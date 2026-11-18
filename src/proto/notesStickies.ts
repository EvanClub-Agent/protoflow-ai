import type { StickyNoteRule } from '../store/useProtoStore';
import { noteHtmlToPlainText } from './notes';
import { buildSitemap, type SitemapLayout } from './sitemap';
import { flattenSitemap } from './mindmaps';

/** Menu pages in sitemap order (used to order summaries the way the PM sees the menu). */
export function sitemapPageOrder(layout: SitemapLayout): { pageId: string; title: string }[] {
  return flattenSitemap(
    buildSitemap(layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase)
  ).flatMap((item) => (item.type === 'page' && item.pageId !== undefined ? [{ pageId: item.pageId, title: item.title }] : []));
}

export interface StickyPageGroup {
  pageId: string;
  pageTitle: string;
  stickies: StickyNoteRule[];
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const normalize = (text: string) => text.replace(/\s+/g, '').toLowerCase();

/**
 * Groups component stickies by page in sitemap order (then by sticky number). Pages without
 * matching stickies are omitted; stickies on pages missing from `pageOrder` come last.
 */
export function groupStickiesByPage(
  stickies: StickyNoteRule[],
  pageOrder: { pageId: string; title: string }[],
  { pageIds, onlyActive = false }: { pageIds?: string[]; onlyActive?: boolean } = {}
): StickyPageGroup[] {
  const wanted = pageIds ? new Set(pageIds) : null;
  const titles = new Map(pageOrder.map((p, i) => [p.pageId, { title: p.title, order: i }]));
  const groups = new Map<string, StickyNoteRule[]>();
  for (const sticky of stickies) {
    if (wanted && !wanted.has(sticky.pageId)) continue;
    if (onlyActive && !sticky.active) continue;
    if (!sticky.text.trim()) continue;
    groups.set(sticky.pageId, [...(groups.get(sticky.pageId) ?? []), sticky]);
  }
  return [...groups.entries()]
    .map(([pageId, list]) => ({
      pageId,
      pageTitle: titles.get(pageId)?.title ?? pageId,
      stickies: [...list].sort((a, b) => a.index - b.index),
    }))
    .sort((a, b) => (titles.get(a.pageId)?.order ?? 1e9) - (titles.get(b.pageId)?.order ?? 1e9));
}

/** Whether the sticky's text already appears in the note (so re-syncing does not duplicate it). */
export function stickyAlreadyInNote(sticky: StickyNoteRule, noteHtml: string): boolean {
  const body = normalize(noteHtmlToPlainText(noteHtml));
  const text = normalize(sticky.text);
  return text.length > 0 && body.includes(text);
}

/**
 * Structured review list: per page a table (number, component, comment, state) followed by a
 * to-do list of the enabled comments so they show up in the global action items.
 */
export function stickySummaryHtml(groups: StickyPageGroup[], { heading }: { heading?: string } = {}): string {
  if (!groups.length) return '';
  const total = groups.reduce((n, g) => n + g.stickies.length, 0);
  const parts: string[] = [];
  if (heading) parts.push(`<h2>${escapeHtml(heading)}</h2>`);
  parts.push(`<p>共 ${groups.length} 个页面、${total} 条画布批注。</p>`);
  for (const group of groups) {
    parts.push(`<h3>📄 ${escapeHtml(group.pageTitle)}（${group.stickies.length} 条）</h3>`);
    const rows = group.stickies
      .map(
        (s) =>
          `<tr><td><p>#${s.index}</p></td><td><p>${escapeHtml(s.targetWidgetName || s.targetWidgetId)}</p></td><td><p>${escapeHtml(
            s.text.trim()
          )}</p></td><td><p>${s.active ? '启用' : '停用'}</p></td></tr>`
      )
      .join('');
    parts.push(
      `<table><tbody><tr><th><p>序号</p></th><th><p>组件</p></th><th><p>批注内容</p></th><th><p>状态</p></th></tr>${rows}</tbody></table>`
    );
    const todos = group.stickies.filter((s) => s.active);
    if (todos.length) {
      parts.push(
        `<ul data-type="taskList">${todos
          .map(
            (s) =>
              `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>【${escapeHtml(
                group.pageTitle
              )} · ${escapeHtml(s.targetWidgetName || s.targetWidgetId)}】${escapeHtml(s.text.trim())}</p></div></li>`
          )
          .join('')}</ul>`
      );
    }
  }
  return parts.join('');
}
