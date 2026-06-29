/**
 * Genera el PDF oficial de OC/OS con pdfkit, replicando el diseño del visor del ERP
 * (OcPdfPreview): logo + Facturar a / Proveedor + tabla + TOTAL + FIRMA + footer empresa.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = resolve(__dirname, '../../../frontend/public/logo-mm.png');
const LOGO = existsSync(LOGO_PATH) ? readFileSync(LOGO_PATH) : null;

const EMISOR = {
  razon: 'MM HIGH METRIK ENGINEERS S.A.C.',
  ruc: '20610639764',
  direccion: 'Av. Republica de Colombia 625 Of. 501',
  distrito: 'San Isidro',
  departamento: 'Lima',
  email: 'mmhighmetrik@gmail.com',
  telefono: '(+51) 955 137 140',
  telefono2: '989010329',
};

type Linea = { numero: number; descripcion: string; unidad: string; cantidad: string; precioUnitario: string };
type OcData = {
  numero: string;
  concepto: string;
  fechaEmision: string;
  lugarEntrega?: string | null;
  moneda: string;
  formaPago?: string | null;
  medioPago?: string | null;
  cotizacion?: string | null;
  total: string;
  aplicaDetraccion?: boolean;
  pctDetraccion?: string | null;
  montoDetraccion?: string | null;
  montoNetoPagar?: string | null;
  terminos?: string | null;
  gestorNombre?: string | null;
  creadoPorEmail?: string | null;
};
type Prov = { razonSocial: string; ruc: string | null; domicilio?: string | null } | null;
type Proy = { codigo: string; nombre: string } | null;

const money = (n: number | string, moneda = 'PEN') => {
  const sym = moneda === 'USD' ? '$' : 'S/';
  return `${sym} ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fechaEs = (d: string) => { const [y, m, day] = d.slice(0, 10).split('-'); return `${Number(day)}/${Number(m)}/${y}`; };

export function generarOcPdf(oc: OcData, lineas: Linea[], proveedor: Prov, proyecto: Proy): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 40;
    const W = doc.page.width - 80; // 515
    const right = left + W;
    const sym = oc.moneda;
    const esServicio = oc.concepto === 'SERVICIO';

    const C = { ink: '#1C1C1C', line: '#000000', soft: '#D8D8D2', accent: '#2A44B8' };

    // ── Header · logo + fecha emisión ──
    if (LOGO) {
      try { doc.image(LOGO, left, 38, { fit: [165, 52] }); } catch { /* noop */ }
    } else {
      doc.fontSize(26).font('Helvetica-Bold').fillColor('#1C1C1C').text('MM', left, 40);
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#3D3D3A').text('HIGH METRIK ENGINEERS', left, 72);
    }
    doc.fillColor(C.ink).fontSize(9).font('Helvetica-Bold').text('Fecha de emision', right - 150, 44, { width: 150, align: 'right' });
    doc.font('Helvetica').text(fechaEs(oc.fechaEmision), right - 150, 58, { width: 150, align: 'right' });

    // ── Título ──
    let y = 100;
    doc.fontSize(12).font('Helvetica-Bold').fillColor(C.ink)
      .text(`${esServicio ? 'ORDEN DE SERVICIO' : 'ORDEN DE COMPRA'} N° ${oc.numero}`, left, y, { width: W, align: 'center' });
    y += 18;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1.2).strokeColor(C.line).stroke();
    y += 8;

    // ── KV helper (dos columnas) ──
    const kv = (x: number, yy: number, label: string, value: string, labelW: number, valW: number) => {
      doc.fontSize(9).font('Helvetica-Bold').fillColor(C.ink).text(label, x, yy, { width: labelW });
      doc.font('Helvetica').text(':', x + labelW, yy, { width: 6 });
      doc.text(value || '—', x + labelW + 8, yy, { width: valW });
    };
    const colL = left;
    const colR = left + Math.round(W * 0.52);
    const wL = Math.round(W * 0.52) - 10;
    const wR = right - colR;

    // ── Facturar a ──
    doc.fontSize(10).font('Helvetica-Bold').fillColor(C.ink).text('Facturar a', left, y);
    y += 14;
    let yL = y, yR = y;
    kv(colL, yL, 'Nombre de', EMISOR.razon, 60, wL - 70); yL += 22;
    kv(colL, yL, 'Direccion', `${EMISOR.direccion.toUpperCase()}, ${EMISOR.distrito.toUpperCase()} - ${EMISOR.departamento.toUpperCase()}`, 60, wL - 70); yL += 22;
    kv(colL, yL, 'RUC', EMISOR.ruc, 60, wL - 70); yL += 14;
    kv(colL, yL, 'Telefono', EMISOR.telefono2, 60, wL - 70); yL += 14;
    kv(colR, yR, 'Moneda', oc.moneda === 'PEN' ? 'Soles' : 'Dólares', 70, wR - 80); yR += 14;
    kv(colR, yR, 'Medio de pago', oc.medioPago ?? '—', 70, wR - 80); yR += 14;
    kv(colR, yR, 'Forma de pago', oc.formaPago ?? '—', 70, wR - 80); yR += 14;
    if (oc.cotizacion) { kv(colR, yR, 'Cotización', oc.cotizacion, 70, wR - 80); yR += 14; }
    y = Math.max(yL, yR) + 4;

    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(C.soft).stroke();
    y += 8;

    // ── Proveedor ──
    doc.fontSize(10).font('Helvetica-Bold').fillColor(C.ink).text('Proveedor', left, y);
    y += 14;
    yL = y; yR = y;
    kv(colL, yL, 'Nombre', proveedor?.razonSocial ?? '—', 60, wL - 70); yL += 22;
    kv(colL, yL, 'Direccion', proveedor?.domicilio ?? '—', 60, wL - 70); yL += 22;
    kv(colL, yL, 'RUC', proveedor?.ruc ?? 'S/ RUC', 60, wL - 70); yL += 14;
    kv(colR, yR, 'Lugar de entrega', oc.lugarEntrega ?? '—', 80, wR - 90); yR += 28;
    y = Math.max(yL, yR) + 6;

    // ── Concepto ──
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor(C.ink).text('Concepto', left, y, { continued: true }).font('Helvetica').text(`   :   ${oc.concepto}`);
    y += 18;

    // ── Tabla de ítems ──
    const cx = { item: left, desc: left + 30, und: left + 285, cant: left + 325, pu: left + 370, tot: left + 440 };
    const cw = { item: 30, desc: 255, und: 40, cant: 45, pu: 70, tot: 75 };
    const cellPad = 3;
    const drawHeader = (yy: number): number => {
      const h = 18;
      doc.rect(left, yy, W, h).fillAndStroke('#F4F4F1', C.line);
      doc.fillColor(C.ink).fontSize(8).font('Helvetica-Bold');
      doc.text('Item', cx.item, yy + 5, { width: cw.item, align: 'center' });
      doc.text('Descripción', cx.desc + cellPad, yy + 5, { width: cw.desc - cellPad });
      doc.text('Unid.', cx.und, yy + 5, { width: cw.und, align: 'center' });
      doc.text('Cant.', cx.cant, yy + 5, { width: cw.cant, align: 'center' });
      doc.text('Precio Unit.', cx.pu, yy + 5, { width: cw.pu, align: 'right' });
      doc.text('Total', cx.tot, yy + 5, { width: cw.tot - cellPad, align: 'right' });
      return yy + h;
    };
    y = drawHeader(y);
    doc.font('Helvetica').fontSize(8).fillColor(C.ink);
    for (const l of lineas) {
      const cant = Number(l.cantidad);
      const pu = Number(l.precioUnitario);
      const tot = cant * pu;
      const descH = doc.heightOfString(l.descripcion, { width: cw.desc - cellPad * 2 });
      const rowH = Math.max(16, descH + 6);
      if (y + rowH > doc.page.height - 150) { doc.addPage(); y = drawHeader(40); doc.font('Helvetica').fontSize(8).fillColor(C.ink); }
      // bordes celda
      doc.rect(left, y, W, rowH).strokeColor(C.line).lineWidth(0.5).stroke();
      for (const vx of [cx.desc, cx.und, cx.cant, cx.pu, cx.tot]) doc.moveTo(vx, y).lineTo(vx, y + rowH).stroke();
      doc.text(String(l.numero).padStart(2, '0'), cx.item, y + 3, { width: cw.item, align: 'center' });
      doc.text(l.descripcion, cx.desc + cellPad, y + 3, { width: cw.desc - cellPad * 2 });
      doc.text(l.unidad, cx.und, y + 3, { width: cw.und, align: 'center' });
      doc.text(cant.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), cx.cant, y + 3, { width: cw.cant - cellPad, align: 'right' });
      doc.text(`${sym === 'USD' ? '$' : 'S/'} ${pu.toLocaleString('es-PE', { minimumFractionDigits: 5, maximumFractionDigits: 5 })}`, cx.pu, y + 3, { width: cw.pu - cellPad, align: 'right' });
      doc.text(money(tot, sym), cx.tot, y + 3, { width: cw.tot - cellPad, align: 'right' });
      y += rowH;
    }

    // ── Total ──
    const ensure = (h: number) => { if (y + h > doc.page.height - 60) { doc.addPage(); y = 40; } };
    ensure(60);
    const totH = 18;
    doc.rect(left, y, W, totH).strokeColor(C.line).lineWidth(0.5).stroke();
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.ink);
    doc.text(`PROYECTO: ${proyecto?.codigo ?? '—'}`, cx.desc + cellPad, y + 5, { width: cw.desc });
    doc.text('TOTAL (INC. IGV)', cx.pu - 40, y + 5, { width: cw.pu + 40, align: 'right' });
    doc.text(money(oc.total, sym), cx.tot, y + 5, { width: cw.tot - cellPad, align: 'right' });
    y += totH;
    if (oc.aplicaDetraccion && Number(oc.montoDetraccion ?? 0) > 0) {
      doc.rect(left, y, W, totH).strokeColor(C.line).lineWidth(0.5).stroke();
      doc.font('Helvetica').text(`Detracción (${oc.pctDetraccion ?? 0}%)`, cx.desc + cellPad, y + 5, { width: cw.desc });
      doc.fillColor('#B45309').text(`- ${money(oc.montoDetraccion ?? 0, sym)}`, cx.pu, y + 5, { width: cw.pu + cw.tot - cellPad, align: 'right' });
      doc.fillColor(C.ink); y += totH;
      doc.rect(left, y, W, totH).strokeColor(C.line).lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').text('NETO A PAGAR', cx.pu - 40, y + 5, { width: cw.pu + 40, align: 'right' });
      doc.text(money(oc.montoNetoPagar ?? oc.total, sym), cx.tot, y + 5, { width: cw.tot - cellPad, align: 'right' });
      y += totH;
    }
    y += 12;

    // ── Generales + FIRMA ──
    ensure(80);
    const firmaW = 150;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(C.ink).text('Generales', left, y);
    doc.fontSize(8.5).font('Helvetica').fillColor(C.ink).text(oc.terminos ?? '', left, y + 14, { width: W - firmaW - 20 });
    // caja firma a la derecha
    const fx = right - firmaW;
    doc.rect(fx, y + 2, firmaW, 46).dash(2, { space: 2 }).strokeColor('#6B6B68').stroke().undash();
    doc.fontSize(8).fillColor('#9A9A96').text('FIRMA', fx, y + 22, { width: firmaW, align: 'center' });
    doc.fontSize(7.5).fillColor(C.ink).font('Helvetica').text(EMISOR.razon, fx, y + 52, { width: firmaW, align: 'center' });
    doc.font('Helvetica-Bold').text((oc.gestorNombre ?? 'MARIO A. GARCÍA CALDERÓN').toUpperCase(), fx, y + 62, { width: firmaW, align: 'center' });
    doc.font('Helvetica').text('SUB GERENTE', fx, y + 72, { width: firmaW, align: 'center' });
    y += 88;

    // ── Legal ──
    ensure(60);
    doc.fontSize(7).font('Helvetica').fillColor(C.ink).text(
      `Estimado proveedor no olvidar adjuntar los sustentos necesarios (orden de servicio/compra debidamente firmada y guía de remisión) para poder presentar su factura en nuestra oficina ${EMISOR.direccion}, ${EMISOR.distrito} - ${EMISOR.departamento} y no estar sujetos a demora en su pago. Una vez confirmada la recepción se dará por aceptada la misma si no recibimos observación luego de 24 horas. Si la cantidad o especificaciones no corresponden a lo solicitado, el producto no será recibido. Al entregar la mercadería, indicar en las Guías de Remisión el número de Orden correspondiente. Si la venta está afecta a detracción, indicar el importe afecto y la cuenta donde depositar.`,
      left, y, { width: W, align: 'justify' },
    );
    y = doc.y + 8;

    // ── Creado por / Gestión ──
    ensure(30);
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(C.soft).stroke();
    doc.fontSize(9).font('Helvetica').fillColor('#3D3D3A').text('Creado por', left, y + 4, { continued: true });
    doc.fillColor(C.accent).text(`  ${oc.creadoPorEmail ?? EMISOR.email}`);
    doc.fillColor('#3D3D3A').text('Gestion:', right - 200, y + 4, { width: 200, align: 'right', continued: false });
    doc.fillColor(C.ink).font('Helvetica-Bold').text(oc.gestorNombre ?? 'Mario A. García Calderón', right - 200, y + 16, { width: 200, align: 'right' });
    y += 30;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(C.soft).stroke();
    y += 6;

    // ── Footer empresa ──
    doc.fontSize(8.5).font('Helvetica').fillColor(C.ink)
      .text(`${EMISOR.direccion} · ${EMISOR.distrito} - ${EMISOR.departamento}`, left, y, { width: W, align: 'center' })
      .text(`Telf. ${EMISOR.telefono}`, { width: W, align: 'center' })
      .text(`e-mail: ${EMISOR.email}`, { width: W, align: 'center' });

    doc.end();
  });
}
