import React from 'react';
import { Languages } from 'lucide-react';
import { useI18n } from '../i18n';

export interface LanguageSwitchProps {
  /** Render a slightly wider pill with full label for standalone headers / welcome screen */
  variant?: 'icon' | 'pill';
  /** Tooltip horizontal alignment to avoid viewport edge clipping */
  tooltipAlign?: 'left' | 'center' | 'right';
}

export const LanguageSwitch: React.FC<LanguageSwitchProps> = ({
  variant = 'icon',
  tooltipAlign = 'right',
}) => {
  const { isEn, toggleLocale } = useI18n();

  const badgeText = isEn ? 'EN' : '中';
  const pillText = isEn ? 'EN · 中文' : '中文 · EN';
  // WCAG 2.5.3 Label in Name: include the exact visible text at the start of aria-label
  const accessibleName =
    variant === 'pill'
      ? isEn
        ? `${pillText} (Switch language to 简体中文)`
        : `${pillText}（切换界面语言至 English）`
      : isEn
      ? `${badgeText} · Switch to 简体中文`
      : `${badgeText} · 切换至 English`;

  const tooltipDesc = isEn ? 'Switch to 简体中文' : '切换界面语言至 English';
  const alignClass =
    tooltipAlign === 'left'
      ? 'left-0'
      : tooltipAlign === 'center'
      ? 'left-1/2 -translate-x-1/2'
      : 'right-0';

  if (variant === 'pill') {
    return (
      <button
        type="button"
        onClick={toggleLocale}
        aria-label={accessibleName}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium cursor-pointer transition shrink-0 whitespace-nowrap"
      >
        <Languages className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
        <span>{pillText}</span>
      </button>
    );
  }

  return (
    <div className="relative group flex items-center shrink-0">
      <button
        type="button"
        onClick={toggleLocale}
        aria-label={accessibleName}
        className="h-7 px-1.5 rounded-lg inline-flex items-center justify-center gap-0.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer transition whitespace-nowrap"
      >
        <Languages className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="text-[10px] font-semibold leading-none tracking-tight">{badgeText}</span>
      </button>
      <div
        role="tooltip"
        aria-hidden="true"
        className={`pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100 transition-all duration-150 ease-out absolute top-full ${alignClass} mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap`}
      >
        <span className="relative z-10 text-xs font-medium tracking-tight">{tooltipDesc}</span>
      </div>
    </div>
  );
};
