import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  FileCheck2,
  LocateFixed,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { useProjectAnalysis } from './useProjectAnalysis';
import { isNavigablePage } from '../services/projectAnalysis';
import { runProjectAi } from '../services/hermesBridge';
import { useHermesStore } from '../store/useHermesStore';

export const ClosedLoopAuditView: React.FC = () => {
  const projectId = useProtoStore(s => s.currentProjectMeta.projectId);
  return <ProjectAudit key={projectId} />;
};

function ProjectAudit() {
  const { project, analysis } = useProjectAnalysis();
  const activePageId = useProtoStore((s) => s.activePageId);
  const dbTables = useProtoStore((s) => s.dbTables);
  const stickyNotes = useProtoStore((s) => s.stickyNotes);
  const issues = useProtoStore((s) => s.closedLoopIssues);
  const scopeFilter = useProtoStore((s) => s.auditScopeFilter);
  const setAuditScopeFilter = useProtoStore((s) => s.setAuditScopeFilter);
  const setActivePage = useProtoStore((s) => s.setActivePage);
  const setViewMode = useProtoStore((s) => s.setViewMode);
  const setSelectedTableId = useProtoStore((s) => s.setSelectedTableId);
  const setActivePopoverWidgetId = useProtoStore(
    (s) => s.setActivePopoverWidgetId
  );
  const projectRunning = useHermesStore(s => Boolean(s.runningProjects[project.currentProjectMeta.projectId]));
  const hermesStatus = useHermesStore((s) => s.status);
  const [selectedIssueId, setSelectedAuditIssueId] = useState('');
  const [selectedOptionId, setSelectedOptionId] = useState('');
  const [customInstruction, setCustomInstruction] = useState('');
  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const busy = scanning || fixing || projectRunning;

  const visible = useMemo(
    () =>
      scopeFilter === 'current_module'
        ? issues.filter((i) => i.pageId === activePageId)
        : issues,
    [issues, scopeFilter, activePageId]
  );
  const active =
    visible.find((i) => i.id === selectedIssueId) || visible[0] || null;

  useEffect(() => {
    setSelectedOptionId(
      active?.resolvedByOptionId || active?.options[0]?.id || ''
    );
    setCustomInstruction(active?.customUserAnswer || '');
  }, [active?.id, active?.options, active?.resolvedByOptionId, active?.customUserAnswer]);

  const resolved = visible.filter((i) => i.status === 'resolved').length;
  const total = visible.length;
  const progress = total ? Math.round((resolved / total) * 100) : null;
  const targetTable = active
    ? dbTables.find(
        (t) => t.id === active.targetTableId
      )
    : undefined;
  const canLocateWidget = Boolean(
    active &&
      isNavigablePage(analysis.pages, active.pageId) &&
      analysis.components.some(node => node.pageId === active.pageId && node.pfId === active.targetWidgetId)
  );
  const canLocateTable = Boolean(targetTable);
  const canApplyTable = !active?.targetTableId || canLocateTable;
  const selectedOption = active?.options.find((o) => o.id === selectedOptionId);

  const runScan = async () => {
    if (busy || (scopeFilter === 'current_module' && !isNavigablePage(analysis.pages, activePageId))) return;
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const scope = scopeFilter === 'all'
        ? '当前项目全部页面；请返回全项目完整问题列表'
        : `仅页面 ${activePageId}；只返回该页面的问题，不返回其他页面的问题。应用时会保留其他页面已有记录`;
      const response = await runProjectAi(
        `请检查${scope}。依据实际源码、表结构与需求记录，调用 protoflow_run_closed_loop_audit 写入有证据的结果；该范围没有问题时返回空数组。此次只巡检，禁止修改源码、表或便签。`,
        { pageId: activePageId, audit: scopeFilter === 'all'
          ? { kind: 'scan', scope: 'project' }
          : { kind: 'scan', scope: 'page', pageId: activePageId } }
      );
      setResult(response.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  const applyWithHermes = async () => {
    if (busy || !active || !selectedOption || !canLocateWidget || !canApplyTable) return;
    setFixing(true);
    setError(null);
    setResult(null);
    try {
      const response = await runProjectAi(
        `修复巡检问题 ${active.id}「${active.title}」（页面 ${active.pageId}，组件 pfId ${active.targetWidgetId}，表 ID ${active.targetTableId || '无'}）。问题：${active.brokenChainDesc}。选择方案 ${selectedOption.id}：${selectedOption.label} - ${selectedOption.description}。方案需求记录：${selectedOption.stickyPatchText}；表结构说明：${selectedOption.dbPatchSummary}。补充要求：${customInstruction || '无'}。先修改真实关联源码、表结构或需求记录，再调用 protoflow_run_closed_loop_audit 更新该问题；结果数组仅包含 ID 为 ${active.id} 的问题，其他问题由应用保留。修复成功后在该问题记录的 resolvedByOptionId 中记录方案 ID ${selectedOption.id}，customUserAnswer 中保存补充要求。无法修复或没有实际变更时保持 open，不得仅修改状态冒充完成。`,
        { pageId: active.pageId, audit: { kind: 'repair', issueId: active.id } }
      );
      setResult(response.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="@container flex min-w-0 flex-1 flex-col overflow-hidden bg-slate-50/80 text-slate-800">
      {/* Top Audit Dashboard Header */}
      <header className="relative border-b border-slate-200/90 bg-white px-6 py-4 shadow-2xs shrink-0">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-blue-600 to-indigo-600" />
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-sm">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-slate-900">
                  需求闭环巡检
                </h1>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                    hermesStatus === 'running'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  {hermesStatus === 'running' ? 'Hermes 在线核验' : '离线记录视图'}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {hermesStatus === 'running'
                  ? 'Hermes 已连接；只有运行巡检后返回的记录会带巡检时间。'
                  : '未连接 Hermes；当前只展示工程内已保存的巡检记录。'}{' '}
                · 需求记录 {stickyNotes.length} 条 · 数据表 {dbTables.length} 张
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            {/* Progress Pill */}
            <span
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-medium ${
                total > 0
                  ? resolved === total
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50/80 text-amber-800'
                  : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}
            >
              {total > 0 ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              ) : (
                <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              )}
              {total
                ? `范围记录处理率 ${progress}% (${resolved}/${total})`
                : '暂无巡检记录'}
            </span>

            {/* Segmented Scope Filter */}
            <div className="inline-flex rounded-xl border border-slate-200/90 bg-slate-100/80 p-0.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => setAuditScopeFilter('all')}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition cursor-pointer ${
                  scopeFilter === 'all'
                    ? 'bg-white text-blue-700 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                全部项目记录 ({issues.length})
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setAuditScopeFilter('current_module')}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition cursor-pointer ${
                  scopeFilter === 'current_module'
                    ? 'bg-white text-blue-700 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                当前页面 ({issues.filter((i) => i.pageId === activePageId).length})
              </button>
            </div>

            {/* Primary Scan Button */}
            <button
              type="button"
              disabled={busy || (scopeFilter === 'current_module' && !isNavigablePage(analysis.pages, activePageId))}
              onClick={runScan}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 font-semibold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`}
              />
              {scanning ? 'Hermes 巡检中...' : '运行 Hermes 巡检'}
            </button>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          className="mx-6 mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 shadow-2xs"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {result && <p role="status" className="mx-6 mt-4 whitespace-pre-wrap rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">{result}</p>}

      {/* Body Content */}
      {visible.length === 0 ? (
        <div className="m-6 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200/70">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <p className="max-w-lg text-sm font-medium text-slate-600 leading-relaxed">
            当前没有巡检记录。可在连接 Hermes 后点击“运行 Hermes 巡检”，让模型根据真实页面源码、数据表和需求记录生成巡检结果。
          </p>
        </div>
      ) : (
        <div data-audit-layout className="mx-auto flex min-h-0 min-w-0 w-full max-w-7xl flex-1 flex-col gap-5 p-6 @min-[720px]:flex-row">
          {/* Left Issue Master List */}
          <aside
            aria-label="巡检问题"
            className="w-full min-w-0 shrink-0 space-y-2.5 overflow-y-auto pr-1 @min-[720px]:w-72"
          >
            {visible.map((issue) => {
              const isSelected = active?.id === issue.id;
              const isResolved = issue.status === 'resolved';
              const isHermesVerified =
                issue.auditOrigin === 'hermes' && Boolean(issue.auditedAt);
              return (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => setSelectedAuditIssueId(issue.id)}
                  className={`w-full rounded-2xl border p-3.5 text-left text-xs transition cursor-pointer ${
                    isSelected
                      ? 'border-blue-500 bg-white shadow-sm ring-2 ring-blue-500/10'
                      : 'border-slate-200/90 bg-white/90 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span
                      className={`inline-flex items-center gap-1 font-semibold ${
                        isResolved ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {isResolved ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      )}
                      {isResolved ? '已处理' : '待处理'} · {issue.category}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                        isHermesVerified
                          ? 'bg-blue-50 text-blue-700 border-blue-200/70'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}
                    >
                      {isHermesVerified ? 'Hermes 记录' : '历史未核验'}
                    </span>
                  </div>
                  <div className="mt-2 font-bold text-slate-900 leading-snug">
                    {issue.title}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 truncate">
                    <span>
                      {issue.moduleTitle} · {issue.targetWidgetName}
                    </span>
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Right Issue Detail & Resolution Workbench */}
          {active && (
            <main data-audit-detail className="w-full min-w-0 flex-1 space-y-5 overflow-y-auto rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs">
              {/* Provenance & Target Quick Jump Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 text-xs">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium border ${
                    active.auditOrigin === 'hermes' && active.auditedAt
                      ? 'border-blue-200 bg-blue-50/80 text-blue-700'
                      : 'border-amber-200 bg-amber-50/80 text-amber-800'
                  }`}
                >
                  {active.auditOrigin === 'hermes' && active.auditedAt ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                  )}
                  {active.auditOrigin === 'hermes' && active.auditedAt
                    ? `Hermes 巡检记录 · ${active.auditedAt}`
                    : '历史记录未核验来源 · 请运行 Hermes 重新核对'}
                </span>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!canLocateWidget}
                    onClick={() => {
                      if (!canLocateWidget) return;
                      setActivePage(active.pageId);
                      setViewMode('single_page');
                      setActivePopoverWidgetId(active.targetWidgetId);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <LocateFixed className="h-3.5 w-3.5" />
                    {canLocateWidget
                      ? `定位组件 ${active.targetWidgetName}`
                      : '关联组件已不可用'}
                  </button>
                  <button
                    type="button"
                    disabled={!canLocateTable}
                    onClick={() => {
                      if (targetTable) {
                        setSelectedTableId(targetTable.id);
                        setViewMode('db_designer');
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Database className="h-3.5 w-3.5" />
                    {canLocateTable
                      ? `定位表 ${targetTable!.tableName}`
                      : '关联表已不可用'}
                  </button>
                </div>
              </div>

              {/* Diagnostic Details Card */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4">
                <h2 className="text-base font-bold text-slate-900">
                  {active.title}
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                  {active.brokenChainDesc}
                </p>
                {active.aiQuestion && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-200/70 bg-blue-50/60 px-3 py-2 text-xs font-medium text-blue-900">
                    <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                    <span>{active.aiQuestion}</span>
                  </div>
                )}
              </div>

              {/* Resolution Options */}
              {active.options.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                    <FileCheck2 className="h-3.5 w-3.5 text-blue-600" />
                    <span>候选闭环修复方案 ({active.options.length})</span>
                  </div>
                  {active.options.map((opt) => {
                    const isChecked = selectedOptionId === opt.id;
                    return (
                      <label
                        key={opt.id}
                        className={`block cursor-pointer rounded-xl border p-3.5 text-xs transition ${
                          isChecked
                            ? 'border-blue-500 bg-blue-50/40 ring-1 ring-blue-500/20'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="audit-option"
                            disabled={busy}
                            checked={isChecked}
                            onChange={() => setSelectedOptionId(opt.id)}
                            className="accent-blue-600"
                          />
                          <span className="font-bold text-slate-900">
                            {opt.label}
                          </span>
                        </div>
                        <p className="mt-1.5 pl-5 text-slate-600 leading-relaxed">
                          {opt.description}
                        </p>
                        <div className="mt-2 ml-5 rounded-lg border border-slate-200/80 bg-white px-2.5 py-1.5 text-[11px] text-slate-500">
                          需求记录：{opt.stickyPatchText} · 表结构：{opt.dbPatchSummary}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Supplemental Custom Instruction */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  补充修复说明
                </label>
                <textarea
                  aria-label="补充修复说明"
                  disabled={busy}
                  value={customInstruction}
                  onChange={(e) => setCustomInstruction(e.target.value)}
                  rows={2}
                  placeholder="补充业务约束，提交后由 Hermes 结合所选方案尝试修复。"
                  className="w-full rounded-xl border border-slate-200/90 bg-slate-50/50 p-3 text-xs text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/15"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2.5 pt-1 text-xs">
                <button
                  type="button"
                  disabled={busy || !selectedOption || !canLocateWidget || !canApplyTable}
                  onClick={applyWithHermes}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  {fixing ? 'Hermes 执行中...' : '应用所选方案并修复'}
                </button>
              </div>
            </main>
          )}
        </div>
      )}
    </div>
  );
};
