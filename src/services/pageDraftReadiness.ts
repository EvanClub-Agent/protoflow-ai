import type { ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import { generationEvidenceIssues, regressedPageDependencies } from './projectDependencies';
import { menuMergeIssue } from './projectMenuMerge';
import { pagePrototypeIssue } from './projectPlanMenus';

export type DraftReadinessSnapshot = Pick<
  ProjectStateSnapshot,
  | 'projectPlan'
  | 'pageSources'
  | 'dbTables'
  | 'mindmaps'
  | 'stickyNotes'
  | 'closedLoopIssues'
  | 'designerPages'
  | 'sitemapBase'
>;

export interface PageDraftReadiness {
  pageId: string;
  planned: boolean;
  acceptanceReady: boolean;
  prototypeIssue: string | null;
  pendingAcceptanceIssues: string[];
}

/**
 * Non-blocking readiness evaluation for a staged page draft.
 * Used inside MCP tools (`protoflow_apply_tsx_patch`, `protoflow_edit_page_block`,
 * `protoflow_inspect_page`, `protoflow_get_project_brief`) so incremental block
 * edits never fail mid-flight while surfacing exact remaining acceptance items
 * before the agent finishes the turn.
 */
export function evaluatePageDraftReadiness(
  snapshot: DraftReadinessSnapshot,
  pageId: string,
  baseSnapshot?: DraftReadinessSnapshot | null,
): PageDraftReadiness {
  const source = snapshot.pageSources?.[pageId];
  const planned = Boolean(snapshot.projectPlan?.pages?.some(p => p.pageId === pageId));
  const prototypeIssue =
    typeof source === 'string' ? pagePrototypeIssue(source) || null : '目标页面尚未写入源码';

  const evidenceIssues =
    planned && !prototypeIssue
      ? generationEvidenceIssues(snapshot, [pageId])
      : [];

  let mergeIssue: string | null = null;
  const mergePlan = snapshot.projectPlan?.revision;
  if (
    planned &&
    !prototypeIssue &&
    baseSnapshot &&
    snapshot.projectPlan?.approved &&
    mergePlan?.merge &&
    mergePlan.pageId === pageId
  ) {
    // Read-only precondition check: never runs the migration, so AI snapshots
    // (compact note catalog, no note workspace) are evaluated without casts.
    try {
      mergeIssue = menuMergeIssue(baseSnapshot, snapshot, pageId, new Set([pageId]));
    } catch (err) {
      mergeIssue = err instanceof Error ? err.message : String(err);
    }
  }

  const dependencyRegressions =
    baseSnapshot?.projectPlan?.pages?.some(p => p.dependencies?.length)
      ? regressedPageDependencies(baseSnapshot, snapshot).map(
          r => `${r.pageId} ← ${r.sourcePageId} · ${r.requirement}（${r.status}）`,
        )
      : [];

  const pendingAcceptanceIssues = [
    ...(prototypeIssue ? [prototypeIssue] : []),
    ...evidenceIssues,
    ...(mergeIssue ? [mergeIssue] : []),
    ...dependencyRegressions,
  ];

  return {
    pageId,
    planned,
    acceptanceReady: pendingAcceptanceIssues.length === 0,
    prototypeIssue,
    pendingAcceptanceIssues,
  };
}
