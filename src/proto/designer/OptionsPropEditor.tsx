import React, { useState } from 'react';
import type { PropValue } from '../types';
import { materialOptions } from '../registry/antdOptions';
import { StructuredPropEditor } from './StructuredPropEditor';
import { useI18n } from '../../i18n';

type Row = { label: string; value: string; numeric: boolean; disabled: boolean };
interface Props { value: PropValue | undefined; onChange: (value: PropValue) => void; stringsOnly?: boolean }

const OptionRows: React.FC<Props & { initial: Row[] }> = ({ initial, onChange, stringsOnly }) => {
  const { tr, td } = useI18n();
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState('');
  const update = (index: number, patch: Partial<Row>) => setRows((items) => items.map((row, i) => i === index ? { ...row, ...patch } : row));
  const apply = () => {
    try {
      const options = rows.map((row, i) => {
        if (row.value === '') throw new Error(tr(`第 ${i + 1} 项请填写实际值`, `Enter a value for option #${i + 1}`));
        const value = row.numeric ? Number(row.value) : row.value;
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(tr(`第 ${i + 1} 项请输入有效数字`, `Enter a valid number for option #${i + 1}`));
        return { label: row.label, value, disabled: row.disabled };
      });
      materialOptions(options);
      onChange(options);
      setError('');
    } catch (err) { setError(err instanceof Error ? td(err.message) : tr('选项无效', 'Invalid options')); }
  };
  return <div className="space-y-2">
    <div className="flex items-center justify-between"><label className="text-[11px] font-semibold text-slate-700">{tr('选项数据', 'Options')}</label>
      <button type="button" className="text-[11px] text-blue-600" onClick={() => setRows([...rows, { label: '', value: '', numeric: false, disabled: false }])}>{tr('＋ 新增选项', '＋ Add Option')}</button>
    </div>
    <p className="text-[10px] text-slate-500">{tr('显示文字用于界面，实际值用于保存和查询。', 'Display label is shown in UI; value is stored and queried.')}</p>
    {rows.map((row, i) => <div key={i} className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2">
      <input aria-label={tr(`选项${i + 1}显示文字`, `Option ${i + 1} label`)} placeholder={tr('显示文字', 'Display label')} value={row.label} onChange={(e) => update(i, { label: e.target.value })} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs" />
      <div className="flex gap-1">
        <input aria-label={tr(`选项${i + 1}实际值`, `Option ${i + 1} value`)} placeholder={tr('实际值（必填）', 'Value (required)')} value={row.value} onChange={(e) => update(i, { value: e.target.value })} className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs" />
        {!stringsOnly && <select aria-label={tr(`选项${i + 1}值类型`, `Option ${i + 1} value type`)} value={row.numeric ? 'number' : 'string'} onChange={(e) => update(i, { numeric: e.target.value === 'number' })} className="rounded border border-slate-200 bg-white text-[11px]"><option value="string">{tr('文本', 'String')}</option><option value="number">{tr('数字', 'Number')}</option></select>}
      </div>
      <div className="flex justify-between text-[11px]"><label className="flex items-center gap-1"><input type="checkbox" checked={row.disabled} onChange={(e) => update(i, { disabled: e.target.checked })} />{tr('禁用', 'Disabled')}</label><button type="button" className="text-red-500" onClick={() => setRows(rows.filter((_, at) => at !== i))}>{tr('删除', 'Delete')}</button></div>
    </div>)}
    {error && <p role="alert" className="text-[11px] text-red-600">{error}</p>}
    <button type="button" onClick={apply} className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700">{tr('应用选项', 'Apply Options')}</button>
  </div>;
};

export const OptionsPropEditor: React.FC<Props> = (props) => {
  const { tr, td } = useI18n();
  try {
    const options = materialOptions(props.value);
    if (props.stringsOnly && options.some((o) => typeof o.value !== 'string')) throw new Error(tr('自动补全仅接受字符串值', 'AutoComplete only accepts string values'));
    return <OptionRows {...props} initial={options.map((o) => ({ label: o.label, value: String(o.value), numeric: typeof o.value === 'number', disabled: o.disabled === true }))} />;
  } catch (err) {
    // Invalid imported options remain visible and repairable; never replace their values.
    return <div><p role="alert" className="text-[11px] text-red-600">{err instanceof Error ? td(err.message) : tr('选项无效', 'Invalid options')}</p><StructuredPropEditor label={tr('修复选项数据', 'Repair Options JSON')} value={props.value} optionsKind={props.stringsOnly ? 'autocomplete' : 'flat'} onChange={(value) => { if (value !== undefined) props.onChange(value); }} /></div>;
  }
};
