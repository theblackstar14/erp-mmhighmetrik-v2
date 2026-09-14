import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Circle, Flag, Lock, Plus, Shield, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import {
  type Adelanto,
  type AdelantoInput,
  type Garantia,
  type GarantiaInput,
  type GarantiaTipo,
  type HitoInput,
  type HitoObra,
  type HitoSugerido,
  type HitoTipo,
  api,
} from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';

const HITO_LABEL: Record<HitoTipo, string> = {
  entrega_terreno: 'Entrega de terreno',
  inicio_plazo: 'Inicio de plazo',
  ampliacion_plazo: 'Ampliación de plazo',
  culminacion: 'Culminación de obra',
  recepcion: 'Recepción de obra',
  liquidacion: 'Liquidación',
  consentimiento_liquidacion: 'Consentimiento de liquidación',
};
const HITO_TIPOS = Object.keys(HITO_LABEL) as HitoTipo[];

const GARANTIA_LABEL: Record<GarantiaTipo, string> = {
  fiel_cumplimiento: 'Fiel cumplimiento',
  adelanto_directo: 'Adelanto directo',
  adelanto_materiales: 'Adelanto materiales',
  adelanto_avance: 'Adelanto por avance',
  retencion: 'Retención',
  beneficios_sociales: 'Beneficios sociales',
};
const GARANTIA_TIPOS = Object.keys(GARANTIA_LABEL) as GarantiaTipo[];
const ADELANTO_TIPOS: GarantiaTipo[] = ['adelanto_directo', 'adelanto_materiales', 'adelanto_avance'];

// Alerta de vigencia · today fijo por render
function vigenciaAlert(vigenciaHasta: string | null, estado: string): { label: string; cls: string } | null {
  if (estado === 'devuelta' || estado === 'ejecutada') return null;
  if (!vigenciaHasta) return null;
  const hoy = new Date();
  const hasta = new Date(`${vigenciaHasta}T00:00:00`);
  const dias = Math.floor((hasta.getTime() - hoy.getTime()) / 86_400_000);
  if (dias < 0) return { label: `vencida hace ${Math.abs(dias)}d`, cls: 'red' };
  if (dias <= 30) return { label: `vence en ${dias}d`, cls: 'amber' };
  return null;
}

export function ContractualTab({ proyectoId }: { proyectoId: string }) {
  const hitosQ = useQuery({ queryKey: ['hitos', proyectoId], queryFn: () => api.contractual.listHitos(proyectoId) });
  const garQ = useQuery({ queryKey: ['garantias', proyectoId], queryFn: () => api.contractual.listGarantias(proyectoId) });
  const adelQ = useQuery({ queryKey: ['adelantos', proyectoId], queryFn: () => api.contractual.listAdelantos(proyectoId) });
  const proyQ = useQuery({ queryKey: ['proyecto', proyectoId], queryFn: () => api.proyectos.get(proyectoId) });
  const sugQ = useQuery({ queryKey: ['hitos-sugeridos', proyectoId], queryFn: () => api.contractual.listHitosSugeridos(proyectoId) });
  const contratoMonto = Number(proyQ.data?.proyecto?.montoContractual ?? 0) || Number(proyQ.data?.proyecto?.costoDirecto ?? 0);

  const hitos = hitosQ.data?.hitos ?? [];
  const garantias = garQ.data?.garantias ?? [];
  const adelantos = adelQ.data?.adelantos ?? [];

  const garVigentes = garantias.filter((g) => g.estado === 'vigente');
  const sumGarVigente = garVigentes.reduce((s, g) => s + Number(g.monto), 0);
  const sumAdelPendiente = adelantos.reduce((s, a) => s + (Number(a.monto) - Number(a.montoAmortizado ?? 0)), 0);
  const hitosSet = new Set(hitos.map((h) => h.tipo));
  // Sugerencias del cronograma · solo tipos aún sin registrar
  const sugeridos = (sugQ.data?.sugeridos ?? []).filter((s) => !hitosSet.has(s.tipo));

  return (
    <div className="space-y-5">
      <CierreObraSection proyectoId={proyectoId} />

      {/* Resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat icon={<Flag className="h-4 w-4" />} label="Hitos registrados" value={hitos.length.toString()} />
        <Stat icon={<Shield className="h-4 w-4" />} label="Garantías vigentes" value={garVigentes.length.toString()} />
        <Stat label="Σ garantías vigentes" value={fmtPEN(sumGarVigente)} mono />
        <Stat icon={<Wallet className="h-4 w-4" />} label="Adelanto por amortizar" value={fmtPEN(sumAdelPendiente)} mono accent={sumAdelPendiente > 0 ? 'amber' : undefined} />
      </div>

      <HitosSection proyectoId={proyectoId} hitos={hitos} loading={hitosQ.isLoading} sugeridos={sugeridos} />
      <GarantiasSection proyectoId={proyectoId} garantias={garantias} hitosSet={hitosSet} loading={garQ.isLoading} contratoMonto={contratoMonto} />
      <AdelantosSection proyectoId={proyectoId} adelantos={adelantos} loading={adelQ.isLoading} contratoMonto={contratoMonto} />
      <LiquidacionSection proyectoId={proyectoId} />
    </div>
  );
}

// ════════════════════ LIQUIDACIÓN DE OBRA (Fase 1 · saldo + snapshot) ════════════════════
function LiquidacionSection({ proyectoId }: { proyectoId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['liquidacion', proyectoId], queryFn: () => api.contractual.getLiquidacion(proyectoId) });
  const inval = () => { qc.invalidateQueries({ queryKey: ['liquidacion', proyectoId] }); qc.invalidateQueries({ queryKey: ['cierre', proyectoId] }); };
  const practicar = useMutation({ mutationFn: () => api.contractual.practicarLiquidacion(proyectoId), onSuccess: inval });
  const reabrir = useMutation({ mutationFn: (motivo: string) => api.contractual.reabrirLiquidacion(q.data!.liquidacion!.id, motivo), onSuccess: inval });

  const liq = q.data?.liquidacion ?? null;
  const prev = q.data?.preview;
  const vigente = liq?.estado === 'practicada';
  const c = prev?.componentes;
  const con = prev?.conciliacion;

  const row = (label: string, val: number, opts?: { neg?: boolean; bold?: boolean }) => (
    <div className={cn('flex justify-between py-1 text-[12px]', opts?.bold && 'font-semibold border-t border-line mt-1 pt-1.5')}>
      <span className="text-ink-3">{label}</span>
      <span className={cn('font-mono', opts?.neg && val > 0 && 'text-rose-600')}>{opts?.neg && val > 0 ? '−' : ''}{fmtPEN(Math.abs(val))}</span>
    </div>
  );

  return (
    <Section title="Liquidación de obra" icon={<Wallet className="h-4 w-4 text-ink-3" />}>
      {q.isLoading || !c || !con ? (
        <div className="text-[12px] text-ink-4 py-2">Calculando…</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[11.5px] text-ink-4">
              {vigente ? (
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Practicada el {liq!.fechaPractica} · saldo congelado</span>
              ) : liq?.estado === 'reabierta' ? (
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Reabierta · preview en vivo</span>
              ) : (
                <span>Sin practicar · preview en vivo ({prev!.valos} valorizaciones)</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-ink-4 hidden sm:inline">Fase 1 · solo cálculo, sin asientos</span>
              {vigente ? (
                <button onClick={() => { const m = window.prompt('Motivo de reapertura:'); if (m) reabrir.mutate(m); }} disabled={reabrir.isPending}
                  className="text-[11.5px] rounded-md border border-line px-2.5 py-1 hover:bg-bg-sunken">Reabrir</button>
              ) : (
                <button onClick={() => practicar.mutate()} disabled={practicar.isPending}
                  className="text-[11.5px] rounded-md bg-primary text-primary-foreground px-2.5 py-1 font-medium hover:opacity-90">
                  {practicar.isPending ? 'Practicando…' : 'Practicar liquidación'}</button>
              )}
            </div>
          </div>

          {prev!.valosCobradas < prev!.valos && (
            <div className="rounded-md bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/40 p-2 text-[10.5px] text-sky-800 dark:text-sky-300">
              El saldo trata como pagadas solo las valorizaciones marcadas <b>cobrada</b> ({prev!.valosCobradas} de {prev!.valos}). Verifica ese estado: si falta marcar cobros, el saldo saldrá mayor de lo real.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Desglose saldo final · base caja con-IGV */}
            <div className="rounded-lg border border-line p-3">
              <div className="text-[11px] font-semibold text-ink-3 mb-1">Saldo final (rollup de valorizaciones)</div>
              {row('Facturado c/IGV', c.facturadoConIgv)}
              {row('− Ya cobrado', c.cobrado, { neg: true })}
              <div className="flex justify-between pt-1.5 mt-1 border-t border-line text-[13px] font-bold">
                <span>Saldo final {prev!.saldoFinal >= 0 ? 'por cobrar' : 'por pagar'}</span>
                <span className={cn('font-mono', prev!.saldoFinal >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{fmtPEN(prev!.saldoFinal)}</span>
              </div>
              <div className="mt-2 pt-2 border-t border-line/60 text-[10.5px] text-ink-4 space-y-0.5">
                <div className="flex justify-between"><span>Retención pendiente de liberar</span><span className="font-mono">{fmtPEN(c.retencionAcum)}</span></div>
                <div className="flex justify-between"><span>Amortización adelantos</span><span className="font-mono">{fmtPEN(c.amortizAdelantos)}</span></div>
                <div className="flex justify-between"><span>Valorizado sin IGV (= ventas)</span><span className="font-mono">{fmtPEN(c.valorizadoSinIgv)}</span></div>
              </div>
            </div>

            {/* Conciliación contable */}
            <div className="rounded-lg border border-line p-3">
              <div className="text-[11px] font-semibold text-ink-3 mb-1">Conciliación con el libro</div>
              {row('Valorizado bruto c/IGV', con.valorizadoBrutoIgv)}
              {row('Saldo cuenta 1212 (asientos)', con.saldo1212)}
              {row('Por cobrar neto (calculado)', con.porCobrarNeto)}
              {Math.abs(con.saldo1212 - con.porCobrarNeto) > 0.5 && (
                <div className="flex justify-between py-1 text-[11px] text-amber-600">
                  <span>Δ 1212 vs calculado (caja no asentada)</span>
                  <span className="font-mono">{fmtPEN(Math.abs(con.saldo1212 - con.porCobrarNeto))}</span>
                </div>
              )}
              <div className="mt-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 p-2 text-[10.5px] text-amber-800 dark:text-amber-300 space-y-1">
                <div><b>No es un error de la liquidación.</b> El 1212 hoy incluye la retención sin segregar ({fmtPEN(con.retencionMezclada)}) y puede no reflejar cobros ya recibidos si el motor no asentó el cobro. La liquidación calcula desde las valorizaciones.</div>
                <div className="text-amber-700/80 dark:text-amber-400/70">{con.nota}</div>
              </div>
            </div>
          </div>
          {liq?.estado === 'reabierta' && liq.motivoReapertura && (
            <div className="text-[10.5px] text-ink-4">Motivo reapertura: {liq.motivoReapertura}</div>
          )}
        </div>
      )}
    </Section>
  );
}

// ════════════════════ CIERRE DE OBRA ════════════════════
// Prueba de cierre: checklist derivado (hitos/garantías/adelantos/valos) + gate server-side.
const VEREDICTO_TONE: Record<string, string> = {
  CERRADA: 'green',
  'LISTA PARA CERRAR': 'green',
  'EN LIQUIDACIÓN': 'amber',
  'EN EJECUCIÓN': 'ink',
};
function CierreObraSection({ proyectoId }: { proyectoId: string }) {
  const qc = useQueryClient();
  const cierreQ = useQuery({ queryKey: ['cierre', proyectoId], queryFn: () => api.proyectos.getCierre(proyectoId) });
  const cerrar = useMutation({
    mutationFn: () => api.proyectos.cerrarObra(proyectoId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cierre', proyectoId] });
      qc.invalidateQueries({ queryKey: ['proyecto', proyectoId] });
    },
  });
  const c = cierreQ.data;
  if (cierreQ.isLoading || !c) return null;
  const cerrada = c.status === 'cerrado';

  return (
    <section className={cn('rounded-md border bg-bg-elev', cerrada ? 'border-ok/40' : 'border-line')}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-[13px] font-semibold flex items-center gap-1.5">
          <Lock className="h-4 w-4 text-ink-3" /> Cierre de obra
          <span className={`chip ${VEREDICTO_TONE[c.veredicto] ?? 'ink'} ml-1`}>{c.veredicto}</span>
        </h3>
        {!cerrada && (
          <button
            disabled={!c.canClose || cerrar.isPending}
            onClick={() => {
              if (window.confirm('¿Cerrar la obra? Marca el proyecto como cerrado. Requiere permiso de reapertura para revertir.')) cerrar.mutate();
            }}
            title={c.canClose ? 'Cerrar obra' : `Falta: ${c.faltantes.join(' · ')}`}
            className="inline-flex items-center gap-1 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium disabled:opacity-40 hover:opacity-90"
          >
            <Lock className="h-3.5 w-3.5" /> {cerrar.isPending ? 'Cerrando...' : 'Cerrar obra'}
          </button>
        )}
      </div>
      <div className="p-3">
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {c.items.map((it) => (
            <div key={it.key} className="flex items-center gap-2 text-[12px]">
              {it.ok
                ? <CheckCircle2 className="h-4 w-4 text-ok shrink-0" />
                : <Circle className="h-4 w-4 text-ink-4 shrink-0" />}
              <span className={cn(it.ok ? 'text-foreground' : 'text-ink-3')}>{it.label}</span>
              <span className="ml-auto text-[11px] text-ink-4 tabular-nums">{it.detail}</span>
            </div>
          ))}
        </div>
        {!cerrada && !c.canClose && (
          <p className="mt-2.5 text-[11px] text-ink-4">
            Falta para cerrar: <span className="text-warn-ink">{c.faltantes.join(' · ')}</span>
          </p>
        )}
        {cerrar.isError && <p className="mt-2 text-[11px] text-destructive">{(cerrar.error as Error).message}</p>}
      </div>
    </section>
  );
}

// ════════════════════ HITOS ════════════════════
function HitosSection({ proyectoId, hitos, loading, sugeridos }: { proyectoId: string; hitos: HitoObra[]; loading: boolean; sugeridos: HitoSugerido[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<HitoInput>({ tipo: 'entrega_terreno', fecha: '', numeroDocumento: '', notas: '' });
  const inval = () => qc.invalidateQueries({ queryKey: ['hitos', proyectoId] });
  const create = useMutation({ mutationFn: () => api.contractual.createHito(proyectoId, form), onSuccess: () => { inval(); setOpen(false); setForm({ tipo: 'entrega_terreno', fecha: '', numeroDocumento: '', notas: '' }); } });
  const del = useMutation({ mutationFn: (id: string) => api.contractual.deleteHito(id), onSuccess: inval });

  const registrar = (s: HitoSugerido) => {
    setForm({ tipo: s.tipo, fecha: s.fechaPlan, numeroDocumento: '', notas: '' });
    setOpen(true);
  };

  return (
    <Section title="Hitos de obra" icon={<Flag className="h-4 w-4 text-ink-3" />} onAdd={() => setOpen((v) => !v)}>
      {sugeridos.length > 0 && <SugerenciasCronograma sugeridos={sugeridos} onRegistrar={registrar} />}
      {open && (
        <FormRow onSubmit={() => create.mutate()} pending={create.isPending} canSubmit={!!form.fecha}>
          <Select value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v as HitoTipo })} options={HITO_TIPOS.map((t) => [t, HITO_LABEL[t]])} />
          <input type="date" className={inputCls} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
          <input className={inputCls} placeholder="N° acta / asiento" value={form.numeroDocumento ?? ''} onChange={(e) => setForm({ ...form, numeroDocumento: e.target.value })} />
          <input className={inputCls} placeholder="notas" value={form.notas ?? ''} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
        </FormRow>
      )}
      {loading ? <Empty txt="Cargando..." /> : hitos.length === 0 ? <Empty txt="Sin hitos · registra desde las actas" /> : (
        <ol className="relative border-l border-line ml-2 space-y-3 py-1">
          {hitos.map((h) => (
            <li key={h.id} className="ml-4 group">
              <div className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-[12.5px] font-semibold">{HITO_LABEL[h.tipo]}</span>
                  <span className="ml-2 text-[11px] text-ink-3 tabular-nums">{h.fecha}</span>
                  {h.numeroDocumento && <span className="ml-2 text-[10.5px] text-ink-4">· {h.numeroDocumento}</span>}
                  {h.notas && <div className="text-[10.5px] text-ink-4 mt-0.5">{h.notas}</div>}
                </div>
                <button onClick={() => del.mutate(h.id)} className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

// Sugerencias del cronograma (.mpp) · banner sobre la lista de hitos
function SugerenciasCronograma({ sugeridos, onRegistrar }: { sugeridos: HitoSugerido[]; onRegistrar: (s: HitoSugerido) => void }) {
  const hoy = new Date();
  const dias = (iso: string) => Math.floor((new Date(`${iso}T00:00:00`).getTime() - hoy.getTime()) / 86_400_000);
  return (
    <div className="rounded-md border border-primary/30 bg-primary/[0.04] p-2.5">
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-primary mb-2">
        <CalendarClock className="h-3.5 w-3.5" /> Detectados en el cronograma
        <span className="font-normal text-ink-4">· fecha planificada del .mpp · confirma con el acta real</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {sugeridos.map((s) => {
          const d = dias(s.fechaPlan);
          const chip = d < 0 ? { t: `vencido hace ${Math.abs(d)}d`, c: 'red' } : d <= 7 ? { t: `en ${d}d`, c: 'amber' } : null;
          return (
            <div key={s.tipo} className="flex items-start justify-between gap-2 rounded-md border border-line bg-bg-elev p-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[12px] font-semibold">{HITO_LABEL[s.tipo]}</span>
                  <span className="text-[11px] text-ink-3 tabular-nums">{s.fechaPlan}</span>
                  {chip && <span className={`chip ${chip.c}`}>{chip.t}</span>}
                </div>
                <div className="text-[10.5px] text-ink-4 mt-0.5 truncate" title={`${s.fuente} · ${s.razon}`}>{s.fuente}</div>
              </div>
              <button onClick={() => onRegistrar(s)} className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-primary text-primary text-[11px] font-medium hover:bg-primary/10">
                <Plus className="h-3 w-3" /> Registrar
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════ GARANTÍAS ════════════════════
function GarantiasSection({ proyectoId, garantias, hitosSet, loading, contratoMonto }: { proyectoId: string; garantias: Garantia[]; hitosSet: Set<string>; loading: boolean; contratoMonto: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const empty: GarantiaInput = { tipo: 'fiel_cumplimiento', monto: 0, numeroCarta: '', bancoEmisor: '', vigenciaDesde: '', vigenciaHasta: '', estado: 'vigente', liberaEnHito: null };
  const [form, setForm] = useState<GarantiaInput>(empty);
  const inval = () => qc.invalidateQueries({ queryKey: ['garantias', proyectoId] });
  const create = useMutation({ mutationFn: () => api.contractual.createGarantia(proyectoId, form), onSuccess: () => { inval(); setOpen(false); setForm(empty); } });
  const del = useMutation({ mutationFn: (id: string) => api.contractual.deleteGarantia(id), onSuccess: inval });
  const setEstado = useMutation({ mutationFn: (v: { id: string; estado: 'vigente' | 'ejecutada' | 'devuelta' }) => api.contractual.updateGarantia(v.id, { estado: v.estado }), onSuccess: inval });
  const genRet = useMutation({ mutationFn: () => api.contractual.generarRetencion(proyectoId), onSuccess: inval });
  const tieneRetencion = garantias.some((g) => g.tipo === 'retencion');

  return (
    <Section title="Garantías (cartas fianza / retención)" icon={<Shield className="h-4 w-4 text-ink-3" />} onAdd={() => setOpen((v) => !v)}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => genRet.mutate()}
          disabled={genRet.isPending}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-line text-[11px] font-medium text-ink-2 hover:bg-bg-sunken disabled:opacity-50"
          title="Suma la retención de todas las valorizaciones y crea/actualiza la garantía de retención"
        >
          <Shield className="h-3.5 w-3.5" /> {genRet.isPending ? 'Calculando...' : tieneRetencion ? 'Recalcular retención (Σ valos)' : 'Generar retención (Σ valos)'}
        </button>
        {genRet.isError && <span className="text-[11px] text-destructive">{(genRet.error as Error).message}</span>}
        {genRet.isSuccess && <span className="text-[11px] text-ok">Retención = {fmtPEN(genRet.data.total)}</span>}
      </div>
      {open && (
        <FormRow onSubmit={() => create.mutate()} pending={create.isPending} canSubmit={form.monto > 0}>
          <Select value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v as GarantiaTipo })} options={GARANTIA_TIPOS.map((t) => [t, GARANTIA_LABEL[t]])} />
          <input className={inputCls} placeholder="N° carta" value={form.numeroCarta ?? ''} onChange={(e) => setForm({ ...form, numeroCarta: e.target.value })} />
          <input className={inputCls} type="number" placeholder="monto" value={form.monto || ''} onChange={(e) => setForm({ ...form, monto: Number(e.target.value) })} />
          {contratoMonto > 0 && <PctDelContrato contratoMonto={contratoMonto} onPick={(m) => setForm({ ...form, monto: m })} />}
          <input className={inputCls} placeholder="banco" value={form.bancoEmisor ?? ''} onChange={(e) => setForm({ ...form, bancoEmisor: e.target.value })} />
          <input className={inputCls} type="date" title="vigencia hasta" value={form.vigenciaHasta ?? ''} onChange={(e) => setForm({ ...form, vigenciaHasta: e.target.value })} />
          <Select value={form.liberaEnHito ?? ''} onChange={(v) => setForm({ ...form, liberaEnHito: (v || null) as HitoTipo | null })} options={[['', 'libera en… (hito)'], ...HITO_TIPOS.map((t) => [t, HITO_LABEL[t]] as [string, string])]} />
        </FormRow>
      )}
      {loading ? <Empty txt="Cargando..." /> : garantias.length === 0 ? <Empty txt="Sin garantías · regístralas del contrato" /> : (
        <Table head={['Tipo', 'N° carta', 'Monto', 'Banco', 'Vigencia', 'Libera en', 'Estado', '']}>
          {garantias.map((g) => {
            const alert = vigenciaAlert(g.vigenciaHasta, g.estado);
            const liberable = g.liberaEnHito != null && hitosSet.has(g.liberaEnHito) && g.estado === 'vigente';
            return (
              <tr key={g.id} className="border-b border-line">
                <Td>{GARANTIA_LABEL[g.tipo]}</Td>
                <Td mono>{g.numeroCarta ?? '—'}</Td>
                <Td mono>{fmtPEN(Number(g.monto))}</Td>
                <Td>{g.bancoEmisor ?? '—'}</Td>
                <Td mono>
                  {g.vigenciaHasta ?? '—'}
                  {alert && <span className={`chip ${alert.cls} ml-1.5`}>{alert.label}</span>}
                </Td>
                <Td>{g.liberaEnHito ? HITO_LABEL[g.liberaEnHito] : '—'}{liberable && <span className="chip green ml-1.5">lista liberar</span>}</Td>
                <Td>
                  <select className="bg-transparent text-[11px] border border-line rounded px-1 py-0.5" value={g.estado} onChange={(e) => setEstado.mutate({ id: g.id, estado: e.target.value as 'vigente' | 'ejecutada' | 'devuelta' })}>
                    <option value="vigente">vigente</option>
                    <option value="ejecutada">ejecutada</option>
                    <option value="devuelta">devuelta</option>
                  </select>
                </Td>
                <Td><button onClick={() => del.mutate(g.id)} className="text-ink-4 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></Td>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );
}

// ════════════════════ ADELANTOS ════════════════════
function AdelantosSection({ proyectoId, adelantos, loading, contratoMonto }: { proyectoId: string; adelantos: Adelanto[]; loading: boolean; contratoMonto: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const empty: AdelantoInput = { tipo: 'adelanto_directo', monto: 0, pctMontoContrato: null, estado: 'pagado', montoAmortizado: 0 };
  const [form, setForm] = useState<AdelantoInput>(empty);
  const inval = () => qc.invalidateQueries({ queryKey: ['adelantos', proyectoId] });
  const create = useMutation({ mutationFn: () => api.contractual.createAdelanto(proyectoId, form), onSuccess: () => { inval(); setOpen(false); setForm(empty); } });
  const del = useMutation({ mutationFn: (id: string) => api.contractual.deleteAdelanto(id), onSuccess: inval });

  return (
    <Section title="Adelantos" icon={<Wallet className="h-4 w-4 text-ink-3" />} onAdd={() => setOpen((v) => !v)}>
      {open && (
        <FormRow onSubmit={() => create.mutate()} pending={create.isPending} canSubmit={form.monto > 0}>
          <Select value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v as GarantiaTipo })} options={ADELANTO_TIPOS.map((t) => [t, GARANTIA_LABEL[t]])} />
          <input
            className={cn(inputCls, 'w-28')}
            type="number"
            step="0.1"
            placeholder="% contrato"
            value={form.pctMontoContrato != null ? form.pctMontoContrato * 100 : ''}
            onChange={(e) => {
              const pct = e.target.value ? Number(e.target.value) : null;
              setForm({
                ...form,
                pctMontoContrato: pct != null ? pct / 100 : null,
                monto: pct != null && contratoMonto > 0 ? Number(((pct / 100) * contratoMonto).toFixed(2)) : form.monto,
              });
            }}
          />
          <input className={inputCls} type="number" placeholder="monto" value={form.monto || ''} onChange={(e) => setForm({ ...form, monto: Number(e.target.value) })} />
          <input className={inputCls} type="number" placeholder="amortizado" value={form.montoAmortizado ?? ''} onChange={(e) => setForm({ ...form, montoAmortizado: e.target.value ? Number(e.target.value) : 0 })} />
        </FormRow>
      )}
      {loading ? <Empty txt="Cargando..." /> : adelantos.length === 0 ? <Empty txt="Sin adelantos" /> : (
        <Table head={['Tipo', 'Monto', '% contrato', 'Amortizado', 'Saldo', 'Estado', '']}>
          {adelantos.map((a) => {
            const saldo = Number(a.monto) - Number(a.montoAmortizado ?? 0);
            const pct = Number(a.montoAmortizado ?? 0) / Number(a.monto || 1);
            return (
              <tr key={a.id} className="border-b border-line">
                <Td>{GARANTIA_LABEL[a.tipo]}</Td>
                <Td mono>{fmtPEN(Number(a.monto))}</Td>
                <Td mono>{a.pctMontoContrato ? `${(Number(a.pctMontoContrato) * 100).toFixed(1)}%` : '—'}</Td>
                <Td mono>{fmtPEN(Number(a.montoAmortizado ?? 0))} <span className="text-ink-4">({(pct * 100).toFixed(0)}%)</span></Td>
                <Td mono>{saldo <= 0.01 ? <span className="text-ok">amortizado</span> : fmtPEN(saldo)}</Td>
                <Td>{a.estado}</Td>
                <Td><button onClick={() => del.mutate(a.id)} className="text-ink-4 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></Td>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );
}

// ════════════════════ UI helpers ════════════════════
const inputCls = 'h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] min-w-0';

// Helper · calcular monto desde % del contrato
function PctDelContrato({ contratoMonto, onPick }: { contratoMonto: number; onPick: (monto: number) => void }) {
  const [pct, setPct] = useState('');
  return (
    <span className="inline-flex items-center gap-1" title={`Contrato S/ ${contratoMonto.toLocaleString('es-PE')}`}>
      <input
        className={cn(inputCls, 'w-16')}
        type="number"
        step="0.1"
        placeholder="% contr"
        value={pct}
        onChange={(e) => {
          setPct(e.target.value);
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v > 0) onPick(Number(((v / 100) * contratoMonto).toFixed(2)));
        }}
      />
    </span>
  );
}

function Section({ title, icon, onAdd, children }: { title: string; icon: React.ReactNode; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-bg-elev">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h3 className="text-[13px] font-semibold flex items-center gap-1.5">{icon}{title}</h3>
        {onAdd && <button onClick={onAdd} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Agregar</button>}
      </div>
      <div className="p-3 space-y-3">{children}</div>
    </section>
  );
}

function FormRow({ children, onSubmit, pending, canSubmit }: { children: React.ReactNode; onSubmit: () => void; pending: boolean; canSubmit: boolean }) {
  return (
    <div className="rounded-md border border-line bg-bg-sunken/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <div className="mt-2 flex justify-end">
        <button disabled={!canSubmit || pending} onClick={onSubmit} className="inline-flex items-center gap-1 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium disabled:opacity-50">
          {pending ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line bg-bg-sunken">
            {head.map((h, i) => <th key={i} className="px-2.5 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-4">{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={cn('px-2.5 py-1.5 text-[11.5px]', mono && 'font-mono tabular-nums')}>{children}</td>;
}

function Empty({ txt }: { txt: string }) {
  return <div className="text-center py-4 text-[12px] text-ink-3">{txt}</div>;
}

function Stat({ label, value, icon, mono, accent }: { label: string; value: string; icon?: React.ReactNode; mono?: boolean; accent?: 'amber' }) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-2.5">
      <div className="flex items-center gap-1.5 text-ink-4">{icon}<span className="font-mono text-[9px] uppercase tracking-wider truncate">{label}</span></div>
      <div className={cn('mt-0.5 font-bold tracking-[-0.02em]', mono ? 'text-[14px] font-mono' : 'text-[16px]', accent === 'amber' && 'text-warn-ink')}>{value}</div>
    </div>
  );
}
