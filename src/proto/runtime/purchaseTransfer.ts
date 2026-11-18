import type { DBTableSchema } from '../../store/useProtoStore';
import type { Row } from './mock';
import { newId } from '../../utils/identity';

/** Shared by runtime execution and project analysis; table IDs are never physical-name fallbacks. */
export function purchaseTransferContractError(tables: DBTableSchema[], sourceTableId: string, targetTableId: string): string | null {
  if (sourceTableId !== 't_pms_po_item' || targetTableId !== 't_wms_acceptance_detail') {
    return '采购转入动作仅支持采购明细到验收明细的明确映射';
  }
  const target = tables.find(t => t.id === targetTableId);
  if (!target || !tables.some(t => t.id === sourceTableId) ||
      !tables.some(t => t.id === 't_wms_acceptance_order') ||
      target.columns.find(c => c.name === 'source_po_item_id')?.references !== 't_pms_po_item(id)' ||
      target.columns.find(c => c.name === 'acceptance_order_id')?.references !== 't_wms_acceptance_order(id)') {
    return '采购转入所需的表或外键契约不完整';
  }
  return null;
}

/** Explicit mapping for the built-in purchase -> acceptance contract (not arbitrary tables). */
export function mapPurchaseOrderLines(source: Row[], existing: Row[], selectedIds: string[], acceptanceOrderId: string): Row[] {
  if (!acceptanceOrderId) throw new Error('请先保存验收单表头');
  if (selectedIds.length === 0) throw new Error('请先勾选采购明细');
  const selected = [...new Set(selectedIds)].map(id => {
    const row = source.find(r => r.id === id);
    if (!row) throw new Error(`采购明细不存在：${id}`);
    return row;
  });
  const prior = new Set(existing.filter(r => r.acceptance_order_id === acceptanceOrderId).map(r => r.source_po_item_id));
  return selected.filter(row => !prior.has(row.id)).map(row => {
    const number = (key: string) => {
      const value = row[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`采购明细 ${row.id} 的 ${key} 无效`);
      return value;
    };
    if (row.status !== 'confirmed') throw new Error(`采购明细 ${row.id} 尚未确认或已完成`);
    if (typeof row.material_code !== 'string' || !row.material_code) throw new Error(`采购明细 ${row.id} 缺少 material_code`);
    const qty = number('ordered_qty') - number('delivered_qty');
    if (qty <= 0) throw new Error(`采购明细 ${row.id} 已无可验收数量`);
    const price = number('unit_price_tax_included');
    const rate = number('tax_rate');
    const noTaxPrice = price / (1 + rate / 100);
    return {
      id: newId('acceptance-line'), acceptance_order_id: acceptanceOrderId,
      source_po_item_id: row.id, material_code: row.material_code, current_accept_qty: qty,
      unit_price_tax_included: price, unit_price_no_tax: Number(noTaxPrice.toFixed(6)),
      tax_amount: Number((qty * (price - noTaxPrice)).toFixed(2)),
      ...(typeof row.project_code === 'string' ? { project_code: row.project_code } : {}),
    };
  });
}
