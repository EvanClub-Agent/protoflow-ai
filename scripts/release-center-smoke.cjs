// Isolated UI/API fixture. Never connects to the real release service.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if(process.versions.electron){
  const {app,BrowserWindow}=require('electron');const dir=process.env.PFLOW_RELEASE_UI_SMOKE_DIR;
  app.setPath('userData',path.join(dir,'profile'));
  app.whenReady().then(async()=>{
    app.dock?.hide();const win=new BrowserWindow({show:false,width:1360,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
    const js=code=>win.webContents.executeJavaScript(code);
    const until=async code=>{for(let n=0;n<200;n++){if(await js(`Boolean(${code})`))return;await new Promise(r=>setTimeout(r,25));}throw new Error('Timed out: '+code);};
    const click=async(text,scope='document')=>{
      const button=`Array.from(${scope}.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
      await until(`(${button}) && !(${button}).disabled`);
      return js(`(${button}).click()`);
    };
    const fill=(name,value)=>js(`(()=>{const el=document.querySelector('dialog[open] [name="${name}"]');Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const platform=os=>js(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.startsWith(${JSON.stringify(os)})).click()`);
    const chooseFile=name=>js(`(()=>{const input=document.querySelector('dialog[open] input[type=file]');const dt=new DataTransfer();dt.items.add(new File(['fixture-installer'],${JSON.stringify(name)}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const capture=async name=>{
      if(!process.env.PFLOW_RELEASE_UI_SCREENSHOTS)return;
      await until(`!document.querySelector('.fixed[role=status]')`);
      await js('document.fonts.ready');
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await new Promise(resolve=>setTimeout(resolve,100));
      fs.mkdirSync(process.env.PFLOW_RELEASE_UI_SCREENSHOTS,{recursive:true});
      fs.writeFileSync(path.join(process.env.PFLOW_RELEASE_UI_SCREENSHOTS,name+'.png'),(await win.webContents.capturePage()).toPNG());
    };
    let passed=false;
    // Use a real loopback origin so the production admin transport checks apply.
    const server=require('node:http').createServer((req,res)=>{
      const name=req.url==='/'?'index.html':req.url==='/app.js'?'app.js':req.url==='/style.css'?'style.css':null;
      if(!name){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html');
      res.end(fs.readFileSync(path.join(dir,name)));
    });
    try{
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
      await until(`document.querySelector('[aria-label="版本 0.0.6 详情"]')`);
      assert.equal(await js(`document.querySelector('.rw-detail h2').textContent`),'Alex v0.0.6');
      assert.ok(await js(`document.querySelector('[role=alert]').textContent.includes('0.2.0')`));
      await click('编辑信息');await until('document.querySelector("dialog[open]")');
      await fill('title','移动审批与关联明细修复');await click('保存修改','document.querySelector("dialog[open]")');
      await until(`!document.querySelector('dialog[open]') && !document.querySelector('.rw-warning')`);
      await capture('release-admin-desktop');
      await click('新建版本');await until('document.querySelector("dialog[open]")');
      assert.equal(await js(`document.querySelector('dialog[open] [name=version]').value`),'');
      assert.equal(await js(`document.querySelector('dialog[open] [name=title]').value`),'');
      assert.equal(await js(`document.querySelector('dialog[open] [name=notes]').value`),'');
      await fill('version','0.0.7');await fill('notes','### 改进\n- 分平台补充安装包。');await click('创建草稿','document.querySelector("dialog[open]")');
      await until(`document.querySelector('[aria-label="版本 0.0.7 详情"]')`);
      assert.equal(await js('window.releaseMock.items[0].published'),false);
      assert.equal(await js('window.releaseMock.items[0].title'),'Alex v0.0.7');
      assert.equal(await js(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='发布版本').disabled`),true);
      await platform('Linux');await click('上传安装包');await until('document.querySelector("dialog[open]")');
      await chooseFile('Alex-0.0.6-linux-amd64.deb');await click('开始上传并保存','document.querySelector("dialog[open]")');
      await until(`document.querySelector('dialog[open]').textContent.includes('不一致')`);
      assert.equal(await js('window.releaseMock.uploads.length'),0);
      await chooseFile('Alex-0.0.7-linux-amd64.deb');await js('window.releaseMock.holdUpload=true');
      await click('开始上传并保存','document.querySelector("dialog[open]")');await until('window.releaseMock.releaseUpload');
      assert.equal(await js(`document.querySelector('dialog[open] input[type=file]').disabled`),true);
      assert.equal(await js(`document.querySelector('dialog[open]').dispatchEvent(new Event('cancel',{bubbles:false,cancelable:true}))`),false);
      await js('window.releaseMock.releaseUpload()');await until(`!document.querySelector('dialog[open]')`);
      await click('发布版本');await until('window.releaseMock.items[0].published');
      assert.deepEqual(await js('window.releaseMock.items[0].assets.map(a=>a.os)'),['linux']);
      await until(`document.querySelector('.rw-release-summary').textContent.includes('当前可下载：Linux')`);
      await platform('macOS');await click('上传安装包');await until('document.querySelector("dialog[open]")');
      await chooseFile('Alex-0.0.7-mac-arm64.dmg');await js('window.releaseMock.failUpload=true');
      await click('开始上传并保存','document.querySelector("dialog[open]")');
      await until(`document.querySelector('dialog[open] [role=alert]')?.textContent.includes('模拟上传失败')`);
      assert.deepEqual(await js('window.releaseMock.items[0].assets.map(a=>a.os)'),['linux']);
      assert.equal(await js(`document.querySelector('dialog[open] input[type=file]').files[0].name`),'Alex-0.0.7-mac-arm64.dmg');
      await click('开始上传并保存','document.querySelector("dialog[open]")');await until(`!document.querySelector('dialog[open]')`);
      assert.deepEqual(await js('window.releaseMock.items[0].assets.map(a=>a.os)'),['linux','macos']);
      assert.equal(await js('window.releaseMock.items[0].published'),true);
      assert.equal(await js('window.releaseMock.items[0].assets[1].releaseId'),'created-007');
      await until(`document.querySelector('.rw-release-summary').textContent.includes('macOS、Linux')`);
      await capture('release-admin-supplemented');
      // Public users see real version identity, platform availability and downloads.
      await js('window.releaseMock.setAdmin(false)');await until(`document.querySelector('[aria-label="版本下载工作区"]')`);
      assert.equal(await js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='编辑信息'||b.textContent==='新建版本')`),false);
      await platform('macOS');await until(`document.querySelector('a[download="Alex-0.0.7-mac-arm64.dmg"]')`);
      await capture('release-public-desktop');
      await platform('Windows');assert.ok(await js(`document.querySelector('[role=tabpanel]').textContent.includes('暂未提供 Windows')`));
      assert.equal(await js(`document.querySelectorAll('[role=tabpanel] a[download]').length`),0);
      win.setSize(390,844);await until('innerWidth===390');
      await capture('release-public-mobile');
      assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'), 'mobile layout must not overflow');
      assert.ok(await js(`Array.from(document.querySelector('body header').querySelectorAll('button,span')).filter(el=>el.getClientRects().length && !el.closest('[role=tooltip]')).every(el=>el.getBoundingClientRect().bottom<=document.querySelector('body header').getBoundingClientRect().bottom)`), 'mobile header content must fit inside its row');
      await js(`document.documentElement.dataset.theme='dark'`);await capture('release-public-dark-mobile');
      assert.deepEqual(errors,[]);
      console.log('PASS real Chromium: canonical version, draft creation, Linux-only publication, macOS supplement, upload mismatch/failure/lock, public downloads and mobile layout');passed=true;
    }catch(e){console.error(e);console.error(errors);console.error(await js('document.body.innerText'));}
    finally{server.close();win.destroy();app.exit(passed?0:1);}
  });
  setTimeout(()=>app.exit(1),50000).unref();
}else{
  const {buildSync}=require('esbuild');const {spawnSync}=require('node:child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pflow-release-ui-'));
  try{
    buildSync({stdin:{contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ReleaseCenterView} from './src/viewer/ReleaseCenterView';import {releaseFixture,releaseAsset} from './tests/fixtures/releases';
sessionStorage.setItem('protoflow_platform_admin_token','fixture-admin');
const mock=window.releaseMock={items:releaseFixture(),uploads:[],holdUpload:false,failUpload:false,releaseUpload:null};
window.fetch=async(input,options={})=>{
 const url=String(input);const method=options.method||'GET';let data;
 if(url==='/api/v1/admin/status')data={initialized:true};
 else if(url==='/api/v1/admin/me')data={admin:{id:'fixture-admin',username:'demo',displayName:'版本管理员'}};
 else if(url==='/api/v1/releases'&&method==='GET')data={items:mock.items,signingPublicKey:'fixture-public-key'};
 else if(url.startsWith('/api/v1/updates?'))data={items:mock.items.filter(r=>r.published)};
 else if(url==='/api/v1/releases'&&method==='POST'){const body=JSON.parse(options.body);data={...body,id:'created-007',assets:[],createdAt:'2026-11-13T11:00:00+08:00',updatedAt:'2026-11-13T11:00:00+08:00',publishedAt:'2026-11-13T11:00:00+08:00'};mock.items.unshift(data);}
 else if(url.startsWith('/api/v1/releases/')&&method==='PUT'){const id=url.split('/')[4];const release=mock.items.find(r=>r.id===id);if(!release)throw new Error('Unknown release ID');Object.assign(release,JSON.parse(options.body));data=release;}
 else throw new Error('Unexpected fixture request: '+method+' '+url);
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
window.XMLHttpRequest=class{
 upload={};status=0;responseText='';open(method,url){this.url=url;}setRequestHeader(){}
 send(form){const id=this.url.split('/')[4];mock.uploads.push({id,os:form.get('os'),fileName:form.get('fileName')});
  const finish=()=>{if(mock.failUpload){mock.failUpload=false;this.status=500;this.responseText=JSON.stringify({error:'模拟上传失败，请重试'});}
   else{const release=mock.items.find(r=>r.id===id);if(!release)throw new Error('Unknown upload target');const asset={...releaseAsset(id,form.get('os'),release.version),fileName:form.get('fileName'),arch:form.get('arch'),packageType:form.get('packageType')};release.assets.push(asset);this.status=200;this.responseText=JSON.stringify(asset);}this.onload();};
  if(mock.holdUpload){mock.holdUpload=false;mock.releaseUpload=finish;}else setTimeout(finish,30);
 }
};
function App(){const [admin,setAdmin]=useState(true);mock.setAdmin=setAdmin;return <ReleaseCenterView isAdminRoute={admin} onNavigateRoute={setAdmin}/>;}
createRoot(document.getElementById('root')).render(<App/>);
`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'iife',outfile:path.join(dir,'app.js'),define:{'process.env.NODE_ENV':'"production"'}});
    const css=fs.readdirSync(path.join(root,'dist-viewer/assets')).find(n=>n.endsWith('.css'));
    fs.copyFileSync(path.join(root,'dist-viewer/assets',css),path.join(dir,'style.css'));
    fs.writeFileSync(path.join(dir,'index.html'),'<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
    const env={...process.env,PFLOW_RELEASE_UI_SMOKE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
    const result=spawnSync(require('electron'),[__filename],{env,encoding:'utf8',timeout:55000});
    if(result.status!==0)throw new Error(result.error?.message||result.stderr||result.stdout);console.log(result.stdout.trim());
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
