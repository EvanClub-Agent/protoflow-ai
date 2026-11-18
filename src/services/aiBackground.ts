import { captureRuntimeError, isDiagnosticCancellation, type DiagnosticContext } from './runtimeDiagnostics';

export type AiBackgroundState = {
  preventSleep: boolean; notifications: boolean; active: boolean; protected: boolean;
  locked: boolean; suspended: boolean; healthError: string;
};
export type AiTaskOutcome = 'finished' | 'failed' | 'cancelled';
type BackgroundBridge = {
  begin(scope: DiagnosticContext): Promise<string>;
  end(input: { leaseId: string; outcome: AiTaskOutcome }): Promise<void>;
  snapshot(): Promise<AiBackgroundState>;
  configure(input: Pick<AiBackgroundState, 'preventSleep' | 'notifications'>): Promise<AiBackgroundState>;
  onChange(listener: (state: AiBackgroundState) => void): () => void;
};
export function aiBackgroundBridge(): BackgroundBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { protoflowDesktop?: { aiBackground?: BackgroundBridge } }).protoflowDesktop?.aiBackground;
}
export function beginAiBackgroundTask(scope: DiagnosticContext) {
  const bridge = aiBackgroundBridge();
  // Browser mode and older desktop preload bridges do not provide native power management.
  if (!bridge) return undefined;
  return bridge.begin(scope).then(leaseId => async (outcome: AiTaskOutcome) => {
    try { await bridge.end({ leaseId, outcome }); }
    catch (error) {
      // Cleanup transport errors must not replace a generation/validation failure.
      void captureRuntimeError(error, { category: 'main', code: 'AI_BACKGROUND_RELEASE_FAILED', stage: 'background', message: '后台任务保护释放失败', context: scope });
    }
  });
}
export async function withAiBackgroundTask<T>(scope: DiagnosticContext, work: () => Promise<T>): Promise<T> {
  const pending = beginAiBackgroundTask(scope);
  if (!pending) return work();
  const end = await pending;
  let outcome: AiTaskOutcome = 'finished';
  try { return await work(); }
  catch (error) { outcome = isDiagnosticCancellation(error) ? 'cancelled' : 'failed'; throw error; }
  finally { await end(outcome); }
}
