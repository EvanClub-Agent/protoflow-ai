import { parsePageSource } from '../dsl/parser';
import { findNode, walk } from '../dsl/tree';
import { COMPONENT_MAP } from '../registry/meta';
import type { DBTableSchema } from '../../store/useProtoStore';
import { isNode, type ProtoNode } from '../types';
import { caption, type RpReshapeCoverage } from './optimization';
import { verifiedAxureSourceId } from './task';

/** Describe the final validated candidate. A direct TSX edit can author a new
 * display title, so describe it as an original header only on an exact match. */
export function axureBindingChanges(pageId:string, before:string|undefined, after:string, sources:Record<string,string>, tables:DBTableSchema[]) {
  const guid = /^rp-optimized-([0-9a-f]{32})$/.exec(pageId)?.[1];
  if (!guid) return [];
  const sourceId = 'rp-page-' + guid;
  if (!Object.hasOwn(sources,sourceId)) return [];
  const doc = parsePageSource(after).doc;
  if (verifiedAxureSourceId(pageId, doc?.header) !== sourceId || !doc) return [];
  const source = parsePageSource(sources[sourceId]).doc;
  if (!source) return [];
  const originals = new Map<string,ProtoNode>();
  walk(source.root,node => { if (node.type === 'StaticTable') originals.set(node.pfId,node); });
  const oldBindings = new Map<string,string>();
  const signature = (node:ProtoNode) => JSON.stringify([node.props.table,node.props.columns,node.props.showIndex,node.props.selectable,node.props.selectionType,node.props.rowActions]);
  const baseline = before && parsePageSource(before).doc;
  if (baseline) walk(baseline.root,node => { if (node.type === 'Table') oldBindings.set(node.pfId,signature(node)); });
  const changes:string[] = [];
  walk(doc.root,node => {
    const grid = originals.get(node.pfId);
    if (node.type !== 'Table' || !grid || oldBindings.get(node.pfId) === signature(node)) return;
    const db = tables.find(t=>t.id === node.props.table);
    if (!db || !Array.isArray(node.props.columns) || !Array.isArray(grid.props.columnWidths)) return;
    const headers = new Set(grid.children.filter(isNode).slice(0,grid.props.columnWidths.length).map(caption));
    const fields:string[] = [];
    for (const column of node.props.columns) {
      if (!column || typeof column !== 'object' || !('dataIndex' in column) || !('title' in column) || typeof column.title !== 'string') continue;
      const field = db.columns.find(c=>c.name === column.dataIndex);
      if (field) fields.push(`${headers.has(column.title) ? '原表头' : '物料列'}「${column.title}」 → ${db.tableName}.${field.name}`);
    }
    if (node.props.showIndex !== false) fields.push('序号列由物料显示');
    if (node.props.selectable === true) fields.push('选行由物料处理');
    if (Array.isArray(node.props.rowActions) && node.props.rowActions.length) {
      const actionLabels = node.props.rowActions
        .map(a => (a && typeof a === 'object' && 'label' in a && typeof a.label === 'string' ? a.label : ''))
        .filter(Boolean);
      if (actionLabels.length) fields.push(`行操作：${actionLabels.join('、')}`);
    }
    changes.push(`「${source.root.props.title}」的表格（${sourceId} / ${grid.pfId}）绑定「${db.cnName}」。${fields.join('；')}`);
  });
  return changes;
}

export function axureReshapeReviewItems(
  pageId: string,
  after: string,
  sources: Record<string, string>,
  tables: DBTableSchema[],
  coverage: unknown,
): string[] {
  const guid = /^rp-optimized-([0-9a-f]{32})$/.exec(pageId)?.[1];
  if (!guid || !coverage || typeof coverage !== 'object' || Array.isArray(coverage)) return [];
  const sourceId = 'rp-page-' + guid;
  if (!Object.hasOwn(sources, sourceId)) return [];
  const doc = parsePageSource(after).doc;
  if (verifiedAxureSourceId(pageId, doc?.header) !== sourceId || !doc) return [];
  const srcDoc = parsePageSource(sources[sourceId]).doc;
  if (!srcDoc) return [];

  const sourceTitle = String(srcDoc.root.props.title ?? sourceId);
  const cov = coverage as Partial<RpReshapeCoverage>;
  const items: string[] = [];

  const origTables = new Map<string, ProtoNode>();
  walk(srcDoc.root, n => {
    if (n.type === 'StaticTable') origTables.set(n.pfId, n);
  });

  if (Array.isArray(cov.converted)) {
    for (const entry of cov.converted) {
      if (!entry || typeof entry !== 'object') continue;
      const target = typeof entry.targetPfId === 'string' ? findNode(doc.root, entry.targetPfId) : undefined;
      if (!target) continue;
      const compTitle = COMPONENT_MAP[target.type]?.title ?? target.type;
      if (target.type === 'QueryForm') {
        const fieldNames = Array.isArray(target.props.fields)
          ? target.props.fields
              .map(f => (f && typeof f === 'object' && !Array.isArray(f) ? String((f as { label?: unknown; name?: unknown }).label ?? (f as { name?: unknown }).name ?? '') : ''))
              .filter(Boolean)
          : [];
        const targetRef = typeof target.props.target === 'string' && target.props.target ? ` → 筛选表格 ${target.props.target}` : '';
        items.push(
          `已转换 ·「${sourceTitle}」${compTitle}（${target.pfId}）：${entry.summary}${fieldNames.length ? `（条件：${fieldNames.join('、')}${targetRef}）` : targetRef}`,
        );
      } else if (target.type === 'Table') {
        const db = tables.find(t => t.id === target.props.table);
        const origGridId = Array.isArray(entry.sourcePfIds) ? entry.sourcePfIds.find(id => origTables.has(id)) : undefined;
        const origGrid = origGridId ? origTables.get(origGridId) : undefined;
        const origHeaders =
          origGrid && Array.isArray(origGrid.props.columnWidths)
            ? new Set(origGrid.children.filter(isNode).slice(0, origGrid.props.columnWidths.length).map(caption))
            : new Set<string>();
        const colMappings: string[] = [];
        if (db && Array.isArray(target.props.columns)) {
          for (const column of target.props.columns) {
            if (!column || typeof column !== 'object' || !('dataIndex' in column) || !('title' in column) || typeof column.title !== 'string') continue;
            const field = db.columns.find(c => c.name === column.dataIndex);
            if (field) colMappings.push(`${origHeaders.has(column.title) ? '原表头' : '物料列'}「${column.title}」 → ${db.tableName}.${field.name}`);
          }
        }
        const actionLabels = Array.isArray(target.props.rowActions)
          ? target.props.rowActions
              .map(a => (a && typeof a === 'object' && 'label' in a && typeof a.label === 'string' ? a.label : ''))
              .filter(Boolean)
          : [];
        const extras = [
          ...(db ? [`绑定「${db.cnName}」`] : []),
          ...colMappings,
          ...(actionLabels.length ? [`行操作：${actionLabels.join('、')}`] : []),
        ].join('；');
        items.push(`已转换 ·「${sourceTitle}」${compTitle}（${target.pfId}）：${entry.summary}${extras ? `。${extras}` : ''}`);
      } else {
        items.push(`已转换 ·「${sourceTitle}」${compTitle}（${target.pfId}）：${entry.summary}`);
      }
    }
  }

  if (Array.isArray(cov.retained) && cov.retained.length > 0) {
    for (const r of cov.retained) {
      if (!r || typeof r !== 'object') continue;
      const ids = Array.isArray(r.sourcePfIds) ? r.sourcePfIds.join('、') : '';
      items.push(`保留区块 ·「${sourceTitle}」${ids ? `（${ids}）` : ''}：${r.summary}`);
    }
  } else {
    items.push(`保留区块 ·「${sourceTitle}」：无原样保留的 RP 定位控件`);
  }

  if (Array.isArray(cov.pending) && cov.pending.length > 0) {
    for (const p of cov.pending) {
      if (!p || typeof p !== 'object') continue;
      const ids = Array.isArray(p.sourcePfIds) && p.sourcePfIds.length ? `（${p.sourcePfIds.join('、')}）` : '';
      items.push(`待确认 ·「${sourceTitle}」${ids}：${p.reason}`);
    }
  } else {
    items.push(`待确认 ·「${sourceTitle}」：无待确认区块`);
  }

  return items;
}
