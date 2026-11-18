const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_QUERY_SMOKE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const window = new BrowserWindow({ show: false, width: 1640, height: 700, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const errors = [];
    window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const js = code => window.webContents.executeJavaScript(code);
    const settle = () => js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const measure = () => js(`(() => {
      const grid = document.querySelector('[data-query-fields]');
      const frame = document.getElementById('frame').getBoundingClientRect();
      const cells = [...grid.children].map(el => {
        const r = el.getBoundingClientRect(), c = el.lastElementChild.getBoundingClientRect();
        return { x:r.x, y:r.y, width:r.width, control:c.width, right:c.right, height:c.height };
      });
      const actions = document.querySelector('[data-query-actions]').getBoundingClientRect();
      return { cells, columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length, frame:{x:frame.x,right:frame.right,width:frame.width}, actions:{right:actions.right,width:actions.width} };
    })()`);
    try {
      await window.loadFile(path.join(dir, 'index.html'));
      for (let i = 0; i < 100 && !await js('Boolean(window.querySmoke && document.querySelector("[data-query-fields]"))'); i++) await new Promise(r => setTimeout(r, 20));
      await settle();
      let m = await measure();
      assert.equal(m.cells.length, 7);
      assert.equal(m.columns, 4, JSON.stringify(m));
      assert.equal(m.cells[0].y, m.cells[3].y, 'four conditions share the first row with fixed labels');
      assert.ok(m.cells[4].y > m.cells[0].y && m.cells[4].y === m.cells[6].y);
      assert.ok(m.cells.every((c, i) => c.control <= (i === 0 ? 320 : 240) + 1));
      assert.ok(m.cells.every(c => c.height <= 33));
      if (process.env.PFLOW_QUERY_SCREENSHOT) fs.writeFileSync(process.env.PFLOW_QUERY_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      await js(`Array.from(document.querySelectorAll('[data-query-actions] button')).find(el => el.textContent.includes('收起')).click()`);
      await settle(); assert.equal((await measure()).cells.length, 4);
      await js(`Array.from(document.querySelectorAll('[data-query-actions] button')).find(el => el.textContent.includes('展开')).click()`);
      await settle(); assert.equal((await measure()).cells.length, 7);
      for (const cols of [1, 2, 3, 4]) {
        await js(`window.querySmoke.configure({cols:${cols}})`); await settle();
        m = await measure(); assert.equal(m.columns, cols);
        assert.ok(m.cells.every((c, i) => c.control <= (i === 0 ? 320 : 240) + 1));
      }
      for (const width of [1100, 720, 360]) {
        await js(`document.getElementById('frame').style.width='${width}px'`); await settle();
        m = await measure();
        assert.ok(m.cells.every(c => c.right <= m.frame.right + 1 && c.control > 0), JSON.stringify(m));
        assert.ok(m.actions.right <= m.frame.right + 1, 'action buttons stay inside the narrow query area');
        assert.ok(m.columns <= 4);
        if (width === 360) assert.equal(m.columns, 1);
      }
      await js(`document.getElementById('frame').style.width='1540px';window.querySmoke.configure({controlMaxWidth:180,rangeMaxWidth:280,layout:'vertical'})`);
      await settle(); m = await measure();
      assert.equal(m.columns, 4);
      assert.ok(m.cells.every((c, i) => c.control <= (i === 0 ? 280 : 180) + 1));
      assert.deepEqual(errors, []);
      console.log('PASS Chromium: seven query fields fit 4+3 with fixed labels; 1–4 columns, width caps, expand/collapse and 360px responsive layout');
      app.exit(0);
    } catch (error) { console.error(error); console.error(errors); app.exit(1); }
  });
  setTimeout(() => app.exit(1), 30000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-query-layout-'));
  try {
    const code = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {parsePageSource} from './src/proto/dsl/parser';import {NodeView} from './src/proto/renderer/NodeView';import {RuntimeProvider,useRuntimeController} from './src/proto/runtime/runtime';
const fields=[{name:'entryDate',label:'入库/退货日期',type:'dateRange'},{name:'entryNo',label:'入库/退货单号'},{name:'purchaseNo',label:'采购单号'},{name:'supplier',label:'供应商名称'},{name:'materialCode',label:'物料编号'},{name:'materialName',label:'物料名称'},{name:'brand',label:'品牌',type:'select',options:['品牌一','品牌二']}];
function App(){const [props,setProps]=useState({cols:4,labelWidth:104,colon:true,defaultExpanded:true});window.querySmoke={configure:p=>setProps(s=>({...s,...p}))};const doc=parsePageSource('export default function Page(){return <Page pfId="page" title="入库/退货查询"><QueryForm pfId="query" fields={'+JSON.stringify(fields)+'}/></Page>}').doc;doc.root.children[0].props={...props,fields};const rt=useRuntimeController(doc,'query-layout',false);return <RuntimeProvider value={rt}><NodeView node={doc.root}/></RuntimeProvider>};
createRoot(document.getElementById('frame')).render(<App/>);`;
    const bundle = buildSync({ stdin: { contents: code, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(dir, 'bundle.js'), bundle.outputFiles[0].contents);
    const css = fs.readdirSync(path.join(root, 'dist/assets')).find(name => name.endsWith('.css'));
    fs.copyFileSync(path.join(root, 'dist/assets', css), path.join(dir, 'styles.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div id="frame" class="pf-paper" style="width:1540px;margin:24px;background:white"></div><script src="./bundle.js"></script>');
    const env = { ...process.env, PFLOW_QUERY_SMOKE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 35000 });
    if (child.status !== 0) throw new Error(child.error?.message || child.stderr || child.stdout);
    console.log(child.stdout.trim());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
