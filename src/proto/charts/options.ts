import { CATEGORY_CHARTS, type ChartType, type ChartDataset, type ChartPoint } from './model';
import type { EChartsCoreOption } from 'echarts/core';

export const CHART_PALETTES = {
  blue: ['#2563eb', '#60a5fa', '#1e40af', '#93c5fd', '#0ea5e9', '#7dd3fc'],
  teal: ['#0d9488', '#2dd4bf', '#0369a1', '#38bdf8', '#059669', '#6ee7b7'],
  warm: ['#f97316', '#fbbf24', '#ef4444', '#fb7185', '#a855f7', '#fdba74'],
  multicolor: ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4'],
};
const item = (name: string, value: number | number[], seriesName: string, extra = {}) => ({ name, value, ...extra, protoflowPoint: { name, value, seriesName } satisfies ChartPoint });

export function buildChartOption(type: ChartType, p: Record<string, unknown>, dataset: ChartDataset, dark = false): EChartsCoreOption {
  const { data, dimension, metrics, groupField } = dataset;
  const names = data.map(row => String(row[dimension]));
  const values = (field: string) => data.map(row => Number(row[field]));
  const colors = CHART_PALETTES[(p.palette === undefined ? 'multicolor' : p.palette) as keyof typeof CHART_PALETTES];
  const dense = data.length > 2000;
  const textColor = dark ? 'rgba(255, 255, 255, 0.85)' : '#475569';
  const subTextColor = dark ? 'rgba(255, 255, 255, 0.65)' : '#64748b';
  const axisLineColor = dark ? '#424242' : '#e2e8f0';
  const splitLineColor = dark ? '#262626' : '#f1f5f9';
  const surfaceBorderColor = dark ? '#141414' : '#fff';
  const tooltipStyle = {
    backgroundColor: dark ? '#1f1f1f' : '#fff',
    borderColor: dark ? '#424242' : null,
    textStyle: { color: dark ? 'rgba(255, 255, 255, 0.88)' : '#475569' },
  };
  const option: EChartsCoreOption = {
    color: colors, animation: !dense, animationDuration: 350,
    textStyle: { fontFamily: 'system-ui, sans-serif', fontSize: 12, color: textColor },
    aria: { enabled: true },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true, ...tooltipStyle },
    legend: { show: p.showLegend !== false, type: 'scroll', bottom: 0, textStyle: { color: subTextColor, fontSize: 11 } },
  };
  const label = { show: p.showLabel === true, color: dark ? textColor : null };
  const metric = metrics[0];
  if (CATEGORY_CHARTS.has(type)) {
    const horizontal = type === 'BarChart' && p.horizontal === true;
    const categoryAxis = { type: 'category', data: names, axisTick: { show: false }, axisLine: { lineStyle: { color: axisLineColor } }, axisLabel: { color: subTextColor, hideOverlap: true }, boundaryGap: type === 'BarChart' };
    const valueAxis = { type: 'value', axisLabel: { color: subTextColor }, splitLine: { lineStyle: { color: splitLineColor } } };
    option.grid = { left: 12, right: 24, top: 16, bottom: p.dataZoom ? 76 : 48, containLabel: true };
    option.xAxis = horizontal ? valueAxis : categoryAxis;
    option.yAxis = horizontal ? categoryAxis : valueAxis;
    option.tooltip = { trigger: 'axis', renderMode: 'richText', confine: true, ...tooltipStyle };
    if (p.dataZoom) option.dataZoom = [{ type: 'inside', ...(horizontal ? { yAxisIndex: 0 } : { xAxisIndex: 0 }) }, { type: 'slider', bottom: 28, height: 18, ...(horizontal ? { yAxisIndex: 0 } : { xAxisIndex: 0 }) }];
    option.series = metrics.map(m => ({ name: m.label, type: type === 'BarChart' ? 'bar' : 'line', data: data.map(row => item(String(row[dimension]), Number(row[m.field]), m.label)), label,
      ...(p.stacked ? { stack: 'metrics' } : {}),
      ...(type === 'BarChart' ? { barMaxWidth: 42, large: dense && p.onClick === undefined, progressive: 3000 } : { smooth: p.smooth === true, showSymbol: !dense, sampling: 'lttb', ...(type === 'AreaChart' ? { areaStyle: { opacity: 0.2 } } : {}) }),
    }));
  } else if (type === 'PieChart' || type === 'DonutChart') {
    option.series = [{ type: 'pie', name: metric.label, stillShowZeroSum: false, radius: type === 'DonutChart' ? ['43%', '66%'] : '66%', center: ['50%', '45%'], avoidLabelOverlap: true, label: { ...label, formatter: '{b}: {c}' }, data: data.map(row => item(String(row[dimension]), Number(row[metric.field]), metric.label)), itemStyle: { borderColor: surfaceBorderColor, borderWidth: 2 } }];
  } else if (type === 'ScatterChart') {
    option.grid = { left: 12, right: 28, top: 28, bottom: 48, containLabel: true };
    option.xAxis = { type: 'value', name: metrics[0].label, nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: subTextColor }, axisLabel: { color: subTextColor }, splitLine: { lineStyle: { color: splitLineColor } } };
    option.yAxis = { type: 'value', name: metrics[1].label, nameTextStyle: { color: subTextColor }, axisLabel: { color: subTextColor }, splitLine: { lineStyle: { color: splitLineColor } } };
    option.series = [{ type: 'scatter', name: metrics.map(m => m.label).join(' / '), symbolSize: dense ? 5 : 14, large: dense && p.onClick === undefined, progressive: 3000, label: { ...label, formatter: '{b}', position: 'top' }, data: data.map(row => item(String(row[dimension]), metrics.map(m => Number(row[m.field])), metrics.map(m => m.label).join(' / '))) }];
  } else if (type === 'RadarChart') {
    option.radar = { radius: '62%', center: ['50%', '45%'], axisName: { color: subTextColor }, splitLine: { lineStyle: { color: axisLineColor } }, splitArea: { areaStyle: { color: dark ? ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.04)'] : ['rgba(250,250,250,0.3)', 'rgba(200,200,200,0.1)'] } }, indicator: data.map(row => ({ name: String(row[dimension]), max: Math.max(1, ...metrics.map(m => Number(row[m.field]))) * 1.2 })) };
    option.series = [{ type: 'radar', label, areaStyle: { opacity: 0.12 }, data: metrics.map(m => item(m.label, values(m.field), m.label)) }];
  } else if (type === 'GaugeChart') {
    option.legend = { show: false };
    option.series = [{ type: 'gauge', min: p.min === undefined ? 0 : p.min, max: p.max === undefined ? 100 : p.max, radius: '84%', center: ['50%', '54%'], progress: { show: true, width: 12 }, axisLine: { lineStyle: { width: 12, color: [[1, dark ? '#262626' : '#e8ebf0']] } }, axisTick: { show: false }, splitLine: { length: 8, lineStyle: { color: dark ? '#424242' : '#cbd5e1' } }, axisLabel: { distance: 18, color: dark ? 'rgba(255,255,255,0.45)' : '#94a3b8', fontSize: 10 }, detail: { fontSize: 28, offsetCenter: [0, '40%'], color: textColor }, title: { offsetCenter: [0, '68%'], fontSize: 12, color: subTextColor }, data: data.map(row => item(String(row[dimension]), Number(row[metric.field]), metric.label)) }];
  } else if (type === 'FunnelChart') {
    option.series = [{ type: 'funnel', name: metric.label, left: '15%', width: '70%', top: 16, bottom: 46, sort: 'none', gap: 3, label: { show: true, position: 'inside', formatter: p.showLabel ? '{b}: {c}' : '{b}' }, itemStyle: { borderColor: surfaceBorderColor, borderWidth: 1 }, data: data.map(row => item(String(row[dimension]), Number(row[metric.field]), metric.label)) }];
  } else if (type === 'HeatmapChart') {
    const xs = [...new Set(names)], ys = [...new Set(data.map(row => String(row[groupField!])))];
    const xIndex = new Map(xs.map((x, i) => [x, i])), yIndex = new Map(ys.map((y, i) => [y, i]));
    option.legend = { show: false };
    option.grid = { left: 12, right: 18, top: 16, bottom: 72, containLabel: true };
    option.xAxis = { type: 'category', data: xs, axisLabel: { color: subTextColor }, axisLine: { lineStyle: { color: axisLineColor } }, splitArea: { show: true } };
    option.yAxis = { type: 'category', data: ys, axisLabel: { color: subTextColor }, axisLine: { lineStyle: { color: axisLineColor } }, splitArea: { show: true } };
    const nums = values(metric.field);
    option.visualMap = { min: Math.min(0, ...nums), max: Math.max(1, ...nums), orient: 'horizontal', left: 'center', bottom: 0, calculable: true, textStyle: { color: subTextColor }, inRange: { color: [dark ? '#111a2c' : '#eff6ff', colors[0]] } };
    option.series = [{ type: 'heatmap', name: metric.label, label, data: data.map(row => ({ value: [xIndex.get(String(row[dimension])), yIndex.get(String(row[groupField!])), Number(row[metric.field])], protoflowPoint: { name: `${row[dimension]} / ${row[groupField!]}`, value: Number(row[metric.field]), seriesName: metric.label } })), emphasis: { itemStyle: { borderColor: surfaceBorderColor, borderWidth: 2 } } }];
  } else if (type === 'TreemapChart') {
    option.legend = { show: false };
    option.series = [{ type: 'treemap', name: metric.label, top: 10, bottom: 10, left: 8, right: 8, roam: false, nodeClick: false, breadcrumb: { show: false }, label: { show: true, formatter: p.showLabel ? '{b}\n{c}' : '{b}' }, data: data.map(row => item(String(row[dimension]), Number(row[metric.field]), metric.label)), itemStyle: { borderColor: surfaceBorderColor, borderWidth: 2, gapWidth: 3 } }];
  } else if (type === 'SankeyChart') {
    option.legend = { show: false };
    const nodes = [...new Set(data.flatMap(row => [String(row[dimension]), String(row[groupField!])]))];
    option.series = [{ type: 'sankey', name: metric.label, left: 12, right: 65, top: 16, bottom: 16, draggable: false, label: { color: textColor }, data: nodes.map(name => ({ name })), links: data.map(row => ({ source: String(row[dimension]), target: String(row[groupField!]), value: Number(row[metric.field]), protoflowPoint: { name: `${row[dimension]} → ${row[groupField!]}`, value: Number(row[metric.field]), seriesName: metric.label } })), lineStyle: { color: 'gradient', opacity: 0.35 }, emphasis: { focus: 'adjacency' } }];
  }
  return option;
}

export function chartClickPoint(event: unknown): ChartPoint | null {
  const p = (event as { data?: { protoflowPoint?: ChartPoint } })?.data?.protoflowPoint;
  if (!p || typeof p.name !== 'string' || typeof p.seriesName !== 'string') return null;
  if (typeof p.value === 'number' ? !Number.isFinite(p.value) : !Array.isArray(p.value) || !p.value.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  return p;
}
