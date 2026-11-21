import { validateTableDomain } from '../proto/database/domain';
import { resolveUniqueConstraints, type UniqueConstraint } from '../proto/database/uniqueConstraints';
import type { RequirementRecord } from '../proto/database/requirementReview';
import type { ProjectPlan } from '../services/projectPlan';
import { emptyMindmaps, type MindmapWorkspace } from '../proto/mindmaps';
import { emptyProjectNotes, type NoteWorkspace } from '../proto/notes';
import { create } from 'zustand';
import type { PflowProjectMetadata } from '../utils/pflowBinaryCodec';
import { newId as createIdentity } from '../utils/identity';
import { tr } from '../i18n/runtime';

export type UIStateMatrix = 'normal' | 'loading' | 'empty' | 'error';
export type WorkspaceViewMode =
  | 'project_ai'
  | 'single_page'
  | 'flow_canvas'
  | 'db_designer'
  | 'mindmap'
  | 'notes'
  | 'knowledge_impact'
  | 'closed_loop_audit';

export type PageNodeId =
  | 'doc-overview'
  | 'doc-changelog'
  | 'supplier-approval'
  | 'qualified-suppliers'
  | 'material-catalog'
  | 'purchase-order-confirm'
  | 'acceptance-new'
  | 'acceptance-list'
  | 'annual-plan'
  // Pages created in the visual designer (code-backed .page.tsx sources) use free-form ids
  | (string & {});

export type SelectableWidgetId =
  | 'header-form-group'
  | 'field-supplier-select'
  | 'btn-import-po'
  | 'acceptance-detail-grid'
  | 'btn-submit-acceptance'
  | 'yellow-sticky-spec'
  | 'supplier-table-widget'
  | 'po-table-widget'
  // Designer nodes are addressed by their stable pfId
  | (string & {});

export interface SitemapItem {
  id: string;
  title: string;
  type: 'folder' | 'page' | 'doc';
  pageId?: PageNodeId;
  deprecated?: boolean;
  badgeCount?: number;
  dataFlowTag?: string;
  sharedTables?: string[]; // Indicates which DB tables this menu uses!
  children?: SitemapItem[];
}

export interface DBColumnSchema {
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey?: boolean;
  isUnique?: boolean; // A declared single-column UNIQUE constraint.
  isForeignKey?: boolean;
  references?: string; // Physical tableName(columnName), never the internal table ID.
  // Optional explicit FK settings; absent settings must not be inferred from field names.
  foreignKeyOptions?: { name?: string; cardinality?: '1:N' | '1:1'; onDelete?: 'RESTRICT' | 'CASCADE' | 'SET NULL' };
  defaultValue?: string;
  comment: string;
  sourceWidgetOrSticky?: string; // Tracks which prototype widget or sticky note derived this column!
  isNew?: boolean;
}

export interface DBTableSchema {
  id: string;
  tableName: string;
  cnName: string;
  domain: string;
  description: string;
  // Historical and manually created tables can predate AI modeling decisions.
  modeling?: { entity: string; grain: string; reason: string; pendingRules?: { rule: string; reason: string }[] };
  uniqueConstraints?: UniqueConstraint[];
  // Crucial insight from user: multiple module menus share the same table!
  sharedByMenus: {
    pageId: PageNodeId;
    menuTitle: string;
    accessMode: 'CRUD 读写' | 'READ 查询' | 'FK 外键引用' | 'STATE 状态流转';
    fieldMappingNote: string;
  }[];
  columns: DBColumnSchema[];
}

export interface SupplierRecord {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  category: string;
  taxRateDefault: number;
  status: 'pending' | 'qualified' | 'rejected';
  updatedAt: string;
  isNew?: boolean;
}

export interface PurchaseOrderItem {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  planCategory: string;
  materialCode: string;
  materialName: string;
  spec: string;
  brand: string;
  unit: string;
  orderedQty: number;
  deliveredQty: number;
  unitPriceTaxIncluded: number;
  taxRate: number;
  projectCode: string;
  status: 'unconfirmed' | 'confirmed' | 'completed';
}

export interface AcceptanceLineItem {
  id: string;
  sourcePoItemId: string;
  planCategory: string;
  materialCode: string;
  materialName: string;
  spec: string;
  brand: string;
  unit: string;
  orderedQty: number;
  alreadyAcceptedQty: number;
  currentAcceptQty: number;
  useCustomTaxPrice: boolean;
  unitPriceTaxIncluded: number;
  taxRate: number;
  projectCode: string;
  serialNo: string;
  isNewItem: boolean;
}

export interface AcceptanceOrderRecord {
  id: string;
  acceptanceNo: string;
  acceptanceDate: string;
  inboundType: '购买' | '调拨' | '盘盈';
  sourceType: '供方发货单转入' | '采购订单转入';
  supplierName: string;
  supplierContact: string;
  supplierPhone: string;
  taxRate: number;
  totalAmount: number;
  inspector: string;
  deliveryPerson: string;
  remark: string;
  status: '草稿' | '已提交验收' | '已入库';
  itemCount: number;
  createdAt: string;
  isNew?: boolean;
}

export interface StickyNoteRule {
  id: string;
  pageId: PageNodeId;
  targetWidgetId: SelectableWidgetId;
  targetWidgetName: string;
  index: number;
  text: string;
  /** Historical rule description; not evidence of executable or implemented behavior. */
  compiledRule: string;
  /** Whether this requirement is enabled, not whether it has been implemented. */
  active: boolean;
}

export interface WidgetSchema {
  id: SelectableWidgetId;
  name: string;
  pageId: PageNodeId;
  type: 'FormGrid' | 'FormField' | 'ActionButton' | 'EditableTable' | 'StickySpec' | 'DataTable';
  props: {
    label: string;
    subLabel?: string;
    primaryColor: 'blue' | 'indigo' | 'emerald' | 'amber';
    visible: boolean;
    precisionDigits?: number;
    strictQtyCheck?: boolean;
    showSerialColumn?: boolean;
  };
}

export interface FlowEventLog {
  id: string;
  time: string;
  fromModule: string;
  toModule: string;
  summary: string;
  detail: string;
}

export interface ClosedLoopIssueOption {
  id: string;
  label: string;
  recommended?: boolean;
  description: string;
  stickyPatchText: string;
  dbPatchSummary: string;
}

export interface ClosedLoopAuditIssue {
  id: string;
  scope: 'module' | 'project';
  pageId: PageNodeId;
  moduleTitle: string;
  category:
    | '逆向流程缺失 (状态机不闭环)'
    | '原型组件 ↔ 数据库表脱节'
    | '跨模块异常分支未定义'
    | '孤立菜单未绑定物理表'
    | '并发锁与幂等校验缺失';
  severity: 'critical' | 'warning';
  title: string;
  brokenChainDesc: string;
  targetWidgetId: SelectableWidgetId;
  targetWidgetName: string;
  targetTableId: string;
  aiQuestion: string;
  options: ClosedLoopIssueOption[];
  status: 'open' | 'resolved';
  resolvedByOptionId?: string;
  customUserAnswer?: string;
  appliedRepairs?: string[];
  resolvedAt?: string;
  auditOrigin?: 'hermes';
  auditedAt?: string;
}

export interface ProtoStore {
  /** Empty string explicitly means the project has no remaining selectable menu page. */
  activePageId: PageNodeId;
  databaseRequirements: RequirementRecord[];
  projectPlan: ProjectPlan | null;
  projectAgreements: import('../services/projectKnowledge').ProjectAgreement[];
  viewMode: WorkspaceViewMode;
  uiState: UIStateMatrix;
  searchQuery: string;
  expandedFolders: Record<string, boolean>;
  showDeprecatedNodes: boolean;
  selectedWidgetId: SelectableWidgetId;
  isImportModalOpen: boolean;

  // Component-level Sticky Notes Controls
  showAllComponentPins: boolean;
  activePopoverWidgetId: SelectableWidgetId | null;

  // Desktop .pflow Bundle Inspector Modal
  isBundleModalOpen: boolean;

  // MCP Spec Server Connection Modal
  isMcpModalOpen: boolean;
  mcpModalTab: 'local' | 'remote';
  mcpModalShareUrl: string | null;
  setMcpModalOpen: (open: boolean, options?: { tab?: 'local' | 'remote'; shareUrl?: string | null }) => void;

  // Axure-style Web Publish & Interactive Web Player Mode ("将设计的东西发布为web页面让用户来进行点击交互")
  isWebPublishModalOpen: boolean;
  isWebPlayerMode: boolean;
  setWebPublishModalOpen: (open: boolean) => void;
  setWebPlayerMode: (enabled: boolean) => void;

  // IntelliJ IDEA-style Welcome Launcher & Project Binary File State
  isWelcomeScreenOpen: boolean;
  currentProjectMeta: PflowProjectMetadata;
  mindmaps: MindmapWorkspace;
  selectedMindmapNodeId: string | null;
  setMindmapSource: (projectId: string, mindmapId: string, source: string) => void;
  projectNotes: NoteWorkspace;
  selectedNoteNodeId: string | null;
  dockedNoteId: string | null;
  setDockedNoteId: (noteId: string | null) => void;
  recentProjects: PflowProjectMetadata[];
  /** The active project's archive was deleted; editing resumes only after opening another project. */
  isProjectClosed: boolean;
  setWelcomeScreenOpen: (open: boolean) => void;


  // Database Designer & VS Code Left Activity Bar State
  leftSidebarTab: 'pages' | 'tables';
  leftActivityView: 'pages' | 'tables' | 'materials' | 'composites' | 'outline' | 'ai';
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  dbTables: DBTableSchema[];
  selectedTableId: string;

  // Unread / Data Flow Badges on Sitemap Menus
  menuPulseBadges: Partial<Record<PageNodeId, number>>;

  // Shared Cross-Module Reactive Entities
  suppliers: SupplierRecord[];
  purchaseOrderItems: PurchaseOrderItem[];
  acceptanceOrders: AcceptanceOrderRecord[];

  // Current "新增到货验收" (Page 57 of 130) Active Draft Form & Table
  draftAcceptanceHeader: {
    acceptanceDate: string;
    acceptanceNo: string;
    inspector: string;
    inboundType: '购买' | '调拨' | '盘盈';
    sourceType: '供方发货单转入' | '采购订单转入';
    deliveryPerson: string;
    supplierId: string;
    supplierContact: string;
    supplierPhone: string;
    invoiceType: '专票' | '普票';
    taxRate: number;
    remark: string;
  };
  draftAcceptanceLines: AcceptanceLineItem[];

  stickyNotes: StickyNoteRule[];
  widgets: Record<SelectableWidgetId, WidgetSchema>;
  flowLogs: FlowEventLog[];

  // AI Closed-Loop Audit & Interrogation State ("模块和项目需求闭环AI检测 不闭环的地方进行AI提问 修复")
  auditScopeFilter: 'all' | 'current_module';
  closedLoopIssues: ClosedLoopAuditIssue[];

  // Actions
  navigationSource: { tableId: string; rowId: string } | null;
  setActivePage: (pageId: PageNodeId, source?: {tableId: string; rowId: string}) => void;
  setViewMode: (mode: WorkspaceViewMode) => void;
  setAuditScopeFilter: (scope: 'all' | 'current_module') => void;
  setUIState: (state: UIStateMatrix) => void;
  setSearchQuery: (q: string) => void;
  toggleFolder: (folderId: string) => void;
  setShowDeprecatedNodes: (show: boolean) => void;
  selectWidget: (id: SelectableWidgetId) => void;
  setImportModalOpen: (open: boolean) => void;
  setShowAllComponentPins: (show: boolean) => void;
  setActivePopoverWidgetId: (id: SelectableWidgetId | null) => void;
  setBundleModalOpen: (open: boolean) => void;

  // Database Designer Actions
  setLeftSidebarTab: (tab: 'pages' | 'tables') => void;
  setLeftActivityView: (view: 'pages' | 'tables' | 'materials' | 'composites' | 'outline' | 'ai') => void;
  setSelectedTableId: (tableId: string) => void;
  addColumnToTable: (tableId: string, col: Omit<DBColumnSchema, 'id'>) => void;
  insertColumnAt: (tableId: string, index: number, col: Omit<DBColumnSchema, 'id'>) => void;
  reorderColumnInTable: (tableId: string, fromIndex: number, toIndex: number) => void;
  updateColumnInTable: (tableId: string, colId: string, partial: Partial<DBColumnSchema>) => void;
  deleteColumnFromTable: (tableId: string, colId: string) => void;
  setUniqueConstraints: (tableId: string, constraints: UniqueConstraint[]) => void;
  duplicateTable: (tableId: string) => string;
  deleteTable: (tableId: string) => void;
  updateTableMeta: (
    tableId: string,
    partial: Partial<Pick<DBTableSchema, 'tableName' | 'cnName' | 'domain' | 'description'>>
  ) => void;
  toggleTableBindingForMenu: (tableId: string, pageId: PageNodeId, menuTitle: string) => void;
  createNewTable: (
    tableName: string,
    cnName: string,
    domain: DBTableSchema['domain'],
    bindToMenu?: { pageId: PageNodeId; menuTitle: string }
  ) => void;

  // Cross-Module Data Flow Actions
  approveSupplier: (supplierId: string) => void;
  addNewSupplier: (name: string, contact: string, phone: string, category: string) => void;
  confirmPurchaseOrder: (poItemId: string) => void;
  importPoItemsToAcceptance: (poItemIds: string[]) => void;

  // Acceptance Form & Live Formula Actions
  updateAcceptanceHeader: (partial: Partial<ProtoStore['draftAcceptanceHeader']>) => void;
  updateAcceptanceLineQty: (lineId: string, qty: number) => void;
  updateAcceptanceLinePrice: (lineId: string, price: number) => void;
  removeAcceptanceLine: (lineId: string) => void;
  submitAcceptanceOrder: (asDraft?: boolean) => void;

  // Component-level & Page Sticky Note Actions
  toggleStickyRule: (ruleId: string) => void;
  addStickyRuleToWidget: (
    pageId: PageNodeId,
    targetWidgetId: SelectableWidgetId,
    text: string,
    targetWidgetName?: string
  ) => void;
  updateStickyRuleText: (ruleId: string, text: string) => void;
  deleteStickyRule: (ruleId: string) => void;
  updateWidgetProps: (id: SelectableWidgetId, partial: Partial<WidgetSchema['props']>) => void;
}

export const SITEMAP_TREE: SitemapItem[] = [
  {
    id: 'node-doc-overview',
    title: '系统总体要求',
    type: 'doc',
    pageId: 'doc-overview',
  },
  {
    id: 'node-doc-changelog',
    title: '设计变更记录',
    type: 'doc',
    pageId: 'doc-changelog',
  },
  {
    id: 'folder-deprecated',
    title: '作废设计 (历史归档)',
    type: 'folder',
    deprecated: true,
    children: [
      { id: 'dep-1', title: '比价确认-作废', type: 'page', deprecated: true },
      { id: 'dep-2', title: '采购订单确认-废弃', type: 'page', deprecated: true },
      { id: 'dep-3', title: '验收入库-作废', type: 'page', deprecated: true },
    ],
  },
  {
    id: 'folder-base-data',
    title: '基础资料管理',
    type: 'folder',
    dataFlowTag: '上游主数据',
    children: [
      {
        id: 'node-material-catalog',
        title: '物料目录',
        type: 'page',
        pageId: 'material-catalog',
        sharedTables: ['t_base_material'],
      },
      {
        id: 'node-supplier-approval',
        title: '供应商审批',
        type: 'page',
        pageId: 'supplier-approval',
        dataFlowTag: '共表: t_base_supplier',
        sharedTables: ['t_base_supplier'],
      },
      {
        id: 'node-qualified-suppliers',
        title: '合格供应商目录',
        type: 'page',
        pageId: 'qualified-suppliers',
        dataFlowTag: '共表: t_base_supplier',
        sharedTables: ['t_base_supplier'],
      },
    ],
  },
  {
    id: 'folder-plan',
    title: '年度计划-审批',
    type: 'folder',
    children: [
      {
        id: 'node-annual-plan',
        title: '季度补货计划预算',
        type: 'page',
        pageId: 'annual-plan',
      },
    ],
  },
  {
    id: 'folder-procurement',
    title: '采购与招标管理',
    type: 'folder',
    dataFlowTag: '中游单据流',
    children: [
      {
        id: 'node-po-confirm',
        title: '采购订单确认 (待转入)',
        type: 'page',
        pageId: 'purchase-order-confirm',
        dataFlowTag: '共表: t_pms_po_item',
        sharedTables: ['t_pms_po_item', 't_base_supplier'],
      },
    ],
  },
  {
    id: 'folder-acceptance',
    title: '验收入库管理',
    type: 'folder',
    dataFlowTag: '核心汇流点',
    children: [
      {
        id: 'node-acceptance-new',
        title: '新增到货验收 (57 of 130)',
        type: 'page',
        pageId: 'acceptance-new',
        dataFlowTag: '关联 4 张核心表',
        sharedTables: [
          't_wms_acceptance_order',
          't_wms_acceptance_detail',
          't_base_supplier',
          't_pms_po_item',
        ],
      },
      {
        id: 'node-acceptance-list',
        title: '到货验收单台账 (已入库)',
        type: 'page',
        pageId: 'acceptance-list',
        dataFlowTag: '共表: t_wms_acceptance_order',
        sharedTables: ['t_wms_acceptance_order'],
      },
    ],
  },
];

const INITIAL_DB_TABLES: DBTableSchema[] = [
  {
    id: 't_base_supplier',
    tableName: 't_base_supplier',
    cnName: '供应商主数据表 (多菜单共用表)',
    domain: '基础资料域 (MDM)',
    description:
      '【核心共表典型案例】由「供应商审批」、「合格供应商目录」、「采购订单确认」、「新增到货验收」4 个不同模块的目录菜单共同读写/引用同一张物理表！',
    sharedByMenus: [
      {
        pageId: 'supplier-approval',
        menuTitle: '基础资料 → 供应商审批 (Page 18)',
        accessMode: 'STATE 状态流转',
        fieldMappingNote: '新增待审供方记录，审批通过时修改 status = "qualified"',
      },
      {
        pageId: 'qualified-suppliers',
        menuTitle: '基础资料 → 合格供应商目录 (Page 19)',
        accessMode: 'READ 查询',
        fieldMappingNote: '展示 WHERE status = "qualified" 的合格供方视图，与审批页共用同一张表',
      },
      {
        pageId: 'acceptance-new',
        menuTitle: '验收入库 → 新增到货验收 (Page 57)',
        accessMode: 'FK 外键引用',
        fieldMappingNote: '表头“供应商”下拉框绑定 id，选中后自动联动回填 contact_person、phone、tax_rate_default',
      },
      {
        pageId: 'purchase-order-confirm',
        menuTitle: '采购管理 → 采购订单确认 (Page 34)',
        accessMode: 'FK 外键引用',
        fieldMappingNote: '采购单关联供方主数据',
      },
    ],
    columns: [
      {
        id: 'col-sup-1',
        name: 'id',
        dataType: 'VARCHAR(32)',
        nullable: false,
        isPrimaryKey: true,
        comment: '供应商唯一主键 ID',
        sourceWidgetOrSticky: '系统主键',
      },
      {
        id: 'col-sup-2',
        name: 'supplier_code',
        dataType: 'VARCHAR(64)',
        nullable: false,
        comment: '供应商编码 (如 VND-2026-001)',
        sourceWidgetOrSticky: '供应商审批页-列表列',
      },
      {
        id: 'col-sup-3',
        name: 'supplier_name',
        dataType: 'VARCHAR(128)',
        nullable: false,
        comment: '供应商全称',
        sourceWidgetOrSticky: '新增到货验收-表头[供应商]下拉框 (#1便签)',
      },
      {
        id: 'col-sup-4',
        name: 'contact_person',
        dataType: 'VARCHAR(64)',
        nullable: true,
        comment: '供应商联系人 (选中供方自动带出)',
        sourceWidgetOrSticky: '新增到货验收-表头[供应商联系人]字段',
      },
      {
        id: 'col-sup-5',
        name: 'contact_phone',
        dataType: 'VARCHAR(32)',
        nullable: true,
        comment: '供应商联系电话',
        sourceWidgetOrSticky: '新增到货验收-表头[供应商联系电话]字段',
      },
      {
        id: 'col-sup-6',
        name: 'tax_rate_default',
        dataType: 'INT',
        nullable: false,
        defaultValue: '13',
        comment: '默认增值税率 (%)',
        sourceWidgetOrSticky: '新增到货验收-表头[税率]联动',
      },
      {
        id: 'col-sup-7',
        name: 'status',
        dataType: 'VARCHAR(20)',
        nullable: false,
        defaultValue: "'pending'",
        comment: '准入状态: pending(待审) / qualified(合格) / rejected(驳回)',
        sourceWidgetOrSticky: '区分【供应商审批】与【合格供应商目录】两个菜单的核心状态位',
      },
    ],
  },
  {
    id: 't_wms_acceptance_order',
    tableName: 't_wms_acceptance_order',
    cnName: '到货验收单主表 (多菜单共用表)',
    domain: '仓储验收域 (WMS)',
    description:
      '【新增到货验收 (Page 57)】负责表单写入，【到货验收单台账 (Page 58)】负责分页查询与入库状态流转。',
    sharedByMenus: [
      {
        pageId: 'acceptance-new',
        menuTitle: '验收入库 → 新增到货验收 (Page 57)',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '表头表单区直接映射本表字段；点击【提交/暂存】写入记录',
      },
      {
        pageId: 'acceptance-list',
        menuTitle: '验收入库 → 到货验收单台账 (Page 58)',
        accessMode: 'READ 查询',
        fieldMappingNote: '台账列表展示本表已提交及草稿记录',
      },
    ],
    columns: [
      {
        id: 'col-acc-1',
        name: 'id',
        dataType: 'VARCHAR(32)',
        nullable: false,
        isPrimaryKey: true,
        comment: '验收单主键 ID',
        sourceWidgetOrSticky: '系统主键',
      },
      {
        id: 'col-acc-2',
        name: 'acceptance_no',
        dataType: 'VARCHAR(64)',
        nullable: false,
        comment: '到货验收单号 (如 DHY20250908001)',
        sourceWidgetOrSticky: '新增到货验收-表头[*到货验收单号]',
      },
      {
        id: 'col-acc-3',
        name: 'acceptance_date',
        dataType: 'DATE',
        nullable: false,
        comment: '到货验收日期',
        sourceWidgetOrSticky: '新增到货验收-表头[*到货验收日期]',
      },
      {
        id: 'col-acc-4',
        name: 'inbound_type',
        dataType: 'VARCHAR(32)',
        nullable: false,
        defaultValue: "'购买'",
        comment: '入库类型 (购买/调拨/盘盈)',
        sourceWidgetOrSticky: '新增到货验收-表头[*入库类型]',
      },
      {
        id: 'col-acc-5',
        name: 'source_type',
        dataType: 'VARCHAR(64)',
        nullable: false,
        comment: '入库来源类型 (供方发货单转入/采购订单转入)',
        sourceWidgetOrSticky: '新增到货验收-表头[*入库来源类型]',
      },
      {
        id: 'col-acc-6',
        name: 'supplier_id',
        dataType: 'VARCHAR(32)',
        nullable: false,
        isForeignKey: true,
        references: 't_base_supplier(id)',
        comment: '外键关联合格供应商 ID',
        sourceWidgetOrSticky: '组件便签 #1: 关联【合格供应商目录】',
      },
      {
        id: 'col-acc-7',
        name: 'total_amount_tax_included',
        dataType: 'DECIMAL(14, 2)',
        nullable: false,
        defaultValue: '0.00',
        comment: '价税合计总额 (自动汇总明细行)',
        sourceWidgetOrSticky: '组件便签 #3: 表头[价税合计]自动汇总',
      },
      {
        id: 'col-acc-8',
        name: 'status',
        dataType: 'VARCHAR(24)',
        nullable: false,
        defaultValue: "'草稿'",
        comment: '单据状态 (草稿 / 已提交验收 / 已入库)',
        sourceWidgetOrSticky: '组件便签 #5: [提交/暂存]按钮状态机',
      },
    ],
  },
  {
    id: 't_wms_acceptance_detail',
    tableName: 't_wms_acceptance_detail',
    cnName: '到货验收单明细表 (含6位小数算税字段)',
    domain: '仓储验收域 (WMS)',
    description:
      '承载【新增到货验收】下方的明细表格数据，字段精度严格由页面上的 #3、#4 黄色需求便签推导生成。',
    sharedByMenus: [
      {
        pageId: 'acceptance-new',
        menuTitle: '验收入库 → 新增到货验收 (Page 57 - 明细表)',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '对应页面中部的【到货验收明细】可编辑表格',
      },
      {
        pageId: 'purchase-order-confirm',
        menuTitle: '采购管理 → 采购订单确认 (Page 34)',
        accessMode: 'FK 外键引用',
        fieldMappingNote: '通过 source_po_item_id 关联采购单明细并回写已到货数量',
      },
    ],
    columns: [
      {
        id: 'col-dtl-1',
        name: 'id',
        dataType: 'VARCHAR(32)',
        nullable: false,
        isPrimaryKey: true,
        comment: '验收明细行主键',
        sourceWidgetOrSticky: '系统主键',
      },
      {
        id: 'col-dtl-2',
        name: 'acceptance_order_id',
        dataType: 'VARCHAR(32)',
        nullable: false,
        isForeignKey: true,
        references: 't_wms_acceptance_order(id)',
        comment: '所属到货验收单主表 ID',
        sourceWidgetOrSticky: '主子表外键关联',
      },
      {
        id: 'col-dtl-3',
        name: 'source_po_item_id',
        dataType: 'VARCHAR(32)',
        nullable: false,
        isForeignKey: true,
        references: 't_pms_po_item(id)',
        comment: '来源采购订单明细行 ID',
        sourceWidgetOrSticky: '组件便签 #2: [选择采购明细]跨模块转入',
      },
      {
        id: 'col-dtl-4',
        name: 'material_code',
        dataType: 'VARCHAR(64)',
        nullable: false,
        comment: '物料编码 (如 07-0021)',
        sourceWidgetOrSticky: '到货验收明细表-[物料编码]列',
      },
      {
        id: 'col-dtl-5',
        name: 'current_accept_qty',
        dataType: 'DECIMAL(12, 2)',
        nullable: false,
        comment: '本次到货数量 (校验 <= 订货数 - 已到货数)',
        sourceWidgetOrSticky: '组件便签 #4: 防超收校验规则',
      },
      {
        id: 'col-dtl-6',
        name: 'unit_price_tax_included',
        dataType: 'DECIMAL(12, 2)',
        nullable: false,
        comment: '含税单价(元)',
        sourceWidgetOrSticky: '到货验收明细表-[含税单价]列',
      },
      {
        id: 'col-dtl-7',
        name: 'unit_price_no_tax',
        dataType: 'DECIMAL(18, 6)',
        nullable: false,
        comment: '不含税单价(元) — 遵循便签要求保留 6 位小数！',
        sourceWidgetOrSticky: '组件便签 #3: 不含税单价 = 含税单价/(1+税率) 6位小数',
      },
      {
        id: 'col-dtl-8',
        name: 'tax_amount',
        dataType: 'DECIMAL(14, 2)',
        nullable: false,
        comment: '税额(元) = 含税金额 - 不含税金额',
        sourceWidgetOrSticky: '组件便签 #3: 税额计算公式',
      },
      {
        id: 'col-dtl-9',
        name: 'project_code',
        dataType: 'VARCHAR(64)',
        nullable: true,
        comment: '课题编码 (如 P20250908001)',
        sourceWidgetOrSticky: '到货验收明细表-[课题编码]列',
      },
    ],
  },
  {
    id: 't_pms_po_item',
    tableName: 't_pms_po_item',
    cnName: '采购订单明细表 (跨模块转入源表)',
    domain: '采购管理域 (SRM)',
    description:
      '由【采购订单确认 (Page 34)】维护，并在【新增到货验收 (Page 57)】点击“选择采购明细”时提供数据源，提交验收后自动累加 delivered_qty。',
    sharedByMenus: [
      {
        pageId: 'purchase-order-confirm',
        menuTitle: '采购管理 → 采购订单确认 (Page 34)',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '确认采购订单，使 status = "confirmed"',
      },
      {
        pageId: 'acceptance-new',
        menuTitle: '验收入库 → 新增到货验收 (Page 57)',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '拉取未收完的订单行，并在提交验收单时反向累加 delivered_qty',
      },
    ],
    columns: [
      {
        id: 'col-po-1',
        name: 'id',
        dataType: 'VARCHAR(32)',
        nullable: false,
        isPrimaryKey: true,
        comment: '采购明细主键',
        sourceWidgetOrSticky: '系统主键',
      },
      {
        id: 'col-po-2',
        name: 'po_number',
        dataType: 'VARCHAR(64)',
        nullable: false,
        comment: '采购订单号 (如 CGDD-202610-081)',
        sourceWidgetOrSticky: '采购订单确认页-[采购单号]列',
      },
      {
        id: 'col-po-3',
        name: 'supplier_id',
        dataType: 'VARCHAR(32)',
        nullable: false,
        isForeignKey: true,
        references: 't_base_supplier(id)',
        comment: '关联供应商 ID',
        sourceWidgetOrSticky: '外键关联 t_base_supplier',
      },
      {
        id: 'col-po-4',
        name: 'ordered_qty',
        dataType: 'DECIMAL(12, 2)',
        nullable: false,
        comment: '采购订货数量',
        sourceWidgetOrSticky: '组件便签 #2/#4: 转入订货数量',
      },
      {
        id: 'col-po-5',
        name: 'delivered_qty',
        dataType: 'DECIMAL(12, 2)',
        nullable: false,
        defaultValue: '0',
        comment: '累计已到货验收数量 (下游验收提交后实时回写累加)',
        sourceWidgetOrSticky: '组件便签 #5: 跨模块回写字段',
      },
    ],
  },
];

const INITIAL_SUPPLIERS: SupplierRecord[] = [
  {
    id: 'SUP-01',
    code: 'VND-2026-001',
    name: '杭州极光智能数码有限公司',
    contactPerson: '张晓明',
    phone: '13805328891',
    category: '智能穿戴与无线音频',
    taxRateDefault: 9,
    status: 'qualified',
    updatedAt: '09:15:00',
  },
  {
    id: 'SUP-02',
    code: 'VND-2026-002',
    name: '深圳星海光电科技有限公司',
    contactPerson: '林建国',
    phone: '13922819904',
    category: '超清显示与会议外设',
    taxRateDefault: 13,
    status: 'qualified',
    updatedAt: '09:20:00',
  },
  {
    id: 'SUP-03',
    code: 'VND-2026-003',
    name: '苏州云图精密配件有限公司',
    contactPerson: '王雅琴',
    phone: '18602193342',
    category: '氮化镓快充与连接配件',
    taxRateDefault: 13,
    status: 'pending',
    updatedAt: '10:01:00',
  },
  {
    id: 'SUP-04',
    code: 'VND-2026-004',
    name: '上海森禾环保包装制品厂',
    contactPerson: '赵立冬',
    phone: '13501087765',
    category: '品牌定制礼盒与缓冲包材',
    taxRateDefault: 9,
    status: 'pending',
    updatedAt: '10:05:00',
  },
];

const INITIAL_PO_ITEMS: PurchaseOrderItem[] = [
  {
    id: 'PO-ITEM-1',
    poNumber: 'CGDD-202610-081',
    supplierId: 'SUP-01',
    supplierName: '杭州极光智能数码有限公司',
    planCategory: '常规补货',
    materialCode: 'SKU-0021',
    materialName: '无线主动降噪耳机 Pro',
    spec: '星际银 / 旗舰版',
    brand: '极光声学',
    unit: '件',
    orderedQty: 3,
    deliveredQty: 2,
    unitPriceTaxIncluded: 56.3,
    taxRate: 9,
    projectCode: 'ORD-2026-Q4A',
    status: 'confirmed',
  },
  {
    id: 'PO-ITEM-2',
    poNumber: 'CGDD-202610-081',
    supplierId: 'SUP-01',
    supplierName: '杭州极光智能数码有限公司',
    planCategory: '常规补货',
    materialCode: 'SKU-0032',
    materialName: '氮化镓 140W 桌面快充站',
    spec: '4口 Type-C / 曜石黑',
    brand: '云图闪充',
    unit: '台',
    orderedQty: 5,
    deliveredQty: 0,
    unitPriceTaxIncluded: 80.0,
    taxRate: 13,
    projectCode: 'ORD-2026-Q4A',
    status: 'confirmed',
  },
  {
    id: 'PO-ITEM-3',
    poNumber: 'CGDD-202610-095',
    supplierId: 'SUP-01',
    supplierName: '杭州极光智能数码有限公司',
    planCategory: '大促备货',
    materialCode: 'SKU-1044',
    materialName: '4K 智能自动取景会议摄像头',
    spec: '双麦降噪阵列',
    brand: '星海智造',
    unit: '台',
    orderedQty: 12,
    deliveredQty: 4,
    unitPriceTaxIncluded: 320.0,
    taxRate: 13,
    projectCode: 'ORD-2026-Q4B',
    status: 'confirmed',
  },
  {
    id: 'PO-ITEM-4',
    poNumber: 'CGDD-202610-102',
    supplierId: 'SUP-02',
    supplierName: '深圳星海光电科技有限公司',
    planCategory: '大促备货',
    materialCode: 'SKU-9001',
    materialName: '人体工学三模无线机械键盘',
    spec: 'Gasket 结构 / 静音轴',
    brand: '星海外设',
    unit: '把',
    orderedQty: 2,
    deliveredQty: 0,
    unitPriceTaxIncluded: 480.0,
    taxRate: 13,
    projectCode: 'ORD-2026-Q4C',
    status: 'unconfirmed',
  },
];

const INITIAL_ACCEPTANCE_LINES: AcceptanceLineItem[] = [
  {
    id: 'LINE-1',
    sourcePoItemId: 'PO-ITEM-1',
    planCategory: '常规补货',
    materialCode: 'SKU-0021',
    materialName: '无线主动降噪耳机 Pro',
    spec: '星际银 / 旗舰版',
    brand: '极光声学',
    unit: '件',
    orderedQty: 3,
    alreadyAcceptedQty: 2,
    currentAcceptQty: 1,
    useCustomTaxPrice: false,
    unitPriceTaxIncluded: 56.3,
    taxRate: 9,
    projectCode: 'ORD-2026-Q4A',
    serialNo: '001',
    isNewItem: true,
  },
  {
    id: 'LINE-2',
    sourcePoItemId: 'PO-ITEM-2',
    planCategory: '常规补货',
    materialCode: 'SKU-0032',
    materialName: '氮化镓 140W 桌面快充站',
    spec: '4口 Type-C / 曜石黑',
    brand: '云图闪充',
    unit: '台',
    orderedQty: 5,
    alreadyAcceptedQty: 0,
    currentAcceptQty: 2,
    useCustomTaxPrice: false,
    unitPriceTaxIncluded: 80.0,
    taxRate: 13,
    projectCode: 'ORD-2026-Q4A',
    serialNo: '002',
    isNewItem: true,
  },
];

const INITIAL_ACCEPTANCE_ORDERS: AcceptanceOrderRecord[] = [
  {
    id: 'ACC-2026-001',
    acceptanceNo: 'DHY20250908000',
    acceptanceDate: '2026-10-25',
    inboundType: '购买',
    sourceType: '采购订单转入',
    supplierName: '深圳星海光电科技有限公司',
    supplierContact: '林建国',
    supplierPhone: '13922819904',
    taxRate: 13,
    totalAmount: 12600.0,
    inspector: '李仓管',
    deliveryPerson: '顺丰干线专车',
    remark: '外箱完好，扫码清点一致',
    status: '已入库',
    itemCount: 4,
    createdAt: '2026-10-25 14:20',
  },
];

const INITIAL_STICKY_NOTES: StickyNoteRule[] = [
  {
    id: 'sticky-1',
    pageId: 'acceptance-new',
    targetWidgetId: 'field-supplier-select',
    targetWidgetName: '字段：供应商下拉框',
    index: 1,
    text: '供应商下拉框数据实时来源于【基础资料管理 -> 合格供应商目录】；在【供应商审批】通过后自动同步至此下拉列表，选中后自动带出联系人与联系电话。',
    compiledRule: 'SELECT * FROM t_base_supplier WHERE status = "qualified" -> bind(header.supplierId)',
    active: true,
  },
  {
    id: 'sticky-2',
    pageId: 'acceptance-new',
    targetWidgetId: 'btn-import-po',
    targetWidgetName: '按钮：[选择采购明细]',
    index: 2,
    text: '点击【选择采购明细】按钮，弹窗从【采购管理 -> 采购订单确认】模块拉取已确认的采购订单明细行，勾选后自动带入计划类别、物料编码、订货数量与已到货数量。',
    compiledRule: 'onClick -> openModal(SELECT * FROM t_pms_po_item WHERE status = "confirmed")',
    active: true,
  },
  {
    id: 'sticky-3',
    pageId: 'acceptance-new',
    targetWidgetId: 'acceptance-detail-grid',
    targetWidgetName: '表格：到货验收明细 (算税公式)',
    index: 3,
    text: '价格与税额联动公式（实时计算）：不含税单价 = 含税单价 / (1 + 税率)（默认保留6位小数，如 51.651376）；含税金额 = 含税单价 × 本次到货数量；不含税金额 = 含税金额 / (1 + 税率)；税额 = 含税金额 - 不含税金额；表头【价税合计】自动汇总所有明细行。',
    compiledRule: 'unit_price_no_tax DECIMAL(18,6) = (taxPrice / (1 + rate)).toFixed(6)',
    active: true,
  },
  {
    id: 'sticky-4',
    pageId: 'acceptance-new',
    targetWidgetId: 'acceptance-detail-grid',
    targetWidgetName: '表格：本次到货数量 (防超收)',
    index: 4,
    text: '防超收校验规则：本次到货数量不得大于（订货数量 - 已到货数量），超出时自动拦截并限制为最大未到货余量。',
    compiledRule: 'CHECK (current_accept_qty <= ordered_qty - already_accepted_qty)',
    active: true,
  },
  {
    id: 'sticky-5',
    pageId: 'acceptance-new',
    targetWidgetId: 'btn-submit-acceptance',
    targetWidgetName: '按钮：[提交 / 暂存]',
    index: 5,
    text: '点击【提交】按钮后，单据状态变更为“已提交验收”，自动写入左侧【到货验收单台账】，并反向扣减上游【采购订单】中的未到货余量；点击【暂存】仅保存草稿不扣减余量。',
    compiledRule: 'INSERT INTO t_wms_acceptance_order && UPDATE t_pms_po_item SET delivered_qty += qty',
    active: true,
  },
];

const INITIAL_WIDGETS: Record<SelectableWidgetId, WidgetSchema> = {
  'header-form-group': {
    id: 'header-form-group',
    name: '到货验收单表头表单区',
    pageId: 'acceptance-new',
    type: 'FormGrid',
    props: {
      label: '到货验收信息 (映射主表 t_wms_acceptance_order)',
      subLabel: '包含日期、单号、入库来源及供应商外键联动信息',
      primaryColor: 'blue',
      visible: true,
    },
  },
  'field-supplier-select': {
    id: 'field-supplier-select',
    name: '字段：供应商下拉选择框',
    pageId: 'acceptance-new',
    type: 'FormField',
    props: {
      label: '供应商',
      subLabel: '外键绑定共用表 t_base_supplier',
      primaryColor: 'blue',
      visible: true,
    },
  },
  'btn-import-po': {
    id: 'btn-import-po',
    name: '按钮：[选择采购明细]',
    pageId: 'acceptance-new',
    type: 'ActionButton',
    props: {
      label: '选择采购明细',
      subLabel: '跨表调取 t_pms_po_item 待收货明细',
      primaryColor: 'blue',
      visible: true,
    },
  },
  'acceptance-detail-grid': {
    id: 'acceptance-detail-grid',
    name: '表格：到货验收明细',
    pageId: 'acceptance-new',
    type: 'EditableTable',
    props: {
      label: '到货验收明细 (映射子表 t_wms_acceptance_detail)',
      subLabel: '支持含税单价、税率、6位不含税单价与价税合计实时公式联动',
      primaryColor: 'blue',
      visible: true,
      precisionDigits: 6,
      strictQtyCheck: true,
      showSerialColumn: true,
    },
  },
  'btn-submit-acceptance': {
    id: 'btn-submit-acceptance',
    name: '按钮组：[提交 / 暂存]',
    pageId: 'acceptance-new',
    type: 'ActionButton',
    props: {
      label: '提交',
      subLabel: '提交后自动写入 t_wms_acceptance_order 并回写 t_pms_po_item',
      primaryColor: 'blue',
      visible: true,
    },
  },
  'yellow-sticky-spec': {
    id: 'yellow-sticky-spec',
    name: '页面底部黄色便签汇总区',
    pageId: 'acceptance-new',
    type: 'StickySpec',
    props: {
      label: '页面全部组件便签汇总与跨模块数据库契约 (Aggregated Sticky Spec)',
      subLabel: '页面内各组件/按钮上的局部便签自动双向汇总于此，并直接驱动数据库表字段生成',
      primaryColor: 'amber',
      visible: true,
    },
  },
  'supplier-table-widget': {
    id: 'supplier-table-widget',
    name: '供应商准入审批工作台',
    pageId: 'supplier-approval',
    type: 'DataTable',
    props: {
      label: '待审批供应商列表 (共表: t_base_supplier)',
      subLabel: '审批通过后实时流入【合格供应商目录】与【新增到货验收】下拉框',
      primaryColor: 'indigo',
      visible: true,
    },
  },
  'po-table-widget': {
    id: 'po-table-widget',
    name: '采购订单确认与下发台',
    pageId: 'purchase-order-confirm',
    type: 'DataTable',
    props: {
      label: '采购订单明细池 (共表: t_pms_po_item)',
      subLabel: '确认后的订单可在【新增到货验收】页面中通过“选择采购明细”一键转入',
      primaryColor: 'emerald',
      visible: true,
    },
  },
};

const nowTime = () => new Date().toTimeString().slice(0, 8);

const INITIAL_PROJECT_META: PflowProjectMetadata = {
  projectId: 'proj-saas-inventory',
  projectName: '云仓电商进销存系统',
  storageDir: '',
  fileName: '云仓电商进销存系统.pflow',
  templateId: 'saas_inventory',
  createdAt: '2026-10-20 09:30',
  updatedAt: '2026-10-28 13:15',
  pageCount: 130,
  tableCount: 4,
  stickyCount: 5,
};

// Only real project files belong in the recent list; sample projects are created from templates.
const INITIAL_RECENT_PROJECTS: PflowProjectMetadata[] = [];

export const useProtoStore = create<ProtoStore>((set, get) => ({
  activePageId: 'acceptance-new',
  databaseRequirements: [],
  projectPlan: null,
  projectAgreements: [],
  viewMode: 'single_page',
  uiState: 'normal',
  searchQuery: '',
  expandedFolders: {
    'folder-deprecated': false,
    'folder-base-data': true,
    'folder-plan': true,
    'folder-procurement': true,
    'folder-acceptance': true,
  },
  showDeprecatedNodes: true,
  selectedWidgetId: 'btn-import-po',
  isImportModalOpen: false,

  showAllComponentPins: true,
  activePopoverWidgetId: null,
  isBundleModalOpen: false,
  isMcpModalOpen: false,
  mcpModalTab: 'local',
  mcpModalShareUrl: null,
  isWebPublishModalOpen: false,
  isWebPlayerMode: false,

  isWelcomeScreenOpen: true,
  currentProjectMeta: INITIAL_PROJECT_META,
  mindmaps: emptyMindmaps(),
  selectedMindmapNodeId: null,
  projectNotes: emptyProjectNotes(),
  selectedNoteNodeId: null,
  dockedNoteId: null,
  recentProjects: INITIAL_RECENT_PROJECTS,
  isProjectClosed: false,

  leftSidebarTab: 'pages',
  leftActivityView: 'pages',
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: false,
  dbTables: INITIAL_DB_TABLES,
  selectedTableId: 't_base_supplier',

  menuPulseBadges: {
    'supplier-approval': 2,
    'purchase-order-confirm': 1,
  },

  suppliers: INITIAL_SUPPLIERS,
  purchaseOrderItems: INITIAL_PO_ITEMS,
  acceptanceOrders: INITIAL_ACCEPTANCE_ORDERS,

  draftAcceptanceHeader: {
    acceptanceDate: '2026-10-28',
    acceptanceNo: 'DHY20250908001',
    inspector: '张检验',
    inboundType: '购买',
    sourceType: '供方发货单转入',
    deliveryPerson: '王送货',
    supplierId: 'SUP-01',
    supplierContact: '张晓明',
    supplierPhone: '13805328891',
    invoiceType: '专票',
    taxRate: 9,
    remark: '9月8日海创标物到货批次',
  },
  draftAcceptanceLines: INITIAL_ACCEPTANCE_LINES,

  stickyNotes: INITIAL_STICKY_NOTES,
  widgets: INITIAL_WIDGETS,
  auditScopeFilter: 'all',
  closedLoopIssues: [],
  flowLogs: [],

  navigationSource: null,
  setActivePage: (pageId, source) =>
    set((s) => {
      const nextBadges = { ...s.menuPulseBadges };
      delete nextBadges[pageId];
      let nextWidget: SelectableWidgetId = s.selectedWidgetId;
      if (pageId === 'supplier-approval') nextWidget = 'supplier-table-widget';
      else if (pageId === 'purchase-order-confirm') nextWidget = 'po-table-widget';
      else if (pageId === 'acceptance-new') nextWidget = 'btn-import-po';

      return {
        activePageId: pageId,
        navigationSource: source ?? null,
        menuPulseBadges: nextBadges,
        selectedWidgetId: nextWidget,
        activePopoverWidgetId: null,
      };
    }),

  setViewMode: (viewMode) => set({ viewMode }),
  setDockedNoteId: (dockedNoteId) => set({ dockedNoteId }),
  setMindmapSource: (projectId, mindmapId, source) => {
    const state = get();
    if (state.isProjectClosed || state.currentProjectMeta.projectId !== projectId) {
      throw new Error(tr('当前项目已变化，无法修改该项目的脑图', 'Current project changed; cannot modify its mindmap'));
    }
    if (!state.mindmaps.nodes.some(node => node.id === mindmapId && node.kind === 'mindmap')) throw new Error(tr('脑图菜单不存在', 'Mindmap node does not exist'));
    set({ mindmaps: { ...state.mindmaps, nodes: state.mindmaps.nodes.map(node => node.id === mindmapId ? { ...node, kind: 'mindmap' as const, source } : node) } });
  },
  setAuditScopeFilter: (auditScopeFilter) => set({ auditScopeFilter }),

  setWelcomeScreenOpen: (isWelcomeScreenOpen) => set({ isWelcomeScreenOpen }),

  setUIState: (uiState) => set({ uiState }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  toggleFolder: (folderId) =>
    set((s) => ({
      expandedFolders: {
        ...s.expandedFolders,
        [folderId]: !(s.expandedFolders[folderId] ?? true),
      },
    })),

  setShowDeprecatedNodes: (showDeprecatedNodes) => set({ showDeprecatedNodes }),
  selectWidget: (selectedWidgetId) => set({ selectedWidgetId }),
  setImportModalOpen: (isImportModalOpen) => set({ isImportModalOpen }),
  setShowAllComponentPins: (showAllComponentPins) => set({ showAllComponentPins }),
  setActivePopoverWidgetId: (activePopoverWidgetId) =>
    set((s) => ({
      activePopoverWidgetId,
      selectedWidgetId: activePopoverWidgetId || s.selectedWidgetId,
    })),
  setBundleModalOpen: (isBundleModalOpen) => set({ isBundleModalOpen }),
  setMcpModalOpen: (isMcpModalOpen, options) =>
    set((s) => ({
      isMcpModalOpen,
      ...(options?.tab ? { mcpModalTab: options.tab } : {}),
      ...(options && 'shareUrl' in options ? { mcpModalShareUrl: options.shareUrl ?? null } : !isMcpModalOpen ? { mcpModalShareUrl: null } : { mcpModalShareUrl: s.mcpModalShareUrl }),
    })),
  setWebPublishModalOpen: (isWebPublishModalOpen) => set({ isWebPublishModalOpen }),
  setWebPlayerMode: (isWebPlayerMode) =>
    set((s) => ({
      isWebPlayerMode,
      viewMode: isWebPlayerMode ? 'single_page' : s.viewMode,
    })),

  setLeftSidebarTab: (leftSidebarTab) =>
    set({ leftSidebarTab, leftActivityView: leftSidebarTab }),
  setLeftActivityView: (leftActivityView) =>
    set((s) => ({
      leftActivityView,
      leftSidebarTab:
        leftActivityView === 'pages' || leftActivityView === 'tables'
          ? leftActivityView
          : s.leftSidebarTab,
      leftSidebarCollapsed: false,
      viewMode:
        leftActivityView === 'materials' ||
        leftActivityView === 'composites' ||
        leftActivityView === 'outline' ||
        leftActivityView === 'ai'
          ? 'single_page'
          : s.viewMode,
    })),
  toggleLeftSidebar: () =>
    set((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
  toggleRightSidebar: () =>
    set((s) => ({ rightSidebarCollapsed: !s.rightSidebarCollapsed })),
  setSelectedTableId: (selectedTableId) => set({ selectedTableId }),

  toggleTableBindingForMenu: (tableId, pageId, menuTitle) =>
    set((s) => {
      const nextTables = s.dbTables.map((t) => {
        if (t.id !== tableId) return t;
        const exists = t.sharedByMenus.some((m) => m.pageId === pageId);
        const nextShared = exists
          ? t.sharedByMenus.filter((m) => m.pageId !== pageId)
          : [
              ...t.sharedByMenus,
              {
                pageId,
                menuTitle,
                accessMode: 'CRUD 读写' as const,
                fieldMappingNote: `在菜单【${menuTitle}】中勾选绑定共用此表`,
              },
            ];
        return { ...t, sharedByMenus: nextShared };
      });
      return {
        dbTables: nextTables,
        flowLogs: [
          {
            id: `log-${Date.now()}`,
            time: nowTime(),
            fromModule: `菜单 [${menuTitle}]`,
            toModule: `数据表 [${tableId}]`,
            summary: `更新菜单与数据表共用绑定关系`,
            detail: `已在【${menuTitle}】中切换绑定物理表 ${tableId}`,
          },
          ...s.flowLogs.slice(0, 19),
        ],
      };
    }),

  createNewTable: (tableName, cnName, domain, bindToMenu) =>
    set((s) => {
      validateTableDomain(domain);
      const cleanId = tableName.trim().replace(/\s+/g, '_').toLowerCase();
      if (s.dbTables.some((t) => t.id === cleanId)) return s;

      const newTable: DBTableSchema = {
        id: cleanId,
        tableName: cleanId,
        cnName: cnName.trim(),
        domain,
        description: bindToMenu
          ? tr(
              `由菜单【${bindToMenu.menuTitle}】就地创建并自动纳入项目全局表目录，可供其他模块菜单勾选共用。`,
              `Created from menu [${bindToMenu.menuTitle}] and registered in the shared project table catalog.`
            )
          : tr(`在左侧全局数据库表目录中创建的物理表。`, `Physical table created in the global database catalog.`),
        sharedByMenus: bindToMenu
          ? [
              {
                pageId: bindToMenu.pageId,
                menuTitle: bindToMenu.menuTitle,
                accessMode: 'CRUD 读写',
                fieldMappingNote: tr('创建该表的源头模块菜单', 'Originating menu that created this table'),
              },
            ]
          : [],
        columns: [
          {
            id: `col-${Date.now()}-1`,
            name: 'id',
            dataType: 'VARCHAR(32)',
            nullable: false,
            isPrimaryKey: true,
            comment: tr(`${cnName}主键 ID`, `${cnName} Primary Key ID`),
            sourceWidgetOrSticky: tr('系统默认主键', 'System primary key'),
          },
          {
            id: `col-${Date.now()}-2`,
            name: 'AcceptanceNew' in (bindToMenu || {}) ? 'acceptance_id' : 'biz_no',
            dataType: 'VARCHAR(64)',
            nullable: false,
            comment: tr('业务单据编号', 'Document No.'),
            sourceWidgetOrSticky: bindToMenu ? tr(`${bindToMenu.menuTitle}-单号字段`, `${bindToMenu.menuTitle} - No. field`) : tr('默认字段', 'Default column'),
          },
          {
            id: `col-${Date.now()}-3`,
            name: 'status',
            dataType: 'VARCHAR(24)',
            nullable: false,
            defaultValue: "'draft'",
            comment: tr('状态标识', 'Status'),
            sourceWidgetOrSticky: tr('状态机字段', 'State column'),
          },
          {
            id: `col-${Date.now()}-4`,
            name: 'created_at',
            dataType: 'DATETIME',
            nullable: false,
            comment: tr('创建时间', 'Created At'),
            sourceWidgetOrSticky: tr('审计字段', 'Audit column'),
          },
        ],
      };

      return {
        dbTables: [...s.dbTables, newTable],
        selectedTableId: cleanId,
        flowLogs: [
          {
            id: `log-${Date.now()}`,
            time: nowTime(),
            fromModule: bindToMenu ? `菜单 [${bindToMenu.menuTitle}]` : '左侧表目录',
            toModule: '全局数据库表目录 & ER画布',
            summary: `新建物理表 \`${cleanId} (${cnName})\``,
            detail: bindToMenu
              ? `已自动绑定至菜单【${bindToMenu.menuTitle}】并同步加入左侧全局表目录`
              : `已加入左侧全局数据库表目录，各菜单现可勾选共用`,
          },
          ...s.flowLogs.slice(0, 19),
        ],
      };
    }),

  addColumnToTable: (tableId, col) =>
    set((s) => {
      const nextTables = s.dbTables.map((t) => {
        if (t.id !== tableId) return t;
        return {
          ...t,
          columns: [
            ...t.columns,
            {
              ...col,
              id: createIdentity('col'),
              isNew: true,
            },
          ],
        };
      });
      const targetTable = s.dbTables.find((t) => t.id === tableId);
      return {
        dbTables: nextTables,
        flowLogs: [
          {
            id: `log-${Date.now()}`,
            time: nowTime(),
            fromModule: `表设计器 [${targetTable?.tableName}]`,
            toModule: `${targetTable?.sharedByMenus.length || 1} 个共用菜单`,
            summary: `新增字段 \`${col.name} (${col.dataType})\` - ${col.comment}`,
            detail: `已同步通知所有共用该表的模块菜单: ${targetTable?.sharedByMenus.map((m) => m.menuTitle).join('、')}`,
          },
          ...s.flowLogs.slice(0, 19),
        ],
      };
    }),

  updateColumnInTable: (tableId, colId, partial) =>
    set((s) => {
      const table = s.dbTables.find(t => t.id === tableId);
      const column = table?.columns.find(c => c.id === colId);
      if (!table || !column) return s;
      if (table.uniqueConstraints?.length) resolveUniqueConstraints({
        ...table, columns: table.columns.map(c => c.id === colId ? { ...c, ...partial } : c),
      });
      const oldReference = `${table.tableName}(${column.name})`;
      const renamed = partial.name !== undefined && partial.name !== column.name;
      return { dbTables: s.dbTables.map(t => t.id !== tableId && !renamed ? t : ({ ...t, columns: t.columns.map(c => {
        const next = t.id === tableId && c.id === colId ? { ...c, ...partial } : c;
        return renamed && next.references === oldReference
          ? { ...next, references: `${table.tableName}(${partial.name})` }
          : next;
      }) })) };
    }),

  setUniqueConstraints: (tableId, constraints) => set(s => {
    const table = s.dbTables.find(t => t.id === tableId);
    if (!table) throw new Error(tr('唯一约束所属的表不存在', 'Table for unique constraint does not exist'));
    const next = { ...table, uniqueConstraints: constraints };
    resolveUniqueConstraints(next);
    return { dbTables: s.dbTables.map(t => t.id === tableId ? next : t) };
  }),

  deleteColumnFromTable: (tableId, colId) => set(s => {
    const table = s.dbTables.find(t => t.id === tableId);
    if (!table) return s;
    const key = table.uniqueConstraints?.find(k => k.columnIds.includes(colId));
    if (key) throw new Error(tr(`请先修改或删除引用该字段的唯一约束 ${key.name}`, `Please update or delete unique constraint ${key.name} referencing this column first`));
    return { dbTables: s.dbTables.map(t => t.id === tableId ? { ...t, columns: t.columns.filter(c => c.id !== colId) } : t) };
  }),

  insertColumnAt: (tableId, index, col) =>
    set((s) => ({
      dbTables: s.dbTables.map((t) => {
        if (t.id !== tableId) return t;
        const nextCols = [...t.columns];
        const safeIdx = Math.max(0, Math.min(index, nextCols.length));
        nextCols.splice(safeIdx, 0, {
          ...col,
          id: createIdentity('col'),
          isNew: true,
        });
        return { ...t, columns: nextCols };
      }),
    })),

  reorderColumnInTable: (tableId, fromIndex, toIndex) =>
    set((s) => ({
      dbTables: s.dbTables.map((t) => {
        if (t.id !== tableId) return t;
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= t.columns.length ||
          toIndex >= t.columns.length
        ) {
          return t;
        }
        const nextCols = [...t.columns];
        const [moved] = nextCols.splice(fromIndex, 1);
        nextCols.splice(toIndex, 0, moved);
        return { ...t, columns: nextCols };
      }),
    })),

  duplicateTable: (tableId) => {
    const s = get();
    const src = s.dbTables.find((t) => t.id === tableId);
    if (!src) return tableId;
    const newId = `${src.tableName}_copy_${Math.floor(Math.random() * 90 + 10)}`;
    const copiedKeys = resolveUniqueConstraints(src);
    const columnIds = new Map(src.columns.map(c => [c.id, createIdentity('col')]));
    const copyTable: DBTableSchema = {
      ...src,
      id: newId,
      tableName: newId,
      cnName: tr(`${src.cnName} (副本)`, `${src.cnName} (Copy)`),
      columns: src.columns.map(c => ({ ...c, id: columnIds.get(c.id)! })),
      ...(src.uniqueConstraints && { uniqueConstraints: copiedKeys.map(k => ({
        name: k.name, columnIds: k.columns.map(c => columnIds.get(c.id)!),
      })) }),
    };
    set({
      dbTables: [...s.dbTables, copyTable],
      selectedTableId: newId,
    });
    return newId;
  },

  deleteTable: (tableId) =>
    set((s) => {
      if (s.dbTables.length <= 1) return s;
      const nextTables = s.dbTables.filter((t) => t.id !== tableId);
      return {
        dbTables: nextTables,
        selectedTableId:
          s.selectedTableId === tableId ? nextTables[0].id : s.selectedTableId,
      };
    }),

  updateTableMeta: (tableId, partial) =>
    set((s) => {
      const table = s.dbTables.find(t => t.id === tableId);
      if (!table) return s;
      if (Object.hasOwn(partial, 'domain')) validateTableDomain(partial.domain);
      const renamed = partial.tableName !== undefined && partial.tableName !== table.tableName;
      return { dbTables: s.dbTables.map(t => t.id !== tableId && !renamed ? t : ({
        ...(t.id === tableId ? { ...t, ...partial } : t),
        columns: renamed ? t.columns.map(c => {
          const ref = c.references && /^([\w]+)\(([\w]+)\)$/.exec(c.references);
          return ref && ref[1] === table.tableName
            ? { ...c, references: `${partial.tableName}(${ref[2]})` }
            : c;
        }) : t.columns,
      })) };
    }),

  approveSupplier: (supplierId) =>
    set((s) => {
      const target = s.suppliers.find((sup) => sup.id === supplierId);
      if (!target) return s;
      const nextSuppliers = s.suppliers.map((sup) =>
        sup.id === supplierId
          ? { ...sup, status: 'qualified' as const, updatedAt: nowTime(), isNew: true }
          : sup
      );

      return {
        suppliers: nextSuppliers,
        menuPulseBadges: {
          ...s.menuPulseBadges,
          'qualified-suppliers': (s.menuPulseBadges['qualified-suppliers'] || 0) + 1,
          'acceptance-new': (s.menuPulseBadges['acceptance-new'] || 0) + 1,
        },
        flowLogs: [
          {
            id: `log-${Date.now()}`,
            time: nowTime(),
            fromModule: '基础资料 → 供应商审批',
            toModule: '共表 t_base_supplier',
            summary: `UPDATE t_base_supplier SET status='qualified' WHERE name='${target.name}'`,
            detail: `因为【合格供应商目录】与【新增到货验收】共用此表，下游已实时感知该数据变更！`,
          },
          ...s.flowLogs.slice(0, 19),
        ],
      };
    }),

  addNewSupplier: (name, contact, phone, category) =>
    set((s) => {
      const newSup: SupplierRecord = {
        id: `SUP-0${s.suppliers.length + 1}`,
        code: `VND-2026-00${s.suppliers.length + 1}`,
        name,
        contactPerson: contact,
        phone,
        category,
        taxRateDefault: 13,
        status: 'qualified',
        updatedAt: nowTime(),
        isNew: true,
      };
      return {
        suppliers: [newSup, ...s.suppliers],
        menuPulseBadges: {
          ...s.menuPulseBadges,
          'qualified-suppliers': (s.menuPulseBadges['qualified-suppliers'] || 0) + 1,
          'acceptance-new': (s.menuPulseBadges['acceptance-new'] || 0) + 1,
        },
        flowLogs: [
          {
            id: `log-${Date.now()}`,
            time: nowTime(),
            fromModule: '基础资料 → 供应商管理',
            toModule: '共表 t_base_supplier',
            summary: `INSERT INTO t_base_supplier (${name})`,
            detail: `所有共用 t_base_supplier 表的模块菜单已同步更新`,
          },
          ...s.flowLogs.slice(0, 19),
        ],
      };
    }),

  confirmPurchaseOrder: (poItemId) =>
    set((s) => {
      const target = s.purchaseOrderItems.find((p) => p.id === poItemId);
      if (!target) return s;
      return {
        purchaseOrderItems: s.purchaseOrderItems.map((p) =>
          p.id === poItemId ? { ...p, status: 'confirmed' as const } : p
        ),
        menuPulseBadges: {
          ...s.menuPulseBadges,
          'acceptance-new': (s.menuPulseBadges['acceptance-new'] || 0) + 1,
        },
        flowLogs: [
          {
            id: `log-${Date.now()}`,
            time: nowTime(),
            fromModule: '采购管理 → 采购订单确认',
            toModule: '共表 t_pms_po_item',
            summary: `UPDATE t_pms_po_item SET status='confirmed' (${target.poNumber})`,
            detail: `可在【新增到货验收】点击“选择采购明细”按钮将该物料转入验收表`,
          },
          ...s.flowLogs.slice(0, 19),
        ],
      };
    }),

  importPoItemsToAcceptance: (poItemIds) =>
    set((s) => {
      const selectedItems = s.purchaseOrderItems.filter((p) => poItemIds.includes(p.id));
      if (selectedItems.length === 0) return { isImportModalOpen: false };

      const existingSourceIds = new Set(s.draftAcceptanceLines.map((l) => l.sourcePoItemId));
      const newLines: AcceptanceLineItem[] = [];

      selectedItems.forEach((po, idx) => {
        if (!existingSourceIds.has(po.id)) {
          const remaining = Math.max(1, po.orderedQty - po.deliveredQty);
          newLines.push({
            id: `LINE-${Date.now()}-${idx}`,
            sourcePoItemId: po.id,
            planCategory: po.planCategory,
            materialCode: po.materialCode,
            materialName: po.materialName,
            spec: po.spec,
            brand: po.brand,
            unit: po.unit,
            orderedQty: po.orderedQty,
            alreadyAcceptedQty: po.deliveredQty,
            currentAcceptQty: remaining,
            useCustomTaxPrice: false,
            unitPriceTaxIncluded: po.unitPriceTaxIncluded,
            taxRate: po.taxRate,
            projectCode: po.projectCode,
            serialNo: `00${s.draftAcceptanceLines.length + newLines.length + 1}`,
            isNewItem: true,
          });
        }
      });

      return {
        draftAcceptanceLines: [...s.draftAcceptanceLines, ...newLines],
        draftAcceptanceHeader: {
          ...s.draftAcceptanceHeader,
          sourceType: '采购订单转入',
        },
        isImportModalOpen: false,
        flowLogs: [
          {
            id: `log-${Date.now()}`,
            time: nowTime(),
            fromModule: 't_pms_po_item',
            toModule: 't_wms_acceptance_detail',
            summary: `跨表关联转入 ${newLines.length} 条采购明细行`,
            detail: `通过外键 source_po_item_id 绑定并自动按 6 位小数公式计算不含税单价`,
          },
          ...s.flowLogs.slice(0, 19),
        ],
      };
    }),

  updateAcceptanceHeader: (partial) =>
    set((s) => {
      const nextHeader = { ...s.draftAcceptanceHeader, ...partial };
      const rule1Active = s.stickyNotes.find((r) => r.id === 'sticky-1')?.active ?? true;
      if (partial.supplierId && rule1Active) {
        const sup = s.suppliers.find((x) => x.id === partial.supplierId);
        if (sup) {
          nextHeader.supplierContact = sup.contactPerson;
          nextHeader.supplierPhone = sup.phone;
          nextHeader.taxRate = sup.taxRateDefault;
        }
      }
      return { draftAcceptanceHeader: nextHeader };
    }),

  updateAcceptanceLineQty: (lineId, qty) =>
    set((s) => {
      const rule4Active = s.stickyNotes.find((r) => r.id === 'sticky-4')?.active ?? true;
      const strictCheck = s.widgets['acceptance-detail-grid'].props.strictQtyCheck ?? true;

      const nextLines = s.draftAcceptanceLines.map((line) => {
        if (line.id !== lineId) return line;
        const maxAllowed = Math.max(0, line.orderedQty - line.alreadyAcceptedQty);
        let finalQty = Math.max(0, qty);
        if (rule4Active && strictCheck && finalQty > maxAllowed) {
          finalQty = maxAllowed;
        }
        return { ...line, currentAcceptQty: finalQty };
      });

      return { draftAcceptanceLines: nextLines };
    }),

  updateAcceptanceLinePrice: (lineId, price) =>
    set((s) => ({
      draftAcceptanceLines: s.draftAcceptanceLines.map((line) =>
        line.id === lineId
          ? { ...line, unitPriceTaxIncluded: Math.max(0, price), useCustomTaxPrice: true }
          : line
      ),
    })),

  removeAcceptanceLine: (lineId) =>
    set((s) => ({
      draftAcceptanceLines: s.draftAcceptanceLines.filter((l) => l.id !== lineId),
    })),

  submitAcceptanceOrder: (asDraft = false) =>
    set((s) => {
      const sup = s.suppliers.find((x) => x.id === s.draftAcceptanceHeader.supplierId);
      const totalAmount = s.draftAcceptanceLines.reduce(
        (sum, l) => sum + l.currentAcceptQty * l.unitPriceTaxIncluded,
        0
      );

      const newOrder: AcceptanceOrderRecord = {
        id: `ACC-${Date.now().toString().slice(-4)}`,
        acceptanceNo: s.draftAcceptanceHeader.acceptanceNo,
        acceptanceDate: s.draftAcceptanceHeader.acceptanceDate,
        inboundType: s.draftAcceptanceHeader.inboundType,
        sourceType: s.draftAcceptanceHeader.sourceType,
        supplierName: sup?.name || '未知供应商',
        supplierContact: s.draftAcceptanceHeader.supplierContact,
        supplierPhone: s.draftAcceptanceHeader.supplierPhone,
        taxRate: s.draftAcceptanceHeader.taxRate,
        totalAmount: Number(totalAmount.toFixed(2)),
        inspector: s.draftAcceptanceHeader.inspector,
        deliveryPerson: s.draftAcceptanceHeader.deliveryPerson,
        remark: s.draftAcceptanceHeader.remark,
        status: asDraft ? '草稿' : '已提交验收',
        itemCount: s.draftAcceptanceLines.length,
        createdAt: `2026-10-28 ${nowTime()}`,
        isNew: true,
      };

      const nextPoItems = s.purchaseOrderItems.map((po) => {
        const matchedLine = s.draftAcceptanceLines.find((l) => l.sourcePoItemId === po.id);
        if (!matchedLine || asDraft) return po;
        const nextDelivered = po.deliveredQty + matchedLine.currentAcceptQty;
        return {
          ...po,
          deliveredQty: nextDelivered,
          status: nextDelivered >= po.orderedQty ? ('completed' as const) : po.status,
        };
      });

      const nextSerial = Math.floor(100 + Math.random() * 899);

      return {
        acceptanceOrders: [newOrder, ...s.acceptanceOrders],
        purchaseOrderItems: nextPoItems,
        draftAcceptanceHeader: {
          ...s.draftAcceptanceHeader,
          acceptanceNo: `DHY20250908${nextSerial}`,
        },
        menuPulseBadges: {
          ...s.menuPulseBadges,
          'acceptance-list': (s.menuPulseBadges['acceptance-list'] || 0) + 1,
          'purchase-order-confirm': (s.menuPulseBadges['purchase-order-confirm'] || 0) + 1,
        },
        flowLogs: [
          {
            id: `log-${Date.now()}`,
            time: nowTime(),
            fromModule: '新增到货验收 (Page 57)',
            toModule: 't_wms_acceptance_order & t_pms_po_item',
            summary: `${asDraft ? '暂存草稿' : '正式提交'}验收单【${newOrder.acceptanceNo}】合计 ¥${newOrder.totalAmount.toFixed(2)}`,
            detail: `已写入共用主表 t_wms_acceptance_order，并反向更新 t_pms_po_item.delivered_qty`,
          },
          ...s.flowLogs.slice(0, 19),
        ],
      };
    }),

  toggleStickyRule: (ruleId) =>
    set((s) => ({
      stickyNotes: s.stickyNotes.map((r) => (r.id === ruleId ? { ...r, active: !r.active } : r)),
    })),

  addStickyRuleToWidget: (pageId, targetWidgetId, text, targetWidgetName) =>
    set((s) => {
      const targetWidget = s.widgets[targetWidgetId]?.pageId === pageId ? s.widgets[targetWidgetId] : undefined;
      const resolvedName = targetWidgetName || targetWidget?.name || targetWidgetId;
      const pageRules = s.stickyNotes.filter((r) => r.pageId === pageId);
      const nextRule: StickyNoteRule = {
        id: `sticky-${Date.now()}`,
        pageId,
        targetWidgetId,
        targetWidgetName: resolvedName,
        index: pageRules.length + 1,
        text,
        compiledRule: '', // A requirement note is not executable code.
        active: true,
      };
      return {
        stickyNotes: [...s.stickyNotes, nextRule],
        flowLogs: [
          {
            id: `log-${Date.now()}`,
            time: nowTime(),
            fromModule: `组件便签 [${resolvedName}]`,
            toModule: '底部总表 & 数据库设计器',
            summary: `在组件【${resolvedName}】上新增了第 ${nextRule.index} 条便签`,
            detail: text,
          },
          ...s.flowLogs.slice(0, 19),
        ],
      };
    }),

  updateStickyRuleText: (ruleId, text) =>
    set((s) => ({
      stickyNotes: s.stickyNotes.map((r) => (r.id === ruleId ? { ...r, text, compiledRule: '' } : r)),
    })),

  deleteStickyRule: (ruleId) =>
    set((s) => {
      const filtered = s.stickyNotes
        .filter((r) => r.id !== ruleId)
        .map((r, idx) => ({ ...r, index: idx + 1 }));
      return { stickyNotes: filtered };
    }),

  updateWidgetProps: (id, partial) =>
    set((s) => {
      // If precisionDigits changed, also sync the DECIMAL(18, X) type in t_wms_acceptance_detail!
      let nextTables = s.dbTables;
      if (id === 'acceptance-detail-grid' && partial.precisionDigits !== undefined) {
        nextTables = s.dbTables.map((t) =>
          t.id === 't_wms_acceptance_detail'
            ? {
                ...t,
                columns: t.columns.map((c) =>
                  c.name === 'unit_price_no_tax'
                    ? { ...c, dataType: `DECIMAL(18, ${partial.precisionDigits})` }
                    : c
                ),
              }
            : t
        );
      }

      return {
        dbTables: nextTables,
        widgets: {
          ...s.widgets,
          [id]: {
            ...s.widgets[id],
            props: {
              ...s.widgets[id].props,
              ...partial,
            },
          },
        },
      };
    }),


}));
