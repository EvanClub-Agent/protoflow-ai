import { readPageHeader } from '../dsl/header';
import { axureSourcePagePattern, axureCopyId, verifiedAxureSourceId } from '../axure/task';
import { figmaSourcePagePattern, figmaCopyId, verifiedFigmaSourceId } from '../figma/task';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionChain, PropValue, ProtoDoc, ProtoNode } from '../types';
import { isActionChain, isNode } from '../types';
import { walk } from '../dsl/tree';
import { FIELD_TYPES, OVERLAY_TYPES } from '../registry/meta';
import { usePageStore } from '../store/usePageStore';
import { useProtoStore } from '../../store/useProtoStore';
import { PreviewDataContext } from './PreviewData';
import {
  buildForeignKeyOptionsFromRows,
  isQualifiedSupplierStatus,
  resolveBoundForeignKeySpec,
} from '../ai/templates';
import type { Row } from './mock';
import { projectPageCatalog } from '../../services/projectAnalysis';
import { td, tr, useLocale, type Locale } from '../../i18n';
import { valuesWithColumnDefaults } from '../database/columnDefault';
import {
  evaluateFieldConstraint,
  formatPokaYokeIssue,
  type FieldConstraintSpec,
  type FieldFormatRule,
  type PokaYokeIssue,
} from './pokaYoke';

export interface Scope {
  row?: Row;
  /** Physical table the current row belongs to */
  tableId?: string;
  /** Enforced target table when nested inside an explicit `activeTable` detail container */
  expectedTableId?: string;
  params?: Record<string, unknown>;
  /** Index in the overlay stack when rendering inside a live overlay */
  overlayIndex?: number;
}

/**
 * Computes a row-isolated draft key whenever a Form / MForm renders inside a
 * specific table record's row scope (both when editing that record directly and
 * when creating child records inside a parent Repeater / MRepeater card), while
 * keeping `node.pfId` unchanged in the AST and DOM for design selection.
 */
export function resolveFormInstanceKey(formPfId: string, formTable?: unknown, scope?: Scope): string {
  const row = (scope?.row ?? scope?.params?.row) as Row | undefined;
  const rowTableId = scope?.tableId ?? (scope?.params?.tableId as string | undefined);
  if (
    row &&
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    typeof formTable === 'string' &&
    formTable.length > 0 &&
    typeof rowTableId === 'string' &&
    rowTableId.length > 0
  ) {
    return `${formPfId}::row:${rowTableId}:${row.id}`;
  }
  return formPfId;
}

/**
 * Creates a child row scope for a bound data view (`Table`, `Repeater`, `CardGrid`,
 * `Kanban`, `Calendar`, `MTaskList`, etc.), updating `expectedTableId` to the child
 * view's own `tableId` when bound so an ancestor detail container's `activeTable`
 * never blocks legitimate row actions on child detail tables.
 */
export function childRowScope(scope: Scope, row: Row, tableId?: string): Scope {
  return {
    ...scope,
    row,
    tableId,
    expectedTableId: tableId ?? scope.expectedTableId,
  };
}

export interface PickerTargetSpec {
  targetPfId: string;
  pickerKey?: string;
  /** AST pfId of the owning Form node (for schema & FK validation) */
  formId?: string;
  /** Runtime draft bucket key (may include `::row:<tableId>:<rowId>`) */
  formKey?: string;
  name?: string;
}

export interface OverlayEntry {
  key: string;
  id: string;
  params: Record<string, unknown>;
  expectedTableId?: string;
  submittedForms?: Record<string, Row>;
  picker?: PickerTargetSpec;
}

export interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
  undoAction?: { label: string; onUndo: () => void };
}

export interface ConfirmDialogState {
  message: string;
  matchText?: string;
  resolve: (ok: boolean) => void;
}

export interface Runtime {
  isDesign: boolean;
  pageId: string;
  overlays: OverlayEntry[];
  vars: Record<string, unknown>;
  hidden: Record<string, boolean>;
  tabs: Record<string, number>;
  filters: Record<string, Record<string, unknown>>;
  pageNo: Record<string, number>;
  selections: Record<string, string[]>;
  activeRows: Record<string, string>;
  formValues: Record<string, Record<string, unknown>>;
  formErrors: Record<string, Record<string, string>>;
  pickerValues: Record<string, string>;
  toasts: ToastItem[];
  confirmState: ConfirmDialogState | null;

  setTab: (pfId: string, index: number) => void;
  setFilter: (pfId: string, values: Record<string, unknown>) => void;
  setPageNo: (pfId: string, n: number) => void;
  setSelection: (pfId: string, ids: string[]) => void;
  setActiveRow: (tableId: string, rowId: string | null) => void;
  getActiveRowId?: (tableId: string) => string | undefined;
  setFormValue: (formId: string, name: string, value: unknown) => void;
  setFormValues: (formId: string, values: Record<string, unknown>) => void;
  openOverlay: (overlayId: string, params?: Record<string, unknown>) => boolean;
  closeOverlay: () => void;
  openPicker: (overlayId: string, picker: PickerTargetSpec, scope: Scope) => void;
  run: (chain: PropValue | undefined, scope: Scope) => Promise<void>;
  resolveConfirm: (ok: boolean) => void;
  reset: () => void;
}

const RuntimeCtx = createContext<Runtime | null>(null);
export const useOptionalRuntime = () => useContext(RuntimeCtx);
export const useRuntime = () => {
  const r = useContext(RuntimeCtx);
  if (!r) throw new Error('Runtime context missing');
  return r;
};
export const RuntimeProvider = RuntimeCtx.Provider;

function lookupPlaceholderPath(
  path: string,
  scope: Scope,
  vars: Record<string, unknown>,
  forms?: Record<string, Record<string, unknown>>,
  doc?: ProtoDoc | null,
): unknown {
  const parts = path.split('.');
  if (parts[0] === 'form' && parts.length >= 3 && forms) {
    const form = doc && findById(doc, parts[1]);
    const key = resolveFormInstanceKey(parts[1], form?.props.table, scope);
    let cur: unknown = forms[key];
    for (const k of parts.slice(2)) {
      if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[k];
      else return undefined;
    }
    return cur;
  }
  let cur: unknown = {
    row: scope.row ?? scope.params?.row ?? {},
    params: scope.params ?? {},
    vars,
    form: forms ?? {},
  };
  for (const k of parts) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[k];
    else return undefined;
  }
  return cur;
}

/** Resolve `{{row.x}}`, `{{params.x}}`, `{{vars.x}}`, `{{form.<pfId>.x}}` display text placeholders. */
export function interpolate(
  text: string,
  scope: Scope,
  vars: Record<string, unknown>,
  forms?: Record<string, Record<string, unknown>>,
  doc?: ProtoDoc | null,
): string {
  if (!text.includes('{{')) return text;
  return text.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (_m, path: string) => {
    const cur = lookupPlaceholderPath(path, scope, vars, forms, doc);
    return cur === undefined || cur === null ? '' : String(cur);
  });
}

/**
 * Resolve an action payload value: when the entire value is a single `{{...}}` reference,
 * preserve its native runtime type (number, boolean, string, etc.); only coerce to string
 * when interpolating multi-part display text.
 */
export function resolveActionValue(
  raw: unknown,
  scope: Scope,
  vars: Record<string, unknown>,
  forms?: Record<string, Record<string, unknown>>,
  doc?: ProtoDoc | null,
): unknown {
  if (typeof raw !== 'string') return raw;
  const exact = /^\{\{\s*([\w.$-]+)\s*\}\}$/.exec(raw);
  if (exact) {
    const resolved = lookupPlaceholderPath(exact[1], scope, vars, forms, doc);
    if (resolved === undefined) {
      throw new Error(tr(`找不到动作引用 ${exact[1]}`, `Action reference ${exact[1]} has no value`));
    }
    return resolved;
  }
  return interpolate(raw, scope, vars, forms, doc);
}

export function findOverlay(doc: ProtoDoc | null, id: string): ProtoNode | null {
  if (!doc) return null;
  let found: ProtoNode | null = null;
  walk(doc.root, (n) => {
    if (!found && OVERLAY_TYPES.has(n.type) && n.props.id === id) found = n;
  });
  return found;
}

function findById(doc: ProtoDoc | null, pfId: string): ProtoNode | null {
  if (!doc) return null;
  let found: ProtoNode | null = null;
  walk(doc.root, (n) => {
    if (!found && n.pfId === pfId) found = n;
  });
  return found;
}

export function usesLiteralLayoutContent(frame: PropValue | undefined) {
  return Boolean(frame && typeof frame === 'object' && !Array.isArray(frame) &&
    (!('literalContent' in frame) || frame.literalContent !== false));
}

export interface FormFieldRuntimeSpec extends FieldConstraintSpec {
  required: boolean;
  initialValue?: string;
}

/** Field specs use the same interpolation and literal import rules as the rendered control. */
export function formFieldSpecs(form: ProtoNode, scope:Scope = {}, vars:Record<string,unknown> = {}): FormFieldRuntimeSpec[] {
  const out: FormFieldRuntimeSpec[] = [];
  const initial = (field:ProtoNode['props'], owner:ProtoNode) => typeof field.initialValue === 'string'
    ? {initialValue:usesLiteralLayoutContent(owner.props.layoutFrame) ? field.initialValue : interpolate(field.initialValue,scope,vars)}
    : {};
  const constraints = (field: Record<string, PropValue>) => ({
    ...(typeof field.minField === 'string' && field.minField ? { minField: field.minField } : {}),
    ...(typeof field.maxField === 'string' && field.maxField ? { maxField: field.maxField } : {}),
    ...(typeof field.minValue === 'number' && Number.isFinite(field.minValue) ? { minValue: field.minValue } : {}),
    ...(typeof field.maxValue === 'number' && Number.isFinite(field.maxValue) ? { maxValue: field.maxValue } : {}),
    ...(typeof field.formatRule === 'string' && field.formatRule ? { formatRule: field.formatRule as FieldFormatRule } : {}),
    ...(typeof field.validationMessage === 'string' && field.validationMessage ? { validationMessage: field.validationMessage } : {}),
  });
  function visit(n:ProtoNode) {
    if (n.type === 'Form' || n.type === 'MForm' || n.type === 'QueryForm') return;
    if (FIELD_TYPES.has(n.type) && typeof n.props.name === 'string') {
      out.push({
        name: n.props.name,
        label: String(n.props.label ?? n.props.name),
        required: n.props.required === true,
        ...initial(n.props,n),
        ...constraints(n.props),
      });
    }
    for (const child of n.children) if (isNode(child)) visit(child);
  }
  const children = form.children.filter(isNode);
  children.forEach(visit);
  if (!children.length && Array.isArray(form.props.fields)) {
    for (const f of form.props.fields) {
      if (f && typeof f === 'object' && !Array.isArray(f) && typeof (f as Record<string, PropValue>).name === 'string') {
        const ff = f as Record<string, PropValue>;
        out.push({
          name: ff.name as string,
          label: String(ff.label ?? ff.name),
          required: ff.required === true,
          ...initial(ff,form),
          ...constraints(ff),
        });
      }
    }
  }
  return out;
}

type FormIssue =
  | { kind: 'required' | 'unqualified' | 'missingReference' | 'invalidReference'; label: string }
  | { kind: 'pokaYoke'; label: string; issue: PokaYokeIssue };

function formIssueMessage(issue: FormIssue, locale: Locale): string {
  if (issue.kind === 'pokaYoke') return formatPokaYokeIssue(issue.issue, locale);
  const label = td(issue.label, locale);
  switch (issue.kind) {
    case 'required': return tr(`请填写${label}`, `${label} is required`, locale);
    case 'unqualified': return tr(`${label}未通过准入或已失效，请重新选择`, `${label} is no longer qualified; please select again`, locale);
    case 'missingReference': return tr(`${label}关联记录不存在，请重新选择`, `${label} references a missing record; please select again`, locale);
    case 'invalidReference': return tr(`${label}的外键定义无法解析`, `The foreign key for ${label} cannot be resolved`, locale);
  }
}

export function useRuntimeController(doc: ProtoDoc | null, pageId: string, isDesign: boolean, canNavigate?: (pageId: string) => boolean, publishedHeader?: (id:string) => readonly string[] | undefined): Runtime {
  const preview = useContext(PreviewDataContext);
  const [overlays, setOverlays] = useState<OverlayEntry[]>([]);
  const [vars, setVars] = useState<Record<string, unknown>>({});
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [tabs, setTabs] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<Record<string, Record<string, unknown>>>({});
  const [pageNo, setPageNoState] = useState<Record<string, number>>({});
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [activeRows, setActiveRowsState] = useState<Record<string, string>>({});
  const [formValues, setFormValuesState] = useState<Record<string, Record<string, unknown>>>({});
  const locale = useLocale();
  const [formIssues, setFormIssues] = useState<Record<string, Record<string, FormIssue>>>({});
  const formErrors = useMemo(() => Object.fromEntries(Object.entries(formIssues).map(([id, issues]) => [
    id, Object.fromEntries(Object.entries(issues).map(([field, issue]) => [field, formIssueMessage(issue, locale)])),
  ])), [formIssues, locale]);
  const [pickerValues, setPickerValues] = useState<Record<string, string>>({});
  const [messages, setToasts] = useState<Array<Omit<ToastItem, 'message'> & { message: string | FormIssue }>>([]);
  const toasts = useMemo(() => messages.map(t => ({
    ...t, message: typeof t.message === 'string' ? t.message : formIssueMessage(t.message, locale),
  })), [messages, locale]);
  const [confirmState, setConfirmState] = useState<Runtime['confirmState']>(null);

  // Refs so the async executor always sees fresh state
  const submittedRows = useRef<Record<string, Row>>({});
  const docRef = useRef(doc);
  docRef.current = doc;
  const isDesignRef = useRef(isDesign);
  isDesignRef.current = isDesign;
  const stateRef = useRef({ overlays, formValues, selections, activeRows });
  stateRef.current = { overlays, formValues, selections, activeRows };
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const toastTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.length = 0;
    };
  }, []);

  const toast = useCallback(
    (
      message: string | FormIssue,
      type: ToastItem['type'] = 'success',
      undoAction?: { label: string; onUndo: () => void },
    ) => {
      const id = Date.now() + Math.random();
      const wrappedUndo = undoAction
        ? {
            label: undoAction.label,
            onUndo: () => {
              undoAction.onUndo();
              setToasts((t) => t.filter((x) => x.id !== id));
            },
          }
        : undefined;
      setToasts((t) => [...t, { id, message, type, ...(wrappedUndo ? { undoAction: wrappedUndo } : {}) }]);
      const duration = wrappedUndo ? 5000 : 2400;
      const timer = setTimeout(() => {
        toastTimers.current = toastTimers.current.filter((item) => item !== timer);
        setToasts((t) => t.filter((x) => x.id !== id));
      }, duration);
      toastTimers.current.push(timer);
    },
    [],
  );

  // Field onChange action chains can submit immediately, before React commits a render.
  // Keep the executor's snapshot in sync with the exact values just entered.
  const updateFormValues = (update: (values: Runtime['formValues']) => Runtime['formValues']) => {
    const next = update(stateRef.current.formValues);
    stateRef.current = { ...stateRef.current, formValues: next };
    setFormValuesState(next);
  };

  const setActiveRow = useCallback((tableId: string, rowId: string | null) => {
    if (!tableId) return;
    const prevId = stateRef.current.activeRows[tableId] ?? null;
    if (prevId === rowId) return;
    const nextActive = { ...stateRef.current.activeRows };
    if (rowId === null || rowId === '') delete nextActive[tableId];
    else nextActive[tableId] = rowId;
    stateRef.current = { ...stateRef.current, activeRows: nextActive };
    setActiveRowsState(nextActive);

    // Clear inline (non-overlay, non-repeater) forms bound to this table so master-detail edit panels re-prefill cleanly
    if (docRef.current) {
      const inlineFormIds: string[] = [];
      const visitNonOverlay = (n: ProtoNode) => {
        if (OVERLAY_TYPES.has(n.type) || n.type === 'Repeater' || n.type === 'MRepeater') return;
        if ((n.type === 'Form' || n.type === 'MForm') && n.props.table === tableId) {
          inlineFormIds.push(n.pfId);
        }
        n.children.filter(isNode).forEach(visitNonOverlay);
      };
      visitNonOverlay(docRef.current.root);
      if (inlineFormIds.length) {
        const matchesInlineForm = (key: string) =>
          inlineFormIds.some((id) => key === id || key.startsWith(`${id}::row:${tableId}:`));
        for (const key of Object.keys(submittedRows.current)) {
          if (matchesInlineForm(key)) delete submittedRows.current[key];
        }
        updateFormValues((fv) =>
          Object.fromEntries(Object.entries(fv).filter(([key]) => !matchesInlineForm(key))),
        );
        setFormIssues((fe) =>
          Object.fromEntries(Object.entries(fe).filter(([key]) => !matchesInlineForm(key))),
        );
      }
    }
  }, []);

  const clearFormsIn = (node: ProtoNode) => {
    const ids: string[] = [];
    const pickers = new Set<string>();
    walk(node, (n) => {
      if (n.type === 'Form' || n.type === 'MForm') ids.push(n.pfId);
      if (n.type === 'PickerInput') pickers.add(n.pfId);
    });
    if (!ids.length) return;
    const matchesClearedForm = (key: string) => ids.some((id) => key === id || key.startsWith(`${id}::row:`));
    const matchesClearedPicker = (key: string) =>
      pickers.has(key) || [...pickers].some((pid) => key.endsWith(`::picker:${pid}`));
    // Opening a different source record must clear the previous record's selection label.
    setPickerValues((values) =>
      Object.fromEntries(Object.entries(values).filter(([id]) => !matchesClearedPicker(id))),
    );
    for (const key of Object.keys(submittedRows.current)) {
      if (matchesClearedForm(key)) delete submittedRows.current[key];
    }
    updateFormValues((fv) =>
      Object.fromEntries(Object.entries(fv).filter(([key]) => !matchesClearedForm(key))),
    );
    setFormIssues((fe) =>
      Object.fromEntries(Object.entries(fe).filter(([key]) => !matchesClearedForm(key))),
    );
  };

  const submittedFormForScope = (form: ProtoNode, s: Scope, inherited?: Row): Row | undefined => {
    const source = s.row ?? (s.params?.row as Row | undefined);
    const sourceTable = s.tableId ?? s.params?.tableId;
    if (s.expectedTableId && (!source || sourceTable !== s.expectedTableId)) return;
    const key = resolveFormInstanceKey(form.pfId, form.props.table, s);
    const saved = submittedRows.current[key];
    if (source && sourceTable === form.props.table) {
      // A previously saved create form is reusable in edit mode only for that exact record.
      return [saved, inherited, submittedRows.current[form.pfId]].find(row => row?.id === source.id);
    }
    return saved ?? inherited;
  };

  const captureSubmittedFormsForScope = (s: Scope): Record<string, Row> => {
    const parentOverlay = s.overlayIndex !== undefined ? stateRef.current.overlays[s.overlayIndex] : undefined;
    const out: Record<string, Row> = {};
    const doc = docRef.current;
    if (!doc) return out;
    walk(doc.root, form => {
      if (form.type !== 'Form' && form.type !== 'MForm') return;
      if (typeof form.props.table !== 'string') return;
      const saved = submittedFormForScope(form, s, parentOverlay?.submittedForms?.[form.pfId]);
      if (saved) out[form.pfId] = saved;
    });
    return out;
  };

  const pushOverlay = (
    id: string,
    params: Record<string, unknown>,
    picker?: OverlayEntry['picker'],
    meta?: { expectedTableId?: string; submittedForms?: Record<string, Row> },
  ): boolean => {
    const node = findOverlay(docRef.current, id);
    if (!node) {
      toast(tr(`未找到弹层「${id}」，请先在页面中添加 id 为 ${id} 的 Modal / Drawer`, `Overlay "${id}" not found. Add a Modal or Drawer with id="${id}" on this page first.`), 'error');
      return false;
    }
    clearFormsIn(node);
    setOverlays((o) => [
      ...o,
      {
        key: `${id}-${Date.now()}-${o.length}`,
        id,
        params,
        ...(meta?.expectedTableId ? { expectedTableId: meta.expectedTableId } : {}),
        ...(meta?.submittedForms && Object.keys(meta.submittedForms).length > 0
          ? { submittedForms: meta.submittedForms }
          : {}),
        picker,
      },
    ]);
    return true;
  };

  const selectTab = useCallback((pfId: string, index: number) => {
    const node = findById(docRef.current, pfId);
    setTabs(t => ({ ...t, [pfId]: index }));
    if (node?.type !== 'MPillTabs' || !Array.isArray(node.props.items) || node.children.some(isNode)) return;
    const { target, filterField, items } = node.props;
    const item = items[index];
    if (typeof target !== 'string' || typeof filterField !== 'string' || !item || typeof item !== 'object' ||
        !('value' in item) || typeof item.value !== 'string') return;
    setFilters(f => ({ ...f, [target]: { ...f[target], [filterField]: item.value } }));
    setPageNoState(p => ({ ...p, [target]: 1 }));
  }, []);

  const run = useCallback(
    async (chain: PropValue | undefined, rawScope: Scope) => {
      if (isDesignRef.current || !isActionChain(chain)) return;
      const ac = chain as ActionChain;
      const pages = usePageStore.getState();
      // Resolve canonical unprojected rows independently for `scope.row` and `scope.params.row`
      // so UI Stack `edge` stress text never leaks into writes AND child rows never clobber `params.row`.
      const canonicalizeRow = (tId: unknown, candidate: unknown): Row | undefined => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
        const rowObj = candidate as Row;
        if (typeof rowObj.id !== 'string' || !rowObj.id || typeof tId !== 'string' || !tId) return rowObj;
        const list = previewRef.current ? previewRef.current.rows[tId] : pages.getRows(tId);
        return list?.find((r) => r.id === rowObj.id) ?? rowObj;
      };
      const nextDirectRow =
        rawScope.row !== undefined ? canonicalizeRow(rawScope.tableId, rawScope.row) : undefined;
      const rawParamRow = rawScope.params?.row;
      const nextParamRow =
        rawParamRow !== undefined ? canonicalizeRow(rawScope.params?.tableId, rawParamRow) : undefined;
      const scope: Scope =
        nextDirectRow !== rawScope.row || nextParamRow !== rawParamRow
          ? {
              ...rawScope,
              ...(rawScope.row !== undefined ? { row: nextDirectRow } : {}),
              ...(rawParamRow !== undefined && rawScope.params
                ? { params: { ...rawScope.params, row: nextParamRow } }
                : {}),
            }
          : rawScope;
      const rowOf = () => (scope.row ?? (scope.params?.row as Row | undefined)) as Row | undefined;
      const tableOf = () => scope.tableId ?? (scope.params?.tableId as string | undefined);

      for (const call of ac.calls) {
        const a = call.args;
        const str = (i: number) => (typeof a[i] === 'string' ? (a[i] as string) : a[i === undefined ? 0 : i] === undefined ? '' : String(a[i]));
        switch (call.name) {
          case 'openModal':
          case 'openDrawer': {
            const rawExtra = a[1] && typeof a[1] === 'object' && !Array.isArray(a[1]) ? (a[1] as Record<string, unknown>) : {};
            const { row: _reservedRow, tableId: _reservedTableId, ...extra } = rawExtra;
            const currentRow = rowOf();
            const currentTable = tableOf();
            const validRowForOverlay =
              currentRow && (!scope.expectedTableId || currentTable === scope.expectedTableId)
                ? currentRow
                : undefined;
            const params = {
              ...extra,
              ...(validRowForOverlay ? { row: validRowForOverlay, tableId: currentTable } : {}),
            };
            const submittedForms = captureSubmittedFormsForScope(scope);
            if (
              !pushOverlay(str(0), params, undefined, {
                expectedTableId: scope.expectedTableId,
                submittedForms,
              })
            ) {
              return;
            }
            break;
          }
          case 'closeOverlay':
            setOverlays((o) => o.slice(0, -1));
            break;
          case 'toast':
            toast(str(0), (str(1) as ToastItem['type']) || 'success');
            break;
          case 'confirm': {
            const hasExplicitMatchArg =
              typeof a[1] === 'string' ? a[1].trim().length > 0 : a[1] !== undefined && a[1] !== null;
            let rawMatch = '';
            if (hasExplicitMatchArg) {
              const templateStr = str(1);
              for (const m of templateStr.matchAll(/\{\{\s*([\w.$-]+)\s*\}\}/g)) {
                const refVal = lookupPlaceholderPath(m[1], scope, vars, stateRef.current.formValues, docRef.current);
                if (refVal === undefined || refVal === null || String(refVal).trim() === '') {
                  toast(
                    tr(
                      `无法执行高危确认：缺少匹配字段值（${m[1]}）`,
                      `Cannot confirm high-risk action: missing value for ${m[1]}`,
                    ),
                    'error',
                  );
                  return;
                }
              }
              rawMatch = interpolate(templateStr, scope, vars, stateRef.current.formValues, docRef.current).trim();
              if (!rawMatch) {
                toast(
                  tr(
                    '无法执行高危确认：匹配校验值不能为空',
                    'Cannot confirm high-risk action: match text resolved to empty',
                  ),
                  'error',
                );
                return;
              }
            }
            const resolvedMsg = interpolate(str(0), scope, vars, stateRef.current.formValues, docRef.current).trim();
            const ok = await new Promise<boolean>((resolve) =>
              setConfirmState({
                message: resolvedMsg || tr('确定执行该操作吗？', 'Are you sure you want to proceed?'),
                ...(rawMatch ? { matchText: rawMatch } : {}),
                resolve,
              }),
            );
            setConfirmState(null);
            if (!ok) return;
            break;
          }
          case 'submitForm':
          case 'resetForm': {
            const form = findById(docRef.current, str(0));
            if (!form) {
              toast(tr(`未找到表单「${str(0)}」`, `Form "${str(0)}" not found`), 'error');
              return;
            }
            const formKey = resolveFormInstanceKey(form.pfId, form.props.table, scope);
            if (call.name === 'resetForm') {
              if (formKey === form.pfId) {
                clearFormsIn(form);
              } else {
                delete submittedRows.current[formKey];
                setPickerValues((pv) =>
                  Object.fromEntries(Object.entries(pv).filter(([id]) => !id.startsWith(`${formKey}::picker:`))),
                );
                updateFormValues((fv) => {
                  const next = { ...fv };
                  delete next[formKey];
                  return next;
                });
                setFormIssues((fe) => {
                  const next = { ...fe };
                  delete next[formKey];
                  return next;
                });
              }
              break;
            }
            const table = typeof form.props.table === 'string' ? form.props.table : '';
            const source = rowOf();
            if (scope.expectedTableId && (!source || tableOf() !== scope.expectedTableId)) {
              toast(
                tr('当前未选中目标记录，请先选择记录后再保存', 'Please select a target record before saving'),
                'error',
              );
              return;
            }
            const rawValues = stateRef.current.formValues[formKey] ?? {};
            const specs = formFieldSpecs(form,scope,vars);
            if (source && table && !tableOf()) {
              toast(tr('当前记录缺少来源表，无法确定表单写入对象', 'Current record is missing its source table'), 'error');
              return;
            }
            const row = source && tableOf() === table ? source : submittedRows.current[formKey];
            const allTables = useProtoStore.getState().dbTables;
            const boundTable = allTables.find(t => t.id === table);
            const values: Record<string, unknown> = { ...rawValues };
            if (!row) {
              for (const f of specs) {
                if (!Object.hasOwn(values, f.name) && f.initialValue !== undefined) values[f.name] = f.initialValue;
              }
            }
            let effective = values;
            if (table && row) {
              const stored = pages.getRows(table).find(r => r.id === row.id);
              if (!stored) {
                toast(tr('要修改的记录已不存在', 'The target record no longer exists'), 'error');
                return;
              }
              effective = { ...stored, ...values };
            } else if (boundTable) {
              try { effective = valuesWithColumnDefaults(boundTable, values); }
              catch (error) { toast(error instanceof Error ? error.message : String(error), 'error'); return; }
            }
            const errs: Record<string, FormIssue> = {};
            const labelMap = new Map<string, string>();
            if (boundTable) {
              for (const col of boundTable.columns) labelMap.set(col.name, col.comment || col.name);
            }
            for (const f of specs) labelMap.set(f.name, f.label);
            const comparisonCtx: Record<string, unknown> = { ...(source ?? {}), ...effective };

            for (const f of specs) {
              const v = effective[f.name];
              if (f.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0))) {
                errs[f.name] = { kind: 'required', label: f.label };
                continue;
              }
              const pokaIssue = evaluateFieldConstraint(f, v, comparisonCtx, labelMap);
              if (pokaIssue) {
                errs[f.name] = { kind: 'pokaYoke', label: f.label, issue: pokaIssue };
              }
            }
            if (Object.keys(errs).length) {
              setFormIssues((fe) => ({ ...fe, [formKey]: errs }));
              const firstIssue = Object.values(errs)[0];
              toast(
                firstIssue.kind === 'pokaYoke'
                  ? firstIssue
                  : tr('请完善必填项', 'Please complete all required fields'),
                'error',
              );
              return;
            }
            setFormIssues((fe) => {
              if (!fe[formKey]) return fe;
              const next = { ...fe };
              delete next[formKey];
              return next;
            });
            if (boundTable) {
              const invalidKeys: string[] = [];
              for (const col of boundTable.columns) {
                if ((!col.references && !col.isForeignKey) || !Object.hasOwn(effective, col.name)) continue;
                const v = effective[col.name];
                if (v == null && col.nullable) continue;
                const fkSpec = resolveBoundForeignKeySpec(boundTable, col, allTables);
                if (!fkSpec) {
                  errs[col.name] = { kind: 'invalidReference', label: specs.find(s => s.name === col.name)?.label ?? col.name };
                  invalidKeys.push(col.name);
                  continue;
                }
                const targetRows = previewRef.current
                  ? previewRef.current.rows[fkSpec.refTable.id] ?? []
                  : pages.getRows(fkSpec.refTable.id);
                const validOpts = buildForeignKeyOptionsFromRows(
                  targetRows,
                  fkSpec.valueCol,
                  fkSpec.labelCol,
                  { qualifiedOnly: fkSpec.qualifiedOnly },
                );
                if (!validOpts.some((opt) => opt.value === v)) {
                  const specLabel = specs.find((s) => s.name === col.name)?.label ?? col.name;
                  errs[col.name] = { kind: fkSpec.qualifiedOnly ? 'unqualified' : 'missingReference', label: specLabel };
                  invalidKeys.push(col.name);
                }
              }
              if (invalidKeys.length > 0) {
                const stalePickerIds = new Set<string>();
                walk(form, (n) => {
                  if (n.type === 'PickerInput' && typeof n.props.name === 'string' && invalidKeys.includes(n.props.name)) {
                    stalePickerIds.add(n.pfId);
                  }
                });
                if (stalePickerIds.size > 0) {
                  setPickerValues((pv) =>
                    Object.fromEntries(
                      Object.entries(pv).filter(
                        ([id]) =>
                          !stalePickerIds.has(id) &&
                          ![...stalePickerIds].some((pid) => id === `${formKey}::picker:${pid}`),
                      ),
                    ),
                  );
                }
                updateFormValues((fv) => {
                  const cur = { ...(fv[formKey] ?? {}) };
                  for (const k of invalidKeys) delete cur[k];
                  return { ...fv, [formKey]: cur };
                });
                setFormIssues((fe) => ({ ...fe, [formKey]: errs }));
                toast(errs[invalidKeys[0]], 'error');
                return;
              }
            }
            setFormIssues((fe) => ({ ...fe, [formKey]: {} }));
            if (table) {
              try {
                if (row) {
                  pages.updateRow(table, row.id, values);
                  submittedRows.current[formKey] = { ...effective, id: row.id };
                } else {
                  submittedRows.current[formKey] = pages.insertRow(table, effective);
                }
              } catch (error) {
                toast(error instanceof Error ? error.message : String(error), 'error');
                return;
              }
            }
            if (!row && Object.keys(values).length > Object.keys(rawValues).length) {
              updateFormValues((fv) => ({ ...fv, [formKey]: values }));
            }
            break;
          }
          case 'refresh':
            setPageNoState((p) => ({ ...p, [str(0)]: 1 }));
            break;
          case 'selectRow': {
            const row = rowOf();
            const table = tableOf();
            if (scope.expectedTableId && (!row || table !== scope.expectedTableId)) {
              toast(tr('当前未选中目标记录，无法执行该操作', 'No active target record selected for this action'), 'error');
              return;
            }
            if (row && table) setActiveRow(table, row.id);
            break;
          }
          case 'deleteRow': {
            const row = rowOf();
            const table = tableOf();
            if (scope.expectedTableId && (!row || table !== scope.expectedTableId)) {
              toast(tr('当前未选中目标记录，无法执行删除', 'No active target record selected to delete'), 'error');
              return;
            }
            if (row && table) {
              const undoMode = str(0) === 'undo';
              pages.getRows(table);
              const prevActiveId = stateRef.current.activeRows[table] ?? null;
              let undoPatch: ReturnType<typeof pages.deleteRow> = null;
              try {
                undoPatch = pages.deleteRow(table, row.id);
              } catch (error) {
                toast(error instanceof Error ? error.message : String(error), 'error');
                return;
              }
              if (prevActiveId === row.id) {
                setActiveRow(table, null);
              }
              if (undoMode && undoPatch) {
                const capturedPatch = undoPatch;
                toast(
                  tr('记录已移除', 'Record removed'),
                  'info',
                  {
                    label: tr('撤销', 'Undo'),
                    onUndo: () => {
                      try {
                        usePageStore.getState().undoDeleteRow(capturedPatch);
                        if (prevActiveId && !stateRef.current.activeRows[table]) {
                          setActiveRow(table, prevActiveId);
                        }
                      } catch (err) {
                        toast(err instanceof Error ? err.message : String(err), 'error');
                      }
                    },
                  },
                );
              }
            }
            break;
          }
          case 'updateRow': {
            const row = rowOf();
            const table = tableOf();
            if (scope.expectedTableId && (!row || table !== scope.expectedTableId)) {
              toast(tr('当前未选中目标记录，无法更新数据', 'No active target record selected to update'), 'error');
              return;
            }
            const rawValues = a[0] && typeof a[0] === 'object' && !Array.isArray(a[0]) ? (a[0] as Record<string, unknown>) : {};
            if (row && table) {
              let values: Record<string, unknown>;
              try {
                values = Object.fromEntries(Object.entries(rawValues).map(([key, val]) => [
                  key, resolveActionValue(val, scope, vars, stateRef.current.formValues, docRef.current),
                ]));
                pages.updateRow(table, row.id, values);
              } catch (error) {
                toast(error instanceof Error ? error.message : String(error), 'error');
                return;
              }
              setOverlays((o) =>
                o.map((e) => {
                  const r = e.params.row as Row | undefined;
                  return r && e.params.tableId === table && r.id === row.id ? { ...e, params: { ...e.params, row: { ...r, ...values } } } : e;
                })
              );
            }
            break;
          }
          case 'importPurchaseOrderLines': {
            const source = findById(docRef.current, str(0));
            const target = findById(docRef.current, str(1));
            const formPfId = str(2);
            const form = findById(docRef.current, formPfId);
            const currentOverlay = scope.overlayIndex === undefined ? undefined : stateRef.current.overlays[scope.overlayIndex];
            const header = currentOverlay
              ? currentOverlay.submittedForms?.[formPfId]
              : form && submittedFormForScope(form, scope);
            try {
              if (source?.type !== 'Table' || target?.type !== 'Table' || form?.type !== 'Form' ||
                  form.props.table !== 't_wms_acceptance_order' || !header ||
                  (tableOf() === form.props.table && rowOf()?.id !== header.id) ||
                  (scope.expectedTableId === form.props.table && !rowOf()) ||
                  typeof source.props.table !== 'string' || typeof target.props.table !== 'string') {
                throw new Error(tr('请先保存验收单表头，并配置采购来源表与验收明细表', 'Please save the receipt header first and configure the PO source table and detail table'));
              }
              const count = pages.importPurchaseOrderLines(source.props.table, target.props.table, stateRef.current.selections[str(0)] ?? [], header.id);
              if (!count) { toast(tr('所选采购明细已转入当前验收单', 'Selected PO lines are already imported into this receipt'), 'info'); return; }
              setSelections(s => ({ ...s, [str(0)]: [] }));
              toast(tr(`已转入 ${count} 条采购明细`, `Imported ${count} PO line(s)`));
            } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error'); return; }
            break;
          }
          case 'returnSelection': {
            const tableNode = findById(docRef.current, str(0));
            const top = stateRef.current.overlays[stateRef.current.overlays.length - 1];
            const ids = stateRef.current.selections[str(0)] ?? [];
            if (!top?.picker) {
              toast(tr('该弹框没有选择器回填目标；采购转入请使用采购明细转入动作', 'This modal has no picker target; use importPurchaseOrderLines for PO imports'), 'error');
              return;
            }
            if (!tableNode || typeof tableNode.props.table !== 'string') {
              toast(tr('returnSelection 需要指向一个绑定了物理表的表格', 'returnSelection must reference a Table bound to a database table'), 'error');
              return;
            }
            if (ids.length === 0) {
              toast(tr('请先勾选数据', 'Please select at least one row first'), 'warning');
              return;
            }
            const rows = pages.getRows(tableNode.props.table).filter((r) => ids.includes(r.id));
            const labelField = str(1);
            if (rows.length !== ids.length || !rows.length) {
              toast(tr('所选来源记录已变化，请重新选择', 'Selected source records changed; please select again'), 'error');
              return;
            }
            const tables = useProtoStore.getState().dbTables;
            const form = top.picker.formId ? findById(docRef.current, top.picker.formId) : null;
            const owner = tables.find(t => t.id === form?.props.table);
            const column = owner?.columns.find(c => c.name === top.picker!.name);
            if (form?.props.table && !column) {
              toast(tr('选单回填的目标表或字段不存在', 'The target table or field for this picker does not exist'), 'error');
              return;
            }
            let valueField = a[2];
            if (owner && column && (column.isForeignKey || column.references)) {
              const fk = resolveBoundForeignKeySpec(owner, column, tables);
              // A two-argument FK picker is valid only when the displayed field is itself the referenced key.
              if (valueField === undefined) valueField = labelField;
              if (!fk || fk.refTable.id !== tableNode.props.table || fk.valueCol !== valueField) {
                toast(tr('选单的来源表或存储字段与目标外键不一致', 'Picker source table or value field does not match the target foreign key'), 'error');
                return;
              }
              if (fk.qualifiedOnly && !isQualifiedSupplierStatus(rows[0].status)) {
                toast(tr('请选择已准入的合格供应商', 'Please select a qualified supplier'), 'error');
                return;
              }
            }
            let label: string;
            let value: unknown;
            if (valueField === undefined) {
              if (rows.some(r => !Object.hasOwn(r, labelField) || r[labelField] == null)) {
                toast(tr('所选记录缺少指定的显示字段', 'The selected record is missing the requested display field'), 'error');
                return;
              }
              label = rows.map(r => String(r[labelField])).join(tr('、', ', '));
              value = label;
            } else {
              const row = rows[0];
              if (rows.length !== 1 || typeof valueField !== 'string' || !valueField ||
                  !Object.hasOwn(row, valueField) || !['string','number'].includes(typeof row[valueField]) ||
                  row[valueField] === '' || !Object.hasOwn(row, labelField) || row[labelField] == null) {
                toast(tr('请单选一条具有指定显示字段和值字段的来源记录', 'Please select a single source record with valid display and value fields'), 'error'); return;
              }
              label = String(row[labelField]); value = row[valueField];
            }
            const displayKey = top.picker!.pickerKey ?? top.picker!.targetPfId;
            setPickerValues(pv => ({ ...pv, [displayKey]: label }));
            const draftFormKey = top.picker.formKey ?? top.picker.formId;
            const { name } = top.picker;
            if (draftFormKey && name) updateFormValues(fv => ({ ...fv, [draftFormKey]: { ...fv[draftFormKey], [name]: value } }));
            setOverlays((o) => o.slice(0, -1));
            break;
          }
          case 'switchTab':
            selectTab(str(0), Number(a[1]));
            break;
          case 'navigate': {
            const st = useProtoStore.getState();
            const rawTarget = str(0);
            const isAvailable = (id: string) => canNavigate ? canNavigate(id) : projectPageCatalog(pages).some(p => p.pageId === id && p.hasSource && !p.deprecated);
            let target = rawTarget;
            if (verifiedAxureSourceId(pageId,docRef.current?.header) && axureSourcePagePattern.test(rawTarget)) {
              const optimizedTarget = axureCopyId(rawTarget);
              const header = canNavigate ? publishedHeader?.(optimizedTarget)
                : Object.hasOwn(pages.pageSources,optimizedTarget) ? readPageHeader(pages.pageSources[optimizedTarget]) : undefined;
              if (verifiedAxureSourceId(optimizedTarget,header) === rawTarget && isAvailable(optimizedTarget)) {
                target = optimizedTarget;
              }
            } else if (verifiedFigmaSourceId(pageId,docRef.current?.header) && figmaSourcePagePattern.test(rawTarget)) {
              const optimizedTarget = figmaCopyId(rawTarget);
              const header = canNavigate ? publishedHeader?.(optimizedTarget)
                : Object.hasOwn(pages.pageSources,optimizedTarget) ? readPageHeader(pages.pageSources[optimizedTarget]) : undefined;
              if (verifiedFigmaSourceId(optimizedTarget,header) === rawTarget && isAvailable(optimizedTarget)) {
                target = optimizedTarget;
              }
            }
            if (!isAvailable(target)) {
              toast(tr(`跳转目标不可用：${String(a[0])}`, `Navigation target unavailable: ${String(a[0])}`), 'error');
              return;
            }
            if (a[1] !== undefined) {
              const row = rowOf(), tableId = tableOf();
              if (a[1] !== 'row' || !row || !tableId || !pages.getRows(tableId).some(r => r.id === row.id)) {
                toast(tr('缺少可追溯的来源行，无法带入目标页面', 'Missing traceable source row to pass into target page'), 'error'); return;
              }
              st.setActivePage(target,{tableId,rowId:row.id});
            } else st.setActivePage(target);
            st.setViewMode('single_page');
            return;
          }
          case 'setVar':
            setVars((v) => ({ ...v, [str(0)]: a[1] }));
            break;
          case 'show':
            setHidden((h) => ({ ...h, [str(0)]: false }));
            break;
          case 'hide':
            setHidden((h) => ({ ...h, [str(0)]: true }));
            break;
          default:
            toast(tr(`未知动作：${call.name}`, `Unknown action: ${call.name}`), 'error');
            return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDesign, toast, canNavigate, publishedHeader, pageId, selectTab, vars]
  );

  const reset = useCallback(() => {
    submittedRows.current = {};
    setOverlays([]);
    setVars({});
    setHidden({});
    setTabs({});
    setFilters({});
    setPageNoState({});
    setSelections({});
    setActiveRowsState({});
    setFormValuesState({});
    setFormIssues({});
    setPickerValues({});
  }, []);

  return useMemo<Runtime>(
    () => ({
      isDesign,
      pageId,
      overlays,
      vars,
      hidden,
      tabs,
      filters,
      pageNo,
      selections,
      activeRows,
      formValues,
      formErrors,
      pickerValues,
      toasts,
      confirmState,
      setTab: selectTab,
      setFilter: (pfId, values) => {
        setFilters((f) => ({ ...f, [pfId]: values }));
        setPageNoState((p) => ({ ...p, [pfId]: 1 }));
      },
      setPageNo: (pfId, n) => setPageNoState((p) => ({ ...p, [pfId]: n })),
      setSelection: (pfId, ids) => setSelections((s) => ({ ...s, [pfId]: ids })),
      setActiveRow,
      getActiveRowId: (tableId) => stateRef.current.activeRows[tableId],
      setFormValue: (formId, name, value) =>
        updateFormValues((fv) => ({ ...fv, [formId]: { ...(fv[formId] ?? {}), [name]: value } })),
      setFormValues: (formId, values) => updateFormValues((fv) => ({ ...fv, [formId]: values })),
      openOverlay: (overlayId, params = {}) => pushOverlay(overlayId, params),
      closeOverlay: () => setOverlays((o) => o.slice(0, -1)),
      openPicker: (overlayId, picker, scope) => {
        if (isDesignRef.current) return;
        const currentRow = scope.row ?? (scope.params?.row as Row | undefined);
        const currentTable = scope.tableId ?? (scope.params?.tableId as string | undefined);
        const validRow =
          currentRow && (!scope.expectedTableId || currentTable === scope.expectedTableId)
            ? currentRow
            : undefined;
        pushOverlay(
          overlayId,
          { ...(validRow ? { row: validRow, tableId: currentTable } : {}) },
          picker,
          {
            expectedTableId: scope.expectedTableId,
            submittedForms: captureSubmittedFormsForScope(scope),
          },
        );
      },
      run,
      resolveConfirm: (ok) => confirmState?.resolve(ok),
      reset,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDesign, pageId, overlays, vars, hidden, tabs, filters, pageNo, selections, activeRows, setActiveRow, formValues, formErrors, pickerValues, toasts, confirmState, run, reset]
  );
}

export const hasNodeChildren = (n: ProtoNode) => n.children.some(isNode);

export const RuntimeContextProvider: React.FC<{ value: Runtime; children: React.ReactNode }> = ({ value, children }) => (
  <RuntimeCtx.Provider value={value}>{children}</RuntimeCtx.Provider>
);
