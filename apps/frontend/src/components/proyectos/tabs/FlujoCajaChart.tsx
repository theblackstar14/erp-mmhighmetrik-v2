import ReactECharts from '@/lib/echarts.js';
import { useMemo } from 'react';
import type { CashflowResponse } from '@/lib/api.js';
import { useThemeStore } from '@/lib/theme-store.js';

const compact = (v: number) => `${v < 0 ? '-' : ''}S/ ${Math.abs(v) >= 1e6 ? `${(Math.abs(v) / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(Math.abs(v) / 1e3).toFixed(0)}K` : Math.abs(v).toFixed(0)}`;

// Flujo de caja: barras de neto por mes (verde+/rojo−) + línea de saldo acumulado.
export default function FlujoCajaChart({ buckets }: { buckets: CashflowResponse['buckets'] }) {
  const dark = useThemeStore((s) => s.theme === 'dark');
  const axis = dark ? '#a1a1aa' : '#52525b';
  const grid = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const tipBg = dark ? '#1c1c20' : '#ffffff';
  const tipTx = dark ? '#e4e4e7' : '#27272a';

  const option = useMemo(() => ({
    grid: { left: 64, right: 18, top: 30, bottom: 26 },
    tooltip: { trigger: 'axis', backgroundColor: tipBg, borderColor: grid, textStyle: { color: tipTx, fontSize: 11 }, valueFormatter: (v: number) => compact(v) },
    legend: { data: ['Neto del mes', 'Saldo acumulado'], textStyle: { color: axis, fontSize: 11 }, top: 0, left: 0 },
    xAxis: { type: 'category', data: buckets.map((b) => b.ym), axisLabel: { color: axis, fontSize: 10 }, axisLine: { lineStyle: { color: grid } }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: axis, fontSize: 10, formatter: compact }, splitLine: { lineStyle: { color: grid } } },
    series: [
      {
        name: 'Neto del mes', type: 'bar', barMaxWidth: 36,
        data: buckets.map((b) => ({ value: b.neto, itemStyle: { color: b.neto >= 0 ? '#16a34a' : '#dc2626', borderRadius: [3, 3, 0, 0] } })),
      },
      { name: 'Saldo acumulado', type: 'line', smooth: true, data: buckets.map((b) => b.saldoAcum), symbolSize: 6, lineStyle: { width: 2.5, color: '#4f6ef7' }, itemStyle: { color: '#4f6ef7' } },
    ],
  }), [buckets, axis, grid, tipBg, tipTx]);

  return <ReactECharts option={option} style={{ height: 260 }} notMerge lazyUpdate opts={{ renderer: 'svg' }} />;
}
