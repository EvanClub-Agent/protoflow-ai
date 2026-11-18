// Deterministic Electron check for the real chat + global question portal.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_QUESTION_SMOKE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const window = new BrowserWindow({ show: false, width: 760, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const js = code => window.webContents.executeJavaScript(code);
    const clickCenter = async selector => {
      const hit = await js(`(() => {
        const control = document.querySelector(${JSON.stringify(selector)});
        const box = control.getBoundingClientRect();
        const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        if (!control.contains(target)) return false;
        control.click();
        return true;
      })()`);
      assert.equal(hit, true, `Control is clipped or covered: ${selector}`);
    };
    const waitFor = async code => {
      for (let i = 0; i < 100; i++) {
        if (await js(`Boolean(${code})`)) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out: ${code}`);
    };
    try {
      await window.loadFile(path.join(dir, 'index.html'));
      await waitFor(`document.querySelector('[aria-label="AI 需要你确认"]')`);
      assert.equal(await js(`document.querySelector('[aria-label="本组问题：第 1 题，共 2 题"]').textContent`), '1 / 2');
      assert.equal(await js(`document.querySelector('[aria-label="AI 对话面板"]').contains(document.querySelector('[aria-label="AI 需要你确认"]'))`), true);
      assert.equal(await js(`document.querySelector('[aria-label="AI 需要你确认"] button[type=submit]').disabled`), true);
      await js(`document.querySelector('input[value="多级审批"]').click(); document.querySelector('button[aria-expanded=false]').click()`);
      await waitFor(`document.querySelector('textarea[aria-label="补充说明"]')`);
      await js(`(()=>{const el=document.querySelector('textarea[aria-label="补充说明"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'超过十万元增加财务审批');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      const disclosure = '[aria-label="AI 需要你确认"] button[aria-expanded]';
      await clickCenter(disclosure);
      await waitFor(`!document.querySelector('textarea[aria-label="补充说明"]')`);
      await clickCenter(disclosure);
      await waitFor(`document.querySelector('textarea[aria-label="补充说明"]')?.value === '超过十万元增加财务审批'`);
      const layout = await js(`(()=>{const panel=document.querySelector('[aria-label="AI 对话面板"]').getBoundingClientRect(), card=document.querySelector('[aria-label="AI 需要你确认"]').getBoundingClientRect();return {fits:card.left>=panel.left&&card.right<=panel.right&&card.bottom<=panel.bottom,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      assert.deepEqual(layout, { fits: true, overflow: false });
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await new Promise(resolve => setTimeout(resolve, 80));
      const screenshot = process.env.PFLOW_QUESTION_SCREENSHOT || path.join(os.tmpdir(), 'protoflow-question-card.png');
      fs.writeFileSync(screenshot, (await window.webContents.capturePage()).toPNG());
      await js(`document.querySelector('[aria-label="AI 需要你确认"] button[type=submit]').click()`);
      await waitFor(`window.questionSmoke.answers.length===1 && !document.querySelector('[aria-label="AI 需要你确认"]')`);
      assert.deepEqual(await js('window.questionSmoke.answers'), [{ id: 'scope-1', answer: '多级审批', supplement: '超过十万元增加财务审批' }]);
      assert.match(await js('document.body.innerText'), /我的回答：多级审批；补充说明：超过十万元增加财务审批/);
      await js(`window.questionSmoke.ask('确认以下方案后继续：采购管理下包含采购申请、审批、订单三个页面。',['确认方案，继续','需要调整']);`);
      await waitFor(`document.querySelector('[aria-label="AI 需要你确认"]')`);
      assert.equal(await js(`document.querySelector('[aria-label="AI 需要你确认"] button[type=submit]').disabled`), true);
      assert.equal(await js(`document.querySelector('[aria-label="本组问题：第 2 题，共 2 题"]').textContent`), '2 / 2');
      await js(`Array.from(document.querySelectorAll('[aria-label="AI 需要你确认"] button')).find(b=>b.textContent==='暂不回答').click()`);
      await waitFor('window.questionSmoke.answers.length===2');
      assert.deepEqual(await js('window.questionSmoke.answers[1]'), { id: 'scope-2', answer: null });
      await clickCenter('[aria-label="收起 AI 对话"]');
      await clickCenter('[aria-label="下一页"]');
      assert.equal(await js('window.questionSmoke.page'), 2);
      assert.equal(await js(`document.querySelector('[aria-label="问 AI"]').getAttribute('aria-expanded')`), 'false');

      window.setContentSize(1180, 740);
      window.webContents.setZoomFactor(2);
      await waitFor('innerWidth === 590 && innerHeight === 370');
      await clickCenter('[aria-label="问 AI"]');
      await js('window.questionSmoke.fillDraft()');
      await waitFor(`document.querySelector('[aria-label="移除图片：布局.png"]') && !document.querySelector('[title="发送"]').disabled`);
      await clickCenter('[title="发送"]');
      await waitFor('window.questionSmoke.sent.length === 1');
      assert.deepEqual(await js('window.questionSmoke.sent[0]'), { lines: 10, images: ['布局.png'] });
      console.log(JSON.stringify({ ok: true, screenshot, checks: ['inline portal', 'no default approval', 'collapse and restore supplement', 'answer history', 'next-round plan confirmation', 'batch progress 1/2 to 2/2', 'skip', 'pagination hit target', 'send at 200% zoom'] }));
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-questions-'));
  try {
    const source = `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {FloatingPageChat} from './src/proto/designer/FloatingPageChat';
      import {HermesEngineModal} from './src/components/HermesEngineModal';
      import {useProtoStore} from './src/store/useProtoStore';
      import {useHermesStore} from './src/store/useHermesStore';
      import {useAiChatStore} from './src/store/useAiChatStore';
      import {conversationKey} from './src/services/hermesConversation';
      const scope={projectId:'question-preview',pageId:'purchase'};
      const project=useProtoStore.getState();
      useProtoStore.setState({currentProjectMeta:{...project.currentProjectMeta,projectId:scope.projectId},activePageId:scope.pageId,isProjectClosed:false,viewMode:'single_page'});
      const answers=[]; let number=0;
      window.protoflowDesktop={hermes:{onEvent:()=>()=>{},session:async input=>({...input,sessionId:'preview',running:true,models:{currentModelId:'preview-model',availableModels:[{modelId:'preview-model',name:'预览模型'}]}}),question:async input=>{answers.push(input);useHermesStore.setState({questions:[]});}}};
      useAiChatStore.getState().switchConversation(scope);
      useAiChatStore.getState().setPageChatOpen(true);
      useAiChatStore.getState().addMessage({...scope,role:'user',status:'done',text:'帮我分析采购管理需求，先和我确认业务流程，再生成原型。'});
      useAiChatStore.getState().addMessage({...scope,role:'assistant',status:'done',text:'我先确认审批方式，再根据你的回答整理目录和页面方案。'});
      useHermesStore.setState({status:'running',currentVersion:'AI',runningProjects:{},questions:[],permissions:[],isModalOpen:false,error:null});
      function ask(message,choices){useHermesStore.setState({questions:[{...scope,id:'scope-'+(++number),message,progress:{batchId:'preview-batch',current:number,total:2},answerSchema:{type:'string',enum:choices}}]});}
      const image = {name:'布局.png', mimeType:'image/png', data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTK0AAAAASUVORK5CYII='};
      const size = atob(image.data).length;
      window.protoflowDesktop.hermes.saveImages = async ({projectId,pageId,images}) => images.map(({name,mimeType,data}) => ({
        projectId, pageId, name, mimeType, id:crypto.randomUUID(), size:atob(data).length,
      }));
      const sent = [];
      function fillDraft() {
        useAiChatStore.getState().updatePageDraft(conversationKey(scope), draft => ({
          ...draft, text:Array(10).fill('调整审批条件').join('\\n'), images:[{...image,size,preview:'data:image/png;base64,'+image.data}],
        }));
      }
      window.questionSmoke={answers,ask,page:1,sent,fillDraft};
      createRoot(document.getElementById('root')).render(
        <div style={{height:'100vh',position:'relative',display:'flex',flexDirection:'column',background:'#f8fafc'}}>
          <main style={{position:'relative',padding:36,flex:1,color:'#475569'}}>
            <h1 style={{fontSize:24,fontWeight:600}}>采购管理</h1>
            <button aria-label="下一页" style={{position:'absolute',bottom:12,right:14}} onClick={()=>window.questionSmoke.page++}>下一页</button>
          </main>
          <FloatingPageChat pageId="purchase" pageTitle="采购管理" selectedLabel={null} running={false}
            onSend={(text,images)=>{sent.push({lines:text.split('\\n').length,images:images.map(image=>image.name)});}} onClearSelection={()=>{}}/>
          <HermesEngineModal/>
        </div>
      );
      ask('采购申请需要怎样的审批流程？这会影响审批页面和状态流转。',['一级审批','多级审批','本期不做审批']);
    `;
    const bundle = buildSync({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', write: false, loader: { '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(dir, 'bundle.js'), bundle.outputFiles[0].contents);
    const css = fs.readdirSync(path.join(root, 'dist/assets')).find(name => name.endsWith('.css'));
    fs.copyFileSync(path.join(root, 'dist/assets', css), path.join(dir, 'styles.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><div id="root"></div><script src="bundle.js"></script>');
    const env = { ...process.env, PFLOW_QUESTION_SMOKE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 30000 });
    if (child.status !== 0) throw new Error(child.error?.message || child.stderr || child.stdout);
    console.log(child.stdout.trim());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
