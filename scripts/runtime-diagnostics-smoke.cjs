const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname, '..');
if(process.versions.electron){
 const {app,BrowserWindow,ipcMain}=require('electron');const dir=process.env.PFLOW_DIAG_SMOKE_DIR;
 app.setPath('userData',path.join(dir,'profile'));
 app.whenReady().then(async()=>{
  app.dock?.hide();
  const {DiagnosticCollector}=require(path.join(root,'electron/diagnostics.cjs'));
  const collector=new DiagnosticCollector({dataDir:dir,serverUrl:'http://127.0.0.1:9999',appVersion:'0.0.5',enabled:false,fetchImpl:async(url,options)=>({status:200,ok:true,json:async()=>url.endsWith('/installations')?{registered:true}:{stored:true,id:JSON.parse(options.body).id}})});
  for(const method of ['capture','snapshot','configure','retry'])ipcMain.handle('pflow:diagnostics-'+method,(_e,input)=>collector[method](input));
  const win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{contextIsolation:true,nodeIntegration:false,preload:path.join(root,'electron/preload.cjs')}});
  win.webContents.on('console-message',e=>{if(e.level==='error')console.error(e.message);});
  const js=code=>win.webContents.executeJavaScript(code);
  const until=async code=>{for(let i=0;i<100;i++){if(await js('Boolean('+code+')'))return;await new Promise(r=>setTimeout(r,30));}throw new Error('Timed out: '+code);};
  let passed=false;
  try{
   await win.loadFile(path.join(dir,'index.html'));
   await until('window.smokeReady');
   await until('document.querySelector("[data-open]")');
   const id=await js(`window.protoflowDesktop.diagnostics.capture({category:'storage',code:'PROJECT_SAVE_FAILED',stage:'autosave',message:'disk full',context:{projectId:'smoke-project'}})`);
   await js(`document.querySelector('[data-open]').click()`);
   await until('document.querySelector("dialog[open]")');
   await until('document.querySelector("dialog").textContent.includes("PROJECT_SAVE_FAILED")');
   assert.equal(await js('document.querySelector("dialog").textContent.includes("待上传")'),true);
   assert.equal(await js(`document.querySelector('dialog').textContent.includes(${JSON.stringify(id)})`),true);
   await js(`document.querySelector('input[type=checkbox]').click()`);
   await until('(document.querySelector("dialog input[type=checkbox]").checked)');
   await js(`window.protoflowDesktop.diagnostics.retry()`);
   assert.equal(collector.snapshot().items[0].state,'uploaded');
   await js(`document.querySelector('[aria-label="关闭运行诊断"]').click()`);
   await until('!document.querySelector("dialog")');
   await until('document.body.textContent.includes("DIAG_ADMIN_TEST")');
   assert.equal(await js('document.body.textContent.includes("smoke-account")'),true);
   assert.equal(await js('document.body.textContent.includes("smoke-computer")'),true);
   await js(`document.querySelector('details > summary').click()`);
   assert.equal(await js('document.body.textContent.includes("440,588")'),true);
   await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='查看此电脑同一任务的全部诊断').click()`);
   await until('window.lastDiagnosticQuery.includes("runId=smoke-run")');
   assert.equal(await js('window.lastDiagnosticQuery.includes("device=22222222-2222-4222-8222-222222222222")'),true);
   await js(`document.querySelector('[aria-label="诊断编号"]').value='';document.querySelector('form').requestSubmit()`);
   await until('document.body.textContent.includes("DIAG_ADMIN_TEST")');
   passed=true;
   console.log('PASS Electron preload, offline upload, account/device/root-cause summary and same-run diagnostic query');
  }catch(error){console.error(error);}
  finally{collector.close();win.destroy();app.exit(passed?0:1);}
 }).catch(e=>{console.error(e);app.exit(1);});
 setTimeout(()=>{console.error('smoke timeout');app.exit(1);},25000).unref();
}else{
 const {buildSync}=require(path.join(root,'node_modules/esbuild'));const {spawnSync}=require('node:child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pflow-diag-smoke-'));
 try{
  buildSync({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {RuntimeDiagnostics} from './src/components/RuntimeDiagnostics';import RuntimeDiagnosticsPanel from './src/viewer/RuntimeDiagnosticsPanel';import {openRuntimeDiagnostics} from './src/services/runtimeDiagnostics';
window.fetch=async(url)=>{window.lastDiagnosticQuery=String(url);return{ok:true,json:async()=>({items:[{id:'11111111-1111-4111-8111-111111111111',installationId:'22222222-2222-4222-8222-222222222222',occurredAt:new Date().toISOString(),receivedAt:new Date().toISOString(),appVersion:'0.0.9',platform:'linux',arch:'x64',category:'ai',code:'DIAG_ADMIN_TEST',stage:'execute',account:{status:'signed-in',source:'client-session',userId:'account-smoke',username:'smoke-account',displayName:'Smoke'},device:{hostname:'smoke-computer'},context:{runId:'smoke-run',failure:{reason:'rate-limit',evidence:'native-session-log',logStatus:'matched',tokensRequested:440588},metrics:{totalExecuteMs:60773,acpTurnMs:59855}}}]})}};
createRoot(document.getElementById('root')).render(<><button data-open onClick={openRuntimeDiagnostics}>打开诊断</button><RuntimeDiagnostics/><RuntimeDiagnosticsPanel token="smoke-admin"/></>);window.smokeReady=true;`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'iife',outfile:path.join(dir,'app.js')});
  fs.writeFileSync(path.join(dir,'index.html'),'<html><head><meta charset="UTF-8"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
  const env={...process.env,PFLOW_DIAG_SMOKE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(require(path.join(root,'node_modules/electron')),[__filename],{env,stdio:'inherit',timeout:30000});if(result.status!==0)process.exitCode=1;
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
