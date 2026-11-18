import type { DiagramRelation } from '../proto/database/relations';
export { diagramRelations, type DiagramRelation } from '../proto/database/relations';
import type { DBColumnSchema, DBTableSchema } from '../store/useProtoStore';

export type Point = { x: number; y: number };
export type TableViewLevel = 'all' | 'keys_only' | 'header_only';
export const CARD_WIDTH = 316;
export const HEADER_HEIGHT = 76;
export const ROW_HEIGHT = 26;
export const FOOTER_HEIGHT = 28;
export function visibleColumns(table: DBTableSchema, level: TableViewLevel, relations: DiagramRelation[]): DBColumnSchema[] {
  if (level === 'header_only') return [];
  if (level === 'all') return table.columns;
  return table.columns.filter(c => c.isPrimaryKey || c.isForeignKey || c.references ||
    relations.some(r => r.fromTableId === table.id && r.fromColumnName === c.name));
}

export function cardHeight(table: DBTableSchema, level: TableViewLevel, relations: DiagramRelation[]) {
  return HEADER_HEIGHT + visibleColumns(table, level, relations).length * ROW_HEIGHT + FOOTER_HEIGHT + 2;
}

export function layoutTables(tables: DBTableSchema[], level: TableViewLevel, relations: DiagramRelation[]) {
  const positions: Record<string, Point> = {};
  const domains = [...new Set(tables.map(t => t.domain))];
  let y = 72;
  for (const domain of domains) {
    const members = tables.filter(t => t.domain === domain);
    for (let i = 0; i < members.length; i += 3) {
      const row = members.slice(i, i + 3);
      row.forEach((table, col) => { positions[table.id] = { x: 48 + col * (CARD_WIDTH + 104), y }; });
      y += Math.max(...row.map(t => cardHeight(t, level, relations))) + 64;
    }
    y += 32;
  }
  return positions;
}

// Keep explicitly dragged cards in place; additions and growing cards need free space.
export function resolvePositions(tables: DBTableSchema[], level: TableViewLevel, relations: DiagramRelation[], automatic: Record<string, Point>, manual: Record<string, Point>) {
  const positions: Record<string, Point> = {};
  const placed: { x: number; y: number; height: number }[] = [];
  for (const table of [...tables.filter(t => manual[t.id]), ...tables.filter(t => !manual[t.id])]) {
    let point = manual[table.id] ?? automatic[table.id];
    const height = cardHeight(table, level, relations);
    if (!manual[table.id]) {
      let collision;
      while ((collision = placed.find(p => point.x < p.x + CARD_WIDTH + 40 && point.x + CARD_WIDTH + 40 > p.x && point.y < p.y + p.height + 40 && point.y + height + 40 > p.y))) {
        point = { x: point.x, y: collision.y + collision.height + 64 };
      }
    }
    positions[table.id] = point;
    placed.push({ ...point, height });
  }
  return positions;
}

export function domainBounds(tables: DBTableSchema[], positions: Record<string, Point>, level: TableViewLevel, relations: DiagramRelation[]) {
  return [...new Set(tables.map(t => t.domain))].map(domain => {
    const members = tables.filter(t => t.domain === domain);
    const x = Math.min(...members.map(t => positions[t.id].x)) - 24;
    const y = Math.min(...members.map(t => positions[t.id].y)) - 40;
    const right = Math.max(...members.map(t => positions[t.id].x + CARD_WIDTH)) + 24;
    const bottom = Math.max(...members.map(t => positions[t.id].y + cardHeight(t, level, relations))) + 24;
    return { domain, count: members.length, x, y, width: right - x, height: bottom - y };
  });
}

export function columnAnchor(table: DBTableSchema, columnName: string, side: 'left' | 'right', position: Point, level: TableViewLevel, relations: DiagramRelation[]): Point | null {
  if (!table.columns.some(c => c.name === columnName)) return null;
  const index = visibleColumns(table, level, relations).findIndex(c => c.name === columnName);
  return {
    x: position.x + (side === 'right' ? CARD_WIDTH : 0),
    y: position.y + (index < 0 ? HEADER_HEIGHT / 2 : 1 + HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2),
  };
}
