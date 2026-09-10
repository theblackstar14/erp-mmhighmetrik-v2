/**
 * Genera el PDF de boleta de pago (oficina/planilla) con pdfkit,
 * replicando el layout del Excel oficial de MM HIGH METRIK.
 */
import PDFDocument from 'pdfkit';

export type BoletaEmpresa = {
  razonSocial: string;
  ruc: string;
  direccion: string;
};

// Subconjunto de campos usados (los campos dinero vienen como string desde la DB)
export type BoletaDetalle = {
  boletaCorrelativo: string | null;
  nombre: string;
  cargo: string;
  dni: string;
  afp: string | null;
  cuspp: string | null;
  cuentaBancaria: string | null;
  diasTrab: number | string | null;
  horasTrab: number | string | null;
  fechaIngreso: string | null;
  fechaCese: string | null;
  sueldoMensual: string | number;
  totalHe: string | number;
  montoDominical: string | number;
  montoFeriado: string | number;
  asigFamiliar: string | number;
  gratificacion: string | number;
  vacaciones: string | number;
  comisiones: string | number;
  bonificacion: string | number;
  totalBruto: string | number;
  onp: string | number;
  essaludVida: string | number;
  imptoRenta5ta: string | number;
  retencionJudicial: string | number;
  afpAporte: string | number;
  afpSeguro: string | number;
  afpComision: string | number;
  adelantoCuota: string | number;
  otrosDescuentos: string | number;
  totalDescuento: string | number;
  essalud: string | number;
  totalAporte: string | number;
  netoPago: string | number;
};

const MONTHS: Record<number, string> = {
  1: 'Ene', 2: 'Feb', 3: 'Mar', 4: 'Abr', 5: 'May', 6: 'Jun',
  7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Oct', 11: 'Nov', 12: 'Dic',
};

/** 'YYYY-MM' → 'Mmm-AA' e.g. '2026-07' → 'Jul-26' */
function mesMes(mes: string): string {
  const [y, m] = mes.split('-');
  return `${MONTHS[Number(m)] ?? m}-${y.slice(2)}`;
}

/** Last day of the month as 'dd/mm/yyyy' */
function lastDayOfMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m, 0); // day 0 of next month = last day of this month
  return `${String(d.getDate()).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' */
function fmtFecha(f: string | null | undefined): string {
  if (!f) return '—';
  const [y, mo, d] = f.slice(0, 10).split('-');
  return `${d}/${mo}/${y}`;
}

const fmt = (n: number | string) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const C = {
  ink: '#1C1C1C',
  line: '#000000',
  soft: '#D8D8D2',
  header: '#E8E8E4',
};

export function generarBoletaPdf(
  detalle: BoletaDetalle,
  empresa: BoletaEmpresa,
  mes: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 36;
    const W = doc.page.width - 72; // ~523
    const right = left + W;

    // ─────────────────────────────────────────────────────────────────
    // HEADER
    // ─────────────────────────────────────────────────────────────────
    let y = 36;

    // Title centered
    doc.fontSize(13).font('Helvetica-Bold').fillColor(C.ink)
      .text('BOLETA DE PAGO', left, y, { width: W, align: 'center' });
    y += 18;

    doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(C.line).stroke();
    y += 6;

    // Left block: company info
    const infoY = y;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.ink)
      .text(`Razon Social: `, left, infoY, { continued: true })
      .font('Helvetica').text(empresa.razonSocial);
    doc.font('Helvetica-Bold').text(`Direccion: `, left, infoY + 12, { continued: true })
      .font('Helvetica').text(empresa.direccion);
    doc.font('Helvetica-Bold').text(`R.U.C.: `, left, infoY + 24, { continued: true })
      .font('Helvetica').text(empresa.ruc);

    // Right block: correlativo
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.ink)
      .text(detalle.boletaCorrelativo ?? '', right - 130, infoY, { width: 130, align: 'right' });

    y = infoY + 38;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor(C.line).stroke();
    y += 6;

    // ─────────────────────────────────────────────────────────────────
    // DATOS DEL TRABAJADOR
    // ─────────────────────────────────────────────────────────────────
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(C.ink)
      .text('DATOS DEL TRABAJADOR', left, y);
    y += 13;

    // Draw worker data in a box with two rows
    const drawKV = (
      x: number, yy: number, label: string, value: string, labelW = 65, valW = 100,
    ) => {
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.ink)
        .text(label, x, yy, { width: labelW });
      doc.font('Helvetica')
        .text(value || '—', x + labelW, yy, { width: valW });
    };

    // Row 1: Nombre, Cargo, Fecha Ing., Fecha cese
    const wData = W / 4;
    drawKV(left, y, 'Nombre:', detalle.nombre, 45, wData - 45);
    drawKV(left + wData, y, 'Cargo:', detalle.cargo, 35, wData - 35);
    drawKV(left + wData * 2, y, 'Fecha Ing.:', fmtFecha(detalle.fechaIngreso), 52, wData - 52);
    drawKV(left + wData * 3, y, 'Fecha cese:', fmtFecha(detalle.fechaCese), 52, wData - 52);
    y += 12;

    // Row 2: DNI, AFP, CUSPP, Dias Trab.
    drawKV(left, y, 'DNI:', detalle.dni, 45, wData - 45);
    drawKV(left + wData, y, 'A.F.P.:', detalle.afp ?? '—', 35, wData - 35);
    drawKV(left + wData * 2, y, 'CUSPP:', detalle.cuspp ?? '—', 52, wData - 52);
    drawKV(left + wData * 3, y, 'Dias Trab.:', String(detalle.diasTrab ?? 0), 52, wData - 52);
    y += 12;

    // Row 3: Horas Trab on the right
    drawKV(left, y, 'Horas Trab:', String(detalle.horasTrab ?? 0), 52, wData - 52);
    y += 14;

    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor(C.line).stroke();
    y += 6;

    // ─────────────────────────────────────────────────────────────────
    // TWO-COLUMN SECTION: REMUNERACIONES | APORTES Y DESCUENTOS
    // ─────────────────────────────────────────────────────────────────
    const midX = left + Math.round(W * 0.46);
    const colLeft = { x: left, w: midX - left };
    const colRight = { x: midX + 4, w: right - midX - 4 };

    const sectionTop = y;

    // ── LEFT: REMUNERACIONES ──────────────────────────────────────────
    let yL = sectionTop;

    // Section header
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.ink)
      .text('REMUNERACIONES', colLeft.x, yL, { width: colLeft.w, align: 'center' });
    yL += 12;

    // Sub-header row
    const mesLabel = mesMes(mes);
    const remAmtW = 65;
    const remLabelW = colLeft.w - remAmtW;
    doc.rect(colLeft.x, yL, colLeft.w, 12).fillAndStroke(C.header, C.line);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(C.ink)
      .text(`Mes de: ${mesLabel}`, colLeft.x + 2, yL + 2, { width: remLabelW - 4 })
      .text('Importe', colLeft.x + remLabelW, yL + 2, { width: remAmtW - 4, align: 'right' });
    yL += 12;

    const remRows: [string, number][] = [
      ['Mensual', Number(detalle.sueldoMensual)],
      ['Dominical', Number(detalle.montoDominical)],
      ['Horas Extras', Number(detalle.totalHe)],
      ['Destajos', 0],
      ['Bonificaciones', Number(detalle.bonificacion)],
      ['Gratificaciones', Number(detalle.gratificacion)],
      ['Vacaciones', Number(detalle.vacaciones)],
      ['Comisiones', Number(detalle.comisiones)],
      ['Asig. Familiar', Number(detalle.asigFamiliar)],
      ['Ley 26504', 0],
      ['Afp 10.23%,3%', 0],
      ['Otros', 0],
    ];

    const rowH = 11;
    for (const [label, amount] of remRows) {
      doc.rect(colLeft.x, yL, colLeft.w, rowH).strokeColor(C.line).lineWidth(0.4).stroke();
      doc.moveTo(colLeft.x + remLabelW, yL).lineTo(colLeft.x + remLabelW, yL + rowH).stroke();
      doc.fontSize(7).font('Helvetica').fillColor(C.ink)
        .text(label, colLeft.x + 2, yL + 2, { width: remLabelW - 4 })
        .text(fmt(amount), colLeft.x + remLabelW + 2, yL + 2, { width: remAmtW - 4, align: 'right' });
      yL += rowH;
    }

    // ── RIGHT: APORTES Y DESCUENTOS ───────────────────────────────────
    let yR = sectionTop;

    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.ink)
      .text('APORTES Y DESCUENTOS', colRight.x, yR, { width: colRight.w, align: 'center' });
    yR += 12;

    // Three sub-columns: Motivo | Empleador | Trabajador
    const emplW = 58;
    const trabW = 58;
    const motivoW = colRight.w - emplW - trabW;

    doc.rect(colRight.x, yR, colRight.w, 12).fillAndStroke(C.header, C.line);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(C.ink)
      .text('Motivo', colRight.x + 2, yR + 2, { width: motivoW - 4 })
      .text('Empleador', colRight.x + motivoW, yR + 2, { width: emplW - 4, align: 'right' })
      .text('Trabajador', colRight.x + motivoW + emplW, yR + 2, { width: trabW - 4, align: 'right' });
    yR += 12;

    // Rows: [label, empleador value, trabajador value]
    const descRows: [string, number, number][] = [
      ['O.N.P.', 0, Number(detalle.onp)],
      ['Essalud Vida', Number(detalle.essaludVida), 0],
      ['Impto. Renta', 0, Number(detalle.imptoRenta5ta)],
      ['Retenc. Judic.', 0, Number(detalle.retencionJudicial)],
      ['AFP pension', 0, Number(detalle.afpAporte)],
      ['AFP Seguro', 0, Number(detalle.afpSeguro)],
      ['AFP Com.%', 0, Number(detalle.afpComision)],
      ['Adelantos', 0, Number(detalle.adelantoCuota)],
      ['Descuentos', 0, Number(detalle.otrosDescuentos)],
      ['Reg. Salud', Number(detalle.essalud), 0],
    ];

    for (const [label, empl, trab] of descRows) {
      doc.rect(colRight.x, yR, colRight.w, rowH).strokeColor(C.line).lineWidth(0.4).stroke();
      doc.moveTo(colRight.x + motivoW, yR).lineTo(colRight.x + motivoW, yR + rowH).stroke();
      doc.moveTo(colRight.x + motivoW + emplW, yR).lineTo(colRight.x + motivoW + emplW, yR + rowH).stroke();
      doc.fontSize(7).font('Helvetica').fillColor(C.ink)
        .text(label, colRight.x + 2, yR + 2, { width: motivoW - 4 })
        .text(empl > 0 ? fmt(empl) : '', colRight.x + motivoW + 2, yR + 2, { width: emplW - 4, align: 'right' })
        .text(trab > 0 ? fmt(trab) : '', colRight.x + motivoW + emplW + 2, yR + 2, { width: trabW - 4, align: 'right' });
      yR += rowH;
    }

    // Total Aporte row (empleador)
    doc.rect(colRight.x, yR, colRight.w, rowH).fillAndStroke(C.header, C.line);
    doc.moveTo(colRight.x + motivoW, yR).lineTo(colRight.x + motivoW, yR + rowH).stroke();
    doc.moveTo(colRight.x + motivoW + emplW, yR).lineTo(colRight.x + motivoW + emplW, yR + rowH).stroke();
    doc.fontSize(7).font('Helvetica-Bold').fillColor(C.ink)
      .text('Total Aporte S/.', colRight.x + 2, yR + 2, { width: motivoW - 4 })
      .text(fmt(Number(detalle.totalAporte)), colRight.x + motivoW + 2, yR + 2, { width: emplW - 4, align: 'right' });
    yR += rowH;

    // Vertical divider between columns
    const sectionBottom = Math.max(yL, yR);
    doc.moveTo(midX, sectionTop).lineTo(midX, sectionBottom).lineWidth(0.8).strokeColor(C.line).stroke();

    y = sectionBottom + 8;

    // ─────────────────────────────────────────────────────────────────
    // TOTALS ROW
    // ─────────────────────────────────────────────────────────────────
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor(C.line).stroke();
    y += 5;

    const totRowH = 14;
    doc.rect(left, y, W, totRowH).strokeColor(C.line).lineWidth(0.6).stroke();
    doc.moveTo(midX, y).lineTo(midX, y + totRowH).stroke();

    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.ink)
      .text('Total Bruto', left + 2, y + 3, { width: 80 })
      .text(`S/ ${fmt(Number(detalle.totalBruto))}`, left + 82, y + 3, { width: colLeft.w - 86, align: 'right' });

    doc.text('Total Dscto.', midX + 4, y + 3, { width: 80 })
      .text(`S/ ${fmt(Number(detalle.totalDescuento))}`, midX + 84, y + 3, { width: colRight.w - 88, align: 'right' });
    y += totRowH + 6;

    // ─────────────────────────────────────────────────────────────────
    // NETO RECIBIDO — prominent
    // ─────────────────────────────────────────────────────────────────
    const netoH = 20;
    doc.rect(left, y, W, netoH).fillAndStroke('#F0F0EA', C.line);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(C.ink)
      .text('Neto Recibido:', left + 4, y + 5, { continued: true })
      .fontSize(11)
      .text(`  S/ ${fmt(Number(detalle.netoPago))}`, { width: W - 8, align: 'right' });
    y += netoH + 14;

    // ─────────────────────────────────────────────────────────────────
    // FOOTER
    // ─────────────────────────────────────────────────────────────────
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(C.soft).stroke();
    y += 8;

    doc.fontSize(8).font('Helvetica').fillColor(C.ink)
      .text(`Lima, ${lastDayOfMes(mes)}`, left, y);
    y += 30;

    // Signature lines
    const sigW = 160;
    const sigGap = W - sigW * 2;
    const sigPad = sigGap / 2;

    doc.moveTo(left + sigPad, y).lineTo(left + sigPad + sigW, y).lineWidth(0.8).strokeColor(C.line).stroke();
    doc.moveTo(right - sigPad - sigW, y).lineTo(right - sigPad, y).stroke();

    y += 4;
    doc.fontSize(7.5).font('Helvetica').fillColor(C.ink)
      .text('Firma Empleador', left + sigPad, y, { width: sigW, align: 'center' })
      .text('Firma Trabajador', right - sigPad - sigW, y, { width: sigW, align: 'center' });

    doc.end();
  });
}
