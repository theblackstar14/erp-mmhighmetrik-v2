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

      {/* Config del motor (visible solo a admin/contab) */}
      {canEdit && <ConfigMotorPanel />}
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
    </div>
  );
}

// ─── ParamLegalSection ────────────────────────────────────────

function ParamLegalSection({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const { data, isLoading } = useQuery({
    queryKey: ['param-legal-list'],
    queryFn: () => api.oficina.listParamLegal(),
  });

  // Form state for new/edit row
  const emptyForm = (): Omit<ParamLegalOficina, 'id'> => ({
    fechaVigencia: '', rmv: '', uit: '', topeRma: '', pctEssalud: '', pctOnp: '', pctAfpAporte: '', pctAsigFamiliar: '',
  });
  const [form, setForm] = useState<Omit<ParamLegalOficina, 'id'>>(emptyForm);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);

  const upsertMut = useMutation({
    mutationFn: (d: Omit<ParamLegalOficina, 'id'>) => api.oficina.upsertParamLegal(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['param-legal-list'] });
      setFormErr(null);
      setFormOk('Guardado.');
      setTimeout(() => setFormOk(null), 2000);
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  const field = (k: keyof typeof form) => (
    <input
      key={k}
      type="number"
      step="any"
      placeholder={k}
      value={form[k]}
      onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
      className="h-7 w-full px-2 rounded-md border border-line bg-bg text-[11.5px] font-mono tabular-nums"
    />
  );

  const loadRow = (p: ParamLegalOficina) =>
    setForm({ fechaVigencia: p.fechaVigencia, rmv: p.rmv, uit: p.uit, topeRma: p.topeRma, pctEssalud: p.pctEssalud, pctOnp: p.pctOnp, pctAfpAporte: p.pctAfpAporte, pctAsigFamiliar: p.pctAsigFamiliar });

  return (
    <div className="mt-1 space-y-3 pl-2">
      {isLoading && <p className="text-[11.5px] text-ink-4">Cargando…</p>}

      {/* Existing rows */}
      {(data?.params ?? []).length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[700px] text-[11.5px]">
            <thead>
              <tr className="border-b border-line bg-bg-sunken">
                {['Vigencia', 'RMV', 'UIT', 'Tope RMA', 'EsSalud', 'ONP', 'AFP Aporte', 'Asig.Fam.', ''].map((h, i) => (
                  <th key={i} className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.params ?? []).map((p) => (
                <tr key={p.id} className="border-b border-line/50 hover:bg-bg-sunken/30">
                  <td className="px-2 py-1.5 font-mono">{p.fechaVigencia}</td>
                  <td className="px-2 py-1.5 font-mono tabular-nums">{fmtPEN(Number(p.rmv))}</td>
                  <td className="px-2 py-1.5 font-mono tabular-nums">{fmtPEN(Number(p.uit))}</td>
                  <td className="px-2 py-1.5 font-mono tabular-nums">{fmtPEN(Number(p.topeRma))}</td>
                  <td className="px-2 py-1.5 font-mono tabular-nums">{(Number(p.pctEssalud) * 100).toFixed(2)}%</td>
                  <td className="px-2 py-1.5 font-mono tabular-nums">{(Number(p.pctOnp) * 100).toFixed(2)}%</td>
                  <td className="px-2 py-1.5 font-mono tabular-nums">{(Number(p.pctAfpAporte) * 100).toFixed(2)}%</td>
                  <td className="px-2 py-1.5 font-mono tabular-nums">{(Number(p.pctAsigFamiliar) * 100).toFixed(2)}%</td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => loadRow(p)} className="text-[10.5px] text-primary underline-offset-2 hover:underline">Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upsert form */}
      <div className="rounded-md border border-line bg-bg-sunken/40 p-3 space-y-2">
        <p className="text-[11px] font-semibold text-ink-3">Nueva / actualizar vigencia</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="space-y-0.5">
            <label className="text-[10px] text-ink-4">Fecha vigencia</label>
            <input type="date" value={form.fechaVigencia} onChange={(e) => setForm((f) => ({ ...f, fechaVigencia: e.target.value }))}
              className="h-7 w-full px-2 rounded-md border border-line bg-bg text-[11.5px]" />
          </div>
          <div className="space-y-0.5"><label className="text-[10px] text-ink-4">RMV</label>{field('rmv')}</div>
          <div className="space-y-0.5"><label className="text-[10px] text-ink-4">UIT</label>{field('uit')}</div>
          <div className="space-y-0.5"><label className="text-[10px] text-ink-4">Tope RMA</label>{field('topeRma')}</div>
          <div className="space-y-0.5"><label className="text-[10px] text-ink-4">% EsSalud (fracción)</label>{field('pctEssalud')}</div>
          <div className="space-y-0.5"><label className="text-[10px] text-ink-4">% ONP (fracción)</label>{field('pctOnp')}</div>
          <div className="space-y-0.5"><label className="text-[10px] text-ink-4">% AFP Aporte (fracción)</label>{field('pctAfpAporte')}</div>
          <div className="space-y-0.5"><label className="text-[10px] text-ink-4">% Asig. Familiar (fracción)</label>{field('pctAsigFamiliar')}</div>
        </div>
        {formErr && <p className="text-[11px] text-rose-600">{formErr}</p>}
        {formOk  && <p className="text-[11px] text-emerald-600">{formOk}</p>}
        <div className="flex gap-2">
          <button
            disabled={upsertMut.isPending}
            onClick={() => upsertMut.mutate(form)}
            className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium disabled:opacity-50"
          >
            {upsertMut.isPending ? 'Guardando…' : 'Guardar vigencia'}
          </button>
          <button onClick={() => { setForm(emptyForm()); setFormErr(null); }}
            className="h-7 px-3 rounded-md border border-line text-[11.5px] text-ink-3 hover:bg-bg-sunken">
            Limpiar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AfpTasasSection ──────────────────────────────────────────

function AfpTasasSection({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  // We re-use listParamLegal just for loading indicator; AFP list comes from a separate query.
  // Since there's no dedicated GET /afp-tasas endpoint yet, we piggyback on the config endpoint
  // which returns existing AFP tasas. For now we expose inline edit per AFP name.
  const [afp, setAfp] = useState('');
  const [pctAporte, setPctAporte] = useState('');
  const [pctSeguro, setPctSeguro] = useState('');
  const [pctFlujo, setPctFlujo] = useState('');
  const [pctMixta, setPctMixta] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      api.oficina.putAfpTasa(afp, {
        pctAporte: pctAporte !== '' ? Number(pctAporte) : undefined,
        pctSeguro: pctSeguro !== '' ? Number(pctSeguro) : undefined,
        pctComisionFlujo: pctFlujo !== '' ? Number(pctFlujo) : undefined,
        pctComisionMixta: pctMixta !== '' ? Number(pctMixta) : undefined,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['afp-tasas'] });
      setErr(null);
      setOk(`AFP ${res.afp.afp} actualizada.`);
      setTimeout(() => setOk(null), 2000);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const numInput = (label: string, val: string, set: (v: string) => void) => (
    <div className="space-y-0.5">
      <label className="text-[10px] text-ink-4">{label}</label>
      <input type="number" step="any" value={val} onChange={(e) => set(e.target.value)}
        placeholder="fracción ej. 0.10"
        className="h-7 w-full px-2 rounded-md border border-line bg-bg text-[11.5px] font-mono tabular-nums" />
    </div>
  );

  return (
    <div className="mt-1 pl-2 space-y-3">
      <p className="text-[11px] text-ink-4">
        Ingresa el nombre exacto de la AFP (ej. <span className="font-mono">AFP INTEGRA</span>) y los campos a actualizar.
        Los campos vacíos no se modifican.
      </p>
      <div className="rounded-md border border-line bg-bg-sunken/40 p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1 space-y-0.5">
            <label className="text-[10px] text-ink-4">Nombre AFP</label>
            <input value={afp} onChange={(e) => setAfp(e.target.value)} placeholder="AFP INTEGRA"
              className="h-7 w-full px-2 rounded-md border border-line bg-bg text-[11.5px] font-mono" />
          </div>
          {numInput('% Aporte (fracción)', pctAporte, setPctAporte)}
          {numInput('% Seguro (fracción)', pctSeguro, setPctSeguro)}
          {numInput('% Comisión flujo (fracción)', pctFlujo, setPctFlujo)}
          {numInput('% Comisión mixta (fracción)', pctMixta, setPctMixta)}
        </div>
        {err && <p className="text-[11px] text-rose-600">{err}</p>}
        {ok  && <p className="text-[11px] text-emerald-600">{ok}</p>}
        <button
          disabled={mut.isPending || !afp.trim()}
          onClick={() => mut.mutate()}
          className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium disabled:opacity-50"
        >
          {mut.isPending ? 'Guardando…' : 'Actualizar AFP'}
        </button>
      </div>
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
