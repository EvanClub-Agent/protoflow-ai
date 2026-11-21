import { MermaidTemplatePicker } from './MermaidTemplatePicker';
import { MERMAID_DIAGRAM_TEMPLATES, mermaidTypeLabel } from '../services/mermaidCatalog';
import { MindmapDirectory, MindmapRelations } from './MindmapDirectory';
import { mindmapPath } from '../proto/mindmaps';
import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  BookOpen,
  Braces,
  ChevronDown,
  ChevronUp,
  Code2,
  Download,
  FileDown,
  GitBranch,
  Hand,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Sparkles,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { MINDMAP_THEMES, renderMermaidDiagram, type MindmapThemeId } from '../services/mindmapRenderer';
import { conversationKey } from '../services/hermesConversation';
import { useMindmapAiStore } from '../services/hermesMindmap';
import { MindmapAiPanel } from './MindmapAiPanel';
import { useI18n } from '../i18n';

const starterSourceZh = `mindmap
  root((项目规划))
    项目目标
      用户需求
      核心价值
    功能模块
      核心功能
      后续迭代
    交付计划
      原型设计
      开发与验收
`;

const starterSourceEn = `mindmap
  root((Project Plan))
    Objectives
      User Needs
      Core Value
    Modules
      Core Features
      Next Iteration
    Delivery Plan
      Prototype Design
      Build & Acceptance
`;

function getSnippetTemplates(tr: <T extends string>(zh: T, en: string) => string, isEn: boolean): { label: string; desc: string; code: string; mode: 'replace' | 'append' }[] {
  return [
    {
      label: tr('项目规划全景思维导图 (Mindmap)', 'Project Overview Mindmap'),
      desc: tr('目标、模块拆解与交付里程碑', 'Objectives, module breakdown & delivery milestones'),
      mode: 'replace',
      code: isEn ? starterSourceEn : starterSourceZh,
    },
    {
      label: tr('采购审批管理流程图 (Flowchart TB)', 'Procurement Approval Flowchart (TB)'),
      desc: tr('多级子图、条件分支与自定义节点配色', 'Subgraphs, decision branches & custom node colors'),
      mode: 'replace',
      code: isEn
        ? `---
config:
  layout: dagre
---
flowchart TB
  START(["Start Procurement"]) --> A1["Submit Request"]
  subgraph PLAN["1. Planning & Approval"]
    A1 --> A2{"Within Budget?"}
    A2 -->|Approved| A3["Create Procurement Plan"]
    A2 -->|Rejected| A1
  end
  subgraph SOURCE["2. Sourcing & Order"]
    A3 --> B1{"Sourcing Mode"}
    B1 -->|Catalog| B2["Create Purchase Order"]
    B1 -->|RFQ| B3["Compare Quotes & Award"]
    B3 --> B2
  end
  B2 --> DONE(["Receiving & Payment"])
  classDef approval fill:#fff3cd,stroke:#d39e00,color:#664d03
  classDef success fill:#d1e7dd,stroke:#198754,color:#0f5132
  class A2,B1 approval
  class B2,DONE success
`
        : `---
config:
  layout: dagre
---
flowchart TB
  START(["采购业务开始"]) --> A1["提报采购需求"]
  subgraph PLAN["一、计划与审批"]
    A1 --> A2{"预算是否合规?"}
    A2 -->|通过| A3["生成采购计划单"]
    A2 -->|驳回| A1
  end
  subgraph SOURCE["二、寻源与订单"]
    A3 --> B1{"采购方式判定"}
    B1 -->|标内目录| B2["直接生成采购订单"]
    B1 -->|标外询价| B3["多方比价与定标"]
    B3 --> B2
  end
  B2 --> DONE(["入库验收与付款登记"])
  classDef approval fill:#fff3cd,stroke:#d39e00,color:#664d03
  classDef success fill:#d1e7dd,stroke:#198754,color:#0f5132
  class A2,B1 approval
  class B2,DONE success
`,
    },
    {
      label: tr('前后端业务调用时序图 (Sequence)', 'End-to-End Sequence Diagram'),
      desc: tr('用户、前端页面、服务端与数据库交互链路', 'User, frontend page, service layer & database sequence'),
      mode: 'replace',
      code: isEn
        ? `sequenceDiagram
  autonumber
  actor User as Operator
  participant Page as Prototype Page
  participant Service as Domain Service
  participant DB as Business Table
  User->>Page: Select booked invoices & click "Batch Pay"
  Page->>Service: Validate invoice status & payment date
  Service->>DB: Write payment date, operator & status
  DB-->>Service: Return updated rows
  Service-->>Page: Refresh grid & show confirmation
`
        : `sequenceDiagram
  autonumber
  actor User as 业务人员
  participant Page as 前端原型页面
  participant Service as 业务服务层
  participant DB as 业务数据表
  User->>Page: 勾选已入账发票并点击「批量付款」
  Page->>Service: 校验发票状态与付款日期
  Service->>DB: 写入付款日期、登记人与状态
  DB-->>Service: 返回更新结果
  Service-->>Page: 刷新列表并提示登记成功
`,
    },
    {
      label: tr('核心单据 ER 实体关系图 (ER Diagram)', 'Core Entity ER Diagram'),
      desc: tr('梳理主单据表、明细子表与基础字典表关联', 'Header tables, line-item detail tables & master lookups'),
      mode: 'replace',
      code: `erDiagram
  SUPPLIER ||--o{ INVOICE : issues
  INVOICE ||--|{ PAYMENT_RECORD : settles
  SUPPLIER {
    string supplier_id PK
    string supplier_name
    string credit_code
  }
  INVOICE {
    string invoice_no PK
    string supplier_id FK
    decimal total_amount
    string status
  }
  PAYMENT_RECORD {
    string payment_id PK
    string invoice_no FK
    date payment_date
    string operator_name
  }
`,
    },
    {
      label: tr('追加思维导图分支节点', 'Append Mindmap Branch'),
      desc: tr('在当前思维导图末尾追加一个二级分支', 'Append a secondary branch at the end of the mindmap'),
      mode: 'append',
      code: isEn ? `\n    New Branch\n      Sub-feature 1\n      Sub-feature 2` : `\n    新增业务分支\n      子功能点一\n      子功能点二`,
    },
  ];
}

type Preview = { source: string; dark: boolean; themeId: MindmapThemeId; svg: string; error: string; diagramType: string | null };

function download(content: string, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProjectMindmapView({ projectId }: { projectId: string }) {
  const { tr } = useI18n();
  const data = useProtoStore(state => state.mindmaps);
  const selectedId = useProtoStore(state => state.selectedMindmapNodeId);
  const selected = data.nodes.find(node => node.id === selectedId);
  return (
    <div className="flex h-full min-h-0 min-w-0 max-md:flex-col bg-white">
      <MindmapDirectory projectId={projectId} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selected?.kind === 'mindmap' ? (
          <MindmapDocumentView key={selected.id} projectId={projectId} mindmapId={selected.id} />
        ) : (
          <>
            {selected && <MindmapRelations key={selected.id} projectId={projectId} node={selected} />}
            <div className="pf-mermaid-canvas-grid flex min-h-52 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-md shadow-rose-500/20">
                <Network size={24} />
              </div>
              <h1 className="text-sm font-semibold text-slate-800">
                {selected ? mindmapPath(data, selected.id) : tr('项目脑图', 'Project Mindmaps')}
              </h1>
              <p className="max-w-80 text-xs leading-6 text-slate-500">
                {selected
                  ? tr(
                      '在此目录中新建或选择脑图菜单。目录的页面关联会用于其下各张脑图的生成。',
                      'Create or select a mindmap item in this folder. Folder page links are inherited when generating diagrams inside it.'
                    )
                  : tr(
                      '在左侧新建脑图目录或菜单，按不同模块整理思路。每个脑图菜单独立编辑和生成。',
                      'Create folders or mindmap items on the left to organize ideas by module. Each mindmap is edited and generated independently.'
                    )}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MindmapDocumentView({ projectId, mindmapId }: { projectId: string; mindmapId: string }) {
  const { isEn, tr, td } = useI18n();
  const starterSource = isEn ? starterSourceEn : starterSourceZh;
  const snippetTemplates = getSnippetTemplates(tr, isEn);
  const data = useProtoStore(state => state.mindmaps);
  const node = data.nodes.find(node => node.id === mindmapId);
  const source = node?.kind === 'mindmap' ? node.source : '';
  const title = node === undefined ? '' : node.title;
  const projectName = useProtoStore(state => state.currentProjectMeta.projectName);
  const setMindmapSource = useProtoStore(state => state.setMindmapSource);
  const setBundleModalOpen = useProtoStore(state => state.setBundleModalOpen);

  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  const [themeId, setThemeId] = useState<MindmapThemeId>('redux');
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [docsOpen, setDocsOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [codeCollapsed, setCodeCollapsed] = useState(false);
  const [panMode, setPanMode] = useState(true);
  const [compactPad, setCompactPad] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const hasSource = source.trim().length > 0;
  const currentPreview =
    preview?.source === source && preview.dark === dark && preview.themeId === themeId
      ? preview
      : null;
  const isRendering = hasSource && currentPreview === null;
  const desktop = Boolean(
    (window as unknown as { protoflowDesktop?: { isElectron?: boolean } }).protoflowDesktop?.isElectron
  );
  const activeTheme = MINDMAP_THEMES.find(t => t.id === themeId) ?? MINDMAP_THEMES[0];
  const aiScopeKey = conversationKey({ projectId, kind: 'mindmap', mindmapId });
  const isAiGenerating = useMindmapAiStore(state => state.runs[aiScopeKey]?.status === 'running');

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === 'dark')
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  const triggerRender = (src: string, isDark: boolean, palette: MindmapThemeId) => {
    if (!src.trim()) return () => {};
    let cancelled = false;
    const timer = setTimeout(() => {
      void renderMermaidDiagram(src, isDark, palette).then(
        result => {
          if (!cancelled) setPreview({ source: src, dark: isDark, themeId: palette, svg: result.svg, diagramType: result.diagramType, error: '' });
        },
        error => {
          if (!cancelled)
            setPreview({
              source: src,
              dark: isDark,
              themeId: palette,
              svg: '',
              diagramType: null,
              error: error instanceof Error ? error.message : String(error),
            });
        }
      );
    }, 260);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  };

  useEffect(() => {
    if (!autoUpdate && preview !== null) return;
    return triggerRender(source, dark, themeId);
  }, [source, dark, themeId, autoUpdate]);

  const updateSource = (next: string) => setMindmapSource(projectId, mindmapId, next);
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const lineCount = Math.max(1, source.split('\n').length);
  const fileName = `${projectName}-${title}`.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  const directionMatch = /(?:^|\n)(\s*(?:flowchart|graph|swimlane(?:-beta)?)\s+)(TB|TD|LR|RL|BT)\b/.exec(source);
  const flowDirection = directionMatch ? directionMatch[2] : null;
  const isHorizontalFlow = flowDirection === 'LR' || flowDirection === 'RL';
  const toggleFlowDirection = () => {
    if (!directionMatch) return;
    const nextDir = isHorizontalFlow ? 'TB' : 'LR';
    updateSource(
      source.replace(
        /(?:^|\n)(\s*(?:flowchart|graph|swimlane(?:-beta)?)\s+)(TB|TD|LR|RL|BT)\b/,
        (full, prefix) => `${full.startsWith('\n') ? '\n' : ''}${prefix.trimStart() ? prefix : prefix}${nextDir}`
      )
    );
  };
  const activeTemplate = currentPreview?.diagramType
    ? MERMAID_DIAGRAM_TEMPLATES.find(item => item.diagramTypes.includes(currentPreview.diagramType!))
    : undefined;
  const activeDocUrl = activeTemplate?.docs ?? 'https://mermaid.js.org/intro/syntax-reference.html';
  const topBtnClass =
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer transition shadow-2xs';
  const hudPillClass =
    'inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/95 backdrop-blur-md px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer transition';
  const dockIconBtnClass =
    'flex h-8 w-8 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition';

  return (
    <section aria-label={tr('项目脑图工作区', 'Project mindmap workspace')} className="flex h-full min-h-0 flex-col bg-white">
      {/* Official mermaid.ai style Top Studio Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/90 bg-white px-4 py-2.5 shrink-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#ff3670] text-white shadow-2xs">
            <Network size={15} />
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="font-medium text-[#ff3670] shrink-0">{tr('项目脑图', 'Mindmap')}</span>
            <span className="text-slate-300">/</span>
            <h1 className="truncate text-sm font-semibold text-slate-900">{title}</h1>
            <span className="hidden sm:inline-block truncate max-w-56 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
              {mindmapPath(data, mindmapId)}
            </span>
          </div>
          <span
            role="status"
            className="ml-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 whitespace-nowrap shrink-0"
          >
            {isRendering ? (
              <>
                <Loader2 size={11} className="animate-spin text-blue-600" />
                {tr('正在绘制…', 'Rendering…')}
              </>
            ) : currentPreview?.error ? (
              <span className="text-amber-600">{tr('需要修正语法', 'Syntax error')}</span>
            ) : (
              <span className="text-emerald-600">{tr('● 实时预览', '● Live Preview')}</span>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={topBtnClass}
            disabled={!hasSource}
            onClick={() => download(source, 'text/plain;charset=utf-8', `${fileName}-${tr('脑图', 'mindmap')}.mmd`)}
          >
            <Code2 size={14} />
            {tr('导出源码', 'Export .mmd')}
          </button>
          <button
            type="button"
            className={topBtnClass}
            disabled={!currentPreview?.svg}
            onClick={() => {
              if (currentPreview?.svg)
                download(currentPreview.svg, 'image/svg+xml;charset=utf-8', `${fileName}-${tr('脑图', 'mindmap')}.svg`);
            }}
          >
            <Download size={14} />
            {tr('导出 SVG', 'Export SVG')}
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap shrink-0 cursor-pointer transition shadow-2xs"
            onClick={() => setBundleModalOpen(true)}
          >
            <FileDown size={14} />
            {tr('导出工程', 'Export Project')}
          </button>
        </div>
      </header>

      {node && <MindmapRelations projectId={projectId} node={node} />}

      {/* Main Studio Body: Left Code Editor Card + Right Infinite Crosshair Canvas */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row bg-slate-50/80">
        {/* Left Floating-Style </> Code Card */}
        <div
          className={`flex flex-col overflow-hidden border-b border-slate-200/90 bg-white transition-all lg:border-b-0 ${
            codeCollapsed
              ? 'h-0 min-h-0 lg:h-auto lg:w-0 lg:border-r-0 opacity-0 pointer-events-none'
              : 'h-1/2 min-h-56 lg:h-auto lg:w-[340px] lg:shrink-0 lg:border-r xl:w-[380px] lg:m-2 lg:mr-0 lg:rounded-2xl lg:border lg:shadow-xs'
          }`}
        >
          {/* Code Card Top Bar: </> Code | Auto-Update Toggle | Docs | Close */}
          <div className="pf-mermaid-code-header flex h-10 shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 px-3.5">
            <label
              htmlFor="project-mindmap-source"
              className="flex items-center gap-1.5 text-xs font-bold text-slate-800 cursor-pointer"
            >
              <Code2 size={15} className="text-slate-700" />
              <span>Code</span>
              <span className="sr-only">{tr('脑图源码', 'Mindmap source')}</span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={autoUpdate}
                onClick={() => setAutoUpdate(prev => !prev)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer"
                title={tr('开启后修改源码自动实时重绘脑图', 'Automatically re-render diagram as you edit code')}
              >
                <span
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                    autoUpdate ? 'bg-teal-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      autoUpdate ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </span>
                <span>Auto-Update</span>
              </button>

              {!autoUpdate && (
                <button
                  type="button"
                  onClick={() => triggerRender(source, dark, themeId)}
                  className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-teal-700 cursor-pointer"
                >
                  <RefreshCw size={11} />
                  {tr('刷新', 'Render')}
                </button>
              )}

              <span className="h-3.5 w-px bg-slate-300/80" />

              <button
                type="button"
                onClick={() => setDocsOpen(prev => !prev)}
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium cursor-pointer transition ${
                  docsOpen
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-700 hover:bg-white/70'
                }`}
                title={tr('查看 Mermaid 图表语法', 'View Mermaid diagram syntax reference')}
              >
                <BookOpen size={12} />
                <span>Docs</span>
              </button>

              <button
                type="button"
                onClick={() => setCodeCollapsed(true)}
                className="rounded-md p-1 text-slate-500 hover:bg-white/70 hover:text-slate-800 cursor-pointer max-lg:hidden"
                title={tr('收起代码面板', 'Collapse code panel')}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <MermaidTemplatePicker source={source} onApply={updateSource} />

          {/* Optional Docs Quick-Reference Drawer */}
          {docsOpen && (
            <div className="shrink-0 border-b border-slate-200 bg-slate-50/90 px-3.5 py-2.5 text-[11px] leading-5 text-slate-600 space-y-1">
              <div className="flex items-center justify-between font-semibold text-slate-800">
                <span>{tr('Mermaid 图表语法', 'Mermaid Syntax Reference')}</span>
                <span className="font-mono text-[10px] text-teal-700">
                  {currentPreview?.diagramType === null || !currentPreview
                    ? 'Mermaid'
                    : td(mermaidTypeLabel(currentPreview.diagramType))}
                </span>
              </div>
              {isEn ? (
                <>
                  <p>
                    Use <code>mindmap</code> with indentation for mindmaps; <code>flowchart TB</code> with arrows for flowcharts;{' '}
                    <code>sequenceDiagram</code> for sequences; and <code>erDiagram</code> for entity relations.
                  </p>
                  <p>Supports YAML frontmatter, subgraphs, edge labels, and custom styles. Use the template picker above for 31 diagram types.</p>
                </>
              ) : (
                <>
                  <p>
                    思维导图用 <code>mindmap</code> 和缩进；流程图用 <code>flowchart TB</code> 与箭头；时序图用{' '}
                    <code>sequenceDiagram</code>；数据关系用 <code>erDiagram</code>。
                  </p>
                  <p>支持 YAML 配置、子图、连线文字及自定义样式。选择上方模板类型可一键载入 31 种图表模板。</p>
                </>
              )}
              <a
                href={activeDocUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block font-medium text-teal-700 hover:text-teal-800 underline"
              >
                {tr('打开当前图表官方语法文档 ↗', 'Open official Mermaid syntax docs ↗')}
              </a>
            </div>
          )}

          {/* Line-Numbered Monospace Code Editor */}
          <div className="relative flex min-h-0 flex-1 overflow-hidden bg-white">
            <div
              ref={gutterRef}
              aria-hidden="true"
              className="select-none overflow-hidden border-r border-slate-100 bg-slate-50/60 py-3.5 pr-2.5 pl-3 text-right font-mono text-[12px] leading-6 text-slate-400"
            >
              {Array.from({ length: lineCount }, (_, idx) => (
                <div key={idx + 1}>{idx + 1}</div>
              ))}
            </div>

            <textarea
              id="project-mindmap-source"
              aria-label={tr('脑图源码', 'Mindmap source')}
              value={source}
              spellCheck={false}
              wrap="off"
              placeholder={tr('mindmap\n  root((我的项目))\n    第一个想法\n    第二个想法', 'mindmap\n  root((My Project))\n    First Idea\n    Second Idea')}
              onChange={event => updateSource(event.target.value)}
              onScroll={event => {
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
              className="min-h-40 w-full flex-1 resize-none bg-white px-3.5 py-3.5 font-mono text-[12.5px] leading-6 text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500/40"
            />
          </div>

          {/* Bottom [ ] Snippets Bar & Expandable Template Drawer */}
          <div className="shrink-0 border-t border-slate-200/90 bg-slate-50/80">
            {snippetsOpen && (
              <div className="border-b border-slate-200/80 bg-white p-2.5 space-y-1.5 max-h-48 overflow-y-auto">
                <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {tr('快速插入模板与片段', 'Quick Templates & Snippets')}
                </div>
                {snippetTemplates.map((tpl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      updateSource(tpl.mode === 'append' && source.trim() ? `${source.trimEnd()}${tpl.code}\n` : tpl.code);
                      setSnippetsOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 hover:border-teal-300 hover:bg-teal-50/40 px-2.5 py-1.5 text-left transition cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-800 truncate">{tpl.label}</div>
                      <div className="text-[10.5px] text-slate-500 truncate">{tpl.desc}</div>
                    </div>
                    <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-teal-700 border border-slate-200/80">
                      {tpl.mode === 'append' ? tr('+ 追加', '+ Append') : tr('应用', 'Apply')}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setSnippetsOpen(prev => !prev)}
              className="flex w-full items-center justify-between px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100/80 cursor-pointer transition"
            >
              <span className="inline-flex items-center gap-1.5">
                <Braces size={13} className="text-slate-500" />
                <span>Snippets</span>
                <span className="text-[11px] font-normal text-slate-400">{tr('· 常用图表模板', '· Common Diagram Snippets')}</span>
              </span>
              {snippetsOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronUp size={14} className="text-slate-400" />}
            </button>
          </div>
        </div>

        {/* Right Infinite Crosshair Canvas Stage + Floating HUD Controls + Apple Intelligence Aura */}
        <div
          data-ai-active={isAiGenerating ? '1' : undefined}
          className="pf-canvas-viewport-shell pf-mermaid-canvas-grid relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden m-1.5 lg:m-2 rounded-[20px] border border-slate-200/90 shadow-2xs"
        >
          {/* Apple Intelligence Iridescent 4-Edge Screen Aura around the Mindmap Rendering Area */}
          {isAiGenerating && <div aria-hidden="true" className="pf-ai-viewport-aura" />}

          {/* 1. Top-Right Floating Theme & Layout Pills (Redux Color theme | Adaptive | Hierarchy | Auto) */}
          <div className="pointer-events-none absolute top-3 right-3 left-3 z-20 flex flex-wrap items-center justify-between gap-2">
            <div className="pointer-events-auto flex items-center gap-1.5">
              {codeCollapsed && (
                <button
                  type="button"
                  onClick={() => setCodeCollapsed(false)}
                  className={hudPillClass}
                  title={tr('展开左侧代码编辑器', 'Expand left code editor')}
                >
                  <PanelLeftOpen size={14} className="text-teal-600" />
                  <span>Code</span>
                </button>
              )}
            </div>

            <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 ml-auto">
              {/* Theme Selector Pill with Rainbow Ring */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setThemeMenuOpen(prev => !prev)}
                  className={hudPillClass}
                  title={tr('切换脑图配色主题', 'Switch diagram color theme')}
                >
                  <span>{td(activeTheme.label)}</span>
                  <span
                    className="inline-block h-3.5 w-3.5 rounded-full border border-white shadow-2xs"
                    style={{
                      background: `conic-gradient(${activeTheme.swatch[0]}, ${activeTheme.swatch[1]}, ${activeTheme.swatch[2]}, ${activeTheme.swatch[3]}, ${activeTheme.swatch[0]})`,
                    }}
                  />
                </button>

                {themeMenuOpen && (
                  <div className="absolute right-0 mt-1.5 w-48 rounded-xl border border-slate-200/90 bg-white/95 p-1.5 shadow-xl backdrop-blur-md z-30">
                    {MINDMAP_THEMES.map(theme => (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => {
                          setThemeId(theme.id);
                          setThemeMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition cursor-pointer ${
                          theme.id === themeId
                            ? 'bg-teal-50 font-semibold text-teal-700'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="truncate">{td(theme.label)}</span>
                        <span className="flex items-center gap-0.5 shrink-0">
                          {theme.swatch.map((color, i) => (
                            <span
                              key={i}
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Adaptive Spacing Pill */}
              <button
                type="button"
                onClick={() => setCompactPad(prev => !prev)}
                className={hudPillClass}
                title={tr('切换画布留白密度', 'Toggle canvas padding density')}
              >
                <span>{compactPad ? 'Compact' : 'Adaptive'}</span>
                <GitBranch size={13} className="text-slate-500" />
              </button>

              {/* Flow Direction Pill (Top to bottom ↓ / Left to right →) when editing a directional diagram */}
              {flowDirection && (
                <button
                  type="button"
                  onClick={toggleFlowDirection}
                  className={hudPillClass}
                  title={tr('切换流程图排列方向 (Top to bottom / Left to right)', 'Toggle flowchart direction (Top to bottom / Left to right)')}
                >
                  <span>{isHorizontalFlow ? 'Left to right' : 'Top to bottom'}</span>
                  {isHorizontalFlow ? (
                    <ArrowRight size={13} className="text-slate-600" />
                  ) : (
                    <ArrowDown size={13} className="text-slate-600" />
                  )}
                </button>
              )}

              {/* Diagram Type Badge */}
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/95 backdrop-blur-md px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                <span>{currentPreview?.diagramType ? td(mermaidTypeLabel(currentPreview.diagramType)) : 'Mermaid'}</span>
                <Network size={13} className="text-slate-500" />
              </span>

              {/* Auto Fit Pill */}
              <button
                type="button"
                onClick={resetView}
                className={hudPillClass}
                title={tr('自动居中并重置缩放比例', 'Center diagram and reset zoom')}
              >
                <span>Auto</span>
                <Sparkles size={12} className="text-teal-600" />
              </button>
            </div>
          </div>

          {/* 2. Left-Middle Floating Quick Tool Dock */}
          <div className="pointer-events-auto absolute top-1/2 left-3 z-20 -translate-y-1/2 hidden sm:flex flex-col gap-1 rounded-2xl border border-slate-200/90 bg-white/95 p-1.5 shadow-md backdrop-blur-md">
            <button
              type="button"
              onClick={() => setCodeCollapsed(prev => !prev)}
              className={dockIconBtnClass}
              title={codeCollapsed ? tr('展开源码面板', 'Expand code panel') : tr('收起源码面板', 'Collapse code panel')}
            >
              {codeCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
            <button
              type="button"
              onClick={() => {
                updateSource(
                  source.trim()
                    ? `${source.trimEnd()}\n    ${tr('新分支', 'New Branch')}\n      ${tr('子节点', 'Child Node')}\n`
                    : starterSource
                );
              }}
              className={dockIconBtnClass}
              disabled={currentPreview?.diagramType !== 'mindmap'}
              title={currentPreview?.diagramType === 'mindmap' ? tr('快速追加分支节点', 'Quick-append branch node') : tr('追加分支仅适用于思维导图', 'Append branch applies to mindmaps only')}
            >
              <Type size={15} />
            </button>
            <button
              type="button"
              disabled={!currentPreview?.svg}
              onClick={() => {
                if (currentPreview?.svg)
                  download(currentPreview.svg, 'image/svg+xml;charset=utf-8', `${fileName}-${tr('脑图', 'mindmap')}.svg`);
              }}
              className={dockIconBtnClass}
              title={tr('下载 SVG 矢量图', 'Download SVG vector graphic')}
            >
              <ImageIcon size={15} />
            </button>
            <button
              type="button"
              onClick={() => setDocsOpen(prev => !prev)}
              className={dockIconBtnClass}
              title={tr('打开或关闭语法参考', 'Toggle syntax reference')}
            >
              <BookOpen size={15} />
            </button>
          </div>

          {/* 3. Right-Middle Floating Pan & Zoom Dock (Hand | ZoomIn | ZoomOut | 1:1 | Fit) */}
          <div className="pointer-events-auto absolute top-1/2 right-3 z-20 -translate-y-1/2 flex flex-col items-center gap-1 rounded-2xl border border-slate-200/90 bg-white/95 p-1.5 shadow-md backdrop-blur-md">
            <button
              type="button"
              onClick={() => setPanMode(prev => !prev)}
              className={`${dockIconBtnClass} ${
                panMode ? 'bg-blue-600 text-white hover:bg-blue-700 hover:text-white' : ''
              }`}
              title={panMode ? tr('抓手拖拽平移已开启（按住画布可自由拖动）', 'Hand pan mode enabled (drag canvas to pan)') : tr('点击开启抓手拖拽平移模式', 'Enable hand drag-to-pan mode')}
            >
              <Hand size={15} />
            </button>
            <button
              type="button"
              aria-label={tr('放大脑图', 'Zoom in mindmap')}
              disabled={zoom >= 3}
              onClick={() => setZoom(value => Math.min(3, value + 0.25))}
              className={dockIconBtnClass}
              title={tr('放大脑图', 'Zoom in')}
            >
              <ZoomIn size={15} />
            </button>
            <button
              type="button"
              aria-label={tr('缩小脑图', 'Zoom out mindmap')}
              disabled={zoom <= 0.5}
              onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}
              className={dockIconBtnClass}
              title={tr('缩小脑图', 'Zoom out')}
            >
              <ZoomOut size={15} />
            </button>
            <button
              type="button"
              onClick={resetView}
              className="flex h-7 min-w-8 items-center justify-center rounded-lg px-1 text-[11px] font-bold tabular-nums text-slate-700 hover:bg-slate-100 cursor-pointer"
              title={tr('重置为 1:1 比例', 'Reset to 1:1')}
            >
              {zoom === 1 ? '1:1' : `${Math.round(zoom * 100)}%`}
            </button>
            <button
              type="button"
              aria-label={tr('适应画布', 'Fit canvas')}
              onClick={resetView}
              className={dockIconBtnClass}
              title={tr('适应画布', 'Fit canvas')}
            >
              <Maximize2 size={14} />
            </button>
          </div>

          {/* Interactive SVG Viewport ([data-mindmap-preview]) */}
          <div
            data-mindmap-preview
            onPointerDown={event => {
              if (!panMode || event.button !== 0) return;
              const target = event.target as HTMLElement;
              if (target.closest('button,a,input,textarea')) return;
              setIsDragging(true);
              dragStartRef.current = {
                x: event.clientX,
                y: event.clientY,
                panX: pan.x,
                panY: pan.y,
              };
            }}
            onPointerMove={event => {
              if (!isDragging || !dragStartRef.current) return;
              const dx = event.clientX - dragStartRef.current.x;
              const dy = event.clientY - dragStartRef.current.y;
              setPan({
                x: dragStartRef.current.panX + dx,
                y: dragStartRef.current.panY + dy,
              });
            }}
            onPointerUp={() => {
              setIsDragging(false);
              dragStartRef.current = null;
            }}
            onPointerCancel={() => {
              setIsDragging(false);
              dragStartRef.current = null;
            }}
            onWheel={event => {
              if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                const delta = event.deltaY < 0 ? 0.15 : -0.15;
                setZoom(value => Math.min(3, Math.max(0.5, Number((value + delta).toFixed(2)))));
              }
            }}
            className={`pf-ai-aura-surface min-h-0 flex-1 overflow-auto ${
              panMode && hasSource && !currentPreview?.error
                ? isDragging
                  ? 'cursor-grabbing select-none'
                  : 'cursor-grab'
                : ''
            }`}
          >
            {!hasSource ? (
              <div className="flex h-full min-h-52 flex-col items-center justify-center p-6 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm border border-slate-200/80 text-[#ff3670]">
                  <Network size={28} strokeWidth={1.5} />
                </div>
                <h2 className="text-sm font-semibold text-slate-800">{tr('从一个想法开始', 'Start from an Idea')}</h2>
                <p className="mt-1.5 max-w-72 text-xs leading-6 text-slate-500">
                  {tr(
                    '梳理项目目标、拆解功能模块，或选择图表模板手工制作，也可以让 Hermes 按指定类型生成。',
                    'Map out project objectives, break down modules, pick a diagram template manually, or ask Hermes to generate one.'
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => updateSource(starterSource)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#ff3670] px-4 py-2 text-xs font-semibold text-white hover:bg-[#e62960] cursor-pointer shadow-sm shadow-rose-500/20 transition"
                >
                  <Plus size={14} />
                  {tr('使用脑图模板', 'Use Mindmap Template')}
                </button>
              </div>
            ) : currentPreview?.error ? (
              <div
                role="alert"
                className="mx-auto my-12 max-w-lg rounded-2xl border border-amber-200/90 bg-white/95 backdrop-blur-md p-5 text-sm shadow-lg"
              >
                <p className="flex items-center gap-2 font-semibold text-slate-800">
                  <AlertCircle size={16} className="text-amber-600 shrink-0" />
                  {tr('暂时无法预览，请检查 Mermaid 语法', 'Cannot render preview — please check Mermaid syntax')}
                </p>
                <pre className="mt-3 rounded-xl bg-amber-50/60 p-3 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-700 border border-amber-100">
                  {td(currentPreview.error)}
                </pre>
                <p className="mt-3 text-xs text-slate-500">
                  {tr('源码已保留，修正后将自动重新绘制。', 'Source code is preserved; fixing syntax will re-render automatically.')}
                </p>
              </div>
            ) : currentPreview?.svg ? (
              <div
                // Keep the fitted diagram clear of the floating tool docks.
                className={`mx-auto ${compactPad ? 'pl-3 pr-16 pt-14 pb-3 sm:pl-16' : 'pl-6 pr-20 pt-16 pb-6 sm:pl-20'}`}
                style={{
                  width: `${zoom * 100}%`,
                  height: `${zoom * 100}%`,
                  transform:
                    pan.x !== 0 || pan.y !== 0
                      ? `translate(${pan.x}px, ${pan.y}px)`
                      : undefined,
                }}
              >
                <div
                  className="project-mindmap-svg h-full w-full"
                  role="img"
                  aria-label={tr(`${projectName}的脑图`, `Mindmap of ${projectName}`)}
                  dangerouslySetInnerHTML={{ __html: currentPreview.svg }}
                />
              </div>
            ) : (
              <div className="flex h-full min-h-52 items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 size={14} className="animate-spin text-teal-600" />
                {tr('正在生成脑图预览…', 'Generating mindmap preview…')}
              </div>
            )}
          </div>

          {/* 4. Bottom-Center Floating AI Prompt Bar (+ Describe your idea / Hermes AI) */}
          <div className="relative z-30 shrink-0 px-4 pb-2.5 pt-1">
            <MindmapAiPanel projectId={projectId} mindmapId={mindmapId} />
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 bg-white px-4 py-1.5 text-[11px] text-slate-500">
        <span>{desktop ? tr('随当前工程自动保存', 'Auto-saved with current project') : tr('浏览器模式 · 请导出工程保存修改', 'Browser mode · Export project to save changes')}</span>
        <span className="tabular-nums">
          {tr(
            `每个脑图菜单独立保存 · ${lineCount} 行 · ${source.length.toLocaleString()} 字符`,
            `Saved per mindmap item · ${lineCount} lines · ${source.length.toLocaleString()} chars`
          )}
        </span>
      </footer>
    </section>
  );
}
