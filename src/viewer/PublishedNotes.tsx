import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pin, X } from 'lucide-react';
import type { PublishedPage, PublishedStickyNote } from '../services/publishedSnapshot';
import { NodeAnnotationProvider } from '../proto/renderer/NodeView';
import { walk } from '../proto/dsl/tree';
import type { ProtoNode } from '../proto/types';

const NotesContext = createContext<{ count: number; open: () => void } | null>(null);

export function PublishedNotesButton() {
  const notes = useContext(NotesContext);
  if (!notes) return null;
  return (
    <button
      type="button"
      onClick={notes.open}
      aria-label={`查看本页便签（${notes.count} 条）`}
      className="flex items-center gap-1.5 rounded-lg border border-amber-200/90 bg-amber-50/90 hover:bg-amber-100/80 px-2.5 py-1.5 text-xs font-medium text-amber-900 shrink-0 cursor-pointer transition shadow-2xs"
    >
      <Pin size={13.5} className="text-amber-600" />
      <span>便签 ({notes.count})</span>
    </button>
  );
}

function NoteDialog({ notes, page, onClose }: { notes: PublishedStickyNote[]; page?: PublishedPage; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const regions = useMemo(() => {
    const ids = new Set<string>();
    if (page) walk(page.doc.root, node => ids.add(node.pfId));
    return ids;
  }, [page]);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      aria-labelledby="published-notes-title"
      className="pf-paper m-auto w-[560px] max-w-[94vw] max-h-[85dvh] rounded-2xl border border-amber-200/90 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-[2px]"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-amber-200/80 bg-amber-50/95 backdrop-blur-xs px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-200/90 flex items-center justify-center shrink-0">
            <Pin size={16} className="text-amber-700" />
          </div>
          <div>
            <h2 id="published-notes-title" className="text-sm font-bold text-slate-900">
              需求便签 · {notes.length} 条
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">{page?.title} · 发布时的需求说明</p>
          </div>
        </div>
        <button
          type="button"
          aria-label="关闭便签"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-amber-100/80 hover:text-slate-800 cursor-pointer transition"
        >
          <X size={16} />
        </button>
      </header>
      <div className="space-y-3 p-5">
        {notes.length === 0 && (
          <p className="py-8 text-center text-xs text-slate-400">本页暂无已发布便签。</p>
        )}
        {notes.map(note => (
          <article key={note.id} className="rounded-xl border border-slate-200/90 bg-slate-50/40 p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-amber-100 border border-amber-200/80 px-2 py-0.5 font-semibold text-amber-900">
                便签 #{note.index}
              </span>
              <span className="font-semibold text-slate-800">{note.targetWidgetName || '未命名区域'}</span>
              {!note.active && (
                <span className="rounded-md bg-slate-200/70 px-1.5 py-0.5 text-[11px] text-slate-500">已停用</span>
              )}
            </div>
            {!regions.has(note.targetWidgetId) && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200/60 rounded-lg px-2.5 py-1.5">
                原区域已不在当前发布页面中，保留便签内容供查看。
              </p>
            )}
            <p className="whitespace-pre-wrap break-words text-xs sm:text-sm leading-6 text-slate-700">{note.text}</p>
          </article>
        ))}
      </div>
    </dialog>
  );
}

/** Every association is (pageId, pfId). Identical pfIds on different pages
 * must never display one another's notes. This provider exposes no mutations. */
export function PublishedNotesProvider({ page, notes, children }: { page?: PublishedPage; notes: PublishedStickyNote[]; children: React.ReactNode }) {
  const [opened, setOpened] = useState<PublishedStickyNote[] | null>(null);
  const currentNotes = useMemo(() => page ? notes.filter(note => note.pageId === page.pageId) : [], [page, notes]);
  const byRegion = useMemo(() => {
    const result = new Map<string, PublishedStickyNote[]>();
    for (const note of currentNotes) {
      const group = result.get(note.targetWidgetId);
      if (group) group.push(note); else result.set(note.targetWidgetId, [note]);
    }
    return result;
  }, [currentNotes]);
  const annotate = useCallback((node: ProtoNode, pageId: string) => {
    if (pageId !== page?.pageId) return null;
    const group = byRegion.get(node.pfId);
    if (!group?.length) return null;
    const position = node.type === 'Modal' || node.type === 'Drawer' ? 'top-2 right-10' : '-top-2.5 right-1.5';
    return <button key={`note-${node.pfId}`} type="button" aria-label={`查看${group[0].targetWidgetName || '此区域'}便签（${group.length} 条）`} title={`查看${group[0].targetWidgetName || '此区域'}便签（${group.length} 条）`} onClick={event => { event.stopPropagation(); setOpened(group); }} className={`absolute ${position} z-30 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100/95 px-1.5 py-0.5 text-[10px] font-bold tabular-nums leading-none text-amber-950 shadow-2xs hover:bg-amber-200`}><Pin size={11} />{group.length}</button>;
  }, [byRegion, page?.pageId]);
  return <NotesContext.Provider value={{ count: currentNotes.length, open: () => setOpened(currentNotes) }}>
    <NodeAnnotationProvider value={annotate}>{children}</NodeAnnotationProvider>
    {opened && <NoteDialog notes={opened} page={page} onClose={() => setOpened(null)} />}
  </NotesContext.Provider>;
}
