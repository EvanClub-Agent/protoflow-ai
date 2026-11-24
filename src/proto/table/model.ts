import { diagramRelations } from '../database/relations';
import type { DBTableSchema } from '../../store/useProtoStore';
import { columnLabel, defaultDisplayColumns, type Row } from '../runtime/mock';
import { materialOptions } from '../registry/antdOptions';

export const CELL_EDITORS = { input: '文本框', textarea: '多行文本', number: '数字框', select: '下拉选择', date: '日期', switch: '开关' };
export type CellEditor = keyof typeof CELL_EDITORS;
export interface TableColumn {
  dataIndex: string;
  title: string;
  render?: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  width?: number;
  editor?: CellEditor;
  editorOptions?: unknown;
  mergeRows?: boolean;
}
export interface CellMerge { rowIds: string[]; fields: string[] }
export const SAMPLE_COLUMNS = [
  { dataIndex: 'name', title: '名称' }, { dataIndex: 'status', title: '状态' }, { dataIndex: 'updated', title: '更新时间' },
];
export const SAMPLE_FIELDS = [...SAMPLE_COLUMNS, { dataIndex: 'id', title: '记录 ID' }, { dataIndex: 'parentId', title: '父记录 ID' }, { dataIndex: 'remark', title: '备注' }, { dataIndex: 'quantity', title: '数量' }, { dataIndex: 'enabled', title: '启用' }];
export const SAMPLE_ROWS: Row[] = ['已通过', '待审批', '草稿'].map((status, i) => ({
  id: `s${i}`, name: `示例数据 ${i + 1}`, status, updated: `2026-10-${20 + i}`,
  parentId: i === 1 ? 's0' : null, quantity: i + 1, enabled: i === 0, remark: ['准备阶段', '准备阶段', '验收阶段'][i],
}));

export function defaultTableColumns(table?: DBTableSchema) {
  return table ? defaultDisplayColumns(table).map(c => ({ dataIndex: c.name, title: columnLabel(c) })) : SAMPLE_COLUMNS;
}

export function lockedColumn(field: string, props: Record<string, unknown>, table?: DBTableSchema) {
  const column = table?.columns.find(c => c.name === field);
  return ['id', '__proto__', 'constructor', 'prototype'].includes(field) || column?.isPrimaryKey || column?.isForeignKey ||
    (props.rowMode === 'tree' && (field === props.treeKeyField || field === props.parentField));
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const fieldList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(s => typeof s === 'string' && s.trim()) && new Set(v).size === v.length;
export function tableConfigErrors(props: Record<string, unknown>, table?: DBTableSchema): string[] {
  const errors: string[] = [];
  const sample = props.table === undefined || props.table === '';
  if (!sample && typeof props.table !== 'string') errors.push('绑定表必须是工程内的表 ID');
  if (props.rowMode !== undefined && !['flat', 'tree', 'expandable'].includes(String(props.rowMode))) errors.push('表格模式仅支持 flat、tree、expandable');
  const checkField = (value: unknown) => {
    if (sample && typeof value === 'string' && !SAMPLE_FIELDS.some(c => c.dataIndex === value)) errors.push(`未知示例字段 ${value}`);
    if (table && typeof value === 'string' && !table.columns.some(c => c.name === value)) errors.push(`未知字段 ${table.id}.${value}`);
  };
  if (props.rowMode === 'tree') {
    if (props.treeKeyField !== undefined && (typeof props.treeKeyField !== 'string' || !props.treeKeyField.trim())) errors.push('节点字段必须是非空字段名');
    if (typeof props.parentField !== 'string' || !props.parentField.trim()) errors.push('树形表需要指定父节点字段 parentField，根节点的父值为 null');
    checkField(props.parentField);
    if (props.treeKeyField !== 'id') checkField(props.treeKeyField);
    if ((props.treeKeyField ?? 'id') === props.parentField) errors.push('节点字段与父节点字段必须不同');
  }
  if (props.rowMode === 'expandable' && props.detailFields !== undefined) {
    if (!fieldList(props.detailFields)) errors.push('detailFields 需要不重复的字段名');
    else props.detailFields.forEach(checkField);
  }
  const columns = Array.isArray(props.columns) ? props.columns.filter(object) : [];
  const advancedColumns = columns.some(c => c.editor !== undefined || c.mergeRows) || props.cellMerges !== undefined;
  if (advancedColumns && new Set(columns.map(c => c.dataIndex)).size !== columns.length) errors.push('编辑或合并单元格时，展示列的字段名必须唯一');
  for (const col of columns) {
    if (col.editorOptions !== undefined && col.editor !== 'select') errors.push('editorOptions 仅用于下拉编辑器');
    if (col.editor !== undefined) {
      if (typeof col.editor !== 'string' || !Object.hasOwn(CELL_EDITORS, col.editor)) errors.push('单元格编辑器类型无效');
      checkField(col.dataIndex);
      if (typeof col.dataIndex !== 'string' || !col.dataIndex.trim() || lockedColumn(col.dataIndex, props, table)) errors.push(`字段 ${String(col.dataIndex)} 不可行内编辑`);
      if (col.editor === 'select') {
        try { if (!materialOptions(col.editorOptions).length) errors.push('下拉编辑器需要配置 editorOptions'); }
        catch (e) { errors.push(e instanceof Error ? e.message : '下拉选项无效'); }
      }
    }
  }
  if (props.cellMerges !== undefined) {
    if (!Array.isArray(props.cellMerges)) return [...errors, 'cellMerges 必须是合并区域数组'];
    const displayedFields = columns.length ? columns.map(c => c.dataIndex) : table || sample ? defaultTableColumns(table).map(c => c.dataIndex) : undefined;
    const occupied = new Map<string, Set<string>[]>();
    for (const region of props.cellMerges) {
      if (!object(region) || !fieldList(region.rowIds) || !fieldList(region.fields) || region.rowIds.length * region.fields.length < 2) {
        errors.push('每个合并区域至少包含两个单元格，rowIds 与 fields 必须各自唯一且非空');
        continue;
      }
      if (displayedFields && region.fields.some(f => !displayedFields.includes(f))) errors.push('合并区域包含未展示的列');
      const fields = new Set(region.fields);
      for (const id of region.rowIds) {
        const previous = occupied.get(id) ?? [];
        if (region.fields.some(f => previous.some(group => group.has(f)))) return [...errors, `记录 ${id} 存在重叠合并区域`];
        previous.push(fields);
        occupied.set(id, previous);
      }
    }
  }
  return errors;
}

export function missingMergeRow(regions: CellMerge[], rows: Row[]): string | undefined {
  if (!regions.length) return;
  const ids = new Set(rows.map(r => r.id));
  for (const group of regions) {
    const missing = group.rowIds.find(id => !ids.has(id));
    if (missing !== undefined) return `合并区域引用了不存在的记录 ${missing}，请在表格结构中移除或重设该区域`;
  }
}

// Both AI staging and publication check bindings against the complete physical dataset.
export function sourceForeignKeyErrors(props: Record<string, unknown>, tables: DBTableSchema[]): string[] {
  if (props.sourceForeignKey === undefined) return [];
  if (typeof props.table !== 'string' || !props.table || typeof props.sourceForeignKey !== 'string' || !props.sourceForeignKey.trim()) {
    return ['sourceForeignKey 必须同时指定真实的 table ID 和非空外键字段名'];
  }
  const edges = diagramRelations(tables).relations.filter(edge => edge.toTableId === props.table && edge.toColumnName === props.sourceForeignKey);
  return edges.length === 1 ? [] : ['sourceForeignKey 必须是绑定表中已声明并可唯一解析的来源外键字段名（不是列 ID）'];
}

export function tableBindingErrors(props: Record<string, unknown>, tables: DBTableSchema[], savedRows?: unknown): string[] {
  const bound = tables.find(t => t.id === props.table);
  if (props.table && !bound) return [`未知表 ${String(props.table)}`];
  const errors = tableConfigErrors(props, bound);
  errors.push(...sourceForeignKeyErrors(props, tables));
  const regions = (props.cellMerges ?? []) as CellMerge[];
  if (errors.length || (props.rowMode !== 'tree' && !regions.length) || savedRows === undefined) return errors;
  const rows = bound ? (object(savedRows) && Object.hasOwn(savedRows, bound.id) ? savedRows[bound.id] : undefined) : SAMPLE_ROWS;
  if (!Array.isArray(rows)) return ['请先准备已保存的表格预览记录'];
  try {
    if (props.rowMode === 'tree') prepareTableRows(rows, props, {}, null);
    const missing = missingMergeRow(regions, rows);
    return missing ? [missing] : [];
  }
  catch (e) { return [e instanceof Error ? e.message : '树形数据无效']; }
}

interface Branch { row: Row; children: Branch[]; parent?: Branch }
export interface VisibleRow { row: Row; depth: number; ordinal: string; parentId?: string; hasChildren: boolean }
export type TableSort = { key: string; asc: boolean };
function treeBranches(records: Row[], key: string, parent: string) {
  const byKey = new Map<unknown, Branch>();
  for (const row of records) {
    const value = row[key];
    const validKey = typeof value === 'string' ? value.trim().length > 0 : Number.isFinite(value);
    if (!validKey) throw new Error(`记录 ${row.id} 缺少有效节点字段 ${key}`);
    if (byKey.has(value)) throw new Error(`节点字段 ${key} 的值重复：${value}`);
    byKey.set(value, { row, children: [] });
  }
  const roots: Branch[] = [];
  for (const branch of byKey.values()) {
    const parentKey = branch.row[parent];
    if (parentKey === null) roots.push(branch);
    else {
      const owner = byKey.get(parentKey);
      if (!owner) throw new Error(`记录 ${branch.row.id} 的 ${parent} 未匹配到节点，根节点请显式填写 null`);
      owner.children.push(branch);
      branch.parent = owner;
    }
  }
  // Each node has at most one parent. A node unreachable from every root belongs to a cyclic component.
  const ordered = [...roots];
  for (let i = 0; i < ordered.length; i++) {
    for (const child of ordered[i].children) ordered.push(child);
  }
  if (ordered.length !== byKey.size) throw new Error('树形表的父子关系存在循环');
  return { roots, ordered };
}

/**
 * Shared exact-match static filter rule for both Table and CardGrid:
 * - Explicit `null` (e.g. root foreign key `parent_id: null`) matches ONLY records that own the field with value `null`,
 *   never records where the field is missing or `undefined`.
 * - Non-null scalars (`string`, `number`, `boolean`, including `""`) match ONLY records that own a non-null value
 *   with exact stringified equality.
 */
export function matchesStaticRowFilter(row: Row, staticFilter: unknown): boolean {
  if (!staticFilter || typeof staticFilter !== 'object' || Array.isArray(staticFilter)) return true;
  for (const [k, v] of Object.entries(staticFilter as Record<string, unknown>)) {
    if (v === undefined || Array.isArray(v)) continue;
    if (!Object.prototype.hasOwnProperty.call(row, k)) return false;
    const cell = row[k];
    if (cell === undefined) return false;
    if (v === null) {
      if (cell !== null) return false;
      continue;
    }
    if (cell === null || String(cell) !== String(v)) {
      return false;
    }
  }
  return true;
}

export function prepareTableRows(records: Row[], props: Record<string, unknown>, query: Record<string, unknown>, sort: TableSort | null) {
  const seen = new Set<string>();
  for (const row of records) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || seen.has(row.id)) throw new Error('预览记录的 id 必须是唯一非空字符串');
    seen.add(row.id);
  }
  const sorted = sort ? [...records].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    const difference = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'zh-CN');
    return sort.asc ? difference : -difference;
  }) : records;
  const conditions = Object.entries(query).filter(([, v]) => v !== '' && v != null && !Array.isArray(v));
  const matches = (r: Row) => conditions.every(([k, v]) => k === '__keyword'
    ? Object.values(r).some(x => String(x ?? '').includes(String(v)))
    : String(r[k] ?? '').includes(String(v)));
  const allowed = (r: Row) => matchesStaticRowFilter(r, props.filter);
  const forcedOpen = new Set<string>();
  if (props.rowMode !== 'tree') return { roots: sorted.filter(r => allowed(r) && matches(r)).map(row => ({ row, children: [] } as Branch)), forcedOpen };
  const nodeKey = props.treeKeyField === undefined ? 'id' : props.treeKeyField;
  if (typeof nodeKey !== 'string' || typeof props.parentField !== 'string') throw new Error('树形表需要有效的节点字段和父节点字段');
  const { roots, ordered } = treeBranches(sorted, nodeKey, props.parentField);
  const keep = new Set<Branch>();
  for (let i = ordered.length - 1; i >= 0; i--) {
    const branch = ordered[i];
    branch.children = branch.children.filter(child => keep.has(child));
    if (!allowed(branch.row)) continue;
    if (branch.children.length || matches(branch.row)) keep.add(branch);
    if (conditions.length && branch.children.length) forcedOpen.add(branch.row.id);
  }
  return { roots: roots.filter(r => keep.has(r)), forcedOpen };
}

export function visibleTableRows(roots: Branch[], isOpen: (id: string) => boolean, rootOffset = 0): VisibleRow[] {
  const stack = roots.map((branch, i) => ({ branch, depth: 0, ordinal: String(rootOffset + i + 1) })).reverse();
  const visible: VisibleRow[] = [];
  while (stack.length) {
    const { branch, depth, ordinal } = stack.pop()!;
    visible.push({ row: branch.row, depth, ordinal, parentId: branch.parent?.row.id, hasChildren: branch.children.length > 0 });
    if (isOpen(branch.row.id)) {
      for (let i = branch.children.length - 1; i >= 0; i--) {
        stack.push({ branch: branch.children[i], depth: depth + 1, ordinal: `${ordinal}.${i + 1}` });
      }
    }
  }
  return visible;
}

type Span = { rowSpan: number; colSpan: number };
// Only combine a rectangle while its original records and fields remain adjacent in display order.
export function tableCellSpans(rows: VisibleRow[], columns: TableColumn[], regions: CellMerge[], hasDetail: (id: string) => boolean) {
  const spans = new Map<number, Span | null>();
  const at = (r: number, c: number) => r * columns.length + c;
  const mark = (r: number, c: number, height: number, width: number) => {
    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) spans.set(at(r + i, c + j), null);
    }
    spans.set(at(r, c), { rowSpan: height, colSpan: width });
  };
  const adjacent = (i: number) => !hasDetail(rows[i - 1].row.id) && rows[i].parentId === rows[i - 1].parentId;
  if (!regions.length && !columns.some(c => c.mergeRows)) return () => undefined;
  const positions = new Map(rows.map((item, i) => [item.row.id, i]));
  for (const { rowIds, fields } of regions) {
    const r = positions.get(rowIds[0]), c = columns.findIndex(col => col.dataIndex === fields[0]);
    if (r === undefined || c < 0 || !fields.every((f, j) => columns[c + j]?.dataIndex === f)) continue;
    if (!rowIds.every((id, i) => rows[r + i]?.row.id === id && (!i || adjacent(r + i)))) continue;
    mark(r, c, rowIds.length, fields.length);
  }
  columns.forEach((col, c) => {
    if (!col.mergeRows) return;
    for (let start = 0; start < rows.length; start++) {
      const value = rows[start].row[col.dataIndex];
      if (value == null || value === '' || typeof value === 'object' || spans.has(at(start, c))) continue;
      let end = start + 1;
      while (end < rows.length && adjacent(end) && !spans.has(at(end, c)) && rows[end].row[col.dataIndex] === value) end++;
      if (end > start + 1) mark(start, c, end - start, 1);
      start = end - 1;
    }
  });
  return (r: number, c: number) => spans.get(at(r, c));
}

/** A missing scope can never expand a detail table into the entire dataset. */
export function rowsForSource(rows: Row[], field: string, tableId: string | undefined, scope: { tableId?: string; row?: Row }, tables: DBTableSchema[]) {
  const edges = diagramRelations(tables).relations.filter(r => r.toTableId === tableId && r.toColumnName === field);
  const edge = edges.length === 1 ? edges[0] : undefined;
  if (!edge || edge.fromTableId !== scope.tableId || !scope.row) return [];
  const value = scope.row[edge.fromColumnName];
  if (!(typeof value === 'string' && value !== '' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean')) return [];
  return rows.filter(row => row[field] === value);
}
