import React, { useEffect, useMemo, useState } from 'react';
import { BookOpenText, ChevronLeft, X } from 'lucide-react';
import type { PublishedNote, ReadablePublishedSnapshot } from '../services/publishedSnapshot';
import { NOTE_ASSET_SCHEME, NOTE_PRIORITY_OPTIONS, NOTE_STATUS_OPTIONS, noteAssetDataUrl } from '../proto/notes';
import { sanitizeNoteHtml } from '../proto/noteHtmlSanitize';

const statusMeta = (id: string) => NOTE_STATUS_OPTIONS.find((s) => s.id === id);
const priorityMeta = (id?: string) => NOTE_PRIORITY_OPTIONS.find((p) => p.id === id);

/** Read-only project notes the author chose to share ("需求说明"), scoped to the current page. */
export function PublishedProjectNotes({
  snapshot,
  activePageId,
  onNavigate,
}: {
  snapshot: ReadablePublishedSnapshot;
  activePageId: string;
  onNavigate: (pageId: string) => void;
}) {
  const notes = useMemo<PublishedNote[]>(
    () => (snapshot.formatVersion === 4 ? snapshot.notes ?? [] : []),
    [snapshot]
  );
  const pageNotes = useMemo(() => notes.filter((n) => n.pageIds.includes(activePageId)), [notes, activePageId]);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'page' | 'all'>('page');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setSelectedId(null), [activePageId]);
  if (!notes.length) return null;

  const list = scope === 'page' ? pageNotes : notes;
  const selected = notes.find((n) => n.noteId === selectedId) ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setScope(pageNotes.length ? 'page' : 'all');
          setOpen(true);
        }}
        aria-label={`查看需求说明（本页 ${pageNotes.length} 篇）`}
        className="flex items-center gap-1.5 rounded-lg border border-blue-200/90 bg-blue-50/90 hover:bg-blue-100/80 px-2.5 py-1.5 text-xs font-medium text-blue-800 shrink-0 cursor-pointer transition shadow-2xs"
      >
        <BookOpenText size={13.5} className="text-blue-600" />
        <span>需求说明 ({pageNotes.length})</span>
      </button>
      {open && (
        <aside
          role="dialog"
          aria-label="需求说明（只读）"
          className="fixed right-0 top-12 bottom-0 z-40 flex w-[min(560px,100vw)] flex-col border-l border-slate-200 bg-white shadow-2xl"
        >
          <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              {selected && (
                <button type="button" aria-label="返回列表" onClick={() => setSelectedId(null)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 cursor-pointer">
                  <ChevronLeft size={15} />
                </button>
              )}
              <BookOpenText size={15} className="shrink-0 text-blue-600" />
              <span className="truncate text-sm font-semibold text-slate-900">{selected ? selected.title : '需求说明'}</span>
              <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] text-slate-500">只读</span>
            </div>
            <button type="button" aria-label="关闭需求说明" onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer">
              <X size={15} />
            </button>
          </header>
          {selected ? (
            <PublishedNoteBody note={selected} snapshot={snapshot} onNavigate={(id) => { onNavigate(id); setSelectedId(null); }} />
          ) : (
            <>
              <div className="flex gap-1 border-b border-slate-100 px-4 py-2 text-xs" role="tablist">
                {(['page', 'all'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={scope === s}
                    onClick={() => setScope(s)}
                    className={`rounded-md px-2.5 py-1 font-medium cursor-pointer ${scope === s ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'}`}
                  >
                    {s === 'page' ? `本页相关 (${pageNotes.length})` : `全部 (${notes.length})`}
                  </button>
                ))}
              </div>
              <ul className="flex-1 space-y-2 overflow-y-auto p-4">
                {list.length === 0 && <li className="py-10 text-center text-xs text-slate-400">当前页面没有关联的需求说明，可切换到「全部」查看。</li>}
                {list.map((note) => {
                  const status = statusMeta(note.status);
                  const priority = priorityMeta(note.priority);
                  return (
                    <li key={note.noteId}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(note.noteId)}
                        className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-300 hover:shadow-xs cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <span>{note.icon}</span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{note.title}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                          {status && <span className={`rounded border px-1.5 py-px ${status.badgeClass}`}>{status.label}</span>}
                          {priority && <span className={`rounded border px-1.5 py-px ${priority.badgeClass}`}>{priority.id}</span>}
                          {note.meetingDate && <span className="text-slate-400">📅 {note.meetingDate}</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </aside>
      )}
    </>
  );
}

function PublishedNoteBody({
  note,
  snapshot,
  onNavigate,
}: {
  note: PublishedNote;
  snapshot: ReadablePublishedSnapshot;
  onNavigate: (pageId: string) => void;
}) {
  const pageIds = useMemo(() => new Set(snapshot.pages.map((p) => p.pageId)), [snapshot]);
  // Sanitized again on the reader side: the share payload is never trusted as markup.
  const html = useMemo(() => {
    const assets = snapshot.formatVersion === 4 ? snapshot.noteAssets ?? {} : {};
    return sanitizeNoteHtml(note.html, {
      resolveImage: (src) => {
        if (!src.startsWith(NOTE_ASSET_SCHEME)) return null;
        const asset = assets[src.slice(NOTE_ASSET_SCHEME.length)];
        return asset ? noteAssetDataUrl(asset) : null;
      },
      keepPageLink: (pageId) => pageIds.has(pageId),
    });
  }, [note, snapshot, pageIds]);
  const status = statusMeta(note.status);
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        {status && <span className={`rounded border px-1.5 py-px ${status.badgeClass}`}>{status.label}</span>}
        {note.priority && <span className="rounded border border-slate-200 px-1.5 py-px">{note.priority}</span>}
        {note.meetingDate && <span>沟通日期 {note.meetingDate}</span>}
        <span>更新于 {note.updatedAt.slice(0, 16).replace('T', ' ')}</span>
      </div>
      <div
        className="pf-notion-editor"
        onClick={(event) => {
          const anchor = (event.target as HTMLElement).closest('a');
          const href = anchor?.getAttribute('href') ?? '';
          if (href.startsWith('#pf-page:')) {
            event.preventDefault();
            onNavigate(href.slice('#pf-page:'.length));
          }
        }}
      >
        <div className="ProseMirror" data-testid="published-note-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
