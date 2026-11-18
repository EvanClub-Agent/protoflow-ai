import React, { useState } from 'react';
import type { PropValue } from '../types';
import { materialOptions } from '../registry/antdOptions';

interface Props {
  label: string;
  description?: string;
  value: PropValue | undefined;
  optionsKind?: 'flat' | 'tree' | 'autocomplete';
  onChange: (value: PropValue | undefined) => void;
}

/** Keep incomplete JSON local; only commit complete, valid structured values. */
export const StructuredPropEditor: React.FC<Props> = ({ label, description, value, optionsKind, onChange }) => {
  const [draft, setDraft] = useState(() => value === undefined ? '' : JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  const apply = () => {
    try {
      const next = draft.trim() ? JSON.parse(draft) as PropValue : undefined;
      if (optionsKind && next !== undefined) {
        const options = materialOptions(next, optionsKind === 'tree');
        if (optionsKind === 'autocomplete' && options.some((o) => typeof o.value !== 'string')) throw new Error('自动补全的 value 必须为字符串');
      }
      onChange(next);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'JSON 格式无效');
    }
  };
  return <div className="space-y-1.5">
    <label className="block text-[11px] font-semibold text-slate-700">{label}</label>
    {description && <p className="text-[10px] leading-relaxed text-slate-500">{description}</p>}
    <textarea aria-label={label} rows={8} spellCheck={false} value={draft} onChange={(e) => { setDraft(e.target.value); setError(''); }} className="w-full rounded border border-slate-200 bg-white p-2 font-mono text-[11px]" />
    {error && <p role="alert" className="text-[11px] text-red-600">{error}</p>}
    <button type="button" onClick={apply} className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700">应用配置</button>
  </div>;
};
