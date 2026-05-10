import { useQuery } from '@tanstack/react-query';
import { Activity, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { type CurvaSData, api } from '@/lib/api.js';
import { cn, fmtCompact, fmtPEN } from '@/lib/utils.js';

type LabelMode = 'fecha' | 'mes';

export function CurvaSTab({ proyectoId }: { proyectoId: string }) {
  const { data: resp, isLoading } = useQuery({
    queryKey: ['curva-s', proyectoId],
    queryFn: () => api.proyectos.getCurvaS(proyectoId),
  });
  const [labelMode, setLabelMode] = useState<LabelMode>('fecha');

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

  const hayEjecucion = data.realAcum.some((v) => v > 0) || data.earnedAcum.some((v) => v > 0);
  const fuenteLabel = {
    valorizaciones: { txt: 'Valorizaciones aprobadas', cls: 'green' },
    avances: { txt: 'Avances físicos', cls: 'blue' },
    mixed: { txt: 'Valorizaciones + avances', cls: 'blue' },
    'plan-only': { txt: 'Solo plan · sin ejecución', cls: 'amber' },
  }[data.fuente];
  const labelOf = (b: CurvaSData['buckets'][number]) =>
    labelMode === 'mes'
      ? `Mes ${b.idx}`
      : new Date(b.year, b.month, 1).toLocaleDateString('es-PE', { month: 'short', year: '2-digit' }).replace('.', '');

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-bg-elev px-3 py-2">
        <div>
          <h3 className="text-[13px] font-semibold flex items-center gap-2">
            Curva S · Avance acumulado
            <span className={`chip ${fuenteLabel.cls}`}>{fuenteLabel.txt}</span>
          </h3>
          <p className="text-[11px] text-ink-3 mt-0.5">
            {data.buckets.length} meses · Fecha de corte: {new Date().toLocaleDateString('es-PE')}
            {!hayEjecucion && (
              <span className="ml-2 text-warn-ink">· Sin ejecución registrada</span>
            )}
          </p>
        </div>
        <div className="flex rounded-md border border-line overflow-hidden">
          <button
            type="button"
            onClick={() => setLabelMode('fecha')}
            className={cn(
              'px-3 py-1 text-[11px] font-medium',
              labelMode === 'fecha'
                ? 'bg-primary text-primary-foreground'
                : 'bg-bg-elev text-ink-3 hover:bg-bg-sunken',
            )}
          >
            Fechas
          </button>
          <button
            type="button"
            onClick={() => setLabelMode('mes')}
            className={cn(
              'px-3 py-1 text-[11px] font-medium border-l border-line',
              labelMode === 'mes'
                ? 'bg-primary text-primary-foreground'
                : 'bg-bg-elev text-ink-3 hover:bg-bg-sunken',
            )}
          >
            Mes N
          </button>
        </div>
      </div>

      {/* Chips EVM */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Kpi lbl="BAC" val={fmtCompact(data.evm.BAC)} sub="Presupuesto total" mono />
        <Kpi
          lbl="PV"
          val={fmtCompact(data.evm.PV)}
          sub={`${data.evm.BAC > 0 ? ((data.evm.PV / data.evm.BAC) * 100).toFixed(1) : '0'}% planificado`}
          mono
        />
        <Kpi
          lbl="EV"
          val={fmtCompact(data.evm.EV)}
          sub={`${data.evm.pctCompletado.toFixed(1)}% completado`}
          mono
          accent="text-primary"
        />
        <Kpi lbl="AC" val={fmtCompact(data.evm.AC)} sub="Costo real" mono accent="text-warn-ink" />
        <Kpi
          lbl="SPI"
          val={hayEjecucion ? data.evm.SPI.toFixed(2) : '—'}
          sub={
            hayEjecucion
              ? data.evm.SV >= 0
                ? `Adelanto ${fmtCompact(Math.abs(data.evm.SV))}`
                : `Atraso ${fmtCompact(Math.abs(data.evm.SV))}`
              : 'Sin ejecución'
          }
          accent={!hayEjecucion ? 'text-ink-4' : data.evm.SPI >= 1 ? 'text-ok' : 'text-destructive'}
          icon={hayEjecucion ? (data.evm.SPI >= 1 ? 'up' : 'down') : null}
        />
        <Kpi
          lbl="CPI"
          val={hayEjecucion && data.evm.AC > 0 ? data.evm.CPI.toFixed(2) : '—'}
          sub={
            hayEjecucion && data.evm.AC > 0
              ? data.evm.CV >= 0
                ? `Ahorro ${fmtCompact(Math.abs(data.evm.CV))}`
                : `Sobrecosto ${fmtCompact(Math.abs(data.evm.CV))}`
              : 'Sin ejecución'
          }
          accent={
            !(hayEjecucion && data.evm.AC > 0) ? 'text-ink-4' : data.evm.CPI >= 1 ? 'text-ok' : 'text-destructive'
          }
          icon={hayEjecucion && data.evm.AC > 0 ? (data.evm.CPI >= 1 ? 'up' : 'down') : null}
        />
      </div>

      {/* Chart */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-[13px] font-semibold">Plan vs Real · Acumulado</h3>
        </div>
        <div className="p-4">
          <CurvaSChart data={data} labelOf={labelOf} />
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
                { lbl: 'Valor Planificado (PV)', arr: data.plan },
                { lbl: 'PV Acumulado', arr: data.planAcum, bold: true },
                { lbl: 'Earned Value (EV)', arr: data.earned, color: 'text-primary' },
                { lbl: 'EV Acumulado', arr: data.earnedAcum, bold: true, color: 'text-primary' },
                { lbl: 'Costo Real (AC)', arr: data.real, color: 'text-warn-ink', muted: !hayEjecucion },
                { lbl: 'AC Acumulado', arr: data.realAcum, bold: true, color: 'text-warn-ink', muted: !hayEjecucion },
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

/* ─── Chart SVG · líneas plan + real + earned + hoy ─── */
function CurvaSChart({
  data,
  labelOf,
}: {
  data: CurvaSData;
  labelOf: (b: CurvaSData['buckets'][number]) => string;
}) {
  const W = 1100;
  const H = 360;
  const padL = 64;
  const padR = 24;
  const padT = 20;
  const padB = 50;
  const iW = W - padL - padR;
  const iH = H - padT - padB;
  const N = data.buckets.length;
  if (N === 0) return null;

  const maxVal = Math.max(...data.planAcum, ...data.realAcum, ...data.earnedAcum, 1);
  const xOf = (i: number) => padL + (i / Math.max(1, N - 1)) * iW;
  const yOf = (v: number) => padT + iH - (v / maxVal) * iH;

  const pathOf = (arr: number[]) =>
    arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');

  const planPath = pathOf(data.planAcum);
  const realHasData = data.realAcum.some((v) => v > 0);
  const earnedHasData = data.earnedAcum.some((v) => v > 0);
  const realPath = realHasData ? pathOf(data.realAcum) : '';
  const earnedPath = earnedHasData ? pathOf(data.earnedAcum) : '';

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => maxVal * f);
  const fmtAxisY = (v: number) =>
    v >= 1e6 ? `S/ ${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `S/ ${(v / 1e3).toFixed(0)}K` : `S/ ${v.toFixed(0)}`;

  const hoyX = data.hoyIdx >= 0 ? xOf(data.hoyIdx + 0.5) : -1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      {/* Grid horizontal */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={W - padR}
            y1={yOf(v)}
            y2={yOf(v)}
            stroke="hsl(var(--line))"
            strokeDasharray={i === 0 ? '0' : '2,3'}
            opacity={0.6}
          />
          <text
            x={padL - 6}
            y={yOf(v) + 3}
            fontSize="9"
            textAnchor="end"
            fill="hsl(var(--ink-3))"
            fontFamily="ui-monospace, monospace"
          >
            {fmtAxisY(v)}
          </text>
        </g>
      ))}

      {/* X labels */}
      {data.buckets.map((b, i) => (
        <text
          key={b.key}
          x={xOf(i)}
          y={H - 28}
          fontSize="9"
          textAnchor="middle"
          fill="hsl(var(--ink-3))"
          fontFamily="ui-monospace, monospace"
        >
          {labelOf(b)}
        </text>
      ))}

      {/* Plan area + line */}
      <path
        d={`${planPath} L${xOf(N - 1)},${padT + iH} L${padL},${padT + iH} Z`}
        fill="hsl(var(--ink-3))"
        opacity="0.06"
      />
      <path
        d={planPath}
        fill="none"
        stroke="hsl(var(--ink-3))"
        strokeWidth="2"
        strokeDasharray="6,3"
        strokeLinecap="round"
      />

      {/* Earned line · azul · sobre area si hay */}
      {earnedPath && (
        <path
          d={earnedPath}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Real line · ámbar */}
      {realPath && (
        <path
          d={realPath}
          fill="none"
          stroke="hsl(var(--warn))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Línea hoy */}
      {hoyX > 0 && (
        <g>
          <line
            x1={hoyX}
            x2={hoyX}
            y1={padT}
            y2={padT + iH}
            stroke="hsl(var(--destructive))"
            strokeWidth="1.5"
            strokeDasharray="3,3"
          />
          <rect
            x={hoyX - 14}
            y={padT - 14}
            width={28}
            height={14}
            fill="hsl(var(--destructive))"
            rx={2}
          />
          <text
            x={hoyX}
            y={padT - 4}
            fontSize="8.5"
            fill="white"
            fontFamily="ui-monospace, monospace"
            fontWeight="700"
            textAnchor="middle"
          >
            HOY
          </text>
        </g>
      )}

      {/* Leyenda */}
      <g transform={`translate(${padL + 8}, ${padT + 4})`} fontSize="10" fontFamily="Inter, sans-serif">
        <line x1="0" x2="16" y1="6" y2="6" stroke="hsl(var(--ink-3))" strokeWidth="2" strokeDasharray="6,3" />
        <text x="20" y="10" fill="hsl(var(--ink-2))" fontWeight="600">PV · Plan</text>
        <line x1="100" x2="116" y1="6" y2="6" stroke="hsl(var(--primary))" strokeWidth="2.5" />
        <text x="120" y="10" fill="hsl(var(--ink-2))" fontWeight="600">EV · Earned</text>
        <line x1="210" x2="226" y1="6" y2="6" stroke="hsl(var(--warn))" strokeWidth="2" />
        <text x="230" y="10" fill="hsl(var(--ink-2))" fontWeight="600">AC · Real</text>
      </g>
    </svg>
  );
}
