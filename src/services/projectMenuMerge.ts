import { ACTION_MAP } from '../proto/runtime/actions';
import { parsePageSource } from '../proto/dsl/parser';
import { printPageSource } from '../proto/dsl/printer';
import { walk } from '../proto/dsl/tree';
import { isActionChain, type ActionCall, type PropValue } from '../proto/types';
import { sitemapCatalog } from '../proto/sitemap';
import { migrateNotePageLinks } from '../proto/notes';
import type { ProjectStateSnapshot } from '../utils/pflowBinaryCodec';

function visitActions(value: PropValue, visit: (call: ActionCall) => void) {
  if (isActionChain(value)) value.calls.forEach(visit);
  else if (Array.isArray(value)) value.forEach(child => visitActions(child, visit));
  else if (value && typeof value === 'object') Object.values(value).forEach(child => visitActions(child, visit));
}

/** Exact inputs read by the merge precondition check. Notes, mindmaps and other
 * migrated-only fields are intentionally excluded so AI context snapshots (whose
 * `projectNotes` is a compact catalog, not a workspace) can be checked without casts. */
export type MenuMergeCheckInput = Pick<
  ProjectStateSnapshot,
  'projectPlan' | 'designerPages' | 'pageSources' | 'sitemapBase' | 'stickyNotes' | 'closedLoopIssues' | 'dbTables'
>;
export type MenuMergeBaseline = Pick<ProjectStateSnapshot, 'pageSources' | 'dbTables'>;

/** Read-only merge precondition check. Never mutates either snapshot.
 * Returns the first blocking issue, or null when the migration can proceed. */
export function menuMergeIssue(
  before: MenuMergeBaseline,
  s: MenuMergeCheckInput,
  pageId: string,
  changed: ReadonlySet<string>,
): string | null {
  const revision = s.projectPlan?.revision, merge = revision?.merge;
  if (!s.projectPlan?.approved || !merge || revision?.pageId !== pageId || !changed.has(pageId)) {
    return '合并需要已确认的方案和本轮目标页面修改';
  }
  const oldId = merge.sourcePageId;
  const target = s.designerPages.find(page => page.pageId === pageId) ?? s.projectPlan.pages.find(page => page.pageId === pageId);
  const exists = s.designerPages.some(page => page.pageId === oldId);
  if (!target || (merge.plannedOnly ? exists || Object.hasOwn(s.pageSources, oldId) : !exists) || sitemapCatalog(s.sitemapBase).builtinPages.has(oldId)) {
    return '原菜单或目标菜单已变化，请重新确认合并方案';
  }
  const originalTarget = parsePageSource(before.pageSources[pageId]).doc;
  const revisedTarget = parsePageSource(s.pageSources[pageId]).doc;
  if (JSON.stringify(originalTarget?.root) === JSON.stringify(revisedTarget?.root)) return '目标页面内容没有变化，合并未应用';
  if (s.stickyNotes.some(note => note.pageId === oldId) || s.closedLoopIssues.some(issue => issue.pageId === oldId)) {
    return '原菜单仍有组件便签或巡检记录，请先处理这些关联后再合并';
  }
  const openAction = merge.presentation === 'drawer' ? 'openDrawer' : 'openModal';
  const overlayTypes = ACTION_MAP[openAction].args[0].refTypes!;
  const overlayNodes = new Set<string>();
  const openingControls = new Set<string>();
  for (const [id, source] of Object.entries(s.pageSources)) {
    if (id === oldId) continue;
    const parsed = parsePageSource(source);
    if (!parsed.doc || parsed.issues.length) return '页面 ' + id + ' 无法完整检查跳转，合并未应用';
    let referencesOld = false;
    let targetNavigatesOld = false;
    walk(parsed.doc.root, node => {
      if (id === pageId && overlayTypes.includes(node.type) && (typeof node.props.id === 'string' ? node.props.id : node.pfId) === merge.overlayId
        && node.children.some(child => child.kind === 'node')) {
        walk(node, child => overlayNodes.add(child.pfId));
      }
      for (const prop of Object.values(node.props)) visitActions(prop, call => {
        if (id === pageId && call.name === openAction && call.args[0] === merge.overlayId) openingControls.add(node.pfId);
        if (call.name !== 'navigate' || call.args[0] !== oldId) return;
        if (id === pageId) targetNavigatesOld = true;
        else referencesOld = true;
      });
    });
    if (targetNavigatesOld) return '目标页面仍跳转到旧菜单，请用弹层打开动作替换该入口';
    if (referencesOld && parsed.normalized) return '页面 ' + id + ' 的组件标识需要修复后才能迁移跳转';
  }
  if (!overlayNodes.size || ![...openingControls].some(id => !overlayNodes.has(id))) return '未找到方案指定的弹层内容和打开入口，原菜单已保留';
  for (const table of s.dbTables) {
    const old = table.sharedByMenus.find(binding => binding.pageId === oldId);
    const previous = before.dbTables.find(item => item.id === table.id)?.sharedByMenus.find(binding => binding.pageId === oldId);
    const sourceBinding = old ?? previous;
    if (!sourceBinding) continue;
    const existing = table.sharedByMenus.find(binding => binding.pageId === pageId);
    if (existing && (existing.accessMode !== sourceBinding.accessMode || existing.fieldMappingNote !== sourceBinding.fieldMappingNote)) {
      return '数据表 ' + table.tableName + ' 在两个页面的绑定含义不同，请先明确合并后的访问模式和字段说明';
    }
  }
  return null;
}

/** Mutates only the candidate snapshot. The host commits the target patch, old
 * menu removal and reference changes together after all validation succeeds. */
export function finishMenuMerge(before: ProjectStateSnapshot, s: ProjectStateSnapshot, pageId: string, changed: Set<string>) {
  const issue = menuMergeIssue(before, s, pageId, changed);
  if (issue) throw new Error(issue);
  const merge = s.projectPlan!.revision!.merge!;
  const oldId = merge.sourcePageId;
  const target = s.designerPages.find(page => page.pageId === pageId) ?? s.projectPlan!.pages.find(page => page.pageId === pageId)!;
  for (const [id, source] of Object.entries(s.pageSources)) {
    if (id === oldId || id === pageId) continue;
    const parsed = parsePageSource(source);
    if (!parsed.doc) continue;
    let rewritten = false;
    walk(parsed.doc.root, node => {
      for (const prop of Object.values(node.props)) visitActions(prop, call => {
        if (call.name !== 'navigate' || call.args[0] !== oldId) return;
        call.args[0] = pageId;
        rewritten = true;
      });
    });
    if (rewritten) {
      s.pageSources[id] = printPageSource(parsed.doc);
      changed.add(id);
    }
  }
  for (const table of s.dbTables) {
    const old = table.sharedByMenus.find(binding => binding.pageId === oldId);
    const previous = before.dbTables.find(item => item.id === table.id)?.sharedByMenus.find(binding => binding.pageId === oldId);
    const sourceBinding = old ?? previous; // An AI schema patch may already have removed the retired menu's binding.
    if (!sourceBinding) continue;
    const existing = table.sharedByMenus.find(binding => binding.pageId === pageId);
    table.sharedByMenus = table.sharedByMenus.filter(binding => binding.pageId !== oldId);
    if (!existing) table.sharedByMenus.push({ ...sourceBinding, pageId, menuTitle: target.title });
  }
  const oldLinks = s.mindmaps.links.filter(link => link.page.kind === 'page' && link.page.pageId === oldId);
  s.mindmaps.links = s.mindmaps.links.filter(link => !oldLinks.includes(link));
  for (const link of oldLinks) {
    if (!s.mindmaps.links.some(other => other.targetNodeId === link.targetNodeId && other.page.kind === 'page' && other.page.pageId === pageId)) {
      s.mindmaps.links.push({ ...link, page: { kind: 'page', pageId } });
    }
  }
  if (s.projectNotes) s.projectNotes = migrateNotePageLinks(s.projectNotes, oldId, pageId);
  s.designerPages = s.designerPages.filter(page => page.pageId !== oldId);
  delete s.pageSources[oldId];
  if (s.activePageId === oldId) s.activePageId = pageId;
}
