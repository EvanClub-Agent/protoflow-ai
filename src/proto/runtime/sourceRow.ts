import { useContext, useEffect, useRef } from 'react';
import { useProtoStore } from '../../store/useProtoStore';
import { usePageStore } from '../store/usePageStore';
import { PreviewDataContext } from './PreviewData';
import { useOptionalRuntime, type Runtime, type Scope } from './runtime';
import type { Row } from './mock';

/** Overlay row scope takes precedence over page activeRow and page navigation.
 * A mismatched explicit scope or navigation from an unrelated table must never
 * leak into a table-constrained consumer (`preferredTableId`). */
export function useSourceRow(scope: Scope, pageId: string, enabled: boolean, preferredTableId?: string) {
  const preview = useContext(PreviewDataContext);
  const rt = useOptionalRuntime();
  // Runtime overlay params have always reserved row/tableId. Some embedding
  // surfaces pass that pair without also mirroring it onto Scope's top level.
  const direct = scope.row !== undefined;
  const paramRow = scope.params?.row;
  const hasParams = paramRow !== undefined;
  const activeEntry = (() => {
    if (!enabled || direct || hasParams || !rt?.activeRows) return null;
    if (preferredTableId) {
      const id = rt.activeRows[preferredTableId];
      return id ? { tableId: preferredTableId, rowId: id } : null;
    }
    const entries = Object.entries(rt.activeRows);
    if (!entries.length) return null;
    const [tableId, rowId] = entries[entries.length - 1];
    return rowId ? { tableId, rowId } : null;
  })();
  const navigation = useProtoStore((state) => {
    if (!enabled || direct || hasParams || activeEntry || state.activePageId !== pageId) return null;
    const nav = state.navigationSource;
    if (!nav) return null;
    if (preferredTableId && nav.tableId !== preferredTableId) return null;
    return nav;
  });
  const target = activeEntry ?? navigation;
  const savedRows = usePageStore((state) => (target ? state.tableRows[target.tableId] : undefined));
  // Staged preview data is authoritative, including a missing/empty source table.
  const resolvedRows = target
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
 * underlying table is active yet (or when THIS list's own runtime filter just changed),
 * preventing ping-pong thrashing when multiple filtered lists share the same `tableId`.
 */
export function useAutoSelectFirstRow(params: {
  rt: Runtime;
  tableId?: string;
  visibleRows: readonly { id: string }[];
  autoSelectFirst: boolean;
  runtimeQuery?: unknown;
}): void {
  const { rt, tableId, visibleRows, autoSelectFirst, runtimeQuery } = params;
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

  const activeRowId = tableId ? rt.activeRows?.[tableId] : undefined;
  const firstVisibleId = visibleRows[0]?.id ?? null;

  useEffect(() => {
    const queryChanged = prevQueryRef.current !== serializedQuery;
    prevQueryRef.current = serializedQuery;
    if (rt.isDesign || !autoSelectFirst || !tableId || !firstVisibleId) return;
    const liveActiveId = rt.getActiveRowId ? rt.getActiveRowId(tableId) : activeRowId;
    const existsInCanonicalTable = Boolean(
      liveActiveId && canonicalRows.some((row) => row.id === liveActiveId),
    );
    if (!liveActiveId || !existsInCanonicalTable) {
      rt.setActiveRow?.(tableId, firstVisibleId);
      return;
    }
    if (queryChanged && !visibleRows.some((row) => row.id === liveActiveId)) {
      rt.setActiveRow?.(tableId, firstVisibleId);
    }
  }, [rt, rt.isDesign, autoSelectFirst, tableId, activeRowId, firstVisibleId, canonicalRows, visibleRows, serializedQuery]);
}
