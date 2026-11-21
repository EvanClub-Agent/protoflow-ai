import React, { useMemo, useState } from 'react';
import { Pin, X } from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { groupStickiesByPage, sitemapPageOrder, stickyAlreadyInNote, stickySummaryHtml } from '../proto/notesStickies';
import { useI18n } from '../i18n';

/**
 * Pulls canvas component stickies back into notes: either inserted into the open note
 * (`mode: 'insert'`) or turned into a new review checklist note (`mode: 'create'`).
 */
export function StickySummaryModal({
  mode,
  preferredPageIds = [],
  noteContent,
  onInsert,
  onCreate,
  onClose,
}: {
  mode: 'insert' | 'create';
  /** Pages linked to the current note; preselected when they have stickies. */
  preferredPageIds?: string[];
  noteContent?: string;
  onInsert?: (html: string, count: number) => void;
  onCreate?: (pageIds: string[], onlyActive: boolean) => void;
  onClose: () => void;
}) {
  const { tr } = useI18n();
  const stickies = useProtoStore((s) => s.stickyNotes);
  const layout = usePageStore();
  const order = useMemo(() => sitemapPageOrder(layout), [layout]);
  const [onlyActive, setOnlyActive] = useState(true);
  const [skipExisting, setSkipExisting] = useState(true);
  const allGroups = useMemo(() => groupStickiesByPage(stickies, order, { onlyActive }), [stickies, order, onlyActive]);
  const [selected, setSelected] = useState<Set<string>>(() => {
    const withStickies = new Set(groupStickiesByPage(stickies, order).map((g) => g.pageId));
    const preferred = preferredPageIds.filter((id) => withStickies.has(id));
    return new Set(preferred.length ? preferred : withStickies);
  });

  const chosen = allGroups
    .filter((g) => selected.has(g.pageId))
    .map((g) => {
      const fresh = mode === 'insert' && skipExisting && noteContent ? g.stickies.filter((s) => !stickyAlreadyInNote(s, noteContent)) : g.stickies;
      return { ...g, stickies: fresh, existing: g.stickies.length - fresh.length };
    });
  const newCount = chosen.reduce((n, g) => n + g.stickies.length, 0);
  const existingCount = chosen.reduce((n, g) => n + g.existing, 0);
  const toggle = (pageId: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });

  return (
    <div className="pf-notes-surface fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-xs">
      <div role="dialog" aria-modal="true" aria-label={tr('汇总画布批注', 'Summarize canvas annotations')} className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white text-xs shadow-2xl">
        <header className="flex items-center justify-between border-b border-amber-200/80 bg-amber-50/90 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold text-amber-950 min-w-0">
            <Pin size={15} className="text-amber-600 shrink-0" />
            <span className="truncate">
              {mode === 'insert'
                ? tr('汇总关联页面的画布批注到本笔记', 'Summarize Linked Page Annotations into Note')
                : tr('从画布批注生成评审修改清单', 'Generate Review Checklist from Canvas Annotations')}
            </span>
          </div>
          <button type="button" aria-label={tr('关闭', 'Close')} onClick={onClose} className="text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer">
            <X size={15} />
          </button>
        </header>
        <div className="space-y-3 p-4">
          {allGroups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-slate-500">
              {onlyActive
                ? tr('项目中还没有启用中的画布批注。', 'No active canvas annotations in this project yet. ')
                : tr('项目中还没有画布批注。', 'No canvas annotations in this project yet. ')}
              {tr('在原型画布上为组件添加便签后再来汇总。', 'Pin sticky notes onto components on the prototype canvas first.')}
            </p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto" role="group" aria-label={tr('选择要汇总的页面', 'Select pages to summarize')}>
              {allGroups.map((g) => {
                const info = chosen.find((c) => c.pageId === g.pageId);
                return (
                  <label key={g.pageId} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 min-w-0">
                    <input type="checkbox" checked={selected.has(g.pageId)} onChange={() => toggle(g.pageId)} aria-label={tr(`汇总 ${g.pageTitle}`, `Summarize ${g.pageTitle}`)} className="shrink-0" />
                    <span className="flex-1 min-w-0 truncate font-medium text-slate-800">📄 {g.pageTitle}</span>
                    {preferredPageIds.includes(g.pageId) && <span className="rounded border border-blue-200 bg-blue-50 px-1 text-[10px] text-blue-700 shrink-0">{tr('已关联', 'Linked')}</span>}
                    <span className="text-slate-500 tabular-nums shrink-0">{tr(`${g.stickies.length} 条`, `${g.stickies.length}`)}</span>
                    {info && info.existing > 0 && <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">{tr(`${info.existing} 条已在笔记中`, `${info.existing} already in note`)}</span>}
                  </label>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-slate-600">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
              {tr('仅启用的批注', 'Active annotations only')}
            </label>
            {mode === 'insert' && (
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
                {tr('跳过笔记中已有的批注', 'Skip annotations already in note')}
              </label>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            {tr(
              '将按「页面 → 组件」生成批注表格，启用中的批注同时生成待办，汇入全局待办。',
              'Generates an annotation table grouped by Page → Widget; active annotations also create to-do items synced to Global To-Dos.'
            )}
            {mode === 'insert' && existingCount > 0 && tr(` 已跳过 ${existingCount} 条重复内容。`, ` Skipped ${existingCount} duplicate item(s).`)}
          </p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-slate-700 hover:bg-slate-50 cursor-pointer">
            {tr('取消', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={newCount === 0}
            onClick={() => {
              if (mode === 'insert') onInsert?.(stickySummaryHtml(chosen.filter((g) => g.stickies.length)), newCount);
              else onCreate?.(chosen.map((g) => g.pageId), onlyActive);
            }}
            className="rounded-lg bg-amber-500 px-4 py-1.5 font-semibold text-white hover:bg-amber-600 disabled:opacity-40 tabular-nums cursor-pointer"
          >
            {mode === 'insert'
              ? tr(`插入 ${newCount} 条批注`, `Insert ${newCount} Annotation(s)`)
              : tr(`生成清单（${newCount} 条）`, `Create Checklist (${newCount})`)}
          </button>
        </footer>
      </div>
    </div>
  );
}
