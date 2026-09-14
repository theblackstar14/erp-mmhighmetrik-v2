import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, Calculator, Download, HardHat, LayoutDashboard, Plus, Printer, Search, Settings, Trash2, Users, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { TabFade } from '@/components/ui/Skeleton.js';
import { type Empleado, type EmpleadoInput, type PlanillaDetalle, type PlanillaLinea, api } from '@/lib/api.js';
import { cn, fmtDate, fmtPEN } from '@/lib/utils.js';
import { CuentaContableSelect } from '@/components/contabilidad/CuentaContableSelect.js';

// ─── Constantes CC ───────────────────────────────────────────
const CATS = ['Operario', 'Oficial', 'Peón', 'Capataz'];
const CAT_COLOR: Record<string, string> = { Operario: '#3B5BDB', Oficial: '#2F7D5C', Peón: '#B45309', Capataz: '#7048E8' };
// Tipos de asistencia (tareo) · código corto + color, fiel a la v1
const ASIST: Record<string, { lbl: string; color: string; bg: string; short: string }> = {
  normal: { lbl: 'Normal', color: '#16A34A', bg: '#DCFCE7', short: 'P' },
  tardanza: { lbl: 'Tardanza', color: '#B45309', bg: '#FEF3C7', short: 'T' },
  falta_inj: { lbl: 'Falta injust.', color: '#DC2626', bg: '#FEE2E2', short: 'F' },
  falta_just: { lbl: 'Falta justif.', color: '#7C3AED', bg: '#EDE9FE', short: 'J' },
  descanso_med: { lbl: 'Descanso méd.', color: '#0891B2', bg: '#CFFAFE', short: 'DM' },
  feriado_trab: { lbl: 'Feriado trab.', color: '#EA580C', bg: '#FFEDD5', short: 'FT' },
  vacaciones: { lbl: 'Vacaciones', color: '#6366F1', bg: '#E0E7FF', short: 'V' },
  dominical: { lbl: 'Dominical', color: '#71717A', bg: '#F4F4F5', short: 'D' },
};
const CICLO = ['normal', 'tardanza', 'falta_inj', 'falta_just', 'descanso_med', 'feriado_trab', 'vacaciones', '']; // '' limpia
const DIAS_TRABAJADOS = new Set(['normal', 'tardanza', 'feriado_trab']);
const inputCls = 'h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] min-w-0';

// Rango de fechas inclusivo (UTC · evita off-by-1)
function rangoFechas(ini: string, fin: string): string[] {
  const out: string[] = [];
  const d = new Date(`${ini}T00:00:00Z`);
  const end = new Date(`${fin}T00:00:00Z`);
  for (let i = 0; i < 31 && d <= end; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const dowOf = (f: string) => DOW[new Date(`${f}T00:00:00Z`).getUTCDay()]!;
const diaOf = (f: string) => f.slice(8, 10);
const diasParaVencer = (f: string | null) => (f ? Math.round((new Date(`${f}T00:00:00Z`).getTime() - Date.now()) / 86400000) : null);

const TABS = [
  { id: 'dashboard', lbl: 'Dashboard', icon: LayoutDashboard },
  { id: 'trabajadores', lbl: 'Trabajadores', icon: Users },
  { id: 'asistencia', lbl: 'Asistencia', icon: HardHat },
  { id: 'planilla', lbl: 'Planilla', icon: Calculator },
  { id: 'config', lbl: 'Configuración', icon: Settings },
] as const;

// ─── Página ──────────────────────────────────────────────────
export function PersonalPage() {
  const { data: proyData } = useQuery({ queryKey: ['proyectos-list'], queryFn: () => api.proyectos.list() });
  const proyectos = proyData?.proyectos ?? [];
  const [sel, setSel] = useState('');
  const proyectoId = sel || proyectos[0]?.id || '';
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('dashboard');
  const [semanaId, setSemanaId] = useState<string | null>(null);

  const empleadosQ = useQuery({ queryKey: ['empleados', 'obrero', proyectoId], queryFn: () => api.planilla.listEmpleados('obrero', proyectoId), enabled: !!proyectoId });
  const empleados = empleadosQ.data?.empleados ?? [];

  // Alerta SCTR vencido / por vencer (<30 días)
  const sctrAlertas = empleados.filter((e) => { const d = diasParaVencer(e.sctrVigencia); return d != null && d < 30; });

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Personal · Planilla Construcción Civil</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">Régimen especial D.S. 011-79-TR · Convenio FTCCP-CAPECO · obreros por obra</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">{empleados.length} obreros</span>
          <Building2 className="h-4 w-4 text-ink-3" />
          <select className="h-9 px-3 rounded-md border border-line bg-bg-elev text-[12.5px] w-full sm:w-[260px] max-w-full truncate" value={proyectoId} onChange={(e) => { setSel(e.target.value); setSemanaId(null); }}>
            {proyectos.length === 0 && <option value="">Sin proyectos</option>}
            {proyectos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre.length > 42 ? `${p.nombre.slice(0, 42)}…` : p.nombre}</option>)}
          </select>
        </div>
      </header>

      {sctrAlertas.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2.5 text-[12px]">
          <AlertTriangle className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold text-rose-600">SCTR por vencer / vencido:</span>{' '}
            {sctrAlertas.map((e) => { const d = diasParaVencer(e.sctrVigencia)!; return `${e.nombre} (${d < 0 ? 'vencido' : `${d}d`})`; }).join(' · ')}
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium border-b-2 -mb-px transition-colors', tab === t.id ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-ink-2')}>
            <t.icon className="h-3.5 w-3.5" /> {t.lbl}
          </button>
        ))}
      </div>

      {!proyectoId ? (
        <div className="rounded-md border border-line bg-bg-elev p-8 text-center text-[12px] text-ink-3">Crea un proyecto primero</div>
      ) : (
        <TabFade tabKey={tab}>
          {tab === 'dashboard' && <DashboardTab />}
          {tab === 'trabajadores' && <TrabajadoresTab proyectoId={proyectoId} empleados={empleados} loading={empleadosQ.isLoading} />}
          {tab === 'asistencia' && <AsistenciaTab proyectoId={proyectoId} proyectos={proyectos} empleados={empleados} semanaId={semanaId} setSemanaId={setSemanaId} />}
          {tab === 'planilla' && <PlanillaView proyectoId={proyectoId} empleados={empleados} semanaId={semanaId} setSemanaId={setSemanaId} />}
          {tab === 'config' && <ConfigTab />}
        </TabFade>
      )}
    </div>
  );
}

// ─── Trabajadores ────────────────────────────────────────────
// ─── Dashboard global (todas las obras) ──────────────────────
function PKpi({ lbl, val, sub, accent }: { lbl: string; val: string; sub?: string; accent?: 'primary' | 'destructive' }) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-4">
      <div className="text-[10px] uppercase tracking-wider text-ink-4 font-medium">{lbl}</div>
      <div className={cn('text-[26px] font-bold tracking-[-0.02em] tabular-nums mt-1 leading-none', accent === 'primary' && 'text-primary', accent === 'destructive' && 'text-destructive')}>{val}</div>
      {sub && <div className="text-[11px] text-ink-3 mt-1.5">{sub}</div>}
    </div>
  );
}

function DashboardTab() {
  const { data, isLoading } = useQuery({ queryKey: ['planilla-dashboard'], queryFn: () => api.planilla.getDashboard() });
  if (isLoading || !data) return <div className="text-[12px] text-ink-3">Cargando dashboard...</div>;
  const maxCat = Math.max(1, ...data.porCategoria.map((c) => c.count));
  const catLabel = data.porCategoria.map((c) => c.count).join(' / ');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-4">
        <Building2 className="h-3.5 w-3.5" />
        <span>Consolidado · <b className="text-ink-3">todas las obras</b> · no depende de la obra seleccionada arriba</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <PKpi lbl="Nómina semana actual" val={fmtPEN(data.nominaSemana)} sub={`Costo total: ${fmtPEN(data.costoTotal)}`} accent="primary" />
        <PKpi lbl="Trabajadores activos" val={String(data.trabajadoresActivos)} sub={data.porCategoria.length ? `Por categoría: ${catLabel}` : undefined} />
        <PKpi lbl="Faltas inj. semana" val={String(data.faltasInjustificadas)} sub="Descontables" accent={data.faltasInjustificadas > 0 ? 'destructive' : undefined} />
        <PKpi lbl="DM activos" val={String(data.dmActivos)} sub="Subsidios EsSalud" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-md border border-line bg-bg-elev p-4">
          <h3 className="text-[14px] font-semibold mb-3.5">Distribución por categoría</h3>
          <div className="space-y-3">
            {data.porCategoria.map((c) => (
              <div key={c.categoria}>
                <div className="flex justify-between items-baseline text-[12px] mb-1">
                  <span className="font-semibold">{c.categoria}</span>
                  <span className="text-ink-3 tabular-nums">{c.count} · S/ {c.jornal.toFixed(2)}/día</span>
                </div>
                <div className="h-2 rounded-full bg-bg-sunken overflow-hidden">
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(c.count / maxCat) * 100}%`, background: CAT_COLOR[c.categoria] ?? '#3B5BDB' }} />
                </div>
              </div>
            ))}
            {data.porCategoria.length === 0 && <div className="text-[12px] text-ink-3">Sin trabajadores</div>}
          </div>
        </div>
        <div className="rounded-md border border-line bg-bg-elev p-4">
          <h3 className="text-[14px] font-semibold mb-3.5">Trabajadores por obra</h3>
          <div className="space-y-2">
            {data.porObra.map((o) => (
              <div key={o.codigo} className="flex items-center justify-between rounded-md border border-line bg-bg-sunken/30 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] text-ink-4">{o.codigo}</div>
                  <div className="text-[12.5px] text-primary truncate">{o.nombre}</div>
                </div>
                <div className="text-[18px] font-bold tabular-nums shrink-0 ml-3">{o.count}</div>
              </div>
            ))}
            {data.porObra.length === 0 && <div className="text-[12px] text-ink-3">Sin obreros asignados a obras</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrabajadoresTab({ proyectoId, empleados, loading }: { proyectoId: string; empleados: Empleado[]; loading: boolean }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [catF, setCatF] = useState('');
  const [form, setForm] = useState<Empleado | 'new' | null>(null);
  const del = useMutation({ mutationFn: (id: string) => api.planilla.deleteEmpleado(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['empleados', 'obrero', proyectoId] }) });

  const filtered = empleados.filter((e) => (!catF || e.categoria === catF) && (!q || `${e.nombre} ${e.numDoc ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const porCat = CATS.map((c) => ({ c, n: empleados.filter((e) => e.categoria === c).length }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-4" />
          <input className={cn(inputCls, 'w-full pl-7')} placeholder="Buscar nombre / DNI" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setCatF('')} className={cn('h-8 px-2.5 rounded-md text-[11.5px] border', !catF ? 'bg-primary text-primary-foreground border-primary' : 'border-line text-ink-2')}>Todas ({empleados.length})</button>
          {porCat.map(({ c, n }) => <button key={c} onClick={() => setCatF(c)} className={cn('h-8 px-2.5 rounded-md text-[11.5px] border', catF === c ? 'text-primary-foreground border-transparent' : 'border-line text-ink-2')} style={catF === c ? { background: CAT_COLOR[c] } : undefined}>{c} ({n})</button>)}
        </div>
        <button onClick={() => setForm('new')} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium ml-auto"><Plus className="h-3.5 w-3.5" /> Obrero</button>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-md border border-line bg-bg-elev animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-line bg-bg-elev p-8 text-center text-[12px] text-ink-3">Sin obreros · agrega con "+ Obrero"</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => <TrabCard key={e.id} e={e} onEdit={() => setForm(e)} onDelete={() => del.mutate(e.id)} />)}
        </div>
      )}

      {form && <TrabForm proyectoId={proyectoId} empleado={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['empleados', 'obrero', proyectoId] }); setForm(null); }} />}
    </div>
  );
}

function TrabCard({ e, onEdit, onDelete }: { e: Empleado; onEdit: () => void; onDelete: () => void }) {
  const color = CAT_COLOR[e.categoria ?? ''] ?? '#71717A';
  const ini = e.nombre.split(' ').slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  const esAfp = (e.sistemaPension ?? '').toUpperCase().includes('AFP');
  const sctrD = diasParaVencer(e.sctrVigencia);
  return (
    <div className="rounded-md border border-line bg-bg-elev p-3 border-l-[3px]" style={{ borderLeftColor: color }}>
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: color }}>{ini}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{e.nombre}</div>
          <div className="font-mono text-[10.5px] text-ink-4">DNI {e.numDoc ?? '—'}</div>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="text-ink-4 hover:text-primary text-[10px]">editar</button>
          <button onClick={onDelete} className="text-ink-4 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
        <span className="rounded px-1.5 py-0.5 font-medium text-white" style={{ background: color }}>{e.categoria}</span>
        <span className="rounded bg-bg-sunken px-1.5 py-0.5 text-ink-2">{esAfp ? e.sistemaPension : 'ONP/SNP'}</span>
        {e.bonifAltura && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600">↑ Altura</span>}
        {e.bonifAgua && <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-cyan-600">💧 Agua</span>}
        {e.aplicaMovilidad && <span className="rounded bg-bg-sunken px-1.5 py-0.5 text-ink-3">Movilidad</span>}
        {e.numHijos > 0 && <span className="rounded bg-bg-sunken px-1.5 py-0.5 text-ink-3">{e.numHijos} hijo(s)</span>}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10.5px] text-ink-4">
        <span>Ingreso {fmtDate(e.fechaIngreso)}</span>
        {sctrD != null && <span className={cn(sctrD < 30 ? 'text-rose-500 font-medium' : 'text-ink-4')}>SCTR {sctrD < 0 ? 'vencido' : `${sctrD}d`}</span>}
      </div>
    </div>
  );
}

function TrabForm({ proyectoId, empleado, onClose, onSaved }: { proyectoId: string; empleado: Empleado | null; onClose: () => void; onSaved: () => void }) {
  const afpQ = useQuery({ queryKey: ['afp'], queryFn: () => api.planilla.listAfp() });
  const afps = ['S.N.P.', ...(afpQ.data?.tasas.map((t) => t.afp) ?? [])];
  const [f, setF] = useState<EmpleadoInput>(
    empleado
      ? { nombre: empleado.nombre, numDoc: empleado.numDoc, categoria: empleado.categoria, sistemaPension: empleado.sistemaPension, aplicaMovilidad: empleado.aplicaMovilidad, bonifAltura: empleado.bonifAltura, bonifAgua: empleado.bonifAgua, numHijos: empleado.numHijos, fechaIngreso: empleado.fechaIngreso, sctrVigencia: empleado.sctrVigencia, tipoPlanilla: 'obrero', proyectoId }
      : { nombre: '', numDoc: '', categoria: 'Operario', sistemaPension: 'S.N.P.', aplicaMovilidad: false, bonifAltura: false, bonifAgua: false, numHijos: 0, fechaIngreso: '', sctrVigencia: '', tipoPlanilla: 'obrero', proyectoId },
  );
  const save = useMutation({ mutationFn: () => (empleado ? api.planilla.updateEmpleado(empleado.id, f) : api.planilla.createEmpleado(f)), onSuccess: onSaved });
  const set = (p: Partial<EmpleadoInput>) => setF((s) => ({ ...s, ...p }));
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={onClose}>
      <div className="w-[460px] max-h-[90vh] overflow-auto rounded-xl border border-line bg-bg-elev shadow-2xl animate-modalPop" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-[14px] font-semibold">{empleado ? 'Editar obrero' : 'Nuevo obrero'}</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink-2"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-2.5">
          <Lbl span2 t="Nombre completo"><input className={cn(inputCls, 'w-full')} value={f.nombre} onChange={(e) => set({ nombre: e.target.value })} /></Lbl>
          <Lbl t="DNI"><input inputMode="numeric" maxLength={8} className={cn(inputCls, 'w-full', f.numDoc && f.numDoc.length !== 8 && 'border-rose-500')} value={f.numDoc ?? ''} onChange={(e) => set({ numDoc: e.target.value.replace(/\D/g, '').slice(0, 8) })} /></Lbl>
          <Lbl t="Categoría"><select className={cn(inputCls, 'w-full')} value={f.categoria ?? ''} onChange={(e) => set({ categoria: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Lbl>
          <Lbl t="Sistema pensión"><select className={cn(inputCls, 'w-full')} value={f.sistemaPension ?? ''} onChange={(e) => set({ sistemaPension: e.target.value })}>{afps.map((a) => <option key={a}>{a}</option>)}</select></Lbl>
          <Lbl t="N° hijos (escolar)"><input type="number" min={0} className={cn(inputCls, 'w-full')} value={f.numHijos ?? 0} onChange={(e) => set({ numHijos: Number(e.target.value) })} /></Lbl>
          <Lbl t="Fecha ingreso"><input type="date" className={cn(inputCls, 'w-full')} value={f.fechaIngreso ?? ''} onChange={(e) => set({ fechaIngreso: e.target.value })} /></Lbl>
          <Lbl t="SCTR vigencia hasta"><input type="date" className={cn(inputCls, 'w-full')} value={f.sctrVigencia ?? ''} onChange={(e) => set({ sctrVigencia: e.target.value })} /></Lbl>
          <div className="col-span-2 flex flex-wrap gap-3 pt-1 text-[11.5px] text-ink-2">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.aplicaMovilidad} onChange={(e) => set({ aplicaMovilidad: e.target.checked })} /> Movilidad</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.bonifAltura} onChange={(e) => set({ bonifAltura: e.target.checked })} /> Bonif. altura</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.bonifAgua} onChange={(e) => set({ bonifAgua: e.target.checked })} /> Contacto agua</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] text-ink-2">Cancelar</button>
          <button disabled={!f.nombre || save.isPending} onClick={() => save.mutate()} className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50">{save.isPending ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
function Lbl({ t, span2, children }: { t: string; span2?: boolean; children: React.ReactNode }) {
  return <label className={cn('flex flex-col gap-1', span2 && 'col-span-2')}><span className="text-[10.5px] font-medium text-ink-3">{t}</span>{children}</label>;
}

// ─── Selector de semana (compartido) ─────────────────────────
function SemanaBar({ proyectoId, semanaId, setSemanaId }: { proyectoId: string; semanaId: string | null; setSemanaId: (id: string | null) => void }) {
  const qc = useQueryClient();
  const semanasQ = useQuery({ queryKey: ['planilla-semanas', proyectoId], queryFn: () => api.planilla.listSemanas(proyectoId) });
  const semanas = semanasQ.data?.semanas ?? [];
  const [ini, setIni] = useState('');
  const [fin, setFin] = useState('');
  const [adding, setAdding] = useState(false);
  const create = useMutation({ mutationFn: () => api.planilla.createSemana(proyectoId, { fechaInicio: ini, fechaFin: fin }), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['planilla-semanas', proyectoId] }); setSemanaId(r.semana.id); setAdding(false); setIni(''); setFin(''); } });
  useEffect(() => { if (!semanaId && semanas[0]) setSemanaId(semanas[0].id); }, [semanas, semanaId, setSemanaId]);
  return (
    <div className="rounded-md border border-line bg-bg-elev p-3 flex flex-wrap items-center gap-2">
      <select className={inputCls} value={semanaId ?? ''} onChange={(e) => setSemanaId(e.target.value || null)}>
        <option value="">— elige semana —</option>
        {semanas.map((s) => <option key={s.id} value={s.id}>{fmtDate(s.fechaInicio)} → {fmtDate(s.fechaFin)} ({s.estado})</option>)}
      </select>
      {adding ? (
        <div className="flex items-center gap-1.5">
          <input className={inputCls} type="date" value={ini} onChange={(e) => setIni(e.target.value)} />
          <span className="text-ink-4">→</span>
          <input className={inputCls} type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
          <button disabled={!ini || !fin || create.isPending} onClick={() => create.mutate()} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] disabled:opacity-50">Crear</button>
          <button onClick={() => setAdding(false)} className="text-ink-4"><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-line text-[11.5px] text-ink-2"><Plus className="h-3.5 w-3.5" /> Nueva semana</button>
      )}
    </div>
  );
}

// ─── Asistencia (tareo · grid diario · obra por fila) ────────
function AsistenciaTab({ proyectoId, proyectos, empleados, semanaId, setSemanaId }: { proyectoId: string; proyectos: { id: string; codigo: string; nombre: string }[]; empleados: Empleado[]; semanaId: string | null; setSemanaId: (id: string | null) => void }) {
  const qc = useQueryClient();
  const semanasQ = useQuery({ queryKey: ['planilla-semanas', proyectoId], queryFn: () => api.planilla.listSemanas(proyectoId) });
  const semana = semanasQ.data?.semanas.find((s) => s.id === semanaId) ?? null;
  const asistQ = useQuery({ queryKey: ['asistencia', semanaId], queryFn: () => api.planilla.getAsistencia(semanaId!), enabled: !!semanaId });
  // mapas locales: empId|fecha → tipo · empId → obra (imputación del día)
  const [grid, setGrid] = useState<Record<string, string>>({});
  const [rowObra, setRowObra] = useState<Record<string, string>>({});
  useEffect(() => {
    const m: Record<string, string> = {}; const o: Record<string, string> = {};
    for (const a of asistQ.data?.asistencia ?? []) { m[`${a.empleadoId}|${a.fecha}`] = a.tipo; if (a.proyectoId) o[a.empleadoId] = a.proyectoId; }
    setGrid(m); setRowObra(o);
  }, [asistQ.data]);

  const dias = useMemo(() => (semana ? rangoFechas(semana.fechaInicio, semana.fechaFin) : []), [semana]);
  const obraDe = (empId: string) => rowObra[empId] ?? proyectoId;
  const setCell = useMutation({ mutationFn: (v: { empleadoId: string; fecha: string; tipo: string; proyectoId: string }) => api.planilla.setAsistencia(semanaId!, v), onSuccess: () => qc.invalidateQueries({ queryKey: ['asistencia', semanaId] }) });
  const cycle = (empId: string, fecha: string) => {
    const cur = grid[`${empId}|${fecha}`] ?? '';
    const next = CICLO[(CICLO.indexOf(cur) + 1) % CICLO.length]!;
    setGrid((g) => ({ ...g, [`${empId}|${fecha}`]: next }));
    setCell.mutate({ empleadoId: empId, fecha, tipo: next, proyectoId: obraDe(empId) });
  };
  const cambiarObra = (empId: string, obra: string) => {
    setRowObra((r) => ({ ...r, [empId]: obra }));
    // re-imputar los días ya marcados de ese obrero a la nueva obra
    for (const f of dias) { const t = grid[`${empId}|${f}`]; if (t) setCell.mutate({ empleadoId: empId, fecha: f, tipo: t, proyectoId: obra }); }
  };
  const marcarTodos = () => { for (const e of empleados) for (const f of dias) if (dowOf(f) !== 'Dom' && !grid[`${e.id}|${f}`]) { setGrid((g) => ({ ...g, [`${e.id}|${f}`]: 'normal' })); setCell.mutate({ empleadoId: e.id, fecha: f, tipo: 'normal', proyectoId: obraDe(e.id) }); } };
  const totalDias = empleados.reduce((s, e) => s + dias.filter((f) => DIAS_TRABAJADOS.has(grid[`${e.id}|${f}`] ?? '')).length, 0);

  return (
    <div className="space-y-3">
      <SemanaBar proyectoId={proyectoId} semanaId={semanaId} setSemanaId={setSemanaId} />
      {!semana ? (
        <div className="rounded-md border border-line bg-bg-elev p-8 text-center text-[12px] text-ink-3">Elige o crea una semana</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {Object.values(ASIST).map((a) => <span key={a.short} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: a.bg, color: a.color }}>{a.short} · {a.lbl}</span>)}
            </div>
            <button onClick={marcarTodos} className="ml-auto h-8 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium">✓ Marcar todos normales</button>
          </div>
          <div className="rounded-md border border-line bg-bg-elev overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line bg-bg-sunken">
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink-4 min-w-[170px]">Trabajador</th>
                <th className="px-2 py-2 text-left font-mono text-[10px] uppercase text-ink-4 min-w-[130px]">Obra del día</th>
                {dias.map((f) => <th key={f} className="px-2 py-2 text-center font-mono text-[10px] text-ink-4"><div>{dowOf(f)}</div><div className="text-ink-3">{diaOf(f)}</div></th>)}
                <th className="px-3 py-2 text-center font-mono text-[10px] uppercase text-ink-4">Días</th>
              </tr></thead>
              <tbody>
                {empleados.map((e) => {
                  const trab = dias.filter((f) => DIAS_TRABAJADOS.has(grid[`${e.id}|${f}`] ?? '')).length;
                  return (
                    <tr key={e.id} className="border-b border-line">
                      <td className="px-3 py-1.5"><div className="text-[12px] font-medium">{e.nombre}</div><div className="text-[10px] text-ink-4">{e.categoria}</div></td>
                      <td className="px-2 py-1.5"><select className={cn(inputCls, 'w-full max-w-[130px]')} value={obraDe(e.id)} onChange={(ev) => cambiarObra(e.id, ev.target.value)}>{proyectos.map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}</select></td>
                      {dias.map((f) => {
                        const tipo = grid[`${e.id}|${f}`] ?? '';
                        const cfg = ASIST[tipo];
                        return <td key={f} className="px-1 py-1.5 text-center"><button onClick={() => cycle(e.id, f)} className="mx-auto flex h-7 w-7 items-center justify-center rounded font-mono text-[10px] font-bold" style={cfg ? { background: cfg.bg, color: cfg.color } : { background: 'transparent', color: 'var(--ink-4,#999)' }}>{cfg?.short ?? '·'}</button></td>;
                      })}
                      <td className="px-3 py-1.5 text-center font-mono text-[12px] font-semibold">{trab}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr className="border-t border-line bg-bg-sunken/40">
                <td className="px-3 py-1.5 text-[11px] text-ink-3" colSpan={2}>{empleados.length} obreros</td>
                {dias.map((f) => <td key={f} />)}
                <td className="px-3 py-1.5 text-center font-mono text-[12px] font-bold">{totalDias}</td>
              </tr></tfoot>
            </table>
          </div>
          <p className="text-[11px] text-ink-4">Click en cada celda para ciclar el estado (se guarda solo). La <b>obra del día</b> imputa los días de ese obrero al costo directo de esa obra — un obrero puede repartirse entre obras.</p>
        </>
      )}
    </div>
  );
}

// ─── Planilla ────────────────────────────────────────────────
type LineaState = PlanillaLinea & { incluir: boolean };
function PlanillaView({ proyectoId, empleados, semanaId, setSemanaId }: { proyectoId: string; empleados: Empleado[]; semanaId: string | null; setSemanaId: (id: string | null) => void }) {
  const qc = useQueryClient();
  const detalleQ = useQuery({ queryKey: ['planilla-detalle', semanaId], queryFn: () => api.planilla.getSemana(semanaId!), enabled: !!semanaId });
  const asistQ = useQuery({ queryKey: ['asistencia', semanaId], queryFn: () => api.planilla.getAsistencia(semanaId!), enabled: !!semanaId });
  const [lineas, setLineas] = useState<Record<string, LineaState>>({});
  const [boleta, setBoleta] = useState<PlanillaDetalle | null>(null);
  const [exportNote, setExportNote] = useState(false);
  const [cuentaCosto, setCuentaCosto] = useState<string | null>('621'); // WS1 · cuenta de costo (default fuerte 621) · aplica a toda la semana

  // días por obrero derivados de asistencia
  const diasAsist = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of asistQ.data?.asistencia ?? []) if (DIAS_TRABAJADOS.has(a.tipo)) m[a.empleadoId] = (m[a.empleadoId] ?? 0) + 1;
    return m;
  }, [asistQ.data]);

  useEffect(() => {
    const det = detalleQ.data?.detalle ?? [];
    const next: Record<string, LineaState> = {};
    for (const e of empleados) {
      const d = det.find((x) => x.empleadoId === e.id);
      const diasA = diasAsist[e.id] ?? 0;
      next[e.id] = d
        ? { empleadoId: e.id, incluir: true, dias: d.diasTrabajados, jornadaDominical: d.jornadaDominical, horasExtra60: Number(d.horasExtra60), horasExtra100: Number(d.horasExtra100), escolaridad: Number(d.montoEscolaridad), renta5ta: Number(d.montoRenta5ta), adelanto: Number(d.montoAdelanto), sindical: Number(d.montoSindical) }
        : { empleadoId: e.id, incluir: diasA > 0, dias: diasA || 6, jornadaDominical: (diasA || 6) >= 6, horasExtra60: 0, horasExtra100: 0, escolaridad: 0, renta5ta: 0, adelanto: 0, sindical: 0 };
    }
    setLineas(next);
  }, [detalleQ.data, empleados, diasAsist]);

  const setL = (id: string, patch: Partial<LineaState>) => setLineas((p) => ({ ...p, [id]: { ...p[id]!, ...patch } }));
  const calcular = useMutation({ mutationFn: () => api.planilla.calcular(semanaId!, Object.values(lineas).filter((l) => l.incluir).map(({ incluir, ...l }) => ({ ...l, cuentaContable: cuentaCosto }))), onSuccess: () => qc.invalidateQueries({ queryKey: ['planilla-detalle', semanaId] }) });
  const totales = detalleQ.data?.totales;
  const detalle = detalleQ.data?.detalle ?? [];

  return (
    <div className="space-y-3">
      <SemanaBar proyectoId={proyectoId} semanaId={semanaId} setSemanaId={setSemanaId} />
      {!semanaId ? (
        <div className="rounded-md border border-line bg-bg-elev p-8 text-center text-[12px] text-ink-3">Elige o crea una semana</div>
      ) : empleados.length === 0 ? (
        <div className="rounded-md border border-line bg-bg-elev p-8 text-center text-[12px] text-ink-3">Sin obreros en esta obra</div>
      ) : (
        <>
          <div className="rounded-md border border-line bg-bg-elev">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h3 className="text-[13px] font-semibold">Cálculo de la semana <span className="text-ink-4 font-normal">· días desde asistencia</span></h3>
              <div className="flex items-center gap-2">
                {/* WS1 · cuenta de costo de la planilla (default 621) · Kelly confirma/cambia */}
                <div className="flex items-center gap-1.5"><span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Costo</span><CuentaContableSelect value={cuentaCosto} onChange={(c) => setCuentaCosto(c)} placeholder="Cuenta de costo (62x)…" /></div>
                <button onClick={() => setExportNote((v) => !v)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken"><Download className="h-3.5 w-3.5" /> Exportar semana</button>
                <button onClick={() => calcular.mutate()} disabled={calcular.isPending} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50"><Calculator className="h-3.5 w-3.5" /> {calcular.isPending ? 'Calculando…' : 'Calcular planilla'}</button>
              </div>
            </div>
            {exportNote && <div className="border-b border-line px-4 py-2 text-[11px] text-ink-4">Export Telecrédito (transferencia masiva del banco) — en preparación. Generará por obrero: DNI + banco + N° de cuenta + neto a pagar.</div>}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-line bg-bg-sunken">{['', 'Obrero', 'Cat.', 'AFP/SNP', 'Días', 'Domin.', 'H.E. 60%', 'H.E. 100%', 'Adelanto'].map((h, i) => <th key={i} className={cn('px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4', i >= 4 ? 'text-center' : 'text-left')}>{h}</th>)}</tr></thead>
                <tbody>
                  {empleados.map((e) => {
                    const l = lineas[e.id];
                    if (!l) return null;
                    return (
                      <tr key={e.id} className={cn('border-b border-line', !l.incluir && 'opacity-50')}>
                        <td className="px-2.5 py-1.5"><input type="checkbox" checked={l.incluir} onChange={(ev) => setL(e.id, { incluir: ev.target.checked })} /></td>
                        <td className="px-2.5 py-1.5 text-[11.5px] font-medium">{e.nombre}</td>
                        <td className="px-2.5 py-1.5 text-[11px] text-ink-3">{e.categoria ?? '—'}</td>
                        <td className="px-2.5 py-1.5 text-[10.5px] text-ink-4">{e.sistemaPension ?? '—'}</td>
                        <td className="px-2.5 py-1.5"><input className={cn(inputCls, 'w-14 text-center')} type="number" min={0} max={7} value={l.dias} onChange={(ev) => setL(e.id, { dias: Number(ev.target.value) })} disabled={!l.incluir} /></td>
                        <td className="px-2.5 py-1.5 text-center"><input type="checkbox" checked={l.jornadaDominical} onChange={(ev) => setL(e.id, { jornadaDominical: ev.target.checked })} disabled={!l.incluir} /></td>
                        <td className="px-2.5 py-1.5"><input className={cn(inputCls, 'w-14 text-center')} type="number" value={l.horasExtra60 || ''} onChange={(ev) => setL(e.id, { horasExtra60: Number(ev.target.value) })} disabled={!l.incluir} /></td>
                        <td className="px-2.5 py-1.5"><input className={cn(inputCls, 'w-14 text-center')} type="number" value={l.horasExtra100 || ''} onChange={(ev) => setL(e.id, { horasExtra100: Number(ev.target.value) })} disabled={!l.incluir} /></td>
                        <td className="px-2.5 py-1.5"><input className={cn(inputCls, 'w-20 text-center')} type="number" value={l.adelanto || ''} onChange={(ev) => setL(e.id, { adelanto: Number(ev.target.value) })} disabled={!l.incluir} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {totales && totales.obreros > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              <Stat label="Total bruto" value={fmtPEN(totales.totalIngreso)} sub={`${totales.obreros} boletas`} />
              <Stat label="Descuentos" value={fmtPEN(totales.totalDescuentos)} danger />
              <Stat label="Neto a pagar" value={fmtPEN(totales.netoPago)} accent />
              <Stat label="Aportes empleador" value={fmtPEN(totales.esSalud + totales.sctr + totales.sencico)} sub="EsSalud+SCTR+Sencico" />
              <Stat label="Costo total" value={fmtPEN(totales.costoTotal)} primary />
            </div>
          )}

          {detalle.length > 0 && (
            <div className="rounded-md border border-line bg-bg-elev px-4 py-2.5 text-[11px] text-ink-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-semibold text-ink-2">Conexión contable:</span>
              <span>asiento 621 + 627x (incl. SCTR/SENCICO)</span>
              <span className="text-ink-4">·</span>
              <span>imputado a Costo Directo por obra</span>
              <span className="text-ink-4">·</span>
              <span>PLE 5.1 Diario / 6.1 Mayor</span>
            </div>
          )}

          {detalle.length > 0 && (
            <div className="rounded-md border border-line bg-bg-elev overflow-x-auto">
              <div className="border-b border-line px-4 py-2.5"><h3 className="text-[13px] font-semibold">Planilla calculada</h3></div>
              <table className="w-full">
                <thead><tr className="border-b border-line bg-bg-sunken">{['Obrero', 'Días', 'Jornal', 'BUC', 'Bonif', 'Bruto', 'Desc', 'Neto', ''].map((h, i) => <th key={i} className={cn('px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-wider text-ink-4', i === 0 ? 'text-left' : 'text-right')}>{h}</th>)}</tr></thead>
                <tbody>
                  {detalle.map((d) => {
                    const bonif = Number(d.montoBonifAltura) + Number(d.montoBonifAgua) + Number(d.montoMovilidad) + Number(d.montoEscolaridad) + Number(d.montoHorasExtra);
                    return (
                      <tr key={d.id} className="border-b border-line text-[10.5px] font-mono tabular-nums">
                        <td className="px-2 py-1.5 font-sans">{d.nombre}</td>
                        <td className="px-2 py-1.5 text-right">{d.diasTrabajados}</td>
                        <td className="px-2 py-1.5 text-right">{fmtPEN(Number(d.montoJornada))}</td>
                        <td className="px-2 py-1.5 text-right">{fmtPEN(Number(d.montoBuc))}</td>
                        <td className="px-2 py-1.5 text-right">{fmtPEN(bonif)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold">{fmtPEN(Number(d.totalIngreso))}</td>
                        <td className="px-2 py-1.5 text-right text-rose-500">{fmtPEN(Number(d.totalDescuentos))}</td>
                        <td className="px-2 py-1.5 text-right font-bold text-primary">{fmtPEN(Number(d.netoPago))}</td>
                        <td className="px-2 py-1.5 text-right"><button onClick={() => setBoleta(d)} className="text-[10px] text-primary hover:underline">Ver boleta</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {boleta && <BoletaModal d={boleta} onClose={() => setBoleta(null)} />}
    </div>
  );
}

function BoletaModal({ d, onClose }: { d: PlanillaDetalle; onClose: () => void }) {
  const ing: [string, number][] = [
    ['Jornal básico', Number(d.montoJornada)], ['Dominical', Number(d.montoDominical)], ['BUC', Number(d.montoBuc)],
    ['Comp. vacacional', Number(d.montoCompVac)], ['Gratificación', Number(d.montoGratif)], ['Bonif. extraord. (L.30334)', Number(d.montoBonifExtra)],
    ['CTS', Number(d.montoCts)], ['Bonif. altura', Number(d.montoBonifAltura)], ['Contacto agua', Number(d.montoBonifAgua)],
    ['Horas extra', Number(d.montoHorasExtra)], ['Movilidad', Number(d.montoMovilidad)], ['Asig. escolar', Number(d.montoEscolaridad)],
  ];
  const desc: [string, number][] = [
    ['AFP aporte', Number(d.montoAfpAporte)], ['AFP comisión', Number(d.montoAfpComision)], ['AFP seguro', Number(d.montoAfpSeguro)],
    ['ONP', Number(d.montoOnp)], ['CONAFOVICER', Number(d.montoConafovicer)], ['Renta 5ta', Number(d.montoRenta5ta)],
    ['Adelanto', Number(d.montoAdelanto)], ['Sindical', Number(d.montoSindical)],
  ];
  const aportes: [string, number][] = [
    ['EsSalud', Number(d.montoEsSalud)], ['SCTR Salud', Number(d.montoSctrSalud)], ['SCTR Pensión', Number(d.montoSctrPension)], ['SENCICO', Number(d.montoSencico)],
  ];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn print-hide" onClick={onClose}>
      <div className="print-sheet w-[560px] max-h-[92vh] overflow-auto rounded-xl border border-line bg-bg-elev shadow-2xl animate-modalPop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3 print-hide">
          <h3 className="text-[14px] font-semibold">Boleta de pago</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-line text-[11.5px] text-ink-2"><Printer className="h-3.5 w-3.5" /> Imprimir</button>
            <button onClick={onClose} className="text-ink-4 hover:text-ink-2"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="mb-3">
            <div className="text-[15px] font-bold">{d.nombre}</div>
            <div className="text-[11px] text-ink-3">{d.categoria} · {d.sistemaPension} · {d.diasTrabajados} días · jornal {fmtPEN(Number(d.jornalUsado))}</div>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <div>
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: ASIST.normal!.color }}>Ingresos</div>
              {ing.filter(([, v]) => v > 0).map(([k, v]) => <Row key={k} k={k} v={v} />)}
              <div className="mt-1.5 flex justify-between border-t border-line pt-1.5 text-[12px] font-bold"><span>Total ingresos</span><span className="font-mono">{fmtPEN(Number(d.totalIngreso))}</span></div>
            </div>
            <div>
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-500">Descuentos</div>
              {desc.filter(([, v]) => v > 0).map(([k, v]) => <Row key={k} k={k} v={v} neg />)}
              <div className="mt-1.5 flex justify-between border-t border-line pt-1.5 text-[12px] font-bold text-rose-500"><span>Total descuentos</span><span className="font-mono">-{fmtPEN(Number(d.totalDescuentos))}</span></div>
            </div>
          </div>
          <div className="mt-4 rounded-md bg-primary/10 px-4 py-2.5 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-primary">NETO A PAGAR</span>
            <span className="font-mono text-[18px] font-bold text-primary">{fmtPEN(Number(d.netoPago))}</span>
          </div>
          <div className="mt-3 rounded-md bg-bg-sunken px-4 py-2.5">
            <div className="mb-1 text-[9.5px] font-mono uppercase tracking-wider text-ink-4">Aportes empleador (no afecta neto)</div>
            <div className="grid grid-cols-2 gap-x-5">{aportes.filter(([, v]) => v > 0).map(([k, v]) => <Row key={k} k={k} v={v} small />)}</div>
            <div className="mt-1.5 flex justify-between border-t border-line pt-1.5 text-[12px] font-bold text-primary"><span>Costo total empresa</span><span className="font-mono">{fmtPEN(Number(d.montoCostoTotal))}</span></div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
function Row({ k, v, neg, small }: { k: string; v: number; neg?: boolean; small?: boolean }) {
  return <div className={cn('flex justify-between py-0.5', small ? 'text-[10.5px]' : 'text-[11.5px]')}><span className="text-ink-3">{k}</span><span className="font-mono tabular-nums">{neg ? '-' : ''}{fmtPEN(v)}</span></div>;
}

function Stat({ label, value, sub, accent, danger, primary }: { label: string; value: string; sub?: string; accent?: boolean; danger?: boolean; primary?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-2.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4 truncate">{label}</div>
      <div className={cn('mt-0.5 text-[14px] font-mono font-bold tracking-[-0.02em]', accent && 'text-emerald-600', danger && 'text-rose-500', primary && 'text-primary')}>{value}</div>
      {sub && <div className="text-[9.5px] text-ink-4 truncate">{sub}</div>}
    </div>
  );
}

// ─── Configuración ───────────────────────────────────────────
function ConfigTab() {
  const qc = useQueryClient();
  const paramsQ = useQuery({ queryKey: ['param-planilla'], queryFn: () => api.planilla.listParams() });
  const afpQ = useQuery({ queryKey: ['afp'], queryFn: () => api.planilla.listAfp() });
  const cfgQ = useQuery({ queryKey: ['config-planilla'], queryFn: () => api.planilla.getConfig() });
  const updParam = useMutation({ mutationFn: (v: { cat: string; data: Record<string, number> }) => api.planilla.updateParam(v.cat, v.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['param-planilla'] }) });
  const updAfp = useMutation({ mutationFn: (v: { afp: string; data: Record<string, number> }) => api.planilla.updateAfp(v.afp, v.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['afp'] }) });
  const updCfg = useMutation({ mutationFn: (data: Record<string, number>) => api.planilla.updateConfig(data), onSuccess: () => qc.invalidateQueries({ queryKey: ['config-planilla'] }) });
  const cfg = cfgQ.data?.config;

  return (
    <div className="space-y-4">
      {/* 1 · Por categoría */}
      <Section title="Por categoría · convenio anual" sub="Jornal básico + BUC (sube cuando cambia el convenio FTCCP-CAPECO)">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {(paramsQ.data?.params ?? []).map((p) => (
            <div key={p.id} className="rounded-md border border-line bg-bg-elev p-3">
              <div className="text-[12px] font-bold" style={{ color: CAT_COLOR[p.categoria] }}>{p.categoria}</div>
              <NumRow t="Jornal S/" def={Number(p.jornalBase)} step="0.01" onSave={(v) => updParam.mutate({ cat: p.categoria, data: { jornalBase: v } })} />
              <NumRow t="BUC %" def={Number(p.pctBuc) * 100} step="0.1" onSave={(v) => updParam.mutate({ cat: p.categoria, data: { pctBuc: v / 100 } })} />
              <NumRow t="Movilidad S/día" def={Number(p.movilidad)} step="0.1" onSave={(v) => updParam.mutate({ cat: p.categoria, data: { movilidad: v } })} />
            </div>
          ))}
        </div>
      </Section>

      {/* 2 · Tasas legales globales */}
      <Section title="Tasas legales · fijas por ley" sub="Cámbialas solo si hay reforma. Base SCTR/EsSalud según convenio de tu aseguradora.">
        {cfg && (
          <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            <CfgNum t="UIT S/" def={Number(cfg.uit)} step="1" onSave={(v) => updCfg.mutate({ uit: v })} />
            <CfgNum t="EsSalud %" def={Number(cfg.pctEsSalud) * 100} onSave={(v) => updCfg.mutate({ pctEsSalud: v / 100 })} />
            <CfgNum t="ONP %" def={Number(cfg.pctOnp) * 100} onSave={(v) => updCfg.mutate({ pctOnp: v / 100 })} />
            <CfgNum t="SENCICO %" def={Number(cfg.pctSencico) * 100} onSave={(v) => updCfg.mutate({ pctSencico: v / 100 })} />
            <CfgNum t="CONAFOVICER %" def={Number(cfg.pctConafovicer) * 100} onSave={(v) => updCfg.mutate({ pctConafovicer: v / 100 })} />
            <CfgNum t="SCTR Salud %" def={Number(cfg.pctSctrSalud) * 100} onSave={(v) => updCfg.mutate({ pctSctrSalud: v / 100 })} />
            <CfgNum t="SCTR Pensión %" def={Number(cfg.pctSctrPension) * 100} onSave={(v) => updCfg.mutate({ pctSctrPension: v / 100 })} />
            <CfgNum t="Bonif. altura %" def={Number(cfg.pctBonifAltura) * 100} onSave={(v) => updCfg.mutate({ pctBonifAltura: v / 100 })} />
            <CfgNum t="Contacto agua %" def={Number(cfg.pctBonifAgua) * 100} onSave={(v) => updCfg.mutate({ pctBonifAgua: v / 100 })} />
            <CfgNum t="Asig. escolar (jornales/año)" def={Number(cfg.asignEscolarJornales)} step="1" onSave={(v) => updCfg.mutate({ asignEscolarJornales: v })} />
          </div>
        )}
      </Section>

      {/* 3 · AFP */}
      <Section title="Tasas AFP · periódico (SBS)" sub="Aporte 10% fijo · comisión y prima varían por AFP.">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {(afpQ.data?.tasas ?? []).map((t) => (
            <div key={t.id} className="rounded-md border border-line bg-bg-elev p-3">
              <div className="text-[12px] font-bold">{t.afp}</div>
              <NumRow t="Comisión %" def={Number(t.pctComision) * 100} onSave={(v) => updAfp.mutate({ afp: t.afp, data: { pctComision: v / 100 } })} />
              <NumRow t="Prima seguro %" def={Number(t.pctSeguro) * 100} onSave={(v) => updAfp.mutate({ afp: t.afp, data: { pctSeguro: v / 100 } })} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-bg-sunken/30 p-3.5">
      <div className="mb-2.5"><h3 className="text-[13px] font-semibold">{title}</h3>{sub && <p className="text-[11px] text-ink-4">{sub}</p>}</div>
      {children}
    </div>
  );
}
function NumRow({ t, def, step = '0.01', onSave }: { t: string; def: number; step?: string; onSave: (v: number) => void }) {
  return (
    <div className="mt-1.5 flex items-center justify-between gap-2">
      <span className="text-[11px] text-ink-3">{t}</span>
      <input className={cn(inputCls, 'w-24 text-right')} type="number" step={step} defaultValue={def} onBlur={(e) => { const v = Number(e.target.value); if (v !== def) onSave(v); }} />
    </div>
  );
}
function CfgNum({ t, def, step = '0.01', onSave }: { t: string; def: number; step?: string; onSave: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 rounded-md border border-line bg-bg-elev p-2.5">
      <span className="text-[10.5px] text-ink-3">{t}</span>
      <input className={cn(inputCls, 'w-full text-right')} type="number" step={step} defaultValue={def} onBlur={(e) => { const v = Number(e.target.value); if (v !== def) onSave(v); }} />
    </label>
  );
}
