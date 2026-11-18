import React, { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { captureRuntimeError, diagnosticsBridge, openRuntimeDiagnostics, type DiagnosticSnapshot } from '../services/runtimeDiagnostics';

const labels={ai:'AI 任务',tool:'工具调用',renderer:'界面渲染',storage:'项目存储',network:'网络请求',main:'桌面进程'};
const stateLabels={pending:'待上传',uploaded:'已入库',rejected:'服务端拒收'};
export class DiagnosticsBoundary extends Component<{children:ReactNode},{failed:boolean;id?:string}> {
  state:{failed:boolean;id?:string}={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(error:Error,info:ErrorInfo){
    void captureRuntimeError(error,{category:'renderer',code:'REACT_RENDER_FAILED',stage:'react'}).then(id=>{if(id)this.setState({id});});
    // Component stacks are not uploaded: they can contain user-authored component names.
    void info;
  }
  render(){return this.state.failed?<div role="alert" className="m-8 rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm">
    <p>界面遇到异常，已尝试保存诊断。请先查看诊断信息；重新打开应用前，确认项目保存状态。</p>
    {this.state.id&&<p className="mt-2 select-all">诊断编号：{this.state.id}</p>}
    <button type="button" onClick={openRuntimeDiagnostics} className="mt-3 underline">查看运行诊断</button>
  </div>:this.props.children;}
}
export function RuntimeDiagnostics(){
  const [open,setOpen]=useState(false),[state,setState]=useState<DiagnosticSnapshot>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const show=()=>setOpen(true);window.addEventListener('protoflow:open-diagnostics',show);return()=>window.removeEventListener('protoflow:open-diagnostics',show);},[]);
  useEffect(()=>{
    if(!open)return;
    dialog.current?.showModal();let active=true;
    const refresh=()=>{const bridge=diagnosticsBridge();if(!bridge){setError('运行诊断仅在桌面应用中可用');return;}
      void bridge.snapshot().then(value=>{if(active)setState(value);}).catch(()=>{if(active)setError('无法读取本地诊断');});};
    refresh();const timer=setInterval(refresh,5000);return()=>{active=false;clearInterval(timer);};
  },[open]);
  async function action(work:()=>Promise<DiagnosticSnapshot>){setBusy(true);setError('');try{setState(await work());}catch{setError('诊断操作失败，请稍后重试');}finally{setBusy(false);}}
  function exportRecords(){if(!state)return;const url=URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:1,items:state.items},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='alex-runtime-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  if(!open)return null;
  return <dialog ref={dialog} onCancel={()=>setOpen(false)} className="m-auto w-[min(800px,95vw)] max-h-[85vh] rounded-xl border border-slate-200 bg-white p-5 text-slate-800 shadow-xl backdrop:bg-black/30">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">运行诊断</h2><button type="button" aria-label="关闭运行诊断" onClick={()=>setOpen(false)}>关闭</button></div>
    <p className="my-3 text-sm text-slate-500">异常先保存在本机，开启自动上传后写入诊断数据库。反馈问题时，请提供对应的诊断编号。默认不收集提示词、完整 AI 回复、页面源码和业务数据行。</p>
    {state&&<div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={state.enabled} disabled={busy} onChange={e=>{const enabled=e.target.checked;void action(()=>diagnosticsBridge()!.configure({enabled}));}}/>自动上传异常</label>
      <button type="button" disabled={busy||!state.enabled} onClick={()=>void action(()=>diagnosticsBridge()!.retry())} className="underline disabled:opacity-50">重试待上传记录</button>
      <button type="button" onClick={exportRecords} className="underline">导出诊断</button>
      <span className="text-slate-500">本地保留 7 天，最多 200 条</span>
    </div>}
    {(error||state?.healthError)&&<p role="alert" className="my-2 text-sm text-rose-600">{error||state?.healthError}</p>}
    {!!state?.dropped&&<p className="text-sm text-amber-700">本次启动后有 {state.dropped} 条待上传记录因保留上限被清理。</p>}
    {state&&!state.items.length&&<p className="py-8 text-center text-slate-500">暂未收集到异常</p>}
    <div className="space-y-2">{state?.items.map(({report,state:status,lastStatus})=><details key={report.id} className="rounded-lg border border-slate-200 p-3 text-xs">
      <summary className="cursor-pointer">{labels[report.category]} · {report.code} · {new Date(report.occurredAt).toLocaleString()} · {stateLabels[status]}{status==='rejected'?` (HTTP ${lastStatus})`:''}</summary>
      <p className="my-2 break-all">诊断编号：{report.id} <button type="button" className="text-blue-600 underline" onClick={()=>{void navigator.clipboard.writeText(report.id).then(()=>setCopied(report.id)).catch(()=>setError('复制失败，请手动选择诊断编号'));}}>{copied===report.id?'已复制':'复制'}</button></p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2">{JSON.stringify(report,null,2)}</pre>
    </details>)}</div>
  </dialog>;
}
