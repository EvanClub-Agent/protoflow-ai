import { acknowledgeToolDiscovery } from './fixtures/hermesToolDiscovery';
import { conversationKey } from '../src/services/hermesConversation';
import { printPageSource } from "../src/proto/dsl/printer";
import { parsePageSource } from "../src/proto/dsl/parser";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { HermesSessionControls } from "../src/components/HermesSessionControls";
import { ClosedLoopAuditView } from "../src/components/ClosedLoopAuditView";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import {
  createProjectPayload,
  loadProjectFromBinaryPayload,
  captureProjectPayload,
} from "../src/services/projectStorage";
import {
  prepareProjectChanges,
  applyProjectChanges,
  projectRevision,
  projectContext,
  undoProjectChange,
  canUndoProjectChange,
} from "../src/services/hermesProject";
import {
  runProjectAi,
  runCanvasAiWithHermes,
} from "../src/services/hermesBridge";
import { useProtoStore } from "../src/store/useProtoStore";
import { usePageStore } from "../src/proto/store/usePageStore";
import { useHermesStore } from "../src/store/useHermesStore";
import { useAiChatStore } from "../src/store/useAiChatStore";
import type {
  HermesDesktopApi,
  HermesEvent,
  HermesOperation,
} from "../src/services/hermesClient";
const { AcpClient } = require(
  path.join(process.cwd(), "electron/hermes-acp.cjs"),
);
const { HermesRuntime } = require(
  path.join(process.cwd(), "electron/hermes-runtime.cjs"),
);
const { callTool, atomicWrite, tools: mcpTools } = require(
  path.join(process.cwd(), "electron/protoflow-mcp.cjs"),
);
const page = (title: string) =>
  `export default function Page(){return <Page pfId="root" title="${title}"><Text pfId="first">unchanged</Text><Text pfId="second">keep</Text></Page>;}`;
const patch = (source: string, pageId = "main"): HermesOperation => ({
  tool: "protoflow_apply_tsx_patch",
  args: { pageId, source },
});
function fixture(id = "hermes-test") {
  const payload = createProjectPayload({
    projectId: id,
    projectName: id,
    templateId: "blank_project",
    storageDir: "/tmp/pflow-test",
    fileName: "test.pflow",
    createdAt: "2026-10-30",
    updatedAt: "2026-10-30",
    pageCount: 0,
    tableCount: 0,
    stickyCount: 0,
  });
  payload.stateSnapshot.designerFolders = [{ id: 'folder-project-pages', title: '测试目录', parentFolderId: null }];
  payload.stateSnapshot.pageSources = { main: page("before") };
  payload.stateSnapshot.designerPages = [
    { pageId: "main", title: "Test", folderId: "folder-project-pages" },
  ];
  payload.stateSnapshot.activePageId = "main";
  return payload;
}
const table = {
  id: "table-id",
  tableName: "actual_table",
  cnName: "物料",
  modeling: { entity: "物料", grain: "每行一个物料", reason: "空项目中首次登记物料，列表与新增共用" },
  domain: "基础资料域 (MDM)",
  description: "",
  columns: [
    {
      id: "column-id",
      name: "name",
      dataType: "TEXT",
      nullable: false,
      comment: "物料名称",
    },
    { id: "material-id-column", name: "material_id", dataType: "BIGINT", nullable: false, isPrimaryKey: true, comment: "物料标识" },
  ],
  sharedByMenus: [],
};
const menuRef = {
  pageId: "material-list",
  menuTitle: "物料目录",
  accessMode: "CRUD 读写",
  fieldMappingNote: "列表查询与新增弹框共用物料名称字段",
};
const materialSource = `export default function Page(){return <Page pfId="material-root" title="物料目录">
  <Button pfId="add-button" onClick={()=>openModal("add-material")}>新增物料</Button>
  <Table pfId="material-grid" table="table-id" columns={[{title:"名称",dataIndex:"name"}]}/>
  <Modal pfId="add-modal" id="add-material" title="新增物料">
    <Form pfId="material-form" table="table-id"><Input pfId="material-name" name="name" label="物料名称" required={true}/></Form>
    <Button pfId="save-button" onClick={()=>{submitForm("material-form");closeOverlay();refresh("material-grid");}}>保存</Button>
    <Button pfId="cancel-button" onClick={()=>closeOverlay()}>取消</Button>
  </Modal>
</Page>}`;
function mcpFixture(file: string) {
  loadProjectFromBinaryPayload(fixture());
  atomicWrite(file, {
    active: true, runId: "db-contract-test", projectId: "hermes-test",
    snapshot: projectContext(), operations: [],
  });
  callTool(file, "protoflow_get_project", {});
}
function mockApi(overrides: Partial<HermesDesktopApi> = {}) {
  let listener: (event: HermesEvent) => void = () => {};
  const session = {
    projectId: useProtoStore.getState().currentProjectMeta.projectId,
    pageId: useProtoStore.getState().activePageId,
    sessionId: "session-a",
    running: false,
    models: {
      currentModelId: "provider:model-a",
      availableModels: [{ modelId: "provider:model-a", name: "A" }],
    },
  };
  const api = {
    onEvent: (fn) => {
      listener = fn;
      return () => {};
    },
    session: async () => session,
    sync: async () => ({ synced: true }),
    execute: async () => ({
      text: "真实测试回复",
      operations: [],
      sessionId: session.sessionId,
      modelId: session.models.currentModelId,
      runId: "run-test",
    }),
    cancel: async () => {},
    ...overrides,
  } as HermesDesktopApi;
  (window as any).protoflowDesktop = { hermes: api };
  useHermesStore.setState({
    status: "running",
    sessions: {},
    runningProjects: {},
    partial: {},
    cancelGeneration: {},
    permissions: [],
    error: null,
  });
  return { emit: (event: HermesEvent) => listener(event), session };
}
describe("Hermes project contract and execution", () => {
  test("valid changes commit as one transaction and undo restores pages and schema", () => {
    loadProjectFromBinaryPayload(fixture());
    const base = captureProjectPayload(),
      revision = projectRevision();
    applyProjectChanges(
      base,
      revision,
      [
        patch(page("after")),
        { tool: "protoflow_upsert_db_table", args: { table } },
      ],
      undefined,
      "change-1",
    );
    assert.match(usePageStore.getState().pageSources.main, /after/);
    assert.equal(useProtoStore.getState().dbTables[0].id, "table-id");
    assert.ok(canUndoProjectChange("change-1"));
    undoProjectChange("change-1");
    assert.equal(
      usePageStore.getState().pageSources.main,
      base.stateSnapshot.pageSources.main,
    );
    assert.deepEqual(useProtoStore.getState().dbTables, []);
  });
  test("invalid TSX, unknown actions, duplicate IDs, unknown fields and fake IDs are rejected", () => {
    const base = fixture();
    base.stateSnapshot.dbTables = [table as any];
    const invalid = [
      "<Page",
      'export default function Page(){return <Page pfId="p"><Button pfId="b" onClick={()=>invented()}/></Page>}',
      'export default function Page(){return <Page pfId="p"><Button pfId="p"/></Page>}',
      'export default function Page(){return <Page pfId="p"><Form pfId="f" table="table-id"><Input pfId="i" name="code"/></Form></Page>}',
      'export default function Page(){return <Page pfId="p"><Table pfId="t" table="actual_table"/></Page>}',
      'export default function Page(){return <Page pfId="p"><Button pfId="b" onClick={()=>show(1)}/></Page>}',
    ];
    for (const source of invalid)
      assert.throws(() => prepareProjectChanges(base, [patch(source)]));
  });
  test("partial changes cannot modify unrelated nodes or another page", () => {
    const base = fixture();
    const selected = { pageId: "main", selectedPfId: "first" };
    assert.doesNotThrow(() =>
      prepareProjectChanges(
        base,
        [patch(page("before").replace('>unchanged</Text>', '>updated</Text>'))],
        selected,
      ),
    );
    assert.throws(
      () =>
        prepareProjectChanges(
          base,
          [patch(page("before").replace('>keep</Text>', '>wrong</Text>'))],
          selected,
        ),
      /范围/,
    );
    assert.throws(
      () =>
        prepareProjectChanges(
          base,
          [
            {
              tool: "protoflow_apply_tsx_patch",
              args: {
                pageId: "other",
                title: "Other",
                folderId: "folder-project-pages",
                source: page("new"),
              },
            },
          ],
          selected,
        ),
      /其他页面/,
    );
  });
  test("failed validation, stale revision and switched project leave all stores untouched", () => {
    loadProjectFromBinaryPayload(fixture());
    const base = captureProjectPayload(),
      revision = projectRevision();
    assert.throws(() =>
      applyProjectChanges(base, revision, [
        patch(page("after")),
        {
          tool: "protoflow_upsert_db_column",
          args: { tableId: "missing", column: { id: "c" } },
        },
      ]),
    );
    assert.equal(
      usePageStore.getState().pageSources.main,
      base.stateSnapshot.pageSources.main,
    );
    usePageStore.getState().setPageSource("main", page("manual"));
    assert.throws(
      () => applyProjectChanges(base, revision, [patch(page("after"))]),
      /等待期间/,
    );
    loadProjectFromBinaryPayload(fixture("different"));
    assert.throws(
      () => applyProjectChanges(base, revision, [patch(page("after"))]),
      /项目已切换/,
    );
  });
  test("disconnected Hermes and provider errors never apply a local heuristic", async () => {
    loadProjectFromBinaryPayload(fixture());
    const original = projectRevision();
    useHermesStore.setState({ status: "not_installed" });
    await assert.rejects(runProjectAi("增加审批弹框"), /先连接/);
    assert.equal(projectRevision(), original);
    mockApi({
      execute: async () => {
        throw new Error("provider unavailable");
      },
    });
    await assert.rejects(runProjectAi("增加审批弹框"), /provider unavailable/);
    assert.equal(projectRevision(), original);
    assert.equal(useAiChatStore.getState().messages.at(-1)?.status, "error");
  });
  test("actual reply streams to the correct project and read-only mutation is rejected", async () => {
    loadProjectFromBinaryPayload(fixture());
    let receivedPrompt = "";
    const mock = mockApi({
      execute: async (input) => {
        receivedPrompt = input.prompt;
        mock.emit({
          type: "run-start",
          projectId: mock.session.projectId,
          pageId: mock.session.pageId,
          sessionId: mock.session.sessionId,
          runId: "run-stream",
        });
        mock.emit({
          type: "session-update",
          projectId: mock.session.projectId,
          pageId: mock.session.pageId,
          sessionId: mock.session.sessionId,
          runId: "run-stream",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "streamed" },
          },
        });
        assert.equal(
          useAiChatStore.getState().messages.at(-1)?.text,
          "streamed",
        );
        return {
          text: "answer",
          operations: [],
          sessionId: "session-a",
          modelId: "provider:model-a",
          runId: "run-stream",
        };
      },
    });
    await runProjectAi("检查当前项目", { readOnly: true });
    assert.match(receivedPrompt, /本轮只回答/);
    assert.match(receivedPrompt, /protoflow_get_implementation_guide/);
    assert.match(receivedPrompt, /protoflow_inspect_page/);
    assert.equal(receivedPrompt.split('物料规范是强制契约').length - 1, 1, 'do not duplicate the complete rulebook in every request');
    assert.equal(
      useAiChatStore.getState().messages.at(-1)?.modelId,
      "provider:model-a",
    );
    mockApi({
      execute: async () => ({
        text: "bad",
        operations: [patch(page("after"))],
        sessionId: "s",
        modelId: "m",
        runId: "r",
      }),
    });
    await assert.rejects(runProjectAi("问答", { readOnly: true }), /只读请求/);
    assert.match(usePageStore.getState().pageSources.main, /before/);
  });
  test("stop during session initialization prevents the prompt from being sent", async () => {
    loadProjectFromBinaryPayload(fixture());
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const mock = mockApi({
      session: async () => {
        await gate;
        return mock.session;
      },
      execute: async () => {
        calls++;
        throw new Error("must not run");
      },
    });
    const task = runProjectAi("生成页面");
    await Promise.resolve();
    await useHermesStore.getState().stop(mock.session);
    release();
    await assert.rejects(task, /停止/);
    assert.equal(calls, 0);
  });
  test("chat history is partitioned by project and never adopts legacy global messages", () => {
    const chat = useAiChatStore.getState();
    window.localStorage.setItem(
      "protoflow_ai_chat",
      '[{"text":"legacy secret"}]',
    );
    chat.switchConversation({ projectId: "chat-A", pageId: "main" });
    chat.clearMessages(useAiChatStore.getState().conversation!);
    const id = chat.addMessage({
      projectId: "chat-A",
      role: "user",
      text: "A secret",
      pageId: "main",
      status: "done",
    });
    chat.switchConversation({ projectId: "chat-B", pageId: "main" });
    chat.clearMessages(useAiChatStore.getState().conversation!);
    assert.deepEqual(useAiChatStore.getState().messages, []);
    chat.updateMessage(id, { text: "A update" });
    assert.deepEqual(useAiChatStore.getState().messages, []);
    chat.switchConversation({ projectId: "chat-A", pageId: "main" });
    assert.equal(useAiChatStore.getState().messages[0].text, "A update");
  });
});
test("model dialog confirms the exact Hermes ID and commits only the acknowledged model", async () => {
  loadProjectFromBinaryPayload(fixture());
  let requested = "";
  const mock = mockApi({
    setModel: async ({ modelId }) => {
      requested = modelId;
      return { ...mock.session, models: { ...mock.session.models, currentModelId: modelId } };
    },
  });
  mock.session.models.availableModels.push({ modelId: "another-provider:exact/model", name: "Another model" });
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(HermesSessionControls)); });
  const trigger = () => renderer!.root.findByProps({ 'aria-label': '选择对话模型' });
  act(() => trigger().props.onClick());
  assert.equal(renderer!.root.findAllByType('dialog').length, 1);
  const radio = () => renderer!.root.findByProps({ type: 'radio', value: 'another-provider:exact/model' });
  act(() => radio().props.onChange());
  assert.equal(requested, '', 'selecting a card must not switch the real session');
  assert.equal(useHermesStore.getState().sessions[conversationKey(mock.session)].models.currentModelId, 'provider:model-a');
  await act(async () => {
    renderer!.root.findAllByType('button').find(b => b.children.includes('切换模型'))!.props.onClick();
  });
  assert.equal(requested, "another-provider:exact/model");
  assert.equal(useHermesStore.getState().sessions[conversationKey(mock.session)].models.currentModelId, requested);
  assert.equal(renderer!.root.findAllByType('dialog').length, 0);
  assert.ok(JSON.stringify(renderer!.toJSON()).includes('Another model'));
  act(() => useHermesStore.setState({ runningProjects: { [mock.session.projectId]: true } }));
  assert.equal(trigger().props.disabled, true);
  act(() => renderer!.unmount());
});

test('reasoning is bound to the selected chat and model and cannot write to a previous page', async () => {
  loadProjectFromBinaryPayload(fixture());
  const requests: unknown[] = [];
  const mock = mockApi({ reasoning: async input => {
    requests.push(input);
    return { sessionId: input.sessionId, modelId: input.modelId, current: 'high', wire: 'high', generalLevels: false, levels: ['low', 'high'] };
  } });
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(HermesSessionControls, { showReasoning: true })); });
  const request = renderer!.root.find(n => typeof n.type === 'function' && n.type.name === 'HermesReasoningPicker').props.request;
  await request();
  await request(null);
  const binding = { projectId: mock.session.projectId, pageId: mock.session.pageId, sessionId: mock.session.sessionId, modelId: 'provider:model-a' };
  assert.deepEqual(requests, [binding, { ...binding, effort: null }]);
  act(() => useHermesStore.setState({ runningProjects: { [binding.projectId]: true } }));
  await assert.rejects(request('low'), /任务结束/);
  act(() => useProtoStore.setState({ activePageId: '' }));
  await assert.rejects(request('low'), /已切换/);
  assert.equal(requests.length, 2);
  act(() => renderer!.unmount());
});

test('model dialog refreshes the same session and rejects stale project callbacks', async () => {
  loadProjectFromBinaryPayload(fixture());
  const requests: unknown[] = [];
  const mock = mockApi({ session: async request => { requests.push(request); return mock.session; } });
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(HermesSessionControls)); });
  act(() => renderer!.root.findByProps({ 'aria-label': '选择对话模型' }).props.onClick());
  await act(async () => {
    renderer!.root.findAllByType('button').find(b => b.children.includes('刷新列表'))!.props.onClick();
  });
  assert.deepEqual(requests.at(-1), { projectId: mock.session.projectId, pageId: mock.session.pageId, fresh: false, refresh: true });
  const picker = renderer!.root.find(n => typeof n.type === 'function' && n.type.name === 'HermesModelPicker');
  const staleSelect = picker.props.onSelect;
  await act(async () => { loadProjectFromBinaryPayload(fixture('different-project')); });
  assert.equal(renderer!.root.findAllByType('dialog').length, 0);
  await assert.rejects(staleSelect('provider:model-a'), /对话已变化/);
  act(() => renderer!.unmount());
});
test("a valid empty audit result renders without a fabricated issue or crash", () => {
  loadProjectFromBinaryPayload(fixture());
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(ClosedLoopAuditView));
  });
  assert.ok(JSON.stringify(renderer!.toJSON()).includes("暂无巡检记录"));
  act(() => renderer!.unmount());
});

test("canvas root selection means whole-page context and permits explicitly requested new pages", async () => {
  loadProjectFromBinaryPayload(fixture());
  mockApi({
    execute: async () => ({
      text: "已新建",
      operations: [
        {
          tool: "protoflow_apply_tsx_patch",
          args: {
            pageId: "new-page",
            title: "New",
            folderId: "folder-project-pages",
            source: page("new"),
          },
        },
      ],
      sessionId: "session-a",
      modelId: "provider:model-a",
      runId: "create-page",
    }),
  });
  const doc = parsePageSource(usePageStore.getState().pageSources.main).doc!;
  const result = await runCanvasAiWithHermes({
    prompt: "新建页面",
    doc,
    selectedPfId: doc.root.pfId,
    pageId: "main",
    dbTables: [],
    compositeBlocks: [],
  });
  assert.equal(result.createdPageId, "new-page");
  assert.equal(useProtoStore.getState().activePageId, "new-page");
});
test("clearing an old project conversation cannot erase the active project chat", () => {
  const chat = useAiChatStore.getState();
  chat.switchConversation({ projectId: "clear-A", pageId: "main" });
  chat.clearMessages(useAiChatStore.getState().conversation!);
  chat.addMessage({
    projectId: "clear-A",
    role: "user",
    text: "A",
    pageId: "main",
    status: "done",
  });
  chat.switchConversation({ projectId: "clear-B", pageId: "main" });
  chat.clearMessages(useAiChatStore.getState().conversation!);
  chat.addMessage({
    projectId: "clear-B",
    role: "user",
    text: "B",
    pageId: "main",
    status: "done",
  });
  chat.clearMessages({ projectId: "clear-A", pageId: "main" });
  assert.equal(useAiChatStore.getState().messages[0].text, "B");
  chat.switchConversation({ projectId: "clear-A", pageId: "main" });
  assert.deepEqual(useAiChatStore.getState().messages, []);
});

describe("Hermes stdio and MCP", () => {
  test("empty-project tools advertise complete nested database contracts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pflow-db-contract-"));
    const file = path.join(dir, "context.json");
    try {
      mcpFixture(file);
      const contract = mcpTools.find((t: any) => t.name === "protoflow_upsert_db_table").inputSchema.properties.table;
      assert.deepEqual(contract.properties.sharedByMenus.items.required,
        ["pageId", "menuTitle", "accessMode", "fieldMappingNote"]);
      assert.equal(contract.properties.sharedByMenus.items.type, "object");
      assert.deepEqual(callTool(file, "protoflow_get_project", {}).contracts.dbTable, contract);
      assert.deepEqual(callTool(file, "protoflow_get_contracts", {}).dbColumn,
        mcpTools.find((t: any) => t.name === "protoflow_upsert_db_column").inputSchema.properties.column);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test("invalid table/column calls leave staging untouched and corrected calls retain exact menu fields", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pflow-db-contract-"));
    const file = path.join(dir, "context.json");
    try {
      mcpFixture(file);
      const before = fs.readFileSync(file, "utf8");
      const invalid = [
        { ...table, sharedByMenus: ["material-list"] },
        { ...table, sharedByMenus: [{ ...menuRef, accessMode: "CRUD" }] },
        { ...table, sharedByMenus: [{ pageId: "material-list" }] },
        { ...table, sharedByMenus: [{ ...menuRef, pageId: " " }] },
        { ...table, sharedByMenus: [menuRef, menuRef] },
        { ...table, columns: [{ ...table.columns[0], nullable: "false" }] },
        { ...table, columns: [{ ...table.columns[0], isPrimaryKey: "true" }] },
        { ...table, columns: [table.columns[0], { ...table.columns[0], id: "other-column" }] },
      ];
      for (const candidate of invalid) {
        assert.throws(() => callTool(file, "protoflow_upsert_db_table", { table: candidate }));
        assert.equal(fs.readFileSync(file, "utf8"), before);
      }
      const valid = { ...table, sharedByMenus: [menuRef] };
      callTool(file, "protoflow_upsert_db_table", { table: valid });
      const staged = fs.readFileSync(file, "utf8");
      assert.throws(() => callTool(file, "protoflow_upsert_db_column", {
        tableId: table.id, column: { ...table.columns[0], nullable: "false" },
      }), /nullable/);
      assert.equal(fs.readFileSync(file, "utf8"), staged);
      assert.deepEqual(callTool(file, "protoflow_get_project", {}).dbTables, [valid]);
      assert.equal(JSON.parse(staged).operations.length, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test("MCP stdio returns actionable schema errors and permits recovery in the same turn", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pflow-db-contract-"));
    const file = path.join(dir, "context.json");
    try {
      mcpFixture(file);
      const valid = { ...table, sharedByMenus: [menuRef] };
      const calls = [
        { ...table, sharedByMenus: ["material-list"] }, valid,
      ].map((candidate, i) => ({ jsonrpc: "2.0", id: i + 1, method: "tools/call",
        params: { name: "protoflow_upsert_db_table", arguments: { table: candidate } } }));
      const child = spawnSync(process.execPath, [path.join(process.cwd(), "electron/protoflow-mcp.cjs"), file], {
        input: calls.map(c => JSON.stringify(c)).join("\n") + "\n", encoding: "utf8", timeout: 10000,
      });
      assert.equal(child.status, 0, child.stderr);
      const replies = child.stdout.trim().split("\n").map(line => JSON.parse(line));
      assert.equal(replies[0].result.isError, true);
      assert.match(replies[0].result.content[0].text, /table.sharedByMenus\[0\].*pageId, menuTitle, accessMode, fieldMappingNote/);
      assert.match(replies[0].result.content[0].text, /未暂存修改/);
      assert.equal(JSON.parse(replies[1].result.content[0].text).staged, true);
      assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).operations.length, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test("a blank-project list, add dialog and table binding commit together and undo together", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pflow-db-contract-"));
    const file = path.join(dir, "context.json");
    try {
      mcpFixture(file);
      const base = captureProjectPayload(), revision = projectRevision();
      callTool(file, "protoflow_upsert_db_table", { table: { ...table, sharedByMenus: [menuRef] } });
      callTool(file, "protoflow_apply_tsx_patch", {
        pageId: menuRef.pageId, title: menuRef.menuTitle,
        folderId: "folder-project-pages", source: materialSource,
      });
      const { operations } = JSON.parse(fs.readFileSync(file, "utf8"));
      const invalid = structuredClone(operations);
      invalid[0].args.table.sharedByMenus = ["material-list"];
      assert.throws(() => applyProjectChanges(base, revision, invalid, undefined, "bad-binding"), /sharedByMenus\[0\].*对象/);
      assert.equal(projectRevision(), revision);
      for (const wrongId of ["add-material", "folder-project-pages", "unknown-page"]) {
        invalid[0].args.table.sharedByMenus = [{ ...menuRef, pageId: wrongId }];
        assert.throws(() => applyProjectChanges(base, revision, invalid, undefined, "bad-binding"), /sharedByMenus.*未知页面/);
        assert.equal(projectRevision(), revision);
      }
      applyProjectChanges(base, revision, operations, undefined, "material-created");
      const after = captureProjectPayload();
      assert.deepEqual(after.stateSnapshot.dbTables[0].sharedByMenus, [menuRef]);
      assert.match(after.stateSnapshot.pageSources[menuRef.pageId], /openModal\(['"]add-material['"]\)/);
      assert.match(after.stateSnapshot.pageSources[menuRef.pageId], /submitForm\(['"]material-form['"]\)/);
      assert.equal(after.stateSnapshot.designerPages.find(p => p.pageId === menuRef.pageId)?.folderId, "folder-project-pages");
      undoProjectChange("material-created");
      assert.equal(projectRevision(), revision);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  function acpFixture() {
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    const client = new AcpClient("fake", {
      home: "/tmp",
      spawnProcess: () => child,
    });
    return { client, child };
  }
  test("ACP handles fragmented Unicode frames, RPC errors and process failure", async () => {
    const { client, child } = acpFixture();
    const reply = client.request("initialize", {}, 1000);
    const data = Buffer.from(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { name: "中文" } }) +
        "\n",
    );
    const split = data.indexOf(Buffer.from("中文")) + 1;
    child.stdout.write(data.subarray(0, split));
    child.stdout.write(data.subarray(split));
    assert.deepEqual(await reply, { name: "中文" });
    const failed = client.request("failure", {}, 1000);
    child.stdout.write('{"id":2,"error":{"message":"denied"}}\n');
    await assert.rejects(failed, /denied/);
    const pending = client.request("pending", {}, 1000);
    child.emit("error", new Error("process failed"));
    await assert.rejects(pending, /process failed/);
    assert.equal(client.pending.size, 0);
  });
  test("long project turns have no host time limit and stopping one permits a retry in the same session", async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { client, child } = acpFixture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-timeout-'));
    const events: HermesEvent[] = [];
    const runtime = new HermesRuntime({ dataDir: dir, emit: (event: HermesEvent) => events.push(event) });
    runtime.client = client;
    runtime.connect = async () => ({});
    const scope = { projectId: 'timeout', kind: 'project', threadId: 'original' };
    const input = { ...scope, prompt: '继续', workflowPhase: 'conversation', snapshot: { projectId: scope.projectId } };
    let promptId!: number;
    let cancelCount = 0;
    child.stdin.on('data', (chunk: Buffer) => {
      const { method, id, params } = JSON.parse(chunk.toString());
      if (method === 'session/new') {
        acknowledgeToolDiscovery(params);
        client.receive({ id, result: { sessionId: 'original-session', models: { currentModelId: 'm', availableModels: [] } } });
      } else if (method === 'session/prompt') {
        assert.equal(params.sessionId, 'original-session');
        promptId = id;
      } else if (method === 'session/cancel') {
        assert.equal(params.sessionId, 'original-session');
        cancelCount++;
      }
    });
    try {
      const first = runtime.execute(input);
      await new Promise(resolve => setImmediate(resolve));
      t.mock.timers.tick(24 * 60 * 60 * 1000);
      assert.equal(cancelCount, 0);
      client.receive({ id: promptId, result: { stopReason: 'end_turn' } });
      assert.equal((await first).sessionId, 'original-session');
      const stopped = assert.rejects(runtime.execute(input), /已停止/);
      await new Promise(resolve => setImmediate(resolve));
      runtime.cancel(scope);
      assert.equal(cancelCount, 1);
      const session = runtime.sessions.get(conversationKey(scope));
      assert.equal(JSON.parse(fs.readFileSync(path.join(session.dir, 'context.json'), 'utf8')).active, false);
      await assert.rejects(runtime.execute(input), /正在运行/);
      client.receive({ id: promptId, result: { stopReason: 'end_turn' } });
      await stopped;
      assert.equal(client.closed, false);
      assert.equal(session.running, false);
      const retry = runtime.execute(input);
      await new Promise(resolve => setImmediate(resolve));
      client.receive({ id: promptId, result: { stopReason: 'end_turn' } });
      assert.equal((await retry).sessionId, 'original-session');
      assert.deepEqual(events.filter(e => e.type.startsWith('run-')).map(e => e.type), ['run-start', 'run-end', 'run-start', 'run-end', 'run-start', 'run-end']);
    } finally { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test('generic ACP failure captures same-turn native throttling, numeric timings and a useful user error without replaying the turn', async () => {
    const {client,child}=acpFixture();
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pflow-native-failure-'));
    const reports:any[]=[];
    const runtime=new HermesRuntime({dataDir:dir,emit:()=>{},diagnostic:(r:any)=>reports.push(r)});
    runtime.client=client;runtime.connect=async()=>({});runtime.info={home:dir};runtime.nativeContextBridge=()=>null;
    fs.mkdirSync(path.join(dir,'logs'));
    let promptCount=0;
    const localTime=()=>{const d=new Date();const n=(v:number,w=2)=>String(v).padStart(w,'0');return `${d.getFullYear()}-${n(d.getMonth()+1)}-${n(d.getDate())} ${n(d.getHours())}:${n(d.getMinutes())}:${n(d.getSeconds())},${n(d.getMilliseconds(),3)}`;};
    child.stdin.on('data',(chunk:Buffer)=>{
      const {method,id,params}=JSON.parse(chunk.toString());
      if(method==='session/new') {acknowledgeToolDiscovery(params);client.receive({id,result:{sessionId:'native-session',models:{currentModelId:'test-model',availableModels:[]}}});}
      else if(method==='session/prompt') {
        promptCount++;
        const stamp=localTime();
        fs.writeFileSync(path.join(dir,'logs/errors.log'),`${stamp} WARNING [native-session] agent.conversation_loop: API call failed attempt 3/3: Rate limit reached tokens per min (TPM): Limit 1000000, Used 625675, Requested 440588. Please try again in 3.976s. private-content\n${stamp} ERROR [native-session] agent.conversation_loop: API call failed after 3 retries. provider=private msgs=219 tokens=~514,092\n`);
        client.receive({id,error:{code:-32603,message:'Internal error',data:{secret:'private-content'}}});
      }
    });
    try {
      await assert.rejects(runtime.execute({projectId:'failure-test',kind:'project',threadId:'thread-A',workflowPhase:'conversation',prompt:'private-content',snapshot:{projectId:'failure-test'}}),(error:any)=>{assert.match(error.message,/Token 限流/);assert.equal(error.rpcCode,-32603);return true;});
      assert.equal(promptCount,1);
      const report=reports.find(r=>r.code==='AI_RUNTIME_FAILED');assert.ok(report);
      assert.equal(report.context.failure.reason,'rate-limit');assert.equal(report.context.failure.tokensRequested,440588);
      assert.equal(report.context.sessionId,'native-session');assert.ok(report.context.runId);assert.ok(report.context.metrics.totalExecuteMs>=0);assert.equal(report.context.metrics.failedToolCallCount,0);
      assert.equal(report.context.checks[0].status,'-32603');assert.ok(!JSON.stringify(report).includes('private-content'));
    } finally {runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
  });
  test("an unacknowledged stop resets the connection once and ignores late frames", async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { client } = acpFixture();
    const resets: string[] = [];
    client.on('disconnect', (_message: string, reason: string) => resets.push(reason));
    client.on('notification', () => assert.fail('closed transport forwarded a late frame'));
    const scope = { sessionId: 'session-hung' };
    const handshake = assert.rejects(client.request('initialize', {}, 50), /超时/);
    const failed = assert.rejects(client.request('session/prompt', scope, null), /未响应停止/);
    t.mock.timers.tick(50);
    await handshake;
    client.notify('session/cancel', scope);
    assert.equal(client.closed, false);
    t.mock.timers.tick(5000);
    await failed;
    client.receive({ method: 'session/update', params: scope });
    client.close();
    assert.deepEqual(resets, ['connection-lost']);
    assert.equal(client.pending.size, 0);
  });
  test("MCP stages exact IDs, returns staged reads, rejects read-only and inactive turns", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pflow-mcp-test-")),
      file = path.join(dir, "context.json");
    try {
      const context = {
        active: true,
        runId: "run",
        projectId: "project",
        snapshot: {
          pageSources: { main: page("before") },
          designerPages: [],
          dbTables: [structuredClone(table)],
          stickyNotes: [],
          closedLoopIssues: [],
        },
        operations: [],
      };
      atomicWrite(file, context);
      callTool(file, "protoflow_get_project", {});
      assert.throws(
        () =>
          callTool(file, "protoflow_upsert_db_column", {
            tableId: "actual_table",
            column: { id: "c" },
          }),
        /Unknown tableId/,
      );
      callTool(file, "protoflow_apply_tsx_patch", {
        pageId: "main",
        source: page("after"),
      });
      assert.match(
        callTool(file, "protoflow_get_page_tsx", { pageId: "main" }).source,
        /after/,
      );
      assert.equal(
        JSON.parse(fs.readFileSync(file, "utf8")).operations.length,
        1,
      );
      atomicWrite(file, { ...context, readOnly: true });
      assert.throws(
        () => callTool(file, "protoflow_run_closed_loop_audit", { issues: [] }),
        /read-only/,
      );
      atomicWrite(file, { ...context, active: false });
      assert.throws(
        () => callTool(file, "protoflow_get_project", {}),
        /No active/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test("runtime serializes session creation, isolates project IDs and passes selected model verbatim", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pflow-runtime-test-"));
    const runtime = new HermesRuntime({ dataDir: dir, emit: () => {} });
    const calls: any[] = [];
    let count = 0;
    runtime.settings = { home: "/custom/hermes", binary: "/custom/bin/hermes" };
    runtime.connect = async () => ({});
    runtime.client = {
      request: async (method: string, args: any) => {
        acknowledgeToolDiscovery(args);
        calls.push({ method, args });
        await Promise.resolve();
        if (method === "session/new")
          return {
            sessionId: `s-${++count}`,
            models: {
              currentModelId: "provider:a",
              availableModels: [
                { modelId: "provider:a", name: "A" },
                { modelId: "provider:b", name: "B" },
              ],
            },
          };
        if (method === "session/load")
          return {
            models: {
              currentModelId: "provider:b",
              availableModels: [{ modelId: "provider:b", name: "B" }],
            },
          };
        return {};
      },
      close: () => {},
    };
    try {
      const [a, b] = await Promise.all([
        runtime.session({ projectId: "A", pageId: "main" }),
        runtime.session({ projectId: "A", pageId: "main" }),
      ]);
      assert.equal(a.sessionId, b.sessionId);
      assert.equal(count, 1);
      const other = await runtime.session({ projectId: "B", pageId: "main" });
      assert.notEqual(other.sessionId, a.sessionId);
      assert.notEqual(runtime.workspace("A"), runtime.workspace("B"));
      assert.equal(calls[0].args.mcpServers[0].name, "protoflow");
      await assert.rejects(
        runtime.setModel({ projectId: "A", pageId: "main", modelId: "guessed" }),
        /模型/,
      );
      const selected = await runtime.setModel({
        projectId: "A",
        pageId: "main",
        modelId: "provider:b",
      });
      assert.equal(selected.models.currentModelId, "provider:b");
      const refreshed = await runtime.session({ projectId: 'A', pageId: 'main', refresh: true });
      assert.equal(refreshed.sessionId, a.sessionId);
      assert.equal(count, 2, 'refresh must load the same conversation, not create a new one');
      assert.equal(calls.at(-1).method, 'session/load');
      runtime.sessions.get(conversationKey({ projectId: 'A', pageId: 'main' })).running = true;
      await assert.rejects(runtime.session({ projectId: 'A', pageId: 'main', refresh: true }), /任务/);
      runtime.sessions.get(conversationKey({ projectId: 'A', pageId: 'main' })).running = false;
      assert.equal(
        calls.find((c) => c.method === "session/set_model").args.modelId,
        "provider:b",
      );
      await runtime.sync({
        projectId: "A",
        skillMarkdown: "local instructions",
      });
      assert.equal(
        fs.readFileSync(path.join(runtime.workspace("A"), "AGENTS.md"), "utf8"),
        "local instructions",
      );
    } finally {
      runtime.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test("guarded model changes ask the user while idle and clean up cancelled or failed confirmations", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-model-permission-'));
    const events: HermesEvent[] = [];
    const runtime = new HermesRuntime({ dataDir: dir, emit: (event: HermesEvent) => events.push(event) });
    const scope = { projectId: 'model-permission', kind: 'project', threadId: 'original' };
    let currentModelId = 'provider:a', requestId = 0;
    let resolveSwitch: () => void, rejectSwitch: (error: Error) => void;
    const rejected: number[] = [];
    const replies: any[] = [];
    const models = () => ({ currentModelId, availableModels: ['provider:a', 'provider:b'].map(modelId => ({ modelId, name: modelId })) });
    runtime.connect = async () => ({});
    runtime.client = {
      close() {},
      reject: (id: number) => rejected.push(id),
      reply: (id: number, result: any) => {
        replies.push({ id, result });
        if (id !== requestId) return;
        if (result.outcome.optionId === 'allow_once') { currentModelId = 'provider:b'; resolveSwitch(); }
        else rejectSwitch(new Error('model_switch_cancelled'));
      },
      request: async (method: string, params: any) => {
        acknowledgeToolDiscovery(params);
        if (method === 'session/new' || method === 'session/load') return { sessionId: 's-model', models: models() };
        assert.equal(method, 'session/set_model');
        assert.equal(params.sessionId, 's-model');
        assert.equal(params.modelId, 'provider:b');
        return new Promise<void>((resolve, reject) => {
          resolveSwitch = resolve; rejectSwitch = reject;
          const activeOpId = runtime.sessions.get(conversationKey(scope))?.activeModelOp?.opId;
          runtime.onRequest({ method: 'session/request_permission', id: ++requestId, params: {
            sessionId: 's-model',
            _meta: { alex_control_kind: 'model_switch', alex_model_op_id: activeOpId },
            toolCall: { title: '确认切换模型', content: [{ type: 'content', content: { type: 'text', text: '目标模型的上下文较小。' } }] },
            options: [{ optionId: 'allow_once', kind: 'allow_once', name: '仍然切换' }, { optionId: 'deny', kind: 'reject_once', name: '取消切换' }],
          } });
        });
      },
    };
    try {
      await runtime.session(scope);
      const session = runtime.sessions.get(conversationKey(scope));
      session.cancelled = true; // A stopped earlier generation must not prevent an idle model pick.
      const input = { ...scope, modelId: 'provider:b' };
      for (const optionId of ['deny', null]) {
        const failure = assert.rejects(runtime.setModel(input), /model_switch_cancelled/);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(session.running, false);
        assert.equal(runtime.permissions.size, 1);
        assert.equal(session.models.currentModelId, 'provider:a');
        assert.deepEqual(events.at(-1)?.toolCall?.content, [{ type: 'content', content: { type: 'text', text: '目标模型的上下文较小。' } }]);
        runtime.respondPermission({ id: String(requestId), optionId });
        await failure;
        assert.equal(runtime.permissions.size, 0);
        assert.equal(session.models.currentModelId, 'provider:a');
      }
      const failure = assert.rejects(runtime.setModel(input), /切换请求失败/);
      await new Promise(resolve => setImmediate(resolve));
      rejectSwitch!(new Error('切换请求失败'));
      await failure;
      assert.equal(runtime.permissions.size, 0);
      assert.deepEqual(replies.at(-1).result, { outcome: { outcome: 'cancelled' } });
      const success = runtime.setModel(input);
      await new Promise(resolve => setImmediate(resolve));
      assert.throws(() => runtime.respondPermission({ id: String(requestId), optionId: 'guessed' }), /无效授权/);
      runtime.respondPermission({ id: String(requestId), optionId: 'allow_once' });
      const selected = await success;
      assert.equal(selected.sessionId, 's-model');
      assert.equal(selected.models.currentModelId, 'provider:b');
      assert.equal(runtime.permissions.size, 0);
      runtime.onRequest({ method: 'session/request_permission', id: 99, params: { sessionId: 's-model' } });
      assert.deepEqual(rejected, [99], 'an unrelated permission on an idle session is still rejected');
    } finally { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test("cancel invalidates MCP writes immediately and releases pending authorization", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pflow-cancel-test-"));
    const events: any[] = [],
      replies: any[] = [];
    const runtime = new HermesRuntime({
      dataDir: dir,
      emit: (e: any) => events.push(e),
    });
    runtime.client = {
      notify: () => {},
      reply: (...a: any[]) => replies.push(a),
      close: () => {},
    };
    const session = {
      projectId: "A",
      pageId: "main",
      sessionId: "s",
      running: true,
      runId: "r",
      boundAdmissionId: null,
      dir,
      models: { currentModelId: "m" },
    };
    runtime.sessions.set(conversationKey(session), session);
    try {
      atomicWrite(path.join(dir, "context.json"), {
        active: true,
        runId: "r",
        projectId: "A",
      });
      runtime.onRequest({
        id: 5,
        method: "session/request_permission",
        params: {
          sessionId: "s",
          _meta: { alex_control_kind: "turn", alex_run_id: "r", admission_id: "aid-cancel-1" },
          options: [{ optionId: "yes", name: "允许" }],
          toolCall: { title: "edit" },
        },
      });
      assert.equal(replies.length, 0);
      runtime.cancel({ projectId: "A", pageId: "main" });
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(dir, "context.json"), "utf8"))
          .active,
        false,
      );
      assert.deepEqual(replies[0], [5, { outcome: { outcome: "cancelled" } }]);
      assert.ok(events.some((e) => e.type === "permission-resolved"));
    } finally {
      runtime.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("Hermes clarification accepts exact free text and validates offered choices", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pflow-question-test-"));
  const replies: any[] = [];
  const events: any[] = [];
  const runtime = new HermesRuntime({
    dataDir: dir,
    emit: (e: any) => events.push(e),
  });
  runtime.client = {
    reply: (...args: any[]) => replies.push(args),
    close: () => {},
    reject: () => {
      throw Error("unexpected reject");
    },
  };
  runtime.sessions.set(conversationKey({ projectId: "A", pageId: "main" }), { projectId: "A", pageId: "main", sessionId: "s", runId: "r-q", boundAdmissionId: null, running: true });
  const request = (id: number, schema: object) =>
    runtime.onRequest({
      id,
      method: "elicitation/create",
      params: {
        sessionId: "s",
        _meta: { alex_control_kind: "turn", alex_run_id: "r-q", admission_id: "aid-q-1" },
        mode: "form",
        message: "需要什么字段？",
        requestedSchema: {
          type: "object",
          properties: { answer: schema },
          required: ["answer"],
        },
      },
    });
  try {
    request(1, { type: "string" });
    assert.equal(replies.length, 0);
    runtime.respondQuestion({ id: "1", answer: "使用真实业务 ID" });
    assert.deepEqual(replies[0], [
      1,
      { action: "accept", content: { answer: "使用真实业务 ID" } },
    ]);
    request(2, { type: "array", items: { type: "string", enum: ["A", "B"] } });
    assert.throws(
      () => runtime.respondQuestion({ id: "2", answer: ["guessed"] }),
      /选项/,
    );
    runtime.respondQuestion({ id: "2", answer: ["B"] });
    assert.deepEqual(replies[1], [
      2,
      { action: "accept", content: { answer: ["B"] } },
    ]);
    request(3, { type: "string", enum: ["确认方案", "需要调整"] });
    runtime.respondQuestion({ id: "3", answer: "需要调整", supplement: "先生成采购模块" });
    assert.deepEqual(replies[2], [3, { action: "accept", content: { answer: "选择：需要调整\n补充说明：先生成采购模块" } }]);
    request(4, { type: "array", items: { type: "string", enum: ["A", "B"] } });
    assert.throws(() => runtime.respondQuestion({ id: "4", answer: ["guessed"], supplement: "说明" }), /选项/);
    runtime.respondQuestion({ id: "4", answer: [], supplement: "自定义范围" });
    assert.deepEqual(replies[3], [4, { action: "accept", content: { answer: ["自定义范围"] } }]);
    request(5, { type: "string", enum: ["A", "B"] });
    assert.throws(() => runtime.respondQuestion({ id: "5", answer: null, supplement: "确认" }), /补充说明/);
    assert.throws(() => runtime.respondQuestion({ id: "5", answer: "", supplement: "  " }), /补充说明/);
    runtime.respondQuestion({ id: "5", answer: null });
    assert.deepEqual(replies[4], [5, { action: "cancel" }]);
    assert.ok(events.some((e) => e.type === "question-resolved"));
  } finally {
    runtime.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clarify progress follows the complete native batch, advances only after an answer, and resets per call and run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-question-progress-'));
  const events: any[] = [];
  const runtime = new HermesRuntime({ dataDir: dir, emit: (event: any) => events.push(event) });
  runtime.client = { reply() {}, close() {}, reject() { throw Error('unexpected rejection'); } };
  const session: any = { projectId: 'A', pageId: 'main', sessionId: 's', runId: 'run-1', boundAdmissionId: null, running: true };
  runtime.sessions.set(conversationKey(session), session);
  const metaFor = (sessionId: string) => {
    const target = [...runtime.sessions.values()].find((item: any) => item.sessionId === sessionId);
    return { alex_control_kind: 'turn', alex_run_id: target.runId, admission_id: `aid-${sessionId}-${target.runId}` };
  };
  const update = (value: any) => runtime.onNotification({ method: 'session/update', params: { sessionId: 's', _meta: metaFor('s'), update: value } });
  const ask = (id: string, message: string, sessionId = 's') => {
    runtime.onRequest({ id, method: 'elicitation/create', params: { sessionId, _meta: metaFor(sessionId), mode: 'form', message,
      requestedSchema: { properties: { answer: { type: 'string' } } } } });
    return events.at(-1);
  };
  try {
    // Actual Hermes builds this JSON content block for clarify (rawInput may be null).
    update({ sessionUpdate: 'tool_call', toolCallId: 'batch-1', title: 'clarify: questions', rawInput: null,
      content: [{ type: 'content', content: { type: 'text', text: JSON.stringify({ questions: ['角色？', '流程？', '页面？'].map(question => ({ question })) }) } }] });
    assert.deepEqual(ask('q1', '角色？').progress, { batchId: 'batch-1', current: 1, total: 3 });
    assert.throws(() => runtime.respondQuestion({ id: 'q1', answer: '' }), /有效答案/);
    assert.deepEqual(ask('q1', '角色？').progress, { batchId: 'batch-1', current: 1, total: 3 });
    runtime.respondQuestion({ id: 'q1', answer: '采购员' });
    assert.deepEqual(ask('q2', '流程？').progress, { batchId: 'batch-1', current: 2, total: 3 });
    runtime.respondQuestion({ id: 'q2', answer: null });
    assert.deepEqual(ask('q3', '页面？').progress, { batchId: 'batch-1', current: 3, total: 3 });
    runtime.respondQuestion({ id: 'q3', answer: '三个页面' });
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'batch-1', status: 'completed' });
    update({ sessionUpdate: 'tool_call', toolCallId: 'batch-2', title: 'clarify', rawInput: { questions: [{ question: '确认方案？' }] } });
    assert.deepEqual(ask('q4', '确认方案？').progress, { batchId: 'batch-2', current: 1, total: 1 });
    runtime.respondQuestion({ id: 'q4', answer: '确认' });
    session.runId = 'run-2';
    session.boundAdmissionId = null;
    assert.equal(ask('q5', '确认方案？').progress, undefined);
    runtime.respondQuestion({ id: 'q5', answer: null });
    update({ sessionUpdate: 'tool_call', toolCallId: 'batch-3', title: 'clarify', rawInput: { questions: [{ question: '补充？' }] } });
    runtime.sessions.set(conversationKey({ projectId: 'B', pageId: 'main' }), { projectId: 'B', pageId: 'main', sessionId: 'other', runId: 'run-2', boundAdmissionId: null, running: true });
    assert.equal(ask('q6', '补充？', 'other').progress, undefined);
    runtime.respondQuestion({ id: 'q6', answer: null });
    assert.deepEqual(ask('q7', '补充？').progress, { batchId: 'batch-3', current: 1, total: 1 });
    runtime.respondQuestion({ id: 'q7', answer: '无' });
  } finally { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("safe edits on the full sample project preserve pre-existing contracts", () => {
  const blank = fixture();
  blank.meta.templateId = "customs_erp";
  loadProjectFromBinaryPayload(createProjectPayload(blank.meta));
  const base = captureProjectPayload(),
    source = base.stateSnapshot.pageSources["acceptance-new"];
  const doc = parsePageSource(source).doc!;
  doc.root.props.title = "Changed title";
  assert.doesNotThrow(() =>
    prepareProjectChanges(base, [
      patch(printPageSource(doc), "acceptance-new"),
    ]),
  );
});
