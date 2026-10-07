import { db, schema } from '@erp/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireAdminOContab } from '../lib/permisos.js';
import { periodoCerradoDeFecha } from '../lib/periodos.js';
import { resolverClase } from '../lib/clasificacion.js';
import { syncAsistencia, listarMarcaciones, getEstadoZlink, setConfigZlink, ZlinkError, pendientesVinculacion, revincularPin } from '../lib/zlinkAsistencia.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);
// La captura y aprobación de rendiciones la hace la contadora/admin (no self-service).
const gate = requireAdminOContab();
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
  const cls = await resolverClase({ proyectoId: r.proyectoId, tipoGasto: r.tipo });
  const [g] = await db.insert(schema.gastos).values({
    codigo: r.codigo, proyectoId: r.proyectoId, ...cls, fecha: r.fecha,
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
  const scope = (req.query.scope as string) || 'todas'; // aprobar · todas
  const empleadoId = (req.query.empleadoId as string) || null; // filtro opcional por empleado
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
      if (empleadoId && x.r.empleadoId !== empleadoId) return false;
      if (scope === 'aprobar') return x.r.estado === 'pendiente' || x.r.estado === 'rendido';
      return true;
    })
    .map((x) => ({ ...x.r, proyectoCodigo: x.proyectoCodigo, cuentaNombre: x.cuenta }));
  res.json({ rendiciones: list });
});

// Saldo POR RENDIR por empleado · derivado de anticipos abiertos (aprobado/rendido, aún no cerrados).
// = Σ (montoAnticipo − montoRendido). El saldo se calcula, no se guarda.
router.get('/oficina/saldos-rendir', async (_req, res) => {
  const rows = await db.select().from(schema.rendiciones)
    .where(and(eq(schema.rendiciones.modo, 'anticipo'), inArray(schema.rendiciones.estado, ['aprobado', 'rendido'])));
  const byEmpleado = new Map<string, { empleadoId: string | null; nombre: string; saldo: number; count: number }>();
  for (const r of rows) {
    const key = r.empleadoId ?? r.solicitanteNombre ?? 'sin';
    const e = byEmpleado.get(key) ?? { empleadoId: r.empleadoId ?? null, nombre: r.solicitanteNombre ?? 'Sin nombre', saldo: 0, count: 0 };
    e.saldo += n(r.montoAnticipo) - n(r.montoRendido);
    e.count += 1;
    byEmpleado.set(key, e);
  }
  const saldos = [...byEmpleado.values()].filter((s) => s.saldo > 0.01).sort((a, b) => b.saldo - a.saldo);
  res.json({ saldos, total: saldos.reduce((s, x) => s + x.saldo, 0) });
});

router.get('/oficina/rendiciones/:id', async (req, res) => {
  const d = await getDetalle(req.params.id!);
  if (!d) return res.status(404).json({ error: 'No encontrada' });
  res.json(d);
});

// ─── Crear / editar cabecera ─────────────────────────────────
const cabSchema = z.object({
  empleadoId: z.string().uuid(), // beneficiario · solo se rinde a empleados del padrón
  modo: z.enum(['reembolso', 'anticipo']),
  tipo: z.string().max(20),
  concepto: z.string().optional().nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proyectoId: z.string().uuid().optional().nullable(),
  cuentaId: z.string().uuid().optional().nullable(),
  montoAnticipo: z.number().nonnegative().default(0),
});
router.post('/oficina/rendiciones', gate, async (req, res) => {
  const parse = cabSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  // El nombre es snapshot del empleado (beneficiario). solicitanteUserId = quién captura (auditoría).
  const [emp] = await db.select().from(schema.empleados).where(eq(schema.empleados.id, parse.data.empleadoId)).limit(1);
  if (!emp) return res.status(400).json({ error: 'Empleado no encontrado' });
  const codigo = await nextCodigo();
  const [r] = await db.insert(schema.rendiciones).values({
    ...parse.data, codigo, solicitanteUserId: req.user!.id, solicitanteNombre: emp.nombre,
    montoAnticipo: dec(parse.data.montoAnticipo), estado: 'borrador',
  }).returning();
  res.json({ rendicion: r });
});
router.put('/oficina/rendiciones/:id', gate, async (req, res) => {
  const parse = cabSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const data: Record<string, unknown> = { ...parse.data };
  if (parse.data.montoAnticipo != null) data.montoAnticipo = dec(parse.data.montoAnticipo);
  const [r] = await db.update(schema.rendiciones).set(data).where(eq(schema.rendiciones.id, req.params.id!)).returning();
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  res.json({ rendicion: r });
});
router.delete('/oficina/rendiciones/:id', gate, async (req, res) => {
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
router.post('/oficina/rendiciones/:id/items', gate, async (req, res) => {
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
router.delete('/oficina/rendicion-items/:id', gate, async (req, res) => {
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
router.post('/oficina/rendiciones/:id/enviar', gate, async (req, res) => {
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
router.post('/oficina/rendiciones/:id/aprobar', gate, async (req, res) => {
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
router.post('/oficina/rendiciones/:id/rechazar', gate, async (req, res) => {
  const r = await load(req.params.id!);
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  const [u] = await db.update(schema.rendiciones).set({ estado: 'rechazado', motivoRechazo: (req.body?.motivo as string) ?? null, aprobadoPorUserId: req.user!.id, aprobadoEn: new Date() }).where(eq(schema.rendiciones.id, r.id)).returning();
  res.json({ rendicion: u });
});
// rendir · anticipo: aprobado → rendido (ya cargó comprobantes)
router.post('/oficina/rendiciones/:id/rendir', gate, async (req, res) => {
  const r = await load(req.params.id!);
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  if (r.estado !== 'aprobado' || r.modo !== 'anticipo') return res.status(409).json({ error: 'No corresponde rendir' });
  const total = await recompute(r.id);
  if (total <= 0) return res.status(400).json({ error: 'Agrega comprobantes' });
  const [u] = await db.update(schema.rendiciones).set({ estado: 'rendido' }).where(eq(schema.rendiciones.id, r.id)).returning();
  res.json({ rendicion: u });
});
// cerrar · anticipo: rendido → cerrado (gasto + cuadre del saldo)
router.post('/oficina/rendiciones/:id/cerrar', gate, async (req, res) => {
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

// ─── Asistencia biométrica (ZKBio Zlink) ─────────────────────
// Lista marcaciones de un rango (default: hoy).
router.get('/oficina/asistencia', async (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = (req.query.desde as string) || hoy;
  const hasta = (req.query.hasta as string) || hoy;
  const marcaciones = await listarMarcaciones(desde, hasta);
  res.json({ marcaciones });
});

// Estado de la conexión (configurado, última sync).
router.get('/oficina/asistencia/config', async (_req, res) => {
  res.json(await getEstadoZlink());
});

// Ajuste de config del lector (baseUrl/companyId; token manual como escape hatch).
// El login normal es por credenciales de env (ZLINK_USER/ZLINK_PASS) — ver zlinkAsistencia.
router.put('/oficina/asistencia/config', gate, async (req, res) => {
  const b = req.body as { baseUrl?: string; companyId?: string; accessToken?: string; refreshToken?: string; expiresIn?: number };
  res.json(await setConfigZlink(b));
});

// Sincronizar ahora (manual). El cron 09:30/10:00 llama al mismo servicio.
// ?desde=YYYY-MM-DD fuerza el inicio de la ventana (backfill de un lector atrasado).
router.post('/oficina/asistencia/sync', gate, async (req, res) => {
  const d = String(req.query.desde ?? '');
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'desde debe ser YYYY-MM-DD' });
  try {
    const r = await syncAsistencia(d ? new Date(d + 'T00:00:00') : undefined);
    res.json(r);
  } catch (e) {
    if (e instanceof ZlinkError) return res.status(409).json({ error: e.message });
    console.error('[asistencia] sync error', e);
    res.status(500).json({ error: 'Error al sincronizar asistencia' });
  }
});

// Bandeja de PINs huérfanos: marcaron pero no cruzan con ningún empleado.
router.get('/oficina/asistencia/pendientes', gate, async (_req, res) => {
  res.json({ pendientes: await pendientesVinculacion() });
});

// Declara que ese PIN del lector es de ese empleado y adopta sus marcaciones huérfanas.
// Lo escribe en la ficha (empleados.zlink_pin) para que los próximos syncs ya cruce solo.
const vincSchema = z.object({ employeeCode: z.string().min(1).max(30), empleadoId: z.string().uuid() });
router.post('/oficina/asistencia/vincular', gate, async (req, res) => {
  const parse = vincSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const pin = parse.data.employeeCode.trim();

  const [emp] = await db.select().from(schema.empleados).where(eq(schema.empleados.id, parse.data.empleadoId)).limit(1);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  // zlink_pin es único: un PIN ya tomado se avisa en claro en vez de reventar con 23505.
  const [tomado] = await db.select({ id: schema.empleados.id, nombre: schema.empleados.nombre })
    .from(schema.empleados).where(eq(schema.empleados.zlinkPin, pin)).limit(1);
  if (tomado && tomado.id !== emp.id) {
    return res.status(409).json({ error: `El PIN ${pin} ya está asignado a ${tomado.nombre}` });
  }

  await db.update(schema.empleados).set({ zlinkPin: pin }).where(eq(schema.empleados.id, emp.id));
  const adoptadas = await revincularPin(pin, emp.id);
  await audit(req, {
    action: 'vincular_pin', entityType: 'empleado', entityId: emp.id,
    before: { zlinkPin: emp.zlinkPin }, after: { zlinkPin: pin, marcacionesAdoptadas: adoptadas },
  });
  res.json({ ok: true, adoptadas, empleado: emp.nombre });
});

export default router;
