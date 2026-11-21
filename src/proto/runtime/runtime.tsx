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
import type { Row } from './mock';
import { projectPageCatalog } from '../../services/projectAnalysis';

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

/** Resolve `{{row.x}}`, `{{params.x}}`, `{{vars.x}}` placeholders. */
export function interpolate(text: string, scope: Scope, vars: Record<string, unknown>): string {
  if (!text.includes('{{')) return text;
  const ctx: Record<string, unknown> = { row: scope.row ?? scope.params?.row ?? {}, params: scope.params ?? {}, vars };
  return text.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (_m, path: string) => {
    let cur: unknown = ctx;
    for (const k of path.split('.')) {
      if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[k];
      else return '';
    }
    return cur === undefined || cur === null ? '' : String(cur);
  });
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

export function useRuntimeController(doc: ProtoDoc | null, pageId: string, isDesign: boolean, canNavigate?: (pageId: string) => boolean, publishedHeader?: (id:string) => readonly string[] | undefined): Runtime {
  const [overlays, setOverlays] = useState<OverlayEntry[]>([]);
  const [vars, setVars] = useState<Record<string, unknown>>({});
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [tabs, setTabs] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<Record<string, Record<string, unknown>>>({});
  const [pageNo, setPageNoState] = useState<Record<string, number>>({});
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [formValues, setFormValuesState] = useState<Record<string, Record<string, unknown>>>({});
  const [formErrors, setFormErrors] = useState<Record<string, Record<string, string>>>({});
  const [pickerValues, setPickerValues] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<Runtime['confirmState']>(null);

  // Refs so the async executor always sees fresh state
  const submittedRows = useRef<Record<string, Row>>({});
  const docRef = useRef(doc);
  docRef.current = doc;
  const isDesignRef = useRef(isDesign);
  isDesignRef.current = isDesign;
  const stateRef = useRef({ overlays, formValues, selections });
  stateRef.current = { overlays, formValues, selections };

  const toastTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.length = 0;
    };
  }, []);

  const toast = useCallback((message: string, type: ToastItem['type'] = 'success') => {
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
    setFormErrors((fe) => {
      const next = { ...fe };
      ids.forEach((i) => delete next[i]);
      return next;
    });
  };

  const pushOverlay = (id: string, params: Record<string, unknown>, picker?: OverlayEntry['picker']): boolean => {
    const node = findOverlay(docRef.current, id);
    if (!node) {
      toast(`未找到弹层「${id}」，请先在页面中添加 id 为 ${id} 的 Modal / Drawer`, 'error');
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
            const ok = await new Promise<boolean>((resolve) => setConfirmState({ message: str(0) || '确定执行该操作吗？', resolve }));
            setConfirmState(null);
            if (!ok) return;
            break;
          }
          case 'submitForm':
          case 'resetForm': {
            const form = findById(docRef.current, str(0));
            if (!form) {
              toast(`未找到表单「${str(0)}」`, 'error');
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
            const editingSource = Boolean(table && source && tableOf() === table);
            const values: Record<string, unknown> = { ...rawValues };
            if (!editingSource) {
              for (const f of specs) {
                if (!Object.hasOwn(values,f.name) && f.initialValue !== undefined) values[f.name] = f.initialValue;
              }
            }
            const errs: Record<string, string> = {};
            for (const f of specs) {
              const v = values[f.name];
              if (f.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0))) {
                errs[f.name] = `请填写${f.label}`;
              }
            }
            if (Object.keys(errs).length) {
              setFormErrors((fe) => ({ ...fe, [form.pfId]: errs }));
              toast('请完善必填项', 'error');
              return;
            }
            setFormErrors((fe) => ({ ...fe, [form.pfId]: {} }));
            if (table) {
              if (source && !tableOf()) { toast('当前记录缺少来源表，无法确定表单写入对象', 'error'); return; }
              const row = source && tableOf() === table ? source : submittedRows.current[form.pfId];
              if (row) {
                if (!pages.getRows(table).some(r => r.id === row.id)) { toast('要修改的记录已不存在', 'error'); return; }
                pages.updateRow(table, row.id, values);
                submittedRows.current[form.pfId] = { ...row, ...values };
              } else {
                try { submittedRows.current[form.pfId] = pages.insertRow(table, values); }
                catch (error) { toast(error instanceof Error ? error.message : String(error), 'error'); return; }
              }
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
            const values = a[0] && typeof a[0] === 'object' && !Array.isArray(a[0]) ? (a[0] as Record<string, unknown>) : {};
            if (row && table) {
              pages.updateRow(table, row.id, values);
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
                throw new Error('请先保存验收单表头，并配置采购来源表与验收明细表');
              }
              const count = pages.importPurchaseOrderLines(source.props.table, target.props.table, stateRef.current.selections[str(0)] ?? [], header.id);
              if (!count) { toast('所选采购明细已转入当前验收单', 'info'); return; }
              setSelections(s => ({ ...s, [str(0)]: [] }));
              toast(`已转入 ${count} 条采购明细`);
            } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error'); return; }
            break;
          }
          case 'returnSelection': {
            const tableNode = findById(docRef.current, str(0));
            const top = stateRef.current.overlays[stateRef.current.overlays.length - 1];
            const ids = stateRef.current.selections[str(0)] ?? [];
            if (!top?.picker) {
              toast('该弹框没有选择器回填目标；采购转入请使用采购明细转入动作', 'error');
              return;
            }
            if (!tableNode || typeof tableNode.props.table !== 'string') {
              toast('returnSelection 需要指向一个绑定了物理表的表格', 'error');
              return;
            }
            if (ids.length === 0) {
              toast('请先勾选数据', 'warning');
              return;
            }
            const rows = pages.getRows(tableNode.props.table).filter((r) => ids.includes(r.id));
            const labelField = str(1);
            const valueField = a[2];
            if (rows.length !== ids.length || !rows.length) { toast('所选来源记录已变化，请重新选择', 'error'); return; }
            // Two-argument selections keep the historical text contract. An explicit
            // third argument binds one scalar key, with its original type.
            let label: string;
            let value: unknown;
            if (valueField === undefined) {
              label = rows.map(r => String(r[labelField] ?? r.id)).join('、');
              value = label;
            } else {
              const row = rows[0];
              if (rows.length !== 1 || typeof valueField !== 'string' || !valueField ||
                  !Object.hasOwn(row, valueField) || !['string','number'].includes(typeof row[valueField]) ||
                  row[valueField] === '' || !Object.hasOwn(row, labelField) || row[labelField] == null) {
                toast('请单选一条具有指定显示字段和值字段的来源记录', 'error'); return;
              }
              const form = top.picker.formId && findById(docRef.current, top.picker.formId);
              const tables = useProtoStore.getState().dbTables;
              const owner = form && tables.find(t => t.id === form.props.table);
              const column = owner && owner.columns.find(c => c.name === top.picker!.name);
              if (owner && column && (column.isForeignKey || column.references)) {
                const edge = diagramRelations(tables).relations.find(r => r.toTableId === owner.id && r.toColumnId === column.id);
                if (!edge || edge.fromTableId !== tableNode.props.table || edge.fromColumnName !== valueField) {
                  toast('选单的来源表或存储字段与目标外键不一致', 'error'); return;
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
              toast(`跳转目标不可用：${String(a[0])}`, 'error');
              return;
            }
            if (a[1] !== undefined) {
              const row = rowOf(), tableId = tableOf();
              if (a[1] !== 'row' || !row || !tableId || !pages.getRows(tableId).some(r => r.id === row.id)) {
                toast('缺少可追溯的来源行，无法带入目标页面', 'error'); return;
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
            toast(`未知动作：${call.name}`, 'error');
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
    setFormErrors({});
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
