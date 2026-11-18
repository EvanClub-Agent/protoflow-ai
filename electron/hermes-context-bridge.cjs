const { spawn, spawnSync, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const SCRIPT_FILE = path.join(__dirname, 'hermes-context.py');
const SURFACE_FILE = path.join(__dirname, 'hermes-acp-surface.py');
const DEFAULT_TIMEOUT_MS = 30000;

function readContextScript() {
  const surfaceSource = fs.readFileSync(SURFACE_FILE, 'utf8');
  const contextSource = fs.readFileSync(SCRIPT_FILE, 'utf8');
  return `_ALEX_BUNDLED_ACP_SURFACE_SOURCE = ${JSON.stringify(surfaceSource)}\n${contextSource}`;
}
const MAX_LINE_BYTES = 512 * 1024;
/** Actions served by the long-lived bridge. `compress` (unbounded duration) and
 * `watch` (streaming) keep their dedicated one-shot processes. */
const PERSISTENT_ACTIONS = new Set(['usage', 'history', 'verify_prompt', 'refresh_prompt']);
/** Pure reads may fall back to a one-shot process when the long-lived transport
 * fails. `refresh_prompt` mutates the native epoch and is never replayed. */
const IDEMPOTENT_ACTIONS = new Set(['usage', 'history', 'verify_prompt']);

class BridgeTransportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BridgeTransportError';
  }
}

function bridgeKey(bridge) {
  return JSON.stringify([bridge.python, bridge.installDir, bridge.home]);
}

/**
 * One long-lived `hermes-context.py --serve` process per Hermes installation.
 * Reuses the interpreter and imported Hermes modules (the cold-start cost),
 * never results: every request is forwarded and answered by Hermes itself.
 * Requests are strictly serialized, one in flight at a time.
 */
class PersistentContextBridge {
  constructor(bridge, { env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.bridge = { python: bridge.python, installDir: bridge.installDir, home: bridge.home };
    this.key = bridgeKey(bridge);
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.buffer = '';
    this.pending = null;
    this.queue = Promise.resolve();
    this.seq = 0;
    this.spawnCount = 0;
    this.closed = false;
  }

  get alive() {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  ensureChild() {
    if (this.alive) return false;
    this.buffer = '';
    const child = spawn(
      this.bridge.python,
      ['-I', '-c', readContextScript(), this.bridge.installDir, '--serve'],
      { env: { ...this.env, HERMES_HOME: this.bridge.home }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
    );
    this.spawnCount += 1;
    this.child = child;
    // An idle bridge must never keep the host process alive; the per-request
    // timeout timer keeps the loop running while a request is in flight.
    child.unref();
    child.stdout.unref?.();
    child.stdin.unref?.();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.onData(child, chunk));
    child.stdin.on('error', () => {});
    const fail = message => {
      if (this.child === child) this.child = null;
      // A late exit from a killed process must never reject a newer request.
      if (this.pending?.child === child) this.rejectPending(new BridgeTransportError(message));
    };
    child.on('error', () => fail('无法启动 Hermes 上下文接口'));
    child.on('exit', () => fail('Hermes 上下文接口已退出'));
    return true;
  }

  onData(child, chunk) {
    if (this.child !== child) return;
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.kill();
      this.rejectPending(new BridgeTransportError('Hermes 上下文响应过大'));
      return;
    }
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      let frame;
      try { frame = JSON.parse(line); } catch {
        this.kill();
        this.rejectPending(new BridgeTransportError('Hermes 上下文响应无效'));
        return;
      }
      const pending = this.pending;
      if (!pending || frame.requestId !== pending.requestId) continue; // Never accept another request's answer.
      this.pending = null;
      clearTimeout(pending.timer);
      const { requestId: _requestId, ...result } = frame;
      pending.resolve(result);
    }
  }

  rejectPending(error) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  kill() {
    const child = this.child;
    this.child = null;
    if (child) {
      try { child.kill(); } catch {}
    }
  }

  /** Resolves with the raw Hermes response (which may contain `error`). Rejects
   * with `BridgeTransportError` only when the transport itself failed. */
  request(payload, { timeoutMs = this.timeoutMs } = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (this.closed) return reject(new BridgeTransportError('Hermes 上下文接口已关闭'));
      const startedAt = performance.now();
      let coldStart;
      try { coldStart = this.ensureChild(); } catch {
        return reject(new BridgeTransportError('无法启动 Hermes 上下文接口'));
      }
      const requestId = `${process.pid}-${++this.seq}`;
      const timer = setTimeout(() => {
        this.kill();
        this.rejectPending(new BridgeTransportError('Hermes 上下文接口超时'));
      }, timeoutMs);
      this.pending = {
        requestId,
        child: this.child,
        timer,
        resolve: result => resolve({ result, coldStart, durationMs: performance.now() - startedAt }),
        reject,
      };
      try {
        this.child.stdin.write(JSON.stringify({ ...payload, requestId }) + '\n');
      } catch {
        this.kill();
        this.rejectPending(new BridgeTransportError('无法写入 Hermes 上下文接口'));
      }
    });
    const next = this.queue.then(run, run);
    this.queue = next.then(() => {}, () => {});
    return next;
  }

  close() {
    this.closed = true;
    this.kill();
    this.rejectPending(new BridgeTransportError('Hermes 上下文接口已关闭'));
  }
}

/** Original one-shot process: kept for sync callers, `compress`, and read fallbacks. */
function oneShotContextSync(bridge, payload, { env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const result = spawnSync(bridge.python, ['-I', '-c', readContextScript(), bridge.installDir], {
    input: JSON.stringify(payload),
    env: { ...env, HERMES_HOME: bridge.home }, timeout: timeoutMs, maxBuffer: 256 * 1024, encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) throw new BridgeTransportError('Hermes 上下文接口不可用');
  try { return JSON.parse(result.stdout); } catch { throw new BridgeTransportError('Hermes 上下文响应无效'); }
}

/** Async one-shot process for fallbacks; never blocks the caller's event loop. */
function oneShotContext(bridge, payload, { env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(bridge.python, ['-I', '-c', readContextScript(), bridge.installDir], {
      env: { ...env, HERMES_HOME: bridge.home }, timeout: timeoutMs, maxBuffer: 256 * 1024, windowsHide: true,
    }, (error, stdout) => {
      if (error) return reject(new BridgeTransportError('Hermes 上下文接口不可用'));
      try { resolve(JSON.parse(stdout)); } catch { reject(new BridgeTransportError('Hermes 上下文响应无效')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

class ContextBridgePool {
  constructor(options = {}) {
    this.options = options;
    this.bridges = new Map();
  }

  get(bridge) {
    const key = bridgeKey(bridge);
    let current = this.bridges.get(key);
    if (!current || current.closed) {
      current = new PersistentContextBridge(bridge, this.options);
      this.bridges.set(key, current);
    }
    return current;
  }

  /** Returns `{ result, mode, coldStart, durationMs }` where `mode` is
   * `persistent` or `oneshot-fallback`. Never caches a result. */
  async request(bridge, payload, options = {}) {
    if (!PERSISTENT_ACTIONS.has(payload.action)) throw new Error(`上下文动作 ${payload.action} 不支持常驻桥接`);
    const startedAt = performance.now();
    try {
      const { result, coldStart } = await this.get(bridge).request(payload, options);
      return { result, mode: 'persistent', coldStart, durationMs: performance.now() - startedAt };
    } catch (error) {
      if (!(error instanceof BridgeTransportError) || !IDEMPOTENT_ACTIONS.has(payload.action)) throw error;
      const result = await oneShotContext(bridge, payload, { env: this.options.env, timeoutMs: options.timeoutMs });
      return { result, mode: 'oneshot-fallback', coldStart: true, durationMs: performance.now() - startedAt };
    }
  }

  close() {
    for (const bridge of this.bridges.values()) bridge.close();
    this.bridges.clear();
  }
}

module.exports = {
  PersistentContextBridge,
  ContextBridgePool,
  bridgeKey,
  BridgeTransportError,
  readContextScript,
  oneShotContextSync,
  oneShotContext,
  PERSISTENT_ACTIONS,
  IDEMPOTENT_ACTIONS,
};
