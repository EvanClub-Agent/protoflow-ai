import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { generationEvidenceIssues, reviewPageDependencies, validatePageEvidence, type AcceptanceCase } from '../src/services/projectDependencies';
import { evaluatePageDraftReadiness } from '../src/services/pageDraftReadiness';
import { projectContext } from '../src/services/hermesProject';
import { generateProject, useProjectWorkflow } from '../src/services/projectWorkflow';
import { projectChatScope } from '../src/services/projectChatHistory';
import { conversationKey } from '../src/services/hermesConversation';
import { useAiChatStore } from '../src/store/useAiChatStore';
import { useHermesStore } from '../src/store/useHermesStore';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { pageContractErrors } from '../src/proto/ai/pageContract';

const { callTool, atomicWrite, tools } = require(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
const mobile = (body: string) => `export default function Page(){return <MobilePage pfId="root" title="帮助与反馈">${body}</MobilePage>}`;
const backSource = mobile('<MTopBar pfId="support-back" title="反馈" leftMode="back" onLeftClick={() => navigate("profile")}/><MForm pfId="feedback"><MField pfId="content" name="content" label="反馈内容"/></MForm>');
const returnCase = (): AcceptanceCase => ({ scenario: '退出反馈表单', expected: '不保存反馈，返回个人中心', actionPfId: 'support-back', actionEvent: 'onLeftClick', actionKind: 'navigate', targetId: 'profile' });
function fixture(c: AcceptanceCase = returnCase(), source = backSource) {
  const payload = createProjectPayload({ projectId: 'acceptance-return', projectName: '反馈返回验收', templateId: 'blank_project', projectMode: 'mobile',
    storageDir: '/tmp', fileName: 'acceptance-return.pflow', createdAt: '2026-11-12', updatedAt: '2026-11-12', pageCount: 0, tableCount: 0, stickyCount: 0 });
  const s = payload.stateSnapshot;
  s.designerFolders = [{ id: 'account', title: '我的', parentFolderId: null }];
  s.designerPages = [{ pageId: 'support', title: '帮助与反馈', folderId: 'account', platform: 'mobile' }, { pageId: 'profile', title: '个人中心', folderId: 'account', platform: 'mobile' }];
  s.pageSources = { support: source, profile: mobile('<MTopBar pfId="profile-title" title="个人中心"/>') };
  s.activePageId = 'support';
  s.projectPlan = { summary: '反馈页可返回个人中心', approved: true, generatedPageIds: [], folders: s.designerFolders,
    pages: [{ ...s.designerPages[0], requirements: '展示反馈内容并支持返回个人中心', dependencies: [], acceptanceCases: [c] }] };
  return payload;
}
const status = (c: AcceptanceCase, source = backSource) => reviewPageDependencies(fixture(c, source).stateSnapshot).cases[0].status;

test('acceptance return: explicit and legacy back actions accept exit wording without inventing save intent', () => {
  for (const scenario of ['退出反馈表单', '取消填写', '返回个人中心', '放弃本次填写']) {
    const c = { ...returnCase(), scenario };
    assert.equal(status(c), '待业务验收', scenario);
    const legacy = { ...c }; delete legacy.actionKind;
    assert.equal(status(legacy), '待业务验收', `legacy: ${scenario}`);
    const qualified = { ...c, actionPfId: 'support-back.onLeftClick' }; delete qualified.actionEvent;
    assert.equal(status(qualified), '待业务验收');
    const singleEvent = { ...c }; delete singleEvent.actionEvent;
    assert.equal(status(singleEvent), '待业务验收');
  }
  assert.deepEqual(pageContractErrors(backSource, []), []);
  const s = fixture().stateSnapshot;
  assert.deepEqual(generationEvidenceIssues(s, ['support']), []);
  assert.equal(evaluatePageDraftReadiness(s, 'support').acceptanceReady, true);
});

test('acceptance return: missing events, wrong navigation, no-op feedback and mutations stay blocked', () => {
  assert.match(status({ ...returnCase(), actionEvent: 'onRightClick' }), /指定事件未绑定/);
  assert.match(status({ ...returnCase(), actionPfId: 'missing' }), /待绑定可操作入口/);
  assert.notEqual(status(returnCase(), backSource.replace('navigate("profile")', 'navigate("missing")')), '待业务验收');
  assert.notEqual(status({ ...returnCase(), targetId: 'support' }), '待业务验收');
  for (const action of ['toast("已返回")', 'closeOverlay()', 'submitForm("feedback")', 'updateRow({status:"done"})', 'deleteRow()']) {
    const source = backSource.replace('navigate("profile")', action);
    assert.notEqual(status(returnCase(), source), '待业务验收', action);
    const legacy = returnCase(); delete legacy.actionKind;
    assert.notEqual(status(legacy, source), '待业务验收', `legacy: ${action}`);
    if (/^(submitForm|updateRow|deleteRow)/.test(action)) assert.match(status(legacy, source), /正向业务动作不能绑定在取消或关闭操作上/);
  }
  assert.notEqual(status({ scenario: '保存反馈', expected: '保存记录', actionPfId: 'support-back', actionEvent: 'onLeftClick' }), '待业务验收');
});

test('acceptance return: a dock return case selects its exact secondary event rather than its primary action', () => {
  const source = mobile('<MBottomDock pfId="dock" primaryText="查看帮助" secondaryText="取消" onPrimary={() => openModal("help")} onSecondary={() => navigate("profile")}/><MDialog pfId="help-dialog" id="help" title="帮助"/>');
  const c = { ...returnCase(), actionPfId: 'dock', actionEvent: 'onSecondary' };
  assert.equal(status(c, source), '待业务验收');
  assert.notEqual(status({ ...c, actionEvent: 'onPrimary' }, source), '待业务验收');
  delete c.actionEvent;
  assert.equal(status(c, source), '待业务验收');
  assert.notEqual(status(c, source.replace('navigate("profile")', 'toast("已退出")')), '待业务验收');
});

test('acceptance return: closing an overlay has an explicit action kind and verifies its enclosing target', () => {
  const source = mobile('<MButton pfId="open" onClick={() => openModal("feedback-dialog")}>填写反馈</MButton><MDialog pfId="dialog" id="feedback-dialog" title="反馈" onClose={() => closeOverlay()}><MForm pfId="feedback"><MField pfId="content" name="content" label="内容"/></MForm></MDialog>');
  const c: AcceptanceCase = { scenario: '退出反馈表单', expected: '关闭反馈弹层，不提交表单', actionPfId: 'dialog', actionEvent: 'onClose', actionKind: 'closeOverlay', targetId: 'feedback-dialog' };
  validatePageEvidence(fixture(c, source).stateSnapshot.projectPlan!.pages[0]);
  assert.equal(status(c, source), '待业务验收');
  assert.notEqual(status({ ...c, targetId: 'other-dialog' }, source), '待业务验收');
  assert.notEqual(status(c, source.replace('onClose={() => closeOverlay()}', 'onClose={() => toast("已退出")}')), '待业务验收');
  const legacy = { ...c }; delete legacy.actionKind;
  assert.equal(status(legacy, source), '待业务验收');
  assert.equal(status(legacy, source.replace('title="反馈" onClose', 'title="提交反馈" confirmText="提交" onClose')), '待业务验收',
    'the title and confirm button must not turn the separate close event into a submit case');
  assert.notEqual(status({ ...c, actionPfId: 'support-back', actionEvent: 'onLeftClick' }, backSource.replace('navigate("profile")', 'closeOverlay()')), '待业务验收');
});

test('acceptance return: the native MCP reports the same valid return evidence as the host', t => {
  const payload = fixture(); loadProjectFromBinaryPayload(payload);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-return-')), file = path.join(dir, 'context.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const snapshot = projectContext();
  atomicWrite(file, { projectId: payload.meta.projectId, kind: 'project', active: true, runId: 'return-run', sessionId: 'return-session', workflowPhase: 'generating', targetPageId: 'support',
    snapshot, operations: [], baseline: snapshot });
  callTool(file, 'protoflow_get_project_brief', {});
  const staged = callTool(file, 'protoflow_apply_tsx_patch', { pageId: 'support', source: backSource });
  assert.equal(staged.acceptanceReady, true);
  assert.deepEqual(staged.pendingAcceptanceIssues, []);
  const inspected = callTool(file, 'protoflow_inspect_page', { pageId: 'support' });
  assert.equal(inspected.acceptanceReady, true);
  assert.match(usePageStore.getState().pageSources.support, /navigate/);
  const schema = tools.find((tool: any) => tool.name === 'protoflow_set_project_plan').inputSchema.properties.plan.properties.pages.items.properties.acceptanceCases.items.properties;
  assert.ok(schema.actionKind.enum.includes('closeOverlay'));
});

test('acceptance return: generating a valid back action commits in one model turn without a futile repair', async () => {
  const payload = fixture(); loadProjectFromBinaryPayload(payload);
  const index = useAiChatStore.getState().loadProjectIndex(payload.meta.projectId), scope = projectChatScope(payload.meta.projectId, index.activeId);
  let executes = 0;
  const listeners1 = new Set<(e: any) => void>();
  (window as any).protoflowDesktop = { hermes: {
    onEvent: (fn: (e: any) => void) => { listeners1.add(fn); return () => { listeners1.delete(fn); }; }, sync: async () => ({ synced: true }),
    session: async () => ({ ...scope, sessionId: 'return-session', running: false, projectTools: tools.map((t: any) => t.name), models: { currentModelId: 'mock', availableModels: [] } }),
    execute: async (input: any) => {
      executes++;
      const taskKey = JSON.stringify([input.projectId, 'project-page-exec', input.threadId ?? null, input.targetPageId]);
      const baseEvt = { ...scope, sessionId: 'return-session', planningSessionId: 'return-session', execSessionId: 'return-session', taskKey, targetPageId: input.targetPageId, clientRequestId: input.clientRequestId, runId: 'return-run' };
      listeners1.forEach(fn => fn({ type: 'run-start', ...baseEvt }));
      listeners1.forEach(fn => fn({ type: 'run-end', ...baseEvt }));
      return { text: '反馈页已完成', sessionId: 'return-session', planningSessionId: 'return-session', execSessionId: 'return-session', taskKey, clientRequestId: input.clientRequestId, runId: 'return-run', operations: [{ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'support', source: backSource } }] };
    },
  } };
  useHermesStore.setState({ status: 'running', sessions: {}, runningProjects: {}, cancelGeneration: {} });
  await generateProject(payload.meta.projectId);
  assert.equal(executes, 1);
  assert.ok(useProtoStore.getState().projectPlan!.generatedPageIds.includes('support'));
  assert.equal(useProjectWorkflow.getState().lastTurnMetrics[conversationKey(scope)].retryCount, 0);
});

test('runtime diagnostics: failed generation reports the final run and candidate evidence, and keeps raw model text private', async () => {
  const payload=fixture();loadProjectFromBinaryPayload(payload);
  const index=useAiChatStore.getState().loadProjectIndex(payload.meta.projectId),scope=projectChatScope(payload.meta.projectId,index.activeId);
  const prior=(window as any).protoflowDesktop;const reports:any[]=[];let executes=0;
  const listeners2 = new Set<(e: any) => void>();
  (window as any).protoflowDesktop={diagnostics:{capture:async(input:any)=>{reports.push(input);return '11111111-1111-4111-8111-111111111111';}},hermes:{
    onEvent:(fn:(e:any)=>void)=>{listeners2.add(fn);return ()=>{listeners2.delete(fn);};},sync:async()=>({synced:true}),
    session:async()=>({...scope,sessionId:'diagnostic-session',running:false,projectTools:tools.map((t:any)=>t.name),models:{currentModelId:'mock',availableModels:[]}}),
    execute:async(input:any)=>{
      const runId=`diagnostic-run-${++executes}`;
      const taskKey=JSON.stringify([input.projectId,'project-page-exec',input.threadId??null,input.targetPageId]);
      const baseEvt={...scope,sessionId:'diagnostic-session',planningSessionId:'diagnostic-session',execSessionId:'diagnostic-session',taskKey,targetPageId:input.targetPageId,clientRequestId:input.clientRequestId,runId};
      listeners2.forEach(fn=>fn({type:'run-start',...baseEvt}));
      listeners2.forEach(fn=>fn({type:'run-end',...baseEvt}));
      return {text:'PRIVATE_MODEL_RESPONSE',runId,sessionId:'diagnostic-session',planningSessionId:'diagnostic-session',execSessionId:'diagnostic-session',taskKey,clientRequestId:input.clientRequestId,modelId:'mock',operations:[{tool:'protoflow_apply_tsx_patch',args:{pageId:'support',source:backSource.replace('support-back','wrong-back')}}]};
    },
  }};
  useHermesStore.setState({status:'running',sessions:{},runningProjects:{},cancelGeneration:{}});
  try {
    await assert.rejects(generateProject(payload.meta.projectId),/没有生成有效页面/);
    await Promise.resolve();
    assert.equal(executes,2);assert.equal(reports.length,1);
    const report=reports[0];assert.equal(report.code,'AI_GENERATION_REJECTED');assert.equal(report.context.runId,'diagnostic-run-2');assert.equal(report.context.sessionId,'diagnostic-session');assert.equal(report.context.attempt,1);
    assert.equal(report.context.checks[0].actionPfId,'support-back');assert.match(report.context.checks[0].status,/待绑定可操作入口/);
    assert.equal(JSON.stringify(report).includes('PRIVATE_MODEL_RESPONSE'),false);assert.equal(JSON.stringify(report).includes('MobilePage'),false);
    assert.equal(useAiChatStore.getState().byConversation[conversationKey(scope)].at(-1)?.diagnosticId,'11111111-1111-4111-8111-111111111111');
    assert.equal(useProtoStore.getState().projectPlan!.generatedPageIds.includes('support'),false);
  } finally {(window as any).protoflowDesktop=prior;}
});
