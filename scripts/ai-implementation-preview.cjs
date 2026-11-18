// Browser acceptance for the synthetic task in hermes-smoke --custom.
// The input is that generated page; this never opens a user project.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_AI_PREVIEW_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const js = code => window.webContents.executeJavaScript(code);
    const wait = async (predicate, label) => {
      for (let n = 0; n < 150; n++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 40)); }
      throw new Error(`Timed out: ${label}`);
    };
    try {
      await window.loadFile(path.join(dir, 'index.html'));
      await wait(async () => window.webContents.mainFrame.frames.length === 1 && await window.webContents.mainFrame.frames[0].executeJavaScript('document.querySelectorAll("button").length === 6'), 'six generated seats');
      const frame = window.webContents.mainFrame.frames[0];
      const seat = await frame.executeJavaScript('document.querySelector("button").textContent.trim()');
      await frame.executeJavaScript('document.querySelector("button").click()');
      await wait(() => js('window.aiPreview.overlays.length === 1'), 'generated seat opens host modal');
      const params = await js('window.aiPreview.overlays[0].params');
      const values = Object.values(params).filter(value => typeof value === 'string' || typeof value === 'number');
      assert.ok(values.length > 0 && values.some(value => seat.includes(String(value))), 'seat event must match the clicked seat');
      await wait(() => js(`${JSON.stringify(values)}.some(value => document.body.innerText.includes(String(value)))`), 'modal displays the selected seat');
      await js('Array.from(document.querySelectorAll("button")).find(b => /关闭|取消|知道了/.test(b.textContent.replace(/\\s/g,"")))?.click()');
      await wait(() => js('window.aiPreview.overlays.length === 0'), 'generated close action');
      assert.match(await frame.executeJavaScript('document.querySelector("button").getAttribute("aria-pressed")'), /true/);
      assert.ok(await js('document.body.innerText.includes("演示客户")'));
      await js(`(() => { const input=document.querySelector('input:not([type=checkbox])'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'不存在的客户');input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await js(`(() => { const button=Array.from(document.querySelectorAll('button')).find(b=>/^(查询|搜索)$/.test(b.textContent.replace(/\\s/g,''))); if(button)button.click();else document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
      await wait(() => js('!document.body.innerText.includes("演示客户")'), 'generated query filters the original table');
      await js('Array.from(document.querySelectorAll("button")).find(b => b.textContent.replace(/\\s/g,"") === "重置")?.click()');
      await wait(() => js('document.body.innerText.includes("演示客户")'), 'reset restores the original rows');
      assert.equal(await js('document.querySelectorAll("[role=alert]").length'), 0);
      if (process.env.PFLOW_AI_PREVIEW_SCREENSHOT) fs.writeFileSync(process.env.PFLOW_AI_PREVIEW_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      console.log('PASS generated page in Chromium: six seats render and show selection, click emits a value to the declared modal, detail displays it, close and customer query work');
      app.exit(0);
    } catch (error) { console.error(error.message); console.error(await js('document.body.innerText').catch(() => 'unavailable')); app.exit(1); }
  });
  setTimeout(() => app.exit(1), 30000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const source = fs.readFileSync(process.argv[2], 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-ai-preview-'));
  try {
    const code = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {parsePageSource} from './src/proto/dsl/parser';
import {NodeView,ScopeProvider} from './src/proto/renderer/NodeView';
import {RuntimeProvider,useRuntimeController} from './src/proto/runtime/runtime';
import {PreviewDataContext} from './src/proto/runtime/PreviewData';
const doc = parsePageSource(${JSON.stringify(source)}).doc;
const nodes=[]; const visit=node=>{nodes.push(node);node.children.filter(c=>c.kind==='node').forEach(visit)}; visit(doc.root);
const data={tables:[{id:'customer-entity',tableName:'t_customer',cnName:'客户',columns:[{id:'customer-name-column',name:'customer_name',dataType:'TEXT',nullable:false,comment:'客户名称'}]}],rows:{'customer-entity':[{id:'demo-customer',customer_name:'演示客户'}]}};
function App(){const rt=useRuntimeController(doc,'main',false);window.aiPreview=rt;return <PreviewDataContext.Provider value={data}><RuntimeProvider value={rt}><NodeView node={doc.root}/>{rt.overlays.map((entry,index)=><ScopeProvider key={entry.key} value={{params:entry.params,overlayIndex:index}}><NodeView node={nodes.find(n=>n.props.id===entry.id)} live/></ScopeProvider>)}</RuntimeProvider></PreviewDataContext.Provider>}
createRoot(document.getElementById('root')).render(<App/>);`;
    const bundle = buildSync({ stdin: { contents: code, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(dir, 'bundle.js'), bundle.outputFiles[0].contents);
    const css = fs.readdirSync(path.join(root, 'dist/assets')).find(f => f.endsWith('.css'));
    fs.copyFileSync(path.join(root, 'dist/assets', css), path.join(dir, 'styles.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div id="root"></div><script src="./bundle.js"></script>');
    const env = { ...process.env, PFLOW_AI_PREVIEW_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 35000 });
    if (child.status !== 0) throw new Error(child.error?.message || child.stdout + child.stderr);
    console.log(child.stdout.trim());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
