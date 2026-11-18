import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsType } from 'echarts/core';
import type { CompProps } from '../registry/components';
import { useResolvedTheme } from '../registry/AntdSurface';
import { MobileThemeContext } from '../mobile/components';
import { usePageStore } from '../store/usePageStore';
import { PreviewDataContext, useMaterialTables } from '../runtime/PreviewData';
import { chartConfigErrors, prepareChartData, resolveChartEvent, type ChartType } from './model';
import { buildChartOption, chartClickPoint } from './options';

export const ChartMaterial: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const tables = useMaterialTables();
  const preview = useContext(PreviewDataContext);
  const savedRows = usePageStore(s => s.tableRows);
  const workspaceDark = useResolvedTheme() === 'dark';
  const mobileTheme = useContext(MobileThemeContext);
  const isDark = mobileTheme ? mobileTheme.isDark : workspaceDark;
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
      const rows = p.source === 'table' ? (preview ? preview.rows[p.table] : savedRows[p.table]) : p.data;
      const dataset = prepareChartData(type, node.props, rows);
      return { type, props: node.props, dataset, error: null };
    } catch (e) { return { dataset: null, error: e instanceof Error ? e.message : String(e) }; }
  }, [node.type, node.props, tables, preview, savedRows]);
  const applied = useRef<typeof prepared | null>(null);
  const latest = useRef({ prepared, isDark, p, rt, scope });
  latest.current = { prepared, isDark, p, rt, scope };
  const renderable = !!prepared.dataset?.data.length;

  function applyOptions(instance: EChartsType) {
    const { prepared: config, isDark: dark } = latest.current;
    if (!config.dataset) return;
    const option = buildChartOption(config.type, config.props, config.dataset, dark);
    // Replace stale series when the data/config changes. Merge theme updates
    // into the live model to preserve zoom, legend and visual-map selections.
    instance.setOption(option, { notMerge: applied.current !== config });
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

  const message = prepared.error ?? error;
  const wrapperCls = mobileTheme
    ? `relative min-w-0 w-full rounded-[22px] p-4 ${mobileTheme.cardBg} ${root.className ?? ''}`
    : `relative min-w-0 w-full rounded-xl border border-slate-200 bg-white p-4 ${root.className ?? ''}`;
  const titleCls = mobileTheme ? `min-w-0 truncate text-[13.5px] font-semibold ${mobileTheme.textPrimary}` : 'min-w-0 truncate text-[13px] font-semibold text-slate-800';
  const badgeCls = mobileTheme ? `shrink-0 text-[10.5px] ${mobileTheme.textMuted}` : 'shrink-0 text-[10px] text-slate-400';
  const alertCls = mobileTheme && mobileTheme.isDark
    ? 'rounded-2xl bg-amber-500/15 ring-1 ring-inset ring-amber-400/25 p-4 text-xs leading-relaxed text-amber-200'
    : 'rounded-lg bg-amber-50 p-4 text-xs leading-relaxed text-amber-800';
  const emptyCls = mobileTheme ? `flex items-center justify-center text-xs ${mobileTheme.textMuted}` : 'flex items-center justify-center text-xs text-slate-400';
  const loadingCls = mobileTheme && mobileTheme.isDark
    ? 'absolute inset-0 rounded-[22px] flex items-center justify-center bg-[#1E1F20]/85 text-xs text-[#9AA0A6]'
    : 'absolute inset-0 flex items-center justify-center bg-white/80 text-xs text-slate-500';
  return <section {...root} className={wrapperCls} data-chart-type={node.type} data-chart-status={message ? 'error' : renderable ? ready ? 'ready' : 'loading' : 'empty'}>
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className={titleCls}>{p.title}</h3>
      <span className={badgeCls}>{p.source === 'sample' ? '示例数据' : p.source === 'inline' ? '自定义数据' : '工程预览数据'}</span>
    </div>
    {renderable && <div ref={host} role="img" aria-label={typeof p.title === 'string' ? p.title : '数据图表'} style={{ width: '100%', height: typeof p.height === 'number' ? p.height : 320, pointerEvents: rt.isDesign ? 'none' : 'auto' }} />}
    {message ? <div role="alert" className={alertCls}><p className="font-medium">图表需要调整</p><p className="mt-1 break-words">{message}</p>{!prepared.error && <button type="button" className="mt-2 underline cursor-pointer" onClick={() => setAttempt(n => n + 1)}>重新加载图表</button>}</div>
      : !renderable ? <div className={emptyCls} style={{ height: typeof p.height === 'number' ? p.height : 320 }}>暂无可展示的数据</div>
      : !ready && <div className={loadingCls}>正在准备图表…</div>}
  </section>;
};
