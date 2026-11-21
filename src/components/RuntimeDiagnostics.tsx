import React, { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { captureRuntimeError, diagnosticsBridge, openRuntimeDiagnostics, type DiagnosticSnapshot } from '../services/runtimeDiagnostics';
import { useI18n, tr as syncTr } from '../i18n';

function DiagnosticsFallback({ id }: { id?: string }) {
  const { tr } = useI18n();
  return <div role="alert" className="m-8 rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm">
    <p>{tr('界面遇到异常，已尝试保存诊断。请先查看诊断信息；重新打开应用前，确认项目保存状态。', 'The UI encountered an unexpected error and attempted to save diagnostics. Please check the diagnostics details and verify your project save status before reopening.')}</p>
    {id && <p className="mt-2 select-all">{tr(`诊断编号：${id}`, `Diagnostic ID: ${id}`)}</p>}
    <button type="button" onClick={openRuntimeDiagnostics} className="mt-3 underline">{tr('查看运行诊断', 'View Runtime Diagnostics')}</button>
  </div>;
}

export class DiagnosticsBoundary extends Component<{children:ReactNode},{failed:boolean;id?:string}> {
  state:{failed:boolean;id?:string}={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(error:Error,info:ErrorInfo){
    void captureRuntimeError(error,{category:'renderer',code:'REACT_RENDER_FAILED',stage:'react'}).then(id=>{if(id)this.setState({id});});
    // Component stacks are not uploaded: they can contain user-authored component names.
    void info;
  }
  render(){return this.state.failed?<DiagnosticsFallback id={this.state.id}/>:this.props.children;}
}
export function RuntimeDiagnostics(){
  const { tr, td } = useI18n();
  const labels = {
    ai: tr('AI 任务', 'AI Task'),
    tool: tr('工具调用', 'Tool Call'),
    renderer: tr('界面渲染', 'Renderer'),
    storage: tr('项目存储', 'Storage'),
    network: tr('网络请求', 'Network'),
    main: tr('桌面进程', 'Main Process'),
  };
  const stateLabels = {
    pending: tr('待上传', 'Pending'),
    uploaded: tr('已入库', 'Uploaded'),
    rejected: tr('服务端拒收', 'Rejected'),
  };
  const [open,setOpen]=useState(false),[state,setState]=useState<DiagnosticSnapshot>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const show=()=>setOpen(true);window.addEventListener('protoflow:open-diagnostics',show);return()=>window.removeEventListener('protoflow:open-diagnostics',show);},[]);
  useEffect(()=>{
    if(!open)return;
    dialog.current?.showModal();let active=true;
    const refresh=()=>{const bridge=diagnosticsBridge();if(!bridge){setError(syncTr('运行诊断仅在桌面应用中可用', 'Runtime diagnostics are available only in the desktop app'));return;}
      void bridge.snapshot().then(value=>{if(active)setState(value);}).catch(()=>{if(active)setError(syncTr('无法读取本地诊断', 'Unable to read local diagnostics'));});};
    refresh();const timer=setInterval(refresh,5000);return()=>{active=false;clearInterval(timer);};
  },[open]);
  async function action(work:()=>Promise<DiagnosticSnapshot>){setBusy(true);setError('');try{setState(await work());}catch{setError(tr('诊断操作失败，请稍后重试', 'Diagnostic action failed, please try again later'));}finally{setBusy(false);}}
  function exportRecords(){if(!state)return;const url=URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:1,items:state.items},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='alex-runtime-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  if(!open)return null;
  return <dialog ref={dialog} onCancel={()=>setOpen(false)} className="m-auto w-[min(800px,95vw)] max-h-[85vh] rounded-xl border border-slate-200 bg-white p-5 text-slate-800 shadow-xl backdrop:bg-black/30">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{tr('运行诊断', 'Runtime Diagnostics')}</h2><button type="button" aria-label={tr('关闭运行诊断', 'Close runtime diagnostics')} onClick={()=>setOpen(false)}>{tr('关闭', 'Close')}</button></div>
    <p className="my-3 text-sm text-slate-500">{tr('异常先保存在本机，开启自动上传后写入诊断数据库。反馈问题时，请提供对应的诊断编号。默认不收集提示词、完整 AI 回复、页面源码和业务数据行。', 'Errors are saved locally first and uploaded when automatic reporting is enabled. Share the Diagnostic ID when reporting issues. Prompts, full AI replies, page source code, and data rows are excluded by default.')}</p>
    {state&&<div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={state.enabled} disabled={busy} onChange={e=>{const enabled=e.target.checked;void action(()=>diagnosticsBridge()!.configure({enabled}));}}/>{tr('自动上传异常', 'Auto-upload error reports')}</label>
      <button type="button" disabled={busy||!state.enabled} onClick={()=>void action(()=>diagnosticsBridge()!.retry())} className="underline disabled:opacity-50">{tr('重试待上传记录', 'Retry Pending Uploads')}</button>
      <button type="button" onClick={exportRecords} className="underline">{tr('导出诊断', 'Export Diagnostics')}</button>
      <span className="text-slate-500">{tr('本地保留 7 天，最多 200 条', 'Retained locally for 7 days, max 200 items')}</span>
    </div>}
    {(error||state?.healthError)&&<p role="alert" className="my-2 text-sm text-rose-600">{td(error||state?.healthError||'')}</p>}
    {!!state?.dropped&&<p className="text-sm text-amber-700 tabular-nums">{tr(`本次启动后有 ${state.dropped} 条待上传记录因保留上限被清理。`, `${state.dropped} pending report(s) were pruned due to retention limits since launch.`)}</p>}
    {state&&!state.items.length&&<p className="py-8 text-center text-slate-500">{tr('暂未收集到异常', 'No runtime errors recorded')}</p>}
    <div className="space-y-2">{state?.items.map(({report,state:status,lastStatus})=><details key={report.id} className="rounded-lg border border-slate-200 p-3 text-xs">
      <summary className="cursor-pointer">{labels[report.category]} · {report.code} · {new Date(report.occurredAt).toLocaleString()} · {stateLabels[status]}{status==='rejected'?` (HTTP ${lastStatus})`:''}</summary>
      <p className="my-2 break-all">{tr('诊断编号：', 'Diagnostic ID: ')}{report.id} <button type="button" className="text-blue-600 underline" onClick={()=>{void navigator.clipboard.writeText(report.id).then(()=>setCopied(report.id)).catch(()=>setError(tr('复制失败，请手动选择诊断编号', 'Copy failed — please select the Diagnostic ID manually')));}}>{copied===report.id?tr('已复制', 'Copied'):tr('复制', 'Copy')}</button></p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2">{JSON.stringify(report,null,2)}</pre>
    </details>)}</div>
  </dialog>;
}
