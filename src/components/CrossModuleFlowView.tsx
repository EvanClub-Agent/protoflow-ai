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
import { useI18n } from '../i18n';

function pageTitle(pages: { pageId: string; title: string }[], pageId: string) {
  return pages.find((p) => p.pageId === pageId)?.title || pageId;
}

function tableName(tables: DBTableSchema[], tableId: string) {
  const table = tables.find((t) => t.id === tableId);
  return table ? `${table.cnName || table.tableName} (${table.tableName})` : tableId;
}

export const CrossModuleFlowView: React.FC = () => {
  const { tr, td } = useI18n();
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
      label: tr('页面', 'Pages'),
      value: analysis.pages.length,
      unit: tr('个原型页面', 'prototype pages'),
      icon: Layers,
      iconBg: 'bg-blue-50 text-blue-600 border-blue-200/80',
      accent: 'from-blue-500/10 to-transparent',
    },
    {
      label: tr('跳转配置', 'Navigation Links'),
      value: analysis.navigation.length,
      unit: tr('条跨页链路', 'cross-page links'),
      icon: GitBranch,
      iconBg: 'bg-indigo-50 text-indigo-600 border-indigo-200/80',
      accent: 'from-indigo-500/10 to-transparent',
    },
    {
      label: tr('共用数据表', 'Shared Tables'),
      value: sharedTables.length,
      unit: tr('张跨页共表', 'shared tables'),
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
                    {tr('跨模块关系', 'Cross-Module Flow')}
                  </h1>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200/80 whitespace-nowrap">
                    <Sparkles className="h-3 w-3 text-blue-600 shrink-0" />
                    {tr('AST 静态实测拓扑', 'AST Verified Topology')}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 break-words">
                  {projectName} · {tr('仅展示当前工程已保存的页面跳转、数据转入和共用表关系；只读查看不会改动预览数据。', 'Displays saved page navigation, cross-table data transfers, and shared-table bindings; read-only view.')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setViewMode('single_page')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-2xs transition hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 cursor-pointer shrink-0 whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
              {tr('返回原型画布', 'Back to Canvas')}
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
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-500 truncate">
                      {card.label}
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                        {card.value}
                      </span>
                      <span className="text-[11px] text-slate-400 truncate">
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
            <div className="flex items-center gap-2 font-semibold text-amber-950 tabular-nums">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
              <span>{tr(`需要修复的引用 (${analysis.issues.length})`, `Broken References (${analysis.issues.length})`)}</span>
            </div>
            <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
              {analysis.issues.map((issue) => (
                <li
                  key={issue}
                  className="flex items-start gap-2 rounded-lg border border-amber-200/70 bg-white/80 px-3 py-2 text-[11px] leading-relaxed text-amber-900"
                >
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span className="min-w-0 break-words">{td(issue)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 2-Column Flow Cards: Page Navigation & Data Transfers */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Section 1: Configured Page Navigation */}
          <section className="flex flex-col rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs min-w-0">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200/60">
                  <GitBranch className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-slate-900 truncate tabular-nums">
                    {tr(`已配置的页面跳转 (${analysis.navigation.length})`, `Configured Page Navigation (${analysis.navigation.length})`)}
                  </h2>
                  <p className="text-[11px] text-slate-400 truncate">
                    {tr('解析自页面组件事件中的 navigate() 调用契约', 'Parsed from navigate() event handlers in page source')}
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 tabular-nums">
                {analysis.navigation.length}
              </span>
            </div>

            {analysis.navigation.length === 0 ? (
              <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <GitBranch className="h-4 w-4" />
                </div>
                <p className="text-xs font-medium text-slate-500">
                  {tr('当前没有跨页面跳转配置。', 'No cross-page navigation configured.')}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {tr("在画布按钮或表格行操作中绑定 navigate('pageId') 后会自动在此生成流转链路", "Bind navigate('pageId') on buttons or table row actions to populate navigation flows here")}
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

                      <div className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 border border-indigo-200/60 whitespace-nowrap">
                        <span>{tr('跳转至', 'Navigates to')}</span>
                        <ArrowRight className="h-3 w-3 shrink-0" />
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
          <section className="flex flex-col rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs min-w-0">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200/60">
                  <ArrowRightLeft className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-slate-900 truncate tabular-nums">
                    {tr(`数据转入动作 (${analysis.transfers.length})`, `Data Transfer Actions (${analysis.transfers.length})`)}
                  </h2>
                  <p className="text-[11px] text-slate-400 truncate">
                    {tr('解析自跨表选单转入与明细行回填动作契约', 'Parsed from cross-table line import & backfill contracts')}
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 tabular-nums">
                {analysis.transfers.length}
              </span>
            </div>

            {analysis.transfers.length === 0 ? (
              <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <ArrowRightLeft className="h-4 w-4" />
                </div>
                <p className="text-xs font-medium text-slate-500">
                  {tr('当前页面源码中没有配置跨表数据转入动作。', 'No cross-table data transfer actions configured in page source.')}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {tr('当页面配置跨表选单转入动作时，这里会展示来源表到目标表的数据流向', 'When cross-table order import actions are configured, source-to-target table flows appear here')}
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-2.5">
                {analysis.transfers.map((item) => (
                  <div
                    key={`${item.pageId}-${item.pfId}-${item.fromTableId}-${item.toTableId}`}
                    className="rounded-xl border border-slate-200/90 bg-slate-50/50 p-3 text-xs transition hover:border-emerald-200 hover:bg-emerald-50/20"
                  >
                    <div className="font-semibold text-slate-800 leading-relaxed break-words">
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
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 border border-blue-200/60">
                <Database className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900 truncate tabular-nums">
                  {tr(`共用表关联 (${sharedTables.length})`, `Shared Table Bindings (${sharedTables.length})`)}
                </h2>
                <p className="text-[11px] text-slate-400 truncate">
                  {tr('跨多个原型页面共同绑定的物理数据表与组件读写分布', 'Physical tables shared across multiple prototype pages & widget bindings')}
                </p>
              </div>
            </div>
            <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 tabular-nums">
              {tr(`${sharedTables.length} 张共表`, `${sharedTables.length} shared`)}
            </span>
          </div>

          {sharedTables.length === 0 ? (
            <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Database className="h-4 w-4" />
              </div>
              <p className="text-xs font-medium text-slate-500">
                {tr('当前没有被多个页面共同引用的数据表。', 'No database tables are currently shared across multiple pages.')}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {tr('当两个或以上原型页面绑定同一张数据表时，会自动建立跨模块共表矩阵', 'When two or more prototype pages bind to the same table, a cross-module shared matrix is built automatically')}
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3.5 md:grid-cols-2">
              {sharedTables.map((shared) => (
                <div
                  key={shared.table.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-slate-50/40 p-4 text-xs transition hover:border-blue-200 hover:bg-white hover:shadow-xs min-w-0"
                >
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200/70 pb-3">
                      <button
                        type="button"
                        onClick={() => openTable(shared.table.id)}
                        className="group inline-flex items-center gap-2 text-left font-bold text-slate-900 hover:text-blue-600 cursor-pointer min-w-0"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 border border-blue-200/70 group-hover:bg-blue-600 group-hover:text-white transition">
                          <Table2 className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs truncate">
                            {shared.table.cnName || shared.table.tableName}
                          </span>
                          <span className="block font-mono text-[11px] font-normal text-slate-500 truncate">
                            {shared.table.tableName} · {td(shared.table.domain)}
                          </span>
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openTable(shared.table.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-blue-200 hover:text-blue-600 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <span>{tr('表结构', 'Schema')}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </button>
                    </div>

                    {/* Referencing Pages */}
                    <div className="mt-3">
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 tabular-nums">
                        {tr(`共表页面 (${shared.pageIds.length})`, `Referencing Pages (${shared.pageIds.length})`)}
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
                            <FileCode2 className="h-3 w-3 text-blue-500 shrink-0" />
                            {pageTitle(analysis.pages, pageId)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Component Binding Usages */}
                  <div className="mt-3 border-t border-slate-200/60 pt-2.5">
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 tabular-nums">
                      {tr(`组件绑定明细 (${shared.usages.length})`, `Widget Bindings (${shared.usages.length})`)}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                      {shared.usages.map((usage) => (
                        <span
                          key={`${usage.pageId}-${usage.pfId ?? 'menu'}-${usage.description}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200/80 bg-white px-2 py-0.5 text-[11px] text-slate-600"
                        >
                          {pageTitle(analysis.pages, usage.pageId)} · {td(usage.description)}{usage.pfId ? ` (${usage.pfId})` : ''}
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
