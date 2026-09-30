import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import { type PlanillaOficinaDetalle, type ParamLegalOficina, type Renta5taBaseline, type Empleado, ApiError, api } from '@/lib/api.js';
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
  const { empresaActiva, empresas: empresasMembresía, empresaActiva: eA } = useAuthStore();
  const canEdit = eA?.rol === 'admin' || eA?.rol === 'contabilidad';
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
  const [subtab, setSubtab] = useState<'planilla' | 'config'>('planilla');
  const [modal, setModal] = useState<ModalState>(null);
  const [cerrarOpen, setCerrarOpen] = useState(false);
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
    mutationFn: ({ id, cuentaBancariaId }: { id: string; cuentaBancariaId: string | null }) =>
      api.oficina.cerrarPlanillaOficina(id, cuentaBancariaId),
    onSuccess: (res) => {
      setErrMsg(null);
      setCerrarOpen(false);
      setAsientoMsg(
        res.movimientoId
          ? `Asiento generado: ${res.asientoId} · egreso registrado en tesorería`
          : `Asiento generado: ${res.asientoId} · el neto quedó como pasivo en 411`,
      );
      invalidate();
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 423) setErrMsg(`Periodo cerrado: ${e.message}`);
      else setErrMsg(e.message);
    },
  });

  const reabrirMut = useMutation({
    mutationFn: (id: string) => api.oficina.reabrirPlanillaOficina(id),
    onSuccess: () => { setErrMsg(null); setAsientoMsg(null); invalidate(); },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 423) setErrMsg(`Periodo cerrado: ${e.message}`);
      else if (e instanceof ApiError && e.status === 409) setErrMsg(`No se puede reabrir: ${e.message}`);
      else setErrMsg(e.message);
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

  const totalBruto   = detalle.reduce((s, d) => s + Number(d.totalBruto), 0);
  const totalNeto    = detalle.reduce((s, d) => s + Number(d.netoPago), 0);
  const totalEsSalud = detalle.reduce((s, d) => s + Number(d.essalud), 0);
  const totalCosto   = detalle.reduce((s, d) => s + Number(d.costoTotal), 0);
  const estadoLabel  = ESTADO_BADGE[estado ?? '']?.l ?? estado ?? '';

  return (
    <div className="space-y-4">
      {/* Masthead */}
      <div>
        <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Planilla de oficina</h2>
        <p className="mt-0.5 text-[12px] text-ink-3">Personal administrativo, régimen general. El sistema propone, la contadora dispone.</p>
      </div>

      {/* Barra de herramientas */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-bg-elev p-3">
        <label className="inline-flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-wider text-ink-4">Mes</span>
          <input type="month" value={mes} onChange={(e) => { setMes(e.target.value); setAsientoMsg(null); setErrMsg(null); }}
            className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px]" />
        </label>
        {planilla && (
          <span className={cn('inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-medium', ESTADO_BADGE[estado ?? '']?.cls ?? 'bg-bg-sunken text-ink-3')}>
            {estadoLabel}
          </span>
        )}
        <div className="flex-1" />
        {planilla && (estado === 'borrador' || estado === 'calculada') && (
          <button disabled={calcularMut.isPending} onClick={() => calcularMut.mutate(planilla.id)}
            className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground disabled:opacity-50">
            {calcularMut.isPending ? 'Calculando…' : estado === 'calculada' ? 'Recalcular' : 'Calcular'}
          </button>
        )}
        {planilla && estado === 'cerrada' && (
          <button disabled={reabrirMut.isPending} onClick={() => reabrirMut.mutate(planilla.id)}
            className="inline-flex h-9 items-center rounded-md border border-line px-3.5 text-[12.5px] font-medium text-ink-2 hover:bg-bg-sunken disabled:opacity-50">
            {reabrirMut.isPending ? 'Reabriendo…' : 'Reabrir'}
          </button>
        )}
        {planilla && estado === 'calculada' && (
          <button disabled={cerrarMut.isPending} onClick={() => setCerrarOpen(true)}
            className="inline-flex h-9 items-center rounded-md bg-emerald-600 px-3.5 text-[12.5px] font-medium text-white disabled:opacity-50">
            Cerrar mes
          </button>
        )}
        {!planilla && !isLoading && (
          <button disabled={crearMut.isPending} onClick={() => crearMut.mutate()}
            className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground disabled:opacity-50">
            {crearMut.isPending ? 'Creando…' : `Crear planilla de ${mes}`}
          </button>
        )}
      </div>

      {/* Mensajes */}
      {asientoMsg && <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-600">{asientoMsg}</div>}
      {errMsg && <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-600">{errMsg}</div>}
      {isLoading && <div className="py-4 text-[12px] text-ink-4">Cargando…</div>}

      {/* Banda de KPIs */}
      {planilla && detalle.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Administrativos" value={String(detalle.length)} sub="en el mes" />
          <Kpi label="Total bruto" value={fmtPEN(totalBruto)} sub="remuneraciones" />
          <Kpi label="Aportes EsSalud" value={fmtPEN(totalEsSalud)} sub="empleador 9%" />
          <Kpi label="Neto por pagar" value={fmtPEN(totalNeto)} sub={`${detalle.length} boleta(s)`} />
          <Kpi label="Costo total" value={fmtPEN(totalCosto)} sub="bruto + aportes" />
          <Kpi label="Estado" value={estadoLabel} sub={readonly ? 'inmutable' : 'editable'} />
        </div>
      )}

      {/* Sub-tabs */}
      {planilla && (
        <div className="flex gap-1 border-b border-line">
          {(['planilla', ...(canEdit ? ['config'] as const : [])] as const).map((t) => (
            <button key={t} onClick={() => setSubtab(t)}
              className={cn('-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors',
                subtab === t ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-ink-2')}>
              {t === 'planilla' ? 'Planilla' : 'Configuración del motor'}
            </button>
          ))}
        </div>
      )}

      {/* Grid de planilla */}
      {subtab === 'planilla' && planilla && detalle.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line bg-bg-elev">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="border-b border-line bg-bg-sunken">
                {([['Boleta', 'l'], ['Trabajador', 'l'], ['Pensión', 'l'], ['Días', 'r'], ['Bruto', 'r'], ['AFP / ONP', 'r'], ['Renta 5ta', 'r'], ['Neto', 'r'], ['Cuenta', 'l'], ['Docs', 'l'], ['', 'l']] as const).map(([h, a], i) => (
                  <th key={i} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', a === 'r' ? 'text-right' : 'text-left')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detalle.map((det) => (
                <DetalleRow key={det.id} det={det} readonly={readonly}
                  onEdit={(patch) => editarMut.mutate({ id: det.id, patch })}
                  onBoleta={() => setModal({ kind: 'boleta', det })}
                  onAdelantos={() => setModal({ kind: 'adelantos', det })} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-bg-sunken">
                <td className="px-3 py-2 text-[11px] font-semibold text-ink-3" colSpan={4}>{detalle.length} trabajador(es)</td>
                <td className="px-3 py-2 text-right font-mono text-[11.5px] font-semibold tabular-nums">{fmtPEN(totalBruto)}</td>
                <td /><td />
                <td className="px-3 py-2 text-right font-mono text-[11.5px] font-bold tabular-nums text-primary">{fmtPEN(totalNeto)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {subtab === 'planilla' && planilla && detalle.length === 0 && !isLoading && (
        <div className="rounded-md border border-line bg-bg-elev p-8 text-center text-[12px] text-ink-3">
          Sin trabajadores en la planilla. Registra administrativos y pulsa Calcular.
        </div>
      )}

      {/* Configuración del motor */}
      {subtab === 'config' && canEdit && <ConfigMotorPanel />}

      {/* Modals */}
      {cerrarOpen && planilla && (
        <CerrarMesDialog
          mesId={planilla.id}
          mes={mes}
          pending={cerrarMut.isPending}
          onClose={() => setCerrarOpen(false)}
          onConfirm={(cuentaBancariaId) => cerrarMut.mutate({ id: planilla.id, cuentaBancariaId })}
        />
      )}
      {modal?.kind === 'boleta' && (
        <BoletaOficina detalle={modal.det} mes={mes} razonSocial={empresaRazonSocial} ruc={empresaRuc} direccion={empresaDireccion} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'adelantos' && (
        <Modal title={`Adelantos — ${modal.det.nombre ?? ''}`} onClose={() => setModal(null)}>
          <AdelantosPanel empleadoId={modal.det.empleadoId} empleadoNombre={modal.det.nombre ?? undefined} />
        </Modal>
      )}
    </div>
  );
}

// KPI compacto para la banda superior.
function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg-elev px-3 py-2.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">{label}</div>
      <div className="mt-1 font-mono text-[16px] font-bold leading-none tracking-[-0.02em] tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-[10.5px] text-ink-4">{sub}</div>}
    </div>
  );
}

// ─── ConfigMotorPanel ─────────────────────────────────────────
// Three collapsible sections: legal params, AFP rates, renta-5ta baseline import.

function SectionHeader({ title, open, onToggle }: { title: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-md bg-bg-sunken px-3 py-2 text-left text-[12px] font-semibold text-ink-2 hover:bg-bg-sunken/80"
    >
      {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
      {title}
    </button>
  );
}

function ConfigMotorPanel() {
  const qc = useQueryClient();
  const [openParams, setOpenParams] = useState(false);
  const [openAfp, setOpenAfp] = useState(false);
  const [openBaseline, setOpenBaseline] = useState(false);
  const [openDist, setOpenDist] = useState(false);
  const [openCuentas, setOpenCuentas] = useState(false);

  return (
    <div className="mt-6 space-y-2 rounded-xl border border-line bg-bg-elev p-4">
      <h2 className="mb-3 text-[13px] font-semibold text-ink-1">Configuración del motor</h2>

      {/* Section 1: Params legales */}
      <div className="space-y-1">
        <SectionHeader title="Parámetros legales por vigencia" open={openParams} onToggle={() => setOpenParams((v) => !v)} />
        {openParams && <ParamLegalSection qc={qc} />}
      </div>

      {/* Section 2: Tasas AFP */}
      <div className="space-y-1">
        <SectionHeader title="Tasas AFP" open={openAfp} onToggle={() => setOpenAfp((v) => !v)} />
        {openAfp && <AfpTasasSection qc={qc} />}
      </div>

      {/* Section 3: Baseline renta 5ta */}
      <div className="space-y-1">
        <SectionHeader title="Import renta 5.ª categoría (baseline por empleado/año)" open={openBaseline} onToggle={() => setOpenBaseline((v) => !v)} />
        {openBaseline && <Renta5taBaselineSection qc={qc} />}
      </div>

      {/* Section 4: Destino del costo */}
      <div className="space-y-1">
        <SectionHeader title="Destino del costo (reparto por obra)" open={openDist} onToggle={() => setOpenDist((v) => !v)} />
        {openDist && <DistribucionSection qc={qc} />}
      </div>

      {/* Section 5: Cuentas por concepto */}
      <div className="space-y-1">
        <SectionHeader title="Cuentas por concepto del asiento" open={openCuentas} onToggle={() => setOpenCuentas((v) => !v)} />
        {openCuentas && <ConceptoCuentaSection qc={qc} />}
      </div>
    </div>
  );
}

// ─── EditNum · input con edición en sitio (guarda al salir del campo si cambió) ──
function EditNum({ label, value, step = '0.01', onSave }: { label: string; value: number; step?: string; onSave: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-ink-4">{label}</span>
      <input type="number" step={step} defaultValue={value}
        onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== value) onSave(v); }}
        className="h-7 w-full px-2 rounded-md border border-line bg-bg-elev text-[11.5px] font-mono tabular-nums text-right" />
    </label>
  );
}

// ─── ParamLegalSection · vigencias editables en sitio + alta de nueva vigencia ──
const PARAM_LBL: Record<string, string> = { rmv: 'RMV S/', uit: 'UIT S/', topeRma: 'Tope RMA S/', pctEssalud: 'EsSalud (fracción)', pctOnp: 'ONP (fracción)', pctAfpAporte: 'AFP aporte (fracción)', pctAsigFamiliar: 'Asig. fam. (fracción)' };

function ParamLegalSection({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const { data, isLoading } = useQuery({ queryKey: ['param-legal-list'], queryFn: () => api.oficina.listParamLegal() });
  const [msg, setMsg] = useState<string | null>(null);
  const [nueva, setNueva] = useState<Omit<ParamLegalOficina, 'id'>>({ fechaVigencia: '', rmv: '', uit: '', topeRma: '', pctEssalud: '', pctOnp: '', pctAfpAporte: '', pctAsigFamiliar: '' });

  const upsertMut = useMutation({
    mutationFn: (d: Omit<ParamLegalOficina, 'id'>) => api.oficina.upsertParamLegal(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['param-legal-list'] }); setMsg('Guardado.'); setTimeout(() => setMsg(null), 1800); },
    onError: (e: Error) => setMsg(e.message),
  });
  const params = data?.params ?? [];

  // Guardar un campo de una vigencia existente reenvía la fila completa con ese campo cambiado.
  const saveField = (p: ParamLegalOficina, patch: Partial<Omit<ParamLegalOficina, 'id'>>) =>
    upsertMut.mutate({ fechaVigencia: p.fechaVigencia, rmv: p.rmv, uit: p.uit, topeRma: p.topeRma, pctEssalud: p.pctEssalud, pctOnp: p.pctOnp, pctAfpAporte: p.pctAfpAporte, pctAsigFamiliar: p.pctAsigFamiliar, ...patch });

  return (
    <div className="mt-1 space-y-2.5 pl-2">
      {isLoading && <p className="text-[11.5px] text-ink-4">Cargando…</p>}

      {params.map((p) => (
        <div key={p.id} className="rounded-md border border-line bg-bg-elev p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[9px] font-mono uppercase tracking-wider text-ink-4">Vigencia desde</span>
            <span className="text-[12px] font-bold font-mono">{p.fechaVigencia}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <EditNum label="RMV S/" step="1" value={Number(p.rmv)} onSave={(v) => saveField(p, { rmv: String(v) })} />
            <EditNum label="UIT S/" step="1" value={Number(p.uit)} onSave={(v) => saveField(p, { uit: String(v) })} />
            <EditNum label="Tope RMA S/" value={Number(p.topeRma)} onSave={(v) => saveField(p, { topeRma: String(v) })} />
            <EditNum label="EsSalud %" value={Number(p.pctEssalud) * 100} onSave={(v) => saveField(p, { pctEssalud: String(v / 100) })} />
            <EditNum label="ONP %" value={Number(p.pctOnp) * 100} onSave={(v) => saveField(p, { pctOnp: String(v / 100) })} />
            <EditNum label="AFP aporte %" value={Number(p.pctAfpAporte) * 100} onSave={(v) => saveField(p, { pctAfpAporte: String(v / 100) })} />
            <EditNum label="Asig. familiar %" value={Number(p.pctAsigFamiliar) * 100} onSave={(v) => saveField(p, { pctAsigFamiliar: String(v / 100) })} />
          </div>
        </div>
      ))}

      {/* Nueva vigencia */}
      <div className="rounded-md border border-dashed border-line-2 bg-bg-sunken/40 p-3 space-y-2">
        <p className="text-[11px] font-semibold text-ink-3">Nueva vigencia</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="flex flex-col gap-0.5"><span className="text-[10px] text-ink-4">Fecha vigencia</span>
            <input type="date" value={nueva.fechaVigencia} onChange={(e) => setNueva((f) => ({ ...f, fechaVigencia: e.target.value }))}
              className="h-7 w-full px-2 rounded-md border border-line bg-bg-elev text-[11.5px]" /></label>
          {(['rmv', 'uit', 'topeRma', 'pctEssalud', 'pctOnp', 'pctAfpAporte', 'pctAsigFamiliar'] as const).map((k) => (
            <label key={k} className="flex flex-col gap-0.5"><span className="text-[10px] text-ink-4">{PARAM_LBL[k]}</span>
              <input type="number" step="any" value={nueva[k]} onChange={(e) => setNueva((f) => ({ ...f, [k]: e.target.value }))}
                placeholder={k.startsWith('pct') ? '0.09' : ''}
                className="h-7 w-full px-2 rounded-md border border-line bg-bg-elev text-[11.5px] font-mono tabular-nums" /></label>
          ))}
        </div>
        <button disabled={upsertMut.isPending || !nueva.fechaVigencia} onClick={() => upsertMut.mutate(nueva)}
          className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium disabled:opacity-50">
          {upsertMut.isPending ? 'Guardando…' : 'Agregar vigencia'}
        </button>
      </div>
      {msg && <p className="text-[11px] text-emerald-600">{msg}</p>}
    </div>
  );
}

// ─── AfpTasasSection ──────────────────────────────────────────

function AfpTasasSection({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const { data, isLoading } = useQuery({ queryKey: ['afp-tasas'], queryFn: () => api.oficina.listAfpTasas() });
  const [msg, setMsg] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (v: { afp: string; data: { pctAporte?: number; pctSeguro?: number; pctComisionFlujo?: number; pctComisionMixta?: number } }) => api.oficina.putAfpTasa(v.afp, v.data),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['afp-tasas'] }); setMsg(`${res.afp.afp} actualizada.`); setTimeout(() => setMsg(null), 1800); },
    onError: (e: Error) => setMsg(e.message),
  });
  const tasas = data?.tasas ?? [];

  return (
    <div className="mt-1 space-y-2 pl-2">
      {isLoading && <p className="text-[11.5px] text-ink-4">Cargando…</p>}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {tasas.map((t) => (
          <div key={t.id} className="rounded-md border border-line bg-bg-elev p-3 space-y-1.5">
            <div className="text-[12px] font-bold">{t.afp}</div>
            <EditNum label="Aporte %" value={Number(t.pctAporte) * 100} onSave={(v) => mut.mutate({ afp: t.afp, data: { pctAporte: v / 100 } })} />
            <EditNum label="Seguro %" value={Number(t.pctSeguro) * 100} onSave={(v) => mut.mutate({ afp: t.afp, data: { pctSeguro: v / 100 } })} />
            <EditNum label="Comisión flujo %" value={Number(t.pctComisionFlujo) * 100} onSave={(v) => mut.mutate({ afp: t.afp, data: { pctComisionFlujo: v / 100 } })} />
            <EditNum label="Comisión mixta %" value={Number(t.pctComisionMixta) * 100} onSave={(v) => mut.mutate({ afp: t.afp, data: { pctComisionMixta: v / 100 } })} />
          </div>
        ))}
      </div>
      {msg && <p className="text-[11px] text-emerald-600">{msg}</p>}
    </div>
  );
}

// ─── Renta5taBaselineSection ──────────────────────────────────

function Renta5taBaselineSection({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const { data: empData, isLoading: empLoading } = useQuery({
    queryKey: ['empleados-admin'],
    queryFn: () => api.planilla.listEmpleados('admin'),
    staleTime: 5 * 60 * 1000,
  });
  const admins: Empleado[] = empData?.empleados ?? [];

  const anioDefault = new Date().getFullYear();
  const [anio, setAnio] = useState(String(anioDefault));
  const [rows, setRows] = useState<Record<string, { acum: string; ret: string; saved: boolean }>>({});
  const [globalErr, setGlobalErr] = useState<string | null>(null);
  const [globalOk, setGlobalOk] = useState<string | null>(null);

  // Load existing baselines when anio changes
  const { data: baselineData } = useQuery({
    queryKey: ['renta5ta-baselines', anio, admins.map((e) => e.id).join(',')],
    queryFn: async () => {
      if (!admins.length || !anio) return {};
      const results: Record<string, Renta5taBaseline | null> = {};
      await Promise.all(
        admins.map(async (emp) => {
          const r = await api.oficina.getRenta5taBaseline(emp.id, Number(anio));
          results[emp.id] = r.baseline;
        }),
      );
      return results;
    },
    enabled: admins.length > 0 && !!anio,
  });

  // Merge loaded data into rows state when baselineData changes
  const mergedRows: Record<string, { acum: string; ret: string; saved: boolean }> = {};
  for (const emp of admins) {
    const existing = baselineData?.[emp.id];
    const local = rows[emp.id];
    mergedRows[emp.id] = local ?? {
      acum: existing ? existing.acumuladoImportado : '',
      ret:  existing ? existing.retencionesImportadas : '',
      saved: !!existing,
    };
  }

  const upsertMut = useMutation({
    mutationFn: ({ empleadoId, acumuladoImportado, retencionesImportadas }: { empleadoId: string; acumuladoImportado: number; retencionesImportadas: number }) =>
      api.oficina.upsertRenta5taBaseline(empleadoId, Number(anio), { acumuladoImportado, retencionesImportadas }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['renta5ta-baselines'] });
      setRows((prev) => ({ ...prev, [vars.empleadoId]: { ...prev[vars.empleadoId]!, saved: true } }));
      setGlobalErr(null);
      setGlobalOk('Guardado.');
      setTimeout(() => setGlobalOk(null), 2000);
    },
    onError: (e: Error) => setGlobalErr(e.message),
  });

  const saveRow = (emp: Empleado) => {
    const r = mergedRows[emp.id];
    if (!r) return;
    const acum = Number(r.acum);
    const ret  = Number(r.ret);
    if (!Number.isFinite(acum) || !Number.isFinite(ret)) {
      setGlobalErr('Valores inválidos en la fila de ' + emp.nombre);
      return;
    }
    upsertMut.mutate({ empleadoId: emp.id, acumuladoImportado: acum, retencionesImportadas: ret });
  };

  return (
    <div className="mt-1 pl-2 space-y-3">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[12px]">
          Año:
          <input type="number" min="2020" max="2099" value={anio} onChange={(e) => { setAnio(e.target.value); setRows({}); }}
            className="h-7 w-20 px-2 rounded-md border border-line bg-bg text-[11.5px] font-mono" />
        </label>
        {globalErr && <span className="text-[11px] text-rose-600">{globalErr}</span>}
        {globalOk  && <span className="text-[11px] text-emerald-600">{globalOk}</span>}
      </div>

      {empLoading && <p className="text-[11.5px] text-ink-4">Cargando empleados…</p>}

      {admins.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[540px] text-[11.5px]">
            <thead>
              <tr className="border-b border-line bg-bg-sunken">
                {['Empleado', 'Acumulado importado (S/)', 'Retenciones importadas (S/)', ''].map((h, i) => (
                  <th key={i} className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {admins.map((emp) => {
                const r = mergedRows[emp.id] ?? { acum: '', ret: '', saved: false };
                return (
                  <tr key={emp.id} className="border-b border-line/50 hover:bg-bg-sunken/30">
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{emp.nombre}</div>
                      {emp.numDoc && <div className="text-[10px] text-ink-4">{emp.numDoc}</div>}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number" step="0.01" min="0"
                        value={r.acum}
                        onChange={(e) => setRows((prev) => ({ ...prev, [emp.id]: { acum: e.target.value, ret: prev[emp.id]?.ret ?? r.ret, saved: false } }))}
                        className="h-7 w-28 px-2 rounded-md border border-line bg-bg font-mono tabular-nums text-[11.5px]"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number" step="0.01" min="0"
                        value={r.ret}
                        onChange={(e) => setRows((prev) => ({ ...prev, [emp.id]: { acum: prev[emp.id]?.acum ?? r.acum, ret: e.target.value, saved: false } }))}
                        className="h-7 w-28 px-2 rounded-md border border-line bg-bg font-mono tabular-nums text-[11.5px]"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        disabled={upsertMut.isPending}
                        onClick={() => saveRow(emp)}
                        className={cn(
                          'h-6 px-2 rounded-md text-[10.5px] font-medium disabled:opacity-50',
                          r.saved
                            ? 'border border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10'
                            : 'bg-primary text-primary-foreground hover:opacity-90',
                        )}
                      >
                        {r.saved ? 'Actualizar' : 'Guardar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!empLoading && admins.length === 0 && (
        <p className="text-[11.5px] text-ink-4">Sin empleados administrativos registrados.</p>
      )}
    </div>
  );
}

// ─── DistribucionSection · destino del costo por obra ─────────
// Selector Global | Por empleado. La fila "Oficina" es calculada (100 - suma), no editable:
// es el resto, no un dato. Guardar reemplaza el scope completo (el backend borra + inserta).
function DistribucionSection({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const [scope, setScope] = useState<'global' | 'empleado'>('global');
  const [empleadoId, setEmpleadoId] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const { data: dist } = useQuery({ queryKey: ['oficina-distribucion'], queryFn: () => api.oficina.getDistribucionOficina() });
  const { data: proyectosData } = useQuery({ queryKey: ['proyectos'], queryFn: () => api.proyectos.list() });
  const { data: empleadosData } = useQuery({ queryKey: ['empleados', 'admin'], queryFn: () => api.planilla.listEmpleados('admin') });

  const obras = proyectosData?.proyectos ?? [];
  const administrativos = (empleadosData?.empleados ?? []).filter((e) => e.tipoPlanilla === 'admin');

  const guardadas = scope === 'global'
    ? dist?.global ?? []
    : dist?.porEmpleado.find((p) => p.empleadoId === empleadoId)?.filas ?? [];
  const [draft, setDraft] = useState<Record<string, number>>({});
  const filas = Object.keys(draft).length > 0
    ? draft
    : Object.fromEntries(guardadas.map((f) => [f.obraId, f.pct]));

  const suma = Math.round(Object.values(filas).reduce((s, v) => s + Number(v || 0), 0) * 100) / 100;
  const resto = Math.round((100 - suma) * 100) / 100;
  const hereda = scope === 'empleado' && !!empleadoId && guardadas.length === 0;

  const guardarMut = useMutation({
    mutationFn: () =>
      api.oficina.putDistribucionOficina(
        scope === 'global' ? null : empleadoId,
        Object.entries(filas).filter(([, pct]) => Number(pct) > 0).map(([obraId, pct]) => ({ obraId, pct: Number(pct) })),
      ),
    onSuccess: () => {
      setErr(null);
      setOkMsg('Distribución guardada');
      setDraft({});
      qc.invalidateQueries({ queryKey: ['oficina-distribucion'] });
    },
    onError: (e: Error) => { setOkMsg(null); setErr(e.message); },
  });

  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-line p-0.5">
          {(['global', 'empleado'] as const).map((s) => (
            <button key={s} type="button"
              onClick={() => { setScope(s); setDraft({}); setErr(null); setOkMsg(null); }}
              className={cn('rounded px-2.5 py-1 text-[11.5px] font-medium',
                scope === s ? 'bg-primary text-primary-foreground' : 'text-ink-3 hover:text-ink-2')}>
              {s === 'global' ? 'Global' : 'Por empleado'}
            </button>
          ))}
        </div>
        {scope === 'empleado' && (
          <select value={empleadoId}
            onChange={(e) => { setEmpleadoId(e.target.value); setDraft({}); setErr(null); setOkMsg(null); }}
            className="h-8 rounded-md border border-line bg-bg-elev px-2 text-[11.5px]">
            <option value="">Elige un trabajador…</option>
            {administrativos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        )}
      </div>

      {scope === 'empleado' && !empleadoId ? (
        <p className="text-[11.5px] text-ink-4">Elige un trabajador para definir su distribución propia.</p>
      ) : (
        <>
          {hereda && (
            <p className="text-[11.5px] text-ink-4">
              Sin reglas propias: hereda el global ({dist?.global.map((f) => `${f.obraCodigo} ${f.pct}%`).join(' · ') || '100% oficina'}).
              Al guardar aquí, el global deja de aplicarle.
            </p>
          )}
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="px-2 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-4">Obra</th>
                <th className="px-2 py-1.5 text-right font-mono text-[10px] uppercase tracking-wider text-ink-4">%</th>
              </tr>
            </thead>
            <tbody>
              {obras.map((o) => (
                <tr key={o.id} className="border-b border-line/60">
                  <td className="px-2 py-1.5 text-[11.5px]">{o.codigo} · {o.nombre}</td>
                  <td className="px-2 py-1">
                    <input type="number" step="0.01" min="0" max="100"
                      value={filas[o.id] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value === '' ? 0 : Number(e.target.value);
                        setDraft({ ...filas, [o.id]: Number.isFinite(v) ? v : 0 });
                      }}
                      className="h-7 w-24 rounded-md border border-line bg-bg-elev px-2 text-right font-mono text-[11.5px] tabular-nums" />
                  </td>
                </tr>
              ))}
              <tr className="bg-bg-sunken">
                <td className="px-2 py-1.5 text-[11.5px] font-medium text-ink-2">Oficina (gasto general corporativo)</td>
                <td className="px-2 py-1.5 text-right font-mono text-[11.5px] font-semibold tabular-nums">
                  {resto.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          {resto < 0 && <p className="text-[11.5px] text-rose-600">La suma es {suma.toFixed(2)}: no puede pasar de 100.</p>}
          {err && <p className="text-[11.5px] text-rose-600">{err}</p>}
          {okMsg && <p className="text-[11.5px] text-emerald-600">{okMsg}</p>}

          <button type="button" disabled={resto < 0 || guardarMut.isPending}
            onClick={() => guardarMut.mutate()}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[11.5px] font-medium text-primary-foreground disabled:opacity-50">
            {guardarMut.isPending ? 'Guardando…' : 'Guardar distribución'}
          </button>
        </>
      )}
    </div>
  );
}

// ─── ConceptoCuentaSection · cuentas por concepto ─────────────
// Conjunto de conceptos cerrado (lo define el backend). Se edita la cuenta, no la lista.
// Misma mecánica que EditNum: guarda al salir del campo si cambió.
function ConceptoCuentaSection({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const [err, setErr] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['oficina-concepto-cuenta'], queryFn: () => api.oficina.getConceptoCuentaOficina() });

  const guardarMut = useMutation({
    mutationFn: ({ concepto, cuenta }: { concepto: string; cuenta: string }) =>
      api.oficina.putConceptoCuentaOficina(concepto, cuenta),
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ['oficina-concepto-cuenta'] }); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="space-y-2 rounded-md border border-line p-3">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            {['Concepto', 'Lado', 'Obra', 'Cuenta', 'Descripción'].map((h) => (
              <th key={h} className="px-2 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-4">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(data?.conceptos ?? []).map((c) => (
            <tr key={c.concepto} className="border-b border-line/60">
              <td className="px-2 py-1.5 text-[11.5px]">{c.label}</td>
              <td className="px-2 py-1.5 text-[11.5px] text-ink-3">{c.lado === 'debe' ? 'Debe' : 'Haber'}</td>
              <td className="px-2 py-1.5 text-[11.5px] text-ink-3">{c.reparte ? 'se reparte' : 'agregado'}</td>
              <td className="px-2 py-1">
                <input type="text" defaultValue={c.cuenta} key={c.cuenta}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== c.cuenta) guardarMut.mutate({ concepto: c.concepto, cuenta: v });
                  }}
                  className="h-7 w-24 rounded-md border border-line bg-bg-elev px-2 font-mono text-[11.5px] tabular-nums" />
              </td>
              <td className="px-2 py-1.5 text-[11.5px] text-ink-4">{c.cuentaDescripcion ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {err && <p className="text-[11.5px] text-rose-600">{err}</p>}
      <p className="text-[11.5px] text-ink-4">
        La cuenta del sueldo definida por trabajador en la planilla manda sobre esta.
      </p>
    </div>
  );
}

// ─── CerrarMesDialog · cuenta bancaria + asiento antes de firmar ──
// Kelly ve el asiento ANTES de cerrar: es el momento en que su criterio importa.
function CerrarMesDialog({ mesId, mes, onClose, onConfirm, pending }: {
  mesId: string;
  mes: string;
  onClose: () => void;
  onConfirm: (cuentaBancariaId: string | null) => void;
  pending: boolean;
}) {
  const [cuentaId, setCuentaId] = useState<string>('');

  const { data: cuentasData } = useQuery({ queryKey: ['cuentas-bancarias'], queryFn: () => api.finanzas.listCuentas() });
  const cuentas = (cuentasData?.cuentas ?? []).filter((c) => c.activo && c.moneda === 'PEN' && !!c.cuentaContable);

  const { data: preview, isLoading, error } = useQuery({
    queryKey: ['oficina-asiento-preview', mesId, cuentaId],
    queryFn: () => api.oficina.getAsientoPreviewOficina(mesId, cuentaId || null),
  });

  const porObra = new Map<string, { codigo: string; monto: number }>();
  for (const l of preview?.lineas ?? []) {
    if (!l.obraId || Number(l.debe) <= 0) continue;
    const prev = porObra.get(l.obraId);
    porObra.set(l.obraId, { codigo: l.obraCodigo ?? l.obraId, monto: (prev?.monto ?? 0) + Number(l.debe) });
  }
  const oficina = (preview?.lineas ?? [])
    .filter((l) => !l.obraId && Number(l.debe) > 0 && l.cuenta.startsWith('6'))
    .reduce((s, l) => s + Number(l.debe), 0);

  return (
    <Modal title={`Cerrar planilla de ${mes}`} onClose={onClose}>
      <div className="space-y-4">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-4">Pagar el neto desde</span>
          <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}
            className="h-8 rounded-md border border-line bg-bg-elev px-2 text-[11.5px]">
            <option value="">Dejar como pasivo en 411 (pagar después)</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.banco ?? ''} {c.codigo} — {c.descripcion ?? ''}</option>
            ))}
          </select>
        </label>

        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4">Reparto del costo</div>
          <div className="space-y-0.5 text-[11.5px]">
            {[...porObra.values()].map((o) => (
              <div key={o.codigo} className="flex justify-between">
                <span>{o.codigo}</span><span className="font-mono tabular-nums">{fmtPEN(o.monto)}</span>
              </div>
            ))}
            {oficina > 0 && (
              <div className="flex justify-between text-ink-3">
                <span>Oficina (gasto general corporativo)</span>
                <span className="font-mono tabular-nums">{fmtPEN(oficina)}</span>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4">Asiento que se va a postear</div>
          {isLoading && <p className="text-[11.5px] text-ink-4">Cargando…</p>}
          {error && <p className="text-[11.5px] text-rose-600">{(error as Error).message}</p>}
          {preview && (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr className="border-b border-line bg-bg-sunken">
                    {['Cuenta', 'Descripción', 'Obra', 'Clase', 'Debe', 'Haber'].map((h, i) => (
                      <th key={h} className={cn('px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4', i >= 4 ? 'text-right' : 'text-left')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.lineas.map((l, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="px-2 py-1 font-mono text-[11px] tabular-nums">{l.cuenta}</td>
                      <td className="px-2 py-1 text-[11px]">{l.descripcion}</td>
                      <td className="px-2 py-1 text-[11px] text-ink-3">{l.obraCodigo ?? '—'}</td>
                      <td className="px-2 py-1 text-[11px] text-ink-3">{l.clase ?? '—'}</td>
                      <td className="px-2 py-1 text-right font-mono text-[11px] tabular-nums">{Number(l.debe) > 0 ? fmtPEN(Number(l.debe)) : ''}</td>
                      <td className="px-2 py-1 text-right font-mono text-[11px] tabular-nums">{Number(l.haber) > 0 ? fmtPEN(Number(l.haber)) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line bg-bg-sunken">
                    <td colSpan={4} className="px-2 py-1.5 text-[11px] font-semibold text-ink-3">
                      {preview.cuadra ? 'Cuadra' : 'NO cuadra'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-[11px] font-bold tabular-nums">{fmtPEN(preview.totales.debe)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[11px] font-bold tabular-nums">{fmtPEN(preview.totales.haber)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="inline-flex h-9 items-center rounded-md border border-line px-3.5 text-[12.5px] font-medium text-ink-2 hover:bg-bg-sunken">
            Cancelar
          </button>
          <button type="button" disabled={pending || !preview?.cuadra}
            onClick={() => onConfirm(cuentaId || null)}
            className="inline-flex h-9 items-center rounded-md bg-emerald-600 px-3.5 text-[12.5px] font-medium text-white disabled:opacity-50">
            {pending ? 'Cerrando…' : 'Confirmar cierre'}
          </button>
        </div>
      </div>
    </Modal>
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
    if (v !== Number(det.imptoRenta5ta)) onEdit({ imptoRenta5ta: v });
  };

  const esOnp = Number(det.onp) > 0;
  const pension = esOnp ? 'ONP' : (det.afp ?? 'AFP');
  const descPension = esOnp ? Number(det.onp) : Number(det.afpAporte) + Number(det.afpSeguro) + Number(det.afpComision);
  const manual = det.renta5taManual === true;

  return (
    <tr className="border-b border-line/60 hover:bg-bg-sunken/30">
      {/* Boleta */}
      <td className="px-3 py-2 font-mono text-[10.5px] text-ink-3">{det.boletaCorrelativo ?? '—'}</td>

      {/* Trabajador */}
      <td className="px-3 py-2">
        <div className="text-[12px] font-medium">{det.nombre ?? '—'}</div>
        {det.cargo && <div className="text-[10.5px] text-ink-4">{det.cargo}</div>}
      </td>

      {/* Pensión */}
      <td className="px-3 py-2">
        <span className="inline-flex items-center rounded-md bg-bg-sunken px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-3">{pension}</span>
      </td>

      {/* Días */}
      <td className="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums text-ink-3">{det.diasTrab ?? '—'}</td>

      {/* Bruto */}
      <td className="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums">{fmtPEN(Number(det.totalBruto))}</td>

      {/* AFP / ONP */}
      <td className="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums text-ink-3">{fmtPEN(descPension)}</td>

      {/* Renta 5ta (editable + tag Manual/Auto) */}
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1.5">
          <input
            type="number" step="0.01" min="0" disabled={readonly}
            value={renta} onChange={(e) => setRenta(e.target.value)} onBlur={handleRentaBlur}
            className={cn('h-7 w-20 rounded-md border border-line bg-bg-elev px-1.5 text-right font-mono text-[11.5px] tabular-nums', readonly && 'cursor-not-allowed opacity-60')}
          />
          <span className={cn('rounded px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-wide', manual ? 'bg-amber-500/15 text-amber-700' : 'bg-bg-sunken text-ink-4')}>
            {manual ? 'Manual' : 'Auto'}
          </span>
        </div>
      </td>

      {/* Neto */}
      <td className="px-3 py-2 text-right font-mono text-[11.5px] font-bold tabular-nums">{fmtPEN(Number(det.netoPago))}</td>

      {/* Cuenta contable */}
      <td className="min-w-[150px] px-3 py-2">
        {readonly ? (
          <span className="font-mono text-[11.5px] text-ink-3">{det.cuentaContable ?? '—'}</span>
        ) : (
          <CuentaContableSelect value={det.cuentaContable} onChange={(codigo) => onEdit({ cuentaContable: codigo })} soloHoja placeholder="Cuenta…" className="w-full" />
        )}
      </td>

      {/* Docs */}
      <td className="px-3 py-2"><DocumentoAdjunto entidadTipo="planilla_oficina_detalle" entidadId={det.id} /></td>

      {/* Acciones */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button onClick={onBoleta} className="h-7 rounded-md border border-line px-2 text-[11px] text-ink-2 hover:bg-bg-sunken hover:text-foreground">Boleta</button>
          <button onClick={onAdelantos} className="h-7 rounded-md border border-line px-2 text-[11px] text-ink-2 hover:bg-bg-sunken hover:text-foreground">Adelantos</button>
        </div>
      </td>
    </tr>
  );
}
