import React, { useEffect, useRef, useState } from 'react';
import { Palette, RotateCcw } from 'lucide-react';
import { useProtoStore } from '../../store/useProtoStore';
import {
  BRAND_COLOR_SWATCHES,
  DESIGN_PRESETS,
  DESIGN_PRESET_IDS,
  isDefaultDesignTokens,
  resolveDesignTokens,
  type DesignColorMode,
  type DesignDensityToken,
  type DesignPresetId,
  type DesignRadiusToken,
  type ProjectDesignTokens,
} from '../theme/designTokens';
import {
  countPinnedAppearancePages,
  unlockProjectAppearanceToFollowTheme,
} from '../theme/unlockCanvasAppearance';
import { usePageStore } from '../store/usePageStore';
import { useI18n } from '../../i18n';

export const DesignTokensPopover: React.FC = () => {
  const { tr, isEn } = useI18n();
  const designTokens = useProtoStore((s) => s.designTokens);
  const setDesignTokens = useProtoStore((s) => s.setDesignTokens);
  const pageSources = usePageStore((s) => s.pageSources);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const resolved = resolveDesignTokens(designTokens);
  const customized = !isDefaultDesignTokens(designTokens);
  const pinnedPageCount = open ? countPinnedAppearancePages(pageSources) : 0;

  const patchTokens = (patch: Partial<ProjectDesignTokens>) => {
    const next: ProjectDesignTokens = {
      preset: patch.preset ?? resolved.preset,
      primaryColor: patch.primaryColor ?? designTokens?.primaryColor,
      radius: patch.radius ?? designTokens?.radius,
      density: patch.density ?? designTokens?.density,
      surfaceVariant: patch.surfaceVariant ?? designTokens?.surfaceVariant,
      colorMode: patch.colorMode ?? designTokens?.colorMode,
    };
    if (patch.colorMode === 'auto') {
      delete next.colorMode;
      setDesignTokens(isDefaultDesignTokens(next) ? null : next);
      unlockProjectAppearanceToFollowTheme();
      return;
    }
    setDesignTokens(isDefaultDesignTokens(next) ? null : next);
  };

  const selectPreset = (preset: DesignPresetId) => {
    const next: ProjectDesignTokens = {
      preset,
      ...(designTokens?.colorMode ? { colorMode: designTokens.colorMode } : {}),
    };
    setDesignTokens(isDefaultDesignTokens(next) ? null : next);
  };

  return (
    <div ref={wrapRef} className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="design-tokens-trigger"
        title={tr('配置目标原型的品牌主题、圆角与信息密度（仅作用于画布与分享演示，不影响编辑器外壳）', 'Configure canvas-scoped Design Tokens (brand color, radius, density)')}
        className={`h-7 px-2 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition ${
          customized
            ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
        }`}
      >
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/10"
          style={{ backgroundColor: resolved.primaryColor }}
        />
        <Palette className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden xl:inline">
          {isEn ? DESIGN_PRESETS[resolved.preset].nameEn.split(' ')[0] : DESIGN_PRESETS[resolved.preset].nameZh.slice(0, 4)}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={tr('画布品牌主题令牌', 'Canvas Design Tokens')}
          className="absolute top-full right-0 mt-1.5 z-50 w-[308px] rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl space-y-3 text-slate-800"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-slate-900">
                {tr('画布主题令牌 (Design Tokens)', 'Canvas Design Tokens')}
              </div>
              <div className="text-[10.5px] text-slate-500">
                {tr('仅作用于原型画布与发布页，编辑器界面保持隔离', 'Scoped strictly to prototype canvas & viewer')}
              </div>
            </div>
            {customized && (
              <button
                type="button"
                onClick={() => setDesignTokens(null)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{tr('默认', 'Reset')}</span>
              </button>
            )}
          </div>

          {/* 4 Curated Industry Presets */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-600">{tr('行业视觉预设', 'Style Preset')}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {DESIGN_PRESET_IDS.map((pid) => {
                const meta = DESIGN_PRESETS[pid];
                const active = resolved.preset === pid;
                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => selectPreset(pid)}
                    className={`rounded-lg border p-2 text-left transition cursor-pointer ${
                      active
                        ? 'border-blue-600 bg-blue-50/70 ring-1 ring-blue-600/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: meta.defaults.primaryColor }}
                      />
                      <span className="text-[11.5px] font-semibold text-slate-900 truncate">
                        {isEn ? meta.nameEn : meta.nameZh}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500 line-clamp-2 leading-snug">
                      {isEn ? meta.descEn : meta.descZh}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Brand Primary Swatches */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-600">{tr('品牌主色', 'Brand Primary')}</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {BRAND_COLOR_SWATCHES.map((hex) => {
                const active = resolved.primaryColor.toLowerCase() === hex.toLowerCase();
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={hex}
                    onClick={() => patchTokens({ primaryColor: hex })}
                    className={`w-6 h-6 rounded-full transition cursor-pointer ${
                      active ? 'ring-2 ring-offset-2 ring-blue-600 scale-105' : 'hover:scale-105 ring-1 ring-black/10'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                );
              })}
            </div>
          </div>

          {/* Density & Radius & Color Mode */}
          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100">
            <div className="space-y-1">
              <div className="text-[10.5px] font-medium text-slate-500">{tr('圆角', 'Radius')}</div>
              <select
                value={resolved.radius}
                onChange={(e) => patchTokens({ radius: e.target.value as DesignRadiusToken })}
                className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-800"
              >
                <option value="sharp">{tr('利落 4px', 'Sharp')}</option>
                <option value="rounded">{tr('标准 8px', 'Rounded')}</option>
                <option value="generous">{tr('柔和 12px', 'Generous')}</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-[10.5px] font-medium text-slate-500">{tr('密度', 'Density')}</div>
              <select
                value={resolved.density}
                onChange={(e) => patchTokens({ density: e.target.value as DesignDensityToken })}
                className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-800"
              >
                <option value="compact">{tr('紧凑业财', 'Compact')}</option>
                <option value="comfortable">{tr('标准舒适', 'Default')}</option>
                <option value="spacious">{tr('呼吸舒展', 'Spacious')}</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-[10.5px] font-medium text-slate-500">{tr('画布明暗', 'Canvas Mode')}</div>
              <select
                value={resolved.colorMode}
                onChange={(e) => patchTokens({ colorMode: e.target.value as DesignColorMode })}
                className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-800"
              >
                <option value="auto">{tr('跟随外框主题', 'Follow Theme')}</option>
                <option value="light">{tr('固定浅色', 'Light')}</option>
                <option value="dark">{tr('固定深色', 'Dark')}</option>
              </select>
            </div>
          </div>

          {pinnedPageCount > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-2 flex items-center justify-between gap-2 text-[11px] text-amber-900">
              <span className="min-w-0">
                {tr(
                  `有 ${pinnedPageCount} 个页面写死了固定明暗`,
                  `${pinnedPageCount} page(s) pin explicit light/dark`,
                )}
              </span>
              <button
                type="button"
                onClick={() => unlockProjectAppearanceToFollowTheme()}
                className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[10.5px] font-medium text-amber-900 hover:bg-amber-100 cursor-pointer"
              >
                {tr('改为跟随主题', 'Follow Theme')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
