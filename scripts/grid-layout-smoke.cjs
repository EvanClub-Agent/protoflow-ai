const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_GRID_SMOKE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const window = new BrowserWindow({ show: false, width: 1600, height: 650, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const errors = [];
    window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const js = code => window.webContents.executeJavaScript(code);
    const wait = async predicate => {
      for (let i = 0; i < 100; i++) { if (await js(predicate)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      throw new Error(`Timed out: ${predicate}`);
    };
    const measure = () => js(`(() => {
      const rect = id => { const r = document.querySelector('[data-pf-id="'+id+'"]').getBoundingClientRect(); return {x:r.x,right:r.right,width:r.width,y:r.y}; };
      return {row:rect('row'),left:rect('left'),right:rect('right'),chart:rect('line')};
    })()`);
    const click = label => js(`Array.from(document.querySelectorAll('[data-pf-quickbar] button')).find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
    try {
      await window.loadFile(path.join(dir, 'index.html'));
      await wait('document.querySelectorAll("[data-chart-status=ready]").length === 2');
      const initial = await measure();
      assert.ok(initial.row.right - initial.chart.right > 100, '12 + 9 columns reproduce the external blank space');
      assert.ok(Math.abs(initial.right.right - initial.chart.right) < 1, 'full chart already fills its own column');
      assert.ok(await js('document.querySelector("[data-pf-quickbar]").textContent.includes("所在列 3/8")'));
      assert.ok(await js('document.querySelector("[data-pf-quickbar]").textContent.includes("填满本列")'));
      await click('填满右侧');
      await wait('window.gridSmoke.rightSpan === 12');
      await wait('(async()=>{const c=await window.gridSmoke.chart();return c.getWidth()===c.getDom().clientWidth})()');
      const filled = await measure();
      assert.ok(Math.abs(filled.row.right - filled.chart.right) < 1, 'right chart reaches the row edge');
      assert.ok(Math.abs(filled.left.width - initial.left.width) < 1, 'left chart keeps its width');
      assert.ok(Math.abs(filled.right.width - filled.left.width) < 1, 'both columns now occupy one half');
      assert.ok(Math.abs(filled.right.y - filled.left.y) < 1, 'fill does not move the chart to another row');
      assert.equal(await js('Array.from(document.querySelectorAll("[data-pf-quickbar] button")).some(b=>b.textContent.trim()==="填满右侧")'), false);
      if (process.env.PFLOW_GRID_SCREENSHOT) {
        await new Promise(resolve => setTimeout(resolve, 400));
        fs.writeFileSync(process.env.PFLOW_GRID_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      }
      await js('window.gridSmoke.undo()');
      await wait('window.gridSmoke.rightSpan === 9');
      assert.ok(Math.abs((await measure()).chart.right - initial.chart.right) < 1, 'one undo restores the original layout');
      await js('window.gridSmoke.redo()');
      await wait('window.gridSmoke.rightSpan === 12');
      for (const width of [1100, 720]) {
        await js(`document.getElementById('frame').style.width='${width}px'`);
        await wait('(async()=>{const c=await window.gridSmoke.chart();return c.getWidth()===c.getDom().clientWidth})()');
        const resized = await measure();
        assert.ok(Math.abs(resized.row.right - resized.chart.right) < 1, 'resized layout stays filled');
      }
      await js('window.gridSmoke.preview()');
      await wait('document.querySelector("[data-pf-quickbar]") === null');
      const preview = await measure();
      assert.ok(Math.abs(preview.row.right - preview.chart.right) < 1, 'preview shares the same layout');
      assert.deepEqual(errors, []);
      console.log('PASS grid layout: reproduced full chart inside 9/24 column; fill-right aligns edges, preserves neighbour, resizes ECharts, supports undo/redo and preview');
      app.exit(0);
    } catch (error) { console.error(error); console.error(errors); app.exit(1); }
  });
  setTimeout(() => app.exit(1), 30000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-grid-layout-'));
  try {
    const code = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {parsePageSource} from './src/proto/dsl/parser';import {printPageSource} from './src/proto/dsl/printer';import {findNode,findParent,setProp} from './src/proto/dsl/tree';
import {NodeView,DesignProvider} from './src/proto/renderer/NodeView';import {RuntimeProvider,useRuntimeController} from './src/proto/runtime/runtime';import {usePageStore} from './src/proto/store/usePageStore';
const initial='export default function Page(){return <Page pfId="page"><Card pfId="card" title="四季度经营总览"><Row pfId="row"><Col pfId="left" span={12}><BarChart pfId="bar" source="sample" title="合同金额对比" height={300}/></Col><Col pfId="right" span={9}><LineChart pfId="line" source="sample" title="利润趋势" height={300} width="full"/></Col></Row></Card></Page>}';
usePageStore.getState().setPageSource('grid-layout',initial,{recordHistory:false});
function App(){const source=usePageStore(s=>s.pageSources['grid-layout']);const doc=parsePageSource(source).doc;const [selected,select]=useState('line'),[design,setDesign]=useState(true);const rt=useRuntimeController(doc,'grid-layout',design);window.gridSmoke={rightSpan:findNode(doc.root,'right').props.span,undo:()=>usePageStore.getState().undo('grid-layout'),redo:()=>usePageStore.getState().redo('grid-layout'),preview:()=>setDesign(false),chart:async()=>(await import('./src/proto/charts/engine')).echarts.getInstanceByDom(document.querySelector('[data-chart-type=LineChart] [role=img]'))};const api={selectedId:selected,hoverId:null,drop:null,stickyCounts:{},select,hover(){},setDrop(){},onDrop(){},onDragStartNode(){},onSelectParent:id=>select(findParent(doc.root,id).parent.pfId),onUpdateProp:(id,key,value)=>usePageStore.getState().setPageSource('grid-layout',printPageSource(setProp(doc,id,key,value)))};return <RuntimeProvider value={rt}><DesignProvider value={api}><NodeView node={doc.root}/></DesignProvider></RuntimeProvider>};
createRoot(document.getElementById('frame')).render(<App/>);`;
    const bundle = buildSync({ stdin: { contents: code, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(dir, 'bundle.js'), bundle.outputFiles[0].contents);
    const css = fs.readdirSync(path.join(root, 'dist/assets')).find(name => name.endsWith('.css'));
    fs.copyFileSync(path.join(root, 'dist/assets', css), path.join(dir, 'styles.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div id="frame" class="pf-paper" style="width:1500px;margin:24px;background:white"></div><script src="./bundle.js"></script>');
    const env = { ...process.env, PFLOW_GRID_SMOKE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 35000 });
    if (child.status !== 0) throw new Error(child.error?.message || child.stderr || child.stdout);
    console.log(child.stdout.trim());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
