import React, { useEffect, useState } from 'react';
import type { DBTableSchema } from '../../store/useProtoStore';
import type { PropValue, ProtoDoc, ProtoNode } from '../types';
import { replaceNode } from '../dsl/tree';
import { validateMaterialDoc } from '../registry/materialContract';
import { CHART_MATERIALS } from './metadata';
import { chartConfigErrors, chartExample, chartNumber, GROUP_CHARTS, MULTI_METRIC_CHARTS, type ChartMetric, type ChartRecord, type ChartType } from './model';
import { useI18n } from '../../i18n';
import { localizeComponentMeta } from '../registry/localizeMeta';

const inputClass = 'w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400';
const labelsZh: Record<string, string> = { sample: '示例数据', inline: '自定义数据', table: '工程数据表', none: '逐条展示（不汇总）', sum: '按分类求和', average: '按分类求平均', blue: '清新蓝', teal: '青绿色', warm: '暖色系', multicolor: '多彩' };
const labelsEn: Record<string, string> = { sample: 'Sample Data', inline: 'Inline Data', table: 'Project Table', none: 'Raw Rows (No Aggregation)', sum: 'Sum by Category', average: 'Average by Category', blue: 'Blue', teal: 'Teal', warm: 'Warm', multicolor: 'Multicolor' };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
interface Props { node: ProtoNode; doc: ProtoDoc; tables: DBTableSchema[]; onCommit?: (doc: ProtoDoc) => void }

export const ChartInspector: React.FC<Props> = ({ node, doc, tables, onCommit }) => {
  const { locale, isEn, tr, td } = useI18n();
  const type = node.type as ChartType;
  const rawMeta = CHART_MATERIALS.find(c => c.name === type)!;
  const meta = localizeComponentMeta(rawMeta, locale);
  const labels = isEn ? labelsEn : labelsZh;
  const [draft, setDraft] = useState(node.props);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDraft(node.props); setDirty(false); setMessage(null); }, [node.pfId, node.props]);
  const change = (key: string, value: PropValue | undefined) => {
    setDraft(current => { const next = { ...current }; if (value === undefined) delete next[key]; else next[key] = value; return next; });
    setDirty(true); setMessage(null);
  };
  const source = draft.source;
  const table = tables.find(t => t.id === draft.table);
  const validRows = Array.isArray(draft.data) && draft.data.every(object);
  const rows = validRows ? draft.data as ChartRecord[] : [];
  const metrics = Array.isArray(draft.metrics) && draft.metrics.every(m => object(m) && typeof m.field === 'string' && typeof m.label === 'string') ? draft.metrics as unknown as ChartMetric[] : [];
  const fields = source === 'table' ? (table?.columns.map(c => ({ name: c.name, label: c.comment ? `${c.comment} (${c.name})` : c.name })) ?? [])
    : [...new Set([...rows.flatMap(row => Object.keys(row)), ...[draft.dimension, draft.groupField, ...metrics.map(m => m.field)].filter((name): name is string => typeof name === 'string' && name.length > 0)])].map(name => ({ name, label: name }));
  const switchSource = (nextSource: string) => {
    const next: Record<string, PropValue> = { ...draft, source: nextSource };
    for (const key of ['table', 'data', 'dimension', 'metrics', 'groupField']) delete next[key];
    if (nextSource === 'inline') Object.assign(next, chartExample(type));
    if (nextSource === 'table') next.metrics = [];
    setDraft(next); setDirty(true); setMessage(null);
  };
  const selectField = (value: unknown, onChange: (value: string) => void, label: string) => <select aria-label={label} className={inputClass} value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)}>
    <option value="">{tr('请选择字段', 'Select field...')}</option>
    {typeof value === 'string' && value && !fields.some(f => f.name === value) && <option value={value}>{tr(`字段不存在：${value}`, `Missing field: ${value}`)}</option>}
    {fields.map(f => <option key={f.name} value={f.name}>{f.label}</option>)}
  </select>;
  const setMetrics = (next: ChartMetric[]) => change('metrics', next as unknown as PropValue);
  const apply = () => {
    const nextDoc = replaceNode(doc, node.pfId, { ...node, props: draft });
    const errors = [...validateMaterialDoc(nextDoc).filter(i => i.pfId === node.pfId).map(i => td(i.message)), ...chartConfigErrors(type, draft, tables).map(e => td(e))];
    if (errors.length) { setMessage([...new Set(errors)].join(tr('；', '; '))); return; }
    onCommit?.(nextDoc); setDirty(false); setMessage(null);
  };
  return <div className="space-y-3" data-chart-inspector>
    <div className="rounded-lg bg-blue-50 p-3 text-[11px] leading-relaxed text-blue-800">{meta.description}<p className="mt-1 text-blue-600">{tr('配置分类、指标和展示方式，无需编写代码。', 'Configure categories, metrics, and display styles without writing code.')}</p></div>
    <label className="block space-y-1"><span>{tr('数据来源', 'Data Source')}</span><select aria-label={tr('图表数据来源', 'Chart data source')} className={inputClass} value={typeof source === 'string' ? source : ''} onChange={e => switchSource(e.target.value)}><option value="" disabled>{tr('请选择来源', 'Select source...')}</option>{['sample', 'inline', 'table'].map(s => <option key={s} value={s}>{labels[s]}</option>)}</select></label>
    {source === 'sample' && <p className="text-[11px] leading-relaxed text-slate-500">{tr('使用内置示例预览效果。切换到“自定义数据”即可直接修改表格内容。', 'Showing built-in sample data. Switch to "Inline Data" to edit records directly.')}</p>}
    {source === 'table' && <>
      <label className="block space-y-1"><span>{tr('工程数据表', 'Project Table')}</span><select aria-label={tr('图表工程数据表', 'Chart project table')} className={inputClass} value={typeof draft.table === 'string' ? draft.table : ''} onChange={e => { const next: Record<string, PropValue> = { ...draft, table: e.target.value, metrics: [] }; delete next.dimension; delete next.groupField; setDraft(next); setDirty(true); setMessage(null); }}>
        <option value="">{tr('请选择数据表', 'Select table...')}</option>
        {typeof draft.table === 'string' && !table && <option value={draft.table}>{tr(`数据表不存在：${draft.table}`, `Missing table: ${draft.table}`)}</option>}
        {tables.map(t => <option key={t.id} value={t.id}>{t.cnName}</option>)}
      </select></label>
      <p className="text-[11px] leading-relaxed text-slate-500">{tr('读取工程内已保存的预览数据。不会连接线上数据库，也不会自动生成替代记录。', 'Reads saved preview rows in this project without connecting to live databases.')}</p>
    </>}
    {source !== 'sample' && <>
      <label className="block space-y-1"><span>{type === 'SankeyChart' ? tr('来源', 'Source') : type === 'HeatmapChart' ? tr('横向分类', 'X Category') : tr('分类 / 名称', 'Category / Name')}</span>{selectField(draft.dimension, v => change('dimension', v), tr('图表分类字段', 'Chart category field'))}</label>
      {GROUP_CHARTS.has(type) && <label className="block space-y-1"><span>{type === 'SankeyChart' ? tr('去向', 'Target') : tr('纵向分类', 'Series / Y Category')}</span>{selectField(draft.groupField, v => change('groupField', v), tr('图表第二分类字段', 'Chart secondary category field'))}</label>}
      <div className="space-y-2"><div className="font-medium">{tr('数值指标', 'Metrics')}{type === 'ScatterChart' ? tr('（依次为横轴、纵轴）', ' (X-axis, then Y-axis)') : ''}</div>
        {metrics.map((metric, index) => <div key={index} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
          <div className="flex gap-1">{selectField(metric.field, field => setMetrics(metrics.map((m, i) => i === index ? { ...m, field } : m)), tr(`指标 ${index + 1} 字段`, `Metric ${index + 1} field`))}<button type="button" aria-label={tr(`移除指标 ${index + 1}`, `Remove metric ${index + 1}`)} className="px-1 text-slate-400 hover:text-red-500" onClick={() => setMetrics(metrics.filter((_, i) => i !== index))}>×</button></div>
          <input aria-label={tr(`指标 ${index + 1} 显示名称`, `Metric ${index + 1} label`)} placeholder={tr('给指标起个名称', 'Metric display label')} className={inputClass} value={metric.label} onChange={e => setMetrics(metrics.map((m, i) => i === index ? { ...m, label: e.target.value } : m))}/>
        </div>)}
        {(MULTI_METRIC_CHARTS.has(type) || metrics.length < (type === 'ScatterChart' ? 2 : 1)) && <button type="button" className="text-[11px] text-blue-600" onClick={() => setMetrics([...metrics, { field: '', label: tr(`指标 ${metrics.length + 1}`, `Metric ${metrics.length + 1}`) }])}>{tr('＋ 添加指标', '＋ Add Metric')}</button>}
      </div>
    </>}
    {source === 'inline' && <div className="space-y-2">
      {!validRows && <p role="alert" className="text-amber-700">{tr('自定义数据格式无效，请让 AI 修复，或重新选择数据来源。', 'Inline data format is invalid. Ask AI to fix it or reselect data source.')}</p>}
      <div className="font-medium">{tr('编辑数据', 'Edit Data')} <span className="font-normal text-slate-400">{tr(`${rows.length} 行`, `${rows.length} rows`)}</span></div>
      <div className="max-h-64 overflow-auto rounded-lg border border-slate-200"><table className="w-full text-[11px]"><thead className="bg-slate-50"><tr>{fields.map(f => <th key={f.name} className="min-w-24 px-2 py-2 text-left font-medium">{metrics.find(m => m.field === f.name)?.label ?? (f.name === draft.dimension ? (type === 'SankeyChart' ? tr('来源', 'Source') : tr('分类', 'Category')) : f.name === draft.groupField ? (type === 'SankeyChart' ? tr('去向', 'Target') : tr('纵向分类', 'Y Category')) : f.label)}</th>)}<th className="w-5"/></tr></thead><tbody>
        {rows.slice(0, 50).map((row, i) => <tr key={i}>{fields.map(f => <td key={f.name} className="border-t border-slate-100"><input aria-label={tr(`第 ${i + 1} 行 ${f.name}`, `Row ${i + 1} ${f.name}`)} className="w-24 bg-transparent px-2 py-2 outline-none focus:bg-blue-50" value={row[f.name] === null || row[f.name] === undefined ? '' : String(row[f.name])} onChange={e => {
          const value = e.target.value;
          let cell: string | number = value;
          if (metrics.some(m => m.field === f.name)) { try { cell = chartNumber(value, f.name); } catch { /* Keep invalid input visible for correction; apply reports it. */ } }
          change('data', rows.map((r, n) => n === i ? { ...r, [f.name]: cell } : r));
        }}/></td>)}<td><button type="button" aria-label={tr(`删除第 ${i + 1} 行`, `Delete row ${i + 1}`)} className="px-1 text-slate-400" onClick={() => change('data', rows.filter((_, n) => n !== i))}>×</button></td></tr>)}
      </tbody></table></div>
      {rows.length > 50 && <p className="text-[10px] text-slate-500">{tr(`面板展示前 50 行，应用时保留全部 ${rows.length} 行。`, `Showing first 50 rows; all ${rows.length} rows are preserved on apply.`)}</p>}
      <div className="flex gap-3"><button type="button" disabled={!validRows} className="text-[11px] text-blue-600 disabled:opacity-40" onClick={() => change('data', [...rows, Object.fromEntries(fields.map(f => [f.name, '']))])}>{tr('＋ 添加一行', '＋ Add Row')}</button>
        {MULTI_METRIC_CHARTS.has(type) && <button type="button" disabled={!validRows} className="text-[11px] text-blue-600 disabled:opacity-40" onClick={() => {
          let index = 1; while (fields.some(f => f.name === `value_${index}`)) index++;
          const field = `value_${index}`;
          setDraft({ ...draft, data: rows.map(row => ({ ...row, [field]: '' })), metrics: [...metrics, { field, label: tr(`新指标 ${index}`, `Metric ${index}`) }] as unknown as PropValue }); setDirty(true); setMessage(null);
        }}>{tr('＋ 添加数值列', '＋ Add Metric Column')}</button>}
      </div>
    </div>}
    <div className="border-t border-slate-100 pt-3 space-y-2"><div className="font-medium">{tr('展示设置', 'Display Settings')}</div>
      {meta.props.filter(prop => !['source', 'table', 'data', 'dimension', 'metrics', 'groupField'].includes(prop.name)).map(prop => {
        const value = draft[prop.name] === undefined ? prop.default : draft[prop.name];
        if (prop.kind === 'boolean') return <label key={prop.name} className="flex items-center justify-between gap-2 text-[11px]"><span>{prop.label}</span><input type="checkbox" checked={value === true} onChange={e => change(prop.name, e.target.checked)}/></label>;
        return <label key={prop.name} className="block space-y-1 text-[11px]"><span>{prop.label}</span>{prop.kind === 'select'
          ? <select className={inputClass} value={typeof value === 'string' ? value : ''} onChange={e => change(prop.name, e.target.value)}>{prop.options?.map(option => <option key={option} value={option}>{labels[option] ?? option}</option>)}</select>
          : <input aria-label={prop.label} className={inputClass} type={prop.kind === 'number' ? 'number' : 'text'} value={typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={e => change(prop.name, prop.kind === 'number' ? e.target.value === '' ? undefined : Number(e.target.value) : e.target.value)}/>}</label>;
      })}
    </div>
    <p className="text-[10px] leading-relaxed text-slate-500">{tr('点击联动在“交互”中配置。名称、数值、指标名称可传给详情弹框；它们不代表业务记录 ID。', 'Configure click actions in the "Events" tab. Point name, value, and series can be passed to overlays.')}</p>
    {message && <p role="alert" className="rounded-lg bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-800">{message}</p>}
    <button type="button" disabled={!dirty || !onCommit} onClick={apply} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">{tr('应用图表设置', 'Apply Chart Settings')}</button>
  </div>;
};
