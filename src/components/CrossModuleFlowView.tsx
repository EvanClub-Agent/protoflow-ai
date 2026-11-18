import React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Database,
  ExternalLink,
  FileCode2,
  GitBranch,
  Layers,
  Sparkles,
  Table2,
} from 'lucide-react';
import type { DBTableSchema } from '../store/useProtoStore';
import { isNavigablePage } from '../services/projectAnalysis';
import { useProjectAnalysis } from './useProjectAnalysis';

function pageTitle(pages: { pageId: string; title: string }[], pageId: string) {
  return pages.find((p) => p.pageId === pageId)?.title || pageId;
}

function tableName(tables: DBTableSchema[], tableId: string) {
  const table = tables.find((t) => t.id === tableId);
  return table ? `${table.cnName || table.tableName} (${table.tableName})` : tableId;
}

export const CrossModuleFlowView: React.FC = () => {
  const { project, analysis } = useProjectAnalysis();
  const projectName = project.currentProjectMeta.projectName;
  const dbTables = project.dbTables;
  const setActivePage = project.setActivePage;
  const setViewMode = project.setViewMode;
  const setSelectedTableId = project.setSelectedTableId;

  const sharedTables = dbTables
    .map((table) => {
      const tableUsages = analysis.usages.filter((u) => u.tableId === table.id);
      const pageIds = Array.from(new Set(tableUsages.map((u) => u.pageId)));
      return { table, usages: tableUsages, pageIds };
    })
    .filter((item) => item.pageIds.length > 1);

  const openPage = (pageId: string) => {
    if (!isNavigablePage(analysis.pages, pageId)) return;
    setActivePage(pageId);
    setViewMode('single_page');
  };

  const openTable = (tableId: string) => {
    setSelectedTableId(tableId);
    setViewMode('db_designer');
  };

  const kpiCards = [
    {
      label: '页面',
      value: analysis.pages.length,
      unit: '个原型页面',
      icon: Layers,
      iconBg: 'bg-blue-50 text-blue-600 border-blue-200/80',
      accent: 'from-blue-500/10 to-transparent',
    },
    {
      label: '跳转配置',
      value: analysis.navigation.length,
      unit: '条跨页链路',
      icon: GitBranch,
      iconBg: 'bg-indigo-50 text-indigo-600 border-indigo-200/80',
      accent: 'from-indigo-500/10 to-transparent',
    },
    {
      label: '共用数据表',
      value: sharedTables.length,
      unit: '张跨页共表',
      icon: Database,
      iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-200/80',
      accent: 'from-emerald-500/10 to-transparent',
    },
  ] as const;

  return (
    <div
      className="flex-1 overflow-y-auto bg-slate-50/80 p-6 text-slate-800"
      data-project-flow
    >
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Top Hero Header */}
        <header className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-500" />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm">
                <GitBranch className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-bold tracking-tight text-slate-900">
                    跨模块关系
                  </h1>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200/80">
                    <Sparkles className="h-3 w-3 text-blue-600" />
                    AST 静态实测拓扑
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {projectName} · 仅展示当前工程已保存的页面跳转、数据转入和共用表关系；只读查看不会改动预览数据。
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setViewMode('single_page')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-2xs transition hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 cursor-pointer shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回原型画布
            </button>
          </div>
        </header>

        {/* 3 KPI Summary Cards */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs transition hover:border-slate-300 hover:shadow-xs"
              >
                <div
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${card.accent} opacity-70`}
                />
                <div className="relative flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      {card.label}
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                        {card.value}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {card.unit}
                      </span>
                    </div>
                  </div>
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${card.iconBg}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        {/* Reference Issues Alert */}
        {analysis.issues.length > 0 && (
          <section className="rounded-2xl border border-amber-200/90 bg-gradient-to-r from-amber-50/95 to-orange-50/60 p-4 text-xs text-amber-900 shadow-2xs">
            <div className="flex items-center gap-2 font-semibold text-amber-950">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
              <span>需要修复的引用 ({analysis.issues.length})</span>
            </div>
            <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
              {analysis.issues.map((issue) => (
                <li
                  key={issue}
                  className="flex items-start gap-2 rounded-lg border border-amber-200/70 bg-white/80 px-3 py-2 text-[11px] leading-relaxed text-amber-900"
                >
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span className="min-w-0 break-all">{issue}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 2-Column Flow Cards: Page Navigation & Data Transfers */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Section 1: Configured Page Navigation */}
          <section className="flex flex-col rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200/60">
                  <GitBranch className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    已配置的页面跳转 ({analysis.navigation.length})
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    解析自页面组件事件中的 navigate() 调用契约
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 tabular-nums">
                {analysis.navigation.length}
              </span>
            </div>

            {analysis.navigation.length === 0 ? (
              <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <GitBranch className="h-4 w-4" />
                </div>
                <p className="text-xs font-medium text-slate-500">
                  当前没有跨页面跳转配置。
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  在画布按钮或表格行操作中绑定 navigate(&apos;pageId&apos;) 后会自动在此生成流转链路
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-2.5">
                {analysis.navigation.map((item) => (
                  <div
                    key={`${item.from}-${item.pfId}-${item.event}-${item.to}`}
                    className="group rounded-xl border border-slate-200/90 bg-slate-50/50 p-3 text-xs transition hover:border-indigo-200 hover:bg-indigo-50/20 hover:shadow-2xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!isNavigablePage(analysis.pages, item.from)}
                        onClick={() => openPage(item.from)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1 font-semibold text-slate-800 shadow-2xs transition hover:border-blue-300 hover:text-blue-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <FileCode2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                        {pageTitle(analysis.pages, item.from)}
                      </button>

                      <div className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 border border-indigo-200/60">
                        <span>跳转至</span>
                        <ArrowRight className="h-3 w-3" />
                      </div>

                      <button
                        type="button"
                        disabled={!isNavigablePage(analysis.pages, item.to)}
                        onClick={() => openPage(item.to)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200/90 bg-blue-50/70 px-2.5 py-1 font-semibold text-blue-700 shadow-2xs transition hover:bg-blue-100/80 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Layers className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                        {pageTitle(analysis.pages, item.to)}
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600 border border-slate-200/80">
                        {item.pfId} · {item.event}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Section 2: Cross-Table Data Transfer Actions */}
          <section className="flex flex-col rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200/60">
                  <ArrowRightLeft className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    数据转入动作 ({analysis.transfers.length})
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    解析自跨表选单转入与明细行回填动作契约
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 tabular-nums">
                {analysis.transfers.length}
              </span>
            </div>

            {analysis.transfers.length === 0 ? (
              <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <ArrowRightLeft className="h-4 w-4" />
                </div>
                <p className="text-xs font-medium text-slate-500">
                  当前页面源码中没有配置跨表数据转入动作。
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  当页面配置跨表选单转入动作时，这里会展示来源表到目标表的数据流向
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-2.5">
                {analysis.transfers.map((item) => (
                  <div
                    key={`${item.pageId}-${item.pfId}-${item.fromTableId}-${item.toTableId}`}
                    className="rounded-xl border border-slate-200/90 bg-slate-50/50 p-3 text-xs transition hover:border-emerald-200 hover:bg-emerald-50/20"
                  >
                    <div className="font-semibold text-slate-800 leading-relaxed">
                      {pageTitle(analysis.pages, item.pageId)}: {tableName(dbTables, item.fromTableId)} → {tableName(dbTables, item.toTableId)}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600 border border-slate-200/80">
                        {item.pfId} · importPurchaseOrderLines
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Bottom Section: Shared Table Associations */}
        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 border border-blue-200/60">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  共用表关联 ({sharedTables.length})
                </h2>
                <p className="text-[11px] text-slate-400">
                  跨多个原型页面共同绑定的物理数据表与组件读写分布
                </p>
              </div>
            </div>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 tabular-nums">
              {sharedTables.length} 张共表
            </span>
          </div>

          {sharedTables.length === 0 ? (
            <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Database className="h-4 w-4" />
              </div>
              <p className="text-xs font-medium text-slate-500">
                当前没有被多个页面共同引用的数据表。
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                当两个或以上原型页面绑定同一张数据表时，会自动建立跨模块共表矩阵
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3.5 md:grid-cols-2">
              {sharedTables.map((shared) => (
                <div
                  key={shared.table.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-slate-50/40 p-4 text-xs transition hover:border-blue-200 hover:bg-white hover:shadow-xs"
                >
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200/70 pb-3">
                      <button
                        type="button"
                        onClick={() => openTable(shared.table.id)}
                        className="group inline-flex items-center gap-2 text-left font-bold text-slate-900 hover:text-blue-600 cursor-pointer"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 border border-blue-200/70 group-hover:bg-blue-600 group-hover:text-white transition">
                          <Table2 className="h-3.5 w-3.5" />
                        </span>
                        <span>
                          <span className="block text-xs">
                            {shared.table.cnName || shared.table.tableName}
                          </span>
                          <span className="block font-mono text-[11px] font-normal text-slate-500">
                            {shared.table.tableName} · {shared.table.domain}
                          </span>
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openTable(shared.table.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-blue-200 hover:text-blue-600 cursor-pointer"
                      >
                        <span>表结构</span>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Referencing Pages */}
                    <div className="mt-3">
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        共表页面 ({shared.pageIds.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {shared.pageIds.map((pageId) => (
                          <button
                            key={pageId}
                            type="button"
                            disabled={!isNavigablePage(analysis.pages, pageId)}
                            onClick={() => openPage(pageId)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-2xs transition hover:border-blue-300 hover:text-blue-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <FileCode2 className="h-3 w-3 text-blue-500" />
                            {pageTitle(analysis.pages, pageId)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Component Binding Usages */}
                  <div className="mt-3 border-t border-slate-200/60 pt-2.5">
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      组件绑定明细 ({shared.usages.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                      {shared.usages.map((usage) => (
                        <span
                          key={`${usage.pageId}-${usage.pfId ?? 'menu'}-${usage.description}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200/80 bg-white px-2 py-0.5 text-[11px] text-slate-600"
                        >
                          {pageTitle(analysis.pages, usage.pageId)} · {usage.description}{usage.pfId ? ` (${usage.pfId})` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
