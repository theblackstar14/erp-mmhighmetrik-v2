/**
 * Fase 1 · sub-mayor CxP/CxC (modelo WS0): documento_pendiente + aplicacion_documento.
 * El saldo SIEMPRE se deriva de las aplicaciones activas; nunca se resta a ciegas.
 * Las funciones reciben db o una tx para componerse dentro de la transacción de la ruta.
 */
import { schema } from '@erp/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';

export type DbLike = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;
type Gasto = typeof schema.gastos.$inferSelect;
type Documento = typeof schema.documentoPendiente.$inferSelect;

export class DocumentoError extends Error {
  constructor(public status: 400 | 404 | 409, mensaje: string) {
    super(mensaje);
    this.name = 'DocumentoError';
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ref = (d: Pick<Documento, 'docSerie' | 'docNumero'>) => [d.docSerie, d.docNumero].filter(Boolean).join('-') || 's/n';

export const esNotaCredito = (tipoComprobante: string | null | undefined) => /^(07|nota de cr)/i.test((tipoComprobante ?? '').trim());

export async function refrescarDocumento(q: DbLike, documentoId: string): Promise<Documento> {
  const d = schema.documentoPendiente, a = schema.aplicacionDocumento;
  const [doc] = await q.select().from(d).where(eq(d.id, documentoId)).limit(1);
  if (!doc) throw new DocumentoError(404, `Documento pendiente ${documentoId} no existe`);
  const [agg] = await q.select({ aplicado: sql<string>`coalesce(sum(${a.montoAplicado}), 0)` }).from(a)
    .where(and(eq(a.documentoPendienteId, documentoId), eq(a.estado, 'activa')));
  const original = Number(doc.montoOriginal);
  const saldo = Math.max(0, r2(original - Number(agg?.aplicado ?? 0)));
  const estado = saldo <= 0.004 ? 'cancelado' : saldo < original - 0.004 ? 'parcial' : 'abierto';
  const [upd] = await q.update(d).set({ saldoPendiente: saldo.toFixed(2), estado, updatedAt: new Date() }).where(eq(d.id, documentoId)).returning();
  return upd!;
}

/** Cuenta por pagar de una compra. null si es nota de crédito, rendición o total ≤ 0. Idempotente por compra. */
export async function crearDocumentoDesdeGasto(q: DbLike, gasto: Gasto, empresaId = 1): Promise<Documento | null> {
  if (esNotaCredito(gasto.tipoComprobante) || gasto.tipoRegistro === 'Rendición' || Number(gasto.total) <= 0) return null;
  const d = schema.documentoPendiente;
  const [propio] = await q.select().from(d).where(and(eq(d.docOrigenTipo, 'gasto'), eq(d.docOrigenId, gasto.id))).limit(1);
  if (propio) return propio;
  if (gasto.proveedorRuc && gasto.serie && gasto.numero) {
    const [dup] = await q.select({ id: d.id }).from(d)
      .where(and(eq(d.empresaId, empresaId), eq(d.tipo, 'cxp'), eq(d.terceroRuc, gasto.proveedorRuc), eq(d.docSerie, gasto.serie), eq(d.docNumero, gasto.numero))).limit(1);
    if (dup) throw new DocumentoError(409, `La factura ${gasto.serie}-${gasto.numero} de ${gasto.proveedorRuc} ya está registrada`);
  }
  const tc = gasto.moneda === 'PEN' ? 1 : Number(gasto.tipoCambio ?? 0);
  if (!(tc > 0)) throw new DocumentoError(400, `Moneda ${gasto.moneda} requiere tipo de cambio para registrar la cuenta por pagar`);
  const total = Number(gasto.total);
  const [doc] = await q.insert(d).values({
    empresaId, tipo: 'cxp', cuentaControl: '4212',
    terceroRuc: gasto.proveedorRuc, terceroRazon: gasto.proveedorRazon,
    docTipo: gasto.tipoComprobante, docSerie: gasto.serie, docNumero: gasto.numero,
    fechaEmision: gasto.fecha, fechaVenc: gasto.fechaVencimiento ?? gasto.fecha,
    moneda: gasto.moneda, tipoCambio: gasto.moneda === 'PEN' ? null : tc.toFixed(4),
    montoOriginal: total.toFixed(2), montoPen: (total * tc).toFixed(2), saldoPendiente: total.toFixed(2),
    estado: 'abierto', obraId: gasto.proyectoId, docOrigenTipo: 'gasto', docOrigenId: gasto.id,
  }).returning();
  return doc!;
}

export type AplicacionIn = { documentoPendienteId: string; monto: number };

/** Registra aplicaciones de un pago/cobro (o nota) contra documentos. Valida saldo, tipo y moneda. */
export async function aplicar(q: DbLike, o: { origenTipo: 'movimiento' | 'nota'; origenId: string; fecha: string; userId?: string | null; aplicaciones: AplicacionIn[]; tipoEsperado?: 'cxp' | 'cxc'; moneda?: string }) {
  const porDoc = new Map<string, number>();
  for (const ap of o.aplicaciones) {
    if (!(ap.monto > 0)) throw new DocumentoError(400, 'Cada aplicación debe tener monto > 0');
    porDoc.set(ap.documentoPendienteId, r2((porDoc.get(ap.documentoPendienteId) ?? 0) + ap.monto));
  }
  const ids = [...porDoc.keys()];
  if (!ids.length) return;
  const docs = await q.select().from(schema.documentoPendiente).where(inArray(schema.documentoPendiente.id, ids)).for('update'); // D12 · lock de fila: 2 pagos concurrentes no pasan ambos
  for (const id of ids) {
    const doc = docs.find((x) => x.id === id);
    if (!doc) throw new DocumentoError(404, `Documento pendiente ${id} no existe`);
    if (o.tipoEsperado && doc.tipo !== o.tipoEsperado) throw new DocumentoError(400, `El documento ${ref(doc)} es ${doc.tipo}, se esperaba ${o.tipoEsperado}`);
    if (o.moneda && doc.moneda !== o.moneda) throw new DocumentoError(400, `El documento ${ref(doc)} está en ${doc.moneda}; el pago está en ${o.moneda}`);
    const actual = await refrescarDocumento(q, id);
    const monto = porDoc.get(id)!;
    if (monto > Number(actual.saldoPendiente) + 0.005) throw new DocumentoError(400, `La aplicación ${monto.toFixed(2)} excede el saldo ${actual.saldoPendiente} de ${ref(doc)}`);
    await q.insert(schema.aplicacionDocumento).values({
      documentoPendienteId: id, montoAplicado: monto.toFixed(2), moneda: doc.moneda, tipoCambio: doc.tipoCambio,
      fecha: o.fecha, estado: 'activa', createdBy: o.userId ?? null,
      origenTipo: o.origenTipo, origenId: o.origenId, origenRef: `${o.origenTipo}:${o.origenId}`,
    });
    await refrescarDocumento(q, id);
  }
}

/** Anula las aplicaciones activas de un origen (pago anulado) y recompone los saldos. */
export async function anularAplicacionesDe(q: DbLike, origenTipo: 'movimiento' | 'nota', origenId: string) {
  const a = schema.aplicacionDocumento;
  const filas = await q.update(a).set({ estado: 'anulada' })
    .where(and(eq(a.origenTipo, origenTipo), eq(a.origenId, origenId), eq(a.estado, 'activa')))
    .returning({ doc: a.documentoPendienteId });
  for (const id of new Set(filas.map((f) => f.doc))) await refrescarDocumento(q, id);
  return filas.length;
}

/** Pago ligado a un documento de origen (gastoId / valorizacionId): aplica hasta el saldo. null si no hay documento o saldo. */
export async function aplicarPagoAOrigen(q: DbLike, o: { docOrigenTipo: 'gasto' | 'valorizacion'; docOrigenId: string; movimientoId: string; monto: number; fecha: string; userId?: string | null }) {
  const d = schema.documentoPendiente;
  const [doc] = await q.select().from(d).where(and(eq(d.docOrigenTipo, o.docOrigenTipo), eq(d.docOrigenId, o.docOrigenId))).limit(1).for('update'); // D12
  if (!doc) return null;
  const actual = await refrescarDocumento(q, doc.id);
  const aplicable = r2(Math.min(o.monto, Number(actual.saldoPendiente)));
  if (aplicable <= 0.004) return null;
  await aplicar(q, { origenTipo: 'movimiento', origenId: o.movimientoId, fecha: o.fecha, userId: o.userId, aplicaciones: [{ documentoPendienteId: doc.id, monto: aplicable }] });
  return doc.id;
}
