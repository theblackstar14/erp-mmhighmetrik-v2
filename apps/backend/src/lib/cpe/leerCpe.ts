/**
 * Lector de comprobantes electrónicos SUNAT (UBL 2.1): Factura/Boleta (Invoice), NC, ND.
 * Puro: no toca BD ni decide si es compra o venta (eso lo hace la ruta con el RUC de la empresa).
 * - removeNSPrefix: cada OSE usa prefijos distintos (cbc:, n2:, sin prefijo).
 * - Encoding: intenta UTF-8 estricto y cae a latin1 (hay XML que declaran una cosa y traen otra).
 * - UBL 2.0, guías, retención/percepción como documento y RHE → NO_SOPORTADO.
 */
import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type CpeTipo = '01' | '03' | '07' | '08';
export type CpeLeido = {
  tipo: CpeTipo; serie: string; numero: string;
  fechaEmision: string; fechaVencimiento: string | null;
  moneda: string; tipoOperacion: string | null;
  emisor: { ruc: string; razonSocial: string | null };
  cliente: { tipoDoc: string | null; numero: string | null; razonSocial: string | null };
  totales: { valorVenta: number; igv: number; descuentos: number; cargos: number; anticipos: number; total: number };
  formaPago: 'Contado' | 'Credito' | null;
  cuotas: { monto: number; vence: string | null }[];
  detraccion: { codigo: string; porcentaje: number; monto: number; cuentaBn: string | null } | null;
  percepcion: { codigo: string; monto: number } | null;
  retencion: { monto: number } | null;
  anticipos: { documento: string | null; monto: number }[];
  modifica: { tipo: string | null; serieNumero: string; motivo: string | null } | null;
  ordenCompra: string | null;
  guias: string[];
  lineas: { descripcion: string; cantidad: number; unidad: string | null; valorUnitario: number | null; valorVenta: number; igv: number; afectacionIgv: string | null }[];
  hash: string;
};

export class CpeError extends Error {
  constructor(public code: 'XML_INVALIDO' | 'NO_SOPORTADO', mensaje: string) {
    super(mensaje);
    this.name = 'CpeError';
  }
}

const ARRAYS = new Set(['InvoiceLine', 'CreditNoteLine', 'DebitNoteLine', 'PaymentTerms', 'PaymentMeans', 'AllowanceCharge', 'BillingReference',
  'DespatchDocumentReference', 'PrepaidPayment', 'TaxTotal', 'TaxSubtotal', 'PartyIdentification', 'PartyLegalEntity', 'Description', 'Note']);
const parser = new XMLParser({
  removeNSPrefix: true, ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, parseAttributeValue: false, trimValues: true,
  isArray: (nombre) => ARRAYS.has(nombre),
});

type N = any; // nodo de fast-xml-parser
const arr = (v: N): N[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const first = (v: N): N => (Array.isArray(v) ? v[0] : v);
const txt = (v: N): string | null => {
  const x = first(v);
  if (x == null) return null;
  const s = typeof x === 'object' ? x['#text'] : x;
  return s == null ? null : String(s).replace(/\s+/g, ' ').trim() || null;
};
const attr = (v: N, nombre: string): string | null => { const x = first(v); return x && typeof x === 'object' ? (x[`@_${nombre}`] ?? null) : null; };
const num = (v: N): number => { const n = Number(txt(v) ?? 0); return Number.isFinite(n) ? n : 0; };

function decodificar(buf: Buffer): string {
  let s: string;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { s = new TextDecoder('latin1').decode(buf); }
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function leerCpe(buf: Buffer): CpeLeido {
  const xml = decodificar(buf);
  if (XMLValidator.validate(xml) !== true) throw new CpeError('XML_INVALIDO', 'El archivo no es un XML válido');
  const raiz = parser.parse(xml) as Record<string, N>;
  const nombreRaiz = Object.keys(raiz).find((k) => !k.startsWith('?'));
  if (!nombreRaiz || !['Invoice', 'CreditNote', 'DebitNote'].includes(nombreRaiz)) throw new CpeError('NO_SOPORTADO', `Documento "${nombreRaiz ?? '?'}" no soportado (solo factura, boleta, nota de crédito y débito)`);
  const doc = raiz[nombreRaiz];
  if (txt(doc.UBLVersionID) !== '2.1') throw new CpeError('NO_SOPORTADO', `Solo UBL 2.1 (el archivo trae ${txt(doc.UBLVersionID) ?? 'sin versión'})`);

  let tipo: CpeTipo;
  if (nombreRaiz === 'CreditNote') tipo = '07';
  else if (nombreRaiz === 'DebitNote') tipo = '08';
  else {
    const t = txt(doc.InvoiceTypeCode);
    if (t !== '01' && t !== '03') throw new CpeError('NO_SOPORTADO', `Tipo de comprobante ${t ?? '?'} no soportado`);
    tipo = t;
  }

  const id = txt(doc.ID) ?? '';
  const guion = id.lastIndexOf('-');
  const serie = guion > 0 ? id.slice(0, guion).trim() : id;
  const numeroCrudo = guion > 0 ? id.slice(guion + 1).trim() : '';
  const numero = /^\d+$/.test(numeroCrudo) ? String(Number.parseInt(numeroCrudo, 10)) : numeroCrudo;

  const sup = first(doc.AccountingSupplierParty)?.Party ?? {};
  const cus = first(doc.AccountingCustomerParty)?.Party ?? {};
  const idCliente = first(cus.PartyIdentification)?.ID;

  const total = first(doc.LegalMonetaryTotal ?? doc.RequestedMonetaryTotal) ?? {};
  const igv = arr(doc.TaxTotal).flatMap((tt) => arr(tt.TaxSubtotal))
    .filter((ts) => txt(first(ts.TaxCategory)?.TaxScheme?.ID) === '1000')
    .reduce((a, ts) => a + num(ts.TaxAmount), 0);

  const terms = arr(doc.PaymentTerms);
  const det = terms.find((t) => (txt(t.ID) ?? '').toLowerCase() === 'detraccion');
  const medioDet = arr(doc.PaymentMeans).find((p) => (txt(p.ID) ?? '').toLowerCase() === 'detraccion');
  const forma = terms.map((t) => txt(t.PaymentMeansID)).find((x) => x === 'Contado' || x === 'Credito') as 'Contado' | 'Credito' | undefined;
  const cuotas = terms.filter((t) => (txt(t.PaymentMeansID) ?? '').startsWith('Cuota')).map((t) => ({ monto: num(t.Amount), vence: txt(t.PaymentDueDate) }));

  const cargos = arr(doc.AllowanceCharge);
  const porCodigo = (codigos: string[]) => cargos.find((c) => codigos.includes(txt(c.AllowanceChargeReasonCode) ?? ''));
  const perc = porCodigo(['51', '52', '53']);
  const ret = porCodigo(['62']);

  const billing = first(doc.BillingReference)?.InvoiceDocumentReference;
  const lineaTag = nombreRaiz === 'CreditNote' ? 'CreditNoteLine' : nombreRaiz === 'DebitNote' ? 'DebitNoteLine' : 'InvoiceLine';
  const qtyTag = nombreRaiz === 'CreditNote' ? 'CreditedQuantity' : nombreRaiz === 'DebitNote' ? 'DebitedQuantity' : 'InvoicedQuantity';

  return {
    tipo, serie, numero,
    fechaEmision: txt(doc.IssueDate) ?? '',
    fechaVencimiento: txt(doc.DueDate) ?? cuotas[0]?.vence ?? null,
    moneda: txt(doc.DocumentCurrencyCode) ?? 'PEN',
    tipoOperacion: attr(doc.InvoiceTypeCode, 'listID'),
    emisor: { ruc: txt(first(sup.PartyIdentification)?.ID) ?? '', razonSocial: txt(first(sup.PartyLegalEntity)?.RegistrationName) },
    cliente: { tipoDoc: attr(idCliente, 'schemeID'), numero: txt(idCliente), razonSocial: txt(first(cus.PartyLegalEntity)?.RegistrationName) },
    totales: {
      valorVenta: num(total.LineExtensionAmount), igv: Math.round(igv * 100) / 100, descuentos: num(total.AllowanceTotalAmount),
      cargos: num(total.ChargeTotalAmount), anticipos: num(total.PrepaidAmount), total: num(total.PayableAmount),
    },
    formaPago: forma ?? null,
    cuotas,
    detraccion: det ? { codigo: txt(det.PaymentMeansID) ?? '', porcentaje: num(det.PaymentPercent), monto: num(det.Amount), cuentaBn: txt(medioDet?.PayeeFinancialAccount?.ID) } : null,
    percepcion: perc ? { codigo: txt(perc.AllowanceChargeReasonCode) ?? '', monto: num(perc.Amount) } : null,
    retencion: ret ? { monto: num(ret.Amount) } : null,
    anticipos: arr(doc.PrepaidPayment).map((p) => ({ documento: txt(p.ID), monto: num(p.PaidAmount) })),
    modifica: billing ? { tipo: txt(billing.DocumentTypeCode), serieNumero: (txt(billing.ID) ?? '').replace(/\s*-\s*/g, '-'), motivo: txt(first(doc.DiscrepancyResponse)?.ResponseCode) } : null,
    ordenCompra: txt(first(doc.OrderReference)?.ID),
    guias: arr(doc.DespatchDocumentReference).map((g) => txt(g.ID)).filter((x): x is string => !!x),
    lineas: arr(doc[lineaTag]).map((l) => {
      const tt = first(l.TaxTotal);
      return {
        descripcion: arr(l.Item?.Description).map(txt).filter(Boolean).join(' '),
        cantidad: num(l[qtyTag]),
        unidad: attr(l[qtyTag], 'unitCode'),
        valorUnitario: l.Price ? num(l.Price.PriceAmount) : null,
        valorVenta: num(l.LineExtensionAmount),
        igv: num(tt?.TaxAmount),
        afectacionIgv: txt(first(first(tt?.TaxSubtotal)?.TaxCategory)?.TaxExemptionReasonCode),
      };
    }),
    hash: createHash('sha256').update(buf).digest('hex'),
  };
}
