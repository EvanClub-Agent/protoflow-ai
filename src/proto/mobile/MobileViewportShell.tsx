import React, { useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { CaptureMode } from '../../capture/CaptureMode';
import { scopeForOverlay, type OverlayEntry } from '../runtime/runtime';
import type { ProtoNode } from '../types';
import { NodeView, ScopeProvider } from '../renderer/NodeView';
import { useResolvedTheme } from '../registry/AntdSurface';
import {
  canAnimateMobileOverlayExit,
  MobileAppearanceOverrideContext,
  MobileMotionContext,
  MobileOverlayExitContext,
  MobilePageTheme,
  MobileRuntimeFeedback,
  MobileScreenPortalContext,
  normalizeMobileMotion,
  normalizeMobileSurfaceBg,
  resolveMobileAppearance,
  type MobileAppearance,
  type MobileMotionMode,
  type MobileRuntimeFeedbackProps,
} from './components';
import { MOBILE_DEVICE_SPECS, type MobileDevicePreset } from './types';

interface RetainedOverlayItem {
  entry: OverlayEntry;
  stackIndex: number;
  closing: boolean;
}

export const MobileOverlayStack: React.FC<{
  overlays: readonly OverlayEntry[];
  resolveNode: (overlayId: string) => ProtoNode | null | undefined;
}> = ({ overlays, resolveNode }) => {
  const isCapture = useContext(CaptureMode);
  const motionMode = useContext(MobileMotionContext);
  const canAnimate = canAnimateMobileOverlayExit(isCapture, motionMode);
  const [, setExitTick] = useState(0);
  const syncedRef = useRef<RetainedOverlayItem[]>([]);

  const liveByKey = new Map(overlays.map((entry, stackIndex) => [entry.key, { entry, stackIndex }]));
  const nextList: RetainedOverlayItem[] = [];
  const seen = new Set<string>();

  for (const prev of syncedRef.current) {
    const active = liveByKey.get(prev.entry.key);
    if (active) {
      nextList.push({ entry: active.entry, stackIndex: active.stackIndex, closing: false });
      seen.add(prev.entry.key);
    } else if (canAnimate) {
      nextList.push({ entry: prev.entry, stackIndex: prev.stackIndex, closing: true });
      seen.add(prev.entry.key);
    }
  }
  for (const [key, active] of liveByKey) {
    if (!seen.has(key)) {
      nextList.push({ entry: active.entry, stackIndex: active.stackIndex, closing: false });
    }
  }
  syncedRef.current = nextList;

  const finalizeExit = useCallback((key: string) => {
    const before = syncedRef.current.length;
    syncedRef.current = syncedRef.current.filter((it) => !(it.entry.key === key && it.closing));
    if (syncedRef.current.length !== before) {
      setExitTick((t) => t + 1);
    }
  }, []);

  return (
    <>
      {nextList.map((item) => {
        const node = resolveNode(item.entry.id);
        if (!node) return null;
        return (
          <MobileOverlayExitContext.Provider
            key={item.entry.key}
            value={item.closing ? () => finalizeExit(item.entry.key) : null}
          >
            <ScopeProvider
              value={scopeForOverlay(item.entry, item.stackIndex)}
            >
              <NodeView node={node} live />
            </ScopeProvider>
          </MobileOverlayExitContext.Provider>
        );
      })}
    </>
  );
};

interface ScrollThumbState {
  visible: boolean;
  top: number;
  height: number;
}

function useViewportScrollThumb(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
): ScrollThumbState {
  const [thumb, setThumb] = useState<ScrollThumbState>({ visible: false, top: 0, height: 0 });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!enabled || !el) {
      setThumb((prev) => (prev.visible ? { visible: false, top: 0, height: 0 } : prev));
      return;
    }

    const measure = () => {
      const { clientHeight, scrollHeight, scrollTop } = el;
      if (clientHeight <= 0 || scrollHeight <= clientHeight + 1) {
        setThumb((prev) => (prev.visible ? { visible: false, top: 0, height: 0 } : prev));
        return;
      }
      const pad = 6;
      const track = Math.max(24, clientHeight - pad * 2);
      const height = Math.min(track, Math.max(28, Math.round((clientHeight / scrollHeight) * track)));
      const maxScroll = Math.max(1, scrollHeight - clientHeight);
      const ratio = Math.min(1, Math.max(0, scrollTop / maxScroll));
      const top = pad + Math.round(ratio * (track - height));
      setThumb((prev) =>
        prev.visible && prev.top === top && prev.height === height
          ? prev
          : { visible: true, top, height },
      );
    };

    measure();
    el.addEventListener('scroll', measure, { passive: true });

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            measure();
          })
        : null;
    if (ro) {
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    }

    const mo =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            if (ro && el.firstElementChild) ro.observe(el.firstElementChild);
            measure();
          })
        : null;
    mo?.observe(el, { childList: true, subtree: true });

    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [scrollRef, enabled]);

  return thumb;
}

interface MobileViewportShellProps {
  device?: MobileDevicePreset;
  appearance?: unknown;
  /** Optional canvas/viewer preview override ('light' | 'dark') without mutating DSL */
  previewAppearance?: MobileAppearance | null;
  accent?: unknown;
  surfaceBg?: unknown;
  motion?: unknown;
  /** Show outer iPhone titanium bezel, Dynamic Island & Home Indicator */
  framed?: boolean;
  /** Expand height to fit full page content instead of fixed screen scrolling */
  expandHeight?: boolean;
  /** Full-bleed mode for real mobile browsers in PublishedViewer */
  fullBleed?: boolean;
  /** Scoped overlays (MBottomSheet, MDialog, Toast, Confirm) rendered strictly inside the phone screen */
  overlaySlot?: React.ReactNode;
  /** Optional runtime toast & confirm feedback trapped inside the mobile viewport */
  runtimeFeedback?: Omit<MobileRuntimeFeedbackProps, 'topOffset'>;
  children: React.ReactNode;
}

export const MobileViewportShell: React.FC<MobileViewportShellProps> = props => {
  const workspaceTheme = useResolvedTheme();
  const isCapture = useContext(CaptureMode);
  const resolvedAppearance = resolveMobileAppearance(
    props.appearance,
    workspaceTheme,
    props.previewAppearance,
    props.surfaceBg,
  );
  const resolvedMotion = normalizeMobileMotion(props.motion);
  return (
    <MobileMotionContext.Provider value={resolvedMotion}>
      <MobileAppearanceOverrideContext.Provider value={props.previewAppearance ?? null}>
        <MobilePageTheme appearance={resolvedAppearance} accent={props.accent} surfaceBg={props.surfaceBg}>
          <ViewportFrame
            {...props}
            resolvedAppearance={resolvedAppearance}
            resolvedMotion={resolvedMotion}
            isCapture={isCapture}
          />
        </MobilePageTheme>
      </MobileAppearanceOverrideContext.Provider>
    </MobileMotionContext.Provider>
  );
};

const ViewportFrame: React.FC<
  MobileViewportShellProps & {
    resolvedAppearance: MobileAppearance;
    resolvedMotion: MobileMotionMode;
    isCapture: boolean;
  }
> = ({
  device = 'iphone',
  resolvedAppearance,
  resolvedMotion,
  isCapture,
  surfaceBg,
  framed = true,
  expandHeight = false,
  fullBleed = false,
  overlaySlot,
  runtimeFeedback,
  children,
}) => {
  const normalizedSurfaceBg = normalizeMobileSurfaceBg(surfaceBg);
  const spec = MOBILE_DEVICE_SPECS[device] ?? MOBILE_DEVICE_SPECS.iphone;
  const isDark = resolvedAppearance === 'dark';
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [portalEl, setPortalEl] = useState<HTMLDivElement | null>(null);
  const thumb = useViewportScrollThumb(scrollRef, !fullBleed && !expandHeight);

  const handleThumbPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    const startY = e.clientY;
    const startScrollTop = el.scrollTop;
    const pad = 6;
    const track = Math.max(24, el.clientHeight - pad * 2);
    const usableTrack = Math.max(1, track - thumb.height);
    const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      el.scrollTop = startScrollTop + (dy / usableTrack) * maxScroll;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const renderThumbOverlay = (topOffset: number) =>
    thumb.visible ? (
      <span
        aria-hidden="true"
        data-mobile-scroll-thumb="1"
        onPointerDown={handleThumbPointerDown}
        style={{ top: topOffset + thumb.top, height: thumb.height }}
        className={`absolute right-[3px] w-[3.5px] rounded-full z-30 cursor-grab active:cursor-grabbing transition-opacity ${
          isDark ? 'bg-white/45 hover:bg-white/70' : 'bg-slate-600/50 hover:bg-slate-700/75'
        }`}
      />
    ) : null;

  if (fullBleed) {
    return (
      <MobileScreenPortalContext.Provider value={portalEl}>
        <div
          data-mobile-appearance={resolvedAppearance}
          data-surface-bg={normalizedSurfaceBg}
          data-motion={resolvedMotion}
          data-capture-mode={isCapture ? '1' : undefined}
          style={{ colorScheme: isDark ? 'dark' : 'light' }}
          className={`pf-mobile-scope relative w-full h-full min-h-0 flex flex-col overflow-hidden ${
            isDark ? 'bg-[#131314] text-[#E3E3E3]' : 'bg-[#F0F4F9] text-[#1F1F1F]'
          }`}
        >
          <div className="pf-mobile-scroll min-h-0 flex-1 flex flex-col overflow-y-auto overflow-x-hidden overscroll-contain">
            {children}
          </div>
          {overlaySlot}
          <div ref={setPortalEl} className="pointer-events-none absolute inset-0 z-[70] overflow-hidden" />
          {runtimeFeedback && <MobileRuntimeFeedback {...runtimeFeedback} topOffset={12} />}
        </div>
      </MobileScreenPortalContext.Provider>
    );
  }

  if (!framed) {
    return (
      <MobileScreenPortalContext.Provider value={portalEl}>
        <div
          data-mobile-appearance={resolvedAppearance}
          data-surface-bg={normalizedSurfaceBg}
          data-motion={resolvedMotion}
          data-capture-mode={isCapture ? '1' : undefined}
          className={`pf-mobile-scope relative mx-auto shrink-0 rounded-[28px] shadow-xl border overflow-hidden flex flex-col ${
            isDark
              ? 'bg-[#131314] text-[#E3E3E3] border-white/12 shadow-[0_24px_60px_-14px_rgba(0,0,0,0.72)]'
              : 'bg-[#F0F4F9] text-[#1F1F1F] border-slate-200/90'
          }`}
          style={{
            width: spec.width,
            minHeight: expandHeight ? spec.height : undefined,
            height: expandHeight ? 'auto' : spec.height,
            colorScheme: isDark ? 'dark' : 'light',
          }}
        >
          <div
            ref={scrollRef}
            className={`min-h-0 flex-1 flex flex-col relative ${
              expandHeight ? 'overflow-x-hidden' : 'overflow-y-auto overflow-x-hidden no-scrollbar'
            }`}
            style={{ overscrollBehavior: 'contain' }}
          >
            {children}
          </div>
          {renderThumbOverlay(0)}
          {overlaySlot}
          <div ref={setPortalEl} className="pointer-events-none absolute inset-0 z-[70] overflow-hidden" />
          {runtimeFeedback && <MobileRuntimeFeedback {...runtimeFeedback} topOffset={12} />}
        </div>
      </MobileScreenPortalContext.Provider>
    );
  }

  return (
    <div className="relative mx-auto shrink-0 select-none" style={{ width: spec.width + 24 }}>
      {/* Subtle physical hardware side buttons */}
      <span
        aria-hidden="true"
        className="absolute -left-[3px] top-[128px] w-[3px] h-8 rounded-l-sm bg-slate-600/75"
      />
      <span
        aria-hidden="true"
        className="absolute -left-[3px] top-[176px] w-[3px] h-14 rounded-l-sm bg-slate-600/75"
      />
      <span
        aria-hidden="true"
        className="absolute -left-[3px] top-[242px] w-[3px] h-14 rounded-l-sm bg-slate-600/75"
      />
      <span
        aria-hidden="true"
        className="absolute -right-[3px] top-[192px] w-[3px] h-20 rounded-r-sm bg-slate-600/75"
      />

      {/* Titanium Outer Frame */}
      <MobileScreenPortalContext.Provider value={portalEl}>
        <div
          className={`p-[12px] rounded-[54px] bg-gradient-to-b from-[#33363D] via-[#1D1E23] to-[#2B2E35] ${
            isDark
              ? 'shadow-[0_32px_80px_-14px_rgba(0,0,0,0.82),0_0_0_1px_rgba(255,255,255,0.18)_inset]'
              : 'shadow-[0_28px_70px_-16px_rgba(15,23,42,0.42),0_0_0_1px_rgba(255,255,255,0.14)_inset]'
          }`}
        >
          {/* Inner OLED Screen Viewport */}
          <div
            data-mobile-appearance={resolvedAppearance}
            data-surface-bg={normalizedSurfaceBg}
            data-motion={resolvedMotion}
            data-capture-mode={isCapture ? '1' : undefined}
            className={`pf-mobile-scope relative rounded-[42px] overflow-hidden flex flex-col ${
              isDark
                ? 'bg-[#131314] text-[#E3E3E3] ring-1 ring-inset ring-white/[0.06]'
                : 'bg-[#F0F4F9] text-[#1F1F1F]'
            }`}
            style={{
              width: spec.width,
              minHeight: expandHeight ? spec.height : undefined,
              height: expandHeight ? 'auto' : spec.height,
              colorScheme: isDark ? 'dark' : 'light',
            }}
          >
            {/* iOS Status Bar + Dynamic Island */}
            <div
              className={`h-[48px] px-7 pt-2 flex items-center justify-between shrink-0 z-30 ${
                isDark ? 'bg-[#131314] text-[#E3E3E3]' : 'bg-[#F0F4F9] text-[#1F1F1F]'
              }`}
            >
              <span className="text-[13.5px] font-semibold tracking-tight tabular-nums w-14">9:41</span>

              {/* Dynamic Island */}
              <div
                aria-hidden="true"
                className={`w-[114px] h-[31px] rounded-full bg-black flex items-center justify-end pr-3 shadow-inner ${
                  isDark ? 'ring-1 ring-white/10' : ''
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-[#1a2238] ring-1 ring-white/10" />
              </div>

              {/* Signal + Wi-Fi + Battery */}
              <div className="w-14 flex items-center justify-end gap-1.5" aria-hidden="true">
                <svg viewBox="0 0 18 12" className="w-3.5 h-2.5 fill-current">
                  <rect x="0" y="8" width="3" height="4" rx="0.8" />
                  <rect x="4.5" y="5.5" width="3" height="6.5" rx="0.8" />
                  <rect x="9" y="3" width="3" height="9" rx="0.8" />
                  <rect x="13.5" y="0" width="3" height="12" rx="0.8" />
                </svg>
                <svg viewBox="0 0 25 12" className="w-5 h-2.5 fill-current">
                  <rect x="0.5" y="0.5" width="21" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
                  <rect x="2.5" y="2.5" width="16" height="7" rx="1.5" />
                  <path d="M23 4v4a2 2 0 0 0 0-4Z" opacity="0.45" />
                </svg>
              </div>
            </div>

            {/* Scrollable App Viewport Area */}
            <div
              ref={scrollRef}
              className={`min-h-0 flex-1 flex flex-col relative ${
                expandHeight ? 'overflow-x-hidden' : 'overflow-y-auto overflow-x-hidden no-scrollbar'
              }`}
              style={{ overscrollBehavior: 'contain' }}
            >
              {children}
            </div>

            {renderThumbOverlay(48)}

            {/* Bottom Home Indicator Safe Area */}
            <div
              className={`h-[22px] flex items-center justify-center shrink-0 z-30 ${
                isDark ? 'bg-[#131314]' : 'bg-[#F0F4F9]'
              }`}
            >
              <span
                aria-hidden="true"
                className={`w-[128px] h-[4.5px] rounded-full ${isDark ? 'bg-white/40' : 'bg-slate-900/30'}`}
              />
            </div>

            {/* Scoped Overlays strictly trapped inside the phone screen */}
            {overlaySlot}
            <div ref={setPortalEl} className="pointer-events-none absolute inset-0 z-[70] overflow-hidden" />
            {runtimeFeedback && <MobileRuntimeFeedback {...runtimeFeedback} topOffset={54} />}
          </div>
        </div>
      </MobileScreenPortalContext.Provider>
    </div>
  );
};
