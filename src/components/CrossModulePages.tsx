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

export const CrossModulePages: React.FC = () => {
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
      newSupContact.trim() || '周经理',
      newSupPhone.trim() || '13900112233',
      '智能硬件与数码配件'
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
          pageTitle="基础资料 → 供应商审批 (Page 18)"
        />
        <div className="pf-paper bg-white text-slate-800 rounded-lg border border-slate-300 shadow-xl overflow-hidden">
          <div className="bg-slate-100 border-b border-slate-300 px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-indigo-600" />
              <span className="font-bold text-sm">基础资料管理 → 供应商审批</span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">
                上游主数据入口
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActivePage('acceptance-new')}
              className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1 cursor-pointer"
            >
              <span>前往下游【新增到货验收】检验下拉框同步效果</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-4 space-y-4 text-xs">
            {/* Quick Add Form */}
            <form
              onSubmit={handleCreateSupplier}
              className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center gap-2"
            >
              <span className="font-bold text-slate-700">快速新增准入供应商：</span>
              <input
                type="text"
                value={newSupName}
                onChange={(e) => setNewSupName(e.target.value)}
                placeholder="供应商名称（如：杭州极光智能数码）"
                className="px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 w-56"
              />
              <input
                type="text"
                value={newSupContact}
                onChange={(e) => setNewSupContact(e.target.value)}
                placeholder="联系人（如：刘工）"
                className="px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 w-32"
              />
              <input
                type="text"
                value={newSupPhone}
                onChange={(e) => setNewSupPhone(e.target.value)}
                placeholder="电话（如：13811223344）"
                className="px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 w-36"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>直接准入并同步至验收单</span>
              </button>
            </form>

            <table className="w-full border-collapse text-left">
              <thead className="bg-slate-100 text-slate-600 border-b border-slate-300">
                <tr>
                  <th className="p-2.5">供应商编码</th>
                  <th className="p-2.5">供应商名称</th>
                  <th className="p-2.5">供货类别</th>
                  <th className="p-2.5">联系人 / 电话</th>
                  <th className="p-2.5">默认税率</th>
                  <th className="p-2.5">当前准入状态</th>
                  <th className="p-2.5">跨模块联动操作</th>
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
                    <td className="p-2.5 font-mono">{sup.taxRateDefault}%</td>
                    <td className="p-2.5">
                      {sup.status === 'qualified' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-[11px]">
                          <CheckCircle2 className="w-3 h-3" /> 已入库合格供方
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold text-[11px]">
                          <Clock className="w-3 h-3" /> 待审批
                        </span>
                      )}
                    </td>
                    <td className="p-2.5">
                      {sup.status === 'pending' ? (
                        <button
                          type="button"
                          onClick={() => approveSupplier(sup.id)}
                          className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer shadow-xs"
                        >
                          ✓ 审批通过 (流入合格供方与验收单)
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            updateAcceptanceHeader({ supplierId: sup.id });
                            setActivePage('acceptance-new');
                          }}
                          className="px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-medium cursor-pointer"
                        >
                          作为当前验收供方并发起验收 →
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Yellow Sticky Note for Supplier Approval */}
        <div className="max-w-3xl rounded-xl bg-amber-50/70 text-slate-700 p-4 shadow-2xs border border-amber-200 text-xs leading-relaxed space-y-1.5">
          <div className="font-bold flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            <span>【供应商审批】跨模块流转说明（黄色便签）：</span>
          </div>
          <p>
            1. 在本页面点击“审批通过”后，该供应商状态变更为【已入库合格供方】，左侧目录树中的【合格供应商目录】与【新增到货验收】会自动弹出绿色脉冲角标。
          </p>
          <p>
            2. 切换至【新增到货验收】页面时，表头“供应商”下拉框中即可直接选到该企业，并自动带出其联系人与默认税率。
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
          pageTitle="基础资料 → 合格供应商目录 (Page 19)"
        />
        <div className="pf-paper bg-white text-slate-800 rounded-lg border border-slate-300 shadow-xl overflow-hidden">
        <div className="bg-slate-100 border-b border-slate-300 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="font-bold text-sm">
              基础资料管理 → 合格供应商目录 (共 {qualifiedList.length} 家)
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActivePage('acceptance-new')}
            className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium cursor-pointer"
          >
            前往【新增到货验收】使用供方数据 →
          </button>
        </div>
        <div className="p-4 text-xs">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-300 text-slate-600">
              <tr>
                <th className="p-2.5">编码</th>
                <th className="p-2.5">合格供应商名称</th>
                <th className="p-2.5">联系人</th>
                <th className="p-2.5">联系电话</th>
                <th className="p-2.5">默认税率</th>
                <th className="p-2.5">准入时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {qualifiedList.map((s) => (
                <tr key={s.id} className={s.isNew ? 'bg-emerald-50' : ''}>
                  <td className="p-2.5 font-mono">{s.code}</td>
                  <td className="p-2.5 font-bold text-slate-900">
                    {s.name}{' '}
                    {s.isNew && (
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px]">
                        刚刚从【供应商审批】流入
                      </span>
                    )}
                  </td>
                  <td className="p-2.5">{s.contactPerson}</td>
                  <td className="p-2.5 font-mono">{s.phone}</td>
                  <td className="p-2.5 font-mono">{s.taxRateDefault}%</td>
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
          pageTitle="采购管理 → 采购订单确认 (Page 34)"
        />
        <div className="pf-paper bg-white text-slate-800 rounded-lg border border-slate-300 shadow-xl overflow-hidden">
          <div className="bg-slate-100 border-b border-slate-300 px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-blue-600" />
              <span className="font-bold text-sm">采购与招标管理 → 采购订单确认</span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                中游单据池 · 为【新增到货验收】提供转入明细
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActivePage('acceptance-new')}
              className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1 cursor-pointer"
            >
              <span>返回【新增到货验收】转入已确认订单</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-4 text-xs">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-300 text-slate-600">
                <tr>
                  <th className="p-2.5">采购单号</th>
                  <th className="p-2.5">物料编码 & 名称</th>
                  <th className="p-2.5">供应商</th>
                  <th className="p-2.5">订货数量</th>
                  <th className="p-2.5">已到货验收数</th>
                  <th className="p-2.5">含税单价</th>
                  <th className="p-2.5">状态</th>
                  <th className="p-2.5">操作</th>
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
                    <td className="p-2.5 font-mono font-bold">
                      {po.orderedQty} {po.unit}
                    </td>
                    <td className="p-2.5 font-mono text-emerald-700 font-bold">
                      {po.deliveredQty} {po.unit}
                    </td>
                    <td className="p-2.5 font-mono">
                      ¥{po.unitPriceTaxIncluded.toFixed(2)} ({po.taxRate}%)
                    </td>
                    <td className="p-2.5">
                      {po.status === 'confirmed' && (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold text-[11px]">
                          已确认 (可转入验收)
                        </span>
                      )}
                      {po.status === 'unconfirmed' && (
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold text-[11px]">
                          待确认
                        </span>
                      )}
                      {po.status === 'completed' && (
                        <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold text-[11px]">
                          已全部收货完成
                        </span>
                      )}
                    </td>
                    <td className="p-2.5">
                      {po.status === 'unconfirmed' ? (
                        <button
                          type="button"
                          onClick={() => confirmPurchaseOrder(po.id)}
                          className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
                        >
                          ✓ 确认采购单 (开放给验收单转入)
                        </button>
                      ) : (
                        <span className="text-slate-400 text-[11px]">已同步至下游验收池</span>
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
          pageTitle="验收入库 → 到货验收单台账 (Page 58)"
        />
        <div className="pf-paper bg-white text-slate-800 rounded-lg border border-slate-300 shadow-xl overflow-hidden">
        <div className="bg-slate-100 border-b border-slate-300 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-emerald-600" />
            <span className="font-bold text-sm">
              验收入库管理 → 到货验收单台账 (共 {acceptanceOrders.length} 单)
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActivePage('acceptance-new')}
            className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium cursor-pointer"
          >
            + 继续新增到货验收单
          </button>
        </div>

        <div className="p-4 text-xs">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-300 text-slate-600">
              <tr>
                <th className="p-2.5">到货验收单号</th>
                <th className="p-2.5">验收日期</th>
                <th className="p-2.5">入库来源</th>
                <th className="p-2.5">供应商名称</th>
                <th className="p-2.5">明细行数</th>
                <th className="p-2.5">价税合计总额</th>
                <th className="p-2.5">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {acceptanceOrders.map((ord) => (
                <tr key={ord.id} className={ord.isNew ? 'bg-emerald-50/80' : ''}>
                  <td className="p-2.5 font-mono font-bold text-blue-700">
                    {ord.acceptanceNo}
                    {ord.isNew && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px]">
                        NEW 刚提交
                      </span>
                    )}
                  </td>
                  <td className="p-2.5 font-mono">{ord.acceptanceDate}</td>
                  <td className="p-2.5">{ord.sourceType}</td>
                  <td className="p-2.5 font-medium">{ord.supplierName}</td>
                  <td className="p-2.5 font-mono">{ord.itemCount} 项</td>
                  <td className="p-2.5 font-mono font-bold text-emerald-700">
                    ¥ {ord.totalAmount.toFixed(2)}
                  </td>
                  <td className="p-2.5">
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold text-[11px]">
                      {ord.status}
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
        pageTitle={`菜单模块 → ${activePageId}`}
      />
      <div className="pf-paper bg-white text-slate-800 rounded-lg border border-slate-300 shadow-xl p-6 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          <h2 className="text-base font-bold">
            云仓电商进销存系统 · 模块节点预览 ({activePageId})
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setActivePage('acceptance-new')}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold cursor-pointer"
        >
          返回核心演示页：【新增到货验收 (57 of 130)】
        </button>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        当前处于左侧目录树的辅助说明/基础资料节点。为了完整体验<strong>跨模块目录的数据流转</strong>，推荐您依次点击左侧目录树中的：
      </p>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div
          onClick={() => setActivePage('supplier-approval')}
          className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100/70 cursor-pointer space-y-1"
        >
          <div className="font-bold text-indigo-900 flex items-center gap-1">
            <Layers className="w-4 h-4" /> 1. 基础资料 → 供应商审批
          </div>
          <p className="text-slate-600 text-[11px]">
            准入新供应商，观察它如何自动流入【合格供应商目录】与【新增到货验收】的下拉框。
          </p>
        </div>
        <div
          onClick={() => setActivePage('purchase-order-confirm')}
          className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/60 hover:bg-blue-100/70 cursor-pointer space-y-1"
        >
          <div className="font-bold text-blue-900 flex items-center gap-1">
            <ShoppingCart className="w-4 h-4" /> 2. 采购管理 → 采购订单确认
          </div>
          <p className="text-slate-600 text-[11px]">
            确认待收货的采购订单，为下游验收单提供“从采购订单转入”的数据源。
          </p>
        </div>
        <div
          onClick={() => setActivePage('acceptance-new')}
          className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/70 cursor-pointer space-y-1"
        >
          <div className="font-bold text-emerald-900 flex items-center gap-1">
            <ClipboardCheck className="w-4 h-4" /> 3. 验收入库 → 新增到货验收
          </div>
          <p className="text-slate-600 text-[11px]">
            完整复刻您截图中的第 57 页，包含 6 位小数不含税单价联动与底部可执行黄色需求便签！
          </p>
        </div>
      </div>
      </div>
    </div>
  );
};
