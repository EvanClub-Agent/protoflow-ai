import { parsePageSource } from '../dsl/parser';
import { readPageHeader } from '../dsl/header';
import { printPageSource } from '../dsl/printer';
import { findNode, findParent, replaceNode, walk } from '../dsl/tree';
import { isActionChain, isNode, type ActionCall, type ProtoDoc, type ProtoNode, type PropValue } from '../types';
import type { DBTableSchema } from '../../store/useProtoStore';
import type { SitemapLayout } from '../sitemap';
import { COMPONENT_MAP } from '../registry/meta';
import { appearanceSpecs, frameSpecs, positionedNativeTypes } from './metadata';
import { axureCatalog, axureScopePages, axureSourcePagePattern, axureCopyId, verifiedAxureSourceId, type AxureScope } from './task';

export function importedDoc(pageId: string, source: string) {
  const guid = axureSourcePagePattern.exec(pageId)?.[1];
  const parsed = parsePageSource(source, { strict: true });
  if (!guid || !parsed.doc || parsed.issues.length || parsed.normalized ||
      !parsed.doc.root.children.some(c => isNode(c) && c.type === 'AxureCanvas' && c.pfId === 'rp-canvas-' + guid))
    throw new Error('指定页面缺少可核对的 RP 导入画布');
  return parsed.doc;
}

export function optimizedDoc(copyId: string, source: string) {
  const parsed = parsePageSource(source, {strict:true});
  if (!parsed.doc || parsed.issues.length || parsed.normalized || !verifiedAxureSourceId(copyId,parsed.doc.header))
    throw new Error('优化版来源不一致：' + copyId);
  return parsed.doc;
}

function frame(n: ProtoNode): ProtoNode['props'] {
  const f = n.props.layoutFrame;
  return f && typeof f === 'object' && !Array.isArray(f) ? f as ProtoNode['props'] : n.props;
}
const short = (v: PropValue | undefined) => typeof v === 'string' && v.length > 160 ? v.slice(0,159) + '…' : v;
export function caption(n: ProtoNode) {
  if (typeof n.props.text === 'string') return n.props.text;
  return n.children.flatMap(c => isNode(c) ? [] : [c.value]).join(' ');
}

export interface StaticTableActionVariant {
  label: string;
  onClick: ActionCall[];
  rowCount: number;
  rows: number[];
}

export interface StaticTableColumnActionSummary {
  col: number;
  headerPfId: string;
  headerText: string;
  cellPfIds: string[];
  dataRowCount: number;
  populatedDataRowCount: number;
  rowsWithClick: number;
  consistentAcrossDataRows: boolean;
  requiresConfirmation: boolean;
  variants: StaticTableActionVariant[];
  unlinkedTexts: string[];
}

const RISKY_SINGLE_SAMPLE_LABEL = /删除|移除|作废|冲红|驳回|退回|审核|审批/;
const FORM_CONTROL_TYPES = new Set(['Input','Textarea','Select','NumberInput','DatePicker','Checkbox','Radio','ListSelect','ListBox','CheckControl','RadioControl']);

export function analyzeStaticTableActions(node: ProtoNode): StaticTableColumnActionSummary[] {
  if (node.type !== 'StaticTable' || !Array.isArray(node.props.columnWidths) || !Array.isArray(node.props.rowHeights)) {
    return [];
  }
  const cols = node.props.columnWidths.length;
  const rows = node.props.rowHeights.length;
  const kids = node.children.filter(isNode);
  if (cols <= 0 || rows <= 1 || kids.length < cols * rows) return [];

  const populatedDataRows: number[] = [];
  for (let r = 1; r < rows; r++) {
    let hasContent = false;
    for (let c = 0; c < cols; c++) {
      const cell = kids[r * cols + c];
      if (caption(cell).trim() !== '' || isActionChain(cell.props.onClick)) {
        hasContent = true;
        break;
      }
    }
    if (hasContent) populatedDataRows.push(r);
  }

  const out: StaticTableColumnActionSummary[] = [];
  for (let col = 0; col < cols; col++) {
    const header = kids[col];
    const headerText = caption(header).trim();
    const variantMap = new Map<string, StaticTableActionVariant>();
    const unlinkedSet = new Set<string>();
    const cellPfIds: string[] = [];

    for (const r of populatedDataRows) {
      const cell = kids[r * cols + col];
      const txt = caption(cell).trim();
      if (isActionChain(cell.props.onClick)) {
        cellPfIds.push(cell.pfId);
        const key = JSON.stringify([txt, cell.props.onClick.calls]);
        const existing = variantMap.get(key);
        if (existing) {
          existing.rowCount += 1;
          if (existing.rows.length < 12) existing.rows.push(r);
        } else {
          variantMap.set(key, {
            label: txt,
            onClick: cell.props.onClick.calls,
            rowCount: 1,
            rows: [r],
          });
        }
      } else if (txt !== '') {
        unlinkedSet.add(txt);
      }
    }

    if (variantMap.size === 0) {
      if (/操作|动作|action/i.test(headerText) && unlinkedSet.size > 0) {
        out.push({
          col,
          headerPfId: header.pfId,
          headerText,
          cellPfIds: [],
          dataRowCount: rows - 1,
          populatedDataRowCount: populatedDataRows.length,
          rowsWithClick: 0,
          consistentAcrossDataRows: false,
          requiresConfirmation: true,
          variants: [],
          unlinkedTexts: Array.from(unlinkedSet).slice(0, 8),
        });
      }
      continue;
    }

    const variants = Array.from(variantMap.values());
    const rowsWithClick = variants.reduce((sum, v) => sum + v.rowCount, 0);
    const consistentAcrossDataRows =
      populatedDataRows.length > 0 &&
      rowsWithClick === populatedDataRows.length &&
      variants.length === 1 &&
      unlinkedSet.size === 0;
    const singleSampleRisky =
      populatedDataRows.length < 2 && variants.some(v => RISKY_SINGLE_SAMPLE_LABEL.test(v.label));

    out.push({
      col,
      headerPfId: header.pfId,
      headerText,
      cellPfIds,
      dataRowCount: rows - 1,
      populatedDataRowCount: populatedDataRows.length,
      rowsWithClick,
      consistentAcrossDataRows,
      requiresConfirmation: !consistentAcrossDataRows || singleSampleRisky,
      variants,
      unlinkedTexts: Array.from(unlinkedSet).slice(0, 8),
    });
  }
  return out;
}

function findNearbySiblingLabel(target: ProtoNode, parent: ProtoNode | undefined): { pfId: string; text: string } | undefined {
  if (!parent || !['AxureCanvas', 'PositionedGroup', 'PanelState'].includes(parent.type)) return undefined;
  const tf = frame(target);
  if (typeof tf.x !== 'number' || typeof tf.y !== 'number') return undefined;
  const th = typeof tf.height === 'number' ? tf.height : 30;
  const tMidY = tf.y + th / 2;
  let best: { pfId: string; text: string; dist: number } | undefined;
  for (const sib of parent.children.filter(isNode)) {
    if (sib.pfId === target.pfId || (sib.type !== 'Text' && sib.type !== 'VectorShape')) continue;
    if (isActionChain(sib.props.onClick)) continue;
    const rawText = caption(sib).replace(/[:：\s]+$/, '').trim();
    if (!rawText || rawText.length > 24) continue;
    const sf = frame(sib);
    if (sf.hidden === true || typeof sf.x !== 'number' || typeof sf.y !== 'number') continue;
    const sw = typeof sf.width === 'number' ? sf.width : 60;
    const sh = typeof sf.height === 'number' ? sf.height : 24;
    const sRight = sf.x + sw;
    const sMidY = sf.y + sh / 2;
    if (sRight <= tf.x + 12 && tf.x - sRight <= 140 && Math.abs(sMidY - tMidY) <= Math.max(th, sh) * 0.85) {
      const dist = Math.hypot(tf.x - sRight, sMidY - tMidY);
      if (!best || dist < best.dist) best = { pfId: sib.pfId, text: rawText, dist };
    } else if (sf.y + sh <= tf.y + 8 && tf.y - (sf.y + sh) <= 32 && Math.abs(sf.x - tf.x) <= 60) {
      const dist = Math.hypot(sf.x - tf.x, tf.y - (sf.y + sh)) + 20;
      if (!best || dist < best.dist) best = { pfId: sib.pfId, text: rawText, dist };
    }
  }
  return best ? { pfId: best.pfId, text: best.text } : undefined;
}

// Inspect the actual saved document, including imports made before the AI workflow existed.
// Table bodies can contain thousands of identical blank cells. Expand them only on request.
export function inspectAxurePage(pageId: string, source: string, selectedPfId?: string, offset = 0, limit = 30) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 60) throw new Error('offset 从 0 开始，limit 为 1 到 60 的整数');
  const copy = /^rp-optimized-([0-9a-f]{32})$/.exec(pageId);
  const sourcePageId = copy ? 'rp-page-' + copy[1] : pageId;
  const doc = copy ? optimizedDoc(pageId,source) : importedDoc(sourcePageId, source);
  const records: Record<string, unknown>[] = [];
  let total = 0, found = !selectedPfId;
  function visit(n: ProtoNode, parent: ProtoNode | undefined, hidden: boolean, inactive: boolean, selected: boolean) {
    const match = n.pfId === selectedPfId;
    if (match) found = true;
    selected ||= match;
    const f = frame(n);
    hidden ||= f.hidden === true;
    const kids = n.children.filter(isNode);
    if (selected && total++ >= offset && records.length < limit) {
      const record: Record<string, unknown> = { pfId:n.pfId, type:n.type, parentPfId:parent?.pfId, hidden, inactiveState:inactive };
      if (typeof f.label === 'string') record.label = short(f.label);
      if (FORM_CONTROL_TYPES.has(n.type) && !record.label) {
        const nearby = findNearbySiblingLabel(n, parent);
        if (nearby) record.nearbyLabel = nearby;
      }
      const text = caption(n);
      if (text) record.text = short(text);
      record.frame = Object.fromEntries(['x','y','width','height'].filter(key => typeof f[key] === 'number').map(key => [key,f[key]]));
      for (const k of ['placeholder','initialValue','table','name','checked','kind','disabled','readOnly','multiple','selectedOptions','activeState','pinX','pinY','fitContent','pinInFront']) if (n.props[k] !== undefined) record[k] = short(n.props[k]);
      for (const k of ['options','choices']) {
        const values = n.props[k];
        if (Array.isArray(values)) record[k] = {
          count: values.length,
          first: values.slice(0,12).map(option => {
            if (!option || typeof option !== 'object' || Array.isArray(option)) return short(option);
            return Object.fromEntries(Object.entries(option).filter(([key]) => ['label','value','disabled'].includes(key))
              .map(([key,value]) => [key,short(value)]));
          }),
        };
      }
      if (isActionChain(n.props.onClick)) {
        record.onClick = n.props.onClick.calls.slice(0,12);
        record.clickActionCount = n.props.onClick.calls.length;
      }
      if (n.type === 'DynamicPanel') record.states = kids.map(s => ({pfId:s.pfId,label:short(s.props.label)})).slice(0,32);
      if (n.type === 'StaticTable' && Array.isArray(n.props.columnWidths) && Array.isArray(n.props.rowHeights)) {
        const cols = n.props.columnWidths.length;
        const columnActions = analyzeStaticTableActions(n).map(({ cellPfIds: _cells, ...summary }) => summary);
        record.grid = { rows:n.props.rowHeights.length, columns:cols,
          firstRow:kids.slice(0,Math.min(cols,60)).map(c=>({pfId:c.pfId,text:short(caption(c))})),
          sampleRow:kids.slice(cols,cols+Math.min(cols,12)).map(c=>short(caption(c))),
          ...(columnActions.length ? { columnActions } : {}) };
      }
      records.push(record);
    }
    if (n.type === 'StaticTable' && selected && !selectedPfId) return;
    kids.forEach((c,i) => visit(c,n,hidden,inactive || (n.type === 'DynamicPanel' && i+1 !== (n.props.activeState ?? 1)),selected));
  }
  visit(doc.root,undefined,false,false,!selectedPfId);
  if (!found) throw new Error('当前页面没有指定的 pfId');
  return { pageId, sourcePageId, title:doc.root.props.title, importNotes:doc.root.props.description, total, offset,
    nextOffset:offset+records.length < total ? offset+records.length : null, records };
}

interface PageInfo { pageId: string; title: string; folderId: string }
interface Candidate {
  designerPages: PageInfo[];
  pageSources: Record<string, string>;
  dbTables?: DBTableSchema[];
}

function validOptimizedTargets(sources: Record<string, string>) {
  const map = new Map<string, string>();
  for (const id of Object.keys(sources)) {
    const match = /^rp-optimized-([0-9a-f]{32})$/.exec(id);
    if (!match) continue;
    const srcId = verifiedAxureSourceId(id,readPageHeader(sources[id]));
    if (srcId) map.set(srcId, id);
  }
  return map;
}

export function canonicalAxureTargetPageId(
  targetPageId: string,
  sources: Record<string, string>,
  currentCopyId?: string,
  currentSourceId?: string,
): string | null {
  if (currentCopyId && currentSourceId && targetPageId === currentCopyId) return currentSourceId;
  if (/^rp-optimized-([0-9a-f]{32})$/.test(targetPageId)) {
    if (!Object.hasOwn(sources, targetPageId)) return null;
    return verifiedAxureSourceId(targetPageId, readPageHeader(sources[targetPageId])) ?? null;
  }
  return targetPageId;
}

export function retargetOptimizedNavigations(doc: ProtoDoc, sources: Record<string, string>, currentCopyId: string, explicitEvents?: Set<string>) {
  const sourceId = verifiedAxureSourceId(currentCopyId,doc.header);
  if (!sourceId) return false;
  const targets = validOptimizedTargets(sources);
  targets.set(sourceId,currentCopyId);
  let changed = false;
  const rewriteChain = (value: unknown) => {
    if (!isActionChain(value)) return;
    for (const call of value.calls) {
      if (call.name === 'navigate' && typeof call.args[0] === 'string') {
        const nextId = targets.get(call.args[0]);
        if (nextId && nextId !== call.args[0]) {
          call.args[0] = nextId;
          changed = true;
        }
      }
    }
  };
  walk(doc.root, node => {
    for (const [key, val] of Object.entries(node.props)) {
      if (explicitEvents?.has(`${node.pfId}.${key}`)) continue;
      rewriteChain(val);
      if (Array.isArray(val) && ['rowActions', 'items', 'fields'].includes(key)) {
        for (const item of val) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            for (const subVal of Object.values(item)) rewriteChain(subVal);
          }
        }
      }
    }
  });
  return changed;
}

export function retargetOptimizedPageSource(source: string, sources: Record<string, string>, pageId: string): string | null {
  const parsed = parsePageSource(source, { strict: true });
  if (!parsed.doc || parsed.issues.length || parsed.normalized) return null;
  return retargetOptimizedNavigations(parsed.doc, sources, pageId) ? printPageSource(parsed.doc) : null;
}

export function optimizeAxureBlock(
  snapshot: Candidate,
  pageId: string,
  targetPfId: string,
  tsx: string,
  requireHeaderBindings = false,
  migratedCellPfIds?: ReadonlySet<string>,
) {
  const page = snapshot.designerPages.find(p => p.pageId === pageId);
  if (!page || !Object.hasOwn(snapshot.pageSources,pageId)) throw new Error('找不到 RP 来源页面');
  const original = importedDoc(pageId,snapshot.pageSources[pageId]);
  const copyId = axureCopyId(pageId);
  const copy = snapshot.designerPages.find(p => p.pageId === copyId);
  const marker = '// @alex-axure-source ' + pageId;
  let doc: ProtoDoc;
  if (copy || Object.hasOwn(snapshot.pageSources,copyId)) {
    if (!copy || !Object.hasOwn(snapshot.pageSources,copyId))
      throw new Error('优化版页面标识已占用或来源不一致');
    doc = optimizedDoc(copyId,snapshot.pageSources[copyId]);
  } else {
    doc = original;
    doc.header = [...doc.header,marker];
    doc.root.props.title = page.title + '（优化版）';
  }
  const target = findNode(doc.root,targetPfId), parent = findParent(doc.root,targetPfId)?.parent;
  const originalTarget = findNode(original.root,targetPfId);
  if (!target || !originalTarget || !parent || !['AxureCanvas','PositionedGroup','PanelState'].includes(parent.type))
    throw new Error('请选择源页面中可独立定位的控件或分组');
  const parsed = parsePageSource('export default function Page(){return <Page pfId="__fragment__">' + tsx + '</Page>}',{strict:true});
  const children = parsed.doc?.root.children;
  if (!parsed.doc || parsed.normalized || parsed.issues.length || children?.length !== 1 || !isNode(children[0]) ||
      children[0].pfId !== targetPfId || !positionedNativeTypes.has(children[0].type))
    throw new Error('优化区块须提供一个支持定位的 Alex 标准物料，保留目标 pfId，子节点提供唯一 pfId');
  const next = children[0];
  if (requireHeaderBindings && originalTarget.type === 'StaticTable' && next.type === 'Table')
    throw new Error('请用 protoflow_bind_axure_table 根据原表头逐列绑定数据表');
  const sourceFrame = frame(target);
  const transferable = [...frameSpecs, ...appearanceSpecs].map(s=>s.name);
  const requestedFrame = next.props.layoutFrame;
  const literalContent = Boolean(requestedFrame && typeof requestedFrame === 'object' &&
    'literalContent' in requestedFrame && requestedFrame.literalContent === true);
  next.props.layoutFrame = {
    ...Object.fromEntries(transferable.filter(k => sourceFrame[k] !== undefined).map(k => [k,sourceFrame[k]])),
    literalContent,
  };
  if (target.props.disabled === true) next.props.disabled = true;
  // A visual group can own interactive cells or buttons. Losing those events while
  // replacing their parent would make a contract-valid page behave differently.
  const replacements = new Map<string,ProtoNode>();
  const explicitEvents = new Set<string>();
  walk(next, node => {
    replacements.set(node.pfId,node);
    for (const [key, val] of Object.entries(node.props)) {
      if (isActionChain(val)) explicitEvents.add(`${node.pfId}.${key}`);
    }
  });
  walk(target, oldNode => {
    if (oldNode.type === 'DynamicPanel' && replacements.get(oldNode.pfId)?.type !== 'DynamicPanel')
      throw new Error(`动态面板 ${oldNode.pfId} 含有独立状态，请分别优化各状态中的控件`);
    for (const [key,value] of Object.entries(oldNode.props)) {
      if (!isActionChain(value)) continue;
      if (key === 'onClick' && migratedCellPfIds?.has(oldNode.pfId)) continue;
      const replacement = replacements.get(oldNode.pfId);
      if (!replacement || !COMPONENT_MAP[replacement.type]?.events?.some(e => e.name === key))
        throw new Error(`区块包含需要保留的交互 ${oldNode.pfId}.${key}，请保留对应控件或选择更小的区块`);
      if (replacement.props[key] === undefined) replacement.props[key] = value;
    }
  });
  const replaced = replaceNode(doc,targetPfId,next);
  retargetOptimizedNavigations(replaced, snapshot.pageSources, copyId, explicitEvents);
  return { pageId:copyId, title:copy ? copy.title : String(doc.root.props.title), folderId:copy ? copy.folderId : page.folderId,
    source:printPageSource(replaced) };
}

export type RpReshapeColumnMapping =
  | { headerPfId: string; role: 'field'; columnId: string }
  | { headerPfId: string; role: 'index' | 'checkbox' | 'radio' | 'actions' }
  | { headerPfId: string; role: 'pending'; reason?: string };

export interface RpConvertedItem {
  sourcePfIds: string[];
  targetPfId: string;
  summary: string;
  tableId?: string;
  columnMappings?: RpReshapeColumnMapping[];
}

export interface RpRetainedItem {
  sourcePfIds: string[];
  summary: string;
}

export interface RpPendingItem {
  sourcePfIds?: string[];
  reason: string;
}

export interface RpReshapeCoverage {
  converted: RpConvertedItem[];
  retained: RpRetainedItem[];
  pending: RpPendingItem[];
}

const POSITION_AND_APPEARANCE_PROPS = new Set([
  'layoutFrame',
  'x',
  'y',
  'width',
  'height',
  'pinX',
  'pinY',
  'pinMarginX',
  'pinMarginY',
  'pinInFront',
  'fitContent',
  'clip',
  'hidden',
  'disabled',
  ...appearanceSpecs.map(s => s.name),
]);

export function normBindingLabel(raw: string): string {
  return raw.trim().replace(/[:：*＊\s]+$/g, '').toLowerCase();
}

export function assertNonInvertedFieldBinding(
  db: DBTableSchema,
  boundCol: DBTableSchema['columns'][number],
  rawLabel: string,
  ctxLabel: string,
  siblingHeaders?: readonly string[],
) {
  const hNorm = normBindingLabel(rawLabel);
  if (!hNorm) return;
  const boundNameNorm = normBindingLabel(boundCol.name);
  const boundCommentNorm = typeof boundCol.comment === 'string' ? normBindingLabel(boundCol.comment) : '';
  if (boundNameNorm === hNorm || (boundCommentNorm !== '' && boundCommentNorm === hNorm)) {
    return;
  }
  const exactOwner = db.columns.find(
    c =>
      c.id !== boundCol.id &&
      !c.isPrimaryKey &&
      (normBindingLabel(c.name) === hNorm ||
        (typeof c.comment === 'string' && normBindingLabel(c.comment) !== '' && normBindingLabel(c.comment) === hNorm)),
  );
  if (exactOwner) {
    throw new Error(
      `${ctxLabel}「${rawLabel.trim()}」被绑定到字段 ${db.tableName}.${boundCol.name}（${boundCol.comment || boundCol.id}），但表 ${db.tableName} 中存在同名/同义字段 ${exactOwner.name}（${exactOwner.comment || exactOwner.id}），字段绑定颠倒；请核对映射关系，字段归属不明时列为待确认`,
    );
  }
  if (siblingHeaders?.length) {
    const otherHeader = siblingHeaders.find(other => {
      const oNorm = normBindingLabel(other);
      if (!oNorm || oNorm === hNorm) return false;
      return oNorm === boundNameNorm || (boundCommentNorm !== '' && oNorm === boundCommentNorm);
    });
    if (otherHeader) {
      throw new Error(
        `${ctxLabel}「${rawLabel.trim()}」被绑定到字段 ${db.tableName}.${boundCol.name}（${boundCol.comment || boundCol.id}），而该字段与同组另一列/标签「${otherHeader.trim()}」一致，字段绑定颠倒；请核对映射关系`,
      );
    }
  }
}

function areActionCallsEquivalent(
  aCalls: readonly ActionCall[],
  bCalls: readonly ActionCall[],
  canonicalPageOf: (pageId: string) => string | null,
): boolean {
  if (aCalls.length !== bCalls.length) return false;
  for (let i = 0; i < aCalls.length; i++) {
    const a = aCalls[i];
    const b = bCalls[i];
    if (a.name !== b.name || a.args.length !== b.args.length) return false;
    if (a.name === 'navigate' && typeof a.args[0] === 'string' && typeof b.args[0] === 'string') {
      const ca = canonicalPageOf(a.args[0]);
      const cb = canonicalPageOf(b.args[0]);
      if (!ca || !cb || ca !== cb) return false;
      if (JSON.stringify(a.args.slice(1)) !== JSON.stringify(b.args.slice(1))) return false;
    } else if (JSON.stringify(a.args) !== JSON.stringify(b.args)) {
      return false;
    }
  }
  return true;
}

export function areRowActionsEquivalent(
  actual: unknown,
  expected: readonly ProtoNode['props'][],
  sources: Record<string, string>,
  currentCopyId: string,
): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const srcId = /^rp-optimized-([0-9a-f]{32})$/.exec(currentCopyId)
    ? 'rp-page-' + currentCopyId.slice('rp-optimized-'.length)
    : undefined;
  const canonicalPageOf = (id: string) => canonicalAxureTargetPageId(id, sources, currentCopyId, srcId);
  for (let i = 0; i < expected.length; i++) {
    const act = actual[i];
    const exp = expected[i];
    if (!act || typeof act !== 'object' || Array.isArray(act)) return false;
    const actObj = act as Record<string, unknown>;
    if ((actObj.label ?? '') !== (exp.label ?? '')) return false;
    if (Boolean(actObj.danger) !== Boolean(exp.danger)) return false;
    if (!isActionChain(actObj.onClick) || !isActionChain(exp.onClick)) return false;
    if (!areActionCallsEquivalent(actObj.onClick.calls, exp.onClick.calls, canonicalPageOf)) return false;
  }
  return true;
}

function verifyRetainedSubtree(
  orig: ProtoNode,
  next: ProtoNode,
  canonicalPageOf: (pageId: string) => string | null,
  rootRetainedPfId: string,
) {
  if (orig.pfId !== next.pfId) {
    throw new Error(
      `coverage.retained 声明保留的区块「${rootRetainedPfId}」内部节点顺序或 pfId 已改变（期望 ${orig.pfId}，实际 ${next.pfId}）；若结构已调整请改列为 coverage.converted 或 coverage.pending`,
    );
  }
  if (orig.type !== next.type) {
    throw new Error(
      `coverage.retained 声明保留的区块「${rootRetainedPfId}」中，节点 ${orig.pfId} 的物料类型已从 ${orig.type} 变为 ${next.type}；发生语义或物料变化的区块须列为 coverage.converted 或 coverage.pending，不能声明为保留`,
    );
  }
  if (Boolean(frame(orig).hidden) !== Boolean(frame(next).hidden)) {
    throw new Error(
      `coverage.retained 声明保留的区块「${rootRetainedPfId}」中，节点 ${orig.pfId} 的初始显隐状态（hidden）已改变`,
    );
  }
  if (Boolean(orig.props.disabled) !== Boolean(next.props.disabled)) {
    throw new Error(
      `coverage.retained 声明保留的区块「${rootRetainedPfId}」中，节点 ${orig.pfId} 的禁用状态（disabled）已改变`,
    );
  }

  const propKeys = new Set([...Object.keys(orig.props), ...Object.keys(next.props)]);
  for (const key of propKeys) {
    const ov = orig.props[key];
    const nv = next.props[key];
    if (isActionChain(ov) || isActionChain(nv)) {
      if (!isActionChain(ov) || !isActionChain(nv) || !areActionCallsEquivalent(ov.calls, nv.calls, canonicalPageOf)) {
        throw new Error(
          `coverage.retained 声明保留的区块「${rootRetainedPfId}」中，节点 ${orig.pfId} 的交互事件 ${key} 已改变或丢失`,
        );
      }
      continue;
    }
    if (POSITION_AND_APPEARANCE_PROPS.has(key)) continue;
    if (key === 'label' && orig.type !== 'PanelState') {
      if (ov !== undefined && nv !== undefined && ov !== nv) {
        throw new Error(
          `coverage.retained 声明保留的区块「${rootRetainedPfId}」中，节点 ${orig.pfId} 的标签属性 label 已从「${String(ov)}」改为「${String(nv)}」`,
        );
      }
      continue;
    }
    if (key === 'activeState' && orig.type === 'DynamicPanel') {
      if ((ov ?? 1) !== (nv ?? 1)) {
        throw new Error(
          `coverage.retained 声明保留的区块「${rootRetainedPfId}」中，动态面板 ${orig.pfId} 的默认状态 activeState 已改变`,
        );
      }
      continue;
    }
    if (JSON.stringify(ov) !== JSON.stringify(nv)) {
      throw new Error(
        `coverage.retained 声明保留的区块「${rootRetainedPfId}」中，节点 ${orig.pfId}(${orig.type}) 的语义属性 ${key} 已改变或丢失；发生变化的区块不能声明为保留`,
      );
    }
  }

  const origInlineText = orig.children.flatMap(c => (isNode(c) ? [] : [c.value])).join(' ').trim();
  const nextInlineText = next.children.flatMap(c => (isNode(c) ? [] : [c.value])).join(' ').trim();
  if (origInlineText !== nextInlineText || caption(orig).trim() !== caption(next).trim()) {
    throw new Error(
      `coverage.retained 声明保留的区块「${rootRetainedPfId}」中，节点 ${orig.pfId}(${orig.type}) 的文本内容已改变或丢失`,
    );
  }

  const origKids = orig.children.filter(isNode);
  const nextKids = next.children.filter(isNode);
  if (origKids.length !== nextKids.length) {
    throw new Error(
      `coverage.retained 声明保留的区块「${rootRetainedPfId}」中，节点 ${orig.pfId}(${orig.type}) 的子节点/状态数量从 ${origKids.length} 变为 ${nextKids.length}；状态或内容有删改时不能声明为保留`,
    );
  }
  for (let i = 0; i < origKids.length; i++) {
    verifyRetainedSubtree(origKids[i], nextKids[i], canonicalPageOf, rootRetainedPfId);
  }
}

function verifyMigratedRowActionCalls(
  actualChain: unknown,
  srcCalls: readonly ActionCall[],
  canonicalPageOf: (pageId: string) => string | null,
  convertedOverlayBySource: ReadonlyMap<string, { targetPfId: string; overlayAction: 'openDrawer' | 'openModal' }>,
  tblPfId: string,
  actionLabel: string,
) {
  if (!isActionChain(actualChain) || actualChain.calls.length === 0) {
    throw new Error(`表格 ${tblPfId} 的行操作「${actionLabel}」缺少有效点击动作链`);
  }
  const actualCalls = actualChain.calls;

  // Support in-page DynamicPanel popup (show / switchTab+show) converted into Drawer or Modal.
  const isShowPanelOnly =
    (srcCalls.length === 1 && srcCalls[0].name === 'show' && typeof srcCalls[0].args[0] === 'string') ||
    (srcCalls.length === 2 &&
      srcCalls[0].name === 'switchTab' &&
      srcCalls[1].name === 'show' &&
      typeof srcCalls[1].args[0] === 'string' &&
      srcCalls[0].args[0] === srcCalls[1].args[0]);
  if (isShowPanelOnly) {
    const srcPanelId = String(srcCalls[srcCalls.length - 1].args[0]);
    const convertedOverlay = convertedOverlayBySource.get(srcPanelId);
    if (
      convertedOverlay &&
      actualCalls.length === 1 &&
      actualCalls[0].name === convertedOverlay.overlayAction &&
      actualCalls[0].args.length === 1 &&
      actualCalls[0].args[0] === convertedOverlay.targetPfId
    ) {
      return;
    }
  }

  if (actualCalls.length !== srcCalls.length) {
    throw new Error(
      `表格 ${tblPfId} 的行操作「${actionLabel}」动作步骤数（${actualCalls.length}）与原表格单元格动作（${srcCalls.length}）不一致`,
    );
  }
  for (let i = 0; i < srcCalls.length; i++) {
    const sc = srcCalls[i];
    const ac = actualCalls[i];
    if (ac.name !== sc.name) {
      throw new Error(
        `表格 ${tblPfId} 的行操作「${actionLabel}」第 ${i + 1} 步动作「${ac.name}」与原单元格动作「${sc.name}」不一致`,
      );
    }
    if (sc.name === 'navigate' && typeof sc.args[0] === 'string') {
      const actualTarget = typeof ac.args[0] === 'string' ? ac.args[0] : '';
      const expectedCanonical = canonicalPageOf(sc.args[0]);
      const actualCanonical = actualTarget ? canonicalPageOf(actualTarget) : null;
      if (!expectedCanonical || !actualCanonical || actualCanonical !== expectedCanonical) {
        throw new Error(
          `表格 ${tblPfId} 的行操作「${actionLabel}」跳转目标「${actualTarget}」与原表格单元格目标「${sc.args[0]}」（或其已验证优化副本）不一致`,
        );
      }
      if (ac.args.length !== 2 || ac.args[1] !== 'row') {
        throw new Error(
          `表格 ${tblPfId} 的行操作「${actionLabel}」跨页跳转必须携带当前行参数 navigate("${actualTarget}", "row")，确保打开被点击行的对应记录`,
        );
      }
    } else if (JSON.stringify(ac.args) !== JSON.stringify(sc.args)) {
      throw new Error(
        `表格 ${tblPfId} 的行操作「${actionLabel}」第 ${i + 1} 步参数与原表格单元格动作不一致`,
      );
    }
  }
}

function normalizePfIdArray(raw: unknown, fieldLabel: string, allowEmpty = false): string[] {
  if (!Array.isArray(raw) || (!allowEmpty && raw.length === 0)) {
    throw new Error(`${fieldLabel} 必须是非空的源控件 pfId 数组`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${fieldLabel} 包含空或非字符串 pfId`);
    }
    const id = item.trim();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function parseColumnMappings(raw: unknown, ctx: string): RpReshapeColumnMapping[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${ctx}.columnMappings 必须是非空数组`);
  }
  return raw.map((entry, idx) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${ctx}.columnMappings[${idx}] 格式无效`);
    }
    const m = entry as Record<string, unknown>;
    if (typeof m.headerPfId !== 'string' || !m.headerPfId.trim()) {
      throw new Error(`${ctx}.columnMappings[${idx}].headerPfId 不能为空`);
    }
    const headerPfId = m.headerPfId.trim();
    const role = m.role;
    if (role === 'field') {
      if (typeof m.columnId !== 'string' || !m.columnId.trim()) {
        throw new Error(`${ctx}.columnMappings[${idx}]（role="field"）必须提供目标表的 columnId`);
      }
      return { headerPfId, role: 'field', columnId: m.columnId.trim() };
    }
    if (role === 'index' || role === 'checkbox' || role === 'radio' || role === 'actions') {
      if ('columnId' in m && m.columnId !== undefined) {
        throw new Error(`${ctx}.columnMappings[${idx}]（role="${role}"）为界面列，不能绑定数据库字段 columnId`);
      }
      return { headerPfId, role };
    }
    if (role === 'pending') {
      const reason = typeof m.reason === 'string' && m.reason.trim() ? m.reason.trim() : undefined;
      return { headerPfId, role: 'pending', ...(reason ? { reason } : {}) };
    }
    throw new Error(
      `${ctx}.columnMappings[${idx}].role「${String(role)}」无效；可选值为 field / index / checkbox / radio / actions / pending`,
    );
  });
}

function describeSourceNode(node: ProtoNode): string {
  const f = frame(node);
  const label = typeof f.label === 'string' && f.label.trim() ? f.label.trim() : caption(node).trim();
  const shortLabel = label ? `「${label.slice(0, 24)}」` : '';
  return `${node.pfId}(${node.type}${shortLabel})`;
}

/**
 * Controlled whole-page reshaping entry for converting an imported RP source page
 * into a clean, flow-layout Alex native <Page> copy while enforcing explicit
 * source-widget accounting (converted / retained / pending), per-column table
 * binding accuracy, retained-block semantic fidelity, and row-action safety.
 */
export function reshapeAxurePage(
  snapshot: Candidate,
  pageId: string,
  source: string,
  rawCoverage: unknown,
) {
  const page = snapshot.designerPages.find(p => p.pageId === pageId);
  if (!page || !Object.hasOwn(snapshot.pageSources, pageId)) {
    throw new Error('找不到 RP 来源页面');
  }
  const original = importedDoc(pageId, snapshot.pageSources[pageId]);
  const guid = pageId.slice('rp-page-'.length);
  const canvasPfId = 'rp-canvas-' + guid;
  const copyId = axureCopyId(pageId);
  const copy = snapshot.designerPages.find(p => p.pageId === copyId);
  if (copy || Object.hasOwn(snapshot.pageSources, copyId)) {
    if (!copy || !Object.hasOwn(snapshot.pageSources, copyId)) {
      throw new Error('优化版页面标识已占用或来源不一致');
    }
    optimizedDoc(copyId, snapshot.pageSources[copyId]);
  }

  const parsed = parsePageSource(source, { strict: true });
  if (!parsed.doc || parsed.issues.length || parsed.normalized || parsed.doc.root.type !== 'Page') {
    const issueMsg = parsed.issues.map(i => i.message).slice(0, 3).join('；');
    throw new Error(
      `重塑页面源码必须是完整且每个节点带唯一 pfId 的桌面端 <Page>（${issueMsg || '解析或 pfId 校验未通过'}）`,
    );
  }

  const doc = parsed.doc;
  if (doc.root.children.some(c => isNode(c) && c.type === 'AxureCanvas')) {
    throw new Error(
      'protoflow_reshape_axure_page 用于将 RP 页面重塑为标准流式布局 <Page>，不能继续使用顶层自由定位画布 AxureCanvas；局部原位替换请使用 protoflow_optimize_axure_block 或 protoflow_bind_axure_table',
    );
  }

  const cleanHeader = doc.header.filter(line => !line.startsWith('// @alex-axure-source '));
  doc.header = [...cleanHeader, '// @alex-axure-source ' + pageId];
  if (typeof doc.root.props.title !== 'string' || !doc.root.props.title.trim()) {
    doc.root.props.title = copy ? copy.title : page.title + '（优化版）';
  }

  if (!rawCoverage || typeof rawCoverage !== 'object' || Array.isArray(rawCoverage)) {
    throw new Error('重塑 RP 页面必须提供 coverage（包含 converted / retained / pending 去向清单）');
  }
  const covObj = rawCoverage as Record<string, unknown>;
  if (!Array.isArray(covObj.converted)) {
    throw new Error('coverage.converted 必须是数组');
  }

  const origNodes = new Map<string, ProtoNode>();
  walk(original.root, n => {
    origNodes.set(n.pfId, n);
  });
  const nextNodes = new Map<string, ProtoNode>();
  walk(doc.root, n => {
    nextNodes.set(n.pfId, n);
  });

  const canonicalPageOf = (targetId: string) =>
    canonicalAxureTargetPageId(targetId, snapshot.pageSources, copyId, pageId);

  const assertValidSourcePfId = (id: string, ctx: string) => {
    if (id === original.root.pfId || id === canvasPfId) {
      throw new Error(`${ctx} 不能直接填写页面根或画布容器 ${id}，请填写具体的源控件、表格、面板或分组 pfId`);
    }
    if (!origNodes.has(id)) {
      throw new Error(`${ctx} 引用的源控件 pfId「${id}」在源页面 ${pageId} 中不存在`);
    }
  };

  const converted: RpConvertedItem[] = covObj.converted.map((raw, idx) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`coverage.converted[${idx}] 格式无效`);
    }
    const item = raw as Record<string, unknown>;
    const ctx = `coverage.converted[${idx}]`;
    const sourcePfIds = normalizePfIdArray(item.sourcePfIds, `${ctx}.sourcePfIds`);
    sourcePfIds.forEach(id => assertValidSourcePfId(id, ctx));
    if (typeof item.targetPfId !== 'string' || !item.targetPfId.trim()) {
      throw new Error(`${ctx}.targetPfId 不能为空`);
    }
    const targetPfId = item.targetPfId.trim();
    if (targetPfId === doc.root.pfId || !nextNodes.has(targetPfId)) {
      throw new Error(`${ctx}.targetPfId「${targetPfId}」在重塑后的页面源码中不存在（且不能为根 Page）`);
    }
    if (typeof item.summary !== 'string' || !item.summary.trim()) {
      throw new Error(`${ctx}.summary 不能为空`);
    }
    const tableId =
      item.tableId !== undefined
        ? typeof item.tableId === 'string' && item.tableId.trim()
          ? item.tableId.trim()
          : (() => {
              throw new Error(`${ctx}.tableId 必须是非空字符串`);
            })()
        : undefined;
    const columnMappings = item.columnMappings !== undefined ? parseColumnMappings(item.columnMappings, ctx) : undefined;
    return {
      sourcePfIds,
      targetPfId,
      summary: item.summary.trim(),
      ...(tableId ? { tableId } : {}),
      ...(columnMappings ? { columnMappings } : {}),
    };
  });

  const rawRetained = covObj.retained === undefined ? [] : covObj.retained;
  if (!Array.isArray(rawRetained)) throw new Error('coverage.retained 必须是数组');
  const retainedRootSet = new Set<string>();
  const retainedSubtreeNodes = new Set<string>();
  const retained: RpRetainedItem[] = rawRetained.map((raw, idx) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`coverage.retained[${idx}] 格式无效`);
    }
    const item = raw as Record<string, unknown>;
    const ctx = `coverage.retained[${idx}]`;
    const sourcePfIds = normalizePfIdArray(item.sourcePfIds, `${ctx}.sourcePfIds`);
    if (typeof item.summary !== 'string' || !item.summary.trim()) {
      throw new Error(`${ctx}.summary 不能为空`);
    }
    for (const id of sourcePfIds) {
      assertValidSourcePfId(id, ctx);
      const nextNode = nextNodes.get(id);
      if (!nextNode) {
        throw new Error(`${ctx} 声明保留的源控件「${id}」并未出现在新页面源码中；若暂不转换请改列入 coverage.pending`);
      }
      const origNode = origNodes.get(id)!;
      verifyRetainedSubtree(origNode, nextNode, canonicalPageOf, id);
      retainedRootSet.add(id);
      walk(nextNode, desc => {
        retainedSubtreeNodes.add(desc.pfId);
      });
    }
    return { sourcePfIds, summary: item.summary.trim() };
  });

  const rawPending = covObj.pending === undefined ? [] : covObj.pending;
  if (!Array.isArray(rawPending)) throw new Error('coverage.pending 必须是数组');
  const pending: RpPendingItem[] = rawPending.map((raw, idx) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`coverage.pending[${idx}] 格式无效`);
    }
    const item = raw as Record<string, unknown>;
    const sourcePfIds =
      item.sourcePfIds !== undefined
        ? normalizePfIdArray(item.sourcePfIds, `coverage.pending[${idx}].sourcePfIds`, true)
        : undefined;
    sourcePfIds?.forEach(id => assertValidSourcePfId(id, `coverage.pending[${idx}]`));
    if (typeof item.reason !== 'string' || !item.reason.trim()) {
      throw new Error(`coverage.pending[${idx}].reason 不能为空`);
    }
    return {
      ...(sourcePfIds && sourcePfIds.length ? { sourcePfIds } : {}),
      reason: item.reason.trim(),
    };
  });

  for (const c of converted) {
    for (const id of c.sourcePfIds) {
      if (retainedRootSet.has(id)) {
        throw new Error(`源控件「${id}」不能同时出现在 coverage.converted 与 coverage.retained 中`);
      }
    }
  }

  // Mark every accounted source node and its subtree so containers cover their internal cells/items.
  const accounted = new Set<string>();
  const markCovered = (id: string) => {
    const node = origNodes.get(id);
    if (!node) return;
    walk(node, desc => {
      accounted.add(desc.pfId);
    });
  };
  for (const c of converted) c.sourcePfIds.forEach(markCovered);
  for (const r of retained) r.sourcePfIds.forEach(markCovered);
  for (const p of pending) p.sourcePfIds?.forEach(markCovered);

  // Verify no salient RP containers, placeholders, hidden groups, form inputs, or interactive widgets were silently dropped.
  const unaccounted: ProtoNode[] = [];
  const checkSalient = (n: ProtoNode) => {
    if (accounted.has(n.pfId)) return;
    if (n.type === 'Page' || n.type === 'AxureCanvas' || n.type === 'PanelState') {
      n.children.filter(isNode).forEach(checkSalient);
      return;
    }
    if (n.type === 'PositionedGroup') {
      const nf = frame(n);
      if (isActionChain(n.props.onClick) || nf.hidden === true) {
        const beforeLen = unaccounted.length;
        n.children.filter(isNode).forEach(checkSalient);
        if (unaccounted.length === beforeLen && (isActionChain(n.props.onClick) || nf.hidden === true)) {
          const hasAnyChildAccounted = n.children.filter(isNode).some(c => accounted.has(c.pfId));
          if (!hasAnyChildAccounted) unaccounted.push(n);
        }
        return;
      }
      n.children.filter(isNode).forEach(checkSalient);
      return;
    }
    if (
      n.type === 'StaticTable' ||
      n.type === 'DynamicPanel' ||
      n.type === 'OutlineTree' ||
      (n.type === 'AxureWidget' && n.props.kind === 'placeholder') ||
      FORM_CONTROL_TYPES.has(n.type) ||
      isActionChain(n.props.onClick)
    ) {
      unaccounted.push(n);
      return;
    }
    n.children.filter(isNode).forEach(checkSalient);
  };
  checkSalient(original.root);

  if (unaccounted.length > 0) {
    throw new Error(
      `以下源页面区块或交互控件尚未在 coverage（converted / retained / pending）中说明去向，禁止静默丢弃：${unaccounted
        .slice(0, 10)
        .map(describeSourceNode)
        .join('、')}。请将其转换为标准物料、原样保留，或在 coverage.pending 中列出 sourcePfIds 与待确认原因。`,
    );
  }

  // Build map of source DynamicPanels converted into Drawer / Modal overlays for rowAction verification.
  const convertedOverlayBySource = new Map<string, { targetPfId: string; overlayAction: 'openDrawer' | 'openModal' }>();
  for (const c of converted) {
    const tNode = nextNodes.get(c.targetPfId);
    if (!tNode || (tNode.type !== 'Drawer' && tNode.type !== 'Modal')) continue;
    const overlayAction = tNode.type === 'Drawer' ? 'openDrawer' : 'openModal';
    for (const srcId of c.sourcePfIds) {
      convertedOverlayBySource.set(srcId, { targetPfId: tNode.pfId, overlayAction });
    }
  }

  const dbTables = snapshot.dbTables ?? [];
  const sourceStaticTables: ProtoNode[] = [];
  walk(original.root, n => {
    if (n.type === 'StaticTable') sourceStaticTables.push(n);
  });

  // Prevent wrapping a converted Table inside a Card/Col targetPfId to bypass StaticTable -> Table mapping gates.
  for (const c of converted) {
    const srcGrids = c.sourcePfIds.map(id => origNodes.get(id)).filter((n): n is ProtoNode => Boolean(n && n.type === 'StaticTable'));
    if (!srcGrids.length) continue;
    const targetNode = nextNodes.get(c.targetPfId)!;
    if (targetNode.type !== 'Table') {
      let hasDescendantTable = false;
      walk(targetNode, desc => {
        if (desc.pfId !== targetNode.pfId && desc.type === 'Table') hasDescendantTable = true;
      });
      if (hasDescendantTable) {
        throw new Error(
          `转换静态表格 ${srcGrids[0].pfId} 时，coverage.converted 的 targetPfId 必须直接指向目标 Table 物料（不能指向外层容器 ${targetNode.pfId}），并提交 tableId 与逐列 columnMappings`,
        );
      }
    }
  }

  // If the source page has StaticTables, every non-retained <Table> in the reshaped page must declare its StaticTable mapping.
  if (sourceStaticTables.length > 0) {
    const verifiedTargetTableIds = new Set<string>();
    for (const c of converted) {
      const tNode = nextNodes.get(c.targetPfId);
      if (tNode?.type === 'Table' && c.sourcePfIds.some(id => origNodes.get(id)?.type === 'StaticTable')) {
        verifiedTargetTableIds.add(tNode.pfId);
      }
    }
    walk(doc.root, n => {
      if (n.type === 'Table' && !retainedSubtreeNodes.has(n.pfId) && !verifiedTargetTableIds.has(n.pfId)) {
        throw new Error(
          `重塑页面中的 Table（${n.pfId}）未在 coverage.converted 中关联源页面对应的 StaticTable 及逐列 columnMappings；禁止将原表格列为 pending 后另建未核对映射的 Table`,
        );
      }
    });
  }

  // Enforce per-column header mappings, non-inverted field bindings, and strict rowActions verification for every StaticTable.
  for (const gridNode of sourceStaticTables) {
    const colSummaries = analyzeStaticTableActions(gridNode);
    const actionByHeader = new Map(colSummaries.map(cs => [cs.headerPfId, cs]));
    const consistentLabels = new Set<string>();
    const unconfirmedByLabel = new Map<string, StaticTableColumnActionSummary>();
    for (const cs of colSummaries) {
      if (!cs.requiresConfirmation && cs.consistentAcrossDataRows) {
        cs.variants.forEach(v => {
          if (v.label) consistentLabels.add(v.label);
        });
      } else {
        cs.variants.forEach(v => {
          if (v.label) unconfirmedByLabel.set(v.label, cs);
        });
      }
    }

    const tableConversions = converted.filter(
      c => c.sourcePfIds.includes(gridNode.pfId) && nextNodes.get(c.targetPfId)?.type === 'Table',
    );

    for (const conv of tableConversions) {
      const tbl = nextNodes.get(conv.targetPfId)!;
      if (!conv.tableId || !conv.columnMappings) {
        throw new Error(
          `将静态表格 ${gridNode.pfId} 转换为 Table（${tbl.pfId}）时，必须在对应 coverage.converted 项中提交 tableId 与逐列 columnMappings（headerPfId → role / columnId），字段归属不明时将对应表头设为 role: "pending"`,
        );
      }
      if (conv.sourcePfIds.filter(id => origNodes.get(id)?.type === 'StaticTable').length > 1) {
        throw new Error(`每张源静态表格须单独声明一条指向目标 Table 的 coverage.converted 映射（${gridNode.pfId}）`);
      }
      const db = dbTables.find(t => t.id === conv.tableId);
      if (!db) {
        throw new Error(`coverage.converted 指定的 tableId「${conv.tableId}」在当前表目录中不存在`);
      }
      if (tbl.props.table !== db.id) {
        throw new Error(
          `目标 Table（${tbl.pfId}）绑定的 table「${String(tbl.props.table ?? '')}」与 coverage.converted.tableId「${db.id}」不一致`,
        );
      }

      const widths = Array.isArray(gridNode.props.columnWidths) ? gridNode.props.columnWidths : [];
      const headers = gridNode.children.filter(isNode).slice(0, widths.length);
      const headerSet = new Set(headers.map(h => h.pfId));
      const mappingByHeader = new Map<string, RpReshapeColumnMapping>();
      for (const m of conv.columnMappings) {
        if (!headerSet.has(m.headerPfId)) {
          throw new Error(
            `静态表格 ${gridNode.pfId} 的 columnMappings 引用了非本表第一行表头的单元格「${m.headerPfId}」`,
          );
        }
        if (mappingByHeader.has(m.headerPfId)) {
          throw new Error(`静态表格 ${gridNode.pfId} 的 columnMappings 重复映射了表头「${m.headerPfId}」`);
        }
        mappingByHeader.set(m.headerPfId, m);
      }

      for (const h of headers) {
        const inPending = pending.some(p => p.sourcePfIds?.includes(h.pfId));
        if (!mappingByHeader.has(h.pfId) && !inPending) {
          throw new Error(
            `静态表格 ${gridNode.pfId} 的表头单元格 ${h.pfId}（「${caption(h).trim()}」）未在 columnMappings 中说明用途；请映射为 field / index / checkbox / radio / actions，或设为 role: "pending"`,
          );
        }
      }

      const allHeaderTexts = headers.map(h => caption(h).trim()).filter(Boolean);
      const usedColumnIds = new Set<string>();
      const expectedColumns: { headerPfId: string; title: string; dataIndex: string; columnId: string }[] = [];
      let hasIndex = false;
      let selectionRole: 'checkbox' | 'radio' | undefined;
      const expectedActionSummaries: StaticTableColumnActionSummary[] = [];

      for (const h of headers) {
        const m = mappingByHeader.get(h.pfId);
        if (!m) continue;
        const hTitle = caption(h).trim();
        if (m.role === 'field') {
          const col = db.columns.find(c => c.id === m.columnId);
          if (!col || usedColumnIds.has(col.id)) {
            throw new Error(
              `表头「${hTitle || h.pfId}」（${h.pfId}）绑定的 columnId「${m.columnId}」在表 ${db.id} 中不存在或与其他列重复`,
            );
          }
          if (!hTitle) {
            throw new Error(`表头单元格 ${h.pfId} 缺少可核对的文字，不能绑定为业务字段；请确认用途或设为 role: "pending"`);
          }
          assertNonInvertedFieldBinding(db, col, hTitle, `原表头`, allHeaderTexts);
          usedColumnIds.add(col.id);
          expectedColumns.push({ headerPfId: h.pfId, title: hTitle, dataIndex: col.name, columnId: col.id });
        } else if (m.role === 'index') {
          if (hasIndex) throw new Error(`静态表格 ${gridNode.pfId} 最多允许一列序号列（role="index"）`);
          hasIndex = true;
        } else if (m.role === 'checkbox' || m.role === 'radio') {
          if (selectionRole) throw new Error(`静态表格 ${gridNode.pfId} 最多允许一列选行列（role="checkbox" 或 "radio"）`);
          selectionRole = m.role;
        } else if (m.role === 'actions') {
          const colAction = actionByHeader.get(h.pfId);
          if (!colAction || colAction.requiresConfirmation || !colAction.consistentAcrossDataRows || colAction.variants.length !== 1) {
            throw new Error(
              `原表格 ${gridNode.pfId} 的操作列「${hTitle || h.pfId}」（${h.pfId}）未在全部非空样例行一致出现（或仅有单行高风险动作），不能映射为 role="actions"；请改为 role="pending" 并在待确认项说明`,
            );
          }
          expectedActionSummaries.push(colAction);
        } else if (m.role === 'pending') {
          const alreadyMentioned = pending.some(p => p.sourcePfIds?.includes(h.pfId));
          if (!alreadyMentioned) {
            pending.push({
              sourcePfIds: [h.pfId],
              reason: m.reason || `原表头「${hTitle || h.pfId}」字段归属或交互语义待确认`,
            });
          }
        }
      }

      if (expectedColumns.length === 0) {
        throw new Error(`目标 Table（${tbl.pfId}）未映射任何业务字段列`);
      }

      const actualCols = Array.isArray(tbl.props.columns) ? tbl.props.columns : [];
      if (actualCols.length !== expectedColumns.length) {
        throw new Error(
          `目标 Table（${tbl.pfId}）的 columns 数量（${actualCols.length}）与 columnMappings 声明的业务字段列数（${expectedColumns.length}）不一致`,
        );
      }
      for (let k = 0; k < expectedColumns.length; k++) {
        const ac = actualCols[k];
        if (!ac || typeof ac !== 'object' || Array.isArray(ac)) {
          throw new Error(`目标 Table（${tbl.pfId}）第 ${k + 1} 列配置无效`);
        }
        const acObj = ac as Record<string, unknown>;
        const acTitle = typeof acObj.title === 'string' ? acObj.title.trim() : '';
        const acDataIndex = typeof acObj.dataIndex === 'string' ? acObj.dataIndex.trim() : '';
        const exp = expectedColumns[k];
        if (acTitle !== exp.title || acDataIndex !== exp.dataIndex) {
          throw new Error(
            `目标 Table（${tbl.pfId}）第 ${k + 1} 列（title="${acTitle}", dataIndex="${acDataIndex}"）与已确认的源表头映射（${exp.headerPfId}「${exp.title}」 → ${db.tableName}.${exp.dataIndex}）不一致`,
          );
        }
      }

      if (hasIndex && tbl.props.showIndex === false) {
        throw new Error(`columnMappings 已声明序号列，目标 Table（${tbl.pfId}）不能设置 showIndex={false}`);
      }
      if (selectionRole) {
        if (tbl.props.selectable !== true || (tbl.props.selectionType ?? 'checkbox') !== selectionRole) {
          throw new Error(
            `columnMappings 已声明 ${selectionRole} 选行列，目标 Table（${tbl.pfId}）须开启 selectable${selectionRole === 'radio' ? ' 与 selectionType="radio"' : ''}`,
          );
        }
      }

      const actualRowActions = Array.isArray(tbl.props.rowActions) ? tbl.props.rowActions : [];
      for (const ra of actualRowActions) {
        if (!ra || typeof ra !== 'object' || Array.isArray(ra)) continue;
        const label = typeof (ra as { label?: unknown }).label === 'string' ? (ra as { label: string }).label.trim() : '';
        if (label && unconfirmedByLabel.has(label) && !consistentLabels.has(label)) {
          throw new Error(
            `原表格 ${gridNode.pfId} 中的动作「${label}」未在全部非空样例行一致出现（或仅有单行高风险示例），原生 Table.rowActions 会在每一行显示，不能直接推广到全表；请从 rowActions 移除并在 coverage.pending 中列为待确认。`,
          );
        }
      }

      if (actualRowActions.length !== expectedActionSummaries.length) {
        throw new Error(
          `目标 Table（${tbl.pfId}）的 rowActions 数量（${actualRowActions.length}）与 columnMappings 确认的逐行一致操作列数（${expectedActionSummaries.length}）不一致；禁止凭空增删行操作或推广未逐行确认的动作`,
        );
      }

      for (let ai = 0; ai < expectedActionSummaries.length; ai++) {
        const expectedSummary = expectedActionSummaries[ai];
        const variant = expectedSummary.variants[0];
        const expectedLabel = variant.label || '查看';
        const ra = actualRowActions[ai];
        if (!ra || typeof ra !== 'object' || Array.isArray(ra)) {
          throw new Error(`目标 Table（${tbl.pfId}）第 ${ai + 1} 项 rowActions 格式无效`);
        }
        const raObj = ra as Record<string, unknown>;
        const actualLabel = typeof raObj.label === 'string' ? raObj.label.trim() : '';
        if (actualLabel !== expectedLabel) {
          throw new Error(
            `目标 Table（${tbl.pfId}）第 ${ai + 1} 项 rowActions 文字「${actualLabel}」与源操作列（${expectedSummary.headerPfId}）文字「${expectedLabel}」不一致`,
          );
        }
        verifyMigratedRowActionCalls(
          raObj.onClick,
          variant.onClick,
          canonicalPageOf,
          convertedOverlayBySource,
          tbl.pfId,
          expectedLabel,
        );
      }
    }

    // Ensure any unconfirmed/unlinked column actions on this StaticTable are surfaced in pending if AI omitted them.
    if (tableConversions.length > 0 || converted.some(c => c.sourcePfIds.includes(gridNode.pfId))) {
      for (const cs of colSummaries) {
        if (!cs.requiresConfirmation) continue;
        const alreadyMentioned = pending.some(
          p =>
            p.sourcePfIds?.includes(cs.headerPfId) ||
            p.sourcePfIds?.includes(gridNode.pfId) ||
            cs.cellPfIds.some(cid => p.sourcePfIds?.includes(cid)) ||
            cs.variants.some(v => v.label && p.reason.includes(v.label)) ||
            cs.unlinkedTexts.some(t => p.reason.includes(t)),
        );
        if (!alreadyMentioned) {
          const detail = [
            ...cs.variants.map(v => `「${v.label || '点击'}」仅出现在 ${v.rowCount}/${cs.populatedDataRowCount} 条非空样例行`),
            ...(cs.unlinkedTexts.length ? [`文本「${cs.unlinkedTexts.join('、')}」缺少已导入的点击动作`] : []),
          ].join('；');
          pending.push({
            sourcePfIds: [cs.headerPfId],
            reason: `原表格列「${cs.headerText || cs.headerPfId}」存在待确认行级交互（${detail}），未自动推广为全表行操作`,
          });
        }
      }
    }
  }

  // Also guard QueryForm / Form / Descriptions against inverted label <-> column bindings.
  if (dbTables.length > 0) {
    walk(doc.root, node => {
      if (retainedSubtreeNodes.has(node.pfId)) return;
      if (node.type === 'QueryForm' && typeof node.props.target === 'string' && Array.isArray(node.props.fields)) {
        const targetTbl = nextNodes.get(node.props.target);
        const db = targetTbl ? dbTables.find(t => t.id === targetTbl.props.table) : undefined;
        if (!db) return;
        const labels = node.props.fields
          .map(f => (f && typeof f === 'object' && !Array.isArray(f) && typeof (f as { label?: unknown }).label === 'string' ? (f as { label: string }).label : ''))
          .filter(Boolean);
        for (const f of node.props.fields) {
          if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
          const fo = f as { name?: unknown; label?: unknown };
          if (typeof fo.name !== 'string' || typeof fo.label !== 'string') continue;
          const col = db.columns.find(c => c.name === fo.name);
          if (col) assertNonInvertedFieldBinding(db, col, fo.label, `查询表单（${node.pfId}）条件`, labels);
        }
      } else if (node.type === 'Descriptions' && typeof node.props.table === 'string' && Array.isArray(node.props.items)) {
        const db = dbTables.find(t => t.id === node.props.table);
        if (!db) return;
        const labels = node.props.items
          .map(it => (it && typeof it === 'object' && !Array.isArray(it) && typeof (it as { label?: unknown }).label === 'string' ? (it as { label: string }).label : ''))
          .filter(Boolean);
        for (const it of node.props.items) {
          if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
          const io = it as { field?: unknown; label?: unknown };
          if (typeof io.field !== 'string' || typeof io.label !== 'string') continue;
          const col = db.columns.find(c => c.name === io.field);
          if (col) assertNonInvertedFieldBinding(db, col, io.label, `详情描述（${node.pfId}）字段`, labels);
        }
      } else if (node.type === 'Form' && typeof node.props.table === 'string') {
        const db = dbTables.find(t => t.id === node.props.table);
        if (!db) return;
        if (Array.isArray(node.props.fields)) {
          const labels = node.props.fields
            .map(f => (f && typeof f === 'object' && !Array.isArray(f) && typeof (f as { label?: unknown }).label === 'string' ? (f as { label: string }).label : ''))
            .filter(Boolean);
          for (const f of node.props.fields) {
            if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
            const fo = f as { name?: unknown; label?: unknown };
            if (typeof fo.name !== 'string' || typeof fo.label !== 'string') continue;
            const col = db.columns.find(c => c.name === fo.name);
            if (col) assertNonInvertedFieldBinding(db, col, fo.label, `表单（${node.pfId}）字段`, labels);
          }
        }
      }
    });
  }

  if (typeof original.root.props.description === 'string' && original.root.props.description.trim()) {
    const notes = original.root.props.description.trim();
    const mentioned = pending.some(p => p.reason.includes(notes) || p.reason.includes('导入'));
    if (!mentioned) {
      pending.push({
        reason: `源页面导入提示待核对：${notes}`,
      });
    }
  }

  retargetOptimizedNavigations(doc, snapshot.pageSources, copyId);
  const rpCoverage: RpReshapeCoverage = { converted, retained, pending };
  return {
    pageId: copyId,
    title: copy ? copy.title : String(doc.root.props.title),
    folderId: copy ? copy.folderId : page.folderId,
    source: printPageSource(doc),
    rpCoverage,
  };
}

export interface AxureMigrationProgress {
  totalScopePages: number;
  stagedThisTurnCount: number;
  stagedThisTurnPages: { pageId: string; copyId: string; title: string; copyLayout: 'flow' | 'positioned' }[];
  flowReshapedPageCount: number;
  flowReshapedPages: { pageId: string; copyId: string; title: string }[];
  partiallyOptimizedPageCount: number;
  partiallyOptimizedPages: { pageId: string; copyId: string; title: string }[];
  unconvertedPageCount: number;
  unconvertedPages: { pageId: string; title: string }[];
  hint: string;
}

export function evaluateAxureMigrationProgress(
  snapshot: SitemapLayout & { pageSources: Record<string, string> },
  scope: AxureScope,
  operations: readonly { tool: string; args: Record<string, unknown> }[],
): AxureMigrationProgress {
  const scopePages = axureScopePages(axureCatalog(snapshot), scope);
  const stagedCopyIds = new Set(
    operations
      .filter(op => op.tool === 'protoflow_apply_tsx_patch' && typeof op.args?.pageId === 'string')
      .map(op => op.args.pageId as string),
  );
  const stagedThisTurnPages: AxureMigrationProgress['stagedThisTurnPages'] = [];
  const flowReshapedPages: AxureMigrationProgress['flowReshapedPages'] = [];
  const partiallyOptimizedPages: AxureMigrationProgress['partiallyOptimizedPages'] = [];
  const unconvertedPages: AxureMigrationProgress['unconvertedPages'] = [];

  for (const p of scopePages) {
    const copyId = axureCopyId(p.pageId);
    const copySource = snapshot.pageSources[copyId];
    const verifiedSrc =
      typeof copySource === 'string' ? verifiedAxureSourceId(copyId, readPageHeader(copySource)) : undefined;
    if (verifiedSrc !== p.pageId) {
      unconvertedPages.push({ pageId: p.pageId, title: p.title });
      continue;
    }
    const copyDoc = parsePageSource(copySource).doc;
    const guid = p.pageId.slice('rp-page-'.length);
    const isPositioned = Boolean(
      !copyDoc ||
        copyDoc.root.children.some(c => isNode(c) && c.type === 'AxureCanvas' && c.pfId === 'rp-canvas-' + guid),
    );
    const copyLayout: 'flow' | 'positioned' = isPositioned ? 'positioned' : 'flow';
    if (stagedCopyIds.has(copyId)) {
      stagedThisTurnPages.push({ pageId: p.pageId, copyId, title: p.title, copyLayout });
    }
    if (copyLayout === 'flow') {
      flowReshapedPages.push({ pageId: p.pageId, copyId, title: p.title });
    } else {
      partiallyOptimizedPages.push({ pageId: p.pageId, copyId, title: p.title });
    }
  }

  const remainingLabels = [
    ...unconvertedPages.map(p => `${p.title}(${p.pageId})`),
    ...partiallyOptimizedPages.map(p => `${p.title}(${p.pageId}，仅局部优化)`),
  ];
  const hint =
    remainingLabels.length > 0
      ? `当前迁移范围共 ${scopePages.length} 页：已完成整页流式重塑 ${flowReshapedPages.length} 页，本轮暂存修改 ${stagedThisTurnPages.length} 页，仍有 ${remainingLabels.length} 页未完成整页流式重塑（${remainingLabels.slice(0, 6).join('、')}）。仅暂存表结构或只改局部控件不等于完成整页转换，若无阻塞疑问请调用 protoflow_reshape_axure_page 完成流式重塑。`
      : `当前迁移范围内的 ${scopePages.length} 个 RP 页面均已完成整页流式重塑（本轮暂存修改 ${stagedThisTurnPages.length} 页）。`;

  return {
    totalScopePages: scopePages.length,
    stagedThisTurnCount: stagedThisTurnPages.length,
    stagedThisTurnPages,
    flowReshapedPageCount: flowReshapedPages.length,
    flowReshapedPages,
    partiallyOptimizedPageCount: partiallyOptimizedPages.length,
    partiallyOptimizedPages,
    unconvertedPageCount: unconvertedPages.length,
    unconvertedPages,
    hint,
  };
}
