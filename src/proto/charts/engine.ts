import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart, RadarChart, GaugeChart, FunnelChart, HeatmapChart, TreemapChart, SankeyChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, VisualMapComponent, AriaComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout } from 'echarts/features';

echarts.use([BarChart, LineChart, PieChart, ScatterChart, RadarChart, GaugeChart, FunnelChart, HeatmapChart, TreemapChart, SankeyChart, GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, VisualMapComponent, AriaComponent, CanvasRenderer, LabelLayout]);
export { echarts };
