// Real Chromium project chat, isolated profile, deterministic transport (no model requests).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_PROJECT_LIVE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const window = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const errors = [];
    window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const js = async code => {
      try { return await window.webContents.executeJavaScript(code); }
      catch (error) { throw new Error(`${code}: ${error.message}`); }
    };
    const waitFor = async code => {
      for (let i = 0; i < 200; i++) { if (await js(`Boolean(${code})`)) return; await new Promise(r => setTimeout(r, 20)); }
      throw new Error(`Timed out: ${code}`);
    };
    const clickTab = label => js(`Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent===${JSON.stringify(label)}).click()`);
    try {
      await window.loadFile(path.join(dir, 'index.html'));
      await waitFor('window.liveSmoke && window.liveSmoke.sessions === 2 && !document.querySelector("[aria-label=选择对话模型]").disabled');
      assert.equal(await js('window.liveSmoke.executions'), 0, 'entering the view prepares without prompting');
      await js('window.liveSmoke.begin()');
      await waitFor('window.liveSmoke.running');
      await js('window.liveSmoke.think()');
      await waitFor('document.body.textContent.includes("正在思考…")');
      await js('window.liveSmoke.block(1)');
      await waitFor('document.querySelector("[data-ai-preview-page]") && document.body.textContent.includes("第一块已出现")');
      assert.equal(await js('document.querySelector("[data-ai-preview-page]").inert'), true);
      assert.equal(await js('window.liveSmoke.saved().includes("原页面")'), true);
      assert.equal(await js('window.liveSmoke.historySize()'), 0);
      await clickTab('目录与方案');
      await waitFor('!document.querySelector("[data-ai-preview-page]")');
      await clickTab('实时预览');
      await waitFor('document.querySelector("[data-ai-preview-page]")');
      await js('window.liveSmoke.block(2)');
      await waitFor('document.body.textContent.includes("候选订单 A")');
      assert.deepEqual(await js('window.liveSmoke.rows()'), {});
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      if (process.env.PFLOW_PROJECT_LIVE_SCREENSHOT)
        fs.writeFileSync(process.env.PFLOW_PROJECT_LIVE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      await js('window.liveSmoke.otherChat()');
      await waitFor('!document.querySelector("[data-ai-preview-page]")');
      await js('window.liveSmoke.originalChat()');
      await waitFor('document.querySelector("[data-ai-preview-page]") && document.body.textContent.includes("候选订单 A")');
      await js(`document.querySelector('[aria-label="AI 实时生成预览"] button').click()`);
      await waitFor('window.liveSmoke.outcome === "error" && !document.querySelector("[data-ai-preview-page]")');
      assert.equal(await js('window.liveSmoke.cancelledScope.threadId === window.liveSmoke.scope.threadId && window.liveSmoke.cancelledScope.kind === "project"'), true);
      assert.equal(await js('window.liveSmoke.saved().includes("原页面")'), true);
      await js('window.liveSmoke.begin()');
      await waitFor('window.liveSmoke.running');
      await js('window.liveSmoke.block(1)');
      await waitFor('document.querySelector("[data-ai-preview-page]")');
      await js('window.liveSmoke.finish()');
      await waitFor('window.liveSmoke.outcome === "done" && !document.querySelector("[data-ai-preview-page]")');
      assert.equal(await js('window.liveSmoke.saved().includes("第一块已出现")'), true);
      assert.equal(await js('window.liveSmoke.historySize()'), 1);
      assert.deepEqual(errors, []);
      console.log('PASS Chromium: project warm-up without a prompt, thinking status, incremental inert drafts with staged rows, plan/preview tabs, exact chat isolation, scoped cancellation and one final validated commit');
      app.exit(0);
    } catch (error) { console.error(error); console.error(errors); app.exit(1); }
  });
  setTimeout(() => app.exit(1), 30000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-project-live-'));
  try {
    const projectTools = require('../electron/protoflow-mcp.cjs').tools.map(tool => tool.name);
    const code = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ProjectAiView} from './src/components/ProjectAiView';
import {useProtoStore} from './src/store/useProtoStore';
import {usePageStore} from './src/proto/store/usePageStore';
import {useAiChatStore} from './src/store/useAiChatStore';
import {useHermesStore} from './src/store/useHermesStore';
import {createProjectPayload,loadProjectFromBinaryPayload} from './src/services/projectStorage';
import {generateProject} from './src/services/projectWorkflow';
import {projectChatScope} from './src/services/projectChatHistory';
const projectId='chromium-project-live';
const page = body => 'export default function Page(){return <Page pfId="root" title="订单管理">'+body+'</Page>}';
const first = page('<Card pfId="details" title="第一块已出现"><Form pfId="form"><Input pfId="customer" label="客户名称" name="customer"/><Select pfId="status" name="status" label="状态" options={["待处理","已完成"]}/></Form></Card>');
const second = page('<Card pfId="list" title="正在补充订单数据"><Table pfId="orders-table" table="candidate-orders" columns={[{title:"订单",dataIndex:"name"},{title:"状态",dataIndex:"status"}]} /></Card>');
const base = createProjectPayload({projectId,projectName:'项目实时生成预览',templateId:'blank_project',storageDir:'/tmp',fileName:'live.pflow',createdAt:'2026-11-12',updatedAt:'2026-11-12',pageCount:0,tableCount:0,stickyCount:0});
base.stateSnapshot.designerFolders=[{id:'orders-folder',title:'订单管理',parentFolderId:null}];
base.stateSnapshot.designerPages=[{pageId:'orders',title:'订单管理',folderId:'orders-folder',platform:'desktop'}];
base.stateSnapshot.pageSources={orders:page('<Card pfId="original" title="原页面"/>')};
base.stateSnapshot.activePageId='orders';
base.stateSnapshot.projectPlan={summary:'销售订单工作台',folders:base.stateSnapshot.designerFolders,pages:[{pageId:'orders',title:'订单管理',folderId:'orders-folder',requirements:'展示订单内容',dependencies:[],acceptanceCases:[{scenario:'查看订单内容',expected:'展示内容区块'}]}],approved:true,generatedPageIds:[]};
loadProjectFromBinaryPayload(base);useProtoStore.setState({viewMode:'project_ai'});
useAiChatStore.getState().loadProjectIndex(projectId);useAiChatStore.getState().newProjectChat(projectId);
const index=useAiChatStore.getState().projectIndexes[projectId], scope=projectChatScope(projectId,index.activeId);
const listeners=new Set(), emit=e=>listeners.forEach(fn=>fn(e));
let resolve, reject, runId;
const state={scope,sessions:0,executions:0,running:false,outcome:'',cancelledScope:null,
 saved:()=>usePageStore.getState().pageSources.orders,rows:()=>usePageStore.getState().tableRows,historySize:()=>usePageStore.getState().history.orders?.past.length??0,
 begin(){state.outcome='';void generateProject(projectId).then(()=>{state.outcome='done';state.running=false},()=>{state.outcome='error';state.running=false});},
 think(){emit({type:'session-update',...scope,sessionId:'live-session',runId,update:{sessionUpdate:'agent_thought_chunk'}});},
 block(n){const source=n===1?first:second;emit({type:'page-preview',...scope,sessionId:'live-session',runId,preview:{targetPageId:'orders',source,sequence:n,
 dbTables:n===1?[]:[{id:'candidate-orders',tableName:'candidate_orders',cnName:'订单',columns:[{id:'name-col',name:'name',cnName:'订单',dataType:'TEXT',nullable:false},{id:'status-col',name:'status',cnName:'状态',dataType:'TEXT',nullable:false}],sharedByMenus:[]}],
 tableRows:n===1?{}:{'candidate-orders':[{id:'one',name:'候选订单 A',status:'待处理'}]}}});},
 otherChat(){useAiChatStore.getState().newProjectChat(projectId);},
 originalChat(){useAiChatStore.getState().selectProjectChat(projectId,index.activeId);},
 finish(){resolve({text:'订单页面已完成',sessionId:'live-session',runId,modelId:'mock',operations:[{tool:'protoflow_apply_tsx_patch',args:{pageId:'orders',source:first}}]});}
};
window.protoflowDesktop={hermes:{onEvent:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},session:async s=>{state.sessions++;return {...s,sessionId:'live-session',running:false,projectTools:${JSON.stringify(projectTools)},models:{currentModelId:'mock',availableModels:[{modelId:'mock',name:'预览测试模型'}]}}},sync:async()=>({synced:true}),execute:()=>{state.running=true;state.executions++;runId=crypto.randomUUID();emit({type:'run-start',...scope,sessionId:'live-session',runId});return new Promise((yes,no)=>{resolve=yes;reject=no}).finally(()=>emit({type:'run-end',...scope,sessionId:'live-session',runId}));},cancel:async s=>{state.cancelledScope=s;reject(new Error('已停止生成'));}}};
useHermesStore.setState({status:'running',sessions:{},runningProjects:{},runningPageByProject:{},partial:{},progress:{},cancelGeneration:{}});
window.liveSmoke=state;createRoot(document.getElementById('root')).render(<React.StrictMode><ProjectAiView projectId={projectId}/></React.StrictMode>);
`;
    const bundle = buildSync({ tsconfig: path.join(root, 'tsconfig.app.json'), stdin: { contents: code, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', write: false, loader: { '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(dir, 'bundle.js'), bundle.outputFiles[0].contents);
    const css = fs.readdirSync(path.join(root, 'dist/assets')).find(name => name.endsWith('.css'));
    fs.copyFileSync(path.join(root, 'dist/assets', css), path.join(dir, 'styles.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div id="root" style="height:100vh"></div><script src="./bundle.js"></script>');
    const env = { ...process.env, PFLOW_PROJECT_LIVE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 35000 });
    if (child.status !== 0) throw new Error(child.error?.message || child.stderr || child.stdout);
    console.log(child.stdout.trim());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
