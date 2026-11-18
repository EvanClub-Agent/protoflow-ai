import React, { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';

export function DeleteConfirmation({ title, children, confirmLabel = '确认删除', disabled = false, onConfirm, onClose }: {
  title: string; children: React.ReactNode; confirmLabel?: string; disabled?: boolean;
  onConfirm: () => void | Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), busy = useRef(false);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current; element?.showModal(); cancel.current?.focus();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-labelledby="delete-confirmation-title" onCancel={event => {
    if (busy.current) event.preventDefault(); else onClose();
  }} className="m-auto w-[460px] max-w-[92vw] rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-900/40">
    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
      <h2 id="delete-confirmation-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Trash2 size={18} className="text-rose-600" />{title}</h2>
      <button type="button" aria-label="关闭删除确认" disabled={pending} onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50"><X size={16} /></button>
    </div>
    <div className="space-y-3 px-5 py-4 text-sm leading-6 text-slate-600">{children}{error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}</div>
    <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
      <button ref={cancel} type="button" disabled={pending} onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-xs text-slate-700 disabled:opacity-50">取消</button>
      <button type="button" disabled={disabled || pending} onClick={async () => {
        if (busy.current) return;
        busy.current = true; setPending(true); setError('');
        try { await onConfirm(); onClose(); }
        catch (e) { setError(e instanceof Error ? e.message : '删除失败，请重试'); }
        finally { busy.current = false; setPending(false); }
      }} className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50">{pending ? '正在删除…' : confirmLabel}</button>
    </div>
  </dialog>;
}
