import React, { useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Bot,
  Database,
  ExternalLink,
  FileCode2,
  GitBranch,
  Layers,
  Send,
  Sparkles,
  StickyNote,
  Table2,
} from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { isNavigablePage } from '../services/projectAnalysis';
import { useProjectAnalysis } from './useProjectAnalysis';
import { runProjectAi } from '../services/hermesBridge';
import { useHermesStore } from '../store/useHermesStore';
import { ChatMarkdown } from './ChatMarkdown';
import { useI18n } from '../i18n';

export const KnowledgeImpactView: React.FC = () => {
  const projectId = useProtoStore(s => s.currentProjectMeta.projectId);
  const pageId = useProtoStore(s => s.activePageId);
  return <ProjectKnowledge key={JSON.stringify([projectId, pageId])} />;
};

function ProjectKnowledge() {
  const { tr, td } = useI18n();
  const { project, analysis } = useProjectAnalysis();
  const projectName = project.currentProjectMeta.projectName;
  const activePageId = project.activePageId;
  const dbTables = project.dbTables;
  const stickyNotes = project.stickyNotes;
  const setActivePage = project.setActivePage;
  const setViewMode = project.setViewMode;
  const setSelectedTableId = project.setSelectedTableId;
  const hermesStatus = useHermesStore((s) => s.status);
  const projectRunning = useHermesStore(s => Boolean(s.runningProjects[project.currentProjectMeta.projectId]));
  const canAnalyze = isNavigablePage(analysis.pages, activePageId);
  const openPage = (pageId: string) => {
    if (!isNavigablePage(analysis.pages, pageId)) return;
    setActivePage(pageId);
    setViewMode('single_page');
  };
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const pageUsages = analysis.usages.filter((u) => u.pageId === activePageId);
  const tableIds = Array.from(new Set(pageUsages.map((u) => u.tableId)));
  const boundTables = dbTables.filter((t) => tableIds.includes(t.id));
  const sharedPages = Array.from(
    new Set(
      analysis.usages
        .filter(
          (u) => tableIds.includes(u.tableId) && u.pageId !== activePageId
        )
        .map((u) => u.pageId)
    )
  );
  const links = analysis.navigation.filter(
    (n) => n.from === activePageId || n.to === activePageId
  );
  const notes = stickyNotes.filter((n) => n.pageId === activePageId);
  const pageTitle = (pageId: string) =>
    analysis.pages.find((p) => p.pageId === pageId)?.title || pageId;

  const ask = async () => {
    if (!canAnalyze || !question.trim() || running || projectRunning) return;
    setRunning(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await runProjectAi(question, {
        pageId: activePageId,
        readOnly: true,
      });
      setAnswer(res.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-slate-50/80 p-6 text-slate-800">
      <div className="mx-auto max-w-6xl space-y-6 min-w-0">
        {/* Top Control & Context Header */}
        <header className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-600 via-blue-500 to-cyan-500" />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0 flex-1">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-sm">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-bold tracking-tight text-slate-900">
                    {tr('工程知识与影响', 'Project Knowledge & Impact')}
                  </h1>
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700 border border-indigo-200/70 whitespace-nowrap">
                    <Sparkles className="h-3 w-3 shrink-0" />
                    {tr('变更影响域分析', 'Change Impact Analysis')}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 break-words">
                  {projectName} · {tr('关系来自当前页面源码和已保存需求记录；本地不会伪造语义规则或变更影响。', 'Relationships are parsed from current page source and saved requirement notes; no fabricated local semantic rules.')}
                </p>
              </div>
            </div>

            {/* Page Selector Pill Box */}
            <div className="flex items-center gap-2 rounded-xl border border-slate-200/90 bg-slate-50/80 px-3 py-1.5 shrink-0">
              <Layers className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
              <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">
                {tr('分析目标页', 'Target Page')}
              </span>
              <select
                aria-label={tr('分析页面', 'Target Page')}
                value={canAnalyze ? activePageId : ''}
                onChange={(e) => { if (isNavigablePage(analysis.pages, e.target.value)) setActivePage(e.target.value); }}
                className="max-w-[200px] truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-2xs outline-none focus:border-blue-500 cursor-pointer"
              >
                {!canAnalyze && <option value="">{tr('请选择可用页面', 'Select an available page')}</option>}
                {analysis.pages.map((page) => (
                  <option key={page.pageId} value={page.pageId} disabled={!isNavigablePage(analysis.pages, page.pageId)}>
                    {page.title} ({page.pageId})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick Page Impact Metric Strip */}
          <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-slate-100 pt-3.5 sm:grid-cols-4">
            <div className="flex items-center gap-2.5 rounded-xl bg-slate-50/80 px-3 py-2 border border-slate-200/60 min-w-0">
              <Database className="h-4 w-4 text-blue-600 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-slate-400 truncate">{tr('绑定数据表', 'Bound Tables')}</div>
                <div className="text-sm font-bold text-slate-900 tabular-nums">
                  {boundTables.length}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl bg-slate-50/80 px-3 py-2 border border-slate-200/60 min-w-0">
              <FileCode2 className="h-4 w-4 text-indigo-600 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-slate-400 truncate">{tr('共表关联页面', 'Shared-Table Pages')}</div>
                <div className="text-sm font-bold text-slate-900 tabular-nums">
                  {sharedPages.length}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl bg-slate-50/80 px-3 py-2 border border-slate-200/60 min-w-0">
              <GitBranch className="h-4 w-4 text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-slate-400 truncate">{tr('出入向跳转', 'Navigation Links')}</div>
                <div className="text-sm font-bold text-slate-900 tabular-nums">
                  {links.length}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl bg-slate-50/80 px-3 py-2 border border-slate-200/60 min-w-0">
              <StickyNote className="h-4 w-4 text-amber-600 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-slate-400 truncate">{tr('页面需求便签', 'Sticky Rules')}</div>
                <div className="text-sm font-bold text-slate-900 tabular-nums">
                  {notes.length}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* 2-Column Main Inspection Grid */}
        <div className="grid gap-6 lg:grid-cols-2 min-w-0">
          {/* Left Column: Configured Data Associations, Shared Pages & Page Links */}
          <section className="flex flex-col space-y-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs min-w-0">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 border border-blue-200/60">
                  <Database className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-slate-900 truncate">
                    {tr('已配置的数据关联', 'Configured Data Associations')}
                  </h2>
                  <p className="text-[11px] text-slate-400 truncate">
                    {tr('当前页面的物理表绑定、跨页共表半径与上下游跳转', 'Bound physical tables, shared-table blast radius & page links')}
                  </p>
                </div>
              </div>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 tabular-nums">
                {tr(`${boundTables.length} 表`, `${boundTables.length} tables`)}
              </span>
            </div>

            {boundTables.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center">
                <Database className="mb-1.5 h-5 w-5 text-slate-400" />
                <p className="text-xs text-slate-500">
                  {tr('当前页面没有绑定数据表。', 'No database tables bound to this page.')}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {boundTables.map((table) => (
                  <div
                    key={table.id}
                    className="rounded-xl border border-slate-200/90 bg-slate-50/40 p-3.5 text-xs transition hover:border-blue-200 hover:bg-white"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTableId(table.id);
                          setViewMode('db_designer');
                        }}
                        className="inline-flex items-center gap-1.5 font-semibold text-blue-700 hover:text-blue-800 hover:underline cursor-pointer min-w-0"
                      >
                        <Table2 className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {table.cnName || table.tableName}
                        </span>
                        <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                      </button>
                      <span className="rounded-md bg-white px-2 py-0.5 font-mono text-[11px] text-slate-500 border border-slate-200/80 shrink-0 tabular-nums whitespace-nowrap">
                        {tr(`${table.tableName} · ${table.columns.length} 字段`, `${table.tableName} · ${table.columns.length} cols`)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                      {pageUsages
                        .filter((u) => u.tableId === table.id)
                        .map((u) => (
                          <span
                            key={`${u.pfId ?? 'menu'}-${u.description}`}
                            className="rounded-md border border-slate-200/80 bg-white px-2 py-0.5 font-mono text-[10px] text-slate-600"
                          >
                            {td(u.description)}{u.pfId ? ` (${u.pfId})` : ''}
                          </span>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Shared Pages Subsection */}
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-3.5">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <FileCode2 className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                  {tr(`共用表的其他页面 (${sharedPages.length})`, `Other Pages Sharing Tables (${sharedPages.length})`)}
                </span>
              </div>
              {sharedPages.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  {tr('没有其他页面与当前页面共用数据表。', 'No other pages share tables with this page.')}
                </p>
              ) : (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {sharedPages.map((id) => (
                    <button
                      key={id}
                      type="button"
                      disabled={!isNavigablePage(analysis.pages, id)}
                      onClick={() => openPage(id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-2xs transition hover:border-blue-300 hover:text-blue-600 cursor-pointer"
                    >
                      <Layers className="h-3 w-3 text-blue-500 shrink-0" />
                      {pageTitle(id)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Page Navigation Links Subsection */}
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-3.5">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <GitBranch className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  {tr(`页面跳转配置 (${links.length})`, `Page Navigation Links (${links.length})`)}
                </span>
              </div>
              {links.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  {tr('当前页面没有配置跳转关系。', 'No navigation links configured on this page.')}
                </p>
              ) : (
                <div className="mt-2 space-y-1.5 text-xs text-slate-600">
                  {links.map((item) => (
                    <div
                      key={`${item.from}-${item.pfId}-${item.to}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-white px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="font-medium text-slate-700 break-words">
                        {pageTitle(item.from)} → {pageTitle(item.to)} · {item.pfId} ({item.event})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Right Column: Sticky Note Requirement Records */}
          <section className="flex flex-col space-y-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs min-w-0">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 border border-amber-200/70">
                  <StickyNote className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-slate-900 truncate tabular-nums">
                    {tr(`页面需求记录 (${notes.length})`, `Page Requirement Notes (${notes.length})`)}
                  </h2>
                  <p className="text-[11px] text-slate-400 truncate">
                    {tr('挂载于当前页面组件上的业务规则与交互约束便签', 'Business rules & interaction constraints pinned to page widgets')}
                  </p>
                </div>
              </div>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200/60 tabular-nums">
                {tr(`${notes.length} 条记录`, `${notes.length} notes`)}
              </span>
            </div>

            {notes.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-500">
                  <StickyNote className="h-4 w-4" />
                </div>
                <p className="text-xs font-medium text-slate-500">
                  {tr('当前页面还没有黄色便签需求记录。', 'No sticky requirement notes on this page yet.')}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {tr('在原型画布中点击组件右上角便签钉即可添加业务约束说明', 'Click the pin icon on any widget in the prototype canvas to attach requirement notes')}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className={`rounded-xl border p-3.5 text-xs transition ${
                      note.active
                        ? 'border-amber-200/80 bg-gradient-to-br from-amber-50/60 to-white'
                        : 'border-slate-200 bg-slate-50/60 opacity-80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 min-w-0">
                        <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-amber-100/90 px-1.5 font-mono text-[10px] font-bold text-amber-800">
                          #{note.index}
                        </span>
                        <span className="truncate">
                          #{note.index} · {note.targetWidgetName || note.targetWidgetId}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 whitespace-nowrap inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          note.active
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}
                      >
                        {note.active ? tr('已启用记录', 'Active') : tr('已停用记录', 'Inactive')}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-slate-800">
                      {note.text}
                    </p>
                    {note.compiledRule ? (
                      <div className="mt-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-2.5 py-1.5 text-[11px] text-amber-800 break-words">
                        {tr(`历史规则描述（未自动校验）：${note.compiledRule}`, `Legacy rule summary (unverified): ${note.compiledRule}`)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Bottom Section: Read-only Hermes Impact Q&A */}
        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 border border-violet-200/70">
                <Bot className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900">
                  {tr('询问 Hermes', 'Ask Hermes')}
                </h2>
                <p className="text-[11px] text-slate-400 break-words">
                  {tr('基于当前页面 AST、物理表结构与需求便签进行只读变更影响推演', 'Read-only change impact analysis based on current page AST, table schemas & sticky notes')}
                </p>
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border ${
                hermesStatus === 'running'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  hermesStatus === 'running'
                    ? 'bg-emerald-500'
                    : 'bg-slate-400'
                }`}
              />
              {hermesStatus === 'running'
                ? tr('Hermes 已连接；回答仅代表模型分析，不会自动改动工程。', 'Hermes connected; read-only analysis — will not modify the project.')
                : tr('未连接 Hermes；请先在 AI 管理中心完成连接。', 'Hermes disconnected; connect in AI Engine Manager first.')}
            </span>
          </div>

          <div className="space-y-3">
            <textarea
              aria-label={tr('影响分析问题', 'Impact Analysis Question')}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              placeholder={tr('例如：如果调整当前页面绑定表的字段或状态，会影响哪些共用页面和需求记录？', 'e.g. If I change columns or statuses on a table bound to this page, which shared pages and sticky notes will be affected?')}
              className="w-full rounded-xl border border-slate-200/90 bg-slate-50/50 p-3 text-xs leading-relaxed text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/15"
            />
            <div className="flex items-center justify-end">
              <button
                type="button"
                disabled={!canAnalyze || !question.trim() || running || projectRunning}
                onClick={ask}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <Send className="h-3.5 w-3.5 shrink-0" />
                {running ? tr('正在询问 Hermes...', 'Asking Hermes...') : tr('用当前工程上下文询问 Hermes', 'Ask Hermes with Project Context')}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <span className="break-words min-w-0">{td(error)}</span>
            </div>
          )}

          {answer && (
            <div
              role="status"
              className="rounded-xl border border-slate-200 bg-slate-50/90 p-4 text-xs leading-relaxed text-slate-800"
            >
              <ChatMarkdown content={answer} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
