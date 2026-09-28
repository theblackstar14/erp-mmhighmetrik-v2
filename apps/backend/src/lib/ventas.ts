/**
 * F3.1 · registrar una venta standalone en una transacción: venta + CxC (documento_pendiente)
 * + detracción calculada + aplicación de NC contra la factura original.
 * La retención IGV 3% (cliente agente) se guarda como dato del documento: se cobra vía
 * movimiento con cuenta manual 40114 aplicado al mismo doc (el sub-mayor F2.2 ya lo soporta).
 */
import { schema } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { calcularDetraccion } from './detraccionCalc.js';
import { buscarTasaDetraccion } from './detraccionTasa.js';
import { type DbLike, DocumentoError, aplicar, refrescarDocumento } from './documentosPendientes.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n: number) => Math.round(n * 100) / 100;

export const ventaSchema = z.object({
  proyectoId: z.string().uuid().optional().nullable(),
  clienteRuc: z.string().max(15).optional().nullable(),
  clienteRazon: z.string().max(300).optional().nullable(),
  tipoCpe: z.enum(['01', '03', '07', '08']).default('01'),
  serie: z.string().min(1).max(10),
  numero: z.string().min(1).max(20),
  fechaEmision: z.string().regex(FECHA),
  fechaVencimiento: z.string().regex(FECHA).optional().nullable(),
  moneda: z.string().default('PEN'),
  tipoCambio: z.number().positive().optional().nullable(),
  base: z.number().min(0),
  igv: z.number().min(0).default(0),
  total: z.number().positive(),
  cuentaContable: z.string().max(10).optional().nullable(),
  cuentaContableOrigen: z.enum(['USUARIO', 'SUGERIDO']).optional().nullable(),
  origenTipo: z.enum(['directa', 'contrato', 'valorizacion']).default('directa'),
  numContrato: z.string().max(50).optional().nullable(),
  formaPago: z.enum(['Contado', 'Credito']).default('Contado'),
  cuotas: z.array(z.object({ monto: z.number().positive(), vence: z.string().regex(FECHA).nullable() })).optional().nullable(),
  retencionIgv: z.number().min(0).default(0),
  comprobanteRetencion: z.string().max(30).optional().nullable(),
  detraccion: z.object({ codigo: z.string().regex(/^\d{3}$/), montoDeclarado: z.number().min(0).optional().nullable() }).optional().nullable(),
  docModifica: z.object({ serie: z.string().min(1), numero: z.string().min(1) }).optional().nullable(),
  motivoNota: z.string().regex(/^\d{2}$/).optional().nullable(),
  lineas: z.array(z.object({ descripcion: z.string().min(1), cantidad: z.number().positive().default(1), unidad: z.string().max(10).optional().nullable(), valorVenta: z.number().min(0), igv: z.number().min(0).default(0) })).max(200).optional().nullable(),
  descripcion: z.string().optional().nullable(),
});
export type VentaIn = z.infer<typeof ventaSchema>;

const esNC = (tipo: string) => tipo === '07';

export async function registrarVenta(q: DbLike, input: VentaIn & { userId?: string | null; empresaId?: number }) {
  const empresaId = input.empresaId ?? 1;
  const nota = esNC(input.tipoCpe);
  const tc = input.moneda === 'PEN' ? 1 : Number(input.tipoCambio ?? 0);
  if (!(tc > 0)) throw new DocumentoError(400, `Moneda ${input.moneda} requiere tipo de cambio`);

  const [venta] = await q.insert(schema.ventas).values({
    empresaId,
    proyectoId: input.proyectoId ?? null,
    clienteRuc: input.clienteRuc ?? null,
    clienteRazon: input.clienteRazon ?? null,
    tipoCpe: input.tipoCpe, serie: input.serie, numero: input.numero,
    fechaEmision: input.fechaEmision, fechaVencimiento: input.fechaVencimiento ?? null,
    moneda: input.moneda, tipoCambio: input.moneda === 'PEN' ? null : tc.toFixed(4),
    base: input.base.toFixed(2), igv: input.igv.toFixed(2), total: input.total.toFixed(2),
    cuentaContable: input.cuentaContable ?? null,
    cuentaContableOrigen: input.cuentaContable ? (input.cuentaContableOrigen ?? 'USUARIO') : null,
    origenTipo: input.origenTipo, numContrato: input.numContrato ?? null,
    formaPago: input.formaPago, cuotas: input.cuotas ?? null,
    retencionIgv: input.retencionIgv.toFixed(2), comprobanteRetencion: input.comprobanteRetencion ?? null,
    docModificaSerie: input.docModifica?.serie ?? null, docModificaNumero: input.docModifica?.numero ?? null,
    motivoNota: input.motivoNota ?? null,
    lineas: input.lineas ?? null, descripcion: input.descripcion ?? null,
    userId: input.userId ?? null,
  }).returning();

  const d = schema.documentoPendiente;
  let documento: typeof d.$inferSelect | null = null;

  if (nota) {
    // NC de venta: devuelve el saldo de la factura original (aplicación tipo 'nota' sobre la CxC)
    if (!input.docModifica) throw new DocumentoError(400, 'Una nota de crédito debe indicar la factura que modifica (docModifica)');
    const [orig] = await q.select().from(d).where(and(
      eq(d.empresaId, empresaId), eq(d.tipo, 'cxc'),
      eq(d.docSerie, input.docModifica.serie), eq(d.docNumero, input.docModifica.numero),
      ...(input.clienteRuc ? [eq(d.terceroRuc, input.clienteRuc)] : []),
    )).limit(1);
    if (!orig) throw new DocumentoError(404, `No existe CxC de la factura ${input.docModifica.serie}-${input.docModifica.numero} para aplicar la NC`);
    await aplicar(q, {
      origenTipo: 'nota', origenId: venta!.id, fecha: input.fechaEmision, userId: input.userId,
      aplicaciones: [{ documentoPendienteId: orig.id, monto: r2(Math.min(Math.abs(input.total), Number(orig.saldoPendiente))) }],
      tipoEsperado: 'cxc', moneda: input.moneda,
    });
    documento = await refrescarDocumento(q, orig.id);
  } else {
    // CxC de la venta (saldo derivado de aplicaciones · cobros la cancelan vía F2.2)
    const [doc] = await q.insert(d).values({
      empresaId, tipo: 'cxc', cuentaControl: '1212',
      terceroRuc: input.clienteRuc ?? null, terceroRazon: input.clienteRazon ?? null,
      docTipo: input.tipoCpe, docSerie: input.serie, docNumero: input.numero,
      fechaEmision: input.fechaEmision, fechaVenc: input.fechaVencimiento ?? input.fechaEmision,
      moneda: input.moneda, tipoCambio: input.moneda === 'PEN' ? null : tc.toFixed(4),
      montoOriginal: input.total.toFixed(2), montoPen: r2(input.total * tc).toFixed(2), saldoPendiente: input.total.toFixed(2),
      estado: 'abierto', obraId: input.proyectoId ?? null, docOrigenTipo: 'venta', docOrigenId: venta!.id,
    }).returning();
    documento = doc ?? null;
  }

  // Detracción que el cliente retiene y deposita al BN (docOrigenTipo 'venta' · CHECK ampliado en 0025)
  let detraccion: typeof schema.detraccionDocumento.$inferSelect | null = null;
  if (input.detraccion && !nota) {
    const tasa = await buscarTasaDetraccion(input.detraccion.codigo, input.fechaEmision);
    if (!tasa) throw new DocumentoError(400, `Código de detracción ${input.detraccion.codigo} no vigente al ${input.fechaEmision}`);
    const calc = calcularDetraccion({ total: input.total, moneda: input.moneda, tipoCambio: input.moneda === 'PEN' ? null : tc, tasa });
    detraccion = (await q.insert(schema.detraccionDocumento).values({
      docOrigenTipo: 'venta', docOrigenId: venta!.id, empresaId, codigo: tasa.codigo, porcentaje: tasa.porcentaje.toFixed(2),
      basePen: calc.basePen.toFixed(2), monto: calc.monto.toFixed(2),
      montoDeclarado: input.detraccion.montoDeclarado != null ? input.detraccion.montoDeclarado.toFixed(2) : null,
      estado: calc.aplica ? 'pendiente' : 'no_aplica',
    }).returning())[0] ?? null;
  }

  return { venta: venta!, documento, detraccion };
}
