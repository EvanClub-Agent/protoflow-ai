import React, { useEffect, useState } from 'react';
import { fetchRuntimeDiagnostics, type StoredDiagnostic } from '../services/releaseClient';

const reasons: Record<string,string> = {'rate-limit':'模型服务限流',quota:'模型服务额度不足',timeout:'请求超时',network:'网络连接失败',authentication:'认证失败','context-limit':'上下文超出模型限制','stale-state':'任务状态已变化',context:'上下文同步失败',validation:'契约或验收失败',storage:'存储失败',unclassified:'原因尚未分类'};
function accountLabel(item: StoredDiagnostic) {
  if (!item.account) return '账号未采集（旧版记录）';
  if (item.account.status === 'signed-in') return `${item.account.displayName}（${item.account.username}）`;
  return item.account.status === 'signed-out' ? '发生时未登录' : '发生时账号尚未确认';
}
function Evidence({item}:{item:StoredDiagnostic}) {
  const failure = item.context?.failure, metrics = item.context?.metrics;
  return <div className="mt-3 space-y-3">
    <p className="font-medium">{failure?.reason ? reasons[failure.reason] ?? failure.reason : item.message}</p>
    <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
      <div><dt className="text-slate-500">发生时间（客户端）</dt><dd>{new Date(item.occurredAt).toLocaleString()}</dd></div>
      <div><dt className="text-slate-500">入库时间</dt><dd>{new Date(item.receivedAt).toLocaleString()}</dd></div>
      <div><dt className="text-slate-500">发生时账号（客户端登录会话快照）</dt><dd className="break-all">{accountLabel(item)}{item.account?.status==='signed-in' && <span className="block text-slate-500">账号 ID：{item.account.userId}</span>}</dd></div>
      <div><dt className="text-slate-500">电脑 / 安装实例</dt><dd className="break-all">{item.device?.hostname ?? '设备名未采集'}<span className="block text-slate-500">{item.platform} / {item.arch}{item.device?.osRelease && ` · ${item.device.osRelease}`}</span><span className="block text-slate-500">{item.installationId}</span></dd></div>
      {failure && <div><dt className="text-slate-500">根因证据</dt><dd>{failure.evidence==='native-session-log'?'已匹配本轮 Hermes 会话日志':'运行时异常分类'}{failure.logStatus==='no-match'?'；日志未找到本轮匹配证据':failure.logStatus==='unavailable'?'；本机日志不可读取':''}</dd></div>}
      {failure?.rateLimitKind && <div><dt className="text-slate-500">限流与重试</dt><dd>{failure.rateLimitKind==='tokens'?'每分钟 Token（TPM）':'每分钟请求（RPM）'}{failure.retryAfterSeconds!==undefined && `；最后一次拒绝建议等待 ${failure.retryAfterSeconds} 秒`}{failure.retriesExhausted && `；${failure.attempts ?? '已达上限'} 次重试耗尽`}</dd></div>}
      {failure?.tokensRequested!==undefined && <div><dt className="text-slate-500">服务报告的 Token 用量</dt><dd>本次请求 {failure.tokensRequested.toLocaleString()}{failure.tokensUsed!==undefined && `；窗口已用 ${failure.tokensUsed.toLocaleString()}`}{failure.tokenLimit!==undefined && `；限额 ${failure.tokenLimit.toLocaleString()}`}</dd></div>}
      {failure?.messageCount!==undefined && <div><dt className="text-slate-500">会话规模（Hermes 估算）</dt><dd>{failure.messageCount} 条消息{failure.estimatedTokens!==undefined && `；约 ${failure.estimatedTokens.toLocaleString()} Token`}</dd></div>}
      {metrics?.totalExecuteMs!==undefined && <div><dt className="text-slate-500">分阶段耗时</dt><dd>总计 {(metrics.totalExecuteMs/1000).toFixed(1)} 秒{metrics.acpTurnMs!==undefined && `；Hermes ${(metrics.acpTurnMs/1000).toFixed(1)} 秒`}{metrics.sessionSetupMs!==undefined && `；会话准备 ${(metrics.sessionSetupMs/1000).toFixed(2)} 秒`}</dd></div>}
    </dl>
  </div>;
}

export default function RuntimeDiagnosticsPanel({token}:{token:string}) {
  const [id,setId]=useState(''),[category,setCategory]=useState(''),[version,setVersion]=useState('');
  const [account,setAccount]=useState(''),[device,setDevice]=useState(''),[runId,setRunId]=useState('');
  const [query,setQuery]=useState({id:'',category:'',version:'',account:'',device:'',runId:'',offset:0,refresh:0});
  const [items,setItems]=useState<StoredDiagnostic[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setError('');setItems([]);
    void fetchRuntimeDiagnostics(token,query,controller.signal).then(result=>{if(!controller.signal.aborted)setItems(result.items);})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'查询诊断失败');})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[token,query]);
  return <section aria-label="运行诊断查询" className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
    <h2 className="mb-2 text-lg font-semibold">运行诊断</h2>
    <p className="mb-3 text-xs text-slate-500">按编号定位，或用账号、电脑与任务轮次精确查询。账号和设备为错误发生时的客户端快照；旧记录缺失的信息不会补写为当前账号。</p>
    <search><form className="mb-4 flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();setQuery({id:id.trim(),category,version:version.trim(),account:account.trim(),device:device.trim(),runId:runId.trim(),offset:0,refresh:query.refresh+1});}}>
      <input aria-label="诊断编号" className="min-w-64 flex-1 rounded border p-2" placeholder="诊断编号（完整 UUID）" value={id} onChange={e=>setId(e.target.value)}/>
      <input aria-label="应用版本" className="w-32 rounded border p-2" placeholder="应用版本" value={version} onChange={e=>setVersion(e.target.value)}/>
      <input aria-label="发生时账号" className="min-w-48 flex-1 rounded border p-2" placeholder="完整用户名或账号 ID" value={account} onChange={e=>setAccount(e.target.value)}/>
      <input aria-label="发生时电脑" className="min-w-48 flex-1 rounded border p-2" placeholder="完整设备名或安装实例 ID" value={device} onChange={e=>setDevice(e.target.value)}/>
      <input aria-label="任务轮次" className="min-w-48 flex-1 rounded border p-2" placeholder="完整 runId（关联同一任务）" value={runId} onChange={e=>setRunId(e.target.value)}/>
      <select aria-label="异常来源" className="rounded border p-2" value={category} onChange={e=>setCategory(e.target.value)}>
        <option value="">全部来源</option>{Object.entries({ai:'AI 任务',tool:'工具调用',renderer:'界面渲染',storage:'项目存储',network:'网络请求',main:'桌面进程'}).map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select><button disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">查询</button>
    </form></search>
    {error&&<p role="alert" className="mb-3 text-rose-600">{error}</p>}
    {busy?<p>正在查询…</p>:!error&&!items.length?<p className="py-4 text-slate-500">未找到匹配的诊断记录</p>:null}
    <div className="space-y-2">{items.map(item=><details key={item.id} className="rounded border p-3">
      <summary className="cursor-pointer text-xs">{new Date(item.occurredAt).toLocaleString()} · {item.appVersion} / {item.platform} · {item.code}<span className="ml-2 select-all text-slate-500">{item.id}</span><span className="mt-1 block break-all text-slate-600">{accountLabel(item)} · {item.device?.hostname ?? '设备名未采集'}{item.context?.failure?.reason && ` · ${reasons[item.context.failure.reason] ?? item.context.failure.reason}`}</span></summary>
      <Evidence item={item}/>
      {item.context?.runId && <button type="button" className="mt-3 text-xs text-blue-600" onClick={()=>{const relatedRun=item.context!.runId!;setId('');setCategory('');setVersion('');setAccount('');setDevice(item.installationId);setRunId(relatedRun);setQuery({id:'',category:'',version:'',account:'',device:item.installationId,runId:relatedRun,offset:0,refresh:query.refresh+1});}}>查看此电脑同一任务的全部诊断</button>}
      <pre tabIndex={0} role="region" aria-label={`诊断 JSON ${item.id}`} className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all bg-slate-50 p-3 text-xs"><code>{JSON.stringify(item,null,2)}</code></pre>
    </details>)}</div>
    <div className="mt-4 flex items-center gap-4 text-xs"><button type="button" disabled={busy||query.offset===0} onClick={()=>setQuery({...query,offset:query.offset-50})} className="disabled:opacity-40">上一页</button><span>第 {query.offset/50+1} 页</span><button type="button" disabled={busy||items.length<50||query.offset>=100000} onClick={()=>setQuery({...query,offset:query.offset+50})} className="disabled:opacity-40">下一页</button></div>
  </section>;
}
