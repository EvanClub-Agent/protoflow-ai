// Isolated Chromium acceptance for the real ECharts renderer and palette.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_CHARTS_SMOKE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const window = new BrowserWindow({ show: false, width: 1640, height: 1400, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const js = code => window.webContents.executeJavaScript(code);
    const wait = async (predicate, label) => {
      for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
      throw new Error(`Timed out: ${label}`);
    };
    const get = `window.chartSmoke.get('BarChart')`;
    const clickFirstBar = async () => {
      const pos = await js(`(async()=>{const c=await ${get};const element=c.getModel().getSeriesByIndex(0).getData().getItemGraphicEl(0);const box=element.getBoundingRect();const [x,y]=element.transformCoordToGlobal(box.x+box.width/2,box.y+box.height/2);const host=c.getDom().getBoundingClientRect();return {x:Math.round(host.x+x),y:Math.round(host.y+y)}})()`);
      window.webContents.sendInputEvent({ type: 'mouseMove', ...pos });
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...pos });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...pos });
    };
    try {
      await window.loadFile(path.join(dir, 'index.html'));
      await wait(() => js('document.querySelectorAll("[data-chart-status=ready]").length===12'), 'all twelve ECharts render');
      const types = await js('window.chartSmoke.types');
      for (const type of types) {
        assert.ok(await js(`(async()=>{const c=await window.chartSmoke.get(${JSON.stringify(type)});return c.getZr().storage.getDisplayList().length>0 && c.getWidth()>100 && c.getHeight()===220})()`), type);
      }
      await js('Array.from(document.querySelectorAll("aside button")).find(b=>b.textContent.trim()==="图表").click()');
      assert.equal(await js('document.querySelectorAll("aside [draggable=true]").length'), 12);
      assert.equal(await js('document.querySelectorAll("[data-chart-inspector] textarea").length'), 0);
      await clickFirstBar();
      await wait(() => js('window.chartSmoke.runtime.overlays.length===1'), 'actual chart click opens modal');
      assert.deepEqual(await js('window.chartSmoke.runtime.overlays[0].params'), { name: '1 月', value: 120, seriesName: '销售额' });
      assert.ok(await js('document.body.innerText.includes("1 月：120")'));
      await js('window.chartSmoke.runtime.closeOverlay();window.chartSmoke.design(true)');
      await wait(() => js('document.querySelector("[data-chart-type=BarChart] [role=img]").style.pointerEvents==="none"'), 'design selection mode');
      await clickFirstBar();
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await js('window.chartSmoke.runtime.overlays.length'), 0);
      await js('window.chartSmoke.design(false)');
      const width = await js(`(async()=> (await ${get}).getWidth())()`);
      await js('window.chartSmoke.compact(true)');
      await wait(() => js(`(async()=> (await ${get}).getWidth()<${width})()`), 'resize with container');
      await js('window.chartSmoke.visible(false)');
      await js('window.chartSmoke.visible(true);window.chartSmoke.compact(false)');
      await wait(() => js(`(async()=> (await ${get}).getWidth()===${width})()`), 'hidden panel restores correct size');
      await js(`(async()=>{window.originalChart=await ${get};window.chartSmoke.update({source:'inline',dimension:'category',metrics:[{field:'value',label:'当前值'}],data:[{category:'甲',value:42}]});})()`);
      await wait(() => js(`(async()=>{const c=await ${get};return c.getOption().series.length===1&&c.getOption().series[0].data[0].value===42})()`), 'data update removes stale series');
      assert.equal(await js(`(async()=>window.originalChart===await ${get})()`), true);
      await js('window.chartSmoke.update({source:"inline",dimension:"category",metrics:[{field:"value",label:"当前值"}],data:[]})');
      await wait(() => js('document.querySelector("[data-chart-type=BarChart]").dataset.chartStatus==="empty"'), 'empty data never falls back to samples');
      assert.equal(await js('window.originalChart.isDisposed()'), true);
      await js('window.chartSmoke.update({source:"inline",dimension:"category",metrics:[{field:"value",label:"当前值"}],data:[{category:"甲",value:null}]})');
      await wait(() => js('document.querySelector("[data-chart-type=BarChart]").dataset.chartStatus==="error"'), 'invalid metric reports an error');
      await js('window.chartSmoke.update({source:"table",table:"sales-entity",dimension:"category",metrics:[{field:"value",label:"工程数据"}]})');
      await wait(() => js(`(async()=>{const c=await ${get};return !!c&&c.getOption().series[0].data[0].value===25})()`), 'published preview data uses exact table fields');
      await js('window.chartSmoke.update({source:"inline",dimension:"period",metrics:[{field:"value",label:"访问量"}],data:Array.from({length:10000},(_,i)=>({period:String(i),value:i%100})),dataZoom:true})');
      await wait(() => js(`(async()=>{const c=await ${get};const o=c.getOption();return o.series[0].data.length===10000&&o.series[0].large===true&&o.dataZoom.length===2})()`), '10000 data points use large-data rendering and range zoom');
      await js(`(async () => {
        const bar = await ${get};
        bar.dispatchAction({ type: 'dataZoom', start: 20, end: 50 });
        bar.dispatchAction({ type: 'legendUnSelect', name: '访问量' });
        const heatmap = await window.chartSmoke.get('HeatmapChart');
        heatmap.dispatchAction({ type: 'selectDataRange', selected: [30, 70] });
      })()`);
      for (const [mode, tooltip] of [['dark', '#1f1f1f'], ['light', '#fff']]) {
        await js(`document.documentElement.dataset.theme = '${mode}'`);
        await wait(() => js(`(async () => (await ${get}).getOption().tooltip[0].backgroundColor === '${tooltip}')()`), mode + ' tooltip applied');
        const state = await js(`(async () => {
          const { dataZoom, legend } = (await ${get}).getOption();
          const { visualMap } = (await window.chartSmoke.get('HeatmapChart')).getOption();
          return { zoom: [dataZoom[0].start, dataZoom[0].end], visible: legend[0].selected['访问量'], range: visualMap[0].range };
        })()`);
        assert.deepEqual(state, { zoom: [20, 50], visible: false, range: [30, 70] }, mode + ' keeps chart interactions');
      }
      await js('window.chartSmoke.update({source:"sample"})');
      await wait(() => js('document.querySelectorAll("[data-chart-status=ready]").length===12'), 'recover after invalid data');
      assert.equal(await js('document.querySelectorAll("[data-chart-status=error]").length'), 0);
      if (process.env.PFLOW_CHARTS_SCREENSHOT) {
        await new Promise(resolve => setTimeout(resolve, 450));
        assert.equal(await js(`(async()=>{const c=await ${get};return c.getWidth()===c.getDom().clientWidth})()`), true);
        fs.writeFileSync(process.env.PFLOW_CHARTS_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      }
      await js(`(async()=>{window.lastChart=await ${get};window.chartSmoke.mount(false)})()`);
      await wait(() => js('window.lastChart.isDisposed()'), 'unmount disposes chart');
      console.log('PASS charts: 12 real renderers, palette and no-code inspector, physical click with typed modal data, design mode, resize/hide, live update, empty/invalid/saved data, disposal');
      app.exit(0);
    } catch (error) { console.error(error.message); console.error(await js('document.body.innerText').catch(() => 'unavailable')); app.exit(1); }
  });
  setTimeout(() => app.exit(1), 60000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-charts-'));
  try {
    const code = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CHART_TYPES} from './src/proto/charts/model';
import {CHART_MATERIALS} from './src/proto/charts/metadata';
import {ChartInspector} from './src/proto/charts/ChartInspector';
import {MaterialsAndOutlinePane} from './src/proto/designer/MaterialsAndOutlinePane';
import {NodeView,ScopeProvider} from './src/proto/renderer/NodeView';
import {RuntimeProvider,useRuntimeController} from './src/proto/runtime/runtime';
import {PreviewDataContext} from './src/proto/runtime/PreviewData';
const initial={header:[],root:{kind:'node',pfId:'root',type:'Page',props:{},children:CHART_MATERIALS.map(m=>({kind:'node',pfId:m.name,type:m.name,props:{title:m.title,source:'sample',height:220,...(m.name==='BarChart'?{onClick:{$kind:'actions',calls:[{name:'openModal',args:['detail',{name:'{{chart.name}}',value:'{{chart.value}}',seriesName:'{{chart.seriesName}}'}]}]}}:{})},children:[]})).concat([{kind:'node',pfId:'modal',type:'Modal',props:{id:'detail',title:'图表详情'},children:[{kind:'node',pfId:'detail-value',type:'Text',props:{},children:[{kind:'text',value:'{{params.name}}：{{params.value}}'}]}]}])}};
const preview={tables:[{id:'sales-entity',tableName:'t_sales',cnName:'销售数据',columns:[{id:'category-col',name:'category',dataType:'TEXT',comment:'分类',nullable:false},{id:'value-col',name:'value',dataType:'DECIMAL',comment:'数值',nullable:false}]}],rows:{'sales-entity':[{id:'row-1',category:'数据表分类',value:25}]}};
function App(){const [doc,setDoc]=useState(initial),[design,setDesign]=useState(false),[compact,setCompact]=useState(false),[visible,setVisible]=useState(true),[mounted,setMounted]=useState(true);const rt=useRuntimeController(doc,'charts',design);window.chartSmoke={types:CHART_TYPES,runtime:rt,design:setDesign,compact:setCompact,visible:setVisible,mount:setMounted,update:props=>setDoc({...doc,root:{...doc.root,children:doc.root.children.map(n=>n.type==='BarChart'?{...n,props:{title:'柱状图',height:220,...props}}:n)}}),get:async type=>(await import('./src/proto/charts/engine')).echarts.getInstanceByDom(document.querySelector('[data-chart-type='+type+'] [role=img]'))};return <PreviewDataContext.Provider value={preview}><RuntimeProvider value={rt}><div style={{display:'flex',alignItems:'flex-start',background:'#f8fafc',minHeight:'100vh'}}><div style={{height:'100vh',position:'sticky',top:0}}><MaterialsAndOutlinePane root={doc.root} selectedPfId='BarChart' hoveredPfId={null} activeOverlayId={null} compositeBlocks={[]} onSelectNode={()=>{}} onHoverNode={()=>{}} onSelectOverlay={()=>{}} onInsertComponent={()=>{}} onInsertCompositeBlock={()=>{}} onDeleteCompositeBlock={()=>{}} onPromptSaveComposite={()=>{}} onDeleteNode={()=>{}} onApplyTemplate={()=>{}}/></div><main style={{flex:1,minWidth:0,padding:20,maxWidth:compact?650:undefined}}><h1 style={{fontSize:22,fontWeight:600,marginBottom:6}}>数据图表</h1><p style={{fontSize:12,color:'#64748b',marginBottom:20}}>选择适合的数据表达，让信息更直观 · 图中均为示例数据</p><div style={{display:visible?'grid':'none',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:16}}>{mounted&&doc.root.children.slice(0,12).map(node=><NodeView key={node.pfId} node={node}/>)}</div></main><div style={{width:280,flexShrink:0,background:'white',padding:16,position:'sticky',top:0,maxHeight:'100vh',overflow:'auto'}}><h2 style={{fontSize:13,fontWeight:600,marginBottom:12}}>图表设置</h2><ChartInspector node={doc.root.children[0]} doc={doc} tables={preview.tables} onCommit={setDoc}/></div>{rt.overlays.map((entry,index)=><ScopeProvider key={entry.key} value={{params:entry.params,overlayIndex:index}}><NodeView node={doc.root.children[12]} live/></ScopeProvider>)}</div></RuntimeProvider></PreviewDataContext.Provider>}
createRoot(document.getElementById('root')).render(<App/>);`;
    const bundle = buildSync({ stdin: { contents: code, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(dir, 'bundle.js'), bundle.outputFiles[0].contents);
    const css = fs.readdirSync(path.join(root, 'dist/assets')).find(f => f.endsWith('.css'));
    fs.copyFileSync(path.join(root, 'dist/assets', css), path.join(dir, 'styles.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div id="root"></div><script src="./bundle.js"></script>');
    const env = { ...process.env, PFLOW_CHARTS_SMOKE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 65000 });
    if (child.status !== 0) throw new Error(child.error?.message || child.stdout + child.stderr);
    console.log(child.stdout.trim());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
