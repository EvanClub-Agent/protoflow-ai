import type { DBTableSchema } from '../../store/useProtoStore';
import { parsePageSource } from '../dsl/parser';
import { validateMaterialSource } from '../registry/materialContract';
import { PAGE_ROOT_TYPES } from '../registry/meta';
import { diagramRelations } from '../database/relations';
import { COLLECTION_BINDING_TYPES, collectionBindingErrors, tableBindingErrors } from '../table/model';
import { freeformBindingErrors } from '../freeform/contract';
import { isNode, type ProtoNode } from '../types';
import { isChartType, chartConfigErrors, prepareChartData } from '../charts/model';
import { extractPageActionSemantics, semanticActionContractErrors } from './actionSemantics';

// Shared by the native staging tool and the host's final atomic commit.
export function pageContractErrors(
  source: string,
  tablesInput: DBTableSchema[] = [],
  data?: { tableRows: unknown },
): string[] {
  const tables = Array.isArray(tablesInput) ? tablesInput : [];
  const parsed = parsePageSource(source, { strict: true });
  if (!parsed.doc) return parsed.issues.map((i) => i.message);
  const errors: string[] = validateMaterialSource(source);
  if (!PAGE_ROOT_TYPES.has(parsed.doc.root.type)) errors.push("根组件必须为 Page 或 MobilePage");
  const root = parsed.doc.root;
  const nodesByPfId = new Map<string, ProtoNode>();
  const indexNodes = (n: ProtoNode) => {
    nodesByPfId.set(n.pfId, n);
    n.children.forEach((c) => {
      if (isNode(c)) indexNodes(c);
    });
  };
  indexNodes(root);
  // Material/DSL rules belong to the shared validator above; only project data
  // bindings are checked here. Keep malformed model output out of runtime casts.
  const visit = (n: ProtoNode, owner?: DBTableSchema, query = false) => {
    if (isChartType(n.type)) {
      const configErrors = chartConfigErrors(n.type, n.props, tables);
      errors.push(...configErrors.map(message => `${n.pfId}:${message}`));
      if (!configErrors.length && n.props.source === 'table' && data) {
        try {
          if (!data.tableRows || typeof data.tableRows !== 'object' || Array.isArray(data.tableRows)) throw new Error('工程快照缺少预览数据，无法核验图表，请重新读取工程');
          const tableId = n.props.table as string;
          const rows = Object.hasOwn(data.tableRows, tableId) ? (data.tableRows as Record<string, unknown>)[tableId] : undefined;
          // Use the renderer's complete-data checks, not just schema names or a
          // paginated sample. Adding a column never supplies historical values.
          prepareChartData(n.type, n.props, rows);
        } catch (error) {
          errors.push(`${n.pfId}:图表数据不可用（表 ${String(n.props.table)}）：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (n.type === 'Table') errors.push(...tableBindingErrors(n.props, tables, data?.tableRows).map(message => `${n.pfId}:${message}`));
    if (COLLECTION_BINDING_TYPES.has(n.type)) {
      errors.push(...collectionBindingErrors(n.type, n.props, tables).map(message => `${n.pfId}:${message}`));
    }
    if (n.type === 'MSheetPicker' && typeof n.props.table === 'string') {
      const bound = tables.find((t) => t.id === n.props.table);
      if (bound) {
        for (const key of ['labelField', 'valueField'] as const) {
          const val = n.props[key];
          if (typeof val === 'string' && val && !bound.columns.some((col) => col.name === val)) {
            errors.push(`${n.pfId}:未知字段 ${bound.id}.${val}`);
          }
        }
      }
    }
    if (n.type === 'Freeform') errors.push(...freeformBindingErrors(n.props, tables).map(message => `${n.pfId}:${message}`));
    if (
      typeof n.props.table === "string" &&
      !tables.some((t) => t.id === n.props.table)
    )
      errors.push(`${n.pfId}:未知表 ${n.props.table}`);
    if (
      typeof n.props.activeTable === "string" &&
      n.props.activeTable &&
      !tables.some((t) => t.id === n.props.activeTable)
    )
      errors.push(`${n.pfId}:未知表 ${n.props.activeTable}`);
    const table =
      (n.type === "Form" || n.type === "MForm") ? tables.find((t) => t.id === n.props.table) : owner;
    const isQuery = query || n.type === "QueryForm";
    const field = (name: unknown) => {
      if (
        !isQuery &&
        table &&
        typeof name === "string" &&
        !table.columns.some((c) => c.name === name)
      )
        errors.push(`${n.pfId}:未知字段 ${table.id}.${name}`);
    };
    field(n.props.name);
    if (typeof n.props.minField === "string" && n.props.minField) field(n.props.minField);
    if (typeof n.props.maxField === "string" && n.props.maxField) field(n.props.maxField);
    if (n.type === 'MSheetPicker' && typeof n.props.table === 'string' && table) {
      const column = table.columns.find(c => c.name === n.props.name);
      if (column && (column.isForeignKey || column.references)) {
        const relation = diagramRelations(tables).relations.find(edge => edge.toTableId === table.id && edge.toColumnId === column.id);
        if (!relation || relation.fromTableId !== n.props.table || relation.fromColumnName !== n.props.valueField)
          errors.push(`${n.pfId}:选项来源表或存储字段与目标外键 ${table.id}.${column.name} 不一致`);
      }
    }
    if (n.type === "Form" && Array.isArray(n.props.fields))
      n.props.fields.forEach((f) => {
        if (f && typeof f === "object" && !Array.isArray(f)) {
          if ("name" in f) field(f.name);
          if ("minField" in f && typeof f.minField === "string" && f.minField) field(f.minField);
          if ("maxField" in f && typeof f.maxField === "string" && f.maxField) field(f.maxField);
        }
      });
    if (
      n.type === "MPillTabs" &&
      typeof n.props.target === "string" &&
      typeof n.props.filterField === "string" &&
      n.props.filterField
    ) {
      const targetNode = nodesByPfId.get(n.props.target);
      if (
        targetNode &&
        COLLECTION_BINDING_TYPES.has(targetNode.type) &&
        typeof targetNode.props.table === "string"
      ) {
        const bound = tables.find((t) => t.id === targetNode.props.table);
        if (bound && !bound.columns.some((col) => col.name === n.props.filterField)) {
          errors.push(`${n.pfId}:未知字段 ${bound.id}.${n.props.filterField}`);
        }
      }
    }
    if (
      n.type === "Table" &&
      typeof n.props.table === "string" &&
      Array.isArray(n.props.columns)
    ) {
      const bound = tables.find((t) => t.id === n.props.table);
      for (const c of n.props.columns)
        if (
          c &&
          typeof c === "object" &&
          !Array.isArray(c) &&
          "dataIndex" in c &&
          typeof c.dataIndex === "string" &&
          bound &&
          !bound.columns.some((col) => col.name === c.dataIndex)
        )
          errors.push(`${n.pfId}:未知字段 ${bound.id}.${c.dataIndex}`);
    }
    n.children.forEach((c) => {
      if (isNode(c)) visit(c, table, isQuery);
    });
  };
  visit(root);
  const actionSemantics = extractPageActionSemantics(root, tables);
  errors.push(...semanticActionContractErrors(actionSemantics, tables));
  return errors;
}
