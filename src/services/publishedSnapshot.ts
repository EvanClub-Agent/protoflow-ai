import { validatePublishedSitemap, publishedMenuIndex, type PublishedMenuItem } from './publishedSitemap';
import type { DBTableSchema, StickyNoteRule } from '../store/useProtoStore';
import { validateNoteAssets, type NoteAsset, type NotePriority, type NoteRequirementStatus } from '../proto/notes';
import type { ProtoDoc } from '../proto/types';
import type { Row } from '../proto/runtime/mock';
import { COMPONENT_MAP, PAGE_ROOT_TYPES } from '../proto/registry/meta';
import { ACTION_MAP } from '../proto/runtime/actions';
import { object } from './projectValidation';
import { validateStickyNoteIndex } from '../proto/stickyNoteIndex';
import { validateMaterialDoc } from '../proto/registry/materialContract';
import { tableBindingErrors, sourceForeignKeyErrors } from '../proto/table/model';
import { freeformBindingErrors } from '../proto/freeform/contract';
import { walk } from '../proto/dsl/tree';
import { isChartType, chartConfigErrors, prepareChartData } from '../proto/charts/model';

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
  /** 4 = 3 plus read-only project notes; 3 is still produced when no note is shared. */
  formatVersion: 3 | 4;
  notes?: PublishedNote[];
  noteAssets?: Record<string, NoteAsset>;
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
function required(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 不能为空`);
}

/** Standard nodes are interpreted by registries. Freeform source is validated
 * here and compiled only inside its isolated runtime. Validate before store writes. */
export function validatePublishedSnapshot(value: unknown): asserts value is ReadablePublishedSnapshot {
  object(value, '发布内容');
  if (value.formatVersion !== 2 && value.formatVersion !== 3 && value.formatVersion !== 4) throw new Error('此发布格式不受支持，请更新浏览端');
  required(value.projectId, '项目 ID'); required(value.title, '项目标题'); required(value.entryPageId, '入口页面');
  if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > 500) throw new Error('发布页面数量无效');
  const pageIds = new Set<string>(), navigationIds = new Set<string>(); let count = 0;
  const checkProp = (v: unknown, depth: number): void => {
    if (depth > 80) throw new Error('组件属性嵌套过深');
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return;
    if (Array.isArray(v)) { v.forEach(x => checkProp(x, depth + 1)); return; }
    object(v, '组件属性');
    if (v.$kind === 'raw') throw new Error('页面包含未支持的代码表达式，请在设计器中修正后再发布');
    if (v.$kind === 'actions') {
      if (!Array.isArray(v.calls)) throw new Error('页面动作格式无效');
      for (const call of v.calls) {
        object(call, '动作'); required(call.name, '动作名');
        if (!has(ACTION_MAP, call.name) || !Array.isArray(call.args)) throw new Error(`不支持的页面动作：${call.name}`);
        if (call.name === 'navigate' && (typeof call.args[0] !== 'string' || !navigationIds.has(call.args[0]))) throw new Error('跳转动作指向未发布的页面');
      }
    }
    for (const [key, item] of Object.entries(v)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('组件属性名无效');
      checkProp(item, depth + 1);
    }
  };
  for (const p of value.pages) {
    object(p, '页面'); required(p.pageId, '页面 ID'); required(p.title, '页面标题'); required(p.folderId, '页面目录');
    navigationIds.add(p.pageId);
    if (pageIds.has(p.pageId)) throw new Error('页面 ID 重复'); pageIds.add(p.pageId);
  }
  if (value.formatVersion === 3 || value.formatVersion === 4) {
    validatePublishedSitemap(value.sitemap, value.pages as PublishedPage[]);
    for (const id of publishedMenuIndex(value.sitemap).keys()) navigationIds.add(id);
  } else if (has(value, 'sitemap')) throw new Error('旧版发布内容不支持菜单目录字段');
  for (const p of value.pages) {
    object(p.doc, '页面内容');
    if (!Array.isArray(p.doc.header) || !p.doc.header.every((s: unknown) => typeof s === 'string')) throw new Error('页面头信息无效');
    const ids = new Set<string>();
    const node = (n: unknown, depth: number): void => {
      if (++count > 50000 || depth > 80) throw new Error('设计内容超过页面复杂度限制');
      object(n, '页面节点');
      if (n.kind === 'text' && typeof n.value === 'string') return;
      if (n.kind !== 'node') throw new Error('页面节点类型无效');
      required(n.pfId, '组件 ID'); required(n.type, '组件类型');
      if (ids.has(n.pfId) || !has(COMPONENT_MAP, n.type)) throw new Error(`组件 ID 重复或不支持组件 ${n.type}`);
      ids.add(n.pfId); object(n.props, '组件属性'); checkProp(n.props, 0);
      if (!Array.isArray(n.children)) throw new Error('组件子节点无效');
      n.children.forEach(c => node(c, depth + 1));
    };
    node(p.doc.root, 0);
    if (!PAGE_ROOT_TYPES.has(p.doc.root.type)) throw new Error('页面根组件必须是 Page 或 MobilePage');
  }
  if (!pageIds.has(value.entryPageId)) throw new Error('入口页面不存在');
  if (!Array.isArray(value.stickyNotes) || value.stickyNotes.length > 10000) throw new Error('发布便签必须明确提供，且最多 10000 条');
  const noteIds = new Set<string>();
  for (const note of value.stickyNotes) {
    object(note, '便签'); required(note.id, '便签 ID'); required(note.pageId, '便签页面 ID'); required(note.targetWidgetId, '便签区域 ID'); required(note.text, '便签内容');
    if (noteIds.has(note.id)) throw new Error('便签 ID 重复'); noteIds.add(note.id);
    if (!pageIds.has(note.pageId)) throw new Error('便签引用未发布的页面');
    const label = `页面 ${note.pageId} 的便签 ${note.id}`;
    if (typeof note.targetWidgetName !== 'string') throw new Error(`${label} 的组件名称（targetWidgetName）必须是文本`);
    if (typeof note.active !== 'boolean') throw new Error(`${label} 的启用状态（active）必须是布尔值`);
    validateStickyNoteIndex(note.index, label);
    // Deleted target regions remain reviewable in the notes list, explicitly
    // marked as missing. Never attach them to another component by name.
  }
  if (!Array.isArray(value.tables)) throw new Error('表结构必须是数组');
  object(value.tableRows, '演示数据');
  const tables = new Set<string>();
  for (const table of value.tables) {
    object(table, '表结构'); required(table.id, '表 ID'); required(table.tableName, '表名'); required(table.cnName, '表标题');
    if (tables.has(table.id)) throw new Error('表 ID 重复'); tables.add(table.id);
    if (!Array.isArray(table.columns) || !Array.isArray(table.sharedByMenus)) throw new Error('表字段或关联页面无效');
    const columns = new Set<string>();
    for (const column of table.columns) {
      object(column, '表字段'); required(column.id, '字段 ID'); required(column.name, '字段名称'); required(column.dataType, '字段类型');
      if (columns.has(column.name) || typeof column.nullable !== 'boolean') throw new Error('表字段重复或属性无效'); columns.add(column.name);
    }
    if (!has(value.tableRows, table.id)) throw new Error(`缺少表 ${table.cnName} 的演示数据`);
  }
  for (const [id, rows] of Object.entries(value.tableRows)) {
    if (!tables.has(id) || !Array.isArray(rows)) throw new Error('演示数据引用未知表');
    const ids = new Set<string>();
    for (const row of rows) { object(row, '数据行'); required(row.id, '行 ID'); if (ids.has(row.id)) throw new Error('数据行 ID 重复'); ids.add(row.id); }
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
        if (issues.length) throw new Error(`表格 ${node.pfId} 未通过发布检查：${issues.join('，')}`);
      }
      if (node.type === 'MTaskList' || node.type === 'MFeedList') {
        const issues = sourceForeignKeyErrors(node.props, value.tables as DBTableSchema[]);
        if (issues.length) throw new Error(`移动列表 ${node.pfId} 未通过发布检查：${issues.join('，')}`);
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
    if (errors.length) throw new Error(`自由组件未通过发布检查：${errors.join('；')}`);
    if (chartIds.size) chartErrors.push(...validateMaterialDoc(page.doc).filter(issue => chartIds.has(issue.pfId)).map(issue => issue.message));
    if (chartErrors.length) throw new Error(`数据图表未通过发布检查：${chartErrors.join('；')}`);
  }
  validatePublishedNotes(value, pageIds);
}

const NOTE_STATUSES = new Set(['draft', 'pending_confirm', 'confirmed', 'implemented']);
const NOTE_PRIORITIES = new Set(['P0', 'P1', 'P2']);

function validatePublishedNotes(value: Record<string, unknown>, pageIds: Set<string>) {
  if (value.formatVersion !== 4) {
    if (has(value, 'notes') || has(value, 'noteAssets')) throw new Error('此发布格式不包含项目笔记字段');
    return;
  }
  if (!Array.isArray(value.notes) || value.notes.length > PUBLISHED_NOTES_MAX) throw new Error('发布笔记必须明确提供，且最多 500 篇');
  validateNoteAssets(value.noteAssets ?? {});
  const ids = new Set<string>();
  for (const note of value.notes) {
    object(note, '发布笔记');
    required(note.noteId, '笔记 ID');
    required(note.title, '笔记标题');
    if (ids.has(note.noteId)) throw new Error('发布笔记 ID 重复');
    ids.add(note.noteId);
    if (typeof note.icon !== 'string' || note.icon.length > 16) throw new Error('发布笔记图标无效');
    if (!NOTE_STATUSES.has(note.status as string)) throw new Error('发布笔记状态无效');
    if (note.priority !== undefined && !NOTE_PRIORITIES.has(note.priority as string)) throw new Error('发布笔记优先级无效');
    if (note.meetingDate !== undefined && typeof note.meetingDate !== 'string') throw new Error('发布笔记日期无效');
    required(note.updatedAt, '笔记更新时间');
    if (typeof note.html !== 'string' || note.html.length > PUBLISHED_NOTE_HTML_MAX) throw new Error(`笔记《${note.title}》内容过长，无法发布`);
    if (!Array.isArray(note.pageIds) || note.pageIds.some((id) => typeof id !== 'string' || !pageIds.has(id))) {
      throw new Error(`笔记《${note.title}》关联了未发布的页面`);
    }
  }
}

/** V1 shares predate note publishing. Keep them readable with an explicitly
 * empty note collection; only a new publication can supply the missing notes. */
export function normalizePublishedSnapshot(value: unknown): ReadablePublishedSnapshot {
  object(value, '发布内容');
  let candidate: unknown = value;
  if (value.formatVersion === 1) {
    if (has(value, 'stickyNotes')) throw new Error('旧版发布内容包含不符合版本的便签字段');
    candidate = { ...value, formatVersion: 2, stickyNotes: [] };
  }
  validatePublishedSnapshot(candidate);
  return structuredClone(candidate);
}
