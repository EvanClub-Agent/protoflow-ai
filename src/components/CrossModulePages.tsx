import React, { useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Clock,
  ArrowRight,
  ShoppingCart,
  ClipboardCheck,
  Plus,
  FileText,
  Sparkles,
  Layers,
} from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { PageTableBindingBar } from './PageTableBindingBar';
import { useI18n } from '../i18n';

export const CrossModulePages: React.FC = () => {
  const { tr, td } = useI18n();
  const {
    activePageId,
    suppliers,
    purchaseOrderItems,
    acceptanceOrders,
    approveSupplier,
    addNewSupplier,
    confirmPurchaseOrder,
    setActivePage,
    updateAcceptanceHeader,
  } = useProtoStore();

  const [newSupName, setNewSupName] = useState('');
  const [newSupContact, setNewSupContact] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');

  const handleCreateSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupName.trim()) return;
    addNewSupplier(
      newSupName.trim(),
      newSupContact.trim() || tr('周经理', 'Manager Zhou'),
      newSupPhone.trim() || '13900112233',
      tr('智能硬件与数码配件', 'Smart Hardware & Accessories')
    );
    setNewSupName('');
    setNewSupContact('');
    setNewSupPhone('');
  };

  // 1. 基础资料 -> 供应商审批
  if (activePageId === 'supplier-approval') {
    return (
      <div className="space-y-4">
        <PageTableBindingBar
          pageId="supplier-approval"
          pageTitle={tr('基础资料 → 供应商审批 (Page 18)', 'Master Data → Supplier Approval (Page 18)')}
        />
        <div className="pf-paper bg-white text-slate-800 rounded-lg border border-slate-300 shadow-xl overflow-hidden">
          <div className="bg-slate-100 border-b border-slate-300 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-indigo-600 shrink-0" />
              <span className="font-bold text-sm">{tr('基础资料管理 → 供应商审批', 'Master Data Management → Supplier Approval')}</span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium whitespace-nowrap">
                {tr('上游主数据入口', 'Upstream Master Data Entry')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActivePage('acceptance-new')}
              className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <span>{tr('前往下游【新增到货验收】检验下拉框同步效果', 'Go to [New Arrival Acceptance] to verify dropdown sync')}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>

          <div className="p-4 space-y-4 text-xs">
            {/* Quick Add Form */}
            <form
              onSubmit={handleCreateSupplier}
              className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center gap-2"
            >
              <span className="font-bold text-slate-700">{tr('快速新增准入供应商：', 'Quick Onboarding:')}</span>
              <input
                type="text"
                value={newSupName}
                onChange={(e) => setNewSupName(e.target.value)}
                placeholder={tr('供应商名称（如：杭州极光智能数码）', 'Supplier Name (e.g. Aurora Smart Tech)')}
                className="px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 w-56"
              />
              <input
                type="text"
                value={newSupContact}
                onChange={(e) => setNewSupContact(e.target.value)}
                placeholder={tr('联系人（如：刘工）', 'Contact (e.g. Alex Liu)')}
                className="px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 w-36"
              />
              <input
                type="text"
                value={newSupPhone}
                onChange={(e) => setNewSupPhone(e.target.value)}
                placeholder={tr('电话（如：13811223344）', 'Phone (e.g. 13811223344)')}
                className="px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 w-40"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>{tr('直接准入并同步至验收单', 'Approve & Sync to Acceptance')}</span>
              </button>
            </form>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead className="bg-slate-100 text-slate-600 border-b border-slate-300 whitespace-nowrap">
                  <tr>
                    <th className="p-2.5">{tr('供应商编码', 'Supplier Code')}</th>
                    <th className="p-2.5">{tr('供应商名称', 'Supplier Name')}</th>
                    <th className="p-2.5">{tr('供货类别', 'Category')}</th>
                    <th className="p-2.5">{tr('联系人 / 电话', 'Contact / Phone')}</th>
                    <th className="p-2.5">{tr('默认税率', 'Default Tax Rate')}</th>
                    <th className="p-2.5">{tr('当前准入状态', 'Onboarding Status')}</th>
                    <th className="p-2.5">{tr('跨模块联动操作', 'Cross-Module Action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {suppliers.map((sup) => (
                    <tr key={sup.id} className="hover:bg-slate-50">
                      <td className="p-2.5 font-mono text-slate-500">{sup.code}</td>
                      <td className="p-2.5 font-bold text-slate-900">{sup.name}</td>
                      <td className="p-2.5 text-slate-600">{sup.category}</td>
                      <td className="p-2.5">
                        {sup.contactPerson} ({sup.phone})
                      </td>
                      <td className="p-2.5 font-mono tabular-nums">{sup.taxRateDefault}%</td>
                      <td className="p-2.5">
                        {sup.status === 'qualified' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-[11px] whitespace-nowrap">
                            <CheckCircle2 className="w-3 h-3 shrink-0" /> {tr('已入库合格供方', 'Qualified Supplier')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold text-[11px] whitespace-nowrap">
                            <Clock className="w-3 h-3 shrink-0" /> {tr('待审批', 'Pending Approval')}
                          </span>
                        )}
                      </td>
                      <td className="p-2.5">
                        {sup.status === 'pending' ? (
                          <button
                            type="button"
                            onClick={() => approveSupplier(sup.id)}
                            className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer shadow-xs whitespace-nowrap"
                          >
                            {tr('✓ 审批通过 (流入合格供方与验收单)', '✓ Approve (Sync to Qualified List & Acceptance)')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              updateAcceptanceHeader({ supplierId: sup.id });
                              setActivePage('acceptance-new');
                            }}
                            className="px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-medium cursor-pointer whitespace-nowrap"
                          >
                            {tr('作为当前验收供方并发起验收 →', 'Select for New Acceptance →')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Yellow Sticky Note for Supplier Approval */}
        <div className="max-w-3xl rounded-xl bg-amber-50/70 text-slate-700 p-4 shadow-2xs border border-amber-200 text-xs leading-relaxed space-y-1.5">
          <div className="font-bold flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>{tr('【供应商审批】跨模块流转说明（黄色便签）：', '[Supplier Approval] Cross-Module Flow Spec (Sticky Note):')}</span>
          </div>
          <p>
            {tr(
              '1. 在本页面点击“审批通过”后，该供应商状态变更为【已入库合格供方】，左侧目录树中的【合格供应商目录】与【新增到货验收】会自动弹出绿色脉冲角标。',
              '1. Approving a supplier here updates its status to [Qualified Supplier], lighting up green sync badges on [Qualified Suppliers] and [New Arrival Acceptance] in the left menu tree.'
            )}
          </p>
          <p>
            {tr(
              '2. 切换至【新增到货验收】页面时，表头“供应商”下拉框中即可直接选到该企业，并自动带出其联系人与默认税率。',
              '2. Switching to [New Arrival Acceptance] immediately lists the approved supplier in the Supplier dropdown and auto-fills its contact person and default tax rate.'
            )}
          </p>
        </div>
      </div>
    );
  }

  // 2. 基础资料 -> 合格供应商目录
  if (activePageId === 'qualified-suppliers') {
    const qualifiedList = suppliers.filter((s) => s.status === 'qualified');
    return (
      <div className="space-y-4">
        <PageTableBindingBar
          pageId="qualified-suppliers"
          pageTitle={tr('基础资料 → 合格供应商目录 (Page 19)', 'Master Data → Qualified Suppliers (Page 19)')}
        />
        <div className="pf-paper bg-white text-slate-800 rounded-lg border border-slate-300 shadow-xl overflow-hidden">
        <div className="bg-slate-100 border-b border-slate-300 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-bold text-sm tabular-nums">
              {tr(
                `基础资料管理 → 合格供应商目录 (共 ${qualifiedList.length} 家)`,
                `Master Data Management → Qualified Suppliers (${qualifiedList.length})`
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActivePage('acceptance-new')}
            className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
          >
            {tr('前往【新增到货验收】使用供方数据 →', 'Use Supplier Data in [New Arrival Acceptance] →')}
          </button>
        </div>
        <div className="p-4 text-xs overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-300 text-slate-600 whitespace-nowrap">
              <tr>
                <th className="p-2.5">{tr('编码', 'Code')}</th>
                <th className="p-2.5">{tr('合格供应商名称', 'Qualified Supplier Name')}</th>
                <th className="p-2.5">{tr('联系人', 'Contact')}</th>
                <th className="p-2.5">{tr('联系电话', 'Phone')}</th>
                <th className="p-2.5">{tr('默认税率', 'Default Tax Rate')}</th>
                <th className="p-2.5">{tr('准入时间', 'Approved At')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {qualifiedList.map((s) => (
                <tr key={s.id} className={s.isNew ? 'bg-emerald-50' : ''}>
                  <td className="p-2.5 font-mono">{s.code}</td>
                  <td className="p-2.5 font-bold text-slate-900">
                    {s.name}{' '}
                    {s.isNew && (
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] whitespace-nowrap">
                        {tr('刚刚从【供应商审批】流入', 'Synced from [Supplier Approval]')}
                      </span>
                    )}
                  </td>
                  <td className="p-2.5">{s.contactPerson}</td>
                  <td className="p-2.5 font-mono">{s.phone}</td>
                  <td className="p-2.5 font-mono tabular-nums">{s.taxRateDefault}%</td>
                  <td className="p-2.5 font-mono text-slate-500">{s.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    );
  }

  // 3. 采购管理 -> 采购订单确认
  if (activePageId === 'purchase-order-confirm') {
    return (
      <div className="space-y-4">
        <PageTableBindingBar
          pageId="purchase-order-confirm"
          pageTitle={tr('采购管理 → 采购订单确认 (Page 34)', 'Procurement → PO Confirmation (Page 34)')}
        />
        <div className="pf-paper bg-white text-slate-800 rounded-lg border border-slate-300 shadow-xl overflow-hidden">
          <div className="bg-slate-100 border-b border-slate-300 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="font-bold text-sm">{tr('采购与招标管理 → 采购订单确认', 'Procurement & Bidding → PO Confirmation')}</span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                {tr('中游单据池 · 为【新增到货验收】提供转入明细', 'Midstream Order Pool · Feeds line items to [New Arrival Acceptance]')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActivePage('acceptance-new')}
              className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <span>{tr('返回【新增到货验收】转入已确认订单', 'Import Confirmed POs in [New Arrival Acceptance]')}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>

          <div className="p-4 text-xs overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-300 text-slate-600 whitespace-nowrap">
                <tr>
                  <th className="p-2.5">{tr('采购单号', 'PO No.')}</th>
                  <th className="p-2.5">{tr('物料编码 & 名称', 'Material Code & Name')}</th>
                  <th className="p-2.5">{tr('供应商', 'Supplier')}</th>
                  <th className="p-2.5">{tr('订货数量', 'Ordered Qty')}</th>
                  <th className="p-2.5">{tr('已到货验收数', 'Accepted Qty')}</th>
                  <th className="p-2.5">{tr('含税单价', 'Tax-Incl. Price')}</th>
                  <th className="p-2.5">{tr('状态', 'Status')}</th>
                  <th className="p-2.5">{tr('操作', 'Action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {purchaseOrderItems.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-50">
                    <td className="p-2.5 font-mono font-semibold text-blue-700">{po.poNumber}</td>
                    <td className="p-2.5">
                      <div className="font-bold text-slate-900">{po.materialName}</div>
                      <div className="text-[11px] text-slate-500">
                        {po.materialCode} · {po.spec}
                      </div>
                    </td>
                    <td className="p-2.5">{po.supplierName}</td>
                    <td className="p-2.5 font-mono font-bold tabular-nums">
                      {po.orderedQty} {po.unit}
                    </td>
                    <td className="p-2.5 font-mono text-emerald-700 font-bold tabular-nums">
                      {po.deliveredQty} {po.unit}
                    </td>
                    <td className="p-2.5 font-mono tabular-nums">
                      ¥{po.unitPriceTaxIncluded.toFixed(2)} ({po.taxRate}%)
                    </td>
                    <td className="p-2.5">
                      {po.status === 'confirmed' && (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold text-[11px] whitespace-nowrap">
                          {tr('已确认 (可转入验收)', 'Confirmed (Ready for Acceptance)')}
                        </span>
                      )}
                      {po.status === 'unconfirmed' && (
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold text-[11px] whitespace-nowrap">
                          {tr('待确认', 'Unconfirmed')}
                        </span>
                      )}
                      {po.status === 'completed' && (
                        <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold text-[11px] whitespace-nowrap">
                          {tr('已全部收货完成', 'Fully Received')}
                        </span>
                      )}
                    </td>
                    <td className="p-2.5">
                      {po.status === 'unconfirmed' ? (
                        <button
                          type="button"
                          onClick={() => confirmPurchaseOrder(po.id)}
                          className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer whitespace-nowrap"
                        >
                          {tr('✓ 确认采购单 (开放给验收单转入)', '✓ Confirm PO (Enable Acceptance Import)')}
                        </button>
                      ) : (
                        <span className="text-slate-400 text-[11px] whitespace-nowrap">
                          {tr('已同步至下游验收池', 'Synced to downstream acceptance pool')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // 4. 验收入库 -> 到货验收单台账
  if (activePageId === 'acceptance-list') {
    return (
      <div className="space-y-4">
        <PageTableBindingBar
          pageId="acceptance-list"
          pageTitle={tr('验收入库 → 到货验收单台账 (Page 58)', 'Inbound Acceptance → Acceptance Ledger (Page 58)')}
        />
        <div className="pf-paper bg-white text-slate-800 rounded-lg border border-slate-300 shadow-xl overflow-hidden">
        <div className="bg-slate-100 border-b border-slate-300 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-bold text-sm tabular-nums">
              {tr(
                `验收入库管理 → 到货验收单台账 (共 ${acceptanceOrders.length} 单)`,
                `Inbound Acceptance → Acceptance Ledger (${acceptanceOrders.length} orders)`
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActivePage('acceptance-new')}
            className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
          >
            {tr('+ 继续新增到货验收单', '+ New Arrival Acceptance')}
          </button>
        </div>

        <div className="p-4 text-xs overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-300 text-slate-600 whitespace-nowrap">
              <tr>
                <th className="p-2.5">{tr('到货验收单号', 'Acceptance No.')}</th>
                <th className="p-2.5">{tr('验收日期', 'Acceptance Date')}</th>
                <th className="p-2.5">{tr('入库来源', 'Inbound Source')}</th>
                <th className="p-2.5">{tr('供应商名称', 'Supplier Name')}</th>
                <th className="p-2.5">{tr('明细行数', 'Line Count')}</th>
                <th className="p-2.5">{tr('价税合计总额', 'Total Amount (Tax Incl.)')}</th>
                <th className="p-2.5">{tr('状态', 'Status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {acceptanceOrders.map((ord) => (
                <tr key={ord.id} className={ord.isNew ? 'bg-emerald-50/80' : ''}>
                  <td className="p-2.5 font-mono font-bold text-blue-700">
                    {ord.acceptanceNo}
                    {ord.isNew && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] whitespace-nowrap">
                        {tr('NEW 刚提交', 'NEW Submitted')}
                      </span>
                    )}
                  </td>
                  <td className="p-2.5 font-mono">{ord.acceptanceDate}</td>
                  <td className="p-2.5">{td(ord.sourceType)}</td>
                  <td className="p-2.5 font-medium">{ord.supplierName}</td>
                  <td className="p-2.5 font-mono tabular-nums">{tr(`${ord.itemCount} 项`, `${ord.itemCount} items`)}</td>
                  <td className="p-2.5 font-mono font-bold text-emerald-700 tabular-nums">
                    ¥ {ord.totalAmount.toFixed(2)}
                  </td>
                  <td className="p-2.5">
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold text-[11px] whitespace-nowrap">
                      {td(ord.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    );
  }

  // Fallback for other documentation/catalog nodes in the tree
  return (
    <div className="space-y-4">
      <PageTableBindingBar
        pageId={activePageId}
        pageTitle={tr(`菜单模块 → ${activePageId}`, `Module Node → ${activePageId}`)}
      />
      <div className="pf-paper bg-white text-slate-800 rounded-lg border border-slate-300 shadow-xl p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-5 h-5 text-blue-600 shrink-0" />
          <h2 className="text-base font-bold truncate">
            {tr(
              `云仓电商进销存系统 · 模块节点预览 (${activePageId})`,
              `Cloud Warehouse ERP · Module Node Preview (${activePageId})`
            )}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setActivePage('acceptance-new')}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
        >
          {tr('返回核心演示页：【新增到货验收 (57 of 130)】', 'Back to Core Demo: [New Arrival Acceptance (57 of 130)]')}
        </button>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        {tr(
          '当前处于左侧目录树的辅助说明/基础资料节点。为了完整体验',
          'You are viewing an auxiliary or master-data node in the menu tree. To experience full '
        )}
        <strong>{tr('跨模块目录的数据流转', 'cross-module data flow')}</strong>
        {tr('，推荐您依次点击左侧目录树中的：', ', try clicking these pages in sequence:')}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div
          onClick={() => setActivePage('supplier-approval')}
          className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100/70 cursor-pointer space-y-1"
        >
          <div className="font-bold text-indigo-900 flex items-center gap-1">
            <Layers className="w-4 h-4 shrink-0" /> {tr('1. 基础资料 → 供应商审批', '1. Master Data → Supplier Approval')}
          </div>
          <p className="text-slate-600 text-[11px]">
            {tr(
              '准入新供应商，观察它如何自动流入【合格供应商目录】与【新增到货验收】的下拉框。',
              'Approve a new supplier and watch it sync into [Qualified Suppliers] and the [New Arrival Acceptance] dropdown.'
            )}
          </p>
        </div>
        <div
          onClick={() => setActivePage('purchase-order-confirm')}
          className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/60 hover:bg-blue-100/70 cursor-pointer space-y-1"
        >
          <div className="font-bold text-blue-900 flex items-center gap-1">
            <ShoppingCart className="w-4 h-4 shrink-0" /> {tr('2. 采购管理 → 采购订单确认', '2. Procurement → PO Confirmation')}
          </div>
          <p className="text-slate-600 text-[11px]">
            {tr(
              '确认待收货的采购订单，为下游验收单提供“从采购订单转入”的数据源。',
              'Confirm open purchase orders to feed downstream "Import from Purchase Order" acceptance lines.'
            )}
          </p>
        </div>
        <div
          onClick={() => setActivePage('acceptance-new')}
          className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/60 hover:bg-blue-100/70 cursor-pointer space-y-1"
        >
          <div className="font-bold text-emerald-900 flex items-center gap-1">
            <ClipboardCheck className="w-4 h-4 shrink-0" /> {tr('3. 验收入库 → 新增到货验收', '3. Inbound Acceptance → New Arrival Acceptance')}
          </div>
          <p className="text-slate-600 text-[11px]">
            {tr(
              '完整复刻您截图中的第 57 页，包含 6 位小数不含税单价联动与底部可执行黄色需求便签！',
              'Full interactive Page 57 prototype featuring 6-decimal tax-exclusive price calculation and live component sticky rules!'
            )}
          </p>
        </div>
      </div>
      </div>
    </div>
  );
};
