import type { DBTableSchema } from '../../store/useProtoStore';
import type { PageTemplateKind } from './templates';
import { tr } from '../../i18n/runtime';

export interface CreatePageIntent {
  title: string;
  template: PageTemplateKind;
  tableId: string;
  tableMatched: boolean;
  folderId: string;
  /** Remaining instruction after the page clause, e.g. "并增加批量导入弹框" */
  extraInstruction: string;
}

/** Prompts that regenerate the CURRENT page instead of creating a new one */
const REGENERATE_CURRENT = /^(重生成|生成整页|重构整页|生成标准列表页|生成主子表|(?:regenerate|rebuild|recreate)\s+(?:the\s+)?(?:current|whole|entire|this|standard)?\s*(?:page|screen|view|list|master[-\s]detail)\b)/i;

const CREATE_PAGE_RE =
  /(?:创建|新建|新增|生成|做|建|搭建|设计|加)(?:一个|一张|个|一下|一页)?\s*[「“"]?(.+?)[」”"]?\s*(?:的)?(?:页面|页|菜单|模块)/;

/** "新建一个客户管理列表 / 做一个合同台账" — strong create verbs + list-like nouns also mean a new page */
const CREATE_LIST_PAGE_RE =
  /(?:创建|新建|搭建|做|设计)(?:一个|一张|个|一下)?\s*[「“"]?(.+?(?:管理|台账|列表|清单|档案|中心))[」”"]?(?=$|[，,。；;\s]|并|然后|同时)/;

/** English create-page intent: e.g. "create a Supplier Return page", "build an Order Approval form", "design a Sales Analytics dashboard" */
const CREATE_PAGE_EN_RE =
  /(?:(?:please\s+|help\s+(?:me\s+)?)?(?:create|add|build|design|make|generate)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:new\s+)?|^new\s+)["'“”「]?([A-Za-z0-9][A-Za-z0-9\s/&_-]{0,60}?)["'“”」]?\s+(page|screen|view|menu|module|list|form|dashboard|ledger|directory|overview)(?:\s+(?:page|screen|view))?(?=$|[\s,.;:]|\s+(?:and|with|then|including)\b)/i;

function titleCaseEnglish(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Recognise natural-language requests such as
 *  「帮我创建一个采购退货单管理页面」「新建供应商绩效考评页，并增加批量导入弹框」
 *  or "Create a Purchase Return Management page and add a batch import modal"
 * Returns null when the prompt is not a "create a new page" intent.
 */
export function parseCreatePageIntent(
  prompt: string,
  dbTables: DBTableSchema[]
): CreatePageIntent | null {
  const p = prompt.trim();
  if (!p || REGENERATE_CURRENT.test(p)) return null;
  // Overlays are sub-canvases of the current page, never new pages
  if (/(弹框|弹窗|抽屉|\bmodal\b|\bdrawer\b|\bdialog\b)/i.test(p.split(/[，,。；;]|\b(?:and|with|then|including)\b/i)[0])) return null;

  const zhMatch = p.match(CREATE_PAGE_RE) ?? p.match(CREATE_LIST_PAGE_RE);
  const enMatch = zhMatch ? null : p.match(CREATE_PAGE_EN_RE);
  const m = zhMatch ?? enMatch;
  if (!m || m.index === undefined) return null;

  let title: string;
  let enKindHint = '';
  if (enMatch) {
    const rawSubject = enMatch[1]
      .replace(/^(?:a|an|the|new)\s+/i, '')
      .trim();
    const kindWord = (enMatch[2] || '').toLowerCase();
    enKindHint = kindWord;
    if (!rawSubject || /^(?:whole|entire|current)$/i.test(rawSubject)) return null;
    if (/^(?:blank|empty)$/i.test(rawSubject)) {
      title = tr('新建空白页', 'Blank Page');
    } else {
      const formattedSubject = titleCaseEnglish(rawSubject);
      const keepSuffix = /^(?:list|form|dashboard|ledger|directory|overview)$/i.test(kindWord) &&
        !new RegExp(`\\b${kindWord}$`, 'i').test(formattedSubject);
      title = keepSuffix ? `${formattedSubject} ${titleCaseEnglish(kindWord)}` : formattedSubject;
    }
  } else {
    title = m[1]
      .replace(/^(帮我|请|给我|麻烦)/, '')
      .replace(/^(一个|一张|个)/, '')
      .trim();
    if (!title || title.length < 2 || /^(整|新|空白)$/.test(title)) {
      if (!/空白/.test(p)) return null;
      title = '新建空白页';
    }
  }

  const remainder = p
    .slice(m.index + m[0].length)
    .replace(/^[\s，,。；;、]+/, '')
    .replace(/^(并且|并|然后|再|同时|里面|其中|(?:and|then|also|plus)\s+)/i, '')
    .trim();

  const all = `${title} ${enKindHint} ${remainder}`;

  let template: PageTemplateKind = 'list';
  if (/空白|\b(?:blank|empty)\b/i.test(all)) template = 'blank';
  else if (/(主子表|复合单据|明细|单据头|\bmaster[-\s]?detail\b|\bline\s+items?\b|\bheader[-\s]?detail\b)/i.test(all)) template = 'master_detail';
  else if (/(详情|看板|概览|档案|\bdetail\b|\bdashboard\b|\boverview\b|\bprofile\b)/i.test(all)) template = 'detail';
  else if (
    /(表单|填写|申请|录入|登记|\bform\b|\bapply\b|\bapplication\b|\bentry\b|\bregistration\b)/i.test(all) &&
    !/(列表|管理|台账|查询|\blist\b|\bledger\b|\bdirectory\b)/i.test(all)
  )
    template = 'form';

  const allLower = all.toLowerCase();
  const findBy = (kw: RegExp, id: string) =>
    kw.test(all) ? dbTables.find((t) => t.id === id) : undefined;
  const direct = dbTables.find((t) => {
    const cleanCn = t.cnName.replace(/\s*\(.*?\)\s*/g, '').replace(/(主数据表|主表|明细表|表)$/, '').trim();
    const shortTable = t.tableName.replace(/^t_(?:[a-z]+_)?/i, '').replace(/_/g, ' ').toLowerCase();
    return (
      allLower.includes(t.tableName.toLowerCase()) ||
      (cleanCn.length >= 2 && allLower.includes(cleanCn.toLowerCase())) ||
      (shortTable.length >= 4 && allLower.includes(shortTable))
    );
  });
  const matched =
    direct ??
    findBy(/供应商|供方|\bsuppliers?\b|\bvendors?\b/i, 't_base_supplier') ??
    findBy(/物料|商品|货品|\bmaterials?\b|\bproducts?\b|\bitems?\b|\bskus?\b/i, 't_base_material') ??
    findBy(/验收|入库|到货|\bacceptance\b|\breceiving\b|\binbound\b|\breceipts?\b|\binspection\b/i, 't_wms_acceptance_order') ??
    findBy(/采购|订单|\bpurchase\b|\bprocurement\b|\borders?\b|\bpo\b/i, 't_pms_po_item');

  let folderId = 'folder-base-data';
  if (/(计划|年度|配额|\bplan\b|\bannual\b|\bquota\b|\bbudget\b)/i.test(all)) folderId = 'folder-plan';
  else if (/(采购|招标|订单|退货|\bpurchase\b|\bprocurement\b|\btender\b|\borders?\b|\breturns?\b)/i.test(all)) folderId = 'folder-procurement';
  else if (/(验收|入库|出库|仓|到货|\bacceptance\b|\breceiving\b|\binbound\b|\boutbound\b|\bwarehouse\b)/i.test(all)) folderId = 'folder-acceptance';

  return {
    title,
    template,
    tableId: (matched ?? dbTables[0])?.id ?? 't_base_supplier',
    tableMatched: Boolean(matched),
    folderId,
    extraInstruction: remainder.length >= 3 ? remainder : '',
  };
}
