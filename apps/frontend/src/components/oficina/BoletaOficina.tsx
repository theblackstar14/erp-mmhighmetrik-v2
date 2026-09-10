import { Printer, X } from 'lucide-react';
import { type PlanillaOficinaDetalle } from '@/lib/api.js';
import { fmtPEN } from '@/lib/utils.js';

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

// ─── sub-components ────────────────────────────────────────────────────────────

function SectionBand({ children }: { children: string }) {
  return (
    <div className="bg-bg-sunken border-y border-line px-3 py-0.5 text-[9.5px] font-mono font-semibold uppercase tracking-widest text-ink-3">
      {children}
    </div>
  );
}

function RemRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-[2px] border-b border-line/30 last:border-0 gap-1">
      <span className="text-[11px] text-ink-2 truncate">{label}</span>
      <span className="text-[11px] font-mono tabular-nums text-foreground whitespace-nowrap">{value}</span>
    </div>
  );
}

/** Three-column row: label | empleador-amount | trabajador-amount */
function ApdRow({
  label,
  empleador,
  trabajador,
}: {
  label: string;
  empleador?: string;
  trabajador?: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 py-[2px] border-b border-line/30 last:border-0">
      <span className="text-[11px] text-ink-2 truncate">{label}</span>
      <span className="text-[11px] font-mono tabular-nums text-ink-3 w-[70px] text-right">
        {empleador ?? ''}
      </span>
      <span className="text-[11px] font-mono tabular-nums text-foreground w-[70px] text-right">
        {trabajador ?? ''}
      </span>
    </div>
  );
}

function DataField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0">
      <span className="text-[9.5px] text-ink-4 font-mono uppercase tracking-wide">{label}</span>
      <span className="text-[11px] text-foreground">{value ?? '—'}</span>
    </div>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

export function BoletaOficina({
  detalle,
  razonSocial,
  ruc,
  mes,
  onClose,
}: {
  detalle: PlanillaOficinaDetalle;
  razonSocial?: string;
  ruc?: string;
  mes?: string;
  onClose: () => void;
}) {
  const d = detalle;
  const mesLabel = mesMmAA(mes);
  const lastDay = lastDayOfMes(mes);

  // Derive direccion from prop (may be extended later; show dash if absent)
  const direccion: string | undefined = undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-backdropIn print:bg-transparent print:static print:p-0"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-3xl rounded-xl border border-line bg-white text-black shadow-xl animate-modalPop overflow-y-auto max-h-[90vh] print:shadow-none print:border-0 print:rounded-none print:max-h-none print:overflow-visible">

        {/* ── Topbar: close + print ─────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-2 p-2 border-b border-line print:hidden">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 transition-opacity"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir
          </button>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-md border border-line hover:bg-bg-sunken text-ink-3 hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Boleta content ────────────────────────────────────────────────── */}
        <div className="p-4 space-y-0 text-[11px]">

          {/* BOLETA DE PAGO header */}
          <div className="text-center mb-2">
            <div className="text-[18px] font-bold tracking-wide uppercase">BOLETA DE PAGO</div>
          </div>

          {/* Company header: left info + right correlativo */}
          <div className="flex justify-between items-start border border-line p-2 mb-2">
            <div className="space-y-0.5">
              <div><span className="font-semibold">Razon Social:</span> {razonSocial ?? 'MM HIGH METRIK SAC'}</div>
              <div><span className="font-semibold">Direccion:</span> {direccion ?? '—'}</div>
              <div><span className="font-semibold">R.U.C.:</span> {ruc ?? '—'}</div>
            </div>
            {d.boletaCorrelativo && (
              <div className="text-right">
                <div className="text-[9.5px] font-mono uppercase text-ink-4">N° Boleta</div>
                <div className="text-[14px] font-mono font-semibold">{d.boletaCorrelativo}</div>
              </div>
            )}
          </div>

          {/* DATOS DEL TRABAJADOR */}
          <SectionBand>Datos del Trabajador</SectionBand>
          <div className="border border-t-0 border-line p-2 mb-2">
            <div className="grid grid-cols-3 gap-x-4 gap-y-2">
              <DataField label="Nombre" value={d.nombre} />
              <DataField label="Cargo" value={d.cargo} />
              <DataField label="Fecha Ing." value={d.fechaIngreso} />
              <DataField label="Fecha cese" value={d.fechaCese} />
              <DataField label="DNI" value={d.dni} />
              <DataField label="A.F.P." value={d.afp} />
              <DataField label="CUSPP" value={d.cuspp} />
              <DataField label="Dias Trab." value={d.diasTrab != null ? String(d.diasTrab) : null} />
              <DataField label="Horas Trab" value={d.horasTrab != null ? String(d.horasTrab) : null} />
            </div>
          </div>

          {/* Two-column: REMUNERACIONES | APORTES Y DESCUENTOS */}
          <div className="grid grid-cols-2 border border-line divide-x divide-line mb-2">

            {/* LEFT: REMUNERACIONES */}
            <div>
              <div className="bg-bg-sunken border-b border-line px-2 py-1 text-[9.5px] font-mono font-semibold uppercase tracking-widest text-ink-3">
                Remuneraciones
              </div>
              <div className="px-2 py-1 border-b border-line/50">
                <div className="flex justify-between text-[9.5px] font-mono text-ink-3">
                  <span>Mes de: {mesLabel}</span>
                  <span>Importe</span>
                </div>
              </div>
              <div className="px-2 py-1 space-y-0">
                <RemRow label="Mensual"          value={amt(d.sueldoMensual)} />
                <RemRow label="Dominical"         value={amt(d.montoDominical)} />
                <RemRow label="Horas Extras"      value={amt(d.totalHe)} />
                <RemRow label="Destajos"          value={fmtPEN(0)} />
                <RemRow label="Bonificaciones"    value={amt(d.bonificacion)} />
                <RemRow label="Gratificaciones"   value={amt(d.gratificacion)} />
                <RemRow label="Vacaciones"        value={amt(d.vacaciones)} />
                <RemRow label="Comisiones"        value={amt(d.comisiones)} />
                <RemRow label="Asig. Familiar"    value={amt(d.asigFamiliar)} />
                <RemRow label="Ley 26504"         value={fmtPEN(0)} />
                <RemRow label="Afp 10.23%,3%"     value={fmtPEN(0)} />
                <RemRow label="Otros"             value={fmtPEN(0)} />
              </div>
            </div>

            {/* RIGHT: APORTES Y DESCUENTOS */}
            <div>
              <div className="bg-bg-sunken border-b border-line px-2 py-1 text-[9.5px] font-mono font-semibold uppercase tracking-widest text-ink-3">
                Aportes y Descuentos
              </div>
              <div className="px-2 py-1 border-b border-line/50">
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 text-[9.5px] font-mono text-ink-3">
                  <span>Motivo</span>
                  <span className="w-[70px] text-right">Empleador</span>
                  <span className="w-[70px] text-right">Trabajador</span>
                </div>
              </div>
              <div className="px-2 py-1 space-y-0">
                <ApdRow label="O.N.P."          trabajador={amt(d.onp)} />
                <ApdRow label="Essalud Vida"    empleador={amt(d.essaludVida)} />
                <ApdRow label="Impto. Renta"    trabajador={amt(d.imptoRenta5ta)} />
                <ApdRow label="Retenc. Judic."  trabajador={amt(d.retencionJudicial)} />
                <ApdRow label="AFP pension"     trabajador={amt(d.afpAporte)} />
                <ApdRow label="AFP Seguro"      trabajador={amt(d.afpSeguro)} />
                <ApdRow label="AFP Com.%"       trabajador={amt(d.afpComision)} />
                <ApdRow label="Adelantos"       trabajador={amt(d.adelantoCuota)} />
                <ApdRow label="Descuentos"      trabajador={amt(d.otrosDescuentos)} />
                <ApdRow label="Reg. Salud"      empleador={amt(d.essalud)} />
              </div>
              <div className="border-t border-line px-2 py-1">
                <ApdRow label="Total Aporte S/." empleador={amt(d.totalAporte)} />
              </div>
            </div>
          </div>

          {/* Totals row */}
          <div className="grid grid-cols-2 border border-line divide-x divide-line mb-2">
            <div className="flex justify-between items-center px-2 py-1">
              <span className="text-[11px] font-semibold">Total Bruto</span>
              <span className="text-[11px] font-mono tabular-nums font-semibold">{amt(d.totalBruto)}</span>
            </div>
            <div className="flex justify-between items-center px-2 py-1">
              <span className="text-[11px] font-semibold">Total Dscto.</span>
              <span className="text-[11px] font-mono tabular-nums font-semibold">{amt(d.totalDescuento)}</span>
            </div>
          </div>

          {/* Neto Recibido */}
          <div className="border border-line px-2 py-1.5 mb-2 flex justify-between items-center">
            <span className="text-[13px] font-bold">Neto Recibido</span>
            <span className="text-[14px] font-bold font-mono tabular-nums text-emerald-700">{amt(d.netoPago)}</span>
          </div>

          {/* Footer */}
          <div className="mt-4 pt-2 space-y-6">
            <div className="text-[11px]">Lima, {lastDay}</div>
            <div className="grid grid-cols-2 gap-8 mt-8">
              <div className="text-center">
                <div className="border-t border-black/40 pt-1 text-[11px]">Firma Empleador</div>
              </div>
              <div className="text-center">
                <div className="border-t border-black/40 pt-1 text-[11px]">Firma Trabajador</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
