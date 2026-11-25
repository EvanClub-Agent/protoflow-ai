import { declaredColumnOptions, sqlEnumValues } from '../database/enumContract';
import { diagramRelations } from '../database/relations';
import { resolveUniqueConstraints, uniqueColumnValue } from '../database/uniqueConstraints';
import type { DBColumnSchema, DBTableSchema } from '../../store/useProtoStore';
import type { Row } from './mock';
import { td, tr, type Locale } from '../../i18n/runtime';

export type FieldFormatRule = '' | 'phone' | 'email' | 'credit_code' | 'id_card' | 'positive_number';

export interface FieldConstraintSpec {
  name: string;
  label: string;
  minField?: string;
  maxField?: string;
  minValue?: number;
  maxValue?: number;
  formatRule?: FieldFormatRule;
  validationMessage?: string;
}

export type PokaYokeIssue =
  | { kind: 'minField'; label: string; otherLabel: string; bound: string; customMessage?: string }
  | { kind: 'maxField'; label: string; otherLabel: string; bound: string; customMessage?: string }
  | { kind: 'minValue'; label: string; bound: number; customMessage?: string }
  | { kind: 'maxValue'; label: string; bound: number; customMessage?: string }
  | { kind: 'format'; label: string; rule: Exclude<FieldFormatRule, ''>; customMessage?: string };

export function formatPokaYokeIssue(issue: PokaYokeIssue, locale?: Locale): string {
  if (issue.customMessage && issue.customMessage.trim()) {
    return td(issue.customMessage.trim(), locale);
  }
  const label = td(issue.label, locale);
  switch (issue.kind) {
    case 'minField': {
      const other = td(issue.otherLabel, locale);
      return tr(
        `${label}不能小于${other}（${issue.bound}）`,
        `${label} must be ≥ ${other} (${issue.bound})`,
        locale,
      );
    }
    case 'maxField': {
      const other = td(issue.otherLabel, locale);
      return tr(
        `${label}不能超过${other}（${issue.bound}）`,
        `${label} cannot exceed ${other} (${issue.bound})`,
        locale,
      );
    }
    case 'minValue':
      return tr(`${label}不能小于 ${issue.bound}`, `${label} must be ≥ ${issue.bound}`, locale);
    case 'maxValue':
      return tr(`${label}不能大于 ${issue.bound}`, `${label} must be ≤ ${issue.bound}`, locale);
    case 'format':
      switch (issue.rule) {
        case 'phone':
          return tr(`${label}格式不正确（需为有效手机号）`, `${label} must be a valid phone number`, locale);
        case 'email':
          return tr(`${label}格式不正确（需为有效邮箱）`, `${label} must be a valid email address`, locale);
        case 'credit_code':
          return tr(`${label}需为 18 位统一社会信用代码`, `${label} must be an 18-character credit code`, locale);
        case 'id_card':
          return tr(`${label}需为有效身份证号`, `${label} must be a valid ID number`, locale);
        case 'positive_number':
          return tr(`${label}必须大于 0`, `${label} must be greater than 0`, locale);
      }
  }
}

const ISO_DATE_LIKE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;

function compareComparableValues(actual: unknown, ref: unknown): number | null {
  if (actual === undefined || actual === null || actual === '' || ref === undefined || ref === null || ref === '') {
    return null;
  }
  const aStr = String(actual).trim();
  const bStr = String(ref).trim();
  if (ISO_DATE_LIKE.test(aStr) && ISO_DATE_LIKE.test(bStr)) {
    const aTime = Date.parse(aStr.replace(/\//g, '-'));
    const bTime = Date.parse(bStr.replace(/\//g, '-'));
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
      return aTime === bTime ? 0 : aTime < bTime ? -1 : 1;
    }
  }
  const aNum = typeof actual === 'number' ? actual : Number(aStr);
  const bNum = typeof ref === 'number' ? ref : Number(bStr);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
    return aNum === bNum ? 0 : aNum < bNum ? -1 : 1;
  }
  return null;
}

const FORMAT_PATTERNS: Record<Exclude<FieldFormatRule, '' | 'positive_number'>, RegExp> = {
  phone: /^\+?\d[\d\s-]{6,18}\d$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  credit_code: /^[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}$/i,
  id_card: /^\d{15}(\d{2}[0-9Xx])?$/,
};

export function evaluateFieldConstraint(
  spec: FieldConstraintSpec,
  value: unknown,
  allValues: Record<string, unknown>,
  labelByField: Map<string, string>,
): PokaYokeIssue | null {
  if (value === undefined || value === null || value === '') return null;
  const customMessage = spec.validationMessage;

  if (spec.formatRule) {
    if (spec.formatRule === 'positive_number') {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        return { kind: 'format', label: spec.label, rule: 'positive_number', customMessage };
      }
    } else {
      const re = FORMAT_PATTERNS[spec.formatRule];
      if (re && !re.test(String(value).trim())) {
        return { kind: 'format', label: spec.label, rule: spec.formatRule, customMessage };
      }
    }
  }

  if (typeof spec.minValue === 'number' && Number.isFinite(spec.minValue)) {
    const n = Number(value);
    if (Number.isFinite(n) && n < spec.minValue) {
      return { kind: 'minValue', label: spec.label, bound: spec.minValue, customMessage };
    }
  }

  if (typeof spec.maxValue === 'number' && Number.isFinite(spec.maxValue)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > spec.maxValue) {
      return { kind: 'maxValue', label: spec.label, bound: spec.maxValue, customMessage };
    }
  }

  if (spec.minField) {
    const refVal = allValues[spec.minField];
    const cmp = compareComparableValues(value, refVal);
    if (cmp !== null && cmp < 0) {
      return {
        kind: 'minField',
        label: spec.label,
        otherLabel: labelByField.get(spec.minField) ?? spec.minField,
        bound: String(refVal),
        customMessage,
      };
    }
  }

  if (spec.maxField) {
    const refVal = allValues[spec.maxField];
    const cmp = compareComparableValues(value, refVal);
    if (cmp !== null && cmp > 0) {
      return {
        kind: 'maxField',
        label: spec.label,
        otherLabel: labelByField.get(spec.maxField) ?? spec.maxField,
        bound: String(refVal),
        customMessage,
      };
    }
  }

  return null;
}

/**
 * Evaluates declarative row/context state guards such as:
 * - disabledWhenField="status" disabledWhenValue="已入库,已归档"
 * - disabledWhenField="status" disabledWhenValue="!待审批" (negated: disabled whenever status !== '待审批')
 */
export function matchesWhenCondition(
  row: Record<string, unknown> | undefined,
  field: unknown,
  expectedRaw: unknown,
): boolean {
  if (!row || typeof field !== 'string' || !field.trim()) return false;
  if (typeof expectedRaw !== 'string' || !expectedRaw.trim()) return false;
  const actual = row[field.trim()];
  const actualStr = actual === undefined || actual === null ? '' : String(actual).trim();
  const raw = expectedRaw.trim();
  if (raw.startsWith('!')) {
    const allowed = raw
      .slice(1)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowed.length) return false;
    return !allowed.includes(actualStr);
  }
  const targets = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return targets.includes(actualStr);
}

export interface RowDeleteUndoPatch {
  removed: Array<{ tableId: string; row: Row; originalIndex: number }>;
  nullified: Array<{ tableId: string; rowId: string; columnName: string; previousValue: unknown }>;
}

const KANBAN_FORBIDDEN_COL_TYPE_RE =
  /^(?:DATE|TIME|DATETIME|TIMESTAMP|TIMESTAMPTZ|YEAR|(?:TINY|SMALL|MEDIUM|BIG)?INT|INTEGER|SERIAL|BIGSERIAL|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|BOOL|BOOLEAN|JSON|JSONB|BLOB|BYTEA|BINARY|VARBINARY|UUID)\b/i;
const KANBAN_TEXT_COL_TYPE_RE = /^(?:(?:N|VAR)?CHAR|(?:TINY|MEDIUM|LONG)?TEXT)\b/i;

function varcharMaxLength(dataType: string): number | null {
  const m = /^(?:N?VARCHAR|N?CHAR)\s*\(\s*(\d+)\s*\)/i.exec(dataType.trim());
  return m ? Number(m[1]) : null;
}

function isKanbanColumnDomainCompatible(
  col: DBColumnSchema,
  configuredLanes: string[],
  requireConfirmedImplicitDomain: boolean,
): boolean {
  const dt = (col.dataType || '').trim();
  if (KANBAN_FORBIDDEN_COL_TYPE_RE.test(dt)) return false;
  if (!/^ENUM\b/i.test(dt) && !KANBAN_TEXT_COL_TYPE_RE.test(dt)) return false;
  const options = declaredColumnOptions(col);
  const allowed = options?.map(option => option.value);
  if (allowed && (allowed.length < 2 || configuredLanes.some(lane => !allowed.includes(lane)))) return false;
  const lanes = configuredLanes.length ? configuredLanes : allowed ?? [];
  const maxLen = varcharMaxLength(dt);
  if (maxLen !== null && lanes.some(lane => String(lane).length > maxLen)) return false;
  return !requireConfirmedImplicitDomain || lanes.length >= 2;
}

/**
 * Resolves the status lane column for Kanban / MKanban.
 * When `statusField` is omitted on a bound table, requires a single unambiguous
 * status/stage/state/phase column AND a confirmable compatible value domain
 * (SQL ENUM or explicit compatible `lanes`) before allowing lane mutations,
 * preventing accidental writes to timestamps (`status_changed_at`) or other columns.
 */
export function resolveKanbanStatusColumn(
  table: DBTableSchema | undefined,
  explicitStatusField: unknown,
  explicitLanes?: unknown,
): {
  statusCol: DBColumnSchema | undefined;
  statusKey: string;
  writable: boolean;
} {
  if (!table) {
    const key = typeof explicitStatusField === 'string' && explicitStatusField.trim() ? explicitStatusField.trim() : 'status';
    return { statusCol: undefined, statusKey: key, writable: true };
  }
  const configuredLanes = Array.isArray(explicitLanes)
    ? explicitLanes.map((x) => String(x)).filter(Boolean)
    : [];
  if (typeof explicitStatusField === 'string' && explicitStatusField.trim()) {
    const key = explicitStatusField.trim();
    const col = table.columns.find((c) => c.name === key);
    const writable = Boolean(
      col &&
        !col.isPrimaryKey &&
        !col.isForeignKey &&
        !col.references &&
        isKanbanColumnDomainCompatible(col, configuredLanes, false),
    );
    return { statusCol: col, statusKey: key, writable };
  }

  const candidateCols = table.columns.filter((c) => !c.isPrimaryKey && !c.isForeignKey && !c.references);
  const semanticCols = candidateCols.filter((c) => /(?:^|_)(status|stage|state|phase)$/i.test(c.name));
  if (semanticCols.length === 1) {
    const col = semanticCols[0];
    const writable = isKanbanColumnDomainCompatible(col, configuredLanes, true);
    return { statusCol: col, statusKey: col.name, writable };
  }
  if (semanticCols.length > 1) {
    return { statusCol: semanticCols[0], statusKey: semanticCols[0].name, writable: false };
  }

  const enumCols = candidateCols.filter((c) => sqlEnumValues(c) !== null);
  if (enumCols.length > 0) {
    // Non-status enum (e.g. priority / category): safe to group visually, but refuse implicit writes
    return { statusCol: enumCols[0], statusKey: enumCols[0].name, writable: false };
  }
  return { statusCol: undefined, statusKey: 'status', writable: false };
}

/**
 * Enforces ER foreign-key `onDelete` (`RESTRICT` | `CASCADE` | `SET NULL`) transitively
 * across the entire relation graph (with cycle protection) before committing any deletion,
 * and produces a surgical `undoPatch` so Undo never clobbers unrelated edits.
 */
export function applyGuardedRowDelete(
  tables: DBTableSchema[],
  currentData: Record<string, Row[]>,
  getRowsForTable: (tableId: string) => Row[],
  tableId: string,
  rowId: string,
): { nextTableRows: Record<string, Row[]>; deletedRow: Row | undefined; undoPatch: RowDeleteUndoPatch | null } {
  // All dependencies are resolved against the same pre-delete data, including lazy preview tables.
  const originals = new Map<string, Row[]>();
  const rowsOf = (id: string) => {
    const cached = originals.get(id);
    if (cached) return cached;
    const rows = currentData[id] ?? getRowsForTable(id);
    originals.set(id, rows);
    return rows;
  };
  const deletedRow = rowsOf(tableId).find(row => row.id === rowId);
  if (!deletedRow) return { nextTableRows: currentData, deletedRow, undoPatch: null };

  const tablesById = new Map(tables.map(table => [table.id, table]));
  const relations = diagramRelations(tables).relations;
  const pending = [{ tableId, row: deletedRow }];
  const deletedIds = new Map<string, Set<string>>([[tableId, new Set([rowId])]]);
  type Reference = { table: DBTableSchema; column: DBColumnSchema; rows: Row[] };
  const retainedReferences: Reference[] = [];

  for (let i = 0; i < pending.length; i++) {
    const parent = pending[i];
    for (const rel of relations) {
      if (rel.fromTableId !== parent.tableId) continue;
      const value = parent.row[rel.fromColumnName];
      if (value == null) continue;
      const table = tablesById.get(rel.toTableId)!;
      const column = table.columns.find(c => c.id === rel.toColumnId)!;
      const rows = rowsOf(table.id).filter(row => row[column.name] === value);
      if (!rows.length) continue;
      if (column.foreignKeyOptions?.onDelete !== 'CASCADE') {
        retainedReferences.push({ table, column, rows });
        continue;
      }
      const ids = deletedIds.get(table.id) ?? new Set<string>();
      deletedIds.set(table.id, ids);
      for (const row of rows) {
        if (ids.has(row.id)) continue;
        ids.add(row.id);
        pending.push({ tableId: table.id, row });
      }
    }
  }

  // Only references which survive the full cascade need to be restricted or cleared.
  const clearedColumns = new Map<string, Map<string, Set<string>>>();
  for (const { table, column, rows } of retainedReferences) {
    const surviving = rows.filter(row => !deletedIds.get(table.id)?.has(row.id));
    if (!surviving.length) continue;
    const label = table.cnName || table.tableName;
    if (column.foreignKeyOptions?.onDelete !== 'SET NULL') {
      throw new Error(tr(
        `无法删除：仍有 ${surviving.length} 条「${label}」关联引用该记录，请先处理子记录`,
        `Cannot delete: ${surviving.length} record(s) in "${label}" still reference this item`,
      ));
    }
    if (!column.nullable) {
      throw new Error(tr(
        `无法解绑删除：「${label}.${column.name}」不允许为空`,
        `Cannot SET NULL on non-nullable column "${table.tableName}.${column.name}"`,
      ));
    }
    const byRow = clearedColumns.get(table.id) ?? new Map<string, Set<string>>();
    clearedColumns.set(table.id, byRow);
    for (const row of surviving) {
      const fields = byRow.get(row.id) ?? new Set<string>();
      fields.add(column.name);
      byRow.set(row.id, fields);
    }
  }

  // SET NULL on a referenced business key is an update. The ER contract has no ON UPDATE cascade.
  for (const rel of relations) {
    const cleared = clearedColumns.get(rel.fromTableId);
    if (!cleared) continue;
    const lostKeys = new Set(rowsOf(rel.fromTableId)
      .filter(row => cleared.get(row.id)?.has(rel.fromColumnName))
      .map(row => row[rel.fromColumnName]));
    if (!lostKeys.size) continue;
    const stillReferences = rowsOf(rel.toTableId).some(row =>
      !deletedIds.get(rel.toTableId)?.has(row.id) &&
      !clearedColumns.get(rel.toTableId)?.get(row.id)?.has(rel.toColumnName) &&
      lostKeys.has(row[rel.toColumnName]));
    if (stillReferences) {
      throw new Error(tr(`无法置空：仍有记录引用 ${rel.fromTableId}.${rel.fromColumnName}`,
        `Cannot clear a referenced key: ${rel.fromTableId}.${rel.fromColumnName}`));
    }
  }

  const nextTableRows = { ...currentData };
  const undoPatch: RowDeleteUndoPatch = { removed: [], nullified: [] };
  for (const [id, original] of originals) {
    const removed = deletedIds.get(id);
    const clears = clearedColumns.get(id);
    if (!removed && !clears) {
      nextTableRows[id] = original;
      continue;
    }
    const next: Row[] = [];
    original.forEach((row, originalIndex) => {
      if (removed?.has(row.id)) {
        undoPatch.removed.push({ tableId: id, row: structuredClone(row), originalIndex });
        return;
      }
      const fields = clears?.get(row.id);
      if (!fields) {
        next.push(row);
        return;
      }
      const updated = { ...row };
      for (const columnName of fields) {
        undoPatch.nullified.push({ tableId: id, rowId: row.id, columnName, previousValue: row[columnName] });
        updated[columnName] = null;
      }
      next.push(updated);
    });
    nextTableRows[id] = next;
  }
  return { nextTableRows, deletedRow, undoPatch };
}

function assertTableCandidateRowsUnique(schema: DBTableSchema | undefined, rows: Row[]): void {
  const seenRuntimeIds = new Set<string>();
  for (const r of rows) {
    if (seenRuntimeIds.has(r.id)) {
      throw new Error(
        tr('无法撤销删除：记录已被重新创建或存在主键冲突', 'Cannot undo delete: a record with the same ID now exists'),
      );
    }
    seenRuntimeIds.add(r.id);
  }
  if (!schema) return;

  const pkCols = schema.columns.filter((c) => c.isPrimaryKey);
  if (pkCols.length > 0) {
    const seenPk = new Set<string>();
    const pkLabel = pkCols.map((c) => c.comment || c.name).join(', ');
    for (const r of rows) {
      if (pkCols.some((c) => r[c.name] === undefined || r[c.name] === null)) continue;
      const key = JSON.stringify(pkCols.map(c => uniqueColumnValue(r[c.name], c.dataType)));
      if (seenPk.has(key)) {
        throw new Error(
          tr(
            `无法撤销删除：业务主键「${pkLabel}」已被后续新增或修改占用`,
            `Cannot undo delete: primary key (${pkLabel}) conflicts with a newer record`,
          ),
        );
      }
      seenPk.add(key);
    }
  }

  for (const col of schema.columns) {
    if (!col.isUnique) continue;
    const seenUnique = new Set<string>();
    for (const r of rows) {
      const val = r[col.name];
      if (val === undefined || val === null) continue;
      const key = JSON.stringify(uniqueColumnValue(val, col.dataType));
      if (seenUnique.has(key)) {
        throw new Error(
          tr(
            `无法撤销删除：唯一字段「${col.comment || col.name}」已被后续新增或修改占用`,
            `Cannot undo delete: unique value on "${col.name}" conflicts with a newer edit`,
          ),
        );
      }
      seenUnique.add(key);
    }
  }

  const compositeConstraints = resolveUniqueConstraints(schema);
  for (const uc of compositeConstraints) {
    const seenComposite = new Set<string>();
    for (const r of rows) {
      if (uc.columns.some((c) => r[c.name] === undefined || r[c.name] === null)) continue;
      const key = JSON.stringify(uc.columns.map(c => uniqueColumnValue(r[c.name], c.dataType)));
      if (seenComposite.has(key)) {
        throw new Error(
          tr(
            `无法撤销删除：联合唯一约束「${uc.name}」已被后续新增或修改占用`,
            `Cannot undo delete: composite unique constraint "${uc.name}" conflicts with a newer record`,
          ),
        );
      }
      seenComposite.add(key);
    }
  }
}

/**
 * Surgically applies a `RowDeleteUndoPatch` on top of the latest live `tableRows`
 * without touching unrelated tables or rows edited after the deletion, while
 * aborting safely if conflicting changes occurred in the meantime.
 */
export function applyRowDeleteUndo(
  tables: DBTableSchema[],
  currentData: Record<string, Row[]>,
  getRowsForTable: (tableId: string) => Row[],
  patch: RowDeleteUndoPatch,
): Record<string, Row[]> {
  const nextData: Record<string, Row[]> = { ...currentData };
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const allRelations = diagramRelations(tables).relations;
  const touchedTableIds = new Set<string>();

  const removedByTable = new Map<string, Array<{ row: Row; originalIndex: number }>>();
  for (const entry of patch.removed) {
    const arr = removedByTable.get(entry.tableId) ?? [];
    arr.push({ row: entry.row, originalIndex: entry.originalIndex });
    removedByTable.set(entry.tableId, arr);
  }

  for (const [tblId, items] of removedByTable.entries()) {
    const base = [...(nextData[tblId] ?? getRowsForTable(tblId))];
    const sorted = [...items].sort((a, b) => a.originalIndex - b.originalIndex);
    for (const { row, originalIndex } of sorted) {
      if (base.some((r) => r.id === row.id)) {
        throw new Error(
          tr('无法撤销删除：记录已被重新创建或存在主键冲突', 'Cannot undo delete: a record with the same ID now exists'),
        );
      }
      const insertAt = Math.max(0, Math.min(originalIndex, base.length));
      base.splice(insertAt, 0, structuredClone(row));
    }
    nextData[tblId] = base;
    touchedTableIds.add(tblId);
  }

  for (const item of patch.nullified) {
    const base = [...(nextData[item.tableId] ?? getRowsForTable(item.tableId))];
    const idx = base.findIndex((r) => r.id === item.rowId);
    if (idx < 0) {
      throw new Error(
        tr('无法撤销删除：关联子记录已被后续删除', 'Cannot undo delete: a related child record was deleted afterwards'),
      );
    }
    const curVal = base[idx][item.columnName];
    if (curVal !== null && curVal !== undefined && curVal !== '') {
      throw new Error(
        tr(
          '无法撤销删除：关联子记录的外键已被后续修改为其他对象',
          'Cannot undo delete: a related child record was reassigned afterwards',
        ),
      );
    }
    base[idx] = { ...base[idx], [item.columnName]: structuredClone(item.previousValue) };
    nextData[item.tableId] = base;
    touchedTableIds.add(item.tableId);
  }

  for (const tblId of touchedTableIds) {
    assertTableCandidateRowsUnique(tableById.get(tblId), nextData[tblId] ?? []);
  }

  // Verify upstream parent references still exist for restored rows
  for (const { tableId: tblId, row } of patch.removed) {
    const incoming = allRelations.filter((rel) => rel.toTableId === tblId);
    for (const rel of incoming) {
      const childCol = tableById.get(tblId)?.columns.find((c) => c.id === rel.toColumnId);
      if (!childCol) continue;
      const fkVal = row[childCol.name];
      if (fkVal === null || fkVal === undefined || fkVal === '') continue;
      const parentRows = nextData[rel.fromTableId] ?? getRowsForTable(rel.fromTableId);
      if (!parentRows.some((pr) => pr[rel.fromColumnName] === fkVal)) {
        throw new Error(
          tr('无法撤销删除：该记录所依赖的上级主记录已被删除', 'Cannot undo delete: a parent record it references was deleted'),
        );
      }
    }
  }

  return nextData;
}
