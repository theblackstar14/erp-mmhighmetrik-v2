/**
 * Contabilidad PCGE 2020 · MM HIGH METRIK (MYPE Tributario · contador interno).
 * Plan contable · asientos (manual + motor automático) · diario · mayor ·
 * balance comprobación · fiscal IGV/Renta (pago a cuenta 1% MYPE).
 * Motor automático: batch idempotente por (origen, origenId) — los documentos
 * operativos (gastos, pagos OC, valorizaciones, planilla) generan su asiento.
 * Movimientos de caja NO generan asiento (espejo de gastos/valos · evita doble conteo).
 */
import { db, schema } from '@erp/db';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql as dsql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { NATURALEZAS_CONTABLES, cuentaDeNaturaleza, type NaturalezaContable } from '@erp/shared';
import { createHash } from 'node:crypto';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { freezePeriodo, unfreezePeriodo } from '../lib/periodos.js';
import { derivarClaseCore, cargarDerivarCtx, type DerivarCtx } from '../lib/clasificacion.js';
import { construirTaxonomia } from '../lib/conciliacionTaxonomia.js';
import * as ple from '../lib/ple.js';

// F3 · config del cutover 104x (editable en tabla configuracion_contable · reversible sin deploy)
async function getContabilidadConfig(): Promise<{ cutover: string | null; parallel: boolean }> {
  const rows = await db.select().from(schema.configuracionContable).where(inArray(schema.configuracionContable.clave, ['MOVIMIENTOS_104X_CUTOVER', 'MOVIMIENTOS_104X_PARALLEL']));
  const map = new Map(rows.map((r) => [r.clave, r.valor]));
  const raw = map.get('MOVIMIENTOS_104X_CUTOVER') ?? null;
  const cutover = raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null; // 'YYYY-MM-DD' o null = inerte (legacy manda)
  return { cutover, parallel: (map.get('MOVIMIENTOS_104X_PARALLEL') ?? 'false') === 'true' };
}

// ── F4.4 · REGLA ÚNICA de ownership del 104x (anti-drift) ────────────────────
// El dueño de un evento de caja según su fecha (YYYY-MM-DD) y el cutover vigente.
// cutover=null → SIEMPRE legacy (inerte). cutover=fecha → legacy < fecha, movimiento >= fecha.
// Usada por /generar, buildShadowReport y el simulador → no pueden divergir.
const legacyOwnsCaja = (ymd: string, cutover: string | null) => cutover === null || ymd < cutover;
const movOwnsCaja = (ymd: string, cutover: string | null) => cutover !== null && ymd >= cutover;
const ownerDeCaja = (ymd: string, cutover: string | null): 'legacy' | 'movimiento' => (movOwnsCaja(ymd, cutover) ? 'movimiento' : 'legacy');

const router = Router();
router.use(requireAuth);

const D2 = (n: number) => n.toFixed(2);
const periodoDe = (fecha: string) => String(fecha).slice(0, 7);
const RECON_TOLERANCE = 0.05; // F3-B · tolerancia monetaria única (neto + por-doc + redondeo)
// DEVENGADO · el ingreso de una valorización se reconoce cuando se APRUEBA (percepción del ingreso),
// no cuando se factura. Estos estados generan el asiento de venta 70/12/40111.
// Ojo: el PLE Registro de Ventas (14.1) sí es por comprobante → ese sigue filtrando solo facturada/cobrada.
const VALO_DEVENGADO = ['aprobada', 'conformidad_supervision', 'facturada', 'cobrada'] as const;

// ── Periodo helpers (tabla periodos_contables: anio+mes+estado · proyectoId null = empresa) ──
const partesPeriodo = (periodo: string) => {
  const [anio, mes] = periodo.split('-').map(Number) as [number, number];
  const fin = new Date(anio, mes, 0).getDate();
  return { anio, mes, fechaInicio: `${periodo}-01`, fechaFin: `${periodo}-${String(fin).padStart(2, '0')}` };
};

async function buscarPeriodo(periodo: string) {
  const { anio, mes } = partesPeriodo(periodo);
  const [p] = await db.select().from(schema.periodosContables)
    .where(and(eq(schema.periodosContables.anio, anio), eq(schema.periodosContables.mes, mes), isNull(schema.periodosContables.proyectoId)));
  return p ?? null;
}

async function periodoAbierto(periodo: string): Promise<boolean> {
  const p = await buscarPeriodo(periodo);
  if (!p) {
    const { anio, mes, fechaInicio, fechaFin } = partesPeriodo(periodo);
    await db.insert(schema.periodosContables).values({ anio, mes, fechaInicio, fechaFin }).onConflictDoNothing();
    return true;
  }
  return p.estado === 'abierto' || p.estado === 'reabierto';
}

async function nextCorrelativoAsiento(periodo: string): Promise<string> {
  const pref = `AS-${periodo.replace('-', '')}-`;
  const rows = await db
    .select({ c: schema.asientos.correlativo })
    .from(schema.asientos)
    .where(dsql`${schema.asientos.correlativo} LIKE ${pref + '%'}`);
  const max = rows.reduce((m, r) => Math.max(m, Number(r.c.slice(pref.length)) || 0), 0);
  return `${pref}${String(max + 1).padStart(4, '0')}`;
}

// Inserta asiento + líneas (valida cuadre) · status registrado
// WS1 · cada línea persiste cuenta_contable + obra_id + clase_derivada + cuenta_origen.
//   cuentaContable: cuenta MANUAL (Kelly) si viene; si no, = cuenta inferida (compat).
//   cuentaOrigen: MANUAL|SUGERIDO (viene del origen) o INFERIDO (default del motor).
export type LineaIn = {
  cuenta: string; descripcion?: string | null; debe: number; haber: number;
  cuentaContable?: string | null; obraId?: string | null; cuentaOrigen?: 'USUARIO' | 'SUGERIDO' | 'AUTOMATICO' | null;
};
export async function crearAsiento(opts: {
  fecha: string; glosa: string; lineas: LineaIn[];
  origen?: string; origenId?: string | null; proyectoId?: string | null;
  moneda?: string; tipoCambio?: number | null; docOrigen?: string | null; tipoDoc?: string | null;
  contraparteRuc?: string | null; contraparteRazon?: string | null; status?: 'borrador' | 'registrado';
  userId?: string | null; // H1.2 · trazabilidad de quién generó el asiento
  empresaId?: number; // WS1 · un asiento = una empresa (header). Default MM=1 (operativo actual).
  derivarCtx?: DerivarCtx; // WS1 · contexto precargado (clasificable + mapa) para derivar clase sin N queries
  // overrides para /generar · evitan re-query por asiento (correlativo/periodo/plan) → quita O(n²)
  nextCorrelativo?: () => string; skipPeriodoCheck?: boolean; validCuentas?: Set<string>;
}) {
  const lineas = opts.lineas.filter((l) => l.debe > 0.004 || l.haber > 0.004);
  const debe = lineas.reduce((s, l) => s + l.debe, 0);
  const haber = lineas.reduce((s, l) => s + l.haber, 0);
  if (lineas.length < 2) throw new Error('Asiento necesita al menos 2 líneas');
  const delta = debe - haber; // >0 falta haber · <0 falta debe
  // Umbral de redondeo. Un asiento de planilla acumula redondeo de decenas de líneas (sueldo/EsSalud/ONP/SCTR…)
  // y llegaba a ~S/0.09 > 0.05 → reventaba. Real descuadre (línea faltante) siempre es ≥ S/1. 0.50 separa ambos.
  if (Math.abs(delta) > 0.50) throw new Error(`Asiento descuadrado: debe ${D2(debe)} ≠ haber ${D2(haber)}`);
  if (Math.abs(delta) > 0.01) {
    // Regla 2 · redondeo ≤ S/0.50 → línea automática de ajuste (659 pérdida / 759 ganancia)
    if (delta > 0) lineas.push({ cuenta: '759', descripcion: 'Ajuste por redondeo', debe: 0, haber: Math.abs(delta) });
    else lineas.push({ cuenta: '659', descripcion: 'Ajuste por redondeo', debe: Math.abs(delta), haber: 0 });
  }
  const periodo = periodoDe(opts.fecha);
  if (!opts.skipPeriodoCheck && !(await periodoAbierto(periodo))) throw new Error(`Periodo ${periodo} cerrado`);
  // valida cuentas existen (set precargado si viene de /generar · evita 1 query por asiento)
  const codigos = [...new Set(lineas.map((l) => l.cuenta))];
  let faltan: string[];
  if (opts.validCuentas) {
    faltan = codigos.filter((c) => !opts.validCuentas!.has(c));
  } else {
    const existentes = await db.select({ codigo: schema.planContable.codigo }).from(schema.planContable).where(inArray(schema.planContable.codigo, codigos));
    faltan = codigos.filter((c) => !existentes.some((e) => e.codigo === c));
  }
  if (faltan.length) throw new Error(`Cuentas no existen en el plan: ${faltan.join(', ')}`);

  // correlativo: generador en memoria si viene de /generar (post-validación · sin gaps), si no 1 query
  const correlativo = opts.nextCorrelativo ? opts.nextCorrelativo() : await nextCorrelativoAsiento(periodo);
  const [asiento] = await db.insert(schema.asientos).values({
    correlativo,
    fecha: opts.fecha,
    periodo,
    glosa: opts.glosa,
    origen: opts.origen ?? 'manual',
    origenId: opts.origenId ?? null,
    proyectoId: opts.proyectoId ?? null,
    moneda: opts.moneda ?? 'PEN',
    tipoCambio: opts.tipoCambio != null ? String(opts.tipoCambio) : null,
    docOrigen: opts.docOrigen ?? null,
    tipoDoc: opts.tipoDoc ?? null,
    contraparteRuc: opts.contraparteRuc ?? null,
    contraparteRazon: opts.contraparteRazon ?? null,
    status: opts.status ?? 'registrado',
    userId: opts.userId ?? null,
    empresaId: opts.empresaId ?? 1, // WS1 · header empresa (default MM=1 · operativo actual es mono-empresa)
  }).returning();
  // WS1 · ctx para derivar clase (preload si viene de /generar; si no, carga una vez para este asiento)
  const ctx = opts.derivarCtx ?? (await cargarDerivarCtx());
  // 1 INSERT batch de líneas (antes: 1 round-trip por línea)
  await db.insert(schema.asientosLineas).values(
    lineas.map((l, idx) => {
      const cuentaContable = l.cuentaContable ?? l.cuenta; // manual si vino, si no = cuenta inferida (compat)
      // obra por LÍNEA: null explícito (IGV/CxP/control) se respeta; undefined → hereda la del header
      const obraId = l.obraId !== undefined ? l.obraId : (opts.proyectoId ?? null);
      return {
        asientoId: asiento!.id,
        correlativo: idx + 1,
        cuenta: l.cuenta,
        descripcion: l.descripcion ?? null,
        debe: D2(l.debe),
        haber: D2(l.haber),
        cuentaContable,
        obraId,
        claseDerivada: derivarClaseCore(ctx.clasificablePorCuenta.get(cuentaContable) ?? false, obraId, ctx.claseObraPorCuenta.get(cuentaContable)),
        cuentaOrigen: l.cuentaOrigen ?? 'AUTOMATICO', // procedencia: explícita si vino del origen, si no AUTOMATICO
      };
    }),
  );
  return asiento!;
}

// ── Plan contable ────────────────────────────────────────────
// GET /plan?q= · WS1 autocomplete de cuentas (código/descripción, activas, por empresa).
//   Devuelve lo necesario para <CuentaContableSelect>. NO expone CD/GG (se deriva, nunca input).
//   empresaId opcional: filtra compartidas (empresa_id IS NULL) + propias de esa empresa.
router.get('/plan', async (req, res, next) => {
  const { q, empresaId, soloHoja } = req.query as { q?: string; empresaId?: string; soloHoja?: string };
  if (q === undefined) return next(); // sin ?q= → cae al handler de saldos (?periodo=) de abajo
  const term = q.trim().toLowerCase();
  const empId = empresaId ? Number(empresaId) : null;
  const conds = [eq(schema.planContable.activa, true)];
  if (empId) conds.push(or(isNull(schema.planContable.empresaId), eq(schema.planContable.empresaId, empId))!);
  if (soloHoja === '1') conds.push(eq(schema.planContable.esDivisionaria, true));
  if (term) conds.push(or(dsql`lower(${schema.planContable.codigo}) like ${term + '%'}`, dsql`lower(${schema.planContable.descripcion}) like ${'%' + term + '%'}`)!);
  const rows = await db
    .select({
      codigo: schema.planContable.codigo,
      descripcion: schema.planContable.descripcion,
      tipo: schema.planContable.tipo,
      nivel: schema.planContable.nivel,
      esDivisionaria: schema.planContable.esDivisionaria,
      empresaId: schema.planContable.empresaId,
      activa: schema.planContable.activa,
      clasificable: schema.planContable.clasificable,
      claseObra: schema.mapaCuentaClase.claseObra, // WS1 · para que el FE pinte el chip CD/GG derivado (NO editable)
    })
    .from(schema.planContable)
    .leftJoin(schema.mapaCuentaClase, eq(schema.mapaCuentaClase.cuenta, schema.planContable.codigo))
    .where(and(...conds))
    .orderBy(asc(schema.planContable.codigo))
    .limit(30);
  res.json({ cuentas: rows });
});

// WS1 · GET /sugerir-cuenta?proveedorRuc=&tipoGasto= · prefill (pista, no verdad).
//   1) cuenta válida más reciente usada con ESE proveedor (SUGERIDO)
//   2) fallback mapa tipoGasto→cuenta (AUTOMATICO)
//   Solo cuentas existentes y activas en el plan. Devuelve {cuenta, origen} o {cuenta:null}.
router.get('/sugerir-cuenta', async (req, res) => {
  const { proveedorRuc, tipoGasto } = req.query as { proveedorRuc?: string; tipoGasto?: string };
  const activas = new Set((await db.select({ codigo: schema.planContable.codigo }).from(schema.planContable).where(eq(schema.planContable.activa, true))).map((r) => r.codigo));
  // nivel 1 · reciente por proveedor
  if (proveedorRuc?.trim()) {
    const recientes = await db.select({ cuenta: schema.gastos.cuentaContable })
      .from(schema.gastos)
      .where(and(eq(schema.gastos.proveedorRuc, proveedorRuc.trim()), dsql`${schema.gastos.cuentaContable} is not null`))
      .orderBy(desc(schema.gastos.fecha))
      .limit(10);
    const hit = recientes.find((r) => r.cuenta && activas.has(r.cuenta)); // primera activa
    if (hit?.cuenta) return res.json({ cuenta: hit.cuenta, origen: 'SUGERIDO' });
  }
  // nivel 2 · fallback mapa tipoGasto
  if (tipoGasto?.trim()) {
    const [m] = await db.select({ cuenta: schema.gastoCuentaMap.cuenta }).from(schema.gastoCuentaMap).where(eq(schema.gastoCuentaMap.tipoGasto, tipoGasto.trim())).limit(1);
    if (m?.cuenta && activas.has(m.cuenta)) return res.json({ cuenta: m.cuenta, origen: 'AUTOMATICO' });
  }
  res.json({ cuenta: null });
});

// GET /plan?periodo= · cuentas + saldos (movimientos registrados, rollup a padres)
router.get('/plan', async (req, res) => {
  const { periodo } = req.query as { periodo?: string };
  const cuentas = await db.select().from(schema.planContable).orderBy(asc(schema.planContable.codigo));

  const conds = [eq(schema.asientos.status, 'registrado')];
  if (periodo) conds.push(lte(schema.asientos.periodo, periodo)); // saldo acumulado HASTA el periodo
  const movs = await db
    .select({ cuenta: schema.asientosLineas.cuenta, debe: schema.asientosLineas.debe, haber: schema.asientosLineas.haber })
    .from(schema.asientosLineas)
    .innerJoin(schema.asientos, eq(schema.asientosLineas.asientoId, schema.asientos.id))
    .where(and(...conds));

  // saldo directo por cuenta + rollup a todos los prefijos padre
  const acum = new Map<string, { debe: number; haber: number }>();
  for (const m of movs) {
    for (let len = 2; len <= m.cuenta.length; len++) {
      const k = m.cuenta.slice(0, len);
      const e = acum.get(k) ?? { debe: 0, haber: 0 };
      e.debe += Number(m.debe);
      e.haber += Number(m.haber);
      acum.set(k, e);
    }
  }
  const enriched = cuentas.map((c) => {
    const s = acum.get(c.codigo) ?? { debe: 0, haber: 0 };
    return { ...c, debe: s.debe, haber: s.haber, saldo: s.debe - s.haber };
  });
  res.json({ cuentas: enriched });
});

const cuentaSchema = z.object({
  codigo: z.string().min(2).max(10).regex(/^\d+$/),
  descripcion: z.string().min(2),
  tipo: z.string().min(2),
});
router.post('/plan', async (req, res) => {
  const parse = cuentaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { codigo, descripcion, tipo } = parse.data;
  const parent = codigo.length > 2 ? codigo.slice(0, codigo.length - 1) : null;
  if (parent) {
    const [p] = await db.select().from(schema.planContable).where(eq(schema.planContable.codigo, parent));
    if (!p) return res.status(400).json({ error: `Cuenta padre ${parent} no existe` });
  }
  try {
    const [cuenta] = await db.insert(schema.planContable).values({ codigo, descripcion, tipo, parentCodigo: parent, nivel: codigo.length - 1 }).returning();
    res.json({ cuenta });
  } catch {
    res.status(400).json({ error: `Cuenta ${codigo} ya existe` });
  }
});
router.delete('/plan/:codigo', async (req, res) => {
  const codigo = String(req.params.codigo);
  const [mov] = await db.select({ id: schema.asientosLineas.id }).from(schema.asientosLineas).where(eq(schema.asientosLineas.cuenta, codigo)).limit(1);
  if (mov) return res.status(400).json({ error: 'Cuenta con movimientos · no se puede eliminar' });
  const [hija] = await db.select({ codigo: schema.planContable.codigo }).from(schema.planContable).where(eq(schema.planContable.parentCodigo, codigo)).limit(1);
  if (hija) return res.status(400).json({ error: 'Cuenta con sub-cuentas · elimina primero las hijas' });
  await db.delete(schema.planContable).where(eq(schema.planContable.codigo, codigo));
  res.json({ ok: true });
});

// ── Periodos ─────────────────────────────────────────────────
router.get('/periodos', async (_req, res) => {
  const rows = await db.select().from(schema.periodosContables).where(isNull(schema.periodosContables.proyectoId))
    .orderBy(desc(schema.periodosContables.anio), desc(schema.periodosContables.mes));
  // shape simple pa frontend: periodo YYYY-MM · estado abierto/cerrado
  const periodos = rows.map((p) => ({
    periodo: `${p.anio}-${String(p.mes).padStart(2, '0')}`,
    estado: p.estado === 'abierto' || p.estado === 'reabierto' ? 'abierto' : 'cerrado',
    estadoRaw: p.estado, // abierto · reabierto · cerrado (H2 · distingue reabierto)
    cerradoEn: p.fechaCierre ? p.fechaCierre.toISOString() : null,
    cerradoPor: p.cerradoPor ?? null,
    reabiertoPor: p.reabiertoPor ?? null,
    motivoReapertura: p.motivoReapertura ?? null,
    fechaReapertura: p.fechaReapertura ? p.fechaReapertura.toISOString() : null,
    cierreMeta: p.cierreMeta ?? null, // H2.5 · snapshot del cierre
  }));
  res.json({ periodos });
});
router.post('/periodos/:periodo/cerrar', async (req, res) => {
  const periodo = String(req.params.periodo);
  const force = Boolean((req.body as { force?: boolean })?.force);
  // Regla 5 · gate: no cerrar con documentos sin contabilizar (salvo force explícito)
  if (!force) {
    const cob = await calcCobertura(periodo);
    if (cob.total > 0) {
      return res.status(400).json({
        error: `${cob.total} documento(s) del periodo sin contabilizar · genera los asientos automáticos primero (o fuerza el cierre)`,
        cobertura: cob,
      });
    }
  }
  // H2.4 / F4.1 · gate de pre-cierre: no cerrar con bloqueos de integridad sin resolver.
  const shadow = await buildShadowReport(periodo);
  const cfg = await getContabilidadConfig();
  const { bloqueos } = await precloseBloqueos(periodo); // fuente única (igual que /preclose-check)
  const motivo = String((req.body as { motivo?: unknown })?.motivo ?? '').trim();
  let forceMeta: { motivo: string; bloqueos: typeof bloqueos } | null = null;
  if (bloqueos.length) {
    if (!force) return res.status(400).json({ error: 'Pre-cierre con bloqueos de integridad · resuélvelos o fuerza el cierre', bloqueos, parallel: cfg.parallel });
    // F4.1 · bajo PARALLEL el override del bloqueo exige motivo (escape auditado · default seguro + trail defendible).
    if (cfg.parallel && !motivo) return res.status(400).json({ error: 'PARALLEL activo · forzar el cierre con bloqueos exige "motivo" (queda auditado)', bloqueos, parallel: true });
    forceMeta = { motivo, bloqueos }; // snapshot de los bloqueos cruzados al momento del force
  }
  // H2.5 · snapshot del estado al cierre (totals + hash para detectar alteración posterior)
  const [{ na } = { na: 0 }] = await db.select({ na: dsql<number>`count(*)::int` }).from(schema.asientos).where(and(eq(schema.asientos.periodo, periodo), dsql`${schema.asientos.status} != 'anulado'`));
  const snapBase = { legacyNeto: shadow.oficial.legacyNeto, movimientosNeto: shadow.oficial.movimientosNeto, diff: shadow.oficial.diff, asientosCount: na, movimientosCount: shadow.meta.movimientosCount };
  const hash = createHash('sha256').update(JSON.stringify(snapBase)).digest('hex');
  const cierreMeta = { ...snapBase, hash, fechaCierre: new Date().toISOString(), cerradoPor: req.user!.id, force, parallel: cfg.parallel, cutover: cfg.cutover, forceOverride: forceMeta };

  const existente = await buscarPeriodo(periodo);
  if (existente) {
    await db.update(schema.periodosContables).set({ estado: 'cerrado', fechaCierre: new Date(), cerradoPor: req.user!.id, cierreMeta }).where(eq(schema.periodosContables.id, existente.id));
  } else {
    const { anio, mes, fechaInicio, fechaFin } = partesPeriodo(periodo);
    await db.insert(schema.periodosContables).values({ anio, mes, fechaInicio, fechaFin, estado: 'cerrado', fechaCierre: new Date(), cerradoPor: req.user!.id, cierreMeta });
  }
  const frozen = await freezePeriodo(periodo); // H2.1 · congela filas del periodo
  await audit(req, { action: 'cerrar_periodo', entityType: 'periodo', entityId: periodo, motivo: forceMeta?.motivo ?? null, after: { estado: 'cerrado', force, parallel: cfg.parallel, forceOverride: forceMeta, snapshot: snapBase, congeladas: frozen } });
  res.json({ ok: true, cierreMeta, congeladas: frozen });
});
router.post('/periodos/:periodo/reabrir', async (req, res) => {
  const periodo = String(req.params.periodo);
  const motivo = String((req.body as { motivo?: unknown })?.motivo ?? '').trim();
  if (!motivo) return res.status(400).json({ error: 'motivo obligatorio para reabrir un periodo cerrado' }); // H1 · reapertura auditada
  const existente = await buscarPeriodo(periodo);
  if (existente) {
    await db.update(schema.periodosContables).set({ estado: 'reabierto', fechaReapertura: new Date(), reabiertoPor: req.user!.id, motivoReapertura: motivo }).where(eq(schema.periodosContables.id, existente.id));
  }
  const unfrozen = await unfreezePeriodo(periodo); // H2.2 · descongela filas
  await audit(req, { action: 'reabrir_periodo', entityType: 'periodo', entityId: periodo, after: { estado: 'reabierto', descongeladas: unfrozen }, motivo });
  res.json({ ok: true });
});

// ── Asientos · Libro Diario ──────────────────────────────────
router.get('/asientos', async (req, res) => {
  const { periodo, origen } = req.query as { periodo?: string; origen?: string };
  const conds = [];
  if (periodo) conds.push(eq(schema.asientos.periodo, periodo));
  if (origen) conds.push(eq(schema.asientos.origen, origen));
  const list = await db.select().from(schema.asientos).where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(schema.asientos.fecha), asc(schema.asientos.correlativo));
  const ids = list.map((a) => a.id);
  const lineas = ids.length
    ? await db.select().from(schema.asientosLineas).where(inArray(schema.asientosLineas.asientoId, ids)).orderBy(asc(schema.asientosLineas.correlativo))
    : [];
  const byAsiento = new Map<string, typeof lineas>();
  for (const l of lineas) {
    const arr = byAsiento.get(l.asientoId) ?? [];
    arr.push(l);
    byAsiento.set(l.asientoId, arr);
  }
  const enriched = list.map((a) => {
    const ls = byAsiento.get(a.id) ?? [];
    return {
      ...a,
      lineas: ls,
      totalDebe: ls.reduce((s, l) => s + Number(l.debe), 0),
      totalHaber: ls.reduce((s, l) => s + Number(l.haber), 0),
    };
  });
  const registrados = enriched.filter((a) => a.status === 'registrado');
  res.json({
    asientos: enriched,
    stats: {
      count: enriched.length,
      totalDebe: registrados.reduce((s, a) => s + a.totalDebe, 0),
      totalHaber: registrados.reduce((s, a) => s + a.totalHaber, 0),
      porOrigen: enriched.reduce((acc, a) => { acc[a.origen] = (acc[a.origen] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    },
  });
});

const asientoSchema = z.object({
  fecha: z.string().min(10),
  glosa: z.string().min(2),
  moneda: z.string().default('PEN'),
  tipoCambio: z.number().optional().nullable(),
  proyectoId: z.string().uuid().optional().nullable(),
  lineas: z.array(z.object({
    cuenta: z.string().min(2),
    descripcion: z.string().optional().nullable(),
    debe: z.number().min(0).default(0),
    haber: z.number().min(0).default(0),
  })).min(2),
});
router.post('/asientos', async (req, res) => {
  const parse = asientoSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  try {
    const asiento = await crearAsiento({ ...parse.data, origen: 'manual', tipoCambio: parse.data.tipoCambio ?? null, userId: req.user!.id });
    res.status(201).json({ asiento });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
router.post('/asientos/:id/anular', async (req, res) => {
  const [a] = await db.select().from(schema.asientos).where(eq(schema.asientos.id, String(req.params.id)));
  if (!a) return res.status(404).json({ error: 'Asiento no encontrado' });
  if (a.cerradoMes) return res.status(423).json({ error: `Asiento congelado (cierre ${a.cerradoMes}) · reabrir el periodo primero` }); // H2.1
  if (a.periodo && !(await periodoAbierto(a.periodo))) return res.status(400).json({ error: `Periodo ${a.periodo} cerrado` });
  const [upd] = await db.update(schema.asientos).set({ status: 'anulado', updatedAt: new Date() }).where(eq(schema.asientos.id, a.id)).returning();
  await audit(req, { action: 'anular', entityType: 'asiento', entityId: a.id, before: { status: a.status, correlativo: a.correlativo }, after: { status: 'anulado' }, motivo: String((req.body as { motivo?: unknown })?.motivo ?? '') || null });
  res.json({ asiento: upd });
});

// ── Libro Mayor ──────────────────────────────────────────────
router.get('/mayor', async (req, res) => {
  const { cuenta, desde, hasta } = req.query as { cuenta?: string; desde?: string; hasta?: string };
  if (!cuenta) return res.status(400).json({ error: 'cuenta requerida' });
  const conds = [eq(schema.asientos.status, 'registrado'), dsql`${schema.asientosLineas.cuenta} LIKE ${cuenta + '%'}`];
  if (desde) conds.push(gte(schema.asientos.fecha, desde));
  if (hasta) conds.push(lte(schema.asientos.fecha, hasta));
  const rows = await db
    .select({
      fecha: schema.asientos.fecha,
      correlativo: schema.asientos.correlativo,
      glosa: schema.asientos.glosa,
      origen: schema.asientos.origen,
      cuenta: schema.asientosLineas.cuenta,
      descripcion: schema.asientosLineas.descripcion,
      debe: schema.asientosLineas.debe,
      haber: schema.asientosLineas.haber,
    })
    .from(schema.asientosLineas)
    .innerJoin(schema.asientos, eq(schema.asientosLineas.asientoId, schema.asientos.id))
    .where(and(...conds))
    .orderBy(asc(schema.asientos.fecha), asc(schema.asientos.correlativo));
  let saldo = 0;
  const movimientos = rows.map((r) => {
    saldo += Number(r.debe) - Number(r.haber);
    return { ...r, debe: Number(r.debe), haber: Number(r.haber), saldo };
  });
  res.json({
    cuenta,
    movimientos,
    totales: {
      debe: movimientos.reduce((s, m) => s + m.debe, 0),
      haber: movimientos.reduce((s, m) => s + m.haber, 0),
      saldo,
    },
  });
});

// ── Balance de comprobación ──────────────────────────────────
router.get('/balance', async (req, res) => {
  const { periodo } = req.query as { periodo?: string };
  const conds = [eq(schema.asientos.status, 'registrado')];
  if (periodo) conds.push(lte(schema.asientos.periodo, periodo));
  const movs = await db
    .select({ cuenta: schema.asientosLineas.cuenta, debe: schema.asientosLineas.debe, haber: schema.asientosLineas.haber })
    .from(schema.asientosLineas)
    .innerJoin(schema.asientos, eq(schema.asientosLineas.asientoId, schema.asientos.id))
    .where(and(...conds));
  const por2 = new Map<string, { debe: number; haber: number }>();
  for (const m of movs) {
    const k = m.cuenta.slice(0, 2);
    const e = por2.get(k) ?? { debe: 0, haber: 0 };
    e.debe += Number(m.debe);
    e.haber += Number(m.haber);
    por2.set(k, e);
  }
  const nombres = await db.select().from(schema.planContable).where(eq(schema.planContable.nivel, 1));
  const filas = [...por2.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([codigo, s]) => ({
    codigo,
    descripcion: nombres.find((n) => n.codigo === codigo)?.descripcion ?? codigo,
    debe: s.debe,
    haber: s.haber,
    saldoDeudor: Math.max(0, s.debe - s.haber),
    saldoAcreedor: Math.max(0, s.haber - s.debe),
  }));
  res.json({
    filas,
    totales: {
      debe: filas.reduce((s, f) => s + f.debe, 0),
      haber: filas.reduce((s, f) => s + f.haber, 0),
      saldoDeudor: filas.reduce((s, f) => s + f.saldoDeudor, 0),
      saldoAcreedor: filas.reduce((s, f) => s + f.saldoAcreedor, 0),
    },
  });
});

// ── Fiscal · IGV + Renta (MYPE 1%) ───────────────────────────
router.get('/fiscal', async (req, res) => {
  const { periodo } = req.query as { periodo?: string };
  if (!periodo) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  const movs = await db
    .select({ cuenta: schema.asientosLineas.cuenta, debe: schema.asientosLineas.debe, haber: schema.asientosLineas.haber })
    .from(schema.asientosLineas)
    .innerJoin(schema.asientos, eq(schema.asientosLineas.asientoId, schema.asientos.id))
    .where(and(eq(schema.asientos.status, 'registrado'), eq(schema.asientos.periodo, periodo)));

  let igvCredito = 0; // debe 40111 (compras)
  let igvDebito = 0; // haber 40111 (ventas)
  let ingresosNetos = 0; // haber 70x
  for (const m of movs) {
    if (m.cuenta.startsWith('40111')) {
      igvCredito += Number(m.debe);
      igvDebito += Number(m.haber);
    }
    if (m.cuenta.startsWith('70')) ingresosNetos += Number(m.haber) - Number(m.debe);
  }
  const igvNeto = igvDebito - igvCredito; // >0 a pagar · <0 saldo a favor
  const rentaPagoCuenta = Math.max(0, ingresosNetos) * 0.01; // MYPE Tributario · 1% hasta 300 UIT
  res.json({
    periodo,
    igv: { debito: igvDebito, credito: igvCredito, neto: igvNeto, aPagar: Math.max(0, igvNeto), saldoFavor: Math.max(0, -igvNeto) },
    renta: { ingresosNetos, tasa: 0.01, pagoCuenta: rentaPagoCuenta, regimen: 'MYPE Tributario (1% hasta 300 UIT)' },
  });
});

// ── Cobertura · documentos operativos SIN contabilizar (regla 4) ──
async function calcCobertura(periodo: string) {
  const { fechaInicio: desde, fechaFin: hasta } = partesPeriodo(periodo); // fin de mes REAL (no -31 fijo)
  // 5 lecturas independientes en paralelo (antes en serie)
  const [generados, gastosList, ocs, valos, semanas] = await Promise.all([
    db.select({ origen: schema.asientos.origen, origenId: schema.asientos.origenId }).from(schema.asientos).where(and(dsql`${schema.asientos.origen} != 'manual'`, dsql`${schema.asientos.status} != 'anulado'`)),
    db.select({ id: schema.gastos.id, total: schema.gastos.total }).from(schema.gastos).where(and(gte(schema.gastos.fecha, desde), lte(schema.gastos.fecha, hasta))),
    db.select({ id: schema.ordenesCompra.id, pagadoEn: schema.ordenesCompra.pagadoEn }).from(schema.ordenesCompra).where(eq(schema.ordenesCompra.estadoPago, 'pagada')),
    db.select({ id: schema.valorizaciones.id, status: schema.valorizaciones.status, mesPeriodo: schema.valorizaciones.mesPeriodo, fechaEmision: schema.valorizaciones.fechaEmision }).from(schema.valorizaciones).where(inArray(schema.valorizaciones.status, [...VALO_DEVENGADO])),
    db.select({ id: schema.planillaSemanas.id }).from(schema.planillaSemanas).where(and(gte(schema.planillaSemanas.fechaFin, desde), lte(schema.planillaSemanas.fechaFin, hasta))),
  ]);
  const yaSet = new Set(generados.map((a) => `${a.origen}:${a.origenId}`));
  const gastosPend = gastosList.filter((g) => Number(g.total) > 0 && !yaSet.has(`gasto:${g.id}`)).length;
  const pagosPend = ocs.filter((o) => o.pagadoEn && periodoDe(o.pagadoEn.toISOString().slice(0, 10)) === periodo && !yaSet.has(`pago_oc:${o.id}`)).length;
  const valosDelMes = valos.filter((v) => (v.mesPeriodo ?? periodoDe(String(v.fechaEmision))) === periodo);
  const valosPend = valosDelMes.filter((v) => !yaSet.has(`valorizacion:${v.id}`)).length;
  const cobrosPend = valosDelMes.filter((v) => v.status === 'cobrada' && !yaSet.has(`cobro_valo:${v.id}`)).length;
  const planillasPend = semanas.filter((s) => !yaSet.has(`planilla:${s.id}`)).length;

  const total = gastosPend + pagosPend + valosPend + cobrosPend + planillasPend;
  return { periodo, total, gastos: gastosPend, pagosOc: pagosPend, valorizaciones: valosPend, cobros: cobrosPend, planillas: planillasPend };
}

router.get('/cobertura', async (req, res) => {
  const { periodo } = req.query as { periodo?: string };
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  res.json(await calcCobertura(periodo));
});

// ── Mayor resumen · todas las cuentas con movimiento (S.inicial/debe/haber/S.final) ──
router.get('/mayor-resumen', async (req, res) => {
  const { periodo } = req.query as { periodo?: string }; // sin periodo = acumulado
  // Agregación por cuenta en SQL (GROUP BY) · antes traía TODAS las líneas y sumaba en JS (crecía sin tope)
  const aggCols = periodo
    ? {
        inicial: dsql<number>`coalesce(sum(case when ${schema.asientos.periodo} < ${periodo} then ${schema.asientosLineas.debe} - ${schema.asientosLineas.haber} else 0 end),0)::float8`,
        debe: dsql<number>`coalesce(sum(case when ${schema.asientos.periodo} = ${periodo} then ${schema.asientosLineas.debe} else 0 end),0)::float8`,
        haber: dsql<number>`coalesce(sum(case when ${schema.asientos.periodo} = ${periodo} then ${schema.asientosLineas.haber} else 0 end),0)::float8`,
        movs: dsql<number>`(count(*) filter (where ${schema.asientos.periodo} = ${periodo}))::int`,
      }
    : {
        inicial: dsql<number>`0::float8`,
        debe: dsql<number>`coalesce(sum(${schema.asientosLineas.debe}),0)::float8`,
        haber: dsql<number>`coalesce(sum(${schema.asientosLineas.haber}),0)::float8`,
        movs: dsql<number>`count(*)::int`,
      };
  const [rows, plan] = await Promise.all([
    db.select({ cuenta: schema.asientosLineas.cuenta, ...aggCols })
      .from(schema.asientosLineas)
      .innerJoin(schema.asientos, eq(schema.asientosLineas.asientoId, schema.asientos.id))
      .where(eq(schema.asientos.status, 'registrado'))
      .groupBy(schema.asientosLineas.cuenta),
    db.select().from(schema.planContable),
  ]);
  const nombre = new Map(plan.map((p) => [p.codigo, { descripcion: p.descripcion, tipo: p.tipo }]));
  const filas = rows
    .filter((a) => a.movs > 0 || Math.abs(a.inicial) > 0.004)
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta))
    .map((a) => ({
      cuenta: a.cuenta,
      descripcion: nombre.get(a.cuenta)?.descripcion ?? a.cuenta,
      tipo: nombre.get(a.cuenta)?.tipo ?? '—',
      inicial: a.inicial,
      debe: a.debe,
      haber: a.haber,
      final: a.inicial + a.debe - a.haber,
      movs: a.movs,
    }));
  res.json({
    filas,
    totales: {
      cuentas: filas.length,
      movs: filas.reduce((s, f) => s + f.movs, 0),
      debe: filas.reduce((s, f) => s + f.debe, 0),
      haber: filas.reduce((s, f) => s + f.haber, 0),
    },
  });
});

// ── Estados Financieros · Balance de Comprobación + ESF + ER (derivados del mayor) ──
// No postea asiento de cierre: el ESF muestra "resultado antes de IR" → cuadra POR CONSTRUCCIÓN
// (los asientos ya están balanceados; check = -Σ(clase 8/9), que es 0 sin asiento de cierre).
// El IR es estimación RMT informativa (provisión NO asentada · la asienta la contadora al cierre anual).
const UIT_DEFAULT = 5350; // ponytail: UIT 2026 · editar por query ?uit= si cambia la RS anual
router.get('/estados-financieros', async (req, res) => {
  const { anio, uit } = req.query as { anio?: string; uit?: string };
  const UIT = Number(uit) > 0 ? Number(uit) : UIT_DEFAULT;
  const hastaPer = anio && /^\d{4}$/.test(anio) ? `${anio}-12` : null; // corte a dic del año, o todo el histórico
  const rows = await db
    .select({
      cuenta: schema.asientosLineas.cuenta,
      debe: dsql<number>`coalesce(sum(${schema.asientosLineas.debe}),0)::float8`,
      haber: dsql<number>`coalesce(sum(${schema.asientosLineas.haber}),0)::float8`,
    })
    .from(schema.asientosLineas)
    .innerJoin(schema.asientos, eq(schema.asientosLineas.asientoId, schema.asientos.id))
    .where(hastaPer
      ? and(eq(schema.asientos.status, 'registrado'), dsql`${schema.asientos.periodo} <= ${hastaPer}`)
      : eq(schema.asientos.status, 'registrado'))
    .groupBy(schema.asientosLineas.cuenta);
  const plan = await db.select().from(schema.planContable);
  const nombre = new Map(plan.map((p) => [p.codigo, p.descripcion]));

  // Balance de comprobación (por cuenta · debe/haber acumulados + saldos deudor/acreedor)
  const balance = rows
    .filter((r) => Math.abs(r.debe) > 0.004 || Math.abs(r.haber) > 0.004)
    .map((r) => {
      const saldo = r.debe - r.haber;
      return {
        cuenta: r.cuenta, descripcion: nombre.get(r.cuenta) ?? r.cuenta,
        debe: r.debe, haber: r.haber,
        saldoDeudor: saldo > 0 ? saldo : 0, saldoAcreedor: saldo < 0 ? -saldo : 0,
      };
    })
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta));

  // Agrupa por 2 dígitos dentro de una clase (elemento PCGE), con signo natural (deudor +1 / acreedor -1)
  const grupo = (pred: (c: string) => boolean, signo: 1 | -1) => {
    const m = new Map<string, { grupo: string; descripcion: string; monto: number }>();
    for (const r of rows) {
      if (!pred(r.cuenta)) continue;
      const g2 = r.cuenta.slice(0, 2);
      const cur = m.get(g2) ?? { grupo: g2, descripcion: nombre.get(g2) ?? nombre.get(r.cuenta) ?? g2, monto: 0 };
      cur.monto += signo * (r.debe - r.haber);
      m.set(g2, cur);
    }
    return [...m.values()].filter((x) => Math.abs(x.monto) > 0.004).sort((a, b) => a.grupo.localeCompare(b.grupo));
  };
  const cls = (d: string) => (c: string) => c.startsWith(d);
  const activo = [cls('1'), cls('2'), cls('3')].flatMap((p) => grupo(p, 1));
  const pasivo = grupo(cls('4'), -1);
  const patrimonioBase = grupo(cls('5'), -1);
  const ingresos = grupo(cls('7'), -1);
  const gastos = grupo(cls('6'), 1);
  const sum = (a: { monto: number }[]) => a.reduce((s, x) => s + x.monto, 0);

  const totalActivo = sum(activo);
  const totalPasivo = sum(pasivo);
  const totalPatrimonioBase = sum(patrimonioBase);
  const totalIngresos = sum(ingresos);
  const totalGastos = sum(gastos);
  const utilidadAntesIR = totalIngresos - totalGastos;

  // IR RMT: 10% hasta 15 UIT de utilidad neta, 29.5% sobre el exceso (solo si hay utilidad)
  const tope = 15 * UIT;
  const ir = utilidadAntesIR <= 0 ? 0
    : Math.min(utilidadAntesIR, tope) * 0.10 + Math.max(0, utilidadAntesIR - tope) * 0.295;
  const utilidadNeta = utilidadAntesIR - ir;

  const totalPatrimonio = totalPatrimonioBase + utilidadAntesIR; // ESF cuadra con resultado ANTES de IR
  const checkEsf = totalActivo - (totalPasivo + totalPatrimonio);

  res.json({
    anio: anio ?? 'acumulado', uit: UIT,
    balanceComprobacion: {
      filas: balance,
      totales: {
        debe: balance.reduce((s, f) => s + f.debe, 0), haber: balance.reduce((s, f) => s + f.haber, 0),
        saldoDeudor: balance.reduce((s, f) => s + f.saldoDeudor, 0), saldoAcreedor: balance.reduce((s, f) => s + f.saldoAcreedor, 0),
      },
    },
    esf: { activo, pasivo, patrimonio: patrimonioBase, totalActivo, totalPasivo, totalPatrimonioBase, resultadoEjercicio: utilidadAntesIR, totalPatrimonio, check: checkEsf },
    er: { ingresos, gastos, totalIngresos, totalGastos, utilidadAntesIR, ir, regimen: 'RMT · 10% hasta 15 UIT, 29.5% exceso', utilidadNeta },
  });
});

// ── Conciliación bancaria · libros (104x) vs tesorería (movimientos) ──
router.get('/conciliacion', async (_req, res) => {
  // contable (líneas banco/caja) + cuentas + tesorería (GROUP BY) · en paralelo
  // (antes traía TODA movimientos y filtraba O(cuentas×movs) en JS)
  const [movsC, cuentasB, tesRows] = await Promise.all([
    db.select({ debe: schema.asientosLineas.debe, haber: schema.asientosLineas.haber })
      .from(schema.asientosLineas)
      .innerJoin(schema.asientos, eq(schema.asientosLineas.asientoId, schema.asientos.id))
      .where(and(eq(schema.asientos.status, 'registrado'), dsql`(${schema.asientosLineas.cuenta} LIKE '104%' OR ${schema.asientosLineas.cuenta} LIKE '101%' OR ${schema.asientosLineas.cuenta} LIKE '107%')`)),
    db.select().from(schema.cuentasBancarias),
    db.select({ cuentaId: schema.movimientos.cuentaId, tipo: schema.movimientos.tipoMovimiento, total: dsql<number>`coalesce(sum(${schema.movimientos.monto}),0)::float8`, n: dsql<number>`count(*)::int` }).from(schema.movimientos).groupBy(schema.movimientos.cuentaId, schema.movimientos.tipoMovimiento),
  ]);
  const saldoContable = movsC.reduce((s, m) => s + Number(m.debe) - Number(m.haber), 0);

  const tesByC = new Map<string, { ing: number; egr: number; n: number }>();
  for (const r of tesRows) {
    const k = r.cuentaId ?? '';
    const e = tesByC.get(k) ?? { ing: 0, egr: 0, n: 0 };
    if (r.tipo === 'Ingreso') e.ing += r.total;
    else e.egr += r.total;
    e.n += r.n;
    tesByC.set(k, e);
  }
  const cuentas = cuentasB.map((c) => {
    const e = tesByC.get(c.id) ?? { ing: 0, egr: 0, n: 0 };
    return { cuenta: c, saldoTesoreria: e.ing - e.egr, movimientos: e.n };
  });
  const saldoTesoreria = cuentas.reduce((s, c) => s + c.saldoTesoreria, 0);
  res.json({
    saldoContable,
    saldoTesoreria,
    diferencia: saldoContable - saldoTesoreria,
    cuentas,
  });
});

// ── Motor automático · genera asientos del periodo ───────────
const CUENTA_POR_TIPO_GASTO: Record<string, string> = {
  'Compra Materiales': '602',
  'Herramientas': '603',
  'EPPS': '603',
  'EPPs': '603',
  'Combustible': '603',
  'Servicio Terceros': '639',
  'Subcontrato': '638',
  'Movilidad': '631',
  'Viáticos': '631',
  'Transporte': '631',
  'Servicios básicos': '636',
  'Alquileres': '635',
  'Mantenimiento': '634',
  'Seguro': '651',
  'Planilla': '621',
  'Gasto Administrativo': '639',
  'Impuestos': '641',
  'Gasto Bancario': '679',
  'Comisión': '679',
  'Utiles de oficina': '603',
};
const cuentaGasto = (tipo: string | null) => CUENTA_POR_TIPO_GASTO[tipo ?? ''] ?? '659';

router.post('/generar', async (req, res) => {
  const { periodo } = req.body as { periodo?: string };
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  if (!(await periodoAbierto(periodo))) return res.status(400).json({ error: `Periodo ${periodo} cerrado` });

  const { fechaInicio: desde, fechaFin: hasta } = partesPeriodo(periodo); // fin de mes REAL
  const yaGenerados = await db
    .select({ origen: schema.asientos.origen, origenId: schema.asientos.origenId })
    .from(schema.asientos)
    .where(and(dsql`${schema.asientos.origen} != 'manual'`, dsql`${schema.asientos.status} != 'anulado'`));
  const yaSet = new Set(yaGenerados.map((a) => `${a.origen}:${a.origenId}`));
  const resultado = { gastos: 0, pagosOc: 0, valorizaciones: 0, cobros: 0, adelantos: 0, planillas: 0, movimientos: 0, movSkip: { preCutover: 0, sinCuenta104x: 0, transferEspejo: 0 }, errores: [] as string[] };

  // F3 · CUTOVER del 104x · legacy (pago_oc/cobro_valo) manda ANTES del cutover, movimientos DESPUÉS.
  // cutover=null → inerte: legacy asienta todo (comportamiento actual), pass de movimientos no asienta nada.
  const cfg = await getContabilidadConfig();
  const dryRunMov = req.query.dryRun === '1' || (req.body as { dryRun?: boolean })?.dryRun === true;
  // F4.4 · ownership vía regla única (cierra el closure sobre el cutover vigente · sin lógica duplicada)
  const legacyOwns = (ymd: string) => legacyOwnsCaja(ymd, cfg.cutover);
  const movOwns = (ymd: string) => movOwnsCaja(ymd, cfg.cutover);

  // Precompute 1 vez · correlativo base (en memoria) + plan válido + periodo ya verificado arriba.
  // Antes cada crearAsiento re-corría LIKE-scan correlativo (O(asientos²)) + query periodo + query plan.
  const corrPref = `AS-${periodo.replace('-', '')}-`;
  const corrRows = await db.select({ c: schema.asientos.correlativo }).from(schema.asientos).where(dsql`${schema.asientos.correlativo} LIKE ${corrPref + '%'}`);
  let corrN = corrRows.reduce((m, r) => Math.max(m, Number(r.c.slice(corrPref.length)) || 0), 0);
  // F1.1 · retención de garantía segregada: asegura la divisionaria 12122 (hija de 1212) · idempotente
  await db.insert(schema.planContable).values({ codigo: '12122', descripcion: 'Retención de garantía por cobrar', tipo: 'activo', parentCodigo: '1212', nivel: 4, esDivisionaria: true }).onConflictDoNothing();
  const planCodes = new Set((await db.select({ codigo: schema.planContable.codigo }).from(schema.planContable)).map((r) => r.codigo));
  const derivarCtx = await cargarDerivarCtx(); // WS1 · preload clasificable+mapa 1 vez (deriva clase sin N queries)
  const asientoBase = { nextCorrelativo: () => `${corrPref}${String(++corrN).padStart(4, '0')}`, skipPeriodoCheck: true as const, validCuentas: planCodes, userId: req.user!.id, derivarCtx };
  const gen = (o: Parameters<typeof crearAsiento>[0]) => crearAsiento({ ...o, ...asientoBase });

  // 1· GASTOS → provisión compra (60x/63x + 40111 / 4212). Determinación de cuenta = mapa editable de la DB.
  const gastosList = await db.select().from(schema.gastos).where(and(gte(schema.gastos.fecha, desde), lte(schema.gastos.fecha, hasta)));
  const cuentaMap = new Map((await db.select().from(schema.gastoCuentaMap)).map((m) => [m.tipoGasto, m]));
  for (const g of gastosList) {
    if (yaSet.has(`gasto:${g.id}`)) continue;
    const cm = cuentaMap.get(g.tipoGasto ?? '');
    if (cm && !cm.esGasto) continue; // no es gasto (financiamiento/CxC) → no se provisiona como compra
    try {
      const subtotal = Number(g.subtotal) + Number(g.exonerado);
      const igv = Number(g.igv);
      const total = Number(g.total);
      if (total <= 0) continue;
      await gen({
        fecha: g.fecha,
        glosa: `Compra · ${g.proveedorRazon ?? 's/proveedor'} · ${g.descripcionItem ?? g.codigo ?? ''}`.slice(0, 250),
        origen: 'gasto',
        origenId: g.id,
        proyectoId: g.proyectoId,
        docOrigen: [g.serie, g.numero].filter(Boolean).join('-') || null,
        tipoDoc: g.tipoComprobante,
        contraparteRuc: g.proveedorRuc,
        contraparteRazon: g.proveedorRazon,
        lineas: [
          // WS1 · cuenta del gasto: la manual (Kelly) si la eligió, si no la inferida (mapa/fallback). obra en la línea.
          {
            cuenta: g.cuentaContable ?? cm?.cuenta ?? cuentaGasto(g.tipoGasto),
            descripcion: g.tipoGasto ?? 'Gasto', debe: subtotal, haber: 0,
            obraId: g.proyectoId,
            cuentaOrigen: g.cuentaContable ? ((g.cuentaContableOrigen as 'USUARIO' | 'SUGERIDO' | 'AUTOMATICO' | null) ?? 'AUTOMATICO') : 'AUTOMATICO',
          },
          { cuenta: '40111', descripcion: 'IGV crédito fiscal', debe: igv, haber: 0, obraId: null },
          { cuenta: '4212', descripcion: 'Por pagar', debe: 0, haber: total, obraId: null },
        ],
      });
      resultado.gastos++;
    } catch (e) {
      resultado.errores.push(`gasto ${g.codigo ?? g.id}: ${(e as Error).message}`);
    }
  }

  // 2· PAGOS OC (estadoPago=pagada en el periodo) → 4212 / 1041
  const ocsPagadas = await db.select().from(schema.ordenesCompra).where(eq(schema.ordenesCompra.estadoPago, 'pagada'));
  for (const oc of ocsPagadas) {
    if (!oc.pagadoEn) continue;
    const f = oc.pagadoEn.toISOString().slice(0, 10);
    if (periodoDe(f) !== periodo) continue;
    if (yaSet.has(`pago_oc:${oc.id}`)) continue;
    if (!legacyOwns(f)) continue; // F3 · pago >= cutover → lo asienta el movimiento, no la regla legacy
    try {
      const total = Number(oc.total);
      await gen({
        fecha: f,
        glosa: `Pago ${oc.numero}`,
        origen: 'pago_oc',
        origenId: oc.id,
        proyectoId: oc.proyectoId,
        docOrigen: oc.numero,
        lineas: [
          { cuenta: '4212', descripcion: `Cancelación ${oc.numero}`, debe: total, haber: 0 },
          { cuenta: '1041', descripcion: 'Banco', debe: 0, haber: total },
        ],
      });
      resultado.pagosOc++;
    } catch (e) {
      resultado.errores.push(`pago ${oc.numero}: ${(e as Error).message}`);
    }
  }

  // 3· VALORIZACIONES devengadas del periodo (aprobadas+) → 1212 / 7041 + 40111
  const valos = await db.select().from(schema.valorizaciones).where(inArray(schema.valorizaciones.status, [...VALO_DEVENGADO]));
  for (const v of valos) {
    const mes = v.mesPeriodo ?? periodoDe(String(v.fechaEmision));
    if (mes !== periodo) continue;
    if (!yaSet.has(`valorizacion:${v.id}`)) {
      try {
        const sinIgv = Number(v.montoCd);
        const igv = Number(v.montoIgv);
        const total = Number(v.montoTotalConIgv ?? v.montoTotal);
        // F1.1 · la retención de garantía nace segregada en 12122; la 1212 queda solo con lo exigible.
        const retGar = Math.min(Math.max(Number(v.montoRetencion ?? 0), 0), total);
        // F1.2 · amortización de anticipo: la factura SUNAT la resta ANTES del IGV (campo "Anticipos"),
        // así que total/montoIgv ya vienen netos. El debe 122 cancela el anticipo; el ingreso (7041) es bruto.
        const amort = Math.max(Number(v.montoAmortizaciones ?? 0), 0);
        // con amortización el IGV de la factura es montoIgv (0.18 × base neta); el fallback total−sinIgv
        // solo vale cuando no hay amortización (sinIgv es el bruto).
        const igvLinea = amort > 0 ? igv : (Math.max(0, total - sinIgv) || igv);
        await gen({
          fecha: String(v.fechaEmision),
          glosa: `Valorización N°${v.numero} devengada`,
          origen: 'valorizacion',
          origenId: v.id,
          proyectoId: v.proyectoId,
          lineas: [
            { cuenta: '1212', descripcion: `Val N°${v.numero}`, debe: total - retGar, haber: 0, obraId: null },
            { cuenta: '12122', descripcion: `Retención garantía Val N°${v.numero}`, debe: retGar, haber: 0, obraId: null },
            { cuenta: '122', descripcion: `Amortización anticipo Val N°${v.numero}`, debe: amort, haber: 0, obraId: null },
            // WS1 · cuenta de ingreso: la que Kelly confirmó (default fuerte 7041). Deriva clase (70x → null).
            {
              cuenta: v.cuentaContable ?? '7041', descripcion: 'Servicios de construcción', debe: 0, haber: sinIgv,
              obraId: v.proyectoId,
              cuentaOrigen: v.cuentaContable ? ((v.cuentaContableOrigen as 'USUARIO' | 'SUGERIDO' | 'AUTOMATICO' | null) ?? 'AUTOMATICO') : 'AUTOMATICO',
            },
            { cuenta: '40111', descripcion: 'IGV débito fiscal', debe: 0, haber: igvLinea, obraId: null },
          ],
        });
        resultado.valorizaciones++;
      } catch (e) {
        resultado.errores.push(`valo ${v.numero}: ${(e as Error).message}`);
      }
    }
    // F3 · cobro · legacy manda si la emisión es < cutover (proxy de fecha de cobro · el movimiento
    // usa la fecha real de cobro · la sutileza emisión-vs-cobro se valida en el parallel-run/reporte sombra).
    if (v.status === 'cobrada' && !yaSet.has(`cobro_valo:${v.id}`) && legacyOwns(String(v.fechaEmision).slice(0, 10))) {
      try {
        // F1.1 · sin totalContratista el fallback resta la retención: el cliente nunca paga la garantía
        // en el cobro normal, y acreditar el bruto sobre-cancelaba la 1212.
        const total = Number(v.totalContratista ?? (Number(v.montoTotalConIgv ?? v.montoTotal) - Math.min(Math.max(Number(v.montoRetencion ?? 0), 0), Number(v.montoTotalConIgv ?? v.montoTotal))));
        await gen({
          fecha: String(v.fechaEmision),
          glosa: `Cobro valorización N°${v.numero}`,
          origen: 'cobro_valo',
          origenId: v.id,
          proyectoId: v.proyectoId,
          lineas: [
            { cuenta: '1041', descripcion: 'Banco', debe: total, haber: 0 },
            { cuenta: '1212', descripcion: `Cancelación Val N°${v.numero}`, debe: 0, haber: total },
          ],
        });
        resultado.cobros++;
      } catch (e) {
        resultado.errores.push(`cobro valo ${v.numero}: ${(e as Error).message}`);
      }
    }
  }

  // 3b· ADELANTOS facturados (F1.2) → 1212 / 122 + 40111. La factura de anticipo tributa IGV al emitirse
  // (estructura SUNAT: en la valo el campo "Anticipos" resta la base). El COBRO del anticipo es un
  // movimiento bancario (cuenta contra manual 1212). Devengo documental → sin gate de cutover.
  // Supuesto: adelantos.monto viene CON IGV (nace de pct × monto de contrato, que es con IGV).
  const adelantosFacturados = await db.select().from(schema.adelantos).where(inArray(schema.adelantos.estado, ['pagado', 'amortizado']));
  for (const a of adelantosFacturados) {
    if (!a.fechaPago) continue;
    const f = String(a.fechaPago).slice(0, 10);
    if (periodoDe(f) !== periodo) continue;
    if (yaSet.has(`adelanto:${a.id}`)) continue;
    try {
      const monto = Number(a.monto);
      if (monto <= 0) continue;
      const base = Number((monto / 1.18).toFixed(2));
      await gen({
        fecha: f,
        glosa: `Anticipo ${a.tipo} facturado`,
        origen: 'adelanto',
        origenId: a.id,
        proyectoId: a.proyectoId,
        lineas: [
          { cuenta: '1212', descripcion: 'Factura de anticipo', debe: monto, haber: 0, obraId: null },
          { cuenta: '122', descripcion: 'Anticipo de cliente', debe: 0, haber: base, obraId: null },
          { cuenta: '40111', descripcion: 'IGV débito anticipo', debe: 0, haber: monto - base, obraId: null },
        ],
      });
      resultado.adelantos++;
    } catch (e) {
      resultado.errores.push(`adelanto ${a.id}: ${(e as Error).message}`);
    }
  }

  // 4· PLANILLA (semanas del periodo) → 621/6271 vs 4031/4032/407/4039/40173/469/411
  const semanas = await db.select().from(schema.planillaSemanas).where(and(gte(schema.planillaSemanas.fechaFin, desde), lte(schema.planillaSemanas.fechaFin, hasta)));
  for (const s of semanas) {
    if (yaSet.has(`planilla:${s.id}`)) continue;
    const det = await db.select().from(schema.planillaDetalle).where(eq(schema.planillaDetalle.semanaId, s.id));
    if (det.length === 0) continue;
    const sum = (f: (d: typeof det[number]) => number) => det.reduce((acc, d) => acc + f(d), 0);
    const ingresos = sum((d) => Number(d.totalIngreso));
    const essalud = sum((d) => Number(d.montoEsSalud));
    const sctr = sum((d) => Number(d.montoSctrSalud) + Number(d.montoSctrPension)); // cargas patronales de riesgo
    const sencico = sum((d) => Number(d.montoSencico)); // contribución patronal SENCICO 0.2%
    const onp = sum((d) => Number(d.montoOnp));
    const afp = sum((d) => Number(d.montoAfpAporte) + Number(d.montoAfpComision) + Number(d.montoAfpSeguro));
    const conafov = sum((d) => Number(d.montoConafovicer));
    const renta5 = sum((d) => Number(d.montoRenta5ta));
    const otrosDsctos = sum((d) => Number(d.montoAdelanto) + Number(d.montoSindical));
    const neto = sum((d) => Number(d.netoPago));
    if (ingresos <= 0) continue;
    // WS1 · costo de remuneraciones: agrupar por cuenta contable del detalle (default fuerte 621).
    // Kelly puede imputar el costo de un obrero a otra cuenta; el motor emite 1 línea por cuenta distinta.
    const costoPorCuenta = new Map<string, { monto: number; usuario: boolean }>();
    for (const d of det) {
      const cta = d.cuentaContable ?? '621';
      const e = costoPorCuenta.get(cta) ?? { monto: 0, usuario: false };
      e.monto += Number(d.totalIngreso);
      if (d.cuentaContable && d.cuentaContableOrigen === 'USUARIO') e.usuario = true;
      costoPorCuenta.set(cta, e);
    }
    const costoLineas: LineaIn[] = [...costoPorCuenta.entries()]
      .filter(([, v]) => v.monto > 0.004)
      .map(([cta, v]) => ({ cuenta: cta, descripcion: 'Remuneraciones obreros', debe: v.monto, haber: 0, obraId: s.proyectoId, cuentaOrigen: (v.usuario ? 'USUARIO' : 'AUTOMATICO') as 'USUARIO' | 'AUTOMATICO' }));
    try {
      await gen({
        fecha: s.fechaFin,
        glosa: `Planilla CC semana ${s.fechaInicio} al ${s.fechaFin}`,
        origen: 'planilla',
        origenId: s.id,
        proyectoId: s.proyectoId,
        lineas: [
          ...costoLineas,
          { cuenta: '6271', descripcion: 'EsSalud empleador', debe: essalud, haber: 0 },
          { cuenta: '6273', descripcion: 'SCTR empleador (salud + pensión)', debe: sctr, haber: 0 },
          { cuenta: '6279', descripcion: 'SENCICO empleador', debe: sencico, haber: 0 },
          { cuenta: '4031', descripcion: 'EsSalud por pagar', debe: 0, haber: essalud },
          { cuenta: '4034', descripcion: 'SCTR por pagar', debe: 0, haber: sctr },
          { cuenta: '4033', descripcion: 'SENCICO por pagar', debe: 0, haber: sencico },
          { cuenta: '4032', descripcion: 'ONP por pagar', debe: 0, haber: onp },
          { cuenta: '407', descripcion: 'AFP por pagar', debe: 0, haber: afp },
          { cuenta: '4039', descripcion: 'CONAFOVICER por pagar', debe: 0, haber: conafov },
          { cuenta: '40173', descripcion: 'Renta 5ta retenida', debe: 0, haber: renta5 },
          { cuenta: '469', descripcion: 'Otros descuentos (adelantos/sindical)', debe: 0, haber: otrosDsctos },
          { cuenta: '411', descripcion: 'Neto por pagar obreros', debe: 0, haber: neto },
        ],
      });
      resultado.planillas++;
    } catch (e) {
      resultado.errores.push(`planilla ${s.fechaInicio}: ${(e as Error).message}`);
    }
  }

  // ── 5· MOVIMIENTOS de caja (F3) · el 104x nace del movimiento real · GATED por CUTOVER ──
  // Inerte mientras cutover=null (todo cae en preCutover → skip). origen='movimiento' · idempotente.
  // dryRun=1 → cuenta lo que asentaría sin escribir. Si falta cuentaContable (104x) → skip + WARN, no rompe.
  const movs = await db.select().from(schema.movimientos).where(and(gte(schema.movimientos.fecha, desde), lte(schema.movimientos.fecha, hasta)));
  const cuentas104 = new Map(
    (await db.select({ id: schema.cuentasBancarias.id, cc: schema.cuentasBancarias.cuentaContable }).from(schema.cuentasBancarias)).map((c) => [c.id, c.cc]),
  );
  for (const m of movs) {
    if (yaSet.has(`movimiento:${m.id}`)) continue;
    const fmov = String(m.fecha).slice(0, 10);
    if (!movOwns(fmov)) { resultado.movSkip.preCutover++; continue; } // < cutover o sin cutover → manda legacy
    const esTransfer = !!m.transferenciaId;
    if (esTransfer && m.tipoMovimiento !== 'Egreso') { resultado.movSkip.transferEspejo++; continue; } // 1 asiento por transferencia (fila Egreso)
    const banco = m.cuentaId ? cuentas104.get(m.cuentaId) ?? null : null;
    if (!banco) { resultado.movSkip.sinCuenta104x++; console.warn(`WARN movimiento ${m.codigo ?? m.id} skipped: cuenta bancaria sin 104x configurada`); continue; }
    const total = Number(m.montoBase ?? m.monto); // H3.1 · asiento PCGE en PEN (moneda base)
    let lineas: LineaIn[];
    let contraTag: string | null = null; // WS1 · cuenta contra (para etiquetar procedencia/obra tras armar líneas)
    let contraOrigenTag: 'USUARIO' | 'SUGERIDO' | 'AUTOMATICO' = 'AUTOMATICO';
    if (esTransfer) {
      const bancoDest = m.cuentaDestinoId ? cuentas104.get(m.cuentaDestinoId) ?? null : null;
      if (!bancoDest) { resultado.movSkip.sinCuenta104x++; console.warn(`WARN transferencia ${m.id} skipped: cuenta destino sin 104x`); continue; }
      lineas = [
        { cuenta: bancoDest, descripcion: 'Transferencia · destino', debe: total, haber: 0 },
        { cuenta: banco, descripcion: 'Transferencia · origen', debe: 0, haber: total },
      ];
    } else {
      const nat = (m.naturalezaContable ?? '') as NaturalezaContable;
      // contrapartida: doc-link la infiere (pago→4212 · cobro→1212); suelta usa el catálogo; fallback 759/659
      // F1.1 · liberación de retención de garantía: Kelly registra el cobro final con cuenta manual 12122
      // (m.cuentaContable manda sobre la inferida, abajo) — el motor no puede distinguirlo solo.
      let contra = m.ordenCompraId ? '4212' : m.valorizacionId ? '1212' : (nat in NATURALEZAS_CONTABLES ? cuentaDeNaturaleza(nat) : null);
      if (!contra) contra = m.tipoMovimiento === 'Ingreso' ? '759' : '659';
      // WS1 · Kelly puede fijar la cuenta contra manual → manda sobre la inferida.
      if (m.cuentaContable) contra = m.cuentaContable;
      contraTag = contra;
      contraOrigenTag = m.cuentaContable ? ((m.cuentaContableOrigen as 'USUARIO' | 'SUGERIDO' | 'AUTOMATICO' | null) ?? 'AUTOMATICO') : 'AUTOMATICO';
      const docLink = !!(m.ordenCompraId || m.valorizacionId);
      const igv = Number(m.igv ?? 0);
      const sub = Number(m.subtotal ?? 0) || total - igv;
      const simple = docLink || igv <= 0; // pago/cobro: el IGV nació en el devengo → no se re-asienta
      if (m.tipoMovimiento === 'Ingreso') {
        lineas = simple
          ? [{ cuenta: banco, descripcion: m.descripcion, debe: total, haber: 0 }, { cuenta: contra, debe: 0, haber: total }]
          : [{ cuenta: banco, debe: total, haber: 0 }, { cuenta: contra, debe: 0, haber: sub }, { cuenta: '40111', descripcion: 'IGV débito', debe: 0, haber: igv }];
      } else {
        lineas = simple
          ? [{ cuenta: contra, descripcion: m.descripcion, debe: total, haber: 0 }, { cuenta: banco, debe: 0, haber: total }]
          : [{ cuenta: contra, debe: sub, haber: 0 }, { cuenta: '40111', descripcion: 'IGV crédito', debe: igv, haber: 0 }, { cuenta: banco, debe: 0, haber: total }];
      }
    }
    // WS1 · procedencia por línea: la contra lleva MANUAL/SUGERIDO/INFERIDO + obra; banco/IGV/transfer no son de obra.
    for (const l of lineas) {
      if (!esTransfer && contraTag && l.cuenta === contraTag) { l.cuentaOrigen = contraOrigenTag; l.obraId = m.proyectoId; }
      else l.obraId = null; // banco (104x) / IGV / transferencia no llevan dimensión obra
    }
    if (dryRunMov) { resultado.movimientos++; continue; } // dry-run: cuenta pero no escribe
    try {
      await gen({ fecha: fmov, glosa: m.descripcion ?? `Movimiento ${m.tipoMovimiento}`, origen: 'movimiento', origenId: m.id, proyectoId: m.proyectoId, lineas });
      resultado.movimientos++;
    } catch (e) {
      resultado.errores.push(`movimiento ${m.codigo ?? m.id}: ${(e as Error).message}`);
    }
  }

  const totalGenerados = resultado.gastos + resultado.pagosOc + resultado.valorizaciones + resultado.cobros + resultado.adelantos + resultado.planillas + resultado.movimientos;
  if (!dryRunMov && totalGenerados > 0) await audit(req, { action: 'generar', entityType: 'periodo', entityId: periodo, after: { generados: totalGenerados, detalle: resultado } });
  res.json({ ok: true, periodo, generados: totalGenerados, detalle: resultado, cutover: cfg.cutover, parallel: cfg.parallel, dryRunMov });
});

// ── F3-B · REPORTE SOMBRA (read-only · 0 escrituras · no toca CUTOVER) ──────────
// Compara lo que el motor legacy asienta en 104x (1041) contra lo que los movimientos
// de caja asentarían (recálculo de la pasada de /generar, sin gate de cutover) para
// decidir si es seguro flipear el CUTOVER. Determinístico (orden fecha/docId · boundaries
// del periodo explícitos · sin tz local). `?cutover=YYYY-MM-DD` opcional para evaluar un
// corte hipotético; default = config actual, y si null = inicio del periodo (evalúa todo
// el mes como movimiento-owned, que es justo el what-if pre-flip).
// H2.4 · cómputo del reporte sombra extraído a función (reusado por /reporte-sombra y /preclose-check) · sin cambios de output
async function buildShadowReport(periodo: string, cutoverQ = '') {
  const { fechaInicio: desde, fechaFin: hasta } = partesPeriodo(periodo);
  const cfg = await getContabilidadConfig();
  const evalCutover = /^\d{4}-\d{2}-\d{2}/.test(cutoverQ) ? cutoverQ.slice(0, 10) : (cfg.cutover ?? desde);

  // ── lado LEGACY: líneas de 1041 de asientos pago_oc/cobro_valo del periodo (por documento) ──
  // legacy mete TODO el banco en 1041 (no distingue cuenta). neto = Σ(debe−haber): pago=−total, cobro=+total.
  const legacyRows = await db
    .select({ origen: schema.asientos.origen, origenId: schema.asientos.origenId, fecha: schema.asientos.fecha, debe: schema.asientosLineas.debe, haber: schema.asientosLineas.haber })
    .from(schema.asientosLineas)
    .innerJoin(schema.asientos, eq(schema.asientosLineas.asientoId, schema.asientos.id))
    .where(and(
      eq(schema.asientos.status, 'registrado'),
      inArray(schema.asientos.origen, ['pago_oc', 'cobro_valo']),
      eq(schema.asientosLineas.cuenta, '1041'),
      gte(schema.asientos.fecha, desde),
      lte(schema.asientos.fecha, hasta),
    ));
  const legacyByDoc = new Map<string, { neto: number; fecha: string }>();
  for (const r of legacyRows) {
    const key = r.origen === 'pago_oc' ? `oc:${r.origenId}` : `valo:${r.origenId}`;
    const e = legacyByDoc.get(key) ?? { neto: 0, fecha: String(r.fecha).slice(0, 10) };
    e.neto += Number(r.debe) - Number(r.haber);
    legacyByDoc.set(key, e);
  }
  const legacyNeto = legacyRows.reduce((s, r) => s + Number(r.debe) - Number(r.haber), 0);

  // ── lado MOVIMIENTOS: recálculo de la pasada (read-only) · H1 · excluye anulados ──
  const movsAll = await db.select().from(schema.movimientos).where(and(gte(schema.movimientos.fecha, desde), lte(schema.movimientos.fecha, hasta)));
  const movAnulados = movsAll.filter((m) => m.anulado).length;
  const movs = movsAll.filter((m) => !m.anulado)
    .sort((a, b) => (String(a.fecha) + a.id).localeCompare(String(b.fecha) + b.id)); // determinístico
  const cuentasB = await db.select().from(schema.cuentasBancarias);
  const cuentas104 = new Map(cuentasB.map((c) => [c.id, c.cuentaContable]));
  const cuentaNombre = new Map(cuentasB.map((c) => [c.id, c.descripcion ?? c.banco ?? c.codigo]));
  const ocNum = new Map((await db.select({ id: schema.ordenesCompra.id, n: schema.ordenesCompra.numero }).from(schema.ordenesCompra)).map((o) => [o.id, o.n]));
  const valoNum = new Map((await db.select({ id: schema.valorizaciones.id, n: schema.valorizaciones.numero }).from(schema.valorizaciones)).map((v) => [v.id, v.n]));

  const porCuenta = new Map<string, { ingresos: number; egresos: number }>();
  const add104 = (cuenta: string, ing: number, egr: number) => {
    const e = porCuenta.get(cuenta) ?? { ingresos: 0, egresos: 0 };
    e.ingresos += ing; e.egresos += egr; porCuenta.set(cuenta, e);
  };
  const movByDoc = new Map<string, { neto: number; fecha: string; count: number }>();
  const cuentasSin104x = new Set<string>();
  const movimientosSinCuenta: string[] = []; // movimiento sin cuentaId asignada (captura parcial · gap operativo)
  const naturalezaSinCuenta = new Set<string>();
  const docLinkFaltante: string[] = [];
  let movimientosNetoDocLinked = 0; // scope-matched vs legacy (solo doc-linked)
  let movimientosNetoTotal = 0;     // todos los flujos 104x (incluye aportes/préstamos/sueltos)

  for (const m of movs) {
    const fmov = String(m.fecha).slice(0, 10);
    const esTransfer = !!m.transferenciaId;
    const total = Number(m.montoBase ?? m.monto); // H3.1 · comparar SIEMPRE en moneda base (PEN); fallback monto para legacy sin montoBase
    const banco = m.cuentaId ? cuentas104.get(m.cuentaId) ?? null : null;
    if (esTransfer) {
      if (m.tipoMovimiento !== 'Egreso') continue; // 1 evento por transferencia (fila Egreso)
      const bancoDest = m.cuentaDestinoId ? cuentas104.get(m.cuentaDestinoId) ?? null : null;
      if (!m.cuentaId || !m.cuentaDestinoId) movimientosSinCuenta.push(m.codigo ?? m.id); // transfer sin cuenta origen/destino
      if (!banco && m.cuentaId) cuentasSin104x.add(cuentaNombre.get(m.cuentaId) ?? m.cuentaId);
      if (!bancoDest && m.cuentaDestinoId) cuentasSin104x.add(cuentaNombre.get(m.cuentaDestinoId) ?? m.cuentaDestinoId);
      if (banco) add104(banco, 0, total);
      if (bancoDest) add104(bancoDest, total, 0);
      continue; // transfer neta 0 en banco total → no afecta diff oficial
    }
    if (!banco) {
      if (m.cuentaId) cuentasSin104x.add(cuentaNombre.get(m.cuentaId) ?? m.cuentaId);
      else movimientosSinCuenta.push(m.codigo ?? m.id); // sin cuenta bancaria asignada → gap operativo
      continue;
    }
    const signed = m.tipoMovimiento === 'Ingreso' ? total : -total;
    add104(banco, m.tipoMovimiento === 'Ingreso' ? total : 0, m.tipoMovimiento === 'Ingreso' ? 0 : total);
    movimientosNetoTotal += signed;

    const docKey = m.ordenCompraId ? `oc:${m.ordenCompraId}` : m.valorizacionId ? `valo:${m.valorizacionId}` : null;
    const nat = (m.naturalezaContable ?? '') as NaturalezaContable;
    const natDef = nat in NATURALEZAS_CONTABLES ? NATURALEZAS_CONTABLES[nat] : null;
    if (docKey) {
      const e = movByDoc.get(docKey) ?? { neto: 0, fecha: fmov, count: 0 };
      e.neto += signed; e.count++; movByDoc.set(docKey, e);
      movimientosNetoDocLinked += signed;
    } else if (natDef?.docLinked) {
      docLinkFaltante.push(m.codigo ?? m.id); // naturaleza pago/cobro pero sin OC/valo enlazada
    } else if (!natDef) {
      naturalezaSinCuenta.add(m.naturalezaContable ?? '(sin naturaleza)'); // suelto sin cuenta inferible
    }
  }

  // ── doble ownership REAL (señal más peligrosa): docs con asiento legacy Y asiento movimiento ya registrado ──
  const movAsientoIds = new Set(
    (await db.select({ origenId: schema.asientos.origenId }).from(schema.asientos)
      .where(and(eq(schema.asientos.origen, 'movimiento'), eq(schema.asientos.status, 'registrado')))).map((a) => a.origenId),
  );
  const docsConAsientoMov = new Set<string>();
  for (const m of movs) {
    if (!movAsientoIds.has(m.id)) continue;
    const k = m.ordenCompraId ? `oc:${m.ordenCompraId}` : m.valorizacionId ? `valo:${m.valorizacionId}` : null;
    if (k) docsConAsientoMov.add(k);
  }

  // ── reconciliación a nivel documento ──
  const docLabel = (k: string) => k.startsWith('oc:') ? (ocNum.get(k.slice(3)) ?? k) : (valoNum.get(k.slice(5)) ?? k);
  const realDiffs: { tipo: string; docId: string; doc: string; legacyMonto: number; movMonto: number; detalle: string }[] = [];
  const temporales: { tipo: string; docId: string; doc: string; legacyMonto: number; movMonto: number; detalle: string }[] = [];
  let ownershipAmbiguo = 0;
  const docKeys = [...new Set([...legacyByDoc.keys(), ...movByDoc.keys()])].sort();
  for (const k of docKeys) {
    const L = legacyByDoc.get(k);
    const M = movByDoc.get(k);
    const doc = String(docLabel(k));
    const fecha = M?.fecha ?? L?.fecha ?? desde;
    const post = movOwnsCaja(fecha, evalCutover); // F4.4 · regla única (evalCutover siempre concreto aquí → idéntico a fecha>=evalCutover)
    const lm = L?.neto ?? 0, mm = M?.neto ?? 0;
    if (M && M.count > 1) { // >1 movimiento ligado al mismo doc · pago parcial legítimo o doble-pago (verificar)
      temporales.push({ tipo: 'doc_multi_movimiento', docId: k, doc, legacyMonto: lm, movMonto: mm, detalle: `${M.count} movimientos ligados al doc · verificar pago parcial vs doble` });
    }
    if (docsConAsientoMov.has(k) && L) { // legacy + asiento movimiento real = doble conteo en libros
      ownershipAmbiguo++;
      realDiffs.push({ tipo: 'doble_ownership', docId: k, doc, legacyMonto: lm, movMonto: mm, detalle: 'doc tiene asiento legacy Y asiento de movimiento registrado (doble conteo)' });
      continue;
    }
    if (L && !M) {
      if (post) realDiffs.push({ tipo: 'falta_movimiento', docId: k, doc, legacyMonto: lm, movMonto: 0, detalle: 'legacy asienta caja pero no existe movimiento espejo (flip perderia el evento)' });
      // pre-cutover sin mov = histórico congelado → no es diff
    } else if (!L && M) {
      temporales.push({ tipo: 'solo_movimiento', docId: k, doc, legacyMonto: 0, movMonto: mm, detalle: 'movimiento sin asiento legacy (timing emision/cobro o post-cutover esperado)' });
    } else if (L && M) {
      if (Math.sign(lm) !== Math.sign(mm) && Math.abs(lm) > RECON_TOLERANCE && Math.abs(mm) > RECON_TOLERANCE) {
        realDiffs.push({ tipo: 'cuenta_mal_inferida', docId: k, doc, legacyMonto: lm, movMonto: mm, detalle: 'signo opuesto legacy vs movimiento' });
      } else if (Math.abs(Math.abs(lm) - Math.abs(mm)) > RECON_TOLERANCE) {
        realDiffs.push({ tipo: 'monto_inconsistente', docId: k, doc, legacyMonto: lm, movMonto: mm, detalle: `dif ${D2(Math.abs(lm) - Math.abs(mm))} > tolerancia` });
      }
      // match dentro de tolerancia → reconciliado OK
    }
  }

  const porCuenta104x = [...porCuenta.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cuenta, e]) => ({ cuenta, ingresos: e.ingresos, egresos: e.egresos, neto: e.ingresos - e.egresos }));
  const diff = legacyNeto - movimientosNetoDocLinked;
  const config = { cuentasSin104x: [...cuentasSin104x].sort(), movimientosSinCuenta: [...new Set(movimientosSinCuenta)].sort(), naturalezaSinCuenta: [...naturalezaSinCuenta].sort(), docLinkFaltante: docLinkFaltante.sort() };
  const listoParaFlip =
    Math.abs(diff) <= RECON_TOLERANCE &&
    realDiffs.length === 0 &&
    ownershipAmbiguo === 0 &&
    config.cuentasSin104x.length === 0 &&
    config.movimientosSinCuenta.length === 0 &&
    config.naturalezaSinCuenta.length === 0;

  return {
    periodo,
    oficial: { legacyNeto, movimientosNeto: movimientosNetoDocLinked, diff },
    porCuenta104x,
    realDiffs,
    temporales,
    config,
    meta: {
      cutover: cfg.cutover,
      evalCutover,
      parallelRun: cfg.parallel,
      eventosEvaluados: docKeys.length,
      legacyCount: legacyByDoc.size,
      movimientosCount: movs.length,
      movimientosAnulados: movAnulados,
      movimientosNetoTotal, // todos los flujos 104x (informativo · incluye aportes/préstamos/sueltos fuera del scope legacy)
    },
    resumen: {
      realDiffsCount: realDiffs.length,
      ownershipAmbiguo,
      cuentasSin104x: config.cuentasSin104x.length,
      movimientosSinCuenta: config.movimientosSinCuenta.length,
      listoParaFlip,
    },
  };
}

router.get('/reporte-sombra', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  const report = await buildShadowReport(periodo, String(req.query.cutover ?? ''));
  res.json(report);
  // F4.2 · captura idempotente bajo parallel (fire-and-forget · no bloquea la respuesta). Solo para el periodo real (sin what-if cutover).
  if (report.meta.parallelRun && !req.query.cutover) {
    const conPend = await conciliacionPendientePeriodo(periodo);
    void capturarSnapshot(periodo, report.resumen, report.oficial.diff, conPend, report.meta.cutover, true, 'auto');
  }
});

// F4.2 · conteo de líneas de extracto pendientes del periodo (reutilizado por snapshot + preclose).
async function conciliacionPendientePeriodo(periodo: string): Promise<number> {
  const { fechaInicio, fechaFin } = partesPeriodo(periodo);
  const r = await db.select({ estado: schema.extractoLineas.estado }).from(schema.extractoLineas)
    .where(and(gte(schema.extractoLineas.fecha, fechaInicio), lte(schema.extractoLineas.fecha, fechaFin), eq(schema.extractoLineas.estado, 'pendiente')));
  return r.length;
}

// F4.1 · bloqueos de pre-cierre · FUENTE ÚNICA (la usan /preclose-check y el handler cerrar · no pueden divergir).
// Devuelve la lista de bloqueos de integridad del periodo (shadow + conciliación bancaria).
async function precloseBloqueos(periodo: string) {
  const r = await buildShadowReport(periodo);
  const docMulti = r.temporales.filter((t) => t.tipo === 'doc_multi_movimiento').length;
  const { fechaInicio: cDesde, fechaFin: cHasta } = partesPeriodo(periodo);
  const concil = await db.select({ estado: schema.extractoLineas.estado }).from(schema.extractoLineas)
    .where(and(gte(schema.extractoLineas.fecha, cDesde), lte(schema.extractoLineas.fecha, cHasta)));
  const conPend = concil.filter((e) => e.estado === 'pendiente').length;
  const conDif = concil.filter((e) => e.estado === 'diferencia').length;
  const bloqueos = [
    { tipo: 'realDiffs', count: r.resumen.realDiffsCount, detalle: 'diferencias reales legacy vs movimientos' },
    { tipo: 'ownershipAmbiguo', count: r.resumen.ownershipAmbiguo, detalle: 'doble conteo (legacy + asiento movimiento)' },
    { tipo: 'cuentasSin104x', count: r.resumen.cuentasSin104x, detalle: 'cuentas bancarias sin 104x asignado' },
    { tipo: 'movimientosSinCuenta', count: r.resumen.movimientosSinCuenta, detalle: 'movimientos sin cuenta bancaria (captura parcial)' },
    { tipo: 'docLinkFaltante', count: r.config.docLinkFaltante.length, detalle: 'movimientos sin documento ligado (no reconciliables con legacy)' },
    { tipo: 'docMultiMovimiento', count: docMulti, detalle: 'documentos con >1 movimiento ligado (verificar pago parcial vs doble)' },
    { tipo: 'conciliacionPendiente', count: conPend, detalle: 'líneas de extracto bancario sin conciliar' },
    { tipo: 'conciliacionDiferencia', count: conDif, detalle: 'líneas de extracto marcadas como diferencia' },
  ].filter((b) => b.count > 0);
  return { bloqueos, resumen: r.resumen, conciliacion: { pendiente: conPend, diferencia: conDif, total: concil.length }, diff: r.oficial.diff };
}

// F4.2 · snapshot de estabilidad · idempotente 1/día/periodo (onConflictDoNothing) · no-throw.
// El caller decide si llamarlo (auto solo bajo parallel · manual siempre). Evidencia de tendencia pre-cutover.
async function capturarSnapshot(
  periodo: string,
  resumen: { realDiffsCount: number; ownershipAmbiguo: number; cuentasSin104x: number; movimientosSinCuenta: number; listoParaFlip: boolean },
  diff: number, conciliacionPendiente: number, cutover: string | null, parallel: boolean, fuente: 'auto' | 'manual',
): Promise<void> {
  try {
    const fecha = new Date().toISOString().slice(0, 10); // día de captura (dedup)
    const metrics = {
      diff, realDiffsCount: resumen.realDiffsCount, ownershipAmbiguo: resumen.ownershipAmbiguo,
      movimientosSinCuenta: resumen.movimientosSinCuenta, cuentasSin104x: resumen.cuentasSin104x,
      conciliacionPendiente, listoParaFlip: resumen.listoParaFlip,
    };
    const hash = createHash('sha256').update(JSON.stringify({ periodo, fecha, ...metrics })).digest('hex');
    await db.insert(schema.cutoverSnapshots).values({
      periodo, fechaSnapshot: fecha, diff: diff.toFixed(2),
      realDiffsCount: metrics.realDiffsCount, ownershipAmbiguo: metrics.ownershipAmbiguo,
      movimientosSinCuenta: metrics.movimientosSinCuenta, cuentasSin104x: metrics.cuentasSin104x,
      conciliacionPendiente: metrics.conciliacionPendiente, listoParaFlip: metrics.listoParaFlip,
      meta: { cutover, parallel, fuente }, hash,
    }).onConflictDoNothing({ target: [schema.cutoverSnapshots.periodo, schema.cutoverSnapshots.fechaSnapshot] });
  } catch (e) { console.warn(`[cutover-snapshot] no capturado ${periodo}:`, (e as Error).message); }
}

// H2.4 · pre-cierre · convierte el cierre en "estado validado": lista los bloqueos antes de permitir cerrar.
router.get('/preclose-check', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  const cfg = await getContabilidadConfig();
  const { bloqueos, resumen, conciliacion, diff } = await precloseBloqueos(periodo);
  // F4.1 · bajo PARALLEL los bloqueos son DUROS (solo se cruzan con force+motivo+audit en el cierre).
  res.json({ periodo, ok: bloqueos.length === 0, bloqueos, resumen, conciliacion, parallel: cfg.parallel, cutover: cfg.cutover });
  // F4.2 · captura idempotente bajo parallel (fire-and-forget).
  if (cfg.parallel) void capturarSnapshot(periodo, resumen, diff, conciliacion.pendiente, cfg.cutover, true, 'auto');
});

// F4.2 · captura manual ("capturar ahora") · ignora el gate parallel · idempotente 1/día/periodo.
router.post('/cutover-snapshot', async (req, res) => {
  const periodo = String((req.query.periodo ?? (req.body as { periodo?: string })?.periodo) ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  const cfg = await getContabilidadConfig();
  const { resumen, conciliacion, diff } = await precloseBloqueos(periodo);
  await capturarSnapshot(periodo, resumen, diff, conciliacion.pendiente, cfg.cutover, cfg.parallel, 'manual');
  const [snap] = await db.select().from(schema.cutoverSnapshots)
    .where(and(eq(schema.cutoverSnapshots.periodo, periodo), eq(schema.cutoverSnapshots.fechaSnapshot, new Date().toISOString().slice(0, 10))));
  res.json({ ok: true, snapshot: snap ?? null });
});

// F4.2 · tendencia histórica (read-only) · serie de snapshots del periodo, orden cronológico.
router.get('/cutover-trend', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  const snaps = await db.select().from(schema.cutoverSnapshots)
    .where(eq(schema.cutoverSnapshots.periodo, periodo))
    .orderBy(asc(schema.cutoverSnapshots.fechaSnapshot));
  res.json({ periodo, snapshots: snaps });
});

// F4.3 · veredicto del flip (pura · deriva de la salida del shadow · sin reglas nuevas → no drift).
function recomendarFlip(report: Awaited<ReturnType<typeof buildShadowReport>>) {
  const huerfanos = report.realDiffs.filter((d) => d.tipo === 'falta_movimiento').length; // legacy asienta caja pero no hay movimiento espejo >= cutover → se perdería el evento
  const conflictos = report.realDiffs.filter((d) => d.tipo === 'cuenta_mal_inferida').length; // signo opuesto legacy vs movimiento
  const { ownershipAmbiguo, cuentasSin104x, movimientosSinCuenta } = report.resumen;
  const docLink = report.config.docLinkFaltante.length;
  const diffOk = Math.abs(report.oficial.diff) <= RECON_TOLERANCE;
  if (huerfanos > 0 || conflictos > 0 || ownershipAmbiguo > 0) {
    return { nivel: 'imposible' as const, motivo: `Flipear perdería o duplicaría caja: ${huerfanos} evento(s) huérfano(s) (legacy deja de asentar, sin movimiento espejo)${conflictos ? `, ${conflictos} con signo opuesto` : ''}${ownershipAmbiguo ? `, ${ownershipAmbiguo} doble-ownership` : ''}.` };
  }
  if (!diffOk || cuentasSin104x > 0 || movimientosSinCuenta > 0 || docLink > 0) {
    return { nivel: 'riesgoso' as const, motivo: `Sin huérfanos, pero hay gaps de captura/config: diff ${diffOk ? 'ok' : '≠0'}, ${cuentasSin104x} cuentas sin 104x, ${movimientosSinCuenta} mov sin cuenta, ${docLink} sin doc. Resolver antes de flipear.` };
  }
  return { nivel: 'seguro' as const, motivo: 'Legacy y movimientos cuadran a nivel documento, sin huérfanos ni gaps. Flip seguro (confirmar con varios ciclos en paralelo).' };
}

// F4.3 · SIMULADOR de cutover (read-only puro · 0 escrituras · no muta config · no crea asientos).
// "¿Si el cutover hubiera sido X, qué pasaría?" → reusa buildShadowReport(periodo, X) (mismas reglas que shadow/preclose).
router.get('/cutover-simular', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  const cutover = String(req.query.cutover ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutover)) return res.status(400).json({ error: 'cutover requerido (YYYY-MM-DD)' });
  const report = await buildShadowReport(periodo, cutover); // what-if: evalCutover = cutover propuesto
  const recomendacion = recomendarFlip(report);
  res.json({
    periodo,
    cutoverSimulado: report.meta.evalCutover,
    cutoverActual: report.meta.cutover, // config vigente (no se toca)
    recomendacion,
    resumen: report.resumen,
    diff: report.oficial.diff,
    oficial: report.oficial,
    docsAfectados: {
      huerfanos: report.realDiffs.filter((d) => d.tipo === 'falta_movimiento'),  // legacy pierde ownership y no hay espejo
      conflictos: report.realDiffs.filter((d) => d.tipo === 'cuenta_mal_inferida'),
      esperados: report.temporales, // solo_movimiento (post-cutover esperado) / doc_multi
    },
    porCuenta104x: report.porCuenta104x,
    meta: report.meta,
  });
});

// F4.4 · INVARIANTES (read-only · integridad estructural). Cómputo extraído → reusado por /invariantes, watchdog y smoke (anti-drift).
async function computeInvariantes(periodo: string) {
  const { fechaInicio, fechaFin } = partesPeriodo(periodo);
  const cfg = await getContabilidadConfig();
  const report = await buildShadowReport(periodo);
  const movs = await db.select().from(schema.movimientos)
    .where(and(gte(schema.movimientos.fecha, fechaInicio), lte(schema.movimientos.fecha, fechaFin), ne(schema.movimientos.anulado, true)));
  const checks: { check: string; ok: boolean; detalle: string }[] = [];

  // 1 · transfer neto 0 (cada transferenciaId: Σ con signo ≈ 0)
  const porTransfer = new Map<string, number>();
  for (const m of movs) {
    if (!m.transferenciaId) continue;
    const base = Number(m.montoBase ?? m.monto);
    porTransfer.set(m.transferenciaId, (porTransfer.get(m.transferenciaId) ?? 0) + (m.tipoMovimiento === 'Ingreso' ? base : -base));
  }
  const transferRotas = [...porTransfer.entries()].filter(([, n]) => Math.abs(n) > RECON_TOLERANCE);
  checks.push({ check: 'transfer_neto_cero', ok: transferRotas.length === 0, detalle: transferRotas.length ? `${transferRotas.length} transferencia(s) con neto ≠ 0: ${transferRotas.map(([id]) => id.slice(0, 8)).join(', ')}` : `${porTransfer.size} transferencia(s) cuadran a neto 0` });

  // 2 · no doble 104x (XOR ownership): ningún doc con asiento legacy Y de movimiento
  checks.push({ check: 'ownership_xor', ok: report.resumen.ownershipAmbiguo === 0, detalle: report.resumen.ownershipAmbiguo === 0 ? 'sin doble-ownership' : `${report.resumen.ownershipAmbiguo} doc(s) con doble conteo (legacy + movimiento)` });

  // 3 · parallel gating / ownership NO movido: cutover=null ⇒ 0 asientos origen='movimiento'
  const [{ nm } = { nm: 0 }] = await db.select({ nm: dsql<number>`count(*)::int` }).from(schema.asientos)
    .where(and(eq(schema.asientos.periodo, periodo), eq(schema.asientos.origen, 'movimiento')));
  const gatingOk = cfg.cutover === null ? nm === 0 : true;
  checks.push({ check: 'parallel_gating', ok: gatingOk, detalle: cfg.cutover === null ? (nm === 0 ? 'cutover=null → 0 asientos de movimiento (legacy manda · ownership intacto)' : `cutover=null pero existen ${nm} asientos origen=movimiento (¡ownership movido sin flip!)`) : `cutover=${cfg.cutover} → ownership de movimiento esperado (${nm} asientos)` });

  // 4 · moneda consistente: todo movimiento ≠PEN con tipoCambio>0 y montoBase
  const monedaRotos = movs.filter((m) => m.moneda !== 'PEN' && (!m.tipoCambio || Number(m.tipoCambio) <= 0 || m.montoBase == null));
  checks.push({ check: 'moneda_consistente', ok: monedaRotos.length === 0, detalle: monedaRotos.length ? `${monedaRotos.length} movimiento(s) ≠PEN sin TC/montoBase: ${monedaRotos.map((m) => m.codigo ?? m.id.slice(0, 8)).join(', ')}` : 'multimoneda con TC y montoBase OK' });

  // 5 · freeze respetado: si el periodo está cerrado, sus filas deben estar congeladas
  const per = await buscarPeriodo(periodo);
  if (per?.estado === 'cerrado') {
    const [{ sinLock } = { sinLock: 0 }] = await db.select({ sinLock: dsql<number>`count(*)::int` }).from(schema.movimientos)
      .where(and(gte(schema.movimientos.fecha, fechaInicio), lte(schema.movimientos.fecha, fechaFin), isNull(schema.movimientos.lockedAt)));
    checks.push({ check: 'freeze_respetado', ok: sinLock === 0, detalle: sinLock === 0 ? 'periodo cerrado · filas congeladas (locked_at)' : `periodo cerrado pero ${sinLock} movimiento(s) sin locked_at (freeze incompleto)` });
  } else {
    checks.push({ check: 'freeze_respetado', ok: true, detalle: 'periodo abierto · freeze no aplica' });
  }

  // 6 · snapshots idempotentes: 0 duplicados (periodo, fecha_snapshot)
  const dups = await db.select({ n: dsql<number>`count(*)::int` }).from(schema.cutoverSnapshots)
    .where(eq(schema.cutoverSnapshots.periodo, periodo))
    .groupBy(schema.cutoverSnapshots.fechaSnapshot)
    .having(dsql`count(*) > 1`);
  checks.push({ check: 'snapshots_idempotentes', ok: dups.length === 0, detalle: dups.length === 0 ? 'sin duplicados (1/día/periodo)' : `${dups.length} día(s) con snapshot duplicado` });

  // 7 · consistencia interna del diff (legacyNeto − movimientosNeto == diff reportado)
  const diffCalc = report.oficial.legacyNeto - report.oficial.movimientosNeto;
  checks.push({ check: 'diff_interno_consistente', ok: Math.abs(diffCalc - report.oficial.diff) <= 0.001, detalle: `diff=${D2(report.oficial.diff)} = legacy(${D2(report.oficial.legacyNeto)}) − mov(${D2(report.oficial.movimientosNeto)})` });

  const ok = checks.every((c) => c.ok);
  return { periodo, ok, checks, contexto: { cutover: cfg.cutover, parallel: cfg.parallel } };
}
router.get('/invariantes', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  res.json(await computeInvariantes(periodo));
});

// ── F4.6 · WATCHDOG (read-only) · consolida shadow+invariantes+preclose+tendencia+config → semáforo ──
const tendencia = (vals: number[]): 'mejorando' | 'empeorando' | 'estable' | 'sin_datos' => {
  if (vals.length < 2) return 'sin_datos';
  const d = Math.abs(vals[vals.length - 1]!) - Math.abs(vals[0]!); // shrink (incl. |diff|) = mejor
  return Math.abs(d) < 0.01 ? 'estable' : d < 0 ? 'mejorando' : 'empeorando';
};

router.get('/watchdog', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  const cfg = await getContabilidadConfig();
  const shadow = await buildShadowReport(periodo);
  const inv = await computeInvariantes(periodo);
  const pre = await precloseBloqueos(periodo);
  const snaps = await db.select().from(schema.cutoverSnapshots).where(eq(schema.cutoverSnapshots.periodo, periodo)).orderBy(asc(schema.cutoverSnapshots.fechaSnapshot));
  const flip = recomendarFlip(shadow);

  const gapsActivos = {
    movimientosSinCuenta: shadow.resumen.movimientosSinCuenta,
    cuentasSin104x: shadow.resumen.cuentasSin104x,
    docLinkFaltante: shadow.config.docLinkFaltante.length,
    conciliacionPendiente: pre.conciliacion.pendiente,
  };
  const tendenciaDiff = tendencia(snaps.map((s) => Number(s.diff)));
  const tendenciaOwnership = tendencia(snaps.map((s) => s.ownershipAmbiguo));
  const tendenciaMovSinCuenta = tendencia(snaps.map((s) => s.movimientosSinCuenta));
  const hoy = new Date().toISOString().slice(0, 10);
  const snapshotsFaltantes = cfg.parallel && !snaps.some((s) => s.fechaSnapshot === hoy);

  // tamper-evidence: periodo cerrado cuyo estado actual ≠ snapshot de cierre (H2.5 hash) → "cerrado con cambios"
  let cerradoConCambios = false;
  const per = await buscarPeriodo(periodo);
  if (per?.estado === 'cerrado' && per.cierreMeta && (per.cierreMeta as { hash?: string }).hash) {
    const [{ na } = { na: 0 }] = await db.select({ na: dsql<number>`count(*)::int` }).from(schema.asientos).where(and(eq(schema.asientos.periodo, periodo), dsql`${schema.asientos.status} != 'anulado'`));
    const snapBase = { legacyNeto: shadow.oficial.legacyNeto, movimientosNeto: shadow.oficial.movimientosNeto, diff: shadow.oficial.diff, asientosCount: na, movimientosCount: shadow.meta.movimientosCount };
    const hashAhora = createHash('sha256').update(JSON.stringify(snapBase)).digest('hex');
    cerradoConCambios = hashAhora !== (per.cierreMeta as { hash: string }).hash;
  }

  const razones: string[] = [];
  const recomendaciones: string[] = [];
  const invFail = inv.checks.filter((c) => !c.ok);
  // ── ROJO (integridad rota · NO flipear) ──
  if (invFail.length) razones.push(`Invariante(s) roto(s): ${invFail.map((c) => c.check).join(', ')}`);
  if (shadow.resumen.ownershipAmbiguo > 0) razones.push(`${shadow.resumen.ownershipAmbiguo} doc(s) con doble-ownership (legacy + movimiento)`);
  if (shadow.resumen.realDiffsCount > 0) razones.push(`${shadow.resumen.realDiffsCount} diferencia(s) real(es) legacy vs movimientos`);
  if (cerradoConCambios) razones.push('Periodo CERRADO con estado alterado tras el cierre (hash no coincide con el snapshot H2.5)');
  const rojo = invFail.length > 0 || shadow.resumen.ownershipAmbiguo > 0 || shadow.resumen.realDiffsCount > 0 || cerradoConCambios;
  // ── AMARILLO (gaps / deterioro · revisar antes de flip) ──
  const gapTotal = gapsActivos.movimientosSinCuenta + gapsActivos.cuentasSin104x + gapsActivos.docLinkFaltante + gapsActivos.conciliacionPendiente;
  if (gapTotal > 0) { razones.push(`Gaps activos: ${gapsActivos.movimientosSinCuenta} mov sin cuenta · ${gapsActivos.cuentasSin104x} cuentas sin 104x · ${gapsActivos.docLinkFaltante} sin doc · ${gapsActivos.conciliacionPendiente} concil pend`); recomendaciones.push('Resolver gaps de captura/config antes de considerar el flip'); }
  if (Math.abs(shadow.oficial.diff) > RECON_TOLERANCE) razones.push(`Diff legacy−movimientos = ${D2(shadow.oficial.diff)} (fuera de tolerancia)`);
  if (tendenciaDiff === 'empeorando') { razones.push('Tendencia del diff EMPEORANDO'); recomendaciones.push('Investigar por qué el diff crece entre snapshots'); }
  if (tendenciaMovSinCuenta === 'empeorando') razones.push('movimientosSinCuenta CRECIENDO');
  if (tendenciaOwnership === 'empeorando') razones.push('ownershipAmbiguo CRECIENDO');
  if (snapshotsFaltantes) { razones.push('PARALLEL activo pero sin snapshot de hoy'); recomendaciones.push('Abrir Sombra/pre-cierre o pulsar «Capturar ahora» para registrar tendencia'); }
  const amarillo = gapTotal > 0 || Math.abs(shadow.oficial.diff) > RECON_TOLERANCE || tendenciaDiff === 'empeorando' || tendenciaMovSinCuenta === 'empeorando' || tendenciaOwnership === 'empeorando' || snapshotsFaltantes;

  const estadoGlobal = rojo ? 'rojo' : amarillo ? 'amarillo' : 'verde';
  if (estadoGlobal === 'verde') { razones.push('Sin diferencias reales, sin doble-ownership, sin gaps · cuadra'); recomendaciones.push('Confirmar estabilidad por varios ciclos antes de pedir GO de flip'); }
  if (rojo) recomendaciones.unshift('NO flipear: resolver lo ROJO primero (es bloqueante e implica pérdida/duplicación de caja)');

  res.json({
    periodo, estadoGlobal, razones, recomendaciones,
    riesgoFlip: flip,
    tendenciaDiff, tendenciaOwnership, tendenciaMovSinCuenta,
    gapsActivos, snapshotsFaltantes, cerradoConCambios,
    invariantes: { ok: inv.ok, rotos: invFail.map((c) => c.check) },
    preclose: { ok: pre.bloqueos.length === 0, bloqueos: pre.bloqueos },
    config: cfg,
    resumen: shadow.resumen,
    diff: shadow.oficial.diff,
    snapshotsCount: snaps.length,
  });
});

// ── F4.6 · SMOKE operacional (read-only) · "1 request = confianza" · auto-prueba sin mutar ──
router.get('/smoke', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  const { fechaInicio, fechaFin } = partesPeriodo(periodo);
  const cnt = async () => {
    const r = await db.execute(dsql`select (select count(*) from asientos)+(select count(*) from movimientos)+(select count(*) from configuracion_contable)+(select count(*) from cutover_snapshots) as n`);
    return Number((r as unknown as { n: number }[])[0]?.n ?? 0);
  };
  const antes = await cnt();
  const checks: { check: string; ok: boolean; detalle: string }[] = [];

  // 1 · invariantes (reusa el cómputo central)
  const inv = await computeInvariantes(periodo);
  for (const c of inv.checks) checks.push(c);

  // 2 · determinismo del shadow (2 corridas → mismo diff/realDiffs = sin no-determinismo/drift)
  const s1 = await buildShadowReport(periodo);
  const s2 = await buildShadowReport(periodo);
  const det = Math.abs(s1.oficial.diff - s2.oficial.diff) < 0.001 && s1.resumen.realDiffsCount === s2.resumen.realDiffsCount;
  checks.push({ check: 'shadow_determinista', ok: det, detalle: det ? 'dos corridas idénticas' : 'NO determinista (drift en el cálculo)' });

  // 3 · simulador multi-fecha (sanity · cada fecha produce un nivel sin reventar)
  const fechas = [fechaInicio, `${periodo}-15`, fechaFin];
  let simOk = true; const niveles: string[] = [];
  for (const f of fechas) { try { niveles.push(recomendarFlip(await buildShadowReport(periodo, f)).nivel); } catch { simOk = false; } }
  checks.push({ check: 'simulador_multifecha', ok: simOk && niveles.length === fechas.length, detalle: simOk ? `niveles: ${niveles.join(' / ')}` : 'una simulación falló' });

  // 4 · no-mutación (el propio smoke + sus lecturas no escriben nada)
  const despues = await cnt();
  checks.push({ check: 'no_mutacion', ok: antes === despues, detalle: antes === despues ? `counts estables (${antes})` : `MUTÓ: ${antes}→${despues}` });

  const ok = checks.every((c) => c.ok);
  res.json({ periodo, ok, total: checks.length, pasaron: checks.filter((c) => c.ok).length, checks });
});

// ── F4.6 · ROLLBACK PLAN (read-only) · cómo deshacer cada paso de la transición ──
router.get('/rollback-plan', async (_req, res) => {
  const cfg = await getContabilidadConfig();
  res.json({
    estadoActual: { cutover: cfg.cutover, parallel: cfg.parallel, flipeado: cfg.cutover !== null },
    escenarios: [
      {
        titulo: 'Desactivar PARALLEL (vigilancia → off)',
        cuando: 'Si la vigilancia genera ruido o se pausa la preparación del flip.',
        reversible: true, auditado: 'update_config',
        pasos: ['PUT /contabilidad/config { parallel:false }', 'Verificar GET /contabilidad/config → parallel=false', 'El pre-cierre vuelve a modo informativo (los bloqueos siguen visibles, ya no son duros)'],
      },
      {
        titulo: 'Revertir CUTOVER a null (DES-FLIP · volver a legacy)',
        cuando: 'Si tras el flip aparecen diffs reales, doble-ownership o eventos huérfanos.',
        reversible: true, auditado: 'update_config',
        pasos: ['PUT /contabilidad/config { cutover:null }', 'Verificar /invariantes → parallel_gating OK (0 asientos de movimiento con cutover=null)', 'Re-correr /generar del periodo: legacy vuelve a asentar la caja', 'Validar con /reporte-sombra que el diff vuelve a la línea base'],
      },
      {
        titulo: 'ownershipAmbiguo aparece post-flip (doble conteo)',
        cuando: 'Un doc terminó con asiento legacy Y de movimiento.',
        reversible: true, auditado: 'anular',
        pasos: ['Identificar los docs vía /watchdog o /reporte-sombra (lista realDiffs/doble_ownership)', 'NO borrar asientos (hard-delete prohibido)', 'Anular el asiento sobrante por el flujo de anulación auditado (mantener el del owner correcto según la fecha vs cutover)', 'Re-correr shadow y confirmar ownershipAmbiguo=0'],
      },
      {
        titulo: 'Snapshot/config corrupto o de prueba',
        cuando: 'Snapshots de prueba o config mal seteada.',
        reversible: true, auditado: 'parcial',
        pasos: ['Los snapshots son read-only históricos; borrar solo filas de prueba por SQL directo si fuese necesario (no afecta ownership)', 'Re-setear config vía PUT /contabilidad/config (queda en audit_log update_config)'],
      },
    ],
    noRevertir: [
      'Asientos legacy históricos ya confirmados (son la verdad contable previa).',
      'Movimientos de caja reales (son hechos operativos, no derivados).',
      'audit_log (inmutable por diseño · trail de auditoría).',
      'Periodos ya cerrados y validados → usar reapertura auditada (motivo obligatorio), nunca edición directa.',
    ],
    riesgos: [
      'Flipear con gaps activos (movimientosSinCuenta, cuentasSin104x) → captura parcial del 104x.',
      'Flipear con eventos huérfanos (falta_movimiento ≥ cutover) → se pierde el evento de caja.',
      'Revertir cutover sin re-correr /generar → el periodo queda sin asientos de caja.',
    ],
    invariantesNoTocar: ['CUTOVER no se mueve sin GO explícito + shadow verde', 'transfer neto 0', 'no doble 104x', 'freeze de periodos cerrados'],
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// F4.5 PREP · procedimiento del flip (TODO read-only · NO ejecuta el flip · no muta ownership/CUTOVER)
// ══════════════════════════════════════════════════════════════════════════════
const SNAPSHOTS_VERDES_REQUERIDOS = 3; // "watchdog verde N ciclos" antes del GO
const LEGACY_CAJA_ORIGENES = ['pago_oc', 'cobro_valo'] as const; // asientos legacy que postean 104x

// Criterios GO/NO-GO · fuente única (la usan /cutover-readiness y /cutover-playbook · anti-drift).
async function computeReadiness(periodo: string) {
  const cfg = await getContabilidadConfig();
  const shadow = await buildShadowReport(periodo);
  const inv = await computeInvariantes(periodo);
  const pre = await precloseBloqueos(periodo);
  const flip = recomendarFlip(shadow);
  const recientes = await db.select().from(schema.cutoverSnapshots)
    .where(eq(schema.cutoverSnapshots.periodo, periodo)).orderBy(desc(schema.cutoverSnapshots.fechaSnapshot)).limit(SNAPSHOTS_VERDES_REQUERIDOS);
  const verdes = recientes.filter((s) => s.realDiffsCount === 0 && s.ownershipAmbiguo === 0 && Math.abs(Number(s.diff)) <= RECON_TOLERANCE).length;
  const hoy = new Date().toISOString().slice(0, 10);
  const gaps = shadow.resumen.movimientosSinCuenta + shadow.resumen.cuentasSin104x + shadow.config.docLinkFaltante.length;
  const per = await buscarPeriodo(periodo);

  // hard = bloqueante (NO_GO) · soft = condicional (CONDITIONAL)
  const criterios = [
    { criterio: 'invariantes_ok', hard: true, ok: inv.ok, detalle: inv.ok ? 'todos los invariantes pasan' : `rotos: ${inv.checks.filter((c) => !c.ok).map((c) => c.check).join(', ')}` },
    { criterio: 'sin_ownership_ambiguo', hard: true, ok: shadow.resumen.ownershipAmbiguo === 0, detalle: `ownershipAmbiguo=${shadow.resumen.ownershipAmbiguo}` },
    { criterio: 'sin_diferencias_reales', hard: true, ok: shadow.resumen.realDiffsCount === 0, detalle: `realDiffs=${shadow.resumen.realDiffsCount}` },
    { criterio: 'simulador_no_imposible', hard: true, ok: flip.nivel !== 'imposible', detalle: `nivel=${flip.nivel}` },
    { criterio: 'diff_en_tolerancia', hard: false, ok: Math.abs(shadow.oficial.diff) <= RECON_TOLERANCE, detalle: `diff=${D2(shadow.oficial.diff)} (tol ${RECON_TOLERANCE})` },
    { criterio: 'sin_gaps', hard: false, ok: gaps === 0, detalle: `gaps=${gaps} (movSinCuenta ${shadow.resumen.movimientosSinCuenta} + cuentasSin104x ${shadow.resumen.cuentasSin104x} + sinDoc ${shadow.config.docLinkFaltante.length})` },
    { criterio: 'simulador_seguro', hard: false, ok: flip.nivel === 'seguro', detalle: flip.nivel === 'seguro' ? 'flip seguro' : flip.motivo },
    { criterio: 'preclose_limpio', hard: false, ok: pre.bloqueos.length === 0, detalle: pre.bloqueos.length ? `${pre.bloqueos.length} bloqueo(s)` : 'sin bloqueos' },
    { criterio: 'conciliacion_aceptable', hard: false, ok: pre.conciliacion.pendiente === 0 && pre.conciliacion.diferencia === 0, detalle: `pend ${pre.conciliacion.pendiente} · dif ${pre.conciliacion.diferencia}` },
    { criterio: `watchdog_verde_${SNAPSHOTS_VERDES_REQUERIDOS}_ciclos`, hard: false, ok: verdes >= SNAPSHOTS_VERDES_REQUERIDOS, detalle: `${verdes}/${SNAPSHOTS_VERDES_REQUERIDOS} snapshots recientes verdes` },
    { criterio: 'snapshots_recientes', hard: false, ok: recientes.some((s) => s.fechaSnapshot === hoy), detalle: recientes.length ? `último ${recientes[0]!.fechaSnapshot}` : 'sin snapshots' },
    { criterio: 'periodo_coherente', hard: false, ok: per?.estado !== 'cerrado', detalle: `periodo ${per?.estado ?? 'abierto'}` },
  ];
  const hardFail = criterios.filter((c) => c.hard && !c.ok);
  const softFail = criterios.filter((c) => !c.hard && !c.ok);
  const resultado: 'GO' | 'CONDITIONAL' | 'NO_GO' = hardFail.length ? 'NO_GO' : softFail.length ? 'CONDITIONAL' : 'GO';
  const razones = [...hardFail.map((c) => `[BLOQUEANTE] ${c.criterio}: ${c.detalle}`), ...softFail.map((c) => `[condicional] ${c.criterio}: ${c.detalle}`)];
  if (resultado === 'GO') razones.push('Todos los criterios cumplen · pendiente solo la confirmación humana (GO explícito).');
  return { periodo, resultado, razones, criterios, contexto: { cutover: cfg.cutover, parallel: cfg.parallel } };
}

// Dry-run del flip · proyecta el estado post-cutover SIN escribir nada.
async function computeDryRun(periodo: string, cutover: string) {
  const shadow = await buildShadowReport(periodo, cutover); // what-if: evalCutover = cutover propuesto
  const inv = await computeInvariantes(periodo);
  const flip = recomendarFlip(shadow);
  const { fechaFin } = partesPeriodo(periodo);
  // asientos legacy de caja EXISTENTES con fecha >= cutover → al flipear DEBEN anularse (si no, doble conteo con el nuevo asiento de movimiento)
  const legacyCaja = await db.select({ id: schema.asientos.id, correlativo: schema.asientos.correlativo, fecha: schema.asientos.fecha })
    .from(schema.asientos)
    .where(and(eq(schema.asientos.periodo, periodo), inArray(schema.asientos.origen, [...LEGACY_CAJA_ORIGENES]), gte(schema.asientos.fecha, cutover), dsql`${schema.asientos.status} != 'anulado'`));
  // movimientos que tomarían ownership (fecha >= cutover · misma regla que /generar)
  const movs = await db.select().from(schema.movimientos).where(and(lte(schema.movimientos.fecha, fechaFin), ne(schema.movimientos.anulado, true)));
  const movPostCutover = movs.filter((m) => movOwnsCaja(String(m.fecha).slice(0, 10), cutover));
  const movConCuenta = movPostCutover.filter((m) => m.cuentaId);
  const huerfanos = shadow.realDiffs.filter((d) => d.tipo === 'falta_movimiento');
  const conflictos = shadow.realDiffs.filter((d) => d.tipo === 'cuenta_mal_inferida');

  // recomendación combinada: el riesgo del flip incluye la anulación pendiente de legacy (no visible en recomendarFlip puro)
  let nivel = flip.nivel;
  const razones = [flip.motivo];
  if (legacyCaja.length > 0 && movConCuenta.length > 0 && nivel === 'seguro') { nivel = 'riesgoso'; }
  if (legacyCaja.length > 0) razones.push(`${legacyCaja.length} asiento(s) legacy de caja >= ${cutover} deben ANULARSE durante el flip (si no → doble conteo).`);

  const resumenOwnership = {
    antesDelFlip: 'legacy posee todo el 104x del periodo',
    despuesDelFlip: { hastaCutover: 'legacy (congelado)', desdeCutover: 'movimientos' },
    legacyCajaAsientosAAnular: legacyCaja.length,
    movimientosQueTomanOwnership: movPostCutover.length,
    movimientosConCuenta104x: movConCuenta.length,
    movimientosSinCuenta104x: movPostCutover.length - movConCuenta.length, // estos NO postearían → captura parcial
    docsHuerfanos: huerfanos.length,
    conflictos: conflictos.length,
    impactoNetoDiff: shadow.oficial.diff,
  };

  // smoke post-flip PROYECTADO (lo que el smoke real verificaría tras el flip · aquí read-only)
  const postFlipSmoke = [
    { check: 'ownership_cambiaria', ok: movPostCutover.length > 0, detalle: `${movPostCutover.length} movimiento(s) >= ${cutover} tomarían el 104x` },
    { check: 'legacy_dejaria_caja', ok: legacyCaja.length === 0, detalle: legacyCaja.length === 0 ? 'no quedan asientos legacy de caja >= cutover' : `${legacyCaja.length} asiento(s) legacy a anular (acción del flip)` },
    { check: 'movimientos_postean_104x', ok: movConCuenta.length > 0 || movPostCutover.length === 0, detalle: `${movConCuenta.length}/${movPostCutover.length} con cuenta 104x asignada` },
    { check: 'sin_doble_conteo_proyectado', ok: shadow.resumen.ownershipAmbiguo === 0, detalle: `ownershipAmbiguo proyectado=${shadow.resumen.ownershipAmbiguo}` },
    { check: 'transfer_neto_0', ok: inv.checks.find((c) => c.check === 'transfer_neto_cero')?.ok ?? false, detalle: inv.checks.find((c) => c.check === 'transfer_neto_cero')?.detalle ?? '' },
    { check: 'snapshots_consistentes', ok: inv.checks.find((c) => c.check === 'snapshots_idempotentes')?.ok ?? false, detalle: 'idempotencia de snapshots' },
    { check: 'sin_huerfanos', ok: huerfanos.length === 0, detalle: huerfanos.length ? `${huerfanos.length} evento(s) se perderían` : 'sin huérfanos' },
    { check: 'rollback_posible', ok: true, detalle: 'CUTOVER es config reversible → set null + re-generar' },
  ];

  return {
    periodo, cutover, recomendacion: { nivel, razones },
    resumenOwnership,
    riesgoOperacional: huerfanos.length > 0 || conflictos.length > 0 ? 'alto' : (legacyCaja.length > 0 || resumenOwnership.movimientosSinCuenta104x > 0) ? 'medio' : 'bajo',
    shadow: { diff: shadow.oficial.diff, resumen: shadow.resumen, huerfanos, conflictos },
    invariantes: { ok: inv.ok, rotos: inv.checks.filter((c) => !c.ok).map((c) => c.check) },
    postFlipSmoke,
    legacyCajaAAnular: legacyCaja, // lista exacta (correlativo/fecha) para el paso de anulación del playbook
    rollbackPreview: {
      titulo: 'Des-flip (volver a legacy)',
      pasos: ['PUT /contabilidad/config { cutover:null }', 'Re-anular NADA / re-activar asientos legacy anulados durante el flip (vía flujo auditado)', 'Re-correr /generar del periodo → legacy re-asienta la caja', 'Verificar /invariantes parallel_gating OK y /reporte-sombra diff base'],
      reversible: true,
    },
  };
}

router.post('/cutover-dry-run', async (req, res) => {
  const { periodo, cutover } = (req.body ?? {}) as { periodo?: string; cutover?: string };
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  if (!cutover || !/^\d{4}-\d{2}-\d{2}$/.test(cutover)) return res.status(400).json({ error: 'cutover requerido (YYYY-MM-DD)' });
  res.json(await computeDryRun(periodo, cutover)); // read-only puro · no escribe ownership ni config
});

// ── Readiness v2 (PARALELO · read-only · NO gobierna GO · default sigue v1) ──
// Reglas v2: cobertura SOLO confirmada (H1) · umbral con tope duro (H2) · structuring (H3) · snapshot hash (H4)
// · transfer interna conservadora (H5) · NO cableado a cerrar/playbook (H6 · v1 sigue mandando).
async function computeReadinessV2(periodo: string) {
  const cfg = await getContabilidadConfig();
  const shadow = await buildShadowReport(periodo);
  const inv = await computeInvariantes(periodo);
  const flip = recomendarFlip(shadow);
  const tax = await construirTaxonomia(periodo);
  const recientes = await db.select().from(schema.cutoverSnapshots)
    .where(eq(schema.cutoverSnapshots.periodo, periodo)).orderBy(desc(schema.cutoverSnapshots.fechaSnapshot)).limit(SNAPSHOTS_VERDES_REQUERIDOS);
  const verdes = recientes.filter((s) => s.realDiffsCount === 0 && s.ownershipAmbiguo === 0 && Math.abs(Number(s.diff)) <= RECON_TOLERANCE).length;
  const hoy = new Date().toISOString().slice(0, 10);
  const per = await buscarPeriodo(periodo);
  const T = tax.taxonomia; const U = tax.umbrales; const D = tax.derivados;

  const criterios = [
    // HARD (integridad · NUNCA flexibilizar)
    { codigo: 'INV', clase: 'hard', ok: inv.ok, detalle: inv.ok ? '7/7' : `rotos: ${inv.checks.filter((c) => !c.ok).map((c) => c.check).join(',')}` },
    { codigo: 'RDIFF', clase: 'hard', ok: shadow.resumen.realDiffsCount === 0, detalle: `realDiffs=${shadow.resumen.realDiffsCount}` },
    { codigo: 'OWN', clase: 'hard', ok: shadow.resumen.ownershipAmbiguo === 0, detalle: `ownershipAmbiguo=${shadow.resumen.ownershipAmbiguo}` },
    { codigo: 'SIM_NO_IMPOSIBLE', clase: 'hard', ok: flip.nivel !== 'imposible', detalle: `nivel=${flip.nivel}` },
    { codigo: 'MONTO_SIN_CLASIFICAR', clase: 'hard', ok: T.montoSinClasificar === 0, detalle: `sin clasificar=${T.montoSinClasificar}` },
    { codigo: 'RUIDO_TECHO', clase: 'hard', ok: tax.guardas.ruidoDentroTecho, detalle: `ruido ${T.ruido.pctFlujo}% ≤ ${U.ruidoTecho}%` },
    { codigo: 'UMBRAL_EN_RANGO', clase: 'hard', ok: tax.guardas.umbralMaterialDentroRango, detalle: `material=${U.material} (cfg ${U.materialCfg}, cap ${U.capMaterialPct}% flujo)` },
    { codigo: 'CRIT', clase: 'hard', ok: T.critico.lineas === 0, detalle: `${T.critico.lineas} criticos · S/${T.critico.monto}` },
    { codigo: 'COB_PISO', clase: 'hard', ok: D.cobConfirmada >= U.cobPiso, detalle: `confirmada ${D.cobConfirmada}% ≥ piso ${U.cobPiso}%` },
    { codigo: 'AGING_PROMOVIDO', clase: 'hard', ok: D.agingCriticoMax <= U.agingDias, detalle: `critico aging ${D.agingCriticoMax}d ≤ ${U.agingDias}d` },
    // SOFT (juicio · override con motivo+audit)
    { codigo: 'COB_TARGET', clase: 'soft', ok: D.cobConfirmada >= U.cobMin, detalle: `confirmada ${D.cobConfirmada}% ≥ ${U.cobMin}%` },
    { codigo: 'SIM_SEGURO', clase: 'soft', ok: flip.nivel === 'seguro', detalle: flip.nivel === 'seguro' ? 'seguro' : flip.motivo },
    { codigo: 'WD_VERDE_N', clase: 'soft', ok: verdes >= SNAPSHOTS_VERDES_REQUERIDOS, detalle: `${verdes}/${SNAPSHOTS_VERDES_REQUERIDOS} snapshots verdes` },
    { codigo: 'SNAP_RECIENTE', clase: 'soft', ok: recientes.some((s) => s.fechaSnapshot === hoy), detalle: recientes.length ? `último ${recientes[0]!.fechaSnapshot}` : 'sin snapshots' },
    { codigo: 'PER_COHERENTE', clase: 'soft', ok: per?.estado !== 'cerrado', detalle: `periodo ${per?.estado ?? 'abierto'}` },
  ] as const;
  const hardFail = criterios.filter((c) => c.clase === 'hard' && !c.ok);
  const softFail = criterios.filter((c) => c.clase === 'soft' && !c.ok);
  const resultado: 'GO' | 'CONDITIONAL' | 'NO_GO' = hardFail.length ? 'NO_GO' : softFail.length ? 'CONDITIONAL' : 'GO';
  const razones = [...hardFail.map((c) => `[HARD] ${c.codigo}: ${c.detalle}`), ...softFail.map((c) => `[soft] ${c.codigo}: ${c.detalle}`)];
  return {
    periodo, readinessVersion: 'v2' as const, resultado, razones, criterios,
    taxonomiaConciliacion: T,
    snapshot: { hash: tax.snapshot.hash, umbrales: U, capturadoEn: tax.snapshot.capturadoEn },
    guardas: tax.guardas,
    contexto: { cutover: cfg.cutover, parallel: cfg.parallel, mode: 'v2', gobiernaGO: false },
  };
}

router.get('/cutover-readiness', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  const mode = String(req.query.mode ?? 'v1'); // DEFAULT v1 · v2 es solo observabilidad
  if (mode === 'v2') return res.json(await computeReadinessV2(periodo));
  if (mode === 'both') {
    const [v1, v2] = await Promise.all([computeReadiness(periodo), computeReadinessV2(periodo)]);
    const cambia = v1.resultado !== v2.resultado;
    const porQue = cambia ? [`v1=${v1.resultado} vs v2=${v2.resultado}`, ...v2.razones.slice(0, 4)] : [];
    return res.json({ v1, v2, divergencia: { resultadoCambia: cambia, porQue, nota: 'v2 es read-only · NO gobierna GO · v1 sigue mandando' } });
  }
  res.json(await computeReadiness(periodo)); // v1 intacto (default)
});

// ── Watchdog v2 (PARALELO · NO reemplaza el watchdog de producción) · misma taxonomía/códigos ──
router.get('/watchdog-v2', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  const cfg = await getContabilidadConfig();
  const shadow = await buildShadowReport(periodo);
  const inv = await computeInvariantes(periodo);
  const tax = await construirTaxonomia(periodo);
  const T = tax.taxonomia; const D = tax.derivados; const U = tax.umbrales;
  const razones: string[] = [];
  // ROJO = integridad rota o críticos materiales (incl. aging promovido o guardas)
  const rojo = !inv.ok || shadow.resumen.realDiffsCount > 0 || shadow.resumen.ownershipAmbiguo > 0
    || T.critico.lineas > 0 || D.agingCriticoMax > U.agingDias || !tax.guardas.ruidoDentroTecho || !tax.guardas.umbralMaterialDentroRango;
  if (!inv.ok) razones.push('invariantes rotos');
  if (shadow.resumen.realDiffsCount > 0) razones.push(`${shadow.resumen.realDiffsCount} realDiffs`);
  if (T.critico.lineas > 0) razones.push(`${T.critico.lineas} criticos materiales · S/${T.critico.monto}`);
  if (D.agingCriticoMax > U.agingDias) razones.push(`critico aging ${D.agingCriticoMax}d > ${U.agingDias}d`);
  if (!tax.guardas.ruidoDentroTecho) razones.push(`ruido ${T.ruido.pctFlujo}% fuera de techo`);
  // AMARILLO = cobertura confirmada insuficiente
  const amarillo = D.cobConfirmada < U.cobMin;
  if (amarillo && !rojo) razones.push(`cobertura confirmada ${D.cobConfirmada}% < ${U.cobMin}%`);
  const estadoGlobal = rojo ? 'rojo' : amarillo ? 'amarillo' : 'verde';
  // divergencia con watchdog v1 (estado actual de producción)
  const v1Rojo = inv.ok === false || shadow.resumen.realDiffsCount > 0 || shadow.resumen.ownershipAmbiguo > 0;
  res.json({
    periodo, watchdogVersion: 'v2', estadoGlobal, razones,
    criticos: { lineas: T.critico.lineas, monto: T.critico.monto },
    cobertura: T.cobertura, ruido: T.ruido, agingCriticoMaxDias: D.agingCriticoMax,
    transferenciaInterna: T.transferenciaInterna,
    snapshotHash: tax.snapshot.hash, guardas: tax.guardas,
    divergenciaV1: { v1RojoPorIntegridad: v1Rojo, nota: 'watchdog-v2 NO reemplaza el de producción' },
    contexto: { cutover: cfg.cutover, parallel: cfg.parallel, gobiernaGO: false },
  });
});

// Criterios de ABORT inmediato (hard-stops) · expuestos para el playbook + UI.
const ABORT_CONDITIONS = {
  hardStops: [
    'ownershipAmbiguo > 0 (doble conteo de caja) → revertir YA',
    'Cualquier invariante en ROJO (transfer ≠ 0, moneda inconsistente, freeze roto) → revertir YA',
    'Aparece falta_movimiento (huérfano) con fecha >= cutover → se está perdiendo caja → revertir YA',
    'Diff legacy−movimientos salta fuera de tolerancia tras el flip → revertir YA',
  ],
  ventanasTolerancia: {
    amarillo: 'Máx 1 ciclo de cierre con AMARILLO por gaps de captura (movimientosSinCuenta) si NO hay doble conteo ni huérfanos · resolver en el ciclo.',
    rojo: 'CERO tolerancia · rollback inmediato (minutos, no días).',
  },
  metricasHardStop: ['ownershipAmbiguo', 'realDiffs (falta_movimiento / cuenta_mal_inferida)', 'transfer_neto_cero', 'cerradoConCambios'],
};

router.get('/cutover-playbook', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  const cutover = String(req.query.cutover ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo requerido (YYYY-MM)' });
  const readiness = await computeReadiness(periodo);
  const dryRun = /^\d{4}-\d{2}-\d{2}$/.test(cutover) ? await computeDryRun(periodo, cutover) : null;
  res.json({
    periodo, cutover: cutover || null,
    estadoActual: readiness.contexto,
    readiness: { resultado: readiness.resultado, razones: readiness.razones },
    dryRun: dryRun ? { recomendacion: dryRun.recomendacion, riesgoOperacional: dryRun.riesgoOperacional, resumenOwnership: dryRun.resumenOwnership } : null,
    ejecutor: 'admin (contadora supervisa) · 1 sola persona ejecuta, 1 verifica',
    duracionEstimada: '15-30 min (incluye verificación + smoke post-flip)',
    ventanaRecomendada: 'Fuera de horario de captura · periodo objetivo ABIERTO · backup DB reciente',
    procedimiento: [
      { fase: '0 · Prerrequisitos', pasos: ['readiness = GO (o CONDITIONAL aceptado explícitamente)', 'backup completo de la DB (pg_dump) verificado y restaurable', 'PARALLEL=true activo (vigilancia)', 'anular/limpiar cualquier asiento legacy de caja >= cutover ANTES (ver dryRun.legacyCajaAAnular) para evitar doble conteo'] },
      { fase: '1 · Snapshot obligatorio', pasos: ['POST /contabilidad/cutover-snapshot?periodo= (captura estado pre-flip · queda en historial + hash)', 'Guardar salida de /cutover-dry-run y /cutover-readiness como evidencia'] },
      { fase: '2 · Validación previa', pasos: ['GET /cutover-readiness = GO', 'POST /cutover-dry-run nivel ≠ imposible y riesgoOperacional ≤ medio', 'GET /watchdog = verde'] },
      { fase: '3 · FLIP (orden exacto)', pasos: ['PUT /contabilidad/config { cutover: "<fecha>" } (queda en audit_log update_config)', 'Verificar GET /contabilidad/config → cutover seteado', 'Correr POST /contabilidad/periodos/<periodo>/generar (re-genera: legacy frena caja >= cutover, movimientos postean 104x)'] },
      { fase: '4 · Verificación inmediata (minuto a minuto)', pasos: ['GET /invariantes → parallel_gating ahora espera asientos de movimiento · ownership_xor OK · 7/7', 'GET /reporte-sombra → diff dentro de tolerancia, ownershipAmbiguo=0', 'GET /smoke → 10/10', 'GET /watchdog → verde'] },
      { fase: '5 · Smoke post-flip', pasos: ['Ejecutar checks de dryRun.postFlipSmoke contra el estado REAL', 'Confirmar: ownership cambiado · legacy no postea caja >= cutover · movimientos postean 104x · sin doble conteo · transfer neto 0'] },
      { fase: '6 · Si algo falla → ABORT', pasos: ['Aplicar rollback (ver abortConditions + rollbackPreview)', 'PUT /contabilidad/config { cutover: null } · re-generar · verificar diff base'] },
    ],
    monitoreoMinutoAMinuto: ['ownershipAmbiguo (debe seguir 0)', 'diff legacy−movimientos', 'realDiffs (huérfanos/conflictos)', 'watchdog estadoGlobal', 'invariantes 7/7'],
    abortConditions: ABORT_CONDITIONS,
    rollback: dryRun?.rollbackPreview ?? { titulo: 'Des-flip', pasos: ['PUT /contabilidad/config { cutover:null }', 're-generar', 'verificar'], reversible: true },
    nota: 'F4.5 BLOQUEADO · este playbook es read-only y NO ejecuta el flip. Requiere GO explícito del usuario.',
  });
});

// ── F4.1 · Config de transición 104x (cutover/parallel) · lectura + escritura auditada ──
// Lectura abierta (cualquier auth); escritura SOLO admin. Reversible: editar la config no migra nada.
router.get('/config', async (_req, res) => {
  const rows = await db.select().from(schema.configuracionContable)
    .where(inArray(schema.configuracionContable.clave, ['MOVIMIENTOS_104X_CUTOVER', 'MOVIMIENTOS_104X_PARALLEL']));
  const m = new Map(rows.map((r) => [r.clave, r]));
  const cfg = await getContabilidadConfig();
  res.json({
    cutover: cfg.cutover,
    parallel: cfg.parallel,
    meta: {
      cutover: m.get('MOVIMIENTOS_104X_CUTOVER') ?? null,
      parallel: m.get('MOVIMIENTOS_104X_PARALLEL') ?? null,
    },
  });
});

const configSchema = z.object({
  cutover: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional(), // 'YYYY-MM-DD' o null (inerte)
  parallel: z.boolean().optional(),
  comentario: z.string().max(500).optional(),
}).refine((v) => v.cutover !== undefined || v.parallel !== undefined, { message: 'nada que actualizar (cutover y/o parallel)' });

router.put('/config', requireRole('admin'), async (req, res) => {
  const parse = configSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.issues[0]?.message ?? 'payload inválido' });
  const { cutover, parallel, comentario } = parse.data;
  const before = await getContabilidadConfig();
  const actor = req.user!.email;
  const upsert = async (clave: string, valor: string) => {
    await db.insert(schema.configuracionContable)
      .values({ clave, valor, comentario: comentario ?? null, actualizadoPor: actor, actualizadoEn: new Date() })
      .onConflictDoUpdate({ target: schema.configuracionContable.clave, set: { valor, comentario: comentario ?? null, actualizadoPor: actor, actualizadoEn: new Date() } });
  };
  if (cutover !== undefined) await upsert('MOVIMIENTOS_104X_CUTOVER', cutover ?? '');
  if (parallel !== undefined) await upsert('MOVIMIENTOS_104X_PARALLEL', parallel ? 'true' : 'false');
  const after = await getContabilidadConfig();
  await audit(req, { action: 'update_config', entityType: 'configuracion', entityId: 'MOVIMIENTOS_104X', before, after, motivo: comentario ?? null });
  res.json({ ok: true, before, after });
});

// H2.3 · audit trail visible (read-only) · filtros periodo (por mes de createdAt) / usuario / acción
router.get('/audit-log', async (req, res) => {
  const { periodo, userId, action } = req.query as { periodo?: string; userId?: string; action?: string };
  const conds = [];
  if (periodo && /^\d{4}-\d{2}$/.test(periodo)) {
    const { fechaInicio, fechaFin } = partesPeriodo(periodo);
    // periodo del evento = registrado ese mes O entidad-periodo (cierre/reabrir/generar llevan YYYY-MM como entityId)
    conds.push(or(
      and(gte(schema.auditLog.createdAt, new Date(`${fechaInicio}T00:00:00`)), lte(schema.auditLog.createdAt, new Date(`${fechaFin}T23:59:59`))),
      eq(schema.auditLog.entityId, periodo),
    )!);
  }
  if (userId) conds.push(eq(schema.auditLog.userId, userId));
  if (action) conds.push(eq(schema.auditLog.action, action));
  const eventos = await db
    .select({
      id: schema.auditLog.id, action: schema.auditLog.action, entityType: schema.auditLog.entityType,
      entityId: schema.auditLog.entityId, changes: schema.auditLog.changes, createdAt: schema.auditLog.createdAt,
      userId: schema.auditLog.userId, userEmail: schema.users.email, userNombres: schema.users.nombres,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.auditLog.userId, schema.users.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(300);
  res.json({ eventos });
});

// ── PLE SUNAT (C5) ──────────────────────────────────────────
// Construye las filas normalizadas de cada libro desde la data real del periodo.
async function filasComprasPeriodo(periodo: string): Promise<ple.FilaCompra[]> {
  const { fechaInicio, fechaFin } = partesPeriodo(periodo);
  const gs = await db.select().from(schema.gastos)
    .where(and(gte(schema.gastos.fecha, fechaInicio), lte(schema.gastos.fecha, fechaFin)))
    .orderBy(asc(schema.gastos.fecha));
  return gs
    .filter((g) => g.serie || g.numero) // sin comprobante no entra al registro
    .map((g) => ({
      fecha: g.fecha, tipoComprobante: g.tipoComprobante, serie: g.serie, numero: g.numero,
      proveedorRuc: g.proveedorRuc, proveedorRazon: g.proveedorRazon,
      baseGravada: Number(g.subtotal), igv: Number(g.igv), noGravado: Number(g.exonerado), total: Number(g.total),
      moneda: g.moneda, tipoCambio: null,
    }));
}

async function filasVentasPeriodo(periodo: string): Promise<ple.FilaVenta[]> {
  const { fechaInicio, fechaFin } = partesPeriodo(periodo);
  const vs = await db.select().from(schema.valorizaciones)
    .where(and(
      inArray(schema.valorizaciones.status, ['facturada', 'cobrada']),
      gte(schema.valorizaciones.fechaEmision, fechaInicio),
      lte(schema.valorizaciones.fechaEmision, fechaFin),
    ))
    .orderBy(asc(schema.valorizaciones.fechaEmision));
  // cliente vía proyecto
  const proyIds = [...new Set(vs.map((v) => v.proyectoId))];
  const proys = proyIds.length ? await db.select().from(schema.proyectos).where(inArray(schema.proyectos.id, proyIds)) : [];
  const cliIds = [...new Set(proys.map((p) => p.clienteId).filter(Boolean) as string[])];
  const clis = cliIds.length ? await db.select().from(schema.clientes).where(inArray(schema.clientes.id, cliIds)) : [];
  const proyMap = new Map(proys.map((p) => [p.id, p]));
  const cliMap = new Map(clis.map((c) => [c.id, c]));
  return vs.map((v) => {
    const proy = proyMap.get(v.proyectoId);
    const cli = proy?.clienteId ? cliMap.get(proy.clienteId) : null;
    return {
      fecha: v.comprobanteFecha ?? v.fechaEmision,
      tipoComprobante: v.comprobanteTipo === 'boleta' ? 'Boleta' : 'Factura',
      // comprobante real capturado al facturar (o mock F001-correlativo); fallback al placeholder viejo si faltara
      serie: v.comprobanteSerie ?? 'F001', numero: v.comprobanteNumero ?? String(v.numero),
      clienteRuc: cli?.ruc ?? null, clienteRazon: cli?.razonSocial ?? null,
      baseGravada: Number(v.montoCd), igv: Number(v.montoIgv), exonerado: 0, total: Number(v.montoTotal),
      tipoCambio: null,
      fechaVencimiento: v.comprobanteFechaVenc ?? v.comprobanteFecha ?? v.fechaEmision, // RVIE 5
      proyectoCodigo: proy?.codigo ?? null,                                              // RVIE 32
      detraccion: v.comprobanteDetraccion ? Number(v.comprobanteDetraccion) : null,      // RVIE 39
    };
  });
}

async function filasDiarioPeriodo(periodo: string): Promise<ple.FilaDiario[]> {
  const { fechaInicio, fechaFin } = partesPeriodo(periodo);
  const as = await db.select().from(schema.asientos)
    .where(and(
      eq(schema.asientos.status, 'registrado'),
      gte(schema.asientos.fecha, fechaInicio),
      lte(schema.asientos.fecha, fechaFin),
    ))
    .orderBy(asc(schema.asientos.fecha), asc(schema.asientos.correlativo));
  if (as.length === 0) return [];
  const ls = await db.select().from(schema.asientosLineas)
    .where(inArray(schema.asientosLineas.asientoId, as.map((a) => a.id)))
    .orderBy(asc(schema.asientosLineas.correlativo));
  const porAsiento = new Map<string, typeof ls>();
  for (const l of ls) {
    const arr = porAsiento.get(l.asientoId) ?? [];
    arr.push(l);
    porAsiento.set(l.asientoId, arr);
  }
  const filas: ple.FilaDiario[] = [];
  as.forEach((a, i) => {
    const cuo = String(i + 1);
    for (const l of porAsiento.get(a.id) ?? []) {
      filas.push({ cuo, correlativoAsiento: a.correlativo, fecha: a.fecha, glosa: a.glosa, cuenta: l.cuenta, debe: Number(l.debe), haber: Number(l.haber) });
    }
  });
  return filas;
}

// GET /contabilidad/ple/resumen?periodo=YYYY-MM · conteos para la UI
router.get('/ple/resumen', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo inválido (YYYY-MM)' });
  const [compras, ventas, diario] = await Promise.all([filasComprasPeriodo(periodo), filasVentasPeriodo(periodo), filasDiarioPeriodo(periodo)]);
  res.json({
    periodo,
    libros: {
      '8.1': { nombre: ple.LIBROS['8.1'].nombre, filas: compras.length },
      '14.1': { nombre: ple.LIBROS['14.1'].nombre, filas: ventas.length },
      '5.1': { nombre: ple.LIBROS['5.1'].nombre, filas: diario.length },
      '6.1': { nombre: ple.LIBROS['6.1'].nombre, filas: diario.length },
      RCE: { nombre: ple.LIBROS.RCE.nombre, filas: compras.length },
      RVIE: { nombre: ple.LIBROS.RVIE.nombre, filas: ventas.length },
    },
  });
});

// GET /contabilidad/ple?periodo=YYYY-MM&libro=8.1 · descarga el TXT
router.get('/ple', async (req, res) => {
  const periodo = String(req.query.periodo ?? '');
  const libro = String(req.query.libro ?? '') as ple.LibroKey;
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo inválido (YYYY-MM)' });
  if (!ple.LIBROS[libro]) return res.status(400).json({ error: 'libro inválido (5.1|6.1|8.1|14.1|RCE|RVIE)' });

  let contenido = '';
  if (libro === '8.1') contenido = ple.compras80100(periodo, await filasComprasPeriodo(periodo));
  else if (libro === '14.1') contenido = ple.ventas140100(periodo, await filasVentasPeriodo(periodo));
  else if (libro === '5.1') contenido = ple.diario50100(periodo, await filasDiarioPeriodo(periodo));
  else if (libro === '6.1') contenido = ple.mayor60100(periodo, await filasDiarioPeriodo(periodo));
  else if (libro === 'RCE') contenido = ple.rceCompras(periodo, await filasComprasPeriodo(periodo)); // SIRE
  else if (libro === 'RVIE') contenido = ple.rvieVentas(periodo, await filasVentasPeriodo(periodo)); // SIRE

  const conOper = contenido.length > 0;
  const nombre = ple.LIBROS[libro].sire
    ? ple.sireNombreArchivo(periodo, libro as 'RCE' | 'RVIE')
    : ple.nombreArchivo(periodo, ple.LIBROS[libro].codigo, conOper);
  if (conOper) contenido += '\r\n'; // PLE: cada línea termina en CRLF, incluida la última
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(contenido);
});

// ── Determinación de cuentas · mapa tipoGasto → cuenta PCGE (editable por la contadora) ──
router.get('/cuentas-tipo', async (_req, res) => {
  const [mapa, plan] = await Promise.all([
    db.select().from(schema.gastoCuentaMap).orderBy(asc(schema.gastoCuentaMap.tipoGasto)),
    db.select({ codigo: schema.planContable.codigo, nombre: schema.planContable.descripcion }).from(schema.planContable).orderBy(asc(schema.planContable.codigo)),
  ]);
  res.json({ mapa, plan });
});
router.put('/cuentas-tipo/:tipo', async (req, res) => {
  const tipo = String(req.params.tipo);
  const b = req.body as { cuenta?: string; esActivo?: boolean; esGasto?: boolean; clase?: string };
  if (!b.cuenta) return res.status(400).json({ error: 'cuenta requerida' });
  const claseOk = ['CD', 'GG_OBRA', 'GG_CORP'].includes(b.clase ?? '') ? b.clase! : 'CD';
  const set = { cuenta: b.cuenta, esActivo: !!b.esActivo, esGasto: b.esGasto ?? true, clase: claseOk, actualizadoEn: new Date() };
  const [row] = await db.insert(schema.gastoCuentaMap)
    .values({ tipoGasto: tipo, ...set })
    .onConflictDoUpdate({ target: schema.gastoCuentaMap.tipoGasto, set })
    .returning();
  await audit(req, { action: 'update_config', entityType: 'gasto_cuenta_map', entityId: tipo, after: set });
  res.json({ ok: true, row });
});

export default router;
