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
    const done = () => !['版本加载中', 'Loading version'].includes(doc.querySelector('[data-version]').textContent);
    if (done()) return resolve();
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Download UI did not settle')); }, 1500);
    const observer = new window.MutationObserver(() => {
      if (done()) { clearTimeout(timer); observer.disconnect(); resolve(); }
    });
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true });
  });
}

async function openSite(t, result, device = { os: 'linux', arch: 'x64' }, settings = {}, url = 'http://website.test/') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
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
  Object.assign(window.ALEX_SITE_CONFIG, settings);
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

const repo = 'https://github.com/EvanClub-Agent/protoflow-ai';
function githubLatest() {
  const names = ['mac-arm64.dmg', 'mac-x64.zip', 'win-x64.exe', 'linux-amd64.deb', 'linux-x86_64.AppImage', 'linux-x64.tar.gz'];
  return {
    tag_name: 'v1.2.3', name: 'An unrelated release title', draft: false, prerelease: false,
    published_at: '2026-11-22T09:02:44Z', html_url: repo + '/releases/tag/v1.2.3',
    assets: [...names.map(n => 'Alex-1.2.3-' + n), 'designer.zip', 'SHA256SUMS.txt'].map(name => ({
      name, state: 'uploaded', size: 1024, digest: 'sha256:' + 'b'.repeat(64),
      browser_download_url: repo + '/releases/download/v1.2.3/' + name,
    })),
  };
}

test('GitHub mode renders stable desktop assets and uses the actual architecture and published links', async t => {
  const data = githubLatest();
  const { doc, calls } = await openSite(t, data, { os: 'macos', arch: 'arm64' }, { releaseSource: 'github' });
  assert.deepEqual(calls.map(c => c.url), ['https://api.github.com/repos/EvanClub-Agent/protoflow-ai/releases/latest']);
  assert.equal(doc.querySelector('[data-version]').textContent, 'v1.2.3');
  assert.equal(doc.querySelector('[data-recommend-link]').href, data.assets[0].browser_download_url);
  for (const [os, count] of [['macos', 2], ['windows', 1], ['linux', 3]]) {
    assert.equal(doc.querySelectorAll(`[data-os="${os}"] [data-assets] a[download]`).length, count);
  }
  assert.match(doc.querySelector('[data-os="linux"] [data-assets]').textContent, /x64/);
  assert.match(doc.querySelector('[data-recommend-meta]').textContent, /SHA-256 bbbbbbbbbbbb/);
  assert.equal(doc.querySelector('[data-release-actions] a').href, repo + '/releases/latest');
});

test('GitHub mode rejects invalid provenance and keeps the official release page available on failure', async t => {
  for (const change of [
    r => { r.draft = true; }, r => { r.prerelease = true; }, r => { r.tag_name = 'v1.2.4'; },
    r => { r.assets[0].browser_download_url = 'https://example.com/installer'; },
    r => { r.assets[0].digest = null; }, () => { throw new Error('GitHub rate limit'); },
  ]) {
    const { doc, calls } = await openSite(t, () => {
      const r = githubLatest(); change(r); return r;
    }, undefined, { releaseSource: 'github' });
    assert.equal(calls.length, 1);
    assert.equal(doc.querySelector('[data-version]').textContent, '暂不可用');
    assert.equal(doc.querySelectorAll('[data-assets] a[download]').length, 0);
    assert.equal(doc.querySelector('[data-release-actions] a').href, repo + '/releases/latest');
  }
});

test('hero version badge hides cleanly on empty or failed release states and appears when ready', async t => {
  const ready = await openSite(t, listing(release('0.0.9', ['linux'])));
  assert.equal(ready.doc.querySelector('[data-hero-version]').hidden, false);
  assert.equal(ready.doc.querySelector('[data-hero-version] [data-version]').textContent, 'v0.0.9');

  const empty = await openSite(t, listing());
  assert.equal(empty.doc.querySelector('[data-hero-version]').hidden, true);

  const errored = await openSite(t, () => { throw new Error('network error'); });
  assert.equal(errored.doc.querySelector('[data-hero-version]').hidden, true);
});

test('config links bind contactEmail, repoUrl, discordUrl, and optional demoUrl cleanly', async t => {
  const custom = await openSite(t, listing(release('0.0.9', ['linux'])), { os: 'linux', arch: 'x64' }, {
    contactEmail: 'team@protoflow.example',
    repoUrl: 'https://github.com/acme/protoflow-custom',
    discordUrl: 'https://discord.gg/customInvite',
    demoUrl: 'https://demo.protoflow.example/p/crm-demo',
  });
  const mailLinks = [...custom.doc.querySelectorAll('[data-contact-email]')];
  assert.ok(mailLinks.length >= 2);
  assert.ok(mailLinks.every(a => a.href === 'mailto:team@protoflow.example'));
  assert.equal(custom.doc.querySelector('[data-contact-email-text]').textContent, 'team@protoflow.example');

  const repoLinks = [...custom.doc.querySelectorAll('[data-repo-link]')];
  assert.ok(repoLinks.length >= 5);
  assert.ok(repoLinks.every(a => a.href.startsWith('https://github.com/acme/protoflow-custom')));

  const discordLinks = [...custom.doc.querySelectorAll('[data-discord-link]')];
  assert.ok(discordLinks.length >= 2);
  assert.ok(discordLinks.every(a => a.href === 'https://discord.gg/customInvite' && a.hidden === false));

  const secondary = custom.doc.querySelector('[data-secondary-cta]');
  assert.equal(secondary.href, 'https://demo.protoflow.example/p/crm-demo');
  assert.equal(secondary.textContent, '在线体验原型');

  const withoutDiscord = await openSite(t, listing(release('0.0.9', ['linux'])), undefined, { discordUrl: '' });
  for (const link of withoutDiscord.doc.querySelectorAll('[data-discord-link]')) {
    assert.equal(link.hidden, true);
  }
});

test('bilingual switching supports ?lang=en, toggle button, comparison headers, and covers all i18n keys', async t => {
  const { window, doc } = await openSite(t, listing(release('0.0.9', ['linux'])), undefined, {}, 'http://website.test/?lang=en');
  assert.equal(doc.documentElement.lang, 'en');
  assert.match(doc.title, /Alex \(ProtoFlow AI\)/);
  assert.match(doc.title, /Turn Requirements into Runnable Prototypes/);
  assert.equal(doc.querySelector('[data-compare-table]').style.getPropertyValue('--col-1'), '"Static Wireframing Tools"');
  assert.equal(doc.querySelector('[data-lang-toggle]').textContent, '中文');

  const keys = new Set();
  for (const el of doc.querySelectorAll('[data-i18n]')) keys.add(el.dataset.i18n);
  for (const el of doc.querySelectorAll('[data-i18n-html]')) keys.add(el.dataset.i18nHtml);
  for (const el of doc.querySelectorAll('[data-i18n-aria]')) keys.add(el.dataset.i18nAria);
  for (const el of doc.querySelectorAll('[data-i18n-alt]')) keys.add(el.dataset.i18nAlt);
  for (const key of keys) {
    assert.ok(script.includes(`'${key}':`) || script.includes(`${key}:`), `Missing EN_TEXT translation key: ${key}`);
  }

  doc.querySelector('[data-lang-toggle]').click();
  assert.equal(doc.documentElement.lang, 'zh-CN');
  assert.match(doc.title, /把需求做成能跑起来的业务原型/);
  assert.equal(doc.querySelector('[data-compare-table]').style.getPropertyValue('--col-1'), '"传统静态原型工具"');
  assert.equal(doc.querySelector('[data-lang-toggle]').textContent, 'EN');
  assert.equal(window.location.search, '?lang=zh');
});

test('showcase tabs switch aria-selected, roving tabindex, and panel hidden states via click and keyboard', async t => {
  const { window, doc } = await openSite(t, listing(release('0.0.9', ['linux'])));
  const tabs = [...doc.querySelectorAll('[data-tabs] [role="tab"]')];
  const panels = [...doc.querySelectorAll('[data-tabs] [role="tabpanel"]')];
  assert.equal(tabs.length, 4);
  assert.equal(panels.length, 4);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(panels[0].hidden, false);
  assert.ok(panels[1].hasAttribute('hidden'));

  tabs[1].click();
  assert.equal(tabs[0].getAttribute('aria-selected'), 'false');
  assert.equal(tabs[0].tabIndex, -1);
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(tabs[1].tabIndex, 0);
  assert.equal(panels[0].getAttribute('hidden'), 'until-found');
  assert.equal(panels[1].hidden, false);

  tabs[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true');
  assert.equal(panels[2].hidden, false);

  tabs[2].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(tabs[3].getAttribute('aria-selected'), 'true');
  assert.equal(panels[3].hidden, false);

  tabs[3].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(panels[0].hidden, false);

  tabs[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(tabs[3].getAttribute('aria-selected'), 'true');
  assert.equal(panels[3].hidden, false);
});

test('SEO and GEO metadata, Schema.org @graph, and crawl files are complete across / and /en/', () => {
  for (const rel of [
    'robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt',
    'en/index.html', 'about/index.html', 'contact/index.html', 'privacy/index.html', 'mcp/index.html',
    '404.html', '404.md',
  ]) {
    assert.ok(fs.existsSync(path.join(site, rel)), `Missing SEO/GEO file: website/${rel}`);
  }
  const vercelCfgPath = path.resolve(__dirname, '../deploy/vercel-website.json');
  assert.ok(fs.existsSync(vercelCfgPath), 'Missing deploy/vercel-website.json');
  const vercelCfg = JSON.parse(fs.readFileSync(vercelCfgPath, 'utf8'));
  assert.ok(Array.isArray(vercelCfg.routes));
  const fsIdx = vercelCfg.routes.findIndex(r => r.handle === 'filesystem');
  assert.ok(fsIdx > 0, 'Expected pre-filesystem routes before handle: filesystem');
  assert.ok(vercelCfg.routes.slice(0, fsIdx).some(r => r.dest === '/llms.txt'));
  assert.ok(vercelCfg.routes.slice(fsIdx + 1).some(r => r.status === 404 && r.dest === '/404.md'));
  assert.ok(vercelCfg.routes.slice(fsIdx + 1).some(r => r.status === 404 && r.dest === '/404.html'));

  const robots = fs.readFileSync(path.join(site, 'robots.txt'), 'utf8');
  assert.match(robots, /Sitemap:\s*https:\/\/alex\.xclubai\.com\/sitemap\.xml/);
  assert.match(robots, /User-agent:\s*GPTBot/);
  assert.match(robots, /User-agent:\s*ClaudeBot/);
  assert.match(robots, /User-agent:\s*PerplexityBot/);

  const sitemap = fs.readFileSync(path.join(site, 'sitemap.xml'), 'utf8');
  for (const locUrl of [
    'https://alex.xclubai.com/',
    'https://alex.xclubai.com/en/',
    'https://alex.xclubai.com/mcp/',
    'https://alex.xclubai.com/about/',
    'https://alex.xclubai.com/contact/',
    'https://alex.xclubai.com/privacy/',
    'https://alex.xclubai.com/llms.txt',
    'https://alex.xclubai.com/llms-full.txt',
  ]) {
    assert.ok(sitemap.includes(`<loc>${locUrl}</loc>`), `Missing sitemap entry: ${locUrl}`);
  }

  const llms = fs.readFileSync(path.join(site, 'llms.txt'), 'utf8');
  const llmsFull = fs.readFileSync(path.join(site, 'llms-full.txt'), 'utf8');
  assert.match(llms, /^# Alex \(ProtoFlow AI\)/);
  assert.match(llms, /## When to Use Alex/);
  assert.match(llmsFull, /## When to Use Alex/);
  assert.match(llmsFull, /Apache License 2\.0/);
  assert.match(llmsFull, /https:\/\/alex\.xclubai\.com\/en\//);

  const fourOhFourMd = fs.readFileSync(path.join(site, '404.md'), 'utf8');
  assert.ok(fourOhFourMd.trim().length >= 200);
  assert.match(fourOhFourMd, /llms\.txt/);
  assert.match(fourOhFourMd, /sitemap\.xml/);

  const assertSequentialHeadings = (doc, fileLabel) => {
    const levels = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(h => Number(h.tagName.slice(1)));
    assert.equal(levels[0], 1, `${fileLabel} must start with h1`);
    for (let i = 1; i < levels.length; i++) {
      assert.ok(levels[i] <= levels[i - 1] + 1, `${fileLabel} skipped heading level: h${levels[i - 1]} -> h${levels[i]}`);
    }
  };

  for (const [pagePath, expectedCanonical, expectedLang] of [
    ['index.html', 'https://alex.xclubai.com/', 'zh-CN'],
    ['en/index.html', 'https://alex.xclubai.com/en/', 'en'],
  ]) {
    const content = fs.readFileSync(path.join(site, pagePath), 'utf8');
    const dom = new JSDOM(content);
    const doc = dom.window.document;
    assert.equal(doc.documentElement.lang, expectedLang);
    assert.equal(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'), expectedCanonical);
    assert.equal(doc.querySelector('link[rel="alternate"][hreflang="zh-CN"]')?.getAttribute('href'), 'https://alex.xclubai.com/');
    assert.equal(doc.querySelector('link[rel="alternate"][hreflang="en"]')?.getAttribute('href'), 'https://alex.xclubai.com/en/');
    assert.equal(doc.querySelector('link[rel="alternate"][hreflang="x-default"]')?.getAttribute('href'), 'https://alex.xclubai.com/');
    assert.equal(doc.querySelector('link[rel="alternate"][type="text/markdown"][href$="/llms.txt"]')?.getAttribute('href'), 'https://alex.xclubai.com/llms.txt');
    assert.equal(doc.querySelector('meta[property="og:url"]')?.getAttribute('content'), expectedCanonical);
    assert.equal(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'), 'https://alex.xclubai.com/assets/social-preview.jpg');
    assert.match(doc.querySelector('meta[name="robots"]')?.getAttribute('content') || '', /index,\s*follow/);
    assertSequentialHeadings(doc, pagePath);

    const ld = JSON.parse(doc.querySelector('script[type="application/ld+json"]')?.textContent || '{}');
    const types = (ld['@graph'] || []).map(node => node['@type']);
    assert.deepEqual(types, ['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']);
    const orgNode = ld['@graph'].find(n => n['@type'] === 'Organization');
    assert.equal(orgNode.contactPoint?.email, 'ai.agent.club@gmail.com');
    assert.ok(Array.isArray(orgNode.knowsAbout) && orgNode.knowsAbout.length >= 3);
    const appNode = ld['@graph'].find(n => n['@type'] === 'SoftwareApplication');
    assert.equal(appNode.isAccessibleForFree, true);
    assert.equal(appNode.offers?.price, '0');
    const faqNode = ld['@graph'].find(n => n['@type'] === 'FAQPage');
    assert.equal(faqNode.mainEntity.length, 6);
    dom.window.close();
  }

  for (const pageFile of ['index.html', 'en/index.html', 'about/index.html', 'contact/index.html', 'privacy/index.html', 'mcp/index.html']) {
    const dom = new JSDOM(fs.readFileSync(path.join(site, pageFile), 'utf8'));
    const doc = dom.window.document;
    const desc = (doc.querySelector('meta[name="description"]')?.getAttribute('content') || '').trim();
    const title = doc.title.trim();
    assert.ok(desc.length >= 25 && desc.length <= 160, `${pageFile} meta description must be 25..160 chars (got ${desc.length})`);
    assert.ok(title.length >= 15 && title.length <= 65, `${pageFile} title must be 15..65 chars (got ${title.length})`);
    if (pageFile !== 'index.html' && pageFile !== 'en/index.html') {
      assertSequentialHeadings(doc, pageFile);
      const mainTextLen = (doc.querySelector('main')?.textContent || '').replace(/\s+/g, ' ').trim().length;
      assert.ok(mainTextLen >= 500, `${pageFile} main content too short (${mainTextLen} chars)`);
    }
    dom.window.close();
  }
});

test('static English /en/ entry preserves English locale, loads English releases, and uses root-relative paths', async t => {
  const enHtml = fs.readFileSync(path.join(site, 'en/index.html'), 'utf8');
  assert.doesNotMatch(enHtml, /(?:href|src)="(?:assets\/|styles\.css|config\.js|main\.js)"/);
  assert.doesNotMatch(enHtml, /url\(assets\//);

  const dom = new JSDOM(enHtml, { url: 'http://website.test/en/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  Object.defineProperty(window.navigator, 'userAgentData', {
    value: { platform: 'linux', getHighEntropyValues: async () => ({ architecture: 'x86' }) },
  });
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.console.info = () => {};
  window.fetch = async () => ({ ok: true, json: async () => listing(release('0.0.9', ['linux'])) });
  window.eval(config);
  window.eval(script);
  await settled(window);

  const doc = window.document;
  assert.equal(doc.documentElement.lang, 'en');
  assert.match(doc.title, /Turn Requirements into Runnable Prototypes/);
  assert.deepEqual([...doc.querySelectorAll('[data-version]')].map(n => n.textContent), ['v0.0.9', 'v0.0.9']);
  assert.match(doc.querySelector('[data-os="linux"] [data-assets]').textContent, /Debian \/ Ubuntu \.deb/);
  assert.equal(doc.querySelector('[data-lang-toggle]').textContent, '中文');
});
