// echarts tree-shaken · solo charts/componentes que usan nuestros gráficos.
// Reemplaza `import ReactECharts from 'echarts-for-react'` (barrel ~1MB) por este wrapper.
// Si agregas un nuevo tipo de serie/componente en algún chart, REGÍSTRALO en el use([...]) de abajo
// o el gráfico saldrá en blanco. Charts en uso: line, bar, gauge, pie, sankey.
import * as echarts from 'echarts/core';
import { BarChart, GaugeChart, LineChart, PieChart, SankeyChart } from 'echarts/charts';
import { AxisPointerComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { ComponentProps } from 'react';

echarts.use([
  BarChart, GaugeChart, LineChart, PieChart, SankeyChart,
  AxisPointerComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent,
  CanvasRenderer,
]);

export { echarts };

// Drop-in de <ReactECharts/> con la instancia core pre-bindeada (no hay que pasar echarts en cada uso).
export default function ReactECharts(props: Omit<ComponentProps<typeof ReactEChartsCore>, 'echarts'>) {
  return <ReactEChartsCore echarts={echarts} {...props} />;
}
