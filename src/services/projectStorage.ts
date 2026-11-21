import { emptyMindmaps } from '../proto/mindmaps';
import { emptyProjectNotes, migrateInlineNoteImages, pruneStaleNoteLinks, pruneUnusedNoteAssets } from '../proto/notes';
import { legacyBlankSitemap } from './legacyProjectSitemap';
import { migrateLegacyZeroStickyIndexes } from '../proto/stickyNoteIndex';
import { emptySitemapOverrides } from '../proto/sitemap';
import { SITEMAP_TREE, useProtoStore, type DBTableSchema, type SitemapItem, type StickyNoteRule, type WidgetSchema, type SelectableWidgetId } from '../store/useProtoStore';
import { initialPages, usePageStore, type DesignerPage } from '../proto/store/usePageStore';
import { generateBlankPageSource } from '../proto/ai/templates';
import { createMobileStarterDataset } from '../proto/mobile/starter';
import { createCrmStarterDataset } from '../proto/starter/crmStarter';
import { decodePflowBinary, type PflowBinaryPayload, type PflowProjectMetadata, type ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import { object, validateProjectMeta, validateProjectPayload } from './projectValidation';
import { ProjectAutosave, type ProjectSaveBridge } from './projectAutosave';
import { isEnLocale, tr } from '../i18n/runtime';

const RECENT_KEY = 'protoflow_recent_projects_v2';
// Browser file inputs cannot reopen an arbitrary disk path. Keep the exact opened/saved
// snapshot for this session; after reload the user must select the file again.
const browserFiles = new Map<string, PflowBinaryPayload>();
let autosave: ProjectAutosave | null = null;
let applyingSnapshot = false;

interface PersistenceBridge extends ProjectSaveBridge {
  isElectron: boolean;
  readBinaryProject(input: { dirPath: string; fileName: string }): Promise<{ binaryBytes: Uint8Array }>;
  writeBinaryProject: ProjectSaveBridge['saveCurrentProject'];
  onSaveBeforeClose(listener: (requestId: string) => void): () => void;
  finishSaveBeforeClose(result: { requestId: string; ok: boolean; error?: string }): void;
  persistenceReady(): void;
}

/** Started once before React mounts, so StrictMode and changing screens cannot stop saving. */
export function startProjectPersistence(delay = 500) {
  const bridge = (window as unknown as { protoflowDesktop?: Partial<PersistenceBridge> }).protoflowDesktop;
  if (!bridge?.isElectron || autosave) return () => {};
  const controller = new ProjectAutosave({
    delay, capture: captureProjectPayload,
    write: async input => {
      if (bridge.saveCurrentProject) return bridge.saveCurrentProject(input);
      // A renderer hot update can run inside the still-open older desktop process.
      // Its established read/write bridge can save the same archive until restart;
      // verify the disk identity first, and never turn a missing file into a new one.
      if (!bridge.readBinaryProject || !bridge.writeBinaryProject) throw new Error(tr('桌面保存接口不可用，请导出 .pflow 备份后重启应用', 'Desktop save bridge unavailable. Please export a .pflow backup and restart the app.'));
      const disk = normalizeProjectPayload(decodePflowBinary((await bridge.readBinaryProject(input)).binaryBytes));
      if (disk.meta.projectId !== input.projectId) throw new Error(tr('该路径的工程 ID 已变化，未覆盖任何文件', 'Project ID at this path has changed; existing file was not overwritten'));
      return bridge.writeBinaryProject(input);
    },
    onSaved: payload => {
      useProtoStore.setState({ currentProjectMeta: payload.meta });
      remember(payload);
    },
  });
  autosave = controller;
  const protoKeys = ['projectAgreements', 'databaseRequirements', 'projectPlan', 'activePageId', 'dbTables', 'stickyNotes', 'suppliers', 'purchaseOrderItems', 'acceptanceOrders', 'closedLoopIssues', 'widgets', 'draftAcceptanceHeader', 'draftAcceptanceLines', 'mindmaps', 'projectNotes'] as const;
  const pageKeys = ['pageSources', 'designerPages', 'designerFolders', 'sitemapBase', 'sitemapOverrides', 'tableRows'] as const;
  const stopProto = useProtoStore.subscribe((next, prev) => {
    if (!applyingSnapshot && protoKeys.some(key => next[key] !== prev[key])) controller.changed();
  });
  const stopPages = usePageStore.subscribe((next, prev) => {
    if (!applyingSnapshot && pageKeys.some(key => next[key] !== prev[key])) controller.changed();
  });
  const stopClose = bridge.onSaveBeforeClose?.(requestId => {
    void controller.flush().then(
      () => bridge.finishSaveBeforeClose?.({ requestId, ok: true }),
      error => bridge.finishSaveBeforeClose?.({ requestId, ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
  });
  bridge.persistenceReady?.();
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!controller.dirty) return;
    event.preventDefault(); event.returnValue = '';
    void controller.flush().catch(() => {});
  };
  const saveKey = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); void controller.flush().catch(() => {});
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('keydown', saveKey);
  return () => {
    stopProto(); stopPages(); stopClose?.(); controller.dispose();
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('keydown', saveKey);
    if (autosave === controller) autosave = null;
  };
}

export async function flushProjectChanges() { await autosave?.flush(); }
export async function prepareProjectDeletion(projectId: string) { await autosave?.beforeDelete(projectId); }
export function finishProjectDeletion(projectId: string, deleted: boolean) { autosave?.afterDelete(projectId, deleted); }

const emptyDraft = (): ProjectStateSnapshot['draftAcceptanceHeader'] => ({
  acceptanceDate: '', acceptanceNo: '', inspector: '', inboundType: '购买',
  sourceType: '采购订单转入', deliveryPerson: '', supplierId: '', supplierContact: '',
  supplierPhone: '', invoiceType: '专票', taxRate: 0, remark: '',
});

function createEnglishWidgets(widgets: Record<SelectableWidgetId, WidgetSchema>): Record<SelectableWidgetId, WidgetSchema> {
  const clone = structuredClone(widgets);
  const patch: Record<string, { name: string; label: string; subLabel?: string }> = {
    'header-form-group': { name: 'Receipt Header Form', label: 'Receipt Header (bound to t_wms_acceptance_order)', subLabel: 'Includes date, document No., inbound source, and supplier FK linkage' },
    'field-supplier-select': { name: 'Field: Supplier Select', label: 'Supplier', subLabel: 'Foreign key bound to shared table t_base_supplier' },
    'btn-import-po': { name: 'Button: [Import from PO]', label: 'Import from PO', subLabel: 'Pulls pending receipt lines from t_pms_po_item' },
    'acceptance-detail-grid': { name: 'Table: Receipt Line Items', label: 'Receipt Line Items (bound to t_wms_acceptance_detail)', subLabel: 'Live formula sync across tax-inclusive price, tax rate, and 6-decimal net unit price' },
    'btn-submit-acceptance': { name: 'Actions: [Submit / Save Draft]', label: 'Submit', subLabel: 'Inserts into t_wms_acceptance_order and updates t_pms_po_item' },
    'yellow-sticky-spec': { name: 'Page Sticky Spec Summary', label: 'Aggregated Component Sticky Notes & Shared DB Contract', subLabel: 'Bidirectionally aggregates widget sticky notes and drives database column rules' },
    'supplier-table-widget': { name: 'Supplier Qualification Workbench', label: 'Pending Supplier Approvals (shared: t_base_supplier)', subLabel: 'Approved suppliers sync live to Qualified Suppliers and Receipt dropdowns' },
    'po-table-widget': { name: 'Purchase Order Review Table', label: 'Purchase Order Line Pool (shared: t_pms_po_item)', subLabel: 'Confirmed orders can be imported into New Receipt Inspection with one click' },
  };
  for (const [key, info] of Object.entries(patch)) {
    if (clone[key]) {
      clone[key].name = info.name;
      clone[key].props = { ...clone[key].props, label: info.label, ...(info.subLabel ? { subLabel: info.subLabel } : {}) };
    }
  }
  return clone;
}

function createEnglishSaasInventorySeed(initial: ReturnType<typeof useProtoStore.getInitialState>) {
  const dbTables: DBTableSchema[] = [
    {
      ...structuredClone(initial.dbTables[0]),
      cnName: 'Supplier Master Data (Shared Table)',
      domain: 'Master Data (MDM)',
      description: 'Shared physical table read and updated across Supplier Approval, Qualified Suppliers, Purchase Order Review, and New Receipt Inspection.',
      sharedByMenus: [
        { pageId: 'supplier-approval', menuTitle: 'Master Data → Supplier Approval (Page 18)', accessMode: 'STATE 状态流转', fieldMappingNote: 'Creates pending vendor records and sets status = "qualified" on approval' },
        { pageId: 'qualified-suppliers', menuTitle: 'Master Data → Qualified Suppliers (Page 19)', accessMode: 'READ 查询', fieldMappingNote: 'Displays qualified suppliers (WHERE status = "qualified") from the same table' },
        { pageId: 'acceptance-new', menuTitle: 'Receiving → New Receipt Inspection (Page 57)', accessMode: 'FK 外键引用', fieldMappingNote: 'Supplier dropdown binds id and auto-fills contact_person, contact_phone, and tax_rate_default' },
        { pageId: 'purchase-order-confirm', menuTitle: 'Procurement → Purchase Order Review (Page 34)', accessMode: 'FK 外键引用', fieldMappingNote: 'Links purchase orders to supplier master data' },
      ],
      columns: initial.dbTables[0].columns.map((c) => ({
        ...c,
        comment:
          ({
            id: 'Supplier Primary Key ID',
            supplier_code: 'Supplier Code (e.g. VND-2026-001)',
            supplier_name: 'Supplier Name',
            contact_person: 'Contact Person',
            contact_phone: 'Contact Phone',
            tax_rate_default: 'Default Tax Rate (%)',
            status: 'Qualification Status (pending/qualified/rejected)',
          } as Record<string, string>)[c.name] ?? c.comment,
      })),
    },
    {
      ...structuredClone(initial.dbTables[1]),
      cnName: 'Receipt Inspection Orders (Shared Table)',
      domain: 'Warehouse & Receiving (WMS)',
      description: 'Written by New Receipt Inspection (Page 57) and queried by Receipt Ledger (Page 58) for putaway tracking.',
      sharedByMenus: [
        { pageId: 'acceptance-new', menuTitle: 'Receiving → New Receipt Inspection (Page 57)', accessMode: 'CRUD 读写', fieldMappingNote: 'Header form maps directly to this table on Save Draft / Submit' },
        { pageId: 'acceptance-list', menuTitle: 'Receiving → Receipt Inspection Ledger (Page 58)', accessMode: 'READ 查询', fieldMappingNote: 'Paginated ledger of submitted and draft receipt orders' },
      ],
      columns: initial.dbTables[1].columns.map((c) => ({
        ...c,
        comment:
          ({
            id: 'Receipt Order ID',
            acceptance_no: 'Receipt No. (e.g. DHY20250908001)',
            acceptance_date: 'Receipt Date',
            inbound_type: 'Inbound Type (购买/调拨/盘盈)',
            source_type: 'Source Type (供方发货单转入/采购订单转入)',
            supplier_id: 'FK to Qualified Supplier ID',
            total_amount_tax_included: 'Total Amount Incl. Tax',
            status: 'Order Status (草稿/已提交验收/已入库)',
          } as Record<string, string>)[c.name] ?? c.comment,
      })),
    },
    {
      ...structuredClone(initial.dbTables[2]),
      cnName: 'Receipt Inspection Line Items (6-Decimal Tax)',
      domain: 'Warehouse & Receiving (WMS)',
      description: 'Stores editable receipt line items with 6-decimal net unit price derived from sticky notes #3 and #4.',
      sharedByMenus: [
        { pageId: 'acceptance-new', menuTitle: 'Receiving → New Receipt Inspection (Page 57 - Lines)', accessMode: 'CRUD 读写', fieldMappingNote: 'Backs the editable Receipt Line Items grid' },
        { pageId: 'purchase-order-confirm', menuTitle: 'Procurement → Purchase Order Review (Page 34)', accessMode: 'FK 外键引用', fieldMappingNote: 'Links via source_po_item_id and writes back delivered_qty' },
      ],
      columns: initial.dbTables[2].columns.map((c) => ({
        ...c,
        comment:
          ({
            id: 'Receipt Line ID',
            acceptance_order_id: 'Parent Receipt Order ID',
            source_po_item_id: 'Source Purchase Order Line ID',
            material_code: 'Item Code (e.g. SKU-0021)',
            current_accept_qty: 'Current Receipt Qty (<= ordered - delivered)',
            unit_price_tax_included: 'Unit Price Incl. Tax (¥)',
            unit_price_no_tax: 'Net Unit Price (¥) — 6 decimal places',
            tax_amount: 'Tax Amount (¥)',
            project_code: 'Project Code',
          } as Record<string, string>)[c.name] ?? c.comment,
      })),
    },
    {
      ...structuredClone(initial.dbTables[3]),
      cnName: 'Purchase Order Line Items (Source Table)',
      domain: 'Procurement (SRM)',
      description: 'Maintained in Purchase Order Review (Page 34) and imported into New Receipt Inspection (Page 57), updating delivered_qty upon receipt.',
      sharedByMenus: [
        { pageId: 'purchase-order-confirm', menuTitle: 'Procurement → Purchase Order Review (Page 34)', accessMode: 'CRUD 读写', fieldMappingNote: 'Confirms purchase order lines (status = "confirmed")' },
        { pageId: 'acceptance-new', menuTitle: 'Receiving → New Receipt Inspection (Page 57)', accessMode: 'CRUD 读写', fieldMappingNote: 'Imports open PO lines and increments delivered_qty upon submission' },
      ],
      columns: initial.dbTables[3].columns.map((c) => ({
        ...c,
        comment:
          ({
            id: 'PO Line ID',
            po_number: 'PO Number (e.g. CGDD-202610-081)',
            supplier_id: 'Supplier ID',
            ordered_qty: 'Ordered Qty',
            delivered_qty: 'Cumulative Delivered Qty',
          } as Record<string, string>)[c.name] ?? c.comment,
      })),
    },
  ];

  const sitemapBase: SitemapItem[] = [
    { id: 'node-doc-overview', title: 'System Architecture Overview', type: 'doc', pageId: 'doc-overview' },
    { id: 'node-doc-changelog', title: 'Design Changelog', type: 'doc', pageId: 'doc-changelog' },
    {
      id: 'folder-deprecated',
      title: 'Deprecated Designs (Archived)',
      type: 'folder',
      deprecated: true,
      children: [
        { id: 'dep-1', title: 'Quote Comparison - Deprecated', type: 'page', deprecated: true },
        { id: 'dep-2', title: 'Legacy PO Review - Archived', type: 'page', deprecated: true },
        { id: 'dep-3', title: 'Legacy Putaway - Deprecated', type: 'page', deprecated: true },
      ],
    },
    {
      id: 'folder-base-data',
      title: 'Master Data Management',
      type: 'folder',
      dataFlowTag: 'Upstream MDM',
      children: [
        { id: 'node-material-catalog', title: 'Item Catalog', type: 'page', pageId: 'material-catalog', sharedTables: ['t_base_material'] },
        { id: 'node-supplier-approval', title: 'Supplier Approval', type: 'page', pageId: 'supplier-approval', dataFlowTag: 'Shared: t_base_supplier', sharedTables: ['t_base_supplier'] },
        { id: 'node-qualified-suppliers', title: 'Qualified Suppliers', type: 'page', pageId: 'qualified-suppliers', dataFlowTag: 'Shared: t_base_supplier', sharedTables: ['t_base_supplier'] },
      ],
    },
    {
      id: 'folder-plan',
      title: 'Annual Planning & Budget',
      type: 'folder',
      children: [
        { id: 'node-annual-plan', title: 'Quarterly Replenishment Plan', type: 'page', pageId: 'annual-plan' },
      ],
    },
    {
      id: 'folder-procurement',
      title: 'Procurement & Tendering',
      type: 'folder',
      dataFlowTag: 'Midstream Flow',
      children: [
        { id: 'node-po-confirm', title: 'Purchase Order Review', type: 'page', pageId: 'purchase-order-confirm', dataFlowTag: 'Shared: t_pms_po_item', sharedTables: ['t_pms_po_item', 't_base_supplier'] },
      ],
    },
    {
      id: 'folder-acceptance',
      title: 'Receiving & Putaway',
      type: 'folder',
      dataFlowTag: 'Core Hub',
      children: [
        { id: 'node-acceptance-new', title: 'New Receipt Inspection (57 of 130)', type: 'page', pageId: 'acceptance-new', dataFlowTag: 'Links 4 Core Tables', sharedTables: ['t_wms_acceptance_order', 't_wms_acceptance_detail', 't_base_supplier', 't_pms_po_item'] },
        { id: 'node-acceptance-list', title: 'Receipt Inspection Ledger', type: 'page', pageId: 'acceptance-list', dataFlowTag: 'Shared: t_wms_acceptance_order', sharedTables: ['t_wms_acceptance_order'] },
      ],
    },
  ];

  const stickyNotes: StickyNoteRule[] = [
    {
      id: 'sticky-1',
      pageId: 'acceptance-new',
      targetWidgetId: 'field-supplier-select',
      targetWidgetName: 'Field: Supplier Select',
      index: 1,
      text: 'Supplier options sync live from [Master Data -> Qualified Suppliers]; once approved in [Supplier Approval], selecting a supplier auto-populates contact person and phone.',
      compiledRule: 'SELECT * FROM t_base_supplier WHERE status = "qualified" -> bind(header.supplierId)',
      active: true,
    },
    {
      id: 'sticky-2',
      pageId: 'acceptance-new',
      targetWidgetId: 'btn-import-po',
      targetWidgetName: 'Button: [Import from PO]',
      index: 2,
      text: 'Clicking [Import from PO] opens a modal pulling confirmed purchase order lines from [Procurement -> Purchase Order Review] and imports item code, ordered qty, and delivered qty.',
      compiledRule: 'onClick -> openModal(SELECT * FROM t_pms_po_item WHERE status = "confirmed")',
      active: true,
    },
    {
      id: 'sticky-3',
      pageId: 'acceptance-new',
      targetWidgetId: 'acceptance-detail-grid',
      targetWidgetName: 'Table: Receipt Line Items (Tax Formula)',
      index: 3,
      text: 'Live tax formula: net_unit_price = unit_price_tax_included / (1 + tax_rate) (6 decimal places, e.g. 51.651376); gross_amount = unit_price_tax_included * current_accept_qty; tax_amount = gross_amount - net_amount.',
      compiledRule: 'unit_price_no_tax DECIMAL(18,6) = (taxPrice / (1 + rate)).toFixed(6)',
      active: true,
    },
    {
      id: 'sticky-4',
      pageId: 'acceptance-new',
      targetWidgetId: 'acceptance-detail-grid',
      targetWidgetName: 'Table: Current Receipt Qty (Over-Receipt Guard)',
      index: 4,
      text: 'Anti-overreceipt validation: current_accept_qty must not exceed (ordered_qty - already_accepted_qty); excess quantities are capped at the remaining open balance.',
      compiledRule: 'CHECK (current_accept_qty <= ordered_qty - already_accepted_qty)',
      active: true,
    },
    {
      id: 'sticky-5',
      pageId: 'acceptance-new',
      targetWidgetId: 'btn-submit-acceptance',
      targetWidgetName: 'Button: [Submit / Save]',
      index: 5,
      text: 'Submitting transitions status to Submitted, inserts into Receipt Inspection Ledger, and increments upstream PO delivered_qty; saving as draft does not deduct PO balance.',
      compiledRule: 'INSERT INTO t_wms_acceptance_order && UPDATE t_pms_po_item SET delivered_qty += qty',
      active: true,
    },
  ];

  const suppliers = [
    { id: 'SUP-01', code: 'VND-2026-001', name: 'Aurora Smart Digital Ltd.', contactPerson: 'Alex Morgan', phone: '13805328891', category: 'Smart Wearables & Audio', taxRateDefault: 9, status: 'qualified' as const, updatedAt: '09:15:00' },
    { id: 'SUP-02', code: 'VND-2026-002', name: 'StarSea Optoelectronics Inc.', contactPerson: 'Liam Lin', phone: '13922819904', category: '4K Display & Peripherals', taxRateDefault: 13, status: 'qualified' as const, updatedAt: '09:20:00' },
    { id: 'SUP-03', code: 'VND-2026-003', name: 'CloudAtlas Precision Parts Co.', contactPerson: 'Elena Wang', phone: '18602193342', category: 'GaN Fast Chargers & Hubs', taxRateDefault: 13, status: 'pending' as const, updatedAt: '10:01:00' },
    { id: 'SUP-04', code: 'VND-2026-004', name: 'GreenForest Eco Packaging Co.', contactPerson: 'Marcus Zhao', phone: '13501087765', category: 'Custom Retail Packaging', taxRateDefault: 9, status: 'pending' as const, updatedAt: '10:05:00' },
  ];

  const purchaseOrderItems = [
    { id: 'PO-ITEM-1', poNumber: 'CGDD-202610-081', supplierId: 'SUP-01', supplierName: 'Aurora Smart Digital Ltd.', planCategory: 'Standard Replenishment', materialCode: 'SKU-0021', materialName: 'Wireless ANC Headphones Pro', spec: 'Starlight Silver / Flagship', brand: 'Aurora Audio', unit: 'pcs', orderedQty: 3, deliveredQty: 2, unitPriceTaxIncluded: 56.3, taxRate: 9, projectCode: 'ORD-2026-Q4A', status: 'confirmed' as const },
    { id: 'PO-ITEM-2', poNumber: 'CGDD-202610-081', supplierId: 'SUP-01', supplierName: 'Aurora Smart Digital Ltd.', planCategory: 'Standard Replenishment', materialCode: 'SKU-0032', materialName: 'GaN 140W Desktop Charger', spec: '4-Port USB-C / Obsidian', brand: 'CloudAtlas', unit: 'pcs', orderedQty: 5, deliveredQty: 0, unitPriceTaxIncluded: 80.0, taxRate: 13, projectCode: 'ORD-2026-Q4A', status: 'confirmed' as const },
    { id: 'PO-ITEM-3', poNumber: 'CGDD-202610-095', supplierId: 'SUP-01', supplierName: 'Aurora Smart Digital Ltd.', planCategory: 'Peak Campaign Stock', materialCode: 'SKU-1044', materialName: '4K Smart Conference Camera', spec: 'Dual-Mic Beamforming', brand: 'StarSea', unit: 'pcs', orderedQty: 12, deliveredQty: 4, unitPriceTaxIncluded: 320.0, taxRate: 13, projectCode: 'ORD-2026-Q4B', status: 'confirmed' as const },
    { id: 'PO-ITEM-4', poNumber: 'CGDD-202610-102', supplierId: 'SUP-02', supplierName: 'StarSea Optoelectronics Inc.', planCategory: 'Peak Campaign Stock', materialCode: 'SKU-9001', materialName: 'Ergonomic Tri-Mode Mechanical Keyboard', spec: 'Gasket Mount / Silent Linear', brand: 'StarSea Gear', unit: 'pcs', orderedQty: 2, deliveredQty: 0, unitPriceTaxIncluded: 480.0, taxRate: 13, projectCode: 'ORD-2026-Q4C', status: 'unconfirmed' as const },
  ];

  const draftAcceptanceLines = [
    { id: 'LINE-1', sourcePoItemId: 'PO-ITEM-1', planCategory: 'Standard Replenishment', materialCode: 'SKU-0021', materialName: 'Wireless ANC Headphones Pro', spec: 'Starlight Silver / Flagship', brand: 'Aurora Audio', unit: 'pcs', orderedQty: 3, alreadyAcceptedQty: 2, currentAcceptQty: 1, useCustomTaxPrice: false, unitPriceTaxIncluded: 56.3, taxRate: 9, projectCode: 'ORD-2026-Q4A', serialNo: '001', isNewItem: true },
    { id: 'LINE-2', sourcePoItemId: 'PO-ITEM-2', planCategory: 'Standard Replenishment', materialCode: 'SKU-0032', materialName: 'GaN 140W Desktop Charger', spec: '4-Port USB-C / Obsidian', brand: 'CloudAtlas', unit: 'pcs', orderedQty: 5, alreadyAcceptedQty: 0, currentAcceptQty: 2, useCustomTaxPrice: false, unitPriceTaxIncluded: 80.0, taxRate: 13, projectCode: 'ORD-2026-Q4A', serialNo: '002', isNewItem: true },
  ];

  const acceptanceOrders = [
    {
      id: 'ACC-2026-001',
      acceptanceNo: 'DHY20250908000',
      acceptanceDate: '2026-10-25',
      inboundType: '购买' as const,
      sourceType: '采购订单转入' as const,
      supplierName: 'StarSea Optoelectronics Inc.',
      supplierContact: 'Liam Lin',
      supplierPhone: '13922819904',
      taxRate: 13,
      totalAmount: 12600.0,
      inspector: 'Owen Li',
      deliveryPerson: 'Express Freight',
      remark: 'Outer cartons intact; barcode scan verified',
      status: '已入库' as const,
      itemCount: 4,
      createdAt: '2026-10-25 14:20',
    },
  ];

  const basePages = initialPages(dbTables, 'en-US', {
    tables: dbTables,
    tableRows: {},
    suppliers,
    purchaseOrderItems,
    acceptanceOrders,
    templateId: 'saas_inventory',
  });
  const sources: Record<string, string> = { ...basePages.sources };

  const draftAcceptanceHeader: ProjectStateSnapshot['draftAcceptanceHeader'] = {
    acceptanceDate: '2026-10-28',
    acceptanceNo: 'DHY20250908001',
    inspector: 'Claire Zhang',
    inboundType: '购买',
    sourceType: '供方发货单转入',
    deliveryPerson: 'Marcus Wang',
    supplierId: 'SUP-01',
    supplierContact: 'Alex Morgan',
    supplierPhone: '13805328891',
    invoiceType: '专票',
    taxRate: 9,
    remark: 'Q4 standard replenishment batch',
  };

  return {
    dbTables,
    sitemapBase,
    pages: { sources, pages: basePages.pages },
    stickyNotes,
    suppliers,
    purchaseOrderItems,
    acceptanceOrders,
    draftAcceptanceHeader,
    draftAcceptanceLines,
    widgets: createEnglishWidgets(initial.widgets),
  };
}

export function createProjectPayload(meta: PflowProjectMetadata): PflowBinaryPayload {
  const initial = useProtoStore.getInitialState();
  const en = isEnLocale();
  if (meta.templateId === 'mobile_starter') {
    const mobileStarter = createMobileStarterDataset();
    const isHybrid = meta.projectMode === 'hybrid';
    const enDesktop = en && isHybrid ? createEnglishSaasInventorySeed(initial) : null;
    const desktopPages = isHybrid
      ? enDesktop
        ? enDesktop.pages
        : initialPages(initial.dbTables, 'zh-CN', {
            tables: initial.dbTables,
            tableRows: {},
            suppliers: initial.suppliers,
            purchaseOrderItems: initial.purchaseOrderItems,
            acceptanceOrders: initial.acceptanceOrders,
            templateId: meta.templateId,
            projectId: meta.projectId,
          })
      : { sources: {}, pages: [] };
    const dbTables = isHybrid ? [...(enDesktop ? enDesktop.dbTables : initial.dbTables), ...mobileStarter.dbTables] : mobileStarter.dbTables;
    const pageSources = { ...desktopPages.sources, ...mobileStarter.pageSources };
    const designerPages = [...desktopPages.pages, ...mobileStarter.designerPages];
    const payload: PflowBinaryPayload = {
      schemaVersion: 7,
      meta: {
        ...meta,
        projectMode: meta.projectMode ?? 'mobile',
        pageCount: Object.keys(pageSources).length,
        tableCount: dbTables.length,
        stickyCount: isHybrid ? (enDesktop ? enDesktop.stickyNotes.length : initial.stickyNotes.length) : 0,
      },
      stateSnapshot: {
        projectPlan: null,
        projectAgreements: [],
        mindmaps: emptyMindmaps(),
        activePageId: mobileStarter.entryPageId,
        dbTables,
        stickyNotes: isHybrid ? (enDesktop ? enDesktop.stickyNotes : initial.stickyNotes) : [],
        suppliers: isHybrid ? (enDesktop ? enDesktop.suppliers : initial.suppliers) : [],
        purchaseOrderItems: isHybrid ? (enDesktop ? enDesktop.purchaseOrderItems : initial.purchaseOrderItems) : [],
        acceptanceOrders: isHybrid ? (enDesktop ? enDesktop.acceptanceOrders : initial.acceptanceOrders) : [],
        closedLoopIssues: [],
        widgets: en ? createEnglishWidgets(initial.widgets) : initial.widgets,
        draftAcceptanceHeader: isHybrid ? (enDesktop ? enDesktop.draftAcceptanceHeader : initial.draftAcceptanceHeader) : emptyDraft(),
        draftAcceptanceLines: isHybrid ? (enDesktop ? enDesktop.draftAcceptanceLines : initial.draftAcceptanceLines) : [],
        pageSources,
        designerPages,
        designerFolders: mobileStarter.designerFolders,
        sitemapBase: isHybrid ? (enDesktop ? enDesktop.sitemapBase : SITEMAP_TREE) : [],
        sitemapOverrides: emptySitemapOverrides(),
        tableRows: mobileStarter.tableRows,
      },
    };
    validateProjectPayload(payload);
    return structuredClone(payload);
  }
  if (meta.templateId === 'crm_analytics') {
    const crm = createCrmStarterDataset();
    const payload: PflowBinaryPayload = {
      schemaVersion: 7,
      meta: {
        ...meta,
        projectMode: meta.projectMode ?? 'hybrid',
        pageCount: Object.keys(crm.pageSources).length,
        tableCount: crm.dbTables.length,
        stickyCount: crm.stickyNotes.length,
      },
      stateSnapshot: {
        projectPlan: null,
        projectAgreements: [],
        mindmaps: crm.mindmaps,
        projectNotes: crm.projectNotes,
        activePageId: crm.entryPageId,
        dbTables: crm.dbTables,
        stickyNotes: crm.stickyNotes,
        suppliers: [],
        purchaseOrderItems: [],
        acceptanceOrders: [],
        closedLoopIssues: [],
        widgets: en ? createEnglishWidgets(initial.widgets) : initial.widgets,
        draftAcceptanceHeader: emptyDraft(),
        draftAcceptanceLines: [],
        pageSources: crm.pageSources,
        designerPages: crm.designerPages,
        designerFolders: crm.designerFolders,
        sitemapBase: [],
        sitemapOverrides: emptySitemapOverrides(),
        tableRows: crm.tableRows,
      },
    };
    validateProjectPayload(payload);
    return structuredClone(payload);
  }
  const blank = meta.templateId === 'blank_project';
  if (en) {
    const enSeed = blank ? null : createEnglishSaasInventorySeed(initial);
    const dbTables = enSeed ? enSeed.dbTables : [];
    const pages = enSeed ? enSeed.pages : { sources: {}, pages: [] };
    const payload: PflowBinaryPayload = {
      schemaVersion: 7,
      meta: { ...meta, pageCount: Object.keys(pages.sources).length, tableCount: dbTables.length, stickyCount: enSeed ? enSeed.stickyNotes.length : 0 },
      stateSnapshot: {
        projectPlan: null,
        projectAgreements: [],
        mindmaps: emptyMindmaps(),
        activePageId: blank ? '' : initial.activePageId,
        dbTables,
        stickyNotes: enSeed ? enSeed.stickyNotes : [],
        suppliers: enSeed ? enSeed.suppliers : [],
        purchaseOrderItems: enSeed ? enSeed.purchaseOrderItems : [],
        acceptanceOrders: enSeed ? enSeed.acceptanceOrders : [],
        closedLoopIssues: [],
        widgets: createEnglishWidgets(initial.widgets),
        draftAcceptanceHeader: enSeed ? enSeed.draftAcceptanceHeader : emptyDraft(),
        draftAcceptanceLines: enSeed ? enSeed.draftAcceptanceLines : [],
        pageSources: pages.sources,
        designerPages: pages.pages,
        designerFolders: [],
        sitemapBase: enSeed ? enSeed.sitemapBase : [],
        sitemapOverrides: emptySitemapOverrides(),
        tableRows: {},
      },
    };
    validateProjectPayload(payload);
    return structuredClone(payload);
  }
  const dbTables = blank ? [] : initial.dbTables;
  const pages = blank
    ? { sources: {}, pages: [] }
    : initialPages(dbTables, 'zh-CN', {
        tables: dbTables,
        tableRows: {},
        suppliers: initial.suppliers,
        purchaseOrderItems: initial.purchaseOrderItems,
        acceptanceOrders: initial.acceptanceOrders,
        templateId: meta.templateId,
        projectId: meta.projectId,
      });
  const payload: PflowBinaryPayload = {
    schemaVersion: 7,
    meta: { ...meta, pageCount: Object.keys(pages.sources).length, tableCount: dbTables.length, stickyCount: blank ? 0 : initial.stickyNotes.length },
    stateSnapshot: {
      projectPlan: null,
      projectAgreements: [],
      mindmaps: emptyMindmaps(),
      activePageId: blank ? '' : initial.activePageId, dbTables,
      stickyNotes: blank ? [] : initial.stickyNotes,
      suppliers: blank ? [] : initial.suppliers,
      purchaseOrderItems: blank ? [] : initial.purchaseOrderItems,
      acceptanceOrders: blank ? [] : initial.acceptanceOrders,
      closedLoopIssues: [],
      widgets: initial.widgets,
      draftAcceptanceHeader: blank ? emptyDraft() : initial.draftAcceptanceHeader,
      draftAcceptanceLines: blank ? [] : initial.draftAcceptanceLines,
      pageSources: pages.sources, designerPages: pages.pages, designerFolders: [], sitemapBase: blank ? [] : SITEMAP_TREE, sitemapOverrides: emptySitemapOverrides(), tableRows: {},
    },
  };
  validateProjectPayload(payload);
  return structuredClone(payload);
}

export function captureProjectPayload(): PflowBinaryPayload {
  const s = useProtoStore.getState(), p = usePageStore.getState();
  if (s.isProjectClosed) throw new Error(tr('当前项目已关闭，请新建或打开项目', 'Current project is closed. Please create or open a project.'));
  return structuredClone({
    schemaVersion: 7,
    meta: { ...s.currentProjectMeta, updatedAt: new Date().toISOString(), pageCount: Object.keys(p.pageSources).length, tableCount: s.dbTables.length, stickyCount: s.stickyNotes.length },
    stateSnapshot: {
      ...(s.databaseRequirements.length ? {databaseRequirements:s.databaseRequirements} : {}),
      projectPlan: s.projectPlan,
      projectAgreements: s.projectAgreements,
      mindmaps: s.mindmaps,
      ...(s.projectNotes.nodes.length || s.projectNotes.links.length ? { projectNotes: pruneUnusedNoteAssets(pruneStaleNoteLinks(s.projectNotes, p)) } : {}),
      activePageId: s.activePageId, dbTables: s.dbTables, stickyNotes: s.stickyNotes,
      suppliers: s.suppliers, purchaseOrderItems: s.purchaseOrderItems, acceptanceOrders: s.acceptanceOrders,
      closedLoopIssues: s.closedLoopIssues, widgets: s.widgets,
      draftAcceptanceHeader: s.draftAcceptanceHeader, draftAcceptanceLines: s.draftAcceptanceLines,
      pageSources: p.pageSources, designerPages: p.designerPages, designerFolders: p.designerFolders, sitemapBase: p.sitemapBase, sitemapOverrides: p.sitemapOverrides, tableRows: p.tableRows,
    },
  });
}

export function normalizeProjectPayload(input: unknown): PflowBinaryPayload {
  object(input, tr('工程', 'project'));
  const predatesMindmaps = input.schemaVersion === undefined || [1, 2, 3, 4, 5].includes(input.schemaVersion as number);
  if (predatesMindmaps) {
    validateProjectMeta(input.meta);
    object(input.stateSnapshot, 'stateSnapshot');
    if (Object.prototype.hasOwnProperty.call(input.stateSnapshot, 'mindmapSource')) throw new Error(tr('旧版工程包含未知的脑图字段，请检查工程版本', 'Legacy project contains an unexpected mindmapSource field'));
  }
  if (input.schemaVersion === undefined || [1, 2, 3, 4, 5, 6].includes(input.schemaVersion as number)) {
    object(input.stateSnapshot, 'stateSnapshot');
    if ('mindmaps' in input.stateSnapshot) throw new Error(tr('旧版工程包含未知的脑图目录字段', 'Legacy project contains an unexpected mindmaps field'));
  }
  let payload: unknown = input;
  const legacy = input.schemaVersion === undefined || [1, 2, 3, 4].includes(input.schemaVersion as number);
  if (legacy) {
    validateProjectMeta(input.meta);
    object(input.stateSnapshot, 'stateSnapshot');
    if (Object.prototype.hasOwnProperty.call(input.stateSnapshot, 'sitemapBase')) throw new Error(tr('旧版工程包含未知的菜单模板字段，请检查工程版本', 'Legacy project contains an unexpected sitemapBase field'));
  }
  if (input.schemaVersion === undefined || input.schemaVersion === 1) {
    // V1 did not serialize canvas sources, directory, preview rows, widgets or drafts.
    // Rebuild only these absent fields from this archive's tables, never the active project.
    validateProjectMeta(input.meta);
    object(input.stateSnapshot, 'stateSnapshot');
    const old = input.stateSnapshot;
    const baseline = createProjectPayload({ ...input.meta, templateId: 'blank_project' });
    const candidate = {
      schemaVersion: 7, meta: input.meta,
      stateSnapshot: { ...old, mindmaps: emptyMindmaps(), widgets: baseline.stateSnapshot.widgets, draftAcceptanceHeader: emptyDraft(), draftAcceptanceLines: [], pageSources: {} as Record<string, string>, designerPages: [] as DesignerPage[], designerFolders: [], sitemapBase: SITEMAP_TREE, sitemapOverrides: emptySitemapOverrides(), tableRows: {} },
    };
    validateProjectPayload(candidate, { allowLegacyZeroStickyIndex: true });
    const pages = initialPages(candidate.stateSnapshot.dbTables, 'zh-CN', {
      tables: candidate.stateSnapshot.dbTables,
      tableRows: {},
      suppliers: candidate.stateSnapshot.suppliers ?? [],
      purchaseOrderItems: candidate.stateSnapshot.purchaseOrderItems ?? [],
      acceptanceOrders: candidate.stateSnapshot.acceptanceOrders ?? [],
      templateId: candidate.meta.templateId,
      projectId: candidate.meta.projectId,
    });
    if (!pages.sources[candidate.stateSnapshot.activePageId] && !candidate.stateSnapshot.activePageId.startsWith('doc-')) {
      const unsavedTitle = tr('旧版工程未保存的画布', 'Unsaved Legacy Canvas');
      pages.sources[candidate.stateSnapshot.activePageId] = generateBlankPageSource({ pageId: candidate.stateSnapshot.activePageId, title: unsavedTitle });
      pages.pages.push({ pageId: candidate.stateSnapshot.activePageId, title: unsavedTitle, folderId: 'folder-base-data' });
    }
    candidate.stateSnapshot.pageSources = pages.sources;
    candidate.stateSnapshot.designerPages = pages.pages;
    payload = candidate;
  } else if (input.schemaVersion === 2) {
    // V2 only supported the built-in directories and had no custom folder field.
    // Upgrade the archive itself; never inherit directories from the active project.
    object(input.stateSnapshot, 'stateSnapshot');
    if (['designerFolders', 'sitemapOverrides'].some(key => Object.prototype.hasOwnProperty.call(input.stateSnapshot, key))) throw new Error(tr('V2 工程包含未知的菜单目录字段，请检查工程版本', 'V2 project contains unexpected folder fields'));
    payload = { ...input, schemaVersion: 7, stateSnapshot: { ...input.stateSnapshot, mindmaps: emptyMindmaps(), designerFolders: [], sitemapBase: SITEMAP_TREE, sitemapOverrides: emptySitemapOverrides() } };
  } else if (input.schemaVersion === 3) {
    // V3 saved custom directories, but built-in menu positions were fixed.
    object(input.stateSnapshot, 'stateSnapshot');
    if (Object.prototype.hasOwnProperty.call(input.stateSnapshot, 'sitemapOverrides')) throw new Error(tr('V3 工程包含未知的菜单位置字段，请检查工程版本', 'V3 project contains unexpected sitemapOverrides field'));
    payload = { ...input, schemaVersion: 7, stateSnapshot: { ...input.stateSnapshot, mindmaps: emptyMindmaps(), sitemapBase: SITEMAP_TREE, sitemapOverrides: emptySitemapOverrides() } };
  } else if (input.schemaVersion === 4) {
    payload = { ...input, schemaVersion: 7, stateSnapshot: { ...input.stateSnapshot as object, mindmaps: emptyMindmaps(), sitemapBase: SITEMAP_TREE } };
  } else if (input.schemaVersion === 5) {
    // V1–V5 never stored mindmaps. Upgrade only this archive; never use the active project's source.
    payload = { ...input, schemaVersion: 7, stateSnapshot: { ...input.stateSnapshot as object, mindmaps: emptyMindmaps() } };
  }
  if (input.schemaVersion === 6) {
    object(input.stateSnapshot, 'stateSnapshot');
    const { mindmapSource, ...state } = input.stateSnapshot;
    if (typeof mindmapSource !== 'string') throw new Error(tr('V6 mindmapSource 必须是字符串', 'V6 mindmapSource must be a string'));
    // V6 had exactly one map. Preserve even whitespace/unfinished drafts verbatim.
    payload = { ...input, schemaVersion: 7, stateSnapshot: { ...state, mindmaps: {
      nodes: mindmapSource === '' ? [] : [{ id: 'mindmap-legacy', title: tr('项目脑图', 'Project Mindmap'), kind: 'mindmap', parentId: null, source: mindmapSource }], links: [],
    } } };
  }
  validateProjectPayload(payload, { allowLegacyZeroStickyIndex: true });
  const normalized = structuredClone(payload);
  migrateLegacyZeroStickyIndexes(normalized.stateSnapshot.stickyNotes);
  if (legacy && normalized.meta.templateId === 'blank_project') {
    normalized.stateSnapshot.sitemapBase = legacyBlankSitemap(normalized.stateSnapshot);
    validateProjectPayload(normalized);
  }
  return normalized;
}

function remember(payload: PflowBinaryPayload) {
  browserFiles.set(payload.meta.projectId, structuredClone(payload));
  const recentProjects = [payload.meta, ...useProtoStore.getState().recentProjects.filter(p => p.projectId !== payload.meta.projectId)].slice(0, 30);
  useProtoStore.setState({ recentProjects });
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(recentProjects)); } catch { /* Recent metadata is optional; project bytes are saved separately. */ }
}

export function restoreRecentProjects() {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return;
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items)) return;
    const valid = items.filter(item => { try { validateProjectMeta(item); return true; } catch { return false; } }) as PflowProjectMetadata[];
    useProtoStore.setState({ recentProjects: valid });
  } catch { /* A broken recent list must not prevent opening an actual file. */ }
}

export function loadProjectFromBinaryPayload(input: unknown, overrideDir?: string, overrideFile?: string) {
  const payload = normalizeProjectPayload(input);
  if (overrideDir !== undefined) payload.meta.storageDir = overrideDir;
  if (overrideFile !== undefined) payload.meta.fileName = overrideFile;
  validateProjectPayload(payload);
  autosave?.assertCanReplace();
  const current = useProtoStore.getState();
  if (!autosave && !current.isProjectClosed && current.currentProjectMeta.projectId !== payload.meta.projectId &&
      current.recentProjects.some(meta => meta.projectId === current.currentProjectMeta.projectId) &&
      browserFiles.has(current.currentProjectMeta.projectId)) {
    // A browser import also switches projects. Keep edits to the previously
    // opened file available through Recent Projects for the current session.
    browserFiles.set(current.currentProjectMeta.projectId, captureProjectPayload());
  }
  applySnapshot(payload);
  autosave?.opened(payload);
  remember(payload);
}

/** Menu deletion/undo edits the current file; it must not reset the saved revision. */
export function applyProjectEditPayload(input: unknown) {
  const payload = normalizeProjectPayload(input);
  const current = useProtoStore.getState().currentProjectMeta;
  if (payload.meta.projectId !== current.projectId || payload.meta.storageDir !== current.storageDir || payload.meta.fileName !== current.fileName) throw new Error(tr('当前工程已变化，无法应用修改', 'Current project changed; cannot apply edit'));
  applySnapshot(payload);
  autosave?.changed();
}

function applySnapshot(payload: PflowBinaryPayload) {
  const { pageSources, designerPages, designerFolders, sitemapBase, sitemapOverrides, tableRows, ...state } = payload.stateSnapshot;
  // Validation is complete before replacing either store. Clear transient state too.
  applyingSnapshot = true;
  try {
    usePageStore.setState({ pageSources, designerPages, designerFolders, sitemapBase, sitemapOverrides, tableRows, history: {} });
    useProtoStore.setState({
      ...state,
      navigationSource: null,
      projectAgreements: state.projectAgreements ?? [],
      databaseRequirements: state.databaseRequirements ?? [],
      projectPlan: state.projectPlan === undefined ? null : state.projectPlan,
      selectedMindmapNodeId: state.mindmaps.nodes.length ? state.mindmaps.nodes[0].id : null,
      projectNotes: state.projectNotes ? migrateInlineNoteImages(state.projectNotes) : emptyProjectNotes(),
      selectedNoteNodeId: state.projectNotes?.nodes.length ? (state.projectNotes.nodes.find(n => n.kind === 'note')?.id ?? state.projectNotes.nodes[0].id) : null,
      dockedNoteId: null,
      currentProjectMeta: payload.meta, isProjectClosed: false, isWelcomeScreenOpen: false, viewMode: 'single_page',
      ...(state.activePageId === '' ? { leftActivityView: 'pages', leftSidebarTab: 'pages', leftSidebarCollapsed: false } : {}),
      selectedTableId: state.dbTables.length ? state.dbTables[0].id : '',
      selectedWidgetId: '', activePopoverWidgetId: null, isImportModalOpen: false,
      isBundleModalOpen: false, isMcpModalOpen: false, isWebPublishModalOpen: false, isWebPlayerMode: false,
      uiState: 'normal', searchQuery: '', expandedFolders: {}, menuPulseBadges: {}, flowLogs: [],
    });
  } finally { applyingSnapshot = false; }
}

export async function readRecentProject(projectId: string): Promise<PflowBinaryPayload> {
  const meta = useProtoStore.getState().recentProjects.find(p => p.projectId === projectId);
  if (!meta) throw new Error(tr('最近项目记录不存在，请重新选择工程文件', 'Recent project entry not found. Please open the project file directly.'));
  const desktop = (window as unknown as { protoflowDesktop?: { readBinaryProject?: (p: { dirPath: string; fileName: string }) => Promise<{ binaryBytes: Uint8Array }> } }).protoflowDesktop;
  let payload: PflowBinaryPayload;
  if (desktop?.readBinaryProject) {
    const result = await desktop.readBinaryProject({ dirPath: meta.storageDir, fileName: meta.fileName });
    payload = normalizeProjectPayload(decodePflowBinary(result.binaryBytes));
  } else {
    const cached = browserFiles.get(projectId);
    if (!cached) throw new Error(tr('浏览器需要重新授权文件访问，请使用“打开本地项目”选择该工程', 'Browser file permission expired. Please use "Open Local Project" to select the file again.'));
    payload = structuredClone(cached);
  }
  if (payload.meta.projectId !== projectId) throw new Error(tr('该路径的工程 ID 已变化，请重新打开文件', 'Project ID at this path has changed. Please reopen the file.'));
  payload.meta.storageDir = meta.storageDir;
  payload.meta.fileName = meta.fileName;
  return payload;
}

export async function openRecentProject(projectId: string) {
  await flushProjectChanges();
  loadProjectFromBinaryPayload(await readRecentProject(projectId));
}

/** Remove only the specified record after the native archive deletion succeeds. */
export function forgetDeletedProject(projectId: string) {
  const state = useProtoStore.getState();
  const recentProjects = state.recentProjects.filter(project => project.projectId !== projectId);
  browserFiles.delete(projectId);
  useProtoStore.setState({ recentProjects, ...(state.currentProjectMeta.projectId === projectId ? {
    isProjectClosed: true, isWelcomeScreenOpen: true,
  } : {}) });
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(recentProjects)); return ''; }
  catch { return tr('工程文件已移到废纸篓，但项目列表保存失败；重新启动后可能需要再次清理记录。', 'Project file moved to Trash, but failed to persist the updated recent list.'); }
}
