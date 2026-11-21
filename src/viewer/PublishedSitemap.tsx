import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Layers, LayoutGrid, Search } from 'lucide-react';
import type { ReadablePublishedSnapshot } from '../services/publishedSnapshot';
import type { PublishedMenuItem } from '../services/publishedSitemap';
import { useI18n } from '../i18n';

function filterMenuItems(items: PublishedMenuItem[], query: string): PublishedMenuItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const result: PublishedMenuItem[] = [];
  for (const item of items) {
    if (item.type === 'folder') {
      const matchedChildren = filterMenuItems(item.children, q);
      if (item.title.toLowerCase().includes(q) || matchedChildren.length > 0) {
        result.push({ ...item, children: item.title.toLowerCase().includes(q) && matchedChildren.length === 0 ? item.children : matchedChildren });
      }
    } else if (item.title.toLowerCase().includes(q)) {
      result.push(item);
    }
  }
  return result;
}

export function PublishedSitemap({ snapshot, activeId, expanded, onToggle, onSelect }: {
  snapshot: ReadablePublishedSnapshot;
  activeId: string;
  expanded: Record<string, boolean>;
  onToggle: (id: string, open: boolean) => void;
  onSelect: (pageId: string) => void;
}) {
  const { tr } = useI18n();
  const [keyword, setKeyword] = useState('');
  const isSearching = keyword.trim().length > 0;
  const filteredSitemap = useMemo(
    () => (snapshot.formatVersion !== 2 ? filterMenuItems(snapshot.sitemap, keyword) : []),
    [snapshot, keyword],
  );
  const filteredFlatPages = useMemo(
    () =>
      snapshot.formatVersion !== 2
        ? []
        : snapshot.pages.filter(p => !isSearching || p.title.toLowerCase().includes(keyword.trim().toLowerCase())),
    [snapshot, keyword, isSearching],
  );

  const render = (item: PublishedMenuItem, depth: number): React.ReactNode => {
    if (item.type === 'folder') {
      const open = isSearching ? true : (expanded[item.id] ?? !item.deprecated);
      return (
        <li key={item.id}>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => onToggle(item.id, !open)}
            title={item.title}
            style={{ paddingLeft: 10 + depth * 14 }}
            className="flex w-full items-center gap-1.5 rounded-lg py-2 pr-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100/80 transition cursor-pointer"
          >
            {open ? <ChevronDown size={13} className="shrink-0 text-slate-400" /> : <ChevronRight size={13} className="shrink-0 text-slate-400" />}
            {open ? <FolderOpen size={14} className="shrink-0 text-amber-500" /> : <Folder size={14} className="shrink-0 text-amber-500" />}
            <span className={`min-w-0 break-words ${item.deprecated ? 'text-slate-400' : ''}`}>{item.title}</span>
          </button>
          {open && (
            <ul className="space-y-0.5">
              {item.children.map(child => render(child, depth + 1))}
              {!item.children.length && (
                <li style={{ paddingLeft: 38 + depth * 14 }} className="py-1.5 text-[11px] text-slate-400">
                  {tr('暂无页面', 'No pages yet')}
                </li>
              )}
            </ul>
          )}
        </li>
      );
    }
    const active = item.pageId !== null && activeId === item.pageId;
    return (
      <li key={item.id}>
        <button
          type="button"
          disabled={item.pageId === null}
          aria-current={active ? 'page' : undefined}
          onClick={() => {
            if (item.pageId !== null) onSelect(item.pageId);
          }}
          title={item.pageId === null ? `${item.title} · ${tr('无可预览内容', 'No preview available')}` : item.title}
          style={{ paddingLeft: 12 + depth * 14 }}
          className={`my-0.5 flex w-full items-center gap-2 rounded-lg py-2 pr-2.5 text-left text-xs transition cursor-pointer disabled:cursor-default ${
            active
              ? 'bg-blue-50/80 text-blue-700 font-semibold ring-1 ring-blue-200/70 shadow-2xs'
              : item.deprecated
                ? 'text-slate-400'
                : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
          }`}
        >
          {item.type === 'doc' ? (
            <FileText size={13.5} className={`shrink-0 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
          ) : (
            <LayoutGrid size={13.5} className={`shrink-0 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
          )}
          <span className={`min-w-0 break-words ${item.deprecated ? 'line-through' : ''}`}>{item.title}</span>
        </button>
      </li>
    );
  };

  return (
    <nav
      aria-label={tr('原型页面目录', 'Prototype page directory')}
      className="max-h-[38vh] shrink-0 flex flex-col overflow-hidden border-b border-slate-200/90 bg-white sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r"
    >
      <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <Layers size={13.5} className="shrink-0 text-blue-600" />
          <p className="truncate text-xs font-bold text-slate-700 tracking-tight">{tr('菜单目录', 'Sitemap')}</p>
        </div>
        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 tabular-nums">
          {tr(`${snapshot.pages.length} 页`, `${snapshot.pages.length} ${snapshot.pages.length === 1 ? 'page' : 'pages'}`)}
        </span>
      </div>

      <div className="px-2.5 pt-2.5 pb-1.5 shrink-0">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder={tr('搜索菜单或页面...', 'Search menus or pages...')}
            aria-label={tr('搜索菜单或页面', 'Search menus or pages')}
            className="w-full rounded-lg border border-slate-200/90 bg-slate-50/80 pl-7 pr-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 focus:outline-none transition"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 pt-1">
        {snapshot.formatVersion !== 2 ? (
          filteredSitemap.length > 0 ? (
            <ul className="space-y-0.5">{filteredSitemap.map(item => render(item, 0))}</ul>
          ) : (
            <p className="px-3 py-6 text-center text-xs text-slate-400">{tr('未找到匹配的页面或目录', 'No matching pages or folders found')}</p>
          )
        ) : (
          <>
            <p className="px-2.5 pb-2 text-[11px] leading-5 text-slate-400">
              {tr('此分享未包含目录结构，发布者更新后可查看完整菜单。', 'This share does not include a folder hierarchy. Republishing will include the full sitemap.')}
            </p>
            <ul className="space-y-0.5">
              {filteredFlatPages.map(page => (
                <li key={page.pageId}>
                  <button
                    type="button"
                    aria-current={activeId === page.pageId ? 'page' : undefined}
                    onClick={() => onSelect(page.pageId)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition cursor-pointer ${
                      activeId === page.pageId
                        ? 'bg-blue-50/80 font-semibold text-blue-700 ring-1 ring-blue-200/70'
                        : 'text-slate-600 hover:bg-slate-100/80'
                    }`}
                  >
                    <FileText size={13.5} className={`shrink-0 ${activeId === page.pageId ? 'text-blue-600' : 'text-slate-400'}`} />
                    <span className="min-w-0 break-words">{page.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </nav>
  );
}

export function PublishedMenuPlaceholder({ item }: { item: Exclude<PublishedMenuItem, { type: 'folder' }> }) {
  const { tr } = useI18n();
  return (
    <article className="space-y-4 p-6 sm:p-8 max-w-2xl">
      <div className="flex items-center gap-2.5 text-slate-900">
        <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200/80 flex items-center justify-center shrink-0">
          {item.type === 'doc' ? <FileText size={17} className="text-blue-600" /> : <LayoutGrid size={17} className="text-blue-600" />}
        </div>
        <h2 className="min-w-0 break-words text-base font-bold tracking-tight">{item.title}</h2>
      </div>
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-sm leading-7 text-slate-600">
        {item.type === 'doc'
          ? tr('此文档在设计器中仍为模板占位，尚未保存独立正文。', 'This document is still a placeholder in the designer and has no saved body yet.')
          : tr('此菜单尚未设计页面内容。', 'No page content has been designed for this menu item yet.')}
        <p className="mt-1 text-xs text-slate-400">
          {tr('菜单位置已保留，可从左侧目录继续查看其他内容。', 'Its menu position is reserved. You can continue browsing other pages from the sidebar.')}
        </p>
      </div>
    </article>
  );
}
