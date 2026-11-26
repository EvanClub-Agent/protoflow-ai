import { validatePublishedSitemap, publishedMenuIndex, type PublishedMenuItem } from './publishedSitemap';
import { tr } from '../i18n/runtime';
import type { DBTableSchema, StickyNoteRule } from '../store/useProtoStore';
import { resolveUniqueConstraints } from '../proto/database/uniqueConstraints';
import { validateNoteAssets, type NoteAsset, type NotePriority, type NoteRequirementStatus } from '../proto/notes';
import type { ProtoDoc } from '../proto/types';
import type { Row } from '../proto/runtime/mock';
import { COMPONENT_MAP, PAGE_ROOT_TYPES } from '../proto/registry/meta';
import { ACTION_MAP } from '../proto/runtime/actions';
import { object } from './projectValidation';
import { validateStickyNoteIndex } from '../proto/stickyNoteIndex';
import { validateMaterialDoc } from '../proto/registry/materialContract';
import { COLLECTION_BINDING_TYPES, collectionBindingErrors, tableBindingErrors } from '../proto/table/model';
import { freeformBindingErrors } from '../proto/freeform/contract';
import { walk } from '../proto/dsl/tree';
import { isChartType, chartConfigErrors, prepareChartData } from '../proto/charts/model';
import { validateDesignTokens, type ProjectDesignTokens } from '../proto/theme/designTokens';

export interface PublishedPage { pageId: string; title: string; folderId: string; doc: ProtoDoc }
export type PublishedStickyNote = Pick<StickyNoteRule, 'id' | 'pageId' | 'targetWidgetId' | 'targetWidgetName' | 'index' | 'text' | 'active'>;
/** Read-only project note shared to the viewer. Only notes explicitly marked shareable. */
export interface PublishedNote {
  noteId: string;
  title: string;
  icon: string;
  status: NoteRequirementStatus;
  priority?: NotePriority;
  meetingDate?: string;
  updatedAt: string;
  /** Allow-list sanitized HTML; images reference `pf-asset:<id>` entries in noteAssets. */
  html: string;
  /** Published pages this note explains (direct or via folders). */
  pageIds: string[];
}
export const PUBLISHED_NOTE_HTML_MAX = 512 * 1024;
export const PUBLISHED_NOTES_MAX = 500;
export interface PublishedSnapshot {
  /**
   * 3 = sitemap + tables (without unique metadata);
   * 4 = 3 plus mandatory read-only project notes;
   * 5 = preserves column isUnique + table uniqueConstraints, with optional read-only project notes.
   */
  formatVersion: 3 | 4 | 5;
  notes?: PublishedNote[];
  noteAssets?: Record<string, NoteAsset>;
  designTokens?: ProjectDesignTokens;
  sitemap: PublishedMenuItem[];
  projectId: string;
  title: string;
  entryPageId: string;
  pages: PublishedPage[];
  tables: DBTableSchema[];
  tableRows: Record<string, Row[]>;
  stickyNotes: PublishedStickyNote[];
}
// Older shares did not upload the menu tree. Read their flat page list without
// guessing current template folders or inventing historical document entries.
export type LegacyPublishedSnapshot = Omit<PublishedSnapshot, 'formatVersion' | 'sitemap' | 'notes' | 'noteAssets'> & { formatVersion: 2 };
export type ReadablePublishedSnapshot = PublishedSnapshot | LegacyPublishedSnapshot;
const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const snapshotFields = {
  formatVersion: true, projectId: true, title: true, entryPageId: true,
  sitemap: true, pages: true, tables: true, tableRows: true, stickyNotes: true,
  notes: true, noteAssets: true, designTokens: true,
} satisfies Record<keyof PublishedSnapshot, true>;
function required(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(tr(`${name} 不能为空`, `${name} cannot be empty`));
}

/** Standard nodes are interpreted by registries. Freeform source is validated
 * here and compiled only inside its isolated runtime. Validate before store writes. */
export function validatePublishedSnapshot(value: unknown): asserts value is ReadablePublishedSnapshot {
  object(value, tr('发布内容', 'published snapshot'));
  for (const key of Object.keys(value)) {
    if (!has(snapshotFields, key)) throw new Error(tr(`发布内容包含不支持的字段 ${key}`, `Unsupported published snapshot field: ${key}`));
  }
  if (value.formatVersion !== 2 && value.formatVersion !== 3 && value.formatVersion !== 4 && value.formatVersion !== 5) throw new Error(tr('此发布格式不受支持，请更新浏览端', 'Unsupported published snapshot version; please update the viewer'));
  required(value.projectId, tr('项目 ID', 'Project ID')); required(value.title, tr('项目标题', 'Project title')); required(value.entryPageId, tr('入口页面', 'Entry page'));
  if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > 500) throw new Error(tr('发布页面数量无效', 'Invalid published page count'));
  const pageIds = new Set<string>(), navigationIds = new Set<string>(); let count = 0;
  const checkProp = (v: unknown, depth: number): void => {
    if (depth > 80) throw new Error(tr('组件属性嵌套过深', 'Component props nested too deeply'));
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return;
    if (Array.isArray(v)) { v.forEach(x => checkProp(x, depth + 1)); return; }
    object(v, tr('组件属性', 'component props'));
    if (v.$kind === 'raw') throw new Error(tr('页面包含未支持的代码表达式，请在设计器中修正后再发布', 'Page contains unsupported code expressions; fix them in the designer before publishing'));
    if (v.$kind === 'actions') {
      if (!Array.isArray(v.calls)) throw new Error(tr('页面动作格式无效', 'Invalid page action format'));
      for (const call of v.calls) {
        object(call, tr('动作', 'action')); required(call.name, tr('动作名', 'Action name'));
        if (!has(ACTION_MAP, call.name) || !Array.isArray(call.args)) throw new Error(tr(`不支持的页面动作：${call.name}`, `Unsupported page action: ${call.name}`));
        if (call.name === 'navigate' && (typeof call.args[0] !== 'string' || !navigationIds.has(call.args[0]))) throw new Error(tr('跳转动作指向未发布的页面', 'Navigation action points to an unpublished page'));
      }
    }
    for (const [key, item] of Object.entries(v)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error(tr('组件属性名无效', 'Invalid component prop name'));
      checkProp(item, depth + 1);
    }
  };
  for (const p of value.pages) {
    object(p, tr('页面', 'page')); required(p.pageId, tr('页面 ID', 'Page ID')); required(p.title, tr('页面标题', 'Page title')); required(p.folderId, tr('页面目录', 'Page folder'));
    navigationIds.add(p.pageId);
    if (pageIds.has(p.pageId)) throw new Error(tr('页面 ID 重复', 'Duplicate page ID')); pageIds.add(p.pageId);
  }
  if (value.formatVersion === 3 || value.formatVersion === 4 || value.formatVersion === 5) {
    validatePublishedSitemap(value.sitemap, value.pages as PublishedPage[]);
    for (const id of publishedMenuIndex(value.sitemap).keys()) navigationIds.add(id);
  } else if (has(value, 'sitemap')) throw new Error(tr('旧版发布内容不支持菜单目录字段', 'Legacy published snapshot does not support sitemap field'));
  for (const p of value.pages) {
    object(p.doc, tr('页面内容', 'page document'));
    if (!Array.isArray(p.doc.header) || !p.doc.header.every((s: unknown) => typeof s === 'string')) throw new Error(tr('页面头信息无效', 'Invalid page header'));
    const ids = new Set<string>();
    const node = (n: unknown, depth: number): void => {
      if (++count > 50000 || depth > 80) throw new Error(tr('设计内容超过页面复杂度限制', 'Design content exceeds page complexity limit'));
      object(n, tr('页面节点', 'page node'));
      if (n.kind === 'text' && typeof n.value === 'string') return;
      if (n.kind !== 'node') throw new Error(tr('页面节点类型无效', 'Invalid page node kind'));
      required(n.pfId, tr('组件 ID', 'Component ID')); required(n.type, tr('组件类型', 'Component type'));
      if (ids.has(n.pfId) || !has(COMPONENT_MAP, n.type)) throw new Error(tr(`组件 ID 重复或不支持组件 ${n.type}`, `Duplicate component ID or unsupported component ${n.type}`));
      ids.add(n.pfId); object(n.props, tr('组件属性', 'component props')); checkProp(n.props, 0);
      if (!Array.isArray(n.children)) throw new Error(tr('组件子节点无效', 'Invalid component children'));
      n.children.forEach(c => node(c, depth + 1));
    };
    node(p.doc.root, 0);
    if (!PAGE_ROOT_TYPES.has(p.doc.root.type)) throw new Error(tr('页面根组件必须是 Page 或 MobilePage', 'Page root component must be Page or MobilePage'));
  }
  if (!pageIds.has(value.entryPageId)) throw new Error(tr('入口页面不存在', 'Entry page does not exist'));
  if (!Array.isArray(value.stickyNotes) || value.stickyNotes.length > 10000) throw new Error(tr('发布便签必须明确提供，且最多 10000 条', 'Published stickyNotes must be provided and cannot exceed 10,000 items'));
  const noteIds = new Set<string>();
  for (const note of value.stickyNotes) {
    object(note, tr('便签', 'sticky note')); required(note.id, tr('便签 ID', 'Sticky note ID')); required(note.pageId, tr('便签页面 ID', 'Sticky note page ID')); required(note.targetWidgetId, tr('便签区域 ID', 'Sticky note target ID')); required(note.text, tr('便签内容', 'Sticky note text'));
    if (noteIds.has(note.id)) throw new Error(tr('便签 ID 重复', 'Duplicate sticky note ID')); noteIds.add(note.id);
    if (!pageIds.has(note.pageId)) throw new Error(tr('便签引用未发布的页面', 'Sticky note references an unpublished page'));
    const label = tr(`页面 ${note.pageId} 的便签 ${note.id}`, `Sticky note ${note.id} on page ${note.pageId}`);
    if (typeof note.targetWidgetName !== 'string') throw new Error(tr(`${label} 的组件名称（targetWidgetName）必须是文本`, `${label} targetWidgetName must be a string`));
    if (typeof note.active !== 'boolean') throw new Error(tr(`${label} 的启用状态（active）必须是布尔值`, `${label} active must be a boolean`));
    validateStickyNoteIndex(note.index, label);
    // Deleted target regions remain reviewable in the notes list, explicitly
    // marked as missing. Never attach them to another component by name.
  }
  if (!Array.isArray(value.tables)) throw new Error(tr('表结构必须是数组', 'tables must be an array'));
  object(value.tableRows, tr('演示数据', 'tableRows'));
  const tables = new Set<string>();
  for (const table of value.tables) {
    object(table, tr('表结构', 'table schema')); required(table.id, tr('表 ID', 'Table ID')); required(table.tableName, tr('表名', 'Table name')); required(table.cnName, tr('表标题', 'Table title'));
    if (tables.has(table.id)) throw new Error(tr('表 ID 重复', 'Duplicate table ID')); tables.add(table.id);
    if (!Array.isArray(table.columns) || !Array.isArray(table.sharedByMenus)) throw new Error(tr('表字段或关联页面无效', 'Invalid table columns or sharedByMenus'));
    const columns = new Set<string>(), columnIds = new Set<string>();
    for (const column of table.columns) {
      object(column, tr('表字段', 'table column')); required(column.id, tr('字段 ID', 'Column ID')); required(column.name, tr('字段名称', 'Column name')); required(column.dataType, tr('字段类型', 'Column dataType'));
      if (value.formatVersion >= 5) {
        if (column.id.trim() !== column.id || columnIds.has(column.id)) throw new Error(tr('表字段 ID 重复或包含首尾空白', 'Duplicate or untrimmed column ID'));
        columnIds.add(column.id);
      }
      if (columns.has(column.name) || typeof column.nullable !== 'boolean') throw new Error(tr('表字段重复或属性无效', 'Duplicate column name or invalid nullable flag')); columns.add(column.name);
      if (value.formatVersion < 5) {
        if (has(column, 'isUnique')) throw new Error(tr('旧版发布格式不包含字段唯一约束', 'Legacy published format does not support column isUnique'));
      } else if (column.isUnique !== undefined && typeof column.isUnique !== 'boolean') {
        throw new Error(tr('字段 isUnique 必须是布尔值', 'Column isUnique must be a boolean'));
      }
    }
    if (value.formatVersion < 5) {
      if (has(table, 'uniqueConstraints')) throw new Error(tr('旧版发布格式不包含表级唯一约束', 'Legacy published format does not support table uniqueConstraints'));
    } else {
      resolveUniqueConstraints(table as unknown as DBTableSchema);
    }
    if (!has(value.tableRows, table.id)) throw new Error(tr(`缺少表 ${table.cnName} 的演示数据`, `Missing preview rows for table ${table.cnName}`));
  }
  for (const [id, rows] of Object.entries(value.tableRows)) {
    if (!tables.has(id) || !Array.isArray(rows)) throw new Error(tr('演示数据引用未知表', 'tableRows references an unknown table'));
    const ids = new Set<string>();
    for (const row of rows) { object(row, tr('数据行', 'data row')); required(row.id, tr('行 ID', 'Row ID')); if (ids.has(row.id)) throw new Error(tr('数据行 ID 重复', 'Duplicate data row ID')); ids.add(row.id); }
  }
  for (const page of value.pages as PublishedPage[]) {
    const chartRows = value.tableRows as Record<string, unknown>;
    const freeformIds = new Set<string>();
    const chartIds = new Set<string>();
    const chartErrors: string[] = [];
    const errors: string[] = [];
    walk(page.doc.root, node => {
      if (node.type === 'Table') {
        const issues = tableBindingErrors(node.props, value.tables as DBTableSchema[], value.tableRows);
        if (issues.length) throw new Error(tr(`表格 ${node.pfId} 未通过发布检查：${issues.join('，')}`, `Table ${node.pfId} failed publish check: ${issues.join(', ')}`));
      }
      if (COLLECTION_BINDING_TYPES.has(node.type)) {
        const issues = collectionBindingErrors(node.type, node.props, value.tables as DBTableSchema[]);
        if (issues.length) {
          const kindZh = node.type.startsWith('M') ? '移动列表' : '数据组件';
          const kindEn = node.type.startsWith('M') ? 'Mobile list' : 'Data view';
          throw new Error(tr(`${kindZh} ${node.pfId} 未通过发布检查：${issues.join('，')}`, `${kindEn} ${node.pfId} failed publish check: ${issues.join(', ')}`));
        }
      }
      if (isChartType(node.type)) {
        chartIds.add(node.pfId);
        const issues = chartConfigErrors(node.type, node.props, value.tables as DBTableSchema[]);
        chartErrors.push(...issues);
        if (!issues.length) {
          try { prepareChartData(node.type, node.props, node.props.source === 'table' ? chartRows[String(node.props.table)] : node.props.data); }
          catch (e) { chartErrors.push(e instanceof Error ? e.message : String(e)); }
        }
      }
      if (node.type !== 'Freeform') return;
      freeformIds.add(node.pfId);
      errors.push(...freeformBindingErrors(node.props, value.tables as DBTableSchema[]));
    });
    if (freeformIds.size) errors.push(...validateMaterialDoc(page.doc).filter(issue => freeformIds.has(issue.pfId)).map(issue => issue.message));
    if (errors.length) throw new Error(tr(`自由组件未通过发布检查：${errors.join('；')}`, `Freeform component failed publish check: ${errors.join('; ')}`));
    if (chartIds.size) chartErrors.push(...validateMaterialDoc(page.doc).filter(issue => chartIds.has(issue.pfId)).map(issue => issue.message));
    if (chartErrors.length) throw new Error(tr(`数据图表未通过发布检查：${chartErrors.join('；')}`, `Chart failed publish check: ${chartErrors.join('; ')}`));
  }
  if (has(value, 'designTokens')) {
    if (value.formatVersion !== 5) {
      throw new Error(tr('此发布格式不包含设计令牌字段', 'This published format does not support designTokens'));
    }
    validateDesignTokens(value.designTokens, 'designTokens');
  }
  validatePublishedNotes(value, pageIds);
}

const NOTE_STATUSES = new Set(['draft', 'pending_confirm', 'confirmed', 'implemented']);
const NOTE_PRIORITIES = new Set(['P0', 'P1', 'P2']);

function validatePublishedNotes(value: Record<string, unknown>, pageIds: Set<string>) {
  if (value.formatVersion !== 4 && value.formatVersion !== 5) {
    if (has(value, 'notes') || has(value, 'noteAssets')) throw new Error(tr('此发布格式不包含项目笔记字段', 'This published format does not support project notes'));
    return;
  }
  if (value.formatVersion === 5 && !has(value, 'notes') && !has(value, 'noteAssets')) {
    return;
  }
  if (!Array.isArray(value.notes) || value.notes.length > PUBLISHED_NOTES_MAX) throw new Error(tr('发布笔记必须明确提供，且最多 500 篇', 'Published notes must be an array of at most 500 notes'));
  validateNoteAssets(value.noteAssets ?? {});
  const ids = new Set<string>();
  for (const note of value.notes) {
    object(note, tr('发布笔记', 'published note'));
    required(note.noteId, tr('笔记 ID', 'Note ID'));
    required(note.title, tr('笔记标题', 'Note title'));
    if (ids.has(note.noteId)) throw new Error(tr('发布笔记 ID 重复', 'Duplicate published note ID'));
    ids.add(note.noteId);
    if (typeof note.icon !== 'string' || note.icon.length > 16) throw new Error(tr('发布笔记图标无效', 'Invalid published note icon'));
    if (!NOTE_STATUSES.has(note.status as string)) throw new Error(tr('发布笔记状态无效', 'Invalid published note status'));
    if (note.priority !== undefined && !NOTE_PRIORITIES.has(note.priority as string)) throw new Error(tr('发布笔记优先级无效', 'Invalid published note priority'));
    if (note.meetingDate !== undefined && typeof note.meetingDate !== 'string') throw new Error(tr('发布笔记日期无效', 'Invalid published note date'));
    required(note.updatedAt, tr('笔记更新时间', 'Note updatedAt'));
    if (typeof note.html !== 'string' || note.html.length > PUBLISHED_NOTE_HTML_MAX) throw new Error(tr(`笔记《${note.title}》内容过长，无法发布`, `Note "${note.title}" is too large to publish`));
    if (!Array.isArray(note.pageIds) || note.pageIds.some((id) => typeof id !== 'string' || !pageIds.has(id))) {
      throw new Error(tr(`笔记《${note.title}》关联了未发布的页面`, `Note "${note.title}" links to an unpublished page`));
    }
  }
}

/** V1 shares predate note publishing. Keep them readable with an explicitly
 * empty note collection; only a new publication can supply the missing notes. */
export function normalizePublishedSnapshot(value: unknown): ReadablePublishedSnapshot {
  object(value, tr('发布内容', 'published snapshot'));
  let candidate: unknown = value;
  if (value.formatVersion === 1) {
    if (has(value, 'stickyNotes')) throw new Error(tr('旧版发布内容包含不符合版本的便签字段', 'V1 published snapshot unexpectedly contains stickyNotes'));
    candidate = { ...value, formatVersion: 2, stickyNotes: [] };
  }
  validatePublishedSnapshot(candidate);
  return structuredClone(candidate);
}
