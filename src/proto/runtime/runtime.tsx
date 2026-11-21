import { diagramRelations } from '../database/relations';
import { readPageHeader } from '../dsl/header';
import { axureSourcePagePattern, axureCopyId, verifiedAxureSourceId } from '../axure/task';
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
  requiresQualifiedSupplier,
  resolveBoundForeignKeySpec,
} from '../ai/templates';
import type { Row } from './mock';
import { projectPageCatalog } from '../../services/projectAnalysis';
import { td, tr, useLocale, type Locale } from '../../i18n';
import { valuesWithColumnDefaults } from '../database/columnDefault';

export interface Scope {
  row?: Row;
  /** Physical table the current row belongs to */
  tableId?: string;
  params?: Record<string, unknown>;
  /** Index in the overlay stack when rendering inside a live overlay */
  overlayIndex?: number;
}

export interface OverlayEntry {
  key: string;
  id: string;
  params: Record<string, unknown>;
  picker?: { targetPfId: string; formId?: string; name?: string };
}

export interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
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
  formValues: Record<string, Record<string, unknown>>;
  formErrors: Record<string, Record<string, string>>;
  pickerValues: Record<string, string>;
  toasts: ToastItem[];
  confirmState: { message: string; resolve: (ok: boolean) => void } | null;

  setTab: (pfId: string, index: number) => void;
  setFilter: (pfId: string, values: Record<string, unknown>) => void;
  setPageNo: (pfId: string, n: number) => void;
  setSelection: (pfId: string, ids: string[]) => void;
  setFormValue: (formId: string, name: string, value: unknown) => void;
  setFormValues: (formId: string, values: Record<string, unknown>) => void;
  openOverlay: (overlayId: string, params?: Record<string, unknown>) => boolean;
  closeOverlay: () => void;
  openPicker: (overlayId: string, picker: { targetPfId: string; formId?: string; name?: string }, scope: Scope) => void;
  run: (chain: PropValue | undefined, scope: Scope) => Promise<void>;
  resolveConfirm: (ok: boolean) => void;
  reset: () => void;
}

const RuntimeCtx = createContext<Runtime | null>(null);
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
): unknown {
  let cur: unknown = {
    row: scope.row ?? scope.params?.row ?? {},
    params: scope.params ?? {},
    vars,
    form: forms ?? {},
  };
  for (const k of path.split('.')) {
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
): string {
  if (!text.includes('{{')) return text;
  return text.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (_m, path: string) => {
    const cur = lookupPlaceholderPath(path, scope, vars, forms);
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
): unknown {
  if (typeof raw !== 'string') return raw;
  const exact = /^\{\{\s*([\w.$-]+)\s*\}\}$/.exec(raw);
  if (exact) {
    const resolved = lookupPlaceholderPath(exact[1], scope, vars, forms);
    if (resolved === undefined) {
      throw new Error(tr(`找不到动作引用 ${exact[1]}`, `Action reference ${exact[1]} has no value`));
    }
    return resolved;
  }
  return interpolate(raw, scope, vars, forms);
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

/** Field specs use the same interpolation and literal import rules as the rendered control. */
export function formFieldSpecs(form: ProtoNode, scope:Scope = {}, vars:Record<string,unknown> = {}): { name: string; label: string; required: boolean; initialValue?: string }[] {
  const out: { name: string; label: string; required: boolean; initialValue?: string }[] = [];
  const initial = (field:ProtoNode['props'], owner:ProtoNode) => typeof field.initialValue === 'string'
    ? {initialValue:usesLiteralLayoutContent(owner.props.layoutFrame) ? field.initialValue : interpolate(field.initialValue,scope,vars)}
    : {};
  function visit(n:ProtoNode) {
    if (n.type === 'Form' || n.type === 'MForm' || n.type === 'QueryForm') return;
    if (FIELD_TYPES.has(n.type) && typeof n.props.name === 'string') {
      out.push({
        name: n.props.name,
        label: String(n.props.label ?? n.props.name),
        required: n.props.required === true,
        ...initial(n.props,n),
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
        });
      }
    }
  }
  return out;
}

type FormIssue = { kind: 'required' | 'unqualified' | 'missingReference' | 'invalidReference'; label: string };

function formIssueMessage(issue: FormIssue, locale: Locale): string {
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
  const stateRef = useRef({ overlays, formValues, selections });
  stateRef.current = { overlays, formValues, selections };
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

  const toast = useCallback((message: string | FormIssue, type: ToastItem['type'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    const timer = setTimeout(() => {
      toastTimers.current = toastTimers.current.filter((item) => item !== timer);
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 2400);
    toastTimers.current.push(timer);
  }, []);

  // Field onChange action chains can submit immediately, before React commits a render.
  // Keep the executor's snapshot in sync with the exact values just entered.
  const updateFormValues = (update: (values: Runtime['formValues']) => Runtime['formValues']) => {
    const next = update(stateRef.current.formValues);
    stateRef.current = { ...stateRef.current, formValues: next };
    setFormValuesState(next);
  };

  const clearFormsIn = (node: ProtoNode) => {
    const ids: string[] = [];
    const pickers = new Set<string>();
    walk(node, (n) => {
      if (n.type === 'Form' || n.type === 'MForm') ids.push(n.pfId);
      if (n.type === 'PickerInput') pickers.add(n.pfId);
    });
    if (!ids.length) return;
    // Opening a different source record must clear the previous record's selection label.
    setPickerValues(values => Object.fromEntries(Object.entries(values).filter(([id]) => !pickers.has(id))));
    ids.forEach(id => delete submittedRows.current[id]);
    updateFormValues((fv) => {
      const next = { ...fv };
      ids.forEach((i) => delete next[i]);
      return next;
    });
    setFormIssues((fe) => {
      const next = { ...fe };
      ids.forEach((i) => delete next[i]);
      return next;
    });
  };

  const pushOverlay = (id: string, params: Record<string, unknown>, picker?: OverlayEntry['picker']): boolean => {
    const node = findOverlay(docRef.current, id);
    if (!node) {
      toast(tr(`未找到弹层「${id}」，请先在页面中添加 id 为 ${id} 的 Modal / Drawer`, `Overlay "${id}" not found. Add a Modal or Drawer with id="${id}" on this page first.`), 'error');
      return false;
    }
    clearFormsIn(node);
    setOverlays((o) => [...o, { key: `${id}-${Date.now()}`, id, params, picker }]);
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
    async (chain: PropValue | undefined, scope: Scope) => {
      if (isDesignRef.current || !isActionChain(chain)) return;
      const ac = chain as ActionChain;
      const rowOf = () => (scope.row ?? (scope.params?.row as Row | undefined)) as Row | undefined;
      const tableOf = () => scope.tableId ?? (scope.params?.tableId as string | undefined);
      const pages = usePageStore.getState();

      for (const call of ac.calls) {
        const a = call.args;
        const str = (i: number) => (typeof a[i] === 'string' ? (a[i] as string) : a[i] === undefined ? '' : String(a[i]));
        switch (call.name) {
          case 'openModal':
          case 'openDrawer': {
            const rawExtra = a[1] && typeof a[1] === 'object' && !Array.isArray(a[1]) ? (a[1] as Record<string, unknown>) : {};
            const { row: _reservedRow, tableId: _reservedTableId, ...extra } = rawExtra;
            const currentRow = rowOf();
            const params = { ...extra, ...(currentRow ? { row: currentRow, tableId: tableOf() } : {}) };
            if (!pushOverlay(str(0), params)) return;
            break;
          }
          case 'closeOverlay':
            setOverlays((o) => o.slice(0, -1));
            break;
          case 'toast':
            toast(str(0), (str(1) as ToastItem['type']) || 'success');
            break;
          case 'confirm': {
            const ok = await new Promise<boolean>((resolve) => setConfirmState({ message: str(0) || tr('确定执行该操作吗？', 'Are you sure you want to proceed?'), resolve }));
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
            if (call.name === 'resetForm') {
              clearFormsIn(form);
              break;
            }
            const rawValues = stateRef.current.formValues[form.pfId] ?? {};
            const specs = formFieldSpecs(form,scope,vars);
            const table = typeof form.props.table === 'string' ? form.props.table : '';
            const source = rowOf();
            if (source && table && !tableOf()) {
              toast(tr('当前记录缺少来源表，无法确定表单写入对象', 'Current record is missing its source table'), 'error');
              return;
            }
            const row = source && tableOf() === table ? source : submittedRows.current[form.pfId];
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
            for (const f of specs) {
              const v = effective[f.name];
              if (f.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0))) {
                errs[f.name] = { kind: 'required', label: f.label };
              }
            }
            if (Object.keys(errs).length) {
              setFormIssues((fe) => ({ ...fe, [form.pfId]: errs }));
              toast(tr('请完善必填项', 'Please complete all required fields'), 'error');
              return;
            }
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
                    Object.fromEntries(Object.entries(pv).filter(([id]) => !stalePickerIds.has(id))),
                  );
                }
                updateFormValues((fv) => {
                  const cur = { ...(fv[form.pfId] ?? {}) };
                  for (const k of invalidKeys) delete cur[k];
                  return { ...fv, [form.pfId]: cur };
                });
                setFormIssues((fe) => ({ ...fe, [form.pfId]: errs }));
                toast(errs[invalidKeys[0]], 'error');
                return;
              }
            }
            setFormIssues((fe) => ({ ...fe, [form.pfId]: {} }));
            if (table) {
              try {
                if (row) {
                  pages.updateRow(table, row.id, values);
                  submittedRows.current[form.pfId] = { ...effective, id: row.id };
                } else {
                  submittedRows.current[form.pfId] = pages.insertRow(table, effective);
                }
              } catch (error) {
                toast(error instanceof Error ? error.message : String(error), 'error');
                return;
              }
            }
            if (!row && Object.keys(values).length > Object.keys(rawValues).length) {
              updateFormValues((fv) => ({ ...fv, [form.pfId]: values }));
            }
            break;
          }
          case 'refresh':
            setPageNoState((p) => ({ ...p, [str(0)]: 1 }));
            break;
          case 'deleteRow': {
            const row = rowOf();
            const table = tableOf();
            if (row && table) pages.deleteRow(table, row.id);
            break;
          }
          case 'updateRow': {
            const row = rowOf();
            const table = tableOf();
            const rawValues = a[0] && typeof a[0] === 'object' && !Array.isArray(a[0]) ? (a[0] as Record<string, unknown>) : {};
            if (row && table) {
              let values: Record<string, unknown>;
              try {
                values = Object.fromEntries(Object.entries(rawValues).map(([key, val]) => [
                  key, resolveActionValue(val, scope, vars, stateRef.current.formValues),
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
            const form = findById(docRef.current, str(2));
            const header = submittedRows.current[str(2)];
            try {
              if (source?.type !== 'Table' || target?.type !== 'Table' || form?.type !== 'Form' ||
                  form.props.table !== 't_wms_acceptance_order' || !header ||
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
            const valueField = a[2];
            if (rows.length !== ids.length || !rows.length) { toast(tr('所选来源记录已变化，请重新选择', 'Selected source records changed; please select again'), 'error'); return; }
            // Two-argument selections keep the historical text contract. An explicit
            // third argument binds one scalar key, with its original type.
            let label: string;
            let value: unknown;
            if (valueField === undefined) {
              label = rows.map(r => String(r[labelField] ?? r.id)).join(tr('、', ', '));
              value = label;
            } else {
              const row = rows[0];
              if (rows.length !== 1 || typeof valueField !== 'string' || !valueField ||
                  !Object.hasOwn(row, valueField) || !['string','number'].includes(typeof row[valueField]) ||
                  row[valueField] === '' || !Object.hasOwn(row, labelField) || row[labelField] == null) {
                toast(tr('请单选一条具有指定显示字段和值字段的来源记录', 'Please select a single source record with valid display and value fields'), 'error'); return;
              }
              const form = top.picker.formId && findById(docRef.current, top.picker.formId);
              const tables = useProtoStore.getState().dbTables;
              const owner = form && tables.find(t => t.id === form.props.table);
              const column = owner && owner.columns.find(c => c.name === top.picker!.name);
              if (owner && column && (column.isForeignKey || column.references)) {
                const edge = diagramRelations(tables).relations.find(r => r.toTableId === owner.id && r.toColumnId === column.id);
                if (!edge || edge.fromTableId !== tableNode.props.table || edge.fromColumnName !== valueField) {
                  toast(tr('选单的来源表或存储字段与目标外键不一致', 'Picker source table or value field does not match the target foreign key'), 'error'); return;
                }
                const refTable = tables.find(t => t.id === edge.fromTableId);
                if (requiresQualifiedSupplier(column, owner, refTable) && !isQualifiedSupplierStatus(row.status)) {
                  toast(tr('请选择已准入的合格供应商', 'Please select a qualified supplier'), 'error'); return;
                }
              }
              label = String(row[labelField]); value = row[valueField];
            }
            setPickerValues(pv => ({ ...pv, [top.picker!.targetPfId]: label }));
            const { formId, name } = top.picker;
            if (formId && name) updateFormValues(fv => ({ ...fv, [formId]: { ...fv[formId], [name]: value } }));
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
      setFormValue: (formId, name, value) =>
        updateFormValues((fv) => ({ ...fv, [formId]: { ...(fv[formId] ?? {}), [name]: value } })),
      setFormValues: (formId, values) => updateFormValues((fv) => ({ ...fv, [formId]: values })),
      openOverlay: (overlayId, params = {}) => pushOverlay(overlayId, params),
      closeOverlay: () => setOverlays((o) => o.slice(0, -1)),
      openPicker: (overlayId, picker, scope) => {
        if (isDesignRef.current) return;
        pushOverlay(overlayId, { ...(scope.row ? { row: scope.row, tableId: scope.tableId } : {}) }, picker);
      },
      run,
      resolveConfirm: (ok) => confirmState?.resolve(ok),
      reset,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDesign, pageId, overlays, vars, hidden, tabs, filters, pageNo, selections, formValues, formErrors, pickerValues, toasts, confirmState, run, reset]
  );
}

export const hasNodeChildren = (n: ProtoNode) => n.children.some(isNode);

export const RuntimeContextProvider: React.FC<{ value: Runtime; children: React.ReactNode }> = ({ value, children }) => (
  <RuntimeCtx.Provider value={value}>{children}</RuntimeCtx.Provider>
);
