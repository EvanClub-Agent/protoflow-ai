import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import type { EditorView } from '@tiptap/pm/view';
import { DOMSerializer } from '@tiptap/pm/model';
import {
  AlignLeft,
  AtSign,
  Bold,
  BookOpen,
  BookOpenText,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  Code,
  Code2,
  Columns,
  Copy,
  Database,
  Download,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  LayoutGrid,
  LayoutTemplate,
  List,
  ListOrdered,
  ListTodo,
  Maximize2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  Plus,
  Quote,
  Rows,
  Sparkles,
  Star,
  Strikethrough,
  Table as TableIcon,
  Tag,
  Underline as UnderlineIcon,
  User,
  Wand2,
  X,
} from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { useHermesStore } from '../store/useHermesStore';
import { runProjectAi } from '../services/hermesBridge';
import { discussProject } from '../services/projectWorkflow';
import { buildSitemap } from '../proto/sitemap';
import { flattenSitemap } from '../proto/mindmaps';
import {
  NOTE_COVERS,
  NOTE_EMOJI_CATALOG,
  NOTE_PRESET_TAGS,
  NOTE_PRIORITY_OPTIONS,
  NOTE_STATUS_OPTIONS,
  NOTE_TEMPLATES,
  extractNoteHeadings,
  noteContext,
  noteHtmlToMarkdown,
  noteHtmlToPlainText,
  notePath,
  noteTemplateContent,
  noteAssetDataUrl,
  noteAssetBytes,
  noteAssetExtension,
  noteAiImageAttachments,
  uniqueNoteTitle,
  NOTE_ASSET_SCHEME,
  type NoteNode,
  type NotePriority,
  type NoteRequirementStatus,
} from '../proto/notes';
import {
  addPageNoteLink,
  createNoteNode,
  createStickyReviewNote,
  openNoteNode,
  registerNoteImage,
  updateNoteContent,
  updateNoteMeta,
} from '../services/notesWorkspace';
import { NotesDirectory, NoteRelations, getTagColorClass } from './NotesDirectory';
import { NotesLedger, useNotesOverviewMode } from './NotesLedgerView';
import { StickySummaryModal } from './StickySummaryModal';
import { NoteAssistantModal } from './NoteAssistantModal';
import type { NoteAssistantSelection, NoteAssistantTab } from '../services/hermesNoteAssistant';

/** Resolves `pf-asset:<id>` to a displayable data URL; other sources are shown as-is. */
function resolveNoteImageSrc(src: string | null | undefined): string {
  if (!src) return '';
  if (!src.startsWith(NOTE_ASSET_SCHEME)) return src;
  const asset = useProtoStore.getState().projectNotes.assets?.[src.slice(NOTE_ASSET_SCHEME.length)];
  return asset ? noteAssetDataUrl(asset) : '';
}

/**
 * Image block for pasted screenshots or uploaded reference images. The document (and saved
 * HTML) keeps the `pf-asset:` reference; only the on-screen node view resolves the bytes.
 */
const NoteImageExtension = TiptapNode.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '需求参考截图' },
    };
  },
  parseHTML() {
    return [{ tag: 'img[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        class: 'pf-note-image rounded-xl border border-slate-200 my-3 max-w-full shadow-xs',
      }),
    ];
  },
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img');
      img.className = 'pf-note-image rounded-xl border border-slate-200 my-3 max-w-full shadow-xs';
      const apply = (attrs: Record<string, unknown>) => {
        const resolved = resolveNoteImageSrc(attrs.src as string | null);
        img.src = resolved;
        img.alt = String(attrs.alt ?? '');
        img.title = resolved ? String(attrs.alt ?? '') : '图片数据缺失';
      };
      apply(node.attrs);
      return {
        dom: img,
        update: (next) => {
          if (next.type.name !== 'image') return false;
          apply(next.attrs);
          return true;
        },
      };
    };
  },
});

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

const IMAGE_MAX_EDGE = 1920;
const IMAGE_COMPRESS_FROM_BYTES = 400 * 1024;

/**
 * Reads an image and, when it is large, downsizes it (longest edge 1920px) and re-encodes as
 * WebP. Small screenshots and GIFs (possibly animated) are kept byte-for-byte.
 */
async function prepareNoteImage(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('仅支持 PNG、JPG、WebP 或 GIF 图片');
  const original = await readFileAsDataUrl(file);
  if (file.type === 'image/gif' || file.size <= IMAGE_COMPRESS_FROM_BYTES) return original;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return original;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const compressed = canvas.toDataURL('image/webp', 0.86);
    return compressed.startsWith('data:image/webp') && compressed.length < original.length ? compressed : original;
  } catch {
    return original;
  }
}

interface SlashCommandItem {
  id: string;
  label: string;
  desc: string;
  keywords: string[];
  icon: React.ReactNode;
  run: (
    editor: Editor,
    helpers?: { uploadImage: () => void; summarizeStickies: () => void; openAssistant: (tab: NoteAssistantTab) => void }
  ) => void;
}

const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    id: 'aiWrite',
    label: 'AI 代写',
    desc: '描述写作要求，起草正文、续写内容或生成提纲',
    keywords: ['ai', '代写', '写作', '续写', '提纲', 'write'],
    icon: <Sparkles size={14} />,
    run: (_editor, helpers) => helpers?.openAssistant('write'),
  },
  {
    id: 'aiPolish',
    label: 'AI 润色改写',
    desc: '保留原意，优化表达、精简内容或梳理结构',
    keywords: ['ai', '润色', '改写', '精简', 'polish'],
    icon: <Wand2 size={14} />,
    run: (_editor, helpers) => helpers?.openAssistant('polish'),
  },
  {
    id: 'aiOrganize',
    label: 'AI 整理成纪要',
    desc: '把速记 / 语音转写整理为结论、需求表格与待办（预览后再写入）',
    keywords: ['ai', '整理', '纪要', '转写', '总结', 'summary'],
    icon: <Sparkles size={14} />,
    run: (_editor, helpers) => helpers?.openAssistant('organize'),
  },
  {
    id: 'aiActions',
    label: 'AI 提取待办',
    desc: '扫描口头承诺，生成“负责人｜截止时间｜事项”待办',
    keywords: ['ai', '待办', 'action', 'todo', '提取'],
    icon: <ListTodo size={14} />,
    run: (_editor, helpers) => helpers?.openAssistant('actions'),
  },
  {
    id: 'paragraph',
    label: '正文段落',
    desc: '普通文本段落',
    keywords: ['text', 'p', '正文', '段落'],
    icon: <AlignLeft size={14} />,
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: 'h1',
    label: '一级标题 (H1)',
    desc: '核心章节大标题',
    keywords: ['h1', 'heading1', '标题1', '一级标题'],
    icon: <Heading1 size={14} />,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: '二级标题 (H2)',
    desc: '模块或小节中标题',
    keywords: ['h2', 'heading2', '标题2', '二级标题'],
    icon: <Heading2 size={14} />,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: '三级标题 (H3)',
    desc: '细分要点小标题',
    keywords: ['h3', 'heading3', '标题3', '三级标题'],
    icon: <Heading3 size={14} />,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'taskList',
    label: '待办清单 (To-do)',
    desc: '跟踪客户待确认问题与跟进事项（自动汇总到全局待办）',
    keywords: ['todo', 'task', 'checkbox', '待办', '任务', '清单'],
    icon: <CheckSquare size={14} />,
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'bulletList',
    label: '无序列表',
    desc: '创建项目符号列表',
    keywords: ['ul', 'bullet', 'list', '无序', '列表'],
    icon: <List size={14} />,
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: '有序列表',
    desc: '创建带编号的步骤列表',
    keywords: ['ol', 'number', 'ordered', '有序', '编号'],
    icon: <ListOrdered size={14} />,
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'callout',
    label: '高亮结论框 (Callout)',
    desc: '突出记录客户拍板结论或核心业务注意项',
    keywords: ['quote', 'callout', '引用', '提示', '结论', '重点'],
    icon: <Quote size={14} />,
    run: (editor) =>
      editor
        .chain()
        .focus()
        .insertContent('<blockquote><p>💡 <strong>核心结论 / 重点说明</strong>：</p></blockquote>')
        .run(),
  },
  {
    id: 'table',
    label: '需求对比表格 (3×3)',
    desc: '插入结构化业务字段或诉求对比表',
    keywords: ['table', 'grid', '表格', '字段表'],
    icon: <TableIcon size={14} />,
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'image',
    label: '插入需求参考图片 / 截图',
    desc: '上传本地截图，或直接在编辑器按 Cmd/Ctrl+V 粘贴截图',
    keywords: ['image', 'img', 'pic', '图片', '截图'],
    icon: <ImageIcon size={14} />,
    run: (_editor, helpers) => helpers?.uploadImage(),
  },
  {
    id: 'stickySummary',
    label: '汇总画布批注',
    desc: '把关联页面上的组件便签按页面/组件汇总成表格与待办',
    keywords: ['sticky', 'pin', '批注', '便签', '评审', '汇总'],
    icon: <Pin size={14} />,
    run: (_editor, helpers) => helpers?.summarizeStickies(),
  },
  {
    id: 'codeBlock',
    label: '代码块 / 校验规则',
    desc: '记录计算公式、SQL 片段或伪代码逻辑',
    keywords: ['code', 'sql', '代码', '公式', '规则'],
    icon: <Code2 size={14} />,
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'hr',
    label: '分割线',
    desc: '在视觉上分隔不同模块内容',
    keywords: ['hr', 'divider', 'line', '分割线'],
    icon: <Minus size={14} />,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'reqSnippet',
    label: '客户需求沟通小节模板',
    desc: '一键插入诉求描述 + 待确认清单组合块',
    keywords: ['template', 'req', '需求', '客户', '模板'],
    icon: <Sparkles size={14} />,
    run: (editor) =>
      editor
        .chain()
        .focus()
        .insertContent(
          `<h3>📌 业务模块诉求小结</h3><ul><li><strong>业务场景</strong>：描述客户在什么场景下触发该操作</li><li><strong>核心诉求</strong>：描述期望的页面展示与交互行为</li><li><strong>涉及字段</strong>：列出新增或必改字段</li></ul>`
        )
        .run(),
  },
];

export interface MentionCandidate {
  id: string;
  kind: 'page' | 'table';
  label: string;
  subLabel: string;
  href: string;
}

function useProjectMentionCandidates(): MentionCandidate[] {
  const dbTables = useProtoStore((s) => s.dbTables);
  const layout = usePageStore();
  return useMemo(() => {
    const items: MentionCandidate[] = [];
    const tree = flattenSitemap(
      buildSitemap(
        layout.designerFolders,
        layout.designerPages,
        layout.sitemapOverrides,
        layout.sitemapBase
      )
    );
    for (const node of tree) {
      if (node.type === 'page' && node.pageId) {
        items.push({
          id: `page:${node.pageId}`,
          kind: 'page',
          label: node.title,
          subLabel: `页面 · ${node.pageId}`,
          href: `#pf-page:${node.pageId}`,
        });
      }
    }
    for (const tbl of dbTables) {
      items.push({
        id: `table:${tbl.id}`,
        kind: 'table',
        label: `${tbl.tableName} (${tbl.cnName})`,
        subLabel: `数据表 · ${tbl.domain}`,
        href: `#pf-table:${tbl.id}`,
      });
    }
    return items;
  }, [dbTables, layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase]);
}

export function ProjectNotesView({ projectId }: { projectId: string }) {
  const data = useProtoStore((state) => state.projectNotes);
  const selectedId = useProtoStore((state) => state.selectedNoteNodeId);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const selectedNode = useMemo(
    () => data.nodes.find((n) => n.id === selectedId) ?? null,
    [data.nodes, selectedId]
  );

  // Auto-select first note if nothing is selected and notes exist
  useEffect(() => {
    if (!selectedNode && data.nodes.length > 0) {
      const firstNote = data.nodes.find((n) => n.kind === 'note') ?? data.nodes[0];
      openNoteNode(projectId, firstNote.id);
    }
  }, [data.nodes, selectedNode, projectId]);

  const handleQuickCreateFromTemplate = (templateId: string, parentId: string | null = null) => {
    const tpl = NOTE_TEMPLATES.find((t) => t.id === templateId) ?? NOTE_TEMPLATES[0];
    const title = uniqueNoteTitle(
      data,
      parentId,
      tpl.id === 'blank-note' ? '未命名需求笔记' : tpl.title
    );
    const id = createNoteNode(projectId, 'note', title, parentId, {
      icon: tpl.icon,
      content: noteTemplateContent(tpl),
      tags: tpl.tags,
      cover: tpl.cover,
      status: tpl.id === 'customer-discovery' ? 'pending_confirm' : 'draft',
    });
    openNoteNode(projectId, id);
  };

  return (
    <div className="pf-notes-surface flex flex-1 min-h-0 overflow-hidden bg-[#F3F5F8]">
      {!sidebarCollapsed && (
        <NotesDirectory
          projectId={projectId}
          onCollapse={() => setSidebarCollapsed(true)}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {selectedNode && selectedNode.kind === 'note' ? (
          <NoteDocumentEditor
            key={JSON.stringify([projectId, selectedNode.id])}
            projectId={projectId}
            node={selectedNode}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
            onCreateFromTemplate={(tplId) =>
              handleQuickCreateFromTemplate(tplId, selectedNode.parentId)
            }
          />
        ) : (
          <NotesOverviewHome
            projectId={projectId}
            folderNode={selectedNode?.kind === 'folder' ? selectedNode : null}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
            onCreateFromTemplate={handleQuickCreateFromTemplate}
          />
        )}
      </div>
    </div>
  );
}

function NotesOverviewHome({
  projectId,
  folderNode,
  sidebarCollapsed,
  onToggleSidebar,
  onCreateFromTemplate,
}: {
  projectId: string;
  folderNode: Extract<NoteNode, { kind: 'folder' }> | null;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onCreateFromTemplate: (templateId: string, parentId: string | null) => void;
}) {
  const data = useProtoStore((state) => state.projectNotes);
  const parentId = folderNode ? folderNode.id : null;
  const [overviewMode, setOverviewMode] = useNotesOverviewMode(projectId);
  const [showReviewFromStickies, setShowReviewFromStickies] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const childNodes = useMemo(
    () => data.nodes.filter((n) => n.parentId === parentId),
    [data.nodes, parentId]
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-white">
      <header className="h-11 shrink-0 border-b border-slate-200 px-4 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2">
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label="展开笔记目录"
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
            >
              <PanelLeftOpen size={15} />
            </button>
          )}
          <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
            <BookOpenText size={14} className="text-blue-600" />
            <span>
              {folderNode ? `${notePath(data, folderNode.id)}` : '项目笔记工作台'}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowReviewFromStickies(true)}
          title="把画布上的组件批注汇总成一篇评审修改清单"
          className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 cursor-pointer"
        >
          <Pin size={12} />
          从画布批注生成评审清单
        </button>
        <div
          role="group"
          aria-label="笔记总览视图"
          className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-[11px]"
        >
          {(
            [
              { id: 'cards', label: '卡片', icon: <LayoutGrid size={12} /> },
              { id: 'table', label: '台账表格', icon: <TableIcon size={12} /> },
              { id: 'kanban', label: '状态看板', icon: <Columns size={12} /> },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={overviewMode === item.id}
              onClick={() => setOverviewMode(item.id)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium cursor-pointer transition ${
                overviewMode === item.id
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
        </div>
      </header>

      {overviewError && (
        <div role="alert" className="mx-6 mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">
          {overviewError}
        </div>
      )}
      {showReviewFromStickies && (
        <StickySummaryModal
          mode="create"
          onClose={() => setShowReviewFromStickies(false)}
          onCreate={(pageIds, onlyActive) => {
            try {
              const id = createStickyReviewNote(projectId, { pageIds, onlyActive });
              setShowReviewFromStickies(false);
              setOverviewError('');
              openNoteNode(projectId, id);
            } catch (err) {
              setOverviewError(err instanceof Error ? err.message : '生成评审清单失败');
            }
          }}
        />
      )}

      {folderNode && (
        <div className="px-8 py-2.5 border-b border-slate-100 bg-slate-50/50">
          <NoteRelations projectId={projectId} node={folderNode} />
        </div>
      )}

      {overviewMode !== 'cards' ? (
        <div className="w-full max-w-7xl mx-auto px-6 py-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <span>{folderNode ? folderNode.icon : '📊'}</span>
              <span>{folderNode ? `${folderNode.title} · 需求台账` : '项目需求台账'}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="从模板新建笔记">
              <span className="text-slate-400">新建：</span>
              {NOTE_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => onCreateFromTemplate(tpl.id, parentId)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:border-blue-300 hover:text-blue-600 cursor-pointer"
                >
                  <span>{tpl.icon}</span>
                  {tpl.title}
                </button>
              ))}
            </div>
          </div>
          <NotesLedger projectId={projectId} folderId={parentId} mode={overviewMode} />
        </div>
      ) : (
      <div className="max-w-4xl w-full mx-auto px-8 py-10 space-y-8">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200/80 text-[11px] font-medium">
            <Sparkles size={12} />
            <span>块级文档 · 支持画布分屏伴随、@引用页面/表、直接粘贴截图与全局待办追踪</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <span>{folderNode ? folderNode.icon : '📓'}</span>
            <span>{folderNode ? folderNode.title : '记录客户沟通需求、评审纪要与业务规则'}</span>
          </h1>
          <p className="text-xs text-slate-500 leading-5 max-w-2xl">
            支持多层级目录管理、输入 <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">/</code> 唤起块级命令、输入 <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">@</code> 引用原型页面或数据表、直接粘贴客户截图，并可点击右上角「分屏对照原型」边看笔记边改画布。
          </p>
        </div>

        {/* Quick Start Templates */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            从精选模板快速新建笔记
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {NOTE_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => onCreateFromTemplate(tpl.id, parentId)}
                className="group p-4 rounded-2xl border border-slate-200/90 bg-white hover:border-blue-400 hover:shadow-md text-left transition cursor-pointer flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2">
                  <div className="w-9 h-9 rounded-xl bg-slate-50 group-hover:bg-blue-50 border border-slate-200/70 flex items-center justify-center text-lg transition">
                    {tpl.icon}
                  </div>
                  <div className="font-semibold text-xs text-slate-900 group-hover:text-blue-600 transition">
                    {tpl.title}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-4 line-clamp-2">
                    {tpl.desc}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-[11px] font-medium text-blue-600 pt-1">
                  <Plus size={12} />
                  <span>立即创建</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Child Notes & Folders in Current Directory */}
        {childNodes.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {folderNode ? `「${folderNode.title}」下的内容 (${childNodes.length})` : `根目录下的笔记与目录 (${childNodes.length})`}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {childNodes.map((child) => {
                const snippet =
                  child.kind === 'note'
                    ? noteHtmlToPlainText(child.content).slice(0, 80)
                    : '分类目录';
                const statusMeta =
                  child.kind === 'note' && child.status
                    ? NOTE_STATUS_OPTIONS.find((s) => s.id === child.status)
                    : undefined;
                return (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => openNoteNode(projectId, child.id)}
                    className="p-4 rounded-2xl border border-slate-200 bg-slate-50/40 hover:bg-white hover:border-blue-300 hover:shadow-xs text-left transition cursor-pointer space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base shrink-0">{child.icon}</span>
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {child.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {statusMeta && (
                          <span
                            className={`px-1.5 py-0.2 rounded border text-[10px] font-medium ${statusMeta.badgeClass}`}
                          >
                            {statusMeta.label}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400">
                          {child.updatedAt.slice(0, 10)}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 line-clamp-2 leading-4">
                      {snippet || '空白笔记，点击开始录入内容...'}
                    </p>
                    {child.kind === 'note' && child.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {child.tags.map((t) => (
                          <span
                            key={t}
                            className={`px-1.5 py-0.2 rounded border text-[10px] font-medium ${getTagColorClass(
                              t
                            )}`}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function NoteDocumentEditor({
  projectId,
  node,
  sidebarCollapsed,
  onToggleSidebar,
  onCreateFromTemplate,
}: {
  projectId: string;
  node: Extract<NoteNode, { kind: 'note' }>;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onCreateFromTemplate: (templateId: string) => void;
}) {
  const data = useProtoStore((state) => state.projectNotes);
  const {
    activePageId,
    setActivePage,
    setSelectedTableId,
    setViewMode,
    setDockedNoteId,
    addStickyRuleToWidget,
  } = useProtoStore();
  const layout = usePageStore();
  const { status: hermesStatus, setModalOpen: setHermesModalOpen } = useHermesStore();

  const [titleDraft, setTitleDraft] = useState(node.title);
  const [stakeholderDraft, setStakeholderDraft] = useState(node.stakeholder || '');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [showTagPopover, setShowTagPopover] = useState(false);
  const [customTagInput, setCustomTagInput] = useState('');
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [showOutline, setShowOutline] = useState(true);
  const [copiedMd, setCopiedMd] = useState(false);
  const [aiStatusMsg, setAiStatusMsg] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showNotice = useCallback((message: string, ms = 3500) => {
    setAiStatusMsg(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setAiStatusMsg(''), ms);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  // Slash Command & @Mention Menu State
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const mentionCandidates = useProjectMentionCandidates();

  // Slash / @ menus float at the caret (fixed positioning), flipping above when space is short.
  const [menuAnchor, setMenuAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null);

  // Selection Conversion State (Convert excerpt to Sticky Note or send excerpt to AI)
  const [selectedExcerpt, setSelectedExcerpt] = useState('');
  const [showStickyConvertModal, setShowStickyConvertModal] = useState(false);
  const [showStickySummary, setShowStickySummary] = useState(false);
  const [assistant, setAssistant] = useState<{
    tab: NoteAssistantTab;
    selection: NoteAssistantSelection | null;
  } | null>(null);
  const editorForAssistant = useRef<Editor | null>(null);
  const openAssistant = (tab: NoteAssistantTab) => {
    const ed = editorForAssistant.current;
    let selection: NoteAssistantSelection | null = null;
    if (ed && !ed.state.selection.empty) {
      const { from, to } = ed.state.selection;
      const fragment = document.createElement('div');
      fragment.appendChild(DOMSerializer.fromSchema(ed.schema).serializeFragment(ed.state.doc.slice(from, to).content));
      selection = { from, to, text: ed.state.doc.textBetween(from, to, '\n'), html: fragment.innerHTML };
    }
    setAssistant({ tab, selection });
  };

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleDraft(node.title);
    setStakeholderDraft(node.stakeholder || '');
  }, [node.id, node.title, node.stakeholder]);

  const canMountRichEditor =
    typeof window !== 'undefined' &&
    typeof window.DOMParser === 'function' &&
    typeof document !== 'undefined' &&
    typeof document.createRange === 'function';

  const [editor, setEditor] = useState<Editor | null>(null);
  editorForAssistant.current = editor;

  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length || !editor) return;
    for (const file of files) {
      try {
        const src = registerNoteImage(projectId, await prepareNoteImage(file), file.name);
        editor
          .chain()
          .focus()
          .insertContent({ type: 'image', attrs: { src, alt: file.name || '需求参考图片' } })
          .run();
      } catch (err) {
        showNotice(`图片未插入：${err instanceof Error ? err.message : '读取失败'}`);
      }
    }
  };

  const filteredSlashCommands = useMemo(() => {
    const q = slashQuery.trim().toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.desc.toLowerCase().includes(q) ||
        cmd.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }, [slashQuery]);

  const filteredMentions = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return mentionCandidates;
    return mentionCandidates.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.subLabel.toLowerCase().includes(q)
    );
  }, [mentionCandidates, mentionQuery]);

  const executeSlashCommand = useCallback(
    (item: SlashCommandItem) => {
      if (!editor) return;
      const { selection } = editor.state;
      const { $from } = selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
      const slashMatch = textBefore.match(/(?:^|\s)(\/[^\s/]*)$/);
      if (slashMatch) {
        const deleteLen = slashMatch[1].length;
        editor
          .chain()
          .focus()
          .deleteRange({ from: selection.from - deleteLen, to: selection.from })
          .run();
      }
      item.run(editor, {
        uploadImage: () => imageInputRef.current?.click(),
        summarizeStickies: () => setShowStickySummary(true),
        openAssistant: (tab) => openAssistant(tab),
      });
      setSlashOpen(false);
      setSlashQuery('');
    },
    [editor]
  );

  const executeMentionInsert = useCallback(
    (item: MentionCandidate) => {
      if (!editor) return;
      const { selection } = editor.state;
      const { $from } = selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
      const mentionMatch = textBefore.match(/(?:^|\s)(@[^\s@]*)$/);
      if (mentionMatch) {
        const deleteLen = mentionMatch[1].length;
        editor
          .chain()
          .focus()
          .deleteRange({ from: selection.from - deleteLen, to: selection.from })
          .run();
      }
      const prefix = item.kind === 'page' ? '📄' : '🗄️';
      // Insert as structured content so names containing <, & or quotes are kept verbatim.
      editor
        .chain()
        .focus()
        .insertContent([
          { type: 'text', text: `${prefix} ${item.label}`, marks: [{ type: 'link', attrs: { href: item.href } }] },
          { type: 'text', text: ' ' },
        ])
        .run();
      setMentionOpen(false);
      setMentionQuery('');
    },
    [editor]
  );

  // Keyboard navigation for Slash Command or @Mention menu
  useEffect(() => {
    if (!slashOpen && !mentionOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only steer the menu while typing in this editor (not in the title or other inputs).
      if (!editor?.isFocused) return;
      if (slashOpen && filteredSlashCommands.length) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashSelectedIndex((i) => (i + 1) % filteredSlashCommands.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashSelectedIndex(
            (i) => (i - 1 + filteredSlashCommands.length) % filteredSlashCommands.length
          );
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const chosen = filteredSlashCommands[slashSelectedIndex] ?? filteredSlashCommands[0];
          if (chosen) executeSlashCommand(chosen);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setSlashOpen(false);
        }
      } else if (mentionOpen && filteredMentions.length) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionSelectedIndex((i) => (i + 1) % filteredMentions.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionSelectedIndex(
            (i) => (i - 1 + filteredMentions.length) % filteredMentions.length
          );
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const chosen = filteredMentions[mentionSelectedIndex] ?? filteredMentions[0];
          if (chosen) executeMentionInsert(chosen);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setMentionOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    slashOpen,
    filteredSlashCommands,
    slashSelectedIndex,
    executeSlashCommand,
    mentionOpen,
    filteredMentions,
    mentionSelectedIndex,
    executeMentionInsert,
    editor,
  ]);

  const updateMenuAnchor = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      setMenuAnchor(null);
      return;
    }
    try {
      const coords = editor.view.coordsAtPos(editor.state.selection.from);
      setMenuAnchor(
        coords.bottom > 0 || coords.top > 0
          ? { left: coords.left, top: coords.top, bottom: coords.bottom }
          : null
      );
    } catch {
      setMenuAnchor(null);
    }
  }, [editor]);

  useEffect(() => {
    if (!slashOpen && !mentionOpen) return;
    updateMenuAnchor();
    const scroller = editorContainerRef.current;
    scroller?.addEventListener('scroll', updateMenuAnchor, { passive: true });
    window.addEventListener('resize', updateMenuAnchor);
    return () => {
      scroller?.removeEventListener('scroll', updateMenuAnchor);
      window.removeEventListener('resize', updateMenuAnchor);
    };
  }, [slashOpen, mentionOpen, slashQuery, mentionQuery, updateMenuAnchor]);

  const floatingMenuStyle = (): React.CSSProperties | undefined => {
    if (!menuAnchor || typeof window === 'undefined') return undefined;
    const width = 320;
    const estimatedHeight = 310;
    const gap = 6;
    const left = Math.max(8, Math.min(menuAnchor.left, window.innerWidth - width - 8));
    const roomBelow = window.innerHeight - menuAnchor.bottom;
    return roomBelow >= estimatedHeight + gap || menuAnchor.top < roomBelow
      ? { position: 'fixed', left, top: menuAnchor.bottom + gap, zIndex: 60 }
      : { position: 'fixed', left, bottom: window.innerHeight - menuAnchor.top + gap, zIndex: 60 };
  };

  const plainText = useMemo(() => noteHtmlToPlainText(node.content), [node.content]);
  const charCount = useMemo(() => plainText.replace(/\s+/g, '').length, [plainText]);
  const headings = useMemo(() => extractNoteHeadings(node.content), [node.content]);

  const taskStats = useMemo(() => {
    const total = (node.content.match(/data-type="taskItem"/g) || []).length;
    const done = (node.content.match(/data-type="taskItem"[^>]*data-checked="true"/g) || []).length;
    return { total, done };
  }, [node.content]);

  const coverConfig = useMemo(
    () => NOTE_COVERS.find((c) => c.id === node.cover) ?? NOTE_COVERS[0],
    [node.cover]
  );

  const handleTitleBlur = () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleDraft(node.title);
      return;
    }
    if (trimmed !== node.title) {
      try {
        updateNoteMeta(projectId, node.id, { title: trimmed });
      } catch (err) {
        setTitleDraft(node.title);
        showNotice(`标题未保存：${err instanceof Error ? err.message : '名称无效'}`);
      }
    }
  };

  const handleStakeholderBlur = () => {
    const trimmed = stakeholderDraft.trim();
    if (trimmed !== (node.stakeholder || '')) {
      try {
        updateNoteMeta(projectId, node.id, { stakeholder: trimmed });
      } catch (err) {
        showNotice(`对接人未保存：${err instanceof Error ? err.message : '内容无效'}`);
      }
    }
  };

  // Title and stakeholder are committed on blur. Switching notes remounts this editor and
  // blur is not guaranteed to fire, so flush pending drafts on unmount as well.
  const pendingDraftsRef = useRef({ titleDraft, stakeholderDraft, node });
  pendingDraftsRef.current = { titleDraft, stakeholderDraft, node };
  useEffect(
    () => () => {
      const { titleDraft: title, stakeholderDraft: stakeholder, node: latest } = pendingDraftsRef.current;
      const patch: { title?: string; stakeholder?: string } = {};
      if (title.trim() && title.trim() !== latest.title) patch.title = title;
      if (stakeholder.trim() !== (latest.stakeholder || '')) patch.stakeholder = stakeholder;
      if (!Object.keys(patch).length) return;
      try {
        updateNoteMeta(projectId, latest.id, patch);
      } catch {
        /* the note was deleted, renamed to a clashing title, or the project changed */
      }
    },
    [projectId]
  );

  const handleToggleTag = (tag: string) => {
    const exists = node.tags.includes(tag);
    const nextTags = exists ? node.tags.filter((t) => t !== tag) : [...node.tags, tag];
    updateNoteMeta(projectId, node.id, { tags: nextTags });
  };

  const handleAddCustomTag = (e: React.FormEvent) => {
    e.preventDefault();
    const t = customTagInput.trim();
    if (!t) return;
    if (!node.tags.includes(t)) {
      updateNoteMeta(projectId, node.id, { tags: [...node.tags, t] });
    }
    setCustomTagInput('');
  };

  const handleApplyTemplateContent = (tplId: string, mode: 'replace' | 'append') => {
    const tpl = NOTE_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    const tplHtml = noteTemplateContent(tpl);
    const nextHtml =
      mode === 'replace' || !node.content || node.content === '<p></p>'
        ? tplHtml
        : `${node.content}<hr>${tplHtml}`;
    // The open editor picks up the new store content through its external-change sync.
    updateNoteContent(projectId, node.id, nextHtml);
    if (mode === 'replace') {
      updateNoteMeta(projectId, node.id, {
        icon: tpl.icon,
        cover: tpl.cover,
        tags: tpl.tags.length ? tpl.tags : node.tags,
      });
    }
    setShowTemplateMenu(false);
  };

  const handleCopyMarkdown = async () => {
    const md = noteHtmlToMarkdown(node);
    try {
      await navigator.clipboard?.writeText(md);
    } catch {
      /* ignore clipboard permission issues */
    }
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 1800);
  };

  const handleExportMarkdownFile = () => {
    // Single-file export embeds images as data URIs so screenshots are not lost.
    const md = noteHtmlToMarkdown(node, { images: 'inline', assets: data.assets });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${node.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendToProjectAi = async (customExcerpt?: string) => {
    try {
      const ctx = noteContext(data, node.id, layout);
      // Whole-note requests carry the note's screenshots as chat image attachments.
      const imagePick = customExcerpt?.trim()
        ? { total: 0, attachments: [] }
        : noteAiImageAttachments(node.content, data.assets);
      const imageHint = imagePick.attachments.length
        ? `\n\n随附 ${imagePick.attachments.length} 张图片，依次对应正文中的 ${imagePick.attachments
            .map((a) => `[图片 ${a.index}]`)
            .join('、')}${imagePick.total > imagePick.attachments.length ? `（笔记共 ${imagePick.total} 张，其余未附带）` : ''}。`
        : '';
      const contentBody = customExcerpt?.trim()
        ? `【摘自笔记《${ctx.title}》的重点需求片段】：\n${customExcerpt.trim()}`
        : noteHtmlToMarkdown(node);
      const prompt = `请根据以下项目笔记需求，协助我规划或更新对应的原型页面与数据表：\n\n${
        ctx.relatedPageIds.length
          ? `关联页面 ID：${ctx.relatedPageIds.join(', ')}\n\n`
          : ''
      }${contentBody}${imageHint}`;

      if (hermesStatus !== 'running') {
        try {
          await navigator.clipboard?.writeText(prompt);
        } catch {
          /* ignore */
        }
        showNotice('已复制需求指令，请先连接 Hermes 引擎后在项目 AI 中粘贴执行');
        setHermesModalOpen(true, 'overview');
        return;
      }

      if (customExcerpt && ctx.relatedPageIds.length === 1) {
        setActivePage(ctx.relatedPageIds[0]);
        setViewMode('single_page');
        await runProjectAi(prompt);
        return;
      }

      setViewMode('project_ai');
      await discussProject(
        projectId,
        prompt,
        imagePick.attachments.map(({ index, asset }) => ({
          name: asset.name?.trim() || `笔记图片-${index}.${noteAssetExtension(asset)}`,
          mimeType: asset.mime as 'image/png' | 'image/jpeg' | 'image/webp',
          data: asset.data,
          preview: noteAssetDataUrl(asset),
          size: noteAssetBytes(asset.data),
        }))
      );
    } catch (err) {
      showNotice(`发送给项目 AI 失败：${err instanceof Error ? err.message : '未知错误'}`, 6000);
    }
  };

  const handleDockToSidecar = () => {
    const ctx = noteContext(data, node.id, layout);
    setDockedNoteId(node.id);
    if (ctx.relatedPageIds.length > 0 && activePageId === '') {
      setActivePage(ctx.relatedPageIds[0]);
    }
    setViewMode('single_page');
  };

  const scrollToHeading = (headingIndex: number) => {
    if (!editorContainerRef.current) return;
    const elements = editorContainerRef.current.querySelectorAll('h1, h2, h3');
    const target = elements[headingIndex];
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Handle clicking @Mention links inside the editor
  const handleEditorSurfaceClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (href.startsWith('#pf-page:')) {
      e.preventDefault();
      const targetPageId = href.replace('#pf-page:', '');
      setActivePage(targetPageId);
      setViewMode('single_page');
    } else if (href.startsWith('#pf-table:')) {
      e.preventDefault();
      const targetTableId = href.replace('#pf-table:', '');
      setSelectedTableId(targetTableId);
      setViewMode('db_designer');
    }
  };

  return (
    <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden bg-white">
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-white">
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageFileSelect}
          className="hidden"
        />

        {/* Top Workspace Header */}
        <header className="h-11 shrink-0 border-b border-slate-200 px-3.5 flex items-center justify-between gap-2 bg-white z-20">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? '展开笔记目录' : '收起笔记目录'}
            title={sidebarCollapsed ? '展开笔记目录' : '收起笔记目录'}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer transition"
          >
            {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>

          <div className="flex items-center gap-1.5 text-xs text-slate-600 truncate">
            <span>{node.icon}</span>
            <span className="font-medium text-slate-800 truncate">
              {notePath(data, node.id)}
            </span>
          </div>

          <button
            type="button"
            onClick={() => updateNoteMeta(projectId, node.id, { pinned: !node.pinned })}
            aria-label={node.pinned ? '取消置顶笔记' : '置顶当前笔记'}
            title={node.pinned ? '已置顶，点击取消' : '置顶到左侧顶部'}
            className={`p-1 rounded-md cursor-pointer transition ${
              node.pinned
                ? 'text-amber-500 bg-amber-50 hover:bg-amber-100'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
            }`}
          >
            <Star size={13} className={node.pinned ? 'fill-amber-400' : ''} />
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5 shrink-0 text-xs">
          <span className="hidden xl:inline-flex items-center gap-2 px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200/80 text-[11px] text-slate-500">
            <span>{charCount} 字</span>
            {taskStats.total > 0 && (
              <>
                <span>·</span>
                <span className="text-emerald-700 font-medium">
                  待办 {taskStats.done}/{taskStats.total}
                </span>
              </>
            )}
          </span>

          {/* Split-screen Dock to Canvas Button */}
          <button
            type="button"
            onClick={handleDockToSidecar}
            title="将此笔记固定到原型画布右侧分屏，边看需求边改原型"
            className="px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50/80 hover:bg-blue-100/80 text-blue-700 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition"
          >
            <Columns size={12} />
            <span>分屏对照原型</span>
          </button>

          {/* Template Picker Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTemplateMenu((v) => !v)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition"
            >
              <LayoutTemplate size={12} className="text-slate-500" />
              <span>套用模板</span>
              <ChevronDown size={11} className="text-slate-400" />
            </button>
            {showTemplateMenu && (
              <div className="absolute right-0 top-full mt-1.5 w-72 rounded-xl border border-slate-200 bg-white shadow-xl p-2 z-50 space-y-1">
                <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase flex items-center justify-between">
                  <span>插入或套用结构化模板</span>
                  <button
                    type="button"
                    onClick={() => setShowTemplateMenu(false)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>
                {NOTE_TEMPLATES.filter((t) => t.id !== 'blank-note').map((tpl) => (
                  <div
                    key={tpl.id}
                    className="p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200/80 space-y-1.5 transition"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                      <span>{tpl.icon}</span>
                      <span>{tpl.title}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-4">{tpl.desc}</p>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleApplyTemplateContent(tpl.id, 'append')}
                        className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-medium cursor-pointer"
                      >
                        追加到文末
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyTemplateContent(tpl.id, 'replace')}
                        className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] cursor-pointer"
                      >
                        覆盖当前页
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowTemplateMenu(false);
                          onCreateFromTemplate(tpl.id);
                        }}
                        className="px-2 py-0.5 rounded bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-[10px] cursor-pointer"
                      >
                        新建此模板页
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleCopyMarkdown}
            title="复制为 Markdown 文本"
            className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition"
          >
            {copiedMd ? (
              <>
                <Check size={12} className="text-emerald-600" />
                <span className="text-emerald-700">已复制</span>
              </>
            ) : (
              <>
                <Copy size={12} className="text-slate-500" />
                <span>复制 MD</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleExportMarkdownFile}
            title="导出为 .md 文件"
            className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition"
          >
            <Download size={12} className="text-slate-500" />
            <span>导出 .md</span>
          </button>

          <button
            type="button"
            onClick={() => handleSendToProjectAi()}
            title="将当前客户需求笔记发送给项目 AI，自动生成或修改原型与数据库"
            className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer shadow-2xs transition"
          >
            <Sparkles size={12} />
            <span>发给项目 AI</span>
          </button>

          <button
            type="button"
            onClick={() => setShowOutline((v) => !v)}
            aria-label={showOutline ? '收起文档大纲' : '展开文档大纲'}
            title={showOutline ? '收起右侧大纲' : '展开右侧大纲'}
            className={`p-1.5 rounded-lg border cursor-pointer transition ${
              showOutline
                ? 'bg-slate-100 border-slate-300 text-slate-800'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {showOutline ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </button>
        </div>
      </header>

      {aiStatusMsg && (
        <div
          role="status"
          className="px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs flex items-center justify-between"
        >
          <span>{aiStatusMsg}</span>
          <button
            type="button"
            onClick={() => setAiStatusMsg('')}
            className="text-amber-700 hover:underline cursor-pointer"
          >
            知道了
          </button>
        </div>
      )}

      {/* Notion Block Formatting Bar */}
      {editor && (
        <div className="px-4 py-1.5 border-b border-slate-200/90 bg-slate-50/80 flex items-center justify-between gap-2 flex-wrap z-10 select-none">
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setSlashOpen((v) => !v);
                setMentionOpen(false);
                setSlashQuery('');
                setSlashSelectedIndex(0);
                editor.commands.focus();
              }}
              className="px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200/80 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
              title="打开 / 斜杠块级命令菜单"
            >
              <Plus size={12} />
              <span>/ 插入块</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMentionOpen((v) => !v);
                setSlashOpen(false);
                setMentionQuery('');
                setMentionSelectedIndex(0);
                editor.commands.focus();
              }}
              className="px-2 py-1 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
              title="输入 @ 引用工程中的原型页面或数据库物理表"
            >
              <AtSign size={12} className="text-blue-600" />
              <span>引用页面/表</span>
            </button>

            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="px-2 py-1 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer mr-1"
              title="上传参考图片，或直接按 Ctrl/Cmd+V 粘贴截图"
            >
              <ImageIcon size={12} className="text-emerald-600" />
              <span>贴图</span>
            </button>

            <button
              type="button"
              onClick={() => openAssistant(selectedExcerpt.trim() ? 'polish' : 'write')}
              className="px-2 py-1 rounded-md bg-gradient-to-r from-blue-600 to-violet-600 hover:opacity-90 text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer"
              title="AI 代写、润色改写、整理纪要、提取待办"
            >
              <Sparkles size={12} />
              <span>AI 助手</span>
            </button>

            <button
              type="button"
              onClick={() => setShowStickySummary(true)}
              className="px-2 py-1 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer mr-1"
              title="把关联页面上的画布组件批注汇总到本笔记"
            >
              <Pin size={12} className="text-amber-500" />
              <span>汇总批注</span>
            </button>

            <div className="h-4 w-px bg-slate-200 mx-0.5" />

            <ToolbarButton
              active={editor.isActive('heading', { level: 1 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              title="一级标题 (H1)"
            >
              <Heading1 size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('heading', { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              title="二级标题 (H2)"
            >
              <Heading2 size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('heading', { level: 3 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              title="三级标题 (H3)"
            >
              <Heading3 size={14} />
            </ToolbarButton>

            <div className="h-4 w-px bg-slate-200 mx-0.5" />

            <ToolbarButton
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              title="加粗 (Cmd+B)"
            >
              <Bold size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title="斜体 (Cmd+I)"
            >
              <Italic size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              title="下划线 (Cmd+U)"
            >
              <UnderlineIcon size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              title="删除线"
            >
              <Strikethrough size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('highlight')}
              onClick={() => editor.chain().focus().toggleHighlight().run()}
              title="荧光笔高亮重点"
            >
              <Highlighter size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
              title="行内代码"
            >
              <Code size={14} />
            </ToolbarButton>

            <div className="h-4 w-px bg-slate-200 mx-0.5" />

            <ToolbarButton
              active={editor.isActive('taskList')}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              title="待办任务清单 (Checkbox)"
            >
              <ListTodo size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              title="无序列表"
            >
              <List size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              title="有序列表"
            >
              <ListOrdered size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              title="引用 / 高亮提示框 (Callout)"
            >
              <Quote size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('codeBlock')}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              title="代码块"
            >
              <Code2 size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={false}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
              }
              title="插入 3×3 表格"
            >
              <TableIcon size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={false}
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              title="插入分割线"
            >
              <Minus size={14} />
            </ToolbarButton>

            {/* Contextual Table Controls when inside a table */}
            {editor.isActive('table') && (
              <>
                <div className="h-4 w-px bg-slate-200 mx-0.5" />
                <div className="flex items-center gap-1 bg-blue-50/80 border border-blue-200/80 rounded-lg px-1.5 py-0.5 text-[11px]">
                  <span className="text-blue-700 font-medium px-1">表格:</span>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().addRowAfter().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-blue-700 cursor-pointer flex items-center gap-0.5"
                  >
                    <Rows size={11} />
                    <span>+行</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().deleteRow().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-slate-600 cursor-pointer"
                  >
                    -删行
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().addColumnAfter().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-blue-700 cursor-pointer flex items-center gap-0.5"
                  >
                    <Columns size={11} />
                    <span>+列</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().deleteColumn().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-slate-600 cursor-pointer"
                  >
                    -删列
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().deleteTable().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-rose-100 text-rose-600 cursor-pointer"
                  >
                    删表
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Selection Precision Action Pill (Convert selected text to Sticky Note or send excerpt to AI) */}
          {selectedExcerpt.trim().length > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200/90 rounded-lg px-2.5 py-1 text-[11px] shadow-2xs">
              <span className="text-amber-900 font-medium">
                已选中 {selectedExcerpt.trim().length} 字:
              </span>
              <button
                type="button"
                onClick={() => setShowStickyConvertModal(true)}
                className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white font-medium flex items-center gap-1 cursor-pointer transition"
              >
                <Pin size={11} />
                <span>转为页面需求便签</span>
              </button>
              <button
                type="button"
                onClick={() => handleSendToProjectAi(selectedExcerpt)}
                className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center gap-1 cursor-pointer transition"
              >
                <Sparkles size={11} />
                <span>仅将选中段发给 AI</span>
              </button>
              <button
                type="button"
                onClick={() => openAssistant('polish')}
                className="px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-700 text-white font-medium flex items-center gap-1 cursor-pointer transition"
              >
                <Wand2 size={11} />
                <span>AI 润色选中段</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Editor + Right Outline Area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div
          ref={editorContainerRef}
          onClick={handleEditorSurfaceClick}
          className="flex-1 overflow-y-auto min-w-0 pb-24"
        >
          {/* Optional Notion Cover Banner */}
          {node.cover !== 'none' && coverConfig.className && (
            <div className={`pf-note-cover group relative h-28 w-full ${coverConfig.className} transition-all`}>
              <div className="absolute right-6 bottom-2.5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition">
                <button
                  type="button"
                  onClick={() => setShowCoverPicker((v) => !v)}
                  className="px-2.5 py-1 rounded-lg bg-white/90 hover:bg-white text-slate-800 text-[11px] font-medium shadow-sm cursor-pointer"
                >
                  更换封面
                </button>
                <button
                  type="button"
                  onClick={() => updateNoteMeta(projectId, node.id, { cover: 'none' })}
                  className="px-2 py-1 rounded-lg bg-slate-900/60 hover:bg-slate-900/80 text-white text-[11px] cursor-pointer"
                >
                  移除
                </button>
              </div>
            </div>
          )}

          {/* Centered Notion Page Container */}
          <div className="max-w-3xl w-full mx-auto px-8 sm:px-12 pt-6 space-y-5 relative">
            {/* Cover Picker Popover */}
            {showCoverPicker && (
              <div className="rounded-xl border border-slate-200 bg-white shadow-xl p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>选择笔记顶部封面</span>
                  <button
                    type="button"
                    onClick={() => setShowCoverPicker(false)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {NOTE_COVERS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        updateNoteMeta(projectId, node.id, { cover: c.id });
                        setShowCoverPicker(false);
                      }}
                      className={`h-10 rounded-lg border text-[10px] font-medium flex items-center justify-center cursor-pointer transition ${
                        c.id === 'none'
                          ? 'bg-slate-50 text-slate-600 border-slate-200'
                          : `${c.className} text-white border-transparent`
                      } ${node.cover === c.id ? 'ring-2 ring-blue-600 ring-offset-1' : ''}`}
                    >
                      {c.label.replace('渐变', '')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Hover Actions when no cover is set */}
            {node.cover === 'none' && (
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <button
                  type="button"
                  onClick={() => updateNoteMeta(projectId, node.id, { cover: 'ocean' })}
                  className="hover:text-slate-700 hover:bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1 cursor-pointer transition"
                >
                  <ImageIcon size={12} />
                  <span>添加封面</span>
                </button>
              </div>
            )}

            {/* Emoji Icon + Large Title Row */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="relative">
                  <button
                    type="button"
                    aria-label="更换笔记图标"
                    title="点击更换笔记 Emoji 图标"
                    onClick={() => setShowEmojiPicker((v) => !v)}
                    className={`w-12 h-12 rounded-2xl border border-slate-200/80 bg-slate-50/80 hover:bg-slate-100 flex items-center justify-center text-2xl cursor-pointer transition shadow-2xs ${
                      node.cover !== 'none' ? '-mt-10 bg-white shadow-md' : ''
                    }`}
                  >
                    {node.icon}
                  </button>

                  {showEmojiPicker && (
                    <div className="absolute left-0 top-full mt-2 w-72 rounded-2xl border border-slate-200 bg-white shadow-2xl p-3 z-50 space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                        <span>选择笔记图标</span>
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker(false)}
                          className="text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      </div>
                      {NOTE_EMOJI_CATALOG.map((cat) => (
                        <div key={cat.category} className="space-y-1">
                          <div className="text-[10px] font-medium text-slate-400">
                            {cat.category}
                          </div>
                          <div className="grid grid-cols-10 gap-1">
                            {cat.emojis.map((em) => (
                              <button
                                key={em}
                                type="button"
                                onClick={() => {
                                  updateNoteMeta(projectId, node.id, { icon: em });
                                  setShowEmojiPicker(false);
                                }}
                                className={`w-6 h-6 rounded flex items-center justify-center text-sm hover:bg-slate-100 cursor-pointer ${
                                  node.icon === em ? 'bg-blue-50 ring-1 ring-blue-500' : ''
                                }`}
                              >
                                {em}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <input
                  type="text"
                  aria-label="笔记标题"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                      editor?.commands.focus('start');
                    }
                  }}
                  placeholder="无标题笔记..."
                  className="flex-1 w-full text-2xl sm:text-3xl font-bold text-slate-900 bg-transparent border-none focus:outline-none placeholder:text-slate-300 tracking-tight"
                />
              </div>

              {/* Notion Page Properties Ledger Section */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 px-3.5 py-2.5 space-y-2 text-xs">
                {/* PM Requirement Status + Priority + Stakeholder + Date Row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1.5 border-b border-slate-200/60">
                  {/* Status */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 font-medium">需求状态</span>
                    <div className="flex items-center gap-1">
                      {NOTE_STATUS_OPTIONS.map((opt) => {
                        const isCurrent = (node.status || 'draft') === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => updateNoteMeta(projectId, node.id, { status: opt.id })}
                            className={`px-2 py-0.5 rounded-md border text-[11px] font-medium flex items-center gap-1 cursor-pointer transition ${
                              isCurrent
                                ? `${opt.badgeClass} ring-1 ring-current/20`
                                : 'bg-white text-slate-500 border-slate-200/80 hover:bg-slate-100'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${opt.dotClass}`} />
                            <span>{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Priority */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 font-medium">优先级</span>
                    <select
                      aria-label="需求优先级"
                      value={node.priority || ''}
                      onChange={(e) =>
                        updateNoteMeta(projectId, node.id, {
                          priority: (e.target.value || undefined) as NotePriority | undefined,
                        })
                      }
                      className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700"
                    >
                      <option value="">未设优先级</option>
                      {NOTE_PRIORITY_OPTIONS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Stakeholder */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 font-medium flex items-center gap-1">
                      <User size={11} />
                      <span>客户对接人</span>
                    </span>
                    <input
                      type="text"
                      aria-label="客户对接人"
                      value={stakeholderDraft}
                      onChange={(e) => setStakeholderDraft(e.target.value)}
                      onBlur={handleStakeholderBlur}
                      placeholder="如：采购部王总"
                      className="w-28 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                    />
                  </div>

                  {/* Meeting Date */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 font-medium flex items-center gap-1">
                      <Calendar size={11} />
                      <span>沟通日期</span>
                    </span>
                    <input
                      type="date"
                      aria-label="沟通日期"
                      value={node.meetingDate || node.updatedAt.slice(0, 10)}
                      onChange={(e) =>
                        updateNoteMeta(projectId, node.id, { meetingDate: e.target.value })
                      }
                      className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                    />
                  </div>

                  {/* Opt-in sharing to viewer links */}
                  <label
                    className="flex items-center gap-1.5 cursor-pointer"
                    title="开启后，发布在线演示时本笔记会以只读形式出现在演示端（关联页面的「需求说明」中）。默认不外发。"
                  >
                    <input
                      type="checkbox"
                      aria-label="允许外发到演示端"
                      checked={node.shareable === true}
                      onChange={(e) => updateNoteMeta(projectId, node.id, { shareable: e.target.checked })}
                    />
                    <span className="text-slate-400 font-medium">外发到演示端</span>
                    {node.shareable ? (
                      <span className="px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-medium">
                        客户可见
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">仅内部</span>
                    )}
                  </label>
                </div>

                {/* Tags Row */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-400 font-medium min-w-[64px] flex items-center gap-1">
                    <Tag size={11} />
                    <span>分类标签</span>
                  </span>
                  {node.tags.map((tag) => (
                    <span
                      key={tag}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium ${getTagColorClass(
                        tag
                      )}`}
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        aria-label={`移除标签${tag}`}
                        onClick={() => handleToggleTag(tag)}
                        className="opacity-60 hover:opacity-100 cursor-pointer"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowTagPopover((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:border-blue-400 hover:text-blue-600 cursor-pointer transition"
                    >
                      <Plus size={10} />
                      <span>添加标签</span>
                    </button>

                    {showTagPopover && (
                      <div className="absolute left-0 top-full mt-1.5 w-64 rounded-xl border border-slate-200 bg-white shadow-xl p-2.5 z-50 space-y-2">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                          <span>选择或新建标签</span>
                          <button
                            type="button"
                            onClick={() => setShowTagPopover(false)}
                            className="text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            <X size={12} />
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {NOTE_PRESET_TAGS.map((preset) => {
                            const active = node.tags.includes(preset.label);
                            return (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() => handleToggleTag(preset.label)}
                                className={`px-2 py-0.5 rounded-md border text-[11px] font-medium cursor-pointer transition ${
                                  active
                                    ? `${preset.colorClass} ring-1 ring-blue-500`
                                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                {active ? `✓ ${preset.label}` : preset.label}
                              </button>
                            );
                          })}
                        </div>
                        <form onSubmit={handleAddCustomTag} className="flex gap-1 pt-1">
                          <input
                            type="text"
                            value={customTagInput}
                            onChange={(e) => setCustomTagInput(e.target.value)}
                            placeholder="输入自定义标签回车..."
                            maxLength={24}
                            className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] focus:outline-none focus:border-blue-600"
                          />
                          <button
                            type="submit"
                            className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[11px] font-medium cursor-pointer"
                          >
                            添加
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                </div>

                {/* Linked Pages Row */}
                <NoteRelations projectId={projectId} node={node} />
              </div>
            </div>

            {/* Floating Slash Command Menu */}
            {slashOpen && (
              <div
                role="listbox"
                aria-label="斜杠块级命令菜单"
                style={floatingMenuStyle()}
                onMouseDown={(e) => e.preventDefault()}
                className="rounded-2xl border border-slate-200 bg-white shadow-2xl p-2 w-80 max-w-full z-40 space-y-1"
              >
                <div className="px-2.5 py-1 flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase">
                  <span>选择要插入的内容块 {slashQuery && `· "${slashQuery}"`}</span>
                  <button
                    type="button"
                    onClick={() => setSlashOpen(false)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto space-y-0.5">
                  {filteredSlashCommands.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-slate-400">
                      无匹配的块级命令
                    </p>
                  ) : (
                    filteredSlashCommands.map((item, idx) => {
                      const active = idx === slashSelectedIndex;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => executeSlashCommand(item)}
                          onMouseEnter={() => setSlashSelectedIndex(idx)}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-left cursor-pointer transition ${
                            active
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
                              active
                                ? 'bg-white border-blue-200 text-blue-600'
                                : 'bg-slate-50 border-slate-200/80 text-slate-500'
                            }`}
                          >
                            {item.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold truncate">{item.label}</div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {item.desc}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Floating @Mention Menu (Pages & Database Tables) */}
            {mentionOpen && (
              <div
                role="listbox"
                aria-label="引用工程页面与数据表菜单"
                style={floatingMenuStyle()}
                onMouseDown={(e) => e.preventDefault()}
                className="rounded-2xl border border-slate-200 bg-white shadow-2xl p-2 w-80 max-w-full z-40 space-y-1"
              >
                <div className="px-2.5 py-1 flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase">
                  <span>@ 引用工程页面或物理表 {mentionQuery && `· "${mentionQuery}"`}</span>
                  <button
                    type="button"
                    onClick={() => setMentionOpen(false)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-0.5">
                  {filteredMentions.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-slate-400">
                      未找到匹配的页面或数据表
                    </p>
                  ) : (
                    filteredMentions.map((item, idx) => {
                      const active = idx === mentionSelectedIndex;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => executeMentionInsert(item)}
                          onMouseEnter={() => setMentionSelectedIndex(idx)}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-left cursor-pointer transition ${
                            active
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
                              active
                                ? 'bg-white border-blue-200 text-blue-600'
                                : 'bg-slate-50 border-slate-200/80 text-slate-500'
                            }`}
                          >
                            {item.kind === 'page' ? (
                              <LayoutGrid size={13} />
                            ) : (
                              <Database size={13} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold truncate">{item.label}</div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {item.subLabel}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Rich Notion Editor Surface */}
            <div className="pf-notion-editor min-h-[420px]">
              {canMountRichEditor ? (
                <RichTiptapMount
                  projectId={projectId}
                  noteId={node.id}
                  initialContent={node.content || '<p></p>'}
                  onEditorReady={setEditor}
                  onSaveError={showNotice}
                  onSelectionTextChange={setSelectedExcerpt}
                  onSlashTrigger={(open, query) => {
                    setSlashOpen(open);
                    if (open) {
                      setMentionOpen(false);
                      setSlashQuery(query);
                      setSlashSelectedIndex(0);
                    }
                  }}
                  onMentionTrigger={(open, query) => {
                    setMentionOpen(open);
                    if (open) {
                      setSlashOpen(false);
                      setMentionQuery(query);
                      setMentionSelectedIndex(0);
                    }
                  }}
                />
              ) : (
                <textarea
                  aria-label="笔记正文编辑器"
                  value={node.content}
                  onChange={(e) => updateNoteContent(projectId, node.id, e.target.value)}
                  className="w-full min-h-[360px] rounded-xl border border-slate-200 p-4 text-sm text-slate-800 focus:outline-none focus:border-blue-600"
                />
              )}
            </div>
          </div>
        </div>

        {/* Right Collapsible Document Outline (TOC) — hidden when AI Assistant panel is docked */}
        {showOutline && !assistant && (
          <aside
            aria-label="笔记大纲目录"
            className="w-56 shrink-0 border-l border-slate-200 bg-slate-50/40 p-3 overflow-y-auto hidden lg:flex flex-col justify-between select-none"
          >
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-1">
                <span>文档大纲 (TOC)</span>
                <span className="font-mono text-[10px] text-slate-400">
                  {headings.length}
                </span>
              </div>

              {headings.length === 0 ? (
                <p className="px-1 py-4 text-[11px] leading-5 text-slate-400">
                  在文档中使用 H1 / H2 / H3 标题，此处将自动生成结构化章节导航。
                </p>
              ) : (
                <nav className="space-y-0.5">
                  {headings.map((h) => (
                    <button
                      key={`${h.index}-${h.text}`}
                      type="button"
                      onClick={() => scrollToHeading(h.index)}
                      style={{ paddingLeft: `${(h.level - 1) * 10 + 8}px` }}
                      className="w-full text-left py-1 pr-2 rounded-md text-xs text-slate-600 hover:bg-slate-200/60 hover:text-blue-600 truncate cursor-pointer transition block"
                      title={h.text}
                    >
                      {h.text}
                    </button>
                  ))}
                </nav>
              )}
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-white p-2.5 space-y-1 text-[11px] text-slate-500">
              <div className="font-semibold text-slate-700 flex items-center gap-1">
                <BookOpen size={12} className="text-blue-600" />
                <span>实战效率技巧</span>
              </div>
              <p>· 输入 <code className="px-1 rounded bg-slate-100">/</code> 唤起块级命令</p>
              <p>· 输入 <code className="px-1 rounded bg-slate-100">@</code> 引用页面或数据表</p>
              <p>· 按 <code className="px-1 rounded bg-slate-100">Cmd/Ctrl+V</code> 直接粘贴截图</p>
              <p>· 划词选中段落可一键转为页面需求便签</p>
            </div>
          </aside>
        )}
        </div>
      </div>

      {/* Right Full-Height Docked AI Note Assistant Companion Panel */}
      {assistant && (
        <NoteAssistantModal
          projectId={projectId}
          node={node}
          editor={editor}
          selection={assistant.selection}
          initialTab={assistant.tab}
          onClose={() => setAssistant(null)}
          onNotice={(message) => showNotice(message, 3500)}
        />
      )}

      {showStickySummary && (
        <StickySummaryModal
          mode="insert"
          preferredPageIds={noteContext(data, node.id, layout).relatedPageIds}
          noteContent={node.content}
          onClose={() => setShowStickySummary(false)}
          onInsert={(html, count) => {
            setShowStickySummary(false);
            if (!editor) return;
            editor.chain().focus().insertContent(html).run();
            showNotice(`已插入 ${count} 条画布批注，启用中的批注已生成待办。`, 3000);
          }}
        />
      )}

      {/* Modal: Convert Selected Excerpt into a Prototype Page Sticky Note */}
      {showStickyConvertModal && (
        <ConvertExcerptToStickyModal
          projectId={projectId}
          note={node}
          excerpt={selectedExcerpt}
          onClose={() => setShowStickyConvertModal(false)}
          onConverted={(targetPageId) => {
            setShowStickyConvertModal(false);
            setSelectedExcerpt('');
            showNotice('已将该段需求添加为原型页面便签！', 3000);
            if (targetPageId) {
              // Ensure the page is also linked to this note if not already
              try {
                addPageNoteLink(projectId, targetPageId, node.id);
              } catch {
                /* ignore if page is not in sitemap */
              }
            }
          }}
          addStickyRuleToWidget={addStickyRuleToWidget}
        />
      )}
    </div>
  );
}

function ConvertExcerptToStickyModal({
  projectId,
  note,
  excerpt,
  onClose,
  onConverted,
  addStickyRuleToWidget,
}: {
  projectId: string;
  note: Extract<NoteNode, { kind: 'note' }>;
  excerpt: string;
  onClose: () => void;
  onConverted: (pageId: string) => void;
  addStickyRuleToWidget: (
    pageId: string,
    targetWidgetId: string,
    ruleText: string,
    targetWidgetName?: string
  ) => void;
}) {
  const data = useProtoStore((s) => s.projectNotes);
  const activePageId = useProtoStore((s) => s.activePageId);
  const layout = usePageStore();

  const pages = useMemo(() => {
    const tree = flattenSitemap(
      buildSitemap(
        layout.designerFolders,
        layout.designerPages,
        layout.sitemapOverrides,
        layout.sitemapBase
      )
    );
    return tree.filter((item) => item.type === 'page' && item.pageId !== undefined);
  }, [layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase]);

  const relatedPageIds = useMemo(
    () => noteContext(data, note.id, layout).relatedPageIds,
    [data, note.id, layout]
  );

  const [targetPageId, setTargetPageId] = useState<string>(
    relatedPageIds[0] || activePageId || (pages[0]?.pageId ?? '')
  );
  const [targetRegionName, setTargetRegionName] = useState('客户沟通需求便签');
  const [textDraft, setTextDraft] = useState(excerpt.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPageId || !textDraft.trim()) return;
    addStickyRuleToWidget(
      targetPageId,
      'root',
      `【来自笔记《${note.title}》】${textDraft.trim()}`,
      targetRegionName.trim() || '页面全局区域'
    );
    onConverted(targetPageId);
  };

  return (
    <div className="pf-notes-surface fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="将选中段落转为页面需求便签"
        className="bg-white border border-slate-200 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden text-xs"
      >
        <header className="px-4 py-3 bg-amber-50/90 border-b border-amber-200/80 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-amber-950">
            <Pin size={15} className="text-amber-600" />
            <span>将笔记段落转为原型页面便签</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X size={15} />
          </button>
        </header>
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5">
          <label className="block font-medium text-slate-700">
            目标原型页面
            <select
              value={targetPageId}
              onChange={(e) => setTargetPageId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-800"
            >
              {pages.map((p) => (
                <option key={p.pageId} value={p.pageId}>
                  {p.title} ({p.pageId})
                </option>
              ))}
            </select>
          </label>
          <label className="block font-medium text-slate-700">
            便签挂载位置 / 模块说明
            <input
              type="text"
              value={targetRegionName}
              onChange={(e) => setTargetRegionName(e.target.value)}
              placeholder="例如：主表工具栏 / 审批弹框"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-800"
            />
          </label>
          <label className="block font-medium text-slate-700">
            便签需求内容
            <textarea
              rows={4}
              required
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-slate-800 leading-5"
            />
          </label>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!targetPageId}
              className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold cursor-pointer disabled:opacity-40"
            >
              生成页面需求便签
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Split-Screen Docked Note Companion Sidecar
 * Lets the Product Manager view/edit/check off notes right next to the Prototype Canvas or DB Designer!
 */
export function DockedNoteSidecar({
  projectId,
  noteId,
}: {
  projectId: string;
  noteId: string;
}) {
  const data = useProtoStore((s) => s.projectNotes);
  const { activePageId, setDockedNoteId, setViewMode } = useProtoStore();
  const layout = usePageStore();

  const allNotes = useMemo(
    () => data.nodes.filter((n): n is Extract<NoteNode, { kind: 'note' }> => n.kind === 'note'),
    [data.nodes]
  );

  // Notes linked to the currently active page
  const pageLinkedNotes = useMemo(() => {
    if (!activePageId) return [];
    return allNotes.filter((n) => {
      try {
        return noteContext(data, n.id, layout).relatedPageIds.includes(activePageId);
      } catch {
        return false;
      }
    });
  }, [allNotes, activePageId, data, layout]);

  const currentNote = useMemo(
    () =>
      allNotes.find((n) => n.id === noteId) ??
      pageLinkedNotes[0] ??
      allNotes[0] ??
      null,
    [allNotes, noteId, pageLinkedNotes]
  );

  const canMountRichEditor =
    typeof window !== 'undefined' &&
    typeof window.DOMParser === 'function' &&
    typeof document !== 'undefined' &&
    typeof document.createRange === 'function';

  const [sidecarError, setSidecarError] = useState('');

  const handleQuickCreateForActivePage = () => {
    try {
      const tpl = NOTE_TEMPLATES[0];
      const pageTitle = activePageId
        ? flattenSitemap(
            buildSitemap(
              layout.designerFolders,
              layout.designerPages,
              layout.sitemapOverrides,
              layout.sitemapBase
            )
          ).find((item) => item.type === 'page' && item.pageId === activePageId)?.title
        : undefined;
      const title = uniqueNoteTitle(
        data,
        null,
        `${pageTitle ? `${pageTitle} · ` : ''}客户沟通速记`
      );
      const id = createNoteNode(projectId, 'note', title, null, {
        icon: '🤝',
        content: noteTemplateContent(tpl),
        tags: ['客户沟通'],
        cover: 'none',
        status: 'pending_confirm',
      });
      if (activePageId) {
        try {
          addPageNoteLink(projectId, activePageId, id);
        } catch {
          /* ignore if activePageId is not in sitemap */
        }
      }
      setSidecarError('');
      setDockedNoteId(id);
    } catch (err) {
      setSidecarError(err instanceof Error ? err.message : '新建速记失败');
    }
  };

  return (
    <aside
      aria-label="画布分屏伴随笔记"
      className="pf-notes-surface w-[360px] shrink-0 border-l border-slate-200 bg-white flex flex-col h-full z-30 shadow-lg select-none"
    >
      {/* Sidecar Header */}
      <header className="px-3 py-2 border-b border-slate-200 bg-blue-50/50 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <BookOpenText size={14} className="text-blue-600 shrink-0" />
            <span className="text-xs font-semibold text-slate-900 truncate">
              伴随需求笔记 (分屏对照)
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {currentNote && (
              <button
                type="button"
                title="切换到全屏笔记工作台"
                onClick={() => {
                  openNoteNode(projectId, currentNote.id);
                }}
                className="p-1 rounded-md text-slate-500 hover:bg-white hover:text-blue-600 cursor-pointer transition"
              >
                <Maximize2 size={13} />
              </button>
            )}
            <button
              type="button"
              aria-label="关闭分屏伴随笔记"
              title="关闭分屏笔记"
              onClick={() => setDockedNoteId(null)}
              className="p-1 rounded-md text-slate-400 hover:bg-white hover:text-slate-700 cursor-pointer transition"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Note Switcher + New Quick Note */}
        <div className="flex items-center gap-1.5">
          <select
            aria-label="选择伴随笔记"
            value={currentNote?.id || ''}
            onChange={(e) => setDockedNoteId(e.target.value)}
            className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
          >
            {!allNotes.length && <option value="">暂无笔记</option>}
            {pageLinkedNotes.length > 0 && (
              <optgroup label="📌 当前页面关联笔记">
                {pageLinkedNotes.map((n) => (
                  <option key={`linked-${n.id}`} value={n.id}>
                    {n.icon} {n.title}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="📓 全部项目笔记">
              {allNotes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.icon} {n.title}
                </option>
              ))}
            </optgroup>
          </select>
          <button
            type="button"
            onClick={handleQuickCreateForActivePage}
            title="为当前页面新建速记笔记"
            className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <Plus size={12} />
            <span>速记</span>
          </button>
        </div>
        {sidecarError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700"
          >
            <span className="min-w-0 truncate" title={sidecarError}>{sidecarError}</span>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => setSidecarError('')}
              className="shrink-0 cursor-pointer text-rose-500 hover:text-rose-700"
            >
              <X size={11} />
            </button>
          </div>
        )}
      </header>

      {/* Sidecar Body */}
      {!currentNote ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
          <p className="text-xs text-slate-500">
            当前工程还没有笔记，点击下方按钮立即边看原型边记客户需求。
          </p>
          <button
            type="button"
            onClick={handleQuickCreateForActivePage}
            className="px-3.5 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-medium cursor-pointer"
          >
            + 新建当前页伴随笔记
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-3 select-text">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-base">{currentNote.icon}</span>
              <SidecarTitleInput
                key={currentNote.id}
                projectId={projectId}
                noteId={currentNote.id}
                title={currentNote.title}
                onError={setSidecarError}
              />
            </div>
            <select
              aria-label="需求状态"
              value={currentNote.status || 'draft'}
              onChange={(e) => {
                try {
                  updateNoteMeta(projectId, currentNote.id, {
                    status: e.target.value as NoteRequirementStatus,
                  });
                } catch (err) {
                  setSidecarError(err instanceof Error ? err.message : '状态未保存');
                }
              }}
              className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 shrink-0"
            >
              {NOTE_STATUS_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="pf-notion-editor text-xs">
            {canMountRichEditor ? (
              <RichTiptapMount
                key={currentNote.id}
                projectId={projectId}
                noteId={currentNote.id}
                initialContent={currentNote.content || '<p></p>'}
                onEditorReady={() => {}}
                onSaveError={setSidecarError}
                onSelectionTextChange={() => {}}
                onSlashTrigger={() => {}}
                onMentionTrigger={() => {}}
              />
            ) : (
              <textarea
                value={currentNote.content}
                onChange={(e) =>
                  updateNoteContent(projectId, currentNote.id, e.target.value)
                }
                className="w-full min-h-[280px] rounded-lg border border-slate-200 p-2 text-xs"
              />
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

/** Title editing keeps a local draft and commits on blur/Enter, so spaces can be typed and
 * clashes with sibling titles are reported instead of thrown from the change handler. */
function SidecarTitleInput({
  projectId,
  noteId,
  title,
  onError,
}: {
  projectId: string;
  noteId: string;
  title: string;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(title);
  const committedRef = useRef(title);
  useEffect(() => {
    committedRef.current = title;
    setDraft(title);
  }, [title]);

  const commitTitle = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(committedRef.current);
      return;
    }
    if (trimmed === committedRef.current) return;
    try {
      updateNoteMeta(projectId, noteId, { title: trimmed });
      onError('');
    } catch (err) {
      setDraft(committedRef.current);
      onError(`标题未保存：${err instanceof Error ? err.message : '名称无效'}`);
    }
  };

  return (
    <input
      type="text"
      aria-label="伴随笔记标题"
      value={draft}
      maxLength={100}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitTitle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(committedRef.current);
          e.currentTarget.blur();
        }
      }}
      className="text-sm font-bold text-slate-900 bg-transparent border-none focus:outline-none truncate"
    />
  );
}

function RichTiptapMount({
  projectId,
  noteId,
  initialContent,
  onEditorReady,
  onSelectionTextChange,
  onSlashTrigger,
  onMentionTrigger,
  onSaveError,
}: {
  projectId: string;
  noteId: string;
  initialContent: string;
  onEditorReady: (editor: Editor | null) => void;
  onSelectionTextChange: (selectedText: string) => void;
  onSlashTrigger: (open: boolean, query: string) => void;
  onMentionTrigger: (open: boolean, query: string) => void;
  onSaveError?: (message: string) => void;
}) {
  // The last HTML this editor wrote to (or loaded from) the store. Any other store value
  // for this note is an external change (global to-do toggle, template, AI…) to pull in.
  const lastSyncedRef = useRef(initialContent);
  const onSaveErrorRef = useRef(onSaveError);
  onSaveErrorRef.current = onSaveError;

  /** Compresses, stores each image as a project asset, then inserts `pf-asset:` image nodes. */
  const insertImageFiles = async (
    view: EditorView,
    files: File[],
    alt?: string,
    pos?: number
  ) => {
    for (const file of files) {
      try {
        const src = registerNoteImage(projectId, await prepareNoteImage(file), file.name);
        const node = view.state.schema.nodes.image?.create({ src, alt: alt ?? (file.name || '需求参考图片') });
        if (!node || view.isDestroyed) continue;
        const tr =
          pos !== undefined && pos <= view.state.doc.content.size
            ? view.state.tr.insert(pos, node)
            : view.state.tr.replaceSelectionWith(node);
        view.dispatch(tr);
      } catch (err) {
        onSaveErrorRef.current?.(`图片未插入：${err instanceof Error ? err.message : '读取失败'}`);
      }
    }
  };
  const storeContent = useProtoStore((s) => {
    const node = s.projectNotes.nodes.find((n) => n.id === noteId);
    return node && node.kind === 'note' ? node.content : undefined;
  });
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Placeholder.configure({
          placeholder:
            '输入内容，输入 "/" 唤起块级命令，输入 "@" 引用页面或物理表，按 Cmd/Ctrl+V 直接粘贴截图...',
        }),
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        Table.configure({
          resizable: false,
        }),
        TableRow,
        TableHeader,
        TableCell,
        Highlight.configure({ multicolor: false }),
        Underline,
        Link.configure({
          openOnClick: false,
        }),
        NoteImageExtension,
      ],
      editorProps: {
        handlePaste: (view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (!files.length) return false;
          event.preventDefault();
          void insertImageFiles(view, files, '粘贴的需求截图');
          return true;
        },
        handleDrop: (view, event) => {
          const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (!files.length) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void insertImageFiles(view, files, undefined, pos);
          return true;
        },
      },
      content: initialContent,
      onSelectionUpdate: ({ editor: ed }) => {
        const { from, to } = ed.state.selection;
        if (to > from) {
          const txt = ed.state.doc.textBetween(from, to, '\n').trim();
          onSelectionTextChange(txt);
        } else {
          onSelectionTextChange('');
        }
      },
      onUpdate: ({ editor: ed }) => {
        const html = ed.getHTML();
        lastSyncedRef.current = html;
        try {
          updateNoteContent(projectId, noteId, html);
        } catch (err) {
          onSaveError?.(err instanceof Error ? err.message : '笔记保存失败');
        }

        const { selection } = ed.state;
        const { $from } = selection;
        const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
        const slashMatch = textBefore.match(/(?:^|\s)\/([^\s/]*)$/);
        const mentionMatch = textBefore.match(/(?:^|\s)@([^\s@]*)$/);
        if (slashMatch) {
          onSlashTrigger(true, slashMatch[1]);
        } else {
          onSlashTrigger(false, '');
        }
        if (mentionMatch) {
          onMentionTrigger(true, mentionMatch[1]);
        } else {
          onMentionTrigger(false, '');
        }
      },
    },
    [projectId, noteId]
  );

  useEffect(() => {
    onEditorReady(editor);
    return () => onEditorReady(null);
  }, [editor, onEditorReady]);

  // Pull external changes into the open editor; otherwise the next keystroke would
  // overwrite them with the editor's stale document.
  useEffect(() => {
    if (!editor || editor.isDestroyed || storeContent === undefined) return;
    if (storeContent === lastSyncedRef.current) return;
    lastSyncedRef.current = storeContent;
    if (storeContent === editor.getHTML()) return;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(storeContent, { emitUpdate: false });
    const max = editor.state.doc.content.size;
    try {
      editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
    } catch {
      /* selection may land inside a non-text node; keep the default */
    }
  }, [editor, storeContent]);

  if (!editor) return null;
  return <EditorContent editor={editor} />;
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`p-1.5 rounded-md cursor-pointer transition ${
        active
          ? 'bg-blue-100 text-blue-700 font-semibold'
          : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}
