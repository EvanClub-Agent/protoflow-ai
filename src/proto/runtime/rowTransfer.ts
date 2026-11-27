import type { DBTableSchema } from '../../store/useProtoStore';
import { validateColumnValues, valuesWithColumnDefaults } from '../database/columnDefault';
import { diagramRelations } from '../database/relations';
import { newId } from '../../utils/identity';
import type { Row } from './mock';

export interface ImportSelectedRowsMapping {
  /** Override target table FK column pointing to the active parent document (defaults to target Table.sourceForeignKey). */
  parentForeignKey?: string;
  /** Map `{ [targetColumnName]: sourceColumnName }` from each selected source row. */
  fieldMap?: Record<string, string>;
  /** Map `{ [targetColumnName]: parentColumnName }` from the resolved parent document row. */
  parentFieldMap?: Record<string, string>;
  /** Static or `{{...}}` template default values `{ [targetColumnName]: value }` applied to each imported row. */
  defaults?: Record<string, unknown>;
  /** Allow importing the same source record multiple times under the same parent (default: false when a source FK exists). */
  allowDuplicate?: boolean;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export function parseImportSelectedRowsMapping(raw: unknown): {
  mapping: ImportSelectedRowsMapping;
  errors: string[];
} {
  if (raw === undefined) return { mapping: {}, errors: [] };
  if (!isPlainObject(raw)) {
    return { mapping: {}, errors: ['importSelectedRows 的第三个参数 mapping 必须是键值配置对象'] };
  }
  const errors: string[] = [];
  const allowedKeys = new Set(['parentForeignKey', 'fieldMap', 'parentFieldMap', 'defaults', 'allowDuplicate']);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      errors.push(`importSelectedRows.mapping 包含未支持的配置项 ${key}（允许：parentForeignKey, fieldMap, parentFieldMap, defaults, allowDuplicate）`);
    }
  }
  const mapping: ImportSelectedRowsMapping = {};
  if (raw.parentForeignKey !== undefined) {
    if (typeof raw.parentForeignKey !== 'string' || !raw.parentForeignKey.trim()) {
      errors.push('importSelectedRows.mapping.parentForeignKey 必须是非空外键字段名');
    } else {
      mapping.parentForeignKey = raw.parentForeignKey.trim();
    }
  }
  for (const mapKey of ['fieldMap', 'parentFieldMap'] as const) {
    if (raw[mapKey] !== undefined) {
      if (!isPlainObject(raw[mapKey])) {
        errors.push(`importSelectedRows.mapping.${mapKey} 必须是字段映射对象`);
      } else {
        const clean: Record<string, string> = {};
        for (const [targetCol, srcCol] of Object.entries(raw[mapKey] as Record<string, unknown>)) {
          if (typeof srcCol !== 'string' || !srcCol.trim()) {
            errors.push(`importSelectedRows.mapping.${mapKey}.${targetCol} 必须指定非空来源字段名`);
          } else {
            clean[targetCol] = srcCol.trim();
          }
        }
        mapping[mapKey] = clean;
      }
    }
  }
  if (raw.defaults !== undefined) {
    if (!isPlainObject(raw.defaults)) {
      errors.push('importSelectedRows.mapping.defaults 必须是默认值键值对象');
    } else {
      mapping.defaults = { ...(raw.defaults as Record<string, unknown>) };
    }
  }
  if (raw.allowDuplicate !== undefined) {
    if (typeof raw.allowDuplicate !== 'boolean') {
      errors.push('importSelectedRows.mapping.allowDuplicate 必须是布尔值');
    } else {
      mapping.allowDuplicate = raw.allowDuplicate;
    }
  }
  return { mapping, errors };
}

export function importSelectedRowsContractErrors(
  tables: DBTableSchema[],
  sourceTableId: string | undefined,
  targetTableId: string | undefined,
  rawMapping?: unknown,
  defaultParentForeignKey?: string,
): string[] {
  const errors: string[] = [];
  if (!sourceTableId) errors.push('importSelectedRows 来源表格必须绑定真实数据表');
  if (!targetTableId) errors.push('importSelectedRows 目标明细表格必须绑定真实数据表');
  const sourceTable = sourceTableId ? tables.find((t) => t.id === sourceTableId) : undefined;
  const targetTable = targetTableId ? tables.find((t) => t.id === targetTableId) : undefined;
  if (sourceTableId && !sourceTable) errors.push(`importSelectedRows 来源表格绑定了未知表 ${sourceTableId}`);
  if (targetTableId && !targetTable) errors.push(`importSelectedRows 目标明细表格绑定了未知表 ${targetTableId}`);
  const parsed = parseImportSelectedRowsMapping(rawMapping);
  errors.push(...parsed.errors);
  if (!sourceTable || !targetTable || errors.length > 0) return errors;

  const { mapping } = parsed;
  const relations = diagramRelations(tables).relations;
  const effectiveParentFk = mapping.parentForeignKey ?? defaultParentForeignKey;
  let parentTable: DBTableSchema | undefined;
  if (effectiveParentFk) {
    const parentEdge = relations.find(
      (edge) => edge.toTableId === targetTable.id && edge.toColumnName === effectiveParentFk,
    );
    if (!parentEdge) {
      errors.push(`importSelectedRows 目标表 ${targetTable.id} 的主单外键字段 ${effectiveParentFk} 未声明有效外键引用`);
    } else {
      parentTable = tables.find((t) => t.id === parentEdge.fromTableId);
    }
  }

  const checkTargetField = (colName: string, label: string) => {
    const col = targetTable.columns.find((c) => c.name === colName);
    if (!col) {
      errors.push(`importSelectedRows ${label} 引用了未知目标字段 ${targetTable.id}.${colName}`);
    } else if (col.name === 'id' || col.isPrimaryKey) {
      errors.push(`importSelectedRows ${label} 不能覆盖目标表主键字段 ${targetTable.id}.${colName}`);
    }
  };

  for (const [targetCol, srcCol] of Object.entries(mapping.fieldMap ?? {})) {
    checkTargetField(targetCol, 'fieldMap');
    if (srcCol !== 'id' && !sourceTable.columns.some((c) => c.name === srcCol)) {
      errors.push(`importSelectedRows fieldMap 引用了未知来源字段 ${sourceTable.id}.${srcCol}`);
    }
  }

  for (const [targetCol, parentCol] of Object.entries(mapping.parentFieldMap ?? {})) {
    checkTargetField(targetCol, 'parentFieldMap');
    if (!parentTable) {
      errors.push(`importSelectedRows 配置了 parentFieldMap，但目标表未关联可解析的主单外键（请配置 Table.sourceForeignKey 或 mapping.parentForeignKey）`);
    } else if (parentCol !== 'id' && !parentTable.columns.some((c) => c.name === parentCol)) {
      errors.push(`importSelectedRows parentFieldMap 引用了未知主单字段 ${parentTable.id}.${parentCol}`);
    }
  }

  for (const targetCol of Object.keys(mapping.defaults ?? {})) {
    checkTargetField(targetCol, 'defaults');
  }

  return errors;
}

export interface BuildImportedRowsParams {
  tables: DBTableSchema[];
  sourceTableId: string;
  targetTableId: string;
  sourceRows: Row[];
  existingTargetRows: Row[];
  selectedIds: string[];
  rawMapping?: unknown;
  defaultParentForeignKey?: string;
  resolveParentRow?: (parentTableId: string) => Row | undefined;
  resolveDynamicValue?: (raw: unknown) => unknown;
}

export function buildImportedSelectedRows(params: BuildImportedRowsParams): Row[] {
  const {
    tables,
    sourceTableId,
    targetTableId,
    sourceRows,
    existingTargetRows,
    selectedIds,
    rawMapping,
    defaultParentForeignKey,
    resolveParentRow,
    resolveDynamicValue,
  } = params;

  const contractErrors = importSelectedRowsContractErrors(
    tables,
    sourceTableId,
    targetTableId,
    rawMapping,
    defaultParentForeignKey,
  );
  if (contractErrors.length > 0) throw new Error(contractErrors[0]);
  if (selectedIds.length === 0) throw new Error('请先勾选要转入的记录');

  const sourceTable = tables.find((t) => t.id === sourceTableId)!;
  const targetTable = tables.find((t) => t.id === targetTableId)!;
  const { mapping } = parseImportSelectedRowsMapping(rawMapping);
  const relations = diagramRelations(tables).relations;

  const uniqueSelectedIds = [...new Set(selectedIds)];
  const selectedSourceRows = uniqueSelectedIds.map((id) => {
    const found = sourceRows.find((r) => r.id === id);
    if (!found) throw new Error(`所选来源记录不存在：${id}`);
    return found;
  });

  const effectiveParentFk = mapping.parentForeignKey ?? defaultParentForeignKey;
  const parentEdge = effectiveParentFk
    ? relations.find((e) => e.toTableId === targetTable.id && e.toColumnName === effectiveParentFk)
    : undefined;
  const parentColSchema = effectiveParentFk
    ? targetTable.columns.find((c) => c.name === effectiveParentFk)
    : undefined;

  let parentRow: Row | undefined;
  let parentFkValue: unknown;
  if (parentEdge) {
    parentRow = resolveParentRow?.(parentEdge.fromTableId);
    if (!parentRow) {
      if (parentColSchema && !parentColSchema.nullable) {
        throw new Error('请先选择或保存主单记录后再转入明细');
      }
    } else {
      parentFkValue = parentRow[parentEdge.fromColumnName];
      if ((parentFkValue === undefined || parentFkValue === null || parentFkValue === '') && !parentColSchema?.nullable) {
        throw new Error('主单记录缺少有效关联键值，请先保存主单');
      }
    }
  }

  // Detect direct FK from targetTable -> sourceTable (e.g. material_id -> t_material(id) or order_item_id -> t_po_item(id))
  const sourceEdges = relations.filter(
    (e) => e.toTableId === targetTable.id && e.fromTableId === sourceTable.id && e.toColumnName !== effectiveParentFk,
  );
  const primarySourceEdge = sourceEdges.length === 1 ? sourceEdges[0] : undefined;

  const targetFkCols = new Set(
    targetTable.columns
      .filter((c) => c.isForeignKey || Boolean(c.references))
      .map((c) => c.name),
  );
  const sourceColNames = new Set(sourceTable.columns.map((c) => c.name));
  const parentTable = parentEdge ? tables.find((t) => t.id === parentEdge.fromTableId) : undefined;
  const parentColNames = new Set(parentTable?.columns.map((c) => c.name) ?? []);

  const scopedExisting =
    effectiveParentFk && parentFkValue !== undefined
      ? existingTargetRows.filter((r) => r[effectiveParentFk] === parentFkValue)
      : existingTargetRows;

  const existingSourceKeys = new Set(
    primarySourceEdge
      ? scopedExisting
          .map((r) => r[primarySourceEdge.toColumnName])
          .filter((v) => v !== undefined && v !== null && v !== '')
      : [],
  );

  const resolvedDefaults: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mapping.defaults ?? {})) {
    resolvedDefaults[k] = resolveDynamicValue ? resolveDynamicValue(v) : v;
  }

  const created: Row[] = [];
  let seqOffset = scopedExisting.length;

  for (const srcRow of selectedSourceRows) {
    if (primarySourceEdge && !mapping.allowDuplicate) {
      const srcKeyVal = srcRow[primarySourceEdge.fromColumnName];
      if (srcKeyVal !== undefined && srcKeyVal !== null && existingSourceKeys.has(srcKeyVal)) {
        continue;
      }
    }

    const draft: Record<string, unknown> = {};

    // 1. Auto-inherit matching non-key denormalized scalar columns from parentRow
    if (parentRow) {
      for (const col of targetTable.columns) {
        if (col.name === 'id' || col.isPrimaryKey || targetFkCols.has(col.name)) continue;
        // Skip status/amount/remark fields on parent so header status/totals never pollute line items unless mapped explicitly
        if (/^(status|flow_state|total_|remark|created_at|updated_at)/.test(col.name)) continue;
        if (parentColNames.has(col.name) && Object.hasOwn(parentRow, col.name) && parentRow[col.name] !== undefined) {
          draft[col.name] = parentRow[col.name];
        }
      }
    }

    // 2. Auto-copy matching non-key scalar columns from selected sourceRow
    for (const col of targetTable.columns) {
      if (col.name === 'id' || col.isPrimaryKey || targetFkCols.has(col.name)) continue;
      if (/^(status|flow_state|created_at|updated_at)$/.test(col.name)) continue;
      if (sourceColNames.has(col.name) && Object.hasOwn(srcRow, col.name) && srcRow[col.name] !== undefined) {
        draft[col.name] = srcRow[col.name];
      }
    }

    // 3. Bind parent FK and direct source FK
    if (effectiveParentFk && parentFkValue !== undefined) {
      draft[effectiveParentFk] = parentFkValue;
    }
    if (primarySourceEdge) {
      const srcKeyVal = srcRow[primarySourceEdge.fromColumnName];
      if (srcKeyVal !== undefined) {
        draft[primarySourceEdge.toColumnName] = srcKeyVal;
        existingSourceKeys.add(srcKeyVal);
      }
    }

    // 4. Apply explicit parentFieldMap, fieldMap, and defaults (in ascending priority)
    if (parentRow && mapping.parentFieldMap) {
      for (const [targetCol, parentCol] of Object.entries(mapping.parentFieldMap)) {
        if (Object.hasOwn(parentRow, parentCol)) {
          draft[targetCol] = parentRow[parentCol];
        }
      }
    }
    if (mapping.fieldMap) {
      for (const [targetCol, srcCol] of Object.entries(mapping.fieldMap)) {
        if (Object.hasOwn(srcRow, srcCol)) {
          draft[targetCol] = srcRow[srcCol];
        }
      }
    }
    for (const [targetCol, val] of Object.entries(resolvedDefaults)) {
      draft[targetCol] = val;
    }

    // 5. Auto-populate sequential row_no if target table has a required integer row_no not yet filled
    const rowNoCol = targetTable.columns.find((c) => c.name === 'row_no' && !c.isPrimaryKey && !targetFkCols.has(c.name));
    if (rowNoCol && draft.row_no === undefined && /^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)\b/i.test(rowNoCol.dataType)) {
      seqOffset += 1;
      draft.row_no = seqOffset;
    }

    // 6. Apply SQL column defaults, and safe zero/empty fallbacks for remaining NOT NULL non-FK scalar columns
    const withDefaults = valuesWithColumnDefaults(targetTable, draft);
    for (const col of targetTable.columns) {
      if (col.name === 'id' || col.isPrimaryKey || Object.hasOwn(withDefaults, col.name)) continue;
      if (!col.nullable && !targetFkCols.has(col.name) && !col.isUnique) {
        const dt = col.dataType.trim();
        if (/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL)\b/i.test(dt)) {
          withDefaults[col.name] = 0;
        } else if (/^BOOL(?:EAN)?\b/i.test(dt)) {
          withDefaults[col.name] = false;
        } else if (/^ENUM\s*\((.+)\)$/i.test(dt)) {
          const m = /^ENUM\s*\(\s*'([^']*)'/i.exec(dt);
          if (m) withDefaults[col.name] = m[1];
        } else if (/^DATE\b/i.test(dt)) {
          withDefaults[col.name] = new Date().toISOString().slice(0, 10);
        } else if (/^(?:VAR)?CHAR\b|^TEXT\b/i.test(dt)) {
          withDefaults[col.name] = '-';
        }
      }
    }

    validateColumnValues(targetTable, withDefaults);
    created.push({ ...withDefaults, id: newId(targetTable.id) });
  }

  return created;
}
