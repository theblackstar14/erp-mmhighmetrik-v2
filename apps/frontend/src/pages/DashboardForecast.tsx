import ReactECharts from '@/lib/echarts.js';
import { useMemo } from 'react';
import type { Forecast } from '@/lib/api.js';
import { useThemeStore } from '@/lib/theme-store.js';

// Curva de proyección (plan maestro vs avance proyectado) + gauge probabilidad cierre Q2.
export default function DashboardForecast({ forecast }: { forecast: Forecast }) {
  const dark = useThemeStore((s) => s.theme === 'dark');
  const axis = dark ? '#a1a1aa' : '#52525b';
  const grid = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const tooltipBg = dark ? '#1c1c20' : '#ffffff';
  const tooltipText = dark ? '#e4e4e7' : '#27272a';

  const curva = useMemo(() => {
    const p = forecast.puntos;
    return {
      grid: { left: 40, right: 16, top: 36, bottom: 24 },
      tooltip: { trigger: 'axis', backgroundColor: tooltipBg, borderColor: grid, textStyle: { color: tooltipText, fontSize: 11 }, valueFormatter: (v: number) => `${v}%` },
      legend: { data: ['Avance proyectado', 'Plan maestro'], textStyle: { color: axis, fontSize: 11 }, top: 0, left: 'center' },
      xAxis: { type: 'category', data: p.map((x) => x.periodo), axisLabel: { color: axis, fontSize: 10 }, axisLine: { lineStyle: { color: grid } }, axisTick: { show: false } },
      yAxis: { type: 'value', max: 100, axisLabel: { color: axis, fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: grid } } },
      series: [
        { name: 'Avance proyectado', type: 'line', smooth: true, data: p.map((x) => x.proyectado), lineStyle: { width: 2.5, color: '#4f6ef7' }, itemStyle: { color: '#4f6ef7' }, areaStyle: { color: dark ? 'rgba(79,110,247,0.12)' : 'rgba(79,110,247,0.08)' }, symbolSize: 6 },
        { name: 'Plan maestro', type: 'line', smooth: true, data: p.map((x) => x.plan), lineStyle: { width: 1.5, type: 'dashed', color: axis }, itemStyle: { color: axis }, symbol: 'none' },
      ],
    };
  }, [forecast, axis, grid, tooltipBg, tooltipText, dark]);

  const prob = forecast.probabilidadCierreQ2;
  const probColor = prob >= 85 ? '#16a34a' : prob >= 60 ? '#f59e0b' : '#dc2626';
  const gauge = useMemo(() => ({
    series: [{
      type: 'gauge', startAngle: 220, endAngle: -40, radius: '92%', center: ['50%', '56%'],
      min: 0, max: 100, progress: { show: true, width: 14, itemStyle: { color: probColor } },
      axisLine: { lineStyle: { width: 14, color: [[1, dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)']] } },
      pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
      detail: { valueAnimation: true, formatter: '{value}%', color: probColor, fontSize: 30, fontWeight: 700, offsetCenter: [0, 0] },
      data: [{ value: prob }],
    }],
  }), [prob, probColor, dark]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-4 mb-1">Curva de proyección anual</div>
        <ReactECharts option={curva} style={{ height: 280 }} notMerge lazyUpdate />
      </div>
      <div className="flex flex-col items-center justify-center">
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-4 self-start">Probabilidad cierre Q2</div>
        <ReactECharts option={gauge} style={{ height: 220, width: '100%' }} notMerge lazyUpdate />
        <p className="text-[11px] text-ink-3 text-center -mt-2 px-4">
          Cumplimiento proyectado del <b>{prob}%</b> al cierre del segundo trimestre según ritmo de valorización actual.
        </p>
      </div>
    </div>
  );
}
