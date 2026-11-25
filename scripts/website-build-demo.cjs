#!/usr/bin/env node
/*
 * Builds the pure-static browser live demo bundle at website/demo/ from the
 * StarLink After-Sales Maintenance & Spare Parts Fulfillment platform
 * (bilingual zh-CN + en-US snapshots).
 *
 * Usage:
 *   npm run website:demo
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '..');
const demoDir = path.join(root, 'website/demo');
const snapshotsDir = path.join(demoDir, 'snapshots');

require('./build-material-contract.cjs').buildMaterialContract();

execFileSync(
  process.execPath,
  [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'website-demo'],
  { cwd: root, stdio: 'inherit' },
);

const builtHtml = path.join(demoDir, 'demo.html');
const targetHtml = path.join(demoDir, 'index.html');
if (!fs.existsSync(builtHtml)) {
  throw new Error(`Expected Vite build output at ${builtHtml}`);
}
fs.renameSync(builtHtml, targetHtml);

const generatorSource = `
import { setLocale } from './src/i18n/runtime';
import { pageContractErrors } from './src/proto/ai/pageContract';
import { emptySitemapOverrides } from './src/proto/sitemap';
import { createStarlinkDemoDataset } from './src/proto/starter/starlinkDemo';
import { createProjectPayload, loadProjectFromBinaryPayload } from './src/services/projectStorage';
import { createPublishedSnapshot } from './src/services/createPublishedSnapshot';
import { validatePublishedSnapshot } from './src/services/publishedSnapshot';
import type { PflowBinaryPayload } from './src/utils/pflowBinaryCodec';

function buildSnapshot(locale: 'zh-CN' | 'en-US', projectName: string) {
  setLocale(locale);
  const starlink = createStarlinkDemoDataset(locale);

  for (const page of starlink.designerPages) {
    const src = starlink.pageSources[page.pageId];
    const contractErrs = pageContractErrors(src, starlink.dbTables, { tableRows: starlink.tableRows });
    if (contractErrs.length > 0) {
      throw new Error(\`[\${locale}] Contract error in \${page.pageId}: \${contractErrs.join('; ')}\`);
    }
  }

  const base = createProjectPayload({
    projectId: 'demo-starlink-maintenance',
    projectName,
    storageDir: '',
    fileName: 'starlink-demo.pflow',
    templateId: 'blank_project',
    projectMode: 'hybrid',
    createdAt: '2026-11-25T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
    pageCount: starlink.designerPages.length,
    tableCount: starlink.dbTables.length,
    stickyCount: starlink.stickyNotes.length,
  });

  const payload: PflowBinaryPayload = {
    schemaVersion: 7,
    meta: {
      ...base.meta,
      pageCount: starlink.designerPages.length,
      tableCount: starlink.dbTables.length,
      stickyCount: starlink.stickyNotes.length,
    },
    stateSnapshot: {
      ...base.stateSnapshot,
      designTokens: starlink.designTokens,
      mindmaps: starlink.mindmaps,
      projectNotes: starlink.projectNotes,
      activePageId: starlink.entryPageId,
      dbTables: starlink.dbTables,
      stickyNotes: starlink.stickyNotes,
      pageSources: starlink.pageSources,
      designerPages: starlink.designerPages,
      designerFolders: starlink.designerFolders,
      sitemapBase: [],
      sitemapOverrides: emptySitemapOverrides(),
      tableRows: starlink.tableRows,
    },
  };

  loadProjectFromBinaryPayload(payload);
  const snapshot = createPublishedSnapshot(starlink.entryPageId);
  validatePublishedSnapshot(snapshot);
  return snapshot;
}

export function buildDemoSnapshots() {
  const zh = buildSnapshot('zh-CN', '星链设备售后维保与备件履约平台');
  const en = buildSnapshot('en-US', 'StarLink Maintenance & Spare Parts Platform');
  return { zh, en };
}
`;

const compiled = buildSync({
  stdin: {
    contents: generatorSource,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  loader: { '.svg': 'dataurl' },
});

const mod = new Module('website-demo-snapshots');
mod.filename = path.join(root, 'scripts/.website-demo-snapshots.cjs');
mod.paths = Module._nodeModulePaths(root);
mod._compile(compiled.outputFiles[0].text, mod.filename);

const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;

const { zh, en } = mod.exports.buildDemoSnapshots();
dom.window.close();

fs.mkdirSync(snapshotsDir, { recursive: true });
fs.writeFileSync(path.join(snapshotsDir, 'starlink-zh.json'), JSON.stringify(zh), 'utf8');
fs.writeFileSync(path.join(snapshotsDir, 'starlink-en.json'), JSON.stringify(en), 'utf8');
fs.writeFileSync(
  path.join(demoDir, 'demo-manifest.json'),
  `${JSON.stringify(
    {
      version: 1,
      project: 'starlink-maintenance-fulfillment',
      snapshots: {
        zh: './snapshots/starlink-zh.json',
        en: './snapshots/starlink-en.json',
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(
  `Built static live demo at ${path.relative(root, demoDir)} (zh: ${zh.pages.length} pages, en: ${en.pages.length} pages)`,
);
