import { tr } from '../i18n/runtime';

export type DiagnosticCategory = 'ai' | 'tool' | 'renderer' | 'storage' | 'network' | 'main';
export type DiagnosticFailure = {
  reason?: string; evidence?: 'native-session-log' | 'runtime-error'; logStatus?: 'matched' | 'no-match' | 'unavailable'; observedAt?: string;
  rateLimitKind?: 'tokens' | 'requests'; retryAfterSeconds?: number; tokenLimit?: number; tokensUsed?: number; tokensRequested?: number;
  attempts?: number; messageCount?: number; estimatedTokens?: number; retriesExhausted?: boolean;
};
export type DiagnosticAccount = { status: 'signed-in'; source: 'client-session'; userId: string; username: string; displayName: string } | { status: 'unknown' | 'signed-out' };
export type DiagnosticContext = {
  projectId?: string; threadId?: string; pageId?: string; mindmapId?: string; targetPageId?: string; pfId?: string;
  sessionId?: string; runId?: string; modelId?: string; workflowPhase?: string; operation?: string;
  attempt?: number; durationMs?: number; toolCallCount?: number; failedToolCallCount?: number;
  checks?: Record<string,string>[]; boundTableIds?: string[];
  failure?: DiagnosticFailure; metrics?: Record<string,number>;
};
export type DiagnosticInput = { category: DiagnosticCategory; code: string; stage: string; message: string; stack?: string; context?: DiagnosticContext };
export type DiagnosticReport = DiagnosticInput & { id:string; occurredAt:string; appVersion:string; platform:string; arch:string; source:string;
  account?: DiagnosticAccount; device?: { hostname?:string; osRelease?:string; osVersion?:string } };
export type DiagnosticSnapshot = { enabled:boolean; serverUrl?:string; healthError:string; dropped:number; items:{report:DiagnosticReport;state:'pending'|'uploaded'|'rejected';lastStatus?:number}[] };
export type DiagnosticsBridge = {
  capture(input:DiagnosticInput):Promise<string|null>;
  snapshot():Promise<DiagnosticSnapshot>;
  configure(input:{enabled:boolean}):Promise<DiagnosticSnapshot>;
  retry():Promise<DiagnosticSnapshot>;
};
export function diagnosticsBridge():DiagnosticsBridge|undefined {
  return typeof window==='undefined'?undefined:(window as unknown as {protoflowDesktop?:{diagnostics?:DiagnosticsBridge}}).protoflowDesktop?.diagnostics;
}
export function isDiagnosticCancellation(error:unknown) {
  return error instanceof Error && (error.name==='AbortError' || /^(已停止|已取消|项目已切换，任务已停止|Stopped|Cancelled|Canceled|Project switched|model_switch_cancelled|The operation was aborted)/i.test(error.message));
}
const capturedErrors = new WeakMap<Error, Promise<string|null>>();
let diagnosticLocation:()=>DiagnosticContext = ()=>({});
export function currentDiagnosticLocation():DiagnosticContext { try{return diagnosticLocation();}catch{return {};} }
export async function captureDiagnostic(input:DiagnosticInput):Promise<string|null> {
  // Diagnostic transport must never become a new application failure.
  try { return await diagnosticsBridge()?.capture(input) ?? null; } catch { return null; }
}
export function captureRuntimeError(error:unknown, input:Omit<DiagnosticInput,'message'|'stack'> & {message?:string}) {
  if(isDiagnosticCancellation(error)) return Promise.resolve(null);
  if(error instanceof Error && capturedErrors.has(error)) return capturedErrors.get(error)!;
  if(error instanceof Error && error.cause instanceof Error && capturedErrors.has(error.cause)) return capturedErrors.get(error.cause)!;
  const stack=error instanceof Error?error.stack?.split('\n').slice(1).join('\n'):undefined;
  const result=captureDiagnostic({...input,context:input.context === undefined ? currentDiagnosticLocation() : input.context,message:input.message ?? (error instanceof Error?error.message:tr('未处理的运行时错误', 'Unhandled runtime error')),stack});
  if(error instanceof Error) capturedErrors.set(error,result);
  return result;
}
export function openRuntimeDiagnostics() { window.dispatchEvent(new Event('protoflow:open-diagnostics')); }
export function installRuntimeDiagnostics(location:()=>DiagnosticContext = ()=>({})) {
  const priorLocation=diagnosticLocation;diagnosticLocation=location;
  const seen=new WeakSet<object>();
  const capture=(error:unknown,stage:string)=>{
    if(error && typeof error==='object'){if(seen.has(error))return;seen.add(error);}
    void captureRuntimeError(error,{category:'renderer',code:'UNHANDLED_RENDERER_ERROR',stage});
  };
  const onError=(event:ErrorEvent)=>capture(event.error ?? new Error(event.message),'window.error');
  const onRejection=(event:PromiseRejectionEvent)=>capture(event.reason,'unhandledrejection');
  window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onRejection);
  return ()=>{diagnosticLocation=priorLocation;window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onRejection);};
}
