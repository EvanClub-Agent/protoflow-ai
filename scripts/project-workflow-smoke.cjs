const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if(process.versions.electron){
 const {app,BrowserWindow}=require('electron'); const dir=process.env.PFLOW_WORKSPACE_SMOKE_DIR;
 app.setPath('userData',path.join(dir,'profile'));
 app.whenReady().then(async()=>{app.dock?.hide();const window=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 const js=code=>window.webContents.executeJavaScript(code);
 const wait=async code=>{for(let i=0;i<150;i++){if(await js(`Boolean(${code})`))return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out: '+code);};
 try{
 await window.loadFile(path.join(dir,'index.html')); await wait(`document.querySelector('[aria-label="项目需求"]')`);
 const attach = async (mode, name = '参考布局.png') => {
   await js(`(async () => {
     const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 96;
     const brush = canvas.getContext('2d'); brush.fillStyle='#fff'; brush.fillRect(0,0,160,96);
     brush.fillStyle=${JSON.stringify(name)}==='参考布局.png'?'#2663a3':'#317769'; brush.fillRect(0,0,160,16);
     brush.fillStyle='#dde5ee'; brush.fillRect(0,16,32,80);
     for (let y=24; y<90; y+=16) brush.fillRect(42,y,104,8);
     const blob = await new Promise(done => canvas.toBlob(done, 'image/png'));
     const transfer = new DataTransfer(); transfer.items.add(new File([blob], ${JSON.stringify(name)}, {type:'image/png'}));
     if (${JSON.stringify(mode)} === 'pick') {
       const input = document.querySelector('[aria-label="选择项目参考图片"]');
       input.files = transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
     } else if (${JSON.stringify(mode)} === 'paste') {
       document.querySelector('[aria-label="项目需求"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
     } else document.querySelector('form').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
   })()`);
   await wait(`document.querySelector('[aria-label="移除图片：${name}"]')`);
 };
 for (const mode of ['pick','drop']) {
   await attach(mode);
   assert.equal(await js('document.querySelector("form button[type=submit]").disabled'),false);
   await js(`document.querySelector('[aria-label="移除图片：参考布局.png"]').click()`);
 }
 await attach('paste');
 await attach('pick','参考样式.png');
 const clickButton = (label, selector='button') => js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
 await clickButton('选择脑图');
 const picker='dialog[aria-label="选择项目脑图"][open]';
 await wait(`document.querySelector('${picker}')`);
 for(const path of ['业务范围 / 采购','采购']) await js(`Array.from(document.querySelectorAll('${picker} label')).find(el=>el.textContent===${JSON.stringify(path)}).querySelector('input').click()`);
 await clickButton('使用所选脑图',picker+' button');
 assert.equal(await js(`document.querySelectorAll('[aria-label="待发送脑图"] li').length`),2);

 await js(`(()=>{let e=document.querySelector('[aria-label="项目需求"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'帮我规划采购申请和审批两个页面');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await js(`document.querySelector('form button[type=submit]').click()`);
 await wait(`document.querySelector('[aria-label="AI 追问快捷气泡"]')`);
 const card = '[aria-label="AI 追问快捷气泡"]';
 const questionButton = label => `Array.from(document.querySelectorAll('${card} button')).find(b=>b.textContent===${JSON.stringify(label)})`;
 const progress = `document.querySelector('[aria-label="当前题号"]')?.textContent`;
 await wait(progress + " === '1/3'");
 await js(questionButton('右侧抽屉')+'.click()');
 assert.equal(await js(`Boolean(${questionButton('提交所选回答')})`), false);
 await js(questionButton('下一题')+'.click()');
 await wait(progress + " === '2/3'");
 assert.equal(await js(questionButton('下一题')+'.disabled'), true);
 await wait(`document.querySelectorAll('[aria-label="本条消息的脑图"] img').length >= 4`);
 const clipMaps = await js(`(async()=>{const el=document.querySelector('[aria-label="本条消息的脑图"]').parentElement;el.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(r));const {x,y,width,height}=el.getBoundingClientRect();return {x:Math.floor(x),y:Math.floor(y),width:Math.ceil(width),height:Math.ceil(height)};})()`);
 fs.writeFileSync(path.join(os.tmpdir(),'protoflow-mixed-chat-attachments.png'), (await window.webContents.capturePage(clipMaps)).toPNG());
 // Reopen an old-version transcript that had submitted just answer 1.
 await js('window.workflowSmoke.legacyPartialReply()');
 await js('location.reload()');
 const recover = "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='继续回答上组问题')";
 await wait(recover);
 const historyImage = '[aria-label="查看图片：参考布局.png"]';
 await wait(`document.querySelector('${historyImage}:not(:disabled)')`);
 await js(`document.querySelector('${historyImage}').click()`);
 await wait(`document.querySelector('dialog[aria-label="图片预览：参考布局.png"][open] img')`);
 await js(`document.querySelector('[aria-label="关闭图片预览"]').click()`);
 // The saved message must render both original diagrams, even after a rename or deletion.
 const mapButton = '[aria-label="预览脑图：业务范围 / 采购"]', goneButton = '[aria-label="预览脑图：采购"]';
 await wait(`document.querySelector('${mapButton} img')?.naturalWidth > 0 && document.querySelector('${goneButton} img')?.naturalWidth > 0`);
 await js(`document.querySelector('${mapButton}').click()`);
 const snapshot = 'dialog[aria-label="脑图快照：业务范围 / 采购"][open]';
 await wait(`document.querySelector('${snapshot} img')?.naturalWidth > 0`);
 assert.match(await js(`fetch(document.querySelector('${snapshot} img').src).then(r=>r.text())`), /限额登记/);
 await js(`document.querySelector('${snapshot} [aria-label="放大脑图"]').click()`);
 assert.equal(await js(`document.querySelector('${snapshot}').innerText.includes('150%')`),true);
 await js(`document.querySelector('${snapshot} [aria-label="关闭脑图预览"]').click()`);
 assert.equal(await js(`document.querySelector('[aria-label="前往脑图：采购"]').disabled`),true);
 assert.match(await js(`fetch(document.querySelector('${goneButton} img').src).then(r=>r.text())`), /汇总审批/);
 const draftText = value => js(`(()=>{const input=document.querySelector('[aria-label="项目需求"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await draftText('继续讨论这张脑图');
 await clickButton('选择脑图');
 await js(`Array.from(document.querySelectorAll('${picker} label')).find(el=>el.textContent==='业务范围 / 新版采购').querySelector('input').click()`);
 await clickButton('使用所选脑图',picker+' button');
 await js(`document.querySelector('[aria-label="前往脑图：业务范围 / 采购"]').click()`);
 await wait(`document.querySelector('textarea[aria-label="脑图源码"]')?.value.includes('最新限额规则')`);
 await clickButton('返回项目会话');
 await wait(recover);
 assert.equal(await js(`document.querySelector('[aria-label="项目需求"]').value`),'继续讨论这张脑图');
 await js(`document.querySelector('[aria-label="移除脑图：业务范围 / 新版采购"]').click()`);
 await draftText('');
 await js(recover+'.click()');
 await wait(progress + " === '2/3'");
 await js(questionButton('上一题')+'.click()');
 assert.equal(await js(questionButton('右侧抽屉')+".getAttribute('aria-pressed')"), 'true');
 await js(questionButton('下一题')+'.click()');
 const custom = '[aria-label="其他选项说明"]';
 await js(`(()=>{const e=document.querySelector('${custom}');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'由采购主管审核');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await js(`document.querySelector('${custom}').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
 await wait(progress + " === '3/3'");
 assert.equal(await js(questionButton('提交所选回答')+'.disabled'), true);
 await js(questionButton('按标段录入')+'.click()');
 await js(questionButton('提交所选回答')+'.click()');
 await wait(`document.querySelector('[aria-label="项目方案确认"]')`);
 const planCard = '[aria-label="项目方案确认"]';
 assert.equal(await js(`document.querySelector('${planCard}').innerText.includes('采购管理 / 审批中心')`), true);
 await js(`Array.from(document.querySelectorAll('${planCard} summary')).find(e=>e.textContent.includes('审批中心')).click()`);
 assert.equal(await js(`document.querySelector('${planCard}').innerText.includes('展示待审批内容和审批操作区域。')`),true);
 await js(`Array.from(document.querySelectorAll('${planCard} button')).find(b=>b.textContent==='提出修改').click()`);
 assert.equal(await js(`document.activeElement.getAttribute('aria-label')`),'项目需求');
 await attach('pick');
 assert.equal(await js(`Array.from(document.querySelectorAll('${planCard} button')).find(b=>b.textContent==='确认方案并生成').disabled`),true);
 await js(`document.querySelector('[aria-label="移除图片：参考布局.png"]').click()`);
 await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 const clip = await js(`(()=>{const {x,y,width,height}=document.querySelector('${planCard}').getBoundingClientRect();return {x:Math.floor(x),y:Math.floor(y),width:Math.ceil(width),height:Math.ceil(height)};})()`);
 fs.writeFileSync(path.join(os.tmpdir(),'protoflow-plan-confirmation.png'), (await window.webContents.capturePage(clip)).toPNG());
 assert.equal(await js('Object.keys(window.workflowSmoke.sources()).length'),0);
 await js(`Array.from(document.querySelectorAll('[aria-label="项目方案确认"] button')).find(b=>b.textContent==='确认方案并生成').click()`);
 await wait(`document.body.innerText.includes('模拟网络中断') && !window.workflowSmoke.running()`);
 assert.deepEqual(await js('window.workflowSmoke.completed()'),['requests']);
 await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='继续生成剩余页面').click()`);
 await wait(`window.workflowSmoke.completed().length===2 && !window.workflowSmoke.running()`);
 assert.deepEqual(await js('window.workflowSmoke.calls'),['requests','reviews','reviews']);
 assert.equal(await js(`document.body.innerText.includes('已生成 2 / 2 页')`),true);
 await js(`(()=>{let e=document.querySelector('[aria-label="项目需求"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'把审批工作台移入独立的档案目录');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await js(`document.querySelector('form button[type=submit]').click()`);
 await wait(`document.querySelector('[aria-label="本次修改"]') && !window.workflowSmoke.running()`);
 assert.equal(await js('window.workflowSmoke.folder()'),'approval');
 assert.equal(await js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='原方案已暂停'&&b.disabled)`),true);
 await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='应用这些修改').click()`);
 await wait(`window.workflowSmoke.folder()==='archive' && !window.workflowSmoke.running()`);
 await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='撤销本次修改').click()`);
 await wait(`window.workflowSmoke.folder()==='approval'`);
 await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 const screenshot=path.join(os.tmpdir(),'protoflow-project-workflow.png');fs.writeFileSync(screenshot,(await window.webContents.capturePage()).toPNG());
 const button = (label, selector = 'header button') => js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
 const history = 'dialog[aria-label="项目历史会话"][open]';
 const confirm = 'dialog[aria-labelledby="delete-confirmation-title"][open]';
 const rows = `document.querySelectorAll('${history} li')`;
 const title = '帮我规划采购申请和审批两个页面';
 await button('新建会话');
 await wait(`!document.body.innerText.includes('${title}')`);
 assert.deepEqual(await js('window.workflowSmoke.completed()'), ['requests','reviews']);
 await button('历史会话');
 await wait(rows+'.length === 2');
 await js(`Array.from(${rows}).find(li=>li.textContent.includes('${title}')).querySelector('button').click()`);
 await wait(`!document.querySelector('${history}') && document.body.innerText.includes('${title}')`);
 await button('历史会话');
 const trash = () => js(`document.querySelector('[aria-label="删除会话「新会话」"]').click()`);
 await trash();
 await button('取消', confirm+' button');
 assert.equal(await js(rows+'.length'),2);
 await trash();
 await button('删除会话', confirm+' button');
 await wait(`document.querySelector('${confirm} [role=alert]')?.textContent.includes('暂时无法删除')`);
 assert.equal(await js(rows+'.length'),2);
 await button('删除会话', confirm+' button');
 await wait(rows+'.length === 1');
 await js(`document.querySelector('${history} [aria-label="关闭历史会话"]').click()`);
 assert.equal(await js(`document.body.innerText.includes('${title}')`),true);
 assert.deepEqual(await js('window.workflowSmoke.completed()'), ['requests','reviews']);
 await draftText('加入会员档案菜单和数据表');
 await js(`document.querySelector('form button[type=submit]').click()`);
 const mixedCard = '[aria-label="本次修改"]';
 await wait(`document.querySelector('${mixedCard}')?.innerText.includes('确认项目方案和修改') && !window.workflowSmoke.running()`);
 assert.equal(await js('Object.hasOwn(window.workflowSmoke.sources(),"page-member")'),false);
 assert.equal(await js('window.workflowSmoke.tables().length'),0);
 await js(`Array.from(document.querySelectorAll('${mixedCard} summary')).find(el=>el.textContent==='查看每个页面要做什么').click()`);
 assert.match(await js(`document.querySelector('${mixedCard} dl').innerText`), /按手机号查询会员卡/);
 await clickButton('确认方案并生成',mixedCard+' button');
 await wait(`window.workflowSmoke.completed().includes('page-member') && !window.workflowSmoke.running()`);
 assert.deepEqual(await js('window.workflowSmoke.tables()[0].sharedByMenus.map(binding=>binding.pageId)'), ['page-member']);
 assert.deepEqual(await js('window.workflowSmoke.calls'), ['requests','reviews','reviews','page-member']);
 // Connection loss, failed automatic reconnect, and retry from the actual composer.
 await js(`(() => {
   const api = window.protoflowDesktop.hermes;
   const environment = { binary: '/smoke/hermes', home: '/smoke/profile', version: 'test', detected: true };
   let sends = 0, reconnects = 0;
   api.connect = async input => {
     if (input.home !== environment.home || input.binary !== environment.binary) throw Error('重连环境错误');
     if (++reconnects === 1) throw Error('模拟重连失败');
     return environment;
   };
   api.execute = async input => {
     if (++sends === 1) {
       window.workflowSmoke.emit({type:'session-update', projectId:input.projectId, kind:input.kind,
         threadId:input.threadId, sessionId:'s', update:{sessionUpdate:'plan', entries:[
           {content:'读取已有页面',status:'completed'}, {content:'检查页面交互',status:'in_progress'}
         ]}});
       await new Promise(resolve => { window.workflowSmoke.disconnect = resolve; });
       window.workflowSmoke.emit({type: 'disconnected', reason: 'connection-lost'});
       throw Error('Hermes 连接意外中断');
     }
     return { text: '原会话重试成功', operations: [], sessionId: 's', runId: 'retry', modelId: 'test' };
   };
   window.workflowSmoke.attempts = () => [sends, reconnects];
 })()`);
 await draftText('继续任务');
 const send = 'form button[type=submit]';
 await js(`document.querySelector('${send}').click()`);
 await wait(`document.body.innerText.includes('任务步骤 1/2 · 检查页面交互')`);
 await js('window.workflowSmoke.disconnect()');
 await wait(`document.querySelector('[role=alert]')?.textContent.includes('模拟重连失败') && !window.workflowSmoke.running()`);
 assert.equal(await js(`document.querySelector('[aria-label="项目需求"]').value`), '继续任务');
 const underPointer = selector => js(`(() => {
   const element = document.querySelector(${JSON.stringify(selector)}), rect = element.getBoundingClientRect();
   return element.contains(document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2));
 })()`);
 assert.equal(await underPointer('[aria-label="项目需求"]'), true);
 assert.equal(await underPointer(send), true);
 await clickButton('重新连接 Hermes', 'form button');
 await wait(`!document.querySelector('${send}').disabled`);
 assert.deepEqual(await js('window.workflowSmoke.attempts()'), [1, 2]);
 await js(`document.querySelector('${send}').click()`);
 await wait(`document.body.innerText.includes('原会话重试成功') && !window.workflowSmoke.running()`);
 assert.deepEqual(await js('window.workflowSmoke.attempts()'), [2, 2]);
 // Guarded model confirmation must sit above the model picker's native modal.
 await js(`(() => {
   const api = window.protoflowDesktop.hermes, originalSession = api.session;
   let current = 'test', pending;
   api.session = async scope => ({...await originalSession(scope), models:{currentModelId:current,
     availableModels:[{modelId:'test',name:'测试模型'},{modelId:'guarded',name:'需确认的模型'}]}});
   api.setModel = input => new Promise((resolve,reject) => {
     pending = {input,resolve,reject};
     window.workflowSmoke.emit({type:'permission', projectId:input.projectId, kind:input.kind, threadId:input.threadId,
       id:'model-confirm', toolCall:{title:'确认切换模型', content:[{type:'content',content:{type:'text',text:'目标模型的上下文较小，请确认后切换。'}}]},
       options:[{optionId:'allow_once',name:'仍然切换',kind:'allow_once'},{optionId:'deny',name:'取消切换',kind:'reject_once'}]});
   });
   api.permission = async ({id, optionId}) => {
     if(id!=='model-confirm') throw Error('授权 ID 不匹配');
     window.workflowSmoke.emit({type:'permission-resolved',id});
     if(optionId==='allow_once') { current=pending.input.modelId; pending.resolve(await api.session(pending.input)); }
     else pending.reject(Error('已取消切换模型'));
   };
 })()`);
 await js(`document.querySelector('form [aria-label="刷新模型"]').click()`);
 await wait(`!document.querySelector('form [aria-label="选择对话模型"]').disabled`);
 await js(`document.querySelector('form [aria-label="选择对话模型"]').click()`);
 const modelPicker = 'dialog[aria-modal=true]:not([aria-label="Hermes 操作授权"])';
 const approval = 'dialog[aria-label="Hermes 操作授权"][open]';
 await wait(`document.querySelector('${modelPicker} input[value=guarded]')`);
 await js(`document.querySelector('${modelPicker} input[value=guarded]').click()`);
 for (const action of ['取消切换', '仍然切换']) {
   await clickButton('切换模型', modelPicker+' button');
   await wait(`document.querySelector('${approval}')`);
   assert.equal(await underPointer(approval+' button'), true);
   assert.match(await js(`document.querySelector('${approval}').innerText`), /目标模型的上下文较小/);
   await clickButton(action, approval+' button');
   await wait(`!document.querySelector('${approval}')`);
   if(action==='取消切换') {
     await wait(`document.querySelector('${modelPicker} [role=alert]')?.textContent.includes('已取消切换模型')`);
     assert.match(await js(`document.querySelector('form [aria-label="选择对话模型"]').textContent`), /测试模型/);
   }
 }
 await wait(`!document.querySelector('${modelPicker}[open]')`);
 assert.match(await js(`document.querySelector('form [aria-label="选择对话模型"]').textContent`), /需确认的模型/);
 await js(`Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('项目资料与上下文')).click()`);
 await js(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='刷新用量').click()`);
 await wait(`document.body.textContent.includes('上下文 60%')`);
 await js(`(()=>{const e=document.querySelector('[aria-label="检索当前会话历史"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'抽屉');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await js(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='检索').click()`);
 await wait(`document.querySelector('[aria-label="历史检索结果"]')?.textContent.includes('压缩前约定')`);
 await js(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='整理上下文').click()`);
 await wait(`document.body.textContent.includes('上下文已整理')`);
 assert.equal(await js(`document.body.textContent.includes('已压缩 1 次')`),true);
 assert.equal(await js(`document.querySelector('[aria-label="本轮资料范围"]').options.length>1`),true);
 assert.equal(await underPointer('[aria-label="本轮资料范围"]'),true);
 await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 fs.writeFileSync(path.join(os.tmpdir(),'protoflow-project-context.png'),(await window.webContents.capturePage()).toPNG());
 await js(`Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('项目资料与上下文')).click()`);
 console.log(JSON.stringify({ok:true,screenshot,checks:['scoped context selector, native usage, compression and archived-history panel','guarded model confirmation above native picker, cancel and retry','connection recovery, draft retention, composer hit-testing and same-chat retry','two selected diagrams, two images and text in one turn','snapshot thumbnails and zoom after reload','open edited original; deleted original still previews','file picker, paste and drop','restore and preview chat image after reload','review folder paths and page requirements','empty-project chat','three questions, selection and custom answer','resume partial legacy answer after reload','replace draft and confirm final plan','explicit plan confirmation','nested directories','page failure and resume','completion progress','review and apply mixed operations','undo menu move','new chat','switch to original chat','cancel and retry history deletion','project pages retained','single confirmation for new menu with schema and continued generation']}));app.exit(0);
 }catch(e){console.error(e);app.exit(1);}});
}else{
 const {buildSync}=require('esbuild'),{spawnSync}=require('node:child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pflow-workspace-smoke-'));
 try{
 const source=`import {ProjectMindmapView} from './src/components/ProjectMindmapView';import {useAiChatStore} from './src/store/useAiChatStore';import React from 'react';import {createRoot} from 'react-dom/client';import {ProjectAiView} from './src/components/ProjectAiView';import {HermesEngineModal} from './src/components/HermesEngineModal';import {useProtoStore} from './src/store/useProtoStore';import {usePageStore} from './src/proto/store/usePageStore';import {useHermesStore} from './src/store/useHermesStore';import {useProjectWorkflow,projectPlanProgress} from './src/services/projectWorkflow';import {createProjectPayload,loadProjectFromBinaryPayload} from './src/services/projectStorage';
 const id='workspace-smoke',p=createProjectPayload({projectId:id,projectName:'采购管理',templateId:'blank_project',storageDir:'/tmp',fileName:'smoke.pflow',createdAt:'2026-11-02',updatedAt:'2026-11-02',pageCount:0,tableCount:0,stickyCount:0});loadProjectFromBinaryPayload(p);useProtoStore.setState({viewMode:'project_ai'});
 const oldMap={kind:'mindmap',id:'quota-map',parentId:'maps-folder',title:'采购',source:'mindmap\\n  root((限额登记))\\n    年度限额'};
 const summaryMap={kind:'mindmap',id:'summary-map',parentId:null,title:'采购',source:'flowchart LR\\n A[汇总审批] --> B[完成]'};
 const mapsEdited=localStorage.getItem('test-edited-maps')==='true';
 useProtoStore.setState({mindmaps:{links:[],nodes:[
   {kind:'folder',id:'maps-folder',parentId:null,title:'业务范围'},
   mapsEdited?{...oldMap,title:'新版采购',source:'mindmap\\n  root((最新限额规则))'}:oldMap,
   ...(mapsEdited?[]:[summaryMap]),
   {kind:'mindmap',id:'ignored',parentId:null,title:'未选范围',source:'mindmap\\n  root((未选业务))'}
 ]}});
 const plan={summary:'采购员发起申请，审批员处理审批。两个页面共用采购流程，先确认结构后生成。',folders:[{id:'procurement',title:'采购管理',parentFolderId:null},{id:'approval',title:'审批中心',parentFolderId:'procurement'}],pages:[{pageId:'requests',title:'采购申请',folderId:'procurement',requirements:'显示采购申请表单与操作区域。'},{pageId:'reviews',title:'审批工作台',folderId:'approval',requirements:'展示待审批内容和审批操作区域。'}]};const calls=[];let fail=true,failDelete=true;
 window.protoflowDesktop={hermes:{saveImages:async ({images,...owner})=>images.map(file=>{
   const {data,name,mimeType}=file; const ref={...owner,id:crypto.randomUUID(),name,mimeType,size:atob(data).length};
   localStorage.setItem('test-image:'+ref.id, JSON.stringify({...ref,data})); return ref;
 }),readImage:async ref=>JSON.parse(localStorage.getItem('test-image:'+ref.id)),deleteProjectChat:async scope=>{if(scope.projectId!==id||scope.kind!=='project'||!scope.threadId)throw Error('会话归属错误');if(failDelete){failDelete=false;throw Error('暂时无法删除');}return {deleted:true};},onEvent:listener=>{window.workflowSmoke.emit=listener;return ()=>{};},context:async input=>{
   if(input.sessionId!=='s'||input.projectId!==id)throw Error('上下文会话归属错误');
   if(input.action==='history')return {sessionId:'s',total:1,matches:[{messageId:42,role:'user',text:'压缩前约定：新增使用抽屉',truncated:false}],nextOffset:null};
   const usage={used:input.action==='compress'?1200:6000,size:10000,compressions:input.action==='compress'?1:0,estimated:false};
   window.workflowSmoke.emit({type:'context-update',...input,context:usage});
   return {sessionId:'s',usage,status:input.action==='compress'?'compressed':undefined};
 },session:async scope=>({...scope,sessionId:'s',running:false,projectTools:['protoflow_get_project_brief','protoflow_search_history','protoflow_upsert_project_agreement','protoflow_ask_questions','protoflow_revise_project_page','protoflow_set_project_plan','protoflow_apply_tsx_patch','protoflow_move_sitemap_item'],models:{currentModelId:'test',availableModels:[{modelId:'test',name:'测试模型'}]}}),sync:async()=>({synced:true}),execute:async input=>{let operations=[];if(input.workflowPhase==='conversation'&&input.prompt.endsWith('帮我规划采购申请和审批两个页面')){
   if(input.images?.length!==2 || input.images[0].kind!=='project' || input.images[0].name!=='参考布局.png' || input.images[1].name!=='参考样式.png') throw Error('模型没有收到项目图片');
   if(![oldMap,summaryMap].every(m=>input.prompt.includes(JSON.stringify(m.source))) || input.prompt.includes('未选业务'))throw Error('收到的脑图与选择不符');
   operations=[{tool:'protoflow_ask_questions',args:{questions:[{question:'采用哪种审批入口？',options:['右侧抽屉','居中弹框']},{question:'谁审核计划？',options:['部门主管','采购部']},{question:'如何录入结果？',options:['按标段录入','按整单录入']}]}}];}else if(input.workflowPhase==='conversation'&&input.prompt.includes('把审批工作台移入独立的档案目录')){operations=[{tool:'protoflow_upsert_folder',args:{folder:{id:'archive',title:'档案',parentFolderId:null}}},{tool:'protoflow_move_sitemap_item',args:{target:{kind:'page',id:'reviews'},parentFolderId:'archive'}}];}else if(input.workflowPhase==='conversation'&&input.prompt.endsWith('加入会员档案菜单和数据表')){
   const member={pageId:'page-member',title:'会员档案',folderId:'procurement',requirements:'按手机号查询会员卡'};
   operations=[{tool:'protoflow_set_project_plan',args:{plan:{...plan,pages:[...plan.pages,member]}}},{tool:'protoflow_upsert_db_table',args:{table:{id:'t_mem_member',tableName:'mem_member',cnName:'会员表',domain:'基础资料域 (MDM)',description:'',modeling:{entity:'会员卡',grain:'每行一张卡',reason:'开卡登记与会员档案查询共用卡记录'}, columns:[{id:'member-card-number',name:'card_no',dataType:'VARCHAR(32)',nullable:false,isPrimaryKey:true,comment:'卡号'}],sharedByMenus:[{pageId:member.pageId,menuTitle:member.title,accessMode:'READ 查询',fieldMappingNote:'查询会员'}]}}}];
 }else if(input.workflowPhase==='conversation'){const expected=['1. 针对「采用哪种审批入口？」：右侧抽屉','2. 针对「谁审核计划？」：其他说明：由采购主管审核','3. 针对「如何录入结果？」：按标段录入'];if(!input.prompt.endsWith(expected.join(String.fromCharCode(10))))throw Error('三题答案未完整传回');operations=[{tool:'protoflow_set_project_plan',args:{plan:{...plan,pages:[plan.pages[0]]}}},{tool:'protoflow_set_project_plan',args:{plan}}];}else{calls.push(input.targetPageId);if(input.targetPageId==='reviews'&&fail){fail=false;throw Error('模拟网络中断，已完成页面保留');}operations=[{tool:'protoflow_apply_tsx_patch',args:{pageId:input.targetPageId,source:'export default function Page(){return <Page pfId="root"><Card pfId="card" title="已生成的页面"/></Page>}' }}];}return {text:input.workflowPhase==='conversation'?'方案已整理，请确认右侧目录和页面职责。':'当前页面已生成，继续下一页。',operations,sessionId:'s',runId:'r',modelId:'test'};}}};useHermesStore.setState({status:'running',binaryPath:'/smoke/hermes',hermesHomePath:'/smoke/profile',sessions:{},runningProjects:{},partial:{},cancelGeneration:{}});window.workflowSmoke={calls,legacyPartialReply:()=>{
   localStorage.setItem('test-edited-maps','true');
   const add=useAiChatStore.getState().addMessage;
   add({projectId:id,kind:'project',role:'user',status:'done',text:'1. 针对「采用哪种审批入口？」：右侧抽屉'});
   add({projectId:id,kind:'project',role:'assistant',status:'error',text:'本轮提交了多个相互覆盖的项目方案'});
 },tables:()=>useProtoStore.getState().dbTables,folder:()=>usePageStore.getState().designerPages.find(p=>p.pageId==='reviews')?.folderId,sources:()=>usePageStore.getState().pageSources,completed:projectPlanProgress,running:()=>useProjectWorkflow.getState().running[id]};
 function Workspace(){const mode=useProtoStore(s=>s.viewMode);return mode==='mindmap'?<><button onClick={()=>useProtoStore.getState().setViewMode('project_ai')}>返回项目会话</button><ProjectMindmapView projectId={id}/></>:<ProjectAiView projectId={id}/>;}
 createRoot(document.getElementById('root')).render(<div className="flex h-screen flex-col"><main className="min-h-0 flex-1"><Workspace/></main><HermesEngineModal inlineFeedback/></div>);`;
 buildSync({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',format:'esm',splitting:true,outdir:dir,entryNames:'bundle',loader:{'.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
 const css=fs.readdirSync(path.join(root,'dist/assets')).find(n=>n.endsWith('.css'));fs.copyFileSync(path.join(root,'dist/assets',css),path.join(dir,'styles.css'));fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><div id="root" style="height:100vh"></div><script type="module" src="bundle.js"></script>');
 const env={...process.env,PFLOW_WORKSPACE_SMOKE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;const child=spawnSync(require('electron'),[__filename],{env,encoding:'utf8',timeout:30000});if(child.status!==0)throw Error(child.error?.message||child.stderr||child.stdout);console.log(child.stdout.trim());
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
