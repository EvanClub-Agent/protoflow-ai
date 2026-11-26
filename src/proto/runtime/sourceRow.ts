import { useContext, useEffect, useMemo, useRef } from 'react';
import { useProtoStore, type DBTableSchema } from '../../store/useProtoStore';
import { resolveForeignKeySourceTableId } from '../table/model';
import { usePageStore } from '../store/usePageStore';
import { PreviewDataContext } from './PreviewData';
import { useOptionalRuntime, type Runtime, type Scope } from './runtime';
import type { Row } from './mock';

/** Overlay row scope takes precedence over page activeRow and page navigation.
 * A mismatched explicit scope or navigation from an unrelated table must never
 * leak into a table-constrained consumer (`preferredTableId`). */
export function useSourceRow(scope: Scope, pageId: string, enabled: boolean, preferredTableId?: string, collectionTableId?: string) {
  const preview = useContext(PreviewDataContext);
  const rt = useOptionalRuntime();
  // Runtime overlay params have always reserved row/tableId. Some embedding
  // surfaces pass that pair without also mirroring it onto Scope's top level.
  const direct = scope.row !== undefined;
  const paramRow = scope.params?.row;
  const hasParams = paramRow !== undefined;
  const allowPageRow = enabled && !scope.isolatePageRow && !direct && !hasParams;
  const activeEntry = (() => {
    if (!allowPageRow || !rt?.activeRows) return null;
    if (preferredTableId) {
      const selections = preferredTableId === collectionTableId ? rt.activeParentRows : rt.activeRows;
      return Object.hasOwn(selections, preferredTableId)
        ? { tableId: preferredTableId, rowId: selections[preferredTableId] }
        : null;
    }
    const last = Object.entries(rt.activeRows).reverse().find(([, rowId]) => rowId !== undefined);
    return last ? { tableId: last[0], rowId: last[1] } : null;
  })();
  const navigation = useProtoStore((state) => {
    if (!allowPageRow || activeEntry || state.activePageId !== pageId) return null;
    const nav = state.navigationSource;
    if (!nav) return null;
    if (preferredTableId && nav.tableId !== preferredTableId) return null;
    // An explicitly empty child selection cannot fall back to editing the navigation row.
    if (nav.tableId !== collectionTableId && rt?.activeRows && Object.hasOwn(rt.activeRows, nav.tableId) && rt.activeRows[nav.tableId] === undefined) return null;
    return nav;
  });
  const target = activeEntry ?? navigation;
  const savedRows = usePageStore((state) => (target?.rowId !== undefined ? state.tableRows[target.tableId] : undefined));
  // Staged preview data is authoritative, including a missing/empty source table.
  const resolvedRows = target?.rowId !== undefined
    ? preview
      ? preview.rows[target.tableId]
      : savedRows ?? usePageStore.getState().getRows(target.tableId)
    : undefined;
  if (direct) {
    if (preferredTableId && scope.tableId !== preferredTableId) {
      return { row: undefined, tableId: undefined };
    }
    return { row: scope.row, tableId: scope.tableId };
  }
  if (hasParams) {
    const paramTableId = typeof scope.params?.tableId === 'string' ? scope.params.tableId : undefined;
    if (preferredTableId && paramTableId !== preferredTableId) {
      return { row: undefined, tableId: undefined };
    }
    return {
      row: paramRow && typeof paramRow === 'object' && !Array.isArray(paramRow) ? (paramRow as Row) : undefined,
      tableId: paramTableId,
    };
  }
  return { row: resolvedRows?.find((row) => row.id === target?.rowId), tableId: target?.tableId };
}

/** Resolve the declared parent table once for both row lookup and child selection. */
export function useCollectionSourceRow(scope: Scope, pageId: string, tableId: string | undefined, foreignKey: unknown, tables: DBTableSchema[]) {
  const fkSourceTableId = useMemo(
    () => resolveForeignKeySourceTableId(tableId, foreignKey, tables),
    [tableId, foreignKey, tables],
  );
  const source = useSourceRow(scope, pageId, foreignKey !== undefined, fkSourceTableId, tableId);
  return { ...source, fkSourceTableId };
}

/**
 * Resolve the unprojected canonical stored row for a bound table so UI Stack `edge`
 * display projections can never prefill forms or write back into `tableRows`.
 */
export function resolveCanonicalRow(
  tableId: unknown,
  row: Row | undefined,
  previewRows?: Record<string, Row[]> | null,
): Row | undefined {
  if (!row || typeof tableId !== 'string' || !tableId) return row;
  const list = previewRows ? previewRows[tableId] : usePageStore.getState().getRows(tableId);
  return list?.find((item) => item.id === row.id) ?? row;
}

/**
 * Safely auto-selects the first visible row of a bound list when no valid row in the
 * underlying table is active yet, or this list's parent or runtime filter changed,
 * preventing ping-pong thrashing when multiple filtered lists share the same `tableId`.
 */
export function useAutoSelectFirstRow(params: {
  rt: Runtime;
  tableId?: string;
  visibleRows: readonly { id: string }[];
  autoSelectFirst: boolean;
  runtimeQuery?: unknown;
  sourceTableId?: string;
  sourceRowId?: string;
}): void {
  const { rt, tableId, visibleRows, autoSelectFirst, runtimeQuery, sourceTableId, sourceRowId } = params;
  const preview = useContext(PreviewDataContext);
  const savedTableRows = usePageStore((s) => (tableId ? s.tableRows[tableId] : undefined));
  const getRows = usePageStore((s) => s.getRows);
  const canonicalRows = tableId
    ? preview
      ? preview.rows[tableId] ?? []
      : savedTableRows ?? getRows(tableId)
    : [];

  const serializedQuery = JSON.stringify(runtimeQuery ?? null);
  const prevQueryRef = useRef<string>(serializedQuery);
  const previousSource = useRef<{ tableId?: string; rowId?: string }>({});

  const activeRowId = tableId ? rt.activeRows?.[tableId] : undefined;
  const firstVisibleId = visibleRows[0]?.id ?? null;

  useEffect(() => {
    const queryChanged = prevQueryRef.current !== serializedQuery;
    prevQueryRef.current = serializedQuery;
    if (rt.isDesign || !autoSelectFirst || !tableId) return;
    const previous = previousSource.current;
    const sourceChanged = sourceTableId !== undefined && (
      previous.rowId !== sourceRowId || (sourceRowId !== undefined && previous.tableId !== sourceTableId)
    );
    previousSource.current = { tableId: sourceTableId, rowId: sourceRowId };
    const liveActiveId = rt.getActiveRowId ? rt.getActiveRowId(tableId) : activeRowId;
    // A sibling list may already have selected a row for this parent in this commit.
    if (sourceChanged && liveActiveId === activeRowId && !visibleRows.some(row => row.id === liveActiveId)) {
      rt.setActiveRow(tableId, firstVisibleId, sourceTableId);
      return;
    }
    if (!firstVisibleId) return;
    const existsInCanonicalTable = Boolean(
      liveActiveId && canonicalRows.some((row) => row.id === liveActiveId),
    );
    if (!liveActiveId || !existsInCanonicalTable) {
      // A self-referenced master can still have a parent selected when it has no children.
      if (!liveActiveId && !sourceTableId && canonicalRows.some(row => row.id === rt.activeParentRows[tableId])) return;
      rt.setActiveRow(tableId, firstVisibleId, sourceTableId);
      return;
    }
    if (queryChanged && !visibleRows.some((row) => row.id === liveActiveId)) {
      rt.setActiveRow(tableId, firstVisibleId, sourceTableId);
    }
  }, [rt, autoSelectFirst, tableId, activeRowId, firstVisibleId, canonicalRows, visibleRows, serializedQuery, sourceTableId, sourceRowId]);
}
