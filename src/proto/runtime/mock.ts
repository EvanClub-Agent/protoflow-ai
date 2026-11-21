import { previewDefaultValue } from '../database/columnDefault';
import { declaredColumnOptions, isTextColumn, tableUsesChineseContract } from '../database/enumContract';
import type { DBColumnSchema, DBTableSchema } from '../../store/useProtoStore';
import { getLocale, isEnLocale, type Locale } from '../../i18n/runtime';

export type Row = Record<string, unknown> & { id: string };

const COMPANY = ['杭州极光智能数码有限公司', '深圳星海光电科技有限公司', '苏州云图精密配件有限公司', '上海森禾环保包装制品厂', '北京远景云端软件股份', '广州新锐消费电子有限公司', '成都锦城新零售供应链集团', '南京智联物联网科技'];
const PEOPLE = ['张晓明', '李娜', '王海涛', '赵敏', '陈立', '刘洋', '周婷', '吴强'];
const MATERIAL = ['无线主动降噪耳机 Pro', '氮化镓 140W 桌面快充站', '4K 智能会议摄像头', '人体工学三模机械键盘', '便携磁吸移动电源', 'Type-C 高速扩展坞', '铝合金笔记本支架', '智能桌面氛围灯带'];
const STATUS = ['待审批', '已通过', '已驳回', '草稿'];

const COMPANY_EN = ['Aurora Smart Digital Ltd.', 'StarSea Optoelectronics Inc.', 'CloudAtlas Precision Parts Co.', 'GreenForest Eco Packaging Co.', 'Horizon Cloud Software Corp.', 'Apex Consumer Electronics Ltd.', 'Metro Retail Supply Chain Group', 'NexLink IoT Technologies'];
const PEOPLE_EN = ['Alex Morgan', 'Elena Lin', 'Marcus Wang', 'Claire Zhao', 'Liam Chen', 'Owen Liu', 'Chloe Zhou', 'Ethan Wu'];
const MATERIAL_EN = ['Wireless ANC Headphones Pro', 'GaN 140W Desktop Charger', '4K Smart Conference Camera', 'Ergonomic Tri-Mode Mechanical Keyboard', 'Magnetic Portable Power Bank', 'USB-C High-Speed Dock', 'Aluminum Laptop Stand', 'Smart Ambient Desk Light Strip'];
const STATUS_EN = ['Pending', 'Approved', 'Rejected', 'Draft'];

const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];

const ACRONYMS = new Set(['id', 'po', 'sku', 'erp', 'crm', 'wms', 'pms', 'url', 'ip', 'api', 'qty', 'no', 'vat']);

export function formatColumnIdentifierLabel(name: string): string {
  const cleaned = name.replace(/_id$/i, '').trim() || name;
  return cleaned
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (ACRONYMS.has(lower)) return lower === 'qty' ? 'Qty' : lower === 'no' ? 'No.' : lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** Choose a plausible mock value from the column name / type / comment. */
export function mockValue(col: DBColumnSchema, i: number, locale: Locale = getLocale(), table?: DBTableSchema): unknown {
  const en = isEnLocale(locale);
  const n = col.name.toLowerCase();
  const c = col.comment || '';
  const cl = c.toLowerCase();
  const type = col.dataType.toUpperCase();
  if (col.isPrimaryKey) return undefined;
  const explicitEnum = declaredColumnOptions(col);
  if (explicitEnum) {
    if (!explicitEnum.length) return undefined;
    return pick(
      explicitEnum.map((item) => item.value),
      i,
    );
  }
  if (isTextColumn(col) && (n.includes('status') || c.includes('状态') || cl.includes('status'))) {
    const useZhStatus = table ? tableUsesChineseContract(table, col) : !en;
    return pick(useZhStatus ? STATUS : STATUS_EN, i);
  }
  if (n.includes('phone') || n.includes('mobile') || c.includes('电话') || cl.includes('phone')) return `138${String(10000000 + i * 7919).slice(0, 8)}`;
  if (n.includes('email')) return `user${i + 1}@example.com`;
  if (n.includes('supplier') && n.includes('name')) return pick(en ? COMPANY_EN : COMPANY, i);
  if ((n.includes('contact') || n.includes('person') || n.includes('inspector') || n.includes('user') || n.includes('creator')) && !n.includes('id')) return pick(en ? PEOPLE_EN : PEOPLE, i);
  if (n.includes('material') && n.includes('name')) return pick(en ? MATERIAL_EN : MATERIAL, i);
  if (n.endsWith('_no') || n.endsWith('_number') || n.endsWith('_code') || n === 'code') {
    const prefix = n.split('_')[0].toUpperCase().slice(0, 3) || 'NO';
    return `${prefix}-2026${String(1001 + i)}`;
  }
  if (n.endsWith('_id')) return `${n.replace(/_id$/, '').toUpperCase().slice(0, 3)}-${String(i + 1).padStart(3, '0')}`;
  if (type.startsWith('DATE') || type.startsWith('TIMESTAMP') || n.endsWith('_at') || n.endsWith('_date')) {
    const d = new Date(2026, 9, 28 - i * 2);
    return type === 'DATE' || n.endsWith('_date') ? d.toISOString().slice(0, 10) : `${d.toISOString().slice(0, 10)} ${String(9 + (i % 8)).padStart(2, '0')}:30`;
  }
  if (/^(?:DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL)\b/.test(type) || n.includes('amount') || n.includes('price') || c.includes('金额') || c.includes('单价')) {
    return Number((120 + i * 87.35).toFixed(2));
  }
  if (/^(?:(?:TINY|SMALL|MEDIUM|BIG)?INT|INTEGER)\b/.test(type) || n.includes('qty') || n.includes('count')) {
    return n.includes('rate') ? 13 : (i * 3 + 2) % 20 + 1;
  }
  if (type.startsWith('BOOL') || type === 'TINYINT(1)') return i % 2 === 0;
  if (n.includes('name') || c.includes('名称') || cl.includes('name')) {
    if (en) {
      const cleanComment = c.replace(/\s*\(.*?\)\s*/g, '').replace(/（.*?）/g, '').replace(/\bname\b/gi, '').trim();
      const base = (cleanComment && !/[\u4e00-\u9fff]/.test(cleanComment) ? cleanComment : formatColumnIdentifierLabel(col.name.replace(/_?name$/i, '') || 'Record')).slice(0, 18) || 'Record';
      return `${base} ${String.fromCharCode(65 + (i % 26))}${i + 1}`;
    }
    const base = (c.replace(/名称|\(.*\)/g, '').trim() || '记录').slice(0, 6);
    return `${base}${String.fromCharCode(65 + (i % 26))}${i + 1}`;
  }
  if (n.includes('remark') || n.includes('desc') || c.includes('备注') || cl.includes('remark') || cl.includes('note')) {
    return i % 3 === 0 ? '' : en ? 'On track' : '按计划执行';
  }
  if (en) {
    const fallbackBase = c && !/[\u4e00-\u9fff]/.test(c)
      ? c.replace(/\(.*\)/, '').trim().slice(0, 14)
      : formatColumnIdentifierLabel(col.name).slice(0, 14);
    return `${fallbackBase || 'Record'} ${i + 1}`;
  }
  return `${(c || col.name).replace(/\(.*\)/, '').slice(0, 6)}${i + 1}`;
}

export function generateMockRows(table: DBTableSchema, count = 8, locale: Locale = getLocale()): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const row: Row = { id: `${table.id}-${String(i + 1).padStart(3, '0')}` };
    for (const col of table.columns) {
      if (col.isPrimaryKey) continue;
      row[col.name] = mockValue(col, i, locale, table);
    }
    return row;
  });
}

/** The original deterministic generator is kept for recognizing old, untouched samples.
 * Current scenarios take declared defaults ahead of name-based display examples, while
 * preserving declared multi-state enums so status tabs all receive sample rows. */
export function generatePreviewRows(table: DBTableSchema, locale: Locale = getLocale()): Row[] {
  const rows = generateMockRows(table, 8, locale);
  const exampleTime = new Date('2026-01-01T00:00:00Z');
  for (const col of table.columns) {
    if (!col.defaultValue?.trim() || col.isPrimaryKey || col.isForeignKey || col.references) continue;
    const explicitEnum = declaredColumnOptions(col);
    if (explicitEnum) {
      const value = previewDefaultValue(col, exampleTime);
      if (value === undefined && !col.nullable) return [];
      if (explicitEnum.some(option => option.value === value) && rows.length > 0 && !rows.some((r) => r[col.name] === value)) {
        rows[0][col.name] = value;
      }
      continue;
    }
    const value = previewDefaultValue(col, exampleTime);
    if (value === undefined && !col.nullable) return [];
    for (const row of rows) {
      if (value === undefined) delete row[col.name];
      else row[col.name] = value;
    }
  }
  return rows;
}

/** Columns that are shown by default for an auto-generated table. */
export function defaultDisplayColumns(table: DBTableSchema, max = 6): DBColumnSchema[] {
  const candidates = table.columns.filter(
    (c) => !c.isPrimaryKey && !/^(created_at|updated_at|deleted|is_deleted|version)$/i.test(c.name)
  );
  const withoutParentFk = candidates.filter(
    (c) => !/^(acceptance_order_id|parent_id|order_id)$/i.test(c.name)
  );
  const list = withoutParentFk.length >= 4 ? withoutParentFk : candidates;
  return list.slice(0, max);
}

export function columnLabel(col: DBColumnSchema, locale: Locale = getLocale()): string {
  if (isEnLocale(locale) && !col.comment?.trim()) {
    return formatColumnIdentifierLabel(col.name);
  }
  let raw = (col.comment || col.name)
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/（.*?）/g, '')
    .split(/\s*(?:—|--|＝|=|:|：)\s*/)[0]
    .trim();

  raw = raw
    .replace(/^外键关联/, '')
    .replace(/^所属/, '')
    .replace(/^FK\s+(?:to\s+)?/i, '')
    .replace(/主表\s*ID$/i, '单号')
    .replace(/明细行\s*ID$/i, '')
    .replace(/\s*ID$/i, '')
    .trim();

  return raw || (isEnLocale(locale) ? formatColumnIdentifierLabel(col.name) : col.name);
}
