const fs = require('node:fs/promises');
const path = require('node:path');

// Native error.data/log text may contain prompts and credentials. Export only
// known categories and numbers, never raw lines, paths or provider messages.
function reasonFromMessage(message) {
  if (/insufficient_quota|exceeded your current quota/i.test(message)) return 'quota';
  if (/rate.?limit|tokens per min|requests per min|\b429\b|限流/i.test(message)) return 'rate-limit';
  if (/timed?\s*out|timeout/i.test(message)) return 'timeout';
  if (/connection error|ECONN|ENOTFOUND|connection reset|connection refused/i.test(message)) return 'network';
  if (/\b40[13]\b|authenticationerror|invalid.api.key|unauthorized|forbidden/i.test(message)) return 'authentication';
  if (/context_length_exceeded|maximum context length|context window.*exceed/i.test(message)) return 'context-limit';
  return 'unclassified';
}

function parseNativeFailure(texts, { sessionId, startedAt, endedAt }) {
  if (typeof sessionId !== 'string' || !sessionId || /[\r\n\[\]]/.test(sessionId) || !Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;
  const events = [];
  for (const text of texts) for (const line of text.split('\n')) {
    // Hermes uses local wall time in these files. Exact session + this turn's
    // time window prevents another project or a previous retry being blamed.
    const match = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d[,.]\d{3})\s+(?:WARNING|ERROR)\s+\[([^\]]+)\]\s+agent\.conversation_loop:\s+(API call failed.*)$/.exec(line);
    if (!match || match[2] !== sessionId) continue;
    const at = new Date(match[1].replace(' ', 'T').replace(',', '.')).getTime();
    if (!Number.isFinite(at) || at < startedAt || at > endedAt) continue;
    events.push({ at, message: match[3] });
  }
  events.sort((a, b) => a.at - b.at);
  let failure = null;
  for (const { at, message } of events) {
    const exhausted = /API call failed after (\d+) retries/.exec(message);
    if (exhausted) {
      failure ??= { reason: 'unclassified', evidence: 'native-session-log' };
      failure.attempts = Number(exhausted[1]);
      failure.retriesExhausted = true;
      const size = /msgs=(\d+) tokens=~([\d,]+)/.exec(message);
      if (size) { failure.messageCount = Number(size[1]); failure.estimatedTokens = Number(size[2].replaceAll(',', '')); }
    } else {
      // The newest actual failure replaces earlier causes, even when unknown.
      // A recovered 429 must not mask a later, unrelated exception.
      failure = { reason: reasonFromMessage(message), evidence: 'native-session-log' };
      const attempt = /attempt (\d+)\/(\d+)/.exec(message);
      if (attempt) failure.attempts = Number(attempt[1]);
      if (failure.reason === 'rate-limit') {
        if (/tokens per min|\bTPM\b/i.test(message)) failure.rateLimitKind = 'tokens';
        else if (/requests per min|\bRPM\b/i.test(message)) failure.rateLimitKind = 'requests';
        const wait = /try again in ([\d.]+)s/i.exec(message);
        if (wait) failure.retryAfterSeconds = Number(wait[1]);
        const budget = /Limit ([\d,]+), Used ([\d,]+), Requested ([\d,]+)/i.exec(message);
        if (budget && failure.rateLimitKind === 'tokens') {
          [failure.tokenLimit, failure.tokensUsed, failure.tokensRequested] = budget.slice(1).map(n => Number(n.replaceAll(',', '')));
        }
      }
    }
    failure.observedAt = new Date(at).toISOString();
  }
  // A transient warning alone may have recovered before an unrelated ACP
  // failure. Only an explicit exhausted-retries event supports attribution.
  return failure?.retriesExhausted === true ? failure : null;
}

async function readTail(file) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('not a regular log file');
    const size = Math.min(stat.size, 512 * 1024), start = stat.size - size;
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, start);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    // Drop a truncated first line rather than treating it as a complete event.
    return start ? text.slice(text.indexOf('\n') + 1) : text;
  } finally { await handle.close(); }
}

async function nativeFailureEvidence({ home, sessionId, startedAt, endedAt }) {
  if (typeof home !== 'string' || !home || typeof sessionId !== 'string' || !sessionId) return { logStatus: 'unavailable' };
  const files = await Promise.allSettled(['errors.log', 'agent.log'].map(name => readTail(path.join(home, 'logs', name))));
  const texts = files.filter(r => r.status === 'fulfilled').map(r => r.value);
  const failure = parseNativeFailure(texts, { sessionId, startedAt, endedAt });
  return failure ? { ...failure, logStatus: 'matched' } : { logStatus: texts.length ? 'no-match' : 'unavailable' };
}

module.exports = { nativeFailureEvidence, parseNativeFailure, reasonFromMessage };
