const { buildSync } = require('esbuild');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
global.window = { localStorage: { getItem: () => null, setItem: () => {} } };
const compiled = buildSync({ entryPoints: [path.join(root, 'tests/publish-demo.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], loader: { '.svg': 'dataurl' } });
const fixture = new Module('publishing-demo'); fixture.filename = path.join(root, 'tests/.publishing-demo.cjs'); fixture.paths = Module._nodeModulePaths(root); fixture._compile(compiled.outputFiles[0].text, fixture.filename);
const service = process.env.PUBLISH_SERVICE_URL || 'http://localhost:8088';
const token = fs.readFileSync(process.env.PUBLISH_TOKEN_FILE || path.join(root, 'server/.publisher-token.local'), 'utf8').trim();
async function request(method, route, body, authenticated = true, expected = 200) {
  const response = await fetch(service + route, { method, headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const result = await response.json(); assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result)}`); return result;
}
async function main() {
  const snapshot = fixture.exports.createPublishDemo();
  const draft = { snapshot, access: { passwordAction: 'remove', password: '', expiresAt: null } };
  await request('GET','/api/v1/publisher');
  const published = await request('POST','/api/v1/publications',draft);
  let temporary;
  try {
    const viewed = await request('POST',`/api/v1/view/${published.id}/open`,{ password: '' },false);
    assert.deepEqual(viewed.snapshot,snapshot);
    const updated = await request('PUT',`/api/v1/publications/${published.id}`,{ ...draft, expectedVersion: published.version });
    assert.equal(updated.version,2);assert.equal(updated.shareUrl,published.shareUrl);
    await request('PUT',`/api/v1/publications/${published.id}`,{...draft,expectedVersion:1},true,409);
    temporary = await request('POST','/api/v1/publications',{ ...draft, access: { passwordAction:'set',password:'temporary-test-password',expiresAt:null } });
    const metadata=await request('GET',`/api/v1/view/${temporary.id}`,undefined,false);assert.equal(metadata.passwordProtected,true);assert.equal(metadata.snapshot,undefined);
    await request('POST',`/api/v1/view/${temporary.id}/open`,{password:'wrong'},false,401);
    await request('POST',`/api/v1/view/${temporary.id}/open`,{password:'temporary-test-password'},false);
    await request('POST',`/api/v1/publications/${temporary.id}/revoke`,{expectedVersion:temporary.version});
    await request('POST',`/api/v1/view/${temporary.id}/open`,{password:'temporary-test-password'},false,410);
    temporary=null;
    const html=await fetch(published.shareUrl);assert.equal(html.status,200);assert.match(await html.text(),/Alex/);
    fs.writeFileSync(path.join(root,'.publishing-smoke.local'),JSON.stringify({service,publication:updated,pages:snapshot.pages.length},null,2),{mode:0o600});
    console.log(JSON.stringify({result:'passed',shareUrl:updated.shareUrl,pages:snapshot.pages.length,version:updated.version,checks:['PostgreSQL snapshot round trip','stable-link update','version conflict','password gate','revocation','Nginx viewer routing']},null,2));
  } finally { if(temporary) await request('POST',`/api/v1/publications/${temporary.id}/revoke`,{expectedVersion:temporary.version}); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
