/**
 * H3 · Conciliación bancaria · ERP ↔ extracto banco real.
 * Importa CSV/XLSX (parser header-matcher extensible · no asume formato único),
 * matcher determinístico (monto/fecha/referencia · sin IA), aprobar/rechazar match.
 * Read-only sobre F3/CUTOVER · solo escribe en extractos_bancarios / extracto_lineas.
 */
import { db, schema } from '@erp/db';
import { and, desc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { createHash } from 'node:crypto';
import { construirTaxonomia } from '../lib/conciliacionTaxonomia.js';
import { parseEeccBcp } from '../lib/eeccBcp.js';

const router = Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const TOL_MONTO = 1.0;   // S/ tolerancia de monto para match
const TOL_DIAS = 3;      // ventana de fecha ±días

// ── parser header-matcher · detecta columnas por nombre (extensible) ──────────
const norm = (s: unknown) => String(s ?? '').toLowerCase().trim().replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u');
const matchCol = (headers: string[], patterns: RegExp[]) => headers.findIndex((h) => patterns.some((p) => p.test(norm(h))));
function detectColumns(headers: string[]) {
  return {
    fecha: matchCol(headers, [/fecha|date|dia/]),
    desc: matchCol(headers, [/desc|glosa|detalle|concepto|operacion|movimiento/]),
    ref: matchCol(headers, [/ref|nro|numero|num|operac|documento|cod/]),
    monto: matchCol(headers, [/monto|importe|amount|valor/]),
    cargo: matchCol(headers, [/cargo|debito|debe|egreso|salida|retiro/]),
    abono: matchCol(headers, [/abono|credito|haber|ingreso|deposito|entrada/]),
    moneda: matchCol(headers, [/moneda|currency|divisa/]), // NO bare "mon": colisiona con "monto"
    saldo: matchCol(headers, [/saldo|balance/]),
  };
}
// serial Excel → 'YYYY-MM-DD' · epoch 1899-12-30 (cubre bug año-1900) · Math.round absorbe fracción de hora.
// NO usar XLSX.SSF.parse_date_code: cuelga (loop infinito) con seriales fraccionarios. ponytail: conversión directa, sin dep.
function excelSerialAFecha(v: number): string | null {
  if (!Number.isFinite(v) || v <= 0 || v > 60000) return null; // rango Excel razonable (~año 2064)
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
// F4B.4 · valida fecha-calendario REAL (no solo regex) · '2026-13-99' → null (se descarta la fila, no rompe el batch)
function fechaValida(yyyy: string, mm: string, dd: string): string | null {
  const y = +yyyy, mo = +mm, d = +dd;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null; // día/mes inexistente
  return `${yyyy}-${mm}-${dd}`;
}
// fecha flexible → 'YYYY-MM-DD' (acepta serial Excel, dd/mm/yyyy, ISO) · valida calendario
function parseFecha(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return excelSerialAFecha(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return fechaValida(m[1]!, m[2]!, m[3]!);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/); // dd/mm/yyyy
  if (m) { const yy = m[3]!.length === 2 ? `20${m[3]}` : m[3]!; return fechaValida(yy, m[2]!.padStart(2, '0'), m[1]!.padStart(2, '0')); }
  return null;
}
// F4B.2 · numop normalizado (trim + upper + sin ceros a la izquierda) · '53380' == '053380'
const normOp = (s: unknown) => String(s ?? '').trim().toUpperCase().replace(/^0+/, '');
const parseNum = (v: unknown): number => { if (v == null || v === '') return 0; const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
// moneda saneada → código de 3 letras (varchar(3)) · si la celda no es código limpio, usa fallback
const monedaLinea = (raw: string, fallback?: string): string => { const m = raw.trim().toUpperCase(); return /^[A-Z]{3}$/.test(m) ? m : ((fallback || 'PEN').slice(0, 3).toUpperCase()); };

// POST /importar · sube extracto (multipart: file + cuentaId + banco? + moneda?)
router.post('/importar', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'archivo CSV/XLSX/PDF requerido' });
  const { cuentaId, banco, moneda } = req.body as Record<string, string>;
  const esPdf = /\.pdf$/i.test(req.file.originalname) || req.file.mimetype === 'application/pdf';

  const lineas: { fecha: string; descripcion: string; referencia: string | null; monto: number; moneda: string; saldo: number | null }[] = [];

  if (esPdf) {
    // Estado de cuenta BCP en PDF · parser IA (Gemini) · ~110s · extrae todas las líneas con signo
    try {
      const parsed = await parseEeccBcp(req.file.buffer);
      for (const m of parsed.movimientos) {
        lineas.push({ fecha: m.fecha, descripcion: m.descripcion, referencia: m.numOp, monto: m.monto, moneda: moneda || 'PEN', saldo: m.saldo });
      }
    } catch (e) { return res.status(400).json({ error: `No se pudo leer el PDF del banco: ${(e as Error).message}` }); }
    if (lineas.length === 0) return res.status(400).json({ error: 'El PDF no devolvió movimientos. ¿Es un estado de cuenta BCP?' });
  } else {
    let rows: unknown[][];
    try {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]!]!;
      rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' });
    } catch (e) { return res.status(400).json({ error: `No se pudo leer el archivo: ${(e as Error).message}` }); }
    // detectar fila de encabezado (la primera con ≥3 columnas no vacías que mapee fecha+monto)
    let hdrIdx = -1, cols!: ReturnType<typeof detectColumns>;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const c = detectColumns((rows[i] ?? []).map((x) => String(x)));
      if (c.fecha >= 0 && (c.monto >= 0 || c.cargo >= 0 || c.abono >= 0)) { hdrIdx = i; cols = c; break; }
    }
    if (hdrIdx < 0) return res.status(400).json({ error: 'No se detectaron columnas (fecha + monto/cargo/abono). Revisa el formato.' });

    for (let i = hdrIdx + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const fecha = parseFecha(r[cols.fecha]);
      if (!fecha) continue;
      let monto = cols.monto >= 0 ? parseNum(r[cols.monto]) : 0;
      if (cols.cargo >= 0 || cols.abono >= 0) monto = parseNum(cols.abono >= 0 ? r[cols.abono] : 0) - parseNum(cols.cargo >= 0 ? r[cols.cargo] : 0); // abono(+) − cargo(−)
      if (monto === 0 && cols.monto < 0) continue;
      lineas.push({
        fecha, descripcion: cols.desc >= 0 ? String(r[cols.desc] ?? '') : '',
        referencia: cols.ref >= 0 ? String(r[cols.ref] ?? '') || null : null,
        monto, moneda: monedaLinea(cols.moneda >= 0 ? String(r[cols.moneda] ?? '') : '', moneda),
        saldo: cols.saldo >= 0 ? parseNum(r[cols.saldo]) : null,
      });
    }
  }
  // fecha estricta YYYY-MM-DD (defensa · nunca insertar fecha malformada que reviente el insert)
  const limpias = lineas.filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.fecha));
  if (limpias.length === 0) return res.status(400).json({ error: 'No se extrajeron líneas con fecha válida (YYYY-MM-DD)' });

  // F4B.3 · hash determinístico del contenido → dedup de import (mismo extracto no se duplica)
  const totalCargos = limpias.filter((l) => l.monto < 0).reduce((s, l) => s + Math.abs(l.monto), 0);
  const totalAbonos = limpias.filter((l) => l.monto > 0).reduce((s, l) => s + l.monto, 0);
  const contenido = limpias.map((l) => `${l.fecha}|${l.monto.toFixed(2)}|${(l.referencia ?? '').trim()}`).sort().join(';');
  const contenidoHash = createHash('sha256').update(`${cuentaId || ''}|${limpias.length}|${totalCargos.toFixed(2)}|${totalAbonos.toFixed(2)}|${contenido}`).digest('hex');
  const [dup] = await db.select().from(schema.extractosBancarios).where(eq(schema.extractosBancarios.contenidoHash, contenidoHash));
  if (dup) return res.status(409).json({ error: 'Extracto ya importado (mismo contenido)', duplicado: true, extractoExistente: dup.id, importadoEn: dup.importadoEn });

  try {
    const [ext] = await db.insert(schema.extractosBancarios).values({
      cuentaId: cuentaId || null, banco: banco || null, moneda: moneda || 'PEN',
      nombreArchivo: req.file.originalname, totalFilas: limpias.length, importadoPor: req.user!.id, contenidoHash,
    }).returning();
    await db.insert(schema.extractoLineas).values(limpias.map((l) => ({
      extractoId: ext!.id, fecha: l.fecha, descripcion: l.descripcion, referencia: l.referencia,
      monto: l.monto.toFixed(2), moneda: l.moneda, saldo: l.saldo != null ? l.saldo.toFixed(2) : null,
    })));
    await audit(req, { action: 'importar_extracto', entityType: 'extracto_bancario', entityId: ext!.id, after: { archivo: req.file.originalname, filas: limpias.length, cuentaId } });
    const matched = await autoMatch(ext!.id); // matcher determinístico inmediato (sugerencias)
    res.json({ extracto: ext, lineas: limpias.length, descartadas: lineas.length - limpias.length, sugeridos: matched });
  } catch (e) {
    const msg = (e as Error).message;
    // F4B.3 · carrera concurrente: el UNIQUE(contenido_hash) frena el 2º insert simultáneo → 409 (no doble extracto)
    if (/extbanc_hash_unq|duplicate key|23505/.test(msg)) return res.status(409).json({ error: 'Extracto ya importado (carrera concurrente)', duplicado: true });
    res.status(400).json({ error: `No se pudo guardar el extracto: ${msg}` }); // nunca crashea el proceso
  }
});

// ── matcher determinístico (sin IA) · F4B.1 asignación GREEDY 1↔1 (una línea ↔ un movimiento, sin clusters N↔1) ──
async function autoMatch(extractoId: string): Promise<number> {
  const lineas = await db.select().from(schema.extractoLineas).where(and(eq(schema.extractoLineas.extractoId, extractoId), eq(schema.extractoLineas.estado, 'pendiente'), isNull(schema.extractoLineas.movimientoId)));
  if (lineas.length === 0) return 0;
  const [ext] = await db.select().from(schema.extractosBancarios).where(eq(schema.extractosBancarios.id, extractoId));
  // universo de movimientos candidatos: misma cuenta (si el extracto la tiene), no anulados
  const movConds = [ne(schema.movimientos.anulado, true)];
  if (ext?.cuentaId) movConds.push(eq(schema.movimientos.cuentaId, ext.cuentaId));
  const movs = await db.select().from(schema.movimientos).where(and(...movConds));

  // 1 · generar TODOS los candidatos (línea, mov, score) que pasan filtros
  const cands: { lineaId: string; movId: string; score: number; dias: number }[] = [];
  for (const l of lineas) {
    const lMonto = Number(l.monto); const lFecha = new Date(`${l.fecha}T00:00:00`);
    const lRefN = normOp(l.referencia); const lDescN = norm(l.descripcion);
    for (const m of movs) {
      const mBase = Number(m.montoBase ?? m.monto);
      const mSigned = m.tipoMovimiento === 'Ingreso' ? mBase : -mBase;
      const diff = Math.abs(Math.abs(lMonto) - Math.abs(mSigned));
      if (diff > TOL_MONTO) continue;                                  // monto fuera de tolerancia
      if (Math.sign(lMonto) !== Math.sign(mSigned)) continue;          // dirección distinta
      const dias = Math.abs((lFecha.getTime() - new Date(`${String(m.fecha).slice(0, 10)}T00:00:00`).getTime()) / 86400000);
      if (dias > TOL_DIAS) continue;                                   // fecha fuera de ventana
      let score = diff < 0.01 ? 50 : 35;                               // monto
      score += dias < 0.5 ? 30 : 20 - Math.min(dias, TOL_DIAS) * 3;    // fecha
      const mOpN = normOp(m.numOperacion);                             // F4B.2 · numop normalizado (ceros izq)
      if (mOpN && (lRefN === mOpN || lDescN.includes(mOpN))) score += 20;
      else if (m.codigo && lDescN.includes(norm(m.codigo))) score += 10;
      if (score >= 50) cands.push({ lineaId: l.id, movId: m.id, score, dias });
    }
  }
  // 2 · ordenar score DESC (desempate: menos días, luego ids → determinístico)
  cands.sort((a, b) => b.score - a.score || a.dias - b.dias || (a.lineaId + a.movId).localeCompare(b.lineaId + b.movId));
  // 3 · consumir GREEDY: cada movimiento y cada línea se usan UNA sola vez
  const usedMov = new Set<string>(); const usedLinea = new Set<string>();
  let n = 0;
  for (const c of cands) {
    if (usedMov.has(c.movId) || usedLinea.has(c.lineaId)) continue;
    usedMov.add(c.movId); usedLinea.add(c.lineaId);
    const conf = c.score >= 80 ? 'alta' : c.score >= 65 ? 'media' : 'baja';
    await db.update(schema.extractoLineas).set({ movimientoId: c.movId, score: c.score.toFixed(2), confianza: conf }).where(eq(schema.extractoLineas.id, c.lineaId));
    n++;
  }
  return n;
}

// GET / · lista extractos con conteos por estado
router.get('/', async (_req, res) => {
  const ext = await db.select().from(schema.extractosBancarios).orderBy(desc(schema.extractosBancarios.importadoEn));
  const lineas = await db.select({ extractoId: schema.extractoLineas.extractoId, estado: schema.extractoLineas.estado }).from(schema.extractoLineas);
  const byExt = new Map<string, Record<string, number>>();
  for (const l of lineas) { const e = byExt.get(l.extractoId) ?? {}; e[l.estado] = (e[l.estado] ?? 0) + 1; byExt.set(l.extractoId, e); }
  res.json({ extractos: ext.map((e) => ({ ...e, conteos: byExt.get(e.id) ?? {} })) });
});

// GET /:id/lineas · líneas + datos del movimiento sugerido
router.get('/:id/lineas', async (req, res) => {
  const lineas = await db.select().from(schema.extractoLineas).where(eq(schema.extractoLineas.extractoId, req.params.id!)).orderBy(schema.extractoLineas.fecha);
  const movIds = [...new Set(lineas.map((l) => l.movimientoId).filter(Boolean) as string[])];
  const movs = movIds.length ? await db.select().from(schema.movimientos).where(inArray(schema.movimientos.id, movIds)) : [];
  const movMap = new Map(movs.map((m) => [m.id, m]));
  res.json({ lineas: lineas.map((l) => ({ ...l, movimiento: l.movimientoId ? movMap.get(l.movimientoId) ?? null : null })) });
});

// POST /lineas/:id/conciliar · aprueba el match (confirma movimientoId)
router.post('/lineas/:id/conciliar', async (req, res) => {
  const movimientoId = String((req.body as { movimientoId?: string }).movimientoId ?? '');
  if (!movimientoId) return res.status(400).json({ error: 'movimientoId requerido' });
  const [l] = await db.update(schema.extractoLineas).set({ estado: 'conciliado', movimientoId, matchedPor: req.user!.id, matchedEn: new Date() }).where(eq(schema.extractoLineas.id, req.params.id!)).returning();
  if (!l) return res.status(404).json({ error: 'Línea no encontrada' });
  await audit(req, { action: 'conciliar', entityType: 'extracto_linea', entityId: l.id, after: { movimientoId, monto: l.monto } });
  res.json({ linea: l });
});
// POST /lineas/:id/estado · marcar diferencia / ignorado / pendiente
router.post('/lineas/:id/estado', async (req, res) => {
  const { estado, motivo } = req.body as { estado?: string; motivo?: string };
  if (!['pendiente', 'diferencia', 'ignorado'].includes(String(estado))) return res.status(400).json({ error: 'estado inválido' });
  const set: Record<string, unknown> = { estado };
  if (estado === 'pendiente' || estado === 'ignorado') { set.movimientoId = null; set.matchedPor = null; set.matchedEn = null; }
  const [l] = await db.update(schema.extractoLineas).set(set).where(eq(schema.extractoLineas.id, req.params.id!)).returning();
  if (!l) return res.status(404).json({ error: 'Línea no encontrada' });
  await audit(req, { action: 'conciliacion_estado', entityType: 'extracto_linea', entityId: l.id, after: { estado }, motivo: motivo ?? null });
  res.json({ linea: l });
});

// F4.6+ · Readiness v2 · TAXONOMÍA read-only (clasifica pendientes por materialidad · NO gobierna GO)
router.get('/taxonomia', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  res.json(await construirTaxonomia(periodo)); // read-only puro · sin escrituras · sin efecto en readiness/ownership
});

// GET /metricas?periodo= · % conciliado, diferencias, aging (para preclose + dashboard)
router.get('/metricas', async (req, res) => {
  const { periodo } = req.query as { periodo?: string };
  const conds = [];
  if (periodo && /^\d{4}-\d{2}$/.test(periodo)) {
    const [yy, mm] = periodo.split('-').map(Number) as [number, number];
    const fin = new Date(yy, mm, 0).getDate(); // último día real del mes (evita fecha inválida -31)
    conds.push(gte(schema.extractoLineas.fecha, `${periodo}-01`), lte(schema.extractoLineas.fecha, `${periodo}-${String(fin).padStart(2, '0')}`));
  }
  const lineas = await db.select().from(schema.extractoLineas).where(conds.length ? and(...conds) : undefined);
  const por = (e: string) => lineas.filter((l) => l.estado === e);
  const total = lineas.length;
  const conciliado = por('conciliado').length;
  const hoy = Date.now();
  const aging = por('pendiente').map((l) => Math.floor((hoy - new Date(`${l.fecha}T00:00:00`).getTime()) / 86400000));
  res.json({
    periodo: periodo ?? null, total,
    conciliado, pendiente: por('pendiente').length, diferencia: por('diferencia').length, ignorado: por('ignorado').length,
    pctConciliado: total ? Math.round((conciliado / total) * 100) : 100,
    diferenciaNeta: por('diferencia').reduce((s, l) => s + Number(l.monto), 0),
    agingMaxDias: aging.length ? Math.max(...aging) : 0,
  });
});

export default router;
