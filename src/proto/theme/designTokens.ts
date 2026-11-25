import antdTheme from 'antd/es/theme';
import type { ThemeConfig } from 'antd/es/config-provider/context';
import { tr, type Locale } from '../../i18n/runtime';

export type DesignPresetId = 'classic_antd' | 'modern_minimal' | 'collab_soft' | 'enterprise_compact';
export type DesignRadiusToken = 'sharp' | 'rounded' | 'generous';
export type DesignDensityToken = 'compact' | 'comfortable' | 'spacious';
export type DesignSurfaceToken = 'bordered' | 'subtle' | 'elevated';
export type DesignColorMode = 'auto' | 'light' | 'dark';

export interface ProjectDesignTokens {
  preset: DesignPresetId;
  primaryColor?: string;
  radius?: DesignRadiusToken;
  density?: DesignDensityToken;
  surfaceVariant?: DesignSurfaceToken;
  colorMode?: DesignColorMode;
}

export interface ResolvedDesignTokens {
  preset: DesignPresetId;
  primaryColor: string;
  radius: DesignRadiusToken;
  radiusPx: number;
  cardRadiusPx: number;
  density: DesignDensityToken;
  fontSizePx: number;
  surfaceVariant: DesignSurfaceToken;
  colorMode: DesignColorMode;
}

export const DESIGN_PRESET_IDS: readonly DesignPresetId[] = [
  'classic_antd',
  'modern_minimal',
  'collab_soft',
  'enterprise_compact',
];
export const DESIGN_RADIUS_TOKENS: readonly DesignRadiusToken[] = ['sharp', 'rounded', 'generous'];
export const DESIGN_DENSITY_TOKENS: readonly DesignDensityToken[] = ['compact', 'comfortable', 'spacious'];
export const DESIGN_SURFACE_TOKENS: readonly DesignSurfaceToken[] = ['bordered', 'subtle', 'elevated'];
export const DESIGN_COLOR_MODES: readonly DesignColorMode[] = ['auto', 'light', 'dark'];

interface PresetDefinition {
  id: DesignPresetId;
  nameZh: string;
  nameEn: string;
  descZh: string;
  descEn: string;
  defaults: Omit<ResolvedDesignTokens, 'radiusPx' | 'cardRadiusPx' | 'fontSizePx'>;
}

export const DESIGN_PRESETS: Record<DesignPresetId, PresetDefinition> = {
  classic_antd: {
    id: 'classic_antd',
    nameZh: '经典企业蓝白',
    nameEn: 'Classic Enterprise',
    descZh: '标准中后台稳重配色与清晰线框，适合政企与通用管理系统',
    descEn: 'Balanced enterprise blue palette with crisp borders for standard admin portals',
    defaults: {
      preset: 'classic_antd',
      primaryColor: '#2563eb',
      radius: 'rounded',
      density: 'comfortable',
      surfaceVariant: 'bordered',
      colorMode: 'auto',
    },
  },
  modern_minimal: {
    id: 'modern_minimal',
    nameZh: '现代极简 SaaS',
    nameEn: 'Modern Minimal SaaS',
    descZh: '高对比黑白灰主调与微阴影层次（类 Linear / Shadcn 风格），适合 AI 与创新 SaaS 产品',
    descEn: 'High-contrast zinc palette with subtle elevation (Linear / Shadcn aesthetic)',
    defaults: {
      preset: 'modern_minimal',
      primaryColor: '#18181b',
      radius: 'rounded',
      density: 'comfortable',
      surfaceVariant: 'elevated',
      colorMode: 'auto',
    },
  },
  collab_soft: {
    id: 'collab_soft',
    nameZh: '柔和协同效率',
    nameEn: 'Soft Collaborative',
    descZh: '大圆角与柔和浅底色块弱化硬边框（类飞书/现代工作台），降低视觉疲劳',
    descEn: 'Generous corner radii and soft surface fills inspired by modern collaborative suites',
    defaults: {
      preset: 'collab_soft',
      primaryColor: '#4f46e5',
      radius: 'generous',
      density: 'spacious',
      surfaceVariant: 'subtle',
      colorMode: 'auto',
    },
  },
  enterprise_compact: {
    id: 'enterprise_compact',
    nameZh: '高密专业业财',
    nameEn: 'Compact Finance & ERP',
    descZh: '紧凑行高、利落小圆角与高信息密度排布，适合财务、报关、供应链重单据场景',
    descEn: 'High-density compact controls and sharp corners for ERP, customs, and financial ledgers',
    defaults: {
      preset: 'enterprise_compact',
      primaryColor: '#0284c7',
      radius: 'sharp',
      density: 'compact',
      surfaceVariant: 'bordered',
      colorMode: 'auto',
    },
  },
};

export const BRAND_COLOR_SWATCHES = [
  '#2563eb',
  '#18181b',
  '#4f46e5',
  '#0284c7',
  '#059669',
  '#d97706',
  '#e11d48',
  '#7c3aed',
];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isDefaultDesignTokens(tokens?: ProjectDesignTokens | null): boolean {
  if (!tokens) return true;
  const r = resolveDesignTokens(tokens);
  const def = DESIGN_PRESETS.classic_antd.defaults;
  return (
    r.preset === def.preset &&
    r.primaryColor.toLowerCase() === def.primaryColor.toLowerCase() &&
    r.radius === def.radius &&
    r.density === def.density &&
    r.surfaceVariant === def.surfaceVariant &&
    r.colorMode === def.colorMode
  );
}

export function validateDesignTokens(value: unknown, path = 'designTokens'): asserts value is ProjectDesignTokens {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(tr(`${path} 必须是对象`, `${path} must be an object`));
  }
  const v = value as Record<string, unknown>;
  const allowedKeys = new Set(['preset', 'primaryColor', 'radius', 'density', 'surfaceVariant', 'colorMode']);
  for (const key of Object.keys(v)) {
    if (!allowedKeys.has(key)) {
      throw new Error(tr(`${path}.${key} 不是受支持的设计令牌字段`, `${path}.${key} is not a supported design token field`));
    }
  }
  if (typeof v.preset !== 'string' || !DESIGN_PRESET_IDS.includes(v.preset as DesignPresetId)) {
    throw new Error(tr(`${path}.preset 无效`, `${path}.preset is invalid`));
  }
  if (v.primaryColor !== undefined && (typeof v.primaryColor !== 'string' || !HEX_COLOR_RE.test(v.primaryColor))) {
    throw new Error(tr(`${path}.primaryColor 必须是 6 位十六进制颜色（如 #2563eb）`, `${path}.primaryColor must be a 6-digit hex color (e.g. #2563eb)`));
  }
  if (v.radius !== undefined && (typeof v.radius !== 'string' || !DESIGN_RADIUS_TOKENS.includes(v.radius as DesignRadiusToken))) {
    throw new Error(tr(`${path}.radius 无效`, `${path}.radius is invalid`));
  }
  if (v.density !== undefined && (typeof v.density !== 'string' || !DESIGN_DENSITY_TOKENS.includes(v.density as DesignDensityToken))) {
    throw new Error(tr(`${path}.density 无效`, `${path}.density is invalid`));
  }
  if (
    v.surfaceVariant !== undefined &&
    (typeof v.surfaceVariant !== 'string' || !DESIGN_SURFACE_TOKENS.includes(v.surfaceVariant as DesignSurfaceToken))
  ) {
    throw new Error(tr(`${path}.surfaceVariant 无效`, `${path}.surfaceVariant is invalid`));
  }
  if (v.colorMode !== undefined && (typeof v.colorMode !== 'string' || !DESIGN_COLOR_MODES.includes(v.colorMode as DesignColorMode))) {
    throw new Error(tr(`${path}.colorMode 无效`, `${path}.colorMode is invalid`));
  }
}

export function resolveDesignTokens(tokens?: ProjectDesignTokens | null): ResolvedDesignTokens {
  const presetId: DesignPresetId =
    tokens?.preset && DESIGN_PRESET_IDS.includes(tokens.preset) ? tokens.preset : 'classic_antd';
  const base = DESIGN_PRESETS[presetId].defaults;
  const radius = tokens?.radius && DESIGN_RADIUS_TOKENS.includes(tokens.radius) ? tokens.radius : base.radius;
  const density = tokens?.density && DESIGN_DENSITY_TOKENS.includes(tokens.density) ? tokens.density : base.density;
  const surfaceVariant =
    tokens?.surfaceVariant && DESIGN_SURFACE_TOKENS.includes(tokens.surfaceVariant)
      ? tokens.surfaceVariant
      : base.surfaceVariant;
  const colorMode =
    tokens?.colorMode && DESIGN_COLOR_MODES.includes(tokens.colorMode) ? tokens.colorMode : base.colorMode;
  const primaryColor =
    tokens?.primaryColor && HEX_COLOR_RE.test(tokens.primaryColor) ? tokens.primaryColor.toLowerCase() : base.primaryColor;

  const radiusPx = radius === 'sharp' ? 4 : radius === 'generous' ? 12 : presetId === 'modern_minimal' ? 8 : 6;
  const cardRadiusPx = radius === 'sharp' ? 6 : radius === 'generous' ? 16 : 12;
  const fontSizePx = density === 'compact' ? 12 : density === 'spacious' ? 14 : 13;

  return {
    preset: presetId,
    primaryColor,
    radius,
    radiusPx,
    cardRadiusPx,
    density,
    fontSizePx,
    surfaceVariant,
    colorMode,
  };
}

export function effectiveCanvasColorMode(
  tokens: ProjectDesignTokens | null | undefined,
  hostMode: 'light' | 'dark',
): 'light' | 'dark' {
  const resolved = resolveDesignTokens(tokens);
  return resolved.colorMode === 'auto' ? hostMode : resolved.colorMode;
}

export function buildAntdThemeConfig(
  tokens: ProjectDesignTokens | null | undefined,
  effectiveMode: 'light' | 'dark',
): ThemeConfig {
  const r = resolveDesignTokens(tokens);
  const algorithms = [effectiveMode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm];
  if (r.density === 'compact') {
    algorithms.push(antdTheme.compactAlgorithm);
  }
  // In dark mode, pure near-black primary (#18181b) becomes invisible on dark surfaces; lift to crisp indigo/slate
  const effectivePrimary =
    effectiveMode === 'dark' && r.primaryColor.toLowerCase() === '#18181b' ? '#818cf8' : r.primaryColor;

  return {
    algorithm: algorithms.length === 1 ? algorithms[0] : algorithms,
    token: {
      colorPrimary: effectivePrimary,
      borderRadius: r.radiusPx,
      fontSize: r.fontSizePx,
      ...(effectiveMode === 'dark'
        ? {
            colorBgContainer: '#141417',
            colorBgElevated: '#1e1e22',
            colorBorder: '#333338',
            colorBorderSecondary: '#27272a',
          }
        : r.preset === 'modern_minimal'
        ? {
            colorBgContainer: '#ffffff',
            colorBorder: '#e4e4e7',
            colorBorderSecondary: '#f4f4f5',
          }
        : r.preset === 'collab_soft'
        ? {
            colorBgContainer: '#ffffff',
            colorBorder: '#e2e8f0',
            colorBorderSecondary: '#f1f5f9',
          }
        : {}),
    },
  };
}

export function buildScopedCssVariables(
  tokens: ProjectDesignTokens | null | undefined,
  effectiveMode: 'light' | 'dark',
): Record<string, string> {
  const r = resolveDesignTokens(tokens);
  const dark = effectiveMode === 'dark';
  const effectivePrimary = dark && r.primaryColor.toLowerCase() === '#18181b' ? '#818cf8' : r.primaryColor;
  return {
    '--pf-color-scheme': effectiveMode,
    '--pf-primary': effectivePrimary,
    '--pf-radius-control': `${r.radiusPx}px`,
    '--pf-radius-card': `${r.cardRadiusPx}px`,
    '--pf-font-size': `${r.fontSizePx}px`,
    '--pf-bg-layout': dark ? '#09090b' : r.preset === 'collab_soft' ? '#f4f6fb' : r.preset === 'modern_minimal' ? '#fafafa' : '#f8fafc',
    '--pf-bg-container': dark ? '#141417' : '#ffffff',
    '--pf-border': dark ? '#27272a' : r.preset === 'modern_minimal' ? '#e4e4e7' : '#e2e8f0',
    '--pf-border-secondary': dark ? '#1f1f23' : '#f1f5f9',
    '--pf-text': dark ? '#f4f4f5' : '#0f172a',
    '--pf-text-secondary': dark ? '#a1a1aa' : '#64748b',
  };
}

export function exportDesignTokensSpec(tokens?: ProjectDesignTokens | null, locale?: Locale) {
  const r = resolveDesignTokens(tokens);
  const presetMeta = DESIGN_PRESETS[r.preset];
  return {
    preset: r.preset,
    presetLabel: locale === 'en-US' ? presetMeta.nameEn : presetMeta.nameZh,
    tokens: r,
    cssVariables: {
      light: buildScopedCssVariables(tokens, 'light'),
      dark: buildScopedCssVariables(tokens, 'dark'),
    },
    antdThemeToken: {
      colorPrimary: r.primaryColor,
      borderRadius: r.radiusPx,
      fontSize: r.fontSizePx,
      compact: r.density === 'compact',
    },
  };
}
