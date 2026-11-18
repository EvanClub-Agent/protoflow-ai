import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Crosshair, LoaderCircle, Sparkles } from 'lucide-react';
import { useAiChatStore } from '../../store/useAiChatStore';
import { AiChatPanel } from './AiChatPanel';

type FloatingPageChatProps = Pick<React.ComponentProps<typeof AiChatPanel>, 'pageId' | 'pageTitle' | 'selectedLabel' | 'running' | 'onSend' | 'onClearSelection'>;

export function FloatingPageChat(props: FloatingPageChatProps) {
  const open = useAiChatStore(state => state.pageChatOpen);
  const setOpen = useAiChatStore(state => state.setPageChatOpen);
  const [hasOpened, setHasOpened] = useState(open);
  const wide = useAiChatStore(state => state.pageChatWide);
  const toggleWidth = useAiChatStore(state => state.togglePageChatWidth);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const previousOpen = useRef(open);

  useLayoutEffect(() => {
    // Opening from an entry point focuses the composer. Selecting a different page keeps focus in the directory.
    if (open && !previousOpen.current) composerRef.current?.focus({ preventScroll: true });
    previousOpen.current = open;
    if (open) setHasOpened(true);
  }, [open]);

  const collapse = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }, [setOpen]);

  useEffect(() => {
    const doc = triggerRef.current?.ownerDocument;
    if (!open || !doc) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('dialog, [role="dialog"], [aria-modal="true"], .fixed.inset-0')) return;
      event.preventDefault();
      if (panelRef.current?.contains(doc.activeElement)) collapse();
      else setOpen(false);
    };
    doc.addEventListener('keydown', onEscape);
    return () => doc.removeEventListener('keydown', onEscape);
  }, [open, setOpen, collapse]);

  return (
    <>
      <aside
        ref={panelRef}
        id={panelId}
        aria-label="AI 对话面板"
        hidden={!open}
        className={
          open
            ? `absolute bottom-14 right-3.5 z-40 flex h-[min(38rem,calc(100%_-_4.5rem))] ${
                wide
                  ? 'w-[min(31rem,calc(100%_-_1.75rem))]'
                  : 'w-[min(24.5rem,calc(100%_-_1.75rem))]'
              } flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] ring-1 ring-slate-900/5 transition-[width] duration-200`
            : 'hidden'
        }
      >
        {(open || hasOpened) && (
          <AiChatPanel
            {...props}
            visible={open}
            composerRef={composerRef}
            onCollapse={collapse}
            wide={wide}
            onToggleWide={toggleWidth}
          />
        )}
      </aside>
      <div className="flex shrink-0 items-center justify-end px-3.5 pt-1 pb-2">
        <button
          ref={triggerRef}
          type="button"
          aria-label="问 AI"
          aria-controls={panelId}
          aria-expanded={open}
          title={props.running ? '当前页面的 AI 任务进行中' : '当前页面的 AI 对话'}
          onClick={() => (open ? collapse() : setOpen(true))}
          className={`pointer-events-auto inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-3.5 text-xs font-semibold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
            open
              ? 'border border-slate-200/90 bg-white text-slate-700 shadow-lg hover:bg-slate-50 hover:text-slate-900'
              : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white shadow-[0_8px_24px_-4px_rgba(37,99,235,0.42)] ring-1 ring-white/20 hover:shadow-[0_12px_28px_-4px_rgba(37,99,235,0.52)] hover:brightness-105'
          }`}
        >
          {props.running ? (
            <LoaderCircle size={14} aria-hidden="true" className="motion-safe:animate-spin shrink-0" />
          ) : open ? (
            <ChevronDown size={14} aria-hidden="true" className="text-slate-500 shrink-0" />
          ) : (
            <Sparkles size={14} aria-hidden="true" className="shrink-0" />
          )}
          <span>问 AI</span>
          {!open && props.running && (
            <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white">
              生成中
            </span>
          )}
          {!open && !props.running && props.selectedLabel && (
            <span className="inline-flex max-w-[120px] items-center gap-1 truncate rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium text-white">
              <Crosshair size={10} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{props.selectedLabel}</span>
            </span>
          )}
        </button>
      </div>
    </>
  );
}
