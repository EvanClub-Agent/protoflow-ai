import React from 'react';
import { openRuntimeDiagnostics } from '../services/runtimeDiagnostics';
import { AccountButton } from './AccountButton';
import { AiBackgroundControl } from './AiBackgroundControl';
import {
  GitBranch,
  Eye,
  Database,
  Pin,
  Package,
  BrainCircuit,
  ShieldCheck,
  FolderOpen,
  Globe,
  LogOut,
  PanelLeft,
  PanelRight,
  ChevronRight,
  Bot,
  ArrowUpCircle,
  BookOpenText,
  Bug,
} from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { useHermesStore } from '../store/useHermesStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { usePageStore } from '../proto/store/usePageStore';
import { ProjectSaveStatus } from './ProjectSaveStatus';
import { AlexLogo } from './AlexLogo';
import { ThemeSwitch, useThemePreference } from './ThemeSwitch';

export type { ThemeMode } from './ThemeSwitch';

export const GlobalToolbar: React.FC = () => {
  const {
    activePageId,
    viewMode,
    setViewMode,
    setLeftSidebarTab,
    showAllComponentPins,
    setShowAllComponentPins,
    setBundleModalOpen,
    stickyNotes,
    dbTables,
    closedLoopIssues,
    setAuditScopeFilter,
    currentProjectMeta,
    setWelcomeScreenOpen,
    isWebPlayerMode,
    setWebPlayerMode,
    setWebPublishModalOpen,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    toggleLeftSidebar,
    toggleRightSidebar,
    projectNotes,
    selectedNoteNodeId,
    dockedNoteId,
    setDockedNoteId,
  } = useProtoStore();
  const {
    status: hermesStatus,
    currentVersion: hermesVer,
    updateAvailable: hermesUpdate,
    setModalOpen: setHermesModalOpen,
  } = useHermesStore();
  const {
    currentVersion: appVersion,
    hasUpdate: appHasUpdate,
    latestRelease: appLatestRelease,
    status: appUpdateStatus,
    setModalOpen: setUpdateModalOpen,
  } = useUpdateStore();

  const openLoopGapCount = closedLoopIssues.filter((i) => i.status === 'open').length;
  const activeDesignerPage = usePageStore(state => state.designerPages.find(page => page.pageId === activePageId));

  const theme = useThemePreference();

  const pageTitleMap: Record<string, string> = {
    'acceptance-new': '新增到货验收 (57/130)',
    'supplier-approval': '供应商审批 (18/130)',
    'qualified-suppliers': '合格供应商目录 (19/130)',
    'purchase-order-confirm': '采购订单确认 (34/130)',
    'acceptance-list': '到货验收单台账 (58/130)',
    'doc-overview': '系统总体要求 (1/130)',
    'doc-changelog': '设计变更记录 (2/130)',
    'material-catalog': '商品物料目录 (15/130)',
    'annual-plan': '季度补货计划预算 (42/130)',
  };
  const activePageTitle = activeDesignerPage ? activeDesignerPage.title : pageTitleMap[activePageId];

  const desktopBridge =
    typeof window !== 'undefined'
      ? (window as unknown as { protoflowDesktop?: { isElectron?: boolean; platform?: string } })
          .protoflowDesktop
      : undefined;
  const isMacDesktop = Boolean(desktopBridge?.isElectron && desktopBridge?.platform === 'darwin');
  const dragRegionStyle = isMacDesktop ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined;
  const noDragStyle = isMacDesktop ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : undefined;
  const headerLeftPadding = isMacDesktop ? 'pl-[78px]' : 'pl-2';

  // Web Player Preview Header
  if (isWebPlayerMode) {
    return (
      <header
        style={dragRegionStyle}
        className={`h-10 ${headerLeftPadding} pr-3 border-b border-slate-200 bg-white flex items-center justify-between gap-2 z-30 select-none shrink-0`}
      >
        <div style={noDragStyle} className="flex items-center gap-2.5 min-w-0">
          <span className="px-2 py-0.5 rounded-md bg-blue-600 text-white text-[11px] font-semibold flex items-center gap-1 shrink-0">
            <Globe className="w-3 h-3" />
            <span>Web 交互预览态</span>
          </span>
          <span className="text-xs font-semibold text-slate-900 truncate">
            {currentProjectMeta.projectName}{activePageId !== '' && ` — ${activePageTitle === undefined ? '页面信息缺失' : activePageTitle}`}
          </span>
        </div>

        <div style={noDragStyle} className="flex items-center gap-2 text-xs shrink-0">
          <AccountButton /><ThemeSwitch {...theme} />

          <button
            type="button"
            onClick={() => setShowAllComponentPins(!showAllComponentPins)}
            className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1 text-[11px] border cursor-pointer transition ${
              showAllComponentPins
                ? 'bg-amber-50 text-amber-800 border-amber-300'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Pin className="w-3 h-3 text-amber-600" />
            <span>
              {showAllComponentPins
                ? `便签已开启 (${stickyNotes.length})`
                : '显示需求便签'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setWebPublishModalOpen(true)}
            className="px-2.5 py-1 rounded-md bg-white hover:bg-slate-50 text-slate-700 font-medium flex items-center gap-1 text-[11px] border border-slate-200 cursor-pointer"
          >
            <Globe className="w-3 h-3 text-slate-500" />
            <span>发布与分享</span>
          </button>

          <button
            type="button"
            onClick={() => setWebPlayerMode(false)}
            className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1 text-[11px] cursor-pointer"
          >
            <LogOut className="w-3 h-3" />
            <span>返回设计器</span>
          </button>
        </div>
      </header>
    );
  }

  return (
    <header
      style={dragRegionStyle}
      className={`h-10 ${headerLeftPadding} pr-3 border-b border-slate-200 bg-white flex items-center justify-between gap-2 z-30 select-none shrink-0 whitespace-nowrap`}
    >
      {/* Left: Sidebar Toggle + Project Switcher + Active Breadcrumb */}
      <div style={noDragStyle} className="flex items-center gap-1.5 min-w-0">
        <div className="relative group flex items-center shrink-0">
          <button
            type="button"
            onClick={toggleLeftSidebar}
            aria-label={leftSidebarCollapsed ? '展开左侧目录树' : '收起左侧目录树'}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
              !leftSidebarCollapsed
                ? 'text-slate-800 bg-slate-100 hover:bg-slate-200/70'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
          <div
            role="tooltip"
            className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full left-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
          >
            <span className="relative z-10 text-xs font-medium tracking-tight">
              {leftSidebarCollapsed ? '展开左侧面板' : '收起左侧面板'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setWelcomeScreenOpen(true)}
          className="flex items-center gap-1.5 min-w-0 max-w-[260px] px-2 py-1 rounded-md bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[11px] cursor-pointer transition"
          title={`工程目录: ${currentProjectMeta.storageDir}/${currentProjectMeta.fileName} (点击切换/新建项目)`}
        >
          <AlexLogo size={16} className="rounded-xs shrink-0" />
          <span className="font-semibold text-slate-800 truncate">{currentProjectMeta.projectName}</span>
          <span className="text-[10px] text-slate-400 shrink-0">▾</span>
        </button>

        {(activePageId !== '' || viewMode === 'mindmap' || viewMode === 'notes' || viewMode === 'project_ai') && <>
        <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />

        <span className="text-[11px] font-medium text-slate-600 px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200/80 truncate max-w-[200px]">
          {viewMode === 'mindmap' ? '项目脑图' : viewMode === 'notes' ? '项目笔记' : viewMode === 'project_ai' ? '项目 AI' : activePageTitle === undefined ? '页面信息缺失' : activePageTitle}
        </span>
        </>}
      </div>

      {/* Center: IntelliJ IDEA-style Icon Segmented Switcher */}
      <div
        style={noDragStyle}
        className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200/90 shrink-0"
      >
        {(
          [
            {
              id: 'single_page',
              label: '原型画布',
              icon: Eye,
              onClick: () => {
                setViewMode('single_page');
                setLeftSidebarTab('pages');
              },
            },
            {
              id: 'flow_canvas',
              label: '跨模块流转',
              icon: GitBranch,
              onClick: () => setViewMode('flow_canvas'),
            },
            {
              id: 'db_designer',
              label: `数据库设计 (${dbTables.length})`,
              icon: Database,
              onClick: () => {
                setViewMode('db_designer');
                setLeftSidebarTab('tables');
              },
            },
            {
              id: 'knowledge_impact',
              label: '变更影响域',
              icon: BrainCircuit,
              onClick: () => setViewMode('knowledge_impact'),
            },
            {
              id: 'closed_loop_audit',
              label: openLoopGapCount > 0 ? `闭环巡检 (${openLoopGapCount})` : '闭环巡检',
              icon: ShieldCheck,
              badge: openLoopGapCount > 0 ? openLoopGapCount : undefined,
              onClick: () => {
                setAuditScopeFilter('all');
                setViewMode('closed_loop_audit');
              },
            },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const isActive = viewMode === item.id;
          return (
            <div key={item.id} className="relative group flex items-center">
              <button
                type="button"
                aria-label={item.label}
                aria-pressed={isActive}
                onClick={item.onClick}
                className={`relative h-7 px-2 rounded-md flex items-center justify-center gap-1 transition cursor-pointer ${
                  isActive
                    ? 'bg-white text-blue-600 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {'badge' in item && item.badge ? (
                  <span className="px-1 rounded-full bg-rose-500 text-white text-[9px] font-semibold leading-tight">
                    {item.badge}
                  </span>
                ) : null}
              </button>
              <div
                role="tooltip"
                className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
              >
                <span className="relative z-10 text-xs font-medium tracking-tight">
                  {item.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Right: IntelliJ IDEA-style Compact Icon Action Bar */}
      <div style={noDragStyle} className="flex items-center gap-1 shrink-0">
        <ProjectSaveStatus />

        {viewMode === 'single_page' && (
          <div className="relative group flex items-center">
            <button
              type="button"
              aria-label={`需求便签 (${stickyNotes.length})`}
              aria-pressed={showAllComponentPins}
              onClick={() => setShowAllComponentPins(!showAllComponentPins)}
              className={`relative w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
                showAllComponentPins
                  ? 'bg-amber-50 text-amber-600 ring-1 ring-amber-200'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              <Pin className="w-3.5 h-3.5" />
              {stickyNotes.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-amber-500 text-white text-[9px] font-semibold flex items-center justify-center leading-none">
                  {stickyNotes.length}
                </span>
              )}
            </button>
            <div
              role="tooltip"
              className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
            >
              <span className="relative z-10 text-xs font-medium tracking-tight">
                {showAllComponentPins
                  ? `隐藏组件便签 (${stickyNotes.length})`
                  : `显示组件便签 (${stickyNotes.length})`}
              </span>
            </div>
          </div>
        )}

        {viewMode !== 'notes' && (
          <div className="relative group flex items-center">
            <button
              type="button"
              aria-label="分屏伴随笔记"
              aria-pressed={dockedNoteId !== null}
              onClick={() => {
                if (dockedNoteId !== null) {
                  setDockedNoteId(null);
                } else {
                  const firstNote =
                    projectNotes.nodes.find((n) => n.id === selectedNoteNodeId && n.kind === 'note') ??
                    projectNotes.nodes.find((n) => n.kind === 'note');
                  setDockedNoteId(firstNote ? firstNote.id : '__empty__');
                }
              }}
              className={`relative w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
                dockedNoteId !== null
                  ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-200'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              <BookOpenText className="w-3.5 h-3.5" />
            </button>
            <div
              role="tooltip"
              className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
            >
              <span className="relative z-10 text-xs font-medium tracking-tight">
                {dockedNoteId !== null ? '关闭右侧伴随笔记' : '开启右侧分屏伴随笔记'}
              </span>
            </div>
          </div>
        )}

        <div className="relative group flex items-center">
          <button
            type="button"
            aria-label="AI 管理中心"
            onClick={() => setHermesModalOpen(true)}
            className="relative w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer transition"
          >
            <Bot className="w-3.5 h-3.5" />
            <span
              className={`absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full ring-1 ring-white ${
                hermesStatus === 'running' ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
            />
          </button>
          <div
            role="tooltip"
            className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
          >
            <span className="relative z-10 text-xs font-medium tracking-tight">
              AI 管理中心{hermesVer ? ` · Hermes ${hermesVer}` : ''}
              {hermesStatus === 'running' && hermesUpdate ? ' (可升级)' : ''}
            </span>
          </div>
        </div>

        <div className="relative group flex items-center">
          <button
            type="button"
            aria-label="版本更新"
            onClick={() => setUpdateModalOpen(true)}
            className={`relative w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer transition ${
              appHasUpdate
                ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-200 hover:bg-blue-100/70'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            <ArrowUpCircle className="w-3.5 h-3.5" />
            {appHasUpdate && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-rose-500 ring-1 ring-white animate-pulse" />
            )}
          </button>
          <div
            role="tooltip"
            className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
          >
            <span className="relative z-10 text-xs font-medium tracking-tight">
              {appHasUpdate && appLatestRelease
                ? `发现新版本 v${appLatestRelease.version}${appUpdateStatus === 'downloaded' ? ' (已下载待安装)' : ' (点击升级)'}`
                : `桌面版本更新 · v${appVersion}`}
            </span>
          </div>
        </div>

        <AiBackgroundControl />
        <button type="button" aria-label="运行诊断" title="运行诊断" onClick={openRuntimeDiagnostics} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><Bug className="w-3.5 h-3.5" /></button>

        <div className="relative group flex items-center">
          <button
            type="button"
            aria-label="工程文件与导出"
            onClick={() => setBundleModalOpen(true)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer transition"
          >
            <Package className="w-3.5 h-3.5" />
          </button>
          <div
            role="tooltip"
            className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
          >
            <span className="relative z-10 text-xs font-medium tracking-tight">
              工程文件与导出 (.pflow)
            </span>
          </div>
        </div>

        <div className="relative group flex items-center">
          <button
            type="button"
            aria-label="发布预览"
            onClick={() => setWebPublishModalOpen(true)}
            className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white shadow-2xs cursor-pointer transition"
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
          <div
            role="tooltip"
            className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
          >
            <span className="relative z-10 text-xs font-medium tracking-tight">
              发布预览与在线分享
            </span>
          </div>
        </div>

        <div className="h-3.5 w-px bg-slate-200 mx-0.5" />

        <AccountButton /><ThemeSwitch {...theme} />

        {viewMode !== 'db_designer' && (
          <div className="relative group flex items-center">
            <button
              type="button"
              aria-label={rightSidebarCollapsed ? '展开右侧属性检视面板' : '收起右侧属性检视面板'}
              onClick={toggleRightSidebar}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
                !rightSidebarCollapsed
                  ? 'text-slate-800 bg-slate-100 hover:bg-slate-200/70'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              <PanelRight className="w-3.5 h-3.5" />
            </button>
            <div
              role="tooltip"
              className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
            >
              <span className="relative z-10 text-xs font-medium tracking-tight">
                {rightSidebarCollapsed ? '展开右侧属性面板' : '收起右侧属性面板'}
              </span>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
