import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { type PlanillaOficinaDetalle, ApiError, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';
import { CuentaContableSelect } from '@/components/contabilidad/CuentaContableSelect.js';
import { DocumentoAdjunto } from '@/components/oficina/DocumentoAdjunto.js';
import { BoletaOficina } from '@/components/oficina/BoletaOficina.js';
import { AdelantosPanel } from '@/components/oficina/AdelantosPanel.js';
import { useAuthStore } from '@/lib/auth-store.js';

const ESTADO_BADGE: Record<string, { l: string; cls: string }> = {
  borrador:  { l: 'Borrador',   cls: 'bg-bg-sunken text-ink-3' },
  calculada: { l: 'Calculada',  cls: 'bg-blue-500/15 text-blue-600' },
  cerrada:   { l: 'Cerrada',    cls: 'bg-emerald-500/15 text-emerald-600' },
  pagada:    { l: 'Pagada',     cls: 'bg-emerald-500/25 text-emerald-700' },
};

type ModalState =
  | { kind: 'boleta'; det: PlanillaOficinaDetalle }
  | { kind: 'adelantos'; det: PlanillaOficinaDetalle }
  | null;

// Simple Modal wrapper
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl border border-line bg-bg-elev shadow-2xl animate-modalPop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-[14px] font-semibold">{title}</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function PlanillaOficinaTab() {
  const qc = useQueryClient();

  // Empresa activa from auth store + full row (ruc/direccion) from admin endpoint
  const { empresaActiva, empresas: empresasMembresía } = useAuthStore();
  const { data: empresasData } = useQuery({
    queryKey: ['admin-empresas'],
    queryFn: () => api.admin.empresas.list(),
    staleTime: 5 * 60 * 1000,
  });
  const empresaRow = empresasData?.empresas.find((e) => e.id === empresaActiva?.id);
  const membresiaRow = empresasMembresía.find((e) => e.id === empresaActiva?.id);
  const empresaRazonSocial = empresaRow?.razonSocial ?? membresiaRow?.razonSocial ?? undefined;
  const empresaRuc = empresaRow?.ruc ?? undefined;
  const empresaDireccion = empresaRow?.direccion ?? undefined;

  // Default to current month YYYY-MM
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [modal, setModal] = useState<ModalState>(null);
  const [asientoMsg, setAsientoMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const qKey = ['planilla-oficina', mes] as const;

  const { data, isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () => api.oficina.getPlanillaOficina(mes),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: qKey });

  const crearMut = useMutation({
    mutationFn: () => api.oficina.crearPlanillaOficina(mes),
    onSuccess: invalidate,
    onError: (e: Error) => setErrMsg(e.message),
  });

  const calcularMut = useMutation({
    mutationFn: (id: string) => api.oficina.calcularPlanillaOficina(id),
    onSuccess: () => { setErrMsg(null); invalidate(); },
    onError: (e: Error) => setErrMsg(e.message),
  });

  const cerrarMut = useMutation({
    mutationFn: (id: string) => api.oficina.cerrarPlanillaOficina(id),
    onSuccess: (res) => {
      setErrMsg(null);
      setAsientoMsg(`Asiento generado: ${res.asientoId}`);
      invalidate();
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 423) {
        setErrMsg(`Periodo cerrado: ${e.message}`);
      } else {
        setErrMsg(e.message);
      }
    },
  });

  const reabrirMut = useMutation({
    mutationFn: (id: string) => api.oficina.reabrirPlanillaOficina(id),
    onSuccess: () => { setErrMsg(null); setAsientoMsg(null); invalidate(); },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 423) {
        setErrMsg(`Periodo cerrado: ${e.message}`);
      } else {
        setErrMsg(e.message);
      }
    },
  });

  const editarMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.oficina.editarDetalleOficina(id, patch),
    onSuccess: invalidate,
  });

  const planilla = data?.mes ?? null;
  const detalle = data?.detalle ?? [];
  const estado = planilla?.estado ?? null;
  const readonly = estado === 'cerrada' || estado === 'pagada';

  const totalBruto = detalle.reduce((s, d) => s + Number(d.totalBruto), 0);
  const totalNeto  = detalle.reduce((s, d) => s + Number(d.netoPago), 0);

  return (
    <div className="space-y-4">
      {/* Header row: month selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12.5px] font-medium">
          Mes:
          <input
            type="month"
            value={mes}
            onChange={(e) => { setMes(e.target.value); setAsientoMsg(null); setErrMsg(null); }}
            className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px]"
          />
        </label>

        {/* Estado badge + actions */}
        {planilla && (
          <>
            <span className={cn('rounded px-2 py-0.5 text-[11px] font-medium', ESTADO_BADGE[estado ?? '']?.cls ?? 'bg-bg-sunken text-ink-3')}>
              {ESTADO_BADGE[estado ?? '']?.l ?? estado}
            </span>

            {(estado === 'borrador' || estado === 'calculada') && (
              <button
                disabled={calcularMut.isPending}
                onClick={() => calcularMut.mutate(planilla.id)}
                className="inline-flex items-center h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50"
              >
                {calcularMut.isPending ? 'Calculando…' : 'Calcular'}
              </button>
            )}

            {estado === 'calculada' && (
              <button
                disabled={cerrarMut.isPending}
                onClick={() => cerrarMut.mutate(planilla.id)}
                className="inline-flex items-center h-8 px-3 rounded-md bg-emerald-600 text-white text-[12px] font-medium disabled:opacity-50"
              >
                {cerrarMut.isPending ? 'Cerrando…' : 'Cerrar'}
              </button>
            )}

            {estado === 'cerrada' && (
              <button
                disabled={reabrirMut.isPending}
                onClick={() => reabrirMut.mutate(planilla.id)}
                className="inline-flex items-center h-8 px-3 rounded-md border border-line text-ink-2 text-[12px] font-medium disabled:opacity-50 hover:bg-bg-sunken"
              >
                {reabrirMut.isPending ? 'Reabriendo…' : 'Reabrir'}
              </button>
            )}
          </>
        )}

        {/* No planilla yet */}
        {!planilla && !isLoading && (
          <button
            disabled={crearMut.isPending}
            onClick={() => crearMut.mutate()}
            className="inline-flex items-center h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50"
          >
            {crearMut.isPending ? 'Creando…' : `Crear planilla de ${mes}`}
          </button>
        )}
      </div>

      {/* Feedback messages */}
      {asientoMsg && (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-[12px] text-emerald-600">
          {asientoMsg}
        </div>
      )}
      {errMsg && (
        <div className="rounded-md bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-[12px] text-rose-600">
          {errMsg}
        </div>
      )}

      {isLoading && (
        <div className="text-[12px] text-ink-4 py-4">Cargando…</div>
      )}

      {/* Detalle grid */}
      {planilla && detalle.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line bg-bg-elev">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-line bg-bg-sunken">
                {['Trabajador', 'Bruto', 'Renta 5ta', 'Cuenta contable', 'Adelanto', 'Dscto', 'Neto', 'Docs', 'Acciones'].map((h, i) => (
                  <th
                    key={i}
                    className={cn(
                      'px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4',
                      i >= 1 && i <= 6 ? 'text-right' : 'text-left',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detalle.map((det) => (
                <DetalleRow
                  key={det.id}
                  det={det}
                  readonly={readonly}
                  onEdit={(patch) => editarMut.mutate({ id: det.id, patch })}
                  onBoleta={() => setModal({ kind: 'boleta', det })}
                  onAdelantos={() => setModal({ kind: 'adelantos', det })}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-bg-sunken">
                <td className="px-3 py-2 text-[11px] font-semibold text-ink-3" colSpan={1}>Totales</td>
                <td className="px-3 py-2 text-right font-mono text-[11.5px] font-semibold tabular-nums">{fmtPEN(totalBruto)}</td>
                <td colSpan={4} />
                <td className="px-3 py-2 text-right font-mono text-[11.5px] font-bold tabular-nums text-primary">{fmtPEN(totalNeto)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {planilla && detalle.length === 0 && !isLoading && (
        <div className="rounded-md border border-line bg-bg-elev p-8 text-center text-[12px] text-ink-3">
          Sin trabajadores en la planilla. Asegúrate de tener administrativos registrados.
        </div>
      )}

      {/* Modals */}
      {modal?.kind === 'boleta' && (
        <BoletaOficina
          detalle={modal.det}
          mes={mes}
          razonSocial={empresaRazonSocial}
          ruc={empresaRuc}
          direccion={empresaDireccion}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'adelantos' && (
        <Modal
          title={`Adelantos — ${modal.det.nombre ?? ''}`}
          onClose={() => setModal(null)}
        >
          <AdelantosPanel
            empleadoId={modal.det.empleadoId}
            empleadoNombre={modal.det.nombre ?? undefined}
          />
        </Modal>
      )}
    </div>
  );
}

function DetalleRow({
  det,
  readonly,
  onEdit,
  onBoleta,
  onAdelantos,
}: {
  det: PlanillaOficinaDetalle;
  readonly: boolean;
  onEdit: (patch: Record<string, unknown>) => void;
  onBoleta: () => void;
  onAdelantos: () => void;
}) {
  const [renta, setRenta] = useState(String(Number(det.imptoRenta5ta) || ''));

  const handleRentaBlur = () => {
    const v = Number(renta);
    if (v !== Number(det.imptoRenta5ta)) {
      onEdit({ imptoRenta5ta: v });
    }
  };

  return (
    <tr className="border-b border-line/60 hover:bg-bg-sunken/30">
      {/* Trabajador */}
      <td className="px-3 py-2">
        <div className="text-[12px] font-medium">{det.nombre ?? '—'}</div>
        {det.cargo && <div className="text-[10.5px] text-ink-4">{det.cargo}</div>}
      </td>

      {/* Bruto */}
      <td className="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums">
        {fmtPEN(Number(det.totalBruto))}
      </td>

      {/* Renta 5ta (editable) */}
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          step="0.01"
          min="0"
          disabled={readonly}
          value={renta}
          onChange={(e) => setRenta(e.target.value)}
          onBlur={handleRentaBlur}
          className={cn(
            'h-7 w-20 px-1.5 text-right rounded-md border border-line bg-bg-elev font-mono text-[11.5px] tabular-nums',
            readonly && 'opacity-60 cursor-not-allowed',
          )}
        />
      </td>

      {/* Cuenta contable */}
      <td className="px-3 py-2 min-w-[160px]">
        {readonly ? (
          <span className="font-mono text-[11.5px] text-ink-3">{det.cuentaContable ?? '—'}</span>
        ) : (
          <CuentaContableSelect
            value={det.cuentaContable}
            onChange={(codigo) => onEdit({ cuentaContable: codigo })}
            soloHoja
            placeholder="Cuenta…"
            className="w-full"
          />
        )}
      </td>

      {/* Adelanto cuota */}
      <td className="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums text-ink-3">
        {fmtPEN(Number(det.adelantoCuota))}
      </td>

      {/* Descuento */}
      <td className="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums text-ink-3">
        {fmtPEN(Number(det.totalDescuento))}
      </td>

      {/* Neto */}
      <td className="px-3 py-2 text-right font-mono text-[11.5px] font-bold tabular-nums">
        {fmtPEN(Number(det.netoPago))}
      </td>

      {/* Docs */}
      <td className="px-3 py-2">
        <DocumentoAdjunto
          entidadTipo="planilla_oficina_detalle"
          entidadId={det.id}
        />
      </td>

      {/* Acciones */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onBoleta}
            className="h-7 px-2 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken hover:text-foreground"
          >
            Boleta
          </button>
          <button
            onClick={onAdelantos}
            className="h-7 px-2 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken hover:text-foreground"
          >
            Adelantos
          </button>
        </div>
      </td>
    </tr>
  );
}
