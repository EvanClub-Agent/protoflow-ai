const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if(process.versions.electron){
  const {app,BrowserWindow}=require('electron');const dir=process.env.PFLOW_SITEMAP_SMOKE_DIR;
  app.setPath('userData',path.join(dir,'profile'));
  app.whenReady().then(async()=>{
    app.dock?.hide();const win=new BrowserWindow({show:false,width:1360,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false}});
    const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
    const js=code=>win.webContents.executeJavaScript(code);
    const settle=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const click=async(selector,area='center')=>{
      const p=await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing click target');const r=el.getBoundingClientRect();return {x:Math.round(${area==='indent'?'r.x+5':'r.x+r.width/2'}),y:Math.round(${area==='padding'?'r.y+2':'r.y+r.height/2'})}})()`);
      win.webContents.sendInputEvent({type:'mouseMove',...p});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await settle();
    };
    const expectPage=async id=>{assert.equal(await js('window.sitemapSmoke.active()'),id);assert.equal(await js('document.querySelector("[data-open-page]").dataset.openPage'),id);assert.ok(await js(`document.querySelector('[data-open-page]').textContent.includes(${JSON.stringify('当前页面 '+id.slice(-1))})`));};
    try{
      await win.loadFile(path.join(dir,'index.html'));
      for(let i=0;i<100&&!await js('Boolean(window.sitemapSmoke && document.querySelector("[data-open-page]"))');i++)await new Promise(r=>setTimeout(r,20));
      await settle();
      await js('window.sitemapSmoke.startGeneration()');
      for(let i=0;i<100&&!await js('Boolean(window.sitemapSmoke.release)');i++)await new Promise(r=>setTimeout(r,20));
      assert.ok(await js('Boolean(window.sitemapSmoke.release)'));
      assert.deepEqual(await js('window.sitemapSmoke.rows()'), {});
      await click('[data-sitemap-id="node-page-b"] > button');await expectPage('page-b');
      assert.equal(await js('window.sitemapSmoke.rows()["table-b"].length'), 8);
      await click('[data-sitemap-id="node-page-a"] > button');await expectPage('page-a');
      await js('window.sitemapSmoke.release()');
      const generation = await js('window.sitemapSmoke.result');
      assert.deepEqual(generation, { completed: ['page-a','page-b','page-c'], selected: 'page-a', rows: 8 });
      await expectPage('page-a');
      console.log('PASS generation: browsing real menus initializes preview rows without rejecting the result, losing data or moving selection');
      console.log('PASS baseline: title button switches on first trusted click');
      await click('[data-sitemap-id="node-page-b"]','padding');await expectPage('page-b');
      await click('[data-sitemap-id="node-page-a"]','indent');await expectPage('page-a');
      await click('[title="该菜单已关联 1 张数据库表"]');await expectPage('page-b');
      await js('window.sitemapSmoke.resetBadge()');await settle();await click('[title="共表数据发生了更新"]');await expectPage('page-a');
      // Folder padding and keyboard activation should toggle once, not bubble twice.
      await click('[data-sitemap-id="folder-smoke"]','padding');assert.equal(await js('document.querySelectorAll("[data-sitemap-id=node-page-b]").length'),0);
      await click('[data-sitemap-id="folder-smoke"] > button');assert.equal(await js('document.querySelectorAll("[data-sitemap-id=node-page-b]").length'),1);
      await js('document.querySelector("[data-sitemap-id=node-page-b] > button").focus()');
      win.webContents.focus();
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'char',keyCode:'\r'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await settle();await expectPage('page-b');
      await click('[aria-label="移动页面甲"]');await expectPage('page-b');assert.ok(await js('Boolean(document.querySelector("dialog[open]"))'));
      await js('Array.from(document.querySelectorAll("dialog[open] button")).find(b=>b.textContent.includes("取消")).click()');await settle();
      await click('[aria-label="删除页面甲"]');await expectPage('page-b');assert.ok(await js('Boolean(document.querySelector("dialog[open]"))'));
      assert.deepEqual(errors,[]);console.log('PASS Chromium: one click navigates from labels, row padding, indentation and badges; folders, keyboard and independent menu actions work');app.exit(0);
    }catch(e){console.error(e);console.error(errors);app.exit(1);}
  });setTimeout(()=>app.exit(1),30000).unref();
}else{
  const {buildSync}=require('esbuild'),{spawnSync}=require('node:child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'protoflow-sitemap-navigation-'));
  try{
    const code=`
import React from 'react';import {createRoot} from 'react-dom/client';import {LeftSitemapTree} from './src/components/LeftSitemapTree';import {ProtoCanvasDesigner} from './src/proto/designer/ProtoCanvasDesigner';import {useProtoStore} from './src/store/useProtoStore';import {usePageStore} from './src/proto/store/usePageStore';import {loadProjectFromBinaryPayload,createProjectPayload} from './src/services/projectStorage';
import {useAiChatStore} from './src/store/useAiChatStore';import {useHermesStore} from './src/store/useHermesStore';import {generateProject,projectPlanProgress} from './src/services/projectWorkflow';
const payload=createProjectPayload({projectId:'sitemap-smoke',projectName:'导航测试',templateId:'blank_project',storageDir:'/tmp',fileName:'smoke.pflow',createdAt:'2026-10-31',updatedAt:'2026-10-31',pageCount:2,tableCount:0,stickyCount:0});
payload.stateSnapshot.designerFolders=[{id:'folder-smoke',title:'测试目录',parentFolderId:null}];payload.stateSnapshot.designerPages=['a','b'].map(id=>({pageId:'page-'+id,title:id==='a'?'页面甲':'页面乙',folderId:'folder-smoke'}));payload.stateSnapshot.pageSources=Object.fromEntries(['a','b'].map(id=>['page-'+id,'export default function Page(){return <Page pfId="root-'+id+'" title="页面'+id+'"><Text pfId="text-'+id+'">当前页面 '+id+'</Text></Page>}']));payload.stateSnapshot.activePageId='page-a';
payload.stateSnapshot.pageSources['page-b']='export default function Page(){return <Page pfId="root-b" title="页面b"><Text pfId="text-b">当前页面 b</Text><Statistic pfId="count-b" table="table-b" title="记录数"/></Page>}';
payload.stateSnapshot.dbTables=[{id:'table-b',tableName:'table_b',cnName:'测试数据',domain:'基础资料域 (MDM)',description:'',columns:[],sharedByMenus:[{pageId:'page-b',menuTitle:'页面乙',accessMode:'READ 查询',fieldMappingNote:''}]}];loadProjectFromBinaryPayload(payload);useProtoStore.setState({leftActivityView:'pages',leftSidebarTab:'pages',leftSidebarCollapsed:false,viewMode:'single_page',menuPulseBadges:{'page-a':1}});
const listeners=new Set();
window.protoflowDesktop={hermes:{onEvent:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},session:async scope=>({...scope,sessionId:'navigation',running:false,projectTools:['protoflow_get_project_brief','protoflow_search_history','protoflow_upsert_project_agreement','protoflow_ask_questions','protoflow_revise_project_page','protoflow_set_project_plan','protoflow_apply_tsx_patch','protoflow_edit_page_block','protoflow_move_sitemap_item'],models:{currentModelId:'test',availableModels:[]}}),sync:async()=>({synced:true}),execute:async input=>{
  const execSessionId='navigation-exec-'+input.targetPageId;
  const taskKey=JSON.stringify([input.projectId,'project-page-exec',input.threadId??null,input.targetPageId]);
  listeners.forEach(fn=>fn({type:'run-start',projectId:input.projectId,kind:input.kind,sessionId:execSessionId,planningSessionId:'navigation',execSessionId,taskKey,targetPageId:input.targetPageId,clientRequestId:input.clientRequestId,runId:'run'}));
  await new Promise(resolve=>{window.sitemapSmoke.release=resolve;});
  return {text:'已生成页面丙',sessionId:execSessionId,planningSessionId:'navigation',execSessionId,taskKey,clientRequestId:input.clientRequestId,runId:'run',modelId:'test',operations:[{tool:'protoflow_apply_tsx_patch',args:{pageId:input.targetPageId,source:'export default function Page(){return <Page pfId="root-c"><Text pfId="text-c">页面丙已生成</Text></Page>}'}}]};
}}};
window.sitemapSmoke={active:()=>useProtoStore.getState().activePageId,rows:()=>usePageStore.getState().tableRows,resetBadge:()=>useProtoStore.setState({menuPulseBadges:{'page-a':1}}),startGeneration:()=>{
  useHermesStore.setState({status:'running',sessions:{},runningProjects:{},cancelGeneration:{},partial:{}});
  useAiChatStore.getState().switchConversation({projectId:payload.meta.projectId,kind:'project'});
  const pages=[...payload.stateSnapshot.designerPages,{pageId:'page-c',title:'页面丙',folderId:'folder-smoke'}];
  useProtoStore.setState({projectPlan:{summary:'补充页面丙',folders:payload.stateSnapshot.designerFolders,pages:pages.map(page=>({...page,requirements:page.title})),approved:true,generatedPageIds:['page-a','page-b']}});
  window.sitemapSmoke.result=generateProject(payload.meta.projectId).then(()=>({completed:projectPlanProgress(),selected:useProtoStore.getState().activePageId,rows:usePageStore.getState().tableRows['table-b'].length}),error=>({error:error.message}));
}};
function App(){const page=useProtoStore(s=>s.activePageId);return <><LeftSitemapTree/><main data-open-page={page} className="flex flex-1 min-w-0 overflow-hidden"><ProtoCanvasDesigner key={page} pageId={page}/></main></>};createRoot(document.getElementById('frame')).render(<App/>);`;
    const result=buildSync({stdin:{contents:code,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,define:{'process.env.NODE_ENV':'"production"'},loader:{'.svg':'dataurl'}});
    fs.writeFileSync(path.join(dir,'bundle.js'),result.outputFiles[0].contents);const css=fs.readdirSync(path.join(root,'dist/assets')).find(n=>n.endsWith('.css'));fs.copyFileSync(path.join(root,'dist/assets',css),path.join(dir,'styles.css'));
    fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><html data-theme="light"><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div id="frame" style="height:100vh;width:100vw;display:flex;background:white"></div><script src="./bundle.js"></script>');
    const env={...process.env,PFLOW_SITEMAP_SMOKE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;const child=spawnSync(require('electron'),[__filename],{env,encoding:'utf8',timeout:35000});
    if(child.status!==0)throw new Error(child.error?.message||child.stdout+child.stderr);console.log(child.stdout.trim());
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
