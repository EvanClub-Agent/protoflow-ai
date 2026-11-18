import { AlertCircle, Check, Loader2, Save } from 'lucide-react';
import { useProjectSaveStore } from '../services/projectAutosave';
import { flushProjectChanges } from '../services/projectStorage';
import { useProtoStore } from '../store/useProtoStore';

const save = () => { void flushProjectChanges().catch(() => {}); };

export function ProjectSaveStatus() {
  const { status, savedAt } = useProjectSaveStore();
  if (status === 'idle') return null;
  const text = { saved: '已自动保存', pending: '等待保存', saving: '保存中…', error: '保存失败 · 点击重试' }[status];
  const Icon = status === 'saved' ? Check : status === 'saving' ? Loader2 : status === 'error' ? AlertCircle : Save;
  const tip = `${text}（⌘S / Ctrl+S）${savedAt ? ` · ${new Date(savedAt).toLocaleTimeString()}` : ''}`;
  return (
    <div className="relative group flex items-center">
      <button
        type="button"
        onClick={save}
        disabled={status === 'saving'}
        aria-label={text}
        className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
          status === 'error'
            ? 'bg-rose-50 text-rose-600 ring-1 ring-rose-200'
            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
        }`}
      >
        <Icon
          size={14}
          className={
            status === 'saving'
              ? 'animate-spin text-blue-600'
              : status === 'saved'
              ? 'text-emerald-600'
              : ''
          }
        />
        <span role="status" className="sr-only">
          {text}
        </span>
      </button>
      <div
        role="tooltip"
        className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
      >
        <span className="relative z-10 text-xs font-medium tracking-tight">{tip}</span>
      </div>
    </div>
  );
}

export function ProjectSaveNotice() {
  const { status, error } = useProjectSaveStore();
  if (!error) return null;
  return <div role="alert" className="fixed bottom-4 left-1/2 z-[200] flex w-[min(640px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 rounded-xl border border-rose-200 bg-white p-4 text-sm shadow-xl">
    <AlertCircle size={20} className="shrink-0 text-rose-600" />
    <div className="min-w-0 flex-1"><p className="font-semibold text-rose-700">修改尚未保存，请保持应用打开</p><p className="mt-1 break-words text-xs text-slate-600">{error}</p></div>
    <button type="button" onClick={() => useProtoStore.getState().setBundleModalOpen(true)} className="shrink-0 text-xs text-slate-600">导出备份</button>
    <button type="button" onClick={save} disabled={status === 'saving'} className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs text-white disabled:opacity-50">重试保存</button>
  </div>;
}
