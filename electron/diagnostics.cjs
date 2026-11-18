const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { origin } = require('./publishing.cjs');

const CATEGORIES = ['ai', 'tool', 'renderer', 'storage', 'network', 'main'];
const IDS = ['projectId','threadId','pageId','mindmapId','targetPageId','pfId','sessionId','runId','modelId','workflowPhase','operation'];
const CHECK_KEYS = ['kind','status','pageId','sourcePageId','sourceTableId','sourceColumnId','tableId','foreignKeyColumnId','actionPfId','actionEvent','actionKind','targetId','index'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function cleanText(value, limit = 1000) {
  return String(value ?? '')
    .replace(/\bbearer\s+\S+|\bsk-[a-zA-Z0-9_-]+/gi, '[redacted]')
    .replace(/(?:api[_-]?key|[a-z_]*token|password|secret|authorization|cookie)["' ]*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '[redacted]')
    .replace(/(?:https?|file):\/\/[^\s)]+/gi, '[url]')
    .replace(/(?:\/Users\/|\/home\/|[a-z]:\\Users\\)[^\s/\\]+/gi, '[home]')
    .slice(0, limit);
}
function cleanContext(input = {}) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  // Identity values are kept exactly, or omitted when invalid; never substituted/truncated.
  for (const key of IDS) if (typeof input[key] === 'string' && input[key].length <= 256 && !/[\r\n\0]/.test(input[key]) && cleanText(input[key], 256) === input[key]) out[key] = input[key];
  for (const key of ['attempt','durationMs','toolCallCount','failedToolCallCount']) {
    if (Number.isFinite(input[key]) && input[key] >= 0) out[key] = key === 'durationMs' ? Math.min(input[key], 604800000) : Math.floor(input[key]);
  }
  if (Array.isArray(input.boundTableIds)) out.boundTableIds = input.boundTableIds.filter(id => typeof id === 'string' && id.length<=256 && cleanText(id,256)===id).slice(0,100);
  if (Array.isArray(input.checks)) out.checks = input.checks.slice(0,100).map(check => {
    const item = {};
    for (const key of CHECK_KEYS) if (typeof check?.[key] === 'string' && check[key].length<=512 && cleanText(check[key],512)===check[key]) item[key] = check[key];
    return item;
  });
  if (input.failure && typeof input.failure === 'object') {
    const f = input.failure, failure = {};
    for (const [key, values] of Object.entries({
      reason: ['rate-limit','quota','timeout','network','authentication','context-limit','stale-state','context','validation','storage','unclassified'],
      evidence: ['native-session-log','runtime-error'], logStatus: ['matched','no-match','unavailable'], rateLimitKind: ['tokens','requests'],
    })) if (values.includes(f[key])) failure[key] = f[key];
    for (const key of ['retryAfterSeconds','tokenLimit','tokensUsed','tokensRequested','attempts','messageCount','estimatedTokens']) {
      if (Number.isFinite(f[key]) && f[key] >= 0 && f[key] <= 1e12) failure[key] = f[key];
    }
    if (typeof f.retriesExhausted === 'boolean') failure.retriesExhausted = f.retriesExhausted;
    if (typeof f.observedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(f.observedAt) && Number.isFinite(Date.parse(f.observedAt))) failure.observedAt = f.observedAt;
    out.failure = failure;
  }
  if (input.metrics && typeof input.metrics === 'object') {
    out.metrics = {};
    for (const key of METRIC_KEYS) if (Number.isFinite(input.metrics[key]) && input.metrics[key] >= 0 && input.metrics[key] <= 1e12) out.metrics[key] = input.metrics[key];
  }
  return out;
}
const METRIC_KEYS = ['providerRetryCount','providerWaitMs','totalExecuteMs','sessionSetupMs','contextBridgeSetupMs','firstOutputMs','firstTextMs','acpTurnMs','unattributedAcpMs','userWaitMs','promptVerifyMs','toolExecMs','toolCallCount','failedToolCallCount','nativeToolExecMs','nativeToolCallCount','failedNativeToolCallCount','contextQueryMs','contextQueryCount','contextColdStarts','promptBytes','imageBytes','snapshotBytes','contextJsonBytes','skillBytes'];
function safeIdentityText(value) { return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 256 && !/[\r\n\0]/.test(value) && cleanText(value,256) === value; }
function cleanAccount(value) {
  if (value?.status === 'signed-out') return { status: 'signed-out' };
  if (value?.status !== 'signed-in' || !['userId','username','displayName'].every(key => safeIdentityText(value[key]))) return { status: 'unknown' };
  return { status: 'signed-in', source: 'client-session', userId: value.userId, username: value.username, displayName: value.displayName };
}
function cleanDevice(value) {
  const device = {};
  for (const key of ['hostname','osRelease','osVersion']) if (safeIdentityText(value?.[key])) device[key] = value[key];
  return device;
}
function isCancellation(error) {
  return error?.name === 'AbortError' || /^(已停止|已取消|项目已切换，任务已停止|model_switch_cancelled|The operation was aborted)/.test(String(error?.message ?? error));
}
function failureReason(error) {
  const text=String(error?.message ?? error);
  const nativeReason = require('./hermes-failure.cjs').reasonFromMessage(text);
  if (nativeReason !== 'unclassified') return nativeReason;
  if(/timeout|timed out|超时/i.test(text))return 'timeout';
  if(/ECONN|ENOTFOUND|fetch failed|network|网络|连接.*(?:断|失败)/i.test(text))return 'network';
  if(/401|403|unauthorized|forbidden|api.?key|鉴权|认证|凭证/i.test(text))return 'authentication';
  if(/stale|旧轮次|已变化|过期|版本冲突/i.test(text))return 'stale-state';
  if(/compression|brief|上下文|压缩/i.test(text))return 'context';
  if(/contract|validation|验收|绑定|契约|无效|缺少/i.test(text))return 'validation';
  if(/ENOSPC|EACCES|EROFS|磁盘|权限/i.test(text))return 'storage';
  return 'unclassified';
}
function atomicJSON(file, value) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
class DiagnosticCollector {
  constructor({ dataDir, serverUrl = '', serverUrlProvider = null, appVersion, platform = process.platform, arch = process.arch, enabled = false, fetchImpl = globalThis.fetch, now = Date.now,
    accountProvider = () => ({ status: 'unknown' }), device = { hostname: os.hostname(), osRelease: os.release(), osVersion: os.version() } }) {
    this.dir = path.join(dataDir, 'diagnostics');
    this.serverUrl = typeof serverUrl === 'string' && serverUrl.trim() ? origin(serverUrl.trim()) : '';
    this.serverUrlProvider = typeof serverUrlProvider === 'function' ? serverUrlProvider : null;
    this.environment = { appVersion, platform, arch }; this.fetch = fetchImpl; this.now = now;
    this.accountProvider = accountProvider; this.device = cleanDevice(device);
    this.records = new Map(); this.inFlight = null; this.registered = false; this.closed = false; this.healthError = ''; this.dropped = 0;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const identityFile = path.join(this.dir, 'installation.json');
    if (fs.existsSync(identityFile)) {
      this.identity = JSON.parse(fs.readFileSync(identityFile,'utf8'));
      if (!UUID.test(this.identity.id) || !/^[0-9a-f]{64}$/.test(this.identity.token)) throw new Error('诊断安装凭证损坏');
    } else { this.identity = { id: randomUUID(), token: randomBytes(32).toString('hex') }; atomicJSON(identityFile, this.identity); }
    this.enabled = enabled;
    const settings = path.join(this.dir,'settings.json');
    if (fs.existsSync(settings)) { try { const value=JSON.parse(fs.readFileSync(settings,'utf8')); if(typeof value.enabled==='boolean') this.enabled=value.enabled; } catch { this.healthError='诊断设置读取失败'; } }
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith('.json') || !UUID.test(name.slice(0,-5))) continue;
      try { const entry=JSON.parse(fs.readFileSync(path.join(this.dir,name),'utf8')); if(entry.report?.id===name.slice(0,-5) && Number.isFinite(Date.parse(entry.report.occurredAt))) this.records.set(entry.report.id,entry); }
      catch { this.healthError='部分本地诊断记录无法读取'; }
    }
    this.prune();
  }
  start() { if(this.timer) return; this.timer=setInterval(()=>{void this.flush();},30000); this.timer.unref?.(); void this.flush(); }
  close() { this.closed=true; clearInterval(this.timer); }
  persist(entry) { atomicJSON(path.join(this.dir,entry.report.id+'.json'),entry); }
  prune() {
    const sorted=[...this.records.values()].sort((a,b)=>a.report.occurredAt.localeCompare(b.report.occurredAt));
    for(const entry of sorted) if(this.records.size>200 || Date.parse(entry.report.occurredAt)<this.now()-7*86400000) {
      fs.rmSync(path.join(this.dir,entry.report.id+'.json'),{force:true});this.records.delete(entry.report.id);if(entry.state!=='uploaded') this.dropped++;
    }
  }
  capture(input) {
    try {
      if(!CATEGORIES.includes(input?.category) || !/^[A-Z][A-Z0-9_]{1,79}$/.test(input.code) || !/^[a-zA-Z0-9_.:/ -]{1,120}$/.test(input.stage)) return null;
      const report={ id:randomUUID(),occurredAt:new Date(this.now()).toISOString(),...this.environment,
        source:input.source==='renderer'?'renderer':'main',category:input.category,code:input.code,stage:input.stage,
        message:cleanText(input.message),stack:cleanText(input.stack,4000),context:cleanContext(input.context) };
      // Capture identity NOW, never at upload time. Renderer-provided identity is
      // ignored. Offline uploads/restarts must retain the original account.
      try { report.account = cleanAccount(this.accountProvider()); } catch { report.account = { status: 'unknown' }; }
      report.device = { ...this.device };
      // Measure UTF-8 bytes, not characters (Chinese check results can be 3 bytes each).
      while(Buffer.byteLength(JSON.stringify(report))>60*1024 && report.context.checks?.length) report.context.checks.pop();
      while(Buffer.byteLength(JSON.stringify(report))>60*1024 && report.context.boundTableIds?.length) report.context.boundTableIds.pop();
      if(Buffer.byteLength(JSON.stringify(report))>60*1024) {this.healthError='诊断记录超过体积限制';return null;}
      const fingerprint=createHash('sha256').update(JSON.stringify([report.code,report.stage,report.message,report.context,report.account,report.device])).digest('hex');
      const same=[...this.records.values()].find(e=>e.fingerprint===fingerprint && this.now()-Date.parse(e.report.occurredAt)<30000);
      if(same)return same.report.id;
      const entry={report,fingerprint,state:'pending',attempts:0,nextAttemptAt:0};
      this.persist(entry);this.records.set(report.id,entry);this.prune();
      if(!this.closed) void this.flush();
      return report.id;
    } catch { this.healthError='无法写入本地诊断，请检查磁盘空间与目录权限';return null; }
  }
  activeServerUrl() {
    if (this.serverUrl) return this.serverUrl;
    try {
      const candidate = this.serverUrlProvider?.();
      return typeof candidate === 'string' && candidate.trim() ? origin(candidate.trim()) : '';
    } catch { return ''; }
  }
  snapshot() { return {enabled:this.enabled,serverUrl:this.activeServerUrl(),healthError:this.healthError,dropped:this.dropped,items:[...this.records.values()].sort((a,b)=>b.report.occurredAt.localeCompare(a.report.occurredAt)).map(({report,state,lastStatus})=>({report,state,lastStatus}))}; }
  configure({enabled}) { if(typeof enabled!=='boolean')throw new Error('诊断设置无效');atomicJSON(path.join(this.dir,'settings.json'),{enabled});this.enabled=enabled;if(enabled)void this.flush();return this.snapshot(); }
  async request(route, body, authenticated = false) {
    const targetUrl = this.activeServerUrl();
    if (!targetUrl) throw new Error('尚未配置诊断服务地址');
    const res=await this.fetch(targetUrl+'/api/v1/diagnostics/'+route,{method:'POST',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+this.identity.token,'X-Diagnostic-Installation':this.identity.id}:{})},body:JSON.stringify(body)});
    const data=res.ok?await res.json():null;return {status:res.status,data};
  }
  flush() {
    if(this.inFlight)return this.inFlight;
    if(!this.enabled||!this.activeServerUrl()||this.closed)return Promise.resolve();
    this.inFlight=this.upload().catch(()=>{this.healthError='诊断上传暂不可用，将自动重试';}).finally(()=>{this.inFlight=null;});return this.inFlight;
  }
  async upload() {
    this.prune();
    const queue=[...this.records.values()].filter(e=>e.state==='pending'&&e.nextAttemptAt<=this.now()).slice(0,10);
    if(!queue.length)return;
    for(const entry of queue) {
      if(this.closed||!this.enabled)break;
      let status=0;
      try {
        if(!this.registered){const r=await this.request('installations',this.identity);status=r.status; if(status!==200||r.data?.registered!==true)throw new Error('registration');this.registered=true;}
        const r=await this.request('reports',entry.report,true);status=r.status;
        if(status===200 && r.data?.stored===true && r.data.id===entry.report.id) {entry.state='uploaded';this.healthError='';}
        else if(status===401){this.registered=false;}
        else if([400,409,413,415,422].includes(status))entry.state='rejected';
      } catch { /* Retry the same ID after offline/network/server failures. */ }
      // A capture/prune can evict this record while its request is in flight.
      // Do not recreate an expired file after it has left the bounded queue.
      if (!this.records.has(entry.report.id)) continue;
      entry.lastStatus=status;entry.attempts++;
      entry.nextAttemptAt=this.now()+Math.min(3600000,30000*2**Math.min(entry.attempts-1,7));this.persist(entry);
      if(entry.state==='pending')break;
    }
  }
  async retry() { for(const entry of this.records.values())if(entry.state==='pending')entry.nextAttemptAt=0;await this.flush();return this.snapshot(); }
}
module.exports={DiagnosticCollector,cleanText,cleanContext,isCancellation,failureReason};
