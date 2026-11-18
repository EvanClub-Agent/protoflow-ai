// Actual Chromium clicks through the designer and the published renderer.
// All data and browser storage live in an isolated temporary fixture.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_RELATED_DETAILS_SMOKE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const window = new BrowserWindow({ show: false, width: 1280, height: 1100,
      webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const errors = [];
    window.webContents.on('console-message', event => {
      if (event.level === 'error') errors.push(event.message);
    });
    const js = code => window.webContents.executeJavaScript(code);
    const waitFor = async code => {
      for (let n = 0; n < 100; n++) {
        if (await js(`Boolean(${code})`)) return;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw new Error(`Timed out waiting for: ${code}`);
    };
    const click = (selector, text, index = 0) => js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(el => el.textContent.trim() === ${JSON.stringify(text)})[${index}].click()`);
    const detail = '[data-pf-id="expense-detail"]';
    const checkDetails = async (present, absent) => {
      await waitFor(`document.querySelector(${JSON.stringify(detail)})`);
      const text = await js(`document.querySelector(${JSON.stringify(detail)}).textContent`);
      for (const value of present) assert.ok(text.includes(value), `Missing ${value}: ${text}`);
      for (const value of absent) assert.ok(!text.includes(value), `Leaked ${value}: ${text}`);
    };
    try {
      await window.loadFile(path.join(dir, 'index.html'));
      await waitFor('window.relatedDetailsSmoke');
      for (const surface of ['designer', 'published']) {
        await js(`window.relatedDetailsSmoke.reset(${JSON.stringify(surface)})`);
        await waitFor(`document.querySelector('[data-pf-id="expense-list"]')`);
        for (const [title, own, other] of [
          ['报销单甲', ['甲单交通费', '甲单住宿费'], ['乙单餐费']],
          ['报销单乙', ['乙单餐费'], ['甲单交通费', '甲单住宿费']],
        ]) {
          await click('[data-pf-id="expense-list"] button', title);
          await waitFor(`document.querySelector('[role="dialog"][aria-label="当前报销明细"]')`);
          await checkDetails(own, other);
          await js(`document.querySelector('[role="dialog"] button[aria-label="关闭抽屉"]').click()`);
          await waitFor(`!document.querySelector('[role="dialog"]')`);
        }
        // Mobile row actions carry the current source row through navigation.
        await click('[data-pf-id="expense-list"] button', '跨页明细', 0);
        await waitFor(`window.relatedDetailsSmoke.pageId() === 'oa-m-detail'`);
        await checkDetails(['甲单交通费', '甲单住宿费'], ['乙单餐费']);
        await js(`window.relatedDetailsSmoke.go('oa-m-approvals')`);
        await waitFor(`document.querySelector('[data-pf-id="expense-list"]')`);
        await click('[data-pf-id="expense-list"] button', '跨页明细', 1);
        await waitFor(`window.relatedDetailsSmoke.pageId() === 'oa-m-detail'`);
        await checkDetails(['乙单餐费'], ['甲单交通费', '甲单住宿费']);
        // Opening the page without row context must clear the previous source.
        await js(`window.relatedDetailsSmoke.go('oa-m-detail')`);
        await waitFor(`window.relatedDetailsSmoke.source() === null`);
        await checkDetails([], ['甲单交通费', '甲单住宿费', '乙单餐费']);
        // The same target also accepts a desktop table's real row action.
        await js(`window.relatedDetailsSmoke.go('oa-pc-expenses')`);
        await waitFor(`document.querySelector('[data-pf-id="expense-table"]')`);
        await click('[data-pf-id="expense-table"] button', '移动查看', 1);
        await waitFor(`window.relatedDetailsSmoke.pageId() === 'oa-m-detail'`);
        await checkDetails(['乙单餐费'], ['甲单交通费', '甲单住宿费']);
        assert.equal(await js('window.relatedDetailsSmoke.rowsUnchanged()'), true);
        console.log(`PASS ${surface}: A/B sheet details, mobile/desktop row navigation, missing source isolation, unchanged records`);
      }
      assert.deepEqual(errors, []);
      app.exit(0);
    } catch (error) {
      console.error(error);
      console.error(errors);
      app.exit(1);
    }
  });
  setTimeout(() => app.exit(1), 45000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-related-details-'));
  try {
    const code = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expenseFixture, expenseRows, expenseMobileSource } from './tests/fixtures/mobile-expense-details';
import { loadProjectFromBinaryPayload } from './src/services/projectStorage';
import { createPublishedSnapshot } from './src/services/createPublishedSnapshot';
import { PublishedPageView, hydratePublishedSnapshot } from './src/viewer/PublishedViewer';
import { ProtoCanvasDesigner } from './src/proto/designer/ProtoCanvasDesigner';
import { usePageStore } from './src/proto/store/usePageStore';
import { useProtoStore } from './src/store/useProtoStore';

const project = expenseFixture();
project.stateSnapshot.pageSources['oa-m-approvals'] = expenseMobileSource();
loadProjectFromBinaryPayload(project);
useProtoStore.setState({ isWebPlayerMode: true, isWelcomeScreenOpen: false });
const published = createPublishedSnapshot('oa-m-approvals');
function App() {
  const [surface, setSurface] = useState('designer');
  const [epoch, setEpoch] = useState(0);
  const pageId = useProtoStore(s => s.activePageId);
  window.relatedDetailsSmoke = {
    reset: surface => {
      if (surface === 'published') hydratePublishedSnapshot(published);
      else { loadProjectFromBinaryPayload(project); useProtoStore.setState({ isWebPlayerMode: true, isWelcomeScreenOpen: false }); }
      setSurface(surface); setEpoch(n => n + 1);
    },
    go: pageId => useProtoStore.getState().setActivePage(pageId),
    pageId: () => useProtoStore.getState().activePageId,
    source: () => useProtoStore.getState().navigationSource,
    rowsUnchanged: () => JSON.stringify(usePageStore.getState().tableRows) === JSON.stringify(expenseRows),
  };
  const page = published.pages.find(p => p.pageId === pageId);
  return <div style={{ height: '100vh' }} key={surface + epoch}>
    {surface === 'designer' ? <ProtoCanvasDesigner key={pageId} pageId={pageId}/> :
      <PublishedPageView key={pageId} page={page} canNavigate={id => published.pages.some(p => p.pageId === id)}/>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;
    const result = buildSync({ stdin: { contents: code, resolveDir: root, loader: 'tsx' }, bundle: true,
      platform: 'browser', format: 'iife', write: false, loader: { '.svg': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(dir, 'bundle.js'), result.outputFiles[0].contents);
    const css = fs.readdirSync(path.join(root, 'dist/assets')).find(name => name.endsWith('.css'));
    fs.copyFileSync(path.join(root, 'dist/assets', css), path.join(dir, 'styles.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div id="root"></div><script src="./bundle.js"></script>');
    const env = { ...process.env, PFLOW_RELATED_DETAILS_SMOKE_DIR: dir };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 50000 });
    if (child.status !== 0) throw new Error(child.error?.message || child.stderr || child.stdout);
    console.log(child.stdout.trim());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
