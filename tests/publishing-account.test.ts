import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { PublishingClient } = require(path.join(process.cwd(), 'electron/publishing.cjs'));
const url = 'http://127.0.0.1:8088';
const user = { id: 'real-account-id', username: 'alice', displayName: 'Alice' };
const token = 'pfu_TestSessionSecret';
const login = { mode: 'login', username: 'alice', password: 'never-save-this-password' };
const storage = { isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value: string) => Buffer.from(value.split('').reverse().join('')),
  decryptStringAsync: async (value: Buffer) => ({ result: value.toString().split('').reverse().join('') }) };
const response = (body: any, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
test('desktop preview opens the published public URL for that exact record', async () => {
  const opened: string[] = [];
  const client = new PublishingClient({ dataDir: '', serviceUrl: url, openExternal: async (target: string) => { opened.push(target); } });
  const id = 'FIRSTSHARE12345678901234';
  const shareUrl = `https://share.example.com/p/${id}`;
  await client.openPreview({ id, shareUrl });
  for (const invalid of [
    { id, shareUrl: shareUrl + 'another-record' },
    { id, shareUrl: `file:///p/${id}` },
    { id, shareUrl: `https://account@share.example.com/p/${id}` },
    { id, shareUrl: shareUrl + '?source=private' },
    { id, shareUrl: shareUrl.replace('https:', 'http:') },
  ]) await assert.rejects(client.openPreview(invalid));
  assert.deepEqual(opened, [shareUrl]);
});

function setup(t: any, handler?: (route: string, options: any) => any) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publishing-account-test-')), calls: any[] = [];
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const client = new PublishingClient({ dataDir, safeStorage: storage, serviceUrl: url,
    fetchImpl: async (target: string, options: any) => {
      const route = target.slice(url.length); calls.push({ route, ...options });
      const result = handler?.(route, options); if (result !== undefined) return result;
      if (route === '/api/v1/auth/login' || route === '/api/v1/auth/register') return response({ user, token });
      if (route === '/api/v1/auth/me') return response({ user });
      if (route === '/api/v1/auth/logout') return response({ loggedOut: true });
      if (route.startsWith('/api/v1/publications?')) return response({ items: [] });
      throw new Error('Unexpected route: ' + route);
    } });
  return { client, dataDir, calls };
}
function legacy(dataDir: string, origin = url) {
  const content = JSON.stringify({ url: origin, encryptedToken: Buffer.from('legacy-secret'.split('').reverse().join('')).toString('base64') });
  fs.writeFileSync(path.join(dataDir, 'publishing.json'), content); return content;
}

test('native account login encrypts only the session, restores after restart and never exposes token or password', async t => {
  const { client, dataDir, calls } = setup(t);
  const state = await client.authenticate(login);
  assert.equal(state.configured, true); assert.deepEqual(state.user, user);
  const persisted = fs.readFileSync(client.sessionFile, 'utf8');
  for (const value of [persisted, JSON.stringify(state)]) { assert.ok(!value.includes(token)); assert.ok(!value.includes(login.password)); }
  const restarted = new PublishingClient({ dataDir, safeStorage: storage, serviceUrl: url, fetchImpl: client.fetch });
  assert.deepEqual(await restarted.settings(), state);
  await restarted.request({ action: 'list', projectId: 'exact/project?id' });
  assert.equal(calls.at(-1).route, '/api/v1/publications?projectId=exact%2Fproject%3Fid');
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer ' + token);
  assert.equal(calls.at(-1).redirect, 'error');
  await assert.rejects(restarted.request({ action: 'update', id: '../publisher', input: {} }), /发布 ID/);
  await assert.rejects(client.authenticate({ ...login, url: 'http://insecure.public.example' }), /HTTPS/);
  const unconfiguredDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publishing-unconfigured-'));
  t.after(() => fs.rmSync(unconfiguredDir, { recursive: true, force: true }));
  const unconfigured = new PublishingClient({ dataDir: unconfiguredDir, safeStorage: storage, serviceUrl: '' });
  assert.equal((await unconfigured.settings()).url, '');
  await assert.rejects(unconfigured.authenticate(login), /填写自建发布服务地址/);
});

test('an old same-origin credential requires explicit linking before any publication operation and survives logout', async t => {
  let linked = false;
  const { client, dataDir, calls } = setup(t, (route, options) => {
    if (route === '/api/v1/publisher') return response({ publisherId: 'legacy-owner', name: '原分享身份' });
    if (route === '/api/v1/auth/me') return response({ user: { ...user, ...(linked ? { publisherId: 'legacy-owner' } : {}) } });
    if (route === '/api/v1/auth/publisher') { assert.equal(JSON.parse(options.body).legacyToken, 'legacy-secret'); linked = true; return response({ publisherId: 'legacy-owner' }); }
  });
  const original = legacy(dataDir);
  await client.authenticate(login);
  const state = await client.settings();
  assert.equal(state.configured, false); assert.equal(state.legacy.publisherId, 'legacy-owner');
  assert.ok(!JSON.stringify(state).includes('legacy-secret'));
  await assert.rejects(client.request({ action: 'create', input: {} }), /选择是否关联/);
  assert.equal(calls.filter(call => call.route.startsWith('/api/v1/publications')).length, 0);
  assert.equal((await client.legacyChoice({ action: 'link' })).configured, true);
  await client.request({ action: 'list', projectId: 'same-project' });
  assert.equal(fs.readFileSync(path.join(dataDir, 'publishing.json'), 'utf8'), original);
  await client.logout();
  assert.equal((await client.settings()).configured, false);
  await assert.rejects(client.request({ action: 'list', projectId: 'same-project' }), /登录/);
});

test('explicitly choosing a new publishing identity persists across restart without destroying legacy proof', async t => {
  const { client, dataDir } = setup(t, route => route === '/api/v1/publisher' ? response({ publisherId: 'legacy-owner', name: 'Legacy' }) : undefined);
  const original = legacy(dataDir); await client.authenticate(login);
  assert.equal((await client.legacyChoice({ action: 'skip' })).configured, true);
  const restarted = new PublishingClient({ dataDir, safeStorage: storage, serviceUrl: url, fetchImpl: client.fetch });
  assert.equal((await restarted.settings()).legacy, null);
  assert.equal(fs.readFileSync(path.join(dataDir, 'publishing.json'), 'utf8'), original);
});

test('credentials from another origin are neither decrypted nor forwarded; invalid legacy credentials do not block a new account', async t => {
  const { client, dataDir, calls } = setup(t, route => route === '/api/v1/publisher' ? response({ error: 'invalid' }, 401) : undefined);
  legacy(dataDir, 'https://previous.example');
  let decrypts = 0;
  client.safeStorage = { ...storage, decryptStringAsync: async (value: Buffer) => { decrypts++; return storage.decryptStringAsync(value); } };
  assert.equal((await client.settings()).configured, false); assert.equal(decrypts, 0);
  assert.equal((await client.authenticate(login)).configured, true);
  assert.equal(calls.some(call => call.headers.Authorization === 'Bearer legacy-secret'), false);
  legacy(dataDir);
  assert.equal((await client.settings()).configured, true);
});

test('expired sessions become signed out, but a service failure does not erase a valid session', async t => {
  let status = 200;
  const { client } = setup(t, route => route === '/api/v1/auth/me' && status !== 200 ? response({ error: 'unavailable' }, status) : undefined);
  await client.authenticate(login);
  const saved = fs.readFileSync(client.sessionFile, 'utf8');
  status = 503; await assert.rejects(client.settings(), (error: any) => error.status === 503);
  assert.equal(fs.readFileSync(client.sessionFile, 'utf8'), saved);
  status = 401; assert.match((await client.settings()).notice, /登录已失效/);
  status = 200; assert.equal((await client.settings()).configured, false);
});

test('late responses after logout cannot restore account state or return old shares', async t => {
  let release!: (value: any) => void, signal!: () => void;
  const started = new Promise<void>(resolve => { signal = resolve; });
  const { client } = setup(t, route => route.startsWith('/api/v1/publications?') ? new Promise(resolve => { release = resolve; signal(); }) : undefined);
  await client.authenticate(login);
  const pending = client.request({ action: 'list', projectId: 'project-A' });
  const rejected = assert.rejects(pending, /账号已变化/);
  await started; await client.logout(); release(response({ items: [{ private: 'old-share' }] })); await rejected;
  assert.equal((await client.settings()).user, null);
});

test('unsafe system storage prevents authentication before sending a password', async t => {
  const { client, calls } = setup(t);
  client.safeStorage = { ...storage, getSelectedStorageBackend: () => 'basic_text' };
  await assert.rejects(client.authenticate(login), /安全存储不可用/);
  assert.equal(calls.length, 0);
});

test('diagnostic account identity comes from validated auth responses and is cleared on logout/expiry',async t=>{
 let status=200;
 const {client,dataDir}=setup(t,route=>route==='/api/v1/auth/me'&&status!==200?response({error:'expired'},status):undefined);
 assert.deepEqual(client.diagnosticAccount(),{status:'unknown'});
 await client.authenticate(login);
 const expected={status:'signed-in',userId:user.id,username:user.username,displayName:user.displayName};
 assert.deepEqual(client.diagnosticAccount(),expected);assert.equal(client.diagnosticAccount().publisherId,undefined);
 const restarted=new PublishingClient({dataDir,safeStorage:storage,serviceUrl:url,fetchImpl:client.fetch});
 assert.deepEqual(restarted.diagnosticAccount(),{status:'unknown'},'saved session ID alone is not a verified account');
 await restarted.accountSettings();assert.deepEqual(restarted.diagnosticAccount(),expected);
 status=503;await assert.rejects(restarted.accountSettings());assert.deepEqual(restarted.diagnosticAccount(),expected,'network errors do not switch the current account');
 status=401;await restarted.accountSettings();assert.deepEqual(restarted.diagnosticAccount(),{status:'signed-out'});
 status=200;await client.authenticate(login);await client.logout();assert.deepEqual(client.diagnosticAccount(),{status:'signed-out'});
});

test('a late auth/me response after logout cannot restore diagnostic identity',async t=>{
 let hold=false,release!:(value:any)=>void,started!:()=>void;
 const ready=new Promise<void>(r=>{started=r;});
 const {client}=setup(t,route=>hold&&route==='/api/v1/auth/me'?new Promise(r=>{release=r;started();}):undefined);
 await client.authenticate(login);hold=true;const read=client.accountSettings();const rejected=assert.rejects(read,/账号已变化/);await ready;
 await client.logout();release(response({user}));await rejected;assert.deepEqual(client.diagnosticAccount(),{status:'signed-out'});
});
