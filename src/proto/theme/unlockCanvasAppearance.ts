import { parsePageSource } from '../dsl/parser';
import { printPageSource } from '../dsl/printer';
import { usePageStore } from '../store/usePageStore';
import { useProtoStore } from '../../store/useProtoStore';
import { isDefaultDesignTokens, type ProjectDesignTokens } from './designTokens';

/**
 * Surfaces that naturally adapt to both light and dark workspace themes when `appearance="auto"`.
 * Dedicated dark-only surfaces (`oled_carbon`, `ocean_glow`) intentionally stay dark by default.
 */
export function isStandardAdaptableSurface(surfaceBg: unknown): boolean {
  return surfaceBg !== 'oled_carbon' && surfaceBg !== 'ocean_glow';
}

export function isPageAppearancePinned(appearance: unknown, surfaceBg: unknown): boolean {
  return (appearance === 'light' || appearance === 'dark') && isStandardAdaptableSurface(surfaceBg);
}

export function countPinnedAppearancePages(pageSources: Record<string, string>): number {
  let count = 0;
  for (const raw of Object.values(pageSources)) {
    if (!raw || (!raw.includes('appearance=') && !raw.includes('appearance :'))) continue;
    const parsed = parsePageSource(raw);
    const root = parsed.doc?.root;
    if (!root || (root.type !== 'Page' && root.type !== 'MobilePage')) continue;
    if (isPageAppearancePinned(root.props.appearance, root.props.surfaceBg)) {
      count++;
    }
  }
  return count;
}

/**
 * Resets project-level `designTokens.colorMode` to `'auto'` and strips hardcoded
 * `appearance="light" | "dark"` from all standard (non-OLED) `<Page>` / `<MobilePage>` roots
 * so the prototype canvas seamlessly follows the outer workbench / viewer theme toggle.
 */
export function unlockProjectAppearanceToFollowTheme(): {
  clearedTokenColorMode: boolean;
  updatedPageIds: string[];
} {
  const protoState = useProtoStore.getState();
  const currentTokens = protoState.designTokens;
  let clearedTokenColorMode = false;

  if (currentTokens?.colorMode && currentTokens.colorMode !== 'auto') {
    const nextTokens: ProjectDesignTokens = { ...currentTokens };
    delete nextTokens.colorMode;
    protoState.setDesignTokens(isDefaultDesignTokens(nextTokens) ? null : nextTokens);
    clearedTokenColorMode = true;
  }

  const pageState = usePageStore.getState();
  const currentSources = pageState.pageSources;
  const nextSources: Record<string, string> = { ...currentSources };
  const updatedPageIds: string[] = [];

  for (const [pageId, raw] of Object.entries(currentSources)) {
    if (!raw || !raw.includes('appearance')) continue;
    const parsed = parsePageSource(raw);
    const doc = parsed.doc;
    if (!doc || (doc.root.type !== 'Page' && doc.root.type !== 'MobilePage')) continue;
    if (!isPageAppearancePinned(doc.root.props.appearance, doc.root.props.surfaceBg)) continue;
    const nextProps = { ...doc.root.props };
    delete nextProps.appearance;
    const nextDoc = {
      ...doc,
      root: {
        ...doc.root,
        props: nextProps,
      },
    };
    nextSources[pageId] = printPageSource(nextDoc);
    updatedPageIds.push(pageId);
  }

  if (updatedPageIds.length > 0) {
    usePageStore.setState({ pageSources: nextSources });
  }

  return { clearedTokenColorMode, updatedPageIds };
}
