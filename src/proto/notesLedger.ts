import {
  NOTE_PRIORITY_OPTIONS,
  NOTE_STATUS_OPTIONS,
  noteDescendants,
  noteHtmlToPlainText,
  relatedPagesResolver,
  type NotePriority,
  type NoteRequirementStatus,
  type NoteWorkspace,
} from './notes';
import type { SitemapLayout } from './sitemap';
import { tr } from '../i18n/runtime';

/** One row of the requirement ledger (table / kanban). Folders are not rows. */
export interface NoteLedgerRow {
  noteId: string;
  title: string;
  icon: string;
  /** Folder path without the note title; empty at the root. */
  folderPath: string;
  status: NoteRequirementStatus;
  priority?: NotePriority;
  stakeholder?: string;
  meetingDate?: string;
  updatedAt: string;
  tags: string[];
  pinned: boolean;
  shareable: boolean;
  relatedPageIds: string[];
  openTasks: number;
  totalTasks: number;
  /** Lower-cased title + body + stakeholder + tags, for search. */
  searchText: string;
}

export function noteTaskCounts(html: string): { total: number; open: number } {
  const items = html.match(/<li\b[^>]*data-type="taskItem"[^>]*>/gi) ?? [];
  const done = items.filter((tag) => /data-checked="true"/i.test(tag)).length;
  return { total: items.length, open: items.length - done };
}

/** Builds ledger rows, optionally limited to the notes inside one folder (recursively). */
export function noteLedgerRows(
  data: NoteWorkspace,
  layout: SitemapLayout,
  folderId: string | null = null
): NoteLedgerRow[] {
  const resolve = relatedPagesResolver(data, layout);
  const scope = folderId === null ? null : noteDescendants(data, folderId);
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const folderPath = (parentId: string | null): string => {
    const parts: string[] = [];
    for (let id = parentId; id !== null; ) {
      const parent = byId.get(id);
      if (!parent) break;
      parts.unshift(parent.title);
      id = parent.parentId;
    }
    return parts.join(' / ');
  };
  const rows: NoteLedgerRow[] = [];
  for (const node of data.nodes) {
    if (node.kind !== 'note' || (scope && !scope.has(node.id))) continue;
    const tasks = noteTaskCounts(node.content);
    rows.push({
      noteId: node.id,
      title: node.title,
      icon: node.icon,
      folderPath: folderPath(node.parentId),
      status: node.status ?? 'draft',
      ...(node.priority ? { priority: node.priority } : {}),
      ...(node.stakeholder ? { stakeholder: node.stakeholder } : {}),
      ...(node.meetingDate ? { meetingDate: node.meetingDate } : {}),
      updatedAt: node.updatedAt,
      tags: node.tags,
      pinned: node.pinned,
      shareable: node.shareable === true,
      relatedPageIds: resolve(node.id).relatedPageIds,
      openTasks: tasks.open,
      totalTasks: tasks.total,
      searchText: [node.title, node.stakeholder ?? '', node.tags.join(' '), noteHtmlToPlainText(node.content)]
        .join('\n')
        .toLowerCase(),
    });
  }
  return rows;
}

export interface NoteLedgerFilter {
  query?: string;
  statuses?: NoteRequirementStatus[];
  /** `'none'` matches notes without a priority. */
  priorities?: (NotePriority | 'none')[];
  stakeholder?: string;
  tag?: string;
  /** Only notes not yet in the "implemented" state. */
  notImplemented?: boolean;
  /** Only notes with open to-dos. */
  hasOpenTasks?: boolean;
}

export function filterLedgerRows(rows: NoteLedgerRow[], filter: NoteLedgerFilter): NoteLedgerRow[] {
  const query = filter.query?.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (!query || row.searchText.includes(query)) &&
      (!filter.statuses?.length || filter.statuses.includes(row.status)) &&
      (!filter.priorities?.length || filter.priorities.includes(row.priority ?? 'none')) &&
      (!filter.stakeholder || row.stakeholder === filter.stakeholder) &&
      (!filter.tag || row.tags.includes(filter.tag)) &&
      (!filter.notImplemented || row.status !== 'implemented') &&
      (!filter.hasOpenTasks || row.openTasks > 0)
  );
}

export type NoteLedgerSortKey =
  | 'title'
  | 'status'
  | 'priority'
  | 'stakeholder'
  | 'meetingDate'
  | 'relatedPages'
  | 'openTasks'
  | 'updatedAt';

export interface NoteLedgerSort {
  key: NoteLedgerSortKey;
  direction: 'asc' | 'desc';
}

const STATUS_ORDER = new Map(NOTE_STATUS_OPTIONS.map((s, i) => [s.id, i]));
const PRIORITY_ORDER = new Map(NOTE_PRIORITY_OPTIONS.map((p, i) => [p.id, i]));

/**
 * Stable sort. Empty values (no priority, no stakeholder, no date) always go last regardless
 * of direction; ties fall back to the most recently updated note.
 */
export function sortLedgerRows(rows: NoteLedgerRow[], sort: NoteLedgerSort): NoteLedgerRow[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const value = (row: NoteLedgerRow): string | number | undefined => {
    switch (sort.key) {
      case 'title':
        return row.title;
      case 'status':
        return STATUS_ORDER.get(row.status);
      case 'priority':
        return row.priority ? PRIORITY_ORDER.get(row.priority) : undefined;
      case 'stakeholder':
        return row.stakeholder;
      case 'meetingDate':
        return row.meetingDate;
      case 'relatedPages':
        return row.relatedPageIds.length;
      case 'openTasks':
        return row.openTasks;
      case 'updatedAt':
        return row.updatedAt;
    }
  };
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      if (a.v === undefined && b.v !== undefined) return 1;
      if (b.v === undefined && a.v !== undefined) return -1;
      if (a.v !== undefined && b.v !== undefined && a.v !== b.v) {
        const cmp =
          typeof a.v === 'number' && typeof b.v === 'number'
            ? a.v - b.v
            : String(a.v).localeCompare(String(b.v), 'zh-Hans-CN');
        if (cmp !== 0) return cmp * sign;
      }
      if (a.row.updatedAt !== b.row.updatedAt) return a.row.updatedAt < b.row.updatedAt ? 1 : -1;
      return a.index - b.index;
    })
    .map((item) => item.row);
}

export interface NoteLedgerInsight {
  id: string;
  label: string;
  count: number;
  filter: NoteLedgerFilter;
  tone: 'rose' | 'amber' | 'blue' | 'slate';
}

/**
 * Ready-made answers to the questions a PM gets asked ("how many P0 are still waiting for the
 * customer?", "which of Mr. Zhang's requests are not in the prototype yet?"). Each insight
 * carries the filter that reproduces it.
 */
export function ledgerInsights(rows: NoteLedgerRow[]): NoteLedgerInsight[] {
  const count = (filter: NoteLedgerFilter) => filterLedgerRows(rows, filter).length;
  const presets: Omit<NoteLedgerInsight, 'count'>[] = [
    { id: 'p0-pending', label: tr('P0 待客户确认', 'P0 Awaiting Sign-Off'), filter: { priorities: ['P0'], statuses: ['pending_confirm'] }, tone: 'rose' },
    { id: 'pending', label: tr('全部待客户确认', 'All Awaiting Sign-Off'), filter: { statuses: ['pending_confirm'] }, tone: 'amber' },
    { id: 'confirmed', label: tr('已确认待落地', 'Confirmed & Ready'), filter: { statuses: ['confirmed'] }, tone: 'blue' },
    { id: 'open-tasks', label: tr('有未完成待办', 'Open Action Items'), filter: { hasOpenTasks: true }, tone: 'slate' },
  ];
  const insights: NoteLedgerInsight[] = presets.map((insight) => ({ ...insight, count: count(insight.filter) }));

  const byStakeholder = new Map<string, number>();
  for (const row of rows) {
    if (row.stakeholder && row.status !== 'implemented') {
      byStakeholder.set(row.stakeholder, (byStakeholder.get(row.stakeholder) ?? 0) + 1);
    }
  }
  [...byStakeholder.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .slice(0, 3)
    .forEach(([stakeholder, n]) =>
      insights.push({
        id: `stakeholder:${stakeholder}`,
        label: tr(`${stakeholder} · 未落地`, `${stakeholder} · Pending`),
        count: n,
        filter: { stakeholder, notImplemented: true },
        tone: 'slate',
      })
    );
  return insights;
}

/** Distinct stakeholders and tags present in the rows, for the filter dropdowns. */
export function ledgerFacets(rows: NoteLedgerRow[]) {
  const stakeholders = [...new Set(rows.flatMap((r) => (r.stakeholder ? [r.stakeholder] : [])))].sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN')
  );
  const tags = [...new Set(rows.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  return { stakeholders, tags };
}
