import { db, schema } from '@erp/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { periodoCerradoDeFecha } from '../lib/periodos.js';

const router = Router();
router.use(requireAuth);
const dec = (n?: number | null) => (n == null ? '0' : n.toString());
const n = (v: unknown) => Number(v ?? 0);

// ─── helpers ─────────────────────────────────────────────────
async function getDetalle(id: string) {
  const [r] = await db.select().from(schema.rendiciones).where(eq(schema.rendiciones.id, id)).limit(1);
  if (!r) return null;
  const items = await db.select().from(schema.rendicionItems).where(eq(schema.rendicionItems.rendicionId, id));
  return { rendicion: r, items };
}
// recalcula montoRendido = suma de comprobantes
async function recompute(id: string) {
  const items = await db.select().from(schema.rendicionItems).where(eq(schema.rendicionItems.rendicionId, id));
  const total = items.reduce((s, it) => s + n(it.total), 0);
  await db.update(schema.rendiciones).set({ montoRendido: dec(total) }).where(eq(schema.rendiciones.id, id));
  return total;
}
// genera el gasto (suma comprobantes deducibles) al reconocer el egreso
async function generarGasto(rendId: string) {
  const d = await getDetalle(rendId);
  if (!d) return null;
  const { rendicion: r, items } = d;
  const ded = items.filter((it) => it.deducible);
  const subtotal = ded.reduce((s, it) => s + n(it.subtotal), 0);
  const igv = ded.reduce((s, it) => s + n(it.igv), 0);
  const exonerado = items.filter((it) => !it.deducible).reduce((s, it) => s + n(it.total), 0);
  const total = items.reduce((s, it) => s + n(it.total), 0);
  const first = items[0];
  const [g] = await db.insert(schema.gastos).values({
    codigo: r.codigo, proyectoId: r.proyectoId, fecha: r.fecha,
    tipoRegistro: 'Rendición', tipoGasto: r.tipo, tipoIgv: igv > 0 ? 'IGV' : 'Exonerado',
    proveedorRuc: first?.ruc ?? null, proveedorRazon: first?.razon ?? r.solicitanteNombre,
    tipoComprobante: first?.tipoComprobante ?? 'recibo', serie: first?.serie ?? null, numero: first?.numero ?? null,
    cuentaId: r.cuentaId, fuentePago: 'Rendición', formaPago: 'Efectivo',
    descripcionItem: r.concepto, subtotal: dec(subtotal), igv: dec(igv), exonerado: dec(exonerado), total: dec(total),
    observaciones: `Rendición ${r.codigo ?? ''} · ${r.solicitanteNombre ?? ''}`,
  }).returning();
  return g ?? null;
}
// movimiento de caja/banco (egreso/ingreso) ligado a la rendición
async function generarMovimiento(r: schema.Rendicion, tipo: 'Egreso' | 'Ingreso', monto: number, subtipo: string, gastoId?: string | null, userId?: string | null) {
  if (monto <= 0) return;
  await db.insert(schema.movimientos).values({
    fecha: r.fecha, proyectoId: r.proyectoId, tipoMovimiento: tipo, cuentaId: r.cuentaId,
    fuenteMovimiento: 'Rendición', subtipo, monto: dec(monto),
    descripcion: `${subtipo} · ${r.codigo ?? ''} · ${r.solicitanteNombre ?? ''}`,
    gastoId: gastoId ?? null, fuentePago: 'Caja', userId: userId ?? null, // H1.2 · trazabilidad
    tipoCambio: '1', montoBase: dec(monto), // H3.1 · rendiciones en PEN
  });
}
async function nextCodigo() {
  const yr = new Date().getUTCFullYear();
  const rows = (await db.select({ count: sql<number>`count(*)` }).from(schema.rendiciones)) as { count: number }[];
  const count = rows[0]?.count ?? 0;
  return `REN-${yr}-${String(Number(count) + 1).padStart(4, '0')}`;
}

// ─── Listado ─────────────────────────────────────────────────
router.get('/oficina/rendiciones', async (req, res) => {
  const scope = (req.query.scope as string) || 'todas'; // mias · aprobar · todas
  const rows = await db
    .select({
      r: schema.rendiciones,
      proyectoCodigo: schema.proyectos.codigo,
      cuenta: schema.cuentasBancarias.descripcion,
    })
    .from(schema.rendiciones)
    .leftJoin(schema.proyectos, eq(schema.proyectos.id, schema.rendiciones.proyectoId))
    .leftJoin(schema.cuentasBancarias, eq(schema.cuentasBancarias.id, schema.rendiciones.cuentaId))
    .orderBy(desc(schema.rendiciones.createdAt));
  const list = rows
    .filter((x) => {
      if (scope === 'mias') return x.r.solicitanteUserId === req.user!.id;
      if (scope === 'aprobar') return x.r.estado === 'pendiente' || x.r.estado === 'rendido';
      return true;
    })
    .map((x) => ({ ...x.r, proyectoCodigo: x.proyectoCodigo, cuentaNombre: x.cuenta }));
  res.json({ rendiciones: list });
});

router.get('/oficina/rendiciones/:id', async (req, res) => {
  const d = await getDetalle(req.params.id!);
  if (!d) return res.status(404).json({ error: 'No encontrada' });
  res.json(d);
});

// ─── Crear / editar cabecera ─────────────────────────────────
const cabSchema = z.object({
  modo: z.enum(['reembolso', 'anticipo']),
  tipo: z.string().max(20),
  concepto: z.string().optional().nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proyectoId: z.string().uuid().optional().nullable(),
  cuentaId: z.string().uuid().optional().nullable(),
  montoAnticipo: z.number().nonnegative().default(0),
});
router.post('/oficina/rendiciones', async (req, res) => {
  const parse = cabSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const codigo = await nextCodigo();
  const [r] = await db.insert(schema.rendiciones).values({
    ...parse.data, codigo, solicitanteUserId: req.user!.id, solicitanteNombre: req.user!.nombres,
    montoAnticipo: dec(parse.data.montoAnticipo), estado: 'borrador',
  }).returning();
  res.json({ rendicion: r });
});
router.put('/oficina/rendiciones/:id', async (req, res) => {
  const parse = cabSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const data: Record<string, unknown> = { ...parse.data };
  if (parse.data.montoAnticipo != null) data.montoAnticipo = dec(parse.data.montoAnticipo);
  const [r] = await db.update(schema.rendiciones).set(data).where(eq(schema.rendiciones.id, req.params.id!)).returning();
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  res.json({ rendicion: r });
});
router.delete('/oficina/rendiciones/:id', async (req, res) => {
  const [r] = await db.select().from(schema.rendiciones).where(eq(schema.rendiciones.id, req.params.id!)).limit(1);
  if (r && !['borrador', 'rechazado'].includes(r.estado)) return res.status(409).json({ error: 'Solo borrador/rechazado se puede eliminar' });
  await db.delete(schema.rendiciones).where(eq(schema.rendiciones.id, req.params.id!));
  res.json({ ok: true });
});

// ─── Ítems (comprobantes) ────────────────────────────────────
const itemSchema = z.object({
  tipoComprobante: z.enum(['factura', 'boleta', 'rh', 'recibo']),
  serie: z.string().optional().nullable(),
  numero: z.string().optional().nullable(),
  ruc: z.string().optional().nullable(),
  razon: z.string().optional().nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  categoria: z.string().optional().nullable(),
  subtotal: z.number().nonnegative().default(0),
  igv: z.number().nonnegative().default(0),
  total: z.number().nonnegative().default(0),
  deducible: z.boolean().default(true),
  archivo: z.string().optional().nullable(),
});
router.post('/oficina/rendiciones/:id/items', async (req, res) => {
  const parse = itemSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  await db.insert(schema.rendicionItems).values({
    rendicionId: req.params.id!, ...d,
    fecha: d.fecha || null, subtotal: dec(d.subtotal), igv: dec(d.igv), total: dec(d.total),
  });
  await recompute(req.params.id!);
  res.json({ ok: true });
});
router.delete('/oficina/rendicion-items/:id', async (req, res) => {
  const [it] = await db.delete(schema.rendicionItems).where(eq(schema.rendicionItems.id, req.params.id!)).returning();
  if (it) await recompute(it.rendicionId);
  res.json({ ok: true });
});

// ─── Transiciones de estado ──────────────────────────────────
async function load(id: string) {
  const [r] = await db.select().from(schema.rendiciones).where(eq(schema.rendiciones.id, id)).limit(1);
  return r ?? null;
}
// enviar: borrador → pendiente
router.post('/oficina/rendiciones/:id/enviar', async (req, res) => {
  const r = await load(req.params.id!);
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  if (r.estado !== 'borrador') return res.status(409).json({ error: 'No está en borrador' });
  const total = await recompute(r.id);
  if (r.modo === 'reembolso' && total <= 0) return res.status(400).json({ error: 'Agrega comprobantes antes de enviar' });
  if (r.modo === 'anticipo' && n(r.montoAnticipo) <= 0) return res.status(400).json({ error: 'Indica el monto de anticipo' });
  const [u] = await db.update(schema.rendiciones).set({ estado: 'pendiente' }).where(eq(schema.rendiciones.id, r.id)).returning();
  res.json({ rendicion: u });
});
// aprobar · reembolso→cerrado (gasto+egreso) · anticipo→aprobado (egreso anticipo)
// ponytail: gatear por rol contador/admin en fase 3 (hoy cualquier autenticado)
router.post('/oficina/rendiciones/:id/aprobar', async (req, res) => {
  const r = await load(req.params.id!);
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  if (r.estado !== 'pendiente') return res.status(409).json({ error: 'No está pendiente' });
  const cerrado = await periodoCerradoDeFecha(String(r.fecha)); // H1.1 · rendición genera movimiento de caja
  if (cerrado) return res.status(423).json({ error: `Periodo ${cerrado} cerrado · no se puede aprobar rendición con fecha retroactiva` });
  const meta = { aprobadoPorUserId: req.user!.id, aprobadoEn: new Date() };
  if (r.modo === 'reembolso') {
    const total = await recompute(r.id);
    const g = await generarGasto(r.id);
    await generarMovimiento(r, 'Egreso', total, 'Reembolso rendición', g?.id, req.user!.id);
    const [u] = await db.update(schema.rendiciones).set({ ...meta, estado: 'cerrado', gastoId: g?.id ?? null }).where(eq(schema.rendiciones.id, r.id)).returning();
    return res.json({ rendicion: u });
  }
  // anticipo: entrega de dinero (aún no es gasto)
  await generarMovimiento(r, 'Egreso', n(r.montoAnticipo), 'Anticipo viático', null, req.user!.id);
  const [u] = await db.update(schema.rendiciones).set({ ...meta, estado: 'aprobado' }).where(eq(schema.rendiciones.id, r.id)).returning();
  res.json({ rendicion: u });
});
router.post('/oficina/rendiciones/:id/rechazar', async (req, res) => {
  const r = await load(req.params.id!);
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  const [u] = await db.update(schema.rendiciones).set({ estado: 'rechazado', motivoRechazo: (req.body?.motivo as string) ?? null, aprobadoPorUserId: req.user!.id, aprobadoEn: new Date() }).where(eq(schema.rendiciones.id, r.id)).returning();
  res.json({ rendicion: u });
});
// rendir · anticipo: aprobado → rendido (ya cargó comprobantes)
router.post('/oficina/rendiciones/:id/rendir', async (req, res) => {
  const r = await load(req.params.id!);
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  if (r.estado !== 'aprobado' || r.modo !== 'anticipo') return res.status(409).json({ error: 'No corresponde rendir' });
  const total = await recompute(r.id);
  if (total <= 0) return res.status(400).json({ error: 'Agrega comprobantes' });
  const [u] = await db.update(schema.rendiciones).set({ estado: 'rendido' }).where(eq(schema.rendiciones.id, r.id)).returning();
  res.json({ rendicion: u });
});
// cerrar · anticipo: rendido → cerrado (gasto + cuadre del saldo)
router.post('/oficina/rendiciones/:id/cerrar', async (req, res) => {
  const r = await load(req.params.id!);
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  if (r.estado !== 'rendido') return res.status(409).json({ error: 'No está rendido' });
  const cerrado = await periodoCerradoDeFecha(String(r.fecha)); // H1.1
  if (cerrado) return res.status(423).json({ error: `Periodo ${cerrado} cerrado · no se puede cerrar rendición con fecha retroactiva` });
  const total = await recompute(r.id);
  const g = await generarGasto(r.id);
  const saldo = n(r.montoAnticipo) - total; // >0 sobró (devuelve) · <0 faltó (reembolso extra)
  if (saldo > 0) await generarMovimiento(r, 'Ingreso', saldo, 'Devolución anticipo', g?.id, req.user!.id);
  else if (saldo < 0) await generarMovimiento(r, 'Egreso', -saldo, 'Reembolso extra rendición', g?.id, req.user!.id);
  const [u] = await db.update(schema.rendiciones).set({ estado: 'cerrado', gastoId: g?.id ?? null, aprobadoPorUserId: req.user!.id, aprobadoEn: new Date() }).where(eq(schema.rendiciones.id, r.id)).returning();
  res.json({ rendicion: u });
});

export default router;
