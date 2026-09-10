import { db, schema } from '@erp/db';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { calcularPlanilla } from '../lib/planillaCalc.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
const dec = (n?: number | null) => (n == null ? '0' : n.toString());

// ─── Empleados ───────────────────────────────────────────────
router.get('/empleados', async (req, res) => {
  const tipo = req.query.tipo as string | undefined;
  const proyecto = req.query.proyecto as string | undefined;
  const list = await db.select().from(schema.empleados).orderBy(asc(schema.empleados.nombre));
  res.json({
    empleados: list.filter((e) => (tipo ? e.tipoPlanilla === tipo : true) && (proyecto ? e.proyectoId === proyecto : true)),
  });
});
const empSchema = z.object({
  nombre: z.string().min(1),
  tipoDoc: z.string().optional(),
  numDoc: z.string().optional().nullable(),
  sistemaPension: z.string().optional().nullable(),
  cuspp: z.string().optional().nullable(),
  fechaIngreso: z.string().optional().nullable(),
  categoria: z.string().optional().nullable(),
  cargo: z.string().optional().nullable(),
  tieneHijos: z.boolean().optional(),
  numHijos: z.number().optional(),
  aplicaMovilidad: z.boolean().optional(),
  bonifAltura: z.boolean().optional(),
  bonifAgua: z.boolean().optional(),
  proyectoId: z.string().uuid().optional().nullable(),
  sctrVigencia: z.string().optional().nullable(),
  banco: z.string().optional().nullable(),
  numCuenta: z.string().optional().nullable(),
  tipoPlanilla: z.enum(['obrero', 'admin']).optional(),
  sueldoBaseMensual: z.number().optional().nullable(),
  asignacionFamiliar: z.boolean().optional(),
  fechaCese: z.string().optional().nullable(),
});
router.post('/empleados', async (req, res) => {
  const parse = empSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  const [emp] = await db.insert(schema.empleados).values({
    ...d,
    fechaIngreso: d.fechaIngreso || null,
    sctrVigencia: d.sctrVigencia || null,
    fechaCese: d.fechaCese || null,
    sueldoBaseMensual: d.sueldoBaseMensual != null ? String(d.sueldoBaseMensual) : null,
  }).returning();
  res.json({ empleado: emp });
});
router.put('/empleados/:id', async (req, res) => {
  const parse = empSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const data = { ...parse.data };
  // fechas vacías → null (columna date no acepta '')
  for (const k of ['fechaIngreso', 'sctrVigencia', 'fechaCese'] as const) if (data[k] === '') data[k] = null;
  // decimal column requiere string
  if ('sueldoBaseMensual' in data) {
    (data as Record<string, unknown>).sueldoBaseMensual = data.sueldoBaseMensual != null ? String(data.sueldoBaseMensual) : null;
  }
  const [emp] = await db.update(schema.empleados).set(data).where(eq(schema.empleados.id, req.params.id!)).returning();
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  res.json({ empleado: emp });
});
router.delete('/empleados/:id', async (req, res) => {
  await db.delete(schema.empleados).where(eq(schema.empleados.id, req.params.id!));
  res.json({ ok: true });
});

// ─── Dashboard global de planilla (todas las obras) ──────────
router.get('/planilla-dashboard', async (_req, res) => {
  const obreros = (await db.select().from(schema.empleados).where(
    and(eq(schema.empleados.tipoPlanilla, 'obrero'), eq(schema.empleados.activo, true)),
  ));
  const params = await db.select().from(schema.paramPlanilla);
  const jornalDe = (cat: string | null) => Number(params.find((p) => p.categoria === cat)?.jornalBase ?? 0);

  // distribución por categoría
  const catMap = new Map<string, number>();
  for (const o of obreros) { const c = o.categoria ?? 'Otros'; catMap.set(c, (catMap.get(c) ?? 0) + 1); }
  const porCategoria = [...catMap.entries()]
    .map(([categoria, count]) => ({ categoria, count, jornal: jornalDe(categoria) }))
    .sort((a, b) => b.count - a.count);

  // trabajadores por obra (solo obras vivas)
  const proyectos = await db.select({ id: schema.proyectos.id, codigo: schema.proyectos.codigo, nombre: schema.proyectos.nombre })
    .from(schema.proyectos).where(isNull(schema.proyectos.deletedAt));
  const proyMap = new Map(proyectos.map((p) => [p.id, p]));
  const obraMap = new Map<string, number>();
  for (const o of obreros) { if (o.proyectoId && proyMap.has(o.proyectoId)) obraMap.set(o.proyectoId, (obraMap.get(o.proyectoId) ?? 0) + 1); }
  const porObra = [...obraMap.entries()]
    .map(([pid, count]) => ({ codigo: proyMap.get(pid)!.codigo, nombre: proyMap.get(pid)!.nombre, count }))
    .sort((a, b) => b.count - a.count);

  // nómina de la última semana
  const [sem] = await db.select().from(schema.planillaSemanas).orderBy(desc(schema.planillaSemanas.fechaInicio)).limit(1);
  let nominaSemana = 0, costoTotal = 0, faltasInjustificadas = 0;
  if (sem) {
    const det = await db.select().from(schema.planillaDetalle).where(eq(schema.planillaDetalle.semanaId, sem.id));
    nominaSemana = det.reduce((s, d) => s + Number(d.netoPago ?? 0), 0);
    costoTotal = det.reduce((s, d) => s + Number(d.montoCostoTotal ?? 0), 0);
    const asis = await db.select().from(schema.asistencia).where(eq(schema.asistencia.semanaId, sem.id));
    faltasInjustificadas = asis.filter((a) => /inj/i.test(a.tipo ?? '')).length;
  }

  res.json({
    trabajadoresActivos: obreros.length,
    porCategoria, porObra,
    nominaSemana, costoTotal, faltasInjustificadas,
    dmActivos: 0, // sin módulo de subsidios EsSalud aún
    semana: sem ? { mes: sem.mes, fechaInicio: sem.fechaInicio, fechaFin: sem.fechaFin } : null,
  });
});

// ─── Parámetros (jornal + %s) · editable ─────────────────────
router.get('/param-planilla', async (_req, res) => {
  const list = await db.select().from(schema.paramPlanilla).orderBy(asc(schema.paramPlanilla.categoria));
  res.json({ params: list });
});
router.put('/param-planilla/:categoria', async (req, res) => {
  const b = req.body as Record<string, number | undefined>;
  const set: Record<string, string> = {};
  for (const k of ['jornalBase', 'movilidad', 'pctBuc', 'pctDominical', 'pctCompVac', 'pctCts', 'pctGratif', 'pctHe60', 'pctHe100']) {
    if (b[k] != null) set[k] = dec(b[k]);
  }
  const [p] = await db.update(schema.paramPlanilla).set(set).where(eq(schema.paramPlanilla.categoria, req.params.categoria!)).returning();
  if (!p) return res.status(404).json({ error: 'Categoría no encontrada' });
  res.json({ param: p });
});

// ─── AFP tasas · editable ────────────────────────────────────
router.get('/afp-tasas', async (_req, res) => {
  const list = await db.select().from(schema.afpTasas).orderBy(asc(schema.afpTasas.afp));
  res.json({ tasas: list });
});
router.put('/afp-tasas/:afp', async (req, res) => {
  const b = req.body as Record<string, number | undefined>;
  const set: Record<string, string> = {};
  for (const k of ['pctAporte', 'pctComision', 'pctSeguro']) if (b[k] != null) set[k] = dec(b[k]);
  const [t] = await db.update(schema.afpTasas).set(set).where(eq(schema.afpTasas.afp, req.params.afp!)).returning();
  if (!t) return res.status(404).json({ error: 'AFP no encontrada' });
  res.json({ tasa: t });
});

// ─── Config global (tasas legales · singleton) · editable ────
router.get('/config-planilla', async (_req, res) => {
  let [cfg] = await db.select().from(schema.configPlanilla).limit(1);
  if (!cfg) [cfg] = await db.insert(schema.configPlanilla).values({ id: 'singleton' }).returning();
  res.json({ config: cfg });
});
router.put('/config-planilla', async (req, res) => {
  const b = req.body as Record<string, number | undefined>;
  const set: Record<string, string> = {};
  for (const k of ['uit', 'pctEsSalud', 'pctOnp', 'pctSencico', 'pctConafovicer', 'pctSctrSalud', 'pctSctrPension', 'pctBonifAltura', 'pctBonifAgua', 'asignEscolarJornales']) {
    if (b[k] != null) set[k] = dec(b[k]);
  }
  await db.insert(schema.configPlanilla).values({ id: 'singleton' }).onConflictDoNothing();
  const [cfg] = await db.update(schema.configPlanilla).set(set).where(eq(schema.configPlanilla.id, 'singleton')).returning();
  res.json({ config: cfg });
});

// ─── Asistencia diaria (tareo) · grid semanal ────────────────
router.get('/planilla-semanas/:id/asistencia', async (req, res) => {
  const list = await db.select().from(schema.asistencia).where(eq(schema.asistencia.semanaId, req.params.id!));
  res.json({ asistencia: list });
});
const asistSchema = z.object({
  empleadoId: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipo: z.string().max(15), // '' limpia la celda
  proyectoId: z.string().uuid().optional().nullable(),
});
router.post('/planilla-semanas/:id/asistencia', async (req, res) => {
  const parse = asistSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { empleadoId, fecha, tipo, proyectoId } = parse.data;
  // upsert por (empleado, fecha) · tipo vacío = borra
  await db.delete(schema.asistencia).where(and(eq(schema.asistencia.empleadoId, empleadoId), eq(schema.asistencia.fecha, fecha)));
  if (tipo) await db.insert(schema.asistencia).values({ empleadoId, fecha, tipo, semanaId: req.params.id!, proyectoId: proyectoId ?? null });
  res.json({ ok: true });
});

// ─── Planilla semanas ────────────────────────────────────────
router.get('/proyectos/:id/planilla-semanas', async (req, res) => {
  const list = await db.select().from(schema.planillaSemanas).where(eq(schema.planillaSemanas.proyectoId, req.params.id!)).orderBy(desc(schema.planillaSemanas.fechaInicio));
  res.json({ semanas: list });
});
router.post('/proyectos/:id/planilla-semanas', async (req, res) => {
  const b = req.body as { fechaInicio?: string; fechaFin?: string; mes?: string };
  if (!b.fechaInicio || !b.fechaFin) return res.status(400).json({ error: 'fechaInicio y fechaFin obligatorios' });
  const [sem] = await db.insert(schema.planillaSemanas).values({ proyectoId: req.params.id!, fechaInicio: b.fechaInicio, fechaFin: b.fechaFin, mes: b.mes ?? b.fechaInicio.slice(0, 7) }).returning();
  res.json({ semana: sem });
});
router.delete('/planilla-semanas/:id', async (req, res) => {
  await db.delete(schema.planillaSemanas).where(eq(schema.planillaSemanas.id, req.params.id!));
  res.json({ ok: true });
});

// GET detalle + totales
router.get('/planilla-semanas/:id', async (req, res) => {
  const [semana] = await db.select().from(schema.planillaSemanas).where(eq(schema.planillaSemanas.id, req.params.id!)).limit(1);
  if (!semana) return res.status(404).json({ error: 'Semana no encontrada' });
  const detalle = await db.select().from(schema.planillaDetalle).where(eq(schema.planillaDetalle.semanaId, req.params.id!));
  const sum = (f: (d: schema.PlanillaDetalle) => number) => detalle.reduce((s, d) => s + f(d), 0);
  const totales = {
    obreros: detalle.length,
    totalIngreso: sum((d) => Number(d.totalIngreso)),
    totalDescuentos: sum((d) => Number(d.totalDescuentos)),
    netoPago: sum((d) => Number(d.netoPago)),
    esSalud: sum((d) => Number(d.montoEsSalud)),
    sctr: sum((d) => Number(d.montoSctrSalud) + Number(d.montoSctrPension)),
    sencico: sum((d) => Number(d.montoSencico)),
    costoTotal: sum((d) => Number(d.montoCostoTotal)),
    afecto: sum((d) => Number(d.totalAfecto)),
  };
  res.json({ semana, detalle, totales });
});

// POST calcular · corre el motor para cada obrero · reemplaza el detalle
const lineaSchema = z.object({
  empleadoId: z.string().uuid(),
  dias: z.number().min(0).max(7),
  jornadaDominical: z.boolean().default(false),
  horasExtra60: z.number().default(0),
  horasExtra100: z.number().default(0),
  escolaridad: z.number().default(0),
  renta5ta: z.number().default(0),
  adelanto: z.number().default(0),
  sindical: z.number().default(0),
  cuentaContable: z.string().max(10).optional().nullable(), // WS1 · cuenta de costo del obrero (default 621 en el motor)
});
router.post('/planilla-semanas/:id/calcular', async (req, res) => {
  const parse = z.object({ lineas: z.array(lineaSchema) }).safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const semanaId = req.params.id!;

  const params = await db.select().from(schema.paramPlanilla);
  const tasas = await db.select().from(schema.afpTasas);
  const empleadosAll = await db.select().from(schema.empleados);
  let [cfgRow] = await db.select().from(schema.configPlanilla).limit(1);
  if (!cfgRow) [cfgRow] = await db.insert(schema.configPlanilla).values({ id: 'singleton' }).returning();
  const cfg = {
    pctEsSalud: Number(cfgRow!.pctEsSalud), pctOnp: Number(cfgRow!.pctOnp), pctSencico: Number(cfgRow!.pctSencico),
    pctConafovicer: Number(cfgRow!.pctConafovicer), pctSctrSalud: Number(cfgRow!.pctSctrSalud), pctSctrPension: Number(cfgRow!.pctSctrPension),
    pctBonifAltura: Number(cfgRow!.pctBonifAltura), pctBonifAgua: Number(cfgRow!.pctBonifAgua), asignEscolarJornales: Number(cfgRow!.asignEscolarJornales),
  };
  const paramByCat = new Map(params.map((p) => [p.categoria, p]));
  const tasaByAfp = new Map(tasas.map((t) => [t.afp, t]));
  const empById = new Map(empleadosAll.map((e) => [e.id, e]));

  // reemplazar detalle
  await db.delete(schema.planillaDetalle).where(eq(schema.planillaDetalle.semanaId, semanaId));

  const rows = [];
  for (const l of parse.data.lineas) {
    const emp = empById.get(l.empleadoId);
    if (!emp) continue;
    const param = paramByCat.get(emp.categoria ?? '');
    if (!param) continue;
    const esAfp = (emp.sistemaPension ?? '').toUpperCase().includes('AFP');
    const tasa = esAfp ? tasaByAfp.get(emp.sistemaPension ?? '') : null;
    const calc = calcularPlanilla(
      {
        jornal: Number(param.jornalBase), pctBuc: Number(param.pctBuc), pctDominical: Number(param.pctDominical),
        pctCompVac: Number(param.pctCompVac), pctCts: Number(param.pctCts), pctGratif: Number(param.pctGratif),
        pctHe60: Number(param.pctHe60), pctHe100: Number(param.pctHe100), movilidadDia: Number(param.movilidad ?? 0),
      },
      cfg,
      {
        dias: l.dias, jornadaDominical: l.jornadaDominical, horasExtra60: l.horasExtra60, horasExtra100: l.horasExtra100,
        aplicaMovilidad: emp.aplicaMovilidad ?? false, bonifAltura: emp.bonifAltura ?? false, bonifAgua: emp.bonifAgua ?? false,
        numHijos: emp.numHijos ?? 0, escolaridad: l.escolaridad,
        esAfp, afp: tasa ? { aporte: Number(tasa.pctAporte), comision: Number(tasa.pctComision), seguro: Number(tasa.pctSeguro) } : null,
        renta5ta: l.renta5ta, adelanto: l.adelanto, sindical: l.sindical,
      },
    );
    rows.push({
      semanaId, empleadoId: emp.id, nombre: emp.nombre, categoria: emp.categoria, sistemaPension: emp.sistemaPension,
      jornalUsado: dec(Number(param.jornalBase)), diasTrabajados: l.dias, jornadaDominical: l.jornadaDominical,
      horasExtra60: dec(l.horasExtra60), horasExtra100: dec(l.horasExtra100),
      montoJornada: dec(calc.montoJornada), montoDominical: dec(calc.montoDominical), montoBuc: dec(calc.montoBuc),
      montoCompVac: dec(calc.montoCompVac), montoGratif: dec(calc.montoGratif), montoBonifExtra: dec(calc.montoBonifExtra),
      montoCts: dec(calc.montoCts), montoMovilidad: dec(calc.montoMovilidad), montoHorasExtra: dec(calc.montoHorasExtra),
      montoBonifAltura: dec(calc.montoBonifAltura), montoBonifAgua: dec(calc.montoBonifAgua),
      montoEscolaridad: dec(calc.montoEscolaridad), totalIngreso: dec(calc.totalIngreso), totalAfecto: dec(calc.totalAfecto),
      montoAfpAporte: dec(calc.montoAfpAporte), montoAfpComision: dec(calc.montoAfpComision), montoAfpSeguro: dec(calc.montoAfpSeguro),
      montoOnp: dec(calc.montoOnp), montoConafovicer: dec(calc.montoConafovicer), montoRenta5ta: dec(calc.montoRenta5ta),
      montoAdelanto: dec(calc.montoAdelanto), montoSindical: dec(calc.montoSindical), totalDescuentos: dec(calc.totalDescuentos),
      netoPago: dec(calc.netoPago), montoEsSalud: dec(calc.montoEsSalud),
      montoSctrSalud: dec(calc.montoSctrSalud), montoSctrPension: dec(calc.montoSctrPension), montoSencico: dec(calc.montoSencico),
      montoCostoTotal: dec(calc.montoCostoTotal),
      cuentaContable: l.cuentaContable ?? null, cuentaContableOrigen: l.cuentaContable ? 'USUARIO' : null, // WS1
    });
  }
  if (rows.length) await db.insert(schema.planillaDetalle).values(rows);
  res.json({ ok: true, calculados: rows.length });
});

export default router;
