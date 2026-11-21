import {
  useProtoStore,
  type AcceptanceOrderRecord,
  type DBColumnSchema,
  type DBTableSchema,
  type PurchaseOrderItem,
  type SupplierRecord,
} from '../../store/useProtoStore';
import { usePageStore } from '../store/usePageStore';
import { parsePageSource } from '../dsl/parser';
import { printPageSource } from '../dsl/printer';
import { diagramRelations } from '../database/relations';
import { declaredColumnOptions, isEnumLikeColumn, isTextColumn, tableUsesChineseContract, unquoteSqlLiteral } from '../database/enumContract';
import { columnLabel, defaultDisplayColumns, formatColumnIdentifierLabel, type Row } from '../runtime/mock';
import type { PagePlatform } from '../mobile/types';
import { getLocale, isEnLocale, type Locale } from '../../i18n/runtime';

const DEFAULT_STATUS_ZH = ['待审批', '已通过', '已驳回', '草稿'] as const;
const DEFAULT_STATUS_EN = ['Pending', 'Approved', 'Rejected', 'Draft'] as const;
const DEFAULT_STATUS_LOWER_EN = ['pending', 'approved', 'rejected', 'draft'] as const;

const DEMO_SUPPLIER_EN_NAMES: Record<string, string> = {
  '杭州极光智能数码有限公司': 'Aurora Smart Digital Ltd.',
  '深圳星海光电科技有限公司': 'StarSea Optoelectronics Inc.',
  '苏州云图精密配件有限公司': 'CloudAtlas Precision Parts Co.',
  '上海森禾环保包装制品厂': 'GreenForest Eco Packaging Co.',
};

const ENUM_LABELS: Record<string, { zh: string; en: string }> = {
  '待审批': { zh: '待审批', en: 'Pending' },
  '待审': { zh: '待审', en: 'Pending' },
  '已通过': { zh: '已通过', en: 'Approved' },
  '已驳回': { zh: '已驳回', en: 'Rejected' },
  '草稿': { zh: '草稿', en: 'Draft' },
  '已完成': { zh: '已完成', en: 'Completed' },
  '已提交验收': { zh: '已提交验收', en: 'Submitted' },
  '已入库': { zh: '已入库', en: 'Putaway' },
  '待法务审批': { zh: '待法务审批', en: 'Pending Legal' },
  '执行中': { zh: '执行中', en: 'Active' },
  '已完结': { zh: '已完结', en: 'Completed' },
  '购买': { zh: '购买', en: 'Purchase' },
  '调拨': { zh: '调拨', en: 'Transfer' },
  '盘盈': { zh: '盘盈', en: 'Surplus' },
  '供方发货单转入': { zh: '供方发货单转入', en: 'ASN Import' },
  '采购订单转入': { zh: '采购订单转入', en: 'PO Import' },
  pending: { zh: '待审批', en: 'Pending' },
  qualified: { zh: '已准入', en: 'Qualified' },
  rejected: { zh: '已驳回', en: 'Rejected' },
  approved: { zh: '已通过', en: 'Approved' },
  draft: { zh: '草稿', en: 'Draft' },
  confirmed: { zh: '已确认', en: 'Confirmed' },
  unconfirmed: { zh: '待确认', en: 'Unconfirmed' },
  completed: { zh: '已完成', en: 'Completed' },
  Pending: { zh: '待审批', en: 'Pending' },
  Approved: { zh: '已通过', en: 'Approved' },
  Rejected: { zh: '已驳回', en: 'Rejected' },
  Draft: { zh: '草稿', en: 'Draft' },
  Completed: { zh: '已完成', en: 'Completed' },
  Submitted: { zh: '已提交验收', en: 'Submitted' },
  Putaway: { zh: '已入库', en: 'Putaway' },
  Active: { zh: '执行中', en: 'Active' },
  'Pending Legal': { zh: '待法务审批', en: 'Pending Legal' },
  'In Progress': { zh: '跟进中', en: 'In Progress' },
  'Closed Won': { zh: '已签约', en: 'Closed Won' },
  Lead: { zh: '线索', en: 'Lead' },
  Proposal: { zh: '方案报价', en: 'Proposal' },
};

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export interface TemplateDataContext {
  tables?: DBTableSchema[];
  tableRows?: Record<string, Row[]>;
  suppliers?: SupplierRecord[];
  purchaseOrderItems?: PurchaseOrderItem[];
  acceptanceOrders?: AcceptanceOrderRecord[];
  templateId?: string;
  projectId?: string;
}

interface ResolvedTemplateData {
  tables: DBTableSchema[];
  tableRows: Record<string, Row[]>;
  suppliers: SupplierRecord[];
  purchaseOrderItems: PurchaseOrderItem[];
  acceptanceOrders: AcceptanceOrderRecord[];
  templateId?: string;
  projectId?: string;
}

function safeProtoState() {
  try {
    return useProtoStore?.getState?.();
  } catch {
    return undefined;
  }
}

function safeTableRows(): Record<string, Row[]> | undefined {
  try {
    return usePageStore?.getState?.()?.tableRows;
  } catch {
    return undefined;
  }
}

function mergeUniqueTables(...lists: Array<DBTableSchema[] | undefined>): DBTableSchema[] {
  const out: DBTableSchema[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const tbl of list) {
      if (tbl && !seen.has(tbl.id)) {
        seen.add(tbl.id);
        out.push(tbl);
      }
    }
  }
  return out;
}

/** Snapshot the currently open project's data for interactive in-project page generation. */
export function currentProjectDataContext(tables?: DBTableSchema[]): TemplateDataContext {
  const proto = safeProtoState();
  const rowsMap = safeTableRows();
  return {
    tables: tables ?? proto?.dbTables ?? [],
    tableRows: rowsMap ?? {},
    suppliers: proto?.suppliers ?? [],
    purchaseOrderItems: proto?.purchaseOrderItems ?? [],
    acceptanceOrders: proto?.acceptanceOrders ?? [],
    templateId: proto?.currentProjectMeta?.templateId,
    projectId: proto?.currentProjectMeta?.projectId,
  };
}

function resolveDataContext(
  data?: TemplateDataContext,
  table?: DBTableSchema,
  tables?: DBTableSchema[],
): ResolvedTemplateData {
  if (data) {
    return {
      tables: mergeUniqueTables(tables, data.tables, table ? [table] : undefined),
      tableRows: data.tableRows ?? {},
      suppliers: data.suppliers ?? [],
      purchaseOrderItems: data.purchaseOrderItems ?? [],
      acceptanceOrders: data.acceptanceOrders ?? [],
      templateId: data.templateId,
      projectId: data.projectId,
    };
  }
  const proto = safeProtoState();
  const protoTables = proto?.dbTables ?? [];
  const passedTables = mergeUniqueTables(tables, table ? [table] : undefined);
  const sharesActiveRef = passedTables.length === 0 || passedTables.some((t) => protoTables.includes(t));
  const disjointFromActiveIds =
    passedTables.length > 0 && passedTables.every((t) => !protoTables.some((pt) => pt.id === t.id));
  const allowStoreTableRows = sharesActiveRef || disjointFromActiveIds;
  const allowStoreDomain = sharesActiveRef;
  return {
    tables: passedTables.length > 0 ? mergeUniqueTables(passedTables, sharesActiveRef ? protoTables : undefined) : protoTables,
    tableRows: allowStoreTableRows ? safeTableRows() ?? {} : {},
    suppliers: allowStoreDomain ? proto?.suppliers ?? [] : [],
    purchaseOrderItems: allowStoreDomain ? proto?.purchaseOrderItems ?? [] : [],
    acceptanceOrders: allowStoreDomain ? proto?.acceptanceOrders ?? [] : [],
    templateId: allowStoreDomain ? proto?.currentProjectMeta?.templateId : undefined,
    projectId: allowStoreDomain ? proto?.currentProjectMeta?.projectId : undefined,
  };
}

export function preferredDisplayColumn(table: DBTableSchema, fallback: string): string {
  return (
    table.columns.find(
      (c) =>
        !c.isPrimaryKey &&
        /(?:supplier_name|company_name|customer_name|vendor_name|material_name|item_name|_name|^name$|_title|^title$)/i.test(c.name),
    )?.name ??
    defaultDisplayColumns(table, 1)[0]?.name ??
    fallback
  );
}

export interface SelectOptionItem {
  label: string;
  value: string | number;
}

export function projectBuiltinFixedRows(input: {
  templateId?: string;
  suppliers?: SupplierRecord[];
  purchaseOrderItems?: PurchaseOrderItem[];
}): Record<string, Row[]> {
  const suppliers = input.suppliers ?? [];
  const purchaseOrderItems = input.purchaseOrderItems ?? [];
  const isErpStarter = input.templateId === 'saas_inventory' || input.templateId === 'customs_erp';
  const out: Record<string, Row[]> = {};
  if (isErpStarter || suppliers.length > 0) {
    out.t_base_supplier = suppliers.map((s) => ({
      id: s.id,
      supplier_code: s.code,
      supplier_name: s.name,
      contact_person: s.contactPerson,
      contact_phone: s.phone,
      tax_rate_default: s.taxRateDefault,
      status: s.status,
    }));
  }
  if (isErpStarter || purchaseOrderItems.length > 0) {
    out.t_pms_po_item = purchaseOrderItems.map((po) => ({
      id: po.id,
      po_number: po.poNumber,
      supplier_id: po.supplierId,
      ordered_qty: po.orderedQty,
      delivered_qty: po.deliveredQty,
      material_code: po.materialCode,
      unit_price_tax_included: po.unitPriceTaxIncluded,
      tax_rate: po.taxRate,
      project_code: po.projectCode,
      status: po.status,
    }));
  }
  return out;
}

function localizeEnumLabel(value: string, locale: Locale, zhHint?: string): string {
  const en = isEnLocale(locale);
  const mapped = ENUM_LABELS[value];
  if (mapped) {
    return en ? mapped.en : zhHint || mapped.zh;
  }
  if (!en && zhHint) return zhHint;
  return value;
}

function existingColumnStringValues(col: DBColumnSchema, table: DBTableSchema | undefined, ctx: ResolvedTemplateData): string[] {
  if (!table) return [];
  const hasSaved = Object.hasOwn(ctx.tableRows, table.id);
  const fixed = projectBuiltinFixedRows({
    templateId: ctx.templateId,
    suppliers: ctx.suppliers,
    purchaseOrderItems: ctx.purchaseOrderItems,
  });
  const rows: Array<Record<string, unknown>> | undefined = hasSaved ? ctx.tableRows[table.id] : fixed[table.id];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (val: unknown) => {
    if (typeof val === 'string' && val.trim() && !seen.has(val.trim())) {
      seen.add(val.trim());
      out.push(val.trim());
    }
  };
  if (Array.isArray(rows)) {
    for (const row of rows) add(row?.[col.name]);
  }
  add(unquoteSqlLiteral(col.defaultValue));
  return out;
}

export interface StatusContract {
  values: string[];
  pairs: Array<{ value: string; zhHint?: string }>;
  pendingValue: string | null;
  approvedValue: string | null;
  rejectedValue: string | null;
}

/**
 * Resolve a column's stored status/enum contract strictly from the table schema and
 * existing records — NEVER from the active UI locale and NEVER by positional guessing
 * or inventing out-of-contract transition values.
 */
export function resolveStatusContract(
  col: DBColumnSchema,
  table?: DBTableSchema,
  data?: TemplateDataContext,
): StatusContract {
  const ctx = resolveDataContext(data, table);
  const explicit = declaredColumnOptions(col);
  let pairs: Array<{ value: string; zhHint?: string }>;

  if (explicit !== null) {
    pairs = explicit.map(p => ({ ...p, value: String(p.value) }));
  } else if (!isTextColumn(col)) {
    pairs = [];
  } else {
    const existing = existingColumnStringValues(col, table, ctx);
    const mergeUnique = (base: readonly string[], extra: string[]) => {
      const set = new Set<string>();
      const res: Array<{ value: string }> = [];
      for (const item of [...base, ...extra]) {
        if (item && !set.has(item)) {
          set.add(item);
          res.push({ value: item });
        }
      }
      return res;
    };
    if (
      table?.id === 't_pms_po_item' ||
      table?.tableName === 't_pms_po_item' ||
      existing.includes('unconfirmed')
    ) {
      pairs = mergeUnique(['unconfirmed', 'confirmed', 'completed'], existing);
    } else if (
      table?.id === 't_base_supplier' ||
      table?.tableName === 't_base_supplier' ||
      existing.includes('qualified')
    ) {
      pairs = mergeUnique(['pending', 'qualified', 'rejected'], existing);
    } else if (
      existing.length > 0 &&
      existing.every((v) => (DEFAULT_STATUS_LOWER_EN as readonly string[]).includes(v))
    ) {
      pairs = mergeUnique(DEFAULT_STATUS_LOWER_EN, existing);
    } else if (
      existing.length > 0 &&
      existing.every((v) => (DEFAULT_STATUS_ZH as readonly string[]).includes(v))
    ) {
      pairs = mergeUnique(DEFAULT_STATUS_ZH, existing);
    } else if (
      existing.length > 0 &&
      existing.every((v) => (DEFAULT_STATUS_EN as readonly string[]).includes(v))
    ) {
      pairs = mergeUnique(DEFAULT_STATUS_EN, existing);
    } else if (existing.length > 0) {
      pairs = existing.map((value) => ({ value }));
    } else {
      const defaults = tableUsesChineseContract(table, col) ? DEFAULT_STATUS_ZH : DEFAULT_STATUS_EN;
      pairs = defaults.map((value) => ({ value }));
    }
  }

  const values = pairs.map((p) => p.value);
  const pendingValue =
    values.find((v) =>
      /^(pending|unconfirmed|in progress|pending legal|submitted|待审批|待审|待确认|待法务审批|已提交验收|审批中|待处理)$/i.test(v),
    ) ?? null;
  const approvedValue =
    values.find((v) =>
      /^(approved|qualified|confirmed|completed|closed won|active|putaway|已通过|合格|已准入|已确认|已完成|已完结|已入库|执行中)$/i.test(v),
    ) ?? null;
  const rejectedValue =
    values.find((v) => /^(rejected|已驳回|驳回|不通过|已拒绝)$/i.test(v)) ?? null;

  return { values, pairs, pendingValue, approvedValue, rejectedValue };
}

export interface BoundForeignKeySpec {
  refTable: DBTableSchema;
  valueCol: string;
  labelCol: string;
  qualifiedOnly: boolean;
}

export function isQualifiedSupplierStatus(status: unknown): boolean {
  return status === 'qualified' || status === '合格' || status === '已准入';
}

export function requiresQualifiedSupplier(
  col: DBColumnSchema,
  table?: DBTableSchema,
  refTable?: DBTableSchema,
): boolean {
  if (
    table &&
    (table.id === 't_wms_acceptance_order' || table.tableName === 't_wms_acceptance_order') &&
    col.name.toLowerCase() === 'supplier_id'
  ) {
    return true;
  }
  if (/合格供应商|qualified\s+supplier/i.test(col.comment || '')) {
    return !refTable || refTable.columns.some((c) => c.name === 'status');
  }
  return false;
}

export function resolveBoundForeignKeySpec(
  tableOrId: DBTableSchema | string | undefined,
  colOrName: DBColumnSchema | string,
  tables?: DBTableSchema[],
): BoundForeignKeySpec | null {
  const knownTables = mergeUniqueTables(tables);
  const table =
    typeof tableOrId === 'string'
      ? knownTables.find((t) => t.id === tableOrId)
      : tableOrId;
  const col =
    typeof colOrName === 'string'
      ? table?.columns.find((c) => c.name === colOrName)
      : colOrName;
  if (!col) return null;

  if (!table || !col.references) return null;
  const rel = diagramRelations([table], knownTables).relations.find(edge => edge.toColumnId === col.id);
  if (!rel) return null;
  const refTable = knownTables.find(t => t.id === rel.fromTableId);
  if (!refTable) return null;
  const valueCol = rel.fromColumnName;
  const labelCol = preferredDisplayColumn(refTable, valueCol);
  return {
    refTable,
    valueCol,
    labelCol,
    qualifiedOnly: requiresQualifiedSupplier(col, table, refTable),
  };
}

export function buildForeignKeyOptionsFromRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  valueCol: string,
  labelCol: string,
  opts: {
    qualifiedOnly?: boolean;
    locale?: Locale;
    translateDemoSupplierNames?: boolean;
  } = {},
): SelectOptionItem[] {
  const en = isEnLocale(opts.locale ?? 'zh-CN');
  const seen = new Set<string | number>();
  const options: SelectOptionItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (opts.qualifiedOnly && !isQualifiedSupplierStatus(row.status)) {
      continue;
    }
    if (!Object.hasOwn(row, valueCol)) continue;
    const rawVal = row[valueCol];
    const isValidString = typeof rawVal === 'string' && rawVal.trim().length > 0;
    const isValidNumber = typeof rawVal === 'number' && Number.isFinite(rawVal);
    if (!isValidString && !isValidNumber) continue;

    // Preserve exact referenced column value (including any significant spaces) while rejecting blank strings.
    const val = rawVal as string | number;
    if (seen.has(val)) continue;
    seen.add(val);

    const rawLabel = Object.hasOwn(row, labelCol) && row[labelCol] != null && String(row[labelCol]).trim() !== ''
      ? String(row[labelCol]).trim()
      : String(val);
    const labelStr =
      en && opts.translateDemoSupplierNames && DEMO_SUPPLIER_EN_NAMES[rawLabel]
        ? DEMO_SUPPLIER_EN_NAMES[rawLabel]
        : rawLabel;
    options.push({ label: labelStr, value: val });
  }
  return options;
}

function resolveSupplierOrForeignKeyOptions(
  col: DBColumnSchema,
  locale: Locale,
  table?: DBTableSchema,
  tables?: DBTableSchema[],
  data?: TemplateDataContext,
): SelectOptionItem[] | null {
  const ctx = resolveDataContext(data, table, tables);
  const spec = resolveBoundForeignKeySpec(table, col, ctx.tables);

  if (spec) {
    const { refTable, valueCol, labelCol, qualifiedOnly } = spec;
    const translateDemoSupplierNames = ctx.projectId === 'proj-default-erp';

    if (Object.hasOwn(ctx.tableRows, refTable.id)) {
      return buildForeignKeyOptionsFromRows(ctx.tableRows[refTable.id] ?? [], valueCol, labelCol, {
        qualifiedOnly,
        locale,
        translateDemoSupplierNames,
      });
    }

    if (refTable.id === 't_base_supplier' && ctx.suppliers.length > 0) {
      const supplierRows = ctx.suppliers.map((s) => ({
        id: s.id,
        supplier_code: s.code,
        supplier_name: s.name,
        contact_person: s.contactPerson,
        contact_phone: s.phone,
        tax_rate_default: s.taxRateDefault,
        status: s.status,
      }));
      return buildForeignKeyOptionsFromRows(supplierRows, valueCol, labelCol, {
        qualifiedOnly,
        locale,
        translateDemoSupplierNames,
      });
    }

    if (refTable.id === 't_pms_po_item' && ctx.purchaseOrderItems.length > 0) {
      const poRows = ctx.purchaseOrderItems.map((po) => ({
        id: po.id,
        po_number: po.poNumber,
        supplier_id: po.supplierId,
        ordered_qty: po.orderedQty,
        delivered_qty: po.deliveredQty,
        material_code: po.materialCode,
        unit_price_tax_included: po.unitPriceTaxIncluded,
        tax_rate: po.taxRate,
        project_code: po.projectCode,
        status: po.status,
      }));
      return buildForeignKeyOptionsFromRows(poRows, valueCol, labelCol, {
        qualifiedOnly: false,
        locale,
      });
    }

    return [];
  }

  // If column declares an explicit foreign key / references whose target table doesn't exist, keep empty options.
  if (col.isForeignKey || col.references) {
    return [];
  }

  return null;
}

export function resolveFieldSelectOptions(
  col: DBColumnSchema,
  locale: Locale = getLocale(),
  table?: DBTableSchema,
  tables?: DBTableSchema[],
  data?: TemplateDataContext,
): SelectOptionItem[] {
  const fkOptions = resolveSupplierOrForeignKeyOptions(col, locale, table, tables, data);
  if (fkOptions !== null) return fkOptions;

  const pairs = declaredColumnOptions(col) ?? resolveStatusContract(col, table, data).pairs;
  return pairs.map(({ value, zhHint }) => ({
    label: localizeEnumLabel(String(value), locale, zhHint),
    value,
  }));
}

function formatOptionsPropValue(options: SelectOptionItem[]): string {
  const canUsePlainString =
    options.length > 0 &&
    options.every(
      (opt) =>
        typeof opt.value === 'string' &&
        opt.label === opt.value &&
        opt.value.length > 0 &&
        opt.value.trim() === opt.value &&
        !opt.label.includes(',') &&
        !opt.label.includes('，'),
    );
  if (canUsePlainString) {
    return q(options.map((opt) => opt.label).join(','));
  }
  return `[${options
    .map(
      (opt) =>
        `{ label: ${q(opt.label)}, value: ${typeof opt.value === 'number' ? String(opt.value) : q(opt.value)} }`,
    )
    .join(', ')}]`;
}

function englishTableEntity(table: DBTableSchema): string {
  const cleanCn = table.cnName.replace(/\s*\(.*?\)\s*/g, '').trim();
  if (cleanCn && !/[\u4e00-\u9fff]/.test(cleanCn)) {
    return cleanCn.replace(/\s+table$/i, '').trim() || cleanCn;
  }
  const stripped = table.tableName.replace(/^t_(?:base|pms|wms|crm|oms|sys|biz|app)_/i, '').replace(/^t_/i, '');
  return formatColumnIdentifierLabel(stripped || table.tableName);
}

export function fieldTypeOf(col: DBColumnSchema): string {
  const n = col.name.toLowerCase();
  const t = col.dataType.toUpperCase();
  const c = col.comment || '';
  if (col.isForeignKey || col.references || declaredColumnOptions(col) || (isTextColumn(col) && isEnumLikeColumn(col))) return 'select';
  if (n.includes('remark') || n.includes('desc') || c.includes('备注') || /\b(?:remark|notes?)\b/i.test(c)) return 'textarea';
  if (t.startsWith('DATE') || t.startsWith('TIMESTAMP') || n.endsWith('_date')) return 'date';
  if (/^(?:DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|(?:TINY|SMALL|MEDIUM|BIG)?INT|INTEGER)\b/.test(t) || n.includes('qty') || n.includes('amount')) return 'number';
  return 'input';
}

function fieldObj(
  col: DBColumnSchema,
  opts: { required?: boolean; includeAllOption?: boolean } = {},
  locale: Locale = 'zh-CN',
  table?: DBTableSchema,
  tables?: DBTableSchema[],
  data?: TemplateDataContext,
): string {
  const type = fieldTypeOf(col);
  const parts = [`name: ${q(col.name)}`, `label: ${q(columnLabel(col, locale))}`];
  if (type !== 'input') parts.push(`type: ${q(type)}`);
  if (type === 'select') {
    const rawOpts = resolveFieldSelectOptions(col, locale, table, tables, data);
    const selectOpts =
      opts.includeAllOption && rawOpts.length > 0 && !rawOpts.some(o => o.value === '')
        ? [{ label: isEnLocale(locale) ? 'All' : '全部', value: '' }, ...rawOpts]
        : rawOpts;
    parts.push(`options: ${formatOptionsPropValue(selectOpts)}`);
  }
  if (type === 'textarea') parts.push('span: 2');
  if (opts.required ?? !col.nullable) parts.push('required: true');
  return `{ ${parts.join(', ')} }`;
}

function formFields(
  table: DBTableSchema,
  max = 8,
  locale: Locale = 'zh-CN',
  tables?: DBTableSchema[],
  data?: TemplateDataContext,
): string {
  const cols = table.columns
    .filter((c) => !c.isPrimaryKey && !/^(created_at|updated_at|is_deleted|version)$/i.test(c.name))
    .slice(0, max);
  return `[${cols.map((c) => fieldObj(c, {}, locale, table, tables, data)).join(', ')}]`;
}

function queryFields(
  table: DBTableSchema,
  locale: Locale = 'zh-CN',
  tables?: DBTableSchema[],
  data?: TemplateDataContext,
): string {
  const cols = table.columns.filter((c) => !c.isPrimaryKey);
  const picked: DBColumnSchema[] = [];
  const add = (pred: (c: DBColumnSchema) => boolean) => {
    const c = cols.find((x) => pred(x) && !picked.includes(x));
    if (c) picked.push(c);
  };
  add((c) => /name/i.test(c.name));
  add((c) => /(_no|_code|number)$/i.test(c.name));
  add((c) => /status/i.test(c.name));
  add((c) => fieldTypeOf(c) === 'date');
  while (picked.length < 3 && picked.length < cols.length) add(() => true);
  return `[${picked
    .map((c) => fieldObj(c, { required: false, includeAllOption: true }, locale, table, tables, data))
    .join(', ')}]`;
}

function normalize(tsx: string): string {
  const res = parsePageSource(tsx);
  return res.doc ? printPageSource(res.doc) : tsx;
}

export interface ListPageOptions {
  pageId: string;
  title?: string;
  menuPath?: string[];
  relatedTable?: DBTableSchema;
  withStatusTabs?: boolean;
  filter?: Record<string, string | number>;
  locale?: Locale;
  data?: TemplateDataContext;
}

/**
 * Standard CRUD module page: query form + toolbar + table + pagination,
 * create / edit modals, detail drawer, nested related-records modal → drawer,
 * and (optional) status tabs with an approval modal.
 */
export function generateListPageSource(table: DBTableSchema, tables: DBTableSchema[], opts: ListPageOptions): string {
  const locale = opts.locale ?? getLocale();
  const data = opts.data;
  const mainFilter = opts.filter ? ` filter={${JSON.stringify(opts.filter)}}` : '';
  const statusCol = table.columns.find((c) => /status/i.test(c.name));
  const statusContract = statusCol ? resolveStatusContract(statusCol, table, data) : null;
  const hasPendingTab = Boolean(opts.withStatusTabs && statusCol && statusContract?.pendingValue);
  const hasApprovedTab = Boolean(opts.withStatusTabs && statusCol && statusContract?.approvedValue);
  const tabs = hasPendingTab || hasApprovedTab;
  const canApprove = Boolean(
    hasPendingTab && statusCol && (statusContract?.approvedValue || statusContract?.rejectedValue),
  );

  const pendingPair = statusContract?.pairs.find((p) => p.value === statusContract.pendingValue);
  const approvedPair = statusContract?.pairs.find((p) => p.value === statusContract.approvedValue);
  const pendingTabTitle =
    statusContract?.pendingValue
      ? localizeEnumLabel(statusContract.pendingValue, locale, pendingPair?.zhHint)
      : isEnLocale(locale)
      ? 'Pending'
      : '待审批';
  const approvedTabTitle =
    statusContract?.approvedValue
      ? localizeEnumLabel(statusContract.approvedValue, locale, approvedPair?.zhHint)
      : isEnLocale(locale)
      ? 'Approved'
      : '已通过';

  const decisionOptions: SelectOptionItem[] = [];
  if (statusContract?.approvedValue) {
    decisionOptions.push({
      label: isEnLocale(locale) ? 'Approve' : '通过',
      value: statusContract.approvedValue,
    });
  }
  if (statusContract?.rejectedValue) {
    decisionOptions.push({
      label: isEnLocale(locale) ? 'Reject' : '驳回',
      value: statusContract.rejectedValue,
    });
  }

  if (isEnLocale(locale)) {
    const baseEntity = englishTableEntity(table);
    const title = opts.title || `${baseEntity} Management`;
    const entity = title.replace(/\s+(?:Management|List|Ledger|Directory)$/i, '').trim() || baseEntity;
    const menu = opts.menuPath ?? ['Workspace', title];
    const related = opts.relatedTable && opts.relatedTable.id !== table.id ? opts.relatedTable : undefined;
    const relatedEntity = related ? englishTableEntity(related) : 'Records';

    const rowActions = (approve: boolean) => `[
    { label: 'View', onClick: () => openDrawer('d-detail') },
    { label: 'Edit', onClick: () => openModal('m-edit') },${
      approve ? `\n    { label: 'Approve', onClick: () => openModal('m-approve') },` : ''
    }
    { label: 'Delete', danger: true, onClick: () => { confirm(${q(`Delete this ${entity.toLowerCase()} record?`)}); deleteRow(); toast('Deleted'); } },
  ]`;

    const toolbar = `
          <Toolbar align="between" title=${JSON.stringify(`${entity} List`)}>
            <Button type="primary" icon="plus" onClick={() => openModal('m-create')}>New</Button>
            <Button icon="download" onClick={() => toast('Exported to CSV', 'info')}>Export</Button>
          </Toolbar>`;

    const mainTable = `<Table pfId="tbl-main" table="${table.id}"${mainFilter} selectable rowActions={${rowActions(false)}} />`;

    const pendingTabBlock = hasPendingTab
      ? `
          <Tab title=${JSON.stringify(pendingTabTitle)} badge={3}>
            <Table pfId="tbl-pending" table="${table.id}" filter={{ ${statusCol!.name}: ${q(statusContract!.pendingValue!)} }} rowActions={${rowActions(canApprove)}} />
          </Tab>`
      : '';
    const approvedTabBlock = hasApprovedTab
      ? `
          <Tab title=${JSON.stringify(approvedTabTitle)}>
            <Table pfId="tbl-approved" table="${table.id}" filter={{ ${statusCol!.name}: ${q(statusContract!.approvedValue!)} }} rowActions={${rowActions(false)}} />
          </Tab>`
      : '';

    const listBody = tabs
      ? `
      <Card>
        <Tabs pfId="tabs-status">
          <Tab title="All">${toolbar}
            ${mainTable}
          </Tab>${pendingTabBlock}${approvedTabBlock}
        </Tabs>
      </Card>`
      : `
      <Card>${toolbar}
        ${mainTable}
      </Card>`;

    const formModal = (id: string, formId: string, modalTitle: string, okToast: string) => `
      <Modal id="${id}" title=${JSON.stringify(modalTitle)} width={720} footer={false}>
        <Form pfId="${formId}" table="${table.id}" cols={2} fields={${formFields(table, 8, locale, tables, data)}} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>Cancel</Button>
          <Button type="primary" onClick={() => { submitForm('${formId}'); toast('${okToast}'); closeOverlay(); refresh('tbl-main'); }}>Save</Button>
        </Toolbar>
      </Modal>`;

    const relatedPart = related
      ? `
      <Modal id="m-related" title=${JSON.stringify(`Related ${relatedEntity}`)} width={900} footer={false}>
        <Alert type="info" message="Nested overlays supported: click [View] on any row to open its detail drawer." />
        <Table pfId="tbl-related" table="${related.id}" pageSize={5} rowActions={[{ label: 'View', onClick: () => openDrawer('d-related-detail') }]} />
      </Modal>
      <Drawer id="d-related-detail" title="Record Details" width={480}>
        <Descriptions table="${related.id}" column={1} />
      </Drawer>`
      : '';

    const secondaryApproveBtnEn = statusContract?.rejectedValue
      ? `<Button type="danger" onClick={() => { updateRow({ ${statusCol!.name}: ${q(statusContract.rejectedValue)} }); toast('Rejected', 'warning'); closeOverlay(); }}>Reject</Button>`
      : `<Button onClick={() => closeOverlay()}>Cancel</Button>`;

    const approvePart = canApprove
      ? `
      <Modal id="m-approve" title=${JSON.stringify(`Approve ${entity}`)} width={560} footer={false}>
        <Descriptions table="${table.id}" column={2} />
        <Form pfId="form-approve" cols={1}>
          <Radio label="Decision" name="decision" options={${formatOptionsPropValue(decisionOptions)}} required />
          <Textarea label="Review Notes" name="opinion" />
        </Form>
        <Toolbar align="right">
          ${secondaryApproveBtnEn}
          <Button type="primary" onClick={() => { submitForm('form-approve'); updateRow({ ${statusCol!.name}: '{{form.form-approve.decision}}' }); toast('Submitted'); closeOverlay(); }}>Submit</Button>
        </Toolbar>
      </Modal>`
      : '';

    const tsxEn = `// @protoflow page: ${opts.pageId}
// Template: Standard List Page (Filter + Tabs + Table + Pagination + Create/Edit Modals + Detail Drawer)
export default function Page() {
  return (
    <Page title=${JSON.stringify(title)} description=${JSON.stringify(`Generated by Alex standard list template, bound to ${table.tableName}`)}>
      <PageHeader title=${JSON.stringify(title)} breadcrumb={[${menu.map(q).join(', ')}]} />
      <Card title="Filter">
        <QueryForm target="tbl-main" cols={3} fields={${queryFields(table, locale, tables, data)}} />
      </Card>${listBody}${formModal('m-create', 'form-create', 'Create Record', 'Record created')}${formModal('m-edit', 'form-edit', `Edit ${entity}`, 'Changes saved')}
      <Drawer id="d-detail" title="Details" width={560}>
        <Descriptions title="Overview" table="${table.id}" column={2} />
        <Divider text="Activity Log" />
        <Timeline items={[{ title: 'Record Created', time: '2026-10-20 09:12', status: 'done' }, { title: 'Submitted for Review', time: '2026-10-21 14:30', status: 'done' }, { title: 'Pending Department Approval', time: '', status: 'current' }]} />
        <Toolbar align="right">
          ${related ? `<Button onClick={() => openModal('m-related')}>View Related</Button>` : ''}
          <Button type="primary" icon="edit" onClick={() => openModal('m-edit')}>Edit</Button>
        </Toolbar>
      </Drawer>${relatedPart}${approvePart}
    </Page>
  );
}
`;
    return normalize(tsxEn);
  }

  const title = opts.title || table.cnName.replace(/\s*\(.*?\)\s*/g, '').replace(/表$/, '') + '管理';
  const entity = title.replace(/管理$/, '');
  const menu = opts.menuPath ?? ['业务模块', title];
  const related = opts.relatedTable && opts.relatedTable.id !== table.id ? opts.relatedTable : undefined;
  const displayFirst = defaultDisplayColumns(table, 1)[0];
  const labelField = displayFirst?.name ?? 'id';

  const rowActions = (approve: boolean) => `[
    { label: '查看', onClick: () => openDrawer('d-detail') },
    { label: '编辑', onClick: () => openModal('m-edit') },${
      approve ? `\n    { label: '审批', onClick: () => openModal('m-approve') },` : ''
    }
    { label: '删除', danger: true, onClick: () => { confirm('确定删除该${entity}吗？'); deleteRow(); toast('已删除'); } },
  ]`;

  const toolbar = `
          <Toolbar align="between" title="${entity}列表">
            <Button type="primary" icon="plus" onClick={() => openModal('m-create')}>新增${entity}</Button>
            <Button icon="download" onClick={() => toast('已导出 Excel', 'info')}>导出</Button>
          </Toolbar>`;

  const mainTable = `<Table pfId="tbl-main" table="${table.id}"${mainFilter} selectable rowActions={${rowActions(false)}} />`;

  const pendingTabBlockZh = hasPendingTab
    ? `
          <Tab title=${JSON.stringify(pendingTabTitle)} badge={3}>
            <Table pfId="tbl-pending" table="${table.id}" filter={{ ${statusCol!.name}: ${q(statusContract!.pendingValue!)} }} rowActions={${rowActions(canApprove)}} />
          </Tab>`
    : '';
  const approvedTabBlockZh = hasApprovedTab
    ? `
          <Tab title=${JSON.stringify(approvedTabTitle)}>
            <Table pfId="tbl-approved" table="${table.id}" filter={{ ${statusCol!.name}: ${q(statusContract!.approvedValue!)} }} rowActions={${rowActions(false)}} />
          </Tab>`
    : '';

  const listBody = tabs
    ? `
      <Card>
        <Tabs pfId="tabs-status">
          <Tab title="全部">${toolbar}
            ${mainTable}
          </Tab>${pendingTabBlockZh}${approvedTabBlockZh}
        </Tabs>
      </Card>`
    : `
      <Card>${toolbar}
        ${mainTable}
      </Card>`;

  const formModal = (id: string, formId: string, modalTitle: string, okToast: string) => `
      <Modal id="${id}" title="${modalTitle}" width={720} footer={false}>
        <Form pfId="${formId}" table="${table.id}" cols={2} fields={${formFields(table, 8, 'zh-CN', tables, data)}} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button type="primary" onClick={() => { submitForm('${formId}'); toast('${okToast}'); closeOverlay(); refresh('tbl-main'); }}>保存</Button>
        </Toolbar>
      </Modal>`;

  const relatedPart = related
    ? `
      <Modal id="m-related" title="关联${related.cnName.replace(/\s*\(.*?\)\s*/g, '')}" width={900} footer={false}>
        <Alert type="info" message="弹框中可以继续打开抽屉：点击行操作【查看】" />
        <Table pfId="tbl-related" table="${related.id}" pageSize={5} rowActions={[{ label: '查看', onClick: () => openDrawer('d-related-detail') }]} />
      </Modal>
      <Drawer id="d-related-detail" title="明细详情" width={480}>
        <Descriptions table="${related.id}" column={1} />
      </Drawer>`
    : '';

  const secondaryApproveBtnZh = statusContract?.rejectedValue
    ? `<Button type="danger" onClick={() => { updateRow({ ${statusCol!.name}: ${q(statusContract.rejectedValue)} }); toast('已驳回', 'warning'); closeOverlay(); }}>驳回</Button>`
    : `<Button onClick={() => closeOverlay()}>取消</Button>`;

  const approvePart = canApprove
    ? `
      <Modal id="m-approve" title="${entity}审批" width={560} footer={false}>
        <Descriptions table="${table.id}" column={2} />
        <Form pfId="form-approve" cols={1}>
          <Radio label="审批结论" name="decision" options={${formatOptionsPropValue(decisionOptions)}} required />
          <Textarea label="审批意见" name="opinion" />
        </Form>
        <Toolbar align="right">
          ${secondaryApproveBtnZh}
          <Button type="primary" onClick={() => { submitForm('form-approve'); updateRow({ ${statusCol!.name}: '{{form.form-approve.decision}}' }); toast('已提交'); closeOverlay(); }}>提交</Button>
        </Toolbar>
      </Modal>`
    : '';

  const tsx = `// @protoflow page: ${opts.pageId}
// 模板：标准列表页（查询 + 页签 + 列表 + 分页 + 新增/编辑弹框 + 详情抽屉 + 嵌套弹层）
export default function Page() {
  return (
    <Page title="${title}" description="由 Alex 标准列表页模板生成，绑定物理表 ${table.tableName}">
      <PageHeader title="${title}" breadcrumb={[${menu.map(q).join(', ')}]} />
      <Card>
        <QueryForm target="tbl-main" cols={3} fields={${queryFields(table, 'zh-CN', tables, data)}} />
      </Card>${listBody}${formModal('m-create', 'form-create', `新增${entity}`, '新增成功')}${formModal('m-edit', 'form-edit', `编辑${entity}`, '保存成功')}
      <Drawer id="d-detail" title="${entity}详情" width={560}>
        <Descriptions title="基本信息" table="${table.id}" column={2} />
        <Divider text="操作记录" />
        <Timeline items={[{ title: '创建记录', time: '2026-10-20 09:12', status: 'done' }, { title: '提交审批', time: '2026-10-21 14:30', status: 'done' }, { title: '待部门审批', time: '', status: 'current' }]} />
        <Toolbar align="right">
          ${related ? `<Button onClick={() => openModal('m-related')}>查看关联明细</Button>` : ''}
          <Button type="primary" icon="edit" onClick={() => openModal('m-edit')}>编辑</Button>
        </Toolbar>
      </Drawer>${relatedPart}${approvePart}
    </Page>
  );
}
`;
  void labelField;
  return normalize(tsx);
}

export function generateFormPageSource(
  table: DBTableSchema,
  opts: { pageId: string; title?: string; locale?: Locale; data?: TemplateDataContext },
  tables?: DBTableSchema[],
): string {
  const locale = opts.locale ?? getLocale();
  if (isEnLocale(locale)) {
    const title = opts.title || `Create ${englishTableEntity(table)}`;
    return normalize(`// @protoflow page: ${opts.pageId}
// Template: Form Page
export default function Page() {
  return (
    <Page title=${JSON.stringify(title)}>
      <PageHeader title=${JSON.stringify(title)} back />
      <Card title="Create Record">
        <Form pfId="form-main" table="${table.id}" cols={3} fields={${formFields(table, 12, locale, tables, opts.data)}} />
      </Card>
      <Toolbar align="center">
        <Button onClick={() => resetForm('form-main')}>Reset</Button>
        <Button type="primary" onClick={() => { submitForm('form-main'); toast('Submitted'); }}>Submit</Button>
      </Toolbar>
    </Page>
  );
}
`);
  }
  const title = opts.title || `新增${table.cnName.replace(/\s*\(.*?\)\s*/g, '').replace(/表$/, '')}`;
  return normalize(`// @protoflow page: ${opts.pageId}
// 模板：单据表单页
export default function Page() {
  return (
    <Page title="${title}">
      <PageHeader title="${title}" back />
      <Card title="基本信息">
        <Form pfId="form-main" table="${table.id}" cols={3} fields={${formFields(table, 12, 'zh-CN', tables, opts.data)}} />
      </Card>
      <Toolbar align="center">
        <Button onClick={() => resetForm('form-main')}>重置</Button>
        <Button type="primary" onClick={() => { submitForm('form-main'); toast('提交成功'); }}>提交</Button>
      </Toolbar>
    </Page>
  );
}
`);
}

export function generateDetailPageSource(table: DBTableSchema, opts: { pageId: string; title?: string; locale?: Locale }): string {
  const locale = opts.locale ?? getLocale();
  if (isEnLocale(locale)) {
    const title = opts.title || `${englishTableEntity(table)} Details`;
    return normalize(`// @protoflow page: ${opts.pageId}
// Template: Detail Page
export default function Page() {
  return (
    <Page title=${JSON.stringify(title)}>
      <PageHeader title=${JSON.stringify(title)} back />
      <Row gutter={16}>
        <Col span={8}><Statistic title="Total Records" table="${table.id}" /></Col>
        <Col span={8}><Statistic title="New This Month" value="12" trend="up" /></Col>
        <Col span={8}><Statistic title="Pending" value="3" trend="down" /></Col>
      </Row>
      <Card title="Details">
        <Descriptions table="${table.id}" column={3} />
      </Card>
      <Card title="Activity Log">
        <Timeline items={[{ title: 'Submitted', time: '2026-10-20 09:12', status: 'done' }, { title: 'Under Review', time: '', status: 'current' }]} />
      </Card>
    </Page>
  );
}
`);
  }
  const title = opts.title || `${table.cnName.replace(/\s*\(.*?\)\s*/g, '').replace(/表$/, '')}详情`;
  return normalize(`// @protoflow page: ${opts.pageId}
// 模板：详情页
export default function Page() {
  return (
    <Page title="${title}">
      <PageHeader title="${title}" back />
      <Row gutter={16}>
        <Col span={8}><Statistic title="记录总数" table="${table.id}" suffix="条" /></Col>
        <Col span={8}><Statistic title="本月新增" value="12" trend="up" /></Col>
        <Col span={8}><Statistic title="待处理" value="3" trend="down" /></Col>
      </Row>
      <Card title="基本信息">
        <Descriptions table="${table.id}" column={3} />
      </Card>
      <Card title="处理记录">
        <Timeline items={[{ title: '提交', time: '2026-10-20 09:12', status: 'done' }, { title: '审批中', time: '', status: 'current' }]} />
      </Card>
    </Page>
  );
}
`);
}

export function generateMasterDetailPageSource(
  headerTable: DBTableSchema,
  detailTable: DBTableSchema,
  pickerTable: DBTableSchema | undefined,
  supplierTable: DBTableSchema | undefined,
  opts: { pageId: string; title: string; menuPath?: string[]; locale?: Locale; data?: TemplateDataContext },
  tables?: DBTableSchema[],
): string {
  const locale = opts.locale ?? getLocale();
  const data = opts.data;
  const pickTblId = pickerTable?.id ?? detailTable.id;
  const supTblId = supplierTable?.id ?? headerTable.id;
  const allTables = mergeUniqueTables(
    tables,
    data?.tables,
    [headerTable, detailTable],
    pickerTable ? [pickerTable] : undefined,
    supplierTable ? [supplierTable] : undefined,
  );

  if (isEnLocale(locale)) {
    const menu = opts.menuPath ?? ['Receiving Management', opts.title];
    return normalize(`// @protoflow page: ${opts.pageId}
// Template: Master-Detail Document Page (Header Form + Line Grid + PO Picker + 3-Level Nested Overlays)
export default function Page() {
  return (
    <Page title=${JSON.stringify(opts.title)} description="Master-detail composite document prototype with modal picker import and 3-level nested Modal → Drawer → Modal workflows">
      <PageHeader title=${JSON.stringify(opts.title)} subTitle="Supports header entry, purchase order line import, and nested inspection drawers" breadcrumb={[${menu.map(q).join(', ')}]} />
      <Card>
        <Steps current={1} items={['Fill Receipt Header', 'Import PO Lines', 'Verify Qty & Tax Price', 'Submit & Putaway']} />
      </Card>
      <Card title="1. Document Header (${headerTable.tableName})" extra="Required fields validated">
        <Form pfId="field-supplier-select" table="${headerTable.id}" cols={3} fields={${formFields(headerTable, 9, locale, allTables, data)}} />
      </Card>
      <Card title="2. Receipt Line Items (${detailTable.tableName})" extra="Supports PO picker import and QC drawer inspection">
        <Toolbar>
          <Button pfId="btn-import-po" type="primary" icon="plus" onClick={() => { submitForm('field-supplier-select'); openModal('m-pick-po'); }}>Import from PO</Button>
          <Button icon="plus" onClick={() => openModal('m-add-line')}>New Line</Button>
          <Button icon="eye" onClick={() => openDrawer('d-supplier-profile')}>View Supplier</Button>
        </Toolbar>
        <Table
          pfId="acceptance-detail-grid"
          table="${detailTable.id}"
          selectable
          pageSize={5}
          rowActions={[
            { label: 'View', onClick: () => openDrawer('d-line-detail') },
            { label: 'Edit', onClick: () => openModal('m-edit-line') },
            { label: 'Delete', danger: true, onClick: () => { confirm('Remove this receipt line item?'); deleteRow(); toast('Line item removed'); } },
          ]}
        />
      </Card>
      <Toolbar align="right">
        <Button onClick={() => { resetForm('field-supplier-select'); toast('Header reset', 'info'); }}>Reset</Button>
        <Button onClick={() => { submitForm('field-supplier-select'); toast('Draft saved', 'info'); }}>Save</Button>
        <Button pfId="btn-submit-acceptance" type="primary" icon="check" onClick={() => { submitForm('field-supplier-select'); toast('Receipt inspection submitted!'); }}>Submit</Button>
      </Toolbar>
      <Modal id="m-pick-po" title="Select Purchase Order Lines (Level 1 Modal → Level 2 Drawer)" width={920} footer={false}>
        <Alert type="info" message="Tip: Select PO lines and click [Import Selected] below, or click [Supplier Profile] on a row to open a nested drawer." />
        <QueryForm target="tbl-po-picker" cols={3} fields={${queryFields(pickerTable ?? detailTable, locale, allTables, data)}} />
        <Table
          pfId="tbl-po-picker"
          table="${pickTblId}"
          selectable
          pageSize={5}
          rowActions={[
            { label: 'Supplier Profile', onClick: () => openDrawer('d-supplier-profile') },
            { label: 'QC Spec', onClick: () => openModal('m-qc-spec') },
          ]}
        />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>Cancel</Button>
          <Button type="primary" icon="check" onClick={() => { importPurchaseOrderLines('tbl-po-picker', 'acceptance-detail-grid', 'field-supplier-select'); closeOverlay(); }}>Import Selected</Button>
        </Toolbar>
      </Modal>
      <Modal id="m-add-line" title="Create Record" width={680} footer={false}>
        <Form pfId="form-add-line" table="${detailTable.id}" cols={2} fields={${formFields(detailTable, 8, locale, allTables, data)}} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>Cancel</Button>
          <Button type="primary" onClick={() => { submitForm('form-add-line'); toast('Line item added'); closeOverlay(); refresh('acceptance-detail-grid'); }}>Save</Button>
        </Toolbar>
      </Modal>
      <Modal id="m-edit-line" title="Edit Line Item" width={680} footer={false}>
        <Form pfId="form-edit-line" table="${detailTable.id}" cols={2} fields={${formFields(detailTable, 8, locale, allTables, data)}} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>Cancel</Button>
          <Button type="primary" onClick={() => { submitForm('form-edit-line'); toast('Line item updated'); closeOverlay(); refresh('acceptance-detail-grid'); }}>Save</Button>
        </Toolbar>
      </Modal>
      <Drawer id="d-line-detail" title="Details" width={540}>
        <Descriptions title="Line Item Details" table="${detailTable.id}" column={2} />
        <Divider text="Quality Inspection" />
        <Toolbar align="right">
          <Button onClick={() => openModal('m-qc-spec')}>Open QC Spec</Button>
          <Button type="primary" onClick={() => openModal('m-edit-line')}>Edit</Button>
        </Toolbar>
      </Drawer>
      <Drawer id="d-supplier-profile" title="Supplier Qualification Profile (Level 2 Drawer)" width={560}>
        <Alert type="success" message="Inside this nested drawer, click below to open the 3rd-level [QC Sampling Standard] modal." />
        <Descriptions title="Supplier Business & Tax Profile" table="${supTblId}" column={2} />
        <Divider text="Recent Fulfillment History" />
        <Timeline items={[{ title: 'Annual Qualification Approved', time: '2026-09-01 10:00', status: 'done' }, { title: 'Master Supply Contract Signed', time: '2026-10-12 15:20', status: 'done' }, { title: 'Current Receipt Inspection', time: 'Now', status: 'current' }]} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>Cancel</Button>
          <Button type="primary" onClick={() => openModal('m-qc-spec')}>View QC Standard</Button>
        </Toolbar>
      </Drawer>
      <Modal id="m-qc-spec" title="Material Quality & Sampling Standard (Level 3 Modal)" width={600} footer={false}>
        <Alert type="warning" message="3-level overlay demo: Main Page → PO Picker Modal → Supplier Drawer → QC Standard Modal" />
        <Descriptions
          title="Sampling & Acceptance Quality Limit (AQL)"
          items={[
            { label: 'Inspection Standard', value: 'GB/T 2828.1-2012' },
            { label: 'Inspection Level', value: 'General Inspection Level II' },
            { label: 'AQL Threshold', value: 'Major 0.65 / Minor 2.5' },
            { label: 'Unit Price Tolerance', value: '±0.50% (triggers audit alert if exceeded)' },
          ]}
          column={2}
        />
        <Toolbar align="right">
          <Button type="primary" onClick={() => closeOverlay()}>Close</Button>
        </Toolbar>
      </Modal>
    </Page>
  );
}
`);
  }

  const menu = opts.menuPath ?? ['验收入库管理', opts.title];

  return normalize(`// @protoflow page: ${opts.pageId}
// 模板：主子表复合单据页（单据头表单 + 明细表 + 弹窗选单回填 + 三级嵌套弹框/抽屉）
export default function Page() {
  return (
    <Page title="${opts.title}" description="主子表复合单据原型，支持弹窗选单回填及 Modal → Drawer → Modal 多级弹层嵌套">
      <PageHeader title="${opts.title}" subTitle="支持主表填写、采购订单弹窗选单转入、多级抽屉联查" breadcrumb={[${menu.map(q).join(', ')}] } />
      <Card>
        <Steps current={1} items={['填写验收单据头', '转入采购订单明细', '核对实收数量与税价', '提交入库闭环']} />
      </Card>
      <Card title="一、验收单据头信息 (${headerTable.tableName})" extra="必填项已做校验标记">
        <Form pfId="field-supplier-select" table="${headerTable.id}" cols={3} fields={${formFields(headerTable, 9, 'zh-CN', allTables, data)}} />
      </Card>
      <Card title="二、到货验收明细行 (${detailTable.tableName})" extra="支持采购订单弹窗选单与质检抽屉联查">
        <Toolbar>
          <Button pfId="btn-import-po" type="primary" icon="plus" onClick={() => { submitForm('field-supplier-select'); openModal('m-pick-po'); }}>从采购订单转入明细</Button>
          <Button icon="plus" onClick={() => openModal('m-add-line')}>手工新增明细行</Button>
          <Button icon="eye" onClick={() => openDrawer('d-supplier-profile')}>查看供方档案抽屉</Button>
        </Toolbar>
        <Table
          pfId="acceptance-detail-grid"
          table="${detailTable.id}"
          selectable
          pageSize={5}
          rowActions={[
            { label: '质检抽屉', onClick: () => openDrawer('d-line-detail') },
            { label: '编辑行', onClick: () => openModal('m-edit-line') },
            { label: '删除', danger: true, onClick: () => { confirm('确定移除该验收明细行吗？'); deleteRow(); toast('已移除明细行'); } },
          ]}
        />
      </Card>
      <Toolbar align="right">
        <Button onClick={() => { resetForm('field-supplier-select'); toast('已重置单据头', 'info'); }}>重置表单</Button>
        <Button onClick={() => { submitForm('field-supplier-select'); toast('草稿已保存', 'info'); }}>暂存草稿</Button>
        <Button pfId="btn-submit-acceptance" type="primary" icon="check" onClick={() => { submitForm('field-supplier-select'); toast('验收单已提交入库！'); }}>提交验收单</Button>
      </Toolbar>
      <Modal id="m-pick-po" title="选择待转入采购订单明细（一级弹框 → 可继续打开二级抽屉）" width={920} footer={false}>
        <Alert type="info" message="提示：勾选采购订单行后点击底部【转入选中明细】；也可点击行右侧【供方档案】在当前弹框之上继续打开二级抽屉！" />
        <QueryForm target="tbl-po-picker" cols={3} fields={${queryFields(pickerTable ?? detailTable, 'zh-CN', allTables, data)}} />
        <Table
          pfId="tbl-po-picker"
          table="${pickTblId}"
          selectable
          pageSize={5}
          rowActions={[
            { label: '供方档案(二级抽屉)', onClick: () => openDrawer('d-supplier-profile') },
            { label: '质检标准(三级弹框)', onClick: () => openModal('m-qc-spec') },
          ]}
        />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button type="primary" icon="check" onClick={() => { importPurchaseOrderLines('tbl-po-picker', 'acceptance-detail-grid', 'field-supplier-select'); closeOverlay(); }}>转入选中明细</Button>
        </Toolbar>
      </Modal>
      <Modal id="m-add-line" title="手工新增验收明细行" width={680} footer={false}>
        <Form pfId="form-add-line" table="${detailTable.id}" cols={2} fields={${formFields(detailTable, 8, 'zh-CN', allTables, data)}} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button type="primary" onClick={() => { submitForm('form-add-line'); toast('已新增验收明细行'); closeOverlay(); refresh('acceptance-detail-grid'); }}>确认添加</Button>
        </Toolbar>
      </Modal>
      <Modal id="m-edit-line" title="编辑验收明细行" width={680} footer={false}>
        <Form pfId="form-edit-line" table="${detailTable.id}" cols={2} fields={${formFields(detailTable, 8, 'zh-CN', allTables, data)}} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button type="primary" onClick={() => { submitForm('form-edit-line'); toast('明细行已更新'); closeOverlay(); refresh('acceptance-detail-grid'); }}>保存修改</Button>
        </Toolbar>
      </Modal>
      <Drawer id="d-line-detail" title="验收明细行质检详情（抽屉内可再调起弹框）" width={540}>
        <Descriptions title="明细行字段信息" table="${detailTable.id}" column={2} />
        <Divider text="抽检操作" />
        <Toolbar align="right">
          <Button onClick={() => openModal('m-qc-spec')}>打开物料质检标准弹框</Button>
          <Button type="primary" onClick={() => openModal('m-edit-line')}>编辑此行</Button>
        </Toolbar>
      </Drawer>
      <Drawer id="d-supplier-profile" title="供应商主数据资质档案（二级嵌套抽屉）" width={560}>
        <Alert type="success" message="当前处于嵌套抽屉中，您还可以点击下方按钮继续弹出第三层【物料质检标准】弹框！" />
        <Descriptions title="供应商工商与税务档案" table="${supTblId}" column={2} />
        <Divider text="近期履约记录" />
        <Timeline items={[{ title: '年度资质年审通过', time: '2026-09-01 10:00', status: 'done' }, { title: '首批集采合同签署', time: '2026-10-12 15:20', status: 'done' }, { title: '本次到货验收流转中', time: '当前', status: 'current' }]} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>关闭抽屉</Button>
          <Button type="primary" onClick={() => openModal('m-qc-spec')}>调起三级弹框：物料质检标准</Button>
        </Toolbar>
      </Drawer>
      <Modal id="m-qc-spec" title="国家/企业物料质检标准规范（三级嵌套弹框）" width={600} footer={false}>
        <Alert type="warning" message="三级弹层演示：主页面 → 一级选单弹框 → 二级供方抽屉 → 三级质检标准弹框" />
        <Descriptions
          title="质检抽样与允收标准 (AQL)"
          items={[
            { label: '检验标准号', value: 'GB/T 2828.1-2012' },
            { label: '抽样水平', value: '一般检验水平 II' },
            { label: '合格质量限 (AQL)', value: '主缺陷 0.65 / 次缺陷 2.5' },
            { label: '单价容差上限', value: '±0.50% (超出自动触发审计预警)' },
          ]}
          column={2}
        />
        <Toolbar align="right">
          <Button type="primary" onClick={() => closeOverlay()}>我已知晓，返回上一层</Button>
        </Toolbar>
      </Modal>
    </Page>
  );
}
`);
}

export function generateBlankPageSource(opts: { pageId: string; title: string; platform?: PagePlatform; locale?: Locale }): string {
  const locale = opts.locale ?? getLocale();
  if (opts.platform === 'mobile') {
    return generateBlankMobilePageSource({ ...opts, locale });
  }
  if (isEnLocale(locale)) {
    return normalize(`// @protoflow page: ${opts.pageId}
export default function Page() {
  return (
    <Page title=${JSON.stringify(opts.title)}>
      <PageHeader title=${JSON.stringify(opts.title)} />
      <Card title="Workspace">
        <Empty description="Drag components from the left palette to start designing" />
      </Card>
    </Page>
  );
}
`);
  }
  return normalize(`// @protoflow page: ${opts.pageId}
export default function Page() {
  return (
    <Page title="${opts.title}">
      <PageHeader title="${opts.title}" />
      <Card title="内容区">
        <Empty description="从左侧物料库拖入组件开始设计" />
      </Card>
    </Page>
  );
}
`);
}

export function generateBlankMobilePageSource(opts: { pageId: string; title: string; locale?: Locale }): string {
  const locale = opts.locale ?? getLocale();
  if (isEnLocale(locale)) {
    return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="back" rightIcon="avatar" />
      <MSurface title={${JSON.stringify(opts.title)}} subtitle="Modern mobile canvas · Drag M* mobile components from the left palette">
        <MButton variant="tonal" block={true}>Get Started</MButton>
      </MSurface>
    </MobilePage>
  );
}
`);
  }
  return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="back" rightIcon="avatar" />
      <MSurface title={${JSON.stringify(opts.title)}} subtitle="Gemini 现代移动页面 · 可从左侧拖入 M* 移动物料">
        <MButton variant="tonal" block={true}>开始体验</MButton>
      </MSurface>
    </MobilePage>
  );
}
`);
}

export type PageTemplateKind =
  | 'list'
  | 'master_detail'
  | 'form'
  | 'detail'
  | 'blank'
  | 'mobile_explore'
  | 'mobile_workspace'
  | 'mobile_ai'
  | 'mobile_form'
  | 'mobile_profile';

export interface PageTemplateDescriptor {
  kind: PageTemplateKind;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  needsTable: boolean;
}

export const PAGE_TEMPLATES: PageTemplateDescriptor[] = [
  {
    kind: 'list',
    title: '标准列表页',
    titleEn: 'Standard List Page',
    description: '查询条件 + 页签 + 列表 + 分页 + 新增/编辑弹框 + 详情抽屉',
    descriptionEn: 'Filter bar + status tabs + table + pagination + create/edit modals + detail drawer',
    needsTable: true,
  },
  {
    kind: 'master_detail',
    title: '主子表复合单据页',
    titleEn: 'Master-Detail Document Page',
    description: '单据头表单 + 明细表 + 弹窗选单回填 + 三级嵌套弹框/抽屉',
    descriptionEn: 'Document header form + line grid + picker import + 3-level nested modals & drawers',
    needsTable: true,
  },
  {
    kind: 'form',
    title: '单据表单页',
    titleEn: 'Form Page',
    description: '多列表单 + 提交/重置',
    descriptionEn: 'Multi-column data entry form with submit & reset actions',
    needsTable: true,
  },
  {
    kind: 'detail',
    title: '详情页',
    titleEn: 'Detail Page',
    description: '指标卡 + 描述列表 + 处理记录',
    descriptionEn: 'KPI stat cards + field descriptions + activity timeline',
    needsTable: true,
  },
  {
    kind: 'blank',
    title: '空白页',
    titleEn: 'Blank Page',
    description: '从零开始拖拽设计',
    descriptionEn: 'Start from an empty canvas and drag components freely',
    needsTable: false,
  },
];

export const MOBILE_PAGE_TEMPLATES: PageTemplateDescriptor[] = [
  {
    kind: 'mobile_explore',
    title: 'C端探索/商城首页',
    titleEn: 'Consumer Explore & Storefront',
    description: '流光问候头 + 胶囊搜索 + Bento 宫格 + 瀑布流卡片 + 规格半屏抽屉 + 悬浮底栏',
    descriptionEn: 'Greeting hero + pill search + Bento grid + waterfall feed + option bottom sheet + floating tab bar',
    needsTable: false,
  },
  {
    kind: 'mobile_workspace',
    title: 'B端移动审批/待办页',
    titleEn: 'Mobile Approval & Tasks',
    description: '趋势指标卡 + 胶囊状态切换 + 业务单据流 + 详情与新建半屏抽屉',
    descriptionEn: 'Trend KPI card + status pills + task list + detail & create bottom sheets',
    needsTable: true,
  },
  {
    kind: 'mobile_ai',
    title: 'Gemini 智能助手页',
    titleEn: 'Gemini AI Assistant',
    description: '顶部模型切换顶栏 + 对话消息流 + 启发磁贴 + 底部多模态胶囊输入舱',
    descriptionEn: 'Model switcher header + chat stream + prompt tiles + docked multimodal composer',
    needsTable: false,
  },
  {
    kind: 'mobile_form',
    title: '移动端触控录入页',
    titleEn: 'Mobile Touch Form',
    description: '48px 柔和填充式输入框 + 半屏选择器 + 胶囊点选组 + 底部悬浮提交坞',
    descriptionEn: '48px soft-filled inputs + bottom-sheet pickers + chip selectors + docked submit bar',
    needsTable: true,
  },
  {
    kind: 'mobile_profile',
    title: '现代个人中心页',
    titleEn: 'Modern User Profile',
    description: '品牌视觉头卡 + 快捷 Bento 磁贴 + 圆角分组列表 + 悬浮胶囊底栏',
    descriptionEn: 'Brand banner + quick Bento tiles + grouped settings list + floating tab bar',
    needsTable: false,
  },
  {
    kind: 'blank',
    title: '空白移动页',
    titleEn: 'Blank Mobile Page',
    description: '极简顶栏 + 空白移动画布，从零自由搭建',
    descriptionEn: 'Minimal top bar + empty mobile viewport to build from scratch',
    needsTable: false,
  },
];

function generateMobileFromTemplate(
  kind: PageTemplateKind,
  table: DBTableSchema | undefined,
  tables: DBTableSchema[],
  opts: { pageId: string; title: string; locale?: Locale }
): string {
  const locale = opts.locale ?? getLocale();
  const en = isEnLocale(locale);
  if (kind === 'blank') return generateBlankMobilePageSource({ ...opts, locale });
  const cols = table ? defaultDisplayColumns(table, 4) : [];
  const firstCol = cols[0]?.name;
  const secondCol = cols[1]?.name;
  const editableCols = table?.columns.filter(c => !c.isPrimaryKey && (!c.defaultValue || c.references || c.isForeignKey));
  const fieldsTsx = editableCols && table
    ? editableCols.map((c) => {
        const labelLit = JSON.stringify(columnLabel(c, locale));
        const nameLit = JSON.stringify(c.name);
        const req = !c.nullable;
        const fkSpec = resolveBoundForeignKeySpec(table, c, tables);
        if (fkSpec) {
          return `<MSheetPicker label={${labelLit}} name={${nameLit}} table={${JSON.stringify(fkSpec.refTable.id)}} labelField={${JSON.stringify(fkSpec.labelCol)}} valueField={${JSON.stringify(fkSpec.valueCol)}} required={${req}} />`;
        }
        if (declaredColumnOptions(c)) {
          const options = resolveFieldSelectOptions(c, locale, table, tables);
          return `<MSheetPicker label={${labelLit}} name={${nameLit}} options={${JSON.stringify(options)}} required={${req}} />`;
        }
        if (/^(DATE|TIMESTAMP|DATETIME)/i.test(c.dataType) || /_date$/i.test(c.name)) {
          return `<MSheetPicker label={${labelLit}} name={${nameLit}} mode="date" required={${req}} />`;
        }
        if (/^TIME/i.test(c.dataType)) {
          return `<MSheetPicker label={${labelLit}} name={${nameLit}} mode="time" required={${req}} />`;
        }
        if (/remark|desc/i.test(c.name) || (c.comment || '').includes('备注') || /\b(?:remark|notes?)\b/i.test(c.comment || '')) {
          return `<MField label={${labelLit}} name={${nameLit}} multiline={true} required={${req}} />`;
        }
        const inputType = fieldTypeOf(c) === 'number' ? 'number' : 'text';
        return `<MField label={${labelLit}} name={${nameLit}} inputType="${inputType}" required={${req}} />`;
      }).join('\n        ')
    : en
      ? '<MField label="Title" name="name" required={true} />'
      : '<MField label="标题名称" name="name" required={true} />';

  if (en) {
    if (kind === 'mobile_ai') {
      return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="sparkle" titleDropdown={true} rightIcon="avatar" />
      <MHeroHeader mode="greeting" eyebrow="Gemini Mobile Agent" title="Hi, Alex" subtitle="Search business data, uncover insights, or draft plans in seconds" />
      <MBentoGrid cols={2} layout="equal" items={[
        { title: 'Executive Summary', subtitle: 'Summarize key KPI trends', icon: 'Sparkles', badge: 'AI', tone: 'violet' },
        { title: 'Anomaly Scan', subtitle: 'Spot overdue & high-risk items', icon: 'Zap', tone: 'blue' }
      ]} />
      <MChatStream assistantName="Gemini" messages={[
        { role: 'user', title: 'What are my top priorities today?' },
        { role: 'assistant', title: 'Here are today’s priorities: operations are running smoothly, with 3 high-priority approvals awaiting review.', highlight: 'Tip: Use the bottom composer to ask follow-up questions.' }
      ]} />
      <MComposerBar placeholder="Ask Gemini or enter a command..." suggestions="Summarize today's tasks,Draft weekly brief,Analyze conversion trend" docked={true} onSend={() => toast('Command sent')} />
    </MobilePage>
  );
}
`);
    }

    if (kind === 'mobile_profile') {
      return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="none" rightIcon="bell" />
      <MHeroHeader mode="banner" eyebrow="PRO WORKSPACE" title="Alex · Digital Hub" subtitle="Real-time cross-device sync · Modern mobile UX" actionText="Pro Perks" onAction={() => openModal('dlg-member')} />
      <MBentoGrid cols={2} layout="equal" items={[
        { title: 'My Tasks', subtitle: '3 pending items', icon: 'Layers', badge: '3', tone: 'blue' },
        { title: 'Saved', subtitle: '12 bookmarked items', icon: 'Bookmark', tone: 'violet' }
      ]} />
      <MListGroup title="Preferences & Security" items={[
        { title: 'Workspace', value: 'Default', icon: 'Compass', arrow: true },
        { title: 'Push Notifications', value: 'Enabled', icon: 'Bell', arrow: true },
        { title: 'Privacy & Security', value: 'Verified', icon: 'Shield', arrow: true }
      ]} />
      <MTabBar variant="floating" activeKey="mine" items={[
        { key: 'home', title: 'Home', icon: 'Sparkles' },
        { key: 'tasks', title: 'Tasks', icon: 'Layers' },
        { key: 'mine', title: 'Profile', icon: 'User' }
      ]} />
      <MDialog id="dlg-member" title="Pro Perks Active" description="All cross-platform components and live shared database previews are unlocked." confirmText="Got It" />
    </MobilePage>
  );
}
`);
    }

    if (kind === 'mobile_form' || kind === 'form') {
      return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="back" rightIcon="more" />
      <MForm pfId="mform-main" ${table ? `table="${table.id}" ` : ''}title="Create Record">
        ${fieldsTsx}
      </MForm>
      <MBottomDock mode="action" secondaryText="Reset" primaryText="Submit" onSecondary={() => { resetForm('mform-main'); toast('Form reset', 'info'); }} onPrimary={() => { submitForm('mform-main'); toast('Submitted'); }} />
    </MobilePage>
  );
}
`);
    }

    if (kind === 'mobile_workspace' || kind === 'list' || kind === 'master_detail' || kind === 'detail') {
      const fieldItems = cols
        .slice(1, 4)
        .map((c) => `{ dataIndex: ${q(c.name)}, title: ${q(columnLabel(c, locale))} }`)
        .join(', ');
      return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="back" rightIcon="plus" onRightClick={() => openDrawer('sheet-create')} />
      <MStatCard title="Active Items" value="18" unit="items" trend="+12.5%" trendTone="up" sparkline={true} />
      <MSearchPill placeholder="Search..." target="mtask-main" showFilter={false} />
      <MTaskList
        pfId="mtask-main"
        ${table ? `table="${table.id}" ${firstCol ? `titleField={${JSON.stringify(firstCol)}} ` : ''}${fieldItems ? `fields={[${fieldItems}]} ` : ''}` : ''}
        rowActions={[
          { label: 'View', onClick: () => openDrawer('sheet-detail') }
        ]}
        onCardClick={() => openDrawer('sheet-detail')}
      />
      <MTabBar variant="floating" activeKey="tasks" items={[
        { key: 'home', title: 'Explore', icon: 'Sparkles' },
        { key: 'tasks', title: 'Tasks', icon: 'Layers', badge: '3' },
        { key: 'mine', title: 'Profile', icon: 'User' }
      ]} />
      <MBottomSheet id="sheet-detail" title={${JSON.stringify(`${opts.title} Details`)}} size="medium">
        <MListGroup title="Details" ${table ? `table="${table.id}" ` : ''}/>
        <MBottomDock mode="action" primaryText="Close" onPrimary={() => closeOverlay()} />
      </MBottomSheet>
      <MBottomSheet id="sheet-create" title="Create Record" size="tall">
        <MForm pfId="mform-create" ${table ? `table="${table.id}" ` : ''}>
          ${fieldsTsx}
        </MForm>
        <MBottomDock mode="action" secondaryText="Cancel" primaryText="Save" onSecondary={() => closeOverlay()} onPrimary={() => { submitForm('mform-create'); toast('Saved'); closeOverlay(); }} />
      </MBottomSheet>
    </MobilePage>
  );
}
`);
    }

    return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="sparkle" titleDropdown={true} rightIcon="avatar" />
      <MHeroHeader mode="greeting" eyebrow="AI-Powered Experience" title="Hi, Alex" subtitle="Welcome to your modern mobile workspace" />
      <MSearchPill placeholder="Search featured items or services..." target="mfeed-main" showFilter={true} filterOverlay="sheet-pick" />
      <MBentoGrid cols={2} layout="equal" items={[
        { title: 'Smart Picks', subtitle: 'Curated personalized feed', icon: 'Sparkles', badge: 'HOT', tone: 'violet' },
        { title: 'Quick Book', subtitle: 'One-tap instant access', icon: 'Zap', tone: 'blue' }
      ]} />
      <MSurface title="Trending" extra="More" tone="card" onExtraClick={() => openDrawer('sheet-pick')}>
        <MFeedList
          pfId="mfeed-main"
          ${table ? `table="${table.id}" ${firstCol ? `titleField={${JSON.stringify(firstCol)}} ` : ''}${secondCol ? `subtitleField="${secondCol}" ` : ''}` : ''}
          layout="waterfall"
          actionText="View"
          onItemClick={() => openDrawer('sheet-pick')}
        />
      </MSurface>
      <MTabBar variant="floating" activeKey="home" items={[
        { key: 'home', title: 'Explore', icon: 'Sparkles' },
        { key: 'tasks', title: 'Tasks', icon: 'Layers' },
        { key: 'mine', title: 'Profile', icon: 'User' }
      ]} />
      <MBottomSheet id="sheet-pick" title="Select Options" size="medium">
        <MForm pfId="mform-pick">
          <MChipSelect label="Edition" name="spec" options="Standard,Pro,Flagship" />
        </MForm>
        <MBottomDock mode="commerce" summaryLabel="Price" price="¥299.00" primaryText="Confirm" onPrimary={() => { submitForm('mform-pick'); toast('Confirmed'); closeOverlay(); }} />
      </MBottomSheet>
    </MobilePage>
  );
}
`);
  }

  if (kind === 'mobile_ai') {
    return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="sparkle" titleDropdown={true} rightIcon="avatar" />
      <MHeroHeader mode="greeting" eyebrow="Gemini 移动智能体" title="你好，Alex" subtitle="我可以帮你检索业务数据、生成洞察或起草方案" />
      <MBentoGrid cols={2} layout="equal" items={[
        { title: '智能经营总结', subtitle: '一键汇总核心指标趋势', icon: 'Sparkles', badge: 'AI', tone: 'violet' },
        { title: '异常单据筛查', subtitle: '定位超期与高风险环节', icon: 'Zap', tone: 'blue' }
      ]} />
      <MChatStream assistantName="Gemini" messages={[
        { role: 'user', title: '帮我看看今天有哪些重点关注事项？' },
        { role: 'assistant', title: '已为你梳理今日重点：当前业务流转平稳，建议优先确认高优审批事项。', highlight: '提示：点击底部输入舱可继续追问或发送语音指令。' }
      ]} />
      <MComposerBar placeholder="向 Gemini 提问或输入指令..." suggestions="总结今日待办,生成周报摘要,分析转化趋势" docked={true} onSend={() => toast('已发送指令')} />
    </MobilePage>
  );
}
`);
  }

  if (kind === 'mobile_profile') {
    return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="none" rightIcon="bell" />
      <MHeroHeader mode="banner" eyebrow="PRO 会员空间" title="Alex · 数字化工作台" subtitle="多端数据实时同步 · 现代移动体验" actionText="会员权益" onAction={() => openModal('dlg-member')} />
      <MBentoGrid cols={2} layout="equal" items={[
        { title: '我的待办', subtitle: '待处理事项 3 项', icon: 'Layers', badge: '3', tone: 'blue' },
        { title: '我的收藏', subtitle: '已保存 12 项内容', icon: 'Bookmark', tone: 'violet' }
      ]} />
      <MListGroup title="偏好与账户安全" items={[
        { title: '工作空间切换', value: '默认空间', icon: 'Compass', arrow: true },
        { title: '消息推送提醒', value: '已开启', icon: 'Bell', arrow: true },
        { title: '隐私与安全保护', value: '已认证', icon: 'Shield', arrow: true }
      ]} />
      <MTabBar variant="floating" activeKey="mine" items={[
        { key: 'home', title: '首页', icon: 'Sparkles' },
        { key: 'tasks', title: '事项', icon: 'Layers' },
        { key: 'mine', title: '我的', icon: 'User' }
      ]} />
      <MDialog id="dlg-member" title="会员权益已开启" description="已为你解锁全部跨端组件与同源物理表实时预览能力。" confirmText="我知道了" />
    </MobilePage>
  );
}
`);
  }

  if (kind === 'mobile_form' || kind === 'form') {
    return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="back" rightIcon="more" />
      <MForm pfId="mform-main" ${table ? `table="${table.id}" ` : ''}title="填写基本信息">
        ${fieldsTsx}
      </MForm>
      <MBottomDock mode="action" secondaryText="重置" primaryText="确认提交" onSecondary={() => { resetForm('mform-main'); toast('已重置', 'info'); }} onPrimary={() => { submitForm('mform-main'); toast('提交成功'); }} />
    </MobilePage>
  );
}
`);
  }

  if (kind === 'mobile_workspace' || kind === 'list' || kind === 'master_detail' || kind === 'detail') {
    const fieldItems = cols
      .slice(1, 4)
      .map((c) => `{ dataIndex: ${q(c.name)}, title: ${q(columnLabel(c))} }`)
      .join(', ');
    return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="back" rightIcon="plus" onRightClick={() => openDrawer('sheet-create')} />
      <MStatCard title="当前事项概览" value="18" unit="项" trend="+12.5%" trendTone="up" sparkline={true} />
      <MSearchPill placeholder="搜索关键词..." target="mtask-main" showFilter={false} />
      <MTaskList
        pfId="mtask-main"
        ${table ? `table="${table.id}" ${firstCol ? `titleField={${JSON.stringify(firstCol)}} ` : ''}${fieldItems ? `fields={[${fieldItems}]} ` : ''}` : ''}
        rowActions={[
          { label: '详情', onClick: () => openDrawer('sheet-detail') }
        ]}
        onCardClick={() => openDrawer('sheet-detail')}
      />
      <MTabBar variant="floating" activeKey="tasks" items={[
        { key: 'home', title: '探索', icon: 'Sparkles' },
        { key: 'tasks', title: '事项', icon: 'Layers', badge: '3' },
        { key: 'mine', title: '我的', icon: 'User' }
      ]} />
      <MBottomSheet id="sheet-detail" title={${JSON.stringify(opts.title + '详情')}} size="medium">
        <MListGroup title="单据详情" ${table ? `table="${table.id}" ` : ''}/>
        <MBottomDock mode="action" primaryText="关闭" onPrimary={() => closeOverlay()} />
      </MBottomSheet>
      <MBottomSheet id="sheet-create" title="新建记录" size="tall">
        <MForm pfId="mform-create" ${table ? `table="${table.id}" ` : ''}>
          ${fieldsTsx}
        </MForm>
        <MBottomDock mode="action" secondaryText="取消" primaryText="保存提交" onSecondary={() => closeOverlay()} onPrimary={() => { submitForm('mform-create'); toast('已保存'); closeOverlay(); }} />
      </MBottomSheet>
    </MobilePage>
  );
}
`);
  }

  // Default: mobile_explore (C-end + B-end modern feed)
  return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="sparkle" titleDropdown={true} rightIcon="avatar" />
      <MHeroHeader mode="greeting" eyebrow="AI 驱动现代体验" title="你好，Alex" subtitle="欢迎体验 Gemini 风格移动端界面" />
      <MSearchPill placeholder="搜索精选内容或服务..." target="mfeed-main" showFilter={true} filterOverlay="sheet-pick" />
      <MBentoGrid cols={2} layout="equal" items={[
        { title: '智能推荐', subtitle: '个性化精选内容流', icon: 'Sparkles', badge: 'HOT', tone: 'violet' },
        { title: '快捷预约', subtitle: '极速响应一键直达', icon: 'Zap', tone: 'blue' }
      ]} />
      <MSurface title="热门推荐" extra="更多" tone="card" onExtraClick={() => openDrawer('sheet-pick')}>
        <MFeedList
          pfId="mfeed-main"
          ${table ? `table="${table.id}" ${firstCol ? `titleField={${JSON.stringify(firstCol)}} ` : ''}${secondCol ? `subtitleField="${secondCol}" ` : ''}` : ''}
          layout="waterfall"
          actionText="查看"
          onItemClick={() => openDrawer('sheet-pick')}
        />
      </MSurface>
      <MTabBar variant="floating" activeKey="home" items={[
        { key: 'home', title: '探索', icon: 'Sparkles' },
        { key: 'tasks', title: '事项', icon: 'Layers' },
        { key: 'mine', title: '我的', icon: 'User' }
      ]} />
      <MBottomSheet id="sheet-pick" title="选择规格与偏好" size="medium">
        <MForm pfId="mform-pick">
          <MChipSelect label="规格选项" name="spec" options="标准版,Pro 进阶版,旗舰尊享版" />
        </MForm>
        <MBottomDock mode="commerce" summaryLabel="尊享价" price="¥299.00" primaryText="立即确认" onPrimary={() => { submitForm('mform-pick'); toast('操作成功'); closeOverlay(); }} />
      </MBottomSheet>
    </MobilePage>
  );
}
`);
}

export function generateFromTemplate(
  kind: PageTemplateKind,
  table: DBTableSchema | undefined,
  tables: DBTableSchema[],
  opts: { pageId: string; title: string; menuPath?: string[]; platform?: PagePlatform; locale?: Locale; data?: TemplateDataContext },
  locale: Locale = opts.locale ?? getLocale()
): string {
  const mergedOpts = { ...opts, locale };
  if (opts.platform === 'mobile' || kind.startsWith('mobile_')) {
    return generateMobileFromTemplate(kind, table, tables, mergedOpts);
  }
  if (kind === 'blank' || !table) return generateBlankPageSource(mergedOpts);
  if (kind === 'form') return generateFormPageSource(table, mergedOpts, tables);
  if (kind === 'detail') return generateDetailPageSource(table, mergedOpts);
  if (kind === 'master_detail') {
    const detail = tables.find((t) => t.id !== table.id && t.tableName.includes('detail')) ?? tables.find((t) => t.id !== table.id) ?? table;
    const picker = tables.find((t) => t.id === 't_pms_po_item') ?? detail;
    const sup = tables.find((t) => t.id === 't_base_supplier');
    return generateMasterDetailPageSource(table, detail, picker, sup, mergedOpts, tables);
  }
  const related = tables.find((t) => t.id !== table.id && t.columns.some((c) => c.references?.includes(table.id)));
  return generateListPageSource(table, tables, {
    ...mergedOpts,
    relatedTable: related,
    withStatusTabs: table.columns.some((c) => /status/i.test(c.name)),
  });
}
