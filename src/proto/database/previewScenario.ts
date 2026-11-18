import type { DBTableSchema } from '../../store/useProtoStore';
import type { Row } from '../runtime/mock';
import { diagramRelations } from './relations';
import { resolveUniqueConstraints } from './uniqueConstraints';
import { previewRelationIssues } from './previewRelations';

type Dataset = Record<string, Row[]>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const scalar = (v: unknown) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

const integerType = /^(?:(?:TINY|SMALL|MEDIUM|BIG)?INT|INTEGER)\b/i;
const decimalType = /^(?:DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL)\b/i;
function validColumnValue(type: string, value: unknown) {
  if (integerType.test(type)) return typeof value === 'number' ? Number.isSafeInteger(value) : typeof value === 'string' && /^-?\d+$/.test(value);
  if (decimalType.test(type)) return typeof value === 'number' || typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value);
  if (/^(?:(?:VAR)?CHAR|TEXT|ENUM|DATE|TIMESTAMP)\b/i.test(type)) return typeof value === 'string';
  if (/^(?:BOOL|BOOLEAN)\b/i.test(type)) return typeof value === 'boolean';
  return true;
}
// Numeric columns may be encoded as decimal text (including BIGINT). Compare
// such unique keys without rounding through Number; keep FK joins type-exact.
function uniqueValue(value: unknown, type?: string) {
  if (!type || !(integerType.test(type) || decimalType.test(type))) return value;
  const [whole, fraction = ''] = String(value).split('.');
  if (!/^-?\d+$/.test(whole)) return String(value);
  const digits = whole.replace(/^-/, '').replace(/^0+(?=\d)/, '');
  const remainder = fraction.replace(/0+$/, '');
  const sign = whole.startsWith('-') && (digits !== '0' || remainder) ? '-' : '';
  return sign + digits + (remainder ? '.' + remainder : '');
}

/** Explicit, synthetic scenario records for a prototype. Only initializes absent datasets.
 * Validate the entire scenario together, including cycles and references into existing records. */
export function preparePreviewScenario(tables: DBTableSchema[], existing: Dataset, datasets: unknown): Dataset {
  if (!Array.isArray(datasets) || !datasets.length || datasets.length > 30) throw new Error('演示场景须包含 1 至 30 张表');
  const added: Dataset = Object.create(null);
  const graph = diagramRelations(tables);
  for (const data of datasets) {
    if (!object(data) || typeof data.tableId !== 'string' || !Array.isArray(data.rows) || !data.rows.length || data.rows.length > 100) throw new Error('每张演示表需要明确的 tableId 和 1 至 100 行样例');
    const table = tables.find(t => t.id === data.tableId);
    if (!table || ['__proto__','constructor','prototype'].includes(table.id)) throw new Error(`未知的演示表 ${data.tableId}`);
    if (Object.hasOwn(existing, table.id) || Object.hasOwn(added, table.id)) throw new Error(`表 ${table.id} 已有预览数据或已在场景中声明，不能覆盖`);
    const fields = new Set(['id', ...table.columns.map(c => c.name)]);
    for (const column of table.columns.filter(c => c.isForeignKey || c.references)) {
      if (!graph.relations.some(r => r.toTableId === table.id && r.toColumnId === column.id)) throw new Error(`演示表的来源未解析：${table.tableName}.${column.name}`);
    }
    const rows: Row[] = [];
    for (const row of data.rows) {
      if (!object(row) || !Object.hasOwn(row,'id') || typeof row.id !== 'string' || !row.id.trim()) throw new Error(`表 ${table.id} 的样例须提供独立的行标识 id`);
      if (Object.entries(row).some(([field,v]) => !fields.has(field) || !scalar(v))) throw new Error(`表 ${table.id} 的记录 ${row.id} 含未知字段或非标量值`);
      for (const col of table.columns) {
        const value = row[col.name];
        if (value === null || value === undefined) {
          if (!col.nullable || col.isPrimaryKey) throw new Error(`演示记录 ${row.id} 缺少必填字段 ${table.tableName}.${col.name}`);
        } else if (!validColumnValue(col.dataType, value)) {
          throw new Error(`演示记录 ${row.id} 的 ${table.tableName}.${col.name} 与类型 ${col.dataType} 不一致`);
        }
      }
      rows.push(structuredClone(row as Row));
    }
    const keys = [['id'], table.columns.filter(c => c.isPrimaryKey).map(c => c.name),
      ...table.columns.filter(c => c.isUnique).map(c => [c.name]), ...resolveUniqueConstraints(table).map(k => k.columns.map(c => c.name))];
    const types = new Map(table.columns.map(c => [c.name, c.dataType]));
    for (const fields of keys.filter(k => k.length)) {
      const seen = new Set<string>();
      for (const row of rows) {
        if (fields.some(f => row[f] == null)) continue;
        const key = JSON.stringify(fields.map(f => uniqueValue(row[f], types.get(f))));
        if (seen.has(key)) throw new Error(`表 ${table.tableName} 的演示记录违反唯一约束 ${fields.join(', ')}`);
        seen.add(key);
      }
    }
    added[table.id] = rows;
  }
  const issues = previewRelationIssues(tables, {...existing,...added}).filter(issue => Object.hasOwn(added,issue.tableId));
  if (issues.length) {
    const issue = issues[0];
    throw new Error(`演示记录 ${issue.firstRowId} 的 ${issue.tableId}.${issue.field} 找不到唯一来源 ${issue.target}`);
  }
  return added;
}
