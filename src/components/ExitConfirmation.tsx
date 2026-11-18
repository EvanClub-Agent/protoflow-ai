import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Bot, CheckCircle2, Loader2, Power, Save, X } from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { useHermesStore } from '../store/useHermesStore';
import { AlexLogo } from './AlexLogo';

type CloseState = { requestId: string; state: 'confirming' | 'saving' | 'error'; error?: string };
export interface CloseConfirmationBridge {
  onConfirmClose(listener: (requestId: string) => void): () => void;
  onCloseState(listener: (state: CloseState) => void): () => void;
  confirmClose(result: { requestId: string; confirmed: boolean }): void;
  closeConfirmationReady(): void;
}

export function ExitDialog({ state, projectName, aiRunning, onCancel, onConfirm }: {
  state: CloseState; projectName: string | null; aiRunning: boolean;
  onCancel(): void; onConfirm(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const saving = state.state === 'saving';
  useEffect(() => {
    const element = dialog.current;
    element?.showModal(); cancel.current?.focus();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="exit-title"
      aria-describedby="exit-description"
      onCancel={event => {
        event.preventDefault();
        if (!saving) onCancel();
      }}
      className="m-auto w-[420px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/45 backdrop:backdrop-blur-[2px]"
    >
      {/* Compact Header with Brand Logo & Power Badge */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <AlexLogo size={34} className="rounded-xl shadow-xs" />
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white ring-2 ring-white">
              <Power size={9.5} strokeWidth={2.5} />
            </span>
          </div>
          <div className="min-w-0">
            <h2 id="exit-title" className="text-sm font-bold tracking-tight text-slate-900">
              退出 Alex？
            </h2>
            <p id="exit-description" className="mt-0.5 text-[11px] text-slate-500 truncate">
              结束本次工作，退出前会保存当前项目。
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="取消退出"
          onClick={onCancel}
          disabled={saving}
          className="h-7 w-7 shrink-0 rounded-lg flex items-center justify-center text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40"
        >
          <X size={15} />
        </button>
      </div>

      {/* Dialog Body */}
      <div className="space-y-3 px-5 py-4">
        {projectName !== null ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-slate-50/60 px-3.5 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-200/70 bg-blue-50 text-blue-600">
                <Save size={15} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">当前项目</p>
                <p className="mt-0.5 truncate text-xs font-bold text-slate-800" title={projectName}>
                  {projectName}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/80 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 shrink-0">
              <CheckCircle2 size={11} />
              退出自动保存
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-600">
            <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
            <span>当前未打开待保存的工程，可直接安全退出。</span>
          </div>
        )}

        {aiRunning && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/90 bg-amber-50/80 px-3.5 py-2.5 text-xs leading-5 text-amber-800">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-100">
              <Bot size={13.5} className="text-amber-700" />
            </div>
            <div>
              <p className="font-semibold text-amber-900">AI 任务正在处理中</p>
              <p className="mt-0.5 text-[11px] text-amber-700">AI 正在处理请求，退出后当前任务会停止。</p>
            </div>
          </div>
        )}

        {state.state === 'error' && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-rose-200/90 bg-rose-50/90 px-3.5 py-2.5 text-xs leading-5 text-rose-700"
          >
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-rose-100">
              <AlertCircle size={13.5} className="text-rose-600" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-rose-800">保存未完成，已保留当前窗口</p>
              <p className="mt-0.5 text-[11px] text-rose-600 break-words">{state.error}</p>
            </div>
          </div>
        )}

        {saving && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-xl border border-blue-200/80 bg-blue-50/70 px-3.5 py-2.5 text-xs font-medium text-blue-700"
          >
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none text-blue-600 shrink-0" />
            正在保存项目，请稍候…
          </p>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-5 py-3.5">
        <span className="text-[11px] text-slate-400">按 Esc 可取消</span>
        <div className="flex items-center gap-2">
          <button
            ref={cancel}
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-slate-200/90 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:bg-slate-100 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40"
          >
            继续使用
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-xs shadow-blue-600/20 transition hover:bg-blue-700 active:bg-blue-800 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? <Loader2 size={13.5} className="animate-spin motion-reduce:animate-none" /> : <ArrowRight size={13.5} />}
            {saving ? '正在保存' : state.state === 'error' ? '重试并退出' : projectName !== null ? '保存并退出' : '退出程序'}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function ExitConfirmation() {
  const [state, setState] = useState<CloseState | null>(null);
  const current = useRef<CloseState | null>(null);
  const bridge = (window as unknown as { protoflowDesktop?: Partial<CloseConfirmationBridge> }).protoflowDesktop;
  const projectName = useProtoStore(s => s.isProjectClosed || s.isWelcomeScreenOpen ? null : s.currentProjectMeta.projectName);
  const aiRunning = useHermesStore(s => Object.values(s.runningProjects).some(Boolean));
  const update = (next: CloseState | null) => { current.current = next; setState(next); };
  useEffect(() => {
    if (!bridge?.onConfirmClose || !bridge.onCloseState || !bridge.confirmClose || !bridge.closeConfirmationReady) return;
    const stopRequest = bridge.onConfirmClose(requestId => {
      if (current.current?.requestId !== requestId) update({ requestId, state: 'confirming' });
    });
    const stopState = bridge.onCloseState(next => {
      if (current.current?.requestId === next.requestId) update(next);
    });
    bridge.closeConfirmationReady();
    return () => { stopRequest(); stopState(); };
  }, [bridge]);
  if (!state) return null;
  const decide = (confirmed: boolean) => {
    const request = current.current;
    if (!request || request.state === 'saving') return;
    update(confirmed ? { requestId: request.requestId, state: 'saving' } : null);
    bridge!.confirmClose!({ requestId: request.requestId, confirmed });
  };
  return <ExitDialog state={state} projectName={projectName} aiRunning={aiRunning} onCancel={() => decide(false)} onConfirm={() => decide(true)} />;
}
