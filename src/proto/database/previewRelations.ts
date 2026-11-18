import type { DBTableSchema } from '../../store/useProtoStore';
import type { Row } from '../runtime/mock';
import { diagramRelations } from './relations';

type Data = Record<string, Row[]>;
type Value = string | number | boolean;
function key(value: unknown): value is Value {
  return (typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean';
}
function uniqueValues(rows: Row[], field: string) {
  const values = new Map<Value, number>();
  for (const row of rows) if (key(row[field])) {
    const value = row[field] as Value;
    values.set(value, (values.get(value) ?? 0) + 1);
  }
  return values;
}

/** Seed a connected set of missing tables. Saved rows (including []) are authoritative.
 * Allocate row identities first so even two tables referencing each other's PKs can link. */
export function seedRelatedTables(tables: DBTableSchema[], requested: string[], saved: Data, seed: (table: DBTableSchema) => Row[], fixed: Data = {}): Data {
  const byId = new Map(tables.map(t => [t.id,t]));
  const relations = diagramRelations(tables).relations;
  const added: Data = Object.create(null);
  const seeds: Data = Object.create(null);
  function allocate(id: string) {
    if (Object.hasOwn(saved,id) || Object.hasOwn(added,id)) return;
    const t = byId.get(id);
    if (!t) return;
    if (Object.hasOwn(fixed,id)) { added[id] = fixed[id]; return; }
    // Shared primary-key foreign keys require authored row identities.
    added[id] = t.columns.some(c => c.name === 'id' && (c.isForeignKey || c.references)) ? [] : seed(t);
    // Row.id is the runtime identity. A separately named physical primary key
    // gets its own typed example value only for supported scalar key types.
    for (const column of t.columns.filter(c => c.isPrimaryKey && c.name !== 'id' && !c.references && !c.isForeignKey)) {
      added[id].forEach((row, i) => {
        if (Object.hasOwn(row, column.name)) return;
        if (/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)\b/i.test(column.dataType)) row[column.name] = i + 1;
        else if (/^(?:VAR)?CHAR\b|^TEXT\b/i.test(column.dataType)) row[column.name] = `demo-${i + 1}`;
      });
    }
    seeds[id] = added[id];
    // Never seed a heuristic value into an unresolved or cyclic key.
    for (const col of t.columns.filter(c => c.isForeignKey || c.references)) {
      for (const row of added[id]) delete row[col.name];
    }
  }
  // Build the related scenario together, before an editor inserts a new real draft.
  // Otherwise lazily opening its detail table could fabricate children for that draft.
  const connected = new Set(requested);
  const neighbors = new Map<string, Set<string>>();
  function connect(left: string, right: string) {
    const items = neighbors.get(left) ?? new Set<string>();
    items.add(right); neighbors.set(left, items);
  }
  for (const edge of relations) {
    connect(edge.fromTableId, edge.toTableId);
    connect(edge.toTableId, edge.fromTableId);
  }
  for (const id of connected) for (const other of neighbors.get(id) ?? []) connected.add(other);
  connected.forEach(allocate);
  const data = { ...added, ...saved };
  // A referenced UNIQUE field can itself be a foreign key. Propagate keys
  // through those chains before removing rows missing a required source.
  for (let pass = 0; pass <= relations.length; pass++) {
    let changed = false;
    for (const edge of relations) {
      const rows = seeds[edge.toTableId];
      if (!rows?.length) continue;
      const values = [...uniqueValues(data[edge.fromTableId], edge.fromColumnName)].filter(([,n]) => n === 1).map(([v]) => v);
      if (!values.length) continue;
      rows.forEach((row,i) => {
        const value = values[i % values.length];
        if (row[edge.toColumnName] !== value) { row[edge.toColumnName] = value; changed = true; }
      });
    }
    if (!changed) break;
  }
  // Removing a row with a missing required parent can invalidate its descendants.
  let changed: boolean;
  do {
    changed = false;
    for (const id of Object.keys(seeds)) {
      const t = byId.get(id)!;
      for (const col of t.columns.filter(c => c.isForeignKey || c.references)) {
        const edge = relations.find(r => r.toTableId === id && r.toColumnId === col.id);
        const targets = edge && uniqueValues(data[edge.fromTableId], edge.fromColumnName);
        const kept = data[id].filter(row => {
          if (targets?.get(row[col.name] as Value) === 1) return true;
          if (!col.nullable) return false;
          if (row[col.name] !== null) { row[col.name] = null; changed = true; }
          return true;
        });
        if (kept.length < data[id].length) { added[id] = data[id] = kept; changed = true; }
      }
    }
  } while (changed);
  return added;
}

export function previewRelationIssues(tables: DBTableSchema[], rows: Data) {
  const issues: { tableId: string; field: string; target: string; count: number; firstRowId: string }[] = [];
  const graph = diagramRelations(tables);
  for (const edge of graph.relations) {
    const from = rows[edge.toTableId];
    if (!from?.length) continue;
    const col = tables.find(t => t.id === edge.toTableId)!.columns.find(c => c.id === edge.toColumnId)!;
    const values = uniqueValues(rows[edge.fromTableId] ?? [], edge.fromColumnName);
    const broken = from.filter(row => {
      const value = row[edge.toColumnName];
      if (value === null || value === undefined) return !col.nullable;
      return !key(value) || values.get(value) !== 1;
    });
    if (broken.length) issues.push({tableId:edge.toTableId,field:col.name,target:col.references!,count:broken.length,firstRowId:broken[0].id});
  }
  return issues;
}
