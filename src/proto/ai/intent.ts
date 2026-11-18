import type { DBTableSchema } from '../../store/useProtoStore';
import type { PageTemplateKind } from './templates';

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
const REGENERATE_CURRENT = /^(重生成|生成整页|重构整页|生成标准列表页|生成主子表)/;

const CREATE_PAGE_RE =
  /(?:创建|新建|新增|生成|做|建|搭建|设计|加)(?:一个|一张|个|一下|一页)?\s*[「“"]?(.+?)[」”"]?\s*(?:的)?(?:页面|页|菜单|模块)/;

/** "新建一个客户管理列表 / 做一个合同台账" — strong create verbs + list-like nouns also mean a new page */
const CREATE_LIST_PAGE_RE =
  /(?:创建|新建|搭建|做|设计)(?:一个|一张|个|一下)?\s*[「“"]?(.+?(?:管理|台账|列表|清单|档案|中心))[」”"]?(?=$|[，,。；;\s]|并|然后|同时)/;

/**
 * Recognise natural-language requests such as
 *  「帮我创建一个采购退货单管理页面」「新建供应商绩效考评页，并增加批量导入弹框」
 * Returns null when the prompt is not a "create a new page" intent.
 */
export function parseCreatePageIntent(
  prompt: string,
  dbTables: DBTableSchema[]
): CreatePageIntent | null {
  const p = prompt.trim();
  if (!p || REGENERATE_CURRENT.test(p)) return null;
  // Overlays are sub-canvases of the current page, never new pages
  if (/(弹框|弹窗|抽屉|Modal|Drawer)/i.test(p.split(/[，,。；;]/)[0])) return null;

  const m = p.match(CREATE_PAGE_RE) ?? p.match(CREATE_LIST_PAGE_RE);
  if (!m || m.index === undefined) return null;

  let title = m[1]
    .replace(/^(帮我|请|给我|麻烦)/, '')
    .replace(/^(一个|一张|个)/, '')
    .trim();
  if (!title || title.length < 2 || /^(整|新|空白)$/.test(title)) {
    if (!/空白/.test(p)) return null;
    title = '新建空白页';
  }

  const remainder = p
    .slice(m.index + m[0].length)
    .replace(/^[\s，,。；;、]+/, '')
    .replace(/^(并且|并|然后|再|同时|里面|其中)/, '')
    .trim();

  const all = `${title} ${remainder}`;

  let template: PageTemplateKind = 'list';
  if (/空白/.test(all)) template = 'blank';
  else if (/(主子表|复合单据|明细|单据头)/.test(all)) template = 'master_detail';
  else if (/(详情|看板|概览|档案)/.test(all)) template = 'detail';
  else if (/(表单|填写|申请|录入|登记)/.test(all) && !/(列表|管理|台账|查询)/.test(all))
    template = 'form';

  const findBy = (kw: RegExp, id: string) =>
    kw.test(all) ? dbTables.find((t) => t.id === id) : undefined;
  const direct = dbTables.find(
    (t) =>
      all.includes(t.tableName) ||
      all.includes(t.cnName.replace(/\s*\(.*?\)\s*/g, '').replace(/(主数据表|主表|明细表|表)$/, ''))
  );
  const matched =
    direct ??
    findBy(/供应商|供方/, 't_base_supplier') ??
    findBy(/物料|商品|货品/, 't_base_material') ??
    findBy(/验收|入库|到货/, 't_wms_acceptance_order') ??
    findBy(/采购|订单/, 't_pms_po_item');

  let folderId = 'folder-base-data';
  if (/(计划|年度|配额)/.test(all)) folderId = 'folder-plan';
  else if (/(采购|招标|订单|退货)/.test(all)) folderId = 'folder-procurement';
  else if (/(验收|入库|出库|仓|到货)/.test(all)) folderId = 'folder-acceptance';

  return {
    title,
    template,
    tableId: (matched ?? dbTables[0])?.id ?? 't_base_supplier',
    tableMatched: Boolean(matched),
    folderId,
    extraInstruction: remainder.length >= 3 ? remainder : '',
  };
}
