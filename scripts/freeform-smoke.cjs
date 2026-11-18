// Real Chromium checks with an isolated temporary profile; no user projects.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_FREEFORM_SMOKE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const js = code => window.webContents.executeJavaScript(code);
    const wait = async (predicate, label) => {
      for (let n = 0; n < 160; n++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 40)); }
      throw new Error(`Timed out: ${label}`);
    };
    const frames = () => window.webContents.mainFrame.frames;
    try {
      await window.loadFile(path.join(dir, 'index.html'));
      await wait(async () => frames().length === 2 && await frames()[0].executeJavaScript('!!document.querySelector("[data-seat]")'), 'two working freeform frames');
      const first = frames()[0], second = frames()[1];
      assert.equal(await first.executeJavaScript('typeof window.protoflowDesktop'), 'undefined');
      assert.equal(await first.executeJavaScript('(() => {try { return !!parent.document.body } catch { return false }})()'), false);
      assert.equal(await js('document.querySelector("iframe").getAttribute("sandbox")'), 'allow-scripts');
      assert.equal(await js('document.querySelectorAll("textarea").length'), 1);
      assert.equal(await js('document.body.style.backgroundColor'), '');
      assert.equal(await first.executeJavaScript('fetch("https://example.com").then(()=>false,()=>true)'), true);
      await first.executeJavaScript('document.querySelector("[data-seat=\\"2\\"]").click()');
      await wait(() => js('window.freeformSmoke.runtime.overlays[0]?.params.seatId === 2'), 'typed event to host modal');
      await wait(async () => await first.executeJavaScript('document.querySelector("[data-state]").textContent.includes("2")'), 'local React state');
      assert.equal(await second.executeJavaScript('document.querySelector("[data-state]").textContent.includes("未选择")'), true);
      await js('window.freeformSmoke.runtime.closeOverlay()');
      for (const [mode, themedSurface] of [['dark', 'rgb(10, 10, 10)'], ['light', 'rgb(248, 250, 252)']]) {
        await js(`document.documentElement.dataset.theme = '${mode}'`);
        await wait(() => second.executeJavaScript(`getComputedStyle(document.querySelector('.welcome')).backgroundColor === '${themedSurface}' && document.documentElement.dataset.theme === '${mode}'`), 'default component follows ' + mode);
        await wait(() => first.executeJavaScript(`document.documentElement.dataset.theme === '${mode}'`), 'legacy component receives ' + mode);
        const legacy = await first.executeJavaScript(`({
          text: getComputedStyle(document.querySelector('h2')).color,
          surface: getComputedStyle(document.querySelector('.seating')).backgroundColor,
          selection: document.querySelector('[data-state]').textContent
        })`);
        assert.deepEqual(legacy, { text: 'rgb(51, 65, 85)', surface: 'rgb(248, 250, 252)', selection: '当前选择：2' });
      }
      // A correct channel from the wrong window must not trigger a host action.
      const channel = await first.executeJavaScript('window.__pfConfig.channel');
      await second.executeJavaScript(`parent.postMessage({channel:${JSON.stringify(channel)},type:'action',payload:{seatId:9}},'*')`);
      await new Promise(r => setTimeout(r, 100));
      assert.equal(await js('window.freeformSmoke.runtime.overlays.length'), 0);
      await js('window.freeformSmoke.design(true)');
      await wait(() => js('document.querySelector("iframe").style.pointerEvents === "none"'), 'designer selects whole component');
      await first.executeJavaScript('document.querySelector("[data-seat=\\"3\\"]").click()');
      await new Promise(r => setTimeout(r, 100));
      assert.equal(await js('window.freeformSmoke.runtime.overlays.length'), 0);
      await js('window.freeformSmoke.design(false)');
      if (process.env.PFLOW_FREEFORM_SCREENSHOT) fs.writeFileSync(process.env.PFLOW_FREEFORM_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      await js('window.freeformSmoke.fail()');
      await wait(() => js('!!document.querySelector("[role=alert]")'), 'runaway code reports bounded failure');
      assert.match(await js('document.querySelector("[role=alert]").textContent'), /计算时间过长/);
      await js('window.freeformSmoke.restore()');
      await wait(async () => frames().length === 2 && await frames()[0].executeJavaScript('!!document.querySelector("[data-seat]")'), 'recovery after bad code');
      assert.equal(await js('document.querySelectorAll("[role=alert]").length'), 0);
      console.log('PASS Freeform: real React/TSX interaction, typed host events, two-instance isolation, sandbox/network boundaries, design mode, timeout and recovery');
      app.exit(0);
    } catch (error) {
      console.error(error);
      console.error(await js('document.body.innerText').catch(() => 'unavailable'));
      app.exit(1);
    }
  });
  setTimeout(() => app.exit(1), 40000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  require('./build-material-contract.cjs').buildMaterialContract();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-freeform-'));
  try {
    const source = `export default function Component({data,emit}) { const [selected,setSelected] = React.useState<number | null>(null); return <section className="seating welcome"><div className="eyebrow">自由组件 · 交互示例</div><h2>会议室座位选择</h2><p>点击选择座位，试试独特的交互体验</p><div className="screen">演示屏幕</div><div className="seats">{data.seats.map(seat => <button key={seat.seatId} data-seat={seat.seatId} aria-pressed={selected === seat.seatId} onClick={() => {setSelected(seat.seatId);emit({seatId:seat.seatId});}}>{seat.label}</button>)}</div><div className="selection" data-state>当前选择：{selected === null ? '未选择' : selected}</div></section>; }`;
    const css = `.seating{padding:28px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px}.eyebrow{font-size:11px;color:#6366f1}.seating h2{font-size:22px;margin:12px 0}.seating p{color:#64748b;font-size:12px}.screen{margin:30px auto 20px;width:65%;border-top:4px solid #cbd5e1;text-align:center;padding-top:8px;color:#94a3b8;font-size:11px}.seats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:320px;margin:0 auto}.seats button{height:46px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#475569}.seats button[aria-pressed=true]{background:#4f46e5;color:white;border-color:#4f46e5}.selection{margin-top:24px;text-align:center;font-size:12px;color:#64748b}`;
    const code = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {NodeView} from './src/proto/renderer/NodeView';
import {RuntimeProvider,useRuntimeController} from './src/proto/runtime/runtime';
import {FREEFORM_DEFAULT_CSS} from './src/proto/freeform/contract';
import {FreeformInspector} from './src/proto/freeform/FreeformInspector';
const original = ${JSON.stringify(source)};
const makeNode = (pfId) => ({kind:'node',pfId,type:'Freeform',props:{title:'座位选择',source:original,css:pfId==='first'?${JSON.stringify(css)}:FREEFORM_DEFAULT_CSS,height:360,data:{seats:[1,2,3,4,5,6].map(seatId=>({seatId,label:'A'+seatId}))},eventFields:[{name:'seatId',type:'number'}],onAction:{$kind:'actions',calls:[{name:'openModal',args:['details',{seatId:'{{event.seatId}}'}]}]}},children:[]});
const initial={header:[],root:{kind:'node',pfId:'root',type:'Page',props:{title:'自由组件体验'},children:[makeNode('first'),makeNode('second'),{kind:'node',pfId:'modal',type:'Modal',props:{id:'details',title:'座位详情'},children:[]}]}};
function App(){const [doc,setDoc]=useState(initial),[design,setDesign]=useState(false);const rt=useRuntimeController(doc,'smoke-freeform',design);window.freeformSmoke={runtime:rt,design:setDesign,fail:()=>setDoc({...doc,root:{...doc.root,children:doc.root.children.map(n=>n.pfId==='first'?{...n,props:{...n.props,source:'export default function Component(){while(true){} return <p/>}'}}:n)}}),restore:()=>setDoc(initial)};return <div className="h-screen bg-slate-100 p-6"><header className="mb-5"><h1 className="text-xl font-semibold text-slate-900">自由组件</h1><p className="mt-1 text-sm text-slate-500">描述想法，让 AI 实现独特的布局与交互</p></header><div className="flex items-start gap-5"><RuntimeProvider value={rt}><div className="flex-1 grid grid-cols-2 gap-4">{doc.root.children.slice(0,2).map(node=><NodeView key={node.pfId} node={node}/>)}</div></RuntimeProvider><aside className="w-80 shrink-0 rounded-2xl border border-slate-200 bg-white p-4"><FreeformInspector node={doc.root.children[0]} doc={doc} tables={[]} enabled onCommit={setDoc} onPropChange={()=>{}} onGenerate={()=>{}} onConnect={()=>{}}/></aside></div></div>}
createRoot(document.getElementById('root')).render(<App/>);
`;
    const result = buildSync({ stdin: { contents: code, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(dir, 'bundle.js'), result.outputFiles[0].contents);
    const cssFile = fs.readdirSync(path.join(root, 'dist/assets')).find(name => name.endsWith('.css'));
    fs.copyFileSync(path.join(root, 'dist/assets', cssFile), path.join(dir, 'styles.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div id="root"></div><script src="./bundle.js"></script>');
    const env = { ...process.env, PFLOW_FREEFORM_SMOKE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 45000 });
    if (child.status !== 0) throw new Error(child.error?.message || child.stdout + child.stderr);
    console.log(child.stdout.trim());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
