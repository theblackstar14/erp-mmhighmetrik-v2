import { useQuery } from '@tanstack/react-query';
import ReactECharts from '@/lib/echarts.js';
import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { Skel } from '@/components/ui/Skeleton.js';
import { useThemeStore } from '@/lib/theme-store.js';
import { cn, fmtPEN } from '@/lib/utils.js';
import type { CashflowClick } from './DashboardCashflowChart.js';
import DashboardCashflowDrill from './DashboardCashflowDrill.js';

const mesLabel = (m: string) => {
  const [y = '', mm = ''] = m.split('-');
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
  return `${meses[Number(mm) - 1] ?? mm} '${y.slice(2)}`;
};

// paleta categorías (composición + sankey) · ámbar suavizado (amber-600, no #f59e0b neón)
const PAL = ['#ef4444', '#d97706', '#8b5cf6', '#14b8a6', '#3b82f6', '#ec4899', '#84cc16', '#06b6d4', '#a855f7', '#ea7317'];

export default function FlujoCajaView({ proyectoId }: { proyectoId: string }) {
  const theme = useThemeStore((s) => s.theme);
  const dark = theme === 'dark';
  const [cfDrill, setCfDrill] = useState<CashflowClick | null>(null);
  const [sankeyMode, setSankeyMode] = useState<'egresos' | 'ingresos'>('egresos');
  // Sankey colapsado por defecto: es análisis exploratorio, no decisión diaria. Montarlo solo
  // al abrir también evita el crash de echarts con contenedor en tamaño 0 (Suspense/animación).
  const [sankeyOpen, setSankeyOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['finanzas-flujo', proyectoId], queryFn: () => api.finanzas.getFlujo(proyectoId) });

  const axis = dark ? '#a1a1aa' : '#52525b';
  const grid = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const tooltipBg = dark ? '#1c1c20' : '#ffffff';
  const tooltipText = dark ? '#e4e4e7' : '#27272a';

  const comboOption = useMemo(() => {
    const b = data?.barras ?? [];
    return {
      grid: { left: 56, right: 16, top: 32, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: grid,
        textStyle: { color: tooltipText, fontSize: 11 },
        valueFormatter: (v: number) => fmtPEN(v),
      },
      legend: { data: ['Ingresos', 'Egresos', 'Saldo acumulado'], textStyle: { color: axis, fontSize: 11 }, top: 0, right: 0 },
      xAxis: {
        type: 'category',
        data: b.map((d) => mesLabel(d.mes)),
        axisLabel: { color: axis, fontSize: 10 },
        axisLine: { lineStyle: { color: grid } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: axis, fontSize: 10, formatter: (v: number) => (Math.abs(v) >= 1000 ? `${v / 1000}K` : String(v)) },
        splitLine: { lineStyle: { color: grid } },
      },
      series: [
        { name: 'Ingresos', type: 'bar', cursor: 'pointer', data: b.map((d) => Math.round(d.ingresos)), itemStyle: { color: '#3b82f6', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22, emphasis: { focus: 'series', itemStyle: { shadowBlur: 8, shadowColor: 'rgba(59,130,246,0.3)' } } },
        { name: 'Egresos', type: 'bar', cursor: 'pointer', data: b.map((d) => Math.round(d.egresos)), itemStyle: { color: '#ef4444', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22, emphasis: { focus: 'series', itemStyle: { shadowBlur: 8, shadowColor: 'rgba(239,68,68,0.3)' } } },
        { name: 'Saldo acumulado', type: 'line', smooth: true, data: b.map((d) => Math.round(d.saldoAcum)), lineStyle: { color: '#10b981', width: 2, type: 'dashed' }, itemStyle: { color: '#10b981' }, symbol: 'circle', symbolSize: 5 },
      ],
    };
  }, [data, axis, grid, tooltipBg, tooltipText]);

  const sankeyData = sankeyMode === 'egresos' ? data?.sankeyEgresos : data?.sankeyIngresos;
  const sankeyOption = useMemo(() => {
    const s = sankeyData ?? { nodes: [], links: [] };
    // egresos: proy(azul)→cat(rojo) · ingresos: cliente(azul)→proy(índigo)
    const levels = sankeyMode === 'egresos'
      ? [{ depth: 0, itemStyle: { color: '#3b82f6' } }, { depth: 1, itemStyle: { color: '#ef4444' } }]
      : [{ depth: 0, itemStyle: { color: '#3b82f6' } }, { depth: 1, itemStyle: { color: '#6366f1' } }];
    return {
      tooltip: {
        trigger: 'item', backgroundColor: tooltipBg, borderColor: grid, textStyle: { color: tooltipText, fontSize: 11 },
        // los nodos vienen namespaced (c/p/g) desde el backend para evitar ciclos · quitar prefijo al mostrar
        formatter: (p: { dataType?: string; name?: string; data?: { source?: string; target?: string; value?: number } }) => {
          const strip = (s?: string) => String(s ?? '').split('').pop();
          if (p.dataType === 'edge') return `${strip(p.data?.source)} → ${strip(p.data?.target)}<br/><b>${fmtPEN(Number(p.data?.value ?? 0))}</b>`;
          return `<b>${strip(p.name)}</b>`;
        },
      },
      series: [
        {
          type: 'sankey',
          data: s.nodes,
          links: s.links,
          emphasis: { focus: 'adjacency' },
          nodeWidth: 14,
          nodeGap: 10,
          label: { color: dark ? '#d4d4d8' : '#3f3f46', fontSize: 11, formatter: (p: { name?: string }) => String(p.name ?? '').split(String.fromCharCode(1)).pop() },
          lineStyle: { color: 'gradient', opacity: dark ? 0.35 : 0.45, curveness: 0.5 },
          levels,
        },
      ],
    };
  }, [sankeyData, sankeyMode, dark, grid, tooltipBg, tooltipText]);

  // click en barra → drill del mes (reusa el mismo componente del dashboard)
  const onComboClick = (params: { seriesName?: string; dataIndex: number }) => {
    if (params.seriesName === 'Saldo acumulado') return;
    const mes = data?.barras[params.dataIndex]?.mes;
    if (!mes) return;
    setCfDrill({ mode: 'mes', periodKey: mes, tab: params.seriesName === 'Egresos' ? 'egresos' : 'ingresos' });
  };

  if (isLoading) return <Skel className="h-[420px] w-full" />;
  const noData = !data || data.barras.length === 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Combo chart */}
        <div className="lg:col-span-2 rounded-lg border border-line bg-bg-elev p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-semibold">Flujo de caja consolidado</h3>
              <span className="text-[9px] text-primary inline-flex items-center gap-1"><Sparkles className="h-2.5 w-2.5" /> click en una barra para desglosar</span>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-ink-4">{data?.barras.length ?? 0} meses · real</span>
          </div>
          {noData ? <Empty /> : <ReactECharts option={comboOption} style={{ height: 300 }} notMerge lazyUpdate opts={{ renderer: 'svg' }} onEvents={{ click: onComboClick }} />}
        </div>

        {/* Composición */}
        <div className="rounded-lg border border-line bg-bg-elev p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold">Composición</h3>
            <span className="text-[10px] font-mono uppercase tracking-wider text-ink-4">{data?.mesComp ? mesLabel(data.mesComp) : '—'}</span>
          </div>
          {(data?.composicion.length ?? 0) === 0 ? (
            <div className="text-center py-8 text-[11.5px] text-ink-3">Sin gastos en el período</div>
          ) : (
            <div className="space-y-2.5">
              {data!.composicion.slice(0, 8).map((c, i) => (
                <button
                  key={c.categoria}
                  onClick={() => data?.mesComp && setCfDrill({ mode: 'mes', periodKey: data.mesComp, tab: 'egresos' })}
                  className="w-full text-left rounded-md px-1.5 py-1 -mx-1.5 hover:bg-bg-sunken transition-colors"
                >
                  <div className="flex items-center justify-between text-[11.5px] mb-1">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <i className="h-2 w-2 rounded-sm inline-block shrink-0" style={{ background: PAL[i % PAL.length] }} />
                      <span className="truncate">{c.categoria}</span>
                    </span>
                    <span className="font-mono tabular-nums text-ink-3 ml-2 shrink-0">{Math.round(c.pct * 100)}% · {fmtPEN(c.monto)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg-sunken overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${c.pct * 100}%`, background: PAL[i % PAL.length] }} />
                  </div>
                </button>
              ))}
              <div className="text-[9.5px] text-primary pt-0.5 inline-flex items-center gap-1"><Sparkles className="h-2.5 w-2.5" /> click para ver el detalle</div>
            </div>
          )}
        </div>
      </div>

      {/* Drill on-demand (click barra o categoría) · mismo componente del dashboard */}
      {cfDrill && (
        <DashboardCashflowDrill
          drill={cfDrill}
          proyectoId={proyectoId}
          onClose={() => setCfDrill(null)}
          onChangeTab={(tab) => setCfDrill((d) => (d ? { ...d, tab } : d))}
        />
      )}

      {/* Sankey · colapsado por defecto (análisis a demanda, no ocupa el Resumen) */}
      <div className="rounded-lg border border-line bg-bg-elev">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <h3 className="text-[13px] font-semibold">
            ¿A dónde se va la plata? <span className="font-normal text-[11px] text-ink-4">{sankeyMode === 'egresos' ? 'proyecto → categoría' : 'cliente → proyecto'} · acumulado</span>
          </h3>
          <div className="flex items-center gap-2">
            {sankeyOpen && (
              <div className="flex rounded-md border border-line overflow-hidden text-[11px]">
                {(['egresos', 'ingresos'] as const).map((m) => (
                  <button key={m} onClick={() => setSankeyMode(m)} className={cn('px-2.5 h-7 capitalize', sankeyMode === m ? 'bg-primary text-primary-foreground' : 'text-ink-2 hover:bg-bg-sunken')}>{m}</button>
                ))}
              </div>
            )}
            <button onClick={() => setSankeyOpen((o) => !o)} className="h-7 px-2.5 rounded-md border border-line text-[11px] font-medium text-ink-2 hover:bg-bg-sunken">
              {sankeyOpen ? 'Ocultar' : 'Ver diagrama'}
            </button>
          </div>
        </div>
        {sankeyOpen && (
          <div className="border-t border-line px-4 pb-4 pt-2">
            {(sankeyData?.links.length ?? 0) === 0 ? (
              <Empty msg={sankeyMode === 'egresos' ? 'Sin gastos por categoría para diagramar' : 'Sin ingresos con cliente identificable · asigna cliente a los proyectos'} />
            ) : (
              <>
                <ReactECharts option={sankeyOption} style={{ height: 420 }} notMerge lazyUpdate opts={{ renderer: 'svg' }} />
                {sankeyMode === 'ingresos' && (data?.ingresosSinCliente ?? 0) > 0 && (
                  <div className="text-[10.5px] text-ink-4 mt-1.5">{fmtPEN(data!.ingresosSinCliente)} en ingresos sin cliente asignado (no mostrados · asigna cliente al proyecto para incluirlos).</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ msg }: { msg?: string }) {
  return <div className={cn('text-center py-12 text-[12px] text-ink-3')}>{msg ?? 'Sin movimientos registrados'}</div>;
}
