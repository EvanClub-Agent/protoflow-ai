import { ProjectAcceptanceReview } from './ProjectAcceptanceReview';
import { MindmapPicker, MindmapAttachmentCard } from './ProjectChatMindmaps';
import { mindmapPath } from '../proto/mindmaps';
import { ProjectPlanConfirmation } from './ProjectPlanConfirmation';
import { includesPlanAndSchema } from '../services/projectPlanMenus';
import { reviewPageRequirements } from '../services/projectChangeReview';
import { ChatImageThumbnail, ChatImageDraftList } from '../proto/designer/ChatImageThumbnail';
import { CHAT_IMAGE_ACCEPT, MAX_CHAT_IMAGES, readChatImageFiles } from '../services/chatImages';
import { ProjectChatHistory } from './ProjectChatHistory';
import { cachedProjectChatIndex, projectChatScope, type ProjectChatIndex } from '../services/projectChatHistory';
import { canUndoProjectChange, undoProjectChange } from '../services/hermesProject';
import { failureNeedsArchiveRestart } from '../services/projectPlan';
import { flushProjectChanges } from '../services/projectStorage';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Send,
  ImagePlus,
  Network,
  Square,
  FolderTree,
  Sparkles,
  CheckCircle2,
  Clock,
  FileText,
  Folder,
  Copy,
  Check,
  Loader2,
  ArrowUpRight,
  Layers,
  Wand2,
  SlidersHorizontal,
  MessageCircleQuestion,
  PenLine,
  RotateCcw,
  AlertTriangle,
  X,
} from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { useAiChatStore, type AiChatMessage, type ProjectDraft } from '../store/useAiChatStore';
import { useHermesStore } from '../store/useHermesStore';
import { useAiPreviewStore } from '../store/useAiPreviewStore';
import { AiStreamingPreview } from '../proto/designer/AiStreamingPreview';
import { conversationKey, type HermesProjectConversation } from '../services/hermesConversation';
import { axureCatalog, applyRpTaskDraft, clearRpTaskDraft, resolveSubmittedRpMigration, axureScopeFocus, type AxureScope } from '../proto/axure/task';
import { formatRpReviewArgs } from '../proto/axure/reviewSource';
import { ProjectContextPanel, type ProjectContextFocus } from './ProjectContextPanel';
import { discussProject, generateProject, projectPlanProgress, resolveProjectReview, resumePriorPlan, useProjectWorkflow } from '../services/projectWorkflow';
import { HermesSessionControls } from './HermesSessionControls';
import { HermesQuestionHost } from './HermesQuestionCard';
import { RequirementAuditPanel } from './RequirementAuditPanel';
import { ChatMarkdown } from './ChatMarkdown';
import { useI18n } from '../i18n';

const EMPTY: AiChatMessage[] = [];

function getStarterTemplates(tr: (zh: string, en: string) => string) {
  return [
    {
      title: tr('采购与供应商协同系统', 'Procurement & Supplier Collaboration'),
      tag: tr('SRM · 供应链', 'SRM · Supply Chain'),
      prompt: tr(
        '我们需要一套采购与供应商协同管理系统，包含供应商准入审核、采购申请与询比价、合同归档、到货验收及发票付款登记。核心角色有采购员、采购主管、财务审核员。请帮我规划目录与各页面详细原型方案。',
        'We need a procurement and supplier collaboration system covering supplier onboarding review, purchase requests & RFQ comparison, contract archiving, arrival acceptance, and invoice/payment registration. Core roles are Buyer, Procurement Manager, and Finance Reviewer. Please plan the menu tree and detailed page prototypes.'
      ),
    },
    {
      title: tr('了解已有页面怎样协作', 'Understand How Existing Pages Work Together'),
      tag: tr('查现状', 'Inspect Current Project'),
      prompt: tr(
        '帮我看看当前项目里，哪些页面共用一张表？从其中一个页面举例说明操作会影响哪里。先解释即可。',
        'Show me which pages share a database table in this project, and use one page as an example to explain how actions affect downstream pages. Explanation only for now.'
      ),
    },
    {
      title: tr('整理重复的菜单', 'Consolidate Overlapping Menus'),
      tag: tr('改现有项目', 'Refine Existing Project'),
      prompt: tr(
        '帮我检查现有菜单的职责有没有重叠。如果有，指出具体页面和依据，先让我选择要调整哪一组。',
        'Check whether any existing menus have overlapping responsibilities. Point out specific pages and evidence, and let me choose which group to adjust first.'
      ),
    },
  ];
}

const emptyDraft: ProjectDraft = { text: '', images: [], mindmapIds: [] };

export function ProjectAiView({ projectId }: { projectId: string }) {
  const { tr, td } = useI18n();
  const index = useAiChatStore(s => cachedProjectChatIndex(s.projectIndexes, projectId));
  const [loadError,setLoadError] = useState('');
  useEffect(() => {
    try { useAiChatStore.getState().loadProjectIndex(projectId); }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : String(cause)); }
  },[projectId]);
  if (!index) return <p className="p-4 text-sm" role="status">{loadError ? td(loadError) : tr('正在读取项目对话…', 'Loading project chat…')}</p>;
  const scope = projectChatScope(projectId,index.activeId);
  return <ProjectChatPane key={conversationKey(scope)} scope={scope} index={index}/>;
}

function ProjectChatPane({scope,index}: {
  scope: HermesProjectConversation; index: ProjectChatIndex;
}) {
  const { locale, tr, td } = useI18n();
  const {projectId} = scope;
  const key = conversationKey(scope);
  const messages = useAiChatStore(s => s.byConversation[key] ?? EMPTY);
  const storageError = useAiChatStore(s => s.storageErrors[key]);
  const plan = useProtoStore(s => s.projectPlan);
  const designerPages = usePageStore(s => s.designerPages);
  const pageSources = usePageStore(s => s.pageSources);
  const runningKey = useProjectWorkflow(s => s.runningChat[projectId]);
  const running = runningKey === key;
  const backgroundChat = runningKey && !running
    ? index.entries.find(entry => conversationKey(projectChatScope(projectId, entry.id)) === runningKey)
    : undefined;
  const projectBusy = useProjectWorkflow(s => s.running[projectId]);
  const status = useProjectWorkflow(s => s.status[key]);
  const toolProgress = useHermesStore(s => running ? s.progress[key] : undefined);
  const hasPreview = useAiPreviewStore(s => Boolean(s.runs[key]?.latestPageId));
  const [inspectorTab, setInspectorTab] = useState<'plan' | 'preview'>('preview');
  const previewActive = hasPreview && inspectorTab === 'preview';
  useEffect(() => { if (hasPreview) setInspectorTab('preview'); }, [hasPreview]);
  const hermesStatus = useHermesStore(s => s.status);
  const currentVersion = useHermesStore(s => s.currentVersion);
  const setModalOpen = useHermesStore(s => s.setModalOpen);
  const hasNativeQuestion = useHermesStore(s =>
    s.questions.some(q => q.kind === 'project' && conversationKey(q) === key)
  );
  const connected = hermesStatus === 'running';
  const otherRunning = useHermesStore(s => s.runningProjects[projectId]);
  const draft = useAiChatStore(s => s.projectDrafts.get(key) ?? emptyDraft);
  const setDrafts = useAiChatStore(s => s.setProjectDrafts);
  const {text: prompt, images, mindmapIds} = draft;
  const workspace = useProtoStore(s => s.mindmaps);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [contextFocus, setContextFocus] = useState<ProjectContextFocus>({});
  const activePageId = useProtoStore(s => s.activePageId);
  const designerFolders = usePageStore(s => s.designerFolders);
  const sitemapOverrides = usePageStore(s => s.sitemapOverrides);
  const sitemapBase = usePageStore(s => s.sitemapBase);
  const catalog = useMemo(() => axureCatalog({designerPages,designerFolders,sitemapOverrides,sitemapBase,pageSources}),
    [designerPages,designerFolders,sitemapOverrides,sitemapBase,pageSources]);
  const [focusChosen,setFocusChosen] = useState(false);
  const selectFocus = (focus:ProjectContextFocus) => { setFocusChosen(true); setContextFocus(focus); };
  const effectiveFocus = draft.rpTask ? axureScopeFocus(draft.rpTask.scope) : contextFocus;
  const rpScopeId = effectiveFocus.pageId ? 'page:' + effectiveFocus.pageId : effectiveFocus.folderId ? 'folder:' + effectiveFocus.folderId
    : !draft.rpTask && !focusChosen && catalog.pages.some(p=>p.pageId === activePageId) ? 'page:' + activePageId : 'project';
  const rpOptions = useMemo(() => [
    {value:'project',label:tr(`全工程（${catalog.pages.length} 页）`, `Full project (${catalog.pages.length} pages)`),scope:{kind:'project'} as AxureScope},
    ...catalog.folders.map(f=>({value:'folder:'+f.folderId,label:tr(`${f.path}（${f.pageCount} 页）`, `${f.path} (${f.pageCount} pages)`),scope:{kind:'folder',folderId:f.folderId} as AxureScope})),
    ...catalog.pages.map(p=>({value:'page:'+p.pageId,label:p.path,scope:{kind:'page',pageId:p.pageId} as AxureScope})),
  ],[catalog, locale, tr]);
  const starterTemplates = useMemo(() => getStarterTemplates(tr), [locale, tr]);
  const rpSelection = rpOptions.find(option=>option.value === rpScopeId);
  const rpScopeControlId = useId();
  const updateDraft = (change: (current: ProjectDraft) => ProjectDraft) => setDrafts(previous =>
    new Map(previous).set(key, change(previous.get(key) ?? emptyDraft)));
  const setPrompt = (text: string) => updateDraft(current => ({ ...current, text }));
  const [preparing, setPreparing] = useState(false);
  const reading = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState('');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // Answers for the structured project questions attached to the current reply.
  const [activeQuestionIdx, setActiveQuestionIdx] = useState(0);
  const [bubbleSelections, setBubbleSelections] = useState<Record<string, string[]>>({});
  const [bubbleCustomInputs, setBubbleCustomInputs] = useState<Record<string, string>>({});
  const [dismissedMsgId, setDismissedMsgId] = useState<string | null>(null);
  const [reopenedQuestionId, setReopenedQuestionId] = useState<string | null>(null);

  const list = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function prepareRpTask(readOnly:boolean, selection = rpSelection) {
    if (!selection) return;
    const {scope:target,label} = selection;
    selectFocus(axureScopeFocus(target));
    updateDraft(current => applyRpTaskDraft(current, target, label, readOnly));
    textareaRef.current?.focus();
  }
  function changeContext(focus:ProjectContextFocus) {
    if (draft.rpTask) {
      const id = focus.pageId ? 'page:' + focus.pageId : focus.folderId ? 'folder:' + focus.folderId : 'project';
      const selected = rpOptions.find(option => option.value === id);
      if (selected) { prepareRpTask(draft.rpTask.readOnly,selected); return; }
      updateDraft(clearRpTaskDraft);
    }
    selectFocus(focus);
  }
  useEffect(() => {
    useAiChatStore.getState().switchConversation(scope);
  }, [key]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length, messages[messages.length - 1]?.text]);

  const lastMessage = messages[messages.length - 1];
  const replyError = lastMessage?.status === 'error' ? lastMessage.text : undefined;
  const composerError = (error !== replyError && error) || storageError;
  const combinedProposal = lastMessage?.projectChangeReview && includesPlanAndSchema(lastMessage.projectChangeReview.operations);
  const previousMessage = messages.at(-2);
  const failedQuestions = useMemo(() => {
    if (lastMessage?.status !== 'error' || previousMessage?.role !== 'user') return;
    // Old chats stored the submitted answers as numbered text. Only offer
    // recovery when that reply actually identifies the preceding question set.
    for (let i = messages.length - 3; i >= 0; i--) {
      const message = messages[i];
      if (message.projectQuestions) {
        if (
          message.projectQuestions.some(
            (q, n) =>
              previousMessage.text.startsWith(`${n + 1}. 针对「${q.question}」：`) ||
              previousMessage.text.startsWith(`${n + 1}. Regarding "${q.question}": `)
          )
        )
          return message;
        return;
      }
      if (message.role === 'assistant' && message.status === 'done') return;
    }
  }, [messages, lastMessage, previousMessage]);
  const questionMessage = lastMessage?.projectQuestions ? lastMessage
    : failedQuestions?.id === reopenedQuestionId ? failedQuestions : undefined;
  const parsedQuestions = useMemo(() => {
    if (!questionMessage || questionMessage.id === dismissedMsgId) return [];
    return questionMessage.projectQuestions?.map((question, index) => ({ ...question, id: String(index) })) ?? [];
  }, [questionMessage, dismissedMsgId]);

  useEffect(() => {
    if (lastMessage?.projectQuestions) {
      setActiveQuestionIdx(0);
      setBubbleSelections({});
      setBubbleCustomInputs({});
    }
  }, [lastMessage?.id, lastMessage?.projectQuestions]);

  const reopenFailedQuestions = () => {
    if (!failedQuestions?.projectQuestions || !previousMessage) return;
    if (!Object.keys(bubbleSelections).length && !Object.keys(bubbleCustomInputs).length) {
      // Restore only verbatim choices in older transcripts. Never infer a
      // selection from the AI's suggested defaults or free-form user text.
      const lines = previousMessage.text.split('\n');
      const selections: Record<string, string[]> = {};
      failedQuestions.projectQuestions.forEach((question, index) => {
        const choice = question.options.find(
          option =>
            lines.includes(`${index + 1}. 针对「${question.question}」：${option}`) ||
            lines.includes(`${index + 1}. Regarding "${question.question}": ${option}`)
        );
        if (choice !== undefined) selections[String(index)] = [choice];
      });
      setBubbleSelections(selections);
      const firstMissing = failedQuestions.projectQuestions.findIndex((_, i) => !selections[String(i)]);
      setActiveQuestionIdx(firstMissing < 0 ? 0 : firstMissing);
    }
    setDismissedMsgId(null);
    setReopenedQuestionId(failedQuestions.id);
  };

  const completed = projectPlanProgress();
  const busy = Boolean(projectBusy || otherRunning);

  const run = async (action: () => Promise<void>) => {
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const addImages = async (files: File[]) => {
    if (!files.length || reading.current || running) return;
    reading.current = true;
    setPreparing(true);
    setError('');
    try {
      const added = await readChatImageFiles(files, images.length);
      if (mounted.current) updateDraft(current => ({...current, images: [...current.images, ...added]}));
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      reading.current = false;
      if (mounted.current) setPreparing(false);
    }
  };
  const hasDraft = Boolean(prompt.trim() || draft.rpTask || images.length || mindmapIds.length);
  const handleSubmit = () => {
    if (busy || !connected || reading.current || !hasDraft) return;
    if (useAiChatStore.getState().projectIndexes[projectId]?.activeId !== index.activeId) return;
    const submitted = draft;
    const rpMigration = resolveSubmittedRpMigration(submitted.rpTask, questionMessage?.rpQuestionScope);
    const submitText = submitted.text.trim() || submitted.rpTask?.text || '';
    const submitFocus = rpMigration ? axureScopeFocus(rpMigration.scope) : contextFocus;
    const cleared: ProjectDraft = { text: '', images: [], mindmapIds: [] };
    updateDraft(() => cleared);
    void run(async () => {
      try { await discussProject(projectId, submitText, submitted.images, submitted.mindmapIds, submitFocus, undefined, rpMigration); }
      catch (cause) {
        // A delayed failure may restore only its own untouched draft.
        setDrafts(previous => previous.get(key) === cleared ? new Map(previous).set(key, submitted) : previous);
        throw cause;
      }
    });
  };

  const isAnswered = (id: string) => Boolean(bubbleSelections[id]?.length || bubbleCustomInputs[id]?.trim());
  const allAnswered = parsedQuestions.length > 0 && parsedQuestions.every(q => isAnswered(q.id));
  const handleBubbleQuestionsSubmit = () => {
    if (busy || !connected || !allAnswered) return;
    const lines = parsedQuestions.map((q, idx) => {
      const picked = bubbleSelections[q.id] ?? [];
      const custom = (bubbleCustomInputs[q.id] ?? '').trim();
      const ans = [...picked, ...(custom ? [tr(`其他说明：${custom}`, `Other notes: ${custom}`)] : [])].join(tr('；', '; '));
      return tr(`${idx + 1}. 针对「${q.question}」：${ans}`, `${idx + 1}. Regarding "${q.question}": ${ans}`);
    });
    setReopenedQuestionId(null);
    const target = questionMessage?.rpQuestionScope;
    void run(() => discussProject(projectId, lines.join('\n'), [], [], target ? axureScopeFocus(target) : contextFocus,
      undefined, target ? {scope:target,readOnly:false} : undefined));
  };
  const totalPages = plan?.pages.length ?? 0;
  const progressPct = totalPages > 0 ? Math.round((completed.length / totalPages) * 100) : 0;
  const revision = plan?.revision;
  const workComplete = revision ? completed.includes(revision.pageId) : completed.length === totalPages;
  const targetTitle = plan?.pages.find(page => page.pageId === revision?.pageId)?.title;
  const oldTitle = designerPages.find(page => page.pageId === revision?.merge?.sourcePageId)?.title;
  const mergeSourceTitle = oldTitle ?? revision?.merge?.sourceTitle ?? revision?.merge?.sourcePageId;
  const revisionDescription = revision?.merge
    ? tr(
        `本次只更新「${targetTitle}」，将「${mergeSourceTitle}」并入${revision.merge.presentation === 'drawer' ? '抽屉' : '弹框'}。内容与入口校验通过后，将移除旧菜单并迁移项目内关联。`,
        `Updating only "${targetTitle}" and merging "${mergeSourceTitle}" into a ${revision.merge.presentation === 'drawer' ? 'drawer' : 'dialog'}. Once verified, the old menu will be removed and project references migrated.`
      )
    : tr(`本次只更新「${targetTitle}」。`, `Updating only "${targetTitle}".`);
  const activeQ = parsedQuestions[activeQuestionIdx] ?? parsedQuestions[0];
  const recoveryHintId = useId();
  const activeFailure =
    plan?.approved &&
    !plan.discussionPending &&
    plan.lastGenerationFailure &&
    !completed.includes(plan.lastGenerationFailure.pageId) &&
    (!revision || revision.pageId === plan.lastGenerationFailure.pageId)
      ? plan.lastGenerationFailure
      : undefined;
  const failedPage = activeFailure
    ? plan?.pages.find(page => page.pageId === activeFailure.pageId)
    : undefined;
  const failedNeedsArchive = failureNeedsArchiveRestart(activeFailure);
  const remainingPageCount = !plan
    ? 0
    : revision
      ? completed.includes(revision.pageId)
        ? 0
        : 1
      : plan.pages.filter(page => !completed.includes(page.pageId)).length;
  const restartFailedAndContinue = () => {
    if (!failedPage) return;
    void run(() =>
      remainingPageCount > 1
        ? generateProject(projectId, undefined, {
            restartFromProject: true,
            restartPageId: failedPage.pageId,
          })
        : generateProject(projectId, failedPage.pageId, { restartFromProject: true }),
    );
  };
  const restartFailedPageOnly = () => {
    if (!failedPage) return;
    void run(() => generateProject(projectId, failedPage.pageId, { restartFromProject: true }));
  };

  const activeSessionTitle = index.entries.find(entry => entry.id === index.activeId)?.title || tr('新会话', 'New Chat');

  return (
    <div className="flex h-full min-h-0 bg-slate-50/50" aria-label={tr('项目 AI 工作区', 'Project AI Workspace')}>
      {/* Left Column: Requirement Discussion & Streaming Chat */}
      <section className="flex flex-col min-h-0 flex-1 min-w-0 border-r border-slate-200/80 bg-white">
        {/* Top Studio Header & Session Controls */}
        <header className="flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white/95 backdrop-blur-xs px-5 py-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-xs">
              <Bot size={17} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold text-slate-900 whitespace-nowrap">{tr('项目 AI', 'Project AI')}</span>
                <span className="hidden sm:inline-flex items-center rounded-md bg-blue-50 border border-blue-200/70 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 whitespace-nowrap">
                  {tr('项目助手', 'Project Assistant')}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 min-w-0">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                <span
                  className="max-w-64 truncate font-medium text-slate-600"
                  title={activeSessionTitle}
                >
                  {activeSessionTitle}
                </span>
              </div>
            </div>
          </div>

          {/* Right Engine Status & History Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setModalOpen(true, 'overview')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap shrink-0 ${
                connected
                  ? 'bg-emerald-50/80 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/70'
                  : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100/70'
              }`}
              title={
                connected
                  ? tr(`Hermes ${currentVersion} 运行中 · 点击管理引擎`, `Hermes ${currentVersion} running · Click to manage engine`)
                  : tr('点击连接或管理 Hermes 引擎', 'Click to connect or manage Hermes engine')
              }
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span>{connected ? `Hermes ${currentVersion || tr('就绪', 'Ready')}` : tr('连接 Hermes', 'Connect Hermes')}</span>
            </button>
            <ProjectChatHistory index={index} />
          </div>
        </header>

        {/* Scrollable Discussion Stream */}
        <div
          ref={list}
          className="flex-1 min-h-0 overflow-y-auto bg-slate-50/40 px-4 sm:px-6 py-5 space-y-4"
        >
          {!messages.length ? (
            <div className="py-6 max-w-2xl mx-auto space-y-6">
              {/* Hero Welcome Card */}
              <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs space-y-4">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-sm">
                    <Sparkles size={20} />
                  </div>
                  <div className="space-y-1.5 min-w-0">
                    <h2 className="text-lg font-bold text-slate-900 break-words">
                      {tr('想了解或调整项目的哪一部分？', 'Which part of the project would you like to explore or refine?')}
                    </h2>
                    <p className="text-sm text-slate-500 leading-relaxed [text-wrap:pretty] break-words">
                      {tr(
                        '可以问某个按钮会打开哪里、把几个菜单移到同一目录，也可以给出完整需求，让 AI 规划并生成整套原型。',
                        'Ask where a button navigates, group menus into a folder, or describe full requirements for AI to plan and generate an entire prototype.'
                      )}
                    </p>
                  </div>
                </div>

                {/* 3-Step Capability Highlights */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  <div className="rounded-xl bg-slate-50/90 border border-slate-200/60 p-3 space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                      <SlidersHorizontal size={13} className="text-blue-600 shrink-0" />
                      <span className="truncate">{tr('讨论需求', 'Clarify Requirements')}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed break-words">
                      {tr(
                        '在输入框上方弹出交互气泡，直接勾选推荐选项或在气泡内补充其他选项。',
                        'Interactive question cards appear above the input so you can pick options or add custom notes.'
                      )}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50/90 border border-slate-200/60 p-3 space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                      <Layers size={13} className="text-indigo-600 shrink-0" />
                      <span className="truncate">{tr('调整目录和页面', 'Shape Menus & Pages')}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed break-words">
                      {tr(
                        '在右侧实时沉淀多级菜单目录与每页详细功能要求，随时可调。',
                        'Review and refine the multi-level menu structure and per-page specs in the right panel.'
                      )}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50/90 border border-slate-200/60 p-3 space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                      <Wand2 size={13} className="text-violet-600 shrink-0" />
                      <span className="truncate">{tr('按方案生成', 'Generate from Plan')}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed break-words">
                      {tr(
                        '确认方案后按清单顺序生成高保真页面原型，支持断点续生与一键预览。',
                        'Once confirmed, generate high-fidelity page prototypes in order with resume and live preview.'
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Starter Scenario Templates */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="text-xs font-semibold text-slate-500">
                    {tr('可以这样开始', 'Quick Start Prompts')}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {tr('填入后可继续编辑再发送', 'Insert into input and edit before sending')}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {starterTemplates.map(tpl => (
                    <button
                      key={tpl.title}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        updateDraft(current => ({ ...current, text: tpl.prompt, rpTask: undefined }));
                        textareaRef.current?.focus();
                      }}
                      className="group min-w-0 text-left rounded-2xl border border-slate-200/90 bg-white p-3.5 hover:border-blue-400 hover:bg-blue-50/30 transition shadow-2xs flex flex-col justify-between gap-2.5 cursor-pointer disabled:opacity-50"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <span className="inline-flex max-w-full items-center rounded-md bg-slate-100 group-hover:bg-blue-100/80 px-2 py-0.5 text-[10px] font-semibold text-slate-600 group-hover:text-blue-700 transition truncate">
                          {tpl.tag}
                        </span>
                        <div className="text-xs font-bold text-slate-900 group-hover:text-blue-700 transition break-words">
                          {tpl.title}
                        </div>
                        <p className="text-[11px] text-slate-500 line-clamp-3 leading-relaxed break-words">
                          {tpl.prompt}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] font-medium text-blue-600">
                        <span>{tr('填入需求框', 'Use Prompt')}</span>
                        <ArrowUpRight size={12} className="shrink-0 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map(m =>
                m.role === 'user' ? (
                  <article key={m.id} className="flex flex-col items-end gap-1 group">
                    <div className="flex items-center gap-2 px-1 text-[11px] text-slate-400">
                      <span className="font-medium text-slate-500">{tr('你', 'You')}</span>
                      {m.time && <span className="tabular-nums">{m.time}</span>}
                    </div>
                    <div className="max-w-[85%] rounded-2xl rounded-tr-xs bg-blue-600 px-4 py-3 text-sm text-white shadow-xs">
                      <ChatMarkdown content={m.text} tone="user" />
                      {!!m.images?.length && <div className="mt-2 flex flex-wrap gap-2">
                        {m.images.map(image => <div key={image.id} className="w-24"><ChatImageThumbnail name={image.name} attachment={image}/></div>)}
                      </div>}
                      {!!m.mindmaps?.length && <div aria-label={tr('本条消息的脑图', 'Mindmaps in this message')} className="mt-2 flex flex-wrap gap-2">
                        {m.mindmaps.map(map => <MindmapAttachmentCard key={map.mindmapId} map={map}/>)}
                      </div>}
                    </div>
                  </article>
                ) : (
                  <article key={m.id} className="space-y-1.5 min-w-0 group">
                    <div className="flex items-center justify-between gap-2 px-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-2xs">
                          <Sparkles className="w-3 h-3" />
                        </span>
                        <span className="text-xs font-semibold text-slate-800 whitespace-nowrap">{tr('项目 AI', 'Project AI')}</span>
                        {m.engineBadge && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono bg-slate-100 border border-slate-200/80 text-slate-500 truncate max-w-[160px]">
                            <Bot className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                            <span className="truncate">{m.engineBadge}</span>
                          </span>
                        )}
                      </div>
                      {m.time && <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{m.time}</span>}
                    </div>

                    <div
                      className={`rounded-2xl rounded-tl-xs border px-4 py-3 text-sm shadow-2xs transition-all ${
                        m.status === 'error'
                          ? 'bg-rose-50 border-rose-200 text-rose-800'
                          : 'bg-white border-slate-200/90 text-slate-800'
                      }`}
                    >
                      <ChatMarkdown
                        content={m.status === 'error' ? td(m.text) : m.text}
                        streaming={m.status === 'pending'}
                        tone={m.status === 'error' ? 'error' : 'assistant'}
                      />
                      {!m.projectChangeReview && <RequirementAuditPanel report={m.requirementAudit} />}
                      {m.status === 'pending' && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-blue-600">
                          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                          <span role="status">{td(toolProgress || status || tr('正在处理…', 'Processing…'))}</span>
                        </div>
                      )}
                    </div>

                    {m.id === lastMessage?.id &&
                      failedPage &&
                      !busy &&
                      !activeQ &&
                      !lastMessage?.projectChangeReview &&
                      (m.status === 'error' || Boolean(composerError)) && (
                        <div className="mt-2 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 shadow-2xs space-y-2">
                          {failedNeedsArchive ? (
                            <>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={!connected}
                                  aria-describedby={recoveryHintId}
                                  onClick={restartFailedAndContinue}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition"
                                >
                                  <RotateCcw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                  <span>
                                    {remainingPageCount > 1
                                      ? tr(
                                          `保留旧草稿，重新生成「${failedPage.title}」并继续剩余页面`,
                                          `Archive draft, regenerate "${failedPage.title}" & continue remaining pages`
                                        )
                                      : tr(
                                          `保留旧草稿，重新生成「${failedPage.title}」`,
                                          `Archive draft & regenerate "${failedPage.title}"`
                                        )}
                                  </span>
                                </button>
                                {remainingPageCount > 1 && (
                                  <button
                                    type="button"
                                    disabled={!connected}
                                    onClick={restartFailedPageOnly}
                                    className="rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 cursor-pointer disabled:opacity-40 transition"
                                  >
                                    {tr(`仅重新生成「${failedPage.title}」`, `Regenerate "${failedPage.title}" only`)}
                                  </button>
                                )}
                              </div>
                              <p id={recoveryHintId} className="text-[11px] text-slate-500 leading-relaxed tabular-nums">
                                {tr(
                                  `系统会自动归档上次未完成的草稿，并按当前工程重新生成该页；已生成的 ${completed.length} 个页面和当前会话历史不会丢失。`,
                                  `Unfinished draft will be archived automatically and regenerated against the current project; ${completed.length} completed pages and chat history will be preserved.`
                                )}
                              </p>
                            </>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={!connected}
                                onClick={() =>
                                  void run(() =>
                                    remainingPageCount > 1
                                      ? generateProject(projectId)
                                      : generateProject(projectId, failedPage.pageId),
                                  )
                                }
                                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition"
                              >
                                <span>
                                  {remainingPageCount > 1
                                    ? tr('继续生成剩余页面', 'Continue Remaining Pages')
                                    : tr(`继续生成「${failedPage.title}」`, `Continue Generating "${failedPage.title}"`)}
                                </span>
                              </button>
                              <button
                                type="button"
                                disabled={!connected}
                                onClick={restartFailedPageOnly}
                                className="rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 cursor-pointer disabled:opacity-40 transition"
                              >
                                {tr(`保留旧草稿，重新生成「${failedPage.title}」`, `Archive draft & regenerate "${failedPage.title}"`)}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    {m.id === lastMessage?.id && failedQuestions && !parsedQuestions.length && (
                      <button type="button" disabled={busy} onClick={reopenFailedQuestions}
                        className="mt-1 rounded-lg border border-blue-200 px-2.5 py-1 text-xs text-blue-700">
                        {tr('继续回答上组问题', 'Resume Previous Questions')}
                      </button>
                    )}
                    {m.id === lastMessage?.id && m.projectQuestions && dismissedMsgId === m.id && (
                      <button type="button" onClick={() => setDismissedMsgId(null)} className="text-xs text-blue-700">
                        {tr('展开待答问题', 'Show Pending Questions')}
                      </button>
                    )}
                    {m.status === 'done' && m.text.trim().length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 px-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (!navigator.clipboard) return;
                            void navigator.clipboard.writeText(m.text).then(() => {
                              setCopiedMsgId(m.id);
                              setTimeout(() => setCopiedMsgId(prev => (prev === m.id ? null : prev)), 1500);
                            });
                          }}
                          className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-white border border-slate-200/90 text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center gap-1 cursor-pointer transition shadow-2xs whitespace-nowrap"
                          title={tr('复制本条回复', 'Copy reply')}
                        >
                          {copiedMsgId === m.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span className="text-emerald-600">{tr('已复制', 'Copied')}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>{tr('复制', 'Copy')}</span>
                            </>
                          )}
                        </button>
                        {m.diagnosticId && <button type="button" className="text-[11px] text-slate-500 underline whitespace-nowrap" title={m.diagnosticId}
                          onClick={() => { void navigator.clipboard?.writeText(m.diagnosticId!).catch(()=>{}); }}>{tr('复制诊断编号', 'Copy Diagnostic ID')}</button>}
                        {m.changeId && canUndoProjectChange(m.changeId) && (
                          <button
                            type="button"
                            disabled={busy}
                            className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-white border border-slate-200/90 text-slate-600 hover:text-blue-700 hover:border-blue-200 hover:bg-blue-50/60 cursor-pointer disabled:opacity-40 transition shadow-2xs whitespace-nowrap"
                            onClick={() =>
                              void run(async () => {
                                undoProjectChange(m.changeId!);
                                const undoneNote = tr('已撤销本次修改。', 'Undid this change.');
                                useAiChatStore.getState().updateMessage(m.id, {
                                  projectReviewDecision: 'undone',
                                  changeId: undefined,
                                  text: m.text + '\n\n' + undoneNote,
                                });
                                await flushProjectChanges();
                                useProjectWorkflow.setState(s => ({
                                  status: { ...s.status, [key]: undoneNote },
                                }));
                              })
                            }
                          >
                            {tr('撤销本次修改', 'Undo Change')}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                )
              )}
            </div>
          )}
        </div>

        {/* Floating Interactive Bubble Area directly above the Chat Input Box */}
        <div className="px-4 pt-2 bg-gradient-to-t from-white via-white to-transparent shrink-0">
          <div className="max-w-3xl mx-auto space-y-2">
            {/* 1. Native Clarify Question Host (Portaled HermesQuestionCard Bubble) */}
            <HermesQuestionHost scope={scope} />

            {/* Project questions submitted by the project MCP tool */}
            {!hasNativeQuestion && !busy && activeQ && (
              <section
                aria-label={tr('AI 追问快捷气泡', 'AI Clarifying Questions')}
                className="relative overflow-hidden rounded-2xl border border-blue-200/90 bg-white shadow-[0_8px_28px_-6px_rgba(37,99,235,0.16)] text-xs text-slate-700"
              >
                {/* Bubble Header & Multi-question Step Tabs */}
                <div className="flex items-center justify-between gap-2 border-b border-blue-100/80 bg-gradient-to-r from-blue-50/90 via-indigo-50/60 to-blue-50/90 px-3.5 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white shadow-2xs">
                      <MessageCircleQuestion size={13} />
                    </span>
                    <span className="font-bold text-slate-900 whitespace-nowrap">{tr('AI 待确认问题', 'Questions to Confirm')}</span>
                    <span className="hidden sm:inline-block truncate rounded bg-white/80 border border-blue-200/70 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                      {tr('直接点选或填写其他选项', 'Select options or type custom notes')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span aria-label={tr('当前题号', 'Current Question')} className="rounded bg-blue-50 px-2 py-0.5 font-semibold tabular-nums text-blue-700">
                      {activeQuestionIdx + 1}/{parsedQuestions.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => questionMessage && setDismissedMsgId(questionMessage.id)}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/70 cursor-pointer transition"
                      title={tr('收起气泡', 'Collapse')}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>

                {/* Bubble Body: Active Question + Selectable Option Chips + Inline Other Input */}
                <div className="max-h-[42vh] overflow-y-auto p-3.5 space-y-2.5">
                  <div className="font-semibold text-xs text-slate-900 whitespace-pre-wrap break-words leading-relaxed">
                    {parsedQuestions.length > 1 ? `${activeQuestionIdx + 1}. ` : ''}
                    {activeQ.question}
                  </div>

                  {/* Selectable Option Chips (auto-switches to full-width rows when options are long, never truncates) */}
                  <div
                    className={`grid grid-cols-1 gap-1.5 ${
                      activeQ.options.some(opt => opt.length > 14)
                        ? ''
                        : activeQ.options.length === 2
                          ? 'sm:grid-cols-2'
                          : 'sm:grid-cols-3'
                    }`}
                  >
                    {activeQ.options.map(opt => {
                      const picked = (bubbleSelections[activeQ.id] ?? []).includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          aria-pressed={picked}
                          onClick={() =>
                            setBubbleSelections(prev => {
                              const current = prev[activeQ.id] ?? [];
                              const next = current.includes(opt)
                                ? current.filter(item => item !== opt)
                                : [...current, opt];
                              return { ...prev, [activeQ.id]: next };
                            })
                          }
                          className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 text-left text-xs cursor-pointer transition ${
                            picked
                              ? 'border-blue-500 bg-blue-50/90 text-blue-900 font-semibold shadow-2xs'
                              : 'border-slate-200/90 bg-slate-50/50 text-slate-700 hover:border-blue-300 hover:bg-blue-50/30'
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              picked
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-slate-300 bg-white'
                            }`}
                          >
                            {picked && <Check size={10} />}
                          </span>
                          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words leading-relaxed">
                            {opt}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Inline "Other Option" Auto-growing Input inside the Bubble */}
                  <div className="flex items-start gap-2 rounded-xl border border-slate-200/90 bg-slate-50/70 focus-within:bg-white focus-within:border-blue-500 px-2.5 py-2 transition">
                    <PenLine size={13} className="mt-0.5 text-blue-600 shrink-0" />
                    <textarea
                      rows={1}
                      aria-label={tr('其他选项说明', 'Other Option Notes')}
                      value={bubbleCustomInputs[activeQ.id] ?? ''}
                      onChange={e =>
                        setBubbleCustomInputs(prev => ({ ...prev, [activeQ.id]: e.target.value }))
                      }
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          if (!isAnswered(activeQ.id)) return;
                          if (activeQuestionIdx < parsedQuestions.length - 1) {
                            setActiveQuestionIdx(i => i + 1);
                          } else {
                            handleBubbleQuestionsSubmit();
                          }
                        }
                      }}
                      placeholder={tr('其他选项：直接在此输入你的想法或补充要求…', 'Other option: type your custom requirements or notes here…')}
                      className="w-full h-auto [field-sizing:content] min-h-[1.25rem] max-h-24 resize-none bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none leading-relaxed"
                    />
                  </div>
                </div>

                {/* Bubble Footer */}
                <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-3.5 py-2">
                  <div className="flex items-center gap-1.5">
                    {parsedQuestions.length > 1 && activeQuestionIdx > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveQuestionIdx(i => i - 1)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 cursor-pointer transition whitespace-nowrap"
                      >
                        {tr('上一题', 'Previous')}
                      </button>
                    )}
                  </div>
                  {activeQuestionIdx < parsedQuestions.length - 1 ? (
                    <button
                      type="button"
                      disabled={!isAnswered(activeQ.id)}
                      onClick={() => setActiveQuestionIdx(i => i + 1)}
                      className="rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap"
                    >
                      {tr('下一题', 'Next')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!connected || busy || !allAnswered}
                      onClick={handleBubbleQuestionsSubmit}
                      className="flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs cursor-pointer disabled:opacity-40 transition whitespace-nowrap"
                    >
                      <Check size={13} />
                      <span>{tr('提交所选回答', 'Submit Answers')}</span>
                    </button>
                  )}
                </div>
              </section>
            )}

            {lastMessage?.projectChangeReview && (
              <section
                aria-label={tr('本次修改', 'Pending Changes')}
                className="relative overflow-hidden rounded-2xl border border-blue-200/90 bg-white shadow-[0_8px_28px_-6px_rgba(37,99,235,0.16)] text-xs text-slate-700"
              >
                <div className="flex items-center justify-between gap-2 border-b border-blue-100/80 bg-gradient-to-r from-blue-50/90 via-indigo-50/60 to-blue-50/90 px-3.5 py-2">
                  <strong className="font-bold text-slate-900 min-w-0 truncate">
                    {combinedProposal ? tr('确认目录、页面和数据表', 'Confirm Menus, Pages & Tables') : tr('本次修改 · 待应用', 'Pending Changes · Ready to Apply')}
                  </strong>
                  <span className="shrink-0 rounded-full bg-blue-100/90 px-2 py-0.5 text-[10px] font-semibold text-blue-800 tabular-nums whitespace-nowrap">
                    {tr(`${lastMessage.projectChangeReview.items.length} 项变更`, `${lastMessage.projectChangeReview.items.length} changes`)}
                  </span>
                </div>
                <div className="p-3.5 space-y-2.5">
                  {combinedProposal && <p>{tr('确认后会保存菜单和数据表，并逐页生成原型。要调整方案，可以继续在下方对话。', 'Confirming will save menus and tables and generate prototypes page by page. Keep chatting below to adjust the plan.')}</p>}
                  <ul className="max-h-36 overflow-y-auto list-disc pl-5 space-y-1 text-slate-700 leading-relaxed break-words">
                    {lastMessage.projectChangeReview.items.map(item => (
                      <li key={item}>{td(item)}</li>
                    ))}
                  </ul>
                  <RequirementAuditPanel report={lastMessage.requirementAudit} />
                  <details className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2">
                    <summary className="cursor-pointer text-[11px] font-medium text-slate-600 hover:text-blue-600">
                      {combinedProposal ? tr('查看每个页面要做什么', 'View per-page specifications') : tr('查看修改内容', 'View change details')}
                    </summary>
                    {combinedProposal ? <dl className="mt-2 max-h-40 space-y-2 overflow-auto">
                      {reviewPageRequirements(lastMessage.projectChangeReview).map(page => <div key={page.pageId}>
                        <dt className="font-medium text-slate-900">{page.title}</dt>
                        <dd className="whitespace-pre-wrap break-words leading-relaxed">{page.requirements}</dd>
                      </div>)}
                    </dl> : <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-slate-600">
                      {JSON.stringify(lastMessage.projectChangeReview.operations.map(op => formatRpReviewArgs(op.args)), null, 2)}
                    </pre>}
                  </details>
                  {combinedProposal && <details className="rounded-xl border border-slate-200/80 px-3 py-2">
                    <summary className="cursor-pointer text-[11px] text-slate-600">{tr('查看完整改动（含表字段和菜单关联）', 'View full operations (including table columns & menu bindings)')}</summary>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px]">
                      {JSON.stringify(lastMessage.projectChangeReview.operations, null, 2)}
                    </pre>
                  </details>}
                </div>
                <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50/60 px-3.5 py-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 cursor-pointer disabled:opacity-40 transition whitespace-nowrap"
                    onClick={() => void run(() => resolveProjectReview(projectId, lastMessage.id, false))}
                  >
                    {tr('放弃修改', 'Discard Changes')}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !!lastMessage.requirementAudit?.conflicts.length || (!!combinedProposal && (!connected || hasDraft || preparing))}
                    className="rounded-xl bg-blue-600 hover:bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs cursor-pointer disabled:opacity-40 transition whitespace-nowrap"
                    onClick={() => void run(() => resolveProjectReview(projectId, lastMessage.id, true))}
                  >
                    {combinedProposal ? tr('确认方案并生成', 'Confirm Plan & Generate') : tr('应用这些修改', 'Apply Changes')}
                  </button>
                </div>
              </section>
            )}
            {plan && !plan.approved && !plan.discussionPending && !activeQ && !lastMessage?.projectChangeReview && (
              <ProjectPlanConfirmation plan={plan} completed={completed} revisionDescription={revisionDescription}
                disabled={!connected || busy} hasDraft={hasDraft || preparing}
                onConfirm={() => void run(() => generateProject(projectId))}
                onAdjust={() => textareaRef.current?.focus()} />
            )}
          </div>
        </div>

        {/* Bottom Unified Prompt Composer */}
        <div className="border-t border-slate-200/80 bg-white px-4 py-3 shrink-0">
          <div className="max-w-3xl mx-auto space-y-2">
            {composerError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-center justify-between gap-2"
              >
                <span className="max-h-16 overflow-auto break-words min-w-0">{td(composerError)}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (status === error) useProjectWorkflow.setState(s => ({ status: { ...s.status, [key]: '' } }));
                    setError('');
                  }}
                  className="text-[11px] font-medium underline shrink-0 whitespace-nowrap"
                >
                  {tr('知道了', 'Dismiss')}
                </button>
              </div>
            )}

            {backgroundChat && (
              <div
                role="status"
                className="flex items-center justify-between gap-2 rounded-xl border border-amber-200/90 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 shadow-2xs"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Loader2 size={13} className="animate-spin shrink-0 text-amber-600" />
                  <span className="truncate font-medium">
                    {tr(
                      `「${backgroundChat.title || '新会话'}」正在执行任务`,
                      `"${backgroundChat.title || 'New Chat'}" is running a task`
                    )}
                  </span>
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-amber-300/90 bg-white hover:bg-amber-100/60 px-2.5 py-1 text-[11px] font-semibold text-amber-900 cursor-pointer transition whitespace-nowrap"
                  onClick={() =>
                    void run(async () =>
                      useAiChatStore.getState().selectProjectChat(projectId, backgroundChat.id)
                    )
                  }
                >
                  {tr('返回该会话', 'Switch to Chat')}
                </button>
              </div>
            )}

            {status && status !== error && status !== replyError && (
              <div
                role="status"
                className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-1.5 text-xs text-blue-700 flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {running && <Loader2 size={13} className="animate-spin shrink-0 text-blue-600" />}
                  <span className="truncate font-medium" title={td(toolProgress || status)}>
                    {td(status)}{toolProgress && ` · ${td(toolProgress)}`}
                  </span>
                </span>
                {running && (
                  <span className="text-[11px] text-blue-600/80 shrink-0 whitespace-nowrap">
                    {tr('可随时点击右侧停止', 'Click Stop anytime')}
                  </span>
                )}
              </div>
            )}

            <ProjectContextPanel key={key} scope={scope} busy={Boolean(projectBusy || otherRunning)} focus={effectiveFocus} onFocus={changeContext} />
            <form
              onDragOver={event => {
                if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = running || preparing ? 'none' : 'copy'; }
              }}
              onDrop={event => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault(); void addImages(Array.from(event.dataTransfer.files));
              }}
              onSubmit={e => {
                e.preventDefault();
                handleSubmit();
              }}
              className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-2.5 transition-all focus-within:bg-white focus-within:border-blue-500/80 focus-within:shadow-[0_2px_14px_-3px_rgba(37,99,235,0.14)]"
            >
              {catalog.pages.length > 0 && <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <label htmlFor={rpScopeControlId} className="whitespace-nowrap">{tr('RP 迁移范围', 'RP Migration Scope')}</label>
                <select id={rpScopeControlId} className="max-w-60 rounded border border-slate-300 bg-white px-2 py-1"
                  disabled={running || Boolean(otherRunning)} value={rpSelection?.value ?? ''}
                  onChange={event => {
                    const selected = rpOptions.find(option=>option.value === event.target.value);
                    if (!selected) return;
                    if (draft.rpTask) prepareRpTask(draft.rpTask.readOnly,selected);
                    else selectFocus(axureScopeFocus(selected.scope));
                  }}>
                  <option value="" disabled>{tr('选择导入范围', 'Select import scope')}</option>
                  <option value="project">{rpOptions[0].label}</option>
                  <optgroup label={tr('目录', 'Folders')}>{rpOptions.filter(o=>o.scope.kind === 'folder').map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
                  <optgroup label={tr('页面', 'Pages')}>{rpOptions.filter(o=>o.scope.kind === 'page').map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
                </select>
                <button type="button" className="rounded border bg-white px-2 py-1 disabled:opacity-40 whitespace-nowrap shrink-0" disabled={!rpSelection || running || Boolean(otherRunning)}
                  onClick={() => prepareRpTask(true)}>{tr('只读分析', 'Read-only Analysis')}</button>
                <button type="button" className="rounded border border-blue-200 bg-white px-2 py-1 text-blue-700 disabled:opacity-40 whitespace-nowrap shrink-0"
                  disabled={!rpSelection || running || Boolean(otherRunning)} onClick={() => prepareRpTask(false)}>{tr('转换物料并生成表结构', 'Convert Assets & Generate Schema')}</button>
              </div>}
              {draft.rpTask && <div role="status" className={`mb-2 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${draft.rpTask.readOnly ? 'border-amber-200 bg-amber-50/80 text-amber-900' : 'border-blue-200 bg-blue-50/80 text-blue-900'}`}>
                <span className="min-w-0 truncate">
                  <strong>{draft.rpTask.readOnly ? tr('RP 只读分析', 'RP Read-only Analysis') : tr('RP 转换与建表', 'RP Conversion & Schema')}</strong>
                  {' · '}
                  {rpSelection?.label ?? draft.rpTask.label ?? tr('已选范围', 'Selected scope')}
                  <span className="ml-2 opacity-75">{tr('（下方提示词可自由修改）', '(Prompt below can be edited freely)')}</span>
                </span>
                <button type="button" disabled={running || Boolean(otherRunning)} className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-black/5 disabled:opacity-40 whitespace-nowrap"
                  onClick={() => updateDraft(clearRpTaskDraft)}>
                  <X size={13} />
                  <span>{draft.rpTask.readOnly ? tr('取消只读任务', 'Cancel Read-only Task') : tr('取消转换任务', 'Cancel Conversion Task')}</span>
                </button>
              </div>}
              {!!mindmapIds.length && <ul aria-label={tr('待发送脑图', 'Attached Mindmaps')} className="mb-2 flex flex-wrap gap-1.5">
                {mindmapIds.map(id => {
                  const node = workspace.nodes.find(item => item.kind === 'mindmap' && item.id === id);
                  const path = node ? mindmapPath(workspace, id) : tr('脑图已移除', 'Mindmap removed');
                  return <li key={id} className="inline-flex max-w-full items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-800 min-w-0">
                    <Network size={13} className="shrink-0"/><span className="truncate" title={path}>{path}</span>
                    <button type="button" disabled={running} aria-label={tr(`移除脑图：${path}`, `Remove mindmap: ${path}`)} className="shrink-0"
                      onClick={() => updateDraft(current => ({...current, mindmapIds:current.mindmapIds.filter(item => item !== id)}))}><X size={13}/></button>
                  </li>;
                })}
              </ul>}
              <ChatImageDraftList images={images} disabled={running || preparing}
                onRemove={index => updateDraft(current => ({...current, images: current.images.filter((_, i) => i !== index)}))} />
              <textarea
                ref={textareaRef}
                onPaste={event => {
                  const files = Array.from(event.clipboardData.files);
                  if (files.length) { event.preventDefault(); void addImages(files); }
                }}
                aria-label={tr('项目需求', 'Project Requirements')}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                disabled={running}
                rows={2}
                placeholder={
                  plan && !plan.approved
                    ? tr('想改哪一页？描述你的修改，或粘贴参考图…', 'Which page would you like to change? Describe adjustments or paste reference images…')
                    : tr('描述需求，或粘贴参考图…（Enter 发送，Shift + Enter 换行）', 'Describe requirements or paste reference images… (Enter to send, Shift + Enter for newline)')
                }
                className="w-full rounded-lg bg-transparent px-1.5 py-1 text-sm text-slate-800 placeholder:text-slate-400 resize-y min-h-[3.25rem] max-h-40 focus:outline-none disabled:opacity-50 leading-relaxed"
              />
              <div className="mt-1.5 pt-1.5 border-t border-slate-200/60 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <HermesSessionControls scope={scope} showReasoning />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => setPickerOpen(true)} disabled={running} aria-haspopup="dialog"
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0">
                    <Network size={15}/>{tr('选择脑图', 'Mindmaps')}
                  </button>
                  <input ref={fileInput} type="file" multiple accept={CHAT_IMAGE_ACCEPT} className="hidden" aria-label={tr('选择项目参考图片', 'Select project reference images')}
                    onChange={e => { const files = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; void addImages(files); }} />
                  <button type="button" onClick={() => fileInput.current?.click()} disabled={running || preparing || images.length >= MAX_CHAT_IMAGES}
                    title={tr('选择、粘贴或拖入 PNG、JPG、WebP 图片，每条最多 4 张，单张不超过 5 MB', 'Select, paste, or drop PNG/JPG/WebP images (up to 4 per message, max 5 MB each)')}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0">
                    <ImagePlus size={15}/>{preparing ? tr('读取中…', 'Reading…') : tr('添加图片', 'Images')}
                  </button>
                  {running ? (
                    <button
                      type="button"
                      onClick={() => void run(() => useHermesStore.getState().stop(scope))}
                      className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-600 cursor-pointer transition whitespace-nowrap shrink-0"
                    >
                      <Square size={12} />
                      {tr('停止', 'Stop')}
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!connected || busy || preparing || !hasDraft}
                      className="flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition whitespace-nowrap shrink-0"
                    >
                      <Send size={12} />
                      {tr('发送', 'Send')}
                    </button>
                  )}
                </div>
              </div>
            </form>
            {pickerOpen && <MindmapPicker selected={mindmapIds} onClose={() => setPickerOpen(false)}
              onApply={ids => updateDraft(current => ({ ...current, mindmapIds: ids }))} />}
          </div>
        </div>
      </section>

      {/* Right Column: Project Blueprint & Sitemap Inspector */}
      <aside
        className={`${previewActive ? 'w-[55%] min-w-[420px]' : 'w-[360px] xl:w-[400px]'} shrink-0 flex flex-col min-h-0 bg-slate-50/80`}
        aria-label={tr('项目方案与生成预览', 'Project Plan & Live Preview')}
      >
        {hasPreview && <div className="flex gap-2 border-b border-slate-200 bg-white px-4 py-2" role="tablist" aria-label={tr('项目工作区侧栏', 'Project Workspace Sidebar')}>
          <button type="button" role="tab" aria-selected={!previewActive} onClick={() => setInspectorTab('plan')}
            className={`rounded-md px-3 py-1.5 text-xs whitespace-nowrap ${!previewActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600'}`}>{tr('目录与方案', 'Menus & Plan')}</button>
          <button type="button" role="tab" aria-selected={previewActive} onClick={() => setInspectorTab('preview')}
            className={`rounded-md px-3 py-1.5 text-xs whitespace-nowrap ${previewActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600'}`}>{tr('实时预览', 'Live Preview')}</button>
        </div>}
        {previewActive && <div className="flex-1 min-h-0 overflow-auto p-4" role="tabpanel" aria-label={tr('项目实时预览', 'Project Live Preview')}>
          <AiStreamingPreview key={key} {...scope} />
        </div>}
        <div className={previewActive ? 'hidden' : 'flex flex-1 min-h-0 flex-col'} aria-label={tr('项目生成方案', 'Project Generation Plan')}>
        {/* Inspector Header */}
        <div className="px-4 py-3 border-b border-slate-200/80 bg-white flex items-center justify-between gap-2 shrink-0">
          <h2 className="flex items-center gap-2 font-bold text-sm text-slate-900 min-w-0">
            <FolderTree size={16} className="text-blue-600 shrink-0" />
            <span className="truncate">{tr('目录与页面方案', 'Menus & Page Blueprint')}</span>
          </h2>
          {plan ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums whitespace-nowrap shrink-0 ${
                plan.approved
                  ? completed.length === plan.pages.length && plan.pages.length > 0
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                    : 'bg-blue-50 text-blue-700 border border-blue-200/80'
                  : 'bg-amber-50 text-amber-700 border border-amber-200/80'
              }`}
            >
              {plan.discussionPending ? tr('原方案已暂停', 'Plan Paused') : plan.approved
                ? tr(`${completed.length}/${plan.pages.length} 页`, `${completed.length}/${plan.pages.length} pages`)
                : tr('待确认方案', 'Pending Confirmation')}
            </span>
          ) : (
            <span className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">{tr('实时同步', 'Live Sync')}</span>
          )}
        </div>

        {/* Inspector Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {!plan ? (
            <div className="rounded-2xl border border-dashed border-slate-300/90 bg-white/80 p-5 text-center space-y-3">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <FolderTree size={18} />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-800">{tr('暂无项目生成方案', 'No Generation Plan Yet')}</div>
                <p className="text-xs text-slate-500 leading-relaxed break-words">
                  {tr(
                    '需要按方案生成时，目录和页面清单会出现在这里。日常提问和局部调整可以直接在对话中完成。',
                    'When generating from a blueprint, the menu tree and page checklist appear here. Everyday Q&A and small tweaks can be done directly in chat.'
                  )}
                </p>
              </div>
              <div className="pt-2 text-left space-y-2 border-t border-slate-100">
                <div className="text-[11px] font-medium text-slate-400">{tr('方案将包含：', 'Blueprint includes:')}</div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                  <span>{tr('项目整体定位与业务概览', 'Project positioning & business overview')}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                  <span>{tr('多级菜单目录树结构', 'Multi-level menu tree structure')}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                  <span>{tr('每页核心功能、筛选与交互清单', 'Per-page features, filters & interaction specs')}</span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <ProjectAcceptanceReview plan={plan} />
              {/* Summary & Progress Overview Card */}
              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs space-y-3">
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {tr('项目方案概述', 'Blueprint Summary')}
                  </div>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
                    {plan.summary}
                  </p>
                </div>

                {/* Progress Bar & Status Line */}
                <div className="pt-2 border-t border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-medium min-w-0 break-words tabular-nums">
                      {plan.approved
                        ? tr(
                            `已生成 ${completed.length} / ${plan.pages.length} 页，交互待验收`,
                            `Generated ${completed.length} / ${plan.pages.length} pages · Ready for review`
                          )
                        : tr(
                            '待确认；确认将创建目录及页面，并按清单生成。已有同 ID 页面会按方案更新。',
                            'Pending confirmation; confirming creates folders & pages and generates in order. Existing pages with matching IDs will be updated.'
                          )}
                    </span>
                    {plan.approved && (
                      <span className="font-mono text-[11px] font-semibold text-blue-600 tabular-nums shrink-0 ml-2">
                        {progressPct}%
                      </span>
                    )}
                  </div>
                  {plan.approved && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-600 to-emerald-500 transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Folders Structure Card */}
              {plan.folders.length > 0 && (
                <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5 min-w-0">
                      <Folder size={13} className="text-amber-500 shrink-0" />
                      <span className="truncate">{tr('菜单目录结构', 'Menu Structure')}</span>
                    </span>
                    <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{tr(`${plan.folders.length} 个目录`, `${plan.folders.length} folders`)}</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {plan.folders.map(f => {
                      const parentTitle =
                        f.parentFolderId !== null
                          ? plan.folders.find(p => p.id === f.parentFolderId)?.title ?? f.parentFolderId
                          : null;
                      const pageCount = plan.pages.filter(p => p.folderId === f.id).length;
                      return (
                        <div
                          key={f.id}
                          className="flex items-center justify-between gap-2 rounded-xl bg-slate-50/90 border border-slate-200/60 px-2.5 py-1.5 text-slate-700"
                        >
                          <div className="min-w-0 truncate">
                            <span className="font-medium">📁 {f.title}</span>
                            {parentTitle !== null && (
                              <span className="text-slate-400 text-[11px]">{tr(` · 上级 ${parentTitle}`, ` · Parent: ${parentTitle}`)}</span>
                            )}
                          </div>
                          <span className="shrink-0 rounded-md bg-white border border-slate-200/70 px-1.5 py-0.5 text-[10px] text-slate-500 tabular-nums whitespace-nowrap">
                            {tr(`${pageCount} 页`, `${pageCount} pages`)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Page Blueprint Cards */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5 min-w-0">
                    <FileText size={13} className="text-blue-600 shrink-0" />
                    <span className="truncate">{tr('页面清单与需求', 'Pages & Requirements')}</span>
                  </span>
                  <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{tr(`${plan.pages.length} 个页面`, `${plan.pages.length} pages`)}</span>
                </div>

                <ol className="space-y-2.5">
                  {plan.pages.map((page, index) => {
                    const isDone = completed.includes(page.pageId);
                    const isFailedPage = activeFailure?.pageId === page.pageId;
                    const hasSource = Object.hasOwn(pageSources, page.pageId);
                    const folderName =
                      page.folderId !== null
                        ? plan.folders.find(f => f.id === page.folderId)?.title ?? null
                        : null;
                    return (
                      <li
                        key={page.pageId}
                        className={`rounded-2xl border p-3.5 transition shadow-2xs ${
                          isDone
                            ? 'border-emerald-200/90 bg-white'
                            : isFailedPage
                              ? 'border-amber-300/90 bg-amber-50/20'
                              : 'border-slate-200/90 bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-bold text-slate-600 tabular-nums">
                                {String(index + 1).padStart(2, '0')}
                              </span>
                              <span className="font-semibold text-sm text-slate-900 truncate">
                                {page.title}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 pl-6">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                                {page.pageId}
                              </span>
                              {page.platform && (
                                <span className="text-[11px] text-slate-600">
                                  {page.platform === 'mobile' ? tr('移动端', 'Mobile') : tr('PC 管理端', 'Desktop Admin')}
                                </span>
                              )}
                              {folderName && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 truncate max-w-[160px]">
                                  {folderName}
                                </span>
                              )}
                            </div>
                          </div>

                          <span
                            className={`inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                              isDone
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                                : isFailedPage
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200/80'
                                  : 'bg-slate-100 text-slate-500 border border-slate-200/70'
                            }`}
                          >
                            {isDone ? (
                              <CheckCircle2 size={11} className="text-emerald-600 shrink-0" aria-hidden="true" />
                            ) : isFailedPage ? (
                              <AlertTriangle size={11} className="text-amber-600 shrink-0" aria-hidden="true" />
                            ) : (
                              <Clock size={11} className="text-slate-400 shrink-0" aria-hidden="true" />
                            )}
                            <span>
                              {isDone
                                ? tr('已生成', 'Generated')
                                : revision && page.pageId !== revision.pageId
                                  ? tr('本轮未涉及', 'Unchanged')
                                  : isFailedPage
                                    ? tr('上次中断', 'Interrupted')
                                    : tr('待生成', 'Pending')}
                            </span>
                          </span>
                        </div>

                        <p className="mt-2.5 text-xs whitespace-pre-wrap break-words text-slate-600 leading-relaxed bg-slate-50/80 rounded-xl p-2.5 border border-slate-100">
                          {page.requirements}
                        </p>

                        {plan.approved && !plan.discussionPending && !isDone && !busy && (!revision || page.pageId === revision.pageId) && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {isFailedPage && failedNeedsArchive ? (
                              <>
                                <button
                                  type="button"
                                  disabled={!connected || !!activeQ}
                                  onClick={() => void run(() => generateProject(projectId, page.pageId, { restartFromProject: true }))}
                                  className="rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100/70 px-2.5 py-1 text-xs font-medium text-blue-700 cursor-pointer disabled:opacity-40 transition"
                                >
                                  {tr('保留旧草稿，重新生成', 'Archive draft & regenerate')}
                                </button>
                                {remainingPageCount > 1 && (
                                  <button
                                    type="button"
                                    disabled={!connected || !!activeQ}
                                    onClick={restartFailedAndContinue}
                                    className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-2.5 py-1 text-xs text-slate-700 cursor-pointer disabled:opacity-40 transition"
                                  >
                                    {tr('重新生成并继续剩余页面', 'Regenerate & continue remaining')}
                                  </button>
                                )}
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={!connected || !!activeQ}
                                  onClick={() => void run(() => generateProject(projectId, page.pageId))}
                                  className="rounded-lg border border-blue-200 px-2.5 py-1 text-xs text-blue-700 cursor-pointer disabled:opacity-40"
                                >
                                  {isFailedPage ? tr('继续此页', 'Resume Page') : tr('仅生成此页', 'Generate This Page')}
                                </button>
                                {isFailedPage && (
                                  <button
                                    type="button"
                                    disabled={!connected || !!activeQ}
                                    onClick={() => void run(() => generateProject(projectId, page.pageId, { restartFromProject: true }))}
                                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 cursor-pointer disabled:opacity-40"
                                  >
                                    {tr('保留旧草稿，重新生成', 'Archive draft & regenerate')}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                        {hasSource && (
                          <div className="mt-2.5 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                useProtoStore.getState().setActivePage(page.pageId);
                                useProtoStore.getState().setViewMode('single_page');
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-blue-200/90 bg-blue-50/70 hover:bg-blue-100/80 px-2.5 py-1 text-xs font-medium text-blue-700 cursor-pointer transition whitespace-nowrap"
                            >
                              <span>{tr('预览页面', 'Preview Page')}</span>
                              <ArrowUpRight size={12} />
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </>
          )}
        </div>

        {revision && !workComplete && <p className="px-4 py-2 text-xs text-blue-800 bg-blue-50 break-words">{revisionDescription}</p>}
        {/* Sticky Inspector Footer CTA */}
        {plan && (plan.approved || plan.discussionPending) && (
          <div className="border-t border-slate-200/80 bg-white p-3.5 space-y-2 shrink-0">
            {failedPage && failedNeedsArchive && !plan.discussionPending && !(plan.approved && workComplete) && !busy && (
              <div className="rounded-lg border border-amber-200/90 bg-amber-50/80 px-2.5 py-1.5 text-[11px] text-amber-800 leading-relaxed break-words">
                {tr(
                  `「${failedPage.title}」上次中断时存在未确认草稿，无法直接续写；点击下方按钮会自动归档旧草稿并按当前工程重新生成。`,
                  `"${failedPage.title}" has an unconfirmed draft from an interrupted run and cannot be resumed directly; click below to archive the old draft and regenerate.`
                )}
              </div>
            )}
            <button
              type="button"
              disabled={!connected || busy || !!activeQ || plan.discussionPending || !!lastMessage?.projectChangeReview || (plan.approved && workComplete)}
              onClick={() => {
                if (failedPage && failedNeedsArchive && !plan.discussionPending && !(plan.approved && workComplete)) {
                  restartFailedAndContinue();
                  return;
                }
                void run(() => generateProject(projectId));
              }}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 px-3.5 py-2.5 text-sm font-semibold text-white shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {plan.discussionPending
                ? tr('原方案已暂停', 'Plan Paused')
                : revision && workComplete
                  ? tr('本次调整已完成', 'Revision Completed')
                  : failedPage && failedNeedsArchive && !(plan.approved && workComplete)
                    ? remainingPageCount > 1
                      ? tr('保留旧草稿，重新生成并继续剩余页面', 'Archive Draft, Regenerate & Continue')
                      : tr('保留旧草稿，重新生成此页', 'Archive Draft & Regenerate Page')
                    : plan.approved
                      ? tr('继续生成剩余页面', 'Continue Remaining Pages')
                      : tr('确认方案并生成', 'Confirm Plan & Generate')}
            </button>
            <p className="text-[11px] text-slate-400 text-center break-words">
              {plan.discussionPending
                ? <>
                    {tr('可以继续对话。需要恢复旧任务时，', 'Continue chatting, or ')}
                    <button type="button" disabled={busy || !!lastMessage?.projectChangeReview} className="text-blue-700 underline disabled:opacity-40" onClick={() => void run(() => resumePriorPlan(projectId))}>
                      {tr('沿用原方案', 'resume previous plan')}
                    </button>
                    {tr('。', '.')}
                  </>
                : tr('需要修改范围时，在左侧继续对话。新方案需要重新确认。', 'Keep chatting on the left to adjust scope. New plans require confirmation.')}
            </p>
          </div>
        )}
        </div>
      </aside>
    </div>
  );
}
