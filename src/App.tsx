import { ProjectAiView } from './components/ProjectAiView';
import React, { useState } from 'react';
import { useI18n } from './i18n';
import {
  Sparkles,
  Layers,
  LayoutTemplate,
  Database,
  Package,
  Boxes,
  GitBranch,
  Network,
  BookOpenText,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { GlobalToolbar } from './components/GlobalToolbar';
import { LeftSitemapTree } from './components/LeftSitemapTree';
import { AcceptanceNewPage } from './components/AcceptanceNewPage';
import { CrossModulePages } from './components/CrossModulePages';
import { CrossModuleFlowView } from './components/CrossModuleFlowView';
import { DatabaseDesignerView } from './components/DatabaseDesignerView';
import { ProjectMindmapView } from './components/ProjectMindmapView';
import { ProjectNotesView, DockedNoteSidecar } from './components/ProjectNotesView';
import { KnowledgeImpactView } from './components/KnowledgeImpactView';
import { ClosedLoopAuditView } from './components/ClosedLoopAuditView';
import { InspectorSidebar } from './components/InspectorSidebar';
import { DesktopBundleModal } from './components/DesktopBundleModal';
import { McpConnectModal } from './components/McpConnectModal';
import { useAxureImport } from './components/AxureImportDialog';
import { ProjectWelcomeLauncher } from './components/ProjectWelcomeLauncher';
import { WebPublishModal } from './components/WebPublishModal';
import { HermesEngineModal } from './components/HermesEngineModal';
import { AppUpdateModal } from './components/AppUpdateModal';
import { ProtoCanvasDesigner } from './proto/designer/ProtoCanvasDesigner';
import { useProtoStore } from './store/useProtoStore';
import { useHermesStore } from './store/useHermesStore';
import { useUpdateStore } from './store/useUpdateStore';
import { usePageStore } from './proto/store/usePageStore';

export function App() {
  const { tr } = useI18n();
  const axure = useAxureImport();
  const {
    activePageId,
    currentProjectMeta,
    viewMode,
    setViewMode,
    isWelcomeScreenOpen,
    isProjectClosed,
    isWebPlayerMode,
    leftActivityView,
    setLeftActivityView,
    leftSidebarCollapsed,
    toggleLeftSidebar,
    rightSidebarCollapsed,
    dockedNoteId,
    isMcpModalOpen,
    mcpModalTab,
    mcpModalShareUrl,
    setMcpModalOpen,
    setWebPublishModalOpen,
  } = useProtoStore();

  const [useLegacySandbox, setUseLegacySandbox] = useState(false);

  // Desktop: detect the real local Hermes (version, skills) and restore a previous mount on launch
  React.useEffect(() => {
    void useHermesStore.getState().bootstrapHermesOnLaunch();
    void useUpdateStore.getState().bootstrapUpdaterOnLaunch();
  }, []);

  // Dev-only QA hook: ?view=db_designer&theme=dark&page=supplier-approval lets us screenshot any workspace/theme directly
  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const theme = params.get('theme');
    const page = params.get('page');
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.dataset.theme = theme;
    }
    if (view || page) {
      const store = useProtoStore.getState();
      store.setWelcomeScreenOpen(false);
      if (view) {
        store.setViewMode(view as Parameters<typeof store.setViewMode>[0]);
      }
      if (page) {
        store.setActivePage(page);
      }
    }
    const hermesParam = params.get('hermes');
    const hermesTab = params.get('hermesTab') as
      | 'overview'
      | 'update'
      | 'skills'
      | 'config'
      | null;
    if (hermesParam === '1') {
      const hStore = useHermesStore.getState();
      if (params.get('hermesDetected') === '1') {
        hStore.scanLocalHermes();
      }
      hStore.setModalOpen(true, hermesTab ?? 'overview');
    }
  }, []);

  const isDocPage = activePageId === 'doc-overview' || activePageId === 'doc-changelog';
  const isCanvasDesignerActive =
    viewMode === 'single_page' && !isDocPage && !useLegacySandbox;

  // Desktop: the welcome launcher is its own compact native window (IDEA style),
  // which expands into the full workspace once a project is opened.
  const desktop = (
    window as unknown as {
      protoflowDesktop?: { isElectron?: boolean; setWindowMode?: (m: 'welcome' | 'workspace') => Promise<boolean> };
    }
  ).protoflowDesktop;
  const isDesktopApp =
    Boolean(desktop?.isElectron) ||
    (import.meta.env.DEV && new URLSearchParams(window.location.search).get('desktopShell') === '1');

  React.useEffect(() => {
    desktop?.setWindowMode?.(isWelcomeScreenOpen ? 'welcome' : 'workspace');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWelcomeScreenOpen]);

  if ((isDesktopApp && isWelcomeScreenOpen) || isProjectClosed) {
    return (
      <>
        {axure.ui}
        <ProjectWelcomeLauncher standalone onImportRp={axure.pick} />
        <HermesEngineModal />
        <AppUpdateModal />
        {!isProjectClosed && <DesktopBundleModal />}
      </>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#F3F5F8] text-slate-900 overflow-hidden">
      {/* IntelliJ IDEA-style Welcome Launcher Modal when opening the tool or switching projects */}
      {axure.ui}
      {isWelcomeScreenOpen && <ProjectWelcomeLauncher onImportRp={axure.pick} />}

      {/* Top Antigravity-style Single-Line Draggable Titlebar */}
      <GlobalToolbar />

      {/* Classic Left-Center-Right Enterprise Prototype & Schema Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* VS Code-style Far-Left Activity Bar (Icon Rail) */}
        {!isWebPlayerMode && (
          <nav
            aria-label={tr('左侧工作区导航栏', 'Workspace Navigation Bar')}
            className="w-11 shrink-0 bg-slate-100/90 border-r border-slate-200 flex flex-col items-center justify-between py-2 select-none z-40"
          >
            <div className="flex flex-col items-center gap-1 w-full">
              {(
                [
                  { id: 'pages', label: tr('页面目录', 'Pages'), icon: Layers },
                  { id: 'notes', label: tr('项目笔记', 'Project Notes'), icon: BookOpenText },
                  { id: 'tables', label: tr('数据库表', 'Database Tables'), icon: Database },
                  { id: 'mindmap', label: tr('项目脑图', 'Mindmaps'), icon: Network },
                  { id: 'project_ai', label: tr('项目 AI', 'Project AI'), icon: Sparkles },
                  { id: 'materials', label: tr('物料组件库', 'Components'), icon: Package, dividerBefore: true },
                  { id: 'composites', label: tr('业务复合块', 'Composite Blocks'), icon: Boxes },
                  { id: 'outline', label: tr('页面大纲树', 'Page Outline'), icon: GitBranch },
                  { id: 'ai', label: tr('页面模板', 'Page Templates'), icon: LayoutTemplate },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const effectiveView =
                  !isCanvasDesignerActive &&
                  item.id !== 'pages' &&
                  item.id !== 'tables'
                    ? leftActivityView === 'tables'
                      ? 'tables'
                      : 'pages'
                    : leftActivityView;
                const isActive =
                  item.id === 'project_ai'
                    ? viewMode === 'project_ai'
                    : item.id === 'mindmap'
                    ? viewMode === 'mindmap'
                    : item.id === 'notes'
                    ? viewMode === 'notes'
                    : viewMode !== 'project_ai' &&
                      viewMode !== 'mindmap' &&
                      viewMode !== 'notes' &&
                      !leftSidebarCollapsed &&
                      effectiveView === item.id;
                return (
                  <React.Fragment key={item.id}>
                    {'dividerBefore' in item && item.dividerBefore && (
                      <div className="w-5 h-px bg-slate-200/90 my-1" />
                    )}
                    <div className="relative group flex items-center justify-center">
                      <button
                        type="button"
                        aria-label={item.label}
                        aria-pressed={isActive}
                        disabled={activePageId === '' && ['materials','composites','outline','ai'].includes(item.id)}
                        onClick={() => {
                          if (item.id === 'project_ai') { setViewMode('project_ai'); return; }
                          if (item.id === 'mindmap') {
                            setViewMode('mindmap');
                            return;
                          }
                          if (item.id === 'notes') {
                            setViewMode('notes');
                            return;
                          }
                          if (isActive) {
                            toggleLeftSidebar();
                            return;
                          }
                          if (item.id === 'tables') {
                            setLeftActivityView('tables');
                            setViewMode('db_designer');
                          } else if (item.id === 'pages') {
                            setLeftActivityView('pages');
                            if (viewMode === 'project_ai' || viewMode === 'db_designer' || viewMode === 'mindmap' || viewMode === 'notes') {
                              setViewMode('single_page');
                            }
                          } else {
                            setLeftActivityView(item.id);
                            if (useLegacySandbox) setUseLegacySandbox(false);
                          }
                        }}
                        className={`relative w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer transition disabled:opacity-40 disabled:cursor-default ${
                          isActive
                            ? 'bg-white text-blue-600 shadow-2xs ring-1 ring-slate-200/90'
                            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/60'
                        }`}
                      >
                        {isActive && (
                          <span className="absolute -left-1 top-2 bottom-2 w-0.5 rounded-r bg-blue-600" />
                        )}
                        <Icon className="w-4 h-4" />
                      </button>

                      {/* Refined Compact Floating Tooltip */}
                      <div
                        role="tooltip"
                        className="pointer-events-none opacity-0 -translate-x-1 scale-95 group-hover:opacity-100 group-hover:translate-x-0 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:translate-x-0 group-focus-within:scale-100 transition-all duration-150 ease-out absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
                      >
                        <span
                          aria-hidden="true"
                          className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-white border-l border-b border-slate-200/90"
                        />
                        <span className="relative z-10 text-xs font-medium tracking-tight">
                          {item.label}
                        </span>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            <div className="relative group flex items-center justify-center">
              <button
                type="button"
                onClick={toggleLeftSidebar}
                aria-label={leftSidebarCollapsed ? tr('展开左侧面板', 'Expand left sidebar') : tr('收起左侧面板', 'Collapse left sidebar')}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer transition"
              >
                {leftSidebarCollapsed ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>
              <div
                role="tooltip"
                className="pointer-events-none opacity-0 -translate-x-1 scale-95 group-hover:opacity-100 group-hover:translate-x-0 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:translate-x-0 group-focus-within:scale-100 transition-all duration-150 ease-out absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
              >
                <span
                  aria-hidden="true"
                  className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-white border-l border-b border-slate-200/90"
                />
                <span className="relative z-10 text-xs font-medium tracking-tight">
                  {leftSidebarCollapsed ? tr('展开侧边栏', 'Expand Sidebar') : tr('收起侧边栏', 'Collapse Sidebar')}
                </span>
              </div>
            </div>
          </nav>
        )}

        {/* Single Left Primary Sidebar Drawer: Sitemap/Tables OR Canvas Materials/Outline */}
        {viewMode !== 'project_ai' && viewMode !== 'mindmap' && viewMode !== 'notes' && !leftSidebarCollapsed &&
          (leftActivityView === 'pages' ||
            leftActivityView === 'tables' ||
            !isCanvasDesignerActive) && <LeftSitemapTree />}

        {/* Center: 1. Visual Page & Overlay Designer | 2. Cross-Module Flow | 3. DB Designer | 4. AI Knowledge & Impact | 5. AI Closed-Loop Audit */}
        <main
          className={`flex-1 bg-[#F3F5F8] min-w-0 ${
            viewMode === 'project_ai' || viewMode === 'db_designer' || viewMode === 'mindmap' || viewMode === 'notes' || isCanvasDesignerActive
              ? 'overflow-hidden flex flex-col p-0'
              : 'overflow-y-auto p-4'
          }`}
        >
          {viewMode === 'project_ai' ? (<ProjectAiView key={currentProjectMeta.projectId} projectId={currentProjectMeta.projectId} />) : viewMode === 'mindmap' ? (
            <ProjectMindmapView key={currentProjectMeta.projectId} projectId={currentProjectMeta.projectId} />
          ) : viewMode === 'notes' ? (
            <ProjectNotesView key={currentProjectMeta.projectId} projectId={currentProjectMeta.projectId} />
          ) : viewMode === 'closed_loop_audit' ? (
            <ClosedLoopAuditView />
          ) : viewMode === 'knowledge_impact' ? (
            <KnowledgeImpactView />
          ) : viewMode === 'db_designer' ? (
            <DatabaseDesignerView />
          ) : viewMode === 'flow_canvas' ? (
            <CrossModuleFlowView />
          ) : activePageId === '' ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center"><div>
              <h2 className="text-lg font-semibold text-slate-700">{tr('还没有页面', 'No Pages Yet')}</h2>
              <p className="mt-2 text-sm text-slate-500">{tr('在左侧创建目录和页面，或把需求告诉项目 AI。', 'Create folders and pages on the left, or describe your requirements to Project AI.')}</p>
              <button type="button" onClick={() => setViewMode('project_ai')} className="mt-4 text-sm font-medium text-blue-600 hover:underline">{tr('打开项目 AI', 'Open Project AI')}</button>
            </div></div>
          ) : isCanvasDesignerActive ? (
            <ProtoCanvasDesigner
              key={`${currentProjectMeta.projectId}:${activePageId}`}
              pageId={activePageId}
              onSwitchToLegacySandbox={() => setUseLegacySandbox(true)}
            />
          ) : (
            <div className="space-y-3">
              {!isDocPage && (
                <div className="max-w-6xl mx-auto px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between gap-3 text-xs">
                  <span className="text-blue-900 font-medium min-w-0">
                    {tr('当前处于经典静态演示沙盒视图，可随时切换回「代码为底·控件为表」的可视化原型画布设计器。', 'Viewing classic static demo sandbox. Switch back anytime to the code-backed visual canvas designer.')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setUseLegacySandbox(false)}
                    className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{tr('返回可视化画布设计器', 'Back to Visual Canvas')}</span>
                  </button>
                </div>
              )}
              {activePageId === 'acceptance-new' ? (
                <AcceptanceNewPage />
              ) : (
                <CrossModulePages />
              )}
            </div>
          )}
        </main>

        {/* Right: Collapsible Antigravity-style AI & Widget Inspector Sidecar (Hidden in DB Designer & Canvas Designer which has its own AST NodeInspectorPanel) */}
        {!isWebPlayerMode &&
          !rightSidebarCollapsed &&
          viewMode !== 'project_ai' && viewMode !== 'db_designer' &&
          viewMode !== 'mindmap' &&
          viewMode !== 'notes' &&
          !isCanvasDesignerActive && <InspectorSidebar />}

        {/* Split-screen Docked Companion Note Sidecar (for side-by-side Prototype / DB & Note comparison) */}
        {!isWebPlayerMode && viewMode !== 'notes' && dockedNoteId !== null && (
          <DockedNoteSidecar
            key={`${currentProjectMeta.projectId}:${dockedNoteId}`}
            projectId={currentProjectMeta.projectId}
            noteId={dockedNoteId}
          />
        )}
      </div>

      {/* Desktop .pflow Archive & Git Version Control Modal */}
      <DesktopBundleModal />

      {/* Read-Only MCP Spec Server Connection Modal (Local .pflow & Remote Share HTTP) */}
      <McpConnectModal
        open={isMcpModalOpen}
        onClose={() => setMcpModalOpen(false)}
        initialTab={mcpModalTab}
        initialShareUrl={mcpModalShareUrl}
        onOpenPublishModal={() => setWebPublishModalOpen(true)}
      />

      {/* Axure-style Publish to Interactive Web Page / Standalone HTML Modal */}
      <WebPublishModal />

      {/* Embedded Hermes Agent Runtime & Gateway Manager Modal */}
      <HermesEngineModal inlineFeedback />

      {/* Multi-Platform Desktop Version Update Modal */}
      <AppUpdateModal />
    </div>
  );
}

export default App;
