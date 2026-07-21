import { randomUUID } from 'node:crypto';
import { db, schema } from '@erp/db';
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { periodoCerradoDeFecha } from '../lib/periodos.js';
import { audit } from '../lib/audit.js';
import { resolverClase } from '../lib/clasificacion.js';

const router = Router();
router.use(requireAuth);

// H1 · helpers de hardening reutilizables en mutaciones de caja
async function bloqueoPeriodo(fecha: string, res: import('express').Response): Promise<boolean> {
  const cerrado = await periodoCerradoDeFecha(fecha);
  if (cerrado) { res.status(423).json({ error: `Periodo ${cerrado} cerrado · no se permiten mutaciones retroactivas de caja` }); return true; }
  return false;
}

const dec = (n?: number | null) => (n == null ? '0' : n.toFixed(2));

// helper · enriquece con código de proyecto (para vistas globales)
async function proyectoMap() {
  const ps = await db.select({ id: schema.proyectos.id, codigo: schema.proyectos.codigo, nombre: schema.proyectos.nombre }).from(schema.proyectos);
  return new Map(ps.map((p) => [p.id, p]));
}

// ─── Cuentas bancarias ───────────────────────────────────────
router.get('/cuentas-bancarias', async (_req, res) => {
  const list = await db.select().from(schema.cuentasBancarias).orderBy(asc(schema.cuentasBancarias.descripcion));
  res.json({ cuentas: list });
});
const cuentaSchema = z.object({
  codigo: z.string().min(1),
  banco: z.string().optional().nullable(),
  moneda: z.string().default('PEN'),
  descripcion: z.string().optional().nullable(),
});
router.post('/cuentas-bancarias', async (req, res) => {
  const parse = cuentaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const [cuenta] = await db.insert(schema.cuentasBancarias).values({
    codigo: parse.data.codigo,
    banco: parse.data.banco ?? null,
    moneda: parse.data.moneda ?? 'PEN',
    descripcion: parse.data.descripcion ?? null,
  }).returning();
  res.json({ cuenta });
});
// PATCH · F3 · asignar sub-cuenta PCGE 104x (+ editar banco/descripción) · prerequisito del flip
router.patch('/cuentas-bancarias/:id', async (req, res) => {
  const b = req.body as { cuentaContable?: string | null; banco?: string | null; descripcion?: string | null };
  const set: Record<string, string | null> = {};
  if ('cuentaContable' in b) set.cuentaContable = b.cuentaContable?.trim() || null;
  if ('banco' in b) set.banco = b.banco ?? null;
  if ('descripcion' in b) set.descripcion = b.descripcion ?? null;
  if (Object.keys(set).length === 0) return res.status(400).json({ error: 'nada que actualizar' });
  const [prev] = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.id, String(req.params.id)));
  const [cuenta] = await db.update(schema.cuentasBancarias).set(set).where(eq(schema.cuentasBancarias.id, String(req.params.id))).returning();
  if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });
  await audit(req, { action: 'update_104x', entityType: 'cuenta_bancaria', entityId: cuenta.id, before: { cuentaContable: prev?.cuentaContable, banco: prev?.banco }, after: set });
  res.json({ cuenta });
});

// ─── Gastos (Fact de Compras) ────────────────────────────────
const gastoSchema = z.object({
  fecha: z.string().min(1),
  tipoRegistro: z.string().optional().nullable(),
  tipoIgv: z.string().optional().nullable(),
  ordenCompraId: z.string().uuid().optional().nullable(),
  proveedorId: z.string().uuid().optional().nullable(),
  proveedorRuc: z.string().optional().nullable(),
  proveedorRazon: z.string().optional().nullable(),
  tipoComprobante: z.string().optional().nullable(),
  serie: z.string().optional().nullable(),
  numero: z.string().optional().nullable(),
  moneda: z.string().default('PEN'),
  formaPago: z.string().optional().nullable(),
  fuentePago: z.string().optional().nullable(),
  cuentaId: z.string().uuid().optional().nullable(),
  descripcionItem: z.string().optional().nullable(),
  subtotal: z.number().default(0),
  igv: z.number().default(0),
  exonerado: z.number().default(0),
  total: z.number().default(0),
  tipoGasto: z.string().optional().nullable(),
  observaciones: z.string().optional().nullable(),
  inventariable: z.boolean().optional(), // FX · crea ítem de inventario "por completar" ligado al gasto
  destino: z.enum(['proyecto', 'corporativo']).optional(),
  clasificacion: z.enum(['CD', 'GG_OBRA', 'GG_CORP']).optional(),
  prorrateable: z.boolean().optional(),
});

// FX · gasto → inventario: crea un ítem draft ligado (herramientas/equipos/EPPS). El usuario completa
// código/serie/foto/ubicación en Inventario (filtro "Por completar"); ahí puede promoverlo a activo.
async function crearDraftInventario(gasto: typeof schema.gastos.$inferSelect) {
  await db.insert(schema.inventarioItems).values({
    fecha: gasto.fecha,
    proyectoId: gasto.proyectoId ?? null,
    proveedorRuc: gasto.proveedorRuc ?? null,
    proveedorRazon: gasto.proveedorRazon ?? null,
    tipoComprobante: gasto.tipoComprobante ?? null,
    serie: gasto.serie ?? null,
    numero: gasto.numero ?? null,
    cantidad: '1',
    descripcionItem: gasto.descripcionItem ?? gasto.tipoGasto ?? 'Ítem',
    valorUnitario: gasto.total ?? '0',
    categoria: gasto.tipoGasto ?? null,
    estado: 'Por completar',
    gastoId: gasto.id,
  });
}

function toValues(d: z.infer<typeof gastoSchema>) {
  return {
    fecha: d.fecha,
    tipoRegistro: d.tipoRegistro ?? null,
    tipoIgv: d.tipoIgv ?? null,
    ordenCompraId: d.ordenCompraId ?? null,
    proveedorId: d.proveedorId ?? null,
    proveedorRuc: d.proveedorRuc ?? null,
    proveedorRazon: d.proveedorRazon ?? null,
    tipoComprobante: d.tipoComprobante ?? null,
    serie: d.serie ?? null,
    numero: d.numero ?? null,
    moneda: d.moneda ?? 'PEN',
    formaPago: d.formaPago ?? null,
    fuentePago: d.fuentePago ?? null,
    cuentaId: d.cuentaId ?? null,
    descripcionItem: d.descripcionItem ?? null,
    subtotal: dec(d.subtotal),
    igv: dec(d.igv),
    exonerado: dec(d.exonerado),
    total: dec(d.total),
    tipoGasto: d.tipoGasto ?? null,
    observaciones: d.observaciones ?? null,
    prorrateable: d.prorrateable ?? false,
  };
}

// GET gastos por proyecto · ?desde=&hasta=&tipo=  + totales por tipoGasto
router.get('/proyectos/:id/gastos', async (req, res) => {
  const proyectoId = req.params.id!;
  const { desde, hasta, tipo } = req.query as { desde?: string; hasta?: string; tipo?: string };
  const conds = [eq(schema.gastos.proyectoId, proyectoId)];
  if (desde) conds.push(gte(schema.gastos.fecha, desde));
  if (hasta) conds.push(lte(schema.gastos.fecha, hasta));
  if (tipo) conds.push(eq(schema.gastos.tipoGasto, tipo));
  const list = await db.select().from(schema.gastos).where(and(...conds)).orderBy(desc(schema.gastos.fecha));

  const totalGeneral = list.reduce((s, g) => s + Number(g.total), 0);
  const subtotalGeneral = list.reduce((s, g) => s + Number(g.subtotal), 0);
  const porTipo: Record<string, number> = {};
  for (const g of list) {
    const k = g.tipoGasto ?? 'Sin categoría';
    porTipo[k] = (porTipo[k] ?? 0) + Number(g.total);
  }
  res.json({ gastos: list, stats: { count: list.length, totalGeneral, subtotalGeneral, porTipo } });
});

router.post('/proyectos/:id/gastos', async (req, res) => {
  const parse = gastoSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const values = { proyectoId: req.params.id!, ...toValues(parse.data) };
  const cls = await resolverClase({ proyectoId: values.proyectoId, tipoGasto: values.tipoGasto, destino: parse.data.destino, clasificacion: parse.data.clasificacion });
  const [gasto] = await db.insert(schema.gastos).values({ ...values, ...cls }).returning();
  if (parse.data.inventariable && gasto) await crearDraftInventario(gasto);
  res.json({ gasto });
});

router.put('/gastos/:id', async (req, res) => {
  const parse = gastoSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    if (['subtotal', 'igv', 'exonerado', 'total'].includes(k)) set[k] = dec(v as number);
    else set[k] = v;
  }
  const [gasto] = await db.update(schema.gastos).set(set).where(eq(schema.gastos.id, req.params.id!)).returning();
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
  res.json({ gasto });
});

router.delete('/gastos/:id', async (req, res) => {
  const [g] = await db.select({ lockedAt: schema.gastos.lockedAt }).from(schema.gastos).where(eq(schema.gastos.id, req.params.id!));
  if (g?.lockedAt) return res.status(423).json({ error: 'Gasto congelado por cierre de periodo · reabrir el periodo primero' }); // H2.1
  await db.delete(schema.gastos).where(eq(schema.gastos.id, req.params.id!));
  await audit(req, { action: 'delete', entityType: 'gasto', entityId: req.params.id! });
  res.json({ ok: true });
});

// ─── Movimientos (Flujo de Cuentas) · FIN-2 ──────────────────
const movSchema = z.object({
  fecha: z.string().min(1),
  tipoMovimiento: z.enum(['Ingreso', 'Egreso']),
  fuentePago: z.string().optional().nullable(),
  cuentaId: z.string().uuid().optional().nullable(),
  fuenteMovimiento: z.string().optional().nullable(),
  clienteNombre: z.string().optional().nullable(),
  tipoComprobante: z.string().optional().nullable(),
  serie: z.string().optional().nullable(),
  numero: z.string().optional().nullable(),
  moneda: z.string().default('PEN'),
  monto: z.number().nonnegative(),
  descripcion: z.string().optional().nullable(),
  numOperacion: z.string().optional().nullable(),
  gastoId: z.string().uuid().optional().nullable(),
  // desglose fiscal + transferencias (form rico)
  subtipo: z.string().optional().nullable(),
  subtotal: z.number().optional().nullable(),
  igv: z.number().optional().nullable(),
  detraccion: z.number().optional().nullable(),
  retencion: z.number().optional().nullable(),
  cuentaDestinoId: z.string().uuid().optional().nullable(),
  fechaVencimiento: z.string().optional().nullable(),
  estado: z.string().optional().nullable(),
  // F2 · contabilidad: naturaleza estructurada (→ cuenta PCGE) + link a documento
  naturalezaContable: z.string().optional().nullable(),
  ordenCompraId: z.string().uuid().optional().nullable(),
  valorizacionId: z.string().uuid().optional().nullable(),
  tipoCambio: z.number().positive().optional().nullable(), // H3.1 · TC histórico (obligatorio si moneda≠PEN)
});
const dec2 = (n: number | null | undefined) => (n != null ? Number(n).toFixed(2) : '0');
function movValues(d: z.infer<typeof movSchema>) {
  return {
    fecha: d.fecha,
    tipoMovimiento: d.tipoMovimiento,
    fuentePago: d.fuentePago ?? null,
    cuentaId: d.cuentaId ?? null,
    fuenteMovimiento: d.fuenteMovimiento ?? null,
    clienteNombre: d.clienteNombre ?? null,
    tipoComprobante: d.tipoComprobante ?? null,
    serie: d.serie ?? null,
    numero: d.numero ?? null,
    moneda: d.moneda ?? 'PEN',
    monto: d.monto.toFixed(2),
    descripcion: d.descripcion ?? null,
    numOperacion: d.numOperacion ?? null,
    gastoId: d.gastoId ?? null,
    subtipo: d.subtipo ?? null,
    subtotal: dec2(d.subtotal),
    igv: dec2(d.igv),
    detraccion: dec2(d.detraccion),
    retencion: dec2(d.retencion),
    cuentaDestinoId: d.cuentaDestinoId ?? null,
    fechaVencimiento: d.fechaVencimiento || null,
    estado: d.estado ?? null,
    naturalezaContable: d.naturalezaContable ?? null,
    ordenCompraId: d.ordenCompraId ?? null,
    valorizacionId: d.valorizacionId ?? null,
    // H3.1 · TC snapshot + monto base PEN (para sumas/shadow · nunca recalcular retroactivo)
    tipoCambio: dec2(tcDe(d.moneda, d.tipoCambio)),
    montoBase: (d.monto * tcDe(d.moneda, d.tipoCambio)).toFixed(2),
  };
}
// H3.1 · TC efectivo: PEN→1 · ≠PEN→el provisto. monedaBase = PEN.
const tcDe = (moneda: string | null | undefined, tc: number | null | undefined) => (!moneda || moneda === 'PEN' ? 1 : Number(tc ?? 0));
// valida moneda+TC · devuelve error o null
const validarMonedaTC = (moneda: string | null | undefined, tc: number | null | undefined): string | null => {
  if (moneda && moneda !== 'PEN' && !(Number(tc) > 0)) return `Moneda ${moneda} requiere tipoCambio > 0 (TC histórico)`;
  return null;
};

// GET movimientos por proyecto + stats (ingresos/egresos/neto)
router.get('/proyectos/:id/movimientos', async (req, res) => {
  const list = await db.select().from(schema.movimientos).where(eq(schema.movimientos.proyectoId, req.params.id!)).orderBy(desc(schema.movimientos.fecha));
  const ingresos = list.filter((m) => m.tipoMovimiento === 'Ingreso').reduce((s, m) => s + Number(m.monto), 0);
  const egresos = list.filter((m) => m.tipoMovimiento === 'Egreso').reduce((s, m) => s + Number(m.monto), 0);
  res.json({ movimientos: list, stats: { count: list.length, ingresos, egresos, neto: ingresos - egresos } });
});

router.post('/proyectos/:id/movimientos', async (req, res) => {
  const parse = movSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  { const mErr = validarMonedaTC(parse.data.moneda, parse.data.tipoCambio); if (mErr) return res.status(400).json({ error: mErr }); }
  if (await bloqueoPeriodo(parse.data.fecha, res)) return;
  const [mov] = await db.insert(schema.movimientos).values({ proyectoId: req.params.id!, ...movValues(parse.data), userId: req.user!.id }).returning();
  await audit(req, { action: 'create', entityType: 'movimiento', entityId: mov!.id, after: { monto: mov!.monto, tipo: mov!.tipoMovimiento, naturaleza: mov!.naturalezaContable, cuentaId: mov!.cuentaId } });
  res.json({ movimiento: mov });
});

// H1.3 · hard-delete SOLO admin explícito (scripts/dev). Operación normal = anular.
router.delete('/movimientos/:id', async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ error: 'Hard-delete restringido · usa POST /movimientos/:id/anular' });
  const [prev] = await db.select().from(schema.movimientos).where(eq(schema.movimientos.id, req.params.id!));
  if (prev?.lockedAt) return res.status(423).json({ error: 'Movimiento congelado por cierre · reabrir el periodo primero (ni admin borra historia cerrada)' }); // H2.1
  await db.delete(schema.movimientos).where(eq(schema.movimientos.id, req.params.id!));
  await audit(req, { action: 'hard_delete', entityType: 'movimiento', entityId: req.params.id!, before: prev ?? null, motivo: 'admin hard-delete' });
  res.json({ ok: true });
});

// H1.3 · anulación formal (reemplaza el delete operacional) · soft, con motivo + audit
router.post('/movimientos/:id/anular', async (req, res) => {
  const motivo = String((req.body as { motivo?: unknown })?.motivo ?? '').trim();
  if (!motivo) return res.status(400).json({ error: 'motivo obligatorio para anular' });
  const [prev] = await db.select().from(schema.movimientos).where(eq(schema.movimientos.id, req.params.id!));
  if (!prev) return res.status(404).json({ error: 'Movimiento no encontrado' });
  if (prev.anulado) return res.status(400).json({ error: 'Movimiento ya anulado' });
  if (prev.lockedAt) return res.status(423).json({ error: 'Movimiento congelado por cierre de periodo · reabrir el periodo primero' }); // H2.1
  if (await bloqueoPeriodo(String(prev.fecha), res)) return; // no anular en periodo cerrado
  const [mov] = await db.update(schema.movimientos)
    .set({ anulado: true, anuladoPor: req.user!.id, anuladoEn: new Date(), anuladoMotivo: motivo })
    .where(eq(schema.movimientos.id, req.params.id!)).returning();
  // si es una transferencia, anular también la fila espejo
  if (prev.transferenciaId) {
    await db.update(schema.movimientos)
      .set({ anulado: true, anuladoPor: req.user!.id, anuladoEn: new Date(), anuladoMotivo: motivo })
      .where(and(eq(schema.movimientos.transferenciaId, prev.transferenciaId), eq(schema.movimientos.anulado, false)));
  }
  await audit(req, { action: 'anular', entityType: 'movimiento', entityId: mov!.id, before: { anulado: false, monto: prev.monto }, after: { anulado: true }, motivo });
  res.json({ movimiento: mov });
});

// ─── Inventario (Fact de Inventario) · FIN-3 ─────────────────
const invSchema = z.object({
  fecha: z.string().min(1),
  proveedorRuc: z.string().optional().nullable(),
  proveedorRazon: z.string().optional().nullable(),
  tipoComprobante: z.string().optional().nullable(),
  serie: z.string().optional().nullable(),
  numero: z.string().optional().nullable(),
  cantidad: z.number().default(0),
  descripcionItem: z.string().optional().nullable(),
  valorUnitario: z.number().default(0),
  categoria: z.string().optional().nullable(),
  estado: z.string().optional().nullable(),
  responsable: z.string().optional().nullable(),
  observacion: z.string().optional().nullable(),
});
router.get('/proyectos/:id/inventario', async (req, res) => {
  const list = await db.select().from(schema.inventarioItems).where(eq(schema.inventarioItems.proyectoId, req.params.id!)).orderBy(desc(schema.inventarioItems.fecha));
  const valorTotal = list.reduce((s, it) => s + Number(it.cantidad) * Number(it.valorUnitario), 0);
  const porCategoria: Record<string, number> = {};
  const porEstado: Record<string, number> = {};
  for (const it of list) {
    const v = Number(it.cantidad) * Number(it.valorUnitario);
    porCategoria[it.categoria ?? 'Sin categoría'] = (porCategoria[it.categoria ?? 'Sin categoría'] ?? 0) + v;
    porEstado[it.estado ?? 'Sin estado'] = (porEstado[it.estado ?? 'Sin estado'] ?? 0) + v;
  }
  res.json({ items: list, stats: { count: list.length, valorTotal, porCategoria, porEstado } });
});
router.post('/proyectos/:id/inventario', async (req, res) => {
  const parse = invSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  const [item] = await db.insert(schema.inventarioItems).values({
    proyectoId: req.params.id!, fecha: d.fecha,
    proveedorRuc: d.proveedorRuc ?? null, proveedorRazon: d.proveedorRazon ?? null,
    tipoComprobante: d.tipoComprobante ?? null, serie: d.serie ?? null, numero: d.numero ?? null,
    cantidad: d.cantidad.toString(), descripcionItem: d.descripcionItem ?? null,
    valorUnitario: d.valorUnitario.toString(), categoria: d.categoria ?? null,
    estado: d.estado ?? 'Disponible', responsable: d.responsable ?? null, observacion: d.observacion ?? null,
  }).returning();
  res.json({ item });
});
router.patch('/inventario/:id', async (req, res) => {
  const estado = String((req.body as { estado?: unknown }).estado ?? '');
  if (!estado) return res.status(400).json({ error: 'estado obligatorio' });
  const [item] = await db.update(schema.inventarioItems).set({ estado }).where(eq(schema.inventarioItems.id, req.params.id!)).returning();
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  res.json({ item });
});
router.delete('/inventario/:id', async (req, res) => {
  await db.delete(schema.inventarioItems).where(eq(schema.inventarioItems.id, req.params.id!));
  res.json({ ok: true });
});

// ════════════════ VISTAS GLOBALES (sidebar · proyecto = filtro) ════════════════
const gastoSchemaG = gastoSchema.extend({ proyectoId: z.string().uuid().optional().nullable() });
const movSchemaG = movSchema.extend({ proyectoId: z.string().uuid().optional().nullable() });
const invSchemaG = invSchema.extend({ proyectoId: z.string().uuid().optional().nullable() });

// GET /gastos?proyectoId=&tipo=  (global · all o filtrado)
router.get('/gastos', async (req, res) => {
  const { proyectoId, tipo } = req.query as { proyectoId?: string; tipo?: string };
  const conds = [];
  if (proyectoId) conds.push(eq(schema.gastos.proyectoId, proyectoId));
  if (tipo) conds.push(eq(schema.gastos.tipoGasto, tipo));
  const list = await db.select().from(schema.gastos).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.gastos.fecha));
  const pm = await proyectoMap();
  const totalGeneral = list.reduce((s, g) => s + Number(g.total), 0);
  const subtotalGeneral = list.reduce((s, g) => s + Number(g.subtotal), 0);
  const porTipo: Record<string, number> = {};
  for (const g of list) { const k = g.tipoGasto ?? 'Sin categoría'; porTipo[k] = (porTipo[k] ?? 0) + Number(g.total); }
  res.json({ gastos: list.map((g) => ({ ...g, proyectoCodigo: g.proyectoId ? pm.get(g.proyectoId)?.codigo ?? null : null })), stats: { count: list.length, totalGeneral, subtotalGeneral, porTipo } });
});
router.post('/gastos', async (req, res) => {
  const parse = gastoSchemaG.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { proyectoId, ...rest } = parse.data;
  if (await bloqueoPeriodo(rest.fecha, res)) return;
  const values = { proyectoId: proyectoId ?? null, ...toValues(rest) };
  const cls = await resolverClase({ proyectoId: values.proyectoId, tipoGasto: values.tipoGasto, destino: rest.destino, clasificacion: rest.clasificacion });
  const [gasto] = await db.insert(schema.gastos).values({ ...values, ...cls }).returning();
  if (rest.inventariable && gasto) await crearDraftInventario(gasto);
  await audit(req, { action: 'create', entityType: 'gasto', entityId: gasto!.id, after: { total: gasto!.total, tipo: gasto!.tipoGasto, proveedor: gasto!.proveedorRazon } });
  res.json({ gasto });
});

// GET /movimientos?proyectoId=  (global)
router.get('/movimientos', async (req, res) => {
  const { proyectoId } = req.query as { proyectoId?: string };
  const list = await db.select().from(schema.movimientos).where(proyectoId ? eq(schema.movimientos.proyectoId, proyectoId) : undefined).orderBy(desc(schema.movimientos.fecha));
  const pm = await proyectoMap();
  const ingresos = list.filter((m) => m.tipoMovimiento === 'Ingreso').reduce((s, m) => s + Number(m.monto), 0);
  const egresos = list.filter((m) => m.tipoMovimiento === 'Egreso').reduce((s, m) => s + Number(m.monto), 0);
  res.json({ movimientos: list.map((m) => ({ ...m, proyectoCodigo: m.proyectoId ? pm.get(m.proyectoId)?.codigo ?? null : null })), stats: { count: list.length, ingresos, egresos, neto: ingresos - egresos } });
});
router.post('/movimientos', async (req, res) => {
  const parse = movSchemaG.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { proyectoId, ...rest } = parse.data;
  { const mErr = validarMonedaTC(rest.moneda, rest.tipoCambio); if (mErr) return res.status(400).json({ error: mErr }); }
  if (await bloqueoPeriodo(rest.fecha, res)) return;
  const base = movValues(rest);
  const uid = req.user!.id;

  // Transferencia entre cuentas · 2 filas (egreso origen + ingreso destino) ligadas
  if (rest.cuentaDestinoId && rest.cuentaId && rest.cuentaDestinoId !== rest.cuentaId) {
    const transferenciaId = randomUUID();
    const rows = await db.insert(schema.movimientos).values([
      { ...base, proyectoId: proyectoId ?? null, tipoMovimiento: 'Egreso', cuentaId: rest.cuentaId, cuentaDestinoId: rest.cuentaDestinoId, transferenciaId, subtipo: rest.subtipo ?? 'Transferencia entre cuentas', userId: uid },
      { ...base, proyectoId: proyectoId ?? null, tipoMovimiento: 'Ingreso', cuentaId: rest.cuentaDestinoId, cuentaDestinoId: rest.cuentaId, transferenciaId, subtipo: rest.subtipo ?? 'Transferencia entre cuentas', userId: uid },
    ]).returning();
    await audit(req, { action: 'create', entityType: 'movimiento', entityId: transferenciaId, after: { transferencia: true, monto: base.monto, origen: rest.cuentaId, destino: rest.cuentaDestinoId } });
    return res.json({ movimiento: rows[0], transferencia: true, filas: rows.length });
  }

  const [mov] = await db.insert(schema.movimientos).values({ proyectoId: proyectoId ?? null, ...base, userId: uid }).returning();
  await audit(req, { action: 'create', entityType: 'movimiento', entityId: mov!.id, after: { monto: mov!.monto, tipo: mov!.tipoMovimiento, naturaleza: mov!.naturalezaContable, cuentaId: mov!.cuentaId } });
  res.json({ movimiento: mov });
});

// GET /inventario?proyectoId=  (global)
router.get('/inventario', async (req, res) => {
  const { proyectoId } = req.query as { proyectoId?: string };
  const list = await db.select().from(schema.inventarioItems).where(proyectoId ? eq(schema.inventarioItems.proyectoId, proyectoId) : undefined).orderBy(desc(schema.inventarioItems.fecha));
  const pm = await proyectoMap();
  const valorTotal = list.reduce((s, it) => s + Number(it.cantidad) * Number(it.valorUnitario), 0);
  const porCategoria: Record<string, number> = {};
  for (const it of list) { const v = Number(it.cantidad) * Number(it.valorUnitario); porCategoria[it.categoria ?? 'Sin categoría'] = (porCategoria[it.categoria ?? 'Sin categoría'] ?? 0) + v; }
  res.json({ items: list.map((it) => ({ ...it, proyectoCodigo: it.proyectoId ? pm.get(it.proyectoId)?.codigo ?? null : null })), stats: { count: list.length, valorTotal, porCategoria } });
});
router.post('/inventario', async (req, res) => {
  const parse = invSchemaG.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  const [item] = await db.insert(schema.inventarioItems).values({
    proyectoId: d.proyectoId ?? null, fecha: d.fecha, proveedorRuc: d.proveedorRuc ?? null, proveedorRazon: d.proveedorRazon ?? null,
    tipoComprobante: d.tipoComprobante ?? null, serie: d.serie ?? null, numero: d.numero ?? null,
    cantidad: d.cantidad.toString(), descripcionItem: d.descripcionItem ?? null, valorUnitario: d.valorUnitario.toString(),
    categoria: d.categoria ?? null, estado: d.estado ?? 'Disponible', responsable: d.responsable ?? null, observacion: d.observacion ?? null,
  }).returning();
  res.json({ item });
});

// ─── Resumen Finanzas (1 request · KPIs + flujo + tesorería + garantías + cobrar/pagar) ───
// ?proyectoId= filtra flujos/gastos/valos/garantías/OC · tesorería SIEMPRE empresa (cuentas compartidas)
router.get('/finanzas/resumen', async (req, res) => {
  const { proyectoId } = req.query as { proyectoId?: string };
  const pFilter = proyectoId && proyectoId !== 'todos' ? proyectoId : null;

  // Todas las lecturas independientes en paralelo · tesorería vía GROUP BY (no traer TODA movimientos)
  const [movs, cuentas, tesRows, valos, ocs, gars, gastosOf, pm] = await Promise.all([
    db.select({ fecha: schema.movimientos.fecha, tipo: schema.movimientos.tipoMovimiento, monto: schema.movimientos.monto }).from(schema.movimientos).where(pFilter ? eq(schema.movimientos.proyectoId, pFilter) : undefined),
    db.select().from(schema.cuentasBancarias),
    db.select({ cuentaId: schema.movimientos.cuentaId, tipo: schema.movimientos.tipoMovimiento, total: sql<number>`coalesce(sum(${schema.movimientos.monto}),0)::float8`, n: sql<number>`count(*)::int` }).from(schema.movimientos).groupBy(schema.movimientos.cuentaId, schema.movimientos.tipoMovimiento),
    db.select().from(schema.valorizaciones).where(pFilter ? eq(schema.valorizaciones.proyectoId, pFilter) : undefined),
    db.select().from(schema.ordenesCompra).where(pFilter ? eq(schema.ordenesCompra.proyectoId, pFilter) : undefined),
    db.select().from(schema.garantias).where(pFilter ? eq(schema.garantias.proyectoId, pFilter) : undefined),
    db.select({ fecha: schema.gastos.fecha, total: schema.gastos.total, tipoGasto: schema.gastos.tipoGasto }).from(schema.gastos).where(isNull(schema.gastos.proyectoId)),
    proyectoMap(),
  ]);

  // 1· flujo mensual (agrupado YYYY-MM)
  const porMes = new Map<string, { ingresos: number; egresos: number }>();
  for (const m of movs) {
    const k = String(m.fecha).slice(0, 7);
    const e = porMes.get(k) ?? { ingresos: 0, egresos: 0 };
    if (m.tipo === 'Ingreso') e.ingresos += Number(m.monto);
    else e.egresos += Number(m.monto);
    porMes.set(k, e);
  }
  const mesesOrden = [...porMes.keys()].sort();
  const flujoMensual = mesesOrden.map((mes) => ({ mes, ...porMes.get(mes)! }));
  const flujo6 = flujoMensual.slice(-6);
  const mesActual = mesesOrden.at(-1) ?? null;
  const mesData = mesActual ? porMes.get(mesActual)! : { ingresos: 0, egresos: 0 };

  // 2· Tesorería · agregado por cuenta desde el GROUP BY
  const tesByC = new Map<string, { ingresos: number; egresos: number; n: number }>();
  for (const r of tesRows) {
    const k = r.cuentaId ?? '';
    const e = tesByC.get(k) ?? { ingresos: 0, egresos: 0, n: 0 };
    if (r.tipo === 'Ingreso') e.ingresos += r.total;
    else e.egresos += r.total;
    e.n += r.n;
    tesByC.set(k, e);
  }
  const tesoreria = cuentas.map((c) => {
    const e = tesByC.get(c.id) ?? { ingresos: 0, egresos: 0, n: 0 };
    return { cuenta: c, ingresos: e.ingresos, egresos: e.egresos, saldo: e.ingresos - e.egresos, movimientos: e.n };
  });
  const totalCaja = tesoreria.reduce((s, x) => s + x.saldo, 0);

  // 3· Por cobrar (valorizaciones emitidas no cobradas)
  const porCobrarList = valos
    .filter((v) => ['emitida', 'conformidad_supervision', 'aprobada', 'facturada'].includes(v.status))
    .map((v) => ({
      id: v.id,
      proyectoId: v.proyectoId,
      numero: v.numero,
      mesPeriodo: v.mesPeriodo,
      status: v.status,
      monto: Number(v.montoTotalConIgv ?? v.montoTotal),
    }));
  const totalPorCobrar = porCobrarList.reduce((s, v) => s + v.monto, 0);

  // 4· Por pagar (OC comprometidas no cerradas)
  const porPagarList = ocs
    .filter((o) => ['aprobada', 'emitida', 'en_transito', 'entregada'].includes(o.estado))
    .map((o) => ({
      id: o.id,
      proyectoId: o.proyectoId,
      numero: o.numero,
      estado: o.estado,
      monto: Number(o.montoNetoPagar ?? o.total),
    }));
  const totalPorPagar = porPagarList.reduce((s, o) => s + o.monto, 0);

  // 5· Garantías vigentes
  const garantias = gars
    .filter((g) => g.estado === 'vigente')
    .map((g) => ({
      id: g.id,
      proyectoId: g.proyectoId,
      tipo: g.tipo,
      banco: g.bancoEmisor,
      monto: Number(g.monto),
      vigenciaHasta: g.vigenciaHasta,
    }));
  const totalGarantias = garantias.reduce((s, g) => s + g.monto, 0);

  // 6· Gastos de oficina (proyectoId null = administrativo/general) · último mes + presupuesto
  const mesesOf = [...new Set(gastosOf.map((g) => String(g.fecha).slice(0, 7)))].sort();
  const mesOf = mesesOf.at(-1) ?? null;
  const ofMap = new Map<string, number>();
  for (const g of gastosOf) {
    if (mesOf && String(g.fecha).slice(0, 7) !== mesOf) continue;
    const k = g.tipoGasto ?? 'Otros';
    ofMap.set(k, (ofMap.get(k) ?? 0) + Number(g.total));
  }
  const ejecutadoOf = [...ofMap.values()].reduce((s, v) => s + v, 0);
  const [presupOf] = mesOf
    ? await db.select().from(schema.presupuestoOficina).where(eq(schema.presupuestoOficina.mes, mesOf))
    : [];
  const gastosOficina = {
    mes: mesOf,
    presupuesto: presupOf ? Number(presupOf.monto) : null,
    ejecutado: ejecutadoOf,
    porCategoria: [...ofMap.entries()].map(([categoria, monto]) => ({ categoria, monto, pct: ejecutadoOf ? monto / ejecutadoOf : 0 })).sort((a, b) => b.monto - a.monto),
  };

  // enrich proyecto código (pm ya viene del Promise.all de arriba)
  const codigoOf = (id: string | null) => (id ? pm.get(id)?.codigo ?? null : null);
  const nombreOf = (id: string | null) => (id ? pm.get(id)?.nombre ?? null : null);

  res.json({
    mesActual,
    gastosOficina,
    kpis: {
      ingresosMes: mesData.ingresos,
      egresosMes: mesData.egresos,
      saldoMes: mesData.ingresos - mesData.egresos,
      totalCaja,
      porCobrar: totalPorCobrar,
      porPagar: totalPorPagar,
    },
    flujoMensual: flujo6,
    tesoreria: { cuentas: tesoreria, totalCaja },
    porCobrar: porCobrarList.map((v) => ({ ...v, proyectoCodigo: codigoOf(v.proyectoId), proyectoNombre: nombreOf(v.proyectoId) })),
    porPagar: porPagarList.map((o) => ({ ...o, proyectoCodigo: codigoOf(o.proyectoId), proyectoNombre: nombreOf(o.proyectoId) })),
    garantias: garantias.map((g) => ({ ...g, proyectoCodigo: codigoOf(g.proyectoId), proyectoNombre: nombreOf(g.proyectoId) })),
    totals: { porCobrar: totalPorCobrar, porPagar: totalPorPagar, garantias: totalGarantias },
  });
});

// ─── Flujo de caja (barras + saldo acumulado + composición + sankey) ───
router.get('/finanzas/flujo', async (req, res) => {
  const { proyectoId } = req.query as { proyectoId?: string };
  const pFilter = proyectoId && proyectoId !== 'todos' ? proyectoId : null;

  const movs = await db
    .select({
      fecha: schema.movimientos.fecha,
      tipo: schema.movimientos.tipoMovimiento,
      monto: schema.movimientos.monto,
      cliente: schema.movimientos.clienteNombre,
      proyectoId: schema.movimientos.proyectoId,
    })
    .from(schema.movimientos)
    .where(pFilter ? eq(schema.movimientos.proyectoId, pFilter) : undefined);

  const gastos = await db
    .select({
      fecha: schema.gastos.fecha,
      total: schema.gastos.total,
      tipoGasto: schema.gastos.tipoGasto,
      proyectoId: schema.gastos.proyectoId,
    })
    .from(schema.gastos)
    .where(pFilter ? eq(schema.gastos.proyectoId, pFilter) : undefined);

  const pm = await proyectoMap();
  const nombreProy = (id: string | null) => (id ? pm.get(id)?.codigo ?? pm.get(id)?.nombre ?? 'Sin obra' : 'Oficina/General');

  // 1· Barras mensuales + saldo acumulado
  const porMes = new Map<string, { ingresos: number; egresos: number }>();
  for (const m of movs) {
    const k = String(m.fecha).slice(0, 7);
    const e = porMes.get(k) ?? { ingresos: 0, egresos: 0 };
    if (m.tipo === 'Ingreso') e.ingresos += Number(m.monto);
    else e.egresos += Number(m.monto);
    porMes.set(k, e);
  }
  const meses = [...porMes.keys()].sort();
  let acum = 0;
  const barras = meses.map((mes) => {
    const d = porMes.get(mes)!;
    acum += d.ingresos - d.egresos;
    return { mes, ingresos: d.ingresos, egresos: d.egresos, saldoAcum: acum };
  });
  const mesUlt = meses.at(-1) ?? null;

  // 2· Composición (egresos por categoría · último mes con gastos)
  const mesesGasto = [...new Set(gastos.map((g) => String(g.fecha).slice(0, 7)))].sort();
  const mesComp = mesesGasto.at(-1) ?? null;
  const compMap = new Map<string, number>();
  for (const g of gastos) {
    if (mesComp && String(g.fecha).slice(0, 7) !== mesComp) continue;
    const k = g.tipoGasto ?? 'Otros';
    compMap.set(k, (compMap.get(k) ?? 0) + Number(g.total));
  }
  const compTotal = [...compMap.values()].reduce((s, v) => s + v, 0) || 1;
  const composicion = [...compMap.entries()]
    .map(([categoria, monto]) => ({ categoria, monto, pct: monto / compTotal }))
    .sort((a, b) => b.monto - a.monto);

  // 3· Sankey · Clientes → Proyectos → Categorías
  // Nodos namespaced por nivel (c/p/g) · si un nombre colisiona entre niveles (cliente == categoría,
  // proy == cat, etc.) echarts lo trata como mismo nodo → ciclo → "DAG has cycle" y no dibuja. El frontend
  // quita el prefijo para mostrar. SEP  = caracter no imprimible (no aparece en nombres reales).
  const SEP = '';
  const nC = (s: string) => `c${SEP}${s}`;
  const nP = (s: string) => `p${SEP}${s}`;
  const nG = (s: string) => `g${SEP}${s}`;
  // A· Normalización de categorías · une grafías/acentos/casing (viatico/Viáticos, Seguro/seguros…)
  const CAT_CANON: Record<string, string> = { viatico: 'Viáticos', viaticos: 'Viáticos', seguro: 'Seguros', seguros: 'Seguros', varios: 'Otros', otros: 'Otros' };
  const catKey = (raw?: string | null) => (raw ?? 'Otros').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const catLabelByKey = new Map<string, string>();
  const catLabel = (raw?: string | null) => {
    const k = catKey(raw);
    if (CAT_CANON[k]) return CAT_CANON[k];
    if (!catLabelByKey.has(k)) catLabelByKey.set(k, (raw ?? 'Otros').trim() || 'Otros');
    return catLabelByKey.get(k)!;
  };

  // B1· Cliente real desde proyecto.clienteId (no el texto libre del movimiento)
  const cliRows = await db
    .select({ pid: schema.proyectos.id, cli: schema.clientes.razonSocial })
    .from(schema.proyectos)
    .leftJoin(schema.clientes, eq(schema.proyectos.clienteId, schema.clientes.id));
  const proyCliente = new Map(cliRows.map((r) => [r.pid, r.cli]));

  // Egresos: Proyecto → Categoría (siempre · 2 niveles · default seguro)
  const egr = new Map<string, number>();
  for (const g of gastos) {
    const k = `${nP(nombreProy(g.proyectoId))}||${nG(catLabel(g.tipoGasto))}`;
    egr.set(k, (egr.get(k) ?? 0) + Number(g.total));
  }
  // Ingresos: Cliente real → Proyecto · sin cliente confiable se omite (se cuenta el monto)
  const ing = new Map<string, number>();
  let ingresosSinCliente = 0;
  for (const m of movs) {
    if (m.tipo !== 'Ingreso') continue;
    const cli = m.proyectoId ? proyCliente.get(m.proyectoId) : null;
    if (!cli) { ingresosSinCliente += Number(m.monto); continue; }
    const k = `${nC(cli)}||${nP(nombreProy(m.proyectoId))}`;
    ing.set(k, (ing.get(k) ?? 0) + Number(m.monto));
  }

  const toSankey = (mp: Map<string, number>) => {
    const set = new Set<string>();
    const links: { source: string; target: string; value: number }[] = [];
    for (const [k, v] of mp) {
      const [s, t] = k.split('||') as [string, string];
      set.add(s); set.add(t);
      links.push({ source: s, target: t, value: Math.round(v) });
    }
    return { nodes: [...set].map((name) => ({ name })), links: links.filter((l) => l.value > 0) };
  };

  res.json({
    barras, mesUlt, composicion, mesComp,
    sankeyEgresos: toSankey(egr),
    sankeyIngresos: toSankey(ing),
    ingresosSinCliente: Math.round(ingresosSinCliente),
  });
});

// ─── Cashflow detallado (dashboard v1: meses + detalleIng/detalleEg) ───
// Ingresos = valorizaciones facturadas/cobradas + movimientos tipo Ingreso.
// Egresos = gastos (Fact de Compras · la fuente real con detalle).
const MESES_ABBR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
const mesAbbr = (ym: string) => { const [y, m] = ym.split('-'); return `${MESES_ABBR[Number(m) - 1] ?? m} '${(y ?? '').slice(2)}`; };

// Dos modos para no mandar 351 KB en cada carga:
//  · sin `periodo`  → TOTALES por mes (gráfico) · payload chico
//  · con `periodo` (+tab) → SOLO el detalle de ese alcance (drill on-demand)
//    periodo = 'todos' | 'YYYY' | 'YYYY-MM'
const inScope = (ym: string, periodo: string) => periodo === 'todos' || (periodo.length === 4 ? ym.slice(0, 4) === periodo : ym === periodo);

router.get('/finanzas/cashflow-detalle', async (req, res) => {
  const { proyectoId, periodo, tab } = req.query as { proyectoId?: string; periodo?: string; tab?: 'ingresos' | 'egresos' };
  const pFilter = proyectoId && proyectoId !== 'todos' ? proyectoId : null;

  // ── modo DETALLE (drill) ──
  if (periodo) {
    const pm = await proyectoMap();
    const codeOf = (id: string | null) => (id ? pm.get(id)?.codigo ?? 'Obra' : 'OFICINA');
    type Entry = { tipo?: string; categoria?: string; concepto: string; proyecto: string; contraparte: string; comprobante: string; fecha: string; monto: number };
    const entries: Entry[] = [];
    if (tab === 'egresos') {
      const gastos = await db.select().from(schema.gastos).where(pFilter ? eq(schema.gastos.proyectoId, pFilter) : undefined);
      for (const g of gastos) {
        const ym = String(g.fecha).slice(0, 7);
        if (!inScope(ym, periodo)) continue;
        entries.push({ categoria: g.tipoGasto ?? 'Varios', concepto: g.descripcionItem ?? 'Gasto', proyecto: codeOf(g.proyectoId), contraparte: g.proveedorRazon ?? 'Varios', comprobante: [g.serie, g.numero].filter(Boolean).join('-') || '—', fecha: String(g.fecha).slice(0, 10), monto: Number(g.total) });
      }
    } else {
      const [cliRows, vals, movs] = await Promise.all([
        db.select({ pid: schema.proyectos.id, cli: schema.clientes.razonSocial }).from(schema.proyectos).leftJoin(schema.clientes, eq(schema.proyectos.clienteId, schema.clientes.id)),
        db.select().from(schema.valorizaciones).where(pFilter ? eq(schema.valorizaciones.proyectoId, pFilter) : undefined),
        db.select().from(schema.movimientos).where(pFilter ? eq(schema.movimientos.proyectoId, pFilter) : undefined),
      ]);
      const cliOf = new Map(cliRows.map((r) => [r.pid, r.cli]));
      for (const v of vals) {
        if (!['facturada', 'cobrada'].includes(v.status)) continue;
        const ym = String(v.fechaEmision).slice(0, 7);
        if (!inScope(ym, periodo)) continue;
        entries.push({ tipo: 'Valorización', concepto: `V${String(v.numero).padStart(2, '0')} — ${mesAbbr(ym)}`, proyecto: codeOf(v.proyectoId), contraparte: cliOf.get(v.proyectoId) ?? 'Cliente', comprobante: '—', fecha: String(v.fechaEmision).slice(0, 10), monto: Number(v.montoTotal) });
      }
      for (const m of movs) {
        if (m.tipoMovimiento !== 'Ingreso') continue;
        const ym = String(m.fecha).slice(0, 7);
        if (!inScope(ym, periodo)) continue;
        entries.push({ tipo: m.fuenteMovimiento ?? 'Ingreso', concepto: m.descripcion ?? 'Ingreso', proyecto: codeOf(m.proyectoId), contraparte: m.clienteNombre ?? 'Varios', comprobante: [m.serie, m.numero].filter(Boolean).join('-') || '—', fecha: String(m.fecha).slice(0, 10), monto: Number(m.monto) });
      }
    }
    return res.json({ entries });
  }

  // ── modo TOTALES (gráfico) · solo sumas por mes ──
  const [gastos, vals, movs] = await Promise.all([
    db.select({ fecha: schema.gastos.fecha, total: schema.gastos.total }).from(schema.gastos).where(pFilter ? eq(schema.gastos.proyectoId, pFilter) : undefined),
    db.select({ fecha: schema.valorizaciones.fechaEmision, monto: schema.valorizaciones.montoTotal, status: schema.valorizaciones.status }).from(schema.valorizaciones).where(pFilter ? eq(schema.valorizaciones.proyectoId, pFilter) : undefined),
    db.select({ fecha: schema.movimientos.fecha, monto: schema.movimientos.monto, tipo: schema.movimientos.tipoMovimiento }).from(schema.movimientos).where(pFilter ? eq(schema.movimientos.proyectoId, pFilter) : undefined),
  ]);
  const meses = new Map<string, { ingresos: number; egresos: number }>();
  const b = (ym: string) => { let x = meses.get(ym); if (!x) { x = { ingresos: 0, egresos: 0 }; meses.set(ym, x); } return x; };
  for (const v of vals) if (['facturada', 'cobrada'].includes(v.status)) b(String(v.fecha).slice(0, 7)).ingresos += Number(v.monto);
  for (const m of movs) if (m.tipo === 'Ingreso') b(String(m.fecha).slice(0, 7)).ingresos += Number(m.monto);
  for (const g of gastos) b(String(g.fecha).slice(0, 7)).egresos += Number(g.total);
  let acum = 0;
  const out = [...meses.keys()].sort().map((ym) => {
    const x = meses.get(ym)!;
    acum += x.ingresos - x.egresos;
    return { ym, label: mesAbbr(ym), year: Number(ym.slice(0, 4)), ingresos: x.ingresos, egresos: x.egresos, acumulado: acum };
  });
  res.json({ meses: out });
});

// ─── Presupuesto oficina (tope mensual editable) ─────────────
router.put('/finanzas/presupuesto-oficina', async (req, res) => {
  const { mes, monto } = req.body as { mes?: string; monto?: number };
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'mes inválido (YYYY-MM)' });
  const [row] = await db
    .insert(schema.presupuestoOficina)
    .values({ mes, monto: dec(monto) })
    .onConflictDoUpdate({ target: schema.presupuestoOficina.mes, set: { monto: dec(monto), updatedAt: new Date() } })
    .returning();
  res.json({ presupuesto: row });
});

// ─── FX-4 · Vistas factura↔ítems ─────────────────────────────
// Ítems de una compra (gasto) + valuación factura vs inventariable
router.get('/gastos/:id/items', async (req, res) => {
  const id = String(req.params.id);
  const [gasto] = await db.select().from(schema.gastos).where(eq(schema.gastos.id, id));
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
  const items = await db.select().from(schema.inventarioItems).where(eq(schema.inventarioItems.gastoId, id)).orderBy(desc(schema.inventarioItems.fecha));
  const inventariable = items.reduce((s, it) => s + Number(it.cantidad) * Number(it.valorUnitario), 0);
  const facturaTotal = Number(gasto.total);
  res.json({ gasto, items, valuacion: { facturaTotal, inventariable, diferencia: facturaTotal - inventariable } });
});

// Detalle de un ítem · compra origen + ítems de la misma factura + historial de compras (misma descripción)
router.get('/inventario/:id/detalle', async (req, res) => {
  const id = String(req.params.id);
  const [item] = await db.select().from(schema.inventarioItems).where(eq(schema.inventarioItems.id, id));
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });

  let gasto: typeof schema.gastos.$inferSelect | null = null;
  let itemsFactura: (typeof schema.inventarioItems.$inferSelect)[] = [];
  let valuacion: { facturaTotal: number; inventariable: number; diferencia: number } | null = null;
  if (item.gastoId) {
    const [gastoArr, itemsF] = await Promise.all([
      db.select().from(schema.gastos).where(eq(schema.gastos.id, item.gastoId)),
      db.select().from(schema.inventarioItems).where(eq(schema.inventarioItems.gastoId, item.gastoId)),
    ]);
    gasto = gastoArr[0] ?? null;
    itemsFactura = itemsF;
    const inventariable = itemsFactura.reduce((s, it) => s + Number(it.cantidad) * Number(it.valorUnitario), 0);
    const facturaTotal = gasto ? Number(gasto.total) : 0;
    valuacion = { facturaTotal, inventariable, diferencia: facturaTotal - inventariable };
  }

  // historial de compras del MISMO ítem (descripción exacta · sin catálogo SKU aún)
  const historial = item.descripcionItem
    ? await db.select().from(schema.inventarioItems).where(eq(schema.inventarioItems.descripcionItem, item.descripcionItem)).orderBy(desc(schema.inventarioItems.fecha))
    : [item];
  res.json({ item, gasto, itemsFactura, valuacion, historial });
});

// GET saldos por cuenta (global · caja real de toda la empresa)
router.get('/tesoreria/saldos', async (_req, res) => {
  const cuentas = await db.select().from(schema.cuentasBancarias);
  const movs = await db.select({ cuentaId: schema.movimientos.cuentaId, tipo: schema.movimientos.tipoMovimiento, monto: schema.movimientos.monto }).from(schema.movimientos);
  const saldos = cuentas.map((c) => {
    const ms = movs.filter((m) => m.cuentaId === c.id);
    const ingresos = ms.filter((m) => m.tipo === 'Ingreso').reduce((s, m) => s + Number(m.monto), 0);
    const egresos = ms.filter((m) => m.tipo === 'Egreso').reduce((s, m) => s + Number(m.monto), 0);
    return { cuenta: c, ingresos, egresos, saldo: ingresos - egresos, movimientos: ms.length };
  });
  res.json({ saldos, totalSaldo: saldos.reduce((s, x) => s + x.saldo, 0) });
});

export default router;
