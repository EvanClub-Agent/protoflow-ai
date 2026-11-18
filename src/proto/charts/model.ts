import type { DBTableSchema } from '../../store/useProtoStore';

export const CHART_TYPES = ['BarChart', 'LineChart', 'AreaChart', 'PieChart', 'DonutChart', 'ScatterChart', 'RadarChart', 'GaugeChart', 'FunnelChart', 'HeatmapChart', 'TreemapChart', 'SankeyChart'] as const;
export type ChartType = typeof CHART_TYPES[number];
export const isChartType = (type: string): type is ChartType => (CHART_TYPES as readonly string[]).includes(type);
export const CATEGORY_CHARTS = new Set<ChartType>(['BarChart', 'LineChart', 'AreaChart']);
export const MULTI_METRIC_CHARTS = new Set<ChartType>(['BarChart', 'LineChart', 'AreaChart', 'RadarChart']);
export const GROUP_CHARTS = new Set<ChartType>(['HeatmapChart', 'SankeyChart']);
export const CHART_ROW_LIMIT = 50000;
export type ChartRecord = Record<string, string | number | boolean | null>;
export interface ChartMetric { field: string; label: string }
export interface ChartDataset { data: ChartRecord[]; dimension: string; metrics: ChartMetric[]; groupField?: string }
export interface ChartPoint { name: string; value: number | number[]; seriesName: string }

export function chartExample(type: ChartType): ChartDataset {
  if (type === 'ScatterChart') return { dimension: 'name', metrics: [{ field: 'visits', label: '访问量' }, { field: 'sales', label: '销售额' }], data: [
    { name: '门店 A', visits: 120, sales: 32 }, { name: '门店 B', visits: 220, sales: 68 }, { name: '门店 C', visits: 160, sales: 46 }, { name: '门店 D', visits: 280, sales: 92 }, { name: '门店 E', visits: 190, sales: 58 },
  ] };
  if (type === 'HeatmapChart') return { dimension: 'day', groupField: 'period', metrics: [{ field: 'value', label: '活跃度' }], data: ['周一', '周二', '周三', '周四', '周五'].flatMap((day, x) => ['上午', '下午', '晚间'].map((period, y) => ({ day, period, value: [24, 68, 42, 35, 92, 58, 46, 75, 33, 62, 84, 51, 38, 96, 72][x * 3 + y] }))) };
  if (type === 'SankeyChart') return { dimension: 'from', groupField: 'to', metrics: [{ field: 'value', label: '访问流量' }], data: [{ from: '搜索', to: '商品页', value: 60 }, { from: '推广', to: '商品页', value: 40 }, { from: '商品页', to: '下单', value: 65 }, { from: '商品页', to: '离开', value: 35 }] };
  if (type === 'GaugeChart') return { dimension: 'name', metrics: [{ field: 'value', label: '完成率' }], data: [{ name: '目标完成率', value: 72 }] };
  if (type === 'RadarChart') return { dimension: 'name', metrics: [{ field: 'current', label: '本期' }, { field: 'previous', label: '上期' }], data: [{ name: '产品', current: 85, previous: 70 }, { name: '体验', current: 92, previous: 80 }, { name: '服务', current: 78, previous: 65 }, { name: '效率', current: 88, previous: 75 }, { name: '增长', current: 76, previous: 68 }] };
  if (type === 'FunnelChart') return { dimension: 'name', metrics: [{ field: 'value', label: '人数' }], data: [{ name: '访问', value: 100 }, { name: '浏览', value: 80 }, { name: '咨询', value: 60 }, { name: '下单', value: 40 }, { name: '支付', value: 25 }] };
  if (['PieChart', 'DonutChart', 'TreemapChart'].includes(type)) return { dimension: 'name', metrics: [{ field: 'value', label: '销售额' }], data: [{ name: '华东', value: 320 }, { name: '华南', value: 240 }, { name: '华北', value: 180 }, { name: '西部', value: 160 }] };
  return { dimension: 'month', metrics: [{ field: 'sales', label: '销售额' }, { field: 'target', label: '目标值' }], data: ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月'].map((month, i) => ({ month, sales: [120, 182, 156, 238, 210, 286][i], target: [150, 160, 180, 200, 230, 260][i] })) };
}

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const fieldName = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && !forbidden.has(v);
export function chartNumber(value: unknown, at: string): number {
  // Numeric DB values can be serialized as decimal strings. Empty/null/boolean
  // are never converted to zero and identifiers are never used as substitutes.
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) && Number.isFinite(Number(value))) return Number(value);
  throw new Error(`${at} 需要数值或非空数字文本，不能用空值代替 0`);
}
function category(value: unknown, at: string): string {
  if ((typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  throw new Error(`${at} 需要非空分类文字或数字`);
}

export function chartConfigErrors(type: ChartType, p: Record<string, unknown>, tables?: DBTableSchema[]): string[] {
  const errors: string[] = [];
  if (!['sample', 'inline', 'table'].includes(String(p.source))) return ['请选择数据来源：sample / inline / table'];
  if (p.source === 'sample') {
    if (['table', 'data', 'dimension', 'metrics', 'groupField'].some(key => p[key] !== undefined)) errors.push('示例模式使用内置演示内容；自定义内容请改为 inline，绑定工程表请改为 table');
  } else {
    if (!fieldName(p.dimension)) errors.push('需要明确的分类字段 dimension');
    if (!Array.isArray(p.metrics) || !p.metrics.length || p.metrics.some(m => !record(m) || !fieldName(m.field) || typeof m.label !== 'string' || !m.label.trim())) errors.push('metrics 需要明确的指标字段 field 和显示名称 label');
    else {
      const metrics = p.metrics as ChartMetric[];
      if (new Set(metrics.map(m => m.field)).size !== metrics.length || new Set(metrics.map(m => m.label)).size !== metrics.length) errors.push('指标字段及显示名称不能重复');
      if (type === 'ScatterChart' ? metrics.length !== 2 : !MULTI_METRIC_CHARTS.has(type) && metrics.length !== 1) errors.push(type === 'ScatterChart' ? '散点图恰好需要两个指标，依次为 X 和 Y' : '此图表需要一个指标');
      if (metrics.some(m => m.field === p.dimension || m.field === p.groupField)) errors.push('分类字段与指标字段不能混用');
    }
    if (GROUP_CHARTS.has(type) && (!fieldName(p.groupField) || p.groupField === p.dimension)) errors.push('需要不同于 dimension 的第二分类字段 groupField');
    if (!GROUP_CHARTS.has(type) && p.groupField !== undefined) errors.push('此图表不使用第二分类字段');
    if (p.source === 'table') {
      if (!fieldName(p.table)) errors.push('需要真实数据表 ID');
      if (p.data !== undefined) errors.push('绑定数据表时不能同时提供自定义数据');
      if (tables) {
        const table = tables.find(t => t.id === p.table);
        if (!table) errors.push(`数据表不存在：${String(p.table)}`);
        else {
          const fields = [p.dimension, ...(Array.isArray(p.metrics) ? p.metrics.map(m => record(m) ? m.field : undefined) : []), ...(GROUP_CHARTS.has(type) ? [p.groupField] : [])];
          for (const name of fields) if (typeof name === 'string' && !table.columns.some(c => c.name === name)) errors.push(`未知图表字段 ${table.id}.${name}`);
        }
      }
    } else {
      if (p.table !== undefined) errors.push('自定义数据不能同时绑定数据表');
      if (!Array.isArray(p.data)) errors.push('自定义数据 data 必须是记录数组');
    }
  }
  if (type === 'GaugeChart' && (typeof p.min === 'number' ? p.min : 0) >= (typeof p.max === 'number' ? p.max : 100)) errors.push('仪表盘下限必须小于上限');
  if (['ScatterChart', 'GaugeChart'].includes(type) && p.aggregation !== undefined && p.aggregation !== 'none') errors.push('散点图和仪表盘不支持分类汇总');
  const checkRefs = (v: unknown) => {
    if (typeof v === 'string') for (const m of v.matchAll(/\{\{chart\.([^}]+)\}\}/g)) if (!['name', 'value', 'seriesName'].includes(m[1])) errors.push(`未知图表点击结果：${m[1]}`);
    if (Array.isArray(v)) v.forEach(checkRefs);
    else if (record(v)) Object.values(v).forEach(checkRefs);
  };
  checkRefs(p.onClick);
  if (!errors.length && (p.source === 'inline' || p.source === 'sample')) {
    try { prepareChartData(type, p, p.data); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  }
  return errors;
}

/** Validates only declared fields, preserving input order; aggregation is opt-in. */
export function prepareChartData(type: ChartType, p: Record<string, unknown>, input: unknown): ChartDataset {
  const config = p.source === 'sample' ? chartExample(type) : { dimension: p.dimension as string, metrics: p.metrics as ChartMetric[], groupField: p.groupField as string | undefined, data: input };
  const rows = config.data;
  if (!Array.isArray(rows)) throw new Error('关联表尚无已保存的预览数据，请先准备数据；不会用示例数据替代');
  if (rows.length > CHART_ROW_LIMIT) throw new Error(`当前图表最多读取 ${CHART_ROW_LIMIT} 条原型记录，请先汇总数据`);
  const dimension = config.dimension, metrics = config.metrics, groupField = config.groupField;
  if (!fieldName(dimension) || !Array.isArray(metrics) || !metrics.length) throw new Error('请先配置分类和指标字段');
  const aggregation = p.aggregation === undefined ? 'none' : p.aggregation;
  if (!['none', 'sum', 'average'].includes(String(aggregation))) throw new Error('未知汇总方式');
  const negativeForbidden = !CATEGORY_CHARTS.has(type) && type !== 'ScatterChart' && type !== 'HeatmapChart' && type !== 'GaugeChart';
  const grouped = new Map<string, { row: ChartRecord; count: number }>();
  const categoryTypes = new Map<string, string>();
  const trackCategory = (value: unknown, text: string, axis: string) => {
    const key = JSON.stringify([axis, text]), encoded = JSON.stringify(value);
    if (categoryTypes.has(key) && categoryTypes.get(key) !== encoded) throw new Error(`分类“${text}”同时使用了数值和同名文字，请统一分类类型`);
    categoryTypes.set(key, encoded!);
  };
  const data: ChartRecord[] = [];
  for (const [i, row] of rows.entries()) {
    if (!record(row) || Object.keys(row).some(k => forbidden.has(k))) throw new Error(`第 ${i + 1} 条数据需要有效记录`);
    for (const field of [dimension, ...metrics.map(m => m.field), ...(groupField === undefined ? [] : [groupField])]) {
      if (!Object.hasOwn(row, field)) throw new Error(`第 ${i + 1} 条数据缺少字段 ${field}`);
    }
    const name = category(row[dimension], `第 ${i + 1} 条数据的 ${dimension}`);
    const group = groupField === undefined ? undefined : category(row[groupField], `第 ${i + 1} 条数据的 ${groupField}`);
    if (type !== 'ScatterChart') trackCategory(row[dimension], name, type === 'SankeyChart' ? 'node' : 'dimension');
    if (groupField !== undefined) trackCategory(row[groupField], group!, type === 'SankeyChart' ? 'node' : 'group');
    const item: ChartRecord = { [dimension]: name, ...(groupField !== undefined ? { [groupField]: group! } : {}) };
    for (const metric of metrics) {
      const value = chartNumber(row[metric.field], `第 ${i + 1} 条数据的 ${metric.field}`);
      if (negativeForbidden && value < 0) throw new Error(`${type} 的指标不能为负数`);
      item[metric.field] = value;
    }
    const key = JSON.stringify([row[dimension], groupField === undefined ? null : row[groupField]]);
    const previous = grouped.get(key);
    if (previous && type !== 'ScatterChart') {
      if (aggregation === 'none') throw new Error(`分类“${name}${group === undefined ? '' : ' / ' + group}”有多条记录，请明确选择求和或平均值`);
      for (const metric of metrics) {
        const sum = Number(previous.row[metric.field]) + Number(item[metric.field]);
        if (!Number.isFinite(sum)) throw new Error(`指标 ${metric.label} 汇总后超出数值范围`);
        previous.row[metric.field] = sum;
      }
      previous.count++;
    } else { grouped.set(key, { row: item, count: 1 }); data.push(item); }
  }
  if (aggregation === 'average') for (const { row, count } of grouped.values()) for (const metric of metrics) row[metric.field] = Number(row[metric.field]) / count;
  if (type === 'GaugeChart' && data.length > 1) throw new Error('仪表盘仅展示一条汇总结果，请提供一个指标值');
  if (type === 'GaugeChart' && data.length) {
    const value = Number(data[0][metrics[0].field]);
    if (value < (typeof p.min === 'number' ? p.min : 0) || value > (typeof p.max === 'number' ? p.max : 100)) throw new Error('仪表值超出配置的上下限，请调整范围');
  }
  if (type === 'SankeyChart' && groupField) {
    const incoming = new Map<string, number>(), edges = new Map<string, string[]>();
    for (const row of data) {
      const from = String(row[dimension]), to = String(row[groupField]);
      incoming.set(from, incoming.get(from) ?? 0); incoming.set(to, (incoming.get(to) ?? 0) + 1);
      const targets = edges.get(from);
      if (targets) targets.push(to); else edges.set(from, [to]);
    }
    const queue = [...incoming].filter(([, count]) => count === 0).map(([name]) => name);
    for (let i = 0; i < queue.length; i++) for (const target of edges.get(queue[i]) ?? []) { const count = incoming.get(target)! - 1; incoming.set(target, count); if (!count) queue.push(target); }
    if (queue.length !== incoming.size) throw new Error('桑基图流向不能形成环路或指向自身');
  }
  return { data, dimension, metrics, ...(groupField !== undefined ? { groupField } : {}) };
}

export function resolveChartEvent(value: unknown, point: ChartPoint): any {
  if (typeof value === 'string') {
    const get = (key: string) => { if (!['name', 'value', 'seriesName'].includes(key)) throw new Error(`未知图表点击结果：${key}`); return point[key as keyof ChartPoint]; };
    const exact = /^\{\{chart\.([^}]+)\}\}$/.exec(value);
    if (exact) return get(exact[1]);
    return value.replace(/\{\{chart\.([^}]+)\}\}/g, (_, key) => { const v = get(key); return Array.isArray(v) ? v.join(', ') : String(v); });
  }
  if (Array.isArray(value)) return value.map(v => resolveChartEvent(v, point));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveChartEvent(v, point)]));
  return value;
}
