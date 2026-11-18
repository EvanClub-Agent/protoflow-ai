// Render the real designer with an isolated profile and a deterministic streaming transport.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_STREAM_SMOKE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const window = new BrowserWindow({ show: false, width: 1500, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const errors = [];
    window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const js = code => window.webContents.executeJavaScript(code);
    const waitFor = async code => {
      for (let i = 0; i < 150; i++) { if (await js(`Boolean(${code})`)) return; await new Promise(r => setTimeout(r, 20)); }
      throw new Error(`Timed out: ${code}`);
    };
    const aura = async active => {
      await waitFor(`Boolean(document.querySelector('.pf-ai-viewport-aura')) === ${active}`);
      const styles = await js(`(()=>{
        const paper = document.querySelector('.pf-ai-aura-surface');
        const frame = document.querySelector('.pf-ai-viewport-aura');
        return { active: !!document.querySelector('[data-ai-active="1"]'),
          animation: getComputedStyle(paper).animationName,
          rim: getComputedStyle(paper, '::after').content,
          pointerEvents: frame && getComputedStyle(frame).pointerEvents };
      })()`);
      assert.equal(styles.active, active);
      assert.equal(styles.animation, active ? 'pf-ai-orbit' : 'none');
      assert.equal(styles.rim, active ? '""' : 'none');
      if (active) assert.equal(styles.pointerEvents, 'none');
    };
    try {
      await window.loadFile(path.join(dir, 'index.html'));
      await waitFor('window.streamSmoke && document.body.textContent.includes("保留原页面")');
      await aura(false);
      await js(`document.querySelector('[data-pf-id="root"]').click()`);
      await waitFor(`document.querySelector('[data-pf-id="root"][data-pf-sel="1"]')`);
      assert.equal(await js('getComputedStyle(document.querySelector("[data-pf-id=root]")).outlineStyle'), 'solid');
      await js('window.streamSmoke.begin()');
      await waitFor('window.streamSmoke.running');
      await aura(true); // Generation starts before its first renderable block.
      await js('window.streamSmoke.selectPage("other")');
      await waitFor('document.body.textContent.includes("其他页面内容")');
      await aura(false);
      await js('window.streamSmoke.selectPage("main")');
      await aura(true);
      await js('window.streamSmoke.player(true)');
      await aura(false);
      await js('window.streamSmoke.player(false)');
      await aura(true);
      await js('window.streamSmoke.block(1)');
      await waitFor('document.querySelector("[data-ai-preview-page]") && document.body.textContent.includes("第一块已出现")');
      assert.equal(await js('window.streamSmoke.saved().includes("保留原页面")'), true);
      assert.equal(await js('document.querySelector("[data-ai-preview-page]").inert'), true);
      await aura(true);
      await js('window.streamSmoke.block(2)');
      await waitFor('document.querySelector("[data-pf-id=stream-table]") && document.body.textContent.includes("继续生成表格")');
      assert.equal(await js('window.streamSmoke.saved().includes("保留原页面")'), true);
      assert.equal(await js('window.streamSmoke.historySize()'), 0);
      window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
      assert.equal(await js('getComputedStyle(document.querySelector(".pf-ai-aura-surface"),"::after").animationName'), 'none');
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features:[] });
      window.webContents.debugger.detach();
      await aura(true);
      if (process.env.PFLOW_STREAM_SCREENSHOT) fs.writeFileSync(process.env.PFLOW_STREAM_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      await js('window.streamSmoke.finish()');
      await waitFor('window.streamSmoke.outcome === "done" && !document.querySelector("[data-ai-preview-page]")');
      assert.equal(await js('window.streamSmoke.saved().includes("stream-table")'), true);
      assert.equal(await js('window.streamSmoke.historySize()'), 1);
      await aura(false);
      await js('window.streamSmoke.begin()');
      await waitFor('window.streamSmoke.running');
      await js('window.streamSmoke.block(1)');
      await waitFor('document.querySelector("[data-ai-preview-page]")');
      await js(`document.querySelector('[aria-label="AI 实时生成预览"] button').click()`);
      await waitFor('window.streamSmoke.outcome === "error" && !document.querySelector("[data-ai-preview-page]")');
      assert.equal(await js('window.streamSmoke.saved().includes("stream-table")'), true);
      assert.equal(await js('window.streamSmoke.historySize()'), 1);
      await aura(false);
      await js('window.streamSmoke.begin()');
      await waitFor('window.streamSmoke.running');
      await aura(true);
      await js('window.streamSmoke.error()');
      await waitFor('window.streamSmoke.outcome === "error"');
      await aura(false);
      await js('window.streamSmoke.begin({readOnly:true})');
      await waitFor('window.streamSmoke.running');
      await aura(false);
      await js('window.streamSmoke.finish()');
      await waitFor('window.streamSmoke.outcome === "done"');
      await js('window.streamSmoke.begin({audit:{kind:"scan",scope:"project"}})');
      await waitFor('window.streamSmoke.running');
      await aura(false);
      await js('window.streamSmoke.finishAudit()');
      await waitFor('window.streamSmoke.outcome === "done"');
      await js('window.streamSmoke.begin()');
      await waitFor('window.streamSmoke.running');
      await aura(true);
      await js('window.streamSmoke.switchProject()');
      await waitFor('document.body.textContent.includes("保留原页面")');
      await aura(false);
      await js('window.streamSmoke.error()');
      await waitFor('window.streamSmoke.outcome === "error"');
      await aura(false);
      assert.deepEqual(errors, []);
      console.log('PASS Chromium: incremental inert drafts and one final commit; aura only for active content generation, hidden on completion/cancel/error/page or project switch, read-only work and playback; reduced motion and idle selection preserved');
      app.exit(0);
    } catch (error) { console.error(error); console.error(errors); app.exit(1); }
  });
  setTimeout(() => app.exit(1), 30000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-stream-smoke-'));
  try {
    const code = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ProtoCanvasDesigner} from './src/proto/designer/ProtoCanvasDesigner';
import {useProtoStore} from './src/store/useProtoStore';
import {usePageStore} from './src/proto/store/usePageStore';
import {useHermesStore} from './src/store/useHermesStore';
import {createProjectPayload,loadProjectFromBinaryPayload} from './src/services/projectStorage';
import {runProjectAi} from './src/services/hermesBridge';
import {editPageBlock} from './src/proto/dsl/editBlock';
const scope = {projectId:'chromium-stream',pageId:'main'};
const page = body => 'export default function Page(){return <Page pfId="root">'+body+'</Page>}';
const first = page('<PageHeader pfId="heading" title="第一块已出现"/><Card pfId="form-card" title="基本信息"><Form pfId="form"><Input pfId="name" name="name" label="姓名"/><Select pfId="status" name="status" label="状态" options={["启用","停用"]}/></Form></Card>');
const second = editPageBlock(first,'root','append_children','<Card pfId="table-card" title="第二块数据列表"><Table pfId="stream-table" columns={[{title:"名称",dataIndex:"name"},{title:"状态",dataIndex:"status"}]} /></Card>');
const base = createProjectPayload({projectId:scope.projectId,projectName:'流式预览测试',templateId:'blank_project',storageDir:'/tmp',fileName:'stream.pflow',createdAt:'2026-10-31',updatedAt:'2026-10-31',pageCount:0,tableCount:0,stickyCount:0});
base.stateSnapshot.pageSources={main:page('<Title pfId="original">保留原页面</Title>'),other:page('<Title pfId="other-title">其他页面内容</Title>')};
base.stateSnapshot.designerFolders = [{ id:'folder-project-pages', title:'测试目录', parentFolderId:null }];
base.stateSnapshot.designerPages=['main','other'].map(pageId=>({pageId,title:pageId,folderId:'folder-project-pages'}));
base.stateSnapshot.activePageId='main'; loadProjectFromBinaryPayload(base);
useProtoStore.setState({leftSidebarCollapsed:false,rightSidebarCollapsed:true});
const listeners=new Set(); const emit=e=>listeners.forEach(fn=>fn(e));
let finish, fail, runId, staged=[];
const state={running:false,outcome:'',saved:()=>usePageStore.getState().pageSources.main,historySize:()=>usePageStore.getState().history.main?.past.length ?? 0,
  begin(options){state.outcome='';staged=[];runId=crypto.randomUUID();void runProjectAi('逐块生成页面',options).then(()=>{state.outcome='done';state.running=false},()=>{state.outcome='error';state.running=false});},
  selectPage:pageId=>useProtoStore.getState().setActivePage(pageId),
  player:isWebPlayerMode=>useProtoStore.setState({isWebPlayerMode}),
  error:()=>fail(new Error('生成服务断开')),
  switchProject(){const next=structuredClone(base);next.meta.projectId='another-project';next.meta.fileName='another.pflow';loadProjectFromBinaryPayload(next);},
  finishAudit(){staged=[{tool:'protoflow_run_closed_loop_audit',args:{issues:[]}}];state.finish();},
  block(n){const source=n===1?first:second;staged.push({tool:'protoflow_apply_tsx_patch',args:{pageId:'main',source}});emit({type:'session-update',...scope,sessionId:'session',runId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:n===1?'正在生成基本信息。':'继续生成表格。'}}});emit({type:'page-preview',...scope,sessionId:'session',runId,preview:{targetPageId:'main',source,sequence:n,dbTables:[]}});},
  finish(){finish({text:'页面已完成',sessionId:'session',runId,modelId:'mock',operations:staged});}};
window.protoflowDesktop={hermes:{onEvent:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},session:async()=>({...scope,sessionId:'session',running:false,models:{currentModelId:'mock',availableModels:[{modelId:'mock',name:'预览测试'}]}}),sync:async()=>({synced:true}),execute:()=>{state.running=true;emit({type:'run-start',...scope,sessionId:'session',runId});return new Promise((resolve,reject)=>{finish=resolve;fail=reject})},cancel:async()=>fail(new Error('已停止生成'))}};
useHermesStore.setState({status:'running',sessions:{},runningProjects:{},runningPageByProject:{},partial:{},cancelGeneration:{}});
function Harness(){const pageId=useProtoStore(s=>s.activePageId),projectId=useProtoStore(s=>s.currentProjectMeta.projectId);return <ProtoCanvasDesigner key={JSON.stringify([projectId,pageId])} pageId={pageId}/>;}
window.streamSmoke=state;createRoot(document.getElementById('root')).render(<Harness/>);
`;
    const bundle = buildSync({ tsconfig: path.join(root, 'tsconfig.app.json'), stdin: { contents: code, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', write: false, loader: { '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(dir, 'bundle.js'), bundle.outputFiles[0].contents);
    const css = fs.readdirSync(path.join(root, 'dist/assets')).find(name => name.endsWith('.css'));
    fs.copyFileSync(path.join(root, 'dist/assets', css), path.join(dir, 'styles.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div id="root" style="height:100vh"></div><script src="./bundle.js"></script>');
    const env = { ...process.env, PFLOW_STREAM_SMOKE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 35000 });
    if (child.status !== 0) throw new Error(child.error?.message || child.stderr || child.stdout);
    console.log(child.stdout.trim());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
