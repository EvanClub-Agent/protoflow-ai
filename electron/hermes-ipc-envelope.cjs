const { cleanText, isCancellation, failureReason } = require('./diagnostics.cjs');

const FAILURE_ENVELOPE_CODES = new Set([
  'PAGE_VALIDATION_FAILED',
  'DRAFT_RECOVERY_CONFLICT',
  'PROVIDER_RATE_LIMIT_BUDGET',
  'PROVIDER_SERVER_ERROR_BUDGET',
  'PROVIDER_QUOTA_EXHAUSTED',
  'PROVIDER_AUTH_FAILED',
  'PROVIDER_REQUEST_TOO_LARGE',
  'PROVIDER_REJECTED',
  'CONTEXT_OVERFLOW_UNRECOVERED',
  'GATEWAY_OUTCOME_UNKNOWN',
  'ACP_DISCONNECTED',
  'USER_CANCELLED',
  'RUNTIME_INTERNAL',
]);

function sanitizeFailureEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') return undefined;
  const code = FAILURE_ENVELOPE_CODES.has(envelope.code) ? envelope.code : 'RUNTIME_INTERNAL';
  const failureScope = ['page', 'shared', 'unknown'].includes(envelope.failureScope) ? envelope.failureScope : 'unknown';
  const terminalConfirmed = Boolean(envelope.terminalConfirmed);
  const candidateStatus = ['available', 'uncertain', 'none'].includes(envelope.candidateStatus) ? envelope.candidateStatus : 'none';
  const out = { code, failureScope, terminalConfirmed, candidateStatus };
  if (
    typeof envelope.targetPageId === 'string' &&
    envelope.targetPageId.length > 0 &&
    envelope.targetPageId.length <= 256 &&
    cleanText(envelope.targetPageId, 256) === envelope.targetPageId
  ) {
    out.targetPageId = envelope.targetPageId;
  }
  return out;
}

async function runHermesExecuteIpc(payload, executeFn, captureDiagnostic) {
  const wantsEnvelope = Boolean(payload && typeof payload === 'object' && payload.__ipcEnvelope === true);
  const cleanPayload = wantsEnvelope ? (({ __ipcEnvelope: _ignored, ...rest }) => rest)(payload) : payload;
  try {
    const value = await executeFn(cleanPayload);
    return wantsEnvelope ? { __ok: true, value } : value;
  } catch (error) {
    if (!wantsEnvelope) throw error;
    if (!isCancellation(error) && typeof captureDiagnostic === 'function') {
      captureDiagnostic({
        source: 'main',
        category: 'ai',
        code: 'IPC_FAILED',
        stage: 'pflow:hermes-execute',
        message: 'AI 桌面调用失败：' + failureReason(error?.cause ?? error),
        stack: String(error?.stack ?? '').split('\n').slice(1).join('\n'),
        context: {
          ...cleanPayload,
          checks: [
            ...(error?.backgroundChecks ?? []),
            ...(Number.isInteger(error?.rpcCode) ? [{ kind: 'acp-error', status: String(error.rpcCode), actionKind: error.rpcMethod }] : []),
          ],
        },
      });
    }
    const failureEnvelope = sanitizeFailureEnvelope(error?.failureEnvelope);
    return {
      __ok: false,
      error: {
        message: cleanText(error instanceof Error ? error.message : String(error), 1000),
        ...(failureEnvelope ? { failureEnvelope } : {}),
      },
    };
  }
}

module.exports = {
  FAILURE_ENVELOPE_CODES,
  sanitizeFailureEnvelope,
  runHermesExecuteIpc,
};
