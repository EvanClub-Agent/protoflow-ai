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
import { useI18n } from '../i18n';

const POLISH_STYLE_EN: Record<NotePolishStyle, { label: string; prompt: string }> = {
  natural: { label: 'Natural', prompt: 'Smooth, natural phrasing while keeping every business rule intact.' },
  concise: { label: 'Concise', prompt: 'Remove filler words and tighten sentences without losing facts.' },
  structured: { label: 'Structured', prompt: 'Organize with clear headings, bullet points, and tables.' },
  formal: { label: 'Executive', prompt: 'Polished, client-ready written tone for formal sign-off.' },
};

function getActionDetails(tr: <T extends string>(zh: T, en: string) => string): Record<
  NoteAssistantAction,
  {
    description: string;
    startLabel: string;
    placeholder: string;
    quickPrompts: { label: string; prompt: string }[];
  }
> {
  return {
    write: {
      description: tr(
        '描述你想写的内容，AI 会结合当前笔记上下文起草正文、续写章节或生成需求提纲。',
        'Describe what you want to write — AI drafts sections, continues your text, or creates an outline using the current note context.'
      ),
      startLabel: tr('开始代写', 'Draft with AI'),
      placeholder: tr(
        '描述写作要求（Enter 发送，Shift + Enter 换行）…\n例如：帮我起草一份订单退款需求说明，包含背景、核心流程和验收标准，尚未明确的规则标为待确认。',
        'Describe what to write (Cmd/Ctrl + Enter to send, Enter for newline)…\ne.g. Draft an order refund spec with background, core flow, and acceptance criteria; mark undecided rules as Pending.'
      ),
      quickPrompts: [
        {
          label: tr('📋 起草背景、流程与验收标准', '📋 Draft background, flow & acceptance criteria'),
          prompt: tr(
            '结合当前笔记标题与已有内容，起草完整的业务背景、核心操作流程、字段规则与验收标准，尚未确认的细节标为待确认。',
            'Based on the current note title and existing content, draft complete business background, core user flows, field rules, and acceptance criteria, marking unconfirmed details as Pending.'
          ),
        },
        {
          label: tr('🔍 补充异常分支与边界规则', '🔍 Add edge cases & exception rules'),
          prompt: tr(
            '针对当前笔记中的业务流程，补充异常分支处理、权限控制与数据校验边界规则（不确定处标注建议或待确认）。',
            'For the business flows in this note, add exception handling, permission controls, and validation boundary rules (mark uncertain items as suggested or pending).'
          ),
        },
        {
          label: tr('❓ 梳理客户待确认问题清单', '❓ List open questions for client confirmation'),
          prompt: tr(
            '根据当前笔记内容，梳理一份结构化的“待向客户确认问题清单”，按业务模块分类并说明影响范围。',
            'From the current note, compile a structured list of open questions for client sign-off, grouped by module with impact scope.'
          ),
        },
        {
          label: tr('✍️ 顺着上文继续续写', '✍️ Continue writing from the last section'),
          prompt: tr(
            '顺着当前笔记的最后一部分继续向下续写后续章节，保持文风与结构一致。',
            'Continue writing subsequent sections from the end of the current note, maintaining consistent tone and structure.'
          ),
        },
      ],
    },
    polish: {
      description: tr(
        '保留原意、数字、日期与业务规则，优化用词、语句和文档结构。支持全文或选中段落润色。',
        'Refines wording, clarity, and structure while preserving original meaning, numbers, dates, and business rules.'
      ),
      startLabel: tr('开始润色', 'Polish Text'),
      placeholder: tr(
        '补充润色要求（选填，例如：面向客户汇报，保留所有数字和时间，控制在 300 字以内）…',
        'Optional polish instructions (e.g. client-facing summary, keep all numbers/dates, under 300 words)…'
      ),
      quickPrompts: [
        {
          label: tr('👔 面向客户汇报', '👔 Client-facing executive tone'),
          prompt: tr(
            '调整为适合发给客户确认的书面表达，语气专业得体，严格保留所有数字、金额与时间。',
            'Rewrite in a professional client-ready tone for sign-off while strictly preserving all numbers, amounts, and dates.'
          ),
        },
        {
          label: tr('🎯 提炼为要点列表', '🎯 Distill into structured bullet points'),
          prompt: tr(
            '将冗长段落提炼为层次清晰的要点列表与小标题，突出核心业务规则。',
            'Distill lengthy paragraphs into clear headings and bullet points highlighting core business rules.'
          ),
        },
        {
          label: tr('✂️ 精简至 300 字内', '✂️ Condense to under 300 words'),
          prompt: tr(
            '去除口语赘词与重复铺垫，保留关键规则和结论，整体控制在 300 字以内。',
            'Remove conversational filler and repetition, keeping key rules and conclusions within 300 words.'
          ),
        },
      ],
    },
    organize: {
      description: tr(
        '将杂乱速记或会议转写整理为：背景与参与人、确认结论、需求点表格、待确认问题与待办清单。',
        'Turns raw notes or meeting transcripts into structured minutes: context, confirmed decisions, requirement table, open questions, and to-dos.'
      ),
      startLabel: tr('整理成纪要', 'Organize Minutes'),
      placeholder: tr(
        '可补充整理侧重点（选填，例如：重点标出涉及金额审批的规则、按模块归类需求表格）…',
        'Optional focus instructions (e.g. highlight amount approval thresholds, group requirements by module)…'
      ),
      quickPrompts: [
        {
          label: tr('📌 严分已拍板与待确认', '📌 Separate confirmed vs. pending items'),
          prompt: tr(
            '严格区分客户已拍板结论与尚未定论的问题，未确认事项全部归入“待确认问题”小节。',
            'Strictly separate confirmed client decisions from unresolved topics, placing all unconfirmed items under "Open Questions".'
          ),
        },
        {
          label: tr('📊 细化模块需求点表格', '📊 Detailed module requirement table'),
          prompt: tr(
            '在需求点表格中尽量细化模块/页面名称、具体业务规则描述与状态。',
            'Detail module/page names, concrete business rules, and status columns in the requirements table.'
          ),
        },
        {
          label: tr('💰 突出金额与审批节点', '💰 Highlight amounts & approval gates'),
          prompt: tr(
            '重点保留并突出原文中涉及金额阈值、审批流转、接口对接的业务规则。',
            'Preserve and highlight rules involving amount thresholds, approval workflows, and API integrations.'
          ),
        },
      ],
    },
    actions: {
      description: tr(
        '扫描正文中的口头承诺、分工与时间节点，提取为“负责人｜截止时间｜事项”格式的勾选待办。',
        'Scans commitments, owners, and deadlines in the note to extract checkable to-dos formatted as "Owner | Due | Action".'
      ),
      startLabel: tr('提取待办', 'Extract To-Dos'),
      placeholder: tr(
        '可补充提取要求（选填，例如：只提取需要客户侧配合提供的事项、按截止时间排序）…',
        'Optional extraction rules (e.g. only client-side deliverables, sort by due date)…'
      ),
      quickPrompts: [
        {
          label: tr('🤝 重点提取客户配合项', '🤝 Focus on client deliverables'),
          prompt: tr(
            '优先识别需要客户侧确认、提供资料或拍板的行动项，并在事项中注明。',
            'Prioritize action items requiring client confirmation, materials, or sign-off, and label them clearly.'
          ),
        },
        {
          label: tr('🔌 提取接口与数据准备事项', '🔌 Focus on API & data preparation'),
          prompt: tr(
            '重点提取涉及接口文档、数据字典、测试环境与字段确认的待办事项。',
            'Extract action items related to API specs, data dictionaries, test environments, and field confirmations.'
          ),
        },
      ],
    },
  };
}

function getRefineQuickPrompts(tr: <T extends string>(zh: T, en: string) => string) {
  return [
    {
      label: tr('✨ 再精简一点', '✨ Make it more concise'),
      prompt: tr(
        '在保留核心业务规则和数字的前提下，把内容再精简 30%，去掉冗余描述。',
        'Condense the content by ~30% while keeping all core business rules and numbers.'
      ),
    },
    {
      label: tr('📊 关键规则改为表格', '📊 Format key rules as table'),
      prompt: tr(
        '把其中的核心需求点或规则整理成结构化 Markdown 表格呈现。',
        'Convert the core requirement points and rules into a structured Markdown table.'
      ),
    },
    {
      label: tr('✅ 补充验收标准', '✅ Add acceptance criteria'),
      prompt: tr(
        '在末尾补充一节可测试的“验收标准”勾选清单，未明确处标为待确认。',
        'Append a testable "Acceptance Criteria" checklist at the end, marking unclear items as Pending.'
      ),
    },
    {
      label: tr('❓ 标出待确认项', '❓ Highlight open questions'),
      prompt: tr(
        '检查全文，把尚不明确或存在歧义的规则单独汇总到“待确认事项”小节。',
        'Review the text and gather any ambiguous or undecided rules into a dedicated "Open Questions" section.'
      ),
    },
  ];
}

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
  const { isEn, tr, td } = useI18n();
  const actionDetails = useMemo(() => getActionDetails(tr), [tr]);
  const refineQuickPrompts = useMemo(() => getRefineQuickPrompts(tr), [tr]);
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
      : tr('选择模型', 'Select model');
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
      label: history.length > 1 ? tr(`第 ${history.length} 版`, `Rev ${history.length}`) : tr('初稿', 'Draft 1'),
      markdown: result.markdown ?? '',
      html: result.html ?? '',
    };
  }, [result, selectedRevIndex, tr]);

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
      throw new Error(tr('当前笔记已变化，请重新打开模型选择', 'Active note changed; please reopen model picker'));
    }
    if (expectedSessionId !== undefined && state.sessions[sessionKey]?.sessionId !== expectedSessionId) {
      throw new Error(tr('笔记助手会话已变化，请重新打开模型选择', 'Assistant session changed; please reopen model picker'));
    }
    if (state.status !== 'running') throw new Error(tr('请先连接 Hermes 引擎', 'Please connect the Hermes engine first'));
    if (pendingProjectAiTasks.has(projectId) || state.runningProjects[projectId]) {
      throw new Error(tr('请等待当前 AI 任务结束后再切换模型', 'Please wait for the current AI task to finish before switching models'));
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
    if (pickerSessionId === null) throw new Error(tr('请重新打开模型选择', 'Please reopen model picker'));
    assertModelSession(pickerSessionId);
    if (
      !useHermesStore
        .getState()
        .sessions[sessionKey]?.models.availableModels.some((model) => model.modelId === modelId)
    ) {
      throw new Error(tr('所选模型已不在列表中，请刷新后重试', 'Selected model is no longer available; refresh and try again'));
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
      if (modelBusy || !session?.models.currentModelId) throw new Error(tr('请等待模型加载完成后再生成', 'Please wait for the model to finish loading'));
      assertModelSession(session.sessionId);
      if (!editor || editor.isDestroyed) throw new Error(tr('编辑器尚未就绪', 'Editor is not ready yet'));
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
        throw new Error(tr('选中内容已变化，请关闭助手后重新选择', 'Selected text changed; close the assistant and select again'));
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
        throw new Error(tr('当前项目已变化，结果未写入', 'Active project changed; result was not applied'));
      }
      const currentNote = current.projectNotes.nodes.find((n) => n.id === node.id);
      if (!currentNote || currentNote.kind !== 'note') throw new Error(tr('笔记已删除，结果未写入', 'Note was deleted; result was not applied'));
      if (how === 'newNote') {
        const suffix =
          result.action === 'write'
            ? tr('AI 代写', 'AI Draft')
            : result.action === 'polish'
            ? tr('AI 润色', 'AI Polished')
            : tr('AI 整理', 'AI Organized');
        const id = createNoteNode(
          projectId,
          'note',
          uniqueNoteTitle(
            current.projectNotes,
            currentNote.parentId,
            isEn ? `${currentNote.title} (${suffix})` : `${currentNote.title}（${suffix}）`
          ),
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
      if (!editor || editor.isDestroyed) throw new Error(tr('编辑器尚未就绪', 'Editor is not ready yet'));
      if (editor.getHTML() !== currentNote.content) throw new Error(tr('编辑器内容正在同步，请稍后再试', 'Editor content is syncing; please try again shortly'));
      if ((how === 'replaceSelection' || how === 'replaceAll') && currentNote.content !== result.sourceContent) {
        throw new Error(tr('笔记在生成后已有修改，请重新生成，或选择追加到文末 / 另存为新笔记', 'The note was modified after generation; regenerate or choose Append / Save as New Note'));
      }
      // Applying a suggestion must undo independently of nearby typing or external updates.
      const chain = editor.chain().command(({ tr: pmTr }) => {
        closeHistory(pmTr);
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
          throw new Error(tr('原选中内容已变化，请重新选择并生成', 'Original selection changed; please select again and regenerate'));
        }
        applied = chain.focus().insertContentAt({ from: range.from, to: range.to }, html).run();
      } else if (how === 'replaceAll') {
        applied = chain.focus().setContent(html).run();
      } else {
        applied = chain.focus('end').insertContent(`${editor.isEmpty ? '' : '<hr>'}${html}`).run();
      }
      if (!applied) throw new Error(tr('写入失败，请重试', 'Failed to apply changes; please try again'));
      editor.view.dispatch(closeHistory(editor.state.tr));
      onNotice(
        how === 'append'
          ? tr('AI 结果已追加到文末，可用 Cmd/Ctrl+Z 撤销', 'AI output appended to note (Cmd/Ctrl+Z to undo)')
          : tr('AI 结果已写入笔记，可用 Cmd/Ctrl+Z 撤销', 'AI output written to note (Cmd/Ctrl+Z to undo)')
      );
      clearResult();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('写入失败', 'Failed to apply'));
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
    onNotice(
      linked
        ? tr(
            `已补全 ${linked} 处 @ 引用${linkPages ? '，并关联到对应页面' : ''}`,
            `Inserted ${linked} @mention(s)${linkPages ? ' and linked matching pages' : ''}`
          )
        : tr('没有可补全的引用', 'No mentions to insert')
    );
    onClose();
  };

  const tabs: { id: NoteAssistantTab; label: string; icon: React.ReactNode }[] = [
    { id: 'write', label: tr('AI 代写', 'AI Draft'), icon: <PenLine size={12} /> },
    { id: 'polish', label: tr('润色改写', 'Polish'), icon: <Sparkles size={12} /> },
    { id: 'organize', label: tr('整理成纪要', 'Minutes'), icon: <Wand2 size={12} /> },
    { id: 'actions', label: tr('提取待办', 'To-Dos'), icon: <ListTodo size={12} /> },
    { id: 'mentions', label: tr('识别页面 / 表关联', 'Detect @Links'), icon: <Link2 size={12} /> },
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
      aria-label={tr('AI 笔记助手', 'AI Note Assistant')}
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
              {tr('AI 笔记助手', 'AI Note Assistant')}
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
            aria-label={wideMode ? tr('切换标准面板宽度', 'Switch to standard panel width') : tr('展开宽屏对照面板', 'Expand wide comparison panel')}
            title={wideMode ? tr('恢复标准侧栏宽度', 'Restore standard sidebar width') : tr('展开宽屏面板（适合原文对照）', 'Expand wide panel for side-by-side comparison')}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer transition"
          >
            {wideMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            aria-label={tr('关闭', 'Close')}
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
        aria-label={tr('笔记助手功能', 'Note assistant features')}
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
              className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium whitespace-nowrap transition cursor-pointer disabled:cursor-wait disabled:opacity-50 ${
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
            <span className="leading-relaxed break-words min-w-0">{td(error)}</span>
            <button
              type="button"
              onClick={() => setError('')}
              aria-label={tr('清除错误提示', 'Dismiss error')}
              className="shrink-0 text-rose-400 hover:text-rose-700 cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {tab === 'mentions' ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5 min-w-0">
                <Link2 size={13} className="text-blue-600 shrink-0" />
                <span className="truncate">{tr('智能识别页面与数据表关联', 'Smart Page & Table Mention Detection')}</span>
              </span>
              <span className="rounded-md bg-slate-100 border border-slate-200/80 px-2 py-0.5 text-[10px] font-medium text-slate-600 whitespace-nowrap shrink-0">
                {tr('本地匹配 · 零延迟', 'Local · Zero Latency')}
              </span>
            </div>
            {candidates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-8 text-center space-y-1.5">
                <p className="font-medium text-slate-600">{tr('正文中没有发现尚未引用的页面名或数据表名。', 'No unlinked page titles or table names found in the note.')}</p>
                <p className="text-[11px] text-slate-400">
                  {tr(
                    '在正文中直接提及工程里已有的页面标题或表名，即可在此一键转为可点击的 @ 引用胶囊。',
                    'Mention existing page titles or physical table names in the note body to convert them into clickable @mentions in one click.'
                  )}
                </p>
              </div>
            ) : (
              <>
                <p className="text-slate-500 leading-relaxed">
                  {tr(
                    '以下名称在正文中出现，且对应真实存在的页面或数据表。勾选后会把首次出现处改为可点击的 @ 引用。',
                    'These names appear in your note and match real pages or tables. Selected items will turn their first occurrence into a clickable @mention.'
                  )}
                </p>
                <div className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-0.5" role="group" aria-label={tr('识别到的引用', 'Detected mentions')}>
                  {candidates.map((c) => {
                    const id = `${c.kind}:${c.id}`;
                    const isChecked = chosen.has(id);
                    return (
                      <label
                        key={id}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 transition min-w-0 ${
                          isChecked
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          aria-label={tr(`引用 ${c.label}`, `Mention ${c.label}`)}
                          checked={isChecked}
                          onChange={() =>
                            setChosen((cur) => {
                              const next = new Set(cur);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            })
                          }
                          className="shrink-0"
                        />
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 whitespace-nowrap shrink-0">
                          {c.kind === 'page' ? tr('📄 页面', '📄 Page') : tr('🗄️ 数据表', '🗄️ Table')}
                        </span>
                        <span className="flex-1 min-w-0 truncate font-medium text-slate-800">{c.label}</span>
                        <span className="text-[11px] text-slate-400 tabular-nums whitespace-nowrap shrink-0">{tr(`出现 ${c.occurrences} 次`, `${c.occurrences}×`)}</span>
                      </label>
                    );
                  })}
                </div>
                <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-slate-600">
                  <input
                    type="checkbox"
                    checked={linkPages}
                    onChange={(e) => setLinkPages(e.target.checked)}
                    className="shrink-0"
                  />
                  <span>{tr('同时把本笔记关联到识别出的页面（单页 AI 对话会自动附带本笔记背景）', 'Also link this note to detected pages (single-page AI chats will include this note as context)')}</span>
                </label>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Mode Intro + Context Scope + Polish Style Card */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2.5">
              <p className="leading-relaxed text-slate-600">{actionDetails[tab].description}</p>

              {/* Context Scope Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200/70 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-600 min-w-0">
                  <FileText size={12} className="text-blue-600 shrink-0" />
                  <span className="truncate tabular-nums">
                    {useSelection && selection?.text.trim()
                      ? tr(`当前作用于选中片段（${selection.text.trim().length} 字）`, `Scope: Selected excerpt (${selection.text.trim().length} chars)`)
                      : tr(
                          `当前作用于整篇笔记（${notePlainText ? `${notePlainText.replace(/\s+/g, '').length} 字` : '空白草稿'}）`,
                          `Scope: Entire note (${notePlainText ? `${notePlainText.replace(/\s+/g, '').length} chars` : 'blank draft'})`
                        )}
                  </span>
                </div>
                {selection?.text.trim() && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200/80 px-2 py-0.5 text-[11px] font-medium text-blue-700 shrink-0 tabular-nums">
                    <input
                      type="checkbox"
                      checked={useSelection}
                      onChange={(e) => setUseSelection(e.target.checked)}
                      disabled={running}
                    />
                    {tab === 'write'
                      ? tr(`仅参考选中的 ${selection.text.trim().length} 字`, `Reference selection (${selection.text.trim().length} chars)`)
                      : tr(`只处理选中的 ${selection.text.trim().length} 字`, `Selected only (${selection.text.trim().length} chars)`)}
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
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="text-[11px] font-semibold text-slate-700 shrink-0">{tr('润色风格', 'Polish Style')}</span>
                    <span className="text-[10px] text-slate-400 truncate min-w-0">
                      {isEn ? POLISH_STYLE_EN[polishStyle]?.prompt ?? td(NOTE_POLISH_STYLES[polishStyle].prompt) : NOTE_POLISH_STYLES[polishStyle].prompt}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5" role="group" aria-label={tr('润色风格', 'Polish style')}>
                    {(Object.keys(NOTE_POLISH_STYLES) as NotePolishStyle[]).map((style) => {
                      const active = polishStyle === style;
                      const styleLabel = isEn ? POLISH_STYLE_EN[style]?.label ?? td(NOTE_POLISH_STYLES[style].label) : NOTE_POLISH_STYLES[style].label;
                      return (
                        <button
                          type="button"
                          key={style}
                          aria-pressed={active}
                          disabled={running}
                          onClick={() => setPolishStyle(style)}
                          className={`min-w-0 truncate rounded-xl border px-2 py-1.5 text-center font-medium transition cursor-pointer disabled:opacity-50 ${
                            active
                              ? 'border-blue-300 bg-blue-50 text-blue-700 font-semibold shadow-2xs'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {styleLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {tab !== 'write' && !hasContent && (
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-800 flex items-center justify-between gap-2">
                <span>{tr('笔记还没有正文，先写一些内容，或切换到“AI 代写”起草。', 'Note body is empty — write some text first or switch to "AI Draft".')}</span>
                <button
                  type="button"
                  onClick={() => setTab('write')}
                  className="shrink-0 font-semibold text-blue-700 hover:underline whitespace-nowrap cursor-pointer"
                >
                  {tr('切到 AI 代写', 'Switch to AI Draft')}
                </button>
              </div>
            )}

            {/* Quick Prompt Suggestion Cards (matches AiChatPanel empty state) */}
            {!running && result?.status !== 'done' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {tr('快捷指令（点击填入下方输入框）', 'Quick Prompts (click to fill below)')}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {actionDetails[tab].quickPrompts.map((item) => (
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
                      className="w-full text-left px-3 py-2 rounded-xl border border-slate-200/80 bg-white hover:bg-blue-50 hover:border-blue-300 transition cursor-pointer shadow-2xs disabled:opacity-40 space-y-0.5 min-w-0"
                    >
                      <div className="text-[11.5px] font-semibold text-slate-800 truncate">{item.label}</div>
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
                  <span className="inline-flex items-center gap-2 font-semibold text-blue-700 min-w-0">
                    <Loader2 size={14} className="animate-spin shrink-0 text-blue-600" />
                    <span className="truncate">{run?.message ? td(run.message) : tr('AI 正在思考…', 'AI is thinking…')}</span>
                  </span>
                  {streamingProgress && (
                    <span className="text-[11px] text-slate-400 truncate max-w-[160px]">
                      {td(streamingProgress)}
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
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 shadow-2xs break-words"
              >
                {td(result.message ?? '')}
              </div>
            )}

            {/* AI Result Preview + Comparison + Multi-turn Refinement */}
            {result?.status === 'done' && activeHtml && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
                  {/* Preview Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/80 px-3 py-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-[11px] font-semibold text-slate-800 truncate">
                        {tr('AI 结果预览（尚未写入笔记）', 'AI Preview (not applied yet)')}
                      </span>
                      {comparisonStats && (
                        <span className="rounded-md bg-white border border-slate-200/80 px-1.5 py-0.5 text-[10px] text-slate-500 tabular-nums shrink-0">
                          {comparisonStats.srcLen > 0
                            ? tr(`${comparisonStats.srcLen} 字 → ${comparisonStats.tgtLen} 字`, `${comparisonStats.srcLen} → ${comparisonStats.tgtLen} chars`)
                            : tr(`共 ${comparisonStats.tgtLen} 字`, `${comparisonStats.tgtLen} chars`)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {/* View Mode Switcher: Rendered / Compare / Markdown */}
                      <div
                        role="group"
                        aria-label={tr('预览视图模式', 'Preview view mode')}
                        className="flex items-center rounded-lg border border-slate-200/80 bg-slate-100 p-0.5 text-[10px]"
                      >
                        <button
                          type="button"
                          aria-pressed={previewMode === 'rendered'}
                          onClick={() => setPreviewMode('rendered')}
                          className={`rounded-md px-2 py-0.5 font-medium whitespace-nowrap cursor-pointer transition ${
                            previewMode === 'rendered'
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          {tr('仅看结果', 'Result')}
                        </button>
                        <button
                          type="button"
                          aria-pressed={previewMode === 'compare'}
                          onClick={() => setPreviewMode('compare')}
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium whitespace-nowrap cursor-pointer transition ${
                            previewMode === 'compare'
                              ? 'bg-white text-blue-700 shadow-2xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <Columns2 size={10} />
                          {tr('原文对照', 'Compare')}
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
                        title={tr('复制生成结果的 Markdown', 'Copy generated Markdown')}
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
                      <span className="text-[10px] font-medium text-slate-500 shrink-0">{tr('版本历史：', 'Revisions:')}</span>
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
                            title={rev.instruction ? tr(`要求：${rev.instruction}`, `Prompt: ${rev.instruction}`) : td(rev.label)}
                            className={`rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0 cursor-pointer transition ${
                              isSelected
                                ? 'bg-blue-600 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-600 hover:border-blue-300'
                            }`}
                          >
                            {td(rev.label)}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Preview Body */}
                  <div
                    className="pf-notion-editor max-h-[38vh] overflow-y-auto p-3.5"
                    aria-label={tr('AI 结果预览', 'AI output preview')}
                  >
                    {previewMode === 'compare' ? (
                      <div className={`grid gap-3 ${wideMode ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 space-y-1.5 min-w-0">
                          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 uppercase">
                            <span>{result.selection ? tr('选中段原文', 'Original Selection') : tr('笔记原文', 'Original Note')}</span>
                            <span className="tabular-nums">{tr(`${comparisonStats?.srcLen ?? 0} 字`, `${comparisonStats?.srcLen ?? 0} chars`)}</span>
                          </div>
                          {result.selection ? (
                            <p className="text-xs leading-relaxed text-slate-600 whitespace-pre-wrap break-words">
                              {result.selection.text}
                            </p>
                          ) : comparisonStats?.sourcePlain ? (
                            <div
                              className="ProseMirror opacity-85"
                              style={{ minHeight: 0 }}
                              dangerouslySetInnerHTML={{ __html: result.sourceContent }}
                            />
                          ) : (
                            <p className="text-slate-400 italic">{tr('（生成前为空白笔记）', '(Note was blank before generation)')}</p>
                          )}
                        </div>
                        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 space-y-1.5 min-w-0">
                          <div className="flex items-center justify-between text-[10px] font-semibold text-blue-700 uppercase">
                            <span>{tr('AI 生成结果', 'AI Output')}</span>
                            <span className="tabular-nums">{tr(`${comparisonStats?.tgtLen ?? 0} 字`, `${comparisonStats?.tgtLen ?? 0} chars`)}</span>
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
                      className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap cursor-pointer transition"
                    >
                      {tr('放弃', 'Discard')}
                    </button>

                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => apply('newNote')}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer transition"
                      >
                        <FilePlus2 size={12} className="text-slate-500 shrink-0" />
                        {tr('另存为新笔记', 'Save as New Note')}
                      </button>
                      <button
                        type="button"
                        onClick={() => apply('append')}
                        className="rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1 font-medium text-blue-700 hover:bg-blue-100 whitespace-nowrap cursor-pointer transition"
                      >
                        {tr('追加到文末', 'Append')}
                      </button>
                      {result.selection ? (
                        <button
                          type="button"
                          onClick={() => apply('replaceSelection')}
                          className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-700 whitespace-nowrap cursor-pointer transition shadow-2xs"
                        >
                          <Replace size={12} className="shrink-0" />
                          {tr('替换选中内容', 'Replace Selection')}
                        </button>
                      ) : (
                        tab !== 'actions' && (
                          <button
                            type="button"
                            onClick={() => apply('replaceAll')}
                            className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-700 whitespace-nowrap cursor-pointer transition shadow-2xs"
                          >
                            <Replace size={12} className="shrink-0" />
                            {notePlainText ? tr('替换全文', 'Replace All') : tr('写入笔记', 'Insert into Note')}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>

                {/* Conversational Follow-up Refinement Card (多轮追问微调) */}
                <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5 min-w-0">
                      <Sparkles size={12} className="text-violet-600 shrink-0" />
                      <span className="truncate">{tr('继续对话微调当前结果', 'Refine Current Output')}</span>
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0">{tr('保留原文上下文', 'Preserves context')}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {refineQuickPrompts.map((chip) => (
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
                      aria-label={tr('追问微调要求', 'Refinement instructions')}
                      value={refineInput}
                      onChange={(e) => setRefineInput(e.target.value)}
                      disabled={running || projectRunning || modelBusy}
                      placeholder={tr('输入微调要求，例如：把第三节改为表格、补充财务复核节点…', 'Enter refinement, e.g. convert section 3 into a table…')}
                      className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 outline-none disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={!refineInput.trim() || running || projectRunning || modelBusy}
                      className="inline-flex items-center gap-1 rounded-xl bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-medium text-white cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                    >
                      <Send size={11} />
                      <span>{tr('微调', 'Refine')}</span>
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
            {tr('关闭', 'Close')}
          </button>
          <button
            type="button"
            disabled={!chosen.size || !candidates.length}
            onClick={applyMentions}
            className="rounded-xl bg-blue-600 px-3.5 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-40 cursor-pointer transition shadow-2xs"
          >
            {tr('补全所选引用', 'Insert Selected @Mentions')}
          </button>
        </footer>
      ) : (
        <div className="p-2.5 bg-white border-t border-slate-200 shrink-0">
          <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-2.5 space-y-1.5 transition-all focus-within:bg-white focus-within:border-blue-500/80 focus-within:shadow-[0_2px_12px_-3px_rgba(37,99,235,0.12)]">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-[10px] font-semibold text-slate-500">
                {tab === 'write' ? tr('写作要求', 'Writing Prompt') : tr('补充要求（选填）', 'Additional Instructions (optional)')}
              </span>
              {instructions[tab].trim() && (
                <button
                  type="button"
                  disabled={running}
                  onClick={() => setInstructions((cur) => ({ ...cur, [tab]: '' }))}
                  className="text-[10px] text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {tr('清空输入', 'Clear')}
                </button>
              )}
            </div>

            <textarea
              aria-label={tab === 'write' ? tr('写作要求', 'Writing prompt') : tr('补充要求', 'Additional instructions')}
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
              placeholder={actionDetails[tab].placeholder}
              className="w-full resize-y rounded-lg bg-transparent px-1 py-0.5 text-xs leading-relaxed text-slate-800 placeholder:text-slate-400 outline-none disabled:opacity-50"
            />

            {/* Integrated Composer Footer: Model Picker (Left) + Submit / Stop (Right) */}
            <div className="pt-1.5 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 min-w-0 flex-1">
                {hermesStatus === 'running' ? (
                  <>
                    <button
                      type="button"
                      aria-label={tr('选择笔记助手模型', 'Select note assistant model')}
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
                      <span className="truncate">{modelBusy ? tr('正在加载模型…', 'Loading models…') : modelTitle}</span>
                      <ChevronDown size={11} className="shrink-0 text-slate-400" />
                    </button>
                    {modelChoice && (
                      <span className="hidden sm:inline text-[10px] text-slate-400 truncate max-w-[72px]">
                        {modelChoice.source}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={tr('刷新笔记助手模型', 'Refresh note assistant models')}
                      title={tr('刷新模型列表', 'Refresh model list')}
                      disabled={modelBusy || projectRunning || running}
                      onClick={() =>
                        void refreshModels().catch((err) =>
                          setModelError(err instanceof Error ? err.message : String(err))
                        )
                      }
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 disabled:opacity-40 shrink-0 cursor-pointer transition"
                    >
                      <RefreshCw size={11} className={modelBusy ? 'animate-spin' : ''} />
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-2 py-0.5">
                    <span>{tr('需要先连接 Hermes 引擎', 'Connect Hermes first')}</span>
                    <button
                      type="button"
                      onClick={() => setHermesModalOpen(true, 'overview')}
                      className="font-semibold underline whitespace-nowrap cursor-pointer"
                    >
                      {tr('去连接', 'Connect')}
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
                        .catch((err) => setError(err instanceof Error ? err.message : tr('停止失败，请重试', 'Failed to stop; please try again')))
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100 whitespace-nowrap cursor-pointer transition"
                  >
                    <Square size={11} />
                    {tr('停止', 'Stop')}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!canStartGeneration}
                    onClick={() => void start(tab)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-2xs hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap cursor-pointer transition"
                  >
                    <Sparkles size={12} />
                    {result?.status === 'done' ? tr('重新生成', 'Regenerate') : actionDetails[tab].startLabel}
                  </button>
                )}
              </div>
            </div>

            {modelError && (
              <p role="alert" className="mt-1 text-[11px] text-rose-600">
                {tr(`模型加载失败：${td(modelError)}。可点击刷新重试。`, `Failed to load models: ${td(modelError)}. Click refresh to retry.`)}
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
