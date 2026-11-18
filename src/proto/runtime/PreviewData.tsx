import { createContext, useContext } from 'react';
import { useProtoStore, type DBTableSchema } from '../../store/useProtoStore';
import type { Row } from './mock';

export const PreviewDataContext = createContext<{ tables: DBTableSchema[]; rows: Record<string, Row[]> } | null>(null);
export function useMaterialTables() {
  const preview = useContext(PreviewDataContext);
  const saved = useProtoStore(s => s.dbTables);
  return preview ? preview.tables : saved;
}
