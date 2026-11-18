import React, { useEffect, useRef, useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import type { FolderOption } from '../proto/sitemap';

export function NewFolderModal({ folders, initialParentId, onCreate, onClose }: {
  folders: FolderOption[];
  initialParentId: string | null;
  onCreate: (title: string, parentFolderId: string | null) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState(initialParentId);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    nameInput.current?.focus();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="new-folder-title" className="m-auto w-[420px] max-w-[90vw] rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-900/40">
    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
      <h2 id="new-folder-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900"><FolderPlus size={18} className="text-amber-500" />新建菜单目录</h2>
      <button type="button" aria-label="关闭新建目录" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-200"><X size={16} /></button>
    </div>
    <form className="space-y-4 p-5 text-sm" onSubmit={event => {
      event.preventDefault(); setError('');
      try { onCreate(title, parentId); } catch (e) { setError(e instanceof Error ? e.message : '创建目录失败'); }
    }}>
      <p className="text-xs leading-5 text-slate-500">使用目录组织页面，也可以在目录下继续添加子目录。</p>
      <label className="block space-y-1.5"><span className="font-medium text-slate-700">目录名称</span><input ref={nameInput} autoFocus required maxLength={60} value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：客户管理" className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-600" /></label>
      <label className="block space-y-1.5"><span className="font-medium text-slate-700">上级目录</span><select value={parentId === null ? '' : parentId} onChange={e => setParentId(e.target.value === '' ? null : e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
        <option value="">无上级（顶层目录）</option>
        {folders.filter(folder => !folder.deprecated).map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
      </select></label>
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-slate-700">取消</button><button type="submit" disabled={!title.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">创建目录</button></div>
    </form>
  </dialog>;
}
