import { tr } from '../../i18n/runtime';
import type { ProjectStateSnapshot } from '../../utils/pflowBinaryCodec';
import { projectPageCatalog } from '../../services/projectAnalysis';
import { parsePageSource } from '../dsl/parser';
import { walk } from '../dsl/tree';

export type VisualAppearanceMode = 'auto' | 'light' | 'dark';
export type VisualMotionMode = 'smooth' | 'snappy' | 'none';

export interface PageVisualProfile {
  pageId: string;
  title: string;
  platform: 'desktop' | 'mobile';
  appearance: VisualAppearanceMode;
  effectiveMode: VisualAppearanceMode;
  surfaceBg: string;
  explicitSurfaceBg: string | null;
  accent: string;
  explicitAccent: string | null;
  motion: VisualMotionMode;
  hasDarkBriefCard: boolean;
}

export interface VisualConsistencyWarning {
  code: 'accent-drift' | 'surface-drift' | 'appearance-drift' | 'dark-brief-clash';
  pageIds: string[];
  message: string;
}

export interface ProjectVisualBaseline {
  /** True once at least one active standard page explicitly declares appearance, surfaceBg, or accent. */
  established: boolean;
  dominant: {
    appearance: VisualAppearanceMode;
    desktopSurfaceBg: string;
    mobileSurfaceBg: string;
    desktopAccent: string;
    mobileAccent: string;
    motion: VisualMotionMode;
  } | null;
  pages: PageVisualProfile[];
  warnings: VisualConsistencyWarning[];
}

type VisualSnapshotInput = Pick<
  ProjectStateSnapshot,
  'designerFolders' | 'designerPages' | 'sitemapOverrides' | 'sitemapBase' | 'pageSources'
>;

const DARK_SURFACES = new Set(['oled_carbon', 'ocean_glow']);
const GREEN_HARMONIC_ACCENTS = new Set(['lime_forest', 'emerald']);

function normalizeAppearance(raw: unknown): VisualAppearanceMode {
  if (raw === 'light' || raw === 'dark') return raw;
  return 'auto';
}

function normalizeMotion(raw: unknown): VisualMotionMode {
  if (raw === 'snappy' || raw === 'none') return raw;
  return 'smooth';
}

function resolveEffectiveMode(appearance: VisualAppearanceMode, surfaceBg: string): VisualAppearanceMode {
  if (appearance === 'dark' || DARK_SURFACES.has(surfaceBg)) return 'dark';
  if (appearance === 'light') return 'light';
  return 'auto';
}

function canonicalAccentFamily(accent: string): string {
  if (accent === 'indigo' || accent === 'gemini' || accent === 'violet') return 'indigo_gemini';
  return accent;
}

function canonicalSurfaceFamily(surfaceBg: string): string {
  if (surfaceBg === 'oled_carbon' || surfaceBg === 'ocean_glow') return 'dark_carbon';
  return surfaceBg;
}

function toDesktopAccent(familyOrAccent: string): string {
  if (familyOrAccent === 'indigo_gemini' || familyOrAccent === 'gemini' || familyOrAccent === 'violet') {
    return 'indigo';
  }
  return familyOrAccent;
}

function toMobileAccent(familyOrAccent: string): string {
  if (familyOrAccent === 'indigo_gemini' || familyOrAccent === 'indigo') {
    return 'gemini';
  }
  return familyOrAccent;
}

function toDesktopSurface(surfaceBg: string): string {
  if (surfaceBg === 'ocean_glow') return 'oled_carbon';
  return surfaceBg;
}

function toMobileSurface(surfaceBg: string): string {
  if (surfaceBg === 'aurora') return 'mist';
  return surfaceBg;
}

function pickMostFrequent<T extends string>(values: T[], fallback: T): T {
  if (values.length === 0) return fallback;
  const counts = new Map<T, number>();
  for (const val of values) {
    counts.set(val, (counts.get(val) ?? 0) + 1);
  }
  let best = values[0];
  let bestCount = -1;
  for (const [val, count] of counts.entries()) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Extracts the project-wide visual identity baseline across saved `<Page>` and `<MobilePage>`
 * roots and detects cross-page visual patchwork (brand accent drift, surface atmosphere drift,
 * light/dark appearance splits, and forest-lime `dark_brief` cards on cool non-green palettes).
 */
export function analyzeVisualConsistency(snapshot: VisualSnapshotInput): ProjectVisualBaseline {
  const catalog = projectPageCatalog(snapshot);
  const profiles: PageVisualProfile[] = [];
  let anyExplicitVisualProp = false;

  for (const entry of catalog) {
    if (entry.deprecated || !entry.hasSource) continue;
    const src = snapshot.pageSources[entry.pageId];
    if (!src) continue;
    const parsed = parsePageSource(src);
    const root = parsed.doc?.root;
    if (!root || (root.type !== 'Page' && root.type !== 'MobilePage')) continue;

    const platform: 'desktop' | 'mobile' = root.type === 'MobilePage' ? 'mobile' : 'desktop';
    const rawAppearance = typeof root.props.appearance === 'string' ? root.props.appearance.trim() : '';
    const rawSurface = typeof root.props.surfaceBg === 'string' ? root.props.surfaceBg.trim() : '';
    const rawAccent = typeof root.props.accent === 'string' ? root.props.accent.trim() : '';
    const rawMotion = typeof root.props.motion === 'string' ? root.props.motion.trim() : '';

    if (rawAppearance || rawSurface || rawAccent) {
      anyExplicitVisualProp = true;
    }

    const appearance = normalizeAppearance(rawAppearance);
    const explicitSurfaceBg = rawSurface || null;
    const surfaceBg = explicitSurfaceBg ?? 'mist';
    const explicitAccent = rawAccent || null;
    const accent = explicitAccent ?? (platform === 'mobile' ? 'gemini' : 'blue');
    const motion = normalizeMotion(rawMotion);
    const effectiveMode = resolveEffectiveMode(appearance, surfaceBg);

    let hasDarkBriefCard = false;
    walk(root, (node) => {
      if (
        (node.type === 'AiCopilotCard' || node.type === 'MAiInsightCard') &&
        node.props.tone === 'dark_brief'
      ) {
        hasDarkBriefCard = true;
      }
    });

    profiles.push({
      pageId: entry.pageId,
      title: entry.title,
      platform,
      appearance,
      effectiveMode,
      surfaceBg,
      explicitSurfaceBg,
      accent,
      explicitAccent,
      motion,
      hasDarkBriefCard,
    });
  }

  if (profiles.length === 0) {
    return { established: false, dominant: null, pages: [], warnings: [] };
  }

  const styledProfiles = anyExplicitVisualProp
    ? profiles.filter((p) => p.explicitAccent !== null || p.explicitSurfaceBg !== null || p.appearance !== 'auto')
    : profiles;
  const anchorPool = styledProfiles.length > 0 ? styledProfiles : profiles;

  const dominantAccentFamily = pickMostFrequent(
    anchorPool.map((p) => canonicalAccentFamily(p.accent)),
    'blue',
  );
  const dominantSurface = pickMostFrequent(
    anchorPool.map((p) => p.surfaceBg),
    'mist',
  );
  const dominantAppearance = pickMostFrequent(
    anchorPool.map((p) => p.appearance),
    'auto',
  );
  const dominantMotion = pickMostFrequent(
    anchorPool.map((p) => p.motion),
    'smooth',
  );

  const dominant = {
    appearance: dominantAppearance,
    desktopSurfaceBg: toDesktopSurface(dominantSurface),
    mobileSurfaceBg: toMobileSurface(dominantSurface),
    desktopAccent: toDesktopAccent(dominantAccentFamily),
    mobileAccent: toMobileAccent(dominantAccentFamily),
    motion: dominantMotion,
  };

  const warnings: VisualConsistencyWarning[] = [];

  // Intra-page chromatic clash check applies even on single-page projects.
  for (const p of profiles) {
    if (
      p.hasDarkBriefCard &&
      !GREEN_HARMONIC_ACCENTS.has(p.accent) &&
      p.surfaceBg !== 'sage_field'
    ) {
      warnings.push({
        code: 'dark-brief-clash',
        pageIds: [p.pageId],
        message: tr(
          `页面「${p.title}」(${p.pageId}) 当前使用 ${p.surfaceBg} + ${p.accent} 色系，但内部混用了森林青柠配色的 tone="dark_brief" 洞察卡。建议改用 ${p.platform === 'mobile' ? 'MAiInsightCard tone="glow"' : 'AiCopilotCard tone="indigo"'}，由顶部反色指标卡承担深色焦点，保持全页色温统一。`,
          `Page "${p.title}" (${p.pageId}) uses ${p.surfaceBg} + ${p.accent} with a forest-lime tone="dark_brief" card. Prefer ${p.platform === 'mobile' ? 'MAiInsightCard tone="glow"' : 'AiCopilotCard tone="indigo"'} so the page palette stays unified.`,
        ),
      });
    }
  }

  // Cross-page drift checks run only when >1 page exists and at least one page explicitly chose a visual token.
  if (profiles.length > 1 && anyExplicitVisualProp) {
    const accentGroups = new Map<string, PageVisualProfile[]>();
    for (const p of profiles) {
      // Unstyled default PC ('blue') + unstyled default Mobile ('gemini') with zero explicit accents on any page is skipped by anyExplicitVisualProp;
      // once explicit accents are in play, compare canonical accent families across all pages.
      const fam = canonicalAccentFamily(p.accent);
      const list = accentGroups.get(fam) ?? [];
      list.push(p);
      accentGroups.set(fam, list);
    }
    // Special case: if nobody set explicitAccent anywhere (only surfaceBg/appearance was set), don't flag default PC blue vs default Mobile gemini.
    const anyExplicitAccent = profiles.some((p) => p.explicitAccent !== null);
    if (anyExplicitAccent && accentGroups.size > 1) {
      const detail = profiles.map((p) => `${p.pageId}(${p.accent})`).join(', ');
      warnings.push({
        code: 'accent-drift',
        pageIds: profiles.map((p) => p.pageId),
        message: tr(
          `跨页品牌主色不一致：检测到多套 accent（${detail}）。同一产品应锁定唯一主色系（当前基线建议：PC accent="${dominant.desktopAccent}" / 移动 accent="${dominant.mobileAccent}"），避免切页换色形成拼盘感。`,
          `Cross-page accent drift detected (${detail}). Lock a single brand accent across the project (recommended baseline: desktop accent="${dominant.desktopAccent}" / mobile accent="${dominant.mobileAccent}").`,
        ),
      });
    }

    const surfaceGroups = new Set(profiles.map((p) => canonicalSurfaceFamily(p.surfaceBg)));
    // Allow Desktop `aurora` paired exclusively with Mobile `mist` since MobilePage has no `aurora` enum.
    const isCompatibleAuroraMistPair =
      surfaceGroups.size === 2 &&
      surfaceGroups.has('aurora') &&
      surfaceGroups.has('mist') &&
      profiles.every(
        (p) =>
          (p.platform === 'desktop' && p.surfaceBg === 'aurora') ||
          (p.platform === 'mobile' && p.surfaceBg === 'mist'),
      );
    if (surfaceGroups.size > 1 && !isCompatibleAuroraMistPair) {
      const detail = profiles.map((p) => `${p.pageId}(${p.surfaceBg})`).join(', ');
      warnings.push({
        code: 'surface-drift',
        pageIds: profiles.map((p) => p.pageId),
        message: tr(
          `跨页底布色阶跳变：检测到多种 surfaceBg（${detail}）。同一工程各页面应复用同源底布（当前基线建议：PC surfaceBg="${dominant.desktopSurfaceBg}" / 移动 surfaceBg="${dominant.mobileSurfaceBg}"）。`,
          `Cross-page surfaceBg drift detected (${detail}). Keep a unified canvas atmosphere across sibling pages (recommended: desktop "${dominant.desktopSurfaceBg}" / mobile "${dominant.mobileSurfaceBg}").`,
        ),
      });
    }

    const hasExplicitLight = profiles.some((p) => p.effectiveMode === 'light');
    const hasExplicitDark = profiles.some((p) => p.effectiveMode === 'dark');
    if (hasExplicitLight && hasExplicitDark) {
      const detail = profiles.map((p) => `${p.pageId}(${p.effectiveMode})`).join(', ');
      warnings.push({
        code: 'appearance-drift',
        pageIds: profiles.map((p) => p.pageId),
        message: tr(
          `跨页明暗外观分裂：部分页面为浅色、部分页面为深色（${detail}）。除非用户明确要求独立的夜间/大屏子端，否则全工程应统一 appearance="${dominant.appearance}" 并通过局部反色主卡（tone="inverted" / MHeroHeader）建立焦点对比。`,
          `Cross-page light/dark split detected (${detail}). Unless a dedicated dark wallboard/night terminal was explicitly requested, keep a unified appearance across pages and use localized inverted hero cards for contrast.`,
        ),
      });
    }
  }

  return {
    established: anyExplicitVisualProp,
    dominant,
    pages: profiles,
    warnings,
  };
}
