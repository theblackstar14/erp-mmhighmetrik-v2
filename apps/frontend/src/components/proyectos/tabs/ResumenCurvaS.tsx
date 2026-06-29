import ReactECharts from '@/lib/echarts.js';
import { useMemo } from 'react';
import type { CurvaSData } from '@/lib/api.js';
import { useThemeStore } from '@/lib/theme-store.js';

const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Curva S interactiva (plan punteado vs real con área) · HOY marker · tooltip por mes. Fiel a v1.
export default function ResumenCurvaS({ data }: { data: CurvaSData }) {
  const dark = useThemeStore((s) => s.theme === 'dark');
  const axis = dark ? '#a1a1aa' : '#52525b';
  const grid = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const tipBg = dark ? '#1c1c20' : '#ffffff';
  const tipTx = dark ? '#e4e4e7' : '#27272a';

  const option = useMemo(() => {
    const bac = data.evm.BAC || Math.max(...data.planAcum, 1);
    const labels = data.buckets.map((b) => `${MES[b.month - 1] ?? ''} ${String(b.year).slice(2)}`);
    const planPct = data.planAcum.map((v) => Math.round((v / bac) * 1000) / 10);
    const realPct = data.earnedAcum.map((v, i) => (i <= data.hoyIdx ? Math.round((v / bac) * 1000) / 10 : null));
    return {
      grid: { left: 44, right: 18, top: 30, bottom: 26 },
      tooltip: { trigger: 'axis', backgroundColor: tipBg, borderColor: grid, textStyle: { color: tipTx, fontSize: 11 }, valueFormatter: (v: number | null) => (v == null ? '—' : `${v}%`) },
      legend: { data: ['Plan', 'Real'], textStyle: { color: axis, fontSize: 11 }, top: 0, left: 0 },
      xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { color: axis, fontSize: 10 }, axisLine: { lineStyle: { color: grid } }, axisTick: { show: false } },
      yAxis: { type: 'value', max: 100, axisLabel: { color: axis, fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: grid } } },
      series: [
        { name: 'Plan', type: 'line', smooth: true, data: planPct, symbol: 'none', lineStyle: { width: 1.5, type: 'dashed', color: axis }, itemStyle: { color: axis } },
        {
          name: 'Real', type: 'line', smooth: true, data: realPct, symbolSize: 6,
          lineStyle: { width: 2.5, color: '#4f6ef7' }, itemStyle: { color: '#4f6ef7' },
          areaStyle: { color: dark ? 'rgba(79,110,247,0.14)' : 'rgba(79,110,247,0.09)' },
          markLine: data.hoyIdx >= 0 ? {
            symbol: 'none', silent: true,
            lineStyle: { color: '#dc2626', width: 1.5, type: 'solid' },
            label: { formatter: 'HOY', color: '#dc2626', fontSize: 10, fontWeight: 700, position: 'insideEndTop' },
            data: [{ xAxis: data.hoyIdx }],
          } : undefined,
        },
      ],
    };
  }, [data, axis, grid, tipBg, tipTx, dark]);

  return <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate opts={{ renderer: 'svg' }} />;
}
