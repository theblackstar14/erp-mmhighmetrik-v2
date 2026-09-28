/**
 * Fase 1 · registrar una compra completa en una transacción: gasto + líneas (opcionales) + cuenta por pagar
 * (o aplicación de nota de crédito) + detracción calculada + inventario por línea.
 * Sin líneas se comporta como antes (una línea implícita con los totales de cabecera).
 */
import { schema } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { calcularDetraccion } from './detraccionCalc.js';
import { buscarTasaDetraccion } from './detraccionTasa.js';
import { buscarTipoCambio } from './tipoCambio.js';
import { type DbLike, DocumentoError, aplicar, crearDocumentoDesdeGasto, esNotaCredito, refrescarDocumento } from './documentosPendientes.js';

const IGV = 0.18;
const r2 = (n: number) => Math.round(n * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const lineaCompraSchema = z.object({
  descripcion: z.string().min(1),
  unidad: z.string().max(10).optional().nullable(),
  cantidad: z.number().positive(),
  valorUnitario: z.number().min(0),
  descuento: z.number().min(0).default(0),
  afectacionIgv: z.string().regex(/^\d{2}$/).default('10'), // catálogo SUNAT 07 · 1x gravado
  cuentaContable: z.string().max(10).optional().nullable(),
  partidaId: z.string().uuid().optional().nullable(),
  proyectoId: z.string().uuid().optional().nullable(),
  aInventario: z.boolean().default(false),
});
export type LineaCompraIn = z.infer<typeof lineaCompraSchema>;

export const extrasCompraSchema = z.object({
  fechaVencimiento: z.string().regex(FECHA).optional().nullable(),
  tipoCambio: z.number().positive().optional().nullable(),
  lineas: z.array(lineaCompraSchema).max(200).optional(),
  detraccion: z.object({ codigo: z.string().regex(/^\d{3}$/), montoDeclarado: z.number().min(0).optional().nullable() }).optional().nullable(),
  retencion: z.object({ tipo: z.enum(['igv3', 'renta4ta']), monto: z.number().positive() }).optional().nullable(),
  percepcion: z.number().min(0).optional().nullable(),
  docModifica: z.object({ serie: z.string().min(1), numero: z.string().min(1) }).optional().nullable(),
  motivoNota: z.string().regex(/^\d{2}$/).optional().nullable(),
});
export type ExtrasCompra = z.infer<typeof extrasCompraSchema>;

export function calcularLineas(lineas: LineaCompraIn[]) {
  return lineas.map((l, i) => {
    const valorVenta = r2(l.cantidad * l.valorUnitario - l.descuento);
    if (valorVenta < 0) throw new DocumentoError(400, `Línea ${i + 1}: el descuento supera el importe`);
    const gravada = l.afectacionIgv.startsWith('1');
    return { ...l, numero: i + 1, valorVenta, igv: gravada ? r2(valorVenta * IGV) : 0, gravada };
  });
}

export async function registrarCompra(q: DbLike, input: { values: typeof schema.gastos.$inferInsert; extras: ExtrasCompra; inventariable?: boolean; userId?: string | null; empresaId?: number }) {
  const { extras } = input;
  const empresaId = input.empresaId ?? 1;
  const values = { ...input.values };
  const moneda = values.moneda ?? 'PEN';
  const esNota = esNotaCredito(values.tipoComprobante);

  let tc: number | null = null;
  if (moneda !== 'PEN') {
    tc = extras.tipoCambio ?? (await buscarTipoCambio(values.fecha, moneda))?.venta ?? null;
    if (!tc) throw new DocumentoError(400, `Falta tipo de cambio ${moneda} del ${values.fecha}: cárgalo en Catálogos o envía tipoCambio`);
  }

  const lineas = extras.lineas?.length ? calcularLineas(extras.lineas) : [];
  if (lineas.length) {
    const subtotal = r2(lineas.filter((l) => l.gravada).reduce((s, l) => s + l.valorVenta, 0));
    const exonerado = r2(lineas.filter((l) => !l.gravada).reduce((s, l) => s + l.valorVenta, 0));
    const igv = r2(lineas.reduce((s, l) => s + l.igv, 0));
    Object.assign(values, { subtotal: subtotal.toFixed(2), exonerado: exonerado.toFixed(2), igv: igv.toFixed(2), total: r2(subtotal + exonerado + igv).toFixed(2) });
  }

  // F3.5 · duplicados: los cubre crearDocumentoDesdeGasto (409 por RUC+serie+número al crear la CxP).
  // ponytail: un prorrateo con el MISMO comprobante en varias filas también choca ahí — repartirlo
  // por gasto_lineas (una compra, N obras) cuando duela.
  if (extras.retencion?.tipo === 'igv3') {
    const [emp] = await q.select({ config: schema.empresas.config }).from(schema.empresas).where(eq(schema.empresas.id, empresaId)).limit(1);
    if ((emp?.config as Record<string, unknown> | null)?.agenteRetencion !== true) throw new DocumentoError(400, 'La empresa no está configurada como agente de retención del IGV');
  }
  if (esNota && !extras.docModifica) throw new DocumentoError(400, 'La nota de crédito debe indicar la factura que modifica (serie y número)');

  const [gasto] = await q.insert(schema.gastos).values({
    ...values,
    fechaVencimiento: extras.fechaVencimiento ?? null,
    tipoCambio: tc != null ? tc.toFixed(4) : null,
    retencion: (extras.retencion?.monto ?? 0).toFixed(2),
    retencionTipo: extras.retencion?.tipo ?? null,
    percepcion: (extras.percepcion ?? 0).toFixed(2),
    docModificaSerie: extras.docModifica?.serie ?? null,
    docModificaNumero: extras.docModifica?.numero ?? null,
    motivoNota: extras.motivoNota ?? null,
  }).returning();
  const g = gasto!;

  if (lineas.length) {
    await q.insert(schema.gastoLineas).values(lineas.map((l) => ({
      gastoId: g.id, numero: l.numero, descripcion: l.descripcion, unidad: l.unidad ?? null,
      cantidad: String(l.cantidad), valorUnitario: String(l.valorUnitario), descuento: l.descuento.toFixed(2),
      valorVenta: l.valorVenta.toFixed(2), afectacionIgv: l.afectacionIgv, igv: l.igv.toFixed(2),
      cuentaContable: l.cuentaContable ?? null, partidaId: l.partidaId ?? null, proyectoId: l.proyectoId ?? null, aInventario: l.aInventario,
    })));
  }

  let documento: typeof schema.documentoPendiente.$inferSelect | null = null;
  if (esNota) {
    const d = schema.documentoPendiente;
    const { serie, numero } = extras.docModifica!;
    const [orig] = await q.select().from(d)
      .where(and(eq(d.empresaId, empresaId), eq(d.tipo, 'cxp'), eq(d.terceroRuc, g.proveedorRuc ?? ''), eq(d.docSerie, serie), eq(d.docNumero, numero))).limit(1);
    if (!orig) throw new DocumentoError(404, `No existe la factura ${serie}-${numero} de ${g.proveedorRuc ?? 's/RUC'} para aplicar la nota de crédito`);
    await aplicar(q, { origenTipo: 'nota', origenId: g.id, fecha: g.fecha, userId: input.userId, aplicaciones: [{ documentoPendienteId: orig.id, monto: Number(g.total) }], tipoEsperado: 'cxp', moneda: g.moneda });
  } else {
    documento = await crearDocumentoDesdeGasto(q, g, empresaId);
    // Fase 1 · la retención se entera a SUNAT, no al proveedor: reduce la CxP; su asiento (4017x) llega en Fase 2
    if (documento && extras.retencion?.monto && extras.retencion.monto > 0) {
      await aplicar(q, { origenTipo: 'nota', origenId: g.id, fecha: g.fecha, userId: input.userId, aplicaciones: [{ documentoPendienteId: documento.id, monto: extras.retencion.monto }], tipoEsperado: 'cxp', moneda: g.moneda });
      documento = await refrescarDocumento(q, documento.id);
    }
  }

  let detraccion: typeof schema.detraccionDocumento.$inferSelect | null = null;
  if (extras.detraccion && !esNota) {
    const tasa = await buscarTasaDetraccion(extras.detraccion.codigo, g.fecha);
    if (!tasa) throw new DocumentoError(400, `Código de detracción ${extras.detraccion.codigo} no vigente o sin % al ${g.fecha}`);
    const calc = calcularDetraccion({ total: Number(g.total), moneda: g.moneda, tipoCambio: tc, tasa });
    const declarado = extras.detraccion.montoDeclarado;
    // D2 · noUncheckedIndexedAccess: returning()[0] es `X | undefined`, no se puede asignar por destructuring a `X | null`
    detraccion = (await q.insert(schema.detraccionDocumento).values({
      docOrigenTipo: 'gasto', docOrigenId: g.id, empresaId, codigo: tasa.codigo, porcentaje: tasa.porcentaje.toFixed(2),
      basePen: calc.basePen.toFixed(2), monto: calc.monto.toFixed(2), montoDeclarado: declarado != null ? declarado.toFixed(2) : null,
      estado: calc.aplica ? 'pendiente' : 'no_aplica',
    }).returning())[0] ?? null;
  }

  // Fase 1 fix1 · una NC no compra nada: no crea items de inventario (ni por línea ni el draft legado)
  if (!esNota) {
    const aInventario = lineas.filter((l) => l.aInventario);
    const comun = { fecha: g.fecha, proveedorRuc: g.proveedorRuc, proveedorRazon: g.proveedorRazon, tipoComprobante: g.tipoComprobante, serie: g.serie, numero: g.numero, categoria: g.tipoGasto, estado: 'Por completar', gastoId: g.id };
    if (aInventario.length) {
      await q.insert(schema.inventarioItems).values(aInventario.map((l) => ({ ...comun, proyectoId: l.proyectoId ?? g.proyectoId ?? null, cantidad: String(l.cantidad), descripcionItem: l.descripcion, valorUnitario: String(l.valorUnitario) })));
    } else if (input.inventariable) {
      // sin líneas: borrador único como antes (el usuario completa cantidad/código en Inventario)
      await q.insert(schema.inventarioItems).values({ ...comun, proyectoId: g.proyectoId ?? null, cantidad: '1', descripcionItem: g.descripcionItem ?? g.tipoGasto ?? 'Ítem', valorUnitario: g.total ?? '0' });
    }
  }

  return { gasto: g, lineas: lineas.length, documento, detraccion };
}
