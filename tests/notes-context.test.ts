import { projectWithHome } from './fixtures/projectWithHome';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { installTestDom } from './dom';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useHermesStore } from '../src/store/useHermesStore';
import { useAiChatStore } from '../src/store/useAiChatStore';
import { loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { runProjectAi } from '../src/services/hermesBridge';
import { conversationKey } from '../src/services/hermesConversation';
import {
  createNoteNode,
  createStickyReviewNote,
  setNoteTargetLinks,
  setPageNoteLinks,
  updateNoteContent,
} from '../src/services/notesWorkspace';
import { notesLinkedToPage, pageNoteBriefing } from '../src/proto/notes';
import { groupStickiesByPage, sitemapPageOrder, stickyAlreadyInNote, stickySummaryHtml } from '../src/proto/notesStickies';
import { extractAllNoteTasks } from '../src/proto/notes';
import { assistantMarkdownToHtml, detectNoteMentions, extractMarkdownBlock, noteAssistantRunKey, noteAssistantScope, previewStreamingMarkdown, runNoteAssistant, useNoteAssistantStore } from '../src/services/hermesNoteAssistant';
import { NoteAssistantModal } from '../src/components/NoteAssistantModal';
import { HermesModelPicker } from '../src/components/HermesModelPicker';

const project = (projectId: string) =>
  projectWithHome({
    projectId,
    projectName: '上下文测试工程',
    templateId: 'blank_project',
    storageDir: '/tmp',
    fileName: `${projectId}.pflow`,
    createdAt: '2026-11-04',
    updatedAt: '2026-11-04',
    pageCount: 0,
    tableCount: 0,
    stickyCount: 0,
  });

test('note model selection retries loading, uses exact dedicated-session model IDs, and rejects stale or running selections', async () => {
  const cleanup = installTestDom();
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    const projectId = 'ctx-note-models';
    loadProjectFromBinaryPayload(project(projectId));
    const noteId = createNoteNode(projectId, 'note', '模型选择', null);
    const scope = noteAssistantScope(projectId);
    const key = conversationKey(scope);
    const models = [
      { modelId: 'custom:team:notes:a', name: '写作模型 A' },
      { modelId: 'custom:team:notes:b', name: '写作模型 B' },
    ];
    let modelId = models[0].modelId;
    let failLoad = true;
    let failSwitch = true;
    const loads: any[] = [], switches: any[] = [];
    const session = () => ({ ...scope, sessionId: 'notes-session', running: false, models: { currentModelId: modelId, availableModels: models } });
    (window as any).protoflowDesktop = { hermes: {
      onEvent: () => () => {},
      session: async (input: any) => {
        loads.push(input);
        if (failLoad) throw new Error('模型列表连接失败');
        return session();
      },
      setModel: async (input: any) => {
        switches.push(input);
        if (failSwitch) throw new Error('模型服务不可用');
        modelId = input.modelId;
        return session();
      },
    } };
    useHermesStore.setState(useHermesStore.getInitialState(), true);
    const mainKey = conversationKey({ projectId, kind: 'project', threadId: 'main-chat' });
    const mainSession = { ...session(), threadId: 'main-chat', sessionId: 'main-session' };
    useHermesStore.setState({ status: 'running', sessions: { [mainKey]: mainSession } });
    const node = useProtoStore.getState().projectNotes.nodes.find((n) => n.id === noteId)!;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(NoteAssistantModal, {
        projectId, node: node as Extract<typeof node, { kind: 'note' }>, editor: null, selection: null, onClose() {}, onNotice() {},
      }));
    });
    const trigger = () => renderer!.root.findByProps({ 'aria-label': '选择笔记助手模型' });
    const button = (label: string) => renderer!.root.findAllByType('button').find((b) => b.children.includes(label))!;
    assert.ok(JSON.stringify(renderer.toJSON()).includes('模型列表连接失败'));
    assert.equal(trigger().props.disabled, true);
    failLoad = false;
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '刷新笔记助手模型' }).props.onClick(); });
    assert.deepEqual(loads.at(-1), { ...scope, fresh: false, refresh: true });
    assert.equal(trigger().props.disabled, false);

    act(() => trigger().props.onClick());
    act(() => renderer!.root.findByProps({ type: 'radio', value: models[1].modelId }).props.onChange());
    await act(async () => { button('切换模型').props.onClick(); });
    assert.ok(JSON.stringify(renderer.toJSON()).includes('模型服务不可用'));
    assert.equal(useHermesStore.getState().sessions[key].models.currentModelId, models[0].modelId);
    failSwitch = false;
    await act(async () => { button('切换模型').props.onClick(); });
    assert.deepEqual(switches.at(-1), { ...scope, modelId: models[1].modelId });
    assert.equal(useHermesStore.getState().sessions[key].models.currentModelId, models[1].modelId);
    assert.equal(useHermesStore.getState().sessions[mainKey], mainSession, 'the project chat must keep its own model');
    assert.equal(renderer.root.findAllByType(HermesModelPicker).length, 0);

    act(() => trigger().props.onClick());
    const staleSelect = renderer.root.findByType(HermesModelPicker).props.onSelect;
    act(() => useHermesStore.setState({ runningProjects: { [projectId]: true } }));
    assert.equal(trigger().props.disabled, true);
    await assert.rejects(staleSelect(models[0].modelId), /当前 AI 任务/);
    act(() => useHermesStore.setState({ runningProjects: {} }));
    act(() => createNoteNode(projectId, 'note', '切换后的笔记', null));
    await assert.rejects(staleSelect(models[0].modelId), /当前笔记已变化/);
    assert.equal(switches.length, 2, 'stale and running callbacks must not send model changes');
  } finally {
    if (renderer) act(() => renderer!.unmount());
    delete (window as any).protoflowDesktop;
    cleanup();
  }
});

test('page AI requests carry the selected linked notes as background, with a summary fallback for long notes', async () => {
  const cleanup = installTestDom();
  try {
    loadProjectFromBinaryPayload(project('ctx-page-ai'));
    const folder = createNoteNode('ctx-page-ai', 'folder', '退款', null);
    const refund = createNoteNode('ctx-page-ai', 'note', '订单退款规则会议纪要', folder, {
      status: 'pending_confirm',
      stakeholder: '张总',
      content: '<p>退款金额超过 500 元需财务复核。</p>',
    });
    const other = createNoteNode('ctx-page-ai', 'note', '无关笔记', null, { content: '<p>与本页无关</p>' });
    setNoteTargetLinks('ctx-page-ai', folder, [{ kind: 'page', pageId: 'page-home' }]);

    const linked = notesLinkedToPage(useProtoStore.getState().projectNotes, usePageStore.getState(), 'page-home');
    assert.deepEqual(linked.map((n) => n.noteId), [refund], 'folder links reach the notes inside');
    assert.ok(!linked.some((n) => n.noteId === other));

    const briefing = pageNoteBriefing(useProtoStore.getState().projectNotes, [refund]);
    assert.match(briefing, /订单退款规则会议纪要/);
    assert.match(briefing, /待客户确认/);
    assert.match(briefing, /退款金额超过 500 元需财务复核/);
    const short = pageNoteBriefing(useProtoStore.getState().projectNotes, [refund], 50);
    assert.match(short, /仅为摘要/);
    assert.match(short, new RegExp(`noteId：${refund}`));
    assert.equal(pageNoteBriefing(useProtoStore.getState().projectNotes, []), '');

    const calls: any[] = [];
    (window as any).protoflowDesktop = {
      hermes: {
        onEvent: () => () => {},
        session: async (scope: any) => ({ ...scope, sessionId: `session-${conversationKey(scope)}`, running: false, models: { currentModelId: 'm', availableModels: [{ modelId: 'm', name: 'M' }] } }),
        sync: async () => ({ synced: true }),
        execute: async (input: any) => {
          calls.push(input);
          return { sessionId: `session-${conversationKey(input)}`, runId: 'r', modelId: 'm', operations: [], text: '已了解' };
        },
        cancel: async () => {},
      },
    };
    useHermesStore.setState(useHermesStore.getInitialState(), true);
    useHermesStore.setState({ status: 'running' });

    await runProjectAi('按照最新客户沟通纪要调整退款表单字段', { pageId: 'page-home', noteIds: [refund] });
    assert.match(calls[0].prompt, /本页关联的项目笔记/);
    assert.match(calls[0].prompt, /退款金额超过 500 元需财务复核/);
    assert.ok(calls[0].prompt.indexOf('本页关联的项目笔记') < calls[0].prompt.indexOf('用户请求：'));
    const messages = useAiChatStore.getState().byConversation[conversationKey({ projectId: 'ctx-page-ai', pageId: 'page-home' })];
    assert.match(messages.find((m) => m.role === 'user')!.text, /已附带关联笔记：《订单退款规则会议纪要》/);

    await runProjectAi('只改标题', { pageId: 'page-home' });
    assert.ok(!calls[1].prompt.includes('本页关联的项目笔记'), 'unticked notes are not sent');
  } finally {
    delete (window as any).protoflowDesktop;
    cleanup();
  }
});

test('canvas stickies are summarised back into notes by page and component, without duplicates', () => {
  loadProjectFromBinaryPayload(project('ctx-stickies'));
  usePageStore.setState((s) => ({
    designerPages: [...s.designerPages, { pageId: 'page-refund', title: '退款详情', folderId: 'folder-project-pages' }],
    pageSources: { ...s.pageSources, 'page-refund': s.pageSources['page-home'].replace(/page-home/g, 'page-refund') },
  }));
  useProtoStore.setState({
    stickyNotes: [
      { id: 's2', pageId: 'page-refund', targetWidgetId: 'form', targetWidgetName: '退款表单', text: '增加退款原因 <必填>', compiledRule: '', index: 2, active: true },
      { id: 's1', pageId: 'page-refund', targetWidgetId: 'btn', targetWidgetName: '提交按钮', text: '提交前二次确认', compiledRule: '', index: 1, active: true },
      { id: 's3', pageId: 'page-home', targetWidgetId: 'grid', targetWidgetName: '列表', text: '已废弃的想法', compiledRule: '', index: 1, active: false },
    ],
  });
  const order = sitemapPageOrder(usePageStore.getState());
  const groups = groupStickiesByPage(useProtoStore.getState().stickyNotes, order, { onlyActive: true });
  assert.deepEqual(groups.map((g) => g.pageId), ['page-refund']);
  assert.deepEqual(groups[0].stickies.map((s) => s.id), ['s1', 's2'], 'ordered by sticky number');
  assert.equal(groupStickiesByPage(useProtoStore.getState().stickyNotes, order).length, 2);

  const html = stickySummaryHtml(groups);
  assert.match(html, /退款详情/);
  assert.match(html, /增加退款原因 &lt;必填&gt;/, 'sticky text is escaped');
  assert.ok(!html.includes('<必填>'));
  assert.ok(stickyAlreadyInNote(groups[0].stickies[1], html));
  assert.ok(!stickyAlreadyInNote(groups[0].stickies[1], '<p>别的内容</p>'));

  const id = createStickyReviewNote('ctx-stickies');
  const notes = useProtoStore.getState().projectNotes;
  const note = notes.nodes.find((n) => n.id === id)!;
  assert.match(note.title, /^评审修改清单 \d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(notes.links.map((l) => l.page), [{ kind: 'page', pageId: 'page-refund' }]);
  const tasks = extractAllNoteTasks(notes).filter((t) => t.noteId === id);
  assert.equal(tasks.length, 2, 'enabled stickies become to-dos');
  assert.match(tasks[0].text, /退款详情 · 提交按钮/);

  // A second checklist on the same day gets a unique title instead of failing.
  const again = createStickyReviewNote('ctx-stickies', { onlyActive: false });
  assert.notEqual(useProtoStore.getState().projectNotes.nodes.find((n) => n.id === again)!.title, note.title);
  assert.throws(() => createStickyReviewNote('ctx-stickies', { pageIds: ['page-home'] }), /没有启用中的画布批注/);
  setPageNoteLinks('ctx-stickies', { kind: 'page', pageId: 'page-home' }, []);
});

test('AI note assistant runs read-only on its own thread, previews Markdown, and rejects write operations', async () => {
  const cleanup = installTestDom();
  try {
    loadProjectFromBinaryPayload(project('ctx-assistant'));
    const id = createNoteNode('ctx-assistant', 'note', '客户速记', null, {
      content: '<p>嗯那个 退款详情 页面要加原因 下周三前老王提供接口文档</p>',
    });
    const calls: any[] = [];
    let reply: any = { operations: [], text: '好的\n```markdown\n## 确认结论\n- 退款需填写原因\n## 待办 Action Items\n- [ ] 老王｜下周三｜提供接口文档\n```' };
    (window as any).protoflowDesktop = {
      hermes: {
        onEvent: () => () => {},
        session: async (scope: any) => ({ ...scope, sessionId: `session-${conversationKey(scope)}`, running: false, models: { currentModelId: 'm', availableModels: [{ modelId: 'm', name: 'M' }] } }),
        sync: async () => ({ synced: true }),
        execute: async (input: any) => {
          calls.push(input);
          return { sessionId: `session-${conversationKey(input)}`, runId: 'r', modelId: 'm', ...reply };
        },
        cancel: async () => {},
      },
    };
    useHermesStore.setState(useHermesStore.getInitialState(), true);
    useHermesStore.setState({ status: 'running' });

    const before = useProtoStore.getState().projectNotes;
    const result = await runNoteAssistant('ctx-assistant', id, 'organize');
    assert.equal(calls[0].readOnly, true);
    assert.equal(calls[0].kind, 'project');
    assert.equal(calls[0].threadId, 'note-assistant');
    assert.match(calls[0].prompt, /下周三前老王提供接口文档/);
    assert.match(result.html!, /data-type="taskItem"/);
    assert.match(result.html!, /老王｜下周三｜提供接口文档/);
    assert.equal(useProtoStore.getState().projectNotes, before, 'nothing is written before the user confirms');
    assert.equal(useHermesStore.getState().runningProjects['ctx-assistant'], false);

    await runNoteAssistant('ctx-assistant', id, 'actions', { selection: { from: 1, to: 9, text: '老王提供接口文档', html: '<p>老王提供接口文档</p>' } });
    assert.match(calls[1].prompt, /用户选中的片段/);
    assert.ok(!calls[1].prompt.includes('退款详情 页面要加原因'));

    reply = { operations: [{ tool: 'protoflow_apply_tsx_patch', args: {} }], text: '```markdown\nx\n```' };
    await assert.rejects(runNoteAssistant('ctx-assistant', id, 'organize'), /拒绝/);
    reply = { operations: [], text: '```markdown\na\n```\n```markdown\nb\n```' };
    await assert.rejects(runNoteAssistant('ctx-assistant', id, 'organize'), /唯一/);
    useHermesStore.setState({ status: 'not_installed' });
    await assert.rejects(runNoteAssistant('ctx-assistant', id, 'organize'), /连接 Hermes/);
  } finally {
    delete (window as any).protoflowDesktop;
    cleanup();
  }
  assert.equal(extractMarkdownBlock('```md\n# 标题\n```'), '# 标题');
  assert.equal(extractMarkdownBlock('纯文本结果'), '纯文本结果');
  assert.match(assistantMarkdownToHtml('# 标题\n正文'), /^<h1>标题<\/h1>/);

  const mentions = detectNoteMentions(
    '<p>退款详情页需要读取 t_refund 表，退款详情也要改</p><p><a href="#pf-page:home">首页</a> 首页</p>',
    [{ pageId: 'refund', title: '退款详情' }, { pageId: 'home', title: '首页' }, { pageId: 'x', title: '库存' }],
    [{ id: 'tbl-refund', tableName: 't_refund', cnName: '退款单' }]
  );
  assert.deepEqual(mentions.map((m) => `${m.kind}:${m.id}:${m.occurrences}`), ['table:tbl-refund:1', 'page:refund:2']);
});

test('note writing accepts an empty body, polishing uses the requested style and excerpt, and failures leave notes intact', async () => {
  const cleanup = installTestDom();
  try {
    const projectId = 'ctx-writing';
    loadProjectFromBinaryPayload(project(projectId));
    const id = createNoteNode(projectId, 'note', '退款需求', null);
    const calls: any[] = [];
    let execute: (input: any) => Promise<any> = async () => ({ text: '```markdown\n## 退款说明\n规则待确认。\n```' });
    (window as any).protoflowDesktop = { hermes: {
      onEvent: () => () => {},
      session: async (scope: any) => ({ ...scope, sessionId: 'writing-session', running: false, models: { currentModelId: 'm', availableModels: [] } }),
      sync: async () => ({ synced: true }),
      execute: async (input: any) => {
        calls.push(input);
        return { sessionId: 'writing-session', runId: 'r', modelId: 'm', operations: [], ...await execute(input) };
      },
      cancel: async () => {},
    } };
    useHermesStore.setState(useHermesStore.getInitialState(), true);
    useHermesStore.setState({ status: 'running' });
    useNoteAssistantStore.setState({ runs: {} });

    await assert.rejects(runNoteAssistant(projectId, id, 'write', { instructions: '  ' }), /写作要求/);
    for (const action of ['polish', 'organize', 'actions'] as const) {
      await assert.rejects(runNoteAssistant(projectId, id, action), /笔记内容为空/, 'the title must not count as body text');
    }
    await assert.rejects(runNoteAssistant(projectId, id, 'polish', { selection: { from: 1, to: 2, text: ' ', html: '<p> </p>' } }), /选中内容无效/);
    assert.equal(calls.length, 0);
    const before = useProtoStore.getState().projectNotes;
    const draft = await runNoteAssistant(projectId, id, 'write', { instructions: '起草退款流程和验收标准，面向客户' });
    assert.match(calls[0].prompt, /起草退款流程和验收标准，面向客户/);
    assert.equal(calls[0].readOnly, true);
    assert.equal(draft.action, 'write');
    assert.equal(draft.projectId, projectId);
    assert.equal(draft.sourceContent, '<p></p>');
    assert.equal(useProtoStore.getState().projectNotes, before);

    const excerptHtml = '<p>退款金额 500 元。不要自动通过。<a href="#pf-page:page-home">首页</a></p>';
    const excerptText = '退款金额 500 元。不要自动通过。首页';
    updateNoteContent(projectId, id, `${excerptHtml}<p>无关段落</p>`);
    const selection = { from: 1, to: 1 + excerptText.length, text: excerptText, html: excerptHtml };
    const polished = await runNoteAssistant(projectId, id, 'polish', { selection, polishStyle: 'formal', instructions: '控制在 100 字内' });
    assert.match(calls[1].prompt, /正式、专业、客观/);
    assert.match(calls[1].prompt, /控制在 100 字内/);
    assert.match(calls[1].prompt, /退款金额 500 元。不要自动通过。/);
    assert.match(calls[1].prompt, /href="#pf-page:page-home"/, 'selected rich-text links are retained in the source');
    assert.ok(!calls[1].prompt.includes('无关段落'));
    assert.deepEqual(polished.selection, selection);
    selection.from = 99;
    assert.equal(polished.selection?.from, 1, 'result retains an immutable copy of its original selection');
    assert.equal(useNoteAssistantStore.getState().runs[noteAssistantRunKey(projectId, id)], polished);
    assert.equal(useNoteAssistantStore.getState().runs[noteAssistantRunKey('another-project', id)], undefined);
    assert.equal(polished.history?.length, 1);

    const refined = await runNoteAssistant(projectId, id, 'polish', {
      selection: polished.selection ?? undefined,
      polishStyle: 'formal',
      refineInstruction: '补充一条财务复核时限',
      previousMarkdown: polished.markdown,
      preserveSourceContent: polished.sourceContent,
      previousHistory: polished.history,
    });
    assert.match(calls[2].prompt, /上一版 AI 生成草稿/);
    assert.match(calls[2].prompt, /补充一条财务复核时限/);
    assert.equal(refined.history?.length, 2);
    assert.equal(refined.history?.[0].label, '初稿');
    assert.equal(refined.history?.[1].label, '第 2 版');
    assert.equal(previewStreamingMarkdown('```markdown\n## 标题\n正在输出…'), '## 标题\n正在输出…');

    execute = async () => { throw new Error('引擎请求失败'); };
    const unchanged = useProtoStore.getState().projectNotes;
    await assert.rejects(runNoteAssistant(projectId, id, 'polish'), /引擎请求失败/);
    assert.equal(useNoteAssistantStore.getState().runs[noteAssistantRunKey(projectId, id)].status, 'error');
    assert.equal(useHermesStore.getState().runningProjects[projectId], false);
    assert.equal(useProtoStore.getState().projectNotes, unchanged);

    execute = async () => {
      await useHermesStore.getState().stop(noteAssistantScope(projectId));
      return { text: '已停止后的迟到结果' };
    };
    await assert.rejects(runNoteAssistant(projectId, id, 'polish'), /已停止/);
    assert.equal(useProtoStore.getState().projectNotes, unchanged);

    execute = async () => {
      loadProjectFromBinaryPayload(project('ctx-switched'));
      return { text: '来自旧项目的结果' };
    };
    await assert.rejects(runNoteAssistant(projectId, id, 'polish'), /当前项目已变化/);
    assert.equal(useProtoStore.getState().projectNotes.nodes.length, 0);
  } finally {
    delete (window as any).protoflowDesktop;
    cleanup();
  }
});
