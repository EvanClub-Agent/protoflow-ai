import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, ChevronLeft, X } from 'lucide-react';
import type { PublishedNote, ReadablePublishedSnapshot } from '../services/publishedSnapshot';
import { NOTE_ASSET_SCHEME, NOTE_PRIORITY_OPTIONS, NOTE_STATUS_OPTIONS, noteAssetDataUrl } from '../proto/notes';
import { sanitizeNoteHtml } from '../proto/noteHtmlSanitize';
import { renderMermaidDiagram } from '../services/mindmapRenderer';
import { useI18n } from '../i18n';

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
  const { tr } = useI18n();
  const notes = useMemo<PublishedNote[]>(
    () => (snapshot.formatVersion === 4 || snapshot.formatVersion === 5 ? snapshot.notes ?? [] : []),
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
        aria-label={tr(`查看需求说明（本页 ${pageNotes.length} 篇）`, `View specs (${pageNotes.length} on this page)`)}
        className="flex items-center gap-1.5 rounded-lg border border-blue-200/90 bg-blue-50/90 hover:bg-blue-100/80 px-2.5 py-1.5 text-xs font-medium text-blue-800 shrink-0 cursor-pointer transition shadow-2xs"
      >
        <BookOpenText size={13.5} className="text-blue-600" />
        <span>{tr(`需求说明 (${pageNotes.length})`, `Specs (${pageNotes.length})`)}</span>
      </button>
      {open && (
        <aside
          role="dialog"
          aria-label={tr('需求说明（只读）', 'Specs (Read-only)')}
          className="fixed right-0 top-12 bottom-0 z-40 flex w-[min(560px,100vw)] flex-col border-l border-slate-200 bg-white shadow-2xl"
        >
          <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              {selected && (
                <button type="button" aria-label={tr('返回列表', 'Back to list')} onClick={() => setSelectedId(null)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 cursor-pointer shrink-0">
                  <ChevronLeft size={15} />
                </button>
              )}
              <BookOpenText size={15} className="shrink-0 text-blue-600" />
              <span className="truncate text-sm font-semibold text-slate-900">{selected ? selected.title : tr('需求说明', 'Specs')}</span>
              <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] text-slate-500">{tr('只读', 'Read-only')}</span>
            </div>
            <button type="button" aria-label={tr('关闭需求说明', 'Close specs')} onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer shrink-0">
              <X size={15} />
            </button>
          </header>
          {selected ? (
            <PublishedNoteBody
              note={selected}
              snapshot={snapshot}
              sharedNoteIds={new Set(notes.map((n) => n.noteId))}
              onSelectNote={(id) => setSelectedId(id)}
              onNavigate={(id) => {
                onNavigate(id);
                setSelectedId(null);
              }}
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-1 border-b border-slate-100 px-4 py-2 text-xs" role="tablist">
                {(['page', 'all'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={scope === s}
                    onClick={() => setScope(s)}
                    className={`rounded-md px-2.5 py-1 font-medium cursor-pointer ${scope === s ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'}`}
                  >
                    {s === 'page'
                      ? tr(`本页相关 (${pageNotes.length})`, `This Page (${pageNotes.length})`)
                      : tr(`全部 (${notes.length})`, `All (${notes.length})`)}
                  </button>
                ))}
              </div>
              <ul className="flex-1 space-y-2 overflow-y-auto p-4">
                {list.length === 0 && (
                  <li className="py-10 text-center text-xs text-slate-400">
                    {tr('当前页面没有关联的需求说明，可切换到「全部」查看。', 'No specs are linked to this page. Switch to "All" to browse all shared notes.')}
                  </li>
                )}
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
  sharedNoteIds,
  onSelectNote,
  onNavigate,
}: {
  note: PublishedNote;
  snapshot: ReadablePublishedSnapshot;
  sharedNoteIds: Set<string>;
  onSelectNote: (noteId: string) => void;
  onNavigate: (pageId: string) => void;
}) {
  const { tr } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const pageIds = useMemo(() => new Set(snapshot.pages.map((p) => p.pageId)), [snapshot]);
  // Sanitized again on the reader side: the share payload is never trusted as markup.
  const html = useMemo(() => {
    const assets = snapshot.formatVersion === 4 || snapshot.formatVersion === 5 ? snapshot.noteAssets ?? {} : {};
    return sanitizeNoteHtml(note.html, {
      resolveImage: (src) => {
        if (!src.startsWith(NOTE_ASSET_SCHEME)) return null;
        const asset = assets[src.slice(NOTE_ASSET_SCHEME.length)];
        return asset ? noteAssetDataUrl(asset) : null;
      },
      keepPageLink: (pageId) => pageIds.has(pageId),
      keepNoteLink: (noteId) => sharedNoteIds.has(noteId),
    });
  }, [note, snapshot, pageIds, sharedNoteIds]);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    let cancelled = false;
    const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
    const blocks = Array.from(root.querySelectorAll('pre > code.language-mermaid'));
    for (const codeEl of blocks) {
      const pre = codeEl.parentElement;
      const src = (codeEl.textContent ?? '').trim();
      if (!pre || !src) continue;
      void renderMermaidDiagram(src, dark).then(
        ({ svg }) => {
          if (cancelled || !pre.isConnected) return;
          const wrap = document.createElement('div');
          wrap.className = 'pf-note-mermaid-card my-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 overflow-x-auto';
          wrap.innerHTML = svg;
          pre.replaceWith(wrap);
        },
        () => {
          /* keep raw code block on syntax error */
        }
      );
    }
    return () => {
      cancelled = true;
    };
  }, [html]);

  const status = statusMeta(note.status);
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        {status && <span className={`rounded border px-1.5 py-px ${status.badgeClass}`}>{status.label}</span>}
        {note.priority && <span className="rounded border border-slate-200 px-1.5 py-px">{note.priority}</span>}
        {note.meetingDate && <span>{tr(`沟通日期 ${note.meetingDate}`, `Meeting date ${note.meetingDate}`)}</span>}
        <span>{tr(`更新于 ${note.updatedAt.slice(0, 16).replace('T', ' ')}`, `Updated ${note.updatedAt.slice(0, 16).replace('T', ' ')}`)}</span>
      </div>
      <div
        className="pf-notion-editor"
        onClick={(event) => {
          const anchor = (event.target as HTMLElement).closest('a');
          const href = anchor?.getAttribute('href') ?? '';
          if (href.startsWith('#pf-page:')) {
            event.preventDefault();
            onNavigate(href.slice('#pf-page:'.length));
          } else if (href.startsWith('#pf-note:')) {
            event.preventDefault();
            onSelectNote(href.slice('#pf-note:'.length));
          }
        }}
      >
        <div ref={bodyRef} className="ProseMirror" data-testid="published-note-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
