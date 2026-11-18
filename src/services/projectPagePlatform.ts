import { parsePageSource } from '../proto/dsl/parser';
import type { PagePlatform, ProjectMode } from '../proto/mobile/types';
import type { ProjectPlan } from './projectPlan';

export interface RequestedPage {
  pageId: string;
  platform: PagePlatform;
}

interface PlatformContext {
  pageSources?: Record<string, string>;
  designerPages?: { pageId: string; platform?: PagePlatform }[];
  projectPlan?: ProjectPlan | null;
}

export function pageRootType(platform: PagePlatform) {
  return platform === 'mobile' ? 'MobilePage' : 'Page';
}

function existingPlatform(state: PlatformContext, pageId: string): PagePlatform | undefined {
  const saved = state.designerPages?.find(page => page.pageId === pageId)?.platform;
  const source = state.pageSources?.[pageId];
  const root = source && parsePageSource(source).doc?.root;
  if (!root) return saved;
  // Old plan confirmations created this empty desktop placeholder for every platform.
  if (!saved && root.type === 'Page' && root.pfId === 'project-root' && !root.children.length) return undefined;
  if (root.type === 'MobilePage') return 'mobile';
  if (root.type === 'Page') return 'desktop';
  return saved;
}

export function plannedPagePlatform(state: PlatformContext, pageId: string, declared: PagePlatform | undefined, mode: ProjectMode | undefined): PagePlatform {
  const existing = existingPlatform(state, pageId);
  if (existing && declared && existing !== declared) throw new Error(`页面 ${pageId} 的方案平台与现有页面不一致`);
  if (declared) return declared;
  if (existing) return existing;
  if (mode === 'hybrid') throw new Error(`混合工程必须为新页面 ${pageId} 指定 platform（mobile 或 desktop）`);
  // Archives predating project modes used desktop pages.
  return mode ?? 'desktop';
}

/** Both the native staging tool and the final host transaction verify the same page root. */
export function checkAiPagePlatform(state: PlatformContext, pageId: string, rootType: string, mode?: ProjectMode, requestedPlatform?: PagePlatform): PagePlatform {
  if (rootType !== 'Page' && rootType !== 'MobilePage') throw new Error('页面根组件必须是 Page 或 MobilePage');
  const actual = rootType === 'MobilePage' ? 'mobile' : 'desktop';
  const planned = state.projectPlan?.pages.find(page => page.pageId === pageId);
  const existing = existingPlatform(state, pageId);
  const expected = planned
    ? plannedPagePlatform(state, pageId, planned.platform, mode)
    : existing ?? requestedPlatform ?? (mode === 'hybrid' ? undefined : mode);
  for (const platform of [expected, requestedPlatform]) {
    if (platform && actual !== platform) throw new Error(`页面 ${pageId} 需要 ${pageRootType(platform)} 根组件，收到 ${rootType}`);
  }
  return actual;
}
