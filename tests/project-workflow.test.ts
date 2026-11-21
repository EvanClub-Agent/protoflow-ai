import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ProjectAiView } from '../src/components/ProjectAiView';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useHermesStore } from '../src/store/useHermesStore';
import { useAiChatStore } from '../src/store/useAiChatStore';
import { createProjectPayload, loadProjectFromBinaryPayload, captureProjectPayload } from '../src/services/projectStorage';
import { encodePflowBinary, decodePflowBinary, generateUnpackedGitFiles } from '../src/utils/pflowBinaryCodec';
import { discussProject, generateProject, projectPlanProgress, resolveProjectReview, resumePriorPlan } from '../src/services/projectWorkflow';
import { conversationKey } from '../src/services/hermesConversation';
import { chatStorageKey, projectChatScope, readProjectChatIndex } from '../src/services/projectChatHistory';
import { applyProjectChanges, prepareProjectChanges, canUndoProjectChange, projectContext, projectRevision, undoProjectChange } from '../src/services/hermesProject';
import { failureNeedsArchiveRestart, type ProjectPlan } from '../src/services/projectPlan';
const { callTool, atomicWrite } = require(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
const { HermesRuntime, conversationKey: nativeKey } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));
const plan: ProjectPlan = { summary: '建立采购系统，申请与审批独立页面。', folders: [{ id: 'procurement', title: '采购管理', parentFolderId: null }, { id: 'approvals', title: '审批', parentFolderId: 'procurement' }], pages: [{ pageId: 'requests', title: '采购申请', folderId: 'procurement', requirements: '展示采购申请表单' }, { pageId: 'reviews', title: '审批工作台', folderId: 'approvals', requirements: '显示审批内容' }], approved: false, generatedPageIds: [] };
const source = (title: string) => `export default function Page(){return <Page pfId="root" title="${title}"><Card pfId="card" title="${title}"/></Page>}`;
function fixture(projectId = 'workflow') {
  const p = createProjectPayload({ projectId, projectName: '采购', templateId: 'blank_project', storageDir: '/tmp', fileName: projectId + '.pflow', createdAt: '2026-11-02', updatedAt: '2026-11-02', pageCount: 0, tableCount: 0, stickyCount: 0 });
  loadProjectFromBinaryPayload(p); useProtoStore.getState().setViewMode('project_ai');
  useAiChatStore.setState({ conversation: null, messages: [], byConversation: {}, storageErrors: {} });
  useAiChatStore.getState().switchConversation({ projectId, kind: 'project' });
  useHermesStore.setState({ status: 'running', sessions: {}, runningProjects: {}, cancelGeneration: {}, partial: {} });
  return { projectId, kind: 'project' as const };
}
const registeredTools = require(path.join(process.cwd(),'electron/protoflow-mcp.cjs')).tools.map((t: {name:string}) => t.name);
function transport(execute: (input: any) => Promise<any>, projectTools: string[] | undefined = registeredTools) {
  const listeners = new Set<(event: any) => void>();
  (window as any).protoflowDesktop = { hermes: {
    onEvent: (fn: (event: any) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    session: async (scope: any) => ({ ...scope, sessionId: 's', running: false, projectTools, models: { currentModelId: 'm', availableModels: [] } }),
    sync: async () => ({ synced: true }),
    execute: async (input: any) => {
      const execSessionId = input.workflowPhase === 'generating' && input.targetPageId ? `s-exec-${input.targetPageId}` : 's';
      const taskKey = input.workflowPhase === 'generating' && input.targetPageId
        ? JSON.stringify([input.projectId, 'project-page-exec', input.threadId ?? null, input.targetPageId])
        : conversationKey(input);
      const baseEvt = {
        projectId: input.projectId,
        kind: input.kind,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        sessionId: execSessionId,
        planningSessionId: 's',
        execSessionId,
        taskKey,
        ...(input.targetPageId ? { targetPageId: input.targetPageId } : {}),
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      };
      let finalRunId = 'r';
      listeners.forEach(fn => fn({ type: 'run-start', ...baseEvt, runId: finalRunId }));
      try {
        const res = await execute(input);
        finalRunId = res?.runId ?? 'r';
        return {
          ...res,
          sessionId: execSessionId,
          planningSessionId: 's',
          execSessionId,
          taskKey,
          ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
          runId: finalRunId,
        };
      } finally {
        listeners.forEach(fn => fn({ type: 'run-end', ...baseEvt, runId: finalRunId }));
      }
    },
    cancel: async () => {},
  } };
}
const response = (operations: any[], text = '已处理') => ({ text, operations, sessionId: 's', runId: 'r', modelId: 'm' });

const memberPlan = {
  summary:'开卡后可以在会员档案查询卡信息。', folders:[{id:'folder-members', title:'会员管理', parentFolderId:null}],
  pages:[
    {pageId:'page-member', title:'会员档案', folderId:'folder-members', requirements:'按手机号查询会员卡'},
    {pageId:'page-issue', title:'开卡办理', folderId:'folder-members', requirements:'登记并办理新会员卡'},
  ],
};
const memberTable = {id:'t_mem_member', tableName:'mem_member', cnName:'会员档案表', domain:'基础资料域 (MDM)', description:'会员卡登记', modeling:{entity:'会员卡',grain:'每行一张卡',reason:'开卡登记与会员档案查询共用卡记录'}, columns:[{id:'member-card-number',name:'card_no',dataType:'VARCHAR(32)',nullable:false,isPrimaryKey:true,comment:'卡号'}],
  sharedByMenus:memberPlan.pages.map(page => ({pageId:page.pageId, menuTitle:page.title, accessMode:'CRUD 读写', fieldMappingNote:'开卡和查询'}))};
const memberDraft = {tool:'protoflow_set_project_plan', args:{plan:memberPlan}};
const memberSchema = {tool:'protoflow_upsert_db_table', args:{table:memberTable}};

test('a mindmap proposal with cross-menu table bindings survives review/reload; confirmation starts generation only for unfinished pages', async () => {
  const scope = fixture('mindmap-members');
  useProtoStore.setState({mindmaps:{nodes:[{id:'card-flow',kind:'mindmap',parentId:null,title:'会员卡',source:'flowchart LR\n A[开卡办理] --> B[会员档案]'}], links:[]}});
  const existingPatch = {tool:'protoflow_apply_tsx_patch', args:{pageId:'page-issue', title:'开卡办理', folderId:'folder-members', source:source('暂存的开卡原型')}};
  let generated = 0;
  transport(async input => {
    if (input.workflowPhase === 'conversation') {
      assert.ok(input.prompt.includes('card-flow'));
      return response([memberSchema, memberDraft, existingPatch]);
    }
    generated++;
    assert.equal(input.targetPageId, 'page-member');
    assert.deepEqual(input.snapshot.projectPlan.generatedPageIds, ['page-issue']);
    assert.deepEqual(input.snapshot.dbTables[0].sharedByMenus, memberTable.sharedByMenus);
    return response([{tool:'protoflow_apply_tsx_patch',args:{pageId:input.targetPageId,source:source('会员档案')}}]);
  });
  const send = () => discussProject(scope.projectId,'根据流程图设计原型', [], ['card-flow']);
  const last = () => useAiChatStore.getState().messages.at(-1)!;
  await send();
  assert.ok(last().projectChangeReview?.items.some(item => item.includes('会员档案、开卡办理')));
  assert.deepEqual(useProtoStore.getState().dbTables, []);
  assert.deepEqual(usePageStore.getState().pageSources, {});
  await resolveProjectReview(scope.projectId, last().id, false);
  assert.equal(useProtoStore.getState().projectPlan, null);
  assert.equal(generated, 0);
  await send();
  useAiChatStore.setState({byConversation:{},messages:[],conversation:null});
  useAiChatStore.getState().switchConversation(scope);
  assert.ok(last().projectChangeReview);
  await resolveProjectReview(scope.projectId, last().id, true);
  assert.equal(generated, 1);
  assert.deepEqual(projectPlanProgress(), ['page-member','page-issue']);
  const saved = decodePflowBinary(encodePflowBinary(captureProjectPayload())).stateSnapshot;
  assert.equal(saved.dbTables.length, 1);
  assert.deepEqual(saved.designerPages.map(p => p.pageId), ['page-member','page-issue']);
  assert.match(saved.pageSources['page-issue'], /暂存的开卡原型/);
  assert.deepEqual(saved.dbTables[0].sharedByMenus, memberTable.sharedByMenus);
});

test('native staging reports unresolved references on either call order and cannot use folders, overlays or superseded pages as menu owners', async () => {
  const scope = fixture('invalid-member-binding');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'member-bindings-')), file = path.join(dir,'context.json');
  try {
    atomicWrite(file,{...scope,active:true,runId:'r',workflowPhase:'conversation',snapshot:projectContext(),operations:[]});
    assert.throws(() => callTool(file,memberSchema.tool,memberSchema.args), /先用 protoflow_get_project/);
    callTool(file,'protoflow_get_project',{});
    const staged = callTool(file,memberSchema.tool,memberSchema.args);
    assert.deepEqual(staged.pendingMenuBindings.map((b:{pageId:string}) => b.pageId), ['page-member','page-issue']);
    assert.equal(callTool(file,memberDraft.tool,memberDraft.args).pendingMenuBindings, undefined);
    const replaced = {...memberPlan, pages:memberPlan.pages.slice(1)};
    assert.deepEqual(callTool(file,memberDraft.tool,{plan:replaced}).pendingMenuBindings, [{tableId:'t_mem_member',pageId:'page-member'}]);
    transport(async () => response(JSON.parse(fs.readFileSync(file,'utf8')).operations));
    await assert.rejects(discussProject(scope.projectId,'去掉会员档案菜单'), /sharedByMenus.*未知页面 page-member/);
    // Correct the final proposal in the same native turn; no project writes or retyping the graph.
    assert.equal(callTool(file,memberDraft.tool,memberDraft.args).pendingMenuBindings, undefined);
    const generating = projectContext();
    atomicWrite(file,{...scope,active:true,runId:'gen',workflowPhase:'generating',targetPageId:'page-issue',
      snapshot:{...generating,projectPlan:{...memberPlan,approved:true,generatedPageIds:[]},
        designerFolders:memberPlan.folders, designerPages:[memberPlan.pages[1]], pageSources:{'page-issue':source('开卡办理')}},operations:[]});
    callTool(file,'protoflow_get_project',{});
    const before = fs.readFileSync(file,'utf8');
    assert.throws(() => callTool(file,memberSchema.tool,memberSchema.args), /不存在的菜单.*page-member/);
    assert.equal(fs.readFileSync(file,'utf8'), before);
    for (const wrong of ['folder-members','modal-member','page-typo']) {
      const invalid = {...memberTable, sharedByMenus:[{...memberTable.sharedByMenus[0], pageId:wrong}]};
      transport(async () => response([memberDraft,{tool:memberSchema.tool,args:{table:invalid}}]));
      await assert.rejects(discussProject(scope.projectId,'校验菜单关联'), new RegExp('未知页面 '+wrong));
    }
    assert.deepEqual(usePageStore.getState().designerFolders, []);
    assert.deepEqual(usePageStore.getState().designerPages, []);
    assert.deepEqual(useProtoStore.getState().dbTables, []);
    assert.equal(useProtoStore.getState().projectPlan, null);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('mindmap-only requests use the selected documents and reject missing, empty or folder selections before asking the model', async () => {
  const scope = fixture('selected-maps');
  const maps = [
    {id:'flow', parentId:null, kind:'mindmap' as const, title:'审批', source:'flowchart LR\n A[申请] --> B[复核]'},
    {id:'tree', parentId:null, kind:'mindmap' as const, title:'年度限额', source:'mindmap\n  年度限额\n    分类额度'},
  ];
  useProtoStore.setState({mindmaps: {nodes:[...maps,
    {id:'folder', kind:'folder', parentId:null, title:'资料'},
    {id:'empty', kind:'mindmap', parentId:null, title:'新脑图', source:''}], links:[]}});
  let calls = 0;
  transport(async input => {
    calls++;
    for (const map of maps) assert.ok(input.prompt.includes(JSON.stringify(map.source)));
    assert.ok(input.prompt.includes('给出生成方案'));
    assert.deepEqual(input.snapshot.requirementSources.map((source:any)=>source.text), [maps[1].source, maps[0].source]);
    return response([{tool:'protoflow_set_project_plan',args:{plan}}]);
  });
  for (const [invalid, reason] of [['folder', /不存在/], ['empty', /空脑图/], ['unknown', /不存在/]] as const) {
    await assert.rejects(discussProject(scope.projectId, '', [], ['flow',invalid]), reason);
  }
  assert.equal(calls, 0);
  assert.equal(useAiChatStore.getState().messages.length, 0);
  await discussProject(scope.projectId, '', [], ['tree','flow']);
  useProtoStore.setState({mindmaps:{nodes:[],links:[]}});
  useAiChatStore.setState({conversation:null, byConversation:{}, messages:[]});
  useAiChatStore.getState().switchConversation(scope);
  const sent = useAiChatStore.getState().messages[0];
  assert.deepEqual(sent.mindmaps?.map(m => [m.mindmapId,m.source]), [[maps[1].id,maps[1].source],[maps[0].id,maps[0].source]]);
  assert.deepEqual(useProtoStore.getState().projectPlan?.pages, plan.pages);
  assert.equal(useProtoStore.getState().projectPlan?.approved, false);
});

test('late replies stay in their own project chat; legacy history and selection survive reopen and deletion', async () => {
  const original = fixture('thread-switch'), { projectId } = original;
  const store = useAiChatStore.getState;
  const reset = () => useAiChatStore.setState({ projectIndexes:{}, byConversation:{}, storageErrors:{}, messages:[], conversation:null });
  window.localStorage.setItem(chatStorageKey(original), JSON.stringify([{
    ...original, id:'old-message', text:'旧版的采购需求', time:'10:00', role:'user', status:'done',
  }]));
  reset();
  store().switchConversation(original);
  assert.equal(store().loadProjectIndex(projectId).entries[0].title, '旧版的采购需求');
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  transport(async input => {
    assert.equal(input.threadId, undefined);
    started();
    await blocked;
    return response([], '这是原会话的回复');
  });
  const firstTurn = discussProject(projectId, '请继续分析');
  await ready;
  store().newProjectChat(projectId);
  const id = store().loadProjectIndex(projectId).activeId;
  assert.ok(id);
  const second = projectChatScope(projectId, id);
  release();
  await firstTurn;
  assert.deepEqual(store().messages, []);
  transport(async input => {
    assert.equal(input.threadId, id);
    return response([], '新会话的回复');
  });
  await discussProject(projectId, '独立的库存需求');
  reset();
  assert.equal(store().loadProjectIndex(projectId).activeId, id);
  store().switchConversation(second);
  assert.deepEqual(store().messages.map(m => m.text), ['独立的库存需求', '新会话的回复']);
  store().selectProjectChat(projectId, null);
  assert.deepEqual(store().messages.map(m => m.text), ['旧版的采购需求', '请继续分析', '这是原会话的回复']);
  assert.equal(store().loadProjectIndex('different-project').entries.length, 1);
  assert.throws(() => store().selectProjectChat('different-project', id), /已删除/);
  store().forgetProjectChat(projectId, null);
  assert.equal(readProjectChatIndex(projectId).activeId, id);
  assert.equal(window.localStorage.getItem(chatStorageKey(original)), null);
  assert.equal(store().messages.at(-1)?.text, '新会话的回复');
  store().forgetProjectChat(projectId, id);
  reset();
  const remaining = store().loadProjectIndex(projectId);
  assert.equal(remaining.entries.length, 1);
  assert.ok(remaining.activeId && remaining.activeId !== id);
  assert.throws(() => store().switchConversation(original), /已删除/);
  assert.throws(() => store().addMessage({...second, role:'assistant', status:'done', text:'过期回调'}), /已删除/);
});

test('empty-project discussion creates a proposal, confirmed generation makes nested menus and resumes only the failed page after reopening', async () => {
  const scope = fixture(); const executed: string[] = []; let fail = true;
  transport(async input => {
    assert.equal(input.kind, 'project'); assert.equal(input.pageId, undefined);
    if (input.workflowPhase === 'conversation') return response([{ tool: 'protoflow_set_project_plan', args: { plan } }]);
    assert.equal(input.snapshot.projectPlan.approved, true);
    executed.push(input.targetPageId);
    if (input.targetPageId === 'reviews' && !fail) assert.match(input.prompt,/上次此页未提交.*模拟第二页失败/);
    if (input.targetPageId === 'reviews' && fail) throw new Error('模拟第二页失败');
    return response([{ tool: 'protoflow_apply_tsx_patch', args: { pageId: input.targetPageId, source: source(input.targetPageId) } }]);
  });
  await discussProject(scope.projectId, '分析采购需求');
  assert.equal(useProtoStore.getState().projectPlan?.approved, false);
  assert.equal(usePageStore.getState().designerFolders.length, 0);
  assert.deepEqual(Object.keys(usePageStore.getState().pageSources), []);
  await assert.rejects(generateProject(scope.projectId), /第二页失败/);
  assert.deepEqual(projectPlanProgress(), ['requests']);
  assert.equal(usePageStore.getState().designerFolders.find(f => f.id === 'approvals')?.parentFolderId, 'procurement');
  const firstSource = usePageStore.getState().pageSources.requests;
  const saved = encodePflowBinary(captureProjectPayload());
  fixture('other'); loadProjectFromBinaryPayload(decodePflowBinary(saved));
  assert.equal(useProtoStore.getState().projectPlan?.lastGenerationFailure?.pageId,'reviews');
  fail = false; await discussProject(scope.projectId,'继续任务');
  assert.equal(useProtoStore.getState().projectPlan?.lastGenerationFailure,undefined);
  assert.deepEqual(executed, ['requests', 'reviews', 'reviews']);
  assert.deepEqual(projectPlanProgress(), ['requests', 'reviews']);
  assert.equal(usePageStore.getState().pageSources.requests, firstSource);
  assert.equal(useProtoStore.getState().activePageId, 'requests'); // First actual page selected; no fake project page ID.
});

test('a missing previously generated page is regenerated instead of treating its new shell as completed', async () => {
  const scope = fixture('missing-generated');
  useProtoStore.setState({ projectPlan: { ...structuredClone(plan), approved: true, generatedPageIds: ['requests', 'reviews'] } });
  const executed: string[] = [];
  transport(async input => { executed.push(input.targetPageId); return response([{ tool: 'protoflow_apply_tsx_patch', args: { pageId: input.targetPageId, source: source(input.targetPageId) } }]); });
  await generateProject(scope.projectId);
  assert.deepEqual(executed, ['requests', 'reviews']);
  assert.deepEqual(projectPlanProgress(), ['requests', 'reviews']);
});

test('project generation retains one background lease across pages until final host validation and save settle', async () => {
  const scope = fixture('background-batch');
  useProtoStore.setState({ projectPlan: { ...structuredClone(plan), approved: true, generatedPageIds: [] } });
  let active = false, starts = 0, ends = 0, pages = 0;
  transport(async input => {
    assert.equal(active, true); pages++;
    assert.equal(starts, 1); assert.equal(ends, 0);
    return response([{ tool: 'protoflow_apply_tsx_patch', args: { pageId: input.targetPageId, source: source(input.targetPageId) } }]);
  });
  (window as any).protoflowDesktop.aiBackground = {
    begin: async (input: any) => { assert.equal(input.projectId, scope.projectId); active = true; starts++; return 'workflow-lease'; },
    end: async (input: any) => { assert.equal(input.leaseId, 'workflow-lease'); assert.equal(input.outcome, 'finished'); assert.deepEqual(projectPlanProgress(), ['requests', 'reviews']); active = false; ends++; },
  };
  try { await generateProject(scope.projectId); }
  finally { delete (window as any).protoflowDesktop.aiBackground; }
  assert.equal(pages, 2); assert.equal(starts, 1); assert.equal(ends, 1); assert.equal(active, false);
});

test('browsing menus and lazily initializing preview rows does not interrupt multi-page generation or change selection', async () => {
  const scope = fixture('browse-during-generation');
  useProtoStore.setState({ projectPlan: structuredClone(plan), dbTables: [{
    ...structuredClone(memberTable), sharedByMenus: [],
  }] });
  const executed: string[] = [];
  let previewRows: ReturnType<typeof usePageStore.getState>['tableRows'];
  transport(async input => {
    executed.push(input.targetPageId);
    // This is the same path used when a table/statistic mounts after menu navigation.
    useProtoStore.getState().setActivePage('reviews');
    useProtoStore.getState().setViewMode('single_page');
    usePageStore.getState().getRows(memberTable.id);
    await Promise.resolve();
    previewRows = usePageStore.getState().tableRows;
    assert.equal(previewRows[memberTable.id].length, 8);
    useProtoStore.getState().setViewMode('project_ai');
    return response([{ tool: 'protoflow_apply_tsx_patch', args: { pageId: input.targetPageId, source: source(input.targetPageId) } }]);
  });
  await generateProject(scope.projectId);
  assert.deepEqual(executed, ['requests', 'reviews']);
  assert.deepEqual(projectPlanProgress(), ['requests', 'reviews']);
  assert.equal(useProtoStore.getState().activePageId, 'reviews');
  assert.equal(useProtoStore.getState().viewMode, 'project_ai');
  assert.equal(usePageStore.getState().tableRows, previewRows!);
});

test('actual preview edits while a page is generating still reject its stale result and preserve the edit', async () => {
  const scope = fixture('edit-during-generation');
  useProtoStore.setState({ projectPlan: structuredClone(plan), dbTables: [{
    ...structuredClone(memberTable), sharedByMenus: [],
  }] });
  let manualRowId: string;
  transport(async input => {
    assert.equal(input.targetPageId, 'requests');
    useProtoStore.getState().setActivePage('reviews');
    usePageStore.getState().getRows(memberTable.id);
    await Promise.resolve();
    manualRowId = usePageStore.getState().insertRow(memberTable.id, { card_no: '用户录入' }).id;
    return response([{ tool: 'protoflow_apply_tsx_patch', args: { pageId: input.targetPageId, source: source('过期结果') } }]);
  });
  await assert.rejects(generateProject(scope.projectId), /等待期间工程已修改/);
  assert.deepEqual(projectPlanProgress(), []);
  assert.doesNotMatch(usePageStore.getState().pageSources.requests, /过期结果/);
  assert.equal(usePageStore.getState().tableRows[memberTable.id].find(row => row.id === manualRowId!)?.card_no, '用户录入');
  assert.equal(useProtoStore.getState().activePageId, 'reviews');
});

test('planning cannot silently write pages and empty generation never counts as completed', async () => {
  const scope = fixture('gates');
  transport(async () => response([{ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'wrong', source: source('wrong') } }]));
  await assert.rejects(discussProject(scope.projectId, '先讨论'), /新页面缺少标题或目录/);
  assert.deepEqual(usePageStore.getState().pageSources, {});
  useProtoStore.setState({ projectPlan: structuredClone(plan) });
  transport(async () => response([]));
  await assert.rejects(generateProject(scope.projectId), /没有生成有效页面/);
  assert.deepEqual(projectPlanProgress(), []);
});

test('cancellation during a page preserves earlier commits and project switching rejects a late reply', async () => {
  const scope = fixture('cancel-workflow'); useProtoStore.setState({ projectPlan: structuredClone(plan) });
  let calls = 0;
  transport(async input => {
    calls++;
    if (input.targetPageId === 'reviews') await useHermesStore.getState().stop(scope);
    return response([{ tool: 'protoflow_apply_tsx_patch', args: { pageId: input.targetPageId, source: source(input.targetPageId) } }]);
  });
  await assert.rejects(generateProject(scope.projectId), /已停止/);
  assert.equal(calls, 2); assert.deepEqual(projectPlanProgress(), ['requests']);
  transport(async () => { fixture('replaced'); return response([{ tool: 'protoflow_set_project_plan', args: { plan } }]); });
  await assert.rejects(discussProject(scope.projectId, '修改方案'), /项目已切换/);
  assert.equal(useProtoStore.getState().currentProjectMeta.projectId, 'replaced');
  assert.equal(useProtoStore.getState().projectPlan, null);
});

test('native tools stage directories and live catalogue, enforce planning and generation scope, and undo restores folders', () => {
  fixture('native-workflow');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-workflow-')), file = path.join(dir, 'context.json');
  try {
    const context = { active: true, projectId: 'native-workflow', runId: 'r', snapshot: projectContext(), operations: [] };
    atomicWrite(file, { ...context, kind: 'project', workflowPhase: 'planning' });
    assert.throws(() => callTool(file, 'protoflow_upsert_folder', { folder: plan.folders[0] }), /尚未确认/);
    callTool(file, 'protoflow_set_project_plan', { plan: { ...plan, approved: true, generatedPageIds: ['requests'] } });
    assert.equal(callTool(file, 'protoflow_get_project', {}).projectPlan.approved, false);
    atomicWrite(file, context);
    callTool(file, 'protoflow_upsert_folder', { folder: plan.folders[0] });
    const catalogue = callTool(file, 'protoflow_get_project', {});
    assert.ok(catalogue.contracts.folderIds.includes('procurement'));
    assert.equal(catalogue.sitemap[0].id, 'procurement');
    const base = captureProjectPayload();
    applyProjectChanges(base, projectRevision(), JSON.parse(fs.readFileSync(file, 'utf8')).operations, undefined, 'folder-change');
    assert.equal(usePageStore.getState().designerFolders.length, 1);
    undoProjectChange('folder-change'); assert.equal(usePageStore.getState().designerFolders.length, 0);
    atomicWrite(file, { ...context, kind: 'project', workflowPhase: 'generating', targetPageId: 'requests', snapshot: { ...context.snapshot, projectPlan: { ...plan, approved: true } } });
    assert.throws(() => callTool(file, 'protoflow_apply_tsx_patch', { pageId: 'reviews', source: source('bad') }), /指定页面/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('project conversation IDs, archives and native workspaces never alias menu or mindmap sessions', () => {
  const scope = fixture('scopes');
  const id = useAiChatStore.getState().addMessage({ ...scope, role: 'user', status: 'done', text: '全项目需求' });
  useAiChatStore.getState().updateMessage(id, { pageId: 'fake-menu' });
  assert.equal(useAiChatStore.getState().byConversation[conversationKey(scope)][0].pageId, undefined);
  useAiChatStore.setState({ conversation: null, byConversation: {}, messages: [] });
  useAiChatStore.getState().switchConversation(scope);
  assert.equal(useAiChatStore.getState().messages[0].text, '全项目需求');
  assert.notEqual(conversationKey(scope), conversationKey({ projectId: scope.projectId, pageId: 'project' }));
  assert.equal(conversationKey(scope), nativeKey(scope));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-project-session-'));
  const runtime = new HermesRuntime({ dataDir: dir, emit() {} });
  try {
    assert.notEqual(runtime.conversationWorkspace(scope), runtime.conversationWorkspace({ projectId: scope.projectId, pageId: 'project' }));
    assert.throws(() => nativeKey({ ...scope, pageId: 'fake' }), /不能包含/);
  } finally { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a confirmed menu revision updates only the target, keeps the original on failure and redirects its references after success', async () => {
  const scope = fixture('revise-merge');
  const home = { pageId: 'home', title: '首页', folderId: 'procurement', requirements: '首页入口' };
  const original = structuredClone(plan);
  original.pages.unshift(home);
  original.approved = true;
  original.generatedPageIds = ['home', 'requests', 'reviews'];
  const homeSource = 'export default function Page(){return <Page pfId="root"><Button pfId="link" onClick={()=>navigate("reviews")}>审批</Button></Page>}';
  usePageStore.setState({ designerFolders: original.folders, designerPages: original.pages,
    pageSources: { home: homeSource, requests: source('申请'), reviews: source('原审批功能') } });
  useProtoStore.setState({ activePageId: 'reviews', projectPlan: original });
  const table = structuredClone(useProtoStore.getInitialState().dbTables[0]);
  table.columns = table.columns.filter(column => !column.references);
  table.sharedByMenus = [{pageId:'reviews',menuTitle:'审批',accessMode:'READ 查询',fieldMappingNote:'审批字段'}];
  useProtoStore.setState({ dbTables:[table], mindmaps: {
    nodes:[{id:'map',kind:'mindmap',title:'业务',parentId:null,source:'mindmap\n  root'}],
    links:[{page:{kind:'page',pageId:'reviews'},targetNodeId:'map'}],
  }, projectNotes: {
    nodes:[{id:'note-review',kind:'note',title:'审批沟通',parentId:null,icon:'📝',updatedAt:'2026-11-04T00:00:00.000Z',content:'<p>审批</p>',tags:[],cover:'none',pinned:false}],
    links:[{page:{kind:'page',pageId:'reviews'},targetNodeId:'note-review'}],
  } });
  const proposed = { pageId: 'requests', requirements: '在采购申请的审批抽屉中处理原审批功能',
    merge: { sourcePageId: 'reviews', overlayId: 'review-drawer', presentation: 'drawer' } };
  let allowMerge = false;
  const generated: string[] = [];
  transport(async input => {
    if (input.workflowPhase === 'conversation') return response([{ tool: 'protoflow_revise_project_page', args: proposed }]);
    generated.push(input.targetPageId);
    const patched = allowMerge
      ? 'export default function Page(){return <Page pfId="root"><Button pfId="open" onClick={()=>openDrawer("review-drawer")}>审批</Button><Drawer pfId="drawer-node" id="review-drawer" title="审批"><Text pfId="text">审批内容</Text></Drawer></Page>}'
      : source('没有抽屉的错误结果');
    return response([{ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'requests', source: patched } }]);
  });
  await discussProject(scope.projectId, '把审批收进采购申请的抽屉');
  assert.deepEqual(projectPlanProgress(), ['home']);
  assert.ok(usePageStore.getState().pageSources.reviews);
  await assert.rejects(generateProject(scope.projectId), /弹层内容和打开入口/);
  assert.equal(usePageStore.getState().pageSources.requests, source('申请'));
  assert.equal(usePageStore.getState().pageSources.home, homeSource);
  assert.ok(usePageStore.getState().pageSources.reviews);
  allowMerge = true;
  // Notes are edited live while AI runs; the merge must keep those edits.
  useProtoStore.setState({ projectNotes: { ...useProtoStore.getState().projectNotes,
    nodes: useProtoStore.getState().projectNotes.nodes.map(n => n.kind === 'note' ? { ...n, content: '<p>AI 运行期间的修改</p>' } : n) } });
  await generateProject(scope.projectId);
  assert.deepEqual(generated, ['requests','requests']);
  assert.equal(useProtoStore.getState().activePageId, 'requests');
  assert.equal(Object.hasOwn(usePageStore.getState().pageSources, 'reviews'), false);
  assert.equal(usePageStore.getState().designerPages.some(page => page.pageId === 'reviews'), false);
  assert.match(usePageStore.getState().pageSources.home, /navigate\(["']requests["']\)/);
  assert.deepEqual(projectPlanProgress(), ['home','requests']);
  const saved = captureProjectPayload();
  assert.equal(saved.stateSnapshot.dbTables[0].sharedByMenus[0].pageId, 'requests');
  assert.deepEqual(saved.stateSnapshot.mindmaps.links[0].page, {kind:'page',pageId:'requests'});
  assert.deepEqual(saved.stateSnapshot.projectNotes?.links, [{page:{kind:'page',pageId:'requests'},targetNodeId:'note-review'}]);
  assert.equal((saved.stateSnapshot.projectNotes?.nodes[0] as { content?: string }).content, '<p>AI 运行期间的修改</p>');
  assert.ok(canUndoProjectChange('r'));
  undoProjectChange('r');
  assert.ok(usePageStore.getState().pageSources.reviews);
  assert.equal(usePageStore.getState().pageSources.home, homeSource);
  assert.equal(useProtoStore.getState().dbTables[0].sharedByMenus[0].pageId, 'reviews');
  assert.deepEqual(useProtoStore.getState().mindmaps.links[0].page, {kind:'page',pageId:'reviews'});
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(saved)));
  assert.deepEqual(projectPlanProgress(), ['home','requests']);
});

test('legacy plans with lost progress can retry a single page without accepting empty replies or touching other pages', async () => {
  const scope = fixture('single-page-recovery');
  useProtoStore.setState({ projectPlan: { ...structuredClone(plan), approved: true } });
  const calls: string[] = [];
  transport(async input => {
    calls.push(input.targetPageId);
    return calls.length === 1 ? response([], '本轮只有说明') : response([{ tool: 'protoflow_apply_tsx_patch', args: { pageId: input.targetPageId, source: source('审批页') } }]);
  });
  await generateProject(scope.projectId, 'reviews');
  assert.deepEqual(calls, ['reviews','reviews']);
  assert.deepEqual(Object.keys(usePageStore.getState().pageSources), ['reviews']);
  assert.deepEqual(projectPlanProgress(), ['reviews']);
});

test('continue remaining pages sends the same durable baseline after an archive round trip of automatic preview rows', async () => {
  const scope=fixture('resume-durable-baseline');
  const approved={...structuredClone(plan),approved:true,pages:[structuredClone(plan.pages[0])]};
  useProtoStore.setState({projectPlan:approved,activePageId:'requests',dbTables:[{id:'school',tableName:'school',cnName:'学校',domain:'基础资料域 (MDM)',description:'',sharedByMenus:[],
    columns:[{id:'school-name',name:'name',dataType:'TEXT',nullable:false,comment:'名称'}]}]});
  // Scaffolds are already present when a batch is resumed, as on 104.
  usePageStore.setState({designerFolders:approved.folders,designerPages:[{pageId:'requests',title:'采购申请',folderId:'procurement'}],
    pageSources:{requests:'export default function Page(){return <Page pfId="root" title="采购申请"/>;}'}});
  usePageStore.getState().getRows('school');await Promise.resolve();
  let baseline:string|undefined,calls=0;
  transport(async input=>{
    calls++;
    assert.equal(input.recoveryRevisionVersion,3);
    assert.equal(input.recoverDraft,true);
    const snapDigest=JSON.stringify({pageSources:input.snapshot.pageSources,dbTables:input.snapshot.dbTables,tableRows:input.snapshot.tableRows});
    if(calls===1){baseline=snapDigest;throw new Error('temporary model failure');}
    assert.equal(snapDigest,baseline);
    return response([{tool:'protoflow_apply_tsx_patch',args:{pageId:'requests',source:source('采购申请')}}]);
  });
  await assert.rejects(generateProject(scope.projectId),/temporary model failure/);
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(captureProjectPayload())));
  await generateProject(scope.projectId);
  assert.equal(calls,2);assert.deepEqual(projectPlanProgress(),['requests']);
});

test('project clarification is a registered MCP tool and preserves exact options without touching the plan', async () => {
  const scope = fixture('questions');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-questions-'));
  try {
    const contextFile = path.join(dir, 'context.json');
    const questions = [{ question: '采用哪种维护入口？', options: ['右侧抽屉', '居中弹框'] }];
    transport(async input => {
      atomicWrite(contextFile, { ...scope, active:true, runId:'run', workflowPhase:input.workflowPhase, snapshot:input.snapshot, operations:[] });
      callTool(contextFile, 'protoflow_ask_questions', { questions });
      assert.throws(() => callTool(contextFile, 'protoflow_set_project_plan', { plan }), /等待用户回答/);
      return response(JSON.parse(fs.readFileSync(contextFile,'utf8')).operations);
    });
    await discussProject(scope.projectId, '请提供弹层选项');
    assert.deepEqual(useAiChatStore.getState().messages.at(-1)?.projectQuestions, questions);
    assert.equal(useProtoStore.getState().projectPlan, null);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('a merge from a draft-only menu creates only the target and never creates an old menu to delete', async () => {
  const scope = fixture('planned-merge');
  useProtoStore.setState({ projectPlan: structuredClone(plan) });
  transport(async input => input.workflowPhase === 'conversation'
    ? response([{tool:'protoflow_revise_project_page', args:{pageId:'requests', requirements:'抽屉审批', merge:{sourcePageId:'reviews',overlayId:'approval',presentation:'drawer'}}}])
    : response([{tool:'protoflow_apply_tsx_patch',args:{pageId:'requests', source:'export default function Page(){return <Page pfId="root"><Button pfId="open" onClick={()=>openDrawer("approval")}>审批</Button><Drawer pfId="drawer" id="approval" title="审批"><Text pfId="body">审批内容</Text></Drawer></Page>}'}}]));
  await discussProject(scope.projectId,'合并到审批抽屉');
  assert.equal(useProtoStore.getState().projectPlan?.revision?.merge?.plannedOnly,true);
  await generateProject(scope.projectId);
  assert.deepEqual(Object.keys(usePageStore.getState().pageSources),['requests']);
});

test('saving a whole revised plan preserves only host-confirmed progress for identical page requirements', async () => {
  const scope = fixture('plan-delta');
  useProtoStore.setState({ projectPlan: {...structuredClone(plan), approved:true, generatedPageIds:['requests','reviews']} });
  const revised = structuredClone(plan);
  revised.pages[1].requirements += '，新增详情抽屉';
  transport(async () => response([{tool:'protoflow_set_project_plan',args:{plan:{...revised,approved:true,generatedPageIds:['requests','reviews']}}}]));
  await discussProject(scope.projectId, '调整审批工作台');
  assert.equal(useProtoStore.getState().projectPlan?.approved,false);
  assert.deepEqual(useProtoStore.getState().projectPlan?.generatedPageIds,['requests']);
});

test('replacing a staged full draft preserves confirmed progress and independent edits, including on older tool sessions', async () => {
  const scope = fixture('replace-draft');
  useProtoStore.setState({ projectPlan: { ...structuredClone(plan), approved:true, generatedPageIds:['reviews'] } });
  const partial = { ...structuredClone(plan), pages:[plan.pages[0]] };
  const draft = (value: ProjectPlan) => ({ tool:'protoflow_set_project_plan', args:{plan:value} });
  const folder = { tool:'protoflow_upsert_folder', args:{folder:{id:'extra', title:'补充资料', parentFolderId:null}} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-replace-draft-'));
  const file = path.join(dir, 'context.json');
  try {
    transport(async input => {
      atomicWrite(file, {...scope, active:true, runId:'r', workflowPhase:'conversation', snapshot:input.snapshot, operations:[]});
      for (const op of [draft(partial), folder, draft(plan)]) callTool(file, op.tool, op.args);
      const staged = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.deepEqual(staged.operations, [folder, draft(plan)]);
      assert.deepEqual(staged.snapshot.projectPlan.generatedPageIds, ['reviews']);
      assert.throws(() => callTool(file, 'protoflow_set_project_plan', {plan:{...plan, pages:[{...plan.pages[0], folderId:null}]}}), /folderId/);
      assert.throws(() => callTool(file, 'protoflow_revise_project_page', {pageId:'reviews', requirements:'改为抽屉'}), /分别确认/);
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).operations, staged.operations);
      // Previous MCP versions returned both valid full drafts in the journal.
      return response([draft(partial), ...staged.operations]);
    });
    await discussProject(scope.projectId, '补全采购方案并添加资料目录');
    assert.equal(usePageStore.getState().designerFolders.length, 0);
    const review = useAiChatStore.getState().messages.at(-1)!;
    assert.deepEqual(review.projectChangeReview?.operations, [folder, draft(plan)]);
    await resolveProjectReview(scope.projectId, review.id, true);
    assert.ok(usePageStore.getState().designerFolders.some(item => item.id === 'extra'));
    assert.deepEqual(useProtoStore.getState().projectPlan?.pages, plan.pages);
    assert.deepEqual(useProtoStore.getState().projectPlan?.generatedPageIds, ['reviews']);
    assert.equal(useProtoStore.getState().projectPlan?.approved, false);
    assert.deepEqual(usePageStore.getState().pageSources, {});
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

test('agent combines folder creation, two menu moves and a page edit in a single review without a plan; stale suggestions cannot apply', async () => {
  const scope = fixture('free-project-agent');
  usePageStore.setState({ designerFolders: structuredClone(plan.folders), designerPages:structuredClone(plan.pages),
    pageSources:{requests:source('现有申请'),reviews:source('现有审批')} });
  const folder = {id:'archive', title:'档案', parentFolderId:null};
  const ops = [
    {tool:'protoflow_upsert_folder', args:{folder}},
    ...plan.pages.map(p => ({tool:'protoflow_move_sitemap_item',args:{target:{kind:'page', id:p.pageId},parentFolderId:'archive'}})),
    {tool:'protoflow_apply_tsx_patch',args:{pageId:'reviews',source:source('审批明细')}},
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'agent-flex-')), file = path.join(dir,'context.json');
  try {
    transport(async input => {
      assert.equal(input.workflowPhase,'conversation');
      atomicWrite(file,{...scope,active:true,runId:'r',workflowPhase:input.workflowPhase,snapshot:input.snapshot,operations:[]});
      for (const op of ops) callTool(file,op.tool,op.args);
      return response(JSON.parse(fs.readFileSync(file,'utf8')).operations);
    });
    await discussProject(scope.projectId,'把两个菜单放进档案目录，顺便补充审批明细');
    const proposed = () => useAiChatStore.getState().messages.at(-1)!;
    const first = proposed().id;
    assert.equal(proposed().projectChangeReview?.items.length,4);
    assert.deepEqual(usePageStore.getState().designerFolders,plan.folders);
    assert.equal(useProtoStore.getState().projectPlan,null);
    usePageStore.setState({pageSources:{...usePageStore.getState().pageSources,reviews:source('手动修改')}});
    await assert.rejects(resolveProjectReview(scope.projectId,first,true),/工程已变化/);
    await discussProject(scope.projectId,'请基于最新版本调整');
    await assert.rejects(resolveProjectReview(scope.projectId,first,true),/取代/);
    const current=proposed().id;
    // Restore chat from disk: only proposals matching the project state can run.
    useAiChatStore.setState({byConversation:{},messages:[],conversation:null});
    useAiChatStore.getState().switchConversation(scope);
    await resolveProjectReview(scope.projectId,current,true);
    assert.deepEqual(usePageStore.getState().designerPages.map(p=>p.folderId),['archive','archive']);
    assert.match(usePageStore.getState().pageSources.reviews,/审批明细/);
    assert.equal(usePageStore.getState().pageSources.requests,source('现有申请'));
    undoProjectChange(current);
    assert.deepEqual(usePageStore.getState().designerFolders,plan.folders);
    assert.equal(usePageStore.getState().pageSources.reviews,source('手动修改'));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('text-only replies never resume the original plan; protection survives reopen; missing tools stop before shell creation', async () => {
  const scope = fixture('stale-plan');
  useProtoStore.setState({projectPlan:{...structuredClone(plan),approved:true}});
  const phases:string[] = [];
  transport(async input => { phases.push(input.workflowPhase); return response([],'已说明，尚未提交修改'); });
  await discussProject(scope.projectId,'先解释审批入口，我考虑改成抽屉');
  const archive = encodePflowBinary(captureProjectPayload());
  loadProjectFromBinaryPayload(decodePflowBinary(archive));
  assert.equal(useProtoStore.getState().projectPlan?.discussionPending,true);
  await assert.rejects(generateProject(scope.projectId),/原方案已暂停/);
  await assert.rejects(generateProject(scope.projectId,'requests'),/原方案已暂停/);
  assert.deepEqual(phases,['conversation']);
  await resumePriorPlan(scope.projectId);
  assert.equal(useProtoStore.getState().projectPlan?.discussionPending,undefined);
  transport(async () => { throw Error('不应执行模型'); },['protoflow_set_project_plan']);
  await assert.rejects(generateProject(scope.projectId),/工具不完整/);
  assert.deepEqual(usePageStore.getState().designerPages,[]);
  assert.deepEqual(usePageStore.getState().designerFolders,[]);
});

test('a menu merge can be proposed against the actual project without a previous generation plan', async () => {
  const scope = fixture('merge-without-plan');
  useProtoStore.setState({activePageId:'requests'});
  usePageStore.setState({designerFolders:structuredClone(plan.folders), designerPages:structuredClone(plan.pages),pageSources:{requests:source('采购'),reviews:source('审批')}});
  transport(async () => response([{tool:'protoflow_revise_project_page',args:{pageId:'requests',requirements:'保持采购表单，审批改为抽屉',merge:{sourcePageId:'reviews',overlayId:'approval',presentation:'drawer'}}}]));
  await discussProject(scope.projectId,'把审批并入采购');
  const proposed = useProtoStore.getState().projectPlan;
  assert.deepEqual(proposed?.pages.map(p=>p.pageId),['requests']);
  assert.equal(proposed?.revision?.merge?.sourcePageId,'reviews');
  assert.equal(proposed?.approved,false);
  assert.equal(usePageStore.getState().designerPages.length,2);
});

test('cached project sessions rediscover tools on upgrades and never accept an old registration receipt after a failed rebind', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pflow-rebind-'));
  const runtime=new HermesRuntime({dataDir:dir,emit(){}});
  const scope={projectId:'upgrade',kind:'project'};
  let version='v1', acknowledge=true;
  const methods:string[]=[];
  runtime.connect=async()=>({});
  runtime.projectToolVersion=()=>version;
  runtime.client={ close(){},request:async(method:string,input:any)=>{
    methods.push(method);
    const binding=input.mcpServers[0].env.find((entry:any)=>entry.name==='PROTOFLOW_TOOL_BINDING').value;
    if (acknowledge) atomicWrite(path.join(input.cwd,'tool-registration.json'),{binding,tools:registeredTools});
    return {sessionId:'original',models:{currentModelId:'m',availableModels:[]}};
  }};
  try {
    assert.equal((await runtime.session(scope)).sessionId,'original');
    await runtime.session(scope);
    version='v2';acknowledge=false;
    await assert.rejects(runtime.session(scope),/未加载当前项目工具/);
    await assert.rejects(runtime.session(scope),/未加载当前项目工具/);
    acknowledge=true;
    assert.deepEqual((await runtime.session(scope)).projectTools,registeredTools);
    assert.deepEqual(methods,['session/new','session/load','session/load','session/load']);
  }finally{runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('native deletion validates the stored session, installation and idle state, and can retry a failed deletion', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-delete-chat-'));
  const removed: string[] = [];
  let fail = true;
  const runtime = new HermesRuntime({dataDir:dir, emit(){}, deleteHistorySession:async (id:string, identity:string) => {
    assert.equal(id, 'acp-original');
    assert.equal(identity, JSON.stringify(['/profile/a','/bin/a']));
    if (fail) throw Error('管理服务不可用');
    removed.push(id);
  }});
  const scope = projectChatScope('history-native', 'chat-a');
  const other = projectChatScope('history-native', 'chat-b');
  const binding = (s: typeof scope) => path.join(runtime.conversationWorkspace(s), 'session.json');
  try {
    const environment = {home:'/profile/a', binary:'/bin/a'};
    runtime.settings = environment;
    runtime.connect = async () => ({});
    const file = binding(scope);
    atomicWrite(file, {...other, sessionId:'acp-other'});
    await assert.rejects(runtime.deleteProjectChat(scope), /归属/);
    atomicWrite(file, {...scope, sessionId:'acp-original'});
    atomicWrite(binding(other), {...other, sessionId:'acp-other'});
    runtime.sessions.set(nativeKey(scope), {...scope, sessionId:'acp-original', running:true});
    await assert.rejects(runtime.deleteProjectChat(scope), /先停止/);
    runtime.sessions.clear();
    runtime.settings = {home:'/profile/b', binary:'/bin/b'};
    await assert.rejects(runtime.deleteProjectChat(scope), /其他 Hermes 环境/);
    await assert.rejects(runtime.session(scope), /其他 Hermes 环境/);
    runtime.settings = environment;
    await assert.rejects(runtime.deleteProjectChat(scope), /管理服务不可用/);
    assert.ok(fs.existsSync(file));
    fail = false;
    await runtime.deleteProjectChat({...scope, sessionId:'untrusted-input'});
    await runtime.deleteProjectChat(scope);
    assert.deepEqual(removed, ['acp-original']);
    assert.equal(fs.existsSync(file), false);
    assert.ok(fs.existsSync(binding(other)));
    await assert.rejects(runtime.session(scope), /已删除/);
  } finally { runtime.close(); fs.rmSync(dir, {recursive:true, force:true}); }
});

test('an agent can submit merge intent and implemented drawer in the same turn; one review applies or rejects both atomically', async () => {
  const scope=fixture('inline-merge');
  useProtoStore.setState({activePageId:'reviews'});
  usePageStore.setState({designerFolders:structuredClone(plan.folders),designerPages:structuredClone(plan.pages),pageSources:{requests:source('采购'),reviews:source('审批')}});
  const revision={tool:'protoflow_revise_project_page',args:{pageId:'requests',requirements:'在抽屉中审批',merge:{sourcePageId:'reviews',overlayId:'approval',presentation:'drawer'}}};
  const patch={tool:'protoflow_apply_tsx_patch',args:{pageId:'requests',source:'export default function Page(){return <Page pfId="root"><Button pfId="open" onClick={()=>openDrawer("approval")}>审批</Button><Drawer pfId="drawer" id="approval"><Text pfId="body">审批内容</Text></Drawer></Page>}'}};
  const phases:string[]=[];
  transport(async i=>{phases.push(i.workflowPhase);return response([revision,patch]);});
  await discussProject(scope.projectId,'直接把审批并进采购抽屉，准备好后我一起确认');
  const review=useAiChatStore.getState().messages.at(-1)!;
  assert.match(review.projectChangeReview!.items.join(' '),/移除旧菜单.*审批工作台/);
  assert.equal(useProtoStore.getState().projectPlan,null);
  assert.equal(usePageStore.getState().pageSources.requests,source('采购'));
  await resolveProjectReview(scope.projectId,review.id,false);
  assert.ok(usePageStore.getState().pageSources.reviews);
  await discussProject(scope.projectId,'准备这个合并');
  const id=useAiChatStore.getState().messages.at(-1)!.id;
  await resolveProjectReview(scope.projectId,id,true);
  assert.deepEqual(phases,['conversation','conversation']);
  assert.equal(usePageStore.getState().pageSources.reviews,undefined);
  assert.match(usePageStore.getState().pageSources.requests,/openDrawer/);
  assert.deepEqual(projectPlanProgress(),['requests']);
  assert.equal(useProtoStore.getState().activePageId,'requests');
  undoProjectChange(id);
  assert.ok(usePageStore.getState().pageSources.reviews);
  assert.equal(useProtoStore.getState().activePageId,'reviews');
});

test('the host compares the actual draft against original quotes, preserves omissions and rejects a key that prevents a second draft', async () => {
  const scope = fixture('quote-source-audit');
  const text='草稿可以有多份。生效报价最多一份。另须保存审批原因。';
  const quote={...memberTable,tableName:'quote',id:'quotes',sharedByMenus:[],modeling:{entity:'报价',grain:'每行一份报价',reason:'保存报价历史',pendingRules:[{rule:'仅生效报价唯一',reason:'需要按状态限制'}]},
    columns:['id','lot','supplier','status'].map(name=>({id:'col-'+name,name,dataType:'INT',nullable:false,isPrimaryKey:name==='id',comment:''}))};
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'quote-review-')),'ctx.json');
  let tooStrict=true;
  try {
    transport(async input=>{
      atomicWrite(file,{...scope,active:true,runId:'r',workflowPhase:'conversation',snapshot:input.snapshot,operations:[]});
      callTool(file,'protoflow_get_project',{});
      callTool(file,'protoflow_upsert_db_table',{table:{...quote,uniqueConstraints:tooStrict?[{name:'uq_lot_supplier',columnIds:['col-lot','col-supplier']}]:[]}});
      const read=callTool(file,'protoflow_review_db_requirements',{});
      const original=read.sources.find((s:any)=>s.text===text);
      assert.ok(original);
      const note={quote:'草稿可以有多份。生效报价最多一份。',state:'pending',note:'只有生效时需要防重',tableId:'quotes',basis:'pending:仅生效报价唯一',
        allow:{description:'不同主键的两份草稿',same:['col-lot','col-supplier','col-status'],different:['col-id']},
        reject:{description:'不同主键的两份生效报价',same:['col-lot','col-supplier','col-status'],different:['col-id']}};
      const annotate=(findings:any[])=>callTool(file,'protoflow_review_db_requirements',{sourceId:original.id,findings});
      assert.throws(()=>annotate([{...note,quote:'随意编造的原文'}]),/逐字引用/);
      const report=annotate([note]);
      assert.match(report.lines.join('\n'),/另须保存审批原因。.*未核对原文/);
      assert.equal(report.uncovered,tooStrict?1:2);
      const journal=JSON.parse(fs.readFileSync(file,'utf8'));
      return {...response(journal.operations),requirementFindings:journal.requirementFindings};
    });
    await discussProject(scope.projectId,text);
    const first=useAiChatStore.getState().messages.at(-1)!;
    assert.match(first.requirementAudit!.conflicts.join('\n'),/两份草稿.*uq_lot_supplier/);
    await assert.rejects(resolveProjectReview(scope.projectId,first.id,true),/正反例.*冲突/);
    assert.equal(captureProjectPayload().stateSnapshot.dbTables.length,0);
    tooStrict=false;
    await discussProject(scope.projectId,'修正约束后重新提交');
    const second=useAiChatStore.getState().messages.at(-1)!;
    assert.deepEqual(second.requirementAudit!.conflicts,[]);
    await resolveProjectReview(scope.projectId,second.id,true);
    const reopened=decodePflowBinary(encodePflowBinary(captureProjectPayload()));
    assert.equal(reopened.stateSnapshot.databaseRequirements!.find(r=>r.text===text)!.findings[0].basis,'pending:仅生效报价唯一');
    const spec=generateUnpackedGitFiles(reopened).find(f=>f.relativePath==='SPEC.md')!.content;
    assert.match(spec,/另须保存审批原因。.*未核对原文/);
    assert.match(spec,/应允许 · 不同主键的两份草稿/);
    const changed=prepareProjectChanges(reopened,[{tool:'protoflow_upsert_db_table',args:{table:{...quote,uniqueConstraints:[{name:'uq_again',columnIds:['col-lot','col-supplier']}]}}}]);
    assert.match(changed.requirementAudit.conflicts.join('\n'),/两份草稿.*uq_again/);
    const old = reopened.stateSnapshot.databaseRequirements!.find(r=>r.text===text)!;
    transport(async () => ({...response([]),requirementFindings:[{sourceId:old.id, findings:[...old.findings,
      {quote:'另须保存审批原因。',state:'clarify',note:'需要确认是一笔报价一次审批，还是多次审批历史'}]}]}));
    await discussProject(scope.projectId,'只补充之前的需求核对记录');
    const updated=useAiChatStore.getState().messages.at(-1)!;
    assert.deepEqual(updated.projectChangeReview?.operations,[]);
    await resolveProjectReview(scope.projectId,updated.id,true);
    assert.equal(captureProjectPayload().stateSnapshot.databaseRequirements!.find(r=>r.id===old.id)?.findings[1].state,'clarify');
  } finally {fs.rmSync(path.dirname(file),{recursive:true,force:true});}
});

test('a downstream menu retries a missing promised binding before its candidate can enter saved progress', async () => {
  const scope=fixture('library-flow');
  const binding={...memberTable, id:'borrowers',tableName:'lib_borrower',cnName:'借书人',domain:'图书流通',
    sharedByMenus:[{pageId:'requests',menuTitle:'登记',accessMode:'CRUD 读写',fieldMappingNote:'借书人登记'}]};
  const proposal=structuredClone(plan);
  proposal.approved=true;
  proposal.pages.reverse(); // Display order is deliberately opposite generation order.
  const later=proposal.pages[0];
  later.dependencies=[{kind:'reuse',sourcePageId:'requests',sourceTableId:'borrowers',requirement:'后续办理使用已登记的借书人'}];
  later.acceptanceCases=[{scenario:'查找已登记读者',expected:'能在名册中找到同一人'}];
  useProtoStore.setState({projectPlan:proposal,dbTables:[binding]});
  const calls:string[]=[];
  const bound='export default function Page(){return <Page pfId="root"><Table pfId="reader-list" table="borrowers"/></Page>}';
  transport(async input=>{
    calls.push(input.targetPageId);
    const firstAttempt=calls.length===2;
    if(calls.length===3){
      assert.match(input.prompt,/待绑定来源表/);
      assert.deepEqual(projectPlanProgress(),['requests']);
      assert.ok(!usePageStore.getState().pageSources.reviews.includes('首次错误'));
    }
    return response([{tool:'protoflow_apply_tsx_patch',args:{pageId:input.targetPageId,source:firstAttempt?source('首次错误'):bound}}]);
  });
  await generateProject(scope.projectId);
  assert.deepEqual(calls,['requests','reviews','reviews']);
  assert.deepEqual(projectPlanProgress(),['reviews','requests']);
});

function nodeText(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map(child => (typeof child === 'string' ? child : nodeText(child)))
    .join('');
}

test('stopping or dropping mid-page with an uncertain draft persists needsArchiveRestart and exposes one-click archive-restart across chat, footer CTA, and page card', async () => {
  const scope = fixture('uncertain-stop-ux');
  const threePagePlan: ProjectPlan = {
    summary: '教务原型系统三页生成验证。',
    folders: [{ id: 'base', title: '基础数据中心', parentFolderId: null }],
    pages: [
      { pageId: 'pg-home', title: '工作台首页', folderId: 'base', requirements: '只读首页指标卡' },
      { pageId: 'pg-base-org', title: '学校与组织结构', folderId: 'base', requirements: '维护学年学期与班级' },
      { pageId: 'pg-calendar', title: '校历与作息时间', folderId: 'base', requirements: '维护校历节次' },
    ],
    approved: true,
    generatedPageIds: [],
  };
  useProtoStore.setState({ projectPlan: structuredClone(threePagePlan) });

  let hasUncertainDraftOnDisk = false;
  const archiveFlagsByPage: Array<{ pageId: string; archiveDraft: boolean; prompt: string }> = [];

  transport(async input => {
    archiveFlagsByPage.push({
      pageId: input.targetPageId,
      archiveDraft: Boolean(input.archiveDraft),
      prompt: input.prompt,
    });
    if (input.targetPageId === 'pg-base-org') {
      if (!hasUncertainDraftOnDisk) {
        hasUncertainDraftOnDisk = true;
        // User clicked "停止" while an MCP/native tool outcome was still unconfirmed.
        await useHermesStore.getState().stop(scope);
        const stopErr = new Error(
          '已停止生成，未应用修改 候选修改已保存在本机；因中断时存在执行结果不明的操作，无法直接续写半截草稿，请点击下方或右侧的“保留旧草稿，重新生成”按钮继续。',
        ) as Error & { failureEnvelope?: any };
        stopErr.failureEnvelope = {
          code: 'CANCELLED',
          failureScope: 'page',
          terminalConfirmed: false,
          candidateStatus: 'uncertain',
          targetPageId: 'pg-base-org',
        };
        throw stopErr;
      }
      if (!input.archiveDraft) {
        const conflictErr = new Error(
          '上轮生成中途中断，存在执行结果不明的操作，候选草稿已保留但无法直接续写。请直接点击下方或右侧的“保留旧草稿，重新生成”按钮：系统会自动归档旧草稿并按当前工程重新生成此页，已完成的页面和不会清空的会话历史均不受影响。',
        ) as Error & { failureEnvelope?: any };
        conflictErr.failureEnvelope = {
          code: 'DRAFT_RECOVERY_CONFLICT',
          failureScope: 'page',
          terminalConfirmed: true,
          candidateStatus: 'uncertain',
          targetPageId: 'pg-base-org',
        };
        throw conflictErr;
      }
      hasUncertainDraftOnDisk = false;
    }
    return response([
      {
        tool: 'protoflow_apply_tsx_patch',
        args: { pageId: input.targetPageId, source: source(input.targetPageId) },
      },
    ]);
  });

  // 1. Mid-way stop on page 2 MUST persist lastGenerationFailure with needsArchiveRestart=true (not swallow it behind checkPlan()).
  await assert.rejects(generateProject(scope.projectId), /已停止.*执行结果不明/);
  assert.deepEqual(projectPlanProgress(), ['pg-home']);
  const savedFailure = useProtoStore.getState().projectPlan?.lastGenerationFailure;
  assert.equal(savedFailure?.pageId, 'pg-base-org');
  assert.equal(savedFailure?.needsArchiveRestart, true);
  assert.equal(failureNeedsArchiveRestart(savedFailure), true);
  // Legacy projects saved before needsArchiveRestart existed must also be recognized via diagnostic text.
  assert.equal(
    failureNeedsArchiveRestart({
      pageId: 'pg-base-org',
      diagnostic:
        '上轮存在执行结果不明的操作，候选草稿已保留，不能直接“继续此页”。核对当前工程后，可选择“保留旧草稿，重新生成”；该操作会归档旧候选并读取当前工程，不会清空会话历史。',
    }),
    true,
  );

  // 2. Programmatic generateProject(projectId) without restartFromProject MUST remain fail-closed.
  await assert.rejects(generateProject(scope.projectId), /保留旧草稿，重新生成/);

  // 3. Render ProjectAiView and verify all 3 recovery surfaces guide and unblock the user in one click.
  const activeScope = projectChatScope(
    scope.projectId,
    readProjectChatIndex(scope.projectId).activeId,
  );
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(ProjectAiView, { projectId: scope.projectId }),
      );
    });
    const buttons = renderer.root.findAllByType('button');
    const buttonLabels = buttons.map(nodeText);

    // Chat stream inline primary + secondary recovery actions:
    const chatPrimaryBtn = buttons.find(
      b => nodeText(b) === '保留旧草稿，重新生成「学校与组织结构」并继续剩余页面',
    );
    assert.ok(chatPrimaryBtn, `expected inline chat recovery button, got: ${buttonLabels.join(' | ')}`);
    assert.ok(
      typeof chatPrimaryBtn.props['aria-describedby'] === 'string' &&
        chatPrimaryBtn.props['aria-describedby'].length > 0,
    );
    assert.ok(buttons.some(b => nodeText(b) === '仅重新生成「学校与组织结构」'));

    // Sticky right-sidebar footer primary CTA must NOT trap the user with "继续生成剩余页面":
    assert.equal(
      buttons.some(b => nodeText(b) === '继续生成剩余页面'),
      false,
      'sticky footer must not show dead-end 继续生成剩余页面 when needsArchiveRestart is true',
    );
    const footerBtn = buttons.find(
      b => nodeText(b) === '保留旧草稿，重新生成并继续剩余页面',
    );
    assert.ok(footerBtn, 'expected sticky footer CTA to offer archive-restart & continue');

    // Interrupted page card hides guaranteed-to-fail "继续此页" and highlights "上次中断":
    assert.equal(
      buttons.some(b => nodeText(b) === '继续此页'),
      false,
      'interrupted page card must hide guaranteed-to-fail 继续此页 when needsArchiveRestart is true',
    );
    assert.ok(buttons.some(b => nodeText(b) === '保留旧草稿，重新生成'));
    assert.match(JSON.stringify(renderer.toJSON()), /上次中断/);

    // 4. Clicking the sticky footer CTA archives & regenerates pg-base-org AND continues pg-calendar with archiveDraft=false!
    archiveFlagsByPage.length = 0;
    await act(async () => {
      footerBtn.props.onClick();
    });
    // Wait for async workflow completion:
    for (let i = 0; i < 20 && projectPlanProgress().length < 3; i++) {
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });
    }
    assert.deepEqual(projectPlanProgress(), ['pg-home', 'pg-base-org', 'pg-calendar']);
    assert.equal(useProtoStore.getState().projectPlan?.lastGenerationFailure, undefined);
    assert.equal(archiveFlagsByPage.length, 2);
    assert.equal(archiveFlagsByPage[0].pageId, 'pg-base-org');
    assert.equal(archiveFlagsByPage[0].archiveDraft, true);
    assert.match(archiveFlagsByPage[0].prompt, /上轮中断草稿已归档/);
    assert.equal(archiveFlagsByPage[1].pageId, 'pg-calendar');
    assert.equal(archiveFlagsByPage[1].archiveDraft, false);
    assert.equal(useAiChatStore.getState().byConversation[conversationKey(activeScope)]?.at(-1)?.status, 'done');
  } finally {
    if (renderer) {
      act(() => {
        renderer.unmount();
      });
    }
  }
});

test('read-only RP analysis reaches the native read-only entry point, keeps a confirmed plan active, and rejects returned mutations', async () => {
  const scope = fixture('rp-read-only-workflow');
  useProtoStore.setState({projectPlan:{...plan,approved:true,discussionPending:false}});
  const initial = captureProjectPayload().stateSnapshot;
  const task = {scope:{kind:'project'} as const,readOnly:true};
  transport(async input => {
    assert.equal(input.readOnly,true);
    assert.deepEqual(input.snapshot.axureMigrationScope,task.scope);
    return response([],'需要确认库存单每行的粒度');
  });
  await discussProject(scope.projectId,'分析来源',[],[],{},undefined,task);
  assert.deepEqual(captureProjectPayload().stateSnapshot,initial);
  transport(async () => response([{tool:'protoflow_upsert_db_table',args:{table:memberTable}}]));
  await assert.rejects(discussProject(scope.projectId,'再核对一次',[],[],{},undefined,task),/只读/);
  assert.deepEqual(captureProjectPayload().stateSnapshot,initial);
});

test('RP conversion keeps its scope through clarification and persists only the confirmed copy and shared schema', async () => {
  const scope = fixture('rp-confirm-workflow');
  const {importAxureRp} = await import('../src/proto/axure/import');
  const imported = await importAxureRp(fs.readFileSync('tests/fixtures/axure9-editable-layout.rp'));
  const [page] = imported.designerPages, id = page.pageId;
  const base = captureProjectPayload();
  Object.assign(base.stateSnapshot,{designerFolders:imported.designerFolders,designerPages:imported.designerPages,
    pageSources:imported.pageSources,activePageId:id});
  loadProjectFromBinaryPayload(base);
  useAiChatStore.getState().switchConversation(scope);
  const migration = {scope:{kind:'page' as const,pageId:id}, readOnly:false};
  const ask = [{question:'每行代表什么？',options:['一张库存单','一条商品明细']}];
  const latest = () => useAiChatStore.getState().messages.at(-1)!;
  transport(async () => response([{tool:'protoflow_ask_questions',args:{questions:ask}}]));
  await discussProject(scope.projectId,'请核对每行代表什么',[],[],{pageId:id},undefined,migration);
  assert.deepEqual(latest().rpQuestionScope,migration.scope);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'rp-confirm-')), file = path.join(dir,'context.json');
  const db = {id:'stock-documents',tableName:'t_stock_documents',cnName:'库存单',domain:'库存',description:'库存单登记',sharedByMenus:[],
    modeling:{entity:'库存单',grain:'每行一张库存单',reason:'单号与仓库来自原型表头'},
    columns:[{id:'document-number',name:'document_no',dataType:'TEXT',nullable:false,isPrimaryKey:true,comment:'单号'},
      {id:'warehouse-name',name:'warehouse_name',dataType:'TEXT',nullable:true,comment:'仓库'}]};
  try {
    let optimizedId = '';
    transport(async input => {
      assert.deepEqual(input.snapshot.axureMigrationScope,migration.scope);
      atomicWrite(file,{...scope,active:true,runId:'verification',workflowPhase:input.workflowPhase,snapshot:input.snapshot,operations:[]});
      const call = (name:string,args:Record<string,unknown>={}) => callTool(file,name,args);
      const grid = call('protoflow_inspect_page',{pageId:id,view:'axure',limit:60}).records.find((r:any)=>r.type === 'StaticTable');
      call('protoflow_get_project');
      call('protoflow_upsert_db_table',{table:db});
      const mappings = grid.grid.firstRow.map((cell:any,i:number)=>({headerPfId:cell.pfId,role:'field',columnId:db.columns[i].id}));
      optimizedId = call('protoflow_bind_axure_table',{pageId:id,targetPfId:grid.pfId,tableId:db.id,mappings}).optimizedPageId;
      return response(JSON.parse(fs.readFileSync(file,'utf8')).operations);
    });
    await discussProject(scope.projectId,'每行一张库存单，单号唯一标识单据',[],[],{pageId:id},undefined,migration);
    assert.ok(latest().projectChangeReview?.items.some(i=>i.includes('原表头「单号」 → t_stock_documents.document_no')));
    assert.deepEqual(useProtoStore.getState().dbTables,[]);
    assert.deepEqual(usePageStore.getState().pageSources,imported.pageSources);
    useAiChatStore.setState({byConversation:{},messages:[],conversation:null});
    useAiChatStore.getState().switchConversation(scope);
    assert.ok(latest().projectChangeReview?.operations.some(op=>op.args.rpSourcePatch));
    await resolveProjectReview(scope.projectId,latest().id,true);
    const saved = decodePflowBinary(encodePflowBinary(captureProjectPayload())).stateSnapshot;
    assert.equal(saved.pageSources[id],imported.pageSources[id]);
    assert.match(saved.pageSources[optimizedId],/table="stock-documents"/);
    assert.deepEqual(saved.dbTables,[db]);
    assert.deepEqual(saved.tableRows,{});
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
