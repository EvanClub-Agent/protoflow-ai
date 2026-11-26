import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureMode } from '../../capture/CaptureMode';
import type { EChartsType } from 'echarts/core';
import type { CompProps } from '../registry/components';
import { useResolvedTheme } from '../registry/AntdSurface';
import { MobileThemeContext } from '../mobile/components';
import { useCanvasTheme, useInsideCardBody } from '../theme/ProtoCanvasThemeScope';
import { usePageStore } from '../store/usePageStore';
import { PreviewDataContext, useMaterialTables } from '../runtime/PreviewData';
import { chartConfigErrors, prepareChartData, resolveChartEvent, type ChartType } from './model';
import { buildChartOption, chartClickPoint } from './options';
import { useUIStackState } from '../runtime/uiStackLens';
import { useI18n } from '../../i18n';

export const ChartMaterial: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { tr, td } = useI18n();
  const capturing = useContext(CaptureMode);
  const uiState = useUIStackState();
  const tables = useMaterialTables();
  const preview = useContext(PreviewDataContext);
  const savedRows = usePageStore(s => s.tableRows);
  const workspaceDark = useResolvedTheme() === 'dark';
  const canvasTheme = useCanvasTheme();
  const insideCard = useInsideCardBody();
  const mobileTheme = useContext(MobileThemeContext);
  const isDark = mobileTheme ? mobileTheme.isDark : canvasTheme ? canvasTheme.effectiveMode === 'dark' : workspaceDark;
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const prepared = useMemo(() => {
    try {
      const type = node.type as ChartType;
      const errors = chartConfigErrors(type, node.props, tables);
      if (errors.length) throw new Error(errors.join('；'));
      if (uiState === 'empty') {
        return {
          type,
          props: node.props,
          dataset: { data: [], dimension: String(node.props.dimension ?? 'category'), metrics: [] },
          error: null,
        };
      }
      const rawRows = p.source === 'table' ? (preview ? preview.rows[p.table] : savedRows[p.table]) : p.data;
      const dataset = prepareChartData(type, node.props, rawRows);
      return { type, props: node.props, dataset, error: null };
    } catch (e) { return { dataset: null, error: e instanceof Error ? e.message : String(e) }; }
  }, [node.type, node.props, tables, preview, savedRows, uiState]);
  const applied = useRef<typeof prepared | null>(null);
  const latest = useRef({ prepared, isDark, p, rt, scope });
  latest.current = { prepared, isDark, p, rt, scope };
  const renderable = !!prepared.dataset?.data.length;

  function applyOptions(instance: EChartsType) {
    const { prepared: config, isDark: dark } = latest.current;
    if (!config.dataset) return;
    const option = buildChartOption(config.type, config.props, config.dataset, dark);
    if (capturing) {
      option.animation = false;
      if (Array.isArray(option.series)) option.series = option.series.map(series => ({ ...series, progressive: 0 }));
    }
    // Replace stale series when the data/config changes. Merge theme updates
    // into the live model to preserve zoom, legend and visual-map selections.
    instance.setOption(option, { notMerge: applied.current !== config });
    if (capturing) instance.getZr().flush();
    applied.current = config;
  }

  useEffect(() => {
    if (!renderable || !host.current) return;
    let cancelled = false, pendingResize = 0;
    const element = host.current;
    let resize = () => {};
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(pendingResize);
      pendingResize = requestAnimationFrame(() => resize());
    });
    observer.observe(element);
    setReady(false); setError(null);
    void import('./engine').then(({ echarts }) => {
      if (cancelled) return;
      resize = () => {
        if (cancelled || element.clientWidth === 0 || element.clientHeight === 0) return;
        try {
          if (!chart.current) {
            const instance = echarts.init(element, undefined, { renderer: 'canvas' });
            chart.current = instance;
            instance.on('click', event => {
              const { p: current, rt: runtime, scope: currentScope } = latest.current;
              const point = chartClickPoint(event);
              if (!point || runtime.isDesign || !current.onClick) return;
              try { void runtime.run(resolveChartEvent(current.onClick, point), currentScope).catch(e => setError(String(e))); }
              catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            });
            applyOptions(instance);
            setReady(true);
          } else chart.current.resize();
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      };
      resize();
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; observer.disconnect(); cancelAnimationFrame(pendingResize); chart.current?.dispose(); chart.current = null; };
  }, [renderable, attempt]);

  useEffect(() => {
    if (!chart.current) return;
    try {
      applyOptions(chart.current);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [prepared, isDark]);

  const rawMessage = prepared.error ?? error;
  const message = rawMessage ? td(rawMessage) : null;
  const wrapperCls = mobileTheme
    ? `relative min-w-0 w-full rounded-[22px] p-4 ${mobileTheme.cardBg} ${root.className ?? ''}`
    : insideCard
    ? `relative min-w-0 w-full rounded-xl p-0 ${root.className ?? ''}`
    : isDark
    ? `relative min-w-0 w-full rounded-[18px] bg-[#16181D] ring-1 ring-inset ring-white/[0.08] shadow-[0_8px_24px_-10px_rgba(0,0,0,0.65)] p-4 ${root.className ?? ''}`
    : `relative min-w-0 w-full rounded-[18px] bg-white ring-1 ring-inset ring-slate-900/[0.06] shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)] p-4 ${root.className ?? ''}`;
  const titleCls = mobileTheme
    ? `min-w-0 truncate text-[13.5px] font-semibold ${mobileTheme.textPrimary}`
    : isDark
    ? 'min-w-0 truncate text-[13px] font-semibold text-zinc-100'
    : 'min-w-0 truncate text-[13px] font-semibold text-slate-800';
  const badgeCls = mobileTheme
    ? `shrink-0 text-[10.5px] ${mobileTheme.textMuted}`
    : isDark
    ? 'shrink-0 text-[10px] text-zinc-500'
    : 'shrink-0 text-[10px] text-slate-400';
  const alertCls = isDark
    ? 'rounded-2xl bg-amber-500/15 ring-1 ring-inset ring-amber-400/25 p-4 text-xs leading-relaxed text-amber-200'
    : 'rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200/80 p-4 text-xs leading-relaxed text-amber-800';
  const emptyCls = mobileTheme
    ? `flex items-center justify-center text-xs ${mobileTheme.textMuted}`
    : isDark
    ? 'flex items-center justify-center text-xs text-zinc-500'
    : 'flex items-center justify-center text-xs text-slate-400';
  const loadingCls = mobileTheme && mobileTheme.isDark
    ? 'absolute inset-0 rounded-[22px] flex items-center justify-center bg-[#1E1F20]/85 text-xs text-[#9AA0A6]'
    : isDark
    ? 'absolute inset-0 rounded-xl flex items-center justify-center bg-[#16181D]/85 text-xs text-zinc-400'
    : 'absolute inset-0 rounded-xl flex items-center justify-center bg-white/80 text-xs text-slate-500';
  const showHeaderRow = Boolean(p.title) || !insideCard || rt.isDesign;
  return <section {...root} className={wrapperCls} data-inside-card={insideCard ? '1' : undefined} data-chart-type={node.type} data-chart-status={message ? 'error' : renderable ? ready ? 'ready' : 'loading' : 'empty'}>
    {showHeaderRow && (
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className={titleCls}>{p.title}</h3>
        {(!insideCard || rt.isDesign) && (
          <span className={badgeCls}>{p.source === 'sample' ? tr('示例数据', 'Sample Data') : p.source === 'inline' ? tr('自定义数据', 'Inline Data') : tr('工程预览数据', 'Project Data')}</span>
        )}
      </div>
    )}
    {renderable && <div ref={host} role="img" aria-label={typeof p.title === 'string' ? p.title : tr('数据图表', 'Chart')} style={{ width: '100%', height: typeof p.height === 'number' ? p.height : 320, pointerEvents: rt.isDesign ? 'none' : 'auto' }} />}
    {message ? <div role="alert" className={alertCls}><p className="font-medium">{tr('图表需要调整', 'Chart Needs Adjustment')}</p><p className="mt-1 break-words">{message}</p>{!prepared.error && <button type="button" className="mt-2 underline cursor-pointer" onClick={() => setAttempt(n => n + 1)}>{tr('重新加载图表', 'Reload Chart')}</button>}</div>
      : !renderable ? <div className={emptyCls} style={{ height: typeof p.height === 'number' ? p.height : 320 }}>{tr('暂无可展示的数据', 'No data to display')}</div>
      : !ready && <div className={loadingCls}>{tr('正在准备图表…', 'Preparing chart…')}</div>}
  </section>;
};
