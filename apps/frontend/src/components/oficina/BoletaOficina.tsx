import { Printer, X } from 'lucide-react';
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { type PlanillaOficinaDetalle } from '@/lib/api.js';
import { fmtPEN } from '@/lib/utils.js';
import { printSheet } from '@/lib/printSheet.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function n(v: string | null | undefined): number {
  return Number(v ?? 0);
}

function amt(v: string | null | undefined): string {
  return fmtPEN(n(v));
}

const MONTH_ABBR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** '2026-07' → 'Jul-26' */
function mesMmAA(mes: string | undefined): string {
  if (!mes) return '';
  const parts = mes.split('-');
  const y = parts[0] ?? '';
  const m = parts[1] ?? '';
  const idx = Number(m) - 1;
  return `${MONTH_ABBR[idx] ?? m}-${y.slice(2)}`;
}

/** '2026-07' → last day as 'dd/mm/yyyy' */
function lastDayOfMes(mes: string | undefined): string {
  if (!mes) return '';
  const [y, m] = mes.split('-');
  const d = new Date(Number(y), Number(m), 0); // day=0 → last day of prev month = last day of m
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ─── main component ────────────────────────────────────────────────────────────

export function BoletaOficina({
  detalle,
  razonSocial,
  ruc,
  direccion,
  mes,
  onClose,
}: {
  detalle: PlanillaOficinaDetalle;
  razonSocial?: string;
  ruc?: string;
  direccion?: string;
  mes?: string;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const d = detalle;
  const mesLabel = mesMmAA(mes);
  const lastDay = lastDayOfMes(mes);
  const correlativo = d.boletaCorrelativo ?? '';

  const handlePrint = () => {
    if (sheetRef.current) {
      printSheet(sheetRef.current, {
        title: `Boleta ${correlativo}`,
        styles: BOLETA_STYLES,
        logoUrl: '/logo-mm.png',
        fitHeightMm: 271,
      });
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-black/45 to-black/65 backdrop-blur-sm p-4 sm:p-8"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Card contenedora · dialog flotante */}
      <div
        className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-xl border border-line bg-bg-elev shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-line px-5 py-2.5 bg-bg-elev shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <h2 className="text-[13px] font-bold tracking-[0.02em] truncate">
                BOLETA DE PAGO{correlativo ? ` N° ${correlativo}` : ''}
              </h2>
              <p className="text-[10.5px] text-ink-3 mt-0.5 truncate">
                {d.nombre ?? '—'} · {mesLabel || (mes ?? '')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90"
              title="Imprimir o guardar como PDF"
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimir / Guardar PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded text-ink-3 hover:bg-bg-sunken"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scroll viewport · sheet centrada · fondo gris claro */}
        <div className="bol-preview-scroll flex-1">
          <div ref={sheetRef} className="bol-print-sheet">
            <style>{BOLETA_STYLES}</style>
            <BoletaSheet
              d={d}
              razonSocial={razonSocial}
              ruc={ruc}
              direccion={direccion}
              mesLabel={mesLabel}
              lastDay={lastDay}
              correlativo={correlativo}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── inner sheet component ─────────────────────────────────────────────────────

function BoletaSheet({
  d,
  razonSocial,
  ruc,
  direccion,
  mesLabel,
  lastDay,
  correlativo,
}: {
  d: PlanillaOficinaDetalle;
  razonSocial?: string;
  ruc?: string;
  direccion?: string;
  mesLabel: string;
  lastDay: string;
  correlativo: string;
}) {
  return (
    <div className="bol-content">

      {/* ── Header: logo (left) + N° Boleta (right) ── */}
      <div className="bol-header">
        <div className="bol-logo-wrap">
          <img src="/logo-mm.png" alt="MM HIGH METRIK" className="bol-logo" />
          <div className="bol-logo-fallback">
            <div className="bol-logo-mm">MM</div>
            <div className="bol-logo-sub">HIGH METRIK ENGINEERS</div>
          </div>
        </div>
        <div className="bol-header-right">
          <div className="bol-header-emisor">
            <div><span className="bol-kv-label">Razon Social</span><span className="bol-colon">:</span> {razonSocial ?? 'MM HIGH METRIK ENGINEERS S.A.C.'}</div>
            <div><span className="bol-kv-label">Direccion</span><span className="bol-colon">:</span> {direccion ?? '—'}</div>
            <div><span className="bol-kv-label">R.U.C.</span><span className="bol-colon">:</span> {ruc ?? '—'}</div>
          </div>
          <div className="bol-correlativo-box">
            <div className="bol-correlativo-lbl">N° BOLETA</div>
            <div className="bol-correlativo-val">{correlativo || '—'}</div>
          </div>
        </div>
      </div>

      {/* ── Título ── */}
      <div className="bol-title">BOLETA DE PAGO</div>

      {/* ── Datos del trabajador ── */}
      <div className="bol-section-title">Datos del Trabajador</div>
      <table className="bol-data-table">
        <tbody>
          <tr>
            <td className="bol-dt-label">Nombre</td>
            <td className="bol-dt-val" colSpan={3}>{d.nombre ?? '—'}</td>
            <td className="bol-dt-label">Cargo</td>
            <td className="bol-dt-val">{d.cargo ?? '—'}</td>
          </tr>
          <tr>
            <td className="bol-dt-label">Fecha Ing.</td>
            <td className="bol-dt-val">{d.fechaIngreso ?? '—'}</td>
            <td className="bol-dt-label">Fecha cese</td>
            <td className="bol-dt-val">{d.fechaCese ?? '—'}</td>
            <td className="bol-dt-label">DNI</td>
            <td className="bol-dt-val">{d.dni ?? '—'}</td>
          </tr>
          <tr>
            <td className="bol-dt-label">A.F.P.</td>
            <td className="bol-dt-val">{d.afp ?? '—'}</td>
            <td className="bol-dt-label">CUSPP</td>
            <td className="bol-dt-val">{d.cuspp ?? '—'}</td>
            <td className="bol-dt-label">Dias Trab.</td>
            <td className="bol-dt-val">{d.diasTrab != null ? String(d.diasTrab) : '—'}</td>
          </tr>
          <tr>
            <td className="bol-dt-label">Horas Trab</td>
            <td className="bol-dt-val" colSpan={5}>{d.horasTrab != null ? String(d.horasTrab) : '—'}</td>
          </tr>
        </tbody>
      </table>

      {/* ── Two-column: REMUNERACIONES | APORTES Y DESCUENTOS ── */}
      <div className="bol-two-col-wrap">

        {/* LEFT: REMUNERACIONES */}
        <table className="bol-pay-table">
          <thead>
            <tr>
              <th colSpan={2} className="bol-band-header">Remuneraciones</th>
            </tr>
            <tr>
              <th className="bol-sub-header">Mes de: {mesLabel}</th>
              <th className="bol-sub-header bol-cell-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Mensual</td>         <td className="bol-cell-right bol-cell-num">{amt(d.sueldoMensual)}</td></tr>
            <tr><td>Dominical</td>        <td className="bol-cell-right bol-cell-num">{amt(d.montoDominical)}</td></tr>
            <tr><td>Horas Extras</td>     <td className="bol-cell-right bol-cell-num">{amt(d.totalHe)}</td></tr>
            <tr><td>Destajos</td>         <td className="bol-cell-right bol-cell-num">{fmtPEN(0)}</td></tr>
            <tr><td>Bonificaciones</td>   <td className="bol-cell-right bol-cell-num">{amt(d.bonificacion)}</td></tr>
            <tr><td>Gratificaciones</td>  <td className="bol-cell-right bol-cell-num">{amt(d.gratificacion)}</td></tr>
            <tr><td>Vacaciones</td>       <td className="bol-cell-right bol-cell-num">{amt(d.vacaciones)}</td></tr>
            <tr><td>Comisiones</td>       <td className="bol-cell-right bol-cell-num">{amt(d.comisiones)}</td></tr>
            <tr><td>Asig. Familiar</td>   <td className="bol-cell-right bol-cell-num">{amt(d.asigFamiliar)}</td></tr>
            <tr><td>Ley 26504</td>        <td className="bol-cell-right bol-cell-num">{fmtPEN(0)}</td></tr>
            <tr><td>Afp 10.23%,3%</td>    <td className="bol-cell-right bol-cell-num">{fmtPEN(0)}</td></tr>
            <tr><td>Otros</td>            <td className="bol-cell-right bol-cell-num">{fmtPEN(0)}</td></tr>
          </tbody>
        </table>

        {/* RIGHT: APORTES Y DESCUENTOS */}
        <table className="bol-pay-table">
          <thead>
            <tr>
              <th colSpan={3} className="bol-band-header">Aportes y Descuentos</th>
            </tr>
            <tr>
              <th className="bol-sub-header">Motivo</th>
              <th className="bol-sub-header bol-cell-right">Empleador</th>
              <th className="bol-sub-header bol-cell-right">Trabajador</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>O.N.P.</td>
              <td className="bol-cell-right bol-cell-num"></td>
              <td className="bol-cell-right bol-cell-num">{amt(d.onp)}</td>
            </tr>
            <tr>
              <td>Essalud Vida</td>
              <td className="bol-cell-right bol-cell-num">{amt(d.essaludVida)}</td>
              <td className="bol-cell-right bol-cell-num"></td>
            </tr>
            <tr>
              <td>Impto. Renta</td>
              <td className="bol-cell-right bol-cell-num"></td>
              <td className="bol-cell-right bol-cell-num">{amt(d.imptoRenta5ta)}</td>
            </tr>
            <tr>
              <td>Retenc. Judic.</td>
              <td className="bol-cell-right bol-cell-num"></td>
              <td className="bol-cell-right bol-cell-num">{amt(d.retencionJudicial)}</td>
            </tr>
            <tr>
              <td>AFP pension</td>
              <td className="bol-cell-right bol-cell-num"></td>
              <td className="bol-cell-right bol-cell-num">{amt(d.afpAporte)}</td>
            </tr>
            <tr>
              <td>AFP Seguro</td>
              <td className="bol-cell-right bol-cell-num"></td>
              <td className="bol-cell-right bol-cell-num">{amt(d.afpSeguro)}</td>
            </tr>
            <tr>
              <td>AFP Com.%</td>
              <td className="bol-cell-right bol-cell-num"></td>
              <td className="bol-cell-right bol-cell-num">{amt(d.afpComision)}</td>
            </tr>
            <tr>
              <td>Adelantos</td>
              <td className="bol-cell-right bol-cell-num"></td>
              <td className="bol-cell-right bol-cell-num">{amt(d.adelantoCuota)}</td>
            </tr>
            <tr>
              <td>Descuentos</td>
              <td className="bol-cell-right bol-cell-num"></td>
              <td className="bol-cell-right bol-cell-num">{amt(d.otrosDescuentos)}</td>
            </tr>
            <tr>
              <td>Reg. Salud</td>
              <td className="bol-cell-right bol-cell-num">{amt(d.essalud)}</td>
              <td className="bol-cell-right bol-cell-num"></td>
            </tr>
            <tr className="bol-row-total-aporte">
              <td><strong>Total Aporte S/.</strong></td>
              <td className="bol-cell-right bol-cell-num"><strong>{amt(d.totalAporte)}</strong></td>
              <td className="bol-cell-right bol-cell-num"></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Totals band ── */}
      <table className="bol-totals-table">
        <tbody>
          <tr>
            <td className="bol-total-cell"><strong>Total Bruto</strong></td>
            <td className="bol-total-cell bol-cell-right bol-cell-num"><strong>{amt(d.totalBruto)}</strong></td>
            <td className="bol-total-cell"><strong>Total Dscto.</strong></td>
            <td className="bol-total-cell bol-cell-right bol-cell-num"><strong>{amt(d.totalDescuento)}</strong></td>
          </tr>
        </tbody>
      </table>

      {/* ── Neto Recibido ── */}
      <table className="bol-neto-table">
        <tbody>
          <tr>
            <td className="bol-neto-label">Neto Recibido</td>
            <td className="bol-neto-val">{amt(d.netoPago)}</td>
          </tr>
        </tbody>
      </table>

      {/* ── Footer ── */}
      <div className="bol-footer">
        <div className="bol-footer-lugar">Lima, {lastDay}</div>
        <div className="bol-firmas">
          <div className="bol-firma-area">
            <div className="bol-firma-line" />
            <div className="bol-firma-caption">Firma Empleador</div>
          </div>
          <div className="bol-firma-area">
            <div className="bol-firma-line" />
            <div className="bol-firma-caption">Firma Trabajador</div>
          </div>
        </div>
      </div>

    </div>
  );
}

// ─── CSS · estilo documento formal (espejo de OcPdfPreview) ───────────────────
const BOLETA_STYLES = `
.bol-preview-scroll {
  overflow: auto;
  background: #EEEEE9;
  padding: 24px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

/* La hoja A4 blanca */
.bol-print-sheet {
  width: 210mm;
  margin: 0 auto;
  padding: 12mm 16mm 10mm;
  background: #FFFFFF;
  color: #000000;
  font-family: 'Calibri', 'Segoe UI', 'Inter', sans-serif;
  font-size: 10pt;
  line-height: 1.35;
  box-shadow: 0 4px 20px rgba(0,0,0,0.12);
  box-sizing: border-box;
  flex-shrink: 0;
}

/* ── Header ── */
.bol-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 4mm;
  gap: 8mm;
}
.bol-logo-wrap {
  position: relative;
  width: 55mm;
  height: 18mm;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.bol-logo {
  max-height: 18mm;
  max-width: 55mm;
  object-fit: contain;
}
.bol-logo-fallback {
  display: none;
  flex-direction: column;
  gap: 2px;
}
.bol-logo-mm {
  font-size: 28pt;
  font-weight: 900;
  color: #1C1C1C;
  letter-spacing: -2pt;
  line-height: 0.9;
}
.bol-logo-sub {
  font-size: 6pt;
  font-weight: 700;
  color: #3D3D3A;
  letter-spacing: 2pt;
  text-transform: uppercase;
}

.bol-header-right {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-start;
  flex: 1;
  gap: 6mm;
}

.bol-header-emisor {
  font-size: 8.5pt;
  line-height: 1.5;
}

.bol-kv-label {
  font-weight: 700;
}
.bol-colon {
  margin: 0 1mm;
}

.bol-correlativo-box {
  text-align: right;
  flex-shrink: 0;
  border: 1pt solid #000;
  padding: 1.5mm 3mm;
  min-width: 32mm;
}
.bol-correlativo-lbl {
  font-size: 7.5pt;
  font-weight: 700;
  color: #1C1C1C;
  margin-top: 0.5mm;
}
.bol-correlativo-val {
  font-size: 11pt;
  font-weight: 700;
  color: #000;
  margin-top: 0.5mm;
}

/* ── Título ── */
.bol-title {
  text-align: center;
  font-weight: 700;
  font-size: 11pt;
  letter-spacing: 0.5pt;
  border-bottom: 1.2pt solid #000;
  padding: 2mm 0;
  margin-bottom: 3mm;
}

/* ── Section band (gray bar like OC) ── */
.bol-section-title {
  background: #EEEEE9;
  border: 0.5pt solid #000;
  padding: 1mm 2mm;
  font-weight: 700;
  font-size: 9pt;
  text-transform: uppercase;
  letter-spacing: 0.5pt;
  margin-bottom: 0;
}

/* ── Datos del trabajador table ── */
.bol-data-table {
  width: 100%;
  border-collapse: collapse;
  border-left: 1pt solid #000;
  border-right: 1pt solid #000;
  border-bottom: 1pt solid #000;
  font-size: 8.5pt;
  margin-bottom: 3mm;
}
.bol-data-table td {
  border: 0.5pt solid #000;
  padding: 1mm 2mm;
  vertical-align: middle;
}
.bol-dt-label {
  background: #F8F7F3;
  font-weight: 700;
  width: 22mm;
  color: #1C1C1C;
  white-space: nowrap;
}
.bol-dt-val {
  min-width: 24mm;
}

/* ── Two-column pay/discount grid ── */
.bol-two-col-wrap {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1pt solid #000;
  margin-bottom: 0;
}
.bol-pay-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 8.5pt;
}
.bol-pay-table:first-child {
  border-right: 0.5pt solid #000;
}
.bol-pay-table th,
.bol-pay-table td {
  border: 0.5pt solid #000;
  padding: 1mm 2mm;
  vertical-align: middle;
  color: #000;
}
.bol-band-header {
  background: #EEEEE9;
  font-weight: 700;
  font-size: 9pt;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.5pt;
  padding: 1.5mm 2mm;
}
.bol-sub-header {
  background: #F8F7F3;
  font-size: 7.5pt;
  font-weight: 700;
  color: #3D3D3A;
}
.bol-cell-right {
  text-align: right;
}
.bol-cell-num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.bol-row-total-aporte td {
  background: #F8F7F3;
  border-top: 1pt solid #000;
}

/* ── Totals band ── */
.bol-totals-table {
  width: 100%;
  border-collapse: collapse;
  border: 1pt solid #000;
  border-top: none;
  font-size: 9pt;
  margin-bottom: 0;
}
.bol-totals-table td {
  border: 0.5pt solid #000;
  padding: 1.5mm 2mm;
  vertical-align: middle;
}
.bol-total-cell {
  background: #EEEEE9;
}

/* ── Neto recibido ── */
.bol-neto-table {
  width: 100%;
  border-collapse: collapse;
  border: 1pt solid #000;
  border-top: none;
  font-size: 10pt;
  margin-bottom: 4mm;
}
.bol-neto-table td {
  border: 0.5pt solid #000;
  padding: 2mm 2mm;
  vertical-align: middle;
}
.bol-neto-label {
  font-weight: 700;
  font-size: 11pt;
}
.bol-neto-val {
  background: #F0F9F0;
  font-weight: 700;
  font-size: 12pt;
  text-align: right;
  color: #1A5C1A;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  width: 48mm;
}

/* ── Footer ── */
.bol-footer {
  margin-top: 6mm;
  font-size: 9pt;
}
.bol-footer-lugar {
  margin-bottom: 12mm;
  color: #1C1C1C;
}
.bol-firmas {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20mm;
  margin-top: 10mm;
}
.bol-firma-area {
  text-align: center;
}
.bol-firma-line {
  border-top: 1pt solid #1C1C1C;
  margin-bottom: 2mm;
}
.bol-firma-caption {
  font-size: 8pt;
  color: #1C1C1C;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5pt;
}

/* Page breaks */
.bol-header,
.bol-title,
.bol-data-table,
.bol-two-col-wrap,
.bol-totals-table,
.bol-neto-table,
.bol-footer,
.bol-firmas { page-break-inside: avoid; break-inside: avoid; }

@media print {
  html, body {
    background: #FFFFFF !important;
    margin: 0;
    padding: 0;
  }
  @page { size: A4; margin: 14mm 16mm 12mm 16mm; }
  .bol-preview-scroll { background: white !important; padding: 0 !important; }
  .bol-print-sheet { box-shadow: none !important; margin: 0; padding: 0; width: auto; min-height: 0; }
}
`;
