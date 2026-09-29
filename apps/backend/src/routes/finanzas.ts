import { randomUUID } from 'node:crypto';
import { db, schema } from '@erp/db';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { periodoCerradoDeFecha } from '../lib/periodos.js';
import { audit } from '../lib/audit.js';
import { resolverClase } from '../lib/clasificacion.js';
import { extrasCompraSchema, registrarCompra } from '../lib/compras.js';
import { DocumentoError, anularAplicacionesDe, aplicar, aplicarPagoAOrigen } from '../lib/documentosPendientes.js';
import { registrarVenta, ventaSchema } from '../lib/ventas.js';

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
  // solo cuentas activas (las desactivadas no aparecen en selectores ni admin; reversible por DB activo=true)
  const list = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.activo, true)).orderBy(asc(schema.cuentasBancarias.descripcion));
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
  // WS1 · cuenta contable MANUAL (Kelly). CD/GG NUNCA es input: se deriva de la cuenta en el motor.
  cuentaContable: z.string().max(10).optional().nullable(),
  cuentaContableOrigen: z.enum(['USUARIO', 'SUGERIDO']).optional().nullable(),
  // F3.5 · anotación RCE en otro periodo (crédito 12 meses) + destino del crédito fiscal
  periodoContable: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
  destinoCredito: z.enum(['DG', 'DGNG', 'DNG']).optional(),
});

// Fase 1 · el alta de compra acepta los datos de documento; el PUT sigue usando gastoSchema (edición de cabecera)
const gastoCompraSchema = gastoSchema.extend(extrasCompraSchema.shape);

async function validarCuentasCompra(cabecera: string | null | undefined, lineas: { cuentaContable?: string | null }[] | undefined) {
  for (const c of [cabecera, ...(lineas ?? []).map((l) => l.cuentaContable)]) {
    const err = await validarCuentaContable(c);
    if (err) return err;
  }
  return null;
}

function separarExtras<T extends z.infer<typeof gastoCompraSchema>>(d: T) {
  const { fechaVencimiento, tipoCambio, lineas, detraccion, retencion, percepcion, docModifica, motivoNota, ...resto } = d;
  return { extras: { fechaVencimiento, tipoCambio, lineas, detraccion, retencion, percepcion, docModifica, motivoNota }, resto };
}

function responderErrorCompra(e: unknown, res: import('express').Response) {
  if (e instanceof DocumentoError) { res.status(e.status).json({ error: e.message }); return true; }
  return false;
}

// WS1 · valida que la cuenta exista, esté activa y pertenezca a la empresa (o sea compartida).
// Devuelve error string o null. empresaId operativo = MM(1) por ahora.
async function validarCuentaContable(codigo: string | null | undefined, empresaId = 1): Promise<string | null> {
  if (!codigo) return null; // sin cuenta manual = válido (el motor infiere · compat)
  const [c] = await db.select({ activa: schema.planContable.activa, empresaId: schema.planContable.empresaId })
    .from(schema.planContable).where(eq(schema.planContable.codigo, codigo)).limit(1);
  if (!c) return `cuenta contable ${codigo} no existe en el plan`;
  if (c.activa === false) return `cuenta contable ${codigo} está inactiva`;
  if (c.empresaId != null && c.empresaId !== empresaId) return `cuenta contable ${codigo} pertenece a otra empresa`;
  return null;
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
    // WS1 · cuenta manual + procedencia. Si no viene cuenta, origen queda null (motor infiere).
    cuentaContable: d.cuentaContable ?? null,
    cuentaContableOrigen: d.cuentaContable ? (d.cuentaContableOrigen ?? 'USUARIO') : null,
    // F3.5 · tributario fino
    periodoContable: d.periodoContable ?? null,
    destinoCredito: d.destinoCredito ?? 'DG',
  };
}

// WS1 · la sugerencia de cuenta por proveedor/tipoGasto vive en GET /contabilidad/sugerir-cuenta (2 niveles).

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

router.post('/proyectos/:id/gastos', async (req, res, next) => {
  const parse = gastoCompraSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { extras, resto } = separarExtras(parse.data);
  const errCuenta = await validarCuentasCompra(resto.cuentaContable, extras.lineas); // WS1
  if (errCuenta) return res.status(400).json({ error: errCuenta });
  const values = { proyectoId: req.params.id!, ...toValues(resto) };
  // FINDING 2: ruta de proyecto → siempre destino='proyecto' (ignorar lo que diga el cliente)
  const cls = await resolverClase({ proyectoId: values.proyectoId, tipoGasto: values.tipoGasto, destino: 'proyecto', clasificacion: resto.clasificacion });
  try {
    const r = await db.transaction((tx) => registrarCompra(tx, { values: { ...values, ...cls }, extras, inventariable: resto.inventariable, userId: req.user!.id }));
    res.json({ gasto: r.gasto, documento: r.documento, detraccion: r.detraccion });
  } catch (e) {
    if (!responderErrorCompra(e, res)) return next(e); // D5 · Express 4 no atrapa el throw async: el request se cuelga sin next
  }
});

router.put('/gastos/:id', async (req, res) => {
  const parse = gastoSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  // Fase 1 · si la compra ya tiene cuenta por pagar (o ES una NC con su aplicación activa contra otra factura),
  // editar los datos del documento la deja desincronizada (D13 + fix1 · nota de crédito también)
  if (['total', 'subtotal', 'igv', 'exonerado', 'moneda', 'serie', 'numero', 'proveedorRuc', 'tipoComprobante'].some((k) => k in d)) {
    const [docExistente] = await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente)
      .where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), eq(schema.documentoPendiente.docOrigenId, req.params.id!))).limit(1);
    const [aplicNota] = await db.select({ id: schema.aplicacionDocumento.id }).from(schema.aplicacionDocumento)
      .where(and(eq(schema.aplicacionDocumento.origenTipo, 'nota'), eq(schema.aplicacionDocumento.origenId, req.params.id!), eq(schema.aplicacionDocumento.estado, 'activa'))).limit(1);
    if (docExistente || aplicNota) return res.status(409).json({ error: 'La compra tiene cuenta por pagar · anula y registra de nuevo' });
  }
  const errCuenta = await validarCuentaContable(d.cuentaContable); // WS1
  if (errCuenta) return res.status(400).json({ error: errCuenta });
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    if (['subtotal', 'igv', 'exonerado', 'total'].includes(k)) set[k] = dec(v as number);
    else set[k] = v;
  }
  // WS1 · si viene cuenta manual, fija su procedencia (USUARIO salvo que el cliente marque SUGERIDO).
  if (d.cuentaContable !== undefined) set.cuentaContableOrigen = d.cuentaContable ? (d.cuentaContableOrigen ?? 'USUARIO') : null;
  // WS1 gobierno (Fase 6) · auditar cambio de cuenta contable (quién · antes · después · documento).
  let cuentaPrev: string | null | undefined;
  if (d.cuentaContable !== undefined) {
    const [pg] = await db.select({ cc: schema.gastos.cuentaContable }).from(schema.gastos).where(eq(schema.gastos.id, req.params.id!)).limit(1);
    cuentaPrev = pg?.cc ?? null;
  }
  // FINDING 1: mantener el invariante de clasificación también al editar (no confiar en el valor crudo del cliente)
  if (d.destino !== undefined || d.clasificacion !== undefined) {
    const [prev] = await db.select({ proyectoId: schema.gastos.proyectoId, tipoGasto: schema.gastos.tipoGasto, destino: schema.gastos.destino }).from(schema.gastos).where(eq(schema.gastos.id, req.params.id!)).limit(1);
    if (prev) {
      const cls = await resolverClase({
        proyectoId: prev.proyectoId,
        tipoGasto: d.tipoGasto ?? prev.tipoGasto,
        destino: d.destino ?? prev.destino,
        clasificacion: d.clasificacion,
      });
      set.destino = cls.destino;
      set.clasificacion = cls.clasificacion;
      set.clasificacionOrigen = cls.clasificacionOrigen;
    }
  }
  const [gasto] = await db.update(schema.gastos).set(set).where(eq(schema.gastos.id, req.params.id!)).returning();
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
  // WS1 gobierno · registra el cambio de cuenta contable (solo si cambió realmente).
  if (d.cuentaContable !== undefined && cuentaPrev !== gasto.cuentaContable) {
    await audit(req, { action: 'reclasificar_cuenta', entityType: 'gasto', entityId: gasto.id, before: { cuentaContable: cuentaPrev }, after: { cuentaContable: gasto.cuentaContable, origen: gasto.cuentaContableOrigen } });
  }
  res.json({ gasto });
});

router.delete('/gastos/:id', async (req, res, next) => {
  const id = req.params.id!;
  try {
    const [g] = await db.select({ lockedAt: schema.gastos.lockedAt }).from(schema.gastos).where(eq(schema.gastos.id, id));
    if (g?.lockedAt) return res.status(423).json({ error: 'Gasto congelado por cierre de periodo · reabrir el periodo primero' }); // H2.1
    await db.transaction(async (tx) => {
      const d = schema.documentoPendiente, a = schema.aplicacionDocumento;
      // fix1 · lock de fila: un pago aplicado entre el check y el borrado no se pierde (D12)
      const [doc] = await tx.select().from(d).where(and(eq(d.docOrigenTipo, 'gasto'), eq(d.docOrigenId, id))).limit(1).for('update');
      if (doc) {
        const activas = await tx.select({ id: a.id, origenTipo: a.origenTipo, origenId: a.origenId }).from(a)
          .where(and(eq(a.documentoPendienteId, doc.id), eq(a.estado, 'activa')));
        // fix1 · la propia retención (origenTipo='nota' · origenId=este mismo gasto) nace al registrar esta compra:
        // se borra junto con su documento más abajo, no bloquea el borrado. Solo bloquea una aplicación EXTERNA
        // (un pago vía movimiento, o una nota de crédito de OTRO gasto) que primero hay que anular.
        const externa = activas.some((x) => !(x.origenTipo === 'nota' && x.origenId === id));
        if (externa) throw new DocumentoError(409, 'La compra tiene pagos o notas de crédito aplicados · anúlalos primero');
      }
      await anularAplicacionesDe(tx, 'nota', id); // si es NC, devuelve el saldo a la factura referida; si tenía retención propia, la anula
      if (doc) {
        await tx.delete(a).where(eq(a.documentoPendienteId, doc.id));
        await tx.delete(d).where(eq(d.id, doc.id));
      }
      await tx.delete(schema.detraccionDocumento).where(and(eq(schema.detraccionDocumento.docOrigenTipo, 'gasto'), eq(schema.detraccionDocumento.docOrigenId, id)));
      // fix1 · borra solo los items "Por completar" creados por esta compra (drafts); otros items ya promovidos quedan (FK set null)
      await tx.delete(schema.inventarioItems).where(and(eq(schema.inventarioItems.gastoId, id), eq(schema.inventarioItems.estado, 'Por completar')));
      await tx.delete(schema.gastos).where(eq(schema.gastos.id, id));
    });
    await audit(req, { action: 'delete', entityType: 'gasto', entityId: id });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof DocumentoError) return res.status(e.status).json({ error: e.message });
    return next(e);
  }
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
  // WS1 · cuenta contable contra MANUAL (Kelly). CD/GG se deriva en el motor, nunca input.
  cuentaContable: z.string().max(10).optional().nullable(),
  cuentaContableOrigen: z.enum(['USUARIO', 'SUGERIDO']).optional().nullable(),
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
    // WS1 · cuenta contra manual + procedencia (motor la re-lee y NO la pisa)
    cuentaContable: d.cuentaContable ?? null,
    cuentaContableOrigen: d.cuentaContable ? (d.cuentaContableOrigen ?? 'USUARIO') : null,
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
  { const cErr = await validarCuentaContable(parse.data.cuentaContable); if (cErr) return res.status(400).json({ error: cErr }); } // WS1
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
  // F2.2 · pago anulado devuelve el saldo a sus documentos (anula aplicaciones activas)
  const devueltas = await anularAplicacionesDe(db, 'movimiento', prev.id);
  // F6 fix · conciliación fantasma: la(s) línea(s) del extracto ligadas a un movimiento anulado
  // vuelven a pendiente (si no, el % conciliado queda inflado contra un movimiento muerto)
  const movsAnulados = prev.transferenciaId
    ? (await db.select({ id: schema.movimientos.id }).from(schema.movimientos).where(eq(schema.movimientos.transferenciaId, prev.transferenciaId))).map((m) => m.id)
    : [prev.id];
  const lineasRevertidas = await db.update(schema.extractoLineas)
    .set({ estado: 'pendiente', movimientoId: null, matchedPor: null, matchedEn: null, score: null, confianza: null })
    .where(inArray(schema.extractoLineas.movimientoId, movsAnulados))
    .returning({ id: schema.extractoLineas.id });
  await audit(req, { action: 'anular', entityType: 'movimiento', entityId: mov!.id, before: { anulado: false, monto: prev.monto }, after: { anulado: true, aplicacionesAnuladas: devueltas, conciliacionesRevertidas: lineasRevertidas.length }, motivo });
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
const movSchemaG = movSchema.extend({
  proyectoId: z.string().uuid().optional().nullable(),
  // F2.2 · un pago/cobro puede aplicarse a varios documentos pendientes (proveedor → jala facturas)
  aplicaciones: z.array(z.object({ documentoPendienteId: z.string().uuid(), monto: z.number().positive() })).optional(),
});
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
  // Fase 1 · saldo de la CxP de cada compra (null = sin documento: histórico, NC o rendición)
  const docs = list.length
    ? await db.select({ origen: schema.documentoPendiente.docOrigenId, saldo: schema.documentoPendiente.saldoPendiente, estado: schema.documentoPendiente.estado })
      .from(schema.documentoPendiente)
      .where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), inArray(schema.documentoPendiente.docOrigenId, list.map((g) => g.id))))
    : [];
  const docPorGasto = new Map(docs.map((d) => [d.origen, d]));
  const estadoPago = (e: string) => (e === 'cancelado' ? 'pagado' : e === 'parcial' ? 'parcial' : 'pendiente');
  res.json({
    gastos: list.map((g) => {
      const d = docPorGasto.get(g.id);
      return { ...g, proyectoCodigo: g.proyectoId ? pm.get(g.proyectoId)?.codigo ?? null : null, saldoPendiente: d ? Number(d.saldo) : null, estadoPago: d ? estadoPago(d.estado) : null };
    }),
    stats: { count: list.length, totalGeneral, subtotalGeneral, porTipo },
  });
});

// Fase 1 · detalle de una compra: líneas + CxP + aplicaciones (pagos/NC) + detracción
router.get('/gastos/:id/detalle', async (req, res) => {
  const id = req.params.id!;
  const [gasto] = await db.select().from(schema.gastos).where(eq(schema.gastos.id, id));
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
  const d = schema.documentoPendiente;
  const lineas = await db.select().from(schema.gastoLineas).where(eq(schema.gastoLineas.gastoId, id)).orderBy(asc(schema.gastoLineas.numero));
  const [documento] = await db.select().from(d).where(and(eq(d.docOrigenTipo, 'gasto'), eq(d.docOrigenId, id)));
  const aplicaciones = documento
    ? await db.select().from(schema.aplicacionDocumento).where(eq(schema.aplicacionDocumento.documentoPendienteId, documento.id)).orderBy(asc(schema.aplicacionDocumento.createdAt))
    : [];
  const [detraccion] = await db.select().from(schema.detraccionDocumento).where(and(eq(schema.detraccionDocumento.docOrigenTipo, 'gasto'), eq(schema.detraccionDocumento.docOrigenId, id)));
  res.json({ gasto, lineas, documento: documento ?? null, aplicaciones, detraccion: detraccion ?? null });
});

router.post('/gastos', async (req, res, next) => {
  const parse = gastoCompraSchema.extend({ proyectoId: z.string().uuid().optional().nullable() }).safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { proyectoId, ...data } = parse.data;
  const { extras, resto } = separarExtras(data);
  const errCuenta = await validarCuentasCompra(resto.cuentaContable, extras.lineas); // WS1
  if (errCuenta) return res.status(400).json({ error: errCuenta });
  if (await bloqueoPeriodo(resto.fecha, res)) return;
  const values = { proyectoId: proyectoId ?? null, ...toValues(resto) };
  const cls = await resolverClase({ proyectoId: values.proyectoId, tipoGasto: values.tipoGasto, destino: resto.destino, clasificacion: resto.clasificacion });
  try {
    const r = await db.transaction((tx) => registrarCompra(tx, { values: { ...values, ...cls }, extras, inventariable: resto.inventariable, userId: req.user!.id }));
    await audit(req, { action: 'create', entityType: 'gasto', entityId: r.gasto.id, after: { total: r.gasto.total, tipo: r.gasto.tipoGasto, proveedor: r.gasto.proveedorRazon, lineas: r.lineas, documento: r.documento?.id ?? null } });
    res.json({ gasto: r.gasto, documento: r.documento, detraccion: r.detraccion });
  } catch (e) {
    if (!responderErrorCompra(e, res)) return next(e); // D5 · Express 4 no atrapa el throw async: el request se cuelga sin next
  }
});

// GET /movimientos?proyectoId=  (global)
router.get('/movimientos', async (req, res) => {
  const { proyectoId } = req.query as { proyectoId?: string };
  const list = await db.select().from(schema.movimientos).where(proyectoId ? eq(schema.movimientos.proyectoId, proyectoId) : undefined).orderBy(desc(schema.movimientos.fecha));
  const pm = await proyectoMap();
  // los anulados se listan (historial) pero NO cuentan en los totales
  const vivos = list.filter((m) => !m.anulado);
  const ingresos = vivos.filter((m) => m.tipoMovimiento === 'Ingreso').reduce((s, m) => s + Number(m.monto), 0);
  const egresos = vivos.filter((m) => m.tipoMovimiento === 'Egreso').reduce((s, m) => s + Number(m.monto), 0);
  res.json({ movimientos: list.map((m) => ({ ...m, proyectoCodigo: m.proyectoId ? pm.get(m.proyectoId)?.codigo ?? null : null })), stats: { count: list.length, ingresos, egresos, neto: ingresos - egresos } });
});
router.post('/movimientos', async (req, res) => {
  const parse = movSchemaG.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { proyectoId, aplicaciones, ...rest } = parse.data;
  // F2.1 · todo movimiento de caja sale/entra de una cuenta: sin cuentaId el motor 104x no puede
  // asentarlo (así nacieron los huérfanos de prorrateo del 2026-08). Obligatoria desde ahora.
  if (!rest.cuentaId) return res.status(400).json({ error: 'Cuenta de origen requerida: indica de qué cuenta sale o a cuál entra el dinero' });
  if (aplicaciones?.length) {
    const sumAp = aplicaciones.reduce((s, a) => s + a.monto, 0);
    if (sumAp > Number(rest.monto) + 0.005) return res.status(400).json({ error: `Lo aplicado (${sumAp.toFixed(2)}) excede el monto del movimiento (${Number(rest.monto).toFixed(2)})` });
  }
  { const mErr = validarMonedaTC(rest.moneda, rest.tipoCambio); if (mErr) return res.status(400).json({ error: mErr }); }
  { const cErr = await validarCuentaContable(rest.cuentaContable); if (cErr) return res.status(400).json({ error: cErr }); } // WS1
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

  // F2.2 · movimiento + aplicaciones en UNA transacción: el saldo del documento se deriva
  // de las aplicaciones activas (sub-mayor Fase 1). Sin aplicaciones explícitas, un pago
  // ligado a gasto/valo aplica solo contra su documento (fix: antes la CxP no bajaba).
  try {
    const { mov, aplicadas } = await db.transaction(async (tx) => {
      const [m] = await tx.insert(schema.movimientos).values({ proyectoId: proyectoId ?? null, ...base, userId: uid }).returning();
      let n = 0;
      if (aplicaciones?.length) {
        await aplicar(tx, {
          origenTipo: 'movimiento', origenId: m!.id, fecha: rest.fecha, userId: uid,
          aplicaciones, tipoEsperado: rest.tipoMovimiento === 'Egreso' ? 'cxp' : 'cxc', moneda: rest.moneda,
        });
        n = aplicaciones.length;
      } else if (rest.gastoId) {
        if (await aplicarPagoAOrigen(tx, { docOrigenTipo: 'gasto', docOrigenId: rest.gastoId, movimientoId: m!.id, monto: rest.monto, fecha: rest.fecha, userId: uid })) n = 1;
      } else if (rest.valorizacionId) {
        if (await aplicarPagoAOrigen(tx, { docOrigenTipo: 'valorizacion', docOrigenId: rest.valorizacionId, movimientoId: m!.id, monto: rest.monto, fecha: rest.fecha, userId: uid })) n = 1;
      }
      return { mov: m!, aplicadas: n };
    });
    await audit(req, { action: 'create', entityType: 'movimiento', entityId: mov.id, after: { monto: mov.monto, tipo: mov.tipoMovimiento, naturaleza: mov.naturalezaContable, cuentaId: mov.cuentaId, aplicadas } });
    res.json({ movimiento: mov, aplicadas });
  } catch (e) {
    if (e instanceof DocumentoError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// ─── F3.2 · Cajas y rendiciones por proyecto ─────────────────────
// La caja agrupa; el dinero vive en una cuenta tipo 'caja' (contable 1413 Entregas a rendir).
// Entrega = transferencia banco→caja · rendición = egresos desde la caja · cierre devuelve el saldo.

async function saldosDeCajas(cuentaIds: string[]) {
  if (!cuentaIds.length) return new Map<string, { entregado: number; rendido: number; docs: number }>();
  const movs = await db.select({ cuentaId: schema.movimientos.cuentaId, tipo: schema.movimientos.tipoMovimiento, monto: schema.movimientos.monto })
    .from(schema.movimientos)
    .where(and(inArray(schema.movimientos.cuentaId, cuentaIds), eq(schema.movimientos.anulado, false)));
  const m = new Map<string, { entregado: number; rendido: number; docs: number }>();
  for (const mv of movs) {
    const e = m.get(mv.cuentaId!) ?? { entregado: 0, rendido: 0, docs: 0 };
    if (mv.tipo === 'Ingreso') e.entregado += Number(mv.monto);
    else { e.rendido += Number(mv.monto); e.docs += 1; }
    m.set(mv.cuentaId!, e);
  }
  return m;
}

router.get('/cajas', async (_req, res) => {
  const list = await db.select().from(schema.cajas).orderBy(desc(schema.cajas.createdAt));
  const saldos = await saldosDeCajas(list.map((c) => c.cuentaId));
  const pm = await proyectoMap();
  res.json({
    cajas: list.map((c) => {
      const s = saldos.get(c.cuentaId) ?? { entregado: 0, rendido: 0, docs: 0 };
      return { ...c, proyectoCodigo: pm.get(c.proyectoId)?.codigo ?? null, ...s, saldo: Math.round((s.entregado - s.rendido) * 100) / 100 };
    }),
  });
});

const cajaSchema = z.object({
  proyectoId: z.string().uuid(),
  encargado: z.string().min(2).max(150),
  monto: z.number().positive(),
  cuentaOrigenId: z.string().uuid(), // banco del que sale la plata
  numOperacion: z.string().min(1).max(40), // cruza con el extracto (obligatorio, modelo Kelly)
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notas: z.string().optional().nullable(),
});

router.post('/cajas', async (req, res, next) => {
  const parse = cajaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  if (await bloqueoPeriodo(d.fecha, res)) return;
  const anio = d.fecha.slice(0, 4);
  try {
    const r = await db.transaction(async (tx) => {
      // correlativo CAJA-YYYY-NNN
      const prev = await tx.select({ codigo: schema.cajas.codigo }).from(schema.cajas).where(sql`${schema.cajas.codigo} LIKE ${`CAJA-${anio}-%`}`);
      const n = prev.reduce((m, x) => Math.max(m, Number(x.codigo.split('-')[2]) || 0), 0) + 1;
      const codigo = `CAJA-${anio}-${String(n).padStart(3, '0')}`;
      // cuenta tipo caja (contable 1413 · aparece en el selector de Bancos y en el motor 104x)
      const [cuenta] = await tx.insert(schema.cuentasBancarias).values({
        codigo, banco: 'CAJA', moneda: 'PEN', descripcion: `Caja ${d.encargado}`, cuentaContable: '1413', tipo: 'caja', activo: true,
      }).returning();
      const [caja] = await tx.insert(schema.cajas).values({
        empresaId: req.empresaId ?? 1, codigo, proyectoId: d.proyectoId, encargado: d.encargado,
        cuentaId: cuenta!.id, fechaApertura: d.fecha, notas: d.notas ?? null, userId: req.user!.id,
      }).returning();
      // entrega = transferencia banco→caja (2 filas ligadas · el motor asienta 1413/banco)
      const transferenciaId = randomUUID();
      const base = {
        fecha: d.fecha, moneda: 'PEN', monto: d.monto.toFixed(2), montoBase: d.monto.toFixed(2), tipoCambio: '1.0000',
        subtipo: 'Entrega a rendir', numOperacion: d.numOperacion, descripcion: `Entrega caja ${codigo} · ${d.encargado}`,
        proyectoId: d.proyectoId, transferenciaId, userId: req.user!.id,
      };
      await tx.insert(schema.movimientos).values([
        { ...base, tipoMovimiento: 'Egreso', cuentaId: d.cuentaOrigenId, cuentaDestinoId: cuenta!.id },
        { ...base, tipoMovimiento: 'Ingreso', cuentaId: cuenta!.id, cuentaDestinoId: d.cuentaOrigenId },
      ]);
      return { caja: caja!, cuenta: cuenta! };
    });
    await audit(req, { action: 'create', entityType: 'caja', entityId: r.caja.id, after: { codigo: r.caja.codigo, encargado: r.caja.encargado, monto: d.monto, numOperacion: d.numOperacion } });
    res.json(r);
  } catch (e) {
    next(e);
  }
});

// Cierre: si hay saldo, exige devolución (transferencia caja→banco con su N° de operación).
router.post('/cajas/:id/cerrar', async (req, res, next) => {
  const body = z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    devolucion: z.object({ cuentaDestinoId: z.string().uuid(), numOperacion: z.string().min(1).max(40) }).optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const [caja] = await db.select().from(schema.cajas).where(eq(schema.cajas.id, req.params.id!));
  if (!caja) return res.status(404).json({ error: 'Caja no encontrada' });
  if (caja.estado === 'cerrada') return res.status(400).json({ error: 'La caja ya está cerrada' });
  if (await bloqueoPeriodo(body.data.fecha, res)) return;
  const saldos = await saldosDeCajas([caja.cuentaId]);
  const s = saldos.get(caja.cuentaId) ?? { entregado: 0, rendido: 0, docs: 0 };
  const saldo = Math.round((s.entregado - s.rendido) * 100) / 100;
  if (saldo < -0.004) return res.status(400).json({ error: `La caja está sobregirada (${saldo.toFixed(2)}): registra la reposición antes de cerrar` });
  if (saldo > 0.004 && !body.data.devolucion) return res.status(400).json({ error: `Saldo por rendir ${saldo.toFixed(2)}: indica la devolución al banco (o regístralo como gasto) antes de cerrar` });
  try {
    await db.transaction(async (tx) => {
      if (saldo > 0.004 && body.data.devolucion) {
        const transferenciaId = randomUUID();
        const base = {
          fecha: body.data.fecha, moneda: 'PEN', monto: saldo.toFixed(2), montoBase: saldo.toFixed(2), tipoCambio: '1.0000',
          subtipo: 'Devolución de caja', numOperacion: body.data.devolucion.numOperacion,
          descripcion: `Devolución caja ${caja.codigo}`, proyectoId: caja.proyectoId, transferenciaId, userId: req.user!.id,
        };
        await tx.insert(schema.movimientos).values([
          { ...base, tipoMovimiento: 'Egreso', cuentaId: caja.cuentaId, cuentaDestinoId: body.data.devolucion.cuentaDestinoId },
          { ...base, tipoMovimiento: 'Ingreso', cuentaId: body.data.devolucion.cuentaDestinoId, cuentaDestinoId: caja.cuentaId },
        ]);
      }
      await tx.update(schema.cajas).set({ estado: 'cerrada', fechaCierre: body.data.fecha, updatedAt: new Date() }).where(eq(schema.cajas.id, caja.id));
      await tx.update(schema.cuentasBancarias).set({ activo: false }).where(eq(schema.cuentasBancarias.id, caja.cuentaId));
    });
    await audit(req, { action: 'update', entityType: 'caja', entityId: caja.id, after: { estado: 'cerrada', saldoDevuelto: saldo } });
    res.json({ ok: true, saldoDevuelto: saldo });
  } catch (e) {
    next(e);
  }
});

// F2.2 · GET /documentos-pendientes?tipo=cxp|cxc&q= · facturas con saldo, para "proveedor → jala facturas"
router.get('/documentos-pendientes', async (req, res) => {
  const { tipo, q } = req.query as { tipo?: string; q?: string };
  const d = schema.documentoPendiente;
  const conds = [inArray(d.estado, ['abierto', 'parcial'])];
  if (tipo === 'cxp' || tipo === 'cxc') conds.push(eq(d.tipo, tipo));
  const term = (q ?? '').trim().toLowerCase();
  if (term) {
    conds.push(sql`(lower(coalesce(${d.terceroRazon},'')) LIKE ${'%' + term + '%'} OR coalesce(${d.terceroRuc},'') LIKE ${term + '%'} OR lower(coalesce(${d.docSerie},'') || '-' || coalesce(${d.docNumero},'')) LIKE ${'%' + term + '%'})`);
  }
  const docs = await db.select().from(d).where(and(...conds)).orderBy(asc(d.terceroRazon), asc(d.fechaVenc)).limit(100);
  res.json({ documentos: docs });
});

// F3.1 · POST /ventas · venta standalone (contrato/adicional/directa) → CxC + detracción + 14.1 real
router.post('/ventas', async (req, res, next) => {
  const parse = ventaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  { const cErr = await validarCuentaContable(parse.data.cuentaContable); if (cErr) return res.status(400).json({ error: cErr }); }
  if (await bloqueoPeriodo(parse.data.fechaEmision, res)) return;
  try {
    const r = await db.transaction((tx) => registrarVenta(tx, { ...parse.data, userId: req.user!.id, empresaId: req.empresaId ?? 1 }));
    await audit(req, { action: 'create', entityType: 'venta', entityId: r.venta.id, after: { comprobante: `${r.venta.serie}-${r.venta.numero}`, cliente: r.venta.clienteRazon, total: r.venta.total, tipoCpe: r.venta.tipoCpe } });
    res.json(r);
  } catch (e) {
    if (e instanceof DocumentoError) return res.status(e.status).json({ error: e.message });
    if (e instanceof Error && /ventas_doc_uq|duplicate key/.test(e.message)) return res.status(409).json({ error: `El comprobante ${parse.data.serie}-${parse.data.numero} ya está registrado` });
    return next(e);
  }
});

// F2.1 · GET /ventas?proyectoId= · registro de ventas (valorizaciones con comprobante + standalone F3.1)
router.get('/ventas', async (req, res) => {
  const { proyectoId } = req.query as { proyectoId?: string };
  const rows = await db
    .select({
      id: schema.valorizaciones.id,
      numero: schema.valorizaciones.numero,
      proyectoId: schema.valorizaciones.proyectoId,
      proyectoCodigo: schema.proyectos.codigo,
      proyectoNombre: schema.proyectos.nombre,
      fechaEmision: schema.valorizaciones.fechaEmision,
      mesPeriodo: schema.valorizaciones.mesPeriodo,
      status: schema.valorizaciones.status,
      comprobanteTipo: schema.valorizaciones.comprobanteTipo,
      comprobanteSerie: schema.valorizaciones.comprobanteSerie,
      comprobanteNumero: schema.valorizaciones.comprobanteNumero,
      cuentaContable: schema.valorizaciones.cuentaContable,
      base: schema.valorizaciones.montoCd,
      igv: schema.valorizaciones.montoIgv,
      total: schema.valorizaciones.montoTotalConIgv,
      totalFallback: schema.valorizaciones.montoTotal,
      retencion: schema.valorizaciones.montoRetencion,
      amortizacion: schema.valorizaciones.montoAmortizaciones,
      totalContratista: schema.valorizaciones.totalContratista,
    })
    .from(schema.valorizaciones)
    .leftJoin(schema.proyectos, eq(schema.proyectos.id, schema.valorizaciones.proyectoId))
    .where(proyectoId ? eq(schema.valorizaciones.proyectoId, proyectoId) : undefined)
    .orderBy(desc(schema.valorizaciones.fechaEmision));
  const detr = rows.length
    ? await db.select({ origen: schema.detraccionDocumento.docOrigenId, monto: schema.detraccionDocumento.monto, estado: schema.detraccionDocumento.estado })
      .from(schema.detraccionDocumento)
      .where(and(eq(schema.detraccionDocumento.docOrigenTipo, 'valorizacion'), inArray(schema.detraccionDocumento.docOrigenId, rows.map((r) => r.id))))
    : [];
  const dPorValo = new Map(detr.map((d) => [d.origen, d]));
  const deValos = rows.map((r) => {
    const total = Number(r.total ?? r.totalFallback);
    const d = dPorValo.get(r.id);
    return {
      ...r,
      total,
      detraccion: d ? Number(d.monto) : null,
      detraccionEstado: d?.estado ?? null,
      cobrada: r.status === 'cobrada',
      fuente: 'valo' as const,
    };
  });

  // F3.1 · ventas standalone: mismo shape que las de valorización · estado de cobro desde el sub-mayor
  const pm2 = await proyectoMap();
  const standalone = await db.select().from(schema.ventas)
    .where(proyectoId && proyectoId !== 'todos' ? eq(schema.ventas.proyectoId, proyectoId) : undefined)
    .orderBy(desc(schema.ventas.fechaEmision));
  const [detrV, docsV] = await Promise.all([
    standalone.length
      ? db.select({ origen: schema.detraccionDocumento.docOrigenId, monto: schema.detraccionDocumento.monto, montoDeclarado: schema.detraccionDocumento.montoDeclarado, estado: schema.detraccionDocumento.estado })
        .from(schema.detraccionDocumento)
        .where(and(eq(schema.detraccionDocumento.docOrigenTipo, 'venta'), inArray(schema.detraccionDocumento.docOrigenId, standalone.map((v) => v.id))))
      : [],
    standalone.length
      ? db.select({ origen: schema.documentoPendiente.docOrigenId, estado: schema.documentoPendiente.estado, saldo: schema.documentoPendiente.saldoPendiente })
        .from(schema.documentoPendiente)
        .where(and(eq(schema.documentoPendiente.docOrigenTipo, 'venta'), inArray(schema.documentoPendiente.docOrigenId, standalone.map((v) => v.id))))
      : [],
  ]);
  const dPorVenta = new Map(detrV.map((d) => [d.origen, d]));
  const docPorVenta = new Map(docsV.map((d) => [d.origen, d]));
  const deStandalone = standalone.map((v) => {
    const d = dPorVenta.get(v.id);
    const doc = docPorVenta.get(v.id);
    const esNc = v.tipoCpe === '07';
    return {
      id: v.id,
      numero: 0,
      proyectoId: v.proyectoId,
      proyectoCodigo: v.proyectoId ? pm2.get(v.proyectoId)?.codigo ?? null : null,
      proyectoNombre: v.clienteRazon, // en standalone el "quién" es el cliente, no la obra
      fechaEmision: v.fechaEmision,
      mesPeriodo: String(v.fechaEmision).slice(0, 7),
      status: esNc ? 'nota_credito' : doc?.estado === 'cancelado' ? 'cobrada' : doc?.estado === 'parcial' ? 'parcial' : 'facturada',
      comprobanteTipo: v.tipoCpe,
      comprobanteSerie: v.serie,
      comprobanteNumero: v.numero,
      cuentaContable: v.cuentaContable,
      base: v.base,
      igv: v.igv,
      total: Number(v.total) * (esNc ? -1 : 1),
      totalFallback: v.total,
      retencion: v.retencionIgv,
      amortizacion: null as string | null,
      totalContratista: null as string | null,
      // el monto DECLARADO en el comprobante manda (es lo que el cliente deposita);
      // el calculado con la tabla vigente queda en la detracción como contraste
      detraccion: d ? Number(d.montoDeclarado ?? d.monto) : null,
      detraccionEstado: d?.estado ?? null,
      cobrada: doc?.estado === 'cancelado',
      fuente: 'venta' as const,
    };
  });

  const ventas = [...deValos, ...deStandalone].sort((a, b) => String(b.fechaEmision).localeCompare(String(a.fechaEmision)));
  const stats = {
    count: ventas.length,
    total: ventas.reduce((s, v) => s + v.total, 0),
    porCobrar: ventas.filter((v) => !v.cobrada && v.total > 0).reduce((s, v) => s + v.total - Number(v.retencion ?? 0), 0),
    retencion: ventas.reduce((s, v) => s + Number(v.retencion ?? 0), 0),
    detraccion: ventas.reduce((s, v) => s + Number(v.detraccion ?? 0), 0),
  };
  res.json({ ventas, stats });
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
    // fix: los movimientos ANULADOS no cuentan en KPIs ni tesorería (la anulación H1 no llegaba a los agregados)
    db.select({ fecha: schema.movimientos.fecha, tipo: schema.movimientos.tipoMovimiento, monto: schema.movimientos.monto }).from(schema.movimientos).where(and(eq(schema.movimientos.anulado, false), pFilter ? eq(schema.movimientos.proyectoId, pFilter) : undefined)),
    db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.activo, true)),
    db.select({ cuentaId: schema.movimientos.cuentaId, tipo: schema.movimientos.tipoMovimiento, total: sql<number>`coalesce(sum(${schema.movimientos.monto}),0)::float8`, n: sql<number>`count(*)::int` }).from(schema.movimientos).where(eq(schema.movimientos.anulado, false)).groupBy(schema.movimientos.cuentaId, schema.movimientos.tipoMovimiento),
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

  // ── Resumen v2 · inbox de acción + proyección de caja + aging + utilidad por proyecto ──
  // Empresa-wide (como tesorería): las decisiones del día no se filtran por obra.
  const hoy = new Date().toISOString().slice(0, 10);
  const dp = schema.documentoPendiente;
  const VALO_DEV = ['aprobada', 'conformidad_supervision', 'facturada', 'cobrada'];
  const [docsAbiertos, detrPend, valosSinCpe, bandejaN, concilN, gastadoPorObra] = await Promise.all([
    db.select({ tipo: dp.tipo, saldo: dp.saldoPendiente, fechaVenc: dp.fechaVenc, terceroRazon: dp.terceroRazon, docSerie: dp.docSerie, docNumero: dp.docNumero })
      .from(dp).where(inArray(dp.estado, ['abierto', 'parcial'])),
    db.select({ monto: schema.detraccionDocumento.monto, docOrigenId: schema.detraccionDocumento.docOrigenId })
      .from(schema.detraccionDocumento).where(eq(schema.detraccionDocumento.estado, 'pendiente')),
    db.select({ id: schema.valorizaciones.id, numero: schema.valorizaciones.numero, proyectoId: schema.valorizaciones.proyectoId })
      .from(schema.valorizaciones)
      .where(and(inArray(schema.valorizaciones.status, VALO_DEV), isNull(schema.valorizaciones.comprobanteSerie))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.cpeBandeja).where(eq(schema.cpeBandeja.estado, 'pendiente')),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.extractoLineas).where(eq(schema.extractoLineas.estado, 'pendiente')),
    db.select({ proyectoId: schema.gastos.proyectoId, gastado: sql<number>`coalesce(sum(${schema.gastos.subtotal}),0)::float8` })
      .from(schema.gastos).where(sql`${schema.gastos.proyectoId} IS NOT NULL`).groupBy(schema.gastos.proyectoId),
  ]);
  // F3.2 · cajas abiertas con saldo por rendir → inbox
  const cajasAbiertas = await db.select().from(schema.cajas).where(eq(schema.cajas.estado, 'abierta'));
  const saldosCajas = await saldosDeCajas(cajasAbiertas.map((c) => c.cuentaId));
  const porRendir = cajasAbiertas
    .map((c) => { const s = saldosCajas.get(c.cuentaId) ?? { entregado: 0, rendido: 0, docs: 0 }; return { codigo: c.codigo, encargado: c.encargado, saldo: Math.round((s.entregado - s.rendido) * 100) / 100 }; })
    .filter((c) => c.saldo > 0.004);
  const sumBy = (rows: typeof docsAbiertos, f: (r: (typeof docsAbiertos)[number]) => boolean) =>
    rows.filter(f).reduce((s, r) => s + Number(r.saldo), 0);
  const enDias = (venc: string | null, d: number) => venc != null && venc <= new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const vencida = (venc: string | null) => venc != null && venc < hoy;
  const bucket = (tipo: 'cxp' | 'cxc') => {
    const rows = docsAbiertos.filter((r) => r.tipo === tipo);
    const corriente = sumBy(rows, (r) => !vencida(r.fechaVenc));
    const v30 = sumBy(rows, (r) => vencida(r.fechaVenc) && enDias(r.fechaVenc, -0) && !((r.fechaVenc ?? '') < new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)));
    const mas30 = sumBy(rows, (r) => (r.fechaVenc ?? '') < new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) && r.fechaVenc != null);
    return { corriente, v30, mas30, total: corriente + v30 + mas30 };
  };
  const cxpPorVencer7 = docsAbiertos.filter((r) => r.tipo === 'cxp' && !vencida(r.fechaVenc) && enDias(r.fechaVenc, 7));
  const resumenV2 = {
    accion: {
      detraccionesPendientes: { n: detrPend.length, monto: detrPend.reduce((s, x) => s + Number(x.monto), 0) },
      cxpPorVencer7: {
        n: cxpPorVencer7.length,
        monto: cxpPorVencer7.reduce((s, r) => s + Number(r.saldo), 0),
        items: cxpPorVencer7.slice(0, 3).map((r) => ({ tercero: r.terceroRazon, doc: [r.docSerie, r.docNumero].filter(Boolean).join('-'), saldo: Number(r.saldo), vence: r.fechaVenc })),
      },
      valosSinComprobante: { n: valosSinCpe.length, items: valosSinCpe.slice(0, 4).map((v) => ({ numero: v.numero, proyectoCodigo: codigoOf(v.proyectoId) })) },
      bandejaCpe: bandejaN[0]?.n ?? 0,
      conciliacionPendiente: concilN[0]?.n ?? 0,
      cajasPorRendir: { n: porRendir.length, monto: porRendir.reduce((s, c) => s + c.saldo, 0), items: porRendir.slice(0, 3) },
    },
    proyeccion: {
      hoy: 0 as number, // se completa abajo con totalCaja
      d30: { cobros: sumBy(docsAbiertos, (r) => r.tipo === 'cxc' && enDias(r.fechaVenc, 30)), pagos: sumBy(docsAbiertos, (r) => r.tipo === 'cxp' && enDias(r.fechaVenc, 30)) },
      d60: { cobros: sumBy(docsAbiertos, (r) => r.tipo === 'cxc' && enDias(r.fechaVenc, 60)), pagos: sumBy(docsAbiertos, (r) => r.tipo === 'cxp' && enDias(r.fechaVenc, 60)) },
    },
    aging: { cxc: bucket('cxc'), cxp: bucket('cxp') },
    utilidadPorProyecto: valos.length || gastadoPorObra.length
      ? [...new Set([...valos.map((v) => v.proyectoId), ...gastadoPorObra.map((g) => g.proyectoId!)])].map((pid) => {
          const valorizado = valos.filter((v) => v.proyectoId === pid && VALO_DEV.includes(v.status)).reduce((s, v) => s + Number(v.montoCd), 0);
          const gastado = Number(gastadoPorObra.find((g) => g.proyectoId === pid)?.gastado ?? 0);
          return { proyectoId: pid, proyectoCodigo: codigoOf(pid), proyectoNombre: nombreOf(pid), valorizado, gastado, margenPct: valorizado > 0 ? (valorizado - gastado) / valorizado : null };
        }).filter((x) => x.valorizado > 0 || x.gastado > 0).sort((a, b) => b.valorizado - a.valorizado).slice(0, 5)
      : [],
  };

  res.json({
    mesActual,
    gastosOficina,
    resumenV2: { ...resumenV2, proyeccion: { ...resumenV2.proyeccion, hoy: totalCaja } },
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
  const cuentas = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.activo, true));
  const movs = await db.select({ cuentaId: schema.movimientos.cuentaId, tipo: schema.movimientos.tipoMovimiento, monto: schema.movimientos.monto }).from(schema.movimientos).where(eq(schema.movimientos.anulado, false));
  const saldos = cuentas.map((c) => {
    const ms = movs.filter((m) => m.cuentaId === c.id);
    const ingresos = ms.filter((m) => m.tipo === 'Ingreso').reduce((s, m) => s + Number(m.monto), 0);
    const egresos = ms.filter((m) => m.tipo === 'Egreso').reduce((s, m) => s + Number(m.monto), 0);
    return { cuenta: c, ingresos, egresos, saldo: ingresos - egresos, movimientos: ms.length };
  });
  res.json({ saldos, totalSaldo: saldos.reduce((s, x) => s + x.saldo, 0) });
});

export default router;
