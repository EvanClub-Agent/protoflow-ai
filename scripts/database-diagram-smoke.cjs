const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_DB_SMOKE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const win = new BrowserWindow({ show:false, width:1600, height:1000, webPreferences:{contextIsolation:true,nodeIntegration:false} });
    const errors=[];
    win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
    const js=code=>win.webContents.executeJavaScript(code);
    const settle=()=>js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const click=async text=>{await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);await settle();};
    const measure=()=>js(`(()=>{
      const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
      return {canvas:rect(document.querySelector('[data-db-canvas]')),cards:[...document.querySelectorAll('[data-db-table]')].map(el=>({...rect(el),id:el.dataset.dbTable})),areas:[...document.querySelectorAll('[data-db-domain]')].map(rect),toolbar:rect(document.querySelector('[data-db-toolbar]'))};
    })()`);
    function check(m){
      assert.equal(m.cards.length,7);
      for(const [i,a]of m.cards.entries()){
        assert.ok(a.x>=m.canvas.x-1 && a.y>=m.canvas.y-1 && a.right<=m.canvas.right+1 && a.bottom<=m.canvas.bottom+1,`card outside viewport ${JSON.stringify(m)}`);
        for(const b of m.cards.slice(i+1))assert.ok(a.right<=b.x || b.right<=a.x || a.bottom<=b.y || b.bottom<=a.y,`overlap ${a.id}/${b.id}`);
        assert.ok(m.areas.some(d=>a.x>=d.x && a.y>=d.y && a.right<=d.right+1 && a.bottom<=d.bottom+1),'domain encloses card');
      }
    }
    try {
      await win.loadFile(path.join(dir,'index.html'));
      for(let i=0;i<100&&!await js('Boolean(window.diagramSmoke && document.querySelector("[data-db-table]"))');i++)await new Promise(r=>setTimeout(r,20));
      await settle();check(await measure());
      assert.equal(await js('document.querySelectorAll("[data-db-relation]").length'),3);
      if(process.env.PFLOW_DB_SCREENSHOT)fs.writeFileSync(process.env.PFLOW_DB_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
      for(const mode of ['全部字段','仅表名','主外键']){
        await click(mode);check(await measure());
        // SVG endpoints and actual rendered field/header centers must agree after transforms.
        const differences=await js(`(()=>{
          const rels=window.diagramSmoke.relations();const errors=[];
          for(const relation of rels){
            const g=[...document.querySelectorAll('[data-db-relation]')].find(e=>e.dataset.dbRelation===relation.id);
            const dots=g.querySelectorAll('circle');
            for(const [index,id,field] of [[0,relation.fromTableId,relation.fromColumnName],[1,relation.toTableId,relation.toColumnName]]){
              const card=[...document.querySelectorAll('[data-db-table]')].find(e=>e.dataset.dbTable===id);
              const row=[...card.querySelectorAll('[data-db-field]')].find(e=>e.dataset.dbField===field);
              const anchor=(row||card.firstElementChild).getBoundingClientRect();const dot=dots[index].getBoundingClientRect();
              errors.push(Math.abs((anchor.y+anchor.height/2)-(dot.y+dot.height/2)));
            }
          }return errors;
        })()`);
        assert.ok(differences.every(n=>n<1.5),`disconnected anchors in ${mode}: ${differences}`);
      }
      // Drag a card at the current scale, then recover via automatic layout.
      await js(`(()=>{const el=document.querySelector('[data-db-table]');const r=el.firstElementChild.getBoundingClientRect();const c=document.querySelector('[data-db-canvas]');el.firstElementChild.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.x+40,clientY:r.y+10}));c.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.x+140,clientY:r.y+60}));c.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));})()`);
      await settle();await click('自动排布');check(await measure());
      await click('编辑表结构');assert.ok(await js('Boolean(document.querySelector("input[title=直接修改物理表名]"))'));
      await click('展开编辑区');assert.equal(await js('document.querySelectorAll("[data-db-canvas]").length'),0);
      await click('返回分栏');await click('收起编辑区');check(await measure());
      await js('window.diagramSmoke.removeReferencedColumn()');await settle();
      assert.equal(await js('document.querySelectorAll("[data-db-relation]").length'),2);
      await js("Array.from(document.querySelectorAll('summary')).find(s => s.textContent.includes('数据库设计审查')).click()");
      assert.ok(await js('document.querySelector("details[open]").innerText.includes("t_mdm_supplier(id) 无法解析")'));
      await js('document.querySelector("details[open] summary").click()');
      await js('window.diagramSmoke.restore()');await settle();
      win.setSize(1040,800);await settle();await click('适应');check(await measure());
      const hidden=await js(`(()=>{const toolbar=document.querySelector('[data-db-toolbar]').getBoundingClientRect();return [...document.querySelectorAll('[data-db-toolbar] button')].some(b=>b.getBoundingClientRect().right>toolbar.right+1)})()`);
      assert.equal(hidden,false,'toolbar actions wrap instead of disappearing');
      await js('window.diagramSmoke.empty()');await settle();assert.ok(await js('document.body.textContent.includes("还没有数据表")'));
      await click('建表');
      await js(`(()=>{const c=document.querySelector('[data-db-canvas]'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.x+80,clientY:r.y+120}));c.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));})()`);await settle();
      assert.equal(await js('document.querySelectorAll("[data-db-table]").length'),1);
      assert.deepEqual(errors,[]);
      console.log('PASS Chromium: 7 tables, 3 real relationships, all display modes, exact anchors, dragging/auto layout, inspector, missing reference, responsive toolbar, empty project and new table');app.exit(0);
    } catch(e){console.error(e);console.error(errors);app.exit(1);}
  });
  setTimeout(()=>app.exit(1),30000).unref();
} else {
  const {buildSync}=require('esbuild');const {spawnSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'protoflow-db-diagram-'));
  try {
    const code=`
import React from 'react';import {createRoot} from 'react-dom/client';import {DatabaseDesignerView} from './src/components/DatabaseDesignerView';import {LeftSitemapTree} from './src/components/LeftSitemapTree';import {useProtoStore} from './src/store/useProtoStore';import {diagramRelations} from './src/components/databaseDiagram';
const names=['supplier','purchase_return','purchase_return_item','po_delivery_line','annual_plan','annual_plan_item','statement_line'];
const labels=['供应商主表','采购退货单主表','采购退货单明细表','采购订单发货明细表','耗材年度计划申报主表','耗材年度计划申报明细表','入库退货对账流水表'];
const counts=[20,15,11,21,13,19,19];
const tables=names.map((name,i)=>({id:'entity-'+i,tableName:'t_'+(i===0?'mdm_':'srm_')+name,cnName:labels[i],domain:i===0?'基础资料域 (MDM)':'采购管理域 (SRM)',description:'',sharedByMenus:[],columns:Array.from({length:counts[i]},(_,j)=>({id:'column-'+i+'-'+j,name:j===0?'id':j===1?'parent_id':'field_'+j,dataType:'VARCHAR(32)',nullable:j!==0,isPrimaryKey:j===0,comment:''}))}));
tables[1].columns[1]={...tables[1].columns[1],isForeignKey:true,references:tables[0].tableName+'(id)'};tables[2].columns[1]={...tables[2].columns[1],isForeignKey:true,references:tables[1].tableName+'(id)'};tables[5].columns[1]={...tables[5].columns[1],isForeignKey:true,references:tables[4].tableName+'(id)'};
const restore=()=>useProtoStore.setState({dbTables:structuredClone(tables),selectedTableId:'entity-1',leftSidebarTab:'tables',viewMode:'db_designer'});restore();
window.diagramSmoke={restore,relations:()=>diagramRelations(useProtoStore.getState().dbTables).relations,removeReferencedColumn:()=>useProtoStore.getState().deleteColumnFromTable('entity-0','column-0-0'),empty:()=>useProtoStore.setState({dbTables:[],selectedTableId:''})};
createRoot(document.getElementById('frame')).render(<><LeftSitemapTree/><DatabaseDesignerView/></>);`;
    const bundle=buildSync({stdin:{contents:code,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,define:{'process.env.NODE_ENV':'"production"'}});
    fs.writeFileSync(path.join(dir,'bundle.js'),bundle.outputFiles[0].contents);
    const css=fs.readdirSync(path.join(root,'dist/assets')).find(n=>n.endsWith('.css'));
    fs.copyFileSync(path.join(root,'dist/assets',css),path.join(dir,'styles.css'));
    fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><html data-theme="light"><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div id="frame" style="height:100vh;width:100vw;display:flex;background:white"></div><script src="./bundle.js"></script>');
    const env={...process.env,PFLOW_DB_SMOKE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawnSync(require('electron'),[__filename],{env,encoding:'utf8',timeout:35000});
    if(child.status!==0)throw new Error(child.error?.message||child.stderr||child.stdout);console.log(child.stdout.trim());
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
