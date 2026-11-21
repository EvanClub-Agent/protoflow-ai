import React, { useEffect, useState } from 'react';
import { fetchRuntimeDiagnostics, type StoredDiagnostic } from '../services/releaseClient';
import { useI18n } from '../i18n';

function reasonLabel(reason: string, tr: <T>(zh: T, en: T) => T): string {
  const map: Record<string, [string, string]> = {
    'rate-limit': ['模型服务限流', 'Model service rate limit'],
    quota: ['模型服务额度不足', 'Insufficient model quota'],
    timeout: ['请求超时', 'Request timed out'],
    network: ['网络连接失败', 'Network connection failed'],
    authentication: ['认证失败', 'Authentication failed'],
    'context-limit': ['上下文超出模型限制', 'Context exceeded model limit'],
    'stale-state': ['任务状态已变化', 'Task state changed'],
    context: ['上下文同步失败', 'Context sync failed'],
    validation: ['契约或验收失败', 'Contract or validation failed'],
    storage: ['存储失败', 'Storage failed'],
    unclassified: ['原因尚未分类', 'Unclassified reason'],
  };
  const pair = map[reason];
  return pair ? tr(pair[0], pair[1]) : reason;
}

function accountLabel(item: StoredDiagnostic, tr: <T>(zh: T, en: T) => T) {
  if (!item.account) return tr('账号未采集（旧版记录）', 'Account not captured (legacy record)');
  if (item.account.status === 'signed-in') return tr(`${item.account.displayName}（${item.account.username}）`, `${item.account.displayName} (${item.account.username})`);
  return item.account.status === 'signed-out'
    ? tr('发生时未登录', 'Signed out when occurred')
    : tr('发生时账号尚未确认', 'Account unverified when occurred');
}

function Evidence({item}:{item:StoredDiagnostic}) {
  const { tr } = useI18n();
  const failure = item.context?.failure, metrics = item.context?.metrics;
  return <div className="mt-3 space-y-3">
    <p className="font-medium">{failure?.reason ? reasonLabel(failure.reason, tr) : item.message}</p>
    <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
      <div><dt className="text-slate-500">{tr('发生时间（客户端）', 'Occurred At (Client)')}</dt><dd>{new Date(item.occurredAt).toLocaleString()}</dd></div>
      <div><dt className="text-slate-500">{tr('入库时间', 'Ingested At')}</dt><dd>{new Date(item.receivedAt).toLocaleString()}</dd></div>
      <div><dt className="text-slate-500">{tr('发生时账号（客户端登录会话快照）', 'Account Snapshot (Client Session)')}</dt><dd className="break-all">{accountLabel(item, tr)}{item.account?.status==='signed-in' && <span className="block text-slate-500">{tr(`账号 ID：${item.account.userId}`, `Account ID: ${item.account.userId}`)}</span>}</dd></div>
      <div><dt className="text-slate-500">{tr('电脑 / 安装实例', 'Machine / Installation')}</dt><dd className="break-all">{item.device?.hostname ?? tr('设备名未采集', 'Hostname not captured')}<span className="block text-slate-500">{item.platform} / {item.arch}{item.device?.osRelease && ` · ${item.device.osRelease}`}</span><span className="block text-slate-500">{item.installationId}</span></dd></div>
      {failure && <div><dt className="text-slate-500">{tr('根因证据', 'Root Cause Evidence')}</dt><dd>{failure.evidence==='native-session-log'?tr('已匹配本轮 Hermes 会话日志','Matched Hermes session log'):tr('运行时异常分类','Runtime exception classification')}{failure.logStatus==='no-match'?tr('；日志未找到本轮匹配证据','; no matching log entry found'):failure.logStatus==='unavailable'?tr('；本机日志不可读取','; local log unreadable'):''}</dd></div>}
      {failure?.rateLimitKind && <div><dt className="text-slate-500">{tr('限流与重试', 'Rate Limit & Retries')}</dt><dd>{failure.rateLimitKind==='tokens'?tr('每分钟 Token（TPM）','Tokens per minute (TPM)'):tr('每分钟请求（RPM）','Requests per minute (RPM)')}{failure.retryAfterSeconds!==undefined && tr(`；最后一次拒绝建议等待 ${failure.retryAfterSeconds} 秒`, `; retry-after ${failure.retryAfterSeconds}s`)}{failure.retriesExhausted && tr(`；${failure.attempts ?? '已达上限'} 次重试耗尽`, `; ${failure.attempts ?? 'max'} retries exhausted`)}</dd></div>}
      {failure?.tokensRequested!==undefined && <div><dt className="text-slate-500">{tr('服务报告的 Token 用量', 'Reported Token Usage')}</dt><dd>{tr(`本次请求 ${failure.tokensRequested.toLocaleString()}`, `Requested ${failure.tokensRequested.toLocaleString()}`)}{failure.tokensUsed!==undefined && tr(`；窗口已用 ${failure.tokensUsed.toLocaleString()}`, `; window used ${failure.tokensUsed.toLocaleString()}`)}{failure.tokenLimit!==undefined && tr(`；限额 ${failure.tokenLimit.toLocaleString()}`, `; limit ${failure.tokenLimit.toLocaleString()}`)}</dd></div>}
      {failure?.messageCount!==undefined && <div><dt className="text-slate-500">{tr('会话规模（Hermes 估算）', 'Session Size (Hermes Estimate)')}</dt><dd>{tr(`${failure.messageCount} 条消息`, `${failure.messageCount} messages`)}{failure.estimatedTokens!==undefined && tr(`；约 ${failure.estimatedTokens.toLocaleString()} Token`, `; ~${failure.estimatedTokens.toLocaleString()} tokens`)}</dd></div>}
      {metrics?.totalExecuteMs!==undefined && <div><dt className="text-slate-500">{tr('分阶段耗时', 'Stage Latency')}</dt><dd>{tr(`总计 ${(metrics.totalExecuteMs/1000).toFixed(1)} 秒`, `Total ${(metrics.totalExecuteMs/1000).toFixed(1)}s`)}{metrics.acpTurnMs!==undefined && tr(`；Hermes ${(metrics.acpTurnMs/1000).toFixed(1)} 秒`, `; Hermes ${(metrics.acpTurnMs/1000).toFixed(1)}s`)}{metrics.sessionSetupMs!==undefined && tr(`；会话准备 ${(metrics.sessionSetupMs/1000).toFixed(2)} 秒`, `; session setup ${(metrics.sessionSetupMs/1000).toFixed(2)}s`)}</dd></div>}
    </dl>
  </div>;
}

export default function RuntimeDiagnosticsPanel({token}:{token:string}) {
  const { tr } = useI18n();
  const [id,setId]=useState(''),[category,setCategory]=useState(''),[version,setVersion]=useState('');
  const [account,setAccount]=useState(''),[device,setDevice]=useState(''),[runId,setRunId]=useState('');
  const [query,setQuery]=useState({id:'',category:'',version:'',account:'',device:'',runId:'',offset:0,refresh:0});
  const [items,setItems]=useState<StoredDiagnostic[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setError('');setItems([]);
    void fetchRuntimeDiagnostics(token,query,controller.signal).then(result=>{if(!controller.signal.aborted)setItems(result.items);})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:tr('查询诊断失败','Failed to query diagnostics'));})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[token,query,tr]);
  const categoryOptions: [string, string][] = [
    ['ai', tr('AI 任务', 'AI Task')],
    ['tool', tr('工具调用', 'Tool Call')],
    ['renderer', tr('界面渲染', 'Renderer')],
    ['storage', tr('项目存储', 'Project Storage')],
    ['network', tr('网络请求', 'Network')],
    ['main', tr('桌面进程', 'Main Process')],
  ];
  return <section aria-label={tr('运行诊断查询', 'Runtime diagnostics search')} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
    <h2 className="mb-2 text-lg font-semibold">{tr('运行诊断', 'Runtime Diagnostics')}</h2>
    <p className="mb-3 text-xs text-slate-500">{tr('按编号定位，或用账号、电脑与任务轮次精确查询。账号和设备为错误发生时的客户端快照；旧记录缺失的信息不会补写为当前账号。', 'Search by diagnostic ID, or filter by account, machine, and run ID. Account and device reflect client snapshots when the error occurred; legacy records without account data are never backfilled.')}</p>
    <search><form className="mb-4 flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();setQuery({id:id.trim(),category,version:version.trim(),account:account.trim(),device:device.trim(),runId:runId.trim(),offset:0,refresh:query.refresh+1});}}>
      <input aria-label={tr('诊断编号', 'Diagnostic ID')} className="min-w-64 flex-1 rounded border p-2" placeholder={tr('诊断编号（完整 UUID）', 'Diagnostic ID (full UUID)')} value={id} onChange={e=>setId(e.target.value)}/>
      <input aria-label={tr('应用版本', 'App Version')} className="w-36 rounded border p-2" placeholder={tr('应用版本', 'App version')} value={version} onChange={e=>setVersion(e.target.value)}/>
      <input aria-label={tr('发生时账号', 'Account at Error')} className="min-w-48 flex-1 rounded border p-2" placeholder={tr('完整用户名或账号 ID', 'Username or account ID')} value={account} onChange={e=>setAccount(e.target.value)}/>
      <input aria-label={tr('发生时电脑', 'Machine at Error')} className="min-w-48 flex-1 rounded border p-2" placeholder={tr('完整设备名或安装实例 ID', 'Hostname or installation ID')} value={device} onChange={e=>setDevice(e.target.value)}/>
      <input aria-label={tr('任务轮次', 'Run ID')} className="min-w-48 flex-1 rounded border p-2" placeholder={tr('完整 runId（关联同一任务）', 'Full runId (correlates same task)')} value={runId} onChange={e=>setRunId(e.target.value)}/>
      <select aria-label={tr('异常来源', 'Category')} className="rounded border p-2" value={category} onChange={e=>setCategory(e.target.value)}>
        <option value="">{tr('全部来源', 'All Categories')}</option>{categoryOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select><button disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{tr('查询', 'Search')}</button>
    </form></search>
    {error&&<p role="alert" className="mb-3 text-rose-600">{error}</p>}
    {busy?<p>{tr('正在查询…', 'Searching…')}</p>:!error&&!items.length?<p className="py-4 text-slate-500">{tr('未找到匹配的诊断记录', 'No matching diagnostic records found')}</p>:null}
    <div className="space-y-2">{items.map(item=><details key={item.id} className="rounded border p-3">
      <summary className="cursor-pointer text-xs">{new Date(item.occurredAt).toLocaleString()} · {item.appVersion} / {item.platform} · {item.code}<span className="ml-2 select-all text-slate-500">{item.id}</span><span className="mt-1 block break-all text-slate-600">{accountLabel(item, tr)} · {item.device?.hostname ?? tr('设备名未采集', 'Hostname not captured')}{item.context?.failure?.reason && ` · ${reasonLabel(item.context.failure.reason, tr)}`}</span></summary>
      <Evidence item={item}/>
      {item.context?.runId && <button type="button" className="mt-3 text-xs text-blue-600" onClick={()=>{const relatedRun=item.context!.runId!;setId('');setCategory('');setVersion('');setAccount('');setDevice(item.installationId);setRunId(relatedRun);setQuery({id:'',category:'',version:'',account:'',device:item.installationId,runId:relatedRun,offset:0,refresh:query.refresh+1});}}>{tr('查看此电脑同一任务的全部诊断', 'View all diagnostics for this task on this machine')}</button>}
      <pre tabIndex={0} role="region" aria-label={tr(`诊断 JSON ${item.id}`, `Diagnostic JSON ${item.id}`)} className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all bg-slate-50 p-3 text-xs"><code>{JSON.stringify(item,null,2)}</code></pre>
    </details>)}</div>
    <div className="mt-4 flex items-center gap-4 text-xs"><button type="button" disabled={busy||query.offset===0} onClick={()=>setQuery({...query,offset:query.offset-50})} className="disabled:opacity-40">{tr('上一页', 'Prev')}</button><span>{tr(`第 ${query.offset/50+1} 页`, `Page ${query.offset/50+1}`)}</span><button type="button" disabled={busy||items.length<50||query.offset>=100000} onClick={()=>setQuery({...query,offset:query.offset+50})} className="disabled:opacity-40">{tr('下一页', 'Next')}</button></div>
  </section>;
}
