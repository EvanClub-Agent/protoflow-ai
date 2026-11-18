import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CheckSquare, FileText, Filter, Search, X } from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { buildSitemap } from '../proto/sitemap';
import { flattenSitemap } from '../proto/mindmaps';
import {
  NOTE_PRIORITY_OPTIONS,
  NOTE_STATUS_OPTIONS,
  type NotePriority,
  type NoteRequirementStatus,
} from '../proto/notes';
import {
  filterLedgerRows,
  ledgerFacets,
  ledgerInsights,
  noteLedgerRows,
  sortLedgerRows,
  type NoteLedgerFilter,
  type NoteLedgerRow,
  type NoteLedgerSort,
  type NoteLedgerSortKey,
} from '../proto/notesLedger';
import { openNoteNode, updateNoteMeta, type NoteMetaPatch } from '../services/notesWorkspace';

export type NotesOverviewMode = 'cards' | 'table' | 'kanban';

const modeKey = (projectId: string) => `pf-notes-overview:${projectId}`;

/** The overview layout is remembered per project (UI preference, not project data). */
export function useNotesOverviewMode(projectId: string) {
  const read = (): NotesOverviewMode => {
    try {
      const value = window.localStorage.getItem(modeKey(projectId));
      return value === 'table' || value === 'kanban' ? value : 'cards';
    } catch {
      return 'cards';
    }
  };
  const [mode, setMode] = useState<NotesOverviewMode>(read);
  useEffect(() => setMode(read()), [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (next: NotesOverviewMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(modeKey(projectId), next);
    } catch {
      /* preference only */
    }
  };
  return [mode, update] as const;
}

const statusMeta = (id: NoteRequirementStatus) => NOTE_STATUS_OPTIONS.find((s) => s.id === id)!;
const priorityMeta = (id?: NotePriority) => NOTE_PRIORITY_OPTIONS.find((p) => p.id === id);

const toneClass: Record<'rose' | 'amber' | 'blue' | 'slate', string> = {
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  slate: 'bg-slate-50 text-slate-700 border-slate-200',
};

const isFilterEmpty = (f: NoteLedgerFilter) =>
  !f.query?.trim() && !f.statuses?.length && !f.priorities?.length && !f.stakeholder && !f.tag && !f.notImplemented && !f.hasOpenTasks;

export function NotesLedger({
  projectId,
  folderId,
  mode,
}: {
  projectId: string;
  folderId: string | null;
  mode: 'table' | 'kanban';
}) {
  const data = useProtoStore((s) => s.projectNotes);
  const layout = usePageStore();
  const [filter, setFilter] = useState<NoteLedgerFilter>({});
  const [sort, setSort] = useState<NoteLedgerSort>({ key: 'updatedAt', direction: 'desc' });
  const [error, setError] = useState('');

  const rows = useMemo(() => noteLedgerRows(data, layout, folderId), [data, layout, folderId]);
  const visible = useMemo(() => sortLedgerRows(filterLedgerRows(rows, filter), sort), [rows, filter, sort]);
  const insights = useMemo(() => ledgerInsights(rows), [rows]);
  const facets = useMemo(() => ledgerFacets(rows), [rows]);
  const pageTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of flattenSitemap(
      buildSitemap(layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase)
    )) {
      if (item.type === 'page' && item.pageId !== undefined) map.set(item.pageId, item.title);
    }
    return map;
  }, [layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase]);

  const patch = (noteId: string, change: NoteMetaPatch) => {
    try {
      updateNoteMeta(projectId, noteId, change);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '属性未保存');
    }
  };

  const toggleIn = <T,>(list: T[] | undefined, value: T) =>
    list?.includes(value) ? list.filter((v) => v !== value) : [...(list ?? []), value];

  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center text-xs text-slate-500">
        这里还没有笔记。用上方模板新建一篇后，即可在台账中统一管理状态、优先级与对接人。
      </div>
    );
  }

  return (
    <div className="space-y-3" aria-label="需求台账">
      {/* Insight chips: one click reproduces the answer as a filter. */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="台账快捷统计">
        {insights.map((insight) => {
          const active = JSON.stringify(filter) === JSON.stringify(insight.filter);
          return (
            <button
              key={insight.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(active ? {} : insight.filter)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium cursor-pointer transition ${
                toneClass[insight.tone]
              } ${active ? 'ring-2 ring-blue-500' : 'hover:shadow-xs'}`}
            >
              <span>{insight.label}</span>
              <span className="font-bold tabular-nums">{insight.count}</span>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px]">
        <Filter size={12} className="text-slate-400" />
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            aria-label="搜索台账"
            value={filter.query ?? ''}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
            placeholder="标题 / 正文 / 对接人"
            className="w-40 rounded-md border border-slate-200 bg-white py-1 pl-6 pr-2 text-[11px] text-slate-800 focus:outline-none focus:border-blue-600"
          />
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="按状态筛选">
          {NOTE_STATUS_OPTIONS.map((s) => {
            const active = filter.statuses?.includes(s.id) ?? false;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter((f) => ({ ...f, statuses: toggleIn(f.statuses, s.id) }))}
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 cursor-pointer ${
                  active ? s.badgeClass : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${s.dotClass}`} />
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="按优先级筛选">
          {[...NOTE_PRIORITY_OPTIONS.map((p) => p.id), 'none' as const].map((p) => {
            const active = filter.priorities?.includes(p) ?? false;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter((f) => ({ ...f, priorities: toggleIn(f.priorities, p) }))}
                className={`rounded-md border px-1.5 py-0.5 cursor-pointer ${
                  active
                    ? priorityMeta(p === 'none' ? undefined : p)?.badgeClass ?? 'bg-slate-100 text-slate-700 border-slate-300'
                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {p === 'none' ? '未设' : p}
              </button>
            );
          })}
        </div>
        {facets.stakeholders.length > 0 && (
          <select
            aria-label="按对接人筛选"
            value={filter.stakeholder ?? ''}
            onChange={(e) => setFilter((f) => ({ ...f, stakeholder: e.target.value || undefined }))}
            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700"
          >
            <option value="">全部对接人</option>
            {facets.stakeholders.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        {facets.tags.length > 0 && (
          <select
            aria-label="按标签筛选"
            value={filter.tag ?? ''}
            onChange={(e) => setFilter((f) => ({ ...f, tag: e.target.value || undefined }))}
            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700"
          >
            <option value="">全部标签</option>
            {facets.tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto text-slate-500">
          显示 {visible.length} / {rows.length} 篇
        </span>
        {!isFilterEmpty(filter) && (
          <button
            type="button"
            onClick={() => setFilter({})}
            className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X size={11} />
            清除筛选
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      {mode === 'table' ? (
        <LedgerTable
          projectId={projectId}
          rows={visible}
          sort={sort}
          onSort={setSort}
          onPatch={patch}
          pageTitles={pageTitles}
        />
      ) : (
        <LedgerKanban projectId={projectId} rows={visible} onPatch={patch} pageTitles={pageTitles} />
      )}
    </div>
  );
}

const COLUMNS: { key: NoteLedgerSortKey; label: string; className?: string }[] = [
  { key: 'title', label: '笔记', className: 'min-w-[220px]' },
  { key: 'status', label: '状态' },
  { key: 'priority', label: '优先级' },
  { key: 'stakeholder', label: '对接人' },
  { key: 'meetingDate', label: '沟通日期' },
  { key: 'relatedPages', label: '关联页面' },
  { key: 'openTasks', label: '未完成待办' },
  { key: 'updatedAt', label: '更新时间' },
];

function LedgerTable({
  projectId,
  rows,
  sort,
  onSort,
  onPatch,
  pageTitles,
}: {
  projectId: string;
  rows: NoteLedgerRow[];
  sort: NoteLedgerSort;
  onSort: (sort: NoteLedgerSort) => void;
  onPatch: (noteId: string, change: NoteMetaPatch) => void;
  pageTitles: Map<string, string>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-xs" aria-label="需求台账表">
        <thead className="bg-slate-50 text-[11px] text-slate-500">
          <tr>
            {COLUMNS.map((col) => {
              const active = sort.key === col.key;
              const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`border-b border-slate-200 px-3 py-2 font-medium whitespace-nowrap ${col.className ?? ''}`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      onSort({
                        key: col.key,
                        direction: active && sort.direction === 'desc' ? 'asc' : active ? 'desc' : col.key === 'title' ? 'asc' : 'desc',
                      })
                    }
                    className={`inline-flex items-center gap-1 cursor-pointer hover:text-slate-800 ${active ? 'text-slate-800' : ''}`}
                  >
                    {col.label}
                    <Icon size={11} className={active ? 'text-blue-600' : 'text-slate-300'} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-slate-400">
                没有符合筛选条件的笔记
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.noteId} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => openNoteNode(projectId, row.noteId)}
                    className="flex min-w-0 items-center gap-1.5 text-left cursor-pointer group"
                  >
                    <span className="shrink-0">{row.icon}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900 group-hover:text-blue-600">{row.title}</span>
                      {row.folderPath && <span className="block truncate text-[10px] text-slate-400">{row.folderPath}</span>}
                    </span>
                  </button>
                </td>
                <td className="px-3 py-2">
                  <select
                    aria-label={`${row.title} 的状态`}
                    value={row.status}
                    onChange={(e) => onPatch(row.noteId, { status: e.target.value as NoteRequirementStatus })}
                    className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${statusMeta(row.status).badgeClass}`}
                  >
                    {NOTE_STATUS_OPTIONS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    aria-label={`${row.title} 的优先级`}
                    value={row.priority ?? ''}
                    onChange={(e) => onPatch(row.noteId, { priority: (e.target.value || undefined) as NotePriority | undefined })}
                    className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
                      priorityMeta(row.priority)?.badgeClass ?? 'bg-white text-slate-400 border-slate-200'
                    }`}
                  >
                    <option value="">未设</option>
                    {NOTE_PRIORITY_OPTIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <StakeholderCell
                    key={`${row.noteId}:${row.stakeholder ?? ''}`}
                    label={row.title}
                    value={row.stakeholder ?? ''}
                    onCommit={(value) => onPatch(row.noteId, { stakeholder: value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="date"
                    aria-label={`${row.title} 的沟通日期`}
                    value={row.meetingDate ?? ''}
                    onChange={(e) => onPatch(row.noteId, { meetingDate: e.target.value })}
                    className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700"
                  />
                </td>
                <td className="px-3 py-2 text-slate-600 tabular-nums">
                  <span
                    title={row.relatedPageIds.map((id) => pageTitles.get(id) ?? id).join('、') || '未关联页面'}
                    className="inline-flex items-center gap-1"
                  >
                    <FileText size={11} className="text-slate-400" />
                    {row.relatedPageIds.length}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {row.totalTasks === 0 ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <span className={`inline-flex items-center gap-1 ${row.openTasks ? 'text-amber-700' : 'text-emerald-700'}`}>
                      <CheckSquare size={11} />
                      {row.openTasks} / {row.totalTasks}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[11px] text-slate-500">
                  {row.updatedAt.slice(0, 16).replace('T', ' ')}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function StakeholderCell({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <input
      type="text"
      aria-label={`${label} 的对接人`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(value);
      }}
      placeholder="未填写"
      className="w-24 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[11px] text-slate-800 placeholder:text-slate-400 hover:border-slate-200 focus:outline-none focus:border-blue-600"
    />
  );
}

const DRAG_TYPE = 'application/x-pf-note';

function LedgerKanban({
  projectId,
  rows,
  onPatch,
  pageTitles,
}: {
  projectId: string;
  rows: NoteLedgerRow[];
  onPatch: (noteId: string, change: NoteMetaPatch) => void;
  pageTitles: Map<string, string>;
}) {
  const [dropTarget, setDropTarget] = useState<NoteRequirementStatus | null>(null);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="需求状态看板">
      {NOTE_STATUS_OPTIONS.map((column) => {
        const cards = rows.filter((row) => row.status === column.id);
        return (
          <section
            key={column.id}
            aria-label={`${column.label}（${cards.length}）`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropTarget(column.id);
            }}
            onDragLeave={() => setDropTarget((t) => (t === column.id ? null : t))}
            onDrop={(e) => {
              const noteId = e.dataTransfer.getData(DRAG_TYPE);
              setDropTarget(null);
              if (noteId) {
                e.preventDefault();
                onPatch(noteId, { status: column.id });
              }
            }}
            className={`flex min-h-[220px] flex-col rounded-xl border bg-slate-50/60 p-2 transition ${
              dropTarget === column.id ? 'border-blue-400 ring-2 ring-blue-200/70' : 'border-slate-200'
            }`}
          >
            <header className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${column.dotClass}`} />
                {column.label}
              </span>
              <span className="rounded-md bg-white px-1.5 text-slate-500 tabular-nums border border-slate-200">{cards.length}</span>
            </header>
            <div className="flex-1 space-y-2">
              {cards.length === 0 && (
                <p className="px-2 py-6 text-center text-[11px] text-slate-400">拖拽卡片到这里切换状态</p>
              )}
              {cards.map((row) => {
                const priority = priorityMeta(row.priority);
                return (
                  <article
                    key={row.noteId}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, row.noteId);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    className="cursor-grab rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-2xs hover:border-blue-300 active:cursor-grabbing"
                  >
                    <button
                      type="button"
                      onClick={() => openNoteNode(projectId, row.noteId)}
                      className="flex w-full items-start gap-1.5 text-left cursor-pointer group"
                    >
                      <span className="shrink-0">{row.icon}</span>
                      <span className="min-w-0 flex-1 font-medium text-slate-900 group-hover:text-blue-600 line-clamp-2">
                        {row.title}
                      </span>
                    </button>
                    {row.folderPath && <p className="mt-0.5 truncate pl-5 text-[10px] text-slate-400">{row.folderPath}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                      {priority && (
                        <span className={`rounded border px-1 py-px font-medium ${priority.badgeClass}`}>{priority.id}</span>
                      )}
                      {row.stakeholder && <span className="truncate">👤 {row.stakeholder}</span>}
                      {row.meetingDate && <span>📅 {row.meetingDate}</span>}
                      {row.totalTasks > 0 && (
                        <span className={row.openTasks ? 'text-amber-700' : 'text-emerald-700'}>
                          ☑ {row.totalTasks - row.openTasks}/{row.totalTasks}
                        </span>
                      )}
                      {row.relatedPageIds.length > 0 && (
                        <span title={row.relatedPageIds.map((id) => pageTitles.get(id) ?? id).join('、')}>
                          📄 {row.relatedPageIds.length}
                        </span>
                      )}
                    </div>
                    {/* Keyboard / non-drag alternative for changing the lane. */}
                    <select
                      aria-label={`移动「${row.title}」到其他状态`}
                      value={row.status}
                      onChange={(e) => onPatch(row.noteId, { status: e.target.value as NoteRequirementStatus })}
                      className="mt-2 w-full rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600"
                    >
                      {NOTE_STATUS_OPTIONS.map((s) => (
                        <option key={s.id} value={s.id}>
                          移到：{s.label}
                        </option>
                      ))}
                    </select>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
