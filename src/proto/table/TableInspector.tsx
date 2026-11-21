import React, { useState } from 'react';
import type { DBTableSchema } from '../../store/useProtoStore';
import { usePageStore } from '../store/usePageStore';
import { columnLabel, type Row } from '../runtime/mock';
import type { PropValue, ProtoNode } from '../types';
import { defaultTableColumns, SAMPLE_FIELDS, SAMPLE_ROWS, prepareTableRows, tableConfigErrors, visibleTableRows } from './model';
import { useI18n } from '../../i18n';

export const TABLE_LAYOUT_PROPS = ['rowMode', 'treeKeyField', 'parentField', 'detailFields', 'defaultExpandAll', 'cellMerges'];
type Patch = Record<string, PropValue | undefined>;
type Choice = { dataIndex: string; title: string };
const selectStyle = 'w-full min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700';

const SAMPLE_FIELD_EN_TITLES: Record<string, string> = {
  id: 'ID',
  parentId: 'Parent ID',
  name: 'Name',
  status: 'Status',
  remark: 'Notes',
  quantity: 'Quantity',
  updated: 'Updated',
  enabled: 'Enabled',
};

function ChoiceField({ label, value, options, onChange }: { label: string; value: string; options: Choice[]; onChange: (value: string) => void }) {
  const { tr } = useI18n();
  return <label className="block min-w-0 text-[11px] text-slate-600">{label}
    <select className={selectStyle} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{tr('请选择', 'Select...')}</option>
      {options.map(o => <option key={o.dataIndex} value={o.dataIndex}>{o.title}</option>)}
    </select>
  </label>;
}

function MergePanel({ node, rows, columns, onChange }: { node: ProtoNode; rows: Row[]; columns: Choice[]; onChange: (patch: Patch) => void }) {
  const { tr, td } = useI18n();
  const [open, setOpen] = useState(false);
  const [startRow, setStartRow] = useState(''), [endRow, setEndRow] = useState('');
  const [startField, setStartField] = useState(''), [endField, setEndField] = useState('');
  const [error, setError] = useState('');
  const ranges = Array.isArray(node.props.cellMerges) ? node.props.cellMerges : [];
  let ordered: ReturnType<typeof visibleTableRows> = [];
  let rowsError = '';
  if (open) {
    try { ordered = visibleTableRows(prepareTableRows(rows, node.props, {}, null).roots, () => true); }
    catch (cause) { rowsError = cause instanceof Error ? td(cause.message) : tr('表格记录不可用', 'Table rows unavailable'); }
  }
  const choices = ordered.map(({ row }) => {
    const value = columns.length ? row[columns[0].dataIndex] : undefined;
    return { dataIndex: row.id, title: value == null || value === row.id ? row.id : `${row.id} · ${value}` };
  });
  const range = (items: Choice[], first: string, last: string) => {
    const from = items.findIndex(c => c.dataIndex === first), to = items.findIndex(c => c.dataIndex === last);
    return from === -1 || to < from ? [] : items.slice(from, to + 1).map(c => c.dataIndex);
  };
  function add() {
    const rowIds = range(choices, startRow, endRow || startRow);
    const fields = range(columns, startField, endField || startField);
    if (!rowIds.length || !fields.length) { setError(tr('请选择有效的起点，终点须在起点之后', 'Select a valid start; end must not precede start')); return; }
    if (rowIds.length * fields.length < 2) { setError(tr('至少选择两行或两列', 'Select at least 2 rows or 2 columns')); return; }
    const siblings = ordered.filter(item => rowIds.includes(item.row.id));
    if (siblings.some(item => item.parentId !== siblings[0].parentId)) { setError(tr('树形表仅可合并同级且同父的行', 'Tree tables can only merge sibling rows with the same parent')); return; }
    const next = [...ranges, { rowIds, fields }];
    const errors = tableConfigErrors({ table: node.props.table, columns, cellMerges: next });
    if (errors.length) { setError(td(errors[0])); return; }
    setError('');
    onChange({ cellMerges: next });
  }
  const sep = tr('、', ', ');
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="rounded border border-slate-200 bg-white p-2 text-xs">
    <summary className="cursor-pointer font-medium text-slate-700">{tr('合并单元格', 'Merge Cells')}{ranges.length > 0 && tr(`（${ranges.length}）`, ` (${ranges.length})`)}</summary>
    {open && <div className="mt-2 space-y-2">
      <p className="text-[11px] text-slate-500">{tr('选择左上角和右下角，合并后显示左上角的值。同一页内行列连续时生效。', 'Pick top-left and bottom-right cells; displays top-left value when contiguous on the same page.')}</p>
      <div className="grid grid-cols-2 gap-2">
        <ChoiceField label={tr('起始记录', 'Start Row')} options={choices} value={startRow} onChange={setStartRow} />
        <ChoiceField label={tr('结束记录（可省略）', 'End Row (opt)')} options={choices} value={endRow} onChange={setEndRow} />
        <ChoiceField label={tr('起始列', 'Start Column')} options={columns} value={startField} onChange={setStartField} />
        <ChoiceField label={tr('结束列（可省略）', 'End Column (opt)')} options={columns} value={endField} onChange={setEndField} />
      </div>
      {(error || rowsError) && <div role="alert" className="text-red-600">{rowsError || error}</div>}
      <button type="button" onClick={add} className="rounded border border-blue-200 px-2 py-1 text-blue-700">{tr('添加合并区域', 'Add Merge Region')}</button>
      {ranges.map((region, i) => <div key={i} className="flex items-start gap-2 text-[11px] text-slate-600">
        <span className="min-w-0 flex-1 break-all">{region && typeof region === 'object' && 'rowIds' in region && Array.isArray(region.rowIds) && 'fields' in region && Array.isArray(region.fields) ? `${region.rowIds.join(sep)} × ${region.fields.join(sep)}` : tr('无效区域', 'Invalid region')}</span>
        <button type="button" className="text-red-600" onClick={() => onChange({ cellMerges: ranges.filter((_, j) => i !== j) })}>{tr('移除', 'Remove')}</button>
      </div>)}
    </div>}
  </details>;
}

export function TableInspector({ node, table, onChange }: { node: ProtoNode; table?: DBTableSchema; onChange: (patch: Patch) => void }) {
  const { isEn, tr } = useI18n();
  const { props } = node;
  const stored = usePageStore(s => table ? s.tableRows[table.id] : undefined);
  const sample = !props.table;
  const fields = table
    ? table.columns.map(c => ({ dataIndex: c.name, title: columnLabel(c) }))
    : sample
    ? SAMPLE_FIELDS.map(c => ({ dataIndex: c.dataIndex, title: isEn ? (SAMPLE_FIELD_EN_TITLES[c.dataIndex] ?? c.title) : c.title }))
    : [];
  const columns = Array.isArray(props.columns) && props.columns.length
    ? props.columns.filter((c): c is Record<string, PropValue> => !!c && typeof c === 'object' && 'dataIndex' in c).map(c => ({ dataIndex: String(c.dataIndex), title: String(c.title) }))
    : defaultTableColumns(table).map(c => ({ dataIndex: c.dataIndex, title: isEn && !table ? (SAMPLE_FIELD_EN_TITLES[c.dataIndex] ?? c.title) : c.title }));
  const mode = props.rowMode ?? 'flat';
  const detail = Array.isArray(props.detailFields) ? props.detailFields : columns.map(c => c.dataIndex);
  const modeLabels = {
    flat: tr('普通表格', 'Flat'),
    tree: tr('树形表格', 'Tree'),
    expandable: tr('展开详情', 'Expandable'),
  };
  return <section className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
    <h3 className="text-xs font-semibold text-slate-800">{tr('表格结构', 'Table Structure')}</h3>
    <div className="grid grid-cols-3 gap-1">
      {Object.entries(modeLabels).map(([key, title]) => <button type="button" key={key} aria-pressed={mode === key}
        className={`rounded border px-1 py-1.5 text-[11px] truncate ${mode === key ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}
        onClick={() => onChange({ rowMode: key === 'flat' ? undefined : key, ...(sample && key === 'tree' && !props.parentField ? { parentField: 'parentId' } : {}) })}>{title}</button>)}
    </div>
    {mode === 'tree' && <>
      <ChoiceField label={tr('节点字段', 'Node Key Field')} value={String(props.treeKeyField ?? 'id')} options={[{ dataIndex: 'id', title: tr('id · 工程记录 ID', 'id · Record ID') }, ...fields.filter(c => c.dataIndex !== 'id')]} onChange={v => onChange({ treeKeyField: v || undefined })} />
      <ChoiceField label={tr('父节点字段', 'Parent Key Field')} value={String(props.parentField ?? '')} options={fields} onChange={v => onChange({ parentField: v || undefined })} />
      <p className="text-[11px] text-slate-500">{tr('父值须与节点字段的值和类型一致，根节点填写 null。分页按根节点计数。', 'Parent value must match node key value/type (null for root rows). Pagination counts root rows.')}</p>
    </>}
    {mode === 'expandable' && <fieldset><legend className="text-[11px] font-medium text-slate-700">{tr('展开后展示的字段', 'Expanded Detail Fields')}</legend>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{fields.map(c => <label key={c.dataIndex} className="inline-flex items-center gap-1 text-[11px]">
        <input type="checkbox" checked={detail.includes(c.dataIndex)} disabled={detail.length === 1 && detail[0] === c.dataIndex} onChange={e => {
          const next = e.target.checked ? [...detail, c.dataIndex] : detail.filter(f => f !== c.dataIndex);
          onChange({ detailFields: next });
        }} />{c.title}</label>)}</div>
      <button type="button" className="mt-1 text-[11px] text-blue-700" onClick={() => onChange({ detailFields: undefined })}>{tr('使用展示列', 'Use Visible Columns')}</button>
    </fieldset>}
    {mode !== 'flat' && <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={props.defaultExpandAll === true} onChange={e => onChange({ defaultExpandAll: e.target.checked || undefined })} />{tr('默认展开全部', 'Expand all by default')}</label>}
    <MergePanel node={node} rows={sample ? SAMPLE_ROWS : stored ?? []} columns={columns} onChange={onChange} />
  </section>;
}
