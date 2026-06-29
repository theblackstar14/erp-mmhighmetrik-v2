import { useQuery } from '@tanstack/react-query';
import { Activity, TrendingDown, TrendingUp } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';
import { type CurvaSData, api } from '@/lib/api.js';
import { cn, fmtCompact, fmtPEN } from '@/lib/utils.js';

const CurvaSChartEcharts = lazy(() => import('./CurvaSChartEcharts.js'));

type LabelMode = 'fecha' | 'mes';
type Metric = 'obra' | 'inversion';

export function CurvaSTab({ proyectoId }: { proyectoId: string }) {
  const { data: resp, isLoading } = useQuery({
    queryKey: ['curva-s', proyectoId],
    queryFn: () => api.proyectos.getCurvaS(proyectoId),
  });
  const [labelMode, setLabelMode] = useState<LabelMode>('fecha');
  // Default: avance físico obra (inversión por ahora sin ingesta · togglable)
  const [metricRaw, setMetricRaw] = useState<Metric | null>(null);

  if (isLoading) return <div className="text-[12px] text-ink-3">Cargando curva S...</div>;
  const data = resp?.data;
  if (!data) {
    return (
      <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
        <Activity className="mx-auto mb-4 h-8 w-8 text-ink-4" />
        <h3 className="text-[14px] font-semibold mb-1.5">Sin datos para curva S</h3>
        <p className="text-[12px] text-ink-3">Sube cronograma con partidas que tengan fechas + costo</p>
      </div>
    );
  }

  const inv = data.inversion;
  const hasInversion = !!inv && inv.BAC > 0;
  // default: avance físico obra (la inversión queda en 0 sin ingesta · usuario puede togglear)
  const metric: Metric = metricRaw ?? 'obra';
  const setMetric = (m: Metric) => setMetricRaw(m);
  const activeMetric: Metric = hasInversion ? metric : 'obra';

  const labelOf = (b: CurvaSData['buckets'][number]) =>
    labelMode === 'mes'
      ? `Mes ${b.idx}`
      : new Date(b.year, b.month, 1).toLocaleDateString('es-PE', { month: 'short', year: '2-digit' }).replace('.', '');

  // ── Vista activa · mapea arrays según métrica ──
  const view =
    activeMetric === 'inversion' && inv
      ? {
          BAC: inv.BAC,
          PV: inv.PV,
          EV: inv.EV,
          planAcum: inv.planAcum,
          earnedAcum: inv.evAcum,
          realAcum: [] as number[], // inversión no separa AC
          plan: inv.plan,
          earned: inv.ev,
          real: [] as number[],
          pctCompletado: inv.pctRealHoy,
          pctPlan: inv.pctPlanHoy,
          spi: inv.spi,
          hasAC: false,
          hayEjecucion: inv.evIngestado,
        }
      : {
          BAC: data.evm.BAC,
          PV: data.evm.PV,
          EV: data.evm.EV,
          planAcum: data.planAcum,
          earnedAcum: data.earnedAcum,
          realAcum: data.realAcum,
          plan: data.plan,
          earned: data.earned,
          real: data.real,
          pctCompletado: data.evm.pctCompletado,
          pctPlan: data.evm.BAC > 0 ? (data.evm.PV / data.evm.BAC) * 100 : 0,
          spi: data.evm.SPI,
          hasAC: true,
          hayEjecucion: data.realAcum.some((v) => v > 0) || data.earnedAcum.some((v) => v > 0),
        };

  const fuenteLabel = {
    valorizaciones: { txt: 'Valorizaciones aprobadas', cls: 'green' },
    avances: { txt: 'Avances físicos', cls: 'blue' },
    mixed: { txt: 'Valorizaciones + avances', cls: 'blue' },
    'plan-only': { txt: 'Solo plan · sin ejecución', cls: 'amber' },
  }[data.fuente];

  return (
    <div className="space-y-4">
      {/* Banner jerárquico · inversión primario (oficial MEF) · obra secundario */}
      {hasInversion && inv && (
        <div className="rounded-md border border-line bg-bg-elev overflow-hidden">
          {/* Primario · INVERSIÓN */}
          <button
            type="button"
            onClick={() => setMetric('inversion')}
            className={cn(
              'w-full text-left px-4 py-3.5 transition-colors border-l-2',
              activeMetric === 'inversion' ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-bg-sunken',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                Avance de inversión
                <span className="ml-2 chip green">oficial MEF/OxI</span>
              </span>
              {activeMetric === 'inversion' && <span className="chip blue">viendo</span>}
            </div>
            <div className="mt-1 flex items-baseline gap-2.5 flex-wrap">
              <span className="text-[30px] font-bold tracking-[-0.02em] text-primary leading-none">
                {inv.pctRealHoy.toFixed(2)}%
              </span>
              <span className="text-[12px] text-ink-3">ejecutado</span>
              <DeltaPill pct={inv.pctRealHoy} plan={inv.pctPlanHoy} />
            </div>
            <div className="mt-1 text-[10.5px] text-ink-4">
              Base monto inversión {fmtCompact(inv.BAC)} · obra + mobiliario + ET + supervisiones
              {!inv.evIngestado && <span className="ml-1 text-warn-ink">· sin avance real ingestado</span>}
            </div>
          </button>
          {/* Secundario · OBRA */}
          <button
            type="button"
            onClick={() => setMetric('obra')}
            className={cn(
              'w-full text-left px-4 py-2.5 border-t border-line transition-colors border-l-2',
              activeMetric === 'obra' ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-bg-sunken',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[11px] text-ink-3">Avance físico obra (CD):</span>
                <span className="text-[16px] font-bold tracking-[-0.02em] text-ink-1">
                  {data.evm.pctCompletado.toFixed(2)}%
                </span>
                <DeltaPill pct={data.evm.pctCompletado} plan={data.evm.BAC > 0 ? (data.evm.PV / data.evm.BAC) * 100 : 0} small />
                <span className="text-[10px] text-ink-4">· interno · base {fmtCompact(data.evm.BAC)}</span>
              </div>
              {activeMetric === 'obra' && <span className="chip blue shrink-0">viendo</span>}
            </div>
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-bg-elev px-3 py-2">
        <div>
          <h3 className="text-[13px] font-semibold flex items-center gap-2">
            Curva S · {activeMetric === 'inversion' ? 'Inversión' : 'Obra (CD)'}
            <span className={`chip ${fuenteLabel.cls}`}>{fuenteLabel.txt}</span>
          </h3>
          <p className="text-[11px] text-ink-3 mt-0.5">
            {data.buckets.length} meses · Fecha de corte: {new Date().toLocaleDateString('es-PE')}
            {!view.hayEjecucion && <span className="ml-2 text-warn-ink">· Sin ejecución registrada</span>}
          </p>
        </div>
        <div className="flex rounded-md border border-line overflow-hidden">
          <button
            type="button"
            onClick={() => setLabelMode('fecha')}
            className={cn(
              'px-3 py-1 text-[11px] font-medium',
              labelMode === 'fecha' ? 'bg-primary text-primary-foreground' : 'bg-bg-elev text-ink-3 hover:bg-bg-sunken',
            )}
          >
            Fechas
          </button>
          <button
            type="button"
            onClick={() => setLabelMode('mes')}
            className={cn(
              'px-3 py-1 text-[11px] font-medium border-l border-line',
              labelMode === 'mes' ? 'bg-primary text-primary-foreground' : 'bg-bg-elev text-ink-3 hover:bg-bg-sunken',
            )}
          >
            Mes N
          </button>
        </div>
      </div>

      {/* Chips EVM */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Kpi lbl="BAC" val={fmtCompact(view.BAC)} sub={activeMetric === 'inversion' ? 'Monto inversión' : 'Presupuesto obra'} mono />
        <Kpi lbl="PV" val={fmtCompact(view.PV)} sub={`${view.pctPlan.toFixed(1)}% planificado`} mono />
        <Kpi
          lbl="EV"
          val={fmtCompact(view.EV)}
          sub={`${view.pctCompletado.toFixed(1)}% ejecutado`}
          mono
          accent="text-primary"
        />
        {view.hasAC ? (
          <Kpi lbl="AC" val={fmtCompact(data.evm.AC)} sub="Costo real" mono accent="text-warn-ink" />
        ) : (
          <Kpi lbl="—" val="—" sub="Inversión no separa costo real" mono accent="text-ink-4" />
        )}
        <Kpi
          lbl="SPI"
          val={view.hayEjecucion ? view.spi.toFixed(2) : '—'}
          sub={view.hayEjecucion ? (view.spi >= 1 ? 'Adelantado' : 'Atrasado') : 'Sin ejecución'}
          accent={!view.hayEjecucion ? 'text-ink-4' : view.spi >= 1 ? 'text-ok' : 'text-destructive'}
          icon={view.hayEjecucion ? (view.spi >= 1 ? 'up' : 'down') : null}
        />
        {view.hasAC ? (
          <Kpi
            lbl="CPI"
            val={view.hayEjecucion && data.evm.AC > 0 ? data.evm.CPI.toFixed(2) : '—'}
            sub={
              view.hayEjecucion && data.evm.AC > 0
                ? data.evm.CV >= 0
                  ? `Ahorro ${fmtCompact(Math.abs(data.evm.CV))}`
                  : `Sobrecosto ${fmtCompact(Math.abs(data.evm.CV))}`
                : 'Sin ejecución'
            }
            accent={!(view.hayEjecucion && data.evm.AC > 0) ? 'text-ink-4' : data.evm.CPI >= 1 ? 'text-ok' : 'text-destructive'}
            icon={view.hayEjecucion && data.evm.AC > 0 ? (data.evm.CPI >= 1 ? 'up' : 'down') : null}
          />
        ) : (
          <Kpi
            lbl="SV"
            val={view.hayEjecucion ? fmtCompact(view.EV - view.PV) : '—'}
            sub={view.EV - view.PV >= 0 ? 'Adelanto plan' : 'Atraso plan'}
            mono
            accent={view.EV - view.PV >= 0 ? 'text-ok' : 'text-destructive'}
          />
        )}
      </div>

      {/* Chart */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-[13px] font-semibold">Plan vs Real · Acumulado</h3>
        </div>
        <div className="p-4">
          <Suspense fallback={<div className="h-[340px] animate-pulse rounded bg-bg-sunken/50" />}>
            <CurvaSChartEcharts
              labels={data.buckets.map(labelOf)}
              planAcum={view.planAcum}
              earnedAcum={view.earnedAcum}
              realAcum={view.realAcum}
              hoyIdx={data.hoyIdx}
              showAC={view.hasAC}
            />
          </Suspense>
        </div>
      </div>

      {/* Tabla mensual */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-[13px] font-semibold">Detalle mensual</h3>
          <p className="text-[11px] text-ink-3 mt-0.5">{data.buckets.length} períodos · S/</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line bg-bg-sunken">
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink-4 sticky left-0 bg-bg-sunken min-w-[180px]">
                  Concepto
                </th>
                {data.buckets.map((b) => (
                  <th
                    key={b.key}
                    className={cn(
                      'px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider min-w-[100px]',
                      b.idx - 1 === data.hoyIdx ? 'text-primary font-bold' : 'text-ink-4',
                    )}
                  >
                    {labelOf(b)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { lbl: 'Valor Planificado (PV)', arr: view.plan },
                { lbl: 'PV Acumulado', arr: view.planAcum, bold: true },
                { lbl: 'Earned Value (EV)', arr: view.earned, color: 'text-primary' },
                { lbl: 'EV Acumulado', arr: view.earnedAcum, bold: true, color: 'text-primary' },
                ...(view.hasAC
                  ? [
                      { lbl: 'Costo Real (AC)', arr: view.real, color: 'text-warn-ink', muted: !view.hayEjecucion },
                      { lbl: 'AC Acumulado', arr: view.realAcum, bold: true, color: 'text-warn-ink', muted: !view.hayEjecucion },
                    ]
                  : []),
              ].map((row) => (
                <tr key={row.lbl} className="border-b border-line">
                  <td
                    className={cn(
                      'px-3 py-1.5 text-[11px] sticky left-0 bg-bg-elev',
                      row.bold && 'font-bold',
                      row.muted && 'text-ink-4',
                      row.color && !row.muted && row.color,
                    )}
                  >
                    {row.lbl}
                  </td>
                  {row.arr.map((v, i) => (
                    <td
                      key={i}
                      className={cn(
                        'px-3 py-1.5 text-right font-mono text-[10.5px] tabular-nums',
                        row.bold && 'font-semibold',
                        row.muted ? 'text-ink-4' : v > 0 ? row.color ?? 'text-foreground' : 'text-ink-4',
                      )}
                    >
                      {v > 0 ? fmtPEN(v) : 'S/ -'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DeltaPill({ pct, plan, small }: { pct: number; plan: number; small?: boolean }) {
  const delta = pct - plan;
  const ok = delta >= 0;
  return (
    <span className={cn('text-ink-3', small ? 'text-[10px]' : 'text-[11px]')}>
      Plan hoy {plan.toFixed(2)}% ·{' '}
      <span className={ok ? 'text-ok font-medium' : 'text-destructive font-medium'}>
        {ok ? 'adelanto +' : 'atraso '}
        {delta.toFixed(2)} pts
      </span>
    </span>
  );
}

function Kpi({
  lbl,
  val,
  sub,
  accent,
  mono,
  icon,
}: {
  lbl: string;
  val: string;
  sub?: string;
  accent?: string;
  mono?: boolean;
  icon?: 'up' | 'down' | null;
}) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-2.5 min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4 truncate">{lbl}</div>
      <div className="mt-0.5 flex items-center gap-1">
        <div className={cn('truncate font-bold tracking-[-0.02em]', accent, mono ? 'text-[13px] font-mono' : 'text-[15px]')}>
          {val}
        </div>
        {icon === 'up' && <TrendingUp className="h-3.5 w-3.5 text-ok shrink-0" />}
        {icon === 'down' && <TrendingDown className="h-3.5 w-3.5 text-destructive shrink-0" />}
      </div>
      {sub && <div className="text-[10px] text-ink-3 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}
