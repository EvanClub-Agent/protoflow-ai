import { findNode, replaceNode, walk } from '../dsl/tree';
import { printNodeSource, printPageSource } from '../dsl/printer';
import { isActionChain, isNode, type ProtoNode } from '../types';
import type { DBTableSchema } from '../../store/useProtoStore';
import type { SitemapLayout } from '../sitemap';
import { axureCatalog, axureScopePages, axureCopyId, type AxureScope } from './task';
import {
  importedDoc,
  optimizedDoc,
  optimizeAxureBlock,
  caption,
  analyzeStaticTableActions,
  areRowActionsEquivalent,
  assertNonInvertedFieldBinding,
  retargetOptimizedNavigations,
} from './optimization';

type MigrationSnapshot = SitemapLayout & { pageSources:Record<string,string>; dbTables:DBTableSchema[] };

const formControls = new Set(['Input','Textarea','Select','NumberInput','DatePicker','Checkbox','Radio','ListSelect','ListBox','CheckControl','RadioControl']);

function pageOverview(root:ProtoNode) {
  const widgets:Record<string,number> = {};
  const grids: {pfId:string; columns:number; rows:number; headers:string[]; hidden:boolean; inactiveState:boolean}[] = [];
  const otherGrids:typeof grids = [];
  const controls: {pfId:string;type:string;label?:string;placeholder?:string;hidden:boolean;inactiveState:boolean}[] = [];
  const links = new Set<string>();
  let gridCount = 0;
  function visit(node:ProtoNode, hidden:boolean, inactiveState:boolean) {
    const frame = node.props.layoutFrame;
    hidden ||= node.props.hidden === true || Boolean(frame && typeof frame === 'object' && 'hidden' in frame && frame.hidden === true);
    widgets[node.type] = (widgets[node.type] ?? 0) + 1;
    if (formControls.has(node.type) && controls.length<12) {
      const label = frame && typeof frame === 'object' && 'label' in frame ? frame.label : node.props.label;
      controls.push({pfId:node.pfId,type:node.type,hidden,inactiveState,
        ...(typeof label === 'string' && {label:label.slice(0,100)}),
        ...(typeof node.props.placeholder === 'string' && {placeholder:node.props.placeholder.slice(0,100)})});
    }
    const click = node.props.onClick;
    if (isActionChain(click)) for (const action of click.calls)
      if (action.name === 'navigate' && typeof action.args[0] === 'string') links.add(action.args[0]);
    const children = node.children.filter(isNode);
    if (node.type === 'StaticTable' && Array.isArray(node.props.columnWidths) && Array.isArray(node.props.rowHeights)) {
      gridCount++;
      const preview = hidden || inactiveState ? otherGrids : grids;
      if (preview.length < 4) {
        const columns = node.props.columnWidths.length;
        preview.push({pfId:node.pfId, rows:node.props.rowHeights.length, columns, hidden, inactiveState,
          headers:children.slice(0,Math.min(24,columns)).map(cell=>caption(cell).slice(0,100))});
      }
    }
    children.forEach((child,index) => visit(child,hidden,inactiveState || (node.type === 'DynamicPanel' && index+1 !== (node.props.activeState ?? 1))));
  }
  visit(root,false,false);
  return { widgets, controls, gridCount, grids:[...grids,...otherGrids].slice(0,4), linkedPageCount:links.size, linkedPageIds:[...links].slice(0,24) };
}

/** Bounded cross-page overview. Only parse pages in the requested window. Full
 * headers, omitted grids and state contents remain accessible by inspecting a page. */
export function inspectAxureProject(snapshot:MigrationSnapshot, scope:AxureScope, offset=0, limit=4) {
  if (!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(limit) || limit<1 || limit>8)
    throw new Error('页面分页需要非负整数 offset 和 1 到 8 的 limit');
  const pages = axureScopePages(axureCatalog(snapshot),scope);
  const records = pages.slice(offset,offset+limit).map(page => {
    const {pageId,title,path} = page;
    const doc = importedDoc(pageId,snapshot.pageSources[pageId]);
    const copyId = axureCopyId(pageId);
    const hasCopy = Object.hasOwn(snapshot.pageSources,copyId);
    let optimizedPageId: string | undefined;
    let copyLayout: 'positioned' | 'flow' | undefined;
    let bindings: {pfId:string; material:string; tableId:string}[] | undefined;
    let boundCount = 0;
    if (hasCopy) {
      const copy = optimizedDoc(copyId,snapshot.pageSources[copyId]);
      const guid = pageId.slice('rp-page-'.length);
      copyLayout = copy.root.children.some(c => isNode(c) && c.type === 'AxureCanvas' && c.pfId === 'rp-canvas-' + guid) ? 'positioned' : 'flow';
      optimizedPageId = copyId;
      const observed: NonNullable<typeof bindings> = [];
      walk(copy.root, node => {
        if (typeof node.props.table !== 'string') return;
        boundCount++;
        if (observed.length < 16) observed.push({pfId:node.pfId,material:node.type,tableId:node.props.table});
      });
      bindings = observed;
    }
    return {pageId,title,path,optimizedPageId,...(copyLayout && {copyLayout}),bindings,boundCount,importNotes:doc.root.props.description,...pageOverview(doc.root)};
  });
  return {scope,totalPages:pages.length,offset,nextOffset:offset+records.length<pages.length?offset+records.length:null,records};
}

export type RpColumnMapping =
  | {headerPfId:string; role:'field'; columnId:string}
  | {headerPfId:string; role:'index'|'checkbox'|'radio'|'actions'};

/** Only a model or a user supplies the business meaning. Resolve identifiers
 * under the exact grid/table and keep Axure's order, labels and column widths. */
export function bindAxureTable(snapshot:MigrationSnapshot, pageId:string, targetPfId:string, tableId:string, mappings:RpColumnMapping[]) {
  if (!Object.hasOwn(snapshot.pageSources,pageId)) throw new Error('RP 来源页不存在');
  const grid = findNode(importedDoc(pageId,snapshot.pageSources[pageId]).root,targetPfId);
  if (grid?.type !== 'StaticTable' || !Array.isArray(grid.props.columnWidths)) throw new Error('目标必须是所选源页面中的静态表格');
  const db = snapshot.dbTables.find(t=>t.id === tableId);
  if (!db) throw new Error('数据库目录中没有该 tableId');
  const widths = grid.props.columnWidths;
  const headers = grid.children.filter(isNode).slice(0,widths.length);
  if (!Array.isArray(mappings) || !headers.length || headers.length !== widths.length || mappings.length !== headers.length)
    throw new Error('需要逐一指定全部第一行单元格的用途；请先核对原型的表头行');
  const byCell = new Map(mappings.map(m=>[m?.headerPfId,m]));
  const actionByHeader = new Map(analyzeStaticTableActions(grid).map(a => [a.headerPfId, a]));
  const allHeaderTexts = headers.map(h => caption(h).trim()).filter(Boolean);
  const fields = new Set<string>();
  const columns: ProtoNode['props'][] = [];
  const migratedCellPfIds = new Set<string>();
  let showIndex = false, selection: 'radio'|'checkbox'|undefined, hasActionsCol = false;
  let migratedRowActions: ProtoNode['props'][] | undefined;
  headers.forEach((header,i) => {
    const m = byCell.get(header.pfId);
    if (!m || header.type !== 'StaticTableCell') throw new Error('表头映射遗漏、重复或引用了其他表格的单元格');
    if (m.role === 'field') {
      const column = db.columns.find(c=>c.id === m.columnId);
      if (!column || fields.has(column.id)) throw new Error('字段必须使用目标表中唯一的 columnId，请核对重复或未知字段');
      const title = caption(header);
      if (!title.trim()) throw new Error('业务列表头没有可核对的文字，请确认用途');
      assertNonInvertedFieldBinding(db, column, title, '原表头', allHeaderTexts);
      fields.add(column.id);
      const width = widths[i];
      columns.push({title,dataIndex:column.name,...(typeof width === 'number' && width>0 ? {width} : {})});
    } else if (m.role === 'index' && !showIndex && !('columnId' in m)) showIndex = true;
    else if ((m.role === 'checkbox' || m.role === 'radio') && !selection && !('columnId' in m)) selection = m.role;
    else if (m.role === 'actions' && !hasActionsCol && !('columnId' in m)) {
      hasActionsCol = true;
      const colAction = actionByHeader.get(header.pfId);
      if (!colAction || colAction.requiresConfirmation || !colAction.consistentAcrossDataRows || colAction.variants.length !== 1) {
        throw new Error(`操作列「${caption(header) || header.pfId}」缺少逐行一致的已导入点击动作（或含仅部分样例行出现的动作），不能直接推广为全表 rowActions；请改用 protoflow_reshape_axure_page 转换确定内容并将待确认动作列入 coverage.pending`);
      }
      const v = colAction.variants[0];
      colAction.cellPfIds.forEach(cid => migratedCellPfIds.add(cid));
      const calls = v.onClick.map(c =>
        c.name === 'navigate' && c.args.length === 1 && typeof c.args[0] === 'string'
          ? { name: 'navigate', args: [c.args[0], 'row'] }
          : c,
      );
      migratedRowActions = [{ label: v.label || '查看', onClick: { $kind: 'actions', calls } }];
    }
    else throw new Error('序号、选行和操作列各允许一列，界面列不能绑定数据库字段');
  });
  if (!columns.length) throw new Error('未指定任何业务字段，请保留原型表格');
  const material: ProtoNode = {kind:'node',type:'Table',pfId:targetPfId,children:[],
    props:{table:tableId,columns,showIndex,selectable:Boolean(selection),layoutFrame:{literalContent:true},...(selection && {selectionType:selection}),...(migratedRowActions && {rowActions:migratedRowActions})}};
  const copyId = axureCopyId(pageId);
  if (Object.hasOwn(snapshot.pageSources,copyId)) {
    const source = snapshot.pageSources[copyId];
    const copy = optimizedDoc(copyId,source);
    const current = findNode(copy.root,targetPfId);
    if (current?.type === 'Table') {
      const sameTable = current.props.table === tableId;
      const oldColumns = new Map<string,ProtoNode['props']>();
      if (!Array.isArray(current.props.columns)) throw new Error('优化版缺少显式列配置，请先核对需要重新绑定的列');
      for (const c of current.props.columns) {
        if (!c || typeof c !== 'object' || !('dataIndex' in c) || typeof c.dataIndex !== 'string' || oldColumns.has(c.dataIndex))
          throw new Error('优化版已有无法逐列核对的字段配置');
        oldColumns.set(c.dataIndex,c);
      }
      const sameFields = current.props.columns.length === columns.length &&
        [...oldColumns.keys()].every((name,i) => name === columns[i].dataIndex);

      // Determine whether rowActions changed or require protection on second-pass re-binding.
      const sourceAutoActionCandidates: ProtoNode['props'][][] = [];
      for (const colAct of actionByHeader.values()) {
        if (!colAct.requiresConfirmation && colAct.consistentAcrossDataRows && colAct.variants.length === 1) {
          const v = colAct.variants[0];
          const calls = v.onClick.map(c =>
            c.name === 'navigate' && c.args.length === 1 && typeof c.args[0] === 'string'
              ? { name: 'navigate', args: [c.args[0], 'row'] }
              : c,
          );
          sourceAutoActionCandidates.push([{ label: v.label || '查看', onClick: { $kind: 'actions', calls } }]);
        }
      }
      const currentHadAutoMigratedRowActions =
        current.props.rowActions !== undefined &&
        sourceAutoActionCandidates.some(cand => areRowActionsEquivalent(current.props.rowActions, cand, snapshot.pageSources, copyId));

      let sameRowActions: boolean;
      if (migratedRowActions !== undefined) {
        sameRowActions = areRowActionsEquivalent(current.props.rowActions, migratedRowActions, snapshot.pageSources, copyId);
        if (sameTable && current.props.rowActions !== undefined && !sameRowActions && !currentHadAutoMigratedRowActions) {
          throw new Error('优化版已有自定义 rowActions 配置，请先核对行操作后再覆盖');
        }
      } else {
        // If previous rowActions came from an auto-migrated RP action column that is no longer mapped as 'actions', update to remove it; otherwise preserve custom rowActions.
        sameRowActions = !currentHadAutoMigratedRowActions;
      }

      if (sameTable && sameFields && sameRowActions && (current.props.showIndex !== false) === showIndex &&
          Boolean(current.props.selectable) === Boolean(selection) && (!selection || (current.props.selectionType ?? 'checkbox') === selection))
        return {pageId:copyId, unchanged:true as const};
      const sourceTitles = new Set(headers.map(caption));
      if (!sameTable && ['filter','sourceForeignKey','treeKeyField','parentField','detailFields','cellMerges','rowActions'].some(key => current.props[key] !== undefined))
        throw new Error('优化版含有依赖旧表的配置，请先核对过滤、行操作和关联字段再换表');
      for (const [field,old] of oldColumns) {
        if (sameTable && columns.some(c => c.dataIndex === field)) continue;
        const originalPresentation = headers.some((h,i) => caption(h) === old.title &&
          old.width === (typeof widths[i] === 'number' && widths[i] > 0 ? widths[i] : undefined));
        if (!originalPresentation || Object.keys(old).some(k => !['dataIndex','title','width'].includes(k)))
          throw new Error(`优化版字段 ${field} 有自定义列配置，请先核对后再移除或更换绑定`);
      }
      const nextColumns = columns.map(column => {
        const old = sameTable && typeof column.dataIndex === 'string' ? oldColumns.get(column.dataIndex) : undefined;
        if (!old) return column;
        // Keep hand-edited presentation on the same physical field. If an
        // original header was remapped, display the newly assigned RP caption.
        const title = typeof old.title === 'string' && sourceTitles.has(old.title) ? column.title : old.title;
        return {...old,title};
      });
      const {selectionType:_previousSelection,rowActions:previousRowActions,...props} = current.props;
      const nextRowActions =
        migratedRowActions !== undefined
          ? migratedRowActions
          : currentHadAutoMigratedRowActions
            ? undefined
            : previousRowActions;
      const next = {...current,props:{...props,table:tableId,columns:nextColumns,showIndex,selectable:Boolean(selection),
        ...(selection && {selectionType:selection}),
        ...(nextRowActions !== undefined && {rowActions:nextRowActions})}};
      const page = snapshot.designerPages.find(p => p.pageId === copyId);
      if (!page) throw new Error('优化版缺少页面目录记录');
      const updatedDoc = replaceNode(copy,targetPfId,next);
      retargetOptimizedNavigations(updatedDoc, snapshot.pageSources, copyId);
      return {pageId:copyId,title:page.title,folderId:page.folderId,source:printPageSource(updatedDoc)};
    } else if (current?.type !== 'StaticTable' || JSON.stringify(current.children) !== JSON.stringify(grid.children) ||
        JSON.stringify(current.props.columnWidths) !== JSON.stringify(widths)) {
      throw new Error('该区块在优化版中已有修改，请先核对工作副本');
    }
  }
  return optimizeAxureBlock(snapshot,pageId,targetPfId,printNodeSource(material),false,migratedCellPfIds);
}
