import type { DBTableSchema } from '../../store/useProtoStore';

export type DiagramRelation = {
  id: string;
  name: string;
  fromTableId: string;
  fromColumnName: string;
  toTableId: string;
  toColumnId: string;
  toColumnName: string;
  cardinality?: '1:N' | '1:1';
  onDelete?: 'RESTRICT' | 'CASCADE' | 'SET NULL';
};

// references uses the physical table name, not the store's table ID (same contract as AI imports).
export function diagramRelations(tables: DBTableSchema[], allProjectTables = tables) {
  const relations: DiagramRelation[] = [];
  const issues: string[] = [];
  for (const table of tables) for (const col of table.columns) {
    if (!col.references && !col.isForeignKey) continue;
    const ref = /^([\w]+)\(([\w]+)\)$/.exec(col.references ?? '');
    const candidates = ref ? allProjectTables.filter(t => t.tableName === ref[1]) : [];
    const target = candidates.length === 1 ? candidates[0] : undefined;
    if (!ref || !target || !target.columns.some(c => c.name === ref[2])) {
      issues.push(`${table.tableName}.${col.name}：外键引用 ${col.references || '未填写'} 无法解析`);
      continue;
    }
    relations.push({
      id: JSON.stringify([table.id, col.id]),
      name: col.foreignKeyOptions?.name ?? `fk_${table.tableName}_${col.name}`,
      fromTableId: target.id, fromColumnName: ref[2],
      toTableId: table.id, toColumnId: col.id, toColumnName: col.name,
      cardinality: col.foreignKeyOptions?.cardinality, onDelete: col.foreignKeyOptions?.onDelete,
    });
  }
  return { relations, issues };
}
