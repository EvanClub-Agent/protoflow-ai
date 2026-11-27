import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Blockquote from '@tiptap/extension-blockquote';
import CodeBlock from '@tiptap/extension-code-block';
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
  AlertTriangle,
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
  Eye,
  GitBranch,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  Image as ImageIcon,
  Italic,
  LayoutGrid,
  LayoutTemplate,
  List,
  ListOrdered,
  ListTodo,
  Lock,
  Maximize2,
  Minimize2,
  Minus,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Pin,
  Plus,
  Quote,
  Rows,
  Search,
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
import { flattenSitemap, mindmapPath } from '../proto/mindmaps';
import { renderMermaidDiagram } from '../services/mindmapRenderer';
import {
  NOTE_COVERS,
  NOTE_EMOJI_CATALOG,
  NOTE_PRESET_TAGS,
  NOTE_PRIORITY_OPTIONS,
  NOTE_STATUS_OPTIONS,
  NOTE_TEMPLATES,
  VALID_NOTE_CALLOUTS,
  extractInlineNoteImages,
  extractNoteHeadings,
  markdownToNoteHtml,
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
  type NoteCalloutKind,
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
import { useI18n, tr } from '../i18n';

const NOTE_STATUS_EN: Record<NoteRequirementStatus, string> = {
  draft: 'Draft',
  pending_confirm: 'Pending',
  confirmed: 'Confirmed',
  implemented: 'Implemented',
};

const NOTE_PRIORITY_EN: Record<NotePriority, string> = {
  P0: 'P0 · Critical',
  P1: 'P1 · High',
  P2: 'P2 · Normal',
};

const NOTE_COVER_EN: Record<string, string> = {
  none: 'None',
  ocean: 'Ocean',
  indigo: 'Indigo',
  amber: 'Amber',
  emerald: 'Emerald',
  rose: 'Rose',
  slate: 'Slate',
};

const NOTE_TPL_EN: Record<string, { title: string; desc: string }> = {
  'customer-discovery': {
    title: 'Customer Discovery Notes',
    desc: 'Capture interview background, pain points, key decisions, and open questions.',
  },
  'review-minutes': {
    title: 'Prototype Review Minutes',
    desc: 'Record review feedback, UI adjustments, and action items by module.',
  },
  'business-rules': {
    title: 'Business Rules & Specs',
    desc: 'Document validation formulas, status flows, permissions, and field constraints.',
  },
  'blank-note': {
    title: 'Blank Requirement Note',
    desc: 'Start from a clean block document with slash commands and @mentions.',
  },
};

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
        img.title = resolved ? String(attrs.alt ?? '') : tr('图片数据缺失', 'Image data missing');
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

/**
 * Blockquote extended with GFM Alert / Callout variants (`data-callout="note|tip|important|warning|caution"`).
 */
const NoteBlockquoteExtension = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      callout: {
        default: null,
        parseHTML: (element) => {
          const val = (element.getAttribute('data-callout') || '').toLowerCase();
          return VALID_NOTE_CALLOUTS.has(val) ? val : null;
        },
        renderHTML: (attributes) => {
          const val = String(attributes.callout || '').toLowerCase();
          return VALID_NOTE_CALLOUTS.has(val) ? { 'data-callout': val } : {};
        },
      },
    };
  },
});

/**
 * CodeBlock extended with an interactive Mermaid visual diagram NodeView (`language === 'mermaid'`).
 * Stored HTML stays pure `<pre><code class="language-mermaid">...</code></pre>` for 100% GFM compatibility.
 */
const NoteCodeBlockExtension = CodeBlock.extend({
  addNodeView() {
    return ({ node: initialNode }) => {
      let currentNode = initialNode;
      const isMermaid = () => String(currentNode.attrs.language || '').toLowerCase() === 'mermaid';

      if (!isMermaid()) {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (currentNode.attrs.language) {
          code.className = `language-${currentNode.attrs.language}`;
        }
        pre.appendChild(code);
        return {
          dom: pre,
          contentDOM: code,
          update: (next) => {
            if (next.type.name !== 'codeBlock') return false;
            if (String(next.attrs.language || '').toLowerCase() === 'mermaid') return false;
            currentNode = next;
            code.className = next.attrs.language ? `language-${next.attrs.language}` : '';
            return true;
          },
        };
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'pf-note-mermaid-block';
      let mode: 'preview' | 'split' | 'code' = currentNode.textContent.trim() ? 'preview' : 'split';
      wrapper.dataset.mode = mode;

      const header = document.createElement('div');
      header.className = 'pf-note-mermaid-header';
      header.contentEditable = 'false';

      const badge = document.createElement('span');
      badge.className = 'font-semibold text-slate-700 flex items-center gap-1.5';
      badge.textContent = `📊 ${tr('Mermaid 状态机 / 流程图', 'Mermaid Flowchart / State Diagram')}`;

      const controls = document.createElement('div');
      controls.className = 'flex items-center gap-1';

      const makeModeBtn = (targetMode: 'preview' | 'split' | 'code', label: string) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        const syncActive = () => {
          btn.className =
            mode === targetMode
              ? 'px-2 py-0.5 rounded bg-blue-600 text-white font-medium cursor-pointer transition'
              : 'px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer transition';
        };
        syncActive();
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          mode = targetMode;
          wrapper.dataset.mode = mode;
          syncAllButtons();
        });
        return { btn, syncActive };
      };

      const btnPreview = makeModeBtn('preview', tr('预览图表', 'Diagram'));
      const btnSplit = makeModeBtn('split', tr('分栏编辑', 'Split'));
      const btnCode = makeModeBtn('code', tr('源码', 'Code'));
      const syncAllButtons = () => {
        btnPreview.syncActive();
        btnSplit.syncActive();
        btnCode.syncActive();
      };
      controls.append(btnPreview.btn, btnSplit.btn, btnCode.btn);
      header.append(badge, controls);

      const body = document.createElement('div');
      body.className = 'pf-note-mermaid-body';

      const sourceWrap = document.createElement('div');
      sourceWrap.className = 'pf-note-mermaid-source';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = 'language-mermaid';
      pre.appendChild(code);
      sourceWrap.appendChild(pre);

      const preview = document.createElement('div');
      preview.className = 'pf-note-mermaid-preview';
      preview.contentEditable = 'false';

      body.append(sourceWrap, preview);
      wrapper.append(header, body);

      let destroyed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let lastSource = '';

      const runRender = (sourceText: string) => {
        const trimmed = sourceText.trim();
        if (!trimmed) {
          preview.innerHTML = `<span class="text-xs text-slate-400">${tr('输入 Mermaid 语法即可实时预览流程图或状态机...', 'Enter Mermaid syntax to preview flowchart or state diagram...')}</span>`;
          return;
        }
        const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
        void renderMermaidDiagram(trimmed, dark).then(
          ({ svg }) => {
            if (destroyed || sourceText !== currentNode.textContent) return;
            preview.innerHTML = svg;
          },
          (err) => {
            if (destroyed || sourceText !== currentNode.textContent) return;
            const msg = (err instanceof Error ? err.message : String(err)).replace(/[<>&]/g, '');
            preview.innerHTML = `<div class="w-full rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800"><strong>${tr('Mermaid 语法待修正：', 'Mermaid syntax issue: ')}</strong>${msg.slice(0, 220)}</div>`;
          }
        );
      };

      lastSource = currentNode.textContent;
      runRender(lastSource);

      return {
        dom: wrapper,
        contentDOM: code,
        stopEvent: (event) => {
          const target = event.target as HTMLElement | null;
          return Boolean(target && (header.contains(target) || preview.contains(target)));
        },
        ignoreMutation: (mutation) => {
          return header.contains(mutation.target) || preview.contains(mutation.target) || mutation.target === wrapper;
        },
        update: (next) => {
          if (next.type.name !== 'codeBlock') return false;
          if (String(next.attrs.language || '').toLowerCase() !== 'mermaid') return false;
          currentNode = next;
          if (next.textContent !== lastSource) {
            lastSource = next.textContent;
            clearTimeout(timer);
            timer = setTimeout(() => runRender(lastSource), 200);
          }
          return true;
        },
        destroy: () => {
          destroyed = true;
          clearTimeout(timer);
        },
      };
    };
  },
});

/** Detect whether pasted plain text contains structured multi-line Markdown that should be parsed into blocks. */
function shouldParsePastedMarkdown(plainText: string, htmlText: string): boolean {
  if (!plainText || plainText.length < 6) return false;
  if (htmlText && /<(h[1-6]|table|ul|ol|blockquote|img)\b/i.test(htmlText)) return false;
  const lines = plainText.replace(/\r\n/g, '\n').split('\n');
  if (lines.length < 2) {
    return /^#{1,5}\s+\S/.test(lines[0].trim());
  }
  let blockSignals = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^#{1,5}\s+\S/.test(t)) blockSignals += 2;
    else if (/^(`{3,}|~{3,})/.test(t)) blockSignals += 2;
    else if (/^>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(t)) blockSignals += 2;
    else if (/^[-*+]\s+\[[ xX]\]\s+/.test(t)) blockSignals += 2;
    else if (t.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) blockSignals += 3;
    else if (/^(?:[-*+]|\d+\.)\s+\S/.test(t)) blockSignals += 1;
    if (blockSignals >= 2) return true;
  }
  return false;
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(tr('读取图片失败', 'Failed to read image')));
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
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error(tr('仅支持 PNG、JPG、WebP 或 GIF 图片', 'Only PNG, JPG, WebP, or GIF images are supported'));
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

function getSlashCommands(t: <T extends string>(zh: T, en: string) => string): SlashCommandItem[] {
  return [
    {
      id: 'aiWrite',
      label: t('AI 代写', 'AI Draft'),
      desc: t('描述写作要求，起草正文、续写内容或生成提纲', 'Describe what to write — draft sections, continue writing, or generate an outline'),
      keywords: ['ai', '代写', '写作', '续写', '提纲', 'write', 'draft'],
      icon: <Sparkles size={14} />,
      run: (_editor, helpers) => helpers?.openAssistant('write'),
    },
    {
      id: 'aiPolish',
      label: t('AI 润色改写', 'AI Polish & Rewrite'),
      desc: t('保留原意，优化表达、精简内容或梳理结构', 'Preserve meaning while improving clarity, conciseness, or structure'),
      keywords: ['ai', '润色', '改写', '精简', 'polish', 'rewrite'],
      icon: <Wand2 size={14} />,
      run: (_editor, helpers) => helpers?.openAssistant('polish'),
    },
    {
      id: 'aiOrganize',
      label: t('AI 整理成纪要', 'AI Organize Minutes'),
      desc: t('把速记 / 语音转写整理为结论、需求表格与待办（预览后再写入）', 'Turn raw notes or transcripts into decisions, requirement tables, and to-dos'),
      keywords: ['ai', '整理', '纪要', '转写', '总结', 'summary', 'minutes'],
      icon: <Sparkles size={14} />,
      run: (_editor, helpers) => helpers?.openAssistant('organize'),
    },
    {
      id: 'aiActions',
      label: t('AI 提取待办', 'AI Extract To-Dos'),
      desc: t('扫描口头承诺，生成“负责人｜截止时间｜事项”待办', 'Scan commitments and generate "Owner | Due | Action" checkable to-dos'),
      keywords: ['ai', '待办', 'action', 'todo', '提取', 'extract'],
      icon: <ListTodo size={14} />,
      run: (_editor, helpers) => helpers?.openAssistant('actions'),
    },
    {
      id: 'paragraph',
      label: t('正文段落', 'Paragraph'),
      desc: t('普通文本段落', 'Plain text paragraph'),
      keywords: ['text', 'p', '正文', '段落', 'paragraph'],
      icon: <AlignLeft size={14} />,
      run: (editor) => editor.chain().focus().setParagraph().run(),
    },
    {
      id: 'h1',
      label: t('一级标题 (H1)', 'Heading 1 (H1)'),
      desc: t('核心章节大标题', 'Top-level section heading'),
      keywords: ['h1', 'heading1', '标题1', '一级标题'],
      icon: <Heading1 size={14} />,
      run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: 'h2',
      label: t('二级标题 (H2)', 'Heading 2 (H2)'),
      desc: t('模块或小节中标题', 'Module or subsection heading'),
      keywords: ['h2', 'heading2', '标题2', '二级标题'],
      icon: <Heading2 size={14} />,
      run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      id: 'h3',
      label: t('三级标题 (H3)', 'Heading 3 (H3)'),
      desc: t('细分要点小标题', 'Detailed sub-point heading'),
      keywords: ['h3', 'heading3', '标题3', '三级标题'],
      icon: <Heading3 size={14} />,
      run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      id: 'h4',
      label: t('四级标题 (H4)', 'Heading 4 (H4)'),
      desc: t('弹窗、抽屉或子规则小节标题', 'Modal, drawer, or sub-rule section heading'),
      keywords: ['h4', 'heading4', '标题4', '四级标题'],
      icon: <Heading4 size={14} />,
      run: (editor) => editor.chain().focus().toggleHeading({ level: 4 }).run(),
    },
    {
      id: 'taskList',
      label: t('待办清单 (To-do)', 'To-Do List'),
      desc: t('跟踪客户待确认问题与跟进事项（自动汇总到全局待办）', 'Track open client questions and follow-ups (auto-synced to Global To-Dos)'),
      keywords: ['todo', 'task', 'checkbox', '待办', '任务', '清单'],
      icon: <CheckSquare size={14} />,
      run: (editor) => editor.chain().focus().toggleTaskList().run(),
    },
    {
      id: 'bulletList',
      label: t('无序列表', 'Bulleted List'),
      desc: t('创建项目符号列表', 'Create a bulleted list'),
      keywords: ['ul', 'bullet', 'list', '无序', '列表'],
      icon: <List size={14} />,
      run: (editor) => editor.chain().focus().toggleBulletList().run(),
    },
    {
      id: 'orderedList',
      label: t('有序列表', 'Numbered List'),
      desc: t('创建带编号的步骤列表', 'Create a numbered step list'),
      keywords: ['ol', 'number', 'ordered', '有序', '编号'],
      icon: <ListOrdered size={14} />,
      run: (editor) => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      id: 'callout',
      label: t('重要业务约束框 (Important)', 'Important Callout'),
      desc: t('高亮标注核心业务约束、状态流转前提或客户拍板结论', 'Highlight critical business constraints or client sign-off decisions'),
      keywords: ['quote', 'callout', 'important', '引用', '提示', '结论', '重点', '约束'],
      icon: <Quote size={14} />,
      run: (editor) =>
        editor
          .chain()
          .focus()
          .insertContent(
            t(
              '<blockquote data-callout="important"><p><strong>核心约束说明</strong>：在此补充关键前置条件或校验口径。</p></blockquote>',
              '<blockquote data-callout="important"><p><strong>Key Constraint</strong>: Document critical preconditions or validation rules here.</p></blockquote>'
            )
          )
          .run(),
    },
    {
      id: 'calloutWarning',
      label: t('边界与风险警示框 (Warning)', 'Warning Callout'),
      desc: t('突出提示异常分支、防重拦截或权限控制注意项', 'Highlight edge cases, duplicate guards, or permission rules'),
      keywords: ['warning', 'caution', 'alert', '风险', '警告', '红线', '注意'],
      icon: <AlertTriangle size={14} />,
      run: (editor) =>
        editor
          .chain()
          .focus()
          .insertContent(
            t(
              '<blockquote data-callout="warning"><p><strong>边界异常处理</strong>：当触发越限或状态不满足时阻断提交并提示原因。</p></blockquote>',
              '<blockquote data-callout="warning"><p><strong>Edge Case Guard</strong>: Block submission and explain when state or limits fail.</p></blockquote>'
            )
          )
          .run(),
    },
    {
      id: 'mermaid',
      label: t('Mermaid 状态机 / 流程图', 'Mermaid Flowchart / State Diagram'),
      desc: t('内嵌可实时预览的单据状态流转图、泳道图或推单链路图', 'Embed a live-rendered state machine, swimlane, or business flowchart'),
      keywords: ['mermaid', 'flow', 'diagram', 'state', '流程图', '状态机', '状态图', '泳道图'],
      icon: <GitBranch size={14} />,
      run: (editor) =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'codeBlock',
            attrs: { language: 'mermaid' },
            content: [
              {
                type: 'text',
                text: t(
                  'stateDiagram-v2\n  direction LR\n  [*] --> 草稿: 新建保存\n  草稿 --> 待审核: 提交单据\n  待审核 --> 已通过: 审核通过\n  待审核 --> 已驳回: 驳回修改\n  已驳回 --> 待审核: 重新提交',
                  'stateDiagram-v2\n  direction LR\n  [*] --> Draft: Save\n  Draft --> Pending: Submit\n  Pending --> Approved: Approve\n  Pending --> Rejected: Reject'
                ),
              },
            ],
          })
          .run(),
    },
    {
      id: 'table',
      label: t('需求对比表格 (3×3)', 'Table (3×3)'),
      desc: t('插入结构化业务字段或诉求对比表', 'Insert a structured 3×3 field or requirement comparison table'),
      keywords: ['table', 'grid', '表格', '字段表'],
      icon: <TableIcon size={14} />,
      run: (editor) =>
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      id: 'image',
      label: t('插入需求参考图片 / 截图', 'Insert Image / Screenshot'),
      desc: t('上传本地截图，或直接在编辑器按 Cmd/Ctrl+V 粘贴截图', 'Upload a local image or press Cmd/Ctrl+V to paste a screenshot'),
      keywords: ['image', 'img', 'pic', '图片', '截图', 'screenshot'],
      icon: <ImageIcon size={14} />,
      run: (_editor, helpers) => helpers?.uploadImage(),
    },
    {
      id: 'stickySummary',
      label: t('汇总画布批注', 'Summarize Canvas Annotations'),
      desc: t('把关联页面上的组件便签按页面/组件汇总成表格与待办', 'Aggregate component sticky notes from linked pages into tables and to-dos'),
      keywords: ['sticky', 'pin', '批注', '便签', '评审', '汇总', 'annotations'],
      icon: <Pin size={14} />,
      run: (_editor, helpers) => helpers?.summarizeStickies(),
    },
    {
      id: 'codeBlock',
      label: t('代码块 / 校验规则', 'Code / Formula Block'),
      desc: t('记录计算公式、SQL 片段或伪代码逻辑', 'Document formulas, SQL snippets, or validation pseudocode'),
      keywords: ['code', 'sql', '代码', '公式', '规则'],
      icon: <Code2 size={14} />,
      run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: 'hr',
      label: t('分割线', 'Divider'),
      desc: t('在视觉上分隔不同模块内容', 'Visually separate sections'),
      keywords: ['hr', 'divider', 'line', '分割线'],
      icon: <Minus size={14} />,
      run: (editor) => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      id: 'reqSnippet',
      label: t('客户需求沟通小节模板', 'Requirement Section Snippet'),
      desc: t('一键插入诉求描述 + 待确认清单组合块', 'Insert a structured scenario, goal, and fields block'),
      keywords: ['template', 'req', '需求', '客户', '模板', 'snippet'],
      icon: <Sparkles size={14} />,
      run: (editor) =>
        editor
          .chain()
          .focus()
          .insertContent(
            t(
              `<h3>📌 业务模块诉求小结</h3><ul><li><strong>业务场景</strong>：描述客户在什么场景下触发该操作</li><li><strong>核心诉求</strong>：描述期望的页面展示与交互行为</li><li><strong>涉及字段</strong>：列出新增或必改字段</li></ul>`,
              `<h3>📌 Module Requirement Summary</h3><ul><li><strong>Scenario</strong>: Describe when users trigger this workflow</li><li><strong>Core Goal</strong>: Describe expected UI presentation and interactions</li><li><strong>Fields</strong>: List new or modified fields</li></ul>`
            )
          )
          .run(),
    },
  ];
}

export interface MentionCandidate {
  id: string;
  kind: 'page' | 'table' | 'note' | 'mindmap';
  label: string;
  subLabel: string;
  href: string;
}

function useProjectMentionCandidates(excludeNoteId?: string): MentionCandidate[] {
  const { tr, td } = useI18n();
  const dbTables = useProtoStore((s) => s.dbTables);
  const projectNotes = useProtoStore((s) => s.projectNotes);
  const mindmaps = useProtoStore((s) => s.mindmaps);
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
          subLabel: tr(`页面 · ${node.pageId}`, `Page · ${node.pageId}`),
          href: `#pf-page:${node.pageId}`,
        });
      }
    }
    for (const tbl of dbTables) {
      items.push({
        id: `table:${tbl.id}`,
        kind: 'table',
        label: `${tbl.tableName} (${tbl.cnName})`,
        subLabel: tr(`数据表 · ${tbl.domain}`, `Table · ${td(tbl.domain)}`),
        href: `#pf-table:${tbl.id}`,
      });
    }
    for (const note of projectNotes.nodes) {
      if (note.kind === 'note' && note.id !== excludeNoteId) {
        items.push({
          id: `note:${note.id}`,
          kind: 'note',
          label: note.title,
          subLabel: tr(`项目笔记 · ${notePath(projectNotes, note.id)}`, `Note · ${notePath(projectNotes, note.id)}`),
          href: `#pf-note:${note.id}`,
        });
      }
    }
    for (const mm of mindmaps.nodes) {
      if (mm.kind === 'mindmap') {
        items.push({
          id: `mindmap:${mm.id}`,
          kind: 'mindmap',
          label: mm.title,
          subLabel: tr(`项目脑图 · ${mindmapPath(mindmaps, mm.id)}`, `Diagram · ${mindmapPath(mindmaps, mm.id)}`),
          href: `#pf-mindmap:${mm.id}`,
        });
      }
    }
    return items;
  }, [dbTables, projectNotes, mindmaps, excludeNoteId, layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase, tr, td]);
}

export function ProjectNotesView({ projectId }: { projectId: string }) {
  const { isEn, tr, td } = useI18n();
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
    const tplTitle = isEn ? NOTE_TPL_EN[tpl.id]?.title ?? td(tpl.title) : tpl.title;
    const title = uniqueNoteTitle(
      data,
      parentId,
      tpl.id === 'blank-note' ? tr('未命名需求笔记', 'Untitled Requirement Note') : tplTitle
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
  const { isEn, tr, td } = useI18n();
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
      <header className="h-11 shrink-0 border-b border-slate-200 px-4 flex items-center justify-between gap-2 bg-white">
        <div className="flex items-center gap-2 min-w-0">
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label={tr('展开笔记目录', 'Expand notes directory')}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0 cursor-pointer"
            >
              <PanelLeftOpen size={15} />
            </button>
          )}
          <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5 min-w-0">
            <BookOpenText size={14} className="text-blue-600 shrink-0" />
            <span className="truncate">
              {folderNode ? `${notePath(data, folderNode.id)}` : tr('项目笔记工作台', 'Project Notes Workspace')}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setShowReviewFromStickies(true)}
          title={tr('把画布上的组件批注汇总成一篇评审修改清单', 'Compile canvas component annotations into a review checklist note')}
          className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Pin size={12} className="shrink-0" />
          {tr('从画布批注生成评审清单', 'Checklist from Annotations')}
        </button>
        <div
          role="group"
          aria-label={tr('笔记总览视图', 'Notes overview mode')}
          className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-[11px]"
        >
          {(
            [
              { id: 'cards', label: tr('卡片', 'Cards'), icon: <LayoutGrid size={12} /> },
              { id: 'table', label: tr('台账表格', 'Ledger'), icon: <TableIcon size={12} /> },
              { id: 'kanban', label: tr('状态看板', 'Kanban'), icon: <Columns size={12} /> },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={overviewMode === item.id}
              onClick={() => setOverviewMode(item.id)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium whitespace-nowrap shrink-0 cursor-pointer transition ${
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
          {td(overviewError)}
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
              setOverviewError(err instanceof Error ? err.message : tr('生成评审清单失败', 'Failed to generate review checklist'));
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
            <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2 min-w-0">
              <span className="shrink-0">{folderNode ? folderNode.icon : '📊'}</span>
              <span className="truncate">
                {folderNode
                  ? tr(`${folderNode.title} · 需求台账`, `${folderNode.title} · Requirement Ledger`)
                  : tr('项目需求台账', 'Project Requirement Ledger')}
              </span>
            </h1>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]" aria-label={tr('从模板新建笔记', 'Create note from template')}>
              <span className="text-slate-400">{tr('新建：', 'New:')}</span>
              {NOTE_TEMPLATES.map((tpl) => {
                const tplTitle = isEn ? NOTE_TPL_EN[tpl.id]?.title ?? td(tpl.title) : tpl.title;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => onCreateFromTemplate(tpl.id, parentId)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:border-blue-300 hover:text-blue-600 whitespace-nowrap cursor-pointer"
                  >
                    <span>{tpl.icon}</span>
                    {tplTitle}
                  </button>
                );
              })}
            </div>
          </div>
          <NotesLedger projectId={projectId} folderId={parentId} mode={overviewMode} />
        </div>
      ) : (
      <div className="max-w-4xl w-full mx-auto px-8 py-10 space-y-8">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200/80 text-[11px] font-medium">
            <Sparkles size={12} className="shrink-0" />
            <span>
              {tr(
                '块级文档 · 支持画布分屏伴随、@引用页面/表、直接粘贴截图与全局待办追踪',
                'Block Editor · Split-screen canvas sidecar, @page/@table mentions, screenshot paste & global to-do tracking'
              )}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <span>{folderNode ? folderNode.icon : '📓'}</span>
            <span>
              {folderNode
                ? folderNode.title
                : tr('记录客户沟通需求、评审纪要与业务规则', 'Capture Discovery Notes, Review Minutes & Business Rules')}
            </span>
          </h1>
          <p className="text-xs text-slate-500 leading-5 max-w-2xl">
            {isEn ? (
              <>
                Organize nested folders, type <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">/</code> for block commands, type <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">@</code> to mention prototype pages or tables, paste screenshots directly, and dock notes beside the canvas.
              </>
            ) : (
              <>
                支持多层级目录管理、输入 <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">/</code> 唤起块级命令、输入 <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">@</code> 引用原型页面或数据表、直接粘贴客户截图，并可点击右上角「分屏对照原型」边看笔记边改画布。
              </>
            )}
          </p>
        </div>

        {/* Quick Start Templates */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {tr('从精选模板快速新建笔记', 'Quick-Start Note Templates')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {NOTE_TEMPLATES.map((tpl) => {
              const tplTitle = isEn ? NOTE_TPL_EN[tpl.id]?.title ?? td(tpl.title) : tpl.title;
              const tplDesc = isEn ? NOTE_TPL_EN[tpl.id]?.desc ?? td(tpl.desc) : tpl.desc;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => onCreateFromTemplate(tpl.id, parentId)}
                  className="group min-w-0 p-4 rounded-2xl border border-slate-200/90 bg-white hover:border-blue-400 hover:shadow-md text-left transition cursor-pointer flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-slate-50 group-hover:bg-blue-50 border border-slate-200/70 flex items-center justify-center text-lg transition">
                      {tpl.icon}
                    </div>
                    <div className="font-semibold text-xs text-slate-900 group-hover:text-blue-600 transition break-words">
                      {tplTitle}
                    </div>
                    <p className="text-[11px] text-slate-500 leading-4 line-clamp-2">
                      {tplDesc}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-medium text-blue-600 pt-1">
                    <Plus size={12} />
                    <span>{tr('立即创建', 'Create Note')}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Child Notes & Folders in Current Directory */}
        {childNodes.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider tabular-nums">
              {folderNode
                ? tr(`「${folderNode.title}」下的内容 (${childNodes.length})`, `Items in "${folderNode.title}" (${childNodes.length})`)
                : tr(`根目录下的笔记与目录 (${childNodes.length})`, `Root Notes & Folders (${childNodes.length})`)}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {childNodes.map((child) => {
                const snippet =
                  child.kind === 'note'
                    ? noteHtmlToPlainText(child.content).slice(0, 80)
                    : tr('分类目录', 'Folder');
                const statusMeta =
                  child.kind === 'note' && child.status
                    ? NOTE_STATUS_OPTIONS.find((s) => s.id === child.status)
                    : undefined;
                return (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => openNoteNode(projectId, child.id)}
                    className="min-w-0 p-4 rounded-2xl border border-slate-200 bg-slate-50/40 hover:bg-white hover:border-blue-300 hover:shadow-xs text-left transition cursor-pointer space-y-2"
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
                            className={`px-1.5 py-0.2 rounded border text-[10px] font-medium whitespace-nowrap ${statusMeta.badgeClass}`}
                          >
                            {isEn ? NOTE_STATUS_EN[statusMeta.id] ?? td(statusMeta.label) : statusMeta.label}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 tabular-nums">
                          {child.updatedAt.slice(0, 10)}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 line-clamp-2 leading-4">
                      {snippet || tr('空白笔记，点击开始录入内容...', 'Blank note — click to start writing...')}
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
                            {td(t)}
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
  const { isEn, tr, td } = useI18n();
  const slashCommands = useMemo(() => getSlashCommands(tr), [tr]);
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
  const [tocQuery, setTocQuery] = useState('');
  const [activeHeadingIdx, setActiveHeadingIdx] = useState<number>(0);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [isWideLayout, setIsWideLayout] = useState<boolean>(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('pf_notes_wide_layout') : null;
      if (saved === '1') return true;
      if (saved === '0') return false;
    } catch {
      /* ignore storage errors */
    }
    // Auto-enable wide layout when the note contains wide PRD tables (>= 6 headers) or > 8,000 chars
    const firstRow = /<tr\b[^>]*>([\s\S]*?)<\/tr>/i.exec(node.content);
    const colCount = firstRow ? (firstRow[1].match(/<(?:th|td)\b/gi) || []).length : 0;
    return colCount >= 6 || node.content.length > 8000;
  });
  const toggleWideLayout = () => {
    setIsWideLayout((prev) => {
      const next = !prev;
      try {
        localStorage?.setItem('pf_notes_wide_layout', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };
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
  const mentionCandidates = useProjectMentionCandidates(node.id);

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
          .insertContent({ type: 'image', attrs: { src, alt: file.name || tr('需求参考图片', 'Reference image') } })
          .run();
      } catch (err) {
        showNotice(tr(`图片未插入：${err instanceof Error ? td(err.message) : '读取失败'}`, `Image not inserted: ${err instanceof Error ? td(err.message) : 'Failed to read'}`));
      }
    }
  };

  const filteredSlashCommands = useMemo(() => {
    const q = slashQuery.trim().toLowerCase();
    if (!q) return slashCommands;
    return slashCommands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.desc.toLowerCase().includes(q) ||
        cmd.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }, [slashQuery, slashCommands]);

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
      const prefix =
        item.kind === 'page'
          ? '📄'
          : item.kind === 'table'
            ? '🗄️'
            : item.kind === 'note'
              ? '📝'
              : '🧠';
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
        showNotice(tr(`标题未保存：${err instanceof Error ? td(err.message) : '名称无效'}`, `Title not saved: ${err instanceof Error ? td(err.message) : 'Invalid name'}`));
      }
    }
  };

  const handleStakeholderBlur = () => {
    const trimmed = stakeholderDraft.trim();
    if (trimmed !== (node.stakeholder || '')) {
      try {
        updateNoteMeta(projectId, node.id, { stakeholder: trimmed });
      } catch (err) {
        showNotice(tr(`对接人未保存：${err instanceof Error ? td(err.message) : '内容无效'}`, `Stakeholder not saved: ${err instanceof Error ? td(err.message) : 'Invalid value'}`));
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
        ? tr(
            `\n\n随附 ${imagePick.attachments.length} 张图片，依次对应正文中的 ${imagePick.attachments
              .map((a) => `[图片 ${a.index}]`)
              .join('、')}${imagePick.total > imagePick.attachments.length ? `（笔记共 ${imagePick.total} 张，其余未附带）` : ''}。`,
            `\n\nAttached ${imagePick.attachments.length} image(s) corresponding to ${imagePick.attachments
              .map((a) => `[Image ${a.index}]`)
              .join(', ')}${imagePick.total > imagePick.attachments.length ? ` (${imagePick.total} total in note; remaining omitted)` : ''}.`
          )
        : '';
      const contentBody = customExcerpt?.trim()
        ? tr(
            `【摘自笔记《${ctx.title}》的重点需求片段】：\n${customExcerpt.trim()}`,
            `[Requirement Excerpt from Note "${ctx.title}"]:\n${customExcerpt.trim()}`
          )
        : noteHtmlToMarkdown(node);
      const prompt = tr(
        `请根据以下项目笔记需求，协助我规划或更新对应的原型页面与数据表：\n\n${
          ctx.relatedPageIds.length
            ? `关联页面 ID：${ctx.relatedPageIds.join(', ')}\n\n`
            : ''
        }${contentBody}${imageHint}`,
        `Please help me plan or update the corresponding prototype pages and database tables based on the following requirement note:\n\n${
          ctx.relatedPageIds.length
            ? `Linked Page IDs: ${ctx.relatedPageIds.join(', ')}\n\n`
            : ''
        }${contentBody}${imageHint}`
      );

      if (hermesStatus !== 'running') {
        try {
          await navigator.clipboard?.writeText(prompt);
        } catch {
          /* ignore */
        }
        showNotice(tr('已复制需求指令，请先连接 Hermes 引擎后在项目 AI 中粘贴执行', 'Prompt copied — connect Hermes first, then paste in Project AI'));
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
          name: asset.name?.trim() || `${tr('笔记图片', 'note-image')}-${index}.${noteAssetExtension(asset)}`,
          mimeType: asset.mime as 'image/png' | 'image/jpeg' | 'image/webp',
          data: asset.data,
          preview: noteAssetDataUrl(asset),
          size: noteAssetBytes(asset.data),
        }))
      );
    } catch (err) {
      showNotice(tr(`发送给项目 AI 失败：${err instanceof Error ? td(err.message) : '未知错误'}`, `Failed to send to Project AI: ${err instanceof Error ? td(err.message) : 'Unknown error'}`), 6000);
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
    const elements = editorContainerRef.current.querySelectorAll('h1, h2, h3, h4');
    const target = elements[headingIndex];
    if (target && typeof target.scrollIntoView === 'function') {
      setActiveHeadingIdx(headingIndex);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Track active heading in TOC while scrolling long PRD documents
  useEffect(() => {
    const scroller = editorContainerRef.current;
    if (!scroller || !headings.length) return;
    const onScroll = () => {
      const elements = scroller.querySelectorAll('h1, h2, h3, h4');
      if (!elements.length) return;
      const scrollerTop = scroller.getBoundingClientRect().top;
      let current = 0;
      elements.forEach((el, idx) => {
        if (el.getBoundingClientRect().top - scrollerTop <= 96) {
          current = idx;
        }
      });
      setActiveHeadingIdx(current);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [headings.length]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(!isReadOnly);
    }
    if (isReadOnly) {
      setSlashOpen(false);
      setMentionOpen(false);
    }
  }, [editor, isReadOnly]);

  // Handle clicking @Mention links inside the editor (Pages, DB Tables, Notes, Mindmaps)
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
    } else if (href.startsWith('#pf-note:')) {
      e.preventDefault();
      const targetNoteId = href.replace('#pf-note:', '');
      try {
        openNoteNode(projectId, targetNoteId);
      } catch {
        showNotice(tr('引用的目标笔记不存在或已删除', 'Referenced note no longer exists'));
      }
    } else if (href.startsWith('#pf-mindmap:')) {
      e.preventDefault();
      const targetMindmapId = href.replace('#pf-mindmap:', '');
      if (useProtoStore.getState().mindmaps.nodes.some((m) => m.id === targetMindmapId)) {
        useProtoStore.setState({ selectedMindmapNodeId: targetMindmapId, viewMode: 'mindmap' });
      } else {
        showNotice(tr('引用的目标脑图不存在或已删除', 'Referenced diagram no longer exists'));
      }
    } else if (isReadOnly && /^https?:\/\//i.test(href)) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
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
            aria-label={sidebarCollapsed ? tr('展开笔记目录', 'Expand notes directory') : tr('收起笔记目录', 'Collapse notes directory')}
            title={sidebarCollapsed ? tr('展开笔记目录', 'Expand notes directory') : tr('收起笔记目录', 'Collapse notes directory')}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 shrink-0 cursor-pointer transition"
          >
            {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>

          <div className="flex items-center gap-1.5 text-xs text-slate-600 min-w-0 truncate">
            <span className="shrink-0">{node.icon}</span>
            <span className="font-medium text-slate-800 truncate">
              {notePath(data, node.id)}
            </span>
          </div>

          <button
            type="button"
            onClick={() => updateNoteMeta(projectId, node.id, { pinned: !node.pinned })}
            aria-label={node.pinned ? tr('取消置顶笔记', 'Unpin note') : tr('置顶当前笔记', 'Pin current note')}
            title={node.pinned ? tr('已置顶，点击取消', 'Pinned — click to unpin') : tr('置顶到左侧顶部', 'Pin to top of sidebar')}
            className={`p-1 rounded-md shrink-0 cursor-pointer transition ${
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
          <span className="hidden xl:inline-flex items-center gap-2 px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200/80 text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
            <span>{tr(`${charCount} 字`, `${charCount} chars`)}</span>
            {taskStats.total > 0 && (
              <>
                <span>·</span>
                <span className="text-emerald-700 font-medium">
                  {tr(`待办 ${taskStats.done}/${taskStats.total}`, `To-Dos ${taskStats.done}/${taskStats.total}`)}
                </span>
              </>
            )}
          </span>

          {/* Read-Only Lock / Edit Toggle */}
          <button
            type="button"
            onClick={() => setIsReadOnly((v) => !v)}
            aria-pressed={isReadOnly}
            title={
              isReadOnly
                ? tr('当前为只读阅读锁定态（防误触修改），点击切换回编辑模式', 'Currently in read-only mode to prevent accidental edits — click to edit')
                : tr('切换到只读阅读模式，审阅长篇 PRD 时防止误触改动', 'Switch to read-only mode to review long PRDs safely')
            }
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition ${
              isReadOnly
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
            }`}
          >
            {isReadOnly ? <Lock size={12} className="shrink-0" /> : <Pencil size={12} className="text-slate-500 shrink-0" />}
            <span>{isReadOnly ? tr('只读锁定', 'Read-only') : tr('阅读锁定', 'Lock Read')}</span>
          </button>

          {/* Wide PRD Page Layout Toggle */}
          <button
            type="button"
            onClick={toggleWideLayout}
            aria-pressed={isWideLayout}
            title={
              isWideLayout
                ? tr('当前为宽版 PRD 视图（适合多列字段表与流程图），点击切换标准窄版心', 'Wide PRD layout active — click for standard width')
                : tr('切换为宽版 PRD 全宽视图，完整展示多列字段表与状态图', 'Switch to wide PRD layout for wide tables and diagrams')
            }
            className={`hidden md:inline-flex px-2 py-1 rounded-lg border text-[11px] font-medium items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition ${
              isWideLayout
                ? 'border-blue-200 bg-blue-50/70 text-blue-700 hover:bg-blue-100/70'
                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
            }`}
          >
            {isWideLayout ? <Minimize2 size={12} className="shrink-0" /> : <Maximize2 size={12} className="shrink-0" />}
            <span>{isWideLayout ? tr('宽版 PRD', 'Wide PRD') : tr('标准页宽', 'Standard')}</span>
          </button>

          {/* Split-screen Dock to Canvas Button */}
          <button
            type="button"
            onClick={handleDockToSidecar}
            title={tr('将此笔记固定到原型画布右侧分屏，边看需求边改原型', 'Dock this note beside the prototype canvas for side-by-side editing')}
            className="px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50/80 hover:bg-blue-100/80 text-blue-700 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition"
          >
            <Columns size={12} className="shrink-0" />
            <span>{tr('分屏对照原型', 'Split w/ Canvas')}</span>
          </button>

          {/* Template Picker Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTemplateMenu((v) => !v)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition"
            >
              <LayoutTemplate size={12} className="text-slate-500 shrink-0" />
              <span>{tr('套用模板', 'Templates')}</span>
              <ChevronDown size={11} className="text-slate-400 shrink-0" />
            </button>
            {showTemplateMenu && (
              <div className="absolute right-0 top-full mt-1.5 w-72 rounded-xl border border-slate-200 bg-white shadow-xl p-2 z-50 space-y-1">
                <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase flex items-center justify-between">
                  <span>{tr('插入或套用结构化模板', 'Insert or Apply Template')}</span>
                  <button
                    type="button"
                    onClick={() => setShowTemplateMenu(false)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>
                {NOTE_TEMPLATES.filter((t) => t.id !== 'blank-note').map((tpl) => {
                  const tplTitle = isEn ? NOTE_TPL_EN[tpl.id]?.title ?? td(tpl.title) : tpl.title;
                  const tplDesc = isEn ? NOTE_TPL_EN[tpl.id]?.desc ?? td(tpl.desc) : tpl.desc;
                  return (
                    <div
                      key={tpl.id}
                      className="p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200/80 space-y-1.5 transition"
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                        <span>{tpl.icon}</span>
                        <span>{tplTitle}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-4">{tplDesc}</p>
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleApplyTemplateContent(tpl.id, 'append')}
                          className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-medium cursor-pointer"
                        >
                          {tr('追加到文末', 'Append')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplyTemplateContent(tpl.id, 'replace')}
                          className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] cursor-pointer"
                        >
                          {tr('覆盖当前页', 'Replace')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowTemplateMenu(false);
                            onCreateFromTemplate(tpl.id);
                          }}
                          className="px-2 py-0.5 rounded bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-[10px] cursor-pointer"
                        >
                          {tr('新建此模板页', 'New Note')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleCopyMarkdown}
            title={tr('复制为 Markdown 文本', 'Copy as Markdown')}
            className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition"
          >
            {copiedMd ? (
              <>
                <Check size={12} className="text-emerald-600 shrink-0" />
                <span className="text-emerald-700">{tr('已复制', 'Copied')}</span>
              </>
            ) : (
              <>
                <Copy size={12} className="text-slate-500 shrink-0" />
                <span>{tr('复制 MD', 'Copy MD')}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleExportMarkdownFile}
            title={tr('导出为 .md 文件', 'Export as .md file')}
            className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition"
          >
            <Download size={12} className="text-slate-500 shrink-0" />
            <span>{tr('导出 .md', 'Export .md')}</span>
          </button>

          <button
            type="button"
            onClick={() => handleSendToProjectAi()}
            title={tr('将当前客户需求笔记发送给项目 AI，自动生成或修改原型与数据库', 'Send this requirement note to Project AI to generate or update prototypes and tables')}
            className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer shadow-2xs transition"
          >
            <Sparkles size={12} className="shrink-0" />
            <span>{tr('发给项目 AI', 'Send to AI')}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowOutline((v) => !v)}
            aria-label={showOutline ? tr('收起文档大纲', 'Collapse document outline') : tr('展开文档大纲', 'Expand document outline')}
            title={showOutline ? tr('收起右侧大纲', 'Collapse outline') : tr('展开右侧大纲', 'Expand outline')}
            className={`p-1.5 rounded-lg border shrink-0 cursor-pointer transition ${
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
          className="px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-2"
        >
          <span className="min-w-0 break-words">{td(aiStatusMsg)}</span>
          <button
            type="button"
            onClick={() => setAiStatusMsg('')}
            className="text-amber-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            {tr('知道了', 'Got it')}
          </button>
        </div>
      )}

      {/* Notion Block Formatting Bar (hidden in Read-Only mode to maximize reading space) */}
      {editor && !isReadOnly && (
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
              className="px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200/80 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              title={tr('打开 / 斜杠块级命令菜单', 'Open / slash block command menu')}
            >
              <Plus size={12} className="shrink-0" />
              <span>{tr('/ 插入块', '/ Insert')}</span>
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
              className="px-2 py-1 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              title={tr('输入 @ 引用工程中的原型页面或数据库物理表', 'Type @ to mention prototype pages or database tables')}
            >
              <AtSign size={12} className="text-blue-600 shrink-0" />
              <span>{tr('引用页面/表', 'Mention')}</span>
            </button>

            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="px-2 py-1 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer mr-1"
              title={tr('上传参考图片，或直接按 Ctrl/Cmd+V 粘贴截图', 'Upload image or press Ctrl/Cmd+V to paste screenshot')}
            >
              <ImageIcon size={12} className="text-emerald-600 shrink-0" />
              <span>{tr('贴图', 'Image')}</span>
            </button>

            <button
              type="button"
              onClick={() => openAssistant(selectedExcerpt.trim() ? 'polish' : 'write')}
              className="px-2 py-1 rounded-md bg-gradient-to-r from-blue-600 to-violet-600 hover:opacity-90 text-white text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              title={tr('AI 代写、润色改写、整理纪要、提取待办', 'AI Draft, Polish, Organize Minutes & Extract To-Dos')}
            >
              <Sparkles size={12} className="shrink-0" />
              <span>{tr('AI 助手', 'AI Assist')}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowStickySummary(true)}
              className="px-2 py-1 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer mr-1"
              title={tr('把关联页面上的画布组件批注汇总到本笔记', 'Summarize canvas component annotations from linked pages into this note')}
            >
              <Pin size={12} className="text-amber-500 shrink-0" />
              <span>{tr('汇总批注', 'Annotations')}</span>
            </button>

            <div className="h-4 w-px bg-slate-200 mx-0.5 shrink-0" />

            <ToolbarButton
              active={editor.isActive('heading', { level: 1 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              title={tr('一级标题 (H1)', 'Heading 1 (H1)')}
            >
              <Heading1 size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('heading', { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              title={tr('二级标题 (H2)', 'Heading 2 (H2)')}
            >
              <Heading2 size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('heading', { level: 3 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              title={tr('三级标题 (H3)', 'Heading 3 (H3)')}
            >
              <Heading3 size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('heading', { level: 4 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
              title={tr('四级标题 (H4)', 'Heading 4 (H4)')}
            >
              <Heading4 size={14} />
            </ToolbarButton>

            <div className="h-4 w-px bg-slate-200 mx-0.5 shrink-0" />

            <ToolbarButton
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              title={tr('加粗 (Cmd+B)', 'Bold (Cmd+B)')}
            >
              <Bold size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title={tr('斜体 (Cmd+I)', 'Italic (Cmd+I)')}
            >
              <Italic size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              title={tr('下划线 (Cmd+U)', 'Underline (Cmd+U)')}
            >
              <UnderlineIcon size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              title={tr('删除线', 'Strikethrough')}
            >
              <Strikethrough size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('highlight')}
              onClick={() => editor.chain().focus().toggleHighlight().run()}
              title={tr('荧光笔高亮重点', 'Highlight')}
            >
              <Highlighter size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
              title={tr('行内代码', 'Inline code')}
            >
              <Code size={14} />
            </ToolbarButton>

            <div className="h-4 w-px bg-slate-200 mx-0.5 shrink-0" />

            <ToolbarButton
              active={editor.isActive('taskList')}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              title={tr('待办任务清单 (Checkbox)', 'To-do task list')}
            >
              <ListTodo size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              title={tr('无序列表', 'Bulleted list')}
            >
              <List size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              title={tr('有序列表', 'Numbered list')}
            >
              <ListOrdered size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              title={tr('引用 / 高亮提示框 (Callout)', 'Blockquote / Callout')}
            >
              <Quote size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('codeBlock')}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              title={tr('代码块', 'Code block')}
            >
              <Code2 size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('codeBlock', { language: 'mermaid' })}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: 'codeBlock',
                    attrs: { language: 'mermaid' },
                    content: [
                      {
                        type: 'text',
                        text: 'flowchart LR\n  A[提交申请] --> B{审核结果}\n  B -->|通过| C[生效下推]\n  B -->|驳回| D[退回修改]',
                      },
                    ],
                  })
                  .run()
              }
              title={tr('插入 Mermaid 状态机 / 流程图块', 'Insert Mermaid Flowchart / State Diagram')}
            >
              <GitBranch size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={false}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 4, withHeaderRow: true })
                  .run()
              }
              title={tr('插入字段表格 (可拖拽列宽)', 'Insert resizable table')}
            >
              <TableIcon size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={false}
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              title={tr('插入分割线', 'Insert horizontal divider')}
            >
              <Minus size={14} />
            </ToolbarButton>

            {/* Contextual Callout Variant Switcher when inside a blockquote */}
            {editor.isActive('blockquote') && (
              <>
                <div className="h-4 w-px bg-slate-200 mx-0.5 shrink-0" />
                <div className="flex items-center gap-0.5 bg-violet-50/80 border border-violet-200/80 rounded-lg px-1.5 py-0.5 text-[11px]">
                  <span className="text-violet-700 font-medium px-1">{tr('警示类型:', 'Callout:')}</span>
                  {(
                    [
                      { id: null, label: tr('普通引用', 'Quote') },
                      { id: 'note', label: 'Note' },
                      { id: 'tip', label: 'Tip' },
                      { id: 'important', label: 'Important' },
                      { id: 'warning', label: 'Warning' },
                      { id: 'caution', label: 'Caution' },
                    ] as { id: NoteCalloutKind | null; label: string }[]
                  ).map((item) => {
                    const active = (editor.getAttributes('blockquote').callout ?? null) === item.id;
                    return (
                      <button
                        key={item.id ?? 'plain'}
                        type="button"
                        onClick={() =>
                          editor.chain().focus().updateAttributes('blockquote', { callout: item.id }).run()
                        }
                        className={`px-1.5 py-0.5 rounded whitespace-nowrap cursor-pointer transition ${
                          active
                            ? 'bg-violet-600 text-white font-medium'
                            : 'text-slate-600 hover:bg-violet-100'
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Contextual Table Controls when inside a table */}
            {editor.isActive('table') && (
              <>
                <div className="h-4 w-px bg-slate-200 mx-0.5 shrink-0" />
                <div className="flex items-center gap-1 bg-blue-50/80 border border-blue-200/80 rounded-lg px-1.5 py-0.5 text-[11px]">
                  <span className="text-blue-700 font-medium px-1">{tr('表格:', 'Table:')}</span>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().addRowBefore().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-blue-700 whitespace-nowrap cursor-pointer"
                    title={tr('在上方插入一行', 'Insert row above')}
                  >
                    {tr('+上行', '+Row ↑')}
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().addRowAfter().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-blue-700 whitespace-nowrap cursor-pointer flex items-center gap-0.5"
                    title={tr('在下方插入一行', 'Insert row below')}
                  >
                    <Rows size={11} />
                    <span>{tr('+下行', '+Row ↓')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().deleteRow().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-slate-600 whitespace-nowrap cursor-pointer"
                  >
                    {tr('-删行', '-Row')}
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().addColumnBefore().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-blue-700 whitespace-nowrap cursor-pointer"
                    title={tr('在左侧插入一列', 'Insert column left')}
                  >
                    {tr('+左列', '+Col ←')}
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().addColumnAfter().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-blue-700 whitespace-nowrap cursor-pointer flex items-center gap-0.5"
                    title={tr('在右侧插入一列', 'Insert column right')}
                  >
                    <Columns size={11} />
                    <span>{tr('+右列', '+Col →')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().deleteColumn().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-slate-600 whitespace-nowrap cursor-pointer"
                  >
                    {tr('-删列', '-Col')}
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().mergeOrSplit().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-slate-700 whitespace-nowrap cursor-pointer"
                    title={tr('合并选中单元格或拆分已合并单元格', 'Merge selected cells or split merged cell')}
                  >
                    {tr('合并/拆分', 'Merge/Split')}
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().deleteTable().run()}
                    className="px-1.5 py-0.5 rounded hover:bg-rose-100 text-rose-600 whitespace-nowrap cursor-pointer"
                  >
                    {tr('删表', 'Del Table')}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Selection Precision Action Pill (Convert selected text to Sticky Note or send excerpt to AI) */}
          {selectedExcerpt.trim().length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 bg-amber-50 border border-amber-200/90 rounded-lg px-2.5 py-1 text-[11px] shadow-2xs">
              <span className="text-amber-900 font-medium tabular-nums">
                {tr(`已选中 ${selectedExcerpt.trim().length} 字:`, `Selected ${selectedExcerpt.trim().length} chars:`)}
              </span>
              <button
                type="button"
                onClick={() => setShowStickyConvertModal(true)}
                className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition"
              >
                <Pin size={11} />
                <span>{tr('转为页面需求便签', 'To Sticky Pin')}</span>
              </button>
              <button
                type="button"
                onClick={() => handleSendToProjectAi(selectedExcerpt)}
                className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition"
              >
                <Sparkles size={11} />
                <span>{tr('仅将选中段发给 AI', 'Send Selection to AI')}</span>
              </button>
              <button
                type="button"
                onClick={() => openAssistant('polish')}
                className="px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-700 text-white font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition"
              >
                <Wand2 size={11} />
                <span>{tr('AI 润色选中段', 'AI Polish')}</span>
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
                  {tr('更换封面', 'Change Cover')}
                </button>
                <button
                  type="button"
                  onClick={() => updateNoteMeta(projectId, node.id, { cover: 'none' })}
                  className="px-2 py-1 rounded-lg bg-slate-900/60 hover:bg-slate-900/80 text-white text-[11px] cursor-pointer"
                >
                  {tr('移除', 'Remove')}
                </button>
              </div>
            </div>
          )}

          {/* Centered or Wide PRD Page Container */}
          <div
            className={`${
              isWideLayout ? 'max-w-[1240px] px-6 sm:px-10' : 'max-w-3xl px-8 sm:px-12'
            } w-full mx-auto pt-6 space-y-5 relative transition-[max-width] duration-200`}
          >
            {/* Cover Picker Popover */}
            {showCoverPicker && (
              <div className="rounded-xl border border-slate-200 bg-white shadow-xl p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>{tr('选择笔记顶部封面', 'Select Note Cover')}</span>
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
                      {isEn ? NOTE_COVER_EN[c.id] ?? td(c.label) : c.label.replace('渐变', '')}
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
                  <span>{tr('添加封面', 'Add Cover')}</span>
                </button>
              </div>
            )}

            {/* Emoji Icon + Large Title Row */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="relative">
                  <button
                    type="button"
                    aria-label={tr('更换笔记图标', 'Change note icon')}
                    title={tr('点击更换笔记 Emoji 图标', 'Click to change note emoji icon')}
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
                        <span>{tr('选择笔记图标', 'Select Note Icon')}</span>
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
                            {td(cat.category)}
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
                  aria-label={tr('笔记标题', 'Note title')}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                      editor?.commands.focus('start');
                    }
                  }}
                  placeholder={tr('无标题笔记...', 'Untitled note...')}
                  className="flex-1 min-w-0 w-full text-2xl sm:text-3xl font-bold text-slate-900 bg-transparent border-none focus:outline-none placeholder:text-slate-300 tracking-tight"
                />
              </div>

              {/* Notion Page Properties Ledger Section */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 px-3.5 py-2.5 space-y-2 text-xs">
                {/* PM Requirement Status + Priority + Stakeholder + Date Row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1.5 border-b border-slate-200/60">
                  {/* Status */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-slate-400 font-medium">{tr('需求状态', 'Status')}</span>
                    <div className="flex flex-wrap items-center gap-1">
                      {NOTE_STATUS_OPTIONS.map((opt) => {
                        const isCurrent = (node.status || 'draft') === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => updateNoteMeta(projectId, node.id, { status: opt.id })}
                            className={`px-2 py-0.5 rounded-md border text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition ${
                              isCurrent
                                ? `${opt.badgeClass} ring-1 ring-current/20`
                                : 'bg-white text-slate-500 border-slate-200/80 hover:bg-slate-100'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${opt.dotClass}`} />
                            <span>{isEn ? NOTE_STATUS_EN[opt.id] ?? td(opt.label) : opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Priority */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 font-medium">{tr('优先级', 'Priority')}</span>
                    <select
                      aria-label={tr('需求优先级', 'Requirement priority')}
                      value={node.priority || ''}
                      onChange={(e) =>
                        updateNoteMeta(projectId, node.id, {
                          priority: (e.target.value || undefined) as NotePriority | undefined,
                        })
                      }
                      className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700"
                    >
                      <option value="">{tr('未设优先级', 'No priority')}</option>
                      {NOTE_PRIORITY_OPTIONS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {isEn ? NOTE_PRIORITY_EN[p.id] ?? td(p.label) : p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Stakeholder */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 font-medium flex items-center gap-1">
                      <User size={11} />
                      <span>{tr('客户对接人', 'Stakeholder')}</span>
                    </span>
                    <input
                      type="text"
                      aria-label={tr('客户对接人', 'Stakeholder')}
                      value={stakeholderDraft}
                      onChange={(e) => setStakeholderDraft(e.target.value)}
                      onBlur={handleStakeholderBlur}
                      placeholder={tr('如：采购部王总', 'e.g. Procurement Lead')}
                      className="w-28 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                    />
                  </div>

                  {/* Meeting Date */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 font-medium flex items-center gap-1">
                      <Calendar size={11} />
                      <span>{tr('沟通日期', 'Meeting Date')}</span>
                    </span>
                    <input
                      type="date"
                      aria-label={tr('沟通日期', 'Meeting date')}
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
                    title={tr(
                      '开启后，发布在线演示时本笔记会以只读形式出现在演示端（关联页面的「需求说明」中）。默认不外发。',
                      'When enabled, this note is included read-only in published viewer links under linked pages. Private by default.'
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label={tr('允许外发到演示端', 'Share in published viewer')}
                      checked={node.shareable === true}
                      onChange={(e) => updateNoteMeta(projectId, node.id, { shareable: e.target.checked })}
                    />
                    <span className="text-slate-400 font-medium">{tr('外发到演示端', 'Share in Viewer')}</span>
                    {node.shareable ? (
                      <span className="px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-medium whitespace-nowrap">
                        {tr('客户可见', 'Client visible')}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">{tr('仅内部', 'Internal only')}</span>
                    )}
                  </label>
                </div>

                {/* Tags Row */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-400 font-medium min-w-[64px] flex items-center gap-1">
                    <Tag size={11} />
                    <span>{tr('分类标签', 'Tags')}</span>
                  </span>
                  {node.tags.map((tag) => (
                    <span
                      key={tag}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium ${getTagColorClass(
                        tag
                      )}`}
                    >
                      <span>{td(tag)}</span>
                      <button
                        type="button"
                        aria-label={tr(`移除标签${tag}`, `Remove tag ${tag}`)}
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
                      <span>{tr('添加标签', 'Add Tag')}</span>
                    </button>

                    {showTagPopover && (
                      <div className="absolute left-0 top-full mt-1.5 w-64 rounded-xl border border-slate-200 bg-white shadow-xl p-2.5 z-50 space-y-2">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                          <span>{tr('选择或新建标签', 'Select or Create Tag')}</span>
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
                            const displayTag = td(preset.label);
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
                                {active ? `✓ ${displayTag}` : displayTag}
                              </button>
                            );
                          })}
                        </div>
                        <form onSubmit={handleAddCustomTag} className="flex gap-1 pt-1">
                          <input
                            type="text"
                            value={customTagInput}
                            onChange={(e) => setCustomTagInput(e.target.value)}
                            placeholder={tr('输入自定义标签回车...', 'Custom tag + Enter...')}
                            maxLength={24}
                            className="flex-1 min-w-0 rounded-lg border border-slate-200 px-2 py-1 text-[11px] focus:outline-none focus:border-blue-600"
                          />
                          <button
                            type="submit"
                            className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[11px] font-medium whitespace-nowrap cursor-pointer"
                          >
                            {tr('添加', 'Add')}
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
                aria-label={tr('斜杠块级命令菜单', 'Slash block command menu')}
                style={floatingMenuStyle()}
                onMouseDown={(e) => e.preventDefault()}
                className="rounded-2xl border border-slate-200 bg-white shadow-2xl p-2 w-80 max-w-full z-40 space-y-1"
              >
                <div className="px-2.5 py-1 flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase">
                  <span className="truncate">
                    {tr('选择要插入的内容块', 'Insert Block')} {slashQuery && `· "${slashQuery}"`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSlashOpen(false)}
                    className="text-slate-400 hover:text-slate-600 shrink-0 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto space-y-0.5">
                  {filteredSlashCommands.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-slate-400">
                      {tr('无匹配的块级命令', 'No matching block commands')}
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
                aria-label={tr('引用工程页面与数据表菜单', 'Mention project pages and database tables')}
                style={floatingMenuStyle()}
                onMouseDown={(e) => e.preventDefault()}
                className="rounded-2xl border border-slate-200 bg-white shadow-2xl p-2 w-80 max-w-full z-40 space-y-1"
              >
                <div className="px-2.5 py-1 flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase">
                  <span className="truncate">
                    {tr('@ 引用页面 / 物理表 / 笔记 / 脑图', '@ Mention Page, Table, Note or Diagram')} {mentionQuery && `· "${mentionQuery}"`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMentionOpen(false)}
                    className="text-slate-400 hover:text-slate-600 shrink-0 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-0.5">
                  {filteredMentions.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-slate-400">
                      {tr('未找到匹配的页面、数据表、笔记或脑图', 'No matching pages, tables, notes, or diagrams found')}
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
                            ) : item.kind === 'table' ? (
                              <Database size={13} />
                            ) : item.kind === 'note' ? (
                              <BookOpenText size={13} />
                            ) : (
                              <Network size={13} />
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
                  aria-label={tr('笔记正文编辑器', 'Note body editor')}
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
            aria-label={tr('笔记大纲目录', 'Note table of contents')}
            className="w-60 shrink-0 border-l border-slate-200 bg-slate-50/40 p-3 overflow-y-auto hidden lg:flex flex-col justify-between gap-3 select-none"
          >
            <div className="space-y-2.5 min-w-0">
              <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-1 min-w-0">
                <span className="truncate">{tr('文档大纲 (TOC)', 'Outline (TOC)')}</span>
                <span className="font-mono text-[10px] text-slate-400 tabular-nums shrink-0">
                  {headings.length}
                </span>
              </div>

              {headings.length >= 6 && (
                <div className="relative">
                  <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="search"
                    value={tocQuery}
                    onChange={(e) => setTocQuery(e.target.value)}
                    placeholder={tr('筛选章节标题...', 'Filter sections...')}
                    aria-label={tr('筛选文档大纲章节', 'Filter outline headings')}
                    className="w-full rounded-lg border border-slate-200/90 bg-white pl-7 pr-2 py-1 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {headings.length === 0 ? (
                <p className="px-1 py-4 text-[11px] leading-5 text-slate-400 break-words">
                  {tr(
                    '在文档中使用 H1–H4 标题，此处将自动生成结构化章节导航。',
                    'Use H1–H4 headings in the note to auto-generate a section outline here.'
                  )}
                </p>
              ) : (
                <nav className="space-y-0.5 min-w-0">
                  {headings
                    .filter((h) => !tocQuery.trim() || h.text.toLowerCase().includes(tocQuery.trim().toLowerCase()))
                    .map((h) => {
                      const isActive = h.index === activeHeadingIdx;
                      return (
                        <button
                          key={`${h.index}-${h.text}`}
                          type="button"
                          onClick={() => scrollToHeading(h.index)}
                          style={{ paddingLeft: `${(h.level - 1) * 10 + 8}px` }}
                          className={`w-full min-w-0 text-left py-1 pr-2 rounded-md text-xs truncate cursor-pointer transition block ${
                            isActive
                              ? 'bg-blue-50/90 text-blue-700 font-semibold border-l-2 border-blue-600'
                              : h.level === 4
                                ? 'text-[11px] text-slate-500 hover:bg-slate-200/60 hover:text-blue-600'
                                : 'text-slate-600 hover:bg-slate-200/60 hover:text-blue-600'
                          }`}
                          title={h.text}
                        >
                          {h.text}
                        </button>
                      );
                    })}
                </nav>
              )}
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-white p-2.5 space-y-1 text-[11px] text-slate-500 min-w-0 break-words">
              <div className="font-semibold text-slate-700 flex items-center gap-1 min-w-0">
                <BookOpen size={12} className="text-blue-600 shrink-0" />
                <span className="truncate">{tr('实战效率技巧', 'Quick Shortcuts')}</span>
              </div>
              {isEn ? (
                <>
                  <p>· Type <code className="px-1 rounded bg-slate-100">/</code> for block commands</p>
                  <p>· Type <code className="px-1 rounded bg-slate-100">@</code> to mention pages/tables</p>
                  <p>· Press <code className="px-1 rounded bg-slate-100">Cmd/Ctrl+V</code> to paste screenshots</p>
                  <p>· Select text to convert into a page sticky pin</p>
                </>
              ) : (
                <>
                  <p>· 输入 <code className="px-1 rounded bg-slate-100">/</code> 唤起块级命令</p>
                  <p>· 输入 <code className="px-1 rounded bg-slate-100">@</code> 引用页面或数据表</p>
                  <p>· 按 <code className="px-1 rounded bg-slate-100">Cmd/Ctrl+V</code> 直接粘贴截图</p>
                  <p>· 划词选中段落可一键转为页面需求便签</p>
                </>
              )}
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
            showNotice(tr(`已插入 ${count} 条画布批注，启用中的批注已生成待办。`, `Inserted ${count} canvas annotation(s); active items added as to-dos.`), 3000);
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
            showNotice(tr('已将该段需求添加为原型页面便签！', 'Added excerpt as a prototype page sticky note!'), 3000);
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
  const { tr } = useI18n();
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
  const [targetRegionName, setTargetRegionName] = useState(() => tr('客户沟通需求便签', 'Requirement Note Pin'));
  const [textDraft, setTextDraft] = useState(excerpt.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPageId || !textDraft.trim()) return;
    addStickyRuleToWidget(
      targetPageId,
      'root',
      tr(`【来自笔记《${note.title}》】${textDraft.trim()}`, `[From Note "${note.title}"] ${textDraft.trim()}`),
      targetRegionName.trim() || tr('页面全局区域', 'Page Global Area')
    );
    onConverted(targetPageId);
  };

  return (
    <div className="pf-notes-surface fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('将选中段落转为页面需求便签', 'Convert selected excerpt into page sticky note')}
        className="bg-white border border-slate-200 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden text-xs"
      >
        <header className="px-4 py-3 bg-amber-50/90 border-b border-amber-200/80 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-amber-950 min-w-0">
            <Pin size={15} className="text-amber-600 shrink-0" />
            <span className="truncate">{tr('将笔记段落转为原型页面便签', 'Convert Excerpt to Page Sticky Pin')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer"
          >
            <X size={15} />
          </button>
        </header>
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5">
          <label className="block font-medium text-slate-700">
            {tr('目标原型页面', 'Target Prototype Page')}
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
            {tr('便签挂载位置 / 模块说明', 'Target Region / Section Label')}
            <input
              type="text"
              value={targetRegionName}
              onChange={(e) => setTargetRegionName(e.target.value)}
              placeholder={tr('例如：主表工具栏 / 审批弹框', 'e.g. Main Table Toolbar / Approval Modal')}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-800"
            />
          </label>
          <label className="block font-medium text-slate-700">
            {tr('便签需求内容', 'Sticky Rule Content')}
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
              {tr('取消', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={!targetPageId}
              className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold cursor-pointer disabled:opacity-40"
            >
              {tr('生成页面需求便签', 'Create Page Sticky Pin')}
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
  const { isEn, tr, td } = useI18n();
  const data = useProtoStore((s) => s.projectNotes);
  const { activePageId, setActivePage, setSelectedTableId, setViewMode, setDockedNoteId } = useProtoStore();
  const layout = usePageStore();
  const [sidecarReadOnly, setSidecarReadOnly] = useState(false);
  const [sidecarEditor, setSidecarEditor] = useState<Editor | null>(null);
  useEffect(() => {
    if (sidecarEditor && !sidecarEditor.isDestroyed) {
      sidecarEditor.setEditable(!sidecarReadOnly);
    }
  }, [sidecarEditor, sidecarReadOnly]);

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
        tr(`${pageTitle ? `${pageTitle} · ` : ''}客户沟通速记`, `${pageTitle ? `${pageTitle} · ` : ''}Quick Discovery Notes`)
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
      setSidecarError(err instanceof Error ? err.message : tr('新建速记失败', 'Failed to create quick note'));
    }
  };

  return (
    <aside
      aria-label={tr('画布分屏伴随笔记', 'Docked companion note')}
      className="pf-notes-surface w-[360px] shrink-0 border-l border-slate-200 bg-white flex flex-col h-full z-30 shadow-lg select-none"
    >
      {/* Sidecar Header */}
      <header className="px-3 py-2 border-b border-slate-200 bg-blue-50/50 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <BookOpenText size={14} className="text-blue-600 shrink-0" />
            <span className="text-xs font-semibold text-slate-900 truncate">
              {tr('伴随需求笔记 (分屏对照)', 'Companion Note (Split View)')}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {currentNote && (
              <>
                <button
                  type="button"
                  aria-pressed={sidecarReadOnly}
                  title={
                    sidecarReadOnly
                      ? tr('当前为只读对照态，点击切换为可编辑', 'Read-only companion mode — click to edit')
                      : tr('锁定为只读对照态，防止改画布时误触笔记', 'Lock companion note as read-only')
                  }
                  onClick={() => setSidecarReadOnly((v) => !v)}
                  className={`p-1 rounded-md cursor-pointer transition ${
                    sidecarReadOnly
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'text-slate-500 hover:bg-white hover:text-blue-600'
                  }`}
                >
                  {sidecarReadOnly ? <Lock size={13} /> : <Eye size={13} />}
                </button>
                <button
                  type="button"
                  title={tr('切换到全屏笔记工作台', 'Switch to full-screen Notes workspace')}
                  onClick={() => {
                    openNoteNode(projectId, currentNote.id);
                  }}
                  className="p-1 rounded-md text-slate-500 hover:bg-white hover:text-blue-600 cursor-pointer transition"
                >
                  <Maximize2 size={13} />
                </button>
              </>
            )}
            <button
              type="button"
              aria-label={tr('关闭分屏伴随笔记', 'Close docked companion note')}
              title={tr('关闭分屏笔记', 'Close split note')}
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
            aria-label={tr('选择伴随笔记', 'Select companion note')}
            value={currentNote?.id || ''}
            onChange={(e) => setDockedNoteId(e.target.value)}
            className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
          >
            {!allNotes.length && <option value="">{tr('暂无笔记', 'No notes yet')}</option>}
            {pageLinkedNotes.length > 0 && (
              <optgroup label={tr('📌 当前页面关联笔记', '📌 Linked to Current Page')}>
                {pageLinkedNotes.map((n) => (
                  <option key={`linked-${n.id}`} value={n.id}>
                    {n.icon} {n.title}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={tr('📓 全部项目笔记', '📓 All Project Notes')}>
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
            title={tr('为当前页面新建速记笔记', 'Create a quick note linked to the current page')}
            className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus size={12} />
            <span>{tr('速记', 'Quick Note')}</span>
          </button>
        </div>
        {sidecarError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700"
          >
            <span className="min-w-0 truncate" title={td(sidecarError)}>{td(sidecarError)}</span>
            <button
              type="button"
              aria-label={tr('关闭提示', 'Dismiss alert')}
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
            {tr(
              '当前工程还没有笔记，点击下方按钮立即边看原型边记客户需求。',
              'No notes in this project yet — click below to start capturing requirements beside the canvas.'
            )}
          </p>
          <button
            type="button"
            onClick={handleQuickCreateForActivePage}
            className="px-3.5 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-medium cursor-pointer"
          >
            {tr('+ 新建当前页伴随笔记', '+ New Note for Current Page')}
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-3 select-text">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-base shrink-0">{currentNote.icon}</span>
              <SidecarTitleInput
                key={currentNote.id}
                projectId={projectId}
                noteId={currentNote.id}
                title={currentNote.title}
                onError={setSidecarError}
              />
            </div>
            <select
              aria-label={tr('需求状态', 'Requirement status')}
              value={currentNote.status || 'draft'}
              onChange={(e) => {
                try {
                  updateNoteMeta(projectId, currentNote.id, {
                    status: e.target.value as NoteRequirementStatus,
                  });
                } catch (err) {
                  setSidecarError(err instanceof Error ? err.message : tr('状态未保存', 'Failed to save status'));
                }
              }}
              className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 shrink-0"
            >
              {NOTE_STATUS_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {isEn ? NOTE_STATUS_EN[s.id] ?? td(s.label) : s.label}
                </option>
              ))}
            </select>
          </div>

          <div
            className="pf-notion-editor text-xs"
            onClick={(e) => {
              const anchor = (e.target as HTMLElement).closest('a');
              if (!anchor) return;
              const href = anchor.getAttribute('href') || '';
              if (href.startsWith('#pf-page:')) {
                e.preventDefault();
                setActivePage(href.slice('#pf-page:'.length));
                setViewMode('single_page');
              } else if (href.startsWith('#pf-table:')) {
                e.preventDefault();
                setSelectedTableId(href.slice('#pf-table:'.length));
                setViewMode('db_designer');
              } else if (href.startsWith('#pf-note:')) {
                e.preventDefault();
                setDockedNoteId(href.slice('#pf-note:'.length));
              } else if (href.startsWith('#pf-mindmap:')) {
                e.preventDefault();
                const targetMm = href.slice('#pf-mindmap:'.length);
                if (useProtoStore.getState().mindmaps.nodes.some((m) => m.id === targetMm)) {
                  useProtoStore.setState({ selectedMindmapNodeId: targetMm, viewMode: 'mindmap' });
                }
              }
            }}
          >
            {canMountRichEditor ? (
              <RichTiptapMount
                key={currentNote.id}
                projectId={projectId}
                noteId={currentNote.id}
                initialContent={currentNote.content || '<p></p>'}
                onEditorReady={setSidecarEditor}
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
  const { tr, td } = useI18n();
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
      onError(tr(`标题未保存：${err instanceof Error ? td(err.message) : '名称无效'}`, `Title not saved: ${err instanceof Error ? td(err.message) : 'Invalid name'}`));
    }
  };

  return (
    <input
      type="text"
      aria-label={tr('伴随笔记标题', 'Companion note title')}
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
      className="min-w-0 text-sm font-bold text-slate-900 bg-transparent border-none focus:outline-none truncate"
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
  const { locale, td } = useI18n();
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
        const node = view.state.schema.nodes.image?.create({ src, alt: alt ?? (file.name || tr('需求参考图片', 'Reference image')) });
        if (!node || view.isDestroyed) continue;
        const pmTr =
          pos !== undefined && pos <= view.state.doc.content.size
            ? view.state.tr.insert(pos, node)
            : view.state.tr.replaceSelectionWith(node);
        view.dispatch(pmTr);
      } catch (err) {
        onSaveErrorRef.current?.(tr(`图片未插入：${err instanceof Error ? td(err.message) : '读取失败'}`, `Image not inserted: ${err instanceof Error ? td(err.message) : 'Failed to read'}`));
      }
    }
  };
  const storeContent = useProtoStore((s) => {
    const node = s.projectNotes.nodes.find((n) => n.id === noteId);
    return node && node.kind === 'note' ? node.content : undefined;
  });

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingEditorRef = useRef<Editor | null>(null);

  const flushPendingSave = useCallback(
    (ed: Editor | null) => {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
      if (!ed || ed.isDestroyed) return;
      const html = ed.getHTML();
      if (html === lastSyncedRef.current) return;
      lastSyncedRef.current = html;
      try {
        updateNoteContent(projectId, noteId, html);
      } catch (err) {
        onSaveErrorRef.current?.(err instanceof Error ? err.message : tr('笔记保存失败', 'Failed to save note'));
      }
    },
    [projectId, noteId]
  );

  useEffect(
    () => () => {
      if (debounceTimerRef.current !== undefined) {
        flushPendingSave(pendingEditorRef.current);
      }
    },
    [flushPendingSave]
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5] },
          blockquote: false,
          codeBlock: false,
        }),
        NoteBlockquoteExtension,
        NoteCodeBlockExtension,
        Placeholder.configure({
          placeholder: () =>
            tr(
              '输入内容，输入 "/" 唤起块级命令，输入 "@" 引用页面/表/笔记/脑图，支持直接粘贴 Markdown 或截图...',
              'Type "/" for blocks, "@" to mention pages/tables/notes/diagrams, or paste Markdown & screenshots...'
            ),
        }),
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        Table.configure({
          resizable: true,
          cellMinWidth: 80,
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
          if (files.length) {
            event.preventDefault();
            void insertImageFiles(view, files, tr('粘贴的需求截图', 'Pasted screenshot'));
            return true;
          }
          // When pasting raw Markdown outside a code block, convert it into rich Tiptap blocks.
          if (view.state.selection.$from.parent.type.name !== 'codeBlock') {
            const plain = event.clipboardData?.getData('text/plain') ?? '';
            const htmlClip = event.clipboardData?.getData('text/html') ?? '';
            if (shouldParsePastedMarkdown(plain, htmlClip) && pendingEditorRef.current) {
              const parsed = markdownToNoteHtml(plain, { extractTitle: false });
              if (parsed.html && parsed.html !== '<p></p>') {
                event.preventDefault();
                const currentAssets = useProtoStore.getState().projectNotes.assets;
                const extracted = extractInlineNoteImages(parsed.html, currentAssets);
                if (extracted.assets && extracted.assets !== currentAssets) {
                  useProtoStore.setState((s) => ({
                    projectNotes: { ...s.projectNotes, assets: extracted.assets },
                  }));
                }
                pendingEditorRef.current.chain().focus().insertContent(extracted.html).run();
                return true;
              }
            }
          }
          return false;
        },
        handleDrop: (view, event) => {
          const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (!files.length) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void insertImageFiles(view, files, undefined, pos);
          return true;
        },
        handleDOMEvents: {
          blur: () => {
            if (debounceTimerRef.current !== undefined) {
              flushPendingSave(pendingEditorRef.current);
            }
            return false;
          },
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
        pendingEditorRef.current = ed;
        // Debounce full HTML serialization on large PRD documents (>= 16k doc chars) to keep typing lag-free,
        // while committing synchronously on smaller notes so reactive UI & tests see instant state.
        if (ed.state.doc.content.size >= 16_000) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => flushPendingSave(ed), 180);
        } else {
          flushPendingSave(ed);
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
    pendingEditorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr);
    }
  }, [editor, locale]);

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
