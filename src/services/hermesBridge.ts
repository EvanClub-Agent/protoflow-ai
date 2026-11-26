import { projectPreviewContext } from '../mcp/capturePreview';
import { pageNoteBriefing } from '../proto/notes';
import { captureRuntimeError, type DiagnosticContext } from './runtimeDiagnostics';
import { databaseRequirementSources } from './databaseRequirementSources';
import { collectRequirementRecords } from '../proto/database/requirementReview';
import { conversationKey } from './hermesConversation';
import { pendingProjectAiTasks as pendingProjects } from './hermesTaskLock';
import { beginAiBackgroundTask, type AiTaskOutcome } from './aiBackground';
import { isDiagnosticCancellation } from './runtimeDiagnostics';
import {
  useHermesStore,
  buildProtoFlowHermesSkillMarkdown,
} from "../store/useHermesStore";
import { CORE_MATERIAL_RULES, DESKTOP_MATERIAL_RULES, MOBILE_MATERIAL_RULES } from "../proto/ai/materialInstructions";
import { useProtoStore, type DBTableSchema } from "../store/useProtoStore";
import { useAiChatStore } from "../store/useAiChatStore";
import { useAiPreviewStore } from '../store/useAiPreviewStore';
import {
  usePageStore,
  type CustomCompositeBlock,
} from "../proto/store/usePageStore";
import { captureProjectPayload } from "./projectStorage";
import { getHermesApi, type HermesImageAttachment } from "./hermesClient";
import {
  applyProjectChanges,
  projectContext,
  projectRevision,
  type AuditRequest,
} from "./hermesProject";
import { parsePageSource } from "../proto/dsl/parser";
import {
  currentProjectDataContext,
  generateFromTemplate,
  MOBILE_PAGE_TEMPLATES,
  PAGE_TEMPLATES,
  type PageTemplateKind,
} from "../proto/ai/templates";
import type { RequestedPage } from "./projectPagePlatform";
import type { PagePlatform, ProjectMode } from "../proto/mobile/types";
import type { ProtoDoc } from "../proto/types";
import { parseCreatePageIntent } from "../proto/ai/intent";
import { isEnLocale, td, tr } from "../i18n/runtime";

function resolveTargetPlatform(
  state: {
    pageSources: Record<string, string>;
    designerPages: { pageId: string; platform?: PagePlatform }[];
    projectPlan?: { pages: { pageId: string; platform?: PagePlatform }[] } | null;
  },
  targetPageId: string,
  requestedPage?: RequestedPage,
  projectMode?: ProjectMode,
): ProjectMode {
  if (requestedPage?.pageId === targetPageId) return requestedPage.platform;
  const planned = state.projectPlan?.pages.find((p) => p.pageId === targetPageId)?.platform;
  if (planned) return planned;
  const saved = state.designerPages.find((p) => p.pageId === targetPageId)?.platform;
  const source = state.pageSources[targetPageId];
  const root = source ? parsePageSource(source).doc?.root : undefined;
  if (root?.type === "MobilePage") return "mobile";
  if (root?.type === "Page" && !( !saved && root.pfId === "project-root" && !root.children.length )) return "desktop";
  if (saved) return saved;
  return projectMode ?? "desktop";
}

export function buildStructuredPagePrompt(params: {
  prompt: string;
  projectId: string;
  pageId: string;
  selectedPfId?: string | null;
  requestedPage?: RequestedPage;
  readOnly?: boolean;
  audit?: AuditRequest;
  platform: ProjectMode;
  agreementsSummary: string;
  noteBriefing: string;
}): string {
  const {
    prompt,
    projectId,
    pageId,
    selectedPfId,
    requestedPage,
    readOnly,
    audit,
    platform,
    agreementsSummary,
    noteBriefing,
  } = params;
  const taskType = readOnly
    ? "咨询 / 只读分析"
    : audit?.kind === "scan"
      ? "审查 / 闭环巡检扫描"
      : audit?.kind === "repair"
        ? "修改 / 闭环问题修复"
        : requestedPage
          ? "新建 / 创建新菜单页面"
          : selectedPfId
            ? "修改 / 局部组件修改"
            : "修改 / 页面与契约调整";
  const scopeText = requestedPage
    ? `项目 ID: ${projectId}；目标新页面 ID: ${requestedPage.pageId}（平台: ${requestedPage.platform}）；当前停留页面 ID: ${pageId}（仅作上下文参考，禁止覆盖当前停留页面，必须新建并写入 ${requestedPage.pageId}）`
    : `项目 ID: ${projectId}；目标页面 ID: ${pageId}；选中组件 pfId: ${selectedPfId ?? "无（整页）"}；平台: ${platform}`;
  const platformRuleSummary =
    platform === "mobile"
      ? MOBILE_MATERIAL_RULES
      : platform === "desktop"
        ? DESKTOP_MATERIAL_RULES
        : `${DESKTOP_MATERIAL_RULES}\n\n${MOBILE_MATERIAL_RULES}`;
  const acceptanceText = readOnly
    ? "本轮只回答问题，不允许修改项目（禁止写入页面、数据表、便签或巡检记录）；按需调用 protoflow_get_project、protoflow_inspect_page、protoflow_get_implementation_guide 读取证据后用中文准确解答。"
    : audit?.kind === "scan"
      ? "先调用 protoflow_get_project、protoflow_inspect_page、protoflow_get_page_tsx、protoflow_get_sticky_notes 核查真实证据，再调用一次 protoflow_run_closed_loop_audit 提交完整问题列表（无关联表时 targetTableId 填 \"\"；open 状态必须含修复选项）。本轮仅巡检，严禁修改页面源码、表或便签。"
      : [
          "先调用 protoflow_get_project 读取本轮目录，已有页面用 protoflow_inspect_page 与 protoflow_get_page_tsx 获取当前结构，按任务调用 protoflow_get_implementation_guide 与 protoflow_get_contracts 读取组件契约，修改后再次 protoflow_inspect_page 核对暂存结果（涉及复杂视觉排版、移动端视口或 UI 五态效果时，可按需调用 protoflow_capture_preview 截取暂存候选页面真实渲染图自检）。",
          selectedPfId
            ? "范围约束：仅修改选中组件及其子树，保留其他已有组件的属性和顺序；若选中组件的动作需要新弹层，桌面页在 Page 根部加入 Modal/Drawer，移动页在 MobilePage 根部加入 MDialog/MBottomSheet，其他范围不得新增组件。"
            : "",
          "闭环要求：每项交互必须满足“触发操作 → 准确目标 → 数据/状态变化”闭环（保存按钮必须调用 submitForm 指向真实绑定表的 Form/MForm，跳转必须调用 navigate 指向真实 pageId，状态更新必须调用 updateRow 更新真实字段；严禁仅用 toast 或 closeOverlay 冒充保存完成）。仅通过 protoflow_* 工具暂存修改，禁止直接写文件；最终用中文说明实际结果，不必重复整页代码。",
        ]
          .filter(Boolean)
          .join("\n");
  const missingInfoRule = readOnly
    ? "若项目证据不足以回答或笔记尚未经客户确认（draft / pending_confirm），明确指出缺失信息与受影响的结论，不要猜测。"
    : "缺少决定业务语义、字段归属、主外键身份或状态流转的信息时，优先调用 clarify 向用户澄清（不可用时在回复中明确询问），禁止凭空猜测字段或用提示消息伪装功能已实现。";

  return [
    CORE_MATERIAL_RULES,
    platformRuleSummary,
    [
      `任务类型：${taskType}`,
      `目标范围：${scopeText}`,
      `已确认约束：${agreementsSummary}`,
      `验收要求：\n${acceptanceText}`,
      `缺失信息：${missingInfoRule}`,
    ].join("\n"),
    noteBriefing ? `参考资料：\n${noteBriefing}` : "参考资料：本轮未勾选随附笔记；如涉及需求来源或历史沟通，可按需通过 protoflow_get_project_notes 读取完整正文（留意 total、nextOffset 与 truncated 续读）。",
    `本轮目标（用户请求：${prompt}）`,
    isEnLocale()
      ? "Language Preference (Active UI Locale: English): Unless the user's prompt explicitly requests Chinese, respond in English, write all clarify question cards and plan summaries in English, and generate default UI copy (titles, buttons, labels, placeholders, toast messages) in idiomatic English."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
export interface HermesExecutionResult {
  viaHermes: boolean;
  engineBadge: string;
  toolName: string;
  summary: string;
  changedPages: string[];
  createdPageId?: string;
}
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}
export function reportAiError(error: unknown) {
  useHermesStore.setState({
    error: td(error instanceof Error ? error.message : String(error)),
  });
}
export async function runProjectAi(
  prompt: string,
  options: {
    pageId?: string;
    selectedPfId?: string | null;
    requestedPage?: RequestedPage;
    readOnly?: boolean;
    revealChat?: boolean;
    audit?: AuditRequest;
    images?: HermesImageAttachment[];
    /** Linked project notes the user kept selected; sent as background, never as instructions. */
    noteIds?: string[];
  } = {},
): Promise<HermesExecutionResult> {
  const store = useProtoStore.getState(),
    projectId = store.currentProjectMeta.projectId,
    pageId = options.pageId ?? store.activePageId;
  const scope = { projectId, pageId }, key = conversationKey(scope);
  let diagnosticContext: DiagnosticContext = {...scope};
  if (store.isProjectClosed) throw new Error(tr("请先打开项目", "Please open a project first"));
  if (pendingProjects.has(projectId))
    throw new Error(tr("当前项目已有 AI 任务，请等待或停止生成", "An AI task is already running in this project. Please wait or stop it first."));
  const chat = useAiChatStore.getState();
  // Only surface a page task in the canvas that owns it.
  if (options.revealChat !== false && store.viewMode === 'single_page' && store.activePageId === pageId)
    chat.setPageChatOpen(true);
  const contextNotes = (options.noteIds ?? [])
    .map((id) => store.projectNotes.nodes.find((node) => node.id === id))
    .filter((node): node is NonNullable<typeof node> => node?.kind === 'note');
  chat.addMessage({
    projectId,
    role: "user",
    text: contextNotes.length
      ? tr(
          `${prompt}\n\n📎 已附带关联笔记：${contextNotes.map((n) => `《${n.title}》`).join('')}`,
          `${prompt}\n\n📎 Attached notes: ${contextNotes.map((n) => `"${n.title}"`).join(', ')}`
        )
      : prompt,
    ...(options.images?.length ? { images: options.images } : {}),
    pageId,
    status: "done",
  });
  const replyId = chat.addMessage({
    projectId,
    role: "assistant",
    text: tr("正在连接 Hermes 会话…", "Connecting to Hermes session…"),
    pageId,
    status: "pending",
  });
  const base = captureProjectPayload(),
    revision = projectRevision(),
    snapshot = projectContext(options.requestedPage, base);
  const requirementSources = databaseRequirementSources(base.stateSnapshot, useAiChatStore.getState().byConversation[key] ?? [], pageId);
  useHermesStore.setState((s) => ({
    error: null,
    runningProjects: { ...s.runningProjects, [projectId]: true },
    runningPageByProject: { ...s.runningPageByProject, [projectId]: pageId },
    partial: { ...s.partial, [key]: "" },
  }));
  const cancelGeneration =
    useHermesStore.getState().cancelGeneration[key];
  const checkCancelled = () => {
    if (
      useHermesStore.getState().cancelGeneration[key] !== cancelGeneration
    )
      throw new Error(tr("已停止生成，未应用修改", "Stopped generation; no changes were applied"));
  };
  pendingProjects.add(projectId);
  let endBackground: ((outcome: AiTaskOutcome) => Promise<void>) | undefined;
  let backgroundOutcome: AiTaskOutcome = 'finished';
  let lastText = "";
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  let stopPreviewEvents = () => {};
  const unsub = useHermesStore.subscribe((s) => {
    const text = s.partial[key];
    if (text && text !== lastText) {
      const firstChunk = lastText === '';
      lastText = text;
      // Coalesce token bursts and persist once at completion, not on every token.
      if (firstChunk) { chat.updateMessage(replyId, { text }, { persist: false }); return; }
      if (textTimer === undefined) textTimer = setTimeout(() => {
        textTimer = undefined;
        chat.updateMessage(replyId, { text: lastText }, { persist: false });
      }, 50);
    }
  });
  try {
    const background = beginAiBackgroundTask(scope);
    if (background) endBackground = await background;
    const hermes = useHermesStore.getState();
    const session = await hermes.ensureSession(scope);
    diagnosticContext.sessionId = session.sessionId;
    checkCancelled();
    const targetPageForPlatform = options.requestedPage?.pageId ?? pageId;
    const targetPlatform = resolveTargetPlatform(
      base.stateSnapshot,
      targetPageForPlatform,
      options.requestedPage,
      base.meta.projectMode,
    );
    const instructions = buildProtoFlowHermesSkillMarkdown(
      store.dbTables,
      usePageStore.getState().compositeBlocks,
      store.stickyNotes,
      "menu",
      targetPlatform,
    );
    const synced = await getHermesApi().sync({
      projectId,
      skillMarkdown: instructions,
    });
    if (!synced.synced) throw new Error(tr("项目指令同步失败", "Failed to sync project instructions"));
    checkCancelled();
    if (!options.readOnly && options.audit?.kind !== 'scan') {
      useAiPreviewStore.getState().begin(scope, session.sessionId, base.stateSnapshot.tableRows);
      let invalidated = false;
      stopPreviewEvents = getHermesApi().onEvent(event => {
        if (event.projectId !== projectId || event.pageId !== pageId || event.sessionId !== session.sessionId || !['run-start', 'page-preview'].includes(event.type)) return;
        if (event.type === 'run-start') diagnosticContext.runId = event.runId;
        const current = useProtoStore.getState();
        if (invalidated || current.isProjectClosed || current.currentProjectMeta.projectId !== projectId || useHermesStore.getState().cancelGeneration[key] !== cancelGeneration || projectRevision() !== revision) {
          invalidated = true;
          useAiPreviewStore.getState().clear(scope);
          return;
        }
        useAiPreviewStore.getState().receive(event);
      });
    }
    const scopedAgreements = (base.stateSnapshot.projectAgreements ?? []).filter(
      (a) => a.pageIds.length === 0 || a.pageIds.includes(targetPageForPlatform),
    );
    const activeStickies = store.stickyNotes.filter(
      (s) => s.active && s.pageId === targetPageForPlatform,
    );
    const agreementsSummary =
      scopedAgreements.length || activeStickies.length
        ? [
            scopedAgreements.length
              ? `项目约定 ${scopedAgreements.length} 条（${scopedAgreements.slice(0, 4).map((a) => `「${a.title}」`).join("、")}${scopedAgreements.length > 4 ? "等" : ""}）`
              : "",
            activeStickies.length
              ? `本页启用便签 ${activeStickies.length} 条（通过 protoflow_get_sticky_notes 读取详情）`
              : "",
          ]
            .filter(Boolean)
            .join("；")
        : "当前页面暂无额外已保存项目约定或启用便签（以 protoflow_get_project 实时目录为准）";
    const noteBriefing = contextNotes.length
      ? pageNoteBriefing(store.projectNotes, contextNotes.map((n) => n.id))
      : "";
    const request = buildStructuredPagePrompt({
      prompt,
      projectId,
      pageId,
      selectedPfId: options.selectedPfId,
      requestedPage: options.requestedPage,
      readOnly: options.readOnly,
      audit: options.audit,
      platform: targetPlatform,
      agreementsSummary,
      noteBriefing,
    });
    const res = await getHermesApi().execute({
      projectId,
      pageId,
      prompt: request,
      snapshot: {...snapshot, requirementSources},
      previewContext: projectPreviewContext(base),
      readOnly: options.readOnly,
      ...(options.images?.length ? { images: options.images } : {}),
    });
    diagnosticContext = {...diagnosticContext,runId:res.runId,sessionId:res.sessionId,modelId:res.modelId};
    if (res.metrics) {
      useHermesStore.setState((s) => ({
        lastMetrics: { ...s.lastMetrics, [key]: res.metrics! },
      }));
    }
    clearTimeout(textTimer);
    textTimer = undefined;
    checkCancelled();
    if (synced.skillDigest && res.skillDigest && res.skillDigest !== synced.skillDigest) {
      throw new Error(tr("当前会话尚未加载最新项目指令，请刷新会话后重试", "Session has not loaded the latest project instructions. Please refresh the session and try again."));
    }
    const hasChanges = res.operations.length > 0 || !!res.requirementFindings?.length;
    if (options.readOnly && hasChanges)
      throw new Error(tr("只读请求返回了修改操作", "Read-only request returned write operations"));
    if (options.audit && !res.operations.some(op => op.tool === 'protoflow_run_closed_loop_audit'))
      throw new Error(tr('Hermes 未返回巡检结果，问题状态未更新', 'Hermes did not return an audit result; issue status was not updated'));
    if (res.sessionId !== session.sessionId) throw new Error(tr('Hermes 返回了其他菜单的对话结果，未应用修改', 'Hermes returned a response from a different menu session; changes were rejected'));
    if (options.requestedPage && !hasChanges) throw new Error(res.text.trim() || tr('AI 未提交新页面', 'AI did not submit a new page'));
    const applied = hasChanges
      ? applyProjectChanges(
          base,
          revision,
          res.operations,
          { pageId, selectedPfId: options.selectedPfId ?? null, audit: options.audit },
          res.runId, undefined, false,
          options.audit?.kind==='scan' ? [] : collectRequirementRecords(requirementSources, res.requirementFindings, base.stateSnapshot.databaseRequirements),
          options.requestedPage,
        )
      : { changedPages: [], databaseRisks: [], requirementAudit: undefined, next: base };
    const created = options.requestedPage?.pageId ?? applied.changedPages.find(
      (id) =>
        !Object.prototype.hasOwnProperty.call(
          base.stateSnapshot.pageSources,
          id,
        ),
    );
    let summary =
      res.text.trim() ||
      (res.operations.length
        ? tr(`已应用 ${res.operations.length} 项经过校验的修改`, `Applied ${res.operations.length} validated change(s)`)
        : hasChanges ? tr("已保存需求核对记录", "Saved requirement review records") : tr("Hermes 未返回回复或修改", "Hermes returned no reply or changes"));
    if (!res.text.trim() && !hasChanges) throw new Error(summary);
    if (applied.databaseRisks.length) summary += tr('\n\n数据模型待复核\n', '\n\nDatabase Model Review Notes\n') + applied.databaseRisks.join('\n');
    const badge = `Hermes · ${res.modelId}`;
    chat.updateMessage(replyId, {
      status: "done",
      text: summary,
      requirementAudit: applied.requirementAudit,
      engineBadge: badge,
      viaHermes: true,
      sessionId: res.sessionId,
      modelId: res.modelId,
      changedDoc: hasChanges,
      changeId: hasChanges ? res.runId : undefined,
      createdPageId: created,
    });
    if (
      created &&
      useProtoStore.getState().currentProjectMeta.projectId === projectId &&
      useProtoStore.getState().activePageId === pageId
    ) {
      useProtoStore.getState().setActivePage(created);
      useProtoStore.getState().setViewMode("single_page");
    }
    return {
      viaHermes: true,
      engineBadge: badge,
      toolName: res.operations.map((o) => o.tool).join(", "),
      summary,
      changedPages: applied.changedPages,
      createdPageId: created,
    };
  } catch (error) {
    backgroundOutcome = isDiagnosticCancellation(error) ? 'cancelled' : 'failed';
    clearTimeout(textTimer);
    const text = td(error instanceof Error ? error.message : String(error));
    void captureRuntimeError(error,{category:'ai',code:'AI_PAGE_TASK_FAILED',stage:'page-task',message:tr('页面 AI 任务未完成', 'Page AI task did not complete'),context:diagnosticContext})
      .then(id=>{if(id)chat.updateMessage(replyId,{diagnosticId:id});});
    chat.updateMessage(replyId, { status: "error", text: tr(`执行失败：${text}`, `Execution failed: ${text}`) });
    reportAiError(error);
    throw error;
  } finally {
    if (endBackground) await endBackground(backgroundOutcome);
    unsub();
    clearTimeout(textTimer);
    stopPreviewEvents();
    useAiPreviewStore.getState().clear(scope);
    pendingProjects.delete(projectId);
    useHermesStore.setState((s) => ({
      runningProjects: { ...s.runningProjects, [projectId]: false },
      runningPageByProject: { ...s.runningPageByProject, [projectId]: undefined },
    }));
  }
}
export async function runCanvasAiWithHermes(params: {
  prompt: string;
  images?: HermesImageAttachment[];
  noteIds?: string[];
  doc: ProtoDoc;
  selectedPfId: string | null;
  dbTables: DBTableSchema[];
  pageId: string;
  compositeBlocks: CustomCompositeBlock[];
  history?: ChatTurn[];
}) {
  const result = await runProjectAi(params.prompt, {
    // The canvas owns its launcher. Finishing an attachment upload must not reopen a minimized chat.
    revealChat: false,
    images: params.images,
    noteIds: params.noteIds,
    pageId: params.pageId,
    selectedPfId:
      params.selectedPfId === params.doc.root.pfId ? null : params.selectedPfId,
  });
  return {
    ...result,
    doc:
      parsePageSource(usePageStore.getState().pageSources[params.pageId]).doc ??
      params.doc,
    createdOverlayId: undefined,
    insertedPfId: undefined,
  };
}
export async function runAiCreatePageFromPrompt(
  prompt: string,
  _history?: ChatTurn[],
) {
  if (
    !/(创建|新建|新增|生成).*(页面|页|菜单|模块)/.test(prompt) &&
    !parseCreatePageIntent(prompt, useProtoStore.getState().dbTables)
  ) {
    return null;
  }
  const res = await runProjectAi(prompt);
  if (!res.createdPageId)
    return {
      ...res,
      pageId: useProtoStore.getState().activePageId,
      title: tr("Hermes 回复", "Hermes Reply"),
    };
  return {
    ...res,
    pageId: res.createdPageId,
    title: usePageStore
      .getState()
      .designerPages.find((p) => p.pageId === res.createdPageId)!.title,
  };
}
/** Manual templates are deterministic editor features and are not advertised as AI. */
export function createPageFromTemplate(params: {
  pageId: string;
  title: string;
  template: PageTemplateKind;
  tableId: string;
  dbTables: DBTableSchema[];
  platform?: PagePlatform;
}) {
  const table = params.dbTables.find((t) => t.id === params.tableId);
  const allTemplates = [...PAGE_TEMPLATES, ...MOBILE_PAGE_TEMPLATES];
  const tplSpec = allTemplates.find((t) => t.kind === params.template);
  const requiresTable =
    params.platform === 'mobile'
      ? Boolean(tplSpec?.needsTable && params.dbTables.length > 0)
      : params.template !== 'blank';
  if (requiresTable && !table)
    throw new Error(tr("请选择有效的数据表", "Please select a valid database table"));
  return generateFromTemplate(params.template, table, params.dbTables, {
    pageId: params.pageId,
    title: params.title,
    platform: params.platform,
    data: currentProjectDataContext(params.dbTables),
  });
}
export const runStickyCompileWithHermes = (p: {
  pageId: string;
  widgetId: string;
  widgetName?: string;
  text: string;
}) =>
  runProjectAi(
    `为页面 ${p.pageId} 的组件 ${p.widgetId} 添加并分析需求便签：${p.text}。只使用已确认字段；未实现的运行逻辑必须指出。`,
    { pageId: p.pageId, selectedPfId: p.widgetId },
  );
export const runScanStickiesAndAstToDbWithHermes = () =>
  runProjectAi(
    "审查当前工程的页面表单、需求便签和数据库契约，补齐有明确业务依据的字段。按最近 Form.table 确定字段归属；Select.table 是选项来源，QueryForm 是筛选条件，不要据此创建业务字段。不确定的归属请提问。",
  ).then((r) => ({ ...r, addedColumns: [] as string[] }));
export function runClosedLoopAuditWithHermes(
  action:
    | { kind: "rescan"; scope: string; issueCount: number }
    | {
        kind: "resolve_one";
        issueId: string;
        issueTitle: string;
        optionId: string;
        optionLabel: string;
        customAnswer?: string;
      }
    | { kind: "resolve_all"; openCount: number },
) {
  return runProjectAi(
    action.kind === "rescan"
      ? `基于当前项目实际页面、动作、字段、便签执行闭环巡检，范围 ${action.scope}。通过巡检工具发布有证据的完整结果；不要沿用预置风险数量。`
      : action.kind === "resolve_one"
        ? `修复巡检问题 ${action.issueId}，用户选择方案 ${action.optionId}（${action.optionLabel}），补充说明：${action.customAnswer ?? "无"}。先修改真实页面/契约，再更新巡检结果；无法修复则保持 open。`
        : "重新检查并修复有明确依据的所有未解决问题；先做真实修复再标记 resolved，不确定时提问。",
  );
}
export const runGlobalOrImpactAiWithHermes = (p: {
  source: "inspector_sidebar" | "knowledge_kb" | "impact_scenario";
  prompt: string;
}) => runProjectAi(p.prompt, { readOnly: p.source === "knowledge_kb" });
