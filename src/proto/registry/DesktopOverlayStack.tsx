import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CaptureMode } from '../../capture/CaptureMode';
import { scopeForOverlay, type OverlayEntry } from '../runtime/runtime';
import type { ProtoNode } from '../types';
import { NodeView, ScopeProvider } from '../renderer/NodeView';
import {
  DesktopOverlayExitContext,
  DesktopOverlayPositionContext,
  useCanvasTheme,
} from '../theme/ProtoCanvasThemeScope';
import type { DesktopMotionMode } from '../theme/designTokens';

export function canAnimateDesktopOverlayExit(
  isCapture: boolean,
  motionMode: DesktopMotionMode,
  staticOverlay?: boolean,
): boolean {
  if (isCapture || staticOverlay || motionMode === 'none') return false;
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return false;
  }
  return true;
}

export function useDesktopOverlayExitAnimation(
  live: boolean | undefined,
  staticOverlay: boolean | undefined,
  isCapture: boolean,
  motionMode: DesktopMotionMode,
) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const onHostExitSettled = useContext(DesktopOverlayExitContext);
  const onHostExitSettledRef = useRef(onHostExitSettled);
  onHostExitSettledRef.current = onHostExitSettled;

  const effectiveLive = Boolean(live) && onHostExitSettled === null;
  const [closing, setClosing] = useState(false);
  const prevLiveRef = useRef(effectiveLive);
  const canAnimate = canAnimateDesktopOverlayExit(isCapture, motionMode, staticOverlay);
  const initiatingClose = !effectiveLive && prevLiveRef.current && canAnimate;
  const effectiveClosing = !effectiveLive && (closing || initiatingClose);

  useEffect(() => {
    if (effectiveLive) {
      prevLiveRef.current = true;
      setClosing(false);
      return undefined;
    }

    if (prevLiveRef.current && canAnimate) {
      prevLiveRef.current = false;
      setClosing(true);
      let cancelled = false;
      const settle = async () => {
        await Promise.race([
          new Promise<void>((r) => requestAnimationFrame(() => r())),
          new Promise<void>((r) => setTimeout(r, 32)),
        ]);
        if (cancelled) return;
        const anims = [
          ...(typeof panelRef.current?.getAnimations === 'function' ? panelRef.current.getAnimations() : []),
          ...(typeof backdropRef.current?.getAnimations === 'function' ? backdropRef.current.getAnimations() : []),
        ];
        if (anims.length > 0) {
          await Promise.race([
            Promise.allSettled(anims.map((a) => a.finished)),
            new Promise((r) => setTimeout(r, 340)),
          ]);
        }
        if (!cancelled) {
          setClosing(false);
          onHostExitSettledRef.current?.();
        }
      };
      void settle();
      return () => {
        cancelled = true;
      };
    }

    prevLiveRef.current = false;
    setClosing(false);
    onHostExitSettledRef.current?.();
    return undefined;
  }, [effectiveLive, canAnimate]);

  return {
    mounted: effectiveLive || effectiveClosing,
    closing: effectiveClosing,
    panelRef,
    backdropRef,
    inertProps: effectiveClosing ? { inert: '' } : undefined,
  };
}

interface RetainedDesktopOverlayItem {
  entry: OverlayEntry;
  stackIndex: number;
  closing: boolean;
}

export const DesktopOverlayStack: React.FC<{
  overlays: readonly OverlayEntry[];
  resolveNode: (overlayId: string) => ProtoNode | null | undefined;
  position?: 'absolute' | 'fixed';
}> = ({ overlays, resolveNode, position = 'absolute' }) => {
  const isCapture = useContext(CaptureMode);
  const canvasTheme = useCanvasTheme();
  const motionMode = canvasTheme?.motion ?? 'smooth';
  const canAnimate = canAnimateDesktopOverlayExit(isCapture, motionMode);
  const [, setExitTick] = useState(0);
  const syncedRef = useRef<RetainedDesktopOverlayItem[]>([]);

  const liveByKey = new Map(overlays.map((entry, stackIndex) => [entry.key, { entry, stackIndex }]));
  const nextList: RetainedDesktopOverlayItem[] = [];
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
    <DesktopOverlayPositionContext.Provider value={position}>
      {nextList.map((item) => {
        const node = resolveNode(item.entry.id);
        if (!node) return null;
        return (
          <DesktopOverlayExitContext.Provider
            key={item.entry.key}
            value={item.closing ? () => finalizeExit(item.entry.key) : null}
          >
            <ScopeProvider value={scopeForOverlay(item.entry, item.stackIndex)}>
              <NodeView node={node} live />
            </ScopeProvider>
          </DesktopOverlayExitContext.Provider>
        );
      })}
    </DesktopOverlayPositionContext.Provider>
  );
};
