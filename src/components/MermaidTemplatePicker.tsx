import { useEffect, useRef, useState } from 'react';
import { LayoutTemplate, Sparkles } from 'lucide-react';
import { MERMAID_DIAGRAM_TEMPLATES, mermaidTemplate } from '../services/mermaidCatalog';
import { useI18n } from '../i18n';

export function MermaidTemplatePicker({ source, onApply }: { source: string; onApply: (source: string) => void }) {
  const { tr, td } = useI18n();
  const [type, setType] = useState('flowchart');
  const [pending, setPending] = useState<string | null>(null);
  const apply = () => {
    const code = mermaidTemplate(type).code;
    if (source.trim()) setPending(code);
    else onApply(code);
  };
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/70 px-3.5 py-1.5 text-[11px]">
      <label className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-slate-600">
        <LayoutTemplate size={13} className="shrink-0 text-teal-600" />
        <span className="shrink-0">{tr('模板类型', 'Template')}</span>
        <select
          aria-label={tr('手工制作图表类型', 'Diagram template type')}
          value={type}
          onChange={event => setType(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-slate-200/90 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-2xs outline-none focus:border-teal-500 cursor-pointer transition"
        >
          {MERMAID_DIAGRAM_TEMPLATES.map(item => (
            <option key={item.id} value={item.id}>
              {td(item.label)} ({item.id})
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={apply}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100 whitespace-nowrap cursor-pointer transition shadow-2xs"
      >
        <Sparkles size={11} className="shrink-0" />
        {tr('使用模板', 'Apply Template')}
      </button>
      {pending !== null && (
        <ReplaceDiagramDialog
          code={pending}
          onClose={() => setPending(null)}
          onConfirm={() => {
            onApply(pending);
            setPending(null);
          }}
        />
      )}
    </div>
  );
}

function ReplaceDiagramDialog({ code, onClose, onConfirm }: { code: string; onClose: () => void; onConfirm: () => void }) {
  const { tr } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      aria-label={tr('使用图表模板', 'Apply diagram template')}
      className="m-auto w-[480px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-2xl backdrop:bg-slate-900/40"
    >
      <h2 className="text-base font-semibold text-slate-900">{tr('用模板替换当前源码？', 'Replace current source with template?')}</h2>
      <p className="mt-1.5 text-xs leading-6 text-slate-500">
        {tr(
          '模板会替换当前菜单中的图表。可先导出源码保留当前内容，或在新菜单中使用模板。',
          'Applying a template replaces the current diagram source. Export the source first if you want to keep it, or create a new mindmap item.'
        )}
      </p>
      <pre className="my-4 max-h-56 overflow-auto rounded-xl border border-slate-200/80 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-800">
        {code}
      </pre>
      <div className="flex justify-end gap-2 text-xs">
        <button
          autoFocus
          type="button"
          onClick={onClose}
          className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3.5 py-2 font-medium text-slate-700 cursor-pointer transition"
        >
          {tr('保留当前内容', 'Keep Current')}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-xl bg-teal-600 hover:bg-teal-700 px-3.5 py-2 font-medium text-white cursor-pointer transition shadow-2xs"
        >
          {tr('替换为模板', 'Replace with Template')}
        </button>
      </div>
    </dialog>
  );
}
