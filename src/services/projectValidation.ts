import { validateTableDomain } from '../proto/database/domain';
import { tr } from '../i18n/runtime';
import { validateRequirementRecords } from '../proto/database/requirementReview';
import { resolveUniqueConstraints } from '../proto/database/uniqueConstraints';
import type { DBTableSchema } from '../store/useProtoStore';
import { validateProjectAgreements } from './projectKnowledge';
import { validateDesignTokens } from '../proto/theme/designTokens';
import { validateStickyNoteIndex } from '../proto/stickyNoteIndex';
import { validateProjectPlan } from './projectPlan';
import { validateMindmaps } from '../proto/mindmaps';
import { validateProjectNotes } from '../proto/notes';
import type { PflowBinaryPayload, PflowProjectMetadata } from '../utils/pflowBinaryCodec';
import { buildSitemap, folderOptions, validateDesignerFolders, validateSitemapOverrides, sitemapCatalog } from '../proto/sitemap';

type Obj = Record<string, unknown>;
export function object(value: unknown, path: string): asserts value is Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(tr(`${path} 必须是对象`, `${path} must be an object`));
}
function fields(value: Obj, names: string[], kind: 'string' | 'number' | 'boolean', path: string) {
  for (const name of names) {
    if (typeof value[name] !== kind || (kind === 'number' && !Number.isFinite(value[name]))) {
      throw new Error(tr(`${path}.${name} 必须是${kind}`, `${path}.${name} must be ${kind}`));
    }
  }
}
function id(value: Obj, key: string, path: string) {
  if (typeof value[key] !== 'string' || !(value[key] as string).trim()) throw new Error(tr(`${path}.${key} 不能为空`, `${path}.${key} cannot be empty`));
}
function oneOf(value: Obj, key: string, values: string[], path: string) {
  if (!values.includes(value[key] as string)) throw new Error(tr(`${path}.${key} 无效`, `${path}.${key} is invalid`));
}
function records(value: unknown, path: string, check: (v: Obj, p: string) => void, key = 'id') {
  if (!Array.isArray(value)) throw new Error(tr(`${path} 必须是数组`, `${path} must be an array`));
  const ids = new Set<string>();
  value.forEach((v, i) => {
    const p = `${path}[${i}]`;
    object(v, p); id(v, key, p);
    if (ids.has(v[key] as string)) throw new Error(tr(`${p}.${key} 重复：${v[key]}`, `Duplicate ${p}.${key}: ${v[key]}`));
    ids.add(v[key] as string); check(v, p);
  });
}

export function validateClosedLoopAuditIssues(value: unknown) {
  records(value, 'closedLoopIssues', (v, p) => {
    fields(v, ['pageId', 'moduleTitle', 'category', 'title', 'brokenChainDesc', 'targetWidgetId', 'targetWidgetName', 'targetTableId', 'aiQuestion'], 'string', p);
    id(v, 'pageId', p); id(v, 'moduleTitle', p); id(v, 'category', p); id(v, 'title', p);
    id(v, 'brokenChainDesc', p); id(v, 'targetWidgetId', p); id(v, 'targetWidgetName', p); id(v, 'aiQuestion', p);
    oneOf(v, 'status', ['open', 'resolved'], p); oneOf(v, 'scope', ['module', 'project'], p);
    oneOf(v, 'severity', ['critical', 'warning'], p);
    if (v.resolvedByOptionId !== undefined) fields(v, ['resolvedByOptionId'], 'string', p);
    if (v.customUserAnswer !== undefined) fields(v, ['customUserAnswer'], 'string', p);
    if (v.auditOrigin !== undefined) {
      oneOf(v, 'auditOrigin', ['hermes'], p);
      if (typeof v.auditedAt !== 'string' || !Number.isFinite(Date.parse(v.auditedAt))) throw new Error(tr(`${p}.auditedAt 必须是有效巡检时间`, `${p}.auditedAt must be a valid timestamp`));
    } else if (v.auditedAt !== undefined) throw new Error(tr(`${p}.auditedAt 缺少巡检来源`, `${p}.auditedAt is missing auditOrigin`));
    records(v.options, `${p}.options`, (o, op) => {
      fields(o, ['label', 'description', 'stickyPatchText', 'dbPatchSummary'], 'string', op);
      id(o, 'label', op); id(o, 'description', op);
    });
    if (v.status === 'open' && (v.options as unknown[]).length === 0) throw new Error(tr(`${p}.options 未解决巡检问题必须提供至少一个修复选项`, `${p}.options open audit issue must provide at least one repair option`));
  });
}

export function validateProjectMeta(value: unknown): asserts value is PflowProjectMetadata {
  object(value, 'meta');
  fields(value, ['projectId', 'projectName', 'storageDir', 'fileName', 'createdAt', 'updatedAt'], 'string', 'meta');
  id(value, 'projectId', 'meta'); id(value, 'fileName', 'meta');
  if (/[\\/]/.test(value.fileName as string)) throw new Error(tr('工程文件名不能包含路径', 'Project file name cannot contain path separators'));
  oneOf(value, 'templateId', ['saas_inventory', 'crm_analytics', 'blank_project', 'mobile_starter', 'customs_erp', 'supply_chain'], 'meta');
  if (value.projectMode !== undefined) {
    oneOf(value, 'projectMode', ['desktop', 'mobile', 'hybrid'], 'meta');
  }
  fields(value, ['pageCount', 'tableCount', 'stickyCount'], 'number', 'meta');
}

/** Validate external archives before either store is changed. Empty arrays are valid. */
export function validateProjectPayload(value: unknown, { allowLegacyZeroStickyIndex = false } = {}): asserts value is PflowBinaryPayload {
  object(value, tr('工程', 'project'));
  if (value.schemaVersion !== 7) throw new Error(tr('不支持的工程快照版本', 'Unsupported project snapshot version'));
  validateProjectMeta(value.meta);
  const s = value.stateSnapshot; object(s, 'stateSnapshot');
  if (s.projectAgreements !== undefined) validateProjectAgreements(s.projectAgreements);
  if (s.designTokens !== undefined && s.designTokens !== null) validateDesignTokens(s.designTokens);
  if (s.databaseRequirements !== undefined) validateRequirementRecords(s.databaseRequirements);
  if (s.projectPlan !== undefined && s.projectPlan !== null) validateProjectPlan(s.projectPlan);
  fields(s, ['activePageId'], 'string', 'stateSnapshot');
  if ('mindmapSource' in s) throw new Error(tr('V7 工程不能包含旧版 mindmapSource 字段', 'V7 project cannot contain legacy mindmapSource field'));
  if (s.activePageId !== '') id(s, 'activePageId', 'stateSnapshot');
  records(s.dbTables, 'dbTables', (t, p) => {
    fields(t, ['tableName', 'cnName', 'description'], 'string', p);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t.tableName as string)) throw new Error(tr(`${p}.tableName 无效`, `${p}.tableName is invalid`));
    validateTableDomain(t.domain);
    if (t.modeling !== undefined) {
      const path = `${p}.modeling`;
      object(t.modeling, path);
      for (const key of ['entity', 'grain', 'reason']) id(t.modeling, key, path);
      const rules = t.modeling.pendingRules;
      if (rules !== undefined) {
        if (!Array.isArray(rules)) throw new Error(tr(`${path}.pendingRules 必须是数组`, `${path}.pendingRules must be an array`));
        rules.forEach((r, i) => {
          const item = `${path}.pendingRules[${i}]`;
          object(r, item); id(r, 'rule', item); id(r, 'reason', item);
        });
      }
    }
    records(t.columns, `${p}.columns`, (c, cp) => {
      fields(c, ['name', 'dataType', 'comment'], 'string', cp); id(c, 'name', cp);
      fields(c, ['nullable'], 'boolean', cp);
      for (const flag of ['isPrimaryKey', 'isUnique', 'isForeignKey']) {
        if (c[flag] !== undefined) fields(c, [flag], 'boolean', cp);
      }
      for (const name of ['references','defaultValue']) {
        if (c[name] !== undefined) fields(c, [name], 'string', cp);
      }
      if (c.foreignKeyOptions !== undefined) {
        const fk = c.foreignKeyOptions;
        const path = `${cp}.foreignKeyOptions`;
        object(fk, path);
        id(c, 'references', cp);
        if (fk.name !== undefined && (typeof fk.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(fk.name))) throw new Error(tr(`${path}.name 无效`, `${path}.name is invalid`));
        if (fk.cardinality !== undefined) oneOf(fk, 'cardinality', ['1:N', '1:1'], path);
        if (fk.onDelete !== undefined) oneOf(fk, 'onDelete', ['RESTRICT', 'CASCADE', 'SET NULL'], path);
        if (fk.onDelete === 'SET NULL' && !c.nullable) throw new Error(tr(`${path} SET NULL 要求字段允许空值`, `${path} SET NULL requires a nullable column`));
      }
    });
    resolveUniqueConstraints(t as unknown as DBTableSchema);
    records(t.sharedByMenus, `${p}.sharedByMenus`, (v, vp) => {
      fields(v, ['menuTitle', 'fieldMappingNote'], 'string', vp);
      oneOf(v, 'accessMode', ['CRUD 读写', 'READ 查询', 'FK 外键引用', 'STATE 状态流转'], vp);
    }, 'pageId');
  });
  records(s.stickyNotes, 'stickyNotes', (v, p) => {
    fields(v, ['pageId', 'targetWidgetId', 'targetWidgetName', 'text', 'compiledRule'], 'string', p);
    if (!(allowLegacyZeroStickyIndex && v.index === 0)) validateStickyNoteIndex(v.index, tr(`便签 ${v.id}`, `Sticky note ${v.id}`));
    fields(v, ['active'], 'boolean', p);
  });
  records(s.suppliers, 'suppliers', (v, p) => {
    fields(v, ['code', 'name', 'contactPerson', 'phone', 'category', 'updatedAt'], 'string', p);
    fields(v, ['taxRateDefault'], 'number', p); oneOf(v, 'status', ['pending', 'qualified', 'rejected'], p);
  });
  records(s.purchaseOrderItems, 'purchaseOrderItems', (v, p) => {
    fields(v, ['poNumber', 'supplierId', 'supplierName', 'planCategory', 'materialCode', 'materialName', 'spec', 'brand', 'unit', 'projectCode'], 'string', p);
    fields(v, ['orderedQty', 'deliveredQty', 'unitPriceTaxIncluded', 'taxRate'], 'number', p);
    oneOf(v, 'status', ['unconfirmed', 'confirmed', 'completed'], p);
  });
  records(s.acceptanceOrders, 'acceptanceOrders', (v, p) => {
    fields(v, ['acceptanceNo', 'acceptanceDate', 'supplierName', 'supplierContact', 'supplierPhone', 'inspector', 'deliveryPerson', 'remark', 'createdAt'], 'string', p);
    fields(v, ['taxRate', 'totalAmount', 'itemCount'], 'number', p);
    oneOf(v, 'status', ['草稿', '已提交验收', '已入库'], p);
  });
  records(s.closedLoopIssues, 'closedLoopIssues', (v, p) => {
    fields(v, ['pageId', 'moduleTitle', 'category', 'title', 'brokenChainDesc', 'targetWidgetId', 'targetWidgetName', 'targetTableId', 'aiQuestion'], 'string', p);
    oneOf(v, 'status', ['open', 'resolved'], p); oneOf(v, 'scope', ['module', 'project'], p);
    oneOf(v, 'severity', ['critical', 'warning'], p);
    if (v.auditOrigin !== undefined) {
      oneOf(v, 'auditOrigin', ['hermes'], p);
      if (typeof v.auditedAt !== 'string' || !Number.isFinite(Date.parse(v.auditedAt))) throw new Error(tr(`${p}.auditedAt 必须是有效巡检时间`, `${p}.auditedAt must be a valid timestamp`));
    } else if (v.auditedAt !== undefined) throw new Error(tr(`${p}.auditedAt 缺少巡检来源`, `${p}.auditedAt is missing auditOrigin`));
    records(v.options, `${p}.options`, (o, op) => fields(o, ['label', 'description', 'stickyPatchText', 'dbPatchSummary'], 'string', op));
  });
  object(s.pageSources, 'pageSources');
  for (const [key, source] of Object.entries(s.pageSources)) {
    if (!key || typeof source !== 'string') throw new Error(tr(`pageSources.${key} 必须是源码字符串`, `pageSources.${key} must be a source string`));
  }
  if (!Array.isArray(s.sitemapBase)) throw new Error(tr('工程必须明确提供菜单模板', 'Project must explicitly provide sitemapBase'));
  sitemapCatalog(s.sitemapBase);
  validateSitemapOverrides(s.sitemapOverrides, s.sitemapBase);
  validateDesignerFolders(s.designerFolders, s.sitemapOverrides, s.sitemapBase);
  const folderIds = new Set(folderOptions(s.designerFolders, s.sitemapOverrides, s.sitemapBase).map(folder => folder.id));
  records(s.designerPages, 'designerPages', (v, p) => {
    fields(v, ['title', 'folderId'], 'string', p);
    if (v.platform !== undefined) oneOf(v, 'platform', ['desktop', 'mobile'], p);
    if (!folderIds.has(v.folderId as string)) throw new Error(tr(`${p} 引用的菜单目录不存在`, `${p} references a non-existent folder`));
    if (!Object.prototype.hasOwnProperty.call(s.pageSources, v.pageId as string)) throw new Error(tr(`${p} 缺少页面源码`, `${p} is missing page source`));
  }, 'pageId');
  const snapshot = s as unknown as PflowBinaryPayload['stateSnapshot'];
  validateMindmaps(s.mindmaps, snapshot);
  if (s.projectNotes !== undefined) validateProjectNotes(s.projectNotes, snapshot);
  const menu = buildSitemap(snapshot.designerFolders, snapshot.designerPages, snapshot.sitemapOverrides, snapshot.sitemapBase);
  const hasPage = (items: typeof menu): boolean => items.some(item => item.pageId !== undefined || (item.children !== undefined && hasPage(item.children)));
  if (s.activePageId === '' && (Object.keys(s.pageSources).length > 0 || hasPage(menu))) throw new Error(tr('有页面时必须选择有效页面', 'Must select a valid activePageId when pages exist'));
  const deletedPages = new Set([...sitemapCatalog(snapshot.sitemapBase).builtinNodes.values()].filter(item => snapshot.sitemapOverrides.deletedNodeIds?.includes(item.id) && item.pageId !== undefined).map(item => item.pageId));
  if (deletedPages.has(snapshot.activePageId) || Object.keys(snapshot.pageSources).some(id => deletedPages.has(id))) throw new Error(tr('已删除的菜单不能保留活动页面或画布源码', 'Deleted menus cannot retain activePageId or canvas source'));
  object(s.tableRows, 'tableRows');
  for (const [tableId, rows] of Object.entries(s.tableRows)) {
    if (!(s.dbTables as Obj[]).some(t => t.id === tableId)) throw new Error(tr(`tableRows 引用未知表 ${tableId}`, `tableRows references unknown table ${tableId}`));
    records(rows, `tableRows.${tableId}`, () => {});
  }
  object(s.widgets, 'widgets');
  for (const [key, v] of Object.entries(s.widgets)) {
    object(v, `widgets.${key}`); id(v, 'id', `widgets.${key}`);
    if (v.id !== key) throw new Error(tr(`widgets.${key} 的 ID 不一致`, `widgets.${key} has mismatched ID`));
    fields(v, ['name', 'pageId', 'type'], 'string', `widgets.${key}`);
    object(v.props, `widgets.${key}.props`);
    fields(v.props, ['label', 'primaryColor'], 'string', `widgets.${key}.props`);
    fields(v.props, ['visible'], 'boolean', `widgets.${key}.props`);
  }
  object(s.draftAcceptanceHeader, 'draftAcceptanceHeader');
  fields(s.draftAcceptanceHeader, ['acceptanceDate', 'acceptanceNo', 'inspector', 'inboundType', 'sourceType', 'deliveryPerson', 'supplierId', 'supplierContact', 'supplierPhone', 'invoiceType', 'remark'], 'string', 'draftAcceptanceHeader');
  fields(s.draftAcceptanceHeader, ['taxRate'], 'number', 'draftAcceptanceHeader');
  records(s.draftAcceptanceLines, 'draftAcceptanceLines', (v, p) => {
    fields(v, ['sourcePoItemId', 'planCategory', 'materialCode', 'materialName', 'spec', 'brand', 'unit', 'projectCode', 'serialNo'], 'string', p);
    fields(v, ['orderedQty', 'alreadyAcceptedQty', 'currentAcceptQty', 'unitPriceTaxIncluded', 'taxRate'], 'number', p);
    fields(v, ['useCustomTaxPrice', 'isNewItem'], 'boolean', p);
  });
}
