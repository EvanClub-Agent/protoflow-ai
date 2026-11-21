import React, { useMemo, useState } from 'react';
import {
  Database,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Layers,
  SlidersHorizontal,
  StickyNote,
  Table2,
} from 'lucide-react';
import { captureProjectPayload } from '../services/projectStorage';
import { projectSpecification } from '../services/projectAnalysis';
import { useProjectAnalysis } from './useProjectAnalysis';
import { ProjectTableData } from './ProjectTableData';
import { useI18n } from '../i18n';

export const InspectorSidebar: React.FC = () => {
  const { locale, tr, td } = useI18n();
  const { project, pages, analysis } = useProjectAnalysis();
  const projectId = project.currentProjectMeta.projectId;
  const projectName = project.currentProjectMeta.projectName;
  const activePageId = project.activePageId;
  const dbTables = project.dbTables;
  const stickyNotes = project.stickyNotes;
  const closedLoopIssues = project.closedLoopIssues;
  const setSelectedTableId = project.setSelectedTableId;
  const setViewMode = project.setViewMode;
  const pageSources = pages.pageSources;
  const designerPages = pages.designerPages;
  const [tab, setTab] = useState<'page' | 'data' | 'spec'>('page');
  const [tableId, setTableId] = useState('');

  const pageTitle =
    analysis.pages.find((p) => p.pageId === activePageId)?.title || activePageId;
  const pageTableIds = Array.from(
    new Set(
      analysis.usages
        .filter((u) => u.pageId === activePageId)
        .map((u) => u.tableId)
    )
  );
  const tables = dbTables.filter((t) => pageTableIds.includes(t.id));
  const selectedTable =
    tables.find((t) => t.id === tableId) || tables[0] || null;
  const notes = stickyNotes.filter((n) => n.pageId === activePageId);
  const spec = useMemo(
    () =>
      tab === 'spec' ? projectSpecification(captureProjectPayload()) : '',
    [
      locale,
      tab,
      projectId,
      projectName,
      activePageId,
      dbTables,
      stickyNotes,
      closedLoopIssues,
      pageSources,
      designerPages,
      pages.designerFolders,
      pages.sitemapBase,
      pages.sitemapOverrides,
    ]
  );

  return (
    <aside
      aria-label={tr('工程检查器', 'Project Inspector')}
      className="flex w-80 shrink-0 flex-col border-l border-slate-200/90 bg-white text-slate-800"
    >
      {/* Top Sidebar Header */}
      <div className="border-b border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-white px-3.5 py-3">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 min-w-0">
          <SlidersHorizontal className="h-3 w-3 text-blue-600 shrink-0" />
          <span className="truncate">{tr(`工程检查器 · ${projectName}`, `Project Inspector · ${projectName}`)}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-900 min-w-0">
          <Layers className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
          <span className="truncate">
            {pageTitle} ({activePageId})
          </span>
        </div>

        {/* 3-Tab Segmented Switcher */}
        <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-xl border border-slate-200/80 bg-slate-100/80 p-0.5 text-xs">
          {(
            [
              ['page', tr('页面配置', 'Page'), Layers],
              ['data', tr('预览数据', 'Data'), FileSpreadsheet],
              ['spec', tr('工程规格', 'Spec'), FileText],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`min-w-0 px-1 inline-flex items-center justify-center gap-1 rounded-lg py-1.5 font-medium transition cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap ${
                tab === id
                  ? 'bg-white text-blue-700 font-semibold shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="h-3 w-3 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable Inspector Body */}
      <div className="flex-1 overflow-y-auto p-3.5 text-xs">
        {tab === 'page' && (
          <div className="space-y-4">
            {/* Bound Tables Section */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-bold text-slate-700 min-w-0">
                  <Database className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                  <span className="truncate">{tr(`绑定数据表 (${tables.length})`, `Bound Tables (${tables.length})`)}</span>
                </div>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 tabular-nums shrink-0">
                  {tables.length}
                </span>
              </div>

              {tables.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3.5 text-center text-slate-500">
                  {tr('当前页面源码未绑定数据表。', 'No database tables bound in current page source.')}
                </div>
              ) : (
                <div className="space-y-2">
                  {tables.map((table) => (
                    <div
                      key={table.id}
                      className="rounded-xl border border-slate-200/90 bg-slate-50/40 p-3 transition hover:border-blue-200 hover:bg-white"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTableId(table.id);
                            setViewMode('db_designer');
                          }}
                          className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline cursor-pointer min-w-0"
                        >
                          <Table2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            {table.cnName || table.tableName}
                          </span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />
                        </button>
                        <span className="font-mono text-[10px] text-slate-500 truncate">
                          {table.tableName}
                        </span>
                      </div>
                      <div className="mt-1.5 text-[11px] text-slate-500 tabular-nums truncate">
                        {tr(`${table.columns.length} 字段 · ${table.domain}`, `${table.columns.length} cols · ${td(table.domain)}`)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Page Sticky Notes Section */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-bold text-slate-700 min-w-0">
                  <StickyNote className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <span className="truncate">{tr(`页面需求记录 (${notes.length})`, `Sticky Rules (${notes.length})`)}</span>
                </div>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 tabular-nums shrink-0">
                  {notes.length}
                </span>
              </div>

              {notes.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3.5 text-center text-slate-500">
                  {tr('当前页面没有需求记录。', 'No requirement notes on this page.')}
                </div>
              ) : (
                <div className="space-y-2">
                  {notes.map((note) => (
                    <div
                      key={note.id}
                      className="rounded-xl border border-amber-200/70 bg-amber-50/40 p-3"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span className="font-semibold text-slate-700 min-w-0 truncate">
                          #{note.index} ·{' '}
                          {note.targetWidgetName || note.targetWidgetId}
                        </span>
                        <span
                          className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            note.active
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                              : 'bg-slate-100 text-slate-500 border border-slate-200'
                          }`}
                        >
                          {note.active ? tr('启用', 'Active') : tr('停用', 'Inactive')}
                        </span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap break-words leading-relaxed text-slate-800">
                        {note.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'data' &&
          (tables.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-slate-500">
              {tr('当前页面没有绑定数据表，因此没有可展示的表预览数据。', 'No tables bound to this page, so no preview data is available.')}
            </div>
          ) : (
            <div className="space-y-3">
              {tables.length > 1 && (
                <select
                  aria-label={tr('选择预览数据表', 'Select preview table')}
                  value={selectedTable.id}
                  onChange={(e) => setTableId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-blue-500"
                >
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.cnName || t.tableName} ({t.tableName})
                    </option>
                  ))}
                </select>
              )}
              {selectedTable && <ProjectTableData table={selectedTable} />}
            </div>
          ))}

        {tab === 'spec' && (
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-slate-200/90 bg-slate-50/80 p-3 font-mono text-[11px] leading-relaxed text-slate-700">
            {spec}
          </pre>
        )}
      </div>
    </aside>
  );
};
