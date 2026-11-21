import { columnDefaultSql } from '../proto/database/columnDefault';
import { resolveUniqueConstraints, sqlIdentifier, uniqueConstraintSql } from '../proto/database/uniqueConstraints';
import React, { useState, useRef, useMemo, useLayoutEffect, useEffect } from 'react';
import {
  Database,
  Table2,
  Key,
  Link2,
  Plus,
  Trash2,
  Sparkles,
  ArrowUpRight,
  Copy,
  Check,
  Share2,
  ZoomIn,
  ZoomOut,
  LayoutGrid,
  Pin,
  GitFork,
  Code2,
  GripVertical,
  ArrowUp,
  ArrowDown,
  MousePointer,
  Hand,
  StickyNote,
  Maximize2,
  FileSpreadsheet,
  ListFilter,
  LocateFixed,
  Scan,
  Magnet,
  Bot,
  X,
} from 'lucide-react';
import { useProtoStore, DBTableSchema, PageNodeId } from '../store/useProtoStore';
import { reviewRequirementRecords } from '../proto/database/requirementReview';
import { reviewDatabaseDesign } from '../proto/database/designReview';
import { ProjectTableData } from './ProjectTableData';
import { useHermesStore } from '../store/useHermesStore';
import { runScanStickiesAndAstToDbWithHermes, reportAiError } from '../services/hermesBridge';
import { useI18n } from '../i18n';

import { CARD_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, FOOTER_HEIGHT, layoutTables, resolvePositions, domainBounds, diagramRelations, visibleColumns, columnAnchor, cardHeight, type Point as TablePosition, type DiagramRelation as CustomRelation } from './databaseDiagram';

interface CanvasNoteItem {
  id: string;
  x: number;
  y: number;
  title: string;
  text: string;
  color: 'amber' | 'blue' | 'emerald';
}

interface TableIndexItem {
  id: string;
  tableId: string;
  name: string;
  columnNames: string;
  indexType: 'UNIQUE' | 'NORMAL' | 'FULLTEXT';
  method: 'BTREE' | 'HASH';
  comment: string;
}

const COMMON_SQL_TYPES = [
  'VARCHAR(32)',
  'VARCHAR(64)',
  'VARCHAR(128)',
  'VARCHAR(255)',
  'INT',
  'BIGINT',
  'TINYINT(1)',
  'DECIMAL(14, 2)',
  'DECIMAL(18, 2)',
  'DECIMAL(18, 6)',
  'DATE',
  'DATETIME',
  'TEXT',
  'JSON',
];

export const DatabaseDesignerView: React.FC = () => {
  const projectId = useProtoStore(s => s.currentProjectMeta.projectId);
  return <DatabaseDesignerWorkspace key={projectId} />;
};

const DatabaseDesignerWorkspace: React.FC = () => {
  const { isEn, tr, td } = useI18n();
  const {
    dbTables,
    selectedTableId,
    setSelectedTableId,
    addColumnToTable,
    insertColumnAt,
    reorderColumnInTable,
    updateColumnInTable: writeColumn,
    deleteColumnFromTable: removeColumn,
    setUniqueConstraints,
    createNewTable,
    duplicateTable,
    deleteTable,
    updateTableMeta,
    toggleTableBindingForMenu,
    setActivePage,
    setViewMode,
  } = useProtoStore();

  const [schemaError, setSchemaError] = useState('');
  const editSchema = (change: () => void) => {
    try { change(); setSchemaError(''); }
    catch (error) { setSchemaError(error instanceof Error ? error.message : String(error)); }
  };
  const updateColumnInTable = (...args: Parameters<typeof writeColumn>) => editSchema(() => writeColumn(...args));
  const deleteColumnFromTable = (...args: Parameters<typeof removeColumn>) => editSchema(() => removeColumn(...args));

  // 1. Canvas Tool & View Mode State
  const [activeTool, setActiveTool] = useState<'select' | 'pan' | 'link_fk' | 'new_table'>('select');
  const [tableViewLevel, setTableViewLevel] = useState<'all' | 'keys_only' | 'header_only'>('keys_only');
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showDomainSwimlanes, setShowDomainSwimlanes] = useState(true);
  const [splitLayout, setSplitLayout] = useState<'split' | 'canvas_max' | 'inspector_max'>('canvas_max');
  const [dbScanReport, setDbScanReport] = useState<{
    summary: string;
    engineBadge: string;
  } | null>(null);
  const {
    setModalOpen: setHermesModalOpen,
  } = useHermesStore();

  const handleRunHermesDbScan = async () => {
    try { setDbScanReport(await runScanStickiesAndAstToDbWithHermes()); }
    catch (error) { reportAiError(error); }
  };

  // 2. Canvas Pan, Zoom & Positions
  const [manualPositions, setPositions] = useState<Record<string, TablePosition>>({});
  const [zoom, setZoom] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // 3. Dragging Table Cards & Canvas Sticky Notes
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // 4. Interactive Rubber-Band FK Line Dragging (Drag from field port to another table's field!)
  const [fkDragSource, setFkDragSource] = useState<{
    tableId: string;
    colName: string;
    startX: number;
    startY: number;
  } | null>(null);
  const [mouseCanvasPos, setMouseCanvasPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredRelationId, setHoveredRelationId] = useState<string | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);

  // 5. Right-Click Context Menu (Navicat style)
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    canvasX: number;
    canvasY: number;
    targetType: 'canvas' | 'table';
    tableId?: string;
  } | null>(null);

  // 6. Canvas Annotations / Sticky Notes
  const [canvasNotes, setCanvasNotes] = useState<CanvasNoteItem[]>([]);
  const graph = useMemo(() => diagramRelations(dbTables), [dbTables]);
  const { relations } = graph;
  const design = useMemo(() => reviewDatabaseDesign(dbTables, graph), [dbTables, graph]);
  const requirementRecords = useProtoStore(s=>s.databaseRequirements);
  const trace = useMemo(()=>reviewRequirementRecords(requirementRecords, dbTables),[requirementRecords, dbTables]);
  const designErrors = [...design.tableErrors, ...design.relationErrors];
  const automaticPositions = useMemo(() => layoutTables(dbTables, tableViewLevel, relations), [dbTables, tableViewLevel, relations]);
  const positions = resolvePositions(dbTables, tableViewLevel, relations, automaticPositions, manualPositions);
  const areas = domainBounds(dbTables, positions, tableViewLevel, relations);

  const updateRelation = (relation: CustomRelation, patch: { cardinality?: '1:N' | '1:1'; onDelete?: 'RESTRICT' | 'CASCADE' | 'SET NULL' }) => {
    const column = dbTables.find(t => t.id === relation.toTableId)?.columns.find(c => c.id === relation.toColumnId);
    if (!column) return;
    updateColumnInTable(relation.toTableId, relation.toColumnId, { foreignKeyOptions: { ...column.foreignKeyOptions, ...patch } });
  };
  const removeRelation = (relation: CustomRelation) => {
    updateColumnInTable(relation.toTableId, relation.toColumnId, { isForeignKey: false, references: undefined, foreignKeyOptions: undefined });
    setSelectedRelationId(null);
  };

  // 8. Navicat Bottom "Design Table" Tabs & State
  const [bottomTab, setBottomTab] = useState<
    'fields' | 'foreign_keys' | 'indexes' | 'data_preview' | 'shared_menus' | 'sql_ddl'
  >('fields');
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{
    tableId: string;
    colId: string;
    field: 'name' | 'dataType';
  } | null>(null);

  // Table Indexes State
  const [tableIndexes, setTableIndexes] = useState<TableIndexItem[]>([]);

  // New FK Form State
  const [newFkCol, setNewFkCol] = useState('');
  const [newFkRefTable, setNewFkRefTable] = useState('');
  const [newFkRefCol, setNewFkRefCol] = useState('');
  const [newFkOnDelete, setNewFkOnDelete] = useState<'RESTRICT' | 'CASCADE' | 'SET NULL'>('RESTRICT');

  // New Index Form State
  const [newIdxName, setNewIdxName] = useState('');
  const [newIdxCols, setNewIdxCols] = useState('');
  const [newIdxType, setNewIdxType] = useState<'UNIQUE' | 'NORMAL' | 'FULLTEXT'>('NORMAL');

  // SQL Dialect State
  const [sqlDialect, setSqlDialect] = useState<'mysql' | 'postgres' | 'prisma'>('mysql');
  const [copiedSql, setCopiedSql] = useState(false);

  const activeTable = dbTables.find((t) => t.id === selectedTableId) || dbTables[0];
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const clearIndexForm = () => { setEditingKey(null); setNewIdxName(''); setNewIdxCols(''); };
  useEffect(() => { clearIndexForm(); setSchemaError(''); }, [activeTable?.id]);
  const uniqueKeys = useMemo(() => activeTable ? resolveUniqueConstraints(activeTable) : [], [activeTable]);
  const localIndexes = tableIndexes.filter(i => i.tableId === activeTable?.id);
  const saveIndex = () => editSchema(() => {
    const name = newIdxName.trim();
    if (!name || !newIdxCols.trim()) throw new Error(tr('请填写索引名和本表的物理列名', 'Please enter both the index name and physical column names of this table'));
    if (localIndexes.some(i => i.name.toLowerCase() === name.toLowerCase()) ||
        uniqueKeys.some(k => k.name !== editingKey && k.name.toLowerCase() === name.toLowerCase()))
      throw new Error(tr(`索引名 ${name} 已存在`, `Index name ${name} already exists`));
    if (newIdxType === 'UNIQUE') {
      const columnIds = newIdxCols.split(',').map(token => {
        const columns = activeTable.columns.filter(c => c.name === token.trim());
        if (columns.length !== 1) throw new Error(tr(`请填写本表的准确物理列名：${token}`, `Please enter an exact physical column name from this table: ${token}`));
        return columns[0].id;
      });
      const existing = activeTable.uniqueConstraints ?? [];
      const next = { name, columnIds };
      setUniqueConstraints(activeTable.id, editingKey === null
        ? [...existing, next] : existing.map(k => k.name === editingKey ? next : k));
    } else {
      setTableIndexes(prev => [...prev, {
        id: crypto.randomUUID(), tableId: activeTable.id, name, columnNames: newIdxCols.trim(),
        indexType: newIdxType, method: 'BTREE', comment: tr('自定义业务索引', 'Custom business index'),
      }]);
    }
    clearIndexForm();
  });
  const selectedRelation = relations.find((r) => r.id === selectedRelationId) || null;

  const getTablePos = (tableId: string): TablePosition => positions[tableId];
  const fitCanvas = (nextPositions = positions) => {
    const canvas = canvasRef.current;
    if (!canvas || !dbTables.length) return;
    const left = Math.min(...dbTables.map(t => nextPositions[t.id].x), ...canvasNotes.map(n=>n.x)) - 32;
    const top = Math.min(...dbTables.map(t => nextPositions[t.id].y), ...canvasNotes.map(n=>n.y)) - 48;
    const right = Math.max(...dbTables.map(t => nextPositions[t.id].x + CARD_WIDTH), ...canvasNotes.map(n=>n.x+256)) + 32;
    const bottom = Math.max(...dbTables.map(t => nextPositions[t.id].y + cardHeight(t, tableViewLevel, relations)), ...canvasNotes.map(n=>n.y+180)) + 32;
    const scale = Math.max(0.1, Math.min(1, (canvas.clientWidth - 48) / (right - left), (canvas.clientHeight - 48) / (bottom - top)));
    setZoom(scale);
    setPanOffset({ x: (canvas.clientWidth - (right - left) * scale) / 2 - left * scale, y: 24 - top * scale });
  };
  const focusTable = (tableId: string) => {
    const table = dbTables.find(t => t.id === tableId);
    const canvas = canvasRef.current;
    if (!table || !canvas) return;
    const pos = getTablePos(tableId);
    setZoom(1);
    setPanOffset({ x: (canvas.clientWidth - CARD_WIDTH) / 2 - pos.x, y: 48 - pos.y });
  };
  const layoutKey = JSON.stringify(dbTables.map(t => [t.id, t.domain, visibleColumns(t, tableViewLevel, relations).length]));
  // Fit when the actual geometry changes, not on every field edit or pointer movement.
  useLayoutEffect(() => { fitCanvas(); }, [layoutKey, splitLayout, canvasNotes.length]);
  const fitRef = useRef(fitCanvas);
  fitRef.current = fitCanvas;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fitRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [splitLayout]);
  const previousSelection = useRef(selectedTableId);
  useEffect(() => {
    if (previousSelection.current !== selectedTableId && selectedTableId) {
      const canvas = canvasRef.current;
      const pos = positions[selectedTableId];
      if (canvas && pos && (pos.x * zoom + panOffset.x < 0 || pos.x * zoom + panOffset.x + CARD_WIDTH * zoom > canvas.clientWidth || pos.y * zoom + panOffset.y < 0 || pos.y * zoom + panOffset.y + HEADER_HEIGHT * zoom > canvas.clientHeight)) focusTable(selectedTableId);
    }
    setNewFkCol('');
    setSelectedColumnId(null);
    previousSelection.current = selectedTableId;
  }, [selectedTableId]);

  // Convert client mouse event to canvas-space coordinates
  const clientToCanvasCoords = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 100, y: 100 };
    const scrollLeft = canvasRef.current?.scrollLeft || 0;
    const scrollTop = canvasRef.current?.scrollTop || 0;
    const x = Math.round((clientX - rect.left + scrollLeft - panOffset.x) / zoom);
    const y = Math.round((clientY - rect.top + scrollTop - panOffset.y) / zoom);
    return { x, y };
  };

  const getVisibleColumns = (table: DBTableSchema) => visibleColumns(table, tableViewLevel, relations);
  const getColumnAnchorPoint = (tableId: string, columnName: string, side: 'left' | 'right') => {
    const table = dbTables.find(t => t.id === tableId);
    return table ? columnAnchor(table, columnName, side, positions[tableId], tableViewLevel, relations) : null;
  };

  // Mouse Down on Table Header to Drag Table Card
  const handleTableMouseDown = (e: React.MouseEvent, tableId: string) => {
    if (e.button !== 0 || activeTool === 'pan') return;
    e.stopPropagation();
    setContextMenu(null);
    setSelectedTableId(tableId);
    const coords = clientToCanvasCoords(e.clientX, e.clientY);
    const pos = getTablePos(tableId);
    dragOffsetRef.current = {
      dx: coords.x - pos.x,
      dy: coords.y - pos.y,
    };
    setDraggingTableId(tableId);
  };

  // Mouse Down on Canvas Note to Drag Note
  const handleNoteMouseDown = (e: React.MouseEvent, noteId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setContextMenu(null);
    const note = canvasNotes.find((n) => n.id === noteId);
    if (!note) return;
    const coords = clientToCanvasCoords(e.clientX, e.clientY);
    dragOffsetRef.current = {
      dx: coords.x - note.x,
      dy: coords.y - note.y,
    };
    setDraggingNoteId(noteId);
  };

  // Start Rubber-Band FK Dragging from a Field Port Dot
  const handleStartFkDrag = (
    e: React.MouseEvent,
    tableId: string,
    colName: string,
    side: 'left' | 'right'
  ) => {
    e.stopPropagation();
    const anchor = getColumnAnchorPoint(tableId, colName, side);
    if (!anchor) return;
    setFkDragSource({
      tableId,
      colName,
      startX: anchor.x,
      startY: anchor.y,
    });
    setMouseCanvasPos({ x: anchor.x, y: anchor.y });
  };

  // Complete Rubber-Band FK Drop onto Target Field
  const handleCompleteFkDrop = (targetTable: DBTableSchema, targetColName: string) => {
    if (!fkDragSource) return;
    if (fkDragSource.tableId === targetTable.id) {
      setFkDragSource(null);
      return;
    }

    const sourceTable = dbTables.find(t => t.id === fkDragSource.tableId);
    const targetCol = targetTable.columns.find(c => c.name === targetColName);
    if (!sourceTable || !targetCol || !sourceTable.columns.some(c => c.name === fkDragSource.colName)) return;
    updateColumnInTable(targetTable.id, targetCol.id, {
      isForeignKey: true,
      references: `${sourceTable.tableName}(${fkDragSource.colName})`,
      foreignKeyOptions: { cardinality: '1:N', onDelete: 'RESTRICT' },
    });
    setSelectedRelationId(JSON.stringify([targetTable.id, targetCol.id]));
    setFkDragSource(null);
    setActiveTool('select');
  };

  // Canvas Background Mouse Down (Pan or Create New Table at Click Position)
  const handleCanvasBackgroundMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setContextMenu(null);
    setSelectedRelationId(null);

    if (activeTool === 'new_table') {
      const coords = clientToCanvasCoords(e.clientX, e.clientY);
      let tableNumber = dbTables.length + 1;
      while (dbTables.some(t => t.id === `t_custom_entity_${tableNumber}` || t.tableName === `t_custom_entity_${tableNumber}`)) tableNumber++;
      const newTblName = `t_custom_entity_${tableNumber}`;
      createNewTable(newTblName, tr(`新建业务实体表_${dbTables.length + 1}`, `New_Entity_Table_${dbTables.length + 1}`), '仓储验收域 (WMS)');
      setPositions((prev) => ({
        ...prev,
        [newTblName]: {
          x: snapToGrid ? Math.round(coords.x / 20) * 20 : coords.x,
          y: snapToGrid ? Math.round(coords.y / 20) * 20 : coords.y,
        },
      }));
      setActiveTool('select');
      return;
    }

    if (activeTool === 'pan') {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
    }
  };

  // Canvas Mouse Move (60fps Table Drag, Note Drag, Pan, or Live FK Rubber-band Line)
  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    const coords = clientToCanvasCoords(e.clientX, e.clientY);

    if (fkDragSource) {
      setMouseCanvasPos(coords);
      return;
    }

    if (draggingTableId) {
      const rawX = Math.max(16, coords.x - dragOffsetRef.current.dx);
      const rawY = Math.max(16, coords.y - dragOffsetRef.current.dy);
      const nextX = snapToGrid ? Math.round(rawX / 20) * 20 : rawX;
      const nextY = snapToGrid ? Math.round(rawY / 20) * 20 : rawY;
      setPositions((prev) => ({
        ...prev,
        [draggingTableId]: { x: nextX, y: nextY },
      }));
      return;
    }

    if (draggingNoteId) {
      const nextX = Math.max(16, coords.x - dragOffsetRef.current.dx);
      const nextY = Math.max(16, coords.y - dragOffsetRef.current.dy);
      setCanvasNotes((prev) =>
        prev.map((n) => (n.id === draggingNoteId ? { ...n, x: nextX, y: nextY } : n))
      );
      return;
    }

    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
    }
  };

  const handleCanvasMouseUp = () => {
    setDraggingTableId(null);
    setDraggingNoteId(null);
    setIsPanning(false);
    if (fkDragSource) {
      setFkDragSource(null);
    }
  };

  // Accept Drag-and-Drop of Table Item from Left Sidebar Tree onto ER Canvas!
  const handleCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedTableId = e.dataTransfer.getData('application/protoflow-table-id');
    if (!dbTables.some(t => t.id === droppedTableId)) return;
    const coords = clientToCanvasCoords(e.clientX, e.clientY);
    const nextX = snapToGrid
      ? Math.round(Math.max(20, coords.x - CARD_WIDTH / 2) / 20) * 20
      : Math.max(20, coords.x - CARD_WIDTH / 2);
    const nextY = snapToGrid
      ? Math.round(Math.max(20, coords.y - 30) / 20) * 20
      : Math.max(20, coords.y - 30);

    setPositions((prev) => ({
      ...prev,
      [droppedTableId]: { x: nextX, y: nextY },
    }));
    setSelectedTableId(droppedTableId);
  };

  // Auto Layout all tables into a clean orthogonal grid
  const handleAutoLayout = () => {
    setPositions({});
    fitCanvas(automaticPositions);
  };

  // Navicat Field Toolbar Actions (Add, Insert, Delete, Primary Key Toggle, Move Up/Down)
  const selectedColIndex = activeTable?.columns.findIndex((c) => c.id === selectedColumnId) ?? -1;
  const effectiveColIndex =
    selectedColIndex >= 0 ? selectedColIndex : (activeTable?.columns.length ?? 0) - 1;

  const handleNavicatAddField = () => {
    addColumnToTable(activeTable.id, {
      name: `new_field_${activeTable.columns.length + 1}`,
      dataType: 'VARCHAR(64)',
      nullable: true,
      comment: tr('新增业务字段', 'New business column'),
      sourceWidgetOrSticky: tr('Navicat 表设计器新增', 'Added in Schema Designer'),
    });
  };

  const handleNavicatInsertField = () => {
    insertColumnAt(activeTable.id, Math.max(0, effectiveColIndex), {
      name: `inserted_col_${activeTable.columns.length + 1}`,
      dataType: 'VARCHAR(64)',
      nullable: true,
      comment: tr('插入字段', 'Inserted column'),
      sourceWidgetOrSticky: tr('Navicat 表设计器插入', 'Inserted in Schema Designer'),
    });
  };

  const handleNavicatDeleteField = () => {
    const targetCol =
      activeTable.columns.find((c) => c.id === selectedColumnId) ||
      activeTable.columns[activeTable.columns.length - 1];
    if (targetCol && !targetCol.isPrimaryKey) {
      deleteColumnFromTable(activeTable.id, targetCol.id);
    }
  };

  const handleNavicatTogglePk = () => {
    const targetCol = activeTable.columns.find((c) => c.id === selectedColumnId);
    if (!targetCol) return;
    updateColumnInTable(activeTable.id, targetCol.id, {
      isPrimaryKey: !targetCol.isPrimaryKey,
      nullable: targetCol.isPrimaryKey ? true : false,
    });
  };

  const handleNavicatMoveCol = (dir: -1 | 1) => {
    if (selectedColIndex < 0) return;
    const targetIdx = selectedColIndex + dir;
    if (targetIdx < 0 || targetIdx >= activeTable.columns.length) return;
    reorderColumnInTable(activeTable.id, selectedColIndex, targetIdx);
  };

  const generateDDL = () => {
    const tblFks = relations.filter((r) => r.toTableId === activeTable.id);

    const pk = activeTable.columns.filter(c => c.isPrimaryKey);
    const pending = activeTable.modeling?.pendingRules?.length;
    const boundary = pending
      ? tr(
          `${sqlDialect === 'prisma' ? '//' : '--'} 有 ${pending} 项业务规则未由此结构实现，详见数据库设计审查。\n`,
          `${sqlDialect === 'prisma' ? '//' : '--'} ${pending} business rule(s) are not enforced by this schema; see Schema Design Review.\n`
        )
      : '';
    if (sqlDialect === 'prisma') {
      const prismaHeader = isEn
        ? `// Prisma Schema · Live-generated from Schema Designer [${activeTable.cnName}]\n// Shared by module menus: ${activeTable.sharedByMenus.map((m) => m.menuTitle).join(' | ')}`
        : `// Prisma Schema · 由 Navicat 表设计器【${activeTable.cnName}】实时生成\n// 共用此表的模块菜单: ${activeTable.sharedByMenus.map((m) => m.menuTitle).join(' | ')}`;
      return `${boundary}${prismaHeader}

model ${activeTable.tableName
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join('')} {
${activeTable.columns
  .map((c) => {
    const prismaType = c.dataType.startsWith('BIGINT') ? 'BigInt' : c.dataType.startsWith('INT')
      ? 'Int'
      : c.dataType.startsWith('DECIMAL')
      ? 'Decimal'
      : c.dataType.startsWith('DATE')
      ? 'DateTime'
      : 'String';
    return `  ${c.name.padEnd(26)} ${prismaType}${c.nullable ? '?' : ''} ${
      c.isPrimaryKey && pk.length === 1 ? '@id' : c.isUnique ? '@unique' : ''
    } // ${c.comment}`;
  })
  .join('\n')}

${uniqueKeys.map(k => `  @@unique([${k.columns.map(c => c.name).join(', ')}], map: "${k.name}")\n`).join('')}${pk.length > 1 ? `  @@id([${pk.map(c => c.name).join(', ')}])\n` : ''}  @@map("${activeTable.tableName}")
}`;
    }

    const quote = (name: string) => sqlIdentifier(name, sqlDialect);
    const colLines = activeTable.columns.map((c) => {
      const nullStr = c.nullable ? 'NULL' : 'NOT NULL';
      const pkStr = c.isPrimaryKey && pk.length === 1 ? 'PRIMARY KEY' : c.isUnique ? 'UNIQUE' : '';
      const declaredDefault = columnDefaultSql(c);
      const defStr = declaredDefault ? `DEFAULT ${declaredDefault}` : '';
      const commentStr =
        sqlDialect === 'mysql' ? `COMMENT '${c.comment.replace(/'/g, '')}'` : '';
      return `  ${quote(c.name)} ${c.dataType} ${nullStr} ${pkStr} ${defStr} ${commentStr}`
        .replace(/\s+/g, ' ')
        .trimEnd();
    });

    const idxLines = sqlDialect === 'mysql' ? localIndexes.map(ix =>
      `  ${ix.indexType === 'FULLTEXT' ? 'FULLTEXT ' : ''}KEY ${quote(ix.name)} (${ix.columnNames})`) : [];
    const fkLines = tblFks.map(fk =>
      `  CONSTRAINT ${quote(fk.name)} FOREIGN KEY (${quote(fk.toColumnName)}) REFERENCES ${quote(dbTables.find(t => t.id === fk.fromTableId)!.tableName)} (${quote(fk.fromColumnName)})${fk.onDelete ? ' ON DELETE ' + fk.onDelete : ''}`);
    const compoundKey = pk.length > 1 ? ['  PRIMARY KEY (' + pk.map(c => quote(c.name)).join(', ') + ')'] : [];
    const allBodyLines = [...colLines, ...compoundKey, ...uniqueConstraintSql(activeTable, sqlDialect), ...idxLines, ...fkLines];
    const tableOptions = sqlDialect === 'mysql' ? ` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='${activeTable.cnName.replace(/'/g, "''")}'` : '';
    const pgIndexes = sqlDialect === 'postgres' ? localIndexes.map(ix => ix.indexType === 'FULLTEXT'
      ? tr(`\n-- ${ix.name}：全文索引需明确 PostgreSQL 分词配置及表达式。`, `\n-- ${ix.name}: Full-text index requires explicit PostgreSQL text search config and expression.`)
      : `\nCREATE INDEX ${quote(ix.name)} ON ${quote(activeTable.tableName)} (${ix.columnNames});`).join('') : '';

    const ddlComments = isEn
      ? `-- =====================================================================
-- Navicat Data Modeler · Physical Table DDL: ${activeTable.tableName} (${activeTable.cnName})
-- Domain: ${td(activeTable.domain)}
-- Shared by Module Menus (${activeTable.sharedByMenus.length}):
${activeTable.sharedByMenus
  .map((m) => `--   • [${m.accessMode}] ${m.menuTitle}`)
  .join('\n')}
-- =====================================================================`
      : `-- =====================================================================
-- Navicat Data Modeler · 物理表 DDL: ${activeTable.tableName} (${activeTable.cnName})
-- 所属业务域: ${activeTable.domain}
-- 共用该表的模块菜单 (${activeTable.sharedByMenus.length}个):
${activeTable.sharedByMenus
  .map((m) => `--   • [${m.accessMode}] ${m.menuTitle}`)
  .join('\n')}
-- =====================================================================`;

    return `${boundary}${ddlComments}

CREATE TABLE ${quote(activeTable.tableName)} (
${allBodyLines.join(',\n')}
)${tableOptions};${pgIndexes}`;
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(generateDDL());
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 1800);
  };

  // Muted domain accent used only as a thin strip / dot (never as a large fill)
  const domainAccentColor = (domain: DBTableSchema['domain']) => {
    if (domain.includes('MDM')) return '#6366f1';
    if (domain.includes('SRM')) return '#0ea5e9';
    return '#10b981';
  };

  return (
    <div
      className="flex-1 min-w-0 flex flex-col h-full bg-slate-50 overflow-hidden select-none"
      onClick={() => setContextMenu(null)}
    >
      <div className="shrink-0 bg-white border-b border-slate-200/90 shadow-2xs" data-db-toolbar>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-50/70 via-white to-blue-50/20">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-2xs">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-tight text-slate-900">{tr('数据模型', 'Data Model')}</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 border border-slate-200/80 whitespace-nowrap shrink-0">
                  {tr('ER 实体关系图', 'ER Diagram')}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                {tr(
                  `${dbTables.length} 张表 · ${relations.length} 条关系 · ${areas.length} 个业务域`,
                  `${dbTables.length} tables · ${relations.length} relations · ${areas.length} domains`
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" onClick={handleRunHermesDbScan} title={tr('扫描页面需求便签与画布控件，补齐物理表字段', 'Scan page sticky rules and canvas widgets to complete physical table columns')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200/90 bg-white font-medium text-slate-700 shadow-2xs transition hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-700 whitespace-nowrap shrink-0 cursor-pointer"><Sparkles size={14} className="text-blue-600 shrink-0" />{tr('AI 补全字段', 'AI Fields')}</button>
            <button type="button" onClick={handleAutoLayout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-200/90 bg-blue-50/80 font-medium text-blue-700 transition hover:bg-blue-100/80 whitespace-nowrap shrink-0 cursor-pointer"><LayoutGrid size={14} className="shrink-0" />{tr('自动排布', 'Auto Layout')}</button>
            <button type="button" onClick={() => setSplitLayout(splitLayout === 'canvas_max' ? 'split' : 'canvas_max')} disabled={!activeTable} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 font-semibold text-white shadow-2xs transition hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"><Table2 size={14} className="shrink-0" />{splitLayout === 'canvas_max' ? tr('编辑表结构', 'Edit Schema') : tr('收起编辑区', 'Hide Panel')}</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-100 bg-slate-50/50 px-4 py-1.5 text-[11px] text-slate-600">
          <div className="flex flex-wrap items-center gap-1">
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-200/80 bg-white p-0.5 shadow-2xs">
              {([{tool:'select',label:tr('选择','Select'),icon:MousePointer},{tool:'pan',label:tr('平移','Pan'),icon:Hand},{tool:'new_table',label:tr('建表','Table'),icon:Plus},{tool:'link_fk',label:tr('连线','Relation'),icon:Link2}] as const).map(({tool,label,icon:Icon}) => <button key={tool} type="button" aria-pressed={activeTool === tool} onClick={() => setActiveTool(tool)} className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium whitespace-nowrap shrink-0 transition cursor-pointer ${activeTool === tool ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}><Icon size={13} className="shrink-0" />{label}</button>)}
            </div>
            <button type="button" onClick={() => setCanvasNotes(prev => [...prev, {id:crypto.randomUUID(),x:48,y:Math.max(0,...areas.map(a=>a.y+a.height))+40,title:tr('模型批注','Schema Note'),text:tr('点击编辑批注内容','Click to edit note'),color:'amber'}])} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200/80 bg-white hover:bg-amber-50/60 hover:border-amber-200 hover:text-amber-800 whitespace-nowrap shrink-0 transition cursor-pointer"><StickyNote size={13} className="text-amber-500 shrink-0" />{tr('批注', 'Notes')}</button>
            <span className="mx-1 h-4 border-l border-slate-200 shrink-0" />
            <button type="button" aria-pressed={snapToGrid} onClick={() => setSnapToGrid(!snapToGrid)} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border whitespace-nowrap shrink-0 transition cursor-pointer ${snapToGrid ? 'border-blue-200 text-blue-700 bg-blue-50/80 font-medium' : 'border-transparent hover:bg-slate-100'}`}><Magnet size={13} className="shrink-0" />{tr('吸附', 'Snap')}</button>
            <button type="button" aria-pressed={showDomainSwimlanes} onClick={() => setShowDomainSwimlanes(!showDomainSwimlanes)} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border whitespace-nowrap shrink-0 transition cursor-pointer ${showDomainSwimlanes ? 'border-blue-200 text-blue-700 bg-blue-50/80 font-medium' : 'border-transparent hover:bg-slate-100'}`}><ListFilter size={13} className="shrink-0" />{tr('业务分区', 'Domains')}</button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex items-center bg-slate-200/70 rounded-lg p-0.5 border border-slate-200/80" aria-label={tr('字段显示范围', 'Column visibility')}>
              {([{value:'keys_only',label:tr('主外键','Keys')},{value:'all',label:tr('全部字段','All Cols')},{value:'header_only',label:tr('仅表名','Title')}] as const).map(({value,label}) => <button key={value} type="button" aria-pressed={tableViewLevel === value} onClick={() => {setPositions({});setTableViewLevel(value);}} className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap shrink-0 transition cursor-pointer ${tableViewLevel === value ? 'bg-white text-blue-700 font-semibold shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}>{label}</button>)}
            </div>
            <button type="button" onClick={() => fitCanvas()} title={tr('适应画布，显示全部表', 'Fit all tables in canvas')} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200/80 bg-white hover:bg-slate-100 whitespace-nowrap shrink-0 transition cursor-pointer"><Scan size={13} className="shrink-0" />{tr('适应', 'Fit')}</button>
            <button type="button" onClick={() => activeTable && focusTable(activeTable.id)} disabled={!activeTable} title={tr('以 100% 定位选中表', 'Center selected table at 100%')} className="p-1.5 rounded-lg border border-slate-200/80 bg-white hover:bg-slate-100 disabled:opacity-40 shrink-0 transition cursor-pointer"><LocateFixed size={13} /></button>
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-200/80 bg-white px-1 py-0.5 shrink-0">
              <button type="button" title={tr('缩小画布', 'Zoom out')} onClick={() => setZoom(z=>Math.max(0.1,z-0.1))} className="p-1 rounded hover:bg-slate-100 cursor-pointer"><ZoomOut size={13} /></button>
              <button type="button" title={tr('重置为 100%', 'Reset to 100%')} onClick={() => setZoom(1)} className="w-10 text-center font-mono font-semibold text-slate-700 tabular-nums cursor-pointer">{Math.round(zoom*100)}%</button>
              <button type="button" title={tr('放大画布', 'Zoom in')} onClick={() => setZoom(z=>Math.min(2,z+0.1))} className="p-1 rounded hover:bg-slate-100 cursor-pointer"><ZoomIn size={13} /></button>
            </div>
          </div>
        </div>
      </div>
      {dbTables.length > 0 && <details className="shrink-0 px-4 py-2 text-xs bg-white border-b border-slate-200">
        <summary className="cursor-pointer font-semibold text-slate-700 tabular-nums">
          {tr(
            `数据库设计审查 · ${designErrors.length} 项结构问题 · ${design.risks.length} 项待复核`,
            `Schema Design Review · ${designErrors.length} structural issues · ${design.risks.length} to review`
          )}
        </summary>
        <div className="max-h-52 overflow-y-auto select-text space-y-2 pt-2">
          {trace.lines.length > 0 && <details><summary className="cursor-pointer tabular-nums">{tr(`需求原文与约束核对（${trace.lines.length} 条）`, `Requirement & Constraint Check (${trace.lines.length})`)}</summary>
            {trace.conflicts.map((line,i)=><p key={i} className="text-red-700">{tr('案例冲突 · ', 'Case conflict · ')}{td(line)}</p>)}
            {trace.lines.map((line,i)=><p key={i} className="mt-1 whitespace-pre-wrap">{td(line)}</p>)}
          </details>}
          {designErrors.map((issue, i) => <p key={i} className="text-red-700">{tr('结构问题 · ', 'Structural issue · ')}{td(issue)}</p>)}
          {design.risks.map((risk, i) => <p key={i} className="text-amber-800">{tr('待复核 · ', 'Needs review · ')}{td(risk)}</p>)}
          {dbTables.map(table => table.modeling && <p key={table.id}><strong>{table.tableName} · {td(table.modeling.entity)}</strong>{tr('　', ' — ')}{td(table.modeling.grain)}{tr('。', '. ')}{td(table.modeling.reason)}</p>)}
          <p className="text-slate-500">{tr('根据工程中声明的键、字段和关系检查。查询的实际连接条件和指标口径需结合业务需求复核。', 'Checked against declared keys, columns, and relations in the project. Actual query join conditions and metrics should be verified against business requirements.')}</p>
        </div>
      </details>}

      {schemaError && <div role="alert" className="px-4 py-2 text-xs text-red-700 bg-red-50">{td(schemaError)}</div>}
      {/* Hermes / AI Scan Execution Report Banner */}
      {dbScanReport && (
        <div className="px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2 flex-wrap shadow-2xs">
          <div className="flex items-center gap-2 flex-wrap">
            <Bot className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{td(dbScanReport.summary)}</span>
            <button
              type="button"
              onClick={() => setHermesModalOpen(true, 'overview')}
              className="px-2 py-0.5 rounded-full bg-white text-emerald-800 border border-emerald-300 font-mono text-[10px] font-semibold hover:bg-emerald-100 cursor-pointer"
            >
              {td(dbScanReport.engineBadge)}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setDbScanReport(null)}
            className="text-emerald-600 hover:text-emerald-900 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* =====================================================================
          2. INTERACTIVE NAVICAT ER DIAGRAM CANVAS (PAN, ZOOM, DRAG, DROP, CONTEXT MENU)
         ===================================================================== */}
      {splitLayout !== 'inspector_max' && (
        <div
          ref={canvasRef}
          data-db-canvas
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) setZoom(z => Math.max(0.1, Math.min(2, z * Math.exp(-e.deltaY / 400))));
            else setPanOffset(p => ({ x:p.x-e.deltaX, y:p.y-e.deltaY }));
          }}
          onMouseDown={handleCanvasBackgroundMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
          onContextMenu={(e) => {
            e.preventDefault();
            const coords = clientToCanvasCoords(e.clientX, e.clientY);
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              canvasX: coords.x,
              canvasY: coords.y,
              targetType: 'canvas',
            });
          }}
          className={`relative w-full bg-slate-50 overflow-hidden ${
            splitLayout === 'canvas_max' ? 'flex-1' : 'h-[48%] min-h-[180px] shrink-0'
          } ${
            activeTool === 'pan'
              ? isPanning
                ? 'cursor-grabbing'
                : 'cursor-grab'
              : activeTool === 'new_table'
              ? 'cursor-crosshair'
              : 'cursor-default'
          }`}
          style={{
            backgroundImage:
              'radial-gradient(var(--pf-canvas-dot) 1px, transparent 1px), linear-gradient(to right, var(--pf-canvas-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--pf-canvas-grid) 1px, transparent 1px)',
            backgroundSize: '20px 20px, 100px 100px, 100px 100px',
          }}
        >
          {!dbTables.length && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6">
              <div className="flex max-w-sm flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white/90 px-8 py-7 text-center shadow-xs backdrop-blur-xs">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 border border-blue-200/70">
                  <Database size={24} />
                </div>
                <p className="text-sm font-bold text-slate-800">{tr('还没有数据表', 'No tables yet')}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {tr('点击工具栏「建表」，在画布中创建第一张表', 'Click "Table" in the toolbar to place your first table on the canvas')}
                </p>
              </div>
            </div>
          )}
          {/* Floating Active Tool Banner */}
          {(activeTool === 'new_table' || activeTool === 'link_fk' || fkDragSource) && (
            <div onMouseDown={(e) => e.stopPropagation()} className="absolute top-3 left-4 z-40 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium shadow-md">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>
                {activeTool === 'new_table'
                  ? tr('➕ 请在画布任意空白位置点击，即可在该坐标放置新物理表（右键可取消）', '➕ Click any blank spot on the canvas to place a new physical table (right-click to cancel)')
                  : fkDragSource
                  ? tr(`🔗 正在从 [${fkDragSource.tableId}.${fkDragSource.colName}] 拉出外键连线，请移动到目标表的字段上松开鼠标！`, `🔗 Dragging foreign key from [${fkDragSource.tableId}.${fkDragSource.colName}] — release over a target table column!`)
                  : tr('🔗 请按住任意表字段左右两侧的圆点 (●) 拖拽到另一张表的字段上建立 1:N 外键关系', '🔗 Drag from any column port dot (●) to another table column to create a 1:N foreign key relation')}
              </span>
            </div>
          )}

          {/* Selected Relation Floating Property Bar */}
          {selectedRelation && (
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()} className="absolute top-3 left-4 right-4 z-40 flex flex-wrap items-center gap-3 px-3.5 py-2 rounded-lg bg-white border border-slate-200 text-xs shadow-lg"
            >
              <span className="font-mono font-semibold text-slate-900">
                {tr(`🔗 外键关系: ${selectedRelation.name}`, `🔗 Foreign Key: ${selectedRelation.name}`)}
              </span>
              <span className="text-slate-700 font-mono text-[11px]">
                {selectedRelation.fromTableId}({selectedRelation.fromColumnName}) →{' '}
                {selectedRelation.toTableId}({selectedRelation.toColumnName})
              </span>
              <select
                value={selectedRelation.cardinality ?? ''}
                onChange={(e) =>
                  updateRelation(selectedRelation, { cardinality: e.target.value as '1:N' | '1:1' })
                }
                className="px-2 py-0.5 rounded bg-slate-50 border border-slate-300 text-slate-900 text-[11px]"
              >
                <option value="" disabled>{tr('基数未设置', 'Cardinality unset')}</option>
                <option value="1:N">{tr('1 : N (一对多鸦爪)', "1 : N (One-to-Many Crow's Foot)")}</option>
                <option value="1:1">{tr('1 : 1 (一对一)', '1 : 1 (One-to-One)')}</option>
              </select>
              <select
                value={selectedRelation.onDelete ?? ''}
                onChange={(e) =>
                  updateRelation(selectedRelation, { onDelete: e.target.value as 'RESTRICT' | 'CASCADE' | 'SET NULL' })
                }
                className="px-2 py-0.5 rounded bg-slate-50 border border-slate-300 text-slate-900 text-[11px]"
              >
                <option value="" disabled>{tr('删除策略未设置', 'On Delete unset')}</option>
                <option value="RESTRICT">ON DELETE RESTRICT</option>
                <option value="CASCADE">ON DELETE CASCADE</option>
                <option value="SET NULL" disabled={!dbTables.find(t=>t.id===selectedRelation.toTableId)?.columns.find(c=>c.id===selectedRelation.toColumnId)?.nullable}>ON DELETE SET NULL</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  removeRelation(selectedRelation);
                  setSelectedRelationId(null);
                }}
                className="px-2 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                {tr('删除连线', 'Delete Relation')}
              </button>
            </div>
          )}

          <div
            data-db-stage className="absolute inset-0 origin-top-left"
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            }}
          >
            {showDomainSwimlanes && areas.map(area => <div key={area.domain} data-db-domain={area.domain} style={{left:area.x,top:area.y,width:area.width,height:area.height}} className="absolute rounded-xl border border-dashed border-slate-300 bg-slate-100/40 pointer-events-none px-4 py-2"><span className="text-[11px] font-semibold text-slate-500">{td(area.domain)}<span className="ml-2 font-normal text-slate-400 tabular-nums">{tr(`${area.count} 张表`, `${area.count} tables`)}</span></span></div>)}

            {/* 1. SVG Layer: Field-to-Field Bezier Connectors + Crow's Foot (1:N) + Live Rubberband */}
            <svg data-db-relations className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible">
              <defs>
                <linearGradient id="erLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" style={{ stopColor: 'var(--pf-er-line)' }} />
                  <stop offset="100%" style={{ stopColor: 'var(--pf-er-line)' }} />
                </linearGradient>
                <linearGradient id="erLineActive" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" style={{ stopColor: 'var(--pf-er-line-active)' }} />
                  <stop offset="100%" style={{ stopColor: 'var(--pf-er-line-active)' }} />
                </linearGradient>
              </defs>

              {relations.map((rel) => {
                const fromPos = getTablePos(rel.fromTableId);
                const toPos = getTablePos(rel.toTableId);

                const sameColumn = Math.abs(fromPos.x - toPos.x) < CARD_WIDTH;
                const exitRight = fromPos.x <= toPos.x;
                const start = getColumnAnchorPoint(
                  rel.fromTableId,
                  rel.fromColumnName,
                  exitRight ? 'right' : 'left'
                );
                const end = getColumnAnchorPoint(
                  rel.toTableId,
                  rel.toColumnName,
                  sameColumn ? (exitRight ? 'right' : 'left') : (exitRight ? 'left' : 'right')
                );

                if (!start || !end) return null;
                const dx = Math.max(65, Math.abs(end.x - start.x) * 0.45);
                const c1x = exitRight ? start.x + dx : start.x - dx;
                const c2x = sameColumn ? c1x : (exitRight ? end.x - dx : end.x + dx);
                const pathD = `M ${start.x} ${start.y} C ${c1x} ${start.y}, ${c2x} ${end.y}, ${end.x} ${end.y}`;

                const midX = (start.x + 3*c1x + 3*c2x + end.x) / 8;
                const midY = (start.y + end.y) / 2;

                const isHighlighted =
                  hoveredRelationId === rel.id ||
                  selectedRelationId === rel.id ||
                  selectedTableId === rel.fromTableId ||
                  selectedTableId === rel.toTableId;

                const dir = sameColumn ? (exitRight ? 1 : -1) : (exitRight ? -1 : 1);
                const crowFootD =
                  rel.cardinality === '1:N'
                    ? `
                  M ${end.x + dir * 12} ${end.y} L ${end.x} ${end.y - 6}
                  M ${end.x + dir * 12} ${end.y} L ${end.x} ${end.y}
                  M ${end.x + dir * 12} ${end.y} L ${end.x} ${end.y + 6}
                  M ${end.x + dir * 15} ${end.y - 6} L ${end.x + dir * 15} ${end.y + 6}
                `
                    : rel.cardinality === '1:1' ? `
                  M ${end.x + dir * 8} ${end.y - 6} L ${end.x + dir * 8} ${end.y + 6}
                  M ${end.x + dir * 12} ${end.y - 6} L ${end.x + dir * 12} ${end.y + 6}
                ` : '';

                const oneSideDir = exitRight ? 1 : -1;
                const oneTickD = `
                  M ${start.x + oneSideDir * 8} ${start.y - 6} L ${start.x + oneSideDir * 8} ${start.y + 6}
                  M ${start.x + oneSideDir * 12} ${start.y - 6} L ${start.x + oneSideDir * 12} ${start.y + 6}
                `;

                return (
                  <g
                    key={rel.id}
                    data-db-relation={rel.id}
                    onMouseDown={e => e.stopPropagation()}
                    className="pointer-events-auto cursor-pointer"
                    onMouseEnter={() => setHoveredRelationId(rel.id)}
                    onMouseLeave={() => setHoveredRelationId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedRelationId(rel.id);
                    }}
                  >
                    <path d={pathD} stroke="transparent" strokeWidth="14" fill="none" />

                    {isHighlighted && (
                      <path
                        d={pathD}
                        style={{ stroke: 'var(--pf-er-line-halo)' }}
                        strokeWidth="7"
                        fill="none"
                      />
                    )}

                    <path
                      d={pathD}
                      stroke={isHighlighted ? 'url(#erLineActive)' : 'url(#erLineGrad)'}
                      strokeWidth={isHighlighted ? '2.5' : '1.8'}
                      fill="none"
                    />

                    <path d={rel.cardinality ? oneTickD : ''} style={{ stroke: isHighlighted ? 'var(--pf-er-line-active)' : 'var(--pf-er-line-strong)' }} strokeWidth="1.6" fill="none" />
                    <path d={crowFootD} style={{ stroke: isHighlighted ? 'var(--pf-er-line-active)' : 'var(--pf-er-line-strong)' }} strokeWidth="1.6" fill="none" />

                    <circle cx={start.x} cy={start.y} r="3" style={{ fill: isHighlighted ? 'var(--pf-er-line-active)' : 'var(--pf-er-line-strong)' }} />
                    <circle cx={end.x} cy={end.y} r="3" style={{ fill: isHighlighted ? 'var(--pf-er-line-active)' : 'var(--pf-er-line-strong)' }} />

                    {/* Compact Relationship Cardinality Pill */}
                    {isHighlighted && <g transform={`translate(${midX - 42}, ${midY - 10})`}>
                      <rect
                        width="84"
                        height="18"
                        rx="5"
                        style={{
                          fill: 'var(--pf-er-pill-bg)',
                          stroke: isHighlighted ? 'var(--pf-er-line-active)' : 'var(--pf-er-pill-border)',
                        }}
                        strokeWidth="1.2"
                      />
                      <text
                        x="42"
                        y="12.5"
                        textAnchor="middle"
                        style={{
                          fill: isHighlighted ? 'var(--pf-er-line-active)' : 'var(--pf-er-pill-text)',
                        }}
                        fontSize="9"
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        fontWeight="600"
                      >
                        {rel.cardinality ?? 'FK'}{rel.onDelete ? ` · ${rel.onDelete}` : ''}
                      </text>
                    </g>}
                  </g>
                );
              })}

              {/* Live Rubber-Band FK Line when dragging from a field port dot */}
              {fkDragSource && (
                <g>
                  <path
                    d={`M ${fkDragSource.startX} ${fkDragSource.startY} C ${
                      (fkDragSource.startX + mouseCanvasPos.x) / 2
                    } ${fkDragSource.startY}, ${
                      (fkDragSource.startX + mouseCanvasPos.x) / 2
                    } ${mouseCanvasPos.y}, ${mouseCanvasPos.x} ${mouseCanvasPos.y}`}
                    style={{ stroke: 'var(--pf-er-line-active)' }}
                    strokeWidth="2"
                    strokeDasharray="6 4"
                    fill="none"
                  />
                  <circle
                    cx={mouseCanvasPos.x}
                    cy={mouseCanvasPos.y}
                    r="5"
                    style={{ fill: 'var(--pf-er-line-active)' }}
                  />
                </g>
              )}
            </svg>

            {/* 2. Draggable Navicat Canvas Notes */}
            {canvasNotes.map((note) => (
              <div
                key={note.id}
                onMouseDown={(e) => handleNoteMouseDown(e, note.id)}
                style={{ left: `${note.x}px`, top: `${note.y}px` }}
                className="absolute z-10 w-64 p-3 rounded-xl bg-amber-50 text-slate-800 border border-amber-200 shadow-sm cursor-grab active:cursor-grabbing space-y-1"
              >
                <div className="flex items-center justify-between border-b border-amber-200 pb-1">
                  <span className="font-bold text-[11px] text-slate-900">
                    {note.title}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCanvasNotes((prev) => prev.filter((n) => n.id !== note.id));
                    }}
                    className="text-[10px] text-amber-900 hover:text-rose-700 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
                <textarea aria-label={tr('批注内容', 'Note content')} value={note.text} onMouseDown={e=>e.stopPropagation()} onChange={e=>setCanvasNotes(notes=>notes.map(n=>n.id===note.id?{...n,text:e.target.value}:n))} className="w-full h-24 resize-none bg-transparent text-[11px] leading-snug text-slate-800 outline-none" />
              </div>
            ))}

            {/* 3. Draggable Navicat Table Entity Cards */}
            {dbTables.map((table) => {
              const pos = getTablePos(table.id);
              const isSelected = table.id === selectedTableId;
              const isDragging = table.id === draggingTableId;
              const visCols = getVisibleColumns(table);

              return (
                <div
                  key={table.id}
                  data-db-table={table.id}
                  onMouseDown={e => { if (activeTool !== 'pan') e.stopPropagation(); }}
                  onDoubleClick={e => { if ((e.target as HTMLElement).closest('[data-db-field]')) return; setSelectedTableId(table.id); setSplitLayout('split'); }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTableId(table.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedTableId(table.id);
                    const coords = clientToCanvasCoords(e.clientX, e.clientY);
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      canvasX: coords.x,
                      canvasY: coords.y,
                      targetType: 'table',
                      tableId: table.id,
                    });
                  }}
                  style={{
                    width: `${CARD_WIDTH}px`,
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                  }}
                  className={`absolute z-20 rounded-lg bg-white border transition-shadow overflow-visible ${
                    isSelected
                      ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-lg'
                      : 'border-slate-200 hover:border-slate-300 shadow-sm hover:shadow-md'
                  } ${isDragging ? 'cursor-grabbing opacity-95 shadow-xl' : ''}`}
                >
                  {/* Draggable Table Header — neutral surface + thin domain accent strip */}
                  <div
                    onMouseDown={(e) => handleTableMouseDown(e, table.id)}
                    style={{ height: `${HEADER_HEIGHT}px`, borderTopColor: domainAccentColor(table.domain) }}
                    className="px-3 py-2 rounded-t-lg bg-slate-50 border-t-[3px] border-b border-b-slate-200 cursor-grab active:cursor-grabbing flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Table2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span title={table.tableName} className="font-mono font-semibold text-xs text-slate-900 truncate">
                          {table.tableName}
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 shrink-0">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: domainAccentColor(table.domain) }}
                        />
                        {table.domain.match(/\((.*)\)/)?.[1] || table.domain}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600 truncate">
                      {table.cnName}
                    </div>

                    {/* Shared Menus Pills */}
                    <div
                      className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-0.5"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                        {tr(`引用 ${table.sharedByMenus.length}`, `Refs ${table.sharedByMenus.length}`)}
                      </span>
                      {table.sharedByMenus.map((m, idx) => (
                        <button
                          key={`${m.pageId}-${idx}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivePage(m.pageId);
                            setViewMode('single_page');
                          }}
                          className="px-1.5 py-px rounded bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-200 text-[10px] text-slate-600 hover:text-blue-700 whitespace-nowrap transition cursor-pointer"
                          title={tr(`点击跳转到共用该表的菜单：${m.menuTitle}`, `Jump to menu sharing this table: ${m.menuTitle}`)}
                        >
                          {m.menuTitle.split('→')[1]?.trim() || m.menuTitle}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Table Fields List with Left & Right Draggable FK Connector Ports */}
                  {visCols.length > 0 && (
                    <div className="divide-y divide-slate-200 text-[11px]">
                      {visCols.map((col) => {
                        const isEditingName =
                          editingCell?.tableId === table.id &&
                          editingCell?.colId === col.id &&
                          editingCell?.field === 'name';
                        const isEditingType =
                          editingCell?.tableId === table.id &&
                          editingCell?.colId === col.id &&
                          editingCell?.field === 'dataType';

                        return (
                          <div
                            key={col.id}
                            data-db-field={col.name}
                            style={{ height: `${ROW_HEIGHT}px` }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTableId(table.id);
                              setSelectedColumnId(col.id);
                            }}
                            onMouseUp={(e) => {
                              if (fkDragSource) {
                                e.stopPropagation();
                                handleCompleteFkDrop(table, col.name);
                              }
                            }}
                            className={`group relative px-2.5 flex items-center justify-between gap-1.5 transition ${
                              selectedColumnId === col.id && isSelected
                                ? 'bg-blue-50/70'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            {/* Left FK Connector Port Dot (Drag from here to link FK!) */}
                            <div
                              onMouseDown={(e) =>
                                handleStartFkDrag(e, table.id, col.name, 'left')
                              }
                              title={tr('按住此圆点拖拽到其他表字段建立主外键连线', 'Drag from this port to another table column to create a foreign key relation')}
                              className={`absolute top-1/2 -translate-y-1/2 -left-1.5 w-2.5 h-2.5 rounded-full cursor-crosshair transition-transform hover:scale-150 ${
                                col.isPrimaryKey
                                  ? 'bg-amber-500'
                                  : col.isForeignKey
                                  ? 'bg-blue-500'
                                  : `bg-slate-300 group-hover:bg-blue-500 ${activeTool === 'link_fk' || fkDragSource ? '' : 'opacity-0 group-hover:opacity-100'}`
                              }`}
                            />

                            {/* PK / FK Icon + Field Name */}
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              {col.isPrimaryKey ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateColumnInTable(table.id, col.id, {
                                      isPrimaryKey: !col.isPrimaryKey,
                                    });
                                  }}
                                  className="text-amber-600 shrink-0 cursor-pointer"
                                  title={tr('主键 (点击切换)', 'Primary Key (click to toggle)')}
                                >
                                  <Key className="w-3 h-3" />
                                </button>
                              ) : col.isForeignKey ? (
                                <span
                                  className="text-blue-600 shrink-0 font-mono text-[9px] font-bold"
                                  title={tr(`外键 → ${col.references}`, `Foreign Key → ${col.references}`)}
                                >
                                  FK
                                </span>
                              ) : (
                                <span className="w-3 text-center text-slate-500 shrink-0">
                                  ·
                                </span>
                              )}

                              {isEditingName ? (
                                <input
                                  type="text"
                                  autoFocus
                                  defaultValue={col.name}
                                  onBlur={(e) => {
                                    if (e.target.value.trim()) {
                                      updateColumnInTable(table.id, col.id, {
                                        name: e.target.value.trim(),
                                      });
                                    }
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  className="w-28 px-1 py-0 bg-slate-50 border border-blue-500 rounded font-mono text-[11px] text-slate-900"
                                />
                              ) : (
                                <span
                                  onDoubleClick={() =>
                                    setEditingCell({
                                      tableId: table.id,
                                      colId: col.id,
                                      field: 'name',
                                    })
                                  }
                                  className={`font-mono truncate cursor-text ${
                                    col.isPrimaryKey
                                      ? 'font-semibold text-slate-900'
                                      : col.isForeignKey
                                      ? 'font-medium text-blue-700'
                                      : 'text-slate-800'
                                  }`}
                                  title={tr(`${col.name} (${col.comment}) — 双击直接重命名`, `${col.name} (${col.comment}) — double-click to rename`)}
                                >
                                  {col.name}
                                </span>
                              )}
                            </div>

                            {/* Data Type + Nullable */}
                            <div className="flex items-center gap-1 shrink-0">
                              {isEditingType ? (
                                <input
                                  type="text"
                                  autoFocus
                                  defaultValue={col.dataType}
                                  onBlur={(e) => {
                                    if (e.target.value.trim()) {
                                      updateColumnInTable(table.id, col.id, {
                                        dataType: e.target.value.trim().toUpperCase(),
                                      });
                                    }
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  className="w-24 px-1 py-0 bg-slate-50 border border-blue-500 rounded font-mono text-[10px] text-slate-700"
                                />
                              ) : (
                                <span
                                  onDoubleClick={() =>
                                    setEditingCell({
                                      tableId: table.id,
                                      colId: col.id,
                                      field: 'dataType',
                                    })
                                  }
                                  className="font-mono text-[10px] text-slate-500 cursor-text"
                                  title={tr('双击修改数据类型', 'Double-click to edit data type')}
                                >
                                  {col.dataType}
                                </span>
                              )}
                              <span
                                className={`text-[9px] font-mono ${
                                  col.nullable ? 'text-slate-500' : 'text-rose-600 font-bold'
                                }`}
                              >
                                {col.nullable ? 'N' : 'NN'}
                              </span>
                            </div>

                            {/* Right FK Connector Port Dot (Drag from here to link FK!) */}
                            <div
                              onMouseDown={(e) =>
                                handleStartFkDrag(e, table.id, col.name, 'right')
                              }
                              title={tr('按住此圆点拖拽到其他表字段建立主外键连线', 'Drag from this port to another table column to create a foreign key relation')}
                              className={`absolute top-1/2 -translate-y-1/2 -right-1.5 w-2.5 h-2.5 rounded-full cursor-crosshair transition-transform hover:scale-150 ${
                                col.isPrimaryKey
                                  ? 'bg-amber-500'
                                  : col.isForeignKey
                                  ? 'bg-blue-500'
                                  : `bg-slate-300 group-hover:bg-blue-500 ${activeTool === 'link_fk' || fkDragSource ? '' : 'opacity-0 group-hover:opacity-100'}`
                              }`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Card Footer Quick Bar */}
                  <div style={{height:FOOTER_HEIGHT}} className="px-3 py-1 bg-slate-50 rounded-b-lg border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500">
                    <span className="font-mono tabular-nums">
                      {tr(
                        `${table.columns.length} 字段 · ${tableViewLevel === 'all' ? '双击字段编辑' : `显示 ${visCols.length} 项`}`,
                        `${table.columns.length} cols · ${tableViewLevel === 'all' ? 'Double-click to edit' : `${visCols.length} shown`}`
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTableId(table.id);
                        if (tableViewLevel !== 'all') {setSplitLayout('split');setBottomTab('fields');}
                        addColumnToTable(table.id, {
                          name: `col_${table.columns.length + 1}`,
                          dataType: 'VARCHAR(64)',
                          nullable: true,
                          comment: tr('快捷新增字段', 'Quick-added column'),
                          sourceWidgetOrSticky: tr('ER卡片快捷新增', 'ER Card Quick Add'),
                        });
                      }}
                      className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-0.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Plus className="w-3 h-3 shrink-0" />
                      <span>{tr('加字段', 'Add Col')}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Navicat Right-Click Context Menu */}
          {contextMenu && (
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseDown={e=>e.stopPropagation()}
              style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
              className="fixed z-50 w-56 rounded-xl bg-white border border-slate-300 shadow-2xl py-1.5 text-xs text-slate-800"
            >
              {contextMenu.targetType === 'table' && contextMenu.tableId ? (
                <>
                  <div className="px-3 py-1 text-[10px] font-mono font-semibold text-slate-500 border-b border-slate-200 truncate">
                    {tr(`表操作: ${contextMenu.tableId}`, `Table Actions: ${contextMenu.tableId}`)}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTableId(contextMenu.tableId!);
                      setBottomTab('fields');
                      setSplitLayout('split');
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700 flex items-center gap-2 cursor-pointer"
                  >
                    <Table2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{tr('设计表字段 (Design Table)', 'Design Columns')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTableId(contextMenu.tableId!);
                      setBottomTab('data_preview');
                      setSplitLayout('split');
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700 flex items-center gap-2 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{tr('打开表数据网格 (Open Table)', 'Open Table Data')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      duplicateTable(contextMenu.tableId!);
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700 flex items-center gap-2 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{tr('复制表结构 (Duplicate Table)', 'Duplicate Table')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleCopySql();
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700 flex items-center gap-2 cursor-pointer"
                  >
                    <Code2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{tr('复制 CREATE TABLE DDL', 'Copy CREATE TABLE DDL')}</span>
                  </button>
                  <div className="my-1 border-t border-slate-200" />
                  <button
                    type="button"
                    onClick={() => {
                      deleteTable(contextMenu.tableId!);
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-rose-50 text-rose-600 flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{tr('删除物理表 (Delete Table)', 'Delete Table')}</span>
                  </button>
                </>
              ) : (
                <>
                  <div className="px-3 py-1 text-[10px] font-bold text-slate-500 border-b border-slate-200">
                    {tr('Navicat ER 画布操作', 'ER Canvas Actions')}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      let tableNumber = dbTables.length + 1;
                      while (dbTables.some(t=>t.id===`t_wms_table_${tableNumber}` || t.tableName===`t_wms_table_${tableNumber}`)) tableNumber++;
                      const newTblName = `t_wms_table_${tableNumber}`;
                      createNewTable(
                        newTblName,
                        tr(`新建物理表_${dbTables.length + 1}`, `New_Table_${dbTables.length + 1}`),
                        '仓储验收域 (WMS)'
                      );
                      setPositions((prev) => ({
                        ...prev,
                        [newTblName]: {
                          x: contextMenu.canvasX,
                          y: contextMenu.canvasY,
                        },
                      }));
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700 flex items-center gap-2 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{tr('在此坐标新建物理表 (New Table)', 'New Table Here')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCanvasNotes((prev) => [
                        ...prev,
                        {
                          id: `cnote-${Date.now()}`,
                          x: contextMenu.canvasX,
                          y: contextMenu.canvasY,
                          title: tr('📝 模型设计批注', '📝 Schema Design Note'),
                          text: tr('在此记录索引策略或跨模块共表约束。', 'Document indexing strategies or cross-module shared table constraints here.'),
                          color: 'amber',
                        },
                      ]);
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700 flex items-center gap-2 cursor-pointer"
                  >
                    <StickyNote className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{tr('在此处添加画布便签 (New Note)', 'Add Note Here')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleAutoLayout();
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700 flex items-center gap-2 cursor-pointer"
                  >
                    <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{tr('自动正交排列所有表 (Auto Layout)', 'Auto Layout All Tables')}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {splitLayout !== 'inspector_max' && <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-2 text-[10px] text-slate-500"><span>{tr('拖动表头移动 · 双击表卡编辑 · 滚轮平移 · Ctrl / ⌘ + 滚轮缩放', 'Drag header to move · Double-click card to edit · Wheel to pan · Ctrl / ⌘ + wheel to zoom')}</span><span className="flex items-center gap-3"><span className="flex items-center gap-1"><Key size={11} className="text-amber-600" />{tr('主键', 'PK')}</span><span className="flex items-center gap-1"><Link2 size={11} className="text-blue-500" />{tr('外键', 'FK')}</span></span></div>}
      {/* =====================================================================
          3. AUTHENTIC NAVICAT "DESIGN TABLE (设计表)" MULTI-TAB WORKBENCH
         ===================================================================== */}
      {splitLayout !== 'canvas_max' && activeTable && (
        <div className="flex-1 flex flex-col bg-white border-t-2 border-slate-200 overflow-hidden min-h-[240px]">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 text-xs"><span className="text-slate-500 min-w-0 truncate">{tr('表结构', 'Table Schema')} <span className="ml-2 text-slate-800 font-medium">{activeTable.cnName}</span></span><button type="button" onClick={()=>setSplitLayout(splitLayout === 'inspector_max' ? 'split' : 'inspector_max')} className="flex items-center gap-1 text-slate-500 hover:text-blue-600 whitespace-nowrap shrink-0 cursor-pointer"><Maximize2 size={12}/>{splitLayout === 'inspector_max' ? tr('返回分栏', 'Split View') : tr('展开编辑区', 'Expand Editor')}</button></div>
          {/* Navicat Table Designer Header + Field Action Bar + 6 Tabs */}
          <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
            {/* Left: Active Table Editable Name & Navicat Field Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 pr-2 border-r border-slate-200">
                <Database className="w-4 h-4 text-blue-600 shrink-0" />
                <input
                  type="text"
                  value={activeTable.tableName}
                  onChange={(e) =>
                    updateTableMeta(activeTable.id, { tableName: e.target.value })
                  }
                  className="w-44 px-1.5 py-0.5 rounded bg-white border border-slate-200 font-mono font-semibold text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                  title={tr('直接修改物理表名', 'Edit physical table name')}
                />
                <input
                  type="text"
                  value={activeTable.cnName}
                  onChange={(e) =>
                    updateTableMeta(activeTable.id, { cnName: e.target.value })
                  }
                  className="w-44 px-1.5 py-0.5 rounded bg-white border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                  title={tr('直接修改中文表注释', 'Edit table display name / comment')}
                />
              </div>

              {/* Navicat Classic Field Operations Bar */}
              {bottomTab === 'fields' && (
                <div className="flex items-center gap-1 text-[11px] flex-wrap">
                  <button
                    type="button"
                    onClick={handleNavicatAddField}
                    className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3 h-3 shrink-0" />
                    <span>{tr('添加字段', 'Add Col')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleNavicatInsertField}
                    className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>{tr('插入字段', 'Insert')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleNavicatDeleteField}
                    className="px-2 py-1 rounded bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-300 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3 shrink-0" />
                    <span>{tr('删除字段', 'Delete')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleNavicatTogglePk}
                    className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                    title={tr('切换选中字段的主键 (Primary Key) 状态', 'Toggle Primary Key status on selected column')}
                  >
                    <Key className="w-3 h-3 shrink-0" />
                    <span>{tr('主键', 'PK')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavicatMoveCol(-1)}
                    className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 shrink-0 cursor-pointer"
                    title={tr('上移选中字段', 'Move column up')}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavicatMoveCol(1)}
                    className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 shrink-0 cursor-pointer"
                    title={tr('下移选中字段', 'Move column down')}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Right: 6 Authentic Navicat Table Designer Tabs */}
            <div className="flex items-center overflow-x-auto max-w-full no-scrollbar bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px] tabular-nums">
              <button
                type="button"
                onClick={() => setBottomTab('fields')}
                className={`px-2.5 py-1 rounded-md whitespace-nowrap shrink-0 transition cursor-pointer ${
                  bottomTab === 'fields'
                    ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {tr(`1. 字段 (${activeTable.columns.length})`, `1. Columns (${activeTable.columns.length})`)}
              </button>
              <button
                type="button"
                onClick={() => setBottomTab('foreign_keys')}
                className={`px-2.5 py-1 rounded-md whitespace-nowrap shrink-0 transition cursor-pointer ${
                  bottomTab === 'foreign_keys'
                    ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {tr(
                  `2. 外键 (${relations.filter((r) => r.toTableId === activeTable.id).length})`,
                  `2. Foreign Keys (${relations.filter((r) => r.toTableId === activeTable.id).length})`
                )}
              </button>
              <button
                type="button"
                onClick={() => setBottomTab('indexes')}
                className={`px-2.5 py-1 rounded-md whitespace-nowrap shrink-0 transition cursor-pointer ${
                  bottomTab === 'indexes'
                    ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {tr(
                  `3. 索引 (${localIndexes.length + uniqueKeys.length})`,
                  `3. Indexes & Unique (${localIndexes.length + uniqueKeys.length})`
                )}
              </button>
              <button
                type="button"
                onClick={() => setBottomTab('data_preview')}
                className={`px-2.5 py-1 rounded-md whitespace-nowrap shrink-0 transition cursor-pointer ${
                  bottomTab === 'data_preview'
                    ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {tr('4. 打开表数据', '4. Table Data')}
              </button>
              <button
                type="button"
                onClick={() => setBottomTab('shared_menus')}
                className={`px-2.5 py-1 rounded-md whitespace-nowrap shrink-0 transition cursor-pointer ${
                  bottomTab === 'shared_menus'
                    ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {tr(`5. 共表菜单 (${activeTable.sharedByMenus.length})`, `5. Shared Menus (${activeTable.sharedByMenus.length})`)}
              </button>
              <button
                type="button"
                onClick={() => setBottomTab('sql_ddl')}
                className={`px-2.5 py-1 rounded-md whitespace-nowrap shrink-0 transition cursor-pointer ${
                  bottomTab === 'sql_ddl'
                    ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {tr('6. SQL 预览', '6. SQL / DDL')}
              </button>
            </div>
          </div>

          {/* =================================================================
              TAB 1: NAVICAT FIELDS SPREADSHEET GRID (WITH DRAG-REORDERING!)
             ================================================================= */}
          {bottomTab === 'fields' && (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="py-2 px-2 w-10 text-center">{tr('排序', 'Order')}</th>
                    <th className="py-2 px-2.5">{tr('名 (Field Name)', 'Column Name')}</th>
                    <th className="py-2 px-2.5">{tr('类型 (Data Type)', 'Data Type')}</th>
                    <th className="py-2 px-2 text-center">{tr('不是 null', 'Not Null')}</th>
                    <th className="py-2 px-2 text-center">{tr('键 (Key)', 'Key')}</th>
                    <th className="py-2 px-2.5">{tr('默认值 (Default)', 'Default')}</th>
                    <th className="py-2 px-2.5">{tr('注释 (Comment)', 'Comment')}</th>
                    <th className="py-2 px-2.5">{tr('原型组件 / 黄色便签溯源', 'Widget / Sticky Provenance')}</th>
                    <th className="py-2 px-2 text-center">{tr('操作', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {activeTable.columns.map((col, idx) => {
                    const isRowSelected = selectedColumnId === col.id;
                    return (
                      <tr
                        key={col.id}
                        draggable
                        onDragStart={() => setDraggedColIndex(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedColIndex !== null && draggedColIndex !== idx) {
                            reorderColumnInTable(activeTable.id, draggedColIndex, idx);
                          }
                          setDraggedColIndex(null);
                        }}
                        onClick={() => setSelectedColumnId(col.id)}
                        className={`transition ${
                          isRowSelected
                            ? 'bg-blue-50/70'
                            : 'hover:bg-slate-100'
                        }`}
                      >
                        <td className="py-1.5 px-2 text-center cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-900">
                          <GripVertical className="w-3.5 h-3.5 inline" />
                        </td>
                        <td className="py-1.5 px-2.5">
                          <input
                            type="text"
                            value={col.name}
                            onChange={(e) =>
                              updateColumnInTable(activeTable.id, col.id, {
                                name: e.target.value,
                              })
                            }
                            className="w-44 px-2 py-0.5 rounded bg-slate-50 border border-slate-300 font-mono font-medium text-slate-900 focus:outline-none focus:border-blue-600"
                          />
                        </td>
                        <td className="py-1.5 px-2.5">
                          <div className="flex items-center gap-1">
                            <select
                              value={
                                COMMON_SQL_TYPES.includes(col.dataType)
                                  ? col.dataType
                                  : 'CUSTOM'
                              }
                              onChange={(e) => {
                                if (e.target.value !== 'CUSTOM') {
                                  updateColumnInTable(activeTable.id, col.id, {
                                    dataType: e.target.value,
                                  });
                                }
                              }}
                              className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-300 font-mono text-[11px] text-slate-700"
                            >
                              {COMMON_SQL_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                              {!COMMON_SQL_TYPES.includes(col.dataType) && (
                                <option value="CUSTOM">{col.dataType}</option>
                              )}
                            </select>
                            <input
                              type="text"
                              value={col.dataType}
                              onChange={(e) =>
                                updateColumnInTable(activeTable.id, col.id, {
                                  dataType: e.target.value.toUpperCase(),
                                })
                              }
                              className="w-28 px-1.5 py-0.5 rounded bg-slate-50 border border-slate-300 font-mono text-[11px] text-slate-700"
                            />
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={!col.nullable}
                            onChange={(e) =>
                              updateColumnInTable(activeTable.id, col.id, {
                                nullable: !e.target.checked,
                              })
                            }
                            className="accent-blue-600 w-3.5 h-3.5 cursor-pointer"
                          />
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              updateColumnInTable(activeTable.id, col.id, {
                                isPrimaryKey: !col.isPrimaryKey,
                                nullable: col.isPrimaryKey ? true : false,
                              })
                            }
                            className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold cursor-pointer ${
                              col.isPrimaryKey
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : col.isForeignKey
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {col.isPrimaryKey ? '🔑 PK' : col.isForeignKey ? '🔗 FK' : '—'}
                          </button>
                          <label className="ml-2 inline-flex items-center gap-1" title={tr('单列唯一约束', 'Single-column unique constraint')}>
                            <input type="checkbox" aria-label={tr(`${col.name} 单列唯一`, `${col.name} unique`)} checked={col.isUnique === true}
                              onChange={e => updateColumnInTable(activeTable.id, col.id, { isUnique: e.target.checked })}/>{tr('唯一', 'Unique')}
                          </label>
                        </td>
                        <td className="py-1.5 px-2.5">
                          <input
                            type="text"
                            value={col.defaultValue || ''}
                            placeholder="NULL"
                            onChange={(e) =>
                              updateColumnInTable(activeTable.id, col.id, {
                                defaultValue: e.target.value || undefined,
                              })
                            }
                            className="w-24 px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-700"
                          />
                        </td>
                        <td className="py-1.5 px-2.5">
                          <input
                            type="text"
                            value={col.comment}
                            onChange={(e) =>
                              updateColumnInTable(activeTable.id, col.id, {
                                comment: e.target.value,
                              })
                            }
                            className="w-56 px-2 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-800 focus:outline-none focus:border-blue-600"
                          />
                        </td>
                        <td className="py-1.5 px-2.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200 text-[10px]">
                            <Pin className="w-2.5 h-2.5 shrink-0" />
                            {col.sourceWidgetOrSticky ? td(col.sourceWidgetOrSticky) : tr('标准字段', 'Standard field')}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          {!col.isPrimaryKey && (
                            <button
                              type="button"
                              onClick={() => deleteColumnFromTable(activeTable.id, col.id)}
                              className="text-rose-600 hover:text-rose-800 p-1 cursor-pointer"
                              title={tr('删除字段', 'Delete column')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* =================================================================
              TAB 2: NAVICAT FOREIGN KEYS MANAGER (SYNCED WITH ER CANVAS)
             ================================================================= */}
          {bottomTab === 'foreign_keys' && (
            <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="font-semibold text-slate-800">{tr('新增外键约束：', 'Add Foreign Key:')}</span>
                <select
                  aria-label={tr('本表外键字段', 'Foreign key column in this table')}
                  value={newFkCol}
                  onChange={(e) => setNewFkCol(e.target.value)}
                  className="px-2 py-1 rounded bg-white border border-slate-300 font-mono text-slate-900"
                >
                  <option value="" disabled>{tr('选择本表字段', 'Select local column')}</option>
                  {activeTable.columns.map((c) => (
                    <option key={c.id} value={c.name}>
                      {tr(`本表字段: ${c.name}`, `Column: ${c.name}`)}
                    </option>
                  ))}
                </select>
                <span className="text-slate-500">{tr('引用目标表 →', 'References →')}</span>
                <select
                  aria-label={tr('被引用表', 'Referenced table')}
                  value={newFkRefTable}
                  onChange={(e) => {setNewFkRefTable(e.target.value);setNewFkRefCol('');}}
                  className="px-2 py-1 rounded bg-white border border-slate-300 font-mono text-slate-800"
                >
                  <option value="" disabled>{tr('选择引用表', 'Select target table')}</option>
                  {dbTables
                    .filter((t) => t.id !== activeTable.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.tableName} ({t.cnName})
                      </option>
                    ))}
                </select>
                <select aria-label={tr('被引用字段', 'Referenced column')} value={newFkRefCol} onChange={e => setNewFkRefCol(e.target.value)} className="px-2 py-1 rounded bg-white border border-slate-300 font-mono text-slate-900">
                  <option value="" disabled>{tr('选择引用字段', 'Select target column')}</option>
                  {dbTables.find(t=>t.id===newFkRefTable)?.columns.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <select
                  value={newFkOnDelete}
                  onChange={(e) =>
                    setNewFkOnDelete(e.target.value as 'RESTRICT' | 'CASCADE' | 'SET NULL')
                  }
                  className="px-2 py-1 rounded bg-white border border-slate-300 font-mono text-slate-900"
                >
                  <option value="RESTRICT">ON DELETE RESTRICT</option>
                  <option value="CASCADE">ON DELETE CASCADE</option>
                  <option value="SET NULL" disabled={!activeTable.columns.find(c=>c.name===newFkCol)?.nullable}>ON DELETE SET NULL</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const source = dbTables.find(t => t.id === newFkRefTable);
                    const targetCol = activeTable.columns.find(c => c.name === newFkCol);
                    if (!source || !targetCol || !source.columns.some(c => c.name === newFkRefCol)) return;
                    updateColumnInTable(activeTable.id, targetCol.id, { isForeignKey:true, references:`${source.tableName}(${newFkRefCol})`, foreignKeyOptions:{cardinality:'1:N',onDelete:newFkOnDelete} });
                  }}
                  disabled={!activeTable.columns.some(c=>c.name===newFkCol && (newFkOnDelete !== 'SET NULL' || c.nullable)) || !dbTables.some(t=>t.id===newFkRefTable && t.columns.some(c=>c.name===newFkRefCol))}
                  className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {tr('+ 添加外键并同步ER连线', '+ Add FK & Sync ER Line')}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="p-2">{tr('外键名 (Name)', 'Name')}</th>
                      <th className="p-2">{tr('字段 (Field)', 'Column')}</th>
                      <th className="p-2">{tr('被引用表 (Reference Table)', 'Referenced Table')}</th>
                      <th className="p-2">{tr('被引用字段 (Reference Field)', 'Referenced Column')}</th>
                      <th className="p-2">{tr('删除时 (On Delete)', 'On Delete')}</th>
                      <th className="p-2">{tr('操作', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {relations
                      .filter(
                        (r) =>
                          r.toTableId === activeTable.id || r.fromTableId === activeTable.id
                      )
                      .map((rel) => (
                        <tr key={rel.id} className="hover:bg-slate-100 font-mono">
                          <td className="p-2 text-slate-900 font-semibold">{rel.name}</td>
                          <td className="p-2 text-slate-900">
                            {rel.toTableId}.{rel.toColumnName}
                          </td>
                          <td className="p-2 text-slate-700">{rel.fromTableId}</td>
                          <td className="p-2 text-slate-900 font-medium">{rel.fromColumnName}</td>
                          <td className="p-2">{rel.onDelete ?? tr('未设置', 'Unset')}</td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() =>
                                removeRelation(rel)
                              }
                              className="text-rose-600 hover:underline cursor-pointer"
                            >
                              {tr('删除', 'Delete')}
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* =================================================================
              TAB 3: NAVICAT INDEXES MANAGER
             ================================================================= */}
          {bottomTab === 'indexes' && (
            <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="font-bold text-blue-700">{tr('➕ 添加索引：', '➕ Add Index:')}</span>
                <input
                  type="text"
                  aria-label={tr('索引名', 'Index name')}
                  value={newIdxName}
                  onChange={(e) => setNewIdxName(e.target.value)}
                  placeholder={`idx_${activeTable.tableName}_col`}
                  className="w-52 px-2.5 py-1 rounded bg-white border border-slate-300 font-mono text-slate-900"
                />
                <input
                  type="text"
                  aria-label={tr('索引列，按顺序用英文逗号分隔', 'Indexed columns, comma-separated in order')}
                  value={newIdxCols}
                  onChange={(e) => setNewIdxCols(e.target.value)}
                  placeholder={tr('索引列 (如: supplier_id, status)', 'Columns (e.g. supplier_id, status)')}
                  className="w-56 px-2.5 py-1 rounded bg-white border border-slate-300 font-mono text-slate-900"
                />
                <select
                  aria-label={tr('索引类型', 'Index type')}
                  disabled={editingKey !== null}
                  value={newIdxType}
                  onChange={(e) =>
                    setNewIdxType(e.target.value as 'UNIQUE' | 'NORMAL' | 'FULLTEXT')
                  }
                  className="px-2 py-1 rounded bg-white border border-slate-300 font-mono text-slate-900"
                >
                  <option value="NORMAL">{tr('NORMAL (普通索引)', 'NORMAL (Standard)')}</option>
                  <option value="UNIQUE">{tr('UNIQUE (唯一索引)', 'UNIQUE (Constraint)')}</option>
                  <option value="FULLTEXT">{tr('FULLTEXT (全文索引)', 'FULLTEXT')}</option>
                </select>
                <button
                  type="button"
                  onClick={saveIndex}
                  className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {editingKey === null ? tr('+ 保存索引', '+ Save Index') : tr('保存约束修改', 'Update Constraint')}
                </button>
                {editingKey !== null && <button type="button" className="whitespace-nowrap shrink-0 cursor-pointer" onClick={clearIndexForm}>{tr('取消编辑', 'Cancel')}</button>}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="p-2">{tr('索引名 (Name)', 'Name')}</th>
                      <th className="p-2">{tr('字段 (Fields)', 'Columns')}</th>
                      <th className="p-2">{tr('索引类型 (Index Type)', 'Index Type')}</th>
                      <th className="p-2">{tr('索引方法 (Method)', 'Method')}</th>
                      <th className="p-2">{tr('注释 (Comment)', 'Comment')}</th>
                      <th className="p-2">{tr('操作', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono">
                    {uniqueKeys.map(key => (
                      <tr key={key.name} className="hover:bg-slate-100">
                        <td className="p-2 text-blue-700 font-bold">{key.name}</td>
                        <td className="p-2">{key.columns.map(c => c.name).join(', ')}</td>
                        <td className="p-2">UNIQUE</td><td className="p-2">—</td>
                        <td className="p-2">{tr('业务唯一约束', 'Unique business constraint')}</td>
                        <td className="p-2 space-x-2">
                          <button type="button" className="cursor-pointer hover:underline" onClick={() => {
                            setEditingKey(key.name); setNewIdxType('UNIQUE'); setNewIdxName(key.name);
                            setNewIdxCols(key.columns.map(c => c.name).join(', '));
                          }}>{tr('编辑', 'Edit')}</button>
                          <button type="button" className="text-rose-600 cursor-pointer hover:underline" onClick={() => editSchema(() => {
                            setUniqueConstraints(activeTable.id, activeTable.uniqueConstraints!.filter(k => k.name !== key.name));
                            if (editingKey === key.name) clearIndexForm();
                          })}>{tr('删除', 'Delete')}</button>
                        </td>
                      </tr>
                    ))}
                    {localIndexes
                      .map((ix) => (
                        <tr key={ix.id} className="hover:bg-slate-100">
                          <td className="p-2 text-blue-700 font-bold">{ix.name}</td>
                          <td className="p-2 text-slate-700">{ix.columnNames}</td>
                          <td className="p-2">{ix.indexType}</td>
                          <td className="p-2">{ix.method}</td>
                          <td className="p-2 font-sans text-slate-700">{td(ix.comment)}</td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() =>
                                setTableIndexes((prev) => prev.filter((x) => x.id !== ix.id))
                              }
                              className="text-rose-600 hover:underline cursor-pointer"
                            >
                              {tr('删除', 'Delete')}
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* =================================================================
              TAB 4: NAVICAT "OPEN TABLE (打开表数据网格)" LIVE DATA VIEWER
             ================================================================= */}
          {bottomTab === 'data_preview' && <div className="flex-1 overflow-auto p-4"><ProjectTableData table={activeTable}/></div>}

          {/* =================================================================
              TAB 5: SHARED BY MENUS MATRIX
             ================================================================= */}
          {bottomTab === 'shared_menus' && (
            <div className="flex-1 p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {activeTable.sharedByMenus.map((menu, i) => (
                <div
                  key={`${menu.pageId}-${i}`}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 min-w-0"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="font-bold text-slate-900 flex flex-wrap items-center gap-2">
                      <span className="break-words">{menu.menuTitle}</span>
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-mono text-[10px] shrink-0">
                        {menu.accessMode}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 break-words">{td(menu.fieldMappingNote)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActivePage(menu.pageId);
                      setViewMode('single_page');
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>{tr('跳转原型', 'Open Page')}</span>
                    <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* =================================================================
              TAB 6: SQL / PRISMA DDL PREVIEW
             ================================================================= */}
          {bottomTab === 'sql_ddl' && (
            <div className="flex-1 p-4 overflow-y-auto space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  {(['mysql', 'postgres', 'prisma'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSqlDialect(d)}
                      className={`px-2.5 py-1 rounded-lg font-mono whitespace-nowrap shrink-0 cursor-pointer ${
                        sqlDialect === d
                          ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {d === 'mysql'
                        ? 'MySQL 8.0'
                        : d === 'postgres'
                        ? 'PostgreSQL 16'
                        : 'Prisma Schema'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5 shrink-0" /> : <Copy className="w-3.5 h-3.5 shrink-0" />}
                  <span>{copiedSql ? tr('已复制 DDL', 'Copied DDL') : tr('复制建表语句', 'Copy DDL')}</span>
                </button>
              </div>
              <pre className="p-3 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs text-slate-800 overflow-x-auto leading-relaxed">
                {generateDDL()}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
