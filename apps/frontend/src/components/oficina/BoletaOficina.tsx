import { Printer, X } from 'lucide-react';
import { type PlanillaOficinaDetalle } from '@/lib/api.js';
import { fmtPEN } from '@/lib/utils.js';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 border-b border-line/40 last:border-0">
      <span className="text-[11px] text-ink-3 truncate">{label}</span>
      <span className="text-[11px] font-mono tabular-nums text-foreground whitespace-nowrap">{value}</span>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-[10.5px] text-ink-4 w-24 shrink-0">{label}</span>
      <span className="text-[11px] text-foreground">{value}</span>
    </div>
  );
}

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
  const n = (v: string | null | undefined) => Number(v ?? 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-backdropIn"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl rounded-xl border border-line bg-bg-elev shadow-xl animate-modalPop overflow-y-auto max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-line">
          <div>
            <div className="text-[10.5px] font-mono uppercase tracking-widest text-ink-4 mb-0.5">
              Boleta de Pago
            </div>
            <div className="text-[14px] font-semibold text-foreground">
              {razonSocial ?? 'MM HIGH METRIK'}
            </div>
            {ruc && <div className="text-[11px] text-ink-3">RUC {ruc}</div>}
            {mes && <div className="text-[11px] text-ink-3">Período: {mes}</div>}
            {d.boletaCorrelativo && (
              <div className="text-[11px] text-ink-3">N° {d.boletaCorrelativo}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-md border border-line hover:bg-bg-sunken text-ink-3 hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Datos del trabajador */}
        <div className="p-4 border-b border-line bg-bg-sunken/40">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mb-2">
            Datos del Trabajador
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <DataRow label="Nombre" value={d.nombre} />
            <DataRow label="Cargo" value={d.cargo} />
            <DataRow label="DNI" value={d.dni} />
            <DataRow label="AFP" value={d.afp} />
            <DataRow label="CUSPP" value={d.cuspp} />
            <DataRow
              label="Días trab."
              value={d.diasTrab != null ? String(d.diasTrab) : undefined}
            />
            <DataRow
              label="Horas trab."
              value={d.horasTrab != null ? String(d.horasTrab) : undefined}
            />
          </div>
        </div>

        {/* Columnas remuneraciones / descuentos */}
        <div className="grid grid-cols-2 gap-0 divide-x divide-line">
          {/* Remuneraciones */}
          <div className="p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mb-2">
              Remuneraciones
            </div>
            <div className="space-y-0">
              <Row label="Mensual" value={fmtPEN(n(d.sueldoMensual))} />
              {n(d.totalHe) > 0 && (
                <Row label="Horas Extras" value={fmtPEN(n(d.totalHe))} />
              )}
              {n(d.montoDominical) > 0 && (
                <Row label="Dominical" value={fmtPEN(n(d.montoDominical))} />
              )}
              {n(d.montoFeriado) > 0 && (
                <Row label="Feriado" value={fmtPEN(n(d.montoFeriado))} />
              )}
              {n(d.asigFamiliar) > 0 && (
                <Row label="Asig. Familiar" value={fmtPEN(n(d.asigFamiliar))} />
              )}
              {n(d.gratificacion) > 0 && (
                <Row label="Gratificaciones" value={fmtPEN(n(d.gratificacion))} />
              )}
              {n(d.vacaciones) > 0 && (
                <Row label="Vacaciones" value={fmtPEN(n(d.vacaciones))} />
              )}
              {n(d.comisiones) > 0 && (
                <Row label="Comisiones" value={fmtPEN(n(d.comisiones))} />
              )}
              {n(d.bonificacion) > 0 && (
                <Row label="Bonificaciones" value={fmtPEN(n(d.bonificacion))} />
              )}
            </div>
            <div className="mt-2 pt-2 border-t border-line flex justify-between">
              <span className="text-[11px] font-semibold">Total Bruto</span>
              <span className="text-[11px] font-mono font-semibold tabular-nums">
                {fmtPEN(n(d.totalBruto))}
              </span>
            </div>
          </div>

          {/* Aportes y descuentos */}
          <div className="p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mb-2">
              Aportes y Descuentos
            </div>
            <div className="text-[9.5px] font-mono uppercase tracking-wider text-ink-4 mb-1 mt-1">
              Trabajador
            </div>
            <div className="space-y-0">
              {n(d.onp) > 0 && <Row label="ONP" value={fmtPEN(n(d.onp))} />}
              {n(d.afpAporte) > 0 && (
                <Row label="AFP Pensión" value={fmtPEN(n(d.afpAporte))} />
              )}
              {n(d.afpSeguro) > 0 && (
                <Row label="AFP Seguro" value={fmtPEN(n(d.afpSeguro))} />
              )}
              {n(d.afpComision) > 0 && (
                <Row label="AFP Com." value={fmtPEN(n(d.afpComision))} />
              )}
              {n(d.imptoRenta5ta) > 0 && (
                <Row label="Impto. Renta 5ta" value={fmtPEN(n(d.imptoRenta5ta))} />
              )}
              {n(d.retencionJudicial) > 0 && (
                <Row label="Retenc. Judicial" value={fmtPEN(n(d.retencionJudicial))} />
              )}
              {n(d.adelantoCuota) > 0 && (
                <Row label="Adelantos" value={fmtPEN(n(d.adelantoCuota))} />
              )}
              {n(d.otrosDescuentos) > 0 && (
                <Row label="Descuentos" value={fmtPEN(n(d.otrosDescuentos))} />
              )}
            </div>
            {n(d.essalud) > 0 && (
              <>
                <div className="text-[9.5px] font-mono uppercase tracking-wider text-ink-4 mb-1 mt-2">
                  Empleador
                </div>
                <Row label="Reg. Salud / EsSalud" value={fmtPEN(n(d.essalud))} />
              </>
            )}
            <div className="mt-2 pt-2 border-t border-line space-y-1">
              <div className="flex justify-between">
                <span className="text-[11px] text-ink-3">Total Descuento</span>
                <span className="text-[11px] font-mono tabular-nums text-ink-3">
                  {fmtPEN(n(d.totalDescuento))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[11px] font-semibold">Neto Recibido</span>
                <span className="text-[11px] font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fmtPEN(n(d.netoPago))}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-line">
          <button
            onClick={onClose}
            className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken transition-colors"
          >
            Cerrar
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 transition-opacity"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}
