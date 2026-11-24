#!/usr/bin/env node
/*
 * Generates the static English entry page website/en/index.html from website/index.html + website/main.js
 * so search engines and AI agents can crawl /en/ directly with full English Schema.org JSON-LD,
 * canonical/hreflang links, and zero Chinese FOUC.
 *
 * Usage:
 *   npm run website:seo
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const siteDir = path.join(root, 'website');
const zhHtml = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
const configJs = fs.readFileSync(path.join(siteDir, 'config.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(siteDir, 'main.js'), 'utf8');

async function buildEnglishHtml() {
  const dom = new JSDOM(zhHtml, {
    url: 'http://website.test/?lang=en',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const doc = window.document;

  if (doc.readyState === 'loading') {
    await new Promise((resolve) => doc.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }

  Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });
  Object.defineProperty(window.navigator, 'languages', { value: ['en-US', 'en'], configurable: true });
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.console.info = () => {};
  window.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({}),
  });

  window.eval(configJs);
  window.eval(mainJs);
  await new Promise((resolve) => setTimeout(resolve, 20));

  // Mark static English entry so main.js preserves SSR HTML without capturing zhSnapshot.
  doc.documentElement.setAttribute('lang', 'en');
  doc.documentElement.setAttribute('data-static-locale', 'en');

  // Remove any runtime-only classes/skeletons added during JSDOM initialization.
  const header = doc.querySelector('[data-site-header]');
  if (header) header.className = 'site-header';
  const heroVersion = doc.querySelector('[data-hero-version]');
  if (heroVersion) heroVersion.hidden = false;
  for (const node of doc.querySelectorAll('[data-version]')) {
    node.textContent = 'Loading version';
  }
  const releaseDate = doc.querySelector('[data-release-date]');
  if (releaseDate) releaseDate.textContent = '';
  const sourceNote = doc.querySelector('[data-source-note]');
  if (sourceNote) sourceNote.textContent = '';
  const releaseActions = doc.querySelector('[data-release-actions]');
  if (releaseActions) releaseActions.replaceChildren();
  const recommend = doc.querySelector('[data-recommend]');
  if (recommend) recommend.hidden = true;
  const recLink = doc.querySelector('[data-recommend-link]');
  if (recLink) {
    recLink.removeAttribute('href');
    recLink.removeAttribute('download');
    recLink.textContent = 'Download';
  }
  const primaryLabel = doc.querySelector('[data-primary-label]');
  if (primaryLabel) primaryLabel.textContent = 'Free Download';
  for (const card of doc.querySelectorAll('.platform')) {
    card.classList.remove('is-current');
    const assets = card.querySelector('[data-assets]');
    if (assets) assets.replaceChildren();
    const tip = card.querySelector('.p-tip');
    if (tip) tip.hidden = false;
  }

  // Update SEO & OpenGraph metadata for /en/.
  const setMeta = (sel, content) => {
    const el = doc.querySelector(sel);
    if (el) el.setAttribute('content', content);
  };
  setMeta(
    'meta[name="keywords"]',
    'ProtoFlow AI, AI prototyping tool, open source prototyping, runnable business prototype, shared ER database modeling, Axure .rp import, MCP prototyping server, Claude Code prototype, Alex, Apache-2.0',
  );
  const canonical = doc.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', 'https://alex.xclubai.com/en/');
  setMeta('meta[property="og:url"]', 'https://alex.xclubai.com/en/');
  setMeta('meta[property="og:site_name"]', 'ProtoFlow AI');
  setMeta('meta[property="og:locale"]', 'en_US');
  setMeta('meta[property="og:locale:alternate"]', 'zh_CN');
  setMeta('meta[property="og:image:alt"]', 'ProtoFlow AI Open-Source AI Prototyping and Shared ER Database Workbench Preview');
  setMeta('meta[name="twitter:image:alt"]', 'ProtoFlow AI Open-Source AI Prototyping and Shared ER Database Workbench Preview');

  // Build English Schema.org @graph matching visible English #faq copy verbatim.
  const faqQuestions = [];
  for (const details of doc.querySelectorAll('#faq .faq details')) {
    const q = details.querySelector('summary')?.textContent.trim();
    const a = details.querySelector('p')?.textContent.replace(/\s+/g, ' ').trim();
    if (q && a) {
      faqQuestions.push({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      });
    }
  }
  const ldScript = doc.querySelector('script[type="application/ld+json"]');
  if (ldScript) {
    const graph = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': 'https://alex.xclubai.com/#organization',
          name: 'ProtoFlow AI',
          alternateName: ['ProtoFlow', 'Alex', 'Alex (ProtoFlow AI)'],
          url: 'https://alex.xclubai.com/',
          logo: 'https://alex.xclubai.com/assets/icon.png',
          email: 'ai.agent.club@gmail.com',
          contactPoint: {
            '@type': 'ContactPoint',
            contactType: 'technical support',
            email: 'ai.agent.club@gmail.com',
            url: 'https://alex.xclubai.com/contact/',
            availableLanguage: ['zh-CN', 'en'],
          },
          knowsAbout: [
            'AI Prototyping Tools',
            'Shared ER Database Modeling',
            'Axure RP Import',
            'Model Context Protocol (MCP)',
            'Open Source Prototyping Workbench',
          ],
          sameAs: [
            'https://github.com/EvanClub-Agent/protoflow-ai',
            'https://discord.gg/YDnKBhmsrR',
          ],
        },
        {
          '@type': 'WebSite',
          '@id': 'https://alex.xclubai.com/#website',
          name: 'ProtoFlow AI',
          url: 'https://alex.xclubai.com/',
          inLanguage: ['zh-CN', 'en'],
          publisher: { '@id': 'https://alex.xclubai.com/#organization' },
        },
        {
          '@type': 'SoftwareApplication',
          '@id': 'https://alex.xclubai.com/#software',
          name: 'ProtoFlow AI',
          alternateName: ['ProtoFlow', 'Alex', 'Alex (ProtoFlow AI)'],
          url: 'https://alex.xclubai.com/en/',
          applicationCategory: 'DeveloperApplication',
          applicationSubCategory: 'AI Business Prototyping & ER Database Modeling Workbench',
          operatingSystem: 'macOS 13+, Windows 10/11, Linux',
          isAccessibleForFree: true,
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
          },
          license: 'https://www.apache.org/licenses/LICENSE-2.0',
          codeRepository: 'https://github.com/EvanClub-Agent/protoflow-ai',
          downloadUrl: 'https://github.com/EvanClub-Agent/protoflow-ai/releases/latest',
          screenshot: 'https://alex.xclubai.com/assets/workbench-screenshot.png',
          image: 'https://alex.xclubai.com/assets/social-preview.jpg',
          description:
            'ProtoFlow AI (formerly Alex) is an Apache-2.0 open-source, local-first AI prototyping tool backed by shared ER tables, desktop + iPhone viewports, offline Axure .rp import, 18 bidirectional MCP co-design tools, and Docker self-hosted /p/{id} review links.',
          featureList: [
            'Clarify-first Project AI proposing sitemaps, pages, and shared ER tables before generating',
            'Bidirectional AST canvas with 114+ enterprise desktop and mobile materials synced with TSX DSL',
            'Navicat-style ER database designer with foreign keys and composite unique constraints synced across screens',
            'Desktop admin portals and iPhone mobile viewports sharing the same dataset in one project',
            '12 native Apache ECharts types bound directly to physical tables plus Mermaid diagrams',
            'Offline local Axure RP 9 and RP 11 .rp binary import and AI flow reshaping',
            '18 bidirectional MCP authoring tools and /p/{id} zero-install remote DDL/TSX spec access',
            'Apache-2.0 open source, local-first .pflow files, and 3-step Docker Compose self-hosting',
          ],
          author: { '@id': 'https://alex.xclubai.com/#organization' },
        },
        {
          '@type': 'FAQPage',
          '@id': 'https://alex.xclubai.com/#faq',
          mainEntity: faqQuestions,
        },
      ],
    };
    ldScript.textContent = `\n${JSON.stringify(graph, null, 2)}\n    `;
  }

  // Flip aria-current in footer locale switcher from "/" to "/en/".
  for (const link of doc.querySelectorAll('.footer-locales a')) {
    if (link.getAttribute('href') === '/en/') link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  // Rewrite relative asset/script/style paths to root-relative for /en/ subpath safety,
  // and strip any JSDOM synthetic origin (http://website.test) back to root-relative paths.
  for (const node of doc.querySelectorAll('[href]')) {
    const val = node.getAttribute('href');
    if (!val) continue;
    if (val === 'styles.css' || val.startsWith('assets/')) {
      node.setAttribute('href', `/${val}`);
    } else if (val.startsWith('http://website.test/')) {
      node.setAttribute('href', val.slice('http://website.test'.length) || '/');
    }
  }
  for (const node of doc.querySelectorAll('[src]')) {
    const val = node.getAttribute('src');
    if (!val) continue;
    if (val === 'config.js' || val === 'main.js' || val.startsWith('assets/')) {
      node.setAttribute('src', `/${val}`);
    } else if (val.startsWith('http://website.test/')) {
      node.setAttribute('src', val.slice('http://website.test'.length) || '/');
    }
  }
  for (const node of doc.querySelectorAll('[style]')) {
    const style = node.getAttribute('style');
    if (style && style.includes('url(assets/')) {
      node.setAttribute('style', style.replace(/url\(assets\//g, 'url(/assets/'));
    }
  }

  const out = `<!doctype html>\n${doc.documentElement.outerHTML}\n`;
  window.close();

  // Verify invariants on generated HTML.
  if (!doc.title.includes('Open-Source AI Prototyping Workbench That Runs')) {
    throw new Error(`Expected translated English <title>, got: ${doc.title}`);
  }
  if (!faqQuestions.length || !faqQuestions[0].name.includes('Is ProtoFlow AI free')) {
    throw new Error('Expected translated English FAQ entries in generated HTML');
  }
  if (out.includes('website.test')) {
    throw new Error('Generated /en/index.html leaked synthetic http://website.test URL');
  }
  if (/\bno-popover\b|\bis-current\b|class="[^"]*\bskeleton\b/.test(out)) {
    throw new Error('Generated /en/index.html leaked runtime classes');
  }
  if (/(?:href|src)="(?:assets\/|styles\.css|config\.js|main\.js)"/.test(out) || /url\(assets\//.test(out)) {
    throw new Error('Generated /en/index.html still contains non-root-relative paths');
  }
  return out;
}

(async () => {
  const outDir = path.join(siteDir, 'en');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), await buildEnglishHtml(), 'utf8');
  console.log('Generated website/en/index.html');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
