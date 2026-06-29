import ReactECharts, { echarts } from '@/lib/echarts.js';
import { useMemo } from 'react';
import type { CashflowMes } from '@/lib/api.js';
import { useThemeStore } from '@/lib/theme-store.js';
import { fmtCompact } from '@/lib/utils.js';

export type CashflowMode = 'mes' | 'año' | 'total';
export type CashflowClick = { mode: CashflowMode; periodKey: string; tab: 'ingresos' | 'egresos' };

// Flujo de caja consolidado · línea (mes), barras (año) o barra horizontal (total).
export default function DashboardCashflowChart({ data, mode, onPointClick }: { data: CashflowMes[]; mode: CashflowMode; onPointClick: (c: CashflowClick) => void }) {
  const dark = useThemeStore((s) => s.theme === 'dark');
  const accent = '#4f6ef7', danger = '#dc2626';
  const axis = dark ? '#a1a1aa' : '#52525b';
  const grid = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const tipBg = dark ? '#1c1c20' : '#ffffff';
  const tipTx = dark ? '#e4e4e7' : '#27272a';

  const option = useMemo(() => {
    const baseTip = { backgroundColor: tipBg, borderColor: grid, borderWidth: 1, textStyle: { color: tipTx, fontSize: 11 } };
    if (mode === 'total') {
      const ing = data.reduce((s, d) => s + d.ingresos, 0);
      const eg = data.reduce((s, d) => s + d.egresos, 0);
      return {
        tooltip: { ...baseTip, trigger: 'item', formatter: (p: { name: string; value: number }) => `${p.name}<br/><b>${fmtCompact(p.value)}</b>` },
        grid: { top: 20, right: 90, bottom: 16, left: 12, containLabel: true },
        xAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmtCompact(v).replace('S/ ', ''), color: axis, fontSize: 10 }, splitLine: { lineStyle: { color: grid, type: 'dashed' } } },
        yAxis: { type: 'category', data: ['Egresos', 'Ingresos'], axisLabel: { color: axis, fontSize: 12, fontWeight: 600 }, axisLine: { lineStyle: { color: grid } }, axisTick: { show: false } },
        series: [{
          type: 'bar', cursor: 'pointer', barWidth: 28,
          data: [{ value: eg, itemStyle: { color: danger, borderRadius: [0, 4, 4, 0] } }, { value: ing, itemStyle: { color: accent, borderRadius: [0, 4, 4, 0] } }],
          label: { show: true, position: 'right', formatter: (p: { value: number }) => fmtCompact(p.value), fontSize: 12, fontWeight: 700, color: axis },
        }],
      };
    }
    let chart = data;
    if (mode === 'año') {
      const years: Record<string, { label: string; ingresos: number; egresos: number }> = {};
      data.forEach((d) => { const k = String(d.year); (years[k] ??= { label: k, ingresos: 0, egresos: 0 }); years[k]!.ingresos += d.ingresos; years[k]!.egresos += d.egresos; });
      chart = Object.values(years).map((y) => ({ ...y, ym: y.label, year: Number(y.label), acumulado: 0 })) as CashflowMes[];
    }
    const bars = mode === 'año';
    return {
      tooltip: { ...baseTip, trigger: 'axis', valueFormatter: (v: number) => fmtCompact(v), axisPointer: { type: 'line', lineStyle: { color: accent, type: 'dashed' } } },
      legend: { data: ['Ingresos', 'Egresos'], top: 2, right: 8, icon: 'roundRect', itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11, color: axis } },
      grid: { top: 36, right: 20, bottom: 24, left: 12, containLabel: true },
      xAxis: { type: 'category', boundaryGap: bars, data: chart.map((d) => d.label), axisLine: { lineStyle: { color: grid } }, axisTick: { show: false }, axisLabel: { fontSize: 10, color: axis, hideOverlap: true, margin: 12 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, color: axis, formatter: (v: number) => fmtCompact(v).replace('S/ ', '') }, splitLine: { lineStyle: { color: grid, type: 'dashed' } } },
      series: [
        {
          name: 'Ingresos', type: bars ? 'bar' : 'line', smooth: true, cursor: 'pointer', data: chart.map((d) => d.ingresos), color: accent,
          lineStyle: { width: 2.5 }, symbol: 'circle', symbolSize: 8, barWidth: 26, itemStyle: bars ? { color: accent, borderRadius: [4, 4, 0, 0] } : undefined,
          areaStyle: bars ? undefined : { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(79,110,247,0.20)' }, { offset: 1, color: 'rgba(79,110,247,0)' }]) },
        },
        {
          name: 'Egresos', type: bars ? 'bar' : 'line', smooth: true, cursor: 'pointer', data: chart.map((d) => d.egresos), color: danger,
          lineStyle: { width: 2.5, type: 'dashed' }, symbol: 'circle', symbolSize: 7, barWidth: 26, itemStyle: bars ? { color: danger, borderRadius: [4, 4, 0, 0] } : undefined,
        },
      ],
    };
  }, [data, mode, dark, axis, grid, tipBg, tipTx]);

  const onEvents = useMemo(() => ({
    click: (params: { name: string; seriesName?: string; dataIndex: number }) => {
      if (mode === 'total') onPointClick({ mode: 'total', periodKey: 'all', tab: params.dataIndex === 0 ? 'egresos' : 'ingresos' });
      else {
        const tab = params.seriesName === 'Egresos' ? 'egresos' : 'ingresos';
        const periodKey = mode === 'año' ? String(data[params.dataIndex]?.year ?? params.name) : (data[params.dataIndex]?.ym ?? params.name);
        onPointClick({ mode, periodKey, tab });
      }
    },
  }), [mode, data, onPointClick]);

  return <ReactECharts option={option} style={{ height: 240 }} notMerge lazyUpdate onEvents={onEvents} />;
}
