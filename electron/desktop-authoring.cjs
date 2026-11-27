const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { claimDirectory } = require('./claim-directory.cjs');
const { tr } = require('./i18n.cjs');

function claimConnectionFile(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, 'live.lock');
  const work = fs.mkdtempSync(path.join(directory, '.live-'));
  try {
    claimDirectory(lock, work, 'owner-' + process.pid + '-' + crypto.randomUUID(),
      tr('另一个 Alex 实例已开启双向设计，请先在该实例中关闭。', 'Disable bidirectional design in the other Alex instance first.'));
  } catch (error) {
    fs.rmSync(work, { recursive: true, force: true });
    throw error;
  }
  return () => {
    fs.renameSync(lock, path.join(work, 'released'));
    fs.rmSync(work, { recursive: true });
  };
}

function createDesktopAuthoringBridge(directory, send) {
  let active = null;
  const pending = new Map();

  function finish(id, body, status) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    request.lifetime.abort();
    request.response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    request.response.end(body);
  }

  function close(sessionId) {
    if (!active || (sessionId !== undefined && active.sessionId !== sessionId)) return;
    const session = active;
    active = null;
    for (const id of pending.keys()) finish(id, '', 503);
    session.server.close();
    session.server.closeAllConnections();
    try {
      if (session.published) fs.rmSync(session.connectionPath, { force: true });
    } finally { session.release?.(); }
  }

  async function open({ sessionId, projectId, storageDir, fileName }) {
    if (typeof sessionId !== 'string' || !sessionId || typeof projectId !== 'string' || !projectId ||
        typeof storageDir !== 'string' || !path.isAbsolute(storageDir) || typeof fileName !== 'string' ||
        path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.pflow')) {
      throw new Error('Invalid desktop project identity');
    }
    close();
    const projectPath = path.join(storageDir, fileName);
    const connectionPath = path.join(directory, 'live.json');
    const token = crypto.randomBytes(32).toString('hex');
    const authorization = Buffer.from('Bearer ' + token);
    const server = http.createServer(async (req, res) => {
      const reject = status => { res.writeHead(status); res.end(); };
      if (active !== session || req.url !== '/mcp' || req.method !== 'POST') return reject(404);
      const supplied = Buffer.from(req.headers.authorization ?? '');
      if (req.headers.origin !== undefined || supplied.length !== authorization.length ||
          !crypto.timingSafeEqual(supplied, authorization)) return reject(403);
      if (req.headers['content-type'] !== 'application/json') return reject(415);
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) return reject(413);
          chunks.push(chunk);
        }
        if (active !== session) return reject(403);
        if (pending.size >= 32) return reject(429);
        const id = crypto.randomUUID();
        const deadline = Date.now() + 55_000;
        pending.set(id, { response: res, lifetime: new AbortController(), timer: setTimeout(() => finish(id, '', 504), deadline - Date.now()) });
        res.once('close', () => { if (!res.writableEnded) finish(id, '', 499); });
        try { send({ sessionId, id, deadline, body: Buffer.concat(chunks).toString('utf8') }); }
        catch { finish(id, '', 503); }
      } catch { if (!res.headersSent && !res.destroyed) reject(400); }
    });
    const session = { sessionId, server, connectionPath, published: false, release: null };
    active = session;
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.once('close', () => reject(new Error('Desktop connection closed')));
        server.listen(0, '127.0.0.1', resolve);
      });
      if (active !== session) throw new Error('Desktop connection closed');
      session.release = claimConnectionFile(directory);
      const temporary = path.join(directory, crypto.randomUUID() + '.tmp');
      try {
        fs.writeFileSync(temporary, JSON.stringify({ port: server.address().port, token }), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, connectionPath);
      } finally { fs.rmSync(temporary, { force: true }); }
      session.published = true;
      return { connectionPath, projectPath };
    } catch (error) {
      close(sessionId);
      throw error;
    }
  }

  function reply({ sessionId, id, body, failed }) {
    if (active?.sessionId !== sessionId) return;
    finish(id, typeof body === 'string' ? body : '', failed ? 503 : body === null ? 204 : 200);
  }
  function requestSignal(sessionId, id) {
    if (!active || active.sessionId !== sessionId || !pending.has(id)) throw new Error('Desktop request expired');
    return pending.get(id).lifetime.signal;
  }
  function connectionFile(sessionId) {
    if (!active?.published || active.sessionId !== sessionId) throw new Error('Desktop connection closed');
    return active.connectionPath;
  }
  return { open, close, reply, requestSignal, connectionFile };
}

const skillRoots = new Map([
  ['codex', ['.agents', 'skills']],
  ['claude', ['.claude', 'skills']],
  ['antigravity', ['.gemini', 'config', 'skills']],
]);

function installDesignerSkill(client, home, source, codexHome, options = {}) {
  const parts = skillRoots.get(client);
  if (!parts) throw new Error('Unknown skill client');
  if (client === 'codex' && codexHome && !path.isAbsolute(codexHome)) throw new Error('CODEX_HOME must be absolute');
  const root = client === 'codex' && codexHome ? path.join(codexHome, 'skills') : path.join(home, ...parts);
  const { installDesignerFiles, skillFiles } = require('./designer-install.cjs');
  return installDesignerFiles(path.join(root, 'alex-protoflow-designer'), 'skill', skillFiles(source), undefined, options);
}

function syncManagedIntegrations({ root, home, executable, connectionFile, codexHome, installPlugin }) {
  const synced = [];
  if (typeof installPlugin === 'function' && connectionFile && executable) {
    const pluginDir = path.join(home, '.gemini', 'config', 'plugins', 'alex-protoflow-designer');
    if (fs.existsSync(pluginDir)) {
      try {
        installPlugin(root, home, { executable, connectionFile });
        synced.push(pluginDir);
      } catch {
        // Leave customized or busy plugin directories untouched during background sync.
      }
    }
  }
  const skillSource = path.join(root, 'skills', 'alex-protoflow-designer');
  if (fs.existsSync(skillSource)) {
    for (const [client, parts] of skillRoots.entries()) {
      try {
        const base = client === 'codex' && codexHome && path.isAbsolute(codexHome)
          ? path.join(codexHome, 'skills')
          : path.join(home, ...parts);
        const target = path.join(base, 'alex-protoflow-designer');
        if (fs.existsSync(target)) {
          installDesignerSkill(client, home, skillSource, codexHome);
          synced.push(target);
        }
      } catch {
        // Ignore customized or busy skill directories during silent sync.
      }
    }
  }
  return synced;
}

module.exports = { createDesktopAuthoringBridge, installDesignerSkill, syncManagedIntegrations };
