import type { DBTableSchema } from '../../store/useProtoStore';
import { OVERLAY_TYPES } from '../registry/meta';
import { importSelectedRowsContractErrors } from '../runtime/rowTransfer';
import { isActionChain, isNode, isRawExpr, type ActionCall, type PropValue, type ProtoNode } from '../types';

export type EventSlotRole = 'primary' | 'cancel' | 'other';

export interface EventSlot {
  pfId: string;
  nodeType: string;
  path: string;
  role: EventSlotRole;
  label: string;
  calls: ActionCall[];
  directRowTableId: string | null;
  enclosingOverlayId: string | null;
  rowTableIds: Set<string>;
  hasUncontextualizedEntry: boolean;
  hasGuaranteedRowContext: boolean;
}

export interface SemanticActionError {
  pfId: string;
  path: string;
  code:
    | 'fake-save'
    | 'cancel-mutation'
    | 'misbound-mutation'
    | 'reserved-overlay-param'
    | 'unbound-form'
    | 'unknown-table'
    | 'missing-row-context'
    | 'invalid-row-patch'
    | 'unbound-picker'
    | 'invalid-row-transfer';
  message: string;
}

export const RESERVED_OVERLAY_PARAM_KEYS = ['row', 'tableId'] as const;

export function hasInvalidOverlayParams(arg: PropValue | undefined): 'invalid-type' | 'reserved-key' | null {
  if (arg === undefined) return null;
  if (arg === null || typeof arg !== 'object' || Array.isArray(arg) || isActionChain(arg) || isRawExpr(arg)) {
    return 'invalid-type';
  }
  for (const key of RESERVED_OVERLAY_PARAM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(arg, key)) {
      return 'reserved-key';
    }
  }
  return null;
}

export interface PageActionSemantics {
  forms: Map<string, { node: ProtoNode; tableId: string | null }>;
  overlays: Set<string>;
  openedOverlays: Set<string>;
  pickerTables: Map<string, string | null>;
  tableNodes: Map<string, ProtoNode>;
  nodeTypes: Map<string, string>;
  slots: EventSlot[];
  slotsByPfId: Map<string, EventSlot[]>;
  slotsByQualifiedId: Map<string, EventSlot>;
  labels: Map<string, string>;
}

export const FEEDBACK_ONLY_CALLS = new Set(['toast', 'closeOverlay']);
const MUTATION_OR_PICK_CALLS = new Set([
  'submitForm',
  'updateRow',
  'deleteRow',
  'returnSelection',
  'importPurchaseOrderLines',
  'importSelectedRows',
]);

export const CANCEL_LABEL_PATTERN = /^(取消|关闭|返回|放弃|暂不保存|暂不提交)$/;
export const READ_ONLY_LABEL_PATTERN = /^(预览|查看|查看详情|详情|搜索|查询|筛选|重置|清空)$/;
export const EXPLICIT_SAVE_BUTTON_PATTERN = /^(保存|确认保存|保存修改|保存提交|保存需求|立即保存|提交保存)$/;
export const FORM_SUBMIT_BUTTON_PATTERN = /(保存|提交|确认保存|确认提交)/;

const strProp = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function nodeInlineLabel(node: ProtoNode): string {
  return node.children
    .flatMap((c) => (c.kind === 'text' ? [c.value] : []))
    .join(' ')
    .trim();
}

export function nodeDisplayLabel(node: ProtoNode): string {
  const inlineText = nodeInlineLabel(node);
  const propText = [node.props.primaryText, node.props.confirmText, node.props.label, node.props.title]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
  return `${inlineText} ${propText}`.trim();
}

function validCalls(chain: PropValue | undefined): ActionCall[] | null {
  if (!isActionChain(chain) || !Array.isArray(chain.calls)) return null;
  return chain.calls.filter(
    (call): call is ActionCall =>
      Boolean(call) && typeof call.name === 'string' && Array.isArray(call.args),
  );
}

export function isFakeSaveSlot(slot: EventSlot, hasFormsOnPage: boolean): boolean {
  if (slot.role === 'cancel' || slot.calls.length === 0) return false;
  if (!slot.calls.every((call) => FEEDBACK_ONLY_CALLS.has(call.name))) return false;
  const trimmed = slot.label.trim();
  if (!trimmed) return false;
  if (EXPLICIT_SAVE_BUTTON_PATTERN.test(trimmed)) return true;
  if (hasFormsOnPage && FORM_SUBMIT_BUTTON_PATTERN.test(trimmed)) return true;
  return false;
}

export function extractPageActionSemantics(
  root: ProtoNode,
  tables: DBTableSchema[] = [],
): PageActionSemantics {
  const safeTables = Array.isArray(tables) ? tables : [];
  const tableMap = new Map(safeTables.map((t) => [t.id, t]));
  const forms = new Map<string, { node: ProtoNode; tableId: string | null }>();
  const overlays = new Set<string>();
  const overlayAliases = new Map<string, string>();
  const openedOverlays = new Set<string>();
  const pickerTables = new Map<string, string | null>();
  const tableNodes = new Map<string, ProtoNode>();
  const nodeTypes = new Map<string, string>();
  const slots: EventSlot[] = [];
  const slotsByPfId = new Map<string, EventSlot[]>();
  const slotsByQualifiedId = new Map<string, EventSlot>();
  const labels = new Map<string, string>();

  const addSlot = (
    node: ProtoNode,
    path: string,
    role: EventSlotRole,
    label: string,
    chain: PropValue | undefined,
    directRowTableId: string | null,
    enclosingOverlayId: string | null,
  ) => {
    const calls = validCalls(chain);
    if (!calls) return;
    const slot: EventSlot = {
      pfId: node.pfId,
      nodeType: node.type,
      path,
      role,
      label: label.trim(),
      calls,
      directRowTableId,
      enclosingOverlayId,
      rowTableIds: new Set<string>(),
      hasUncontextualizedEntry: false,
      hasGuaranteedRowContext: false,
    };
    slots.push(slot);
    const list = slotsByPfId.get(node.pfId) ?? [];
    list.push(slot);
    slotsByPfId.set(node.pfId, list);
    slotsByQualifiedId.set(`${node.pfId}.${path}`, slot);
  };

  const visit = (node: ProtoNode, enclosingOverlayId: string | null, enclosingRowTableId: string | null = null) => {
    nodeTypes.set(node.pfId, node.type);
    let currentOverlayId = enclosingOverlayId;
    let currentRowTableId = enclosingRowTableId;
    if (OVERLAY_TYPES.has(node.type)) {
      const explicitId = strProp(node.props.id);
      const oid = explicitId || node.pfId;
      overlays.add(oid);
      overlayAliases.set(oid, oid);
      overlayAliases.set(node.pfId, oid);
      if (explicitId) overlays.add(node.pfId);
      currentOverlayId = oid;
      currentRowTableId = null;
    }
    if (
      (node.type === 'Card' || node.type === 'MSurface') &&
      typeof node.props.activeTable === 'string' &&
      tableMap.has(node.props.activeTable)
    ) {
      currentRowTableId = node.props.activeTable;
    }
    if (
      (node.type === 'Repeater' || node.type === 'MRepeater') &&
      typeof node.props.table === 'string' &&
      tableMap.has(node.props.table)
    ) {
      currentRowTableId = node.props.table;
    }
    if (node.type === 'Form' || node.type === 'MForm') {
      const rawTable = strProp(node.props.table);
      forms.set(node.pfId, { node, tableId: rawTable || null });
    }
    if (node.type === 'Table') {
      const rawTable = strProp(node.props.table);
      pickerTables.set(node.pfId, rawTable || null);
      tableNodes.set(node.pfId, node);
    }
    const displayLabel = nodeDisplayLabel(node);
    labels.set(node.pfId, displayLabel);

    if (node.props.disabled !== true) {
      const handledProps = new Set<string>();
      const boundRowTable =
        ['Table', 'CardGrid', 'Repeater', 'Kanban', 'Calendar', 'ProgressBoard', 'ActivityFeed', 'MTaskList', 'MFeedList', 'MCardGrid', 'MRepeater', 'MKanban', 'MCalendar', 'MProgressList', 'MActivityList'].includes(node.type) &&
        typeof node.props.table === 'string' &&
        tableMap.has(node.props.table)
          ? node.props.table
          : null;

      if (node.type === 'MBottomDock') {
        handledProps.add('onPrimary');
        handledProps.add('onSecondary');
        const pLabel = strProp(node.props.primaryText) || '主操作';
        addSlot(
          node,
          'onPrimary',
          CANCEL_LABEL_PATTERN.test(pLabel) ? 'cancel' : 'primary',
          pLabel,
          node.props.onPrimary,
          null,
          currentOverlayId,
        );
        const sLabel = strProp(node.props.secondaryText);
        addSlot(
          node,
          'onSecondary',
          !sLabel || CANCEL_LABEL_PATTERN.test(sLabel) ? 'cancel' : 'other',
          sLabel || '次要操作',
          node.props.onSecondary,
          null,
          currentOverlayId,
        );
      } else if (node.type === 'Modal') {
        handledProps.add('onOk');
        handledProps.add('onClose');
        const okLabel = strProp(node.props.okText) || '确定';
        addSlot(
          node,
          'onOk',
          CANCEL_LABEL_PATTERN.test(okLabel) ? 'cancel' : 'primary',
          okLabel,
          node.props.onOk,
          null,
          currentOverlayId,
        );
        addSlot(
          node,
          'onClose',
          'cancel',
          strProp(node.props.cancelText) || '取消',
          node.props.onClose,
          null,
          currentOverlayId,
        );
      } else if (node.type === 'MDialog') {
        handledProps.add('onConfirm');
        handledProps.add('onClose');
        const confirmLabel = strProp(node.props.confirmText) || '确定';
        addSlot(
          node,
          'onConfirm',
          CANCEL_LABEL_PATTERN.test(confirmLabel) ? 'cancel' : 'primary',
          confirmLabel,
          node.props.onConfirm,
          null,
          currentOverlayId,
        );
        addSlot(
          node,
          'onClose',
          'cancel',
          strProp(node.props.cancelText) || '取消',
          node.props.onClose,
          null,
          currentOverlayId,
        );
      } else if (node.type === 'Popconfirm') {
        handledProps.add('onConfirm');
        handledProps.add('onCancel');
        const okLabel = strProp(node.props.okText) || displayLabel || '确认';
        addSlot(node, 'onConfirm', 'primary', okLabel, node.props.onConfirm, null, currentOverlayId);
        addSlot(
          node,
          'onCancel',
          'cancel',
          strProp(node.props.cancelText) || '取消',
          node.props.onCancel,
          null,
          currentOverlayId,
        );
      } else if (node.type === 'MTopBar') {
        handledProps.add('onLeftClick');
        handledProps.add('onTitleClick');
        handledProps.add('onRightClick');
        const leftLabel = strProp(node.props.leftText) || (node.props.leftMode === 'back' ? '返回' : '左侧操作');
        addSlot(
          node,
          'onLeftClick',
          node.props.leftMode === 'back' || CANCEL_LABEL_PATTERN.test(leftLabel) ? 'cancel' : 'primary',
          leftLabel,
          node.props.onLeftClick,
          null,
          currentOverlayId,
        );
        addSlot(node, 'onTitleClick', 'primary', strProp(node.props.title), node.props.onTitleClick, null, currentOverlayId);
        const rightLabel = strProp(node.props.rightText) || '右侧操作';
        addSlot(
          node,
          'onRightClick',
          CANCEL_LABEL_PATTERN.test(rightLabel) ? 'cancel' : 'primary',
          rightLabel,
          node.props.onRightClick,
          null,
          currentOverlayId,
        );
      }

      if (node.type === 'Table' || node.type === 'CardGrid' || node.type === 'Kanban' || node.type === 'ActivityFeed' || node.type === 'MTaskList' || node.type === 'MKanban' || node.type === 'MActivityList') {
        const rowSlotOverlayId = boundRowTable ? currentOverlayId : null;
        const rowClickKey =
          node.type === 'Table'
            ? 'onRowClick'
            : node.type === 'CardGrid' || node.type === 'ActivityFeed' || node.type === 'MActivityList'
            ? 'onItemClick'
            : 'onCardClick';
        handledProps.add(rowClickKey);
        handledProps.add('rowActions');
        addSlot(
          node,
          rowClickKey,
          'primary',
          strProp(node.props.title) || rowClickKey,
          node.props[rowClickKey],
          boundRowTable,
          rowSlotOverlayId,
        );
        if (Array.isArray(node.props.rowActions)) {
          node.props.rowActions.forEach((item, i) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return;
            const rec = item as Record<string, PropValue>;
            const actLabel = strProp(rec.label) || `rowActions[${i}]`;
            addSlot(
              node,
              `rowActions[${i}].onClick`,
              CANCEL_LABEL_PATTERN.test(actLabel) ? 'cancel' : 'primary',
              actLabel,
              rec.onClick,
              boundRowTable,
              rowSlotOverlayId,
            );
          });
        }
      } else if (node.type === 'MFeedList' || node.type === 'MCardGrid' || node.type === 'MProgressList' || node.type === 'ProgressBoard' || node.type === 'Repeater' || node.type === 'MRepeater') {
        const rowSlotOverlayId = boundRowTable ? currentOverlayId : null;
        handledProps.add('onItemClick');
        addSlot(
          node,
          'onItemClick',
          'primary',
          strProp(node.props.title) || 'onItemClick',
          node.props.onItemClick,
          boundRowTable,
          rowSlotOverlayId,
        );
      } else if (node.type === 'Calendar' || node.type === 'MCalendar') {
        const rowSlotOverlayId = boundRowTable ? currentOverlayId : null;
        handledProps.add('onEventClick');
        addSlot(
          node,
          'onEventClick',
          'primary',
          strProp(node.props.title) || 'onEventClick',
          node.props.onEventClick,
          boundRowTable,
          rowSlotOverlayId,
        );
      }

      if (
        (node.type === 'MBentoGrid' || node.type === 'MTabBar' || node.type === 'MListGroup' || node.type === 'NavMenu' || node.type === 'Dropdown' || node.type === 'Carousel' || node.type === 'MBannerCarousel' || node.type === 'AiCopilotCard' || node.type === 'MAiInsightCard' || node.type === 'ProgressBoard' || node.type === 'ActivityFeed' || node.type === 'MProgressList' || node.type === 'MActivityList') &&
        Array.isArray(node.props.items)
      ) {
        const isCollectionStaticList =
          node.type === 'ProgressBoard' ||
          node.type === 'ActivityFeed' ||
          node.type === 'MProgressList' ||
          node.type === 'MActivityList';
        handledProps.add('items');
        node.props.items.forEach((item, i) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return;
          const rec = item as Record<string, PropValue>;
          const itemLabel = strProp(rec.title) || strProp(rec.label) || `items[${i}]`;
          addSlot(
            node,
            `items[${i}].onClick`,
            CANCEL_LABEL_PATTERN.test(itemLabel) ? 'cancel' : 'primary',
            itemLabel,
            rec.onClick,
            isCollectionStaticList ? boundRowTable : currentRowTableId,
            isCollectionStaticList ? (boundRowTable ? currentOverlayId : null) : currentOverlayId,
          );
        });
      }

      if ((node.type === 'Form' || node.type === 'QueryForm') && Array.isArray(node.props.fields)) {
        handledProps.add('fields');
        node.props.fields.forEach((field, i) => {
          if (!field || typeof field !== 'object' || Array.isArray(field)) return;
          const rec = field as Record<string, PropValue>;
          addSlot(
            node,
            `fields[${i}].onChange`,
            'other',
            strProp(rec.label) || strProp(rec.name) || `fields[${i}]`,
            rec.onChange,
            null,
            currentOverlayId,
          );
        });
      }

      for (const [key, val] of Object.entries(node.props)) {
        if (handledProps.has(key) || !isActionChain(val)) continue;
        const inlineLabel = nodeInlineLabel(node) || displayLabel;
        const role: EventSlotRole =
          key === 'onCancel' || key === 'onClose' || key === 'onBack'
            ? 'cancel'
            : key === 'onChange'
              ? 'other'
              : CANCEL_LABEL_PATTERN.test(inlineLabel)
                ? 'cancel'
                : 'primary';
        addSlot(node, key, role, inlineLabel, val, currentRowTableId, currentOverlayId);
      }
    }

    node.children.filter(isNode).forEach((child) => visit(child, currentOverlayId, currentRowTableId));
  };

  visit(root, null);

  const canonicalOverlay = (raw: string) => overlayAliases.get(raw) ?? raw;

  for (const slot of slots) {
    for (const call of slot.calls) {
      if ((call.name === 'openModal' || call.name === 'openDrawer') && typeof call.args[0] === 'string' && call.args[0]) {
        openedOverlays.add(call.args[0]);
        openedOverlays.add(canonicalOverlay(call.args[0]));
      }
    }
  }

  // Propagate all possible runtime row contexts (tableId | null) across openModal / openDrawer chains.
  // An overlay opened from both a table row (`tid`) and a top-bar button (`null`) receives `{ tid, null }`,
  // exposing that `ctx.row` is undefined when opened from the non-row entry.
  const overlayPossibleRowContexts = new Map<string, Set<string | null>>();
  const slotPossibleContexts = (slot: EventSlot): Set<string | null> => {
    if (slot.directRowTableId !== null) {
      return new Set<string | null>([slot.directRowTableId]);
    }
    if (slot.enclosingOverlayId === null) {
      return new Set<string | null>([null]);
    }
    return new Set<string | null>(overlayPossibleRowContexts.get(slot.enclosingOverlayId) ?? []);
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const slot of slots) {
      const ctxs = slotPossibleContexts(slot);
      if (ctxs.size === 0) continue;
      for (const call of slot.calls) {
        if ((call.name === 'openModal' || call.name === 'openDrawer') && typeof call.args[0] === 'string' && call.args[0]) {
          const targetId = canonicalOverlay(call.args[0]);
          let targetSet = overlayPossibleRowContexts.get(targetId);
          if (!targetSet) {
            targetSet = new Set<string | null>();
            overlayPossibleRowContexts.set(targetId, targetSet);
          }
          const paramViolation = call.args.length >= 2 ? hasInvalidOverlayParams(call.args[1]) : null;
          const propagatedContexts: Iterable<string | null> = paramViolation ? [null] : ctxs;
          for (const ctx of propagatedContexts) {
            if (!targetSet.has(ctx)) {
              targetSet.add(ctx);
              changed = true;
            }
          }
        }
      }
    }
  }

  for (const slot of slots) {
    const ctxs = slotPossibleContexts(slot);
    for (const ctx of ctxs) {
      if (ctx !== null) slot.rowTableIds.add(ctx);
    }
    slot.hasUncontextualizedEntry = ctxs.has(null);
    slot.hasGuaranteedRowContext = slot.rowTableIds.size > 0 && !slot.hasUncontextualizedEntry;
  }

  return {
    forms,
    overlays,
    openedOverlays,
    pickerTables,
    tableNodes,
    nodeTypes,
    slots,
    slotsByPfId,
    slotsByQualifiedId,
    labels,
  };
}

export function semanticActionContractIssues(
  semantics: PageActionSemantics,
  tables: DBTableSchema[] = [],
  options?: { strictBusinessPersistence?: boolean },
): SemanticActionError[] {
  const strict = options?.strictBusinessPersistence === true;
  const safeTables = Array.isArray(tables) ? tables : [];
  const issues: SemanticActionError[] = [];
  const tableMap = new Map(safeTables.map((t) => [t.id, t]));
  const hasFormsOnPage = semantics.forms.size > 0;

  // Track which overlays contain (directly or transitively) a non-cancel business write/pick action.
  const overlaysWithMutations = new Set<string>();
  let mutChanged = true;
  while (mutChanged) {
    mutChanged = false;
    for (const sl of semantics.slots) {
      if (sl.role === 'cancel' || !sl.enclosingOverlayId || overlaysWithMutations.has(sl.enclosingOverlayId)) continue;
      const writesOrDelegates = sl.calls.some(
        (c) =>
          MUTATION_OR_PICK_CALLS.has(c.name) ||
          ((c.name === 'openModal' || c.name === 'openDrawer') &&
            typeof c.args[0] === 'string' &&
            overlaysWithMutations.has(c.args[0])),
      );
      if (writesOrDelegates) {
        overlaysWithMutations.add(sl.enclosingOverlayId);
        mutChanged = true;
      }
    }
  }

  const push = (
    slot: EventSlot,
    code: SemanticActionError['code'],
    detail: string,
  ) => {
    issues.push({
      pfId: slot.pfId,
      path: slot.path,
      code,
      message: `${slot.pfId}.${slot.path}:${detail}`,
    });
  };

  for (const slot of semantics.slots) {
    const trimmedLabel = slot.label.trim();
    const hasDirectWrite = slot.calls.some((c) => MUTATION_OR_PICK_CALLS.has(c.name));
    const delegatesToMutatingOverlay = slot.calls.some(
      (c) =>
        (c.name === 'openModal' || c.name === 'openDrawer') &&
        typeof c.args[0] === 'string' &&
        overlaysWithMutations.has(c.args[0]),
    );
    const opensReadOnlyOverlay =
      !hasDirectWrite &&
      !delegatesToMutatingOverlay &&
      slot.calls.some(
        (c) =>
          (c.name === 'openModal' || c.name === 'openDrawer') &&
          typeof c.args[0] === 'string' &&
          semantics.overlays.has(c.args[0]),
      );

    if (strict && isFakeSaveSlot(slot, hasFormsOnPage)) {
      push(
        slot,
        'fake-save',
        `保存/提交操作「${slot.label}」仅调用了提示或关窗，缺少 submitForm/updateRow 等实际业务动作`,
      );
    } else if (
      slot.role !== 'cancel' &&
      slot.calls.length > 0 &&
      EXPLICIT_SAVE_BUTTON_PATTERN.test(trimmedLabel) &&
      !hasDirectWrite &&
      !delegatesToMutatingOverlay &&
      (strict || opensReadOnlyOverlay)
    ) {
      push(
        slot,
        'fake-save',
        `保存操作「${slot.label}」未绑定 submitForm/updateRow 等实际写入动作`,
      );
    }

    if (slot.role === 'cancel') {
      for (const call of slot.calls) {
        if (MUTATION_OR_PICK_CALLS.has(call.name)) {
          push(
            slot,
            'cancel-mutation',
            `取消或关闭操作「${slot.label || slot.path}」不能绑定业务写入或回填动作 ${call.name}`,
          );
        }
      }
    } else if (READ_ONLY_LABEL_PATTERN.test(trimmedLabel)) {
      for (const call of slot.calls) {
        if (MUTATION_OR_PICK_CALLS.has(call.name)) {
          push(
            slot,
            'misbound-mutation',
            `只读/预览类操作「${slot.label}」不能绑定业务写入或回填动作 ${call.name}`,
          );
        }
      }
    }

    for (const call of slot.calls) {
      if (call.name === 'openModal' || call.name === 'openDrawer') {
        const violation = call.args.length >= 2 ? hasInvalidOverlayParams(call.args[1]) : null;
        if (violation === 'invalid-type') {
          push(slot, 'reserved-overlay-param', `${call.name} 的第二个参数 params 必须是键值对象`);
        } else if (violation === 'reserved-key') {
          push(
            slot,
            'reserved-overlay-param',
            `${call.name} 的参数 params 不能覆盖系统保留的行上下文字段 row/tableId；当前行由列表/表格行事件自动传入，无行入口请拆分为独立弹层`,
          );
        }
      } else if (call.name === 'submitForm') {
        const formId = typeof call.args[0] === 'string' ? call.args[0] : '';
        const formInfo = semantics.forms.get(formId);
        if (formInfo) {
          if (!formInfo.tableId) {
            if (strict) {
              push(
                slot,
                'unbound-form',
                `submitForm("${formId}") 指向的表单未绑定物理数据表（缺少 table 属性），无法实际写入记录`,
              );
            }
          } else if (!tableMap.has(formInfo.tableId)) {
            push(
              slot,
              'unknown-table',
              `submitForm("${formId}") 指向的表单绑定了未知表 ${formInfo.tableId}`,
            );
          }
        }
      } else if (call.name === 'updateRow') {
        if (!slot.hasGuaranteedRowContext) {
          if (slot.hasUncontextualizedEntry && slot.rowTableIds.size > 0) {
            push(
              slot,
              'missing-row-context',
              'updateRow 所在的弹层存在无行上下文的打开入口（如顶部/全局按钮），从该入口打开时无法更新记录；请拆分为独立弹层或仅保留行级入口',
            );
          } else if (slot.hasUncontextualizedEntry || strict) {
            push(
              slot,
              'missing-row-context',
              'updateRow 缺少当前行数据上下文；必须放在绑定了真实数据表的 Table/MTaskList/MFeedList 行事件中，或由行事件打开的弹层内',
            );
          }
        } else {
          const patch = call.args[0];
          if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
            push(slot, 'invalid-row-patch', 'updateRow 必须提供至少一个待更新字段与值');
          } else {
            const keys = Object.keys(patch);
            const invalidTableId = [...slot.rowTableIds].find((tid) => {
              const tbl = tableMap.get(tid);
              return !tbl || !keys.every((k) => tbl.columns.some((col) => col.name === k));
            });
            if (invalidTableId) {
              const tbl = tableMap.get(invalidTableId);
              const badKey = keys.find((k) => !tbl?.columns.some((col) => col.name === k)) ?? keys[0];
              push(slot, 'invalid-row-patch', `updateRow 更新了未知字段 ${invalidTableId}.${badKey}`);
            }
          }
        }
      } else if (call.name === 'selectRow') {
        if (!slot.hasGuaranteedRowContext && (slot.hasUncontextualizedEntry || strict)) {
          push(
            slot,
            'missing-row-context',
            'selectRow 缺少当前行数据上下文；必须放在绑定了真实数据表的列表/表格/看板/日历行事件中',
          );
        }
      } else if (call.name === 'deleteRow') {
        if (!slot.hasGuaranteedRowContext) {
          if (slot.hasUncontextualizedEntry && slot.rowTableIds.size > 0) {
            push(
              slot,
              'missing-row-context',
              'deleteRow 所在的弹层存在无行上下文的打开入口（如顶部/全局按钮），从该入口打开时无法删除记录；请拆分为独立弹层或仅保留行级入口',
            );
          } else if (slot.hasUncontextualizedEntry || strict) {
            push(
              slot,
              'missing-row-context',
              'deleteRow 缺少当前行数据上下文；必须放在绑定了真实数据表的 Table/MTaskList/MFeedList 行事件中，或由行事件打开的弹层内',
            );
          }
        }
      } else if (call.name === 'navigate' && call.args[1] !== undefined) {
        if (!slot.hasGuaranteedRowContext) {
          if (slot.hasUncontextualizedEntry && slot.rowTableIds.size > 0) {
            push(
              slot,
              'missing-row-context',
              'navigate 携带当前行（"row"）所在的弹层存在无行上下文的打开入口，从该入口打开时缺少来源记录',
            );
          } else if (slot.hasUncontextualizedEntry || strict) {
            push(
              slot,
              'missing-row-context',
              'navigate 携带当前行（"row"）缺少来源行上下文；必须放在绑定了真实数据表的行事件或由行事件打开的弹层内',
            );
          }
        }
      } else if (call.name === 'returnSelection') {
        const tblPfId = typeof call.args[0] === 'string' ? call.args[0] : '';
        if (semantics.pickerTables.has(tblPfId)) {
          const boundTable = semantics.pickerTables.get(tblPfId);
          if (!boundTable || !tableMap.has(boundTable)) {
            if (strict || boundTable) {
              push(
                slot,
                'unbound-picker',
                `returnSelection("${tblPfId}") 指向的选单表格未绑定有效物理数据表`,
              );
            }
          }
        }
      } else if (call.name === 'importSelectedRows') {
        const srcPfId = typeof call.args[0] === 'string' ? call.args[0] : '';
        const dstPfId = typeof call.args[1] === 'string' ? call.args[1] : '';
        const srcNode = semantics.tableNodes.get(srcPfId);
        const dstNode = semantics.tableNodes.get(dstPfId);
        if (srcNode && srcNode.props.selectable !== true) {
          push(
            slot,
            'invalid-row-transfer',
            `importSelectedRows 来源表格 "${srcPfId}" 必须开启 selectable={true} 才能勾选要转入的记录`,
          );
        }
        if (srcNode && dstNode && safeTables.length > 0) {
          const srcTableId = strProp(srcNode.props.table) || undefined;
          const dstTableId = strProp(dstNode.props.table) || undefined;
          const defaultParentFk = strProp(dstNode.props.sourceForeignKey) || undefined;
          const transferErrs = importSelectedRowsContractErrors(
            safeTables,
            srcTableId,
            dstTableId,
            call.args[2],
            defaultParentFk,
          );
          for (const err of transferErrs) {
            push(slot, 'invalid-row-transfer', err);
          }
        }
      }
    }
  }

  return issues;
}

export function semanticActionContractErrors(
  semantics: PageActionSemantics,
  tables: DBTableSchema[] = [],
  options?: { strictBusinessPersistence?: boolean },
): string[] {
  return semanticActionContractIssues(semantics, tables, options).map((i) => i.message);
}
