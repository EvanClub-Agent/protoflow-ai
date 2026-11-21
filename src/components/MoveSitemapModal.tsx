import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpLeft, Check, Folder, FolderInput, Search, X } from 'lucide-react';
import { folderOptions, prepareSitemapMove, sitemapItemLocation, type SitemapLayout, type SitemapMoveTarget } from '../proto/sitemap';
import { useI18n } from '../i18n';

export function MoveSitemapModal({ layout, target, onMove, onClose }: {
  layout: SitemapLayout;
  target: SitemapMoveTarget;
  onMove: (parentFolderId: string | null) => void;
  onClose: () => void;
}) {
  const { locale, tr, td } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const current = sitemapItemLocation(layout, target);
  const [selectedId, setSelectedId] = useState(current.parentFolderId);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const folders = useMemo(() => folderOptions(layout.designerFolders, layout.sitemapOverrides, layout.sitemapBase), [layout.designerFolders, layout.sitemapOverrides, layout.sitemapBase]);
  const choices = useMemo(() => {
    const candidates = folders.filter(folder => !folder.deprecated).map(folder => ({ id: folder.id as string | null, path: folder.path }));
    if (target.kind === 'folder') candidates.unshift({ id: null, path: tr('顶层目录（无上级）', 'Top-level (No Parent)') });
    // Exclude descendants, archived folders and conflicting sibling names using
    // the same validation as the actual move, including mixed built-in/custom trees.
    return candidates.filter(candidate => {
      try { prepareSitemapMove(layout, target, candidate.id); return true; } catch { return false; }
    });
  }, [layout, target, folders, locale, tr]);
  const parent = folders.find(folder => folder.id === current.parentFolderId);
  const canPromote = parent !== undefined && choices.some(choice => choice.id === parent.parentFolderId);
  const pathOf = (id: string | null) => id === null ? tr('顶层目录', 'Top-level') : folders.find(folder => folder.id === id)!.path;
  const visible = choices.filter(choice => choice.path.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    const element = dialog.current;
    element?.showModal(); searchInput.current?.focus();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="move-menu-title" className="m-auto w-[540px] max-w-[92vw] max-h-[90vh] rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-900/40">
    <form onSubmit={event => {
      event.preventDefault(); setError('');
      try { onMove(selectedId); } catch (e) { setError(e instanceof Error ? td(e.message) : tr('移动失败，请重试', 'Move failed, please retry')); }
    }} className="flex max-h-[88vh] flex-col text-sm">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
        <h2 id="move-menu-title" className="flex min-w-0 items-center gap-2 font-semibold text-slate-900"><FolderInput size={18} className="shrink-0 text-blue-600" /><span className="truncate">{tr(`移动「${current.title}」`, `Move "${current.title}"`)}</span></h2>
        <button type="button" aria-label={tr('关闭移动菜单', 'Close move dialog')} onClick={onClose} className="ml-3 rounded p-1 text-slate-500 hover:bg-slate-200"><X size={16} /></button>
      </div>
      <div className="space-y-3 px-5 pt-4">
        <p className="text-xs leading-5 text-slate-500">{target.kind === 'folder' ? tr('选择新的上级目录，目录中的页面和子目录将一起移动。', 'Select a new parent folder. All pages and subfolders inside will move together.') : tr('选择页面要放入的目录，页面内容和便签会完整保留。', 'Select the destination folder. Page content and spec pins will remain intact.')}</p>
        <div className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-3 text-xs"><span className="min-w-0 break-words leading-5 text-slate-600">{tr(`当前位置：${pathOf(current.parentFolderId)}`, `Current location: ${pathOf(current.parentFolderId)}`)}</span>
          {canPromote && <button type="button" onClick={() => { setSelectedId(parent.parentFolderId); setQuery(''); setError(''); }} className="flex shrink-0 items-center gap-1 py-0.5 text-blue-600 hover:underline"><ArrowUpLeft size={14} />{tr('提升一级', 'Move Up One Level')}</button>}
        </div>
        <label className="relative block"><Search size={15} className="absolute left-3 top-2.5 text-slate-400" /><input ref={searchInput} aria-label={tr('搜索目标目录', 'Search destination folder')} value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('搜索目标目录…', 'Search destination folder…')} className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-600" /></label>
        <p className="text-xs font-medium text-slate-700">{tr('移动到', 'Move to')}</p>
      </div>
      <div role="group" aria-label={tr('目标目录', 'Destination Folders')} className="mx-5 my-2 min-h-0 overflow-y-auto rounded-lg border border-slate-200 p-1" style={{ maxHeight: 280 }}>
        {visible.map(choice => <button key={choice.id === null ? 'root' : `folder-${choice.id}`} type="button" aria-pressed={selectedId === choice.id} aria-label={tr(`选择${choice.path}`, `Select ${choice.path}`)} onClick={() => { setSelectedId(choice.id); setError(''); }} className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs ${selectedId === choice.id ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}>
          <Folder size={16} className="shrink-0 text-amber-500" /><span className="min-w-0 flex-1 break-words leading-5">{choice.path}</span>
          {choice.id === current.parentFolderId && <span className="shrink-0 text-[10px] text-slate-400">{tr('当前位置', 'Current')}</span>}{selectedId === choice.id && <Check size={15} className="shrink-0" />}
        </button>)}
        {!visible.length && <p className="p-6 text-center text-xs text-slate-500">{tr('没有可选目录，请尝试其他名称', 'No matching folders — try another name')}</p>}
      </div>
      <div className="space-y-3 px-5 pb-5 pt-2">
        <p className="break-words text-xs leading-5 text-slate-500">{tr('目标位置：', 'Destination: ')}<span className="font-medium text-slate-800">{pathOf(selectedId)} / {current.title}</span></p>
        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-slate-700">{tr('取消', 'Cancel')}</button><button type="submit" disabled={selectedId === current.parentFolderId} className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">{tr('确认移动', 'Confirm Move')}</button></div>
      </div>
    </form>
  </dialog>;
}
