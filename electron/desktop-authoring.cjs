const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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
    if (session.published) fs.rmSync(session.connectionPath, { force: true });
  }

  async function open({ sessionId, projectId, storageDir, fileName }) {
    if (typeof sessionId !== 'string' || !sessionId || typeof projectId !== 'string' || !projectId ||
        typeof storageDir !== 'string' || !path.isAbsolute(storageDir) || typeof fileName !== 'string' ||
        path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.pflow')) {
      throw new Error('Invalid desktop project identity');
    }
    close();
    const projectPath = path.join(storageDir, fileName);
    const key = crypto.createHash('sha256').update(JSON.stringify([projectId, projectPath])).digest('hex');
    const connectionPath = path.join(directory, key + '.json');
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
    const session = { sessionId, server, connectionPath, published: false };
    active = session;
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.once('close', () => reject(new Error('Desktop connection closed')));
        server.listen(0, '127.0.0.1', resolve);
      });
      if (active !== session) throw new Error('Desktop connection closed');
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
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
  return { open, close, reply, requestSignal };
}

const skillRoots = new Map([
  ['codex', ['.agents', 'skills']],
  ['claude', ['.claude', 'skills']],
  ['antigravity', ['.gemini', 'config', 'skills']],
]);

function installDesignerSkill(client, home, source) {
  const parts = skillRoots.get(client);
  if (!parts) throw new Error('Unknown skill client');
  const root = path.join(home, ...parts);
  const target = path.join(root, 'alex-protoflow-designer');
  fs.mkdirSync(root, { recursive: true });
  // Stage the whole pack before publishing. Preserve any customized installation.
  const files = ['SKILL.md', ...fs.readdirSync(path.join(source, 'references')).map(name => path.join('references', name))];
  if (fs.existsSync(target)) {
    if (files.every(file => fs.existsSync(path.join(target, file)) &&
        fs.readFileSync(path.join(target, file)).equals(fs.readFileSync(path.join(source, file))))) return target;
    throw new Error('已有同名 Skill，请先移走自定义版本。 Existing skill differs: ' + target);
  }
  const temp = fs.mkdtempSync(path.join(root, '.alex-skill-'));
  try {
    fs.mkdirSync(path.join(temp, 'references'));
    for (const file of files) fs.copyFileSync(path.join(source, file), path.join(temp, file));
    fs.renameSync(temp, target);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  return target;
}

module.exports = { createDesktopAuthoringBridge, installDesignerSkill };
