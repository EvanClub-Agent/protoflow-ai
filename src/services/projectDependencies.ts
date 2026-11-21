import type { ProjectPlan } from './projectPlan';
import { tr } from '../i18n/runtime';
import type { ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import { isChartType } from '../proto/charts/model';
import { parsePageSource } from '../proto/dsl/parser';
import { walk } from '../proto/dsl/tree';
import { diagramRelations } from '../proto/database/relations';
import {
  extractPageActionSemantics,
  FEEDBACK_ONLY_CALLS,
  FORM_SUBMIT_BUTTON_PATTERN,
  hasInvalidOverlayParams,
  isFakeSaveSlot,
  READ_ONLY_LABEL_PATTERN,
  semanticActionContractErrors,
  semanticActionContractIssues,
  type EventSlot,
  type PageActionSemantics,
} from '../proto/ai/actionSemantics';

/** Internal table/column IDs in a plan. Physical names are resolved from the current schema. */
export type PageDependency = { sourcePageId: string; requirement: string } & (
  | { kind: 'pending' }
  | { kind: 'reuse'; sourceTableId: string }
  | { kind: 'foreignKey'; sourceTableId: string; sourceColumnId: string; tableId: string; foreignKeyColumnId: string }
);
export type AcceptanceActionKind = 'submitForm' | 'openOverlay' | 'closeOverlay' | 'navigate' | 'updateRow' | 'deleteRow' | 'returnSelection';
const ACCEPTANCE_ACTION_KINDS: AcceptanceActionKind[] = ['submitForm', 'openOverlay', 'closeOverlay', 'navigate', 'updateRow', 'deleteRow', 'returnSelection'];
export interface AcceptanceCase {
  scenario: string;
  expected: string;
  actionPfId?: string;
  actionEvent?: string;
  actionKind?: AcceptanceActionKind;
  targetId?: string;
  tableId?: string;
  field?: string;
  chart?: { pfId: string; tableId: string };
  source?: { mindmapId: string; quote: string };
}

const text = (v: unknown) => typeof v === 'string' && !!v.trim();
export function validatePageEvidence(page: ProjectPlan['pages'][number]) {
  if (page.dependencies !== undefined && (!Array.isArray(page.dependencies) || page.dependencies.some(d =>
    !d || !text(d.sourcePageId) || !text(d.requirement) || d.sourcePageId === page.pageId ||
    !['pending','reuse','foreignKey'].includes(d.kind) || (d.kind !== 'pending' && !text(d.sourceTableId)) ||
    (d.kind === 'foreignKey' && (!text(d.tableId) || !text(d.foreignKeyColumnId) || !text(d.sourceColumnId)))))) {
    throw new Error(tr(`页面 ${page.pageId} 的上游数据依赖无效，请指定来源页面、需求和准确的表及外键字段 ID`, `Invalid upstream data dependency on page ${page.pageId}; specify source page, requirement, and exact table/foreign-key column IDs`));
  }
  if (page.acceptanceCases !== undefined && (!Array.isArray(page.acceptanceCases) || page.acceptanceCases.some(c =>
    !c || !text(c.scenario) || !text(c.expected) || (c.actionPfId !== undefined && !text(c.actionPfId)) ||
    (c.actionEvent !== undefined && (!text(c.actionPfId) || !text(c.actionEvent))) ||
    (c.actionKind !== undefined && (!text(c.actionPfId) || !ACCEPTANCE_ACTION_KINDS.includes(c.actionKind))) ||
    (c.targetId !== undefined && !text(c.targetId)) ||
    (c.tableId !== undefined && !text(c.tableId)) ||
    (c.field !== undefined && !text(c.field)) ||
    (c.chart !== undefined && (!c.chart || !text(c.chart.pfId) || !text(c.chart.tableId))) ||
    (c.source !== undefined && (!c.source || !text(c.source.mindmapId) || !text(c.source.quote)))))) {
    throw new Error(tr(`页面 ${page.pageId} 的验收场景、预期动作目标或脑图来源无效`, `Invalid acceptance case, action target, or mindmap source on page ${page.pageId}`));
  }
}

const SAVE_SCENARIO_PATTERN = /(保存|提交表单|落库|写入|新增记录|修改记录)/;
const EXPLICIT_SAVE_CLAIM_PATTERN = /(保存成功|提交成功|保存记录|提交表单|写入数据|新增并保存|修改并保存)/;
const WRITE_OR_PICK_ACTIONS = new Set(['submitForm', 'updateRow', 'deleteRow', 'returnSelection', 'importPurchaseOrderLines']);
// Negative requirements (e.g. “不保存，返回”) must not become positive save claims.
// This only removes explicit negated verbs; any remaining positive write claim still needs a write action.
const NEGATED_WRITE_PATTERN = /(?:不(?:会|再)?|未|无需|不要|禁止|暂不|取消|放弃)(?:自动)?(?:保存|提交(?:表单)?|落库|写入|新增记录|修改记录)/g;

type Inputs = Pick<ProjectStateSnapshot,'projectPlan'|'pageSources'|'dbTables'|'mindmaps'>;
export function reviewPageDependencies(s: Inputs) {
  const tables = new Map(s.dbTables.map(t => [t.id,t]));
  const graph = diagramRelations(s.dbTables);
  const pages = s.projectPlan?.pages ?? [];
  const knownPages = new Set([...Object.keys(s.pageSources), ...pages.map(p => p.pageId)]);
  interface PageFacts {
    tables: Set<string>;
    semantics: PageActionSemantics;
    contractErrors: string[];
    charts: Map<string, string>;
    sampleCharts: string[];
  }
  const emptySemantics = (): PageActionSemantics => ({
    forms: new Map(),
    overlays: new Set(),
    openedOverlays: new Set(),
    pickerTables: new Map(),
    nodeTypes: new Map(),
    slots: [],
    slotsByPfId: new Map(),
    slotsByQualifiedId: new Map(),
    labels: new Map(),
  });
  const sources = new Map<string, PageFacts>();
  function inspect(id: string): PageFacts {
    const cached = sources.get(id);
    if (cached) return cached;
    const result: PageFacts = {
      tables: new Set<string>(),
      semantics: emptySemantics(),
      contractErrors: [],
      charts: new Map<string, string>(),
      sampleCharts: [],
    };
    const source = s.pageSources[id];
    const doc = source && parsePageSource(source).doc;
    if (doc) {
      walk(doc.root, n => {
        if (isChartType(n.type)) {
          if (n.props.source === 'sample') result.sampleCharts.push(n.pfId);
          if (n.props.source === 'table' && typeof n.props.table === 'string') result.charts.set(n.pfId, n.props.table);
        }
        if (typeof n.props.table === 'string') result.tables.add(n.props.table);
      });
      result.semantics = extractPageActionSemantics(doc.root, s.dbTables);
      result.contractErrors = semanticActionContractErrors(result.semantics, s.dbTables, {
        strictBusinessPersistence: true,
      });
    }
    sources.set(id, result);
    return result;
  }

  const resolveCaseSlots = (sem: PageActionSemantics, c: AcceptanceCase, isSaveIntent: boolean) => {
    if (!c.actionPfId) {
      return {
        nodePfId: '',
        explicitEvent: null as string | null,
        componentSlots: [] as EventSlot[],
        allSlots: [] as EventSlot[],
        activeSlots: [] as EventSlot[],
        specificEventMissing: false,
      };
    }
    const isMutationIntent =
      isSaveIntent ||
      (c.actionKind !== undefined &&
        ['submitForm', 'updateRow', 'deleteRow', 'returnSelection'].includes(c.actionKind));
    const eligible = (slot: EventSlot) =>
      !isMutationIntent || (slot.role !== 'cancel' && !READ_ONLY_LABEL_PATTERN.test(slot.label.trim()));
    const rawRef = c.actionPfId.trim();
    let nodePfId = rawRef;
    let explicitEvent = c.actionEvent ? c.actionEvent.trim() : null;
    if (!explicitEvent && !sem.nodeTypes.has(rawRef) && rawRef.includes('.')) {
      const candidates = [...sem.nodeTypes.keys()]
        .filter(id => rawRef.startsWith(`${id}.`))
        .sort((a, b) => b.length - a.length);
      if (candidates.length > 0) {
        nodePfId = candidates[0];
        explicitEvent = rawRef.slice(nodePfId.length + 1);
      }
    }

    const componentSlots = (sem.slotsByPfId.get(nodePfId) ?? []).filter(sl => sl.calls.length > 0);
    if (explicitEvent) {
      const exact = sem.slotsByQualifiedId.get(`${nodePfId}.${explicitEvent}`);
      if (!exact || exact.calls.length === 0) {
        return {
          nodePfId,
          explicitEvent,
          componentSlots,
          allSlots: [] as EventSlot[],
          activeSlots: [] as EventSlot[],
          specificEventMissing: sem.nodeTypes.has(nodePfId),
        };
      }
      return {
        nodePfId,
        explicitEvent,
        componentSlots,
        allSlots: [exact],
        activeSlots: eligible(exact) ? [exact] : [],
        specificEventMissing: false,
      };
    }

    const allSlots = componentSlots;
    let activeSlots = allSlots.filter(eligible);
    const matchedByScenario = activeSlots.filter(sl => {
      const lbl = sl.label.trim();
      return lbl.length >= 2 && c.scenario.includes(lbl);
    });
    const narrowedByScenario = matchedByScenario.length > 0 && matchedByScenario.length < activeSlots.length;
    if (narrowedByScenario) {
      activeSlots = matchedByScenario;
    }

    if (sem.nodeTypes.get(nodePfId) === 'MBottomDock' && !narrowedByScenario) {
      // A structured return/close case may target the secondary action even when
      // its scenario says “退出” and the button says “取消”. Never borrow a submit action.
      const returnCall = c.actionKind === 'navigate' ? 'navigate' : c.actionKind === 'closeOverlay' ? 'closeOverlay' : null;
      if (!isMutationIntent && returnCall) {
        activeSlots = activeSlots.filter(sl => sl.calls.some(call => call.name === returnCall));
      } else {
        const secondarySlot = sem.slotsByQualifiedId.get(`${nodePfId}.onSecondary`);
        const primarySlot = sem.slotsByQualifiedId.get(`${nodePfId}.onPrimary`);
        const sLbl = secondarySlot?.label.trim() ?? '';
        const pLbl = primarySlot?.label.trim() ?? '';
        const scenarioTargetsSecondary =
          sLbl.length >= 2 && c.scenario.includes(sLbl) && !(pLbl.length >= 2 && c.scenario.includes(pLabelOrEmpty(pLbl)));
        if (!scenarioTargetsSecondary && (activeSlots.length > 1 || isSaveIntent)) {
          activeSlots =
            primarySlot &&
            primarySlot.calls.length > 0 &&
            primarySlot.role !== 'cancel' &&
            !(isMutationIntent && READ_ONLY_LABEL_PATTERN.test(primarySlot.label.trim()))
              ? [primarySlot]
              : [];
        }
      }
    }

    return {
      nodePfId,
      explicitEvent: null as string | null,
      componentSlots,
      allSlots,
      activeSlots,
      specificEventMissing: false,
    };
  };
  const pLabelOrEmpty = (v: string) => v;

  const checkSubmitSlot = (slot: EventSlot, sem: PageActionSemantics, c: AcceptanceCase): string | null => {
    const submits = slot.calls.filter(call => call.name === 'submitForm');
    if (!submits.length) return null;
    for (const call of submits) {
      const fid = typeof call.args[0] === 'string' && call.args[0].trim() ? call.args[0].trim() : null;
      if (!fid || !sem.forms.has(fid)) continue;
      if (c.targetId && fid !== c.targetId) continue;
      const boundTable = sem.forms.get(fid)?.tableId ?? null;
      if (!boundTable || !tables.has(boundTable)) return '提交表单未绑定有效物理数据表';
      if (c.tableId && boundTable !== c.tableId) return '提交表单未绑定目标数据表';
      return 'OK';
    }
    if (c.targetId && (!submits.some(call => call.args[0] === c.targetId) || !sem.forms.has(c.targetId))) {
      return '提交动作未指向目标表单';
    }
    return '提交动作未指向有效表单组件';
  };

  const checkUpdateRowSlot = (slot: EventSlot, c: AcceptanceCase): string | null => {
    const updates = slot.calls.filter(call => call.name === 'updateRow');
    if (!updates.length) return null;
    if (!slot.hasGuaranteedRowContext) {
      if (slot.hasUncontextualizedEntry && slot.rowTableIds.size > 0) {
        return '状态修改动作所在弹层存在无行上下文的打开入口，无法保证记录更新';
      }
      return '状态修改动作缺少当前行上下文（需位于表格/列表行操作或由行操作打开的弹层内）';
    }
    if (c.tableId && (!tables.has(c.tableId) || slot.rowTableIds.size !== 1 || !slot.rowTableIds.has(c.tableId))) {
      return '状态修改动作的当前行来源表与目标数据表不一致';
    }
    const candidateTables = c.tableId ? [c.tableId] : [...slot.rowTableIds];
    for (const call of updates) {
      const patch = call.args[0];
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) continue;
      if (c.field && !Object.prototype.hasOwnProperty.call(patch, c.field)) continue;
      const keys = Object.keys(patch);
      const validTable = candidateTables.every(tid => {
        const tbl = tables.get(tid);
        return tbl ? keys.every(k => tbl.columns.some(col => col.name === k)) : false;
      });
      if (!validTable) return '状态修改动作更新了数据表中不存在的字段';
      return 'OK';
    }
    return c.field ? '状态修改动作未更新指定字段' : '状态修改动作缺少有效更新字段';
  };

  const checkDeleteRowSlot = (slot: EventSlot, c: AcceptanceCase): string | null => {
    if (!slot.calls.some(call => call.name === 'deleteRow')) return null;
    if (!slot.hasGuaranteedRowContext) {
      if (slot.hasUncontextualizedEntry && slot.rowTableIds.size > 0) {
        return '删除动作所在弹层存在无行上下文的打开入口，无法保证记录删除';
      }
      return '删除动作缺少当前行上下文（需位于表格/列表行操作或由行操作打开的弹层内）';
    }
    if (c.tableId && (!tables.has(c.tableId) || slot.rowTableIds.size !== 1 || !slot.rowTableIds.has(c.tableId))) {
      return '删除动作的当前行来源表与目标数据表不一致';
    }
    return 'OK';
  };

  const checkNavigation = (slots: EventSlot[], c: AcceptanceCase): string | null => {
    const navigations = slots.flatMap(slot => slot.calls.filter(call => call.name === 'navigate').map(call => ({ slot, call })));
    if (!navigations.length) return '待绑定页面跳转动作（navigate）';
    if (navigations.some(({ slot, call }) => typeof call.args[0] === 'string' && knownPages.has(call.args[0]) &&
        (!c.targetId || call.args[0] === c.targetId) &&
        (call.args[1] === undefined || (call.args[1] === 'row' && slot.hasGuaranteedRowContext)))) return null;
    if (navigations.some(({ slot, call }) => call.args[1] !== undefined && !slot.hasGuaranteedRowContext))
      return '携带当前行跳转缺少来源行上下文';
    return '跳转动作未指向有效目标页面';
  };
  const checkCloseOverlay = (slots: EventSlot[], c: AcceptanceCase): string | null => {
    const closingSlots = slots.filter(slot => slot.calls.some(call => call.name === 'closeOverlay'));
    if (!closingSlots.length) return '待绑定关闭弹层动作（closeOverlay）';
    if (closingSlots.some(slot => !slot.enclosingOverlayId || (c.targetId && slot.enclosingOverlayId !== c.targetId)))
      return '关闭动作不在目标弹层内';
    return null;
  };

  const links = pages.flatMap(page => (page.dependencies ?? []).map(d => {
    const check = () => {
      if (d.kind === 'pending') return '待明确来源';
      const upstream = tables.get(d.sourceTableId);
      if (!upstream) return '待建来源表';
      if (!upstream.sharedByMenus.some(m => m.pageId === d.sourcePageId) && !inspect(d.sourcePageId).tables.has(upstream.id)) return '待核对来源菜单';
      const bound = inspect(page.pageId).tables;
      if (d.kind === 'reuse') return bound.has(upstream.id) ? '已核对结构与页面绑定' : '待绑定来源表';
      if (!tables.has(d.tableId)) return '待建引用表';
      const fk = graph.relations.find(r => r.toTableId === d.tableId && r.toColumnId === d.foreignKeyColumnId);
      if (!fk || fk.fromTableId !== upstream.id || !upstream.columns.some(c => c.id === d.sourceColumnId && c.name === fk.fromColumnName)) return '待建立指定外键';
      return bound.has(d.tableId) ? '已核对结构与页面绑定' : '待绑定引用表';
    };
    return { pageId: page.pageId, ...d, status: check() };
  }));
  const cases = pages.flatMap(page => (page.acceptanceCases ?? []).map(c => {
    const source = c.source && s.mindmaps.nodes.find(n => n.id === c.source!.mindmapId);
    const sourceValid = !c.source || (source?.kind === 'mindmap' && source.source.includes(c.source.quote));
    const pageFacts = inspect(page.pageId);
    const sem = pageFacts.semantics;
    const intentText = `${c.scenario} ${c.expected}`;
    const positiveIntentText = intentText.replace(NEGATED_WRITE_PATTERN, '');
    const isSaveIntent =
      c.actionKind === 'submitForm' ||
      EXPLICIT_SAVE_CLAIM_PATTERN.test(positiveIntentText) ||
      SAVE_SCENARIO_PATTERN.test(positiveIntentText);
    const {
      componentSlots,
      allSlots,
      activeSlots,
      specificEventMissing,
    } = resolveCaseSlots(sem, c, isSaveIntent);
    const cancelMutationSlots = componentSlots.filter(
      sl => sl.role === 'cancel' && sl.calls.some(call => WRITE_OR_PICK_ACTIONS.has(call.name)),
    );
    const misboundMutationSlots = componentSlots.filter(
      sl =>
        sl.role !== 'cancel' &&
        READ_ONLY_LABEL_PATTERN.test(sl.label.trim()) &&
        sl.calls.some(call => WRITE_OR_PICK_ACTIONS.has(call.name)),
    );
    const pageHasForms = sem.forms.size > 0;
    const pageFakeSaveSlots = sem.slots.filter(sl => isFakeSaveSlot(sl, pageHasForms));
    const nodeFakeSaveSlots = allSlots.filter(sl => isFakeSaveSlot(sl, pageHasForms));
    const pageCancelMutations = sem.slots.filter(
      sl => sl.role === 'cancel' && sl.calls.some(call => WRITE_OR_PICK_ACTIONS.has(call.name)),
    );
    const pageMisboundMutations = sem.slots.filter(
      sl =>
        sl.role !== 'cancel' &&
        READ_ONLY_LABEL_PATTERN.test(sl.label.trim()) &&
        sl.calls.some(call => WRITE_OR_PICK_ACTIONS.has(call.name)),
    );

    let status = '待业务验收';
    if (!sourceValid) {
      status = '脑图来源已变化';
    } else if (specificEventMissing) {
      status = '指定事件未绑定可操作动作';
    } else if (c.actionPfId && !allSlots.length) {
      status = '待绑定可操作入口';
    } else if (c.actionPfId && !activeSlots.length) {
      status = cancelMutationSlots.length
        ? '正向业务动作不能绑定在取消或关闭操作上'
        : misboundMutationSlots.length
          ? '正向业务动作不能绑定在只读或预览操作上'
          : '待绑定可操作入口';
    } else if (nodeFakeSaveSlots.length > 0 || (isSaveIntent && pageFakeSaveSlots.length > 0)) {
      status = '不能仅用提示或关窗代替实际保存动作';
    } else if (cancelMutationSlots.length > 0 || (isSaveIntent && pageCancelMutations.length > 0)) {
      status = '正向业务动作不能绑定在取消或关闭操作上';
    } else if (misboundMutationSlots.length > 0 || (isSaveIntent && pageMisboundMutations.length > 0)) {
      status = '正向业务动作不能绑定在只读或预览操作上';
    } else if (c.actionPfId && activeSlots.length > 0) {
      const allFeedbackOnly = activeSlots.every(sl => sl.calls.every(call => FEEDBACK_ONLY_CALLS.has(call.name)));
      const hasSubmitLabel = activeSlots.some(sl => sl.role !== 'cancel' && FORM_SUBMIT_BUTTON_PATTERN.test(sl.label));
      if (c.actionKind === 'submitForm') {
        const results = activeSlots.map(sl => checkSubmitSlot(sl, sem, c)).filter((r): r is string => r !== null);
        if (!results.length) {
          status = allFeedbackOnly ? '不能仅用提示或关窗代替实际保存动作' : '待绑定表单提交动作（submitForm）';
        } else if (!results.includes('OK')) {
          status = results[0];
        }
      } else if (c.actionKind === 'openOverlay') {
        const opens = activeSlots.flatMap(sl => sl.calls.filter(call => call.name === 'openModal' || call.name === 'openDrawer'));
        if (!opens.length) status = '待绑定打开弹层动作';
        else if (c.targetId ? (!opens.some(call => call.args[0] === c.targetId) || !sem.overlays.has(c.targetId))
          : opens.every(call => typeof call.args[0] !== 'string' || !sem.overlays.has(call.args[0]))) {
          status = '打开弹层目标不匹配或弹层不存在';
        } else {
          const relevantOpens = c.targetId ? opens.filter(call => call.args[0] === c.targetId) : opens;
          if (relevantOpens.some(call => call.args.length >= 2 && hasInvalidOverlayParams(call.args[1]) !== null)) {
            status = '打开弹层参数不能覆盖系统保留字段 row/tableId';
          }
        }
      } else if (c.actionKind === 'navigate') {
        status = checkNavigation(activeSlots, c) ?? status;
      } else if (c.actionKind === 'closeOverlay') {
        status = checkCloseOverlay(activeSlots, c) ?? status;
      } else if (c.actionKind === 'updateRow') {
        const results = activeSlots.map(sl => checkUpdateRowSlot(sl, c)).filter((r): r is string => r !== null);
        if (!results.length) {
          status = allFeedbackOnly ? '不能仅用提示代替状态修改动作（updateRow）' : '待绑定记录状态修改动作（updateRow）';
        } else if (!results.includes('OK')) {
          status = results[0];
        }
      } else if (c.actionKind === 'deleteRow') {
        const results = activeSlots.map(sl => checkDeleteRowSlot(sl, c)).filter((r): r is string => r !== null);
        if (!results.length) status = '待绑定删除记录动作（deleteRow）';
        else if (!results.includes('OK')) status = results[0];
      } else if (c.actionKind === 'returnSelection') {
        const pickSlots = activeSlots.filter(sl => sl.calls.some(call => call.name === 'returnSelection'));
        if (!pickSlots.length) {
          status = '待绑定选单回填动作（returnSelection）';
        } else {
          let failReason = '';
          const ok = pickSlots.some(sl =>
            sl.calls.some(call => {
              if (call.name !== 'returnSelection') return false;
              const tblPfId = typeof call.args[0] === 'string' ? call.args[0] : '';
              if (!sem.pickerTables.has(tblPfId) || (c.targetId && tblPfId !== c.targetId)) {
                failReason = '回填动作未指向目标选单表格';
                return false;
              }
              const boundTable = sem.pickerTables.get(tblPfId);
              if (!boundTable || !tables.has(boundTable) || (c.tableId && boundTable !== c.tableId)) {
                failReason = '回填选单表格未绑定有效目标数据表';
                return false;
              }
              if (c.field && !(call.args[2] === c.field || (call.args[2] === undefined && call.args[1] === c.field))) {
                failReason = '回填动作未绑定指定来源字段';
                return false;
              }
              return true;
            }),
          );
          if (!ok) status = failReason || '回填动作配置无效';
        }
      } else {
        if (
          allFeedbackOnly &&
          (EXPLICIT_SAVE_CLAIM_PATTERN.test(positiveIntentText) ||
            (hasSubmitLabel && (pageHasForms || SAVE_SCENARIO_PATTERN.test(positiveIntentText))))
        ) {
          status = '不能仅用提示或关窗代替实际保存动作';
        } else {
          // Legacy cases have no actionKind. A return/cancel event still needs an
          // actual, valid navigation or an in-overlay close; toast alone is not an exit.
          const cancelSlots = activeSlots.filter(sl => sl.role === 'cancel');
          if (cancelSlots.length) {
            if (cancelSlots.some(sl => !sl.calls.some(call => call.name === 'navigate' || call.name === 'closeOverlay')))
              status = '返回或关闭场景未绑定 navigate/closeOverlay 动作';
            else {
              if (cancelSlots.some(sl => sl.calls.some(call => call.name === 'navigate')))
                status = checkNavigation(cancelSlots, c) ?? status;
              if (cancelSlots.some(sl => sl.calls.some(call => call.name === 'closeOverlay')))
                status = checkCloseOverlay(cancelSlots, c) ?? status;
            }
          }
          const submitResults = activeSlots.map(sl => checkSubmitSlot(sl, sem, c)).filter((r): r is string => r !== null);
          if (submitResults.length > 0 && !submitResults.includes('OK')) {
            status = submitResults[0];
          }
          if (
            status === '待业务验收' &&
            isSaveIntent &&
            !activeSlots.some(sl => sl.calls.some(call => WRITE_OR_PICK_ACTIONS.has(call.name)))
          ) {
            status = '保存场景未绑定 submitForm/updateRow 等实际写入动作';
          }
          const updateResults = activeSlots.map(sl => checkUpdateRowSlot(sl, c)).filter((r): r is string => r !== null);
          if (status === '待业务验收' && updateResults.length > 0 && !updateResults.includes('OK')) {
            status = updateResults[0];
          }
          const deleteResults = activeSlots.map(sl => checkDeleteRowSlot(sl, c)).filter((r): r is string => r !== null);
          if (status === '待业务验收' && deleteResults.length > 0 && !deleteResults.includes('OK')) {
            status = deleteResults[0];
          }
          if (
            status === '待业务验收' &&
            activeSlots.some(sl =>
              sl.calls.some(
                call =>
                  (call.name === 'openModal' || call.name === 'openDrawer') &&
                  call.args.length >= 2 &&
                  hasInvalidOverlayParams(call.args[1]) !== null,
              ),
            )
          ) {
            status = '打开弹层参数不能覆盖系统保留字段 row/tableId';
          }
        }
      }
    } else if (!c.actionPfId && pageFacts.contractErrors.length > 0) {
      status = pageFacts.contractErrors[0];
    }
    if (status === '待业务验收' && c.chart && (!tables.has(c.chart.tableId) || pageFacts.charts.get(c.chart.pfId) !== c.chart.tableId)) {
      status = '图表待绑定约定的数据表';
    }
    return { pageId: page.pageId, ...c, status };
  }));
  const sampleCharts = pages.flatMap(page => inspect(page.pageId).sampleCharts.map(pfId => ({pageId:page.pageId, pfId})));
  return { links, cases, sampleCharts, undeclaredPageIds: pages.filter(p => p.dependencies === undefined).map(p => p.pageId) };
}

/** Check both directions when completing a page. Cycles can be drafted until the
 * second endpoint exists, at which point both sides must satisfy the approved plan. */
export function generationEvidenceIssues(snapshot: Inputs, completedNow: string[]) {
  const plan = snapshot.projectPlan;
  if (!plan || !completedNow.length) return [];
  const changed = new Set(completedNow);
  const completed = new Set([...plan.generatedPageIds, ...completedNow]);
  const planned = new Set(plan.pages.map(p => p.pageId));
  const ready = (id: string) => completed.has(id) || (!planned.has(id) && Object.hasOwn(snapshot.pageSources,id));
  const review = reviewPageDependencies(snapshot);
  const failingCaseItems = review.cases.filter(c => changed.has(c.pageId) && c.status !== '待业务验收');
  const reportedPfIdsByPage = new Map<string, Set<string>>();
  for (const item of failingCaseItems) {
    if (!item.actionPfId) continue;
    let set = reportedPfIdsByPage.get(item.pageId);
    if (!set) {
      set = new Set<string>();
      reportedPfIdsByPage.set(item.pageId, set);
    }
    set.add(item.actionPfId);
    const dotIdx = item.actionPfId.indexOf('.');
    if (dotIdx > 0) set.add(item.actionPfId.slice(0, dotIdx));
  }
  const actionContractIssues = completedNow.flatMap(pageId => {
    const source = snapshot.pageSources[pageId];
    const doc = source && parsePageSource(source).doc;
    if (!doc) return [];
    const sem = extractPageActionSemantics(doc.root, snapshot.dbTables);
    const alreadyReported = reportedPfIdsByPage.get(pageId) ?? new Set<string>();
    return semanticActionContractIssues(sem, snapshot.dbTables, { strictBusinessPersistence: true })
      .filter(
        issue =>
          issue.code === 'cancel-mutation' ||
          issue.code === 'misbound-mutation' ||
          issue.code === 'reserved-overlay-param' ||
          !alreadyReported.has(issue.pfId),
      )
      .map(issue => `${pageId} · ${issue.message}`);
  });
  return [
    ...review.links.filter(l => l.kind !== 'pending' && l.status !== '已核对结构与页面绑定' &&
      ready(l.pageId) && ready(l.sourcePageId) && (changed.has(l.pageId) || changed.has(l.sourcePageId)))
      .map(l => `${l.pageId} ← ${l.sourcePageId} · ${l.requirement}（${l.status}）`),
    ...failingCaseItems.map(c => `${c.pageId} · ${c.scenario}（${c.status}）`),
    ...actionContractIssues,
  ];
}

/** Order generation independently from menu display. Cyclic business flows stay in
 * plan order when no prerequisite can be advanced; the final review keeps open links visible. */
export function pageGenerationOrder(pages: ProjectPlan['pages'], completed: string[]) {
  const remaining = new Map(pages.map(p => [p.pageId,p]));
  const ready = new Set(completed);
  const result: ProjectPlan['pages'] = [];
  while (remaining.size) {
    const items = [...remaining.values()];
    const page = items.find(p => (p.dependencies ?? []).every(d =>
      d.kind === 'pending' || ready.has(d.sourcePageId) || !remaining.has(d.sourcePageId))) ?? items[0];
    result.push(page);
    ready.add(page.pageId); remaining.delete(page.pageId);
  }
  return result;
}

export function regressedPageDependencies(before: Inputs, after: Inputs) {
  const fingerprint = ({status: _status, ...link}: ReturnType<typeof reviewPageDependencies>['links'][number]) =>
    JSON.stringify([link.pageId, link.sourcePageId, link.kind, link.kind !== 'pending' && link.sourceTableId,
      link.kind === 'foreignKey' && link.sourceColumnId, link.kind === 'foreignKey' && link.tableId, link.kind === 'foreignKey' && link.foreignKeyColumnId]);
  const verified = new Set(reviewPageDependencies(before).links.filter(l => l.status === '已核对结构与页面绑定').map(fingerprint));
  return reviewPageDependencies(after).links.filter(l => l.status !== '已核对结构与页面绑定' && verified.has(fingerprint(l)));
}
