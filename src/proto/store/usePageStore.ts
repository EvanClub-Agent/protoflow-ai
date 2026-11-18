import { valuesWithColumnDefaults } from '../database/columnDefault';
import { seedRelatedTables } from '../database/previewRelations';
import { create } from 'zustand';
import { mapPurchaseOrderLines, purchaseTransferContractError } from '../runtime/purchaseTransfer';
import { newId } from '../../utils/identity';
import { folderOptions, validateDesignerFolders, emptySitemapOverrides, prepareSitemapMove, type DesignerFolder, type SitemapOverrides, type SitemapMoveTarget } from '../sitemap';
import { SITEMAP_TREE, useProtoStore, type SitemapItem, type DBTableSchema } from '../../store/useProtoStore';
import { generateMockRows, generatePreviewRows, type Row } from '../runtime/mock';
import { generateListPageSource, generateMasterDetailPageSource } from '../ai/templates';
import { printPageSource } from '../dsl/printer';
import { walk } from '../dsl/tree';
import type { ProtoNode } from '../types';
import { isMobileComponentType, type MobileDevicePreset, type PagePlatform } from '../mobile/types';

export type CompositeCategory = 'header' | 'query' | 'table' | 'form' | 'approval' | 'overlay';

export interface CustomCompositeBlock {
  id: string;
  title: string;
  category: CompositeCategory;
  description: string;
  rootType: string;
  childCount: number;
  /** Constrained TSX snippet representing the root ProtoNode subtree */
  tsxSnippet: string;
  createdAt: string;
  isBuiltin?: boolean;
  /** Terminal platform this composite block belongs to ('desktop' by default) */
  platform?: PagePlatform;
}

export const COMPOSITE_CATEGORY_LABELS: Record<CompositeCategory, string> = {
  header: '单据表头',
  query: '查询过滤',
  table: '明细表格',
  form: '表单区块',
  approval: '审批核验',
  overlay: '弹层模板',
};

const COMPOSITE_STORAGE_KEY = 'protoflow_composite_blocks_v1';

export const DEFAULT_COMPOSITE_BLOCKS: CustomCompositeBlock[] = [
  {
    id: 'blk_builtin_doc_header',
    title: '单据标准三栏表头卡片',
    category: 'header',
    description: '标准 SaaS/ERP 单据表头：含单据编号、业务日期、供方选择、经办部门、税率与备注 6 项三栏排布',
    rootType: 'Card',
    childCount: 6,
    createdAt: '2026-10-28',
    isBuiltin: true,
    tsxSnippet: `<Card title="单据基础信息 (标准三栏表头)" cols={3} extra="支持绑定物理主表">
  <Input label="单据编号" name="order_no" defaultValue="DOC-20261028-001" disabled={true} width="1/3" />
  <DatePicker label="业务发生日期" name="biz_date" required={true} width="1/3" />
  <Select label="关联供应商" name="supplier_id" table="t_base_supplier" labelField="supplier_name" valueField="id" required={true} allowClear={true} showSearch={true} width="1/3" />
  <Select label="经办业务部门" name="dept_name" options="电商运营部,智能供应链部,仓储物流部,财务结算部" defaultValue="电商运营部" width="1/3" />
  <InputNumber label="默认增值税率(%)" name="tax_rate" defaultValue={13} min={0} max={100} addonAfter="%" width="1/3" />
  <Input label="单据摘要备注" name="remark" placeholder="请输入业务背景或特殊订单说明..." allowClear={true} width="1/3" />
</Card>`,
  },
  {
    id: 'blk_builtin_query_bar',
    title: '列表高频组合查询栏',
    category: 'query',
    description: '带关键词检索、状态筛选、起止日期范围及右侧查询/重置/导出操作按钮组的标准过滤区',
    rootType: 'QueryForm',
    childCount: 4,
    createdAt: '2026-10-28',
    isBuiltin: true,
    tsxSnippet: `<QueryForm cols={3} labelAlign="right" colon={true}>
  <Input label="关键词检索" name="keyword" placeholder="输入单号 / 编码 / 名称模糊搜索" allowClear={true} />
  <Select label="流转状态" name="status" options="全部,待审批,已通过,已驳回,已归档" allowClear={true} />
  <DateRangePicker label="创建日期范围" name="date_range" />
</QueryForm>`,
  },
  {
    id: 'blk_builtin_detail_table',
    title: '带工具栏的业务明细表区块',
    category: 'table',
    description: '上方含新增/导入/合规校验工具栏，下方含斑马纹、纵向边框、勾选列与底部合计行的标准明细表',
    rootType: 'Card',
    childCount: 5,
    createdAt: '2026-10-28',
    isBuiltin: true,
    tsxSnippet: `<Card title="业务单据明细清单" extra="支持行内校验与底部自动汇总">
  <Toolbar align="between">
    <Space>
      <Button type="primary" icon="Plus">新增明细行</Button>
      <Button type="default" dashed={true}>Excel 批量导入</Button>
    </Space>
    <Space>
      <Tag color="blue">共关联 4 项防超收校验规则</Tag>
      <Button type="default" size="small">导出明细</Button>
    </Space>
  </Toolbar>
  <Table
    table="t_wms_acceptance_detail"
    rowKey="id"
    size="middle"
    striped={true}
    bordered={true}
    showSummary={true}
    selectionType="checkbox"
    pageSize={5}
    columns={[
      { key: 'material_code', title: '商品编码', kind: 'text', sortable: true },
      { key: 'current_accept_qty', title: '本次入库数量', kind: 'number', align: 'right', sortable: true },
      { key: 'unit_price_tax_included', title: '含税单价(元)', kind: 'currency', align: 'right' },
      { key: 'unit_price_no_tax', title: '不含税单价(6位)', kind: 'number', align: 'right' },
      { key: 'tax_amount', title: '税额小计', kind: 'currency', align: 'right', sortable: true }
    ]}
  />
</Card>`,
  },
  {
    id: 'blk_builtin_approval_block',
    title: '双栏审批核验与凭证区块',
    category: 'approval',
    description: '适用于审批流节点：含实心按钮式审核结论、退回节点选择、签署意见及拖拽上传现场凭证',
    rootType: 'Card',
    childCount: 4,
    createdAt: '2026-10-28',
    isBuiltin: true,
    tsxSnippet: `<Card title="审核签署意见与现场凭证" cols={2} extra="流转闭环节点">
  <Radio label="审核结论" name="audit_result" options="审核通过,有条件通过,退回补正,作废冲销" defaultValue="审核通过" optionType="button" buttonStyle="solid" required={true} width="1/2" />
  <Select label="异常退回目标节点" name="rollback_step" options="原单草稿修改,采购订单重签,实验室复检" placeholder="仅退回时必选" allowClear={true} width="1/2" />
  <Textarea label="审核签署意见" name="audit_comment" rows={3} placeholder="请填写具体核验结论或退回整改要求..." showCount={true} maxLength={200} required={true} width="full" />
  <Upload label="现场核验附件 / 质检报告" name="audit_files" listType="dragger" accept=".pdf,.jpg,.png,.xlsx" buttonText="点击或将质检报告拖拽至此区域上传" width="full" />
</Card>`,
  },
  {
    id: 'blk_builtin_mobile_hero_bento',
    title: 'Gemini 流光问候与 Bento 启发区',
    category: 'header',
    description: '移动端首页黄金首屏：含流光渐变问候标题、胶囊搜索条与 2×2 现代便当盒功能入口',
    rootType: 'MSurface',
    childCount: 3,
    createdAt: '2026-11-10',
    isBuiltin: true,
    platform: 'mobile',
    tsxSnippet: `<MSurface title="智能空间入口" tone="glow" padding="md">
  <MHeroHeader mode="greeting" eyebrow="AI 驱动现代体验" title="你好，Alex" subtitle="快速发起查询、审批或浏览精选服务" />
  <MSearchPill placeholder="搜索单号、服务或向 AI 提问..." showFilter={true} />
  <MBentoGrid cols={2} layout="equal" items={[
    { title: '智能洞察', subtitle: '自动汇总今日重点', icon: 'Sparkles', badge: 'AI', tone: 'violet' },
    { title: '协同事项', subtitle: '待处理申请 3 项', icon: 'Layers', badge: '3', tone: 'blue' }
  ]} />
</MSurface>`,
  },
  {
    id: 'blk_builtin_mobile_sheet_form',
    title: '移动端半屏抽屉触控表单',
    category: 'overlay',
    description: 'Gemini 风格 28px 大圆弧半屏抽屉：含填充式输入框、胶囊规格点选组与底部悬浮确认栏',
    rootType: 'MBottomSheet',
    childCount: 2,
    createdAt: '2026-11-10',
    isBuiltin: true,
    platform: 'mobile',
    tsxSnippet: `<MBottomSheet id="sheet-quick-action" title="快速填写与确认" subtitle="支持绑定物理表实时写入" size="medium">
  <MForm title="基础信息">
    <MField label="项目名称" name="name" placeholder="请输入名称..." required={true} />
    <MChipSelect label="优先级标签" name="priority" options="常规办理,重点跟进,加急优先" />
    <MField label="补充说明" name="remark" inputType="textarea" placeholder="请输入备注..." />
  </MForm>
  <MBottomDock mode="action" secondaryText="取消" primaryText="确认提交" onSecondary={() => closeOverlay()} onPrimary={() => { toast('已提交'); closeOverlay(); }} />
</MBottomSheet>`,
  },
];

function loadCompositeBlocks(): CustomCompositeBlock[] {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(COMPOSITE_STORAGE_KEY) : null;
    if (!raw) return DEFAULT_COMPOSITE_BLOCKS;
    const parsed = JSON.parse(raw) as CustomCompositeBlock[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_COMPOSITE_BLOCKS;
    // Ensure builtins exist alongside user custom blocks
    const userBlocks = parsed.filter((b) => !b.isBuiltin);
    return [... userBlocks, ...DEFAULT_COMPOSITE_BLOCKS];
  } catch {
    return DEFAULT_COMPOSITE_BLOCKS;
  }
}

function persistCompositeBlocks(blocks: CustomCompositeBlock[]) {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(COMPOSITE_STORAGE_KEY, JSON.stringify(blocks));
    }
  } catch {
    // ignore storage quota errors
  }
}

function nodeToTsxSnippet(node: ProtoNode): string {
  try {
    const full = printPageSource({ header: [], root: node });
    return full
      .replace(/^export default function Page\(\) \{\n\s*return \(\n/, '')
      .replace(/\n\s*\);\n\}\n?$/, '')
      .trim();
  } catch {
    return `<${node.type} />`;
  }
}

export interface DesignerPage {
  pageId: string;
  title: string;
  /** Sitemap folder id the page is listed under */
  folderId: string;
  /** Terminal platform ('desktop' by default when omitted in legacy archives) */
  platform?: PagePlatform;
}

interface PageHistory {
  past: string[];
  future: string[];
}

interface PageStore {
  /** Page id → constrained TSX source (the single source of truth for designer pages) */
  pageSources: Record<string, string>;
  designerPages: DesignerPage[];
  sitemapBase: SitemapItem[];
  designerFolders: DesignerFolder[];
  sitemapOverrides: SitemapOverrides;
  /** Active iPhone viewport preset for mobile canvas preview & editing */
  mobileDevice: MobileDevicePreset;
  setMobileDevice: (device: MobileDevicePreset) => void;
  moveSitemapItem: (target: SitemapMoveTarget, parentFolderId: string | null, projectId: string) => void;
  history: Record<string, PageHistory>;
  /** Shared mock rows per physical table — every page bound to the same table sees the same data */
  tableRows: Record<string, Row[]>;

  setPageSource: (pageId: string, source: string, opts?: { recordHistory?: boolean }) => void;
  undo: (pageId: string) => void;
  redo: (pageId: string) => void;
  createDesignerPage: (page: DesignerPage, source: string) => void;
  createDesignerFolder: (title: string, parentFolderId: string | null) => DesignerFolder;
  renameDesignerPage: (pageId: string, title: string) => void;

  prepareRelatedExamples: () => void;
  snapshotPreviewRows: () => Record<string, Row[]>;
  getRows: (tableId: string) => Row[];
  insertRow: (tableId: string, values: Record<string, unknown>) => Row;
  updateRow: (tableId: string, id: string, values: Record<string, unknown>) => void;
  deleteRow: (tableId: string, id: string) => void;
  resetRows: () => void;
  importPurchaseOrderLines: (sourceTableId: string, targetTableId: string, ids: string[], orderId: string) => number;

  /** Team reusable business composite components (precipitated from canvas + built-in) */
  compositeBlocks: CustomCompositeBlock[];
  saveCompositeBlock: (input: {
    title: string;
    category: CompositeCategory;
    description: string;
    node: ProtoNode;
  }) => CustomCompositeBlock;
  deleteCompositeBlock: (id: string) => void;
}

const HISTORY_LIMIT = 120;

export const initialPages = (tables: DBTableSchema[]): { sources: Record<string, string>; pages: DesignerPage[] } => {
  const byId = (id: string) => tables.find((t) => t.id === id);
  const supplier = byId('t_base_supplier');
  const material = byId('t_base_material');
  const po = byId('t_pms_po_item');
  const accOrder = byId('t_wms_acceptance_order');
  const accDetail = byId('t_wms_acceptance_detail');

  const sources: Record<string, string> = {};
  const pages: DesignerPage[] = [];

  if (accOrder && accDetail) {
    sources['acceptance-new'] = generateMasterDetailPageSource(accOrder, accDetail, po, supplier, {
      pageId: 'acceptance-new',
      title: '新增到货验收 (57 of 130)',
      menuPath: ['验收入库管理', '新增到货验收'],
    });
  }
  if (supplier) {
    sources['supplier-approval'] = generateListPageSource(supplier, tables, {
      pageId: 'supplier-approval',
      title: '供应商准入与审批',
      menuPath: ['基础资料管理', '供应商审批'],
      relatedTable: po,
      withStatusTabs: true,
    });
    sources['qualified-suppliers'] = generateListPageSource(supplier, tables, {
      pageId: 'qualified-suppliers',
      title: '合格供应商目录',
      menuPath: ['基础资料管理', '合格供应商目录'],
      relatedTable: po,
      withStatusTabs: false,
    });
  }
  if (material) {
    sources['material-catalog'] = generateListPageSource(material, tables, {
      pageId: 'material-catalog',
      title: '标准物料主数据目录',
      menuPath: ['基础资料管理', '物料目录'],
      relatedTable: po,
      withStatusTabs: false,
    });
  }
  if (po) {
    sources['purchase-order-confirm'] = generateListPageSource(po, tables, {
      pageId: 'purchase-order-confirm',
      title: '采购订单确认与交期排程',
      menuPath: ['采购与招标管理', '采购订单确认'],
      relatedTable: accDetail,
      withStatusTabs: true,
    });
    sources['annual-plan'] = generateListPageSource(po, tables, {
      pageId: 'annual-plan',
      title: '季度补货计划预算',
      menuPath: ['年度计划-审批', '季度补货计划预算'],
      withStatusTabs: true,
    });
  }
  if (accOrder) {
    sources['acceptance-list'] = generateListPageSource(accOrder, tables, {
      pageId: 'acceptance-list',
      title: '到货验收单台账 (已入库)',
      menuPath: ['验收入库管理', '到货验收单台账'],
      relatedTable: accDetail,
      withStatusTabs: true,
    });
  }

  return { sources, pages };
};

// Keep lazy preview initialization distinct from authored/saved data. This metadata
// is deliberately not persisted: rows loaded from a project are real saved input.
const initializedPreviewRows = new WeakMap<Row[], { projectId: string; tableId: string; initialValue: string }>();

/** Conflict checks ignore only unchanged rows created by opening a preview. */
export function tableRowsForProjectRevision(): PageStore['tableRows'] {
  const projectId = useProtoStore.getState().currentProjectMeta.projectId;
  return Object.fromEntries(Object.entries(usePageStore.getState().tableRows).filter(([tableId, rows]) => {
    const seed = initializedPreviewRows.get(rows);
    // Explicit writes replace the array; the value check also catches an in-place edit.
    return !seed || seed.projectId !== projectId || seed.tableId !== tableId || seed.initialValue !== JSON.stringify(rows);
  }));
}

export const usePageStore = create<PageStore>((set, get) => {
  const init = initialPages(useProtoStore.getState().dbTables);
  let pendingRows: { projectId: string; generation: PageStore['tableRows']; schema: DBTableSchema[]; rows: PageStore['tableRows'] } | undefined;
  function previewInputs() {
    const project = useProtoStore.getState();
    // The built-in template supplies PO lines and their supplier records through explicit contracts.
    const isErpStarter = project.currentProjectMeta.templateId === 'saas_inventory' || project.currentProjectMeta.templateId === 'customs_erp';
    const fixed: Record<string, Row[]> = !isErpStarter ? {} : {
      t_base_supplier: project.suppliers.map(supplier => ({
        id: supplier.id, supplier_code: supplier.code, supplier_name: supplier.name,
        contact_person: supplier.contactPerson, contact_phone: supplier.phone,
        tax_rate_default: supplier.taxRateDefault, status: supplier.status,
      })),
      t_pms_po_item: project.purchaseOrderItems.map(po => ({
        id: po.id, po_number: po.poNumber, supplier_id: po.supplierId,
        ordered_qty: po.orderedQty, delivered_qty: po.deliveredQty,
        material_code: po.materialCode, unit_price_tax_included: po.unitPriceTaxIncluded,
        tax_rate: po.taxRate, project_code: po.projectCode, status: po.status,
      })) };
    return {project, fixed};
  }
  function currentData() {
    const saved = get().tableRows;
    const project = useProtoStore.getState();
    return pendingRows && pendingRows.projectId === project.currentProjectMeta.projectId &&
      pendingRows.generation === saved && pendingRows.schema === project.dbTables ? { ...pendingRows.rows, ...saved } : saved;
  }
  return {
    pageSources: init.sources,
    designerPages: init.pages,
    sitemapBase: structuredClone(SITEMAP_TREE),
    designerFolders: [],
    sitemapOverrides: emptySitemapOverrides(),
    mobileDevice: 'iphone',
    setMobileDevice: (mobileDevice) => set({ mobileDevice }),
    history: {},
    tableRows: {},
    compositeBlocks: loadCompositeBlocks(),

    setPageSource: (pageId, source, opts) =>
      set((s) => {
        const prev = s.pageSources[pageId];
        if (prev === source) return s;
        const record = opts?.recordHistory !== false && prev !== undefined;
        const h = s.history[pageId] ?? { past: [], future: [] };
        return {
          pageSources: { ...s.pageSources, [pageId]: source },
          history: record
            ? { ...s.history, [pageId]: { past: [...h.past, prev].slice(-HISTORY_LIMIT), future: [] } }
            : s.history,
        };
      }),

    undo: (pageId) =>
      set((s) => {
        const h = s.history[pageId];
        if (!h || h.past.length === 0) return s;
        const prev = h.past[h.past.length - 1];
        return {
          pageSources: { ...s.pageSources, [pageId]: prev },
          history: {
            ...s.history,
            [pageId]: { past: h.past.slice(0, -1), future: [s.pageSources[pageId], ...h.future] },
          },
        };
      }),

    redo: (pageId) =>
      set((s) => {
        const h = s.history[pageId];
        if (!h || h.future.length === 0) return s;
        const [next, ...rest] = h.future;
        return {
          pageSources: { ...s.pageSources, [pageId]: next },
          history: { ...s.history, [pageId]: { past: [...h.past, s.pageSources[pageId]], future: rest } },
        };
      }),

    moveSitemapItem: (target, parentFolderId, projectId) => {
      if (useProtoStore.getState().currentProjectMeta.projectId !== projectId) throw new Error('工程已切换，请重新选择要移动的菜单');
      const { sitemapBase, designerFolders, designerPages, sitemapOverrides } = get();
      const layout = { sitemapBase, designerFolders, designerPages, sitemapOverrides };
      const next = prepareSitemapMove(layout, target, parentFolderId);
      if (next !== layout) set(next);
    },

    createDesignerFolder: (title, parentFolderId) => {
      const folder: DesignerFolder = { id: newId('folder'), title: title.trim(), parentFolderId };
      const folders = [...get().designerFolders, folder];
      validateDesignerFolders(folders, get().sitemapOverrides, get().sitemapBase);
      set({ designerFolders: folders });
      return folder;
    },

    createDesignerPage: (page, source) => {
      if (!folderOptions(get().designerFolders, get().sitemapOverrides, get().sitemapBase).some(folder => folder.id === page.folderId)) throw new Error('页面所属菜单目录不存在');
      set((s) => ({
        pageSources: { ...s.pageSources, [page.pageId]: source },
        designerPages: [...s.designerPages.filter((p) => p.pageId !== page.pageId), page],
      }));
    },

    renameDesignerPage: (pageId, title) =>
      set((s) => ({ designerPages: s.designerPages.map((p) => (p.pageId === pageId ? { ...p, title } : p)) })),

    snapshotPreviewRows: () => {
      const { project, fixed } = previewInputs();
      const ids = project.dbTables.map(t => t.id);
      const saved = currentData();
      const added = seedRelatedTables(project.dbTables, ids, saved, generatePreviewRows, fixed);
      return Object.fromEntries(ids.map(id => [id, Object.hasOwn(saved, id) ? saved[id] : added[id]]));
    },

    prepareRelatedExamples: () => {
      const {project, fixed} = previewInputs();
      const saved = { ...get().tableRows };
      // This explicit editor command replaces only complete, untouched legacy sample sets.
      for (const table of project.dbTables) {
        if (Object.hasOwn(saved,table.id) && JSON.stringify(saved[table.id]) === JSON.stringify(generateMockRows(table))) delete saved[table.id];
      }
      const examples = seedRelatedTables(project.dbTables, project.dbTables.map(t => t.id), saved, generatePreviewRows, fixed);
      set({tableRows:{...saved,...examples}});
    },

    getRows: (tableId) => {
      const existing = get().tableRows[tableId];
      if (Object.hasOwn(get().tableRows, tableId)) return existing;
      const table = useProtoStore.getState().dbTables.find((t) => t.id === tableId);
      if (!table) return [];
      const {project, fixed} = previewInputs();
      const projectId = project.currentProjectMeta.projectId;
      const generation = get().tableRows;
      if (pendingRows?.projectId === projectId && pendingRows.generation === generation && pendingRows.schema === project.dbTables && pendingRows.rows[tableId]) return pendingRows.rows[tableId];
      // The built-in PO table has a real prototype data source with explicit field mapping.
      if (!pendingRows || pendingRows.projectId !== projectId || pendingRows.generation !== generation || pendingRows.schema !== project.dbTables) {
        const batch = { projectId, generation, schema: project.dbTables, rows: Object.create(null) as PageStore['tableRows'] };
        pendingRows = batch;
        // Commit tables requested in the same render together: one lazy seed must
        // not invalidate its siblings. Replaced/reset project data still cancels the batch.
        queueMicrotask(() => {
          if (pendingRows === batch) pendingRows = undefined;
          set(s => {
            if (useProtoStore.getState().currentProjectMeta.projectId !== batch.projectId || s.tableRows !== batch.generation || useProtoStore.getState().dbTables !== batch.schema) return s;
            for (const [tableId, rows] of Object.entries(batch.rows)) {
              initializedPreviewRows.set(rows, { projectId: batch.projectId, tableId, initialValue: JSON.stringify(rows) });
            }
            return { tableRows: { ...s.tableRows, ...batch.rows } };
          });
        });
      }
      Object.assign(pendingRows.rows, seedRelatedTables(project.dbTables, [tableId], currentData(), generatePreviewRows, fixed));
      return pendingRows.rows[tableId];
    },

    insertRow: (tableId, values) => {
      const table = useProtoStore.getState().dbTables.find(t => t.id === tableId);
      if (!table) throw new Error(`未知写入表 ${tableId}`);
      const row: Row = { ...valuesWithColumnDefaults(table, values), id: newId(tableId) };
      const rows = get().getRows(tableId);
      set((s) => ({ tableRows: { ...currentData(), [tableId]: [row, ...(s.tableRows[tableId] ?? rows)] } }));
      return row;
    },

    updateRow: (tableId, id, values) => {
      const rows = get().getRows(tableId);
      set((s) => ({
        tableRows: {
          ...currentData(),
          [tableId]: (s.tableRows[tableId] ?? rows).map((r) => (r.id === id ? { ...r, ...values } : r)),
        },
      }));
    },

    deleteRow: (tableId, id) => {
      const rows = get().getRows(tableId);
      set((s) => ({
        tableRows: { ...currentData(), [tableId]: (s.tableRows[tableId] ?? rows).filter((r) => r.id !== id) },
      }));
    },

    resetRows: () => set({ tableRows: {} }),

    importPurchaseOrderLines: (sourceTableId, targetTableId, ids, orderId) => {
      const contractError = purchaseTransferContractError(useProtoStore.getState().dbTables, sourceTableId, targetTableId);
      if (contractError) throw new Error(contractError);
      if (!get().getRows('t_wms_acceptance_order').some(r => r.id === orderId)) throw new Error('验收单表头不存在，请先保存');
      const source = get().getRows(sourceTableId), existing = get().getRows(targetTableId);
      const added = mapPurchaseOrderLines(source, existing, ids, orderId);
      if (added.length) set(() => ({ tableRows: { ...currentData(), [sourceTableId]: source, [targetTableId]: [...existing, ...added] } }));
      return added.length;
    },

    saveCompositeBlock: ({ title, category, description, node }) => {
      let count = 0;
      walk(node, () => {
        count += 1;
      });
      const childCount = Math.max(1, count - 1);
      const tsxSnippet = nodeToTsxSnippet(node);
      const newBlock: CustomCompositeBlock = {
        id: `blk_${Date.now().toString(36)}`,
        title: title.trim() || `${node.type} 业务组件`,
        category,
        description:
          description.trim() || `基于 <${node.type}> 沉淀的自定义业务复合组件（含 ${childCount} 个子控件）`,
        rootType: node.type,
        childCount,
        tsxSnippet,
        createdAt: new Date().toISOString().slice(0, 10),
        isBuiltin: false,
        platform: isMobileComponentType(node.type) ? 'mobile' : 'desktop',
      };
      set((s) => {
        const next = [newBlock, ...s.compositeBlocks];
        persistCompositeBlocks(next);
        return { compositeBlocks: next };
      });
      return newBlock;
    },

    deleteCompositeBlock: (id) =>
      set((s) => {
        const next = s.compositeBlocks.filter((b) => b.id !== id);
        persistCompositeBlocks(next);
        return { compositeBlocks: next };
      }),
  };
});
