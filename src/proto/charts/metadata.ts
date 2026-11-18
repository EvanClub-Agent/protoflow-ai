import type { ComponentMeta, PropSpec } from '../registry/meta';
import { CATEGORY_CHARTS, CHART_TYPES, GROUP_CHARTS, type ChartType } from './model';

const descriptions: Record<ChartType, [string, string, string]> = {
  BarChart: ['柱状图', 'ChartNoAxesColumn', '比较不同分类的数值，支持横向、分组和堆叠。'],
  LineChart: ['折线图', 'ChartLine', '呈现随时间或有序分类变化的趋势，可显示多条指标。'],
  AreaChart: ['面积图', 'ChartArea', '呈现趋势与规模，支持多指标堆叠。'],
  PieChart: ['饼图', 'ChartPie', '比较少量分类的占比，指标必须为非负数。'],
  DonutChart: ['环形图', 'ChartPie', '以环形呈现分类占比，适合概览看板。'],
  ScatterChart: ['散点图', 'ScatterChart', '观察两个数值指标的关系，每条记录对应一个点。'],
  RadarChart: ['雷达图', 'Radar', '比较多个维度上的综合表现，指标必须为非负数。'],
  GaugeChart: ['仪表盘', 'Gauge', '展示一个指标在指定范围内的位置，如目标完成率。'],
  FunnelChart: ['漏斗图', 'Filter', '展示各阶段数量和转化规模，按数据顺序排列。'],
  HeatmapChart: ['热力图', 'Grid3X3', '用颜色表达两个分类交叉后的数值强弱。'],
  TreemapChart: ['矩形树图', 'PanelsTopLeft', '用矩形面积比较分类构成；当前提供单层分类。'],
  SankeyChart: ['桑基图', 'Workflow', '展示来源、去向与流量，流向不能形成环路。'],
};

export const CHART_MATERIALS: ComponentMeta[] = CHART_TYPES.map(name => {
  const [title, icon, description] = descriptions[name];
  const props: PropSpec[] = [
    { name: 'title', label: '图表标题', kind: 'string', default: title },
    { name: 'source', label: '数据来源', kind: 'select', options: ['sample', 'inline', 'table'], required: true, description: 'sample=明确标注的示例；inline=自定义 data；table=工程已保存预览数据。不连接远程数据仓库。' },
    { name: 'table', label: '工程数据表', kind: 'table', description: '仅 table 来源使用真实 dbTables.id，不是物理表名。' },
    { name: 'data', label: '自定义数据', kind: 'list', description: '仅 inline 来源使用，记录数组；不支持函数或动态表达式。' },
    { name: 'dimension', label: name === 'SankeyChart' ? '来源字段' : '分类字段', kind: 'column', description: 'inline/table 必填，对应原始记录的真实字段名。' },
    { name: 'metrics', label: '数值指标', kind: 'list', itemFields: [{ name: 'field', label: '指标字段', kind: 'column' }, { name: 'label', label: '显示名称', kind: 'string' }], description: 'inline/table 必填，格式 [{field,label}]；数值或非空数字文本，不把空值当 0。柱/折线/面积/雷达支持多指标；散点恰好两个指标，依次 X、Y；其余恰好一个。' },
    ...(GROUP_CHARTS.has(name) ? [{ name: 'groupField', label: name === 'SankeyChart' ? '去向字段' : '纵向分类', kind: 'column' as const, description: '第二个真实分类字段，不能与 dimension 相同。' }] : []),
    ...(!['ScatterChart', 'GaugeChart'].includes(name) ? [{ name: 'aggregation', label: '汇总方式', kind: 'select' as const, options: ['none', 'sum', 'average'], default: 'none', description: '默认逐条展示，重复分类会报错；只有明确指定 sum/average 才按分类求和/平均，保持首次出现顺序。' }] : []),
    { name: 'height', label: '图表高度', kind: 'number', default: 320 },
    { name: 'palette', label: '图表配色', kind: 'select', options: ['blue', 'teal', 'warm', 'multicolor'], default: 'multicolor' },
    ...(!['GaugeChart', 'HeatmapChart', 'TreemapChart', 'SankeyChart'].includes(name) ? [{ name: 'showLegend', label: '显示图例', kind: 'boolean' as const, default: true }] : []),
    ...(!['GaugeChart', 'SankeyChart'].includes(name) ? [{ name: 'showLabel', label: '显示数值', kind: 'boolean' as const, default: false }] : []),
    ...(CATEGORY_CHARTS.has(name) ? [{ name: 'stacked', label: '堆叠展示', kind: 'boolean' as const, default: false }, { name: 'dataZoom', label: '区间缩放', kind: 'boolean' as const, default: false }] : []),
    ...(name === 'BarChart' ? [{ name: 'horizontal', label: '横向展示', kind: 'boolean' as const, default: false }] : []),
    ...(['LineChart', 'AreaChart'].includes(name) ? [{ name: 'smooth', label: '平滑曲线', kind: 'boolean' as const, default: false }] : []),
    ...(name === 'GaugeChart' ? [{ name: 'min', label: '范围下限', kind: 'number' as const, default: 0 }, { name: 'max', label: '范围上限', kind: 'number' as const, default: 100 }] : []),
  ];
  return { name, title, icon, description, category: 'charts', props, events: [{ name: 'onClick', label: '点击数据时（名称、数值、指标）' }], snippet: `<${name} title="${title}" source="sample" height={320} />` };
});

export const CHART_AI_RULES = `数据图表（Apache ECharts 6.1.0）：
- 已接入 BarChart、LineChart、AreaChart、PieChart、DonutChart、ScatterChart、RadarChart、GaugeChart、FunnelChart、HeatmapChart、TreemapChart、SankeyChart，位于“数据图表”。常规图表优先用它们，不能再用自由组件重画已有图表；只有现有图表确实无法表达的局部效果才考虑自由组件。
- 比较分类用柱状/横向柱状；时间趋势用折线或面积；少量分类占比用饼/环形，类别多时优先柱状；双数值关系用散点；多维对比用雷达；单指标范围用仪表盘；有序阶段转化用漏斗；双分类强度用热力；分类构成用矩形树图（当前单层）；来源去向流量用桑基（不能有环路）。
- source 显式选择 sample / inline / table。sample 不带数据映射，且必须明确是示例；inline 提供 data 记录数组、dimension 与 metrics:[{field,label}]；table 用真实表 ID 和真实字段名，先 get_table_rows 检查已保存数据。指标接受数值或非空数字文本，缺失/空值不能当作 0，不猜 id/code/name。
- 追加图表时必须重新核对实际记录，不能只看字段定义。upsert_db_table/upsert_db_column 只更新表结构，不会补齐已有记录，也不会自动计算利润、占比、同比、环比；不要为让图表通过校验而新增没有数据的指标字段。暂存和最终提交会检查所有记录，不能把 get_table_rows 第一页当作完整数据。
- 派生指标：先分页读取全部所需记录，确认原始指标、时期字段、基期对应关系和用户计算口径。若可按明确口径计算，使用标准图表的 source="inline" 展示计算后的结果，并在页面说明这是当前工程快照的计算结果、不会随表记录自动更新；保留原始表和已有图表。若缺少年份、上期/去年同期或基期为零等，不能把“季度1…季度8”擅自当作两个完整年度，也不能补 0、随机比例或改用 sample 来伪装完成；说明缺少的数据与受影响的指标，不声称已实现不可计算的部分。
- HeatmapChart 的 dimension 是横向分类、groupField 是纵向分类；SankeyChart 分别是来源和去向；ScatterChart 的两个 metrics 依次为 X/Y；GaugeChart 数据仅一条，并配置准确的 min/max。其余指标数量按组件契约。
- 默认不聚合，重复分类会提示错误。只有用户口径明确时设 aggregation="sum" 或 "average"。没有日期分桶、自动排序、百分比换算、实时查询或远程数据仓库能力，不把工程内数据说成线上实时数据。大数据量使用 dataZoom，单图最多读取 50000 条原型记录，不会静默截断。
- onClick 为标准动作链。可在动作参数中用 {{chart.name}}、{{chart.value}}、{{chart.seriesName}}；完整占位符保留原始类型。value 通常是数字，散点为 [x,y]，雷达为指标数值数组；这些是图表结果，不是业务行 ID，不能用于伪造 row 或主外键。桑基仅流向边支持点击联动。
- 不接受任意 ECharts option、formatter、renderItem、外部地图或第三方扩展。先读取组件的已接入属性；地图、3D 等未接入功能不可宣称已支持。完成后 inspect_page 检查字段、数据可用性与交互，未实际运行不得声称已验证。`;
