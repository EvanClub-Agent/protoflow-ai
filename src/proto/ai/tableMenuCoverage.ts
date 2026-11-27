import type { DBTableSchema } from '../../store/useProtoStore';
import type { ProjectStateSnapshot } from '../../utils/pflowBinaryCodec';
import { tr } from '../../i18n/runtime';
import { projectPageCatalog } from '../../services/projectAnalysis';
import { diagramRelations } from '../database/relations';
import { parsePageSource } from '../dsl/parser';
import { walk } from '../dsl/tree';
import { isActionChain, type ActionCall, type PropValue, type ProtoNode } from '../types';
import { extractPageActionSemantics } from './actionSemantics';

export type TableMenuCoverageIssueKind =
  | 'unbound_menu_table'
  | 'missing_detail_create'
  | 'sibling_missing_detail'
  | 'missing_crud_write';

export interface TableMenuCoverageIssue {
  kind: TableMenuCoverageIssueKind;
  blocking: boolean;
  pageId: string;
  pageTitle: string;
  tableId: string;
  tableName: string;
  cnName: string;
  accessMode?: string;
  message: string;
}

interface ParsedPageTableProfile {
  pageId: string;
  title: string;
  boundTables: Set<string>;
  /** Tables with row-creation capability (`Form`/`MForm` submitForm or `importSelectedRows`/`importPurchaseOrderLines` target). */
  creatableTables: Set<string>;
  /** Tables with any write capability (creation + `updateRow` + `deleteRow` + `Table` cell `editor`). */
  writableTables: Set<string>;
}

function inspectPageTableProfile(
  pageId: string,
  title: string,
  source: string,
  tables: DBTableSchema[],
): ParsedPageTableProfile | null {
  const parsed = parsePageSource(source);
  if (!parsed.doc || parsed.issues.some((i) => i.level === 'error')) return null;

  const root = parsed.doc.root;
  const boundTables = new Set<string>();
  const creatableTables = new Set<string>();
  const writableTables = new Set<string>();
  const nodesById = new Map<string, ProtoNode>();

  walk(root, (node) => {
    nodesById.set(node.pfId, node);
    if (typeof node.props.id === 'string' && node.props.id.trim()) {
      nodesById.set(node.props.id.trim(), node);
    }
    if (typeof node.props.table === 'string' && node.props.table.trim()) {
      const tid = node.props.table.trim();
      boundTables.add(tid);
      if (node.type === 'Table' && Array.isArray(node.props.columns)) {
        const hasInlineEditor = node.props.columns.some(
          (col) => col && typeof col === 'object' && !Array.isArray(col) && 'editor' in col && Boolean((col as Record<string, unknown>).editor),
        );
        if (hasInlineEditor) writableTables.add(tid);
      }
    }
    if (typeof node.props.activeTable === 'string' && node.props.activeTable.trim()) {
      boundTables.add(node.props.activeTable.trim());
    }
  });

  const sem = extractPageActionSemantics(root, tables);
  // Any Form / MForm bound to a table and referenced by submitForm (or present as an interactive form)
  const submittedFormIds = new Set<string>();
  const collectCalls = (val: PropValue, out: ActionCall[]) => {
    if (isActionChain(val)) out.push(...val.calls);
    else if (Array.isArray(val)) val.forEach((item) => collectCalls(item, out));
    else if (val && typeof val === 'object') Object.values(val).forEach((item) => collectCalls(item, out));
  };
  const allCalls: ActionCall[] = [];
  walk(root, (node) => {
    Object.values(node.props).forEach((v) => collectCalls(v, allCalls));
  });

  for (const call of allCalls) {
    if (call.name === 'submitForm' && typeof call.args[0] === 'string') {
      submittedFormIds.add(call.args[0]);
    }
    if (
      (call.name === 'importSelectedRows' || call.name === 'importPurchaseOrderLines') &&
      typeof call.args[1] === 'string'
    ) {
      const targetNode = nodesById.get(call.args[1]);
      if (targetNode?.type === 'Table' && typeof targetNode.props.table === 'string' && targetNode.props.table) {
        creatableTables.add(targetNode.props.table);
        writableTables.add(targetNode.props.table);
      }
    }
  }

  for (const [formId, formInfo] of sem.forms.entries()) {
    if (!formInfo.tableId) continue;
    if (submittedFormIds.has(formId)) {
      creatableTables.add(formInfo.tableId);
      writableTables.add(formInfo.tableId);
    }
  }

  for (const slot of sem.slots) {
    if (slot.role === 'cancel') continue;
    const mutatesRow = slot.calls.some((c) => c.name === 'updateRow' || c.name === 'deleteRow');
    if (mutatesRow) {
      for (const tid of slot.rowTableIds) {
        writableTables.add(tid);
      }
    }
  }

  return { pageId, title, boundTables, creatableTables, writableTables };
}

/**
 * Audits closed-loop alignment between declared `dbTables[].sharedByMenus` / `1:N` master-detail
 * relationships and the actual component/action bindings in saved page TSX sources.
 */
export function auditTableMenuCoverage(
  s: Pick<ProjectStateSnapshot, 'designerFolders' | 'designerPages' | 'sitemapOverrides' | 'sitemapBase' | 'pageSources' | 'dbTables'>,
  filterPageId?: string | null,
): TableMenuCoverageIssue[] {
  const catalog = projectPageCatalog(s).filter((p) => !p.deprecated && p.hasSource);
  const profiles = new Map<string, ParsedPageTableProfile>();
  for (const page of catalog) {
    const src = s.pageSources[page.pageId];
    if (!src) continue;
    const prof = inspectPageTableProfile(page.pageId, page.title, src, s.dbTables);
    if (prof) profiles.set(page.pageId, prof);
  }

  const relations = diagramRelations(s.dbTables).relations;
  // Map parentTableId -> 1:N child tables (non-nullable FK to parentTableId)
  const requiredChildrenByParent = new Map<string, DBTableSchema[]>();
  for (const edge of relations) {
    if (edge.fromTableId === edge.toTableId) continue;
    const childTable = s.dbTables.find((t) => t.id === edge.toTableId);
    const fkCol = childTable?.columns.find((c) => c.id === edge.toColumnId);
    if (!childTable || !fkCol || fkCol.nullable) continue;
    const list = requiredChildrenByParent.get(edge.fromTableId) ?? [];
    if (!list.some((t) => t.id === childTable.id)) list.push(childTable);
    requiredChildrenByParent.set(edge.fromTableId, list);
  }

  const issues: TableMenuCoverageIssue[] = [];
  const seenKeys = new Set<string>();
  const emit = (issue: TableMenuCoverageIssue) => {
    if (filterPageId && issue.pageId !== filterPageId) return;
    const key = `${issue.kind}:${issue.pageId}:${issue.tableId}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    issues.push(issue);
  };

  // 1. Check declared `sharedByMenus` against actual TSX bindings & CRUD capabilities
  for (const table of s.dbTables) {
    const childTablesReferencingThis = new Set(
      relations.filter((e) => e.fromTableId === table.id).map((e) => e.toTableId),
    );
    const nonNullParentIds = new Set(
      relations
        .filter((e) => {
          if (e.toTableId !== table.id || e.fromTableId === table.id) return false;
          const col = table.columns.find((c) => c.id === e.toColumnId);
          return Boolean(col && !col.nullable);
        })
        .map((e) => e.fromTableId),
    );

    for (const binding of table.sharedByMenus) {
      const prof = profiles.get(binding.pageId);
      if (!prof) continue;

      const isBoundDirectly = prof.boundTables.has(table.id);
      const isSatisfiedViaChildFk =
        binding.accessMode === 'FK 外键引用' &&
        [...prof.boundTables].some((bt) => childTablesReferencingThis.has(bt));

      if (!isBoundDirectly && !isSatisfiedViaChildFk) {
        const isFkOnly = binding.accessMode === 'FK 外键引用';
        emit({
          kind: 'unbound_menu_table',
          blocking: !isFkOnly,
          pageId: prof.pageId,
          pageTitle: prof.title,
          tableId: table.id,
          tableName: table.tableName,
          cnName: table.cnName,
          accessMode: binding.accessMode,
          message: tr(
            `页面「${prof.title}」(${prof.pageId}) 在表 ${table.id}(${table.cnName}) 的 sharedByMenus 中声明了「${binding.accessMode}」，但页面 TSX 未绑定该表`,
            `Page "${prof.title}" (${prof.pageId}) is declared in ${table.id}.sharedByMenus (${binding.accessMode}), but its TSX does not bind ${table.id}`,
          ),
        });
        continue;
      }

      if (binding.accessMode === 'CRUD 读写' && isBoundDirectly) {
        const parentCreatedOnPage = [...nonNullParentIds].find((pid) => prof.creatableTables.has(pid));
        if (parentCreatedOnPage && !prof.creatableTables.has(table.id)) {
          const parentTbl = s.dbTables.find((t) => t.id === parentCreatedOnPage);
          emit({
            kind: 'missing_detail_create',
            blocking: true,
            pageId: prof.pageId,
            pageTitle: prof.title,
            tableId: table.id,
            tableName: table.tableName,
            cnName: table.cnName,
            accessMode: binding.accessMode,
            message: tr(
              `主子单据页「${prof.title}」(${prof.pageId}) 支持新建主表 ${parentTbl?.cnName ?? parentCreatedOnPage}，且明细表 ${table.id}(${table.cnName}) 声明了 CRUD 读写，但页面缺少新增或批量勾选转入明细行的动作（Form submitForm 或 importSelectedRows）`,
              `Master-detail page "${prof.title}" (${prof.pageId}) creates header ${parentCreatedOnPage} and declares CRUD on detail ${table.id}, but has no detail row creation action (Form submitForm or importSelectedRows)`,
            ),
          });
        } else if (!prof.writableTables.has(table.id)) {
          emit({
            kind: 'missing_crud_write',
            blocking: false,
            pageId: prof.pageId,
            pageTitle: prof.title,
            tableId: table.id,
            tableName: table.tableName,
            cnName: table.cnName,
            accessMode: binding.accessMode,
            message: tr(
              `页面「${prof.title}」(${prof.pageId}) 对表 ${table.id}(${table.cnName}) 声明了 CRUD 读写，但仅包含只读展示组件，缺少 Form / importSelectedRows / updateRow / 行内编辑等写入能力`,
              `Page "${prof.title}" (${prof.pageId}) declares CRUD on ${table.id} (${table.cnName}) but only renders read-only views without any write capability`,
            ),
          });
        }
      }
    }
  }

  // 2. Sibling Master-Detail Parity Check:
  // When multiple pages create records in the same header table `P`, and at least one sibling page
  // also binds a 1:N detail line table `C` (`_item` / `_detail` / `_line` / `_slot` or declared CRUD child),
  // flag any sibling header-creation page that completely omits `C`.
  for (const [parentId, childTables] of requiredChildrenByParent.entries()) {
    const parentPagesCreating = [...profiles.values()].filter((p) => p.creatableTables.has(parentId));
    if (parentPagesCreating.length < 2) continue;

    for (const childTable of childTables) {
      const fkEdge = relations.find((e) => e.fromTableId === parentId && e.toTableId === childTable.id);
      const fkCol = fkEdge ? childTable.columns.find((c) => c.id === fkEdge.toColumnId) : undefined;
      const isCascadeOwned = fkCol?.foreignKeyOptions?.onDelete === 'CASCADE';
      const hasStandaloneCrudMenu = childTable.sharedByMenus.some(
        (m) => m.accessMode === 'CRUD 读写' && !parentPagesCreating.some((p) => p.pageId === m.pageId),
      );
      if (hasStandaloneCrudMenu && !isCascadeOwned) continue;
      const isDetailLineTable =
        isCascadeOwned ||
        /(?:_item|_items|_detail|_details|_line|_lines|_pkg|_slot|_entry)$/i.test(childTable.id) ||
        /(?:_item|_items|_detail|_details|_line|_lines|_pkg|_slot|_entry)$/i.test(childTable.tableName) ||
        /明细|子表|分项|物料行/.test(childTable.cnName);
      if (!isDetailLineTable) continue;

      const siblingsWithChild = parentPagesCreating.filter((p) => p.boundTables.has(childTable.id));
      if (siblingsWithChild.length === 0) continue;

      for (const pageProf of parentPagesCreating) {
        if (!pageProf.boundTables.has(childTable.id)) {
          const refSibling = siblingsWithChild[0];
          emit({
            kind: 'sibling_missing_detail',
            blocking: true,
            pageId: pageProf.pageId,
            pageTitle: pageProf.title,
            tableId: childTable.id,
            tableName: childTable.tableName,
            cnName: childTable.cnName,
            message: tr(
              `同族单据页「${pageProf.title}」(${pageProf.pageId}) 与「${refSibling.title}」(${refSibling.pageId}) 共用主表 ${parentId} 新建单据，但漏绑了 1:N 明细子表 ${childTable.id}(${childTable.cnName})`,
              `Sibling document page "${pageProf.title}" (${pageProf.pageId}) shares header creation on ${parentId} with "${refSibling.title}" (${refSibling.pageId}), but omits 1:N detail table ${childTable.id}`,
            ),
          });
        }
      }
    }
  }

  return issues;
}
