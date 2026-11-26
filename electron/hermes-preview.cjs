const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const { pageContractErrors } = require('./generated/material-contract.cjs');

/** Observe atomic MCP staging writes, never incomplete model tokens or persisted projects. */
function watchStagedPages(file, scope, emit, isActive, initialCount = 0) {
  let stopped = false;
  let count = Number.isInteger(initialCount) && initialCount > 0 ? initialCount : 0;
  let tablesJson;
  let rowsJson;
  const published = new Map();
  const publish = (context, frozen = false) => {
    if (stopped || !isActive()) return;
    if ((!context.active && !frozen) || context.readOnly || context.runId !== scope.runId || context.projectId !== scope.projectId || context.pageId !== scope.pageId || context.kind !== scope.kind || context.threadId !== scope.threadId || context.mindmapId !== scope.mindmapId || !Array.isArray(context.operations)) return;
    const snapshot = context.snapshot;
    if (!snapshot || !Array.isArray(snapshot.dbTables) || !snapshot.pageSources) return;
    const nextTables = JSON.stringify(snapshot.dbTables);
    const nextRows = JSON.stringify(snapshot.tableRows);
    const targets = new Set(context.operations.slice(count).filter(op => op.tool === 'protoflow_apply_tsx_patch' && typeof op.args?.pageId === 'string').map(op => op.args.pageId));
    if (nextTables !== tablesJson || nextRows !== rowsJson) for (const id of published.keys()) targets.add(id);
    count = context.operations.length;
    for (const targetPageId of targets) {
      const source = snapshot.pageSources[targetPageId];
      if (typeof source !== 'string' || (source === published.get(targetPageId) && nextTables === tablesJson && nextRows === rowsJson)) continue;
      if (pageContractErrors(source, snapshot.dbTables, { tableRows: snapshot.tableRows }).length) continue;
      published.set(targetPageId, source);
      emit({ type: 'page-preview', ...scope, preview: { targetPageId, source, sequence: count, dbTables: snapshot.dbTables,
        ...(snapshot.tableRows ? { tableRows: snapshot.tableRows } : {}) } });
    }
    tablesJson = nextTables;
    rowsJson = nextRows;
  };
  const flush = () => {
    let context;
    try { context = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    publish(context);
  };
  // watchFile follows rename-based atomic writes on all supported desktop platforms.
  fs.watchFile(file, { interval: 100, persistent: false }, flush);
  // Only the host passes its verified final snapshot here after closing writes;
  // file-watch callbacks continue rejecting inactive or cancelled contexts.
  return { flush, flushFinal(context) { if (context.active === false) publish(context, true); },
    close() { stopped = true; fs.unwatchFile(file, flush); } };
}

/**
 * Loopback-only preview capture bridge allowing `protoflow-mcp.cjs` to render the
 * current turn's staged `PreviewSnapshot` in an isolated hidden BrowserWindow.
 * Strictly fenced by per-turn 256-bit Bearer token, exact `runId`, and turn cancellation.
 */
function createHermesPreviewBridge(captureSnapshot) {
  const turns = new Map();
  let server = null;
  let listeningPromise = null;
  let closed = false;

  function respondJson(res, status, payload) {
    if (res.headersSent || res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload));
  }

  async function ensureServer() {
    if (closed) throw new Error('Hermes preview bridge is closed');
    if (server && server.listening) return server.address().port;
    if (listeningPromise) return listeningPromise;
    const srv = http.createServer(async (req, res) => {
      if (req.url !== '/capture' || req.method !== 'POST') {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.headers.origin !== undefined) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (req.headers['content-type'] !== 'application/json') {
        res.writeHead(415);
        res.end();
        return;
      }
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) {
            res.writeHead(413);
            res.end();
            return;
          }
          chunks.push(chunk);
        }
      } catch {
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(400);
          res.end();
        }
        return;
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        respondJson(res, 400, { ok: false, error: 'Invalid JSON payload' });
        return;
      }
      const runId = typeof body?.runId === 'string' ? body.runId : '';
      const turn = runId ? turns.get(runId) : undefined;
      const supplied = Buffer.from(req.headers.authorization ?? '');
      if (
        !turn ||
        turn.controller.signal.aborted ||
        supplied.length !== turn.authHeader.length ||
        !crypto.timingSafeEqual(supplied, turn.authHeader)
      ) {
        respondJson(res, 403, { ok: false, error: 'Inactive or unauthorized preview capture turn' });
        return;
      }
      if (!body?.snapshot || typeof body.snapshot !== 'object') {
        respondJson(res, 400, { ok: false, error: 'Missing preview snapshot' });
        return;
      }
      const reqAbort = new AbortController();
      req.once('close', () => {
        if (!res.writableEnded) reqAbort.abort();
      });
      const signal = AbortSignal.any([turn.controller.signal, reqAbort.signal, AbortSignal.timeout(45000)]);
      try {
        const image = await captureSnapshot(body.snapshot, signal);
        if (turn.controller.signal.aborted || !turns.has(runId)) {
          respondJson(res, 409, { ok: false, error: 'Turn ended before preview capture completed' });
          return;
        }
        respondJson(res, 200, { ok: true, image });
      } catch (err) {
        respondJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
    srv.unref?.();
    listeningPromise = new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        server = srv;
        resolve(srv.address().port);
      });
    }).finally(() => {
      listeningPromise = null;
    });
    return listeningPromise;
  }

  return {
    async registerTurn(runId) {
      if (closed || typeof runId !== 'string' || !runId) return null;
      const port = await ensureServer();
      const token = crypto.randomBytes(32).toString('hex');
      const controller = new AbortController();
      turns.set(runId, {
        authHeader: Buffer.from('Bearer ' + token),
        controller,
      });
      return { port, token };
    },
    unregisterTurn(runId) {
      if (typeof runId !== 'string' || !runId) return;
      const entry = turns.get(runId);
      if (!entry) return;
      turns.delete(runId);
      entry.controller.abort();
    },
    close() {
      closed = true;
      for (const entry of turns.values()) {
        entry.controller.abort();
      }
      turns.clear();
      if (server) {
        const srv = server;
        server = null;
        try { srv.close(); } catch {}
        try { srv.closeAllConnections?.(); } catch {}
      }
    },
  };
}

module.exports = { watchStagedPages, createHermesPreviewBridge };
