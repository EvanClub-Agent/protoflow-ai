import React, { useEffect, useId, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { closeHistory } from '@tiptap/pm/history';
import {
  Check,
  ChevronDown,
  Columns2,
  Copy,
  FilePlus2,
  FileText,
  History,
  Link2,
  ListTodo,
  Loader2,
  Maximize2,
  Minimize2,
  PenLine,
  RefreshCw,
  Replace,
  Send,
  Sparkles,
  Square,
  Wand2,
  X,
} from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { useHermesStore } from '../store/useHermesStore';
import { sitemapPageOrder } from '../proto/notesStickies';
import { noteHtmlToPlainText, uniqueNoteTitle, type NoteNode } from '../proto/notes';
import {
  detectNoteMentions,
  NOTE_POLISH_STYLES,
  noteAssistantRunKey,
  noteAssistantScope,
  previewStreamingMarkdown,
  runNoteAssistant,
  useNoteAssistantStore,
  type NoteAssistantAction,
  type NoteAssistantSelection,
  type NoteAssistantTab,
  type NotePolishStyle,
} from '../services/hermesNoteAssistant';
import { addPageNoteLink, createNoteNode, openNoteNode, updateNoteContent } from '../services/notesWorkspace';
import { conversationKey } from '../services/hermesConversation';
import { pendingProjectAiTasks } from '../services/hermesTaskLock';
import { presentHermesModel } from '../services/hermesModelCatalog';
import { HermesModelPicker } from './HermesModelPicker';
import { ModelProviderIcon } from './ModelProviderIcon';

const ACTION_DETAILS: Record<
  NoteAssistantAction,
  {
    description: string;
    startLabel: string;
    placeholder: string;
    quickPrompts: { label: string; prompt: string }[];
  }
> = {
  write: {
    description: '描述你想写的内容，AI 会结合当前笔记上下文起草正文、续写章节或生成需求提纲。',
    startLabel: '开始代写',
    placeholder:
      '描述写作要求（Enter 发送，Shift + Enter 换行）…\n例如：帮我起草一份订单退款需求说明，包含背景、核心流程和验收标准，尚未明确的规则标为待确认。',
    quickPrompts: [
      { label: '📋 起草背景、流程与验收标准', prompt: '结合当前笔记标题与已有内容，起草完整的业务背景、核心操作流程、字段规则与验收标准，尚未确认的细节标为待确认。' },
      { label: '🔍 补充异常分支与边界规则', prompt: '针对当前笔记中的业务流程，补充异常分支处理、权限控制与数据校验边界规则（不确定处标注建议或待确认）。' },
      { label: '❓ 梳理客户待确认问题清单', prompt: '根据当前笔记内容，梳理一份结构化的“待向客户确认问题清单”，按业务模块分类并说明影响范围。' },
      { label: '✍️ 顺着上文继续续写', prompt: '顺着当前笔记的最后一部分继续向下续写后续章节，保持文风与结构一致。' },
    ],
  },
  polish: {
    description: '保留原意、数字、日期与业务规则，优化用词、语句和文档结构。支持全文或选中段落润色。',
    startLabel: '开始润色',
    placeholder: '补充润色要求（选填，例如：面向客户汇报，保留所有数字和时间，控制在 300 字以内）…',
    quickPrompts: [
      { label: '👔 面向客户汇报', prompt: '调整为适合发给客户确认的书面表达，语气专业得体，严格保留所有数字、金额与时间。' },
      { label: '🎯 提炼为要点列表', prompt: '将冗长段落提炼为层次清晰的要点列表与小标题，突出核心业务规则。' },
      { label: '✂️ 精简至 300 字内', prompt: '去除口语赘词与重复铺垫，保留关键规则和结论，整体控制在 300 字以内。' },
    ],
  },
  organize: {
    description: '将杂乱速记或会议转写整理为：背景与参与人、确认结论、需求点表格、待确认问题与待办清单。',
    startLabel: '整理成纪要',
    placeholder: '可补充整理侧重点（选填，例如：重点标出涉及金额审批的规则、按模块归类需求表格）…',
    quickPrompts: [
      { label: '📌 严分已拍板与待确认', prompt: '严格区分客户已拍板结论与尚未定论的问题，未确认事项全部归入“待确认问题”小节。' },
      { label: '📊 细化模块需求点表格', prompt: '在需求点表格中尽量细化模块/页面名称、具体业务规则描述与状态。' },
      { label: '💰 突出金额与审批节点', prompt: '重点保留并突出原文中涉及金额阈值、审批流转、接口对接的业务规则。' },
    ],
  },
  actions: {
    description: '扫描正文中的口头承诺、分工与时间节点，提取为“负责人｜截止时间｜事项”格式的勾选待办。',
    startLabel: '提取待办',
    placeholder: '可补充提取要求（选填，例如：只提取需要客户侧配合提供的事项、按截止时间排序）…',
    quickPrompts: [
      { label: '🤝 重点提取客户配合项', prompt: '优先识别需要客户侧确认、提供资料或拍板的行动项，并在事项中注明。' },
      { label: '🔌 提取接口与数据准备事项', prompt: '重点提取涉及接口文档、数据字典、测试环境与字段确认的待办事项。' },
    ],
  },
};

const REFINE_QUICK_PROMPTS = [
  { label: '✨ 再精简一点', prompt: '在保留核心业务规则和数字的前提下，把内容再精简 30%，去掉冗余描述。' },
  { label: '📊 关键规则改为表格', prompt: '把其中的核心需求点或规则整理成结构化 Markdown 表格呈现。' },
  { label: '✅ 补充验收标准', prompt: '在末尾补充一节可测试的“验收标准”勾选清单，未明确处标为待确认。' },
  { label: '❓ 标出待确认项', prompt: '检查全文，把尚不明确或存在歧义的规则单独汇总到“待确认事项”小节。' },
];

type PreviewViewMode = 'rendered' | 'compare' | 'markdown';

/**
 * AI note assistant companion panel.
 * Docked beside the note editor so the product manager can view/edit the note while conversing
 * with AI, previewing streaming output, comparing with original text, and applying changes safely.
 */
export function NoteAssistantModal({
  projectId,
  node,
  editor,
  selection,
  initialTab = 'write',
  onClose,
  onNotice,
}: {
  projectId: string;
  node: Extract<NoteNode, { kind: 'note' }>;
  editor: Editor | null;
  /** Selection captured when the assistant was opened or updated (positions + text). */
  selection: NoteAssistantSelection | null;
  initialTab?: NoteAssistantTab;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const titleId = useId();
  const [tab, setTab] = useState<NoteAssistantTab>(initialTab);
  const [useSelection, setUseSelection] = useState(Boolean(selection?.text.trim()));
  const [instructions, setInstructions] = useState<Record<NoteAssistantAction, string>>({
    write: '',
    polish: '',
    organize: '',
    actions: '',
  });
  const [polishStyle, setPolishStyle] = useState<NotePolishStyle>('natural');
  const [refineInput, setRefineInput] = useState('');
  const [previewMode, setPreviewMode] = useState<PreviewViewMode>('rendered');
  const [selectedRevIndex, setSelectedRevIndex] = useState<number | null>(null);
  const [wideMode, setWideMode] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const [error, setError] = useState('');

  // Sync tab & selection when triggered again from editor toolbar / selection bar while open
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setUseSelection(Boolean(selection?.text.trim()));
  }, [selection?.from, selection?.to, selection?.text]);

  const runKey = noteAssistantRunKey(projectId, node.id);
  const run = useNoteAssistantStore((s) => s.runs[runKey]);
  const hermesStatus = useHermesStore((s) => s.status);
  const scope = useMemo(() => noteAssistantScope(projectId), [projectId]);
  const sessionKey = conversationKey(scope);
  const session = useHermesStore((s) => s.sessions[sessionKey]);
  const projectRunning = useHermesStore((s) => Boolean(s.runningProjects[projectId]));
  const streamingPartial = useHermesStore((s) => s.partial[sessionKey] || '');
  const streamingProgress = useHermesStore((s) => s.progress[sessionKey] || '');
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState('');
  const [pickerSessionId, setPickerSessionId] = useState<string | null>(null);
  const currentModel = session?.models.availableModels.find((model) => model.modelId === session.models.currentModelId);
  const modelChoice = currentModel ? presentHermesModel(currentModel) : null;
  const modelTitle = modelChoice
    ? modelChoice.title
    : session?.models.currentModelId
      ? session.models.currentModelId
      : '选择模型';
  const pickerOpen = pickerSessionId !== null && pickerSessionId === session?.sessionId && hermesStatus === 'running';
  const usesAi = tab !== 'mentions';
  const setHermesModalOpen = useHermesStore((s) => s.setModalOpen);
  const dbTables = useProtoStore((s) => s.dbTables);
  const layout = usePageStore();

  const result = run && run.action === tab ? run : undefined;
  const running = run?.status === 'running';
  const notePlainText = useMemo(() => noteHtmlToPlainText(node.content).trim(), [node.content]);
  const hasContent = Boolean(useSelection && selection ? selection.text.trim() : notePlainText);

  // Reset selected revision index to latest whenever a new revision finishes
  useEffect(() => {
    if (result?.status === 'done') {
      setSelectedRevIndex(null);
    }
  }, [result?.status, result?.markdown, result?.history?.length]);

  const activeRevision = useMemo(() => {
    if (result?.status !== 'done') return null;
    const history = result.history ?? [];
    if (selectedRevIndex !== null && history[selectedRevIndex]) {
      return history[selectedRevIndex];
    }
    return {
      id: 'latest',
      label: history.length > 1 ? `第 ${history.length} 版` : '初稿',
      markdown: result.markdown ?? '',
      html: result.html ?? '',
    };
  }, [result, selectedRevIndex]);

  const activeHtml = activeRevision?.html ?? result?.html ?? '';
  const activeMarkdown = activeRevision?.markdown ?? result?.markdown ?? '';

  const comparisonStats = useMemo(() => {
    if (result?.status !== 'done' || !activeHtml) return null;
    const sourcePlain = result.selection
      ? result.selection.text.trim()
      : noteHtmlToPlainText(result.sourceContent).trim();
    const targetPlain = noteHtmlToPlainText(activeHtml).trim();
    const srcLen = sourcePlain.replace(/\s+/g, '').length;
    const tgtLen = targetPlain.replace(/\s+/g, '').length;
    return { sourcePlain, srcLen, tgtLen };
  }, [result, activeHtml]);

  const streamingPreviewText = useMemo(
    () => (running ? previewStreamingMarkdown(streamingPartial) : ''),
    [running, streamingPartial]
  );

  useEffect(() => {
    let active = true;
    setPickerSessionId(null);
    setModelError('');
    if (hermesStatus !== 'running' || !usesAi) {
      setModelBusy(false);
      return;
    }
    setModelBusy(true);
    void useHermesStore
      .getState()
      .ensureSession(scope)
      .catch((err) => {
        if (active) setModelError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setModelBusy(false);
      });
    return () => {
      active = false;
    };
  }, [scope, hermesStatus, usesAi]);

  const assertModelSession = (expectedSessionId?: string) => {
    const project = useProtoStore.getState();
    const state = useHermesStore.getState();
    if (
      project.isProjectClosed ||
      project.currentProjectMeta.projectId !== projectId ||
      project.selectedNoteNodeId !== node.id ||
      !project.projectNotes.nodes.some((n) => n.id === node.id && n.kind === 'note')
    ) {
      throw new Error('当前笔记已变化，请重新打开模型选择');
    }
    if (expectedSessionId !== undefined && state.sessions[sessionKey]?.sessionId !== expectedSessionId) {
      throw new Error('笔记助手会话已变化，请重新打开模型选择');
    }
    if (state.status !== 'running') throw new Error('请先连接 Hermes 引擎');
    if (pendingProjectAiTasks.has(projectId) || state.runningProjects[projectId]) {
      throw new Error('请等待当前 AI 任务结束后再切换模型');
    }
  };

  const refreshModels = async (expectedSessionId?: string) => {
    assertModelSession(expectedSessionId);
    setModelBusy(true);
    setModelError('');
    try {
      await useHermesStore.getState().ensureSession(scope, false, true);
    } finally {
      setModelBusy(false);
    }
  };

  const selectModel = async (modelId: string) => {
    if (pickerSessionId === null) throw new Error('请重新打开模型选择');
    assertModelSession(pickerSessionId);
    if (
      !useHermesStore
        .getState()
        .sessions[sessionKey]?.models.availableModels.some((model) => model.modelId === modelId)
    ) {
      throw new Error('所选模型已不在列表中，请刷新后重试');
    }
    setModelBusy(true);
    setModelError('');
    try {
      await useHermesStore.getState().selectModel(scope, modelId);
    } finally {
      setModelBusy(false);
    }
  };

  const start = async (action: NoteAssistantAction, refinePrompt?: string) => {
    setError('');
    try {
      if (modelBusy || !session?.models.currentModelId) throw new Error('请等待模型加载完成后再生成');
      assertModelSession(session.sessionId);
      if (!editor || editor.isDestroyed) throw new Error('编辑器尚未就绪');
      const isRefining = Boolean(refinePrompt?.trim() && result?.status === 'done' && activeMarkdown);
      const effectiveSelection = isRefining
        ? result?.selection ?? undefined
        : useSelection && selection
          ? selection
          : undefined;
      if (
        !isRefining &&
        useSelection &&
        selection &&
        (selection.to > editor.state.doc.content.size ||
          editor.state.doc.textBetween(selection.from, selection.to, '\n') !== selection.text)
      ) {
        throw new Error('选中内容已变化，请关闭助手后重新选择');
      }
      if (!isRefining) {
        updateNoteContent(projectId, node.id, editor.getHTML());
      }
      await runNoteAssistant(projectId, node.id, action, {
        selection: effectiveSelection,
        instructions: instructions[action] || undefined,
        polishStyle,
        ...(isRefining
          ? {
              refineInstruction: refinePrompt!.trim(),
              previousMarkdown: activeMarkdown,
              preserveSourceContent: result!.sourceContent,
              previousHistory: result!.history,
            }
          : {}),
      });
      if (isRefining) {
        setRefineInput('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const clearResult = () =>
    useNoteAssistantStore.setState((s) => {
      const runs = { ...s.runs };
      delete runs[runKey];
      return { runs };
    });

  const apply = (how: 'replaceSelection' | 'replaceAll' | 'append' | 'newNote') => {
    if (result?.status !== 'done' || !activeHtml) return;
    const html = activeHtml;
    try {
      const current = useProtoStore.getState();
      if (
        current.isProjectClosed ||
        current.currentProjectMeta.projectId !== projectId ||
        result.projectId !== projectId ||
        result.noteId !== node.id
      ) {
        throw new Error('当前项目已变化，结果未写入');
      }
      const currentNote = current.projectNotes.nodes.find((n) => n.id === node.id);
      if (!currentNote || currentNote.kind !== 'note') throw new Error('笔记已删除，结果未写入');
      if (how === 'newNote') {
        const suffix =
          result.action === 'write' ? 'AI 代写' : result.action === 'polish' ? 'AI 润色' : 'AI 整理';
        const id = createNoteNode(
          projectId,
          'note',
          uniqueNoteTitle(current.projectNotes, currentNote.parentId, `${currentNote.title}（${suffix}）`),
          currentNote.parentId,
          {
            icon: '✨',
            content: html,
            tags: currentNote.tags,
            status: 'draft',
            ...(currentNote.stakeholder ? { stakeholder: currentNote.stakeholder } : {}),
            ...(currentNote.meetingDate ? { meetingDate: currentNote.meetingDate } : {}),
          }
        );
        clearResult();
        onClose();
        openNoteNode(projectId, id);
        return;
      }
      if (!editor || editor.isDestroyed) throw new Error('编辑器尚未就绪');
      if (editor.getHTML() !== currentNote.content) throw new Error('编辑器内容正在同步，请稍后再试');
      if ((how === 'replaceSelection' || how === 'replaceAll') && currentNote.content !== result.sourceContent) {
        throw new Error('笔记在生成后已有修改，请重新生成，或选择追加到文末 / 另存为新笔记');
      }
      // Applying a suggestion must undo independently of nearby typing or external updates.
      const chain = editor.chain().command(({ tr }) => {
        closeHistory(tr);
        return true;
      });
      let applied: boolean;
      if (how === 'replaceSelection') {
        const range = result.selection;
        if (
          !range ||
          range.to > editor.state.doc.content.size ||
          editor.state.doc.textBetween(range.from, range.to, '\n') !== range.text
        ) {
          throw new Error('原选中内容已变化，请重新选择并生成');
        }
        applied = chain.focus().insertContentAt({ from: range.from, to: range.to }, html).run();
      } else if (how === 'replaceAll') {
        applied = chain.focus().setContent(html).run();
      } else {
        applied = chain.focus('end').insertContent(`${editor.isEmpty ? '' : '<hr>'}${html}`).run();
      }
      if (!applied) throw new Error('写入失败，请重试');
      editor.view.dispatch(closeHistory(editor.state.tr));
      onNotice(
        how === 'append' ? 'AI 结果已追加到文末，可用 Cmd/Ctrl+Z 撤销' : 'AI 结果已写入笔记，可用 Cmd/Ctrl+Z 撤销'
      );
      clearResult();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '写入失败');
    }
  };

  const handleCopyPreviewMarkdown = async () => {
    if (!activeMarkdown) return;
    try {
      await navigator.clipboard?.writeText(activeMarkdown);
      setCopiedPreview(true);
      setTimeout(() => setCopiedPreview(false), 1800);
    } catch {
      /* ignore clipboard errors */
    }
  };

  const pages = useMemo(() => sitemapPageOrder(layout), [layout]);
  const candidates = useMemo(
    () => detectNoteMentions(node.content, pages, dbTables),
    [node.content, pages, dbTables]
  );
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(candidates.map((c) => `${c.kind}:${c.id}`))
  );
  const [linkPages, setLinkPages] = useState(true);

  useEffect(() => {
    setChosen(new Set(candidates.map((c) => `${c.kind}:${c.id}`)));
  }, [candidates]);

  const applyMentions = () => {
    if (!editor) return;
    let linked = 0;
    for (const c of candidates) {
      if (!chosen.has(`${c.kind}:${c.id}`)) continue;
      let range: { from: number; to: number } | null = null;
      editor.state.doc.descendants((child, pos) => {
        if (range || !child.isText || !child.text) return !range;
        if (child.marks.some((m) => m.type.name === 'link')) return false;
        const index = child.text.indexOf(c.term);
        if (index >= 0) range = { from: pos + index, to: pos + index + c.term.length };
        return !range;
      });
      if (!range) continue;
      editor.chain().setTextSelection(range).setLink({ href: c.href }).run();
      linked++;
      if (c.kind === 'page' && linkPages) {
        try {
          addPageNoteLink(projectId, c.id, node.id);
        } catch {
          /* page left the sitemap */
        }
      }
    }
    onNotice(linked ? `已补全 ${linked} 处 @ 引用${linkPages ? '，并关联到对应页面' : ''}` : '没有可补全的引用');
    onClose();
  };

  const tabs: { id: NoteAssistantTab; label: string; icon: React.ReactNode }[] = [
    { id: 'write', label: 'AI 代写', icon: <PenLine size={12} /> },
    { id: 'polish', label: '润色改写', icon: <Sparkles size={12} /> },
    { id: 'organize', label: '整理成纪要', icon: <Wand2 size={12} /> },
    { id: 'actions', label: '提取待办', icon: <ListTodo size={12} /> },
    { id: 'mentions', label: '识别页面 / 表关联', icon: <Link2 size={12} /> },
  ];

  const canStartGeneration =
    hermesStatus === 'running' &&
    !modelBusy &&
    !projectRunning &&
    !running &&
    Boolean(session?.models.currentModelId) &&
    (tab === 'write' ? Boolean(instructions.write.trim()) : hasContent);

  return (
    <aside
      role="dialog"
      aria-labelledby={titleId}
      aria-label="AI 笔记助手"
      className={`pf-notes-surface shrink-0 border-l border-slate-200 bg-white flex flex-col h-full z-30 text-xs transition-[width] duration-200 ${
        wideMode ? 'w-[560px] xl:w-[660px]' : 'w-[420px] xl:w-[460px]'
      }`}
    >
      {/* Top Assistant Header — aligned to h-11 workspace header */}
      <header className="h-11 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3.5 shrink-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-2xs">
            <Sparkles size={13} />
          </span>
          <div className="min-w-0 flex items-center gap-1.5">
            <h2 id={titleId} className="truncate font-semibold text-slate-900 text-xs">
              AI 笔记助手
            </h2>
            <span className="text-slate-300 text-[10px] shrink-0">/</span>
            <span className="truncate text-[11px] font-medium text-slate-500" title={node.title}>
              {node.title}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setWideMode((v) => !v)}
            aria-label={wideMode ? '切换标准面板宽度' : '展开宽屏对照面板'}
            title={wideMode ? '恢复标准侧栏宽度' : '展开宽屏面板（适合原文对照）'}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer transition"
          >
            {wideMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer transition"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {/* Mode Switcher Tablist — aligned with editor formatting bar surface */}
      <nav
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200/90 bg-slate-50/80 px-2.5 py-1.5 no-scrollbar"
        aria-label="笔记助手功能"
        role="tablist"
      >
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={running}
              onClick={() => {
                setTab(t.id);
                setError('');
              }}
              className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition cursor-pointer disabled:cursor-wait disabled:opacity-50 ${
                active
                  ? 'border-slate-200/90 bg-white text-blue-700 shadow-2xs font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-200/60'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Main Scrollable Stream Area — uses bg-slate-50/40 for dark-theme token mapping */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50/40 px-3 py-3 space-y-3">
        {error && (
          <div
            role="alert"
            className="flex items-start justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 shadow-2xs"
          >
            <span className="leading-relaxed">{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              aria-label="清除错误提示"
              className="shrink-0 text-rose-400 hover:text-rose-700 cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {tab === 'mentions' ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Link2 size={13} className="text-blue-600" />
                <span>智能识别页面与数据表关联</span>
              </span>
              <span className="rounded-md bg-slate-100 border border-slate-200/80 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                本地匹配 · 零延迟
              </span>
            </div>
            {candidates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-8 text-center space-y-1.5">
                <p className="font-medium text-slate-600">正文中没有发现尚未引用的页面名或数据表名。</p>
                <p className="text-[11px] text-slate-400">
                  在正文中直接提及工程里已有的页面标题或表名，即可在此一键转为可点击的 @ 引用胶囊。
                </p>
              </div>
            ) : (
              <>
                <p className="text-slate-500 leading-relaxed">
                  以下名称在正文中出现，且对应真实存在的页面或数据表。勾选后会把首次出现处改为可点击的 @ 引用。
                </p>
                <div className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-0.5" role="group" aria-label="识别到的引用">
                  {candidates.map((c) => {
                    const id = `${c.kind}:${c.id}`;
                    const isChecked = chosen.has(id);
                    return (
                      <label
                        key={id}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 transition ${
                          isChecked
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`引用 ${c.label}`}
                          checked={isChecked}
                          onChange={() =>
                            setChosen((cur) => {
                              const next = new Set(cur);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            })
                          }
                        />
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          {c.kind === 'page' ? '📄 页面' : '🗄️ 数据表'}
                        </span>
                        <span className="flex-1 truncate font-medium text-slate-800">{c.label}</span>
                        <span className="text-[11px] text-slate-400 tabular-nums">出现 {c.occurrences} 次</span>
                      </label>
                    );
                  })}
                </div>
                <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-slate-600">
                  <input
                    type="checkbox"
                    checked={linkPages}
                    onChange={(e) => setLinkPages(e.target.checked)}
                  />
                  <span>同时把本笔记关联到识别出的页面（单页 AI 对话会自动附带本笔记背景）</span>
                </label>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Mode Intro + Context Scope + Polish Style Card */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2.5">
              <p className="leading-relaxed text-slate-600">{ACTION_DETAILS[tab].description}</p>

              {/* Context Scope Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200/70 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-600 min-w-0">
                  <FileText size={12} className="text-blue-600 shrink-0" />
                  <span className="truncate">
                    {useSelection && selection?.text.trim()
                      ? `当前作用于选中片段（${selection.text.trim().length} 字）`
                      : `当前作用于整篇笔记（${notePlainText ? `${notePlainText.replace(/\s+/g, '').length} 字` : '空白草稿'}）`}
                  </span>
                </div>
                {selection?.text.trim() && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200/80 px-2 py-0.5 text-[11px] font-medium text-blue-700 shrink-0">
                    <input
                      type="checkbox"
                      checked={useSelection}
                      onChange={(e) => setUseSelection(e.target.checked)}
                      disabled={running}
                    />
                    {tab === 'write' ? '仅参考' : '只处理'}选中的 {selection.text.trim().length} 字
                  </label>
                )}
              </div>

              {/* Excerpt quote preview when selection is active */}
              {useSelection && selection?.text.trim() && (
                <div className="rounded-lg border-l-2 border-blue-500 bg-slate-50/80 px-2.5 py-1.5 text-[11px] text-slate-500 line-clamp-2">
                  “{selection.text.trim()}”
                </div>
              )}

              {/* Polish Style Pills */}
              {tab === 'polish' && (
                <div className="space-y-1.5 pt-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-700 shrink-0">润色风格</span>
                    <span className="text-[10px] text-slate-400 truncate">
                      {NOTE_POLISH_STYLES[polishStyle].prompt}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="润色风格">
                    {(Object.keys(NOTE_POLISH_STYLES) as NotePolishStyle[]).map((style) => {
                      const active = polishStyle === style;
                      return (
                        <button
                          type="button"
                          key={style}
                          aria-pressed={active}
                          disabled={running}
                          onClick={() => setPolishStyle(style)}
                          className={`rounded-xl border px-2 py-1.5 text-center font-medium transition cursor-pointer disabled:opacity-50 ${
                            active
                              ? 'border-blue-300 bg-blue-50 text-blue-700 font-semibold shadow-2xs'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {NOTE_POLISH_STYLES[style].label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {tab !== 'write' && !hasContent && (
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-800 flex items-center justify-between gap-2">
                <span>笔记还没有正文，先写一些内容，或切换到“AI 代写”起草。</span>
                <button
                  type="button"
                  onClick={() => setTab('write')}
                  className="shrink-0 font-semibold text-blue-700 hover:underline cursor-pointer"
                >
                  切到 AI 代写
                </button>
              </div>
            )}

            {/* Quick Prompt Suggestion Cards (matches AiChatPanel empty state) */}
            {!running && result?.status !== 'done' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    快捷指令（点击填入下方输入框）
                  </span>
                </div>
                <div className="space-y-1.5">
                  {ACTION_DETAILS[tab].quickPrompts.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      disabled={running}
                      onClick={() =>
                        setInstructions((cur) => ({
                          ...cur,
                          [tab]: cur[tab].trim() ? `${cur[tab].trim()}\n${item.prompt}` : item.prompt,
                        }))
                      }
                      className="w-full text-left px-3 py-2 rounded-xl border border-slate-200/80 bg-white hover:bg-blue-50 hover:border-blue-300 transition cursor-pointer shadow-2xs disabled:opacity-40 space-y-0.5"
                    >
                      <div className="text-[11.5px] font-semibold text-slate-800">{item.label}</div>
                      <div className="text-[10.5px] text-slate-500 line-clamp-1">{item.prompt}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Live Streaming Progress & Partial Output Card */}
            {running && (
              <div
                role="status"
                className="rounded-2xl border border-blue-200 bg-white p-3.5 shadow-2xs space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-semibold text-blue-700">
                    <Loader2 size={14} className="animate-spin shrink-0 text-blue-600" />
                    <span>{run?.message || 'AI 正在思考…'}</span>
                  </span>
                  {streamingProgress && (
                    <span className="text-[11px] text-slate-400 truncate max-w-[160px]">
                      {streamingProgress}
                    </span>
                  )}
                </div>
                {streamingPreviewText ? (
                  <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 font-mono text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap">
                    {streamingPreviewText}
                  </div>
                ) : (
                  <div className="space-y-2 py-1">
                    <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
                  </div>
                )}
              </div>
            )}

            {result?.status === 'error' && !error && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 shadow-2xs"
              >
                {result.message}
              </div>
            )}

            {/* AI Result Preview + Comparison + Multi-turn Refinement */}
            {result?.status === 'done' && activeHtml && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
                  {/* Preview Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/80 px-3 py-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                      <span className="text-[11px] font-semibold text-slate-800">
                        AI 结果预览（尚未写入笔记）
                      </span>
                      {comparisonStats && (
                        <span className="rounded-md bg-white border border-slate-200/80 px-1.5 py-0.5 text-[10px] text-slate-500 tabular-nums">
                          {comparisonStats.srcLen > 0
                            ? `${comparisonStats.srcLen} 字 → ${comparisonStats.tgtLen} 字`
                            : `共 ${comparisonStats.tgtLen} 字`}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {/* View Mode Switcher: Rendered / Compare / Markdown */}
                      <div
                        role="group"
                        aria-label="预览视图模式"
                        className="flex items-center rounded-lg border border-slate-200/80 bg-slate-100 p-0.5 text-[10px]"
                      >
                        <button
                          type="button"
                          aria-pressed={previewMode === 'rendered'}
                          onClick={() => setPreviewMode('rendered')}
                          className={`rounded-md px-2 py-0.5 font-medium cursor-pointer transition ${
                            previewMode === 'rendered'
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          仅看结果
                        </button>
                        <button
                          type="button"
                          aria-pressed={previewMode === 'compare'}
                          onClick={() => setPreviewMode('compare')}
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium cursor-pointer transition ${
                            previewMode === 'compare'
                              ? 'bg-white text-blue-700 shadow-2xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <Columns2 size={10} />
                          原文对照
                        </button>
                        <button
                          type="button"
                          aria-pressed={previewMode === 'markdown'}
                          onClick={() => setPreviewMode('markdown')}
                          className={`rounded-md px-2 py-0.5 font-medium cursor-pointer transition ${
                            previewMode === 'markdown'
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          MD
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleCopyPreviewMarkdown}
                        title="复制生成结果的 Markdown"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200/80 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                      >
                        {copiedPreview ? (
                          <Check size={11} className="text-emerald-600" />
                        ) : (
                          <Copy size={11} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Multi-turn Revision History Pills (when more than 1 turn exists) */}
                  {result.history && result.history.length > 1 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-200/70 bg-slate-50/60 px-3 py-1.5">
                      <History size={11} className="text-blue-600 shrink-0" />
                      <span className="text-[10px] font-medium text-slate-500 shrink-0">版本历史：</span>
                      {result.history.map((rev, idx) => {
                        const isSelected =
                          selectedRevIndex === null
                            ? idx === result.history!.length - 1
                            : selectedRevIndex === idx;
                        return (
                          <button
                            key={rev.id}
                            type="button"
                            onClick={() => setSelectedRevIndex(idx)}
                            title={rev.instruction ? `要求：${rev.instruction}` : rev.label}
                            className={`rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0 cursor-pointer transition ${
                              isSelected
                                ? 'bg-blue-600 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-600 hover:border-blue-300'
                            }`}
                          >
                            {rev.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Preview Body */}
                  <div
                    className="pf-notion-editor max-h-[38vh] overflow-y-auto p-3.5"
                    aria-label="AI 结果预览"
                  >
                    {previewMode === 'compare' ? (
                      <div className={`grid gap-3 ${wideMode ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 uppercase">
                            <span>{result.selection ? '选中段原文' : '笔记原文'}</span>
                            <span>{comparisonStats?.srcLen ?? 0} 字</span>
                          </div>
                          {result.selection ? (
                            <p className="text-xs leading-relaxed text-slate-600 whitespace-pre-wrap">
                              {result.selection.text}
                            </p>
                          ) : comparisonStats?.sourcePlain ? (
                            <div
                              className="ProseMirror opacity-85"
                              style={{ minHeight: 0 }}
                              dangerouslySetInnerHTML={{ __html: result.sourceContent }}
                            />
                          ) : (
                            <p className="text-slate-400 italic">（生成前为空白笔记）</p>
                          )}
                        </div>
                        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] font-semibold text-blue-700 uppercase">
                            <span>AI 生成结果</span>
                            <span>{comparisonStats?.tgtLen ?? 0} 字</span>
                          </div>
                          {/* Generated by markdownToNoteHtml, which escapes all text content. */}
                          <div
                            className="ProseMirror"
                            style={{ minHeight: 0 }}
                            dangerouslySetInnerHTML={{ __html: activeHtml }}
                          />
                        </div>
                      </div>
                    ) : previewMode === 'markdown' ? (
                      <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700">
                        {activeMarkdown}
                      </pre>
                    ) : (
                      /* Generated by markdownToNoteHtml, which escapes all text content. */
                      <div
                        className="ProseMirror"
                        style={{ minHeight: 0 }}
                        dangerouslySetInnerHTML={{ __html: activeHtml }}
                      />
                    )}
                  </div>

                  {/* Preview Apply Action Footer (inside Preview Card) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 bg-slate-50/70 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        clearResult();
                        onClose();
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 cursor-pointer transition"
                    >
                      放弃
                    </button>

                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => apply('newNote')}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer transition"
                      >
                        <FilePlus2 size={12} className="text-slate-500" />
                        另存为新笔记
                      </button>
                      <button
                        type="button"
                        onClick={() => apply('append')}
                        className="rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1 font-medium text-blue-700 hover:bg-blue-100 cursor-pointer transition"
                      >
                        追加到文末
                      </button>
                      {result.selection ? (
                        <button
                          type="button"
                          onClick={() => apply('replaceSelection')}
                          className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-700 cursor-pointer transition shadow-2xs"
                        >
                          <Replace size={12} />
                          替换选中内容
                        </button>
                      ) : (
                        tab !== 'actions' && (
                          <button
                            type="button"
                            onClick={() => apply('replaceAll')}
                            className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-700 cursor-pointer transition shadow-2xs"
                          >
                            <Replace size={12} />
                            {notePlainText ? '替换全文' : '写入笔记'}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>

                {/* Conversational Follow-up Refinement Card (多轮追问微调) */}
                <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
                      <Sparkles size={12} className="text-violet-600" />
                      <span>继续对话微调当前结果</span>
                    </span>
                    <span className="text-[10px] text-slate-400">保留原文上下文</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {REFINE_QUICK_PROMPTS.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        disabled={running || projectRunning || modelBusy}
                        onClick={() => void start(tab, chip.prompt)}
                        className="rounded-lg border border-slate-200/80 bg-slate-50/80 hover:border-blue-300 hover:bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:text-blue-700 cursor-pointer transition disabled:opacity-40"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (refineInput.trim() && !running && !projectRunning && !modelBusy) {
                        void start(tab, refineInput);
                      }
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      type="text"
                      aria-label="追问微调要求"
                      value={refineInput}
                      onChange={(e) => setRefineInput(e.target.value)}
                      disabled={running || projectRunning || modelBusy}
                      placeholder="输入微调要求，例如：把第三节改为表格、补充财务复核节点…"
                      className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 outline-none disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={!refineInput.trim() || running || projectRunning || modelBusy}
                      className="inline-flex items-center gap-1 rounded-xl bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-medium text-white cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    >
                      <Send size={11} />
                      <span>微调</span>
                    </button>
                  </form>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Docked Area: Unified Composer (for AI tabs) or Mention Apply Bar */}
      {tab === 'mentions' ? (
        <footer className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-3.5 py-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 cursor-pointer transition"
          >
            关闭
          </button>
          <button
            type="button"
            disabled={!chosen.size || !candidates.length}
            onClick={applyMentions}
            className="rounded-xl bg-blue-600 px-3.5 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-40 cursor-pointer transition shadow-2xs"
          >
            补全所选引用
          </button>
        </footer>
      ) : (
        <div className="p-2.5 bg-white border-t border-slate-200 shrink-0">
          <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-2.5 space-y-1.5 transition-all focus-within:bg-white focus-within:border-blue-500/80 focus-within:shadow-[0_2px_12px_-3px_rgba(37,99,235,0.12)]">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-[10px] font-semibold text-slate-500">
                {tab === 'write' ? '写作要求' : '补充要求（选填）'}
              </span>
              {instructions[tab].trim() && (
                <button
                  type="button"
                  disabled={running}
                  onClick={() => setInstructions((cur) => ({ ...cur, [tab]: '' }))}
                  className="text-[10px] text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  清空输入
                </button>
              )}
            </div>

            <textarea
              aria-label={tab === 'write' ? '写作要求' : '补充要求'}
              autoFocus={tab === 'write'}
              value={instructions[tab]}
              onChange={(e) => setInstructions((current) => ({ ...current, [tab]: e.target.value }))}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  (e.metaKey || e.ctrlKey || (!e.shiftKey && tab !== 'write')) &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (canStartGeneration) void start(tab);
                }
              }}
              disabled={running}
              rows={tab === 'write' ? 3 : 2}
              placeholder={ACTION_DETAILS[tab].placeholder}
              className="w-full resize-y rounded-lg bg-transparent px-1 py-0.5 text-xs leading-relaxed text-slate-800 placeholder:text-slate-400 outline-none disabled:opacity-50"
            />

            {/* Integrated Composer Footer: Model Picker (Left) + Submit / Stop (Right) */}
            <div className="pt-1.5 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 min-w-0 flex-1">
                {hermesStatus === 'running' ? (
                  <>
                    <button
                      type="button"
                      aria-label="选择笔记助手模型"
                      aria-haspopup="dialog"
                      aria-expanded={pickerOpen}
                      disabled={modelBusy || projectRunning || running || !session}
                      onClick={() => {
                        if (session) setPickerSessionId(session.sessionId);
                      }}
                      title={modelChoice ? `${modelChoice.title} · ${modelChoice.source}` : modelTitle}
                      className="inline-flex min-w-0 max-w-[180px] h-6 items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-2 text-[11px] font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer transition shadow-2xs"
                    >
                      <ModelProviderIcon brand={modelChoice ? modelChoice.brand : 'unknown'} size={14} />
                      <span className="truncate">{modelBusy ? '正在加载模型…' : modelTitle}</span>
                      <ChevronDown size={11} className="shrink-0 text-slate-400" />
                    </button>
                    {modelChoice && (
                      <span className="hidden sm:inline text-[10px] text-slate-400 truncate max-w-[72px]">
                        {modelChoice.source}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label="刷新笔记助手模型"
                      title="刷新模型列表"
                      disabled={modelBusy || projectRunning || running}
                      onClick={() =>
                        void refreshModels().catch((err) =>
                          setModelError(err instanceof Error ? err.message : String(err))
                        )
                      }
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 disabled:opacity-40 cursor-pointer transition"
                    >
                      <RefreshCw size={11} className={modelBusy ? 'animate-spin' : ''} />
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-2 py-0.5">
                    <span>需要先连接 Hermes 引擎</span>
                    <button
                      type="button"
                      onClick={() => setHermesModalOpen(true, 'overview')}
                      className="font-semibold underline cursor-pointer"
                    >
                      去连接
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {running ? (
                  <button
                    type="button"
                    onClick={() =>
                      void useHermesStore
                        .getState()
                        .stop(noteAssistantScope(projectId))
                        .catch((err) => setError(err instanceof Error ? err.message : '停止失败，请重试'))
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100 cursor-pointer transition"
                  >
                    <Square size={11} />
                    停止
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!canStartGeneration}
                    onClick={() => void start(tab)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-2xs hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer transition"
                  >
                    <Sparkles size={12} />
                    {result?.status === 'done' ? '重新生成' : ACTION_DETAILS[tab].startLabel}
                  </button>
                )}
              </div>
            </div>

            {modelError && (
              <p role="alert" className="mt-1 text-[11px] text-rose-600">
                模型加载失败：{modelError}。可点击刷新重试。
              </p>
            )}
          </div>
        </div>
      )}

      {pickerOpen && session && (
        <HermesModelPicker
          key={JSON.stringify([sessionKey, session.sessionId])}
          models={session.models.availableModels}
          currentModelId={session.models.currentModelId}
          running={projectRunning || running}
          onSelect={selectModel}
          onRefresh={() => refreshModels(session.sessionId)}
          onClose={() => setPickerSessionId(null)}
        />
      )}
    </aside>
  );
}
