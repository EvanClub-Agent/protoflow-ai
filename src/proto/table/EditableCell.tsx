import React, { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { AntdFieldControl } from '../registry/AntdFieldControl';
import { materialOptions } from '../registry/antdOptions';
import type { TableColumn } from './model';
import { useI18n } from '../../i18n';

interface Props {
  column: TableColumn;
  value: unknown;
  required: boolean;
  readOnly: boolean;
  onSave: (value: unknown) => void;
  children: React.ReactNode;
}
export function EditableCell({ column, value, required, readOnly, onSave, children }: Props) {
  const { tr } = useI18n();
  const [draft, setDraft] = useState<{ original: unknown; value: unknown } | null>(null);
  const [error, setError] = useState('');
  const label = column.title;
  const options = column.editor === 'select' ? materialOptions(column.editorOptions) : [];
  const display = options.find(o => o.value === value)?.label ?? children;
  if (readOnly) return <>{display} <Pencil aria-label={tr('预览时可编辑', 'Editable in preview')} className="inline h-3 w-3 text-slate-400" /></>;
  if (!draft) return <button type="button" aria-label={tr(`编辑${label}`, `Edit ${label}`)} className="inline-flex max-w-full items-center gap-1.5 text-inherit cursor-pointer hover:text-blue-600"
    onClick={e => { e.stopPropagation(); setError(''); setDraft({ original: value, value }); }}>
    <span className="truncate">{display}</span><Pencil className="h-3 w-3 shrink-0 text-slate-400" />
  </button>;
  const expectedType = column.editor === 'number' ? 'number' : column.editor === 'switch' ? 'boolean' : 'string';
  const incompatible = column.editor !== 'select' && value != null && value !== '' && typeof value !== expectedType;
  const save = () => {
    if (incompatible) return;
    if (!Object.is(value, draft.original)) { setError(tr('该值已变更，请取消并重新编辑', 'Value changed externally; cancel and re-edit')); return; }
    if (required && (draft.value == null || draft.value === '')) { setError(tr('此字段为必填项', 'This field is required')); return; }
    try {
      if (!Object.is(draft.value, draft.original)) onSave(draft.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    setDraft(null);
  };
  return <div className="inline-flex min-w-40 max-w-full flex-col gap-1 align-middle" onClick={e => e.stopPropagation()} onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); }
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !e.nativeEvent.isComposing && ['input', 'number'].includes(column.editor!)) { e.preventDefault(); save(); }
  }}>
    {incompatible ? <span role="alert" className="whitespace-normal text-xs text-red-600">{tr(`当前值与${label}的编辑器类型不符，请调整列配置。`, `Current value does not match editor type for ${label}; adjust column config.`)}</span> : <AntdFieldControl def={{ type: column.editor!, options: column.editorOptions }} value={draft.value}
      onChange={next => { setDraft({ ...draft, value: next }); setError(''); }} disabled={false} size="small" placeholder={label} error={error} />}
    <span className="flex items-center gap-2 text-[11px]">
      <button type="button" onClick={save} disabled={incompatible} aria-label={tr(`保存${label}`, `Save ${label}`)} className="inline-flex items-center text-blue-600"><Check size={12} />{tr('保存', 'Save')}</button>
      <button type="button" onClick={() => setDraft(null)} aria-label={tr(`取消编辑${label}`, `Cancel editing ${label}`)} className="inline-flex items-center text-slate-500"><X size={12} />{tr('取消', 'Cancel')}</button>
    </span>
    {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
  </div>;
}
