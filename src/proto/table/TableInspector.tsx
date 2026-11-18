import React, { useState } from 'react';
import type { DBTableSchema } from '../../store/useProtoStore';
import { usePageStore } from '../store/usePageStore';
import { columnLabel, type Row } from '../runtime/mock';
import type { PropValue, ProtoNode } from '../types';
import { defaultTableColumns, SAMPLE_FIELDS, SAMPLE_ROWS, prepareTableRows, tableConfigErrors, visibleTableRows } from './model';

export const TABLE_LAYOUT_PROPS = ['rowMode', 'treeKeyField', 'parentField', 'detailFields', 'defaultExpandAll', 'cellMerges'];
type Patch = Record<string, PropValue | undefined>;
type Choice = { dataIndex: string; title: string };
const selectStyle = 'w-full min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700';
function ChoiceField({ label, value, options, onChange }: { label: string; value: string; options: Choice[]; onChange: (value: string) => void }) {
  return <label className="block min-w-0 text-[11px] text-slate-600">{label}
    <select className={selectStyle} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">请选择</option>
      {options.map(o => <option key={o.dataIndex} value={o.dataIndex}>{o.title}</option>)}
    </select>
  </label>;
}

function MergePanel({ node, rows, columns, onChange }: { node: ProtoNode; rows: Row[]; columns: Choice[]; onChange: (patch: Patch) => void }) {
  const [open, setOpen] = useState(false);
  const [startRow, setStartRow] = useState(''), [endRow, setEndRow] = useState('');
  const [startField, setStartField] = useState(''), [endField, setEndField] = useState('');
  const [error, setError] = useState('');
  const ranges = Array.isArray(node.props.cellMerges) ? node.props.cellMerges : [];
  let ordered: ReturnType<typeof visibleTableRows> = [];
  let rowsError = '';
  if (open) {
    try { ordered = visibleTableRows(prepareTableRows(rows, node.props, {}, null).roots, () => true); }
    catch (cause) { rowsError = cause instanceof Error ? cause.message : '表格记录不可用'; }
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
    if (!rowIds.length || !fields.length) { setError('请选择有效的起点，终点须在起点之后'); return; }
    if (rowIds.length * fields.length < 2) { setError('至少选择两行或两列'); return; }
    const siblings = ordered.filter(item => rowIds.includes(item.row.id));
    if (siblings.some(item => item.parentId !== siblings[0].parentId)) { setError('树形表仅可合并同级且同父的行'); return; }
    const next = [...ranges, { rowIds, fields }];
    const errors = tableConfigErrors({ table: node.props.table, columns, cellMerges: next });
    if (errors.length) { setError(errors[0]); return; }
    setError('');
    onChange({ cellMerges: next });
  }
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="rounded border border-slate-200 bg-white p-2 text-xs">
    <summary className="cursor-pointer font-medium text-slate-700">合并单元格{ranges.length > 0 && `（${ranges.length}）`}</summary>
    {open && <div className="mt-2 space-y-2">
      <p className="text-[11px] text-slate-500">选择左上角和右下角，合并后显示左上角的值。同一页内行列连续时生效。</p>
      <div className="grid grid-cols-2 gap-2">
        <ChoiceField label="起始记录" options={choices} value={startRow} onChange={setStartRow} />
        <ChoiceField label="结束记录（可省略）" options={choices} value={endRow} onChange={setEndRow} />
        <ChoiceField label="起始列" options={columns} value={startField} onChange={setStartField} />
        <ChoiceField label="结束列（可省略）" options={columns} value={endField} onChange={setEndField} />
      </div>
      {(error || rowsError) && <div role="alert" className="text-red-600">{rowsError || error}</div>}
      <button type="button" onClick={add} className="rounded border border-blue-200 px-2 py-1 text-blue-700">添加合并区域</button>
      {ranges.map((region, i) => <div key={i} className="flex items-start gap-2 text-[11px] text-slate-600">
        <span className="min-w-0 flex-1 break-all">{region && typeof region === 'object' && 'rowIds' in region && Array.isArray(region.rowIds) && 'fields' in region && Array.isArray(region.fields) ? `${region.rowIds.join('、')} × ${region.fields.join('、')}` : '无效区域'}</span>
        <button type="button" className="text-red-600" onClick={() => onChange({ cellMerges: ranges.filter((_, j) => i !== j) })}>移除</button>
      </div>)}
    </div>}
  </details>;
}

export function TableInspector({ node, table, onChange }: { node: ProtoNode; table?: DBTableSchema; onChange: (patch: Patch) => void }) {
  const { props } = node;
  const stored = usePageStore(s => table ? s.tableRows[table.id] : undefined);
  const sample = !props.table;
  const fields = table ? table.columns.map(c => ({ dataIndex: c.name, title: columnLabel(c) })) : sample ? SAMPLE_FIELDS : [];
  const columns = Array.isArray(props.columns) && props.columns.length ? props.columns.filter((c): c is Record<string, PropValue> => !!c && typeof c === 'object' && 'dataIndex' in c).map(c => ({ dataIndex: String(c.dataIndex), title: String(c.title) }))
    : defaultTableColumns(table);
  const mode = props.rowMode ?? 'flat';
  const detail = Array.isArray(props.detailFields) ? props.detailFields : columns.map(c => c.dataIndex);
  return <section className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
    <h3 className="text-xs font-semibold text-slate-800">表格结构</h3>
    <div className="grid grid-cols-3 gap-1">
      {Object.entries({ flat: '普通表格', tree: '树形表格', expandable: '展开详情' }).map(([key, title]) => <button type="button" key={key} aria-pressed={mode === key}
        className={`rounded border px-1 py-1.5 text-[11px] ${mode === key ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}
        onClick={() => onChange({ rowMode: key === 'flat' ? undefined : key, ...(sample && key === 'tree' && !props.parentField ? { parentField: 'parentId' } : {}) })}>{title}</button>)}
    </div>
    {mode === 'tree' && <>
      <ChoiceField label="节点字段" value={String(props.treeKeyField ?? 'id')} options={[{ dataIndex: 'id', title: 'id · 工程记录 ID' }, ...fields.filter(c => c.dataIndex !== 'id')]} onChange={v => onChange({ treeKeyField: v || undefined })} />
      <ChoiceField label="父节点字段" value={String(props.parentField ?? '')} options={fields} onChange={v => onChange({ parentField: v || undefined })} />
      <p className="text-[11px] text-slate-500">父值须与节点字段的值和类型一致，根节点填写 null。分页按根节点计数。</p>
    </>}
    {mode === 'expandable' && <fieldset><legend className="text-[11px] font-medium text-slate-700">展开后展示的字段</legend>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{fields.map(c => <label key={c.dataIndex} className="inline-flex items-center gap-1 text-[11px]">
        <input type="checkbox" checked={detail.includes(c.dataIndex)} disabled={detail.length === 1 && detail[0] === c.dataIndex} onChange={e => {
          const next = e.target.checked ? [...detail, c.dataIndex] : detail.filter(f => f !== c.dataIndex);
          onChange({ detailFields: next });
        }} />{c.title}</label>)}</div>
      <button type="button" className="mt-1 text-[11px] text-blue-700" onClick={() => onChange({ detailFields: undefined })}>使用展示列</button>
    </fieldset>}
    {mode !== 'flat' && <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={props.defaultExpandAll === true} onChange={e => onChange({ defaultExpandAll: e.target.checked || undefined })} />默认展开全部</label>}
    <MergePanel node={node} rows={sample ? SAMPLE_ROWS : stored ?? []} columns={columns} onChange={onChange} />
  </section>;
}
