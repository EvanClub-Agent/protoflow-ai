import type { DBTableSchema } from '../../store/useProtoStore';

export type UniqueConstraint = { name: string; columnIds: string[] };
type ConstraintTable = Pick<DBTableSchema, 'tableName' | 'columns' | 'uniqueConstraints'>;

/** Resolve only stable column IDs, including when reading an untrusted archive.
 * Keep declared order for the index, but compare unordered sets for redundancy. */
export function resolveUniqueConstraints(table: ConstraintTable) {
  const constraints = table.uniqueConstraints;
  if (constraints === undefined) return []; // Older projects have no table-level declarations.
  if (!Array.isArray(constraints)) throw new Error(`${table.tableName}.uniqueConstraints 必须是数组`);
  if (constraints.length === 0) return [];
  const byId = new Map(table.columns.map(c => [c.id, c]));
  if (byId.size !== table.columns.length) throw new Error(`${table.tableName} 包含重复的字段 ID`);
  const names = new Set(['primary', ...table.columns.filter(c => c.isUnique).map(c => c.name.toLowerCase())]);
  const signature = (ids: string[]) => JSON.stringify([...ids].sort());
  const keys = new Set(table.columns.filter(c => c.isUnique).map(c => signature([c.id])));
  keys.add(signature(table.columns.filter(c => c.isPrimaryKey).map(c => c.id)));
  return constraints.map((key, index) => {
    const path = `${table.tableName}.uniqueConstraints[${index}]`;
    if (!key || typeof key.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(key.name))
      throw new Error(`${path} 的约束名须为 1 至 63 位字母、数字或下划线，不能以数字开头`);
    if (names.has(key.name.toLowerCase())) throw new Error(`${path} 的约束名 ${key.name} 重复或已保留`);
    names.add(key.name.toLowerCase());
    if (!Array.isArray(key.columnIds) || !key.columnIds.length || key.columnIds.length > 16)
      throw new Error(`${path}.columnIds 必须包含 1 至 16 个本表字段 ID`);
    const columns = key.columnIds.map(id => {
      const column = byId.get(id);
      if (!column) throw new Error(`${path} 引用了未知的本表字段 ID ${String(id)}`);
      return column;
    });
    if (new Set(key.columnIds).size !== columns.length) throw new Error(`${path} 包含重复字段`);
    const set = signature(key.columnIds);
    if (keys.has(set)) throw new Error(`${path} 与已有主键或唯一约束的字段组合重复`);
    keys.add(set);
    return {name: key.name, columns};
  });
}

export function sqlIdentifier(name: string, dialect: 'mysql' | 'postgres') {
  const quote = dialect === 'mysql' ? '`' : '"';
  return quote + name.split(quote).join(quote + quote) + quote;
}

export function uniqueConstraintSql(table: ConstraintTable, dialect: 'mysql' | 'postgres') {
  const quote = (name: string) => sqlIdentifier(name, dialect);
  return resolveUniqueConstraints(table).map(key =>
    `  CONSTRAINT ${quote(key.name)} UNIQUE (${key.columns.map(c => quote(c.name)).join(', ')})`);
}
