import { useContext } from 'react';
import { useProtoStore } from '../../store/useProtoStore';
import { usePageStore } from '../store/usePageStore';
import { PreviewDataContext } from './PreviewData';
import type { Scope } from './runtime';
import type { Row } from './mock';

/** Overlay row scope takes precedence over page navigation. A mismatched explicit
 * scope must never fall back to a different record from a prior navigation. */
export function useSourceRow(scope: Scope, pageId: string, enabled: boolean) {
  const preview = useContext(PreviewDataContext);
  // Runtime overlay params have always reserved row/tableId. Some embedding
  // surfaces pass that pair without also mirroring it onto Scope's top level.
  const direct = scope.row !== undefined;
  const paramRow = scope.params?.row;
  const hasParams = paramRow !== undefined;
  const navigation = useProtoStore(state =>
    enabled && !direct && !hasParams && state.activePageId === pageId ? state.navigationSource : null);
  const savedRows = usePageStore(state => navigation ? state.tableRows[navigation.tableId] : undefined);
  // Staged preview data is authoritative, including a missing/empty source table.
  const rows = navigation && preview ? preview.rows[navigation.tableId] : savedRows;
  if (direct) return {row:scope.row,tableId:scope.tableId};
  if (hasParams) return {
    row: paramRow && typeof paramRow === 'object' && !Array.isArray(paramRow) ? paramRow as Row : undefined,
    tableId: typeof scope.params?.tableId === 'string' ? scope.params.tableId : undefined,
  };
  return { row: rows?.find(row => row.id === navigation?.rowId), tableId: navigation?.tableId };
}
