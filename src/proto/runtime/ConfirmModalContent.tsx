import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { ConfirmDialogState } from './runtime';

interface DesktopConfirmDialogProps {
  confirmState: ConfirmDialogState;
  onResolve: (ok: boolean) => void;
}

export const DesktopConfirmDialog: React.FC<DesktopConfirmDialogProps> = ({ confirmState, onResolve }) => {
  const { tr } = useI18n();
  const [typed, setTyped] = useState('');
  const requiredMatch = typeof confirmState.matchText === 'string' ? confirmState.matchText.trim() : '';
  const isMatched = !requiredMatch || typed.trim() === requiredMatch;

  useEffect(() => {
    setTyped('');
  }, [confirmState]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('操作确认', 'Confirm Action')}
      className="fixed inset-0 z-[90] bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4"
    >
      <div className="pf-paper bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className={`w-5 h-5 shrink-0 mt-0.5 ${requiredMatch ? 'text-rose-500' : 'text-amber-500'}`}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-900">
              {requiredMatch ? tr('高危操作二次确认', 'High-Risk Action Confirmation') : tr('操作确认', 'Confirm Action')}
            </div>
            <div className="text-xs text-slate-600 mt-1 leading-relaxed break-words">
              {confirmState.message}
            </div>
          </div>
        </div>

        {requiredMatch && (
          <div className="rounded-xl bg-rose-50/70 border border-rose-200/80 p-3 space-y-2">
            <div className="text-[11.5px] text-rose-800 leading-snug">
              {tr('请在下方准确输入', 'Please type')}{' '}
              <code
                data-testid="confirm-match-target"
                className="px-1.5 py-0.5 rounded bg-white border border-rose-200 font-mono font-semibold text-rose-700 select-all"
              >
                {requiredMatch}
              </code>{' '}
              {tr('以解锁确认按钮：', 'below to unlock confirmation:')}
            </div>
            <input
              type="text"
              data-testid="confirm-match-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requiredMatch}
              autoFocus
              className="w-full h-8 px-2.5 rounded-lg border border-rose-200 bg-white text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-400"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => onResolve(false)}
            className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer transition"
          >
            {tr('取消', 'Cancel')}
          </button>
          <button
            type="button"
            data-testid="confirm-submit-btn"
            disabled={!isMatched}
            onClick={() => {
              if (isMatched) onResolve(true);
            }}
            className={`px-3.5 py-1.5 rounded-lg text-white text-xs font-semibold shadow-xs transition ${
              requiredMatch
                ? 'bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 disabled:cursor-not-allowed cursor-pointer'
                : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
            }`}
          >
            {tr('确认执行', 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
