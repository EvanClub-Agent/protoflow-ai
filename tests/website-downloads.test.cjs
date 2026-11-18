const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const site = path.resolve(__dirname, '../website');
const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(site, 'main.js'), 'utf8');
const config = fs.readFileSync(path.join(site, 'config.js'), 'utf8');

function release(version, platforms = [], overrides = {}) {
  const id = `release-${version}`;
  return {
    id, version, title: 'Alex v99.0.0 title is not the version', channel: 'stable',
    published: true, publishedAt: '2026-11-13T10:00:00+08:00',
    assets: platforms.map(os => ({
      id: `asset-${version}-${os}`, releaseId: id, os,
      arch: os === 'macos' ? 'arm64' : 'x64',
      packageType: os === 'macos' ? 'dmg' : os === 'windows' ? 'exe' : 'deb',
      fileName: `Alex-${version}-${os}`, sizeBytes: 1024, sha256: 'a'.repeat(64),
      hosted: true, approved: true, channel: 'stable', signature: 'signed-by-server',
      downloadUrl: `http://releases.test/api/v1/updates/assets/asset-${version}-${os}/download`,
    })), ...overrides,
  };
}
const listing = (...items) => ({ latest: items[0] ?? null, items });

function settled(window) {
  return new Promise((resolve, reject) => {
    const doc = window.document;
    const done = () => doc.querySelector('[data-version]').textContent !== '版本加载中';
    if (done()) return resolve();
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Download UI did not settle')); }, 1500);
    const observer = new window.MutationObserver(() => {
      if (done()) { clearTimeout(timer); observer.disconnect(); resolve(); }
    });
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true });
  });
}

async function openSite(t, result, device = { os: 'linux', arch: 'x64' }) {
  const dom = new JSDOM(html, { url: 'http://website.test/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  Object.defineProperty(window.navigator, 'userAgentData', { value: {
    platform: device.os, getHighEntropyValues: async () => ({ architecture: device.arch === 'arm64' ? 'arm' : device.arch === 'x64' ? 'x86' : '' }),
  } });
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.console.info = () => {};
  const calls = [];
  window.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => typeof result === 'function' ? result(calls.length) : result };
  };
  window.eval(config);
  window.eval(script);
  await settled(window);
  return { window, doc: window.document, calls };
}

test('website uses published release version and same-origin downloads, without static fallback', async t => {
  const latest = release('0.0.9', ['linux']);
  const { doc, calls } = await openSite(t, listing(latest));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://website.test/api/v1/updates?channel=stable');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.deepEqual([...doc.querySelectorAll('[data-version]')].map(n => n.textContent), ['v0.0.9', 'v0.0.9']);
  const links = [...doc.querySelectorAll('[data-assets] a[download]')];
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'http://website.test/api/v1/updates/assets/asset-0.0.9-linux/download');
  assert.match(links[0].textContent, /v0\.0\.9/);
  assert.match(doc.querySelector('[data-os="macos"] [data-assets]').textContent, /暂未发布/);
  assert.match(doc.querySelector('[data-os="windows"] [data-assets]').textContent, /暂未发布/);
  assert.equal(doc.querySelector('[data-recommend]').hidden, false);
  assert.match(doc.querySelector('[data-recommend-meta]').textContent, /v0\.0\.9/);
  assert.doesNotMatch(doc.body.textContent, /v0\.0\.5|v99\.0\.0/);
});

test('staggered platforms keep their own published version and later uploads appear without a site change', async t => {
  const latest = release('0.0.10', ['linux']);
  const earlier = release('0.0.9', ['macos', 'windows']);
  const before = await openSite(t, listing(latest, earlier), { os: 'macos', arch: 'arm64' });
  assert.match(before.doc.querySelector('[data-os="macos"] [data-assets]').textContent, /v0\.0\.9/);
  assert.match(before.doc.querySelector('[data-recommend-meta]').textContent, /v0\.0\.9/);
  assert.equal(before.doc.querySelector('[data-version]').textContent, 'v0.0.10');
  const after = await openSite(t, listing(release('0.0.10', ['linux', 'macos']), earlier));
  assert.match(after.doc.querySelector('[data-os="macos"] [data-assets]').textContent, /v0\.0\.10/);
  assert.doesNotMatch(after.doc.querySelector('[data-os="macos"] [data-assets]').textContent, /v0\.0\.9/);
  assert.match(after.doc.querySelector('[data-os="windows"] [data-assets]').textContent, /v0\.0\.9/);
});

test('empty releases and releases awaiting packages do not resurrect static installers', async t => {
  for (const response of [listing(), listing(release('0.0.10'))]) {
    const { doc, calls } = await openSite(t, response);
    assert.equal(doc.querySelectorAll('a[download]').length, 0);
    assert.equal(calls.length, 1);
    assert.equal(doc.querySelector('[data-version]').textContent, response.latest ? 'v0.0.10' : '暂无发布');
    assert.equal(doc.querySelector('[data-recommend]').hidden, true);
    assert.equal(doc.querySelector('[data-release-actions] button'), null);
  }
});

test('release outage is explicit and retry recovers using the release API alone', async t => {
  const { window, doc, calls } = await openSite(t, count => {
    if (count === 1) throw new Error('backend unavailable');
    return listing(release('0.0.9', ['linux']));
  });
  assert.equal(doc.querySelector('[data-version]').textContent, '暂不可用');
  assert.equal(doc.querySelectorAll('a[download]').length, 0);
  assert.match(doc.querySelector('[data-source-note]').textContent, /加载失败/);
  doc.querySelector('[data-release-actions] button').click();
  await settled(window);
  assert.equal(doc.querySelector('[data-version]').textContent, 'v0.0.9');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.url.includes('/api/v1/updates?channel=stable')));
  assert.equal(doc.querySelector('[data-release-actions] button'), null);
});

test('invalid ownership, architecture, unpublished or unapproved data cannot become a download', async t => {
  const mutations = [
    r => { r.assets[0].releaseId = 'different-release'; },
    r => { delete r.assets[0].arch; },
    r => { r.assets[0].approved = false; },
    r => { r.assets[0].signature = ''; },
    r => { r.assets[0].sha256 = 'invalid'; },
    r => { r.assets[0].downloadUrl = 'javascript:alert(1)'; },
    r => { r.published = false; },
    r => { r.channel = 'beta'; },
  ];
  for (const mutate of mutations) {
    const r = release('0.0.9', ['linux']); mutate(r);
    const { doc, calls } = await openSite(t, listing(r));
    assert.equal(doc.querySelector('[data-version]').textContent, '暂不可用');
    assert.equal(doc.querySelectorAll('a[download]').length, 0);
    assert.equal(calls.length, 1);
  }
});

test('external download addresses remain published URLs and unknown Mac architecture is not guessed', async t => {
  const r = release('0.0.9', ['macos']);
  Object.assign(r.assets[0], { hosted: false, downloadUrl: 'https://cdn.example.com/Alex.dmg' });
  const { doc } = await openSite(t, listing(r), { os: 'macos', arch: null });
  assert.equal(doc.querySelector('[data-assets] a[download]').href, 'https://cdn.example.com/Alex.dmg');
  assert.equal(doc.querySelector('[data-recommend]').hidden, true);
});
