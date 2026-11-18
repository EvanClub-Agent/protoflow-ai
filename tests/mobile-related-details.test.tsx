import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {expenseFixture,expenseTables,expenseRows,expenseMobileSource,expenseDetailSource} from './fixtures/mobile-expense-details';
import {rowsForSource,sourceForeignKeyErrors} from '../src/proto/table/model';
import {loadProjectFromBinaryPayload} from '../src/services/projectStorage';
import {useProtoStore} from '../src/store/useProtoStore';
import {usePageStore} from '../src/proto/store/usePageStore';
import {parsePageSource} from '../src/proto/dsl/parser';
import {findNode} from '../src/proto/dsl/tree';
import {NodeView,ScopeProvider} from '../src/proto/renderer/NodeView';
import {RuntimeProvider,useRuntimeController,type Runtime,type Scope} from '../src/proto/runtime/runtime';
import {PreviewDataContext} from '../src/proto/runtime/PreviewData';
import {pageContractErrors} from '../src/proto/ai/pageContract';
import {getMaterialContracts} from '../src/proto/registry/materialSchemas';
import {getImplementationGuide} from '../src/proto/ai/implementationGuide';
import {buildMaterialGenerationRules} from '../src/proto/ai/materialInstructions';
import {projectContext,prepareProjectChanges} from '../src/services/hermesProject';
import {createPublishedSnapshot} from '../src/services/createPublishedSnapshot';
import {normalizePublishedSnapshot} from '../src/services/publishedSnapshot';
const {callTool,atomicWrite}=require(path.join(process.cwd(),'electron/protoflow-mcp.cjs'));
const content=(node:TestRenderer.ReactTestInstance):string=>node.children.map(child=>typeof child==='object'?content(child):String(child)).join('');

test('related details use the declared physical source key, preserve 0/type, and never broaden a missing or mismatched source',()=>{
  const rows=[...expenseRows['expense-lines'],{id:'string-zero',expense_no:'0',title:'错误类型',checked:false}];
  assert.deepEqual(rowsForSource(rows,'expense_no','expense-lines',{tableId:'expenses',row:expenseRows.expenses[0]},expenseTables).map(r=>r.id),['line-A1','line-A2']);
  for(const scope of [{},{tableId:'wrong-table',row:expenseRows.expenses[0]},{tableId:'expenses',row:{id:'runtime-A'}},{tableId:'expenses',row:{id:'runtime-A',expense_no:''}}])
    assert.deepEqual(rowsForSource(rows,'expense_no','expense-lines',scope,expenseTables),[]);
  assert.deepEqual(rowsForSource(rows,'expense-reference','expense-lines',{tableId:'expenses',row:expenseRows.expenses[0]},expenseTables),[],'column ID cannot replace physical field name');
  assert.ok(sourceForeignKeyErrors({table:'expense-lines',sourceForeignKey:'expense-reference'},expenseTables).length);
});

test('mobile related detail properties are discoverable and both native and host gates reject invalid bindings',()=>{
  const native=require(path.join(process.cwd(),'electron/generated/material-contract.cjs'));
  for(const type of ['MTaskList','MFeedList'] as const){
    const source=expenseMobileSource(expenseDetailSource(type));
    assert.ok(getMaterialContracts().find(c=>c.name===type)?.props.some(p=>p.name==='sourceForeignKey'&&p.valueSchema.type==='string'));
    assert.deepEqual(pageContractErrors(source,expenseTables),[]);assert.deepEqual(native.pageContractErrors(source,expenseTables),[]);
    for(const bad of [source.replace('sourceForeignKey="expense_no"','sourceForeignKey="expense-reference"'),source.replace('sourceForeignKey="expense_no"','sourceForeignKey="title"'),source.replace('table="expense-lines"',''),source.replace('sourceForeignKey="expense_no"','sourceForeignKey=""')]){
      assert.ok(pageContractErrors(bad,expenseTables).some(e=>e.includes('sourceForeignKey')));
      assert.ok(native.pageContractErrors(bad,expenseTables).some((e:string)=>e.includes('sourceForeignKey')));
    }
  }
  assert.match(JSON.stringify(getImplementationGuide(['mobile'])),/sourceForeignKey/);
  assert.match(buildMaterialGenerationRules('mobile'),/不沿用旧会话/);
});

for(const type of ['MTaskList','MFeedList'] as const)test(`${type} isolates direct rows, navigation and staged preview data, including empty and conflicting scopes`,async()=>{
  loadProjectFromBinaryPayload(expenseFixture());
  const doc=parsePageSource(expenseMobileSource(expenseDetailSource(type))).doc!;
  const detail=findNode(doc.root,'expense-detail')!;let rt!:Runtime;
  type Preview=React.ContextType<typeof PreviewDataContext>;
  function Harness({scope={},preview=null}:{scope?:Scope;preview?:Preview}){
    rt=useRuntimeController(doc,'oa-m-approvals',false);
    return <PreviewDataContext.Provider value={preview}><RuntimeProvider value={rt}><ScopeProvider value={scope}><NodeView node={detail} live/></ScopeProvider></RuntimeProvider></PreviewDataContext.Provider>;
  }
  let ui!:TestRenderer.ReactTestRenderer;
  const texts=()=>content(ui.root);
  const check=(present:string[],absent:string[])=>{for(const text of present)assert.ok(texts().includes(text),text);for(const text of absent)assert.ok(!texts().includes(text),text);};
  try{
    await act(async()=>{ui=TestRenderer.create(<Harness scope={{row:expenseRows.expenses[0],tableId:'expenses'}}/>);});
    check(['甲单交通费','甲单住宿费'],['乙单餐费']);
    await act(async()=>{ui.update(<Harness scope={{row:expenseRows.expenses[1],tableId:'expenses'}}/>);});
    check(['乙单餐费'],['甲单交通费','甲单住宿费']);
    await act(async()=>{ui.update(<Harness scope={{params:{row:expenseRows.expenses[0],tableId:'expenses'}}}/>);});
    check(['甲单交通费'],['乙单餐费']);
    // Ordinary filters only narrow the already isolated rows; they cannot replace the source key.
    await act(async()=>{rt.setFilter('expense-detail',{expense_no:1});});
    check([],['甲单交通费','甲单住宿费','乙单餐费']);
    await act(async()=>{rt.setFilter('expense-detail',{});useProtoStore.getState().setActivePage('oa-m-approvals',{tableId:'expenses',rowId:'runtime-B'});ui.update(<Harness/>);});
    check(['乙单餐费'],['甲单交通费']);
    await act(async()=>{ui.update(<Harness scope={{row:expenseRows.expenses[0],tableId:'wrong-table'}}/>);});
    check([],['甲单交通费','乙单餐费']);
    await act(async()=>{ui.update(<Harness preview={{tables:expenseTables,rows:{expenses:[],'expense-lines':expenseRows['expense-lines']}}}/>);});
    check([],['甲单交通费','乙单餐费']);
    await act(async()=>{ui.update(<Harness preview={{tables:expenseTables,rows:{expenses:[{id:'runtime-B',expense_no:99,title:'暂存主单'}],'expense-lines':[{id:'staged-line',expense_no:99,title:'暂存明细'}]}}}/>);});
    check(['暂存明细'],['甲单交通费','乙单餐费']);
    await act(async()=>{ui.update(<Harness/>);useProtoStore.getState().setActivePage('oa-m-approvals');});
    check([],['甲单交通费','乙单餐费']);
    await act(async()=>{useProtoStore.getState().setActivePage('other-page',{tableId:'expenses',rowId:'runtime-A'});});
    check([],['甲单交通费','乙单餐费']);
  }finally{await act(async()=>ui?.unmount());}
});

test('mobile expense failure is reproduced in real MCP readiness, then repaired by one page patch without rebuilding tables or records',()=>{
  const base=expenseFixture();loadProjectFromBinaryPayload(base);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mobile-expense-details-'));const file=path.join(dir,'context.json');
  try{
    const snapshot=projectContext();
    atomicWrite(file,{active:true,kind:'project',projectId:base.meta.projectId,threadId:'expense-thread',runId:'expense-run',sessionId:'expense-session',workflowPhase:'generating',targetPageId:'oa-m-approvals',snapshot,baseline:structuredClone(snapshot),operations:[]});
    callTool(file,'protoflow_get_project_brief',{});
    const before=callTool(file,'protoflow_inspect_page',{pageId:'oa-m-approvals'});
    assert.equal(before.acceptanceReady,false);
    assert.ok(before.pendingAcceptanceIssues.some((s:string)=>s==='oa-m-approvals ← oa-pc-expenses · 查看当前报销明细（待绑定引用表）'));
    const patch={tool:'protoflow_apply_tsx_patch',args:{pageId:'oa-m-approvals',source:expenseMobileSource()}};
    const staged=callTool(file,patch.tool,patch.args);assert.equal(staged.acceptanceReady,true);assert.deepEqual(staged.pendingAcceptanceIssues,[]);
    assert.equal(callTool(file,'protoflow_inspect_page',{pageId:'oa-m-approvals'}).acceptanceReady,true);
    const prepared=prepareProjectChanges(base,[patch]);
    assert.deepEqual(prepared.changedPages,['oa-m-approvals']);assert.deepEqual(prepared.next.stateSnapshot.dbTables,base.stateSnapshot.dbTables);
    assert.deepEqual(prepared.next.stateSnapshot.tableRows,base.stateSnapshot.tableRows);
    assert.equal(prepared.next.stateSnapshot.pageSources['oa-pc-expenses'],base.stateSnapshot.pageSources['oa-pc-expenses']);
    loadProjectFromBinaryPayload(prepared.next);
    const published=createPublishedSnapshot('oa-m-approvals');
    assert.deepEqual(normalizePublishedSnapshot(published).tableRows,base.stateSnapshot.tableRows);
    const invalid=structuredClone(published);
    findNode(invalid.pages.find(p=>p.pageId==='oa-m-approvals')!.doc.root,'expense-detail')!.props.sourceForeignKey='expense-reference';
    assert.throws(()=>normalizePublishedSnapshot(invalid),/移动列表.*sourceForeignKey/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
