import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, ChevronRight, Filter, Sparkles, X } from 'lucide-react';
import { Suspense, lazy, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type SaludObra, type SaludRow, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';
import { Skel, SkelCards } from '@/components/ui/Skeleton.js';
import type { CashflowClick, CashflowMode } from './DashboardCashflowChart.js';

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const DashboardForecast = lazy(() => import('./DashboardForecast.js'));
const CashflowChart = lazy(() => import('./DashboardCashflowChart.js'));
const CashflowDrill = lazy(() => import('./DashboardCashflowDrill.js'));

const STATUS_LABEL: Record<string, string> = { licitacion: 'Licitación', adjudicado: 'Adjudicado', ejecucion: 'En ejecución', liquidacion: 'Liquidación', cerrado: 'Cerrado', cancelado: 'Cancelado' };
const STATUS_CHIP: Record<string, string> = { licitacion: 'amber', adjudicado: 'blue', ejecucion: 'blue', liquidacion: 'amber', cerrado: 'green', cancelado: 'red' };
const SALUD_LABEL: Record<Exclude<SaludObra, 'sin_datos'>, string> = { critico: 'Crítico', observacion: 'Observación', saludable: 'Saludable' };
const SALUD_COLOR: Record<Exclude<SaludObra, 'sin_datos'>, string> = { critico: 'var(--destructive)', observacion: 'var(--warn-ink)', saludable: 'var(--ok)' };
const SALUD_BORDER: Record<Exclude<SaludObra, 'sin_datos'>, string> = { critico: 'border-l-destructive', observacion: 'border-l-amber-500', saludable: 'border-l-emerald-500' };

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const periodoActual = () => { const d = new Date(); return `${MESES[d.getMonth()]} ${d.getFullYear()}`; };

type Drill = 'cartera' | 'licitaciones' | 'forecast' | `salud:${Exclude<SaludObra, 'sin_datos'>}` | null;

export function DashboardPage() {
  const navigate = useNavigate();
  const [drill, setDrill] = useState<Drill>(null);
  const [cfMode, setCfMode] = useState<CashflowMode>('mes');
  const [cfDrill, setCfDrill] = useState<CashflowClick | null>(null);
  const [filtro, setFiltro] = useState('');

  // refetchInterval · auto-refresca el dashboard abierto cada 90s (se pausa solo si la pestaña está en background)
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.proyectos.getDashboard(), staleTime: 60_000, refetchInterval: 90_000 });
  const saludQ = useQuery({ queryKey: ['dashboard-salud'], queryFn: () => api.proyectos.getDashboardSalud(), staleTime: 60_000, refetchInterval: 90_000 });
  const cf = useQuery({ queryKey: ['cashflow-detalle'], queryFn: () => api.finanzas.getCashflowDetalle('todos'), staleTime: 60_000, refetchInterval: 90_000 });
  const t = data?.totales;
  const obras = data?.obras ?? [];
  const forecast = saludQ.data?.forecast ?? null;
  const salud = saludQ.data?.salud ?? { critico: 0, observacion: 0, saludable: 0, sinDatos: 0 };
  const licitaciones = obras.filter((o) => o.status === 'licitacion');
  const carteraLic = licitaciones.reduce((s, o) => s + o.presupuesto, 0);
  const toggle = (d: Drill) => { setDrill((cur) => (cur === d ? null : d)); };
  const onCashflowClick = (c: CashflowClick) => { setCfDrill(c); };

  const obrasFiltradas = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return obras;
    return obras.filter((o) => [o.codigo, o.nombre, o.cliente].some((x) => String(x ?? '').toLowerCase().includes(q)));
  }, [obras, filtro]);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Dashboard Operativo</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">Gestión de proyectos, finanzas y alertas críticas de obra</p>
        </div>
        <div className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line bg-bg-elev text-[12.5px] text-ink-2"><Calendar className="h-3.5 w-3.5 text-ink-4" /> {periodoActual()}</div>
      </header>

      {/* KPIs */}
      {isLoading ? (
        <SkelCards count={4} />
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 animate-dataIn">
        <Kpi label="Cartera total" value={fmtPEN(t?.cartera ?? 0)} sub={`${t?.obrasActivas ?? 0} proyectos activos`} trend="+4.2%" trendKind="pos" active={drill === 'cartera'} onClick={() => toggle('cartera')} loading={isLoading} />
        {/* Salud */}
        <div className="rounded-md border border-line bg-bg-elev overflow-hidden flex flex-col">
          <div className="px-3.5 pt-3 pb-2 font-mono text-[10px] uppercase tracking-wider text-ink-4">Salud (CPI/SPI)</div>
          <div className="flex flex-1">
            {(['critico', 'observacion', 'saludable'] as const).map((k, i) => (
              <button key={k} onClick={() => toggle(`salud:${k}`)} disabled={saludQ.isLoading || salud[k] === 0}
                className={cn('flex-1 flex flex-col items-center justify-center py-2.5 transition-colors disabled:opacity-40', i < 2 && 'border-r border-line', drill === `salud:${k}` ? 'bg-bg-sunken' : 'hover:bg-bg-sunken')}>
                <div className="text-[18px] font-bold tabular-nums" style={{ color: SALUD_COLOR[k] }}>{saludQ.isLoading ? '·' : salud[k]}</div>
                <div className="text-[8.5px] font-mono uppercase tracking-wide text-ink-4">{SALUD_LABEL[k]}</div>
              </button>
            ))}
          </div>
        </div>
        <Kpi label="Avance físico prom." value={fmtPct(t?.avanceFisicoProm ?? 0)} sub={forecast ? `Proyección Q2 · ${forecast.probabilidadCierreQ2}%` : saludQ.isLoading ? 'Calculando…' : 'Sin cronograma'} trend="Forecast" trendKind="pos" progress={forecast?.pctRealHoy ?? 0} active={drill === 'forecast'} onClick={() => toggle('forecast')} loading={isLoading} />
        <Kpi label="Licitaciones en curso" value={fmtPEN(carteraLic)} sub={`${licitaciones.length} procesos activos`} trend="En revisión" active={drill === 'licitaciones'} onClick={() => toggle('licitaciones')} loading={isLoading} />
      </div>
      )}

      {/* Drill-downs inline (uno a la vez) */}
      {drill === 'cartera' && (
        <DrillCard title="Composición de Cartera Total" accent="border-l-primary" onClose={() => setDrill(null)}>
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[9.5px] font-mono uppercase tracking-wider text-ink-4 border-b border-line"><th className="px-4 py-2">Proyecto</th><th className="px-4 py-2">Cliente</th><th className="px-4 py-2 text-right">Presupuesto</th><th className="px-4 py-2 w-36">Distribución</th></tr></thead>
            <tbody className="divide-y divide-line">
              {obras.map((o) => (
                <tr key={o.id} className="hover:bg-bg-sunken/40 cursor-pointer" onClick={() => navigate(`/proyectos/${o.id}/economico`)}>
                  <td className="px-4 py-2"><div className="font-medium">{o.nombre}</div><div className="text-[10px] font-mono text-ink-4">{o.codigo}</div></td>
                  <td className="px-4 py-2 text-ink-3">{o.cliente ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtPEN(o.presupuesto)}</td>
                  <td className="px-4 py-2"><Bar pct={(t?.cartera ?? 0) > 0 ? (o.presupuesto / (t!.cartera)) * 100 : 0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DrillCard>
      )}

      {drill === 'licitaciones' && (
        <DrillCard title="Pipeline de Licitaciones en curso" accent="border-l-violet-500" onClose={() => setDrill(null)}>
          {licitaciones.length === 0 ? <div className="py-6 text-center text-[12px] text-ink-3">Sin licitaciones activas</div> : (
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-[9.5px] font-mono uppercase tracking-wider text-ink-4 border-b border-line"><th className="px-4 py-2">Oportunidad</th><th className="px-4 py-2">Cliente</th><th className="px-4 py-2 text-right">Monto</th><th className="px-4 py-2">Estado</th></tr></thead>
              <tbody className="divide-y divide-line">
                {licitaciones.map((o) => (
                  <tr key={o.id} className="hover:bg-bg-sunken/40 cursor-pointer" onClick={() => navigate(`/proyectos/${o.id}/economico`)}>
                    <td className="px-4 py-2"><div className="font-medium">{o.nombre}</div><div className="text-[10px] font-mono text-ink-4">{o.codigo}</div></td>
                    <td className="px-4 py-2 text-ink-3">{o.cliente ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtPEN(o.presupuesto)}</td>
                    <td className="px-4 py-2"><span className="chip amber">Licitación</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="px-4 py-2 text-[10px] text-ink-4">Probabilidad de adjudicación (IA) · pendiente del módulo Licitaciones con seguimiento de etapas.</p>
        </DrillCard>
      )}

      {drill === 'forecast' && forecast && (
        <DrillCard title="Forecast Q2 · Proyección de avance y cierre" accent="border-l-primary" badge="Análisis predictivo · ritmo actual" onClose={() => setDrill(null)} pad>
          <Suspense fallback={<div className="text-center py-10 text-[12px] text-ink-3">Cargando proyección...</div>}><DashboardForecast forecast={forecast} /></Suspense>
        </DrillCard>
      )}

      {drill?.startsWith('salud:') && (
        <SaludDrill bucket={drill.split(':')[1] as Exclude<SaludObra, 'sin_datos'>} obras={saludQ.data?.obras ?? []} onClose={() => setDrill(null)} onOpen={(id) => navigate(`/proyectos/${id}/economico`)} />
      )}

      {/* Flujo + Alertas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-md border border-line bg-bg-elev">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-2.5"><h3 className="text-[13px] font-semibold">Flujo de Caja Consolidado</h3><span className="text-[9px] text-primary inline-flex items-center gap-1"><Sparkles className="h-2.5 w-2.5" /> click para desglosar</span></div>
            <div className="flex items-center gap-2.5">
              <div className="flex rounded-md border border-line overflow-hidden text-[10px]">
                {(['dia', 'mes', 'año', 'total'] as const).map((m) => (
                  <button key={m} disabled={m === 'dia'} onClick={() => { if (m !== 'dia') { setCfMode(m as CashflowMode); setCfDrill(null); } }}
                    className={cn('px-2.5 h-6 capitalize border-r border-line last:border-r-0', m === 'dia' ? 'opacity-40 cursor-not-allowed' : cfMode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-bg-sunken')}>
                    {m === 'dia' ? 'Día' : m}
                  </button>
                ))}
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-4 hidden sm:inline">{cfMode === 'total' ? 'Acumulado' : cfMode === 'año' ? 'Por año' : 'S/ por mes'}</span>
            </div>
          </div>
          <div className="p-3" style={{ minHeight: 250 }}>
            {cf.isLoading ? <Skel className="h-[240px] w-full" />
              : (cf.data?.meses.length ?? 0) === 0 ? <div className="text-center py-16 text-[12px] text-ink-3">Sin movimientos registrados</div>
              : <Suspense fallback={<Skel className="h-[240px] w-full" />}><div className="animate-dataIn"><CashflowChart data={cf.data!.meses} mode={cfMode} onPointClick={onCashflowClick} /></div></Suspense>}
          </div>
        </div>
        <AlertasIA />
      </div>

      {/* Cashflow drill (full width) */}
      {cfDrill && (
        <Suspense fallback={<Skel className="h-64 w-full" />}>
          <CashflowDrill drill={cfDrill} onClose={() => setCfDrill(null)} onChangeTab={(tab) => setCfDrill((d) => (d ? { ...d, tab } : d))} />
        </Suspense>
      )}

      {/* Estado de Proyectos */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-[13px] font-semibold">Estado de Proyectos</h3>
          <div className="relative w-[200px]">
            <Filter className="h-3.5 w-3.5 text-ink-4 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar..." className="h-7 w-full pl-8 pr-2 rounded-md border border-line bg-bg-sunken/60 text-[11px]" />
          </div>
        </div>
        {isLoading ? (
          <div className="p-3 space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skel key={i} className="h-9 w-full" />)}</div>
        ) : obrasFiltradas.length === 0 ? <div className="p-6 text-center text-[12px] text-ink-3">Sin resultados</div>
          : (
          <div className="overflow-x-auto animate-dataIn">
            <table className="w-full">
              <thead><tr className="border-b border-line bg-bg-sunken">
                {['ID', 'Nombre del Proyecto', 'Cliente', 'Estado', 'Presupuesto', 'Avance físico', ''].map((h, i) => (
                  <th key={i} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', i === 4 ? 'text-right' : 'text-left')}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {obrasFiltradas.map((o) => (
                  <tr key={o.id} className="border-b border-line hover:bg-bg-sunken/50 cursor-pointer" onClick={() => navigate(`/proyectos/${o.id}/economico`)}>
                    <td className="px-3 py-2.5 text-[11px] font-mono text-ink-3">{o.codigo}</td>
                    <td className="px-3 py-2.5 text-[12px] font-medium max-w-[300px] truncate">{o.nombre}</td>
                    <td className="px-3 py-2.5 text-[11.5px] text-ink-3 max-w-[150px] truncate">{o.cliente ?? '—'}</td>
                    <td className="px-3 py-2.5"><span className={`chip ${STATUS_CHIP[o.status] ?? ''}`}>{STATUS_LABEL[o.status] ?? o.status}</span></td>
                    <td className="px-3 py-2.5 text-[11.5px] font-mono tabular-nums text-right">{fmtPEN(o.presupuesto)}</td>
                    <td className="px-3 py-2.5"><div className="flex items-center gap-2"><Bar pct={Math.min(100, o.avanceFisico)} /><span className="text-[11px] font-mono tabular-nums text-ink-2 w-12">{fmtPct(o.avanceFisico)}</span></div></td>
                    <td className="px-2 py-2.5 text-ink-4"><ChevronRight className="h-4 w-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SaludDrill({ bucket, obras, onClose, onOpen }: { bucket: Exclude<SaludObra, 'sin_datos'>; obras: SaludRow[]; onClose: () => void; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => api.usuarios.list() });
  const asignar = useMutation({ mutationFn: (v: { id: string; userId: string | null }) => api.proyectos.asignarResponsable(v.id, v.userId), onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }) });
  const rows = obras.filter((o) => o.salud === bucket);
  return (
    <DrillCard title={`Proyectos en estado: ${SALUD_LABEL[bucket]}`} accent={SALUD_BORDER[bucket]} onClose={onClose}>
      {rows.length === 0 ? <div className="py-6 text-center text-[12px] text-ink-3">Sin obras en este estado</div> : (
        <table className="w-full text-[12px]">
          <thead><tr className="text-left text-[9.5px] font-mono uppercase tracking-wider text-ink-4 border-b border-line"><th className="px-4 py-2">Proyecto</th><th className="px-4 py-2 w-16 text-right">CPI</th><th className="px-4 py-2 w-16 text-right">SPI</th><th className="px-4 py-2 w-24 text-right">Desviación</th><th className="px-4 py-2 w-52">Responsable</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-bg-sunken/40">
                <td className="px-4 py-2.5 cursor-pointer" onClick={() => onOpen(o.id)}><div className="font-mono text-[10.5px] text-primary font-semibold">{o.codigo}</div><div className="text-[11px] text-ink-3 truncate max-w-[280px]">{o.nombre}</div></td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{o.cpi != null ? o.cpi.toFixed(2) : '—'}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{o.spi != null ? o.spi.toFixed(2) : '—'}</td>
                <td className="px-4 py-2.5 text-right">{o.desviacionPct != null ? <span className={cn('text-[10.5px] font-mono px-1.5 py-0.5 rounded', o.desviacionPct < 0 ? 'bg-destructive-soft text-destructive' : 'bg-ok-soft text-ok-ink')}>{o.desviacionPct > 0 ? '+' : ''}{o.desviacionPct.toFixed(1)}%</span> : <span className="text-ink-4">—</span>}</td>
                <td className="px-4 py-2.5"><select className="h-7 w-full max-w-[200px] px-2 rounded-md border border-line bg-bg-elev text-[11px]" value={o.responsableUserId ?? ''} onChange={(e) => asignar.mutate({ id: o.id, userId: e.target.value || null })}><option value="">Sin asignar</option>{(usuarios.data?.usuarios ?? []).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DrillCard>
  );
}

function AlertasIA() {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['notificaciones'], queryFn: () => api.notificaciones.list() });
  const items = (data?.items ?? []).filter((n) => n.severidad !== 'baja').slice(0, 6);
  // rayita por nivel · clases Tailwind (los tokens del theme son triplets HSL, no colores directos)
  const RAYITA: Record<string, string> = { alta: 'bg-rose-500', media: 'bg-amber-500', baja: 'bg-blue-500' };
  return (
    <div className="rounded-md border border-line bg-bg-elev">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5"><h3 className="text-[13px] font-semibold">Alertas empresariales</h3>{items.length > 0 && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">{items.length}</span>}</div>
      <div className="p-4">
        {items.length === 0 ? <div className="py-6 text-center text-[12px] text-ink-3">Sin alertas críticas</div> : (
          <div className="space-y-2.5">
            {items.map((n) => (
              <button key={n.id} onClick={() => n.accionUrl && navigate(n.accionUrl)} className="flex items-stretch gap-2.5 w-full text-left hover:opacity-80">
                <span className={cn('w-[3px] shrink-0 rounded-full self-stretch', RAYITA[n.severidad] ?? 'bg-ink-4')} />
                <div className="min-w-0 flex-1"><div className="text-[12px] font-semibold leading-tight">{n.titulo}</div>{n.detalle && <div className="text-[11px] text-ink-3 truncate">{n.detalle}</div>}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DrillCard({ title, accent, badge, onClose, children, pad }: { title: string; accent: string; badge?: string; onClose: () => void; children: React.ReactNode; pad?: boolean }) {
  return (
    <div className={cn('rounded-md border border-line border-l-[3px] bg-bg-elev animate-pageEnter overflow-hidden', accent)}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <div className="flex items-center gap-2">
          {badge && <span className="text-[9px] text-primary inline-flex items-center gap-1"><Sparkles className="h-2.5 w-2.5" /> {badge}</span>}
          <button onClick={onClose} className="h-7 w-7 rounded-md border border-line inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className={cn(pad ? 'p-4' : 'overflow-x-auto')}>{children}</div>
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return <div className="flex-1 h-1.5 rounded-full bg-bg-sunken overflow-hidden min-w-[60px]"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
}

function Kpi({ label, value, sub, trend, trendKind, progress, active, onClick, loading }: { label: string; value: string; sub: string; trend?: string; trendKind?: 'pos' | 'neg'; progress?: number; active?: boolean; onClick?: () => void; loading?: boolean }) {
  return (
    <button onClick={onClick} className={cn('rounded-md border bg-bg-elev p-3.5 text-left transition-all', active ? 'border-primary ring-1 ring-primary' : 'border-line hover:border-primary/50')}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-4">{label}</span>
        {trend && <span className={cn('font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded', trendKind === 'pos' ? 'bg-ok-soft text-ok-ink' : trendKind === 'neg' ? 'bg-destructive-soft text-destructive' : 'text-primary')}>{trend}</span>}
      </div>
      <div className="mt-1.5 text-[22px] font-bold tracking-[-0.02em] tabular-nums">{loading ? '…' : value}</div>
      <div className="text-[11px] text-ink-3 mt-0.5">{sub}</div>
      {progress != null && <div className="mt-2 h-1 rounded-full bg-bg-sunken overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, progress)}%` }} /></div>}
    </button>
  );
}
