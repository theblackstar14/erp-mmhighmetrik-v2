import ReactECharts from '@/lib/echarts.js';
import { useMemo } from 'react';
import { useThemeStore } from '@/lib/theme-store.js';

const compact = (v: number) => `S/ ${Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0)}`;

// Curva S interactiva en soles (PV/EV/AC) · HOY marker · tooltip por mes. Para tab Avance.
export default function CurvaSChartEcharts({
  labels, planAcum, earnedAcum, realAcum, hoyIdx, showAC,
}: { labels: string[]; planAcum: number[]; earnedAcum: number[]; realAcum: number[]; hoyIdx: number; showAC: boolean }) {
  const dark = useThemeStore((s) => s.theme === 'dark');
  const axis = dark ? '#a1a1aa' : '#52525b';
  const grid = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const tipBg = dark ? '#1c1c20' : '#ffffff';
  const tipTx = dark ? '#e4e4e7' : '#27272a';

  const option = useMemo(() => {
    const cut = (arr: number[]) => arr.map((v, i) => (i <= hoyIdx ? v : null)); // real solo hasta hoy
    const series: Record<string, unknown>[] = [
      { name: 'PV · Plan', type: 'line', smooth: true, data: planAcum, symbol: 'none', lineStyle: { width: 1.5, type: 'dashed', color: axis }, itemStyle: { color: axis } },
      {
        name: 'EV · Earned', type: 'line', smooth: true, data: cut(earnedAcum), symbolSize: 6,
        lineStyle: { width: 2.5, color: '#4f6ef7' }, itemStyle: { color: '#4f6ef7' },
        areaStyle: { color: dark ? 'rgba(79,110,247,0.14)' : 'rgba(79,110,247,0.09)' },
        markLine: hoyIdx >= 0 ? { symbol: 'none', silent: true, lineStyle: { color: '#dc2626', width: 1.5 }, label: { formatter: 'HOY', color: '#dc2626', fontSize: 10, fontWeight: 700, position: 'insideEndTop' }, data: [{ xAxis: hoyIdx }] } : undefined,
      },
    ];
    if (showAC && realAcum.some((v) => v > 0)) {
      series.push({ name: 'AC · Costo real', type: 'line', smooth: true, data: cut(realAcum), symbol: 'none', lineStyle: { width: 2, color: '#d97706' }, itemStyle: { color: '#d97706' } });
    }
    return {
      grid: { left: 64, right: 18, top: 30, bottom: 26 },
      tooltip: { trigger: 'axis', backgroundColor: tipBg, borderColor: grid, textStyle: { color: tipTx, fontSize: 11 }, valueFormatter: (v: number | null) => (v == null ? '—' : compact(v)) },
      legend: { textStyle: { color: axis, fontSize: 11 }, top: 0, left: 0 },
      xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { color: axis, fontSize: 10 }, axisLine: { lineStyle: { color: grid } }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: axis, fontSize: 10, formatter: compact }, splitLine: { lineStyle: { color: grid } } },
      series,
    };
  }, [labels, planAcum, earnedAcum, realAcum, hoyIdx, showAC, axis, grid, tipBg, tipTx, dark]);

  return <ReactECharts option={option} style={{ height: 340 }} notMerge lazyUpdate opts={{ renderer: 'svg' }} />;
}
