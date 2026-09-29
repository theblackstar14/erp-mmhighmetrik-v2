/**
 * H3 · Conciliación bancaria · ERP ↔ extracto banco real.
 * Importa CSV/XLSX (parser header-matcher extensible · no asume formato único),
 * matcher determinístico (monto/fecha/referencia · sin IA), aprobar/rechazar match.
 * Read-only sobre F3/CUTOVER · solo escribe en extractos_bancarios / extracto_lineas.
 */
import { db, schema } from '@erp/db';
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { createHash } from 'node:crypto';
import { construirTaxonomia } from '../lib/conciliacionTaxonomia.js';
import { parseEeccBcp } from '../lib/eeccBcp.js';
import { clasificarLinea } from '../lib/conciliacionCasos.js';

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
  let saldoAnterior: number | null = null, saldoFinal: number | null = null; // F6 · resumen oficial del EECC

  if (esPdf) {
    // Estado de cuenta BCP en PDF · parser IA (Gemini) · ~110s · extrae todas las líneas con signo
    try {
      const parsed = await parseEeccBcp(req.file.buffer);
      saldoAnterior = parsed.resumen?.saldoAnterior ?? null;
      saldoFinal = parsed.resumen?.saldoFinal ?? null;
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

  // F6 · dedup ENTRE extractos de la misma cuenta (re-import del mes: PDF parcial → PDF final).
  // Una línea con la MISMA fecha+monto+N° de operación ya importada antes entra como 'ignorado'
  // (no re-concilia ni re-suma). Sin N° de operación no hay dedup: montos repetidos el mismo día
  // son reales en el BCP (4× 951.25 el 03-01) y marcarlos sería perder plata del extracto.
  let yaImportadas = new Set<string>();
  if (cuentaId) {
    const previas = await db.select({ fecha: schema.extractoLineas.fecha, monto: schema.extractoLineas.monto, ref: schema.extractoLineas.referencia })
      .from(schema.extractoLineas)
      .innerJoin(schema.extractosBancarios, eq(schema.extractoLineas.extractoId, schema.extractosBancarios.id))
      .where(eq(schema.extractosBancarios.cuentaId, cuentaId));
    yaImportadas = new Set(previas.filter((p) => p.ref).map((p) => `${p.fecha}|${Number(p.monto).toFixed(2)}|${normOp(p.ref)}`));
  }
  const esDuplicada = (l: { fecha: string; monto: number; referencia: string | null }) =>
    !!l.referencia && yaImportadas.has(`${l.fecha}|${l.monto.toFixed(2)}|${normOp(l.referencia)}`);
  const duplicadas = limpias.filter(esDuplicada).length;

  try {
    const [ext] = await db.insert(schema.extractosBancarios).values({
      cuentaId: cuentaId || null, banco: banco || null, moneda: moneda || 'PEN',
      nombreArchivo: req.file.originalname, totalFilas: limpias.length, importadoPor: req.user!.id, contenidoHash,
      saldoAnterior: saldoAnterior != null ? saldoAnterior.toFixed(2) : null,
      saldoFinal: saldoFinal != null ? saldoFinal.toFixed(2) : null,
    }).returning();
    await db.insert(schema.extractoLineas).values(limpias.map((l) => ({
      extractoId: ext!.id, fecha: l.fecha, descripcion: l.descripcion, referencia: l.referencia,
      monto: l.monto.toFixed(2), moneda: l.moneda, saldo: l.saldo != null ? l.saldo.toFixed(2) : null,
      estado: esDuplicada(l) ? ('ignorado' as const) : ('pendiente' as const),
    })));
    await audit(req, { action: 'importar_extracto', entityType: 'extracto_bancario', entityId: ext!.id, after: { archivo: req.file.originalname, filas: limpias.length, cuentaId, duplicadas } });
    const matched = await autoMatch(ext!.id); // matcher determinístico inmediato (sugerencias)
    res.json({ extracto: ext, lineas: limpias.length, descartadas: lineas.length - limpias.length, duplicadasOtroExtracto: duplicadas, sugeridos: matched });
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
    // F6 · los cargos del banco (ITF/COM/MANT) no tienen movimiento propio en el ERP: sugerirles
    // pareja es falso-match seguro (un ITF de 0.25 "cuadra" con cualquier mov chico por la
    // tolerancia de S/1). Su destino es el lote de cargos del banco, no el matcher.
    const caso = clasificarLinea(l.descripcion, lMonto).caso;
    if (caso === 'itf' || caso === 'cargo_banco') continue;
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
  // F6 fix · ambigüedad: 4 líneas de 951.25 el mismo día generan candidatos EMPATADOS — la
  // asignación greedy es determinística pero arbitraria → confianza forzada a 'baja' para revisión
  const scoresPorLinea = new Map<string, number[]>();
  for (const c of cands) { const a = scoresPorLinea.get(c.lineaId) ?? []; a.push(c.score); scoresPorLinea.set(c.lineaId, a); }
  // 3 · consumir GREEDY: cada movimiento y cada línea se usan UNA sola vez
  const usedMov = new Set<string>(); const usedLinea = new Set<string>();
  let n = 0;
  for (const c of cands) {
    if (usedMov.has(c.movId) || usedLinea.has(c.lineaId)) continue;
    usedMov.add(c.movId); usedLinea.add(c.lineaId);
    const scores = (scoresPorLinea.get(c.lineaId) ?? []).sort((a, b) => b - a);
    const empatada = scores.length > 1 && scores[1] === c.score;
    const conf = empatada ? 'baja' : c.score >= 80 ? 'alta' : c.score >= 65 ? 'media' : 'baja';
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

// GET /:id/lineas · líneas + movimiento sugerido + caso de uso clasificado (F6)
router.get('/:id/lineas', async (req, res) => {
  const lineas = await db.select().from(schema.extractoLineas).where(eq(schema.extractoLineas.extractoId, req.params.id!)).orderBy(schema.extractoLineas.fecha);
  const movIds = [...new Set(lineas.map((l) => l.movimientoId).filter(Boolean) as string[])];
  const movs = movIds.length ? await db.select().from(schema.movimientos).where(inArray(schema.movimientos.id, movIds)) : [];
  const movMap = new Map(movs.map((m) => [m.id, m]));
  res.json({
    lineas: lineas.map((l) => ({
      ...l,
      movimiento: l.movimientoId ? movMap.get(l.movimientoId) ?? null : null,
      ...clasificarLinea(l.descripcion, Number(l.monto)), // caso · cuentaSugerida · entradaSugerida
    })),
  });
});

// F6 · POST /:id/confirmar-sugeridas · aprueba en lote las sugerencias del matcher.
// Las de confianza BAJA (empates de monto/fecha) quedan FUERA por defecto: esas las revisa
// Kelly una por una con "Otra pareja". Valida dirección igual que el conciliar individual.
router.post('/:id/confirmar-sugeridas', async (req, res) => {
  const incluirBaja = (req.body as { incluirBaja?: boolean })?.incluirBaja === true;
  const lineas = await db.select().from(schema.extractoLineas).where(and(
    eq(schema.extractoLineas.extractoId, req.params.id!),
    eq(schema.extractoLineas.estado, 'pendiente'),
    sql`${schema.extractoLineas.movimientoId} is not null`,
  ));
  const candidatas = lineas.filter((l) => incluirBaja || l.confianza !== 'baja');
  if (!candidatas.length) return res.json({ conciliadas: 0, saltadas: lineas.length, motivo: 'sin sugerencias confirmables (las de confianza baja se revisan a mano)' });
  const movs = await db.select().from(schema.movimientos).where(inArray(schema.movimientos.id, candidatas.map((l) => l.movimientoId!) ));
  const movMap = new Map(movs.map((m) => [m.id, m]));
  let conciliadas = 0;
  const saltadas: string[] = [];
  for (const l of candidatas) {
    const m = movMap.get(l.movimientoId!);
    const dirLinea = Number(l.monto) >= 0 ? 'Ingreso' : 'Egreso';
    if (!m || m.anulado || (m.tipoMovimiento !== dirLinea && !m.transferenciaId)) { saltadas.push(`${l.fecha} ${fmtMini(l.monto)}`); continue; }
    await db.update(schema.extractoLineas).set({ estado: 'conciliado', matchedPor: req.user!.id, matchedEn: new Date() }).where(eq(schema.extractoLineas.id, l.id));
    conciliadas++;
  }
  await audit(req, { action: 'conciliar_lote', entityType: 'extracto_bancario', entityId: req.params.id!, after: { conciliadas, saltadas: saltadas.length, bajaExcluidas: lineas.length - candidatas.length } });
  res.json({ conciliadas, saltadas: saltadas.length, bajaExcluidas: lineas.length - candidatas.length });
});
const fmtMini = (m: unknown) => Number(m).toFixed(2);

// F6 · POST /cargos-banco · lote: N líneas de cargos del banco (ITF/COM/MANT) → N movimientos
// egreso con cuenta contra manual (editable por fila) + línea conciliada de frente (link directo,
// sin depender del matcher: el ITF no trae N° de operación). El asiento nace en /generar.
router.post('/cargos-banco', async (req, res) => {
  const items = (req.body as { items?: { lineaId: string; cuenta?: string }[] }).items ?? [];
  if (!items.length) return res.status(400).json({ error: 'items requeridos: [{lineaId, cuenta?}]' });
  const lineas = await db.select().from(schema.extractoLineas).where(inArray(schema.extractoLineas.id, items.map((i) => i.lineaId)));
  const extIds = [...new Set(lineas.map((l) => l.extractoId))];
  const exts = await db.select().from(schema.extractosBancarios).where(inArray(schema.extractosBancarios.id, extIds));
  const extMap = new Map(exts.map((e) => [e.id, e]));
  // valida cuentas contables del lote de un golpe
  const cuentas = [...new Set(items.map((i) => i.cuenta ?? clasificarLinea(lineas.find((l) => l.id === i.lineaId)?.descripcion ?? null, -1).cuentaSugerida ?? '679'))];
  const enPlan = new Set((await db.select({ c: schema.planContable.codigo }).from(schema.planContable).where(inArray(schema.planContable.codigo, cuentas))).map((r) => r.c));
  const faltan = cuentas.filter((c) => !enPlan.has(c));
  if (faltan.length) return res.status(400).json({ error: `Cuentas no existen en el plan: ${faltan.join(', ')}` });

  const creados: { lineaId: string; movimientoId: string; cuenta: string }[] = [];
  const errores: string[] = [];
  for (const it of items) {
    const l = lineas.find((x) => x.id === it.lineaId);
    if (!l) { errores.push(`${it.lineaId}: línea no existe`); continue; }
    if (l.estado !== 'pendiente' || l.movimientoId) { errores.push(`${l.fecha} ${l.descripcion?.slice(0, 20)}: ya procesada`); continue; }
    const monto = Number(l.monto);
    if (monto >= 0) { errores.push(`${l.fecha} ${l.descripcion?.slice(0, 20)}: no es un cargo`); continue; }
    const ext = extMap.get(l.extractoId);
    if (!ext?.cuentaId) { errores.push(`${l.fecha}: el extracto no tiene cuenta bancaria asignada`); continue; }
    // F6 fix · moneda extranjera necesita TC histórico → registrar manual (formulario), no el lote
    if ((l.moneda ?? 'PEN') !== 'PEN') { errores.push(`${l.fecha} ${l.descripcion?.slice(0, 20)}: cargo en ${l.moneda} · regístralo manual (necesita TC)`); continue; }
    const cuenta = it.cuenta ?? clasificarLinea(l.descripcion, monto).cuentaSugerida ?? '679';
    try {
      const [mov] = await db.insert(schema.movimientos).values({
        fecha: l.fecha, tipoMovimiento: 'Egreso', cuentaId: ext.cuentaId,
        moneda: l.moneda ?? 'PEN', monto: Math.abs(monto).toFixed(2), subtotal: Math.abs(monto).toFixed(2),
        igv: '0', montoBase: Math.abs(monto).toFixed(2), tipoCambio: null,
        subtipo: 'Cargo bancario', naturalezaContable: 'GASTO_OPERATIVO',
        descripcion: (l.descripcion ?? 'Cargo del banco').slice(0, 250),
        numOperacion: l.referencia, cuentaContable: cuenta, cuentaContableOrigen: 'USUARIO',
        userId: req.user!.id,
      }).returning();
      await db.update(schema.extractoLineas)
        .set({ estado: 'conciliado', movimientoId: mov!.id, matchedPor: req.user!.id, matchedEn: new Date() })
        .where(eq(schema.extractoLineas.id, l.id));
      creados.push({ lineaId: l.id, movimientoId: mov!.id, cuenta });
    } catch (e) {
      errores.push(`${l.fecha} ${l.descripcion?.slice(0, 20)}: ${(e as Error).message}`);
    }
  }
  if (creados.length) await audit(req, { action: 'cargos_banco_lote', entityType: 'extracto_bancario', entityId: extIds[0] ?? 'lote', after: { creados: creados.length, total: items.length, errores } });
  res.json({ creados, errores });
});

// POST /lineas/:id/conciliar · aprueba el match (confirma movimientoId)
// F6 fix · valida el movimiento: existe, NO anulado, misma dirección banco↔ERP. El monto NO se
// exige igual (una línea puede cubrir un pago parcial) ni se bloquea reuso del mov (un ingreso
// del ERP puede cubrir 2 abonos del banco: cliente que paga en partes).
router.post('/lineas/:id/conciliar', async (req, res) => {
  const movimientoId = String((req.body as { movimientoId?: string }).movimientoId ?? '');
  if (!movimientoId) return res.status(400).json({ error: 'movimientoId requerido' });
  const [linea] = await db.select().from(schema.extractoLineas).where(eq(schema.extractoLineas.id, req.params.id!));
  if (!linea) return res.status(404).json({ error: 'Línea no encontrada' });
  const [mov] = await db.select().from(schema.movimientos).where(eq(schema.movimientos.id, movimientoId));
  if (!mov) return res.status(404).json({ error: 'El movimiento no existe' });
  if (mov.anulado) return res.status(400).json({ error: 'El movimiento está ANULADO · no se puede conciliar contra él' });
  const dirLinea = Number(linea.monto) >= 0 ? 'Ingreso' : 'Egreso';
  if (mov.tipoMovimiento !== dirLinea && !mov.transferenciaId) {
    return res.status(400).json({ error: `Dirección distinta: la línea es ${dirLinea === 'Ingreso' ? 'abono' : 'cargo'} y el movimiento es ${mov.tipoMovimiento}` });
  }
  const [l] = await db.update(schema.extractoLineas).set({ estado: 'conciliado', movimientoId, matchedPor: req.user!.id, matchedEn: new Date() }).where(eq(schema.extractoLineas.id, req.params.id!)).returning();
  await audit(req, { action: 'conciliar', entityType: 'extracto_linea', entityId: l!.id, after: { movimientoId, monto: l!.monto } });
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

// ── Panel de RESUMEN de conciliación (Fase 1 · read-only) · saldo banco vs libro (104x) + puente ──
router.get('/resumen', async (req, res) => {
  const cuentaId = String(req.query.cuenta ?? '');
  const periodo = String(req.query.periodo ?? '');
  if (!cuentaId || !/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'cuenta y periodo (YYYY-MM) requeridos' });
  const [cuenta] = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.id, cuentaId)).limit(1);
  if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });

  const [ay, mo] = periodo.split('-').map(Number) as [number, number];
  const desde = `${periodo}-01`;
  const hasta = `${periodo}-${String(new Date(ay, mo, 0).getDate()).padStart(2, '0')}`;
  const n = (x: unknown) => Number(x ?? 0);
  const r2 = (x: number) => Number(x.toFixed(2));
  const hoyMs = Date.now();
  const aging = (f: string) => Math.max(0, Math.round((hoyMs - new Date(`${f}T00:00:00Z`).getTime()) / 86400000));

  // Líneas del extracto de esta cuenta en el periodo
  const lineas = await db.select({
      id: schema.extractoLineas.id, fecha: schema.extractoLineas.fecha, desc: schema.extractoLineas.descripcion,
      monto: schema.extractoLineas.monto, saldo: schema.extractoLineas.saldo, estado: schema.extractoLineas.estado, movimientoId: schema.extractoLineas.movimientoId,
    }).from(schema.extractoLineas)
    .innerJoin(schema.extractosBancarios, eq(schema.extractoLineas.extractoId, schema.extractosBancarios.id))
    .where(and(eq(schema.extractosBancarios.cuentaId, cuentaId), gte(schema.extractoLineas.fecha, desde), lte(schema.extractoLineas.fecha, hasta)))
    .orderBy(schema.extractoLineas.fecha);

  // Saldo banco · PRIORIDAD: el "RESUMEN DEL MES" impreso por el banco (saldo_final del extracto).
  // Fallbacks (extractos sin resumen, p.ej. CSV): columna saldo de la última línea → suma de movimientos.
  const extractosCta = await db.select().from(schema.extractosBancarios).where(eq(schema.extractosBancarios.cuentaId, cuentaId));
  const extPeriodo = extractosCta
    .filter((e) => e.saldoFinal != null)
    .sort((a, b) => +new Date(b.importadoEn) - +new Date(a.importadoEn))[0] ?? null;
  const oficial = extPeriodo?.saldoFinal != null ? n(extPeriodo.saldoFinal) : null;
  const oficialAnterior = extPeriodo?.saldoAnterior != null ? n(extPeriodo.saldoAnterior) : null;

  const conSaldo = lineas.filter((l) => l.saldo != null);
  const sumMovs = lineas.reduce((s, l) => s + n(l.monto), 0);
  const viaColumna = conSaldo.length ? n(conSaldo[conSaldo.length - 1]!.saldo) : null;
  let viaMovimientos: number | null = null, estimado = false;
  if (oficialAnterior != null) { viaMovimientos = r2(oficialAnterior + sumMovs); }
  else if (conSaldo.length) { const p = conSaldo[0]!; viaMovimientos = r2(n(p.saldo) - n(p.monto) + sumMovs); }
  else { estimado = oficial == null; viaMovimientos = r2(sumMovs); }
  const saldoBanco = oficial ?? viaColumna ?? viaMovimientos ?? 0;
  // con saldo oficial: "inconsistente" pasa a significar "la lectura del PDF perdió movimientos"
  // (anterior + Σ líneas ≠ final impreso) · sin oficial: columna vs suma, como antes
  const lecturaPerdida = oficial != null && viaMovimientos != null ? r2(oficial - viaMovimientos) : null;
  const inconsistente = oficial != null
    ? lecturaPerdida != null && Math.abs(lecturaPerdida) > 0.5
    : viaColumna != null && viaMovimientos != null && Math.abs(viaColumna - viaMovimientos) > 0.5;

  // Saldo libro = Σ(debe − haber) de la cuenta 104x de esta cuenta bancaria, hasta fin de periodo
  const cc = cuenta.cuentaContable;
  let saldoLibro = 0;
  if (cc) {
    const [lib] = await db.select({ v: sql<number>`coalesce(sum(${schema.asientosLineas.debe} - ${schema.asientosLineas.haber}),0)::float8` })
      .from(schema.asientosLineas).innerJoin(schema.asientos, eq(schema.asientosLineas.asientoId, schema.asientos.id))
      .where(and(sql`${schema.asientosLineas.cuenta} LIKE ${cc + '%'}`, lte(schema.asientos.fecha, hasta), ne(schema.asientos.status, 'anulado')));
    saldoLibro = n(lib?.v);
  }

  const diferencia = r2(saldoBanco - saldoLibro);
  const estado = Math.abs(diferencia) <= 1.0 ? 'cuadrado' : 'descuadrado';

  // Partidas BANCO → LIBRO (líneas pendientes, clasificadas por glosa)
  const clasifBanco = (d: string | null, monto: number) => {
    const s = (d ?? '').toUpperCase();
    if (/ITF/.test(s)) return 'itf';
    if (/COMIS|COM\.|COM /.test(s)) return 'comisiones';
    if (/INTER[EÉ]S/.test(s)) return 'intereses';
    if (/MANTEN|PORTES|ENVIO|SEGURO/.test(s)) return 'debitos_automaticos';
    return monto > 0 ? 'creditos_no_registrados' : 'debitos_automaticos';
  };
  const bancoNoLibro = lineas.filter((l) => l.estado !== 'conciliado')
    .map((l) => ({ id: l.id, fecha: l.fecha, desc: l.desc, monto: n(l.monto), clase: clasifBanco(l.desc, n(l.monto)), aging: aging(l.fecha) }));

  // Partidas LIBRO → BANCO (movimientos de la cuenta no conciliados)
  const movs = await db.select().from(schema.movimientos)
    .where(and(eq(schema.movimientos.cuentaId, cuentaId), gte(schema.movimientos.fecha, desde), lte(schema.movimientos.fecha, hasta), ne(schema.movimientos.anulado, true)));
  const concMovIds = new Set(lineas.filter((l) => l.movimientoId).map((l) => l.movimientoId));
  const clasifLibro = (m: typeof schema.movimientos.$inferSelect) => {
    if (m.transferenciaId || /TRANSFER/.test((m.naturalezaContable ?? '').toUpperCase())) return 'transferencias_pendientes';
    if (/CHEQUE/.test(`${m.tipoComprobante ?? ''} ${m.subtipo ?? ''}`.toUpperCase())) return 'cheques_pendientes';
    return m.tipoMovimiento === 'Ingreso' ? 'depositos_en_transito' : 'cheques_pendientes';
  };
  const libroNoBanco = movs.filter((m) => !concMovIds.has(m.id))
    .map((m) => ({ id: m.id, fecha: m.fecha, desc: m.descripcion ?? m.clienteNombre, monto: m.tipoMovimiento === 'Ingreso' ? n(m.monto) : -n(m.monto), clase: clasifLibro(m), aging: aging(m.fecha) }));

  const total = lineas.length;
  const conc = lineas.filter((l) => l.estado === 'conciliado').length;

  res.json({
    cuenta: { id: cuenta.id, codigo: cuenta.codigo, descripcion: cuenta.descripcion, banco: cuenta.banco, cuentaContable: cc },
    periodo,
    kpis: { saldoBanco: r2(saldoBanco), saldoLibro: r2(saldoLibro), diferencia, estado, partidasLibroPendientes: libroNoBanco.length, movimientosBancoPendientes: bancoNoLibro.length },
    saldoExtracto: { viaColumna: viaColumna != null ? r2(viaColumna) : null, viaMovimientos, usado: r2(saldoBanco), estimado, inconsistente, oficial, lecturaPerdida },
    partidas: { libroNoBanco, bancoNoLibro },
    calidad: { total, conciliados: conc, pendientes: total - conc, pctConciliado: total ? Number(((conc / total) * 100).toFixed(1)) : 100 },
  });
});

export default router;
