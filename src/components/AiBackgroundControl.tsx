import { useEffect, useRef, useState } from 'react';
import { Moon, ShieldCheck } from 'lucide-react';
import { aiBackgroundBridge, type AiBackgroundState } from '../services/aiBackground';
import { useI18n } from '../i18n';

export function AiBackgroundControl() {
  const { isEn, tr, td } = useI18n();
  const [state, setState] = useState<AiBackgroundState>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const bridge = aiBackgroundBridge();
  useEffect(() => {
    if (!bridge) return;
    let mounted = true, changed = false;
    const stop = bridge.onChange(value => { changed = true; if (mounted) setState(value); });
    void bridge.snapshot().then(value => { if (mounted && !changed) setState(value); }).catch(() => { if (mounted) setError(tr('无法读取后台运行状态', 'Unable to read background status')); });
    return () => { mounted = false; stop(); };
  }, [bridge, tr]);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  if (!bridge) return null;
  const status = state?.protected
    ? tr('AI 后台保护中', 'AI sleep guard active')
    : state?.active
    ? tr('AI 正在运行 · 未启用防睡眠', 'AI running · Sleep guard off')
    : state?.preventSleep
    ? tr('AI 后台保护已就绪', 'AI sleep guard ready')
    : tr('AI 自动防睡眠已关闭', 'AI auto sleep guard off');
  async function configure(key: 'preventSleep' | 'notifications', value: boolean) {
    if (!bridge || !state) return;
    setBusy(true); setError('');
    try { setState(await bridge.configure({ preventSleep: state.preventSleep, notifications: state.notifications, [key]: value })); }
    catch { setError(tr('设置保存失败，请重试', 'Failed to save settings, please retry')); }
    finally { setBusy(false); }
  }
  const btnAriaLabel = isEn
    ? state?.active
      ? state.protected
        ? 'AI Background · Guard On'
        : 'AI Background · Guard Off'
      : 'AI Background'
    : 'AI 后台运行';
  return <>
    <button type="button" aria-label={btnAriaLabel} title={status} onClick={() => setOpen(true)} className={`flex h-7 items-center gap-1 rounded-lg px-1.5 text-xs hover:bg-slate-100 shrink-0 ${state?.protected ? 'text-emerald-700' : 'text-slate-500'}`}>
      {state?.protected ? <ShieldCheck className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      {state?.active && <span className="whitespace-nowrap">{tr(`后台保护${state.protected ? '中' : '未开启'}`, state.protected ? 'Guard On' : 'Guard Off')}</span>}
    </button>
    {open && <dialog ref={dialog} aria-labelledby="ai-background-title" onCancel={() => setOpen(false)} className="m-auto w-[min(480px,92vw)] rounded-xl border border-slate-200 bg-white p-6 text-slate-800 shadow-xl backdrop:bg-black/30 whitespace-normal">
      <div className="flex items-center justify-between"><h2 id="ai-background-title" className="text-lg font-semibold">{tr('AI 后台运行', 'AI Background Mode')}</h2><button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">{tr('关闭', 'Close')}</button></div>
      <p role="status" className={`my-4 rounded-lg p-3 text-sm ${state?.protected ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50'}`}>{state ? status : tr('正在读取状态…', 'Reading status…')}</p>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={state?.preventSleep ?? false} disabled={!state || busy} onChange={e => void configure('preventSleep', e.target.checked)} /><span>{tr('AI 运行时防止电脑自动睡眠', 'Prevent computer from sleeping while AI is running')}<span className="mt-1 block text-xs leading-5 text-slate-500">{tr('允许熄屏和锁屏，任务结束后恢复正常省电。持续运行会增加电量消耗。', 'Allows display off and lock screen; normal power saving resumes once tasks finish. Increases battery usage while active.')}</span></span></label>
      <label className="mt-5 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={state?.notifications ?? false} disabled={!state || busy} onChange={e => void configure('notifications', e.target.checked)} /><span>{tr('锁屏时通知任务状态', 'Notify task status while locked')}<span className="mt-1 block text-xs leading-5 text-slate-500">{tr('只显示运行、结束或失败状态，不显示项目内容。锁屏展示取决于系统通知权限、专注模式与通知设置。', 'Shows only running, completed, or failed status without project content. Lock-screen visibility depends on OS notification and Focus settings.')}</span></span></label>
      <p className="mt-5 text-xs leading-5 text-slate-500">{tr('请保持网络连接和 Alex 开启。手动睡眠、合盖或关机仍可能中断任务。', 'Keep network connected and Alex open. Manual sleep, closing the lid, or shutting down may still interrupt tasks.')}</p>
      {(error || state?.healthError) && <p role="alert" className="mt-3 text-sm text-amber-700">{td(error || state?.healthError || '')}</p>}
    </dialog>}
  </>;
}
