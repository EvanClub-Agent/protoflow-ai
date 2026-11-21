import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Plus,
  Trash2,
  CheckCircle2,
  Save,
  Sparkles,
  ArrowRight,
  CheckSquare,
  Square,
  Building2,
  Pin,
} from 'lucide-react';
import { useProtoStore, SelectableWidgetId } from '../store/useProtoStore';
import { ComponentStickyPin } from './ComponentStickyPin';
import { PageTableBindingBar } from './PageTableBindingBar';
import { useI18n } from '../i18n';

export const AcceptanceNewPage: React.FC = () => {
  const { isEn, tr, td } = useI18n();
  const {
    suppliers,
    purchaseOrderItems,
    draftAcceptanceHeader,
    draftAcceptanceLines,
    stickyNotes,
    widgets,
    selectedWidgetId,
    isImportModalOpen,
    selectWidget,
    setImportModalOpen,
    updateAcceptanceHeader,
    updateAcceptanceLineQty,
    updateAcceptanceLinePrice,
    removeAcceptanceLine,
    importPoItemsToAcceptance,
    submitAcceptanceOrder,
    toggleStickyRule,
    addStickyRuleToWidget,
    setActivePage,
    setActivePopoverWidgetId,
  } = useProtoStore();

  const [selectedPoIds, setSelectedPoIds] = useState<string[]>(['PO-ITEM-3']);
  const [newStickyInput, setNewStickyInput] = useState('');
  const [targetWidgetForNewSticky, setTargetWidgetForNewSticky] =
    useState<SelectableWidgetId>('btn-import-po');
  const [submitBanner, setSubmitBanner] = useState<string | null>(null);

  const qualifiedSuppliers = suppliers.filter((s) => s.status === 'qualified');
  const confirmedPoItems = purchaseOrderItems.filter((p) => p.status === 'confirmed');

  const headerWidget = widgets['header-form-group'];
  const importBtnWidget = widgets['btn-import-po'];
  const gridWidget = widgets['acceptance-detail-grid'];
  const submitBtnWidget = widgets['btn-submit-acceptance'];
  const stickyWidget = widgets['yellow-sticky-spec'];

  const precision = gridWidget.props.precisionDigits ?? 6;
  const formulaRuleActive = stickyNotes.find((r) => r.id === 'sticky-3')?.active ?? true;

  const totalTaxIncludedAmount = draftAcceptanceLines.reduce(
    (sum, line) => sum + line.currentAcceptQty * line.unitPriceTaxIncluded,
    0
  );

  const getWidgetHighlight = (id: SelectableWidgetId) =>
    selectedWidgetId === id
      ? 'ring-2 ring-blue-500 border-blue-500 shadow-md'
      : 'hover:ring-1 hover:ring-blue-400/50 border-slate-300';

  const handleAddSticky = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStickyInput.trim()) return;
    addStickyRuleToWidget('acceptance-new', targetWidgetForNewSticky, newStickyInput.trim());
    setNewStickyInput('');
  };

  const handleDoSubmit = (asDraft: boolean) => {
    submitAcceptanceOrder(asDraft);
    setSubmitBanner(
      asDraft
        ? tr('已暂存草稿至【到货验收单台账】！', 'Saved draft to [Acceptance Ledger]!')
        : tr(
            '验收单已正式提交！已自动写入【到货验收单台账】并扣减上游【采购订单】未到货余额。',
            'Acceptance order submitted! Recorded in [Acceptance Ledger] and deducted open balances on upstream [Purchase Orders].'
          )
    );
    setTimeout(() => setSubmitBanner(null), 4000);
  };

  const labelWidthClass = isEn ? 'w-32 whitespace-nowrap' : 'w-24';

  return (
    <div className="space-y-4 pb-12">
      {/* Menu-to-Database Table Binding & In-Menu Table Creation Bar */}
      <PageTableBindingBar
        pageId="acceptance-new"
        pageTitle={tr('验收入库 → 新增到货验收 (Page 57)', 'Inbound Acceptance → New Arrival Acceptance (Page 57)')}
      />

      {/* Submission Feedback Toast */}
      {submitBanner && (
        <div className="p-3 rounded-xl bg-emerald-600 text-white text-xs font-medium flex flex-wrap items-center justify-between gap-2 shadow-lg">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{submitBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setActivePage('acceptance-list')}
            className="px-2.5 py-1 rounded bg-white text-emerald-900 font-bold text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>{tr('立即查看【到货验收单台账】', 'Open [Acceptance Ledger]')}</span>
            <ArrowRight className="w-3 h-3 shrink-0" />
          </button>
        </div>
      )}

      {/* Main White ERP Prototype Paper */}
      <div className="pf-paper bg-white text-slate-800 rounded-lg border border-slate-300 shadow-xl overflow-visible">
        {/* Top Window Title Bar */}
        <div className="bg-slate-100 border-b border-slate-300 px-4 py-2 flex flex-wrap items-center justify-between gap-2 rounded-t-lg">
          <div className="flex flex-wrap items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="font-bold text-sm text-slate-800">{tr('新增到货验收单', 'New Arrival Acceptance Order')}</span>
            <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold border border-amber-300">
              {tr('📌 支持在任意组件/按钮上直接贴黄色便签', '📌 Attach yellow spec notes directly to any widget or button')}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span>
              {tr('点击页面中任意黄色的 ', 'Click any yellow ')}
              <strong>{tr('📌 组件便签', '📌 Widget Pin')}</strong>
              {tr(' 即可就地查看或新增该组件的需求说明', ' to view or add requirement specs in place')}
            </span>
          </div>
        </div>

        {/* Section 1: 到货验收信息 (Header Form) */}
        {headerWidget.props.visible && (
          <div
            onClick={() => selectWidget('header-form-group')}
            className={`m-3 rounded border transition cursor-pointer ${getWidgetHighlight(
              'header-form-group'
            )}`}
          >
            <div className="bg-slate-100/90 px-3 py-1.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700">{td(headerWidget.props.label)}</span>
                <ComponentStickyPin
                  pageId="acceptance-new"
                  widgetId="header-form-group"
                  badgeLabel={tr('表头便签', 'Header Pin')}
                  position="right"
                />
              </div>
              <span className="text-[11px] text-blue-600 font-medium">
                {tr('⚡ 供应商下拉框已挂载组件级便签与跨模块数据流', '⚡ Supplier dropdown is wired to widget-level spec notes & cross-module data flow')}
              </span>
            </div>

            <div
              className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-3 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Row 1 */}
              <div className="flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right text-slate-600 shrink-0`}>
                  <span className="text-rose-500">*</span>{tr('到货验收日期', 'Acceptance Date')}
                </label>
                <input
                  type="date"
                  value={draftAcceptanceHeader.acceptanceDate}
                  onChange={(e) => updateAcceptanceHeader({ acceptanceDate: e.target.value })}
                  className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-slate-800 bg-white"
                />
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right text-slate-600 shrink-0`}>
                  <span className="text-rose-500">*</span>{tr('到货验收单号', 'Acceptance No.')}
                </label>
                <input
                  type="text"
                  value={draftAcceptanceHeader.acceptanceNo}
                  onChange={(e) => updateAcceptanceHeader({ acceptanceNo: e.target.value })}
                  className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-slate-700 bg-slate-50 font-mono"
                />
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right text-slate-600 shrink-0`}>
                  <span className="text-rose-500">*</span>{tr('到货验收人', 'Inspector')}
                </label>
                <input
                  type="text"
                  value={draftAcceptanceHeader.inspector}
                  onChange={(e) => updateAcceptanceHeader({ inspector: e.target.value })}
                  className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-slate-800"
                />
              </div>

              {/* Row 2 */}
              <div className="flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right text-slate-600 shrink-0`}>
                  <span className="text-rose-500">*</span>{tr('入库类型', 'Inbound Type')}
                </label>
                <select
                  value={draftAcceptanceHeader.inboundType}
                  onChange={(e) =>
                    updateAcceptanceHeader({
                      inboundType: e.target.value as '购买' | '调拨' | '盘盈',
                    })
                  }
                  className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-slate-800 bg-white"
                >
                  <option value="购买">{tr('购买', 'Purchase')}</option>
                  <option value="调拨">{tr('调拨', 'Transfer')}</option>
                  <option value="盘盈">{tr('盘盈', 'Inventory Gain')}</option>
                </select>
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right text-blue-600 font-medium shrink-0`}>
                  <span className="text-rose-500">*</span>{tr('入库来源类型', 'Inbound Source')}
                </label>
                <select
                  value={draftAcceptanceHeader.sourceType}
                  onChange={(e) =>
                    updateAcceptanceHeader({
                      sourceType: e.target.value as '供方发货单转入' | '采购订单转入',
                    })
                  }
                  className="flex-1 min-w-0 px-2 py-1 border border-blue-400 rounded text-slate-800 bg-blue-50/40 font-medium"
                >
                  <option value="供方发货单转入">{tr('供方发货单转入', 'From Supplier Delivery Note')}</option>
                  <option value="采购订单转入">{tr('采购订单转入', 'From Purchase Order')}</option>
                </select>
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right text-slate-600 shrink-0`}>{tr('送货人', 'Courier')}</label>
                <input
                  type="text"
                  value={draftAcceptanceHeader.deliveryPerson}
                  onChange={(e) => updateAcceptanceHeader({ deliveryPerson: e.target.value })}
                  className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-slate-800"
                />
              </div>

              {/* Row 3: Cross-module Supplier Dropdown WITH its own Component Sticky Pin! */}
              <div
                onClick={() => selectWidget('field-supplier-select')}
                className="flex items-center gap-2 col-span-1 min-w-0"
              >
                <label className={`${labelWidthClass} text-right text-blue-700 font-semibold shrink-0`}>
                  <span className="text-rose-500">*</span>{tr('供应商', 'Supplier')}
                </label>
                <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                  <select
                    value={draftAcceptanceHeader.supplierId}
                    onChange={(e) => updateAcceptanceHeader({ supplierId: e.target.value })}
                    className="flex-1 min-w-[130px] px-2 py-1 border-2 border-blue-500/70 rounded text-slate-900 bg-blue-50/30 font-medium"
                  >
                    {qualifiedSuppliers.map((sup) => (
                      <option key={sup.id} value={sup.id}>
                        {sup.name} {sup.isNew ? tr(' (★刚审批通过)', ' (★Newly Approved)') : ''}
                      </option>
                    ))}
                  </select>
                  <ComponentStickyPin
                    pageId="acceptance-new"
                    widgetId="field-supplier-select"
                    badgeLabel={tr('#1 供方下拉便签', '#1 Supplier Pin')}
                    position="right"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right text-slate-600 shrink-0`}>{tr('供应商联系人', 'Supplier Contact')}</label>
                <input
                  type="text"
                  value={draftAcceptanceHeader.supplierContact}
                  onChange={(e) => updateAcceptanceHeader({ supplierContact: e.target.value })}
                  className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-slate-700 bg-slate-50"
                />
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right text-slate-600 shrink-0`}>{tr('供应商联系电话', 'Supplier Phone')}</label>
                <input
                  type="text"
                  value={draftAcceptanceHeader.supplierPhone}
                  onChange={(e) => updateAcceptanceHeader({ supplierPhone: e.target.value })}
                  className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-slate-700 bg-slate-50 font-mono"
                />
              </div>

              {/* Row 4: Tax & Auto-Sum Total */}
              <div className="flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right text-slate-600 shrink-0`}>
                  <span className="text-rose-500">*</span>{tr('税率', 'Tax Rate')}
                </label>
                <select
                  value={draftAcceptanceHeader.taxRate}
                  onChange={(e) => updateAcceptanceHeader({ taxRate: Number(e.target.value) })}
                  className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-slate-800 bg-white font-mono"
                >
                  <option value={9}>9%</option>
                  <option value={13}>13%</option>
                  <option value={6}>6%</option>
                  <option value={3}>3%</option>
                </select>
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right text-slate-600 shrink-0`}>{tr('发票类型', 'Invoice Type')}</label>
                <select
                  value={draftAcceptanceHeader.invoiceType}
                  onChange={(e) =>
                    updateAcceptanceHeader({ invoiceType: e.target.value as '专票' | '普票' })
                  }
                  className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-slate-800 bg-white"
                >
                  <option value="专票">{tr('专票', 'Special VAT Invoice')}</option>
                  <option value="普票">{tr('普票', 'General VAT Invoice')}</option>
                </select>
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right font-bold text-slate-700 shrink-0`}>
                  {tr('价税合计(自动)', 'Total w/ Tax (Auto)')}
                </label>
                <input
                  type="text"
                  readOnly
                  value={`¥ ${totalTaxIncludedAmount.toFixed(2)}`}
                  className="flex-1 min-w-0 px-2 py-1 border border-emerald-500 rounded text-emerald-700 bg-emerald-50 font-mono font-bold tabular-nums"
                />
              </div>

              {/* Row 5: Remark */}
              <div className="lg:col-span-2 flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right text-slate-600 shrink-0`}>{tr('备注', 'Remarks')}</label>
                <input
                  type="text"
                  value={draftAcceptanceHeader.remark}
                  onChange={(e) => updateAcceptanceHeader({ remark: e.target.value })}
                  className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-slate-800"
                />
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <label className={`${labelWidthClass} text-right text-slate-600 shrink-0`}>{tr('相关附件', 'Attachments')}</label>
                <span className="px-2.5 py-1 rounded bg-blue-500 text-white text-[11px] whitespace-nowrap">
                  {tr('点击上传质检报告', 'Upload QC Report')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Section 2: Action Button "选择采购明细" WITH its own Component Sticky Pin! */}
        <div className="px-4 py-1 flex items-center justify-between">
          {importBtnWidget.props.visible && (
            <div
              onClick={() => selectWidget('btn-import-po')}
              className={`inline-flex flex-wrap items-center gap-2.5 p-1.5 rounded border transition cursor-pointer ${getWidgetHighlight(
                'btn-import-po'
              )}`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectWidget('btn-import-po');
                  setImportModalOpen(true);
                }}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>{td(importBtnWidget.props.label)} {tr('(从采购订单转入)', '(Import from PO)')}</span>
              </button>

              {/* Inline Sticky Pin attached right next to the button! */}
              <ComponentStickyPin
                pageId="acceptance-new"
                widgetId="btn-import-po"
                badgeLabel={tr('#2 按钮便签', '#2 Button Pin')}
                position="right"
              />

              <span className="text-[11px] text-slate-500 pr-2">
                {tr('← 点击黄色 📌 可直接在此按钮旁读写便签说明', '← Click yellow 📌 to read/write spec notes right beside this button')}
              </span>
            </div>
          )}
        </div>

        {/* Section 3: 到货验收明细 (Editable Live-Calculated Data Table) WITH its own Component Sticky Pin! */}
        {gridWidget.props.visible && (
          <div
            onClick={() => selectWidget('acceptance-detail-grid')}
            className={`m-3 rounded border transition cursor-pointer ${getWidgetHighlight(
              'acceptance-detail-grid'
            )}`}
          >
            <div className="bg-slate-100 px-3 py-1.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700">{td(gridWidget.props.label)}</span>
                <ComponentStickyPin
                  pageId="acceptance-new"
                  widgetId="acceptance-detail-grid"
                  badgeLabel={tr('#3/#4 明细算税与防超收便签', '#3/#4 Tax & Over-Receipt Pin')}
                  position="right"
                />
              </div>
              <span className="text-[11px] text-slate-500 tabular-nums">
                {tr('不含税单价精度: ', 'Excl.-Tax Unit Price Precision: ')}
                <strong className="text-blue-600">{tr(`${precision} 位小数`, `${precision} decimals`)}</strong>
                {tr(' · 修改下方【到货数量】或【含税单价】实时触发便签公式重算', ' · Editing [Accept Qty] or [Tax-Incl. Price] below recalculates sticky formulas live')}
              </span>
            </div>

            <div className="overflow-x-auto" onClick={(e) => e.stopPropagation()}>
              <table className="w-full min-w-[1080px] text-xs border-collapse text-center whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-300">
                  <tr>
                    <th className="border-r border-slate-200 px-2 py-2">{tr('序号', '#')}</th>
                    <th className="border-r border-slate-200 px-2 py-2">{tr('计划类别', 'Plan Type')}</th>
                    <th className="border-r border-slate-200 px-2 py-2">{tr('物料编码', 'Material Code')}</th>
                    <th className="border-r border-slate-200 px-3 py-2 text-left min-w-[190px]">
                      {tr('物料名称', 'Material Name')}
                    </th>
                    <th className="border-r border-slate-200 px-2 py-2">{tr('规格型号', 'Spec / Model')}</th>
                    <th className="border-r border-slate-200 px-2 py-2">{tr('单位', 'Unit')}</th>
                    <th className="border-r border-slate-200 px-2 py-2">{tr('订货数量', 'Ordered Qty')}</th>
                    <th className="border-r border-slate-200 px-2 py-2">{tr('已到货数量', 'Received Qty')}</th>
                    <th className="border-r border-slate-200 px-2 py-2 bg-blue-50/70 text-blue-800">
                      <span className="text-rose-500">*</span>{tr('本次到货数量', 'Current Accept Qty')}
                    </th>
                    <th className="border-r border-slate-200 px-2 py-2 bg-blue-50/70 text-blue-800">
                      {tr('含税单价(元)', 'Unit Price w/ Tax')}
                    </th>
                    <th className="border-r border-slate-200 px-2 py-2">{tr('税率', 'Tax Rate')}</th>
                    <th className="border-r border-slate-200 px-2 py-2 bg-amber-50/80 text-amber-900">
                      {tr('不含税单价(元)', 'Unit Price Excl. Tax')}
                    </th>
                    <th className="border-r border-slate-200 px-2 py-2 bg-amber-50/80 text-amber-900">
                      {tr('不含税金额(元)', 'Amount Excl. Tax')}
                    </th>
                    <th className="border-r border-slate-200 px-2 py-2 bg-amber-50/80 text-amber-900">
                      {tr('税额(元)', 'Tax Amount')}
                    </th>
                    <th className="border-r border-slate-200 px-2 py-2 bg-emerald-50 text-emerald-900 font-bold">
                      {tr('含税金额(元)', 'Amount w/ Tax')}
                    </th>
                    <th className="border-r border-slate-200 px-2 py-2">{tr('课题编码', 'Project Code')}</th>
                    {gridWidget.props.showSerialColumn && (
                      <th className="border-r border-slate-200 px-2 py-2">{tr('顺序编号', 'Serial No.')}</th>
                    )}
                    <th className="px-2 py-2">{tr('操作', 'Action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {draftAcceptanceLines.map((line, idx) => {
                    const rateDecimal =
                      (formulaRuleActive ? line.taxRate : draftAcceptanceHeader.taxRate) / 100;
                    const noTaxUnitPrice = line.unitPriceTaxIncluded / (1 + rateDecimal);
                    const taxIncludedAmount = line.unitPriceTaxIncluded * line.currentAcceptQty;
                    const noTaxAmount = taxIncludedAmount / (1 + rateDecimal);
                    const taxAmount = taxIncludedAmount - noTaxAmount;
                    const maxRemain = Math.max(0, line.orderedQty - line.alreadyAcceptedQty);

                    return (
                      <tr key={line.id} className="hover:bg-blue-50/30">
                        <td className="border-r border-slate-200 px-2 py-2 font-mono tabular-nums">{idx + 1}</td>
                        <td className="border-r border-slate-200 px-2 py-2">{line.planCategory}</td>
                        <td className="border-r border-slate-200 px-2 py-2 font-mono text-slate-600">
                          {line.materialCode}
                        </td>
                        <td className="border-r border-slate-200 px-3 py-2 font-medium text-slate-900 text-left min-w-[190px]">
                          {line.materialName}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-2 text-slate-500">
                          {line.spec}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-2">{line.unit}</td>
                        <td className="border-r border-slate-200 px-2 py-2 font-mono tabular-nums">
                          {line.orderedQty}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-2 font-mono text-slate-500 tabular-nums">
                          {line.alreadyAcceptedQty}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-1.5 bg-blue-50/40">
                          <input
                            type="number"
                            min={1}
                            max={maxRemain}
                            value={line.currentAcceptQty}
                            onChange={(e) =>
                              updateAcceptanceLineQty(line.id, Number(e.target.value))
                            }
                            className="w-16 px-1.5 py-0.5 text-center border border-blue-400 rounded bg-white font-mono font-bold text-blue-700 tabular-nums"
                            title={tr(`最大未到货余量: ${maxRemain}`, `Max remaining open qty: ${maxRemain}`)}
                          />
                        </td>
                        <td className="border-r border-slate-200 px-2 py-1.5 bg-blue-50/40">
                          <input
                            type="number"
                            step="0.1"
                            value={line.unitPriceTaxIncluded}
                            onChange={(e) =>
                              updateAcceptanceLinePrice(line.id, Number(e.target.value))
                            }
                            className="w-20 px-1.5 py-0.5 text-right border border-slate-300 rounded bg-white font-mono tabular-nums"
                          />
                        </td>
                        <td className="border-r border-slate-200 px-2 py-2 font-mono tabular-nums">
                          {line.taxRate}%
                        </td>
                        <td className="border-r border-slate-200 px-2 py-2 font-mono text-amber-900 bg-amber-50/40 tabular-nums">
                          {noTaxUnitPrice.toFixed(precision)}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-2 font-mono text-amber-900 bg-amber-50/40 tabular-nums">
                          {noTaxAmount.toFixed(2)}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-2 font-mono text-amber-900 bg-amber-50/40 tabular-nums">
                          {taxAmount.toFixed(2)}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-2 font-mono font-bold text-emerald-700 bg-emerald-50/50 tabular-nums">
                          {taxIncludedAmount.toFixed(2)}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-2 font-mono text-[11px]">
                          {line.projectCode}
                        </td>
                        {gridWidget.props.showSerialColumn && (
                          <td className="border-r border-slate-200 px-2 py-2 font-mono">
                            {line.serialNo}
                          </td>
                        )}
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => removeAcceptanceLine(line.id)}
                            className="text-rose-600 hover:underline inline-flex items-center gap-0.5 cursor-pointer whitespace-nowrap"
                          >
                            <Trash2 className="w-3 h-3 shrink-0" />
                            <span>{tr('删除', 'Delete')}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Section 4: Bottom Submit / Save Draft Buttons WITH Component Sticky Pin! */}
        {submitBtnWidget.props.visible && (
          <div
            onClick={() => selectWidget('btn-submit-acceptance')}
            className={`m-3 p-3 rounded border flex flex-wrap items-center justify-center gap-4 cursor-pointer ${getWidgetHighlight(
              'btn-submit-acceptance'
            )}`}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDoSubmit(false);
              }}
              className="px-6 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow cursor-pointer whitespace-nowrap"
            >
              {td(submitBtnWidget.props.label)}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDoSubmit(true);
              }}
              className="px-6 py-1.5 rounded bg-blue-500 hover:bg-blue-400 text-white text-xs font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5 shrink-0" />
              <span>{tr('暂存', 'Save Draft')}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActivePage('acceptance-list');
              }}
              className="px-6 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 text-xs cursor-pointer whitespace-nowrap"
            >
              {tr('返回台账', 'Back to Ledger')}
            </button>

            <ComponentStickyPin
              pageId="acceptance-new"
              widgetId="btn-submit-acceptance"
              badgeLabel={tr('#5 提交动作便签', '#5 Submit Action Pin')}
              position="left"
            />
          </div>
        )}
      </div>

      {/* Section 5: Page Specification & Component Sticky Note Rules Card (Refined Commercial Callout) */}
      {stickyWidget.props.visible && (
        <div
          onClick={() => selectWidget('yellow-sticky-spec')}
          className={`max-w-5xl rounded-xl bg-amber-50/70 text-slate-800 p-4 shadow-2xs border transition cursor-pointer ${
            selectedWidgetId === 'yellow-sticky-spec'
              ? 'border-blue-500 ring-2 ring-blue-500/20'
              : 'border-amber-200/90'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/80 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-amber-100 border border-amber-300 flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-amber-700" />
              </span>
              <span className="font-semibold text-xs text-slate-900">{td(stickyWidget.props.label)}</span>
            </div>
            <span className="text-[11px] text-amber-800 bg-amber-100/80 border border-amber-200 px-2 py-0.5 rounded-md">
              {tr('双向联动：点击任意条目的【锚定组件】可直接定位并弹出上方对应组件的便签', 'Two-way sync: click any [Anchored Widget] tag to highlight and open its pin popover above')}
            </span>
          </div>

          <div className="space-y-2 text-xs leading-relaxed" onClick={(e) => e.stopPropagation()}>
            {stickyNotes
              .filter((n) => n.pageId === 'acceptance-new')
              .map((rule) => (
                <div
                  key={rule.id}
                  className={`flex items-start justify-between gap-3 p-2.5 rounded-lg border transition ${
                    rule.active
                      ? 'bg-white border-amber-200/90 hover:border-amber-300 shadow-2xs'
                      : 'bg-slate-50 border-slate-200 opacity-60 line-through'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleStickyRule(rule.id)}
                      className="mt-0.5 cursor-pointer shrink-0"
                    >
                      {rule.active ? (
                        <CheckSquare className="w-4 h-4 text-amber-600 shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-bold text-amber-700">#{rule.index}</span>
                        <button
                          type="button"
                          onClick={() => {
                            selectWidget(rule.targetWidgetId);
                            setActivePopoverWidgetId(rule.targetWidgetId);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 text-[10px] font-medium cursor-pointer transition"
                          title={tr('点击高亮定位到页面上对应的组件便签', 'Click to highlight and open the corresponding widget pin')}
                        >
                          <Pin className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                          <span>{td(rule.targetWidgetName)}</span>
                        </button>
                        <span className="text-slate-800 break-words">{rule.text}</span>
                      </div>
                      <div className="font-mono text-[10px] text-slate-500 mt-1 break-words">
                        {tr('↳ 绑定执行契约: ', '↳ Bound execution contract: ')}`{rule.compiledRule}`
                      </div>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-md border shrink-0 whitespace-nowrap ${
                      rule.active
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    {rule.active ? tr('生效中', 'Active') : tr('已挂起', 'Suspended')}
                  </span>
                </div>
              ))}

            <form onSubmit={handleAddSticky} className="pt-2 flex flex-wrap gap-2">
              <select
                value={targetWidgetForNewSticky}
                onChange={(e) =>
                  setTargetWidgetForNewSticky(e.target.value as SelectableWidgetId)
                }
                className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-medium text-slate-800 focus:outline-none focus:border-blue-600"
              >
                <option value="field-supplier-select">{tr('绑定到：供应商下拉框', 'Bind to: Supplier Dropdown')}</option>
                <option value="btn-import-po">{tr('绑定到：[选择采购明细] 按钮', 'Bind to: [Select PO Lines] Button')}</option>
                <option value="acceptance-detail-grid">{tr('绑定到：到货验收明细表', 'Bind to: Acceptance Lines Table')}</option>
                <option value="btn-submit-acceptance">{tr('绑定到：[提交 / 暂存] 按钮', 'Bind to: [Submit / Save Draft] Buttons')}</option>
                <option value="header-form-group">{tr('绑定到：表头表单区', 'Bind to: Header Form Section')}</option>
              </select>
              <input
                type="text"
                value={newStickyInput}
                onChange={(e) => setNewStickyInput(e.target.value)}
                placeholder={tr('选择目标组件并输入新便签规则（将同时贴在上方组件旁与底部汇总表中）...', 'Select target widget and enter a new spec rule (pinned above & listed here)...')}
                className="flex-1 min-w-[240px] px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
              />
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1 cursor-pointer transition whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>{tr('添加便签规则', 'Add Spec Rule')}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Cross-Module Modal: 从【采购订单确认】转入明细 */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="text-sm font-semibold text-slate-900 truncate">
                  {tr('跨模块调取：从【采购订单确认】转入待验收明细', 'Cross-Module Import: Select Pending Lines from [PO Confirmation]')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="text-xs text-slate-400 hover:text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
              >
                {tr('关闭 ✕', 'Close ✕')}
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div className="p-2.5 rounded-lg bg-blue-50/70 border border-blue-200 text-slate-700 flex flex-wrap items-center justify-between gap-2">
                <span>
                  {tr('以下数据实时读取自左侧菜单 ', 'Live data read from left menu ')}
                  <strong>{tr('【采购与招标管理 → 采购订单确认】', '[Procurement & Bidding → PO Confirmation]')}</strong>
                  {tr(' 中状态为“已确认”的采购单：', ' where status is "Confirmed":')}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setImportModalOpen(false);
                    setActivePage('purchase-order-confirm');
                  }}
                  className="text-[11px] font-medium text-blue-600 hover:underline shrink-0 cursor-pointer whitespace-nowrap"
                >
                  {tr('去采购模块确认更多订单 →', 'Confirm more POs in Procurement →')}
                </button>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 whitespace-nowrap">
                    <tr>
                      <th className="p-2.5">{tr('选择', 'Select')}</th>
                      <th className="p-2.5">{tr('采购单号', 'PO No.')}</th>
                      <th className="p-2.5">{tr('物料名称 / 规格', 'Material / Spec')}</th>
                      <th className="p-2.5">{tr('供应商', 'Supplier')}</th>
                      <th className="p-2.5">{tr('未到货余量', 'Open Qty')}</th>
                      <th className="p-2.5">{tr('含税单价', 'Tax-Incl. Price')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {confirmedPoItems.map((po) => {
                      const checked = selectedPoIds.includes(po.id);
                      return (
                        <tr
                          key={po.id}
                          onClick={() =>
                            setSelectedPoIds((prev) =>
                              checked ? prev.filter((x) => x !== po.id) : [...prev, po.id]
                            )
                          }
                          className="hover:bg-slate-50 cursor-pointer"
                        >
                          <td className="p-2.5">
                            <input type="checkbox" checked={checked} readOnly className="accent-blue-600" />
                          </td>
                          <td className="p-2.5 font-mono font-medium text-blue-600">{po.poNumber}</td>
                          <td className="p-2.5">
                            <div className="font-medium text-slate-900">{po.materialName}</div>
                            <div className="text-[10px] text-slate-500">{po.spec}</div>
                          </td>
                          <td className="p-2.5 text-slate-700">{po.supplierName}</td>
                          <td className="p-2.5 font-mono font-medium text-emerald-700 tabular-nums whitespace-nowrap">
                            {po.orderedQty - po.deliveredQty} {po.unit} {tr(`(共订${po.orderedQty})`, `(of ${po.orderedQty})`)}
                          </td>
                          <td className="p-2.5 font-mono text-slate-800 tabular-nums whitespace-nowrap">
                            ¥{po.unitPriceTaxIncluded} ({po.taxRate}%)
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  className="px-4 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  {tr('取消', 'Cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => importPoItemsToAcceptance(selectedPoIds)}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium cursor-pointer tabular-nums whitespace-nowrap"
                >
                  {tr(`确认转入选中明细 (${selectedPoIds.length} 项)`, `Import Selected Lines (${selectedPoIds.length})`)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
