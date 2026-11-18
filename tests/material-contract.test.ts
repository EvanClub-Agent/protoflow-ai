import { mobileOptions } from '../src/proto/mobile/options';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parsePageSource } from '../src/proto/dsl/parser';
import { printPageSource } from '../src/proto/dsl/printer';
import { getMaterialContracts, validateMaterialSource } from '../src/proto/registry/materialContract';
import { MOBILE_COMPONENT_NAMES, OVERLAY_TYPES } from '../src/proto/registry/meta';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { generateAiSystemPrompt, validatePageDoc } from '../src/proto/ai/assistant';
import { buildProtoFlowHermesSkillMarkdown } from '../src/store/useHermesStore';
import { createProjectPayload, captureProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { pageContractErrors, prepareProjectChanges, projectContext, projectRevision } from '../src/services/hermesProject';
import type { HermesOperation } from '../src/services/hermesClient';
import type { ProtoNode } from '../src/proto/types';

const native = require(path.join(process.cwd(), 'electron/generated/material-contract.cjs'));
const { callTool, atomicWrite } = require(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
const source = (body: string) => `export default function Page(){return <Page pfId="root">${body}</Page>}`;
const mobileSource = (body: string) => `export default function Page(){return <MobilePage pfId="root">${body}</MobilePage>}`;
const canonical = (body: string, mobile = false) => printPageSource(parsePageSource((mobile ? mobileSource : source)(body)).doc!);
const patch = (code: string): HermesOperation => ({ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'main', source: code } });
function fixture() {
  const payload = createProjectPayload({ projectId: 'material-contract', projectName: '契约测试', templateId: 'blank_project', storageDir: '/tmp/material-contract', fileName: 'contract.pflow', createdAt: '2026-10-31', updatedAt: '2026-10-31', pageCount: 0, tableCount: 0, stickyCount: 0 });
  payload.stateSnapshot.designerFolders = [{ id: 'folder-project-pages', title: '测试目录', parentFolderId: null }];
  payload.stateSnapshot.pageSources = { main: source('<Text pfId="text">原有内容</Text>') };
  payload.stateSnapshot.designerPages = [{ pageId: 'main', title: '测试页面', folderId: 'folder-project-pages' }];
  payload.stateSnapshot.activePageId = 'main';
  return payload;
}

test('every material contract is identical in the renderer and native MCP; complete snippets pass', () => {
  assert.deepEqual(native.getMaterialContracts(), getMaterialContracts());
  for (const contract of getMaterialContracts()) {
    const props = contract.props;
    assert.equal(new Set(props.map((p) => p.name)).size, props.length, contract.name);
    assert.ok(props.every((p) => p.valueSchema), contract.name);
    let body = contract.snippet;
    const isMobile = MOBILE_COMPONENT_NAMES.has(contract.name);
    if (contract.name === 'Page') body = '<Text>页面</Text>';
    else if (contract.name === 'MobilePage') body = '<MButton>开始</MButton>';
    else if (contract.parents && !OVERLAY_TYPES.has(contract.name)) body = `<${contract.parents[0]}>${body}</${contract.parents[0]}>`;
    // Palette placeholders become explicit, valid references before AI submission.
    if (contract.name === 'Table') body = body.replace(' table=""', '');
    if (contract.name === 'PickerInput') body = body.replace('overlay=""', 'overlay="picker"') + '<Modal id="picker" />';
    const code = canonical(body, isMobile);
    assert.deepEqual(validateMaterialSource(code), [], contract.name);
    assert.deepEqual(native.validateMaterialSource(code), [], contract.name);
  }
});

test('invented props, native Ant Design APIs, bad types/enums and ignored structures fail in both gates', () => {
  const cases: [string, RegExp][] = [
    ['<InputNumber pfId="x" />', /未知组件/],
    ['<Button pfId="x" htmlType="submit">保存</Button>', /htmlType.*未注册/],
    ['<Table pfId="x" dataSource={[]} />', /dataSource.*未注册/],
    ['<Select pfId="x" fieldNames={{label:"name",value:"id"}} />', /fieldNames.*未注册/],
    ['<Select pfId="x" size="huge" />', /size.*仅允许/],
    ['<Input pfId="x" disabled="false" />', /disabled.*boolean/],
    ['<Rate pfId="x" count={0} />', /count.*≥ 1/],
    ['<Modal pfId="x" id="modal" width="1/2" />', /width.*number/],
    ['<Card pfId="x" width={400} />', /width.*string/],
    ['<Button pfId="x" onChange={() => toast("x")}>按钮</Button>', /onChange.*未注册/],
    ['<Button pfId="x" onClick="submitForm">按钮</Button>', /onClick.*actions/],
    ['<Text pfId="x" text="看不到" />', /text.*未注册/],
    ['<Input pfId="x"><Text pfId="y">被忽略</Text></Input>', /children.*不接受子组件/],
    ['<Tabs pfId="x"><Card pfId="y" /></Tabs>', /只接受 Tab/],
    ['<CollapsePanel pfId="x" />', /只能放在 Collapse/],
    ['<Card pfId="x"><Drawer pfId="y" id="drawer" /></Card>', /parent.*Page/],
    ['<Form pfId="x"><Input pfId="y" /></Form>', /name.*显式/],
    ['<Form pfId="x" fields={[{name:"a"}]}><Input pfId="y" name="a" /></Form>', /fields.*同时/],
    ['<Form pfId="x" fields={[{name:"a",imaginary:true}]} />', /imaginary.*未注册/],
    ['<Form pfId="x" fields={[{name:"a",type:"date",picker:"year",showTime:true}]} />', /fields\[0\].showTime/],
    ['<Form pfId="x" fields={[{name:"a",type:"select",options:[0,0]}]} />', /fields\[0\].options.*value 重复/],
    ['<Form pfId="x" fields={[{name:"a",type:"picker",overlay:"missing"}]} />', /fields\[0\].overlay.*不存在/],
    ['<Form pfId="x" fields={[{name:"a"},{name:"a"}]} />', /fields\[1\].name.*重复/],
    ['<QueryForm pfId="x" fields={[{name:"a",required:true}]} />', /required.*未注册/],
    ['<QueryForm pfId="x" controlMaxWidth={0} />', /controlMaxWidth.*≥ 1/],
    ['<QueryForm pfId="x" rangeMaxWidth="320px" />', /rangeMaxWidth.*number/],
    ['<QueryForm pfId="x" fields={[{name:"a",width:"full"}]} />', /width.*未注册/],
    ['<Table pfId="x" columns={[{dataIndex:"id",title:"编号",ellipsis:true}]} />', /columns\[0\].ellipsis.*未注册/],
    ['<Select pfId="x" options={[{label:"显示名",id:"wrong"}]} />', /options\[0\].value/],
    ['<TreeSelect pfId="x" options={[{label:"父",value:"p",children:[{label:"子",code:"wrong"}]}]} />', /children\[0\].value/],
    ['<Select pfId="x" options={[{label:"A",value:0},{label:"B",value:0}]} />', /value 重复/],
    ['<AutoComplete pfId="x" options={[{label:"数字",value:1}]} />', /value.*string/],
    ['<DatePicker pfId="x" picker="year" showTime />', /showTime.*粒度/],
    ['<Slider pfId="x" min={20} max={10} />', /min.*不能大于/],
    ['<Button pfId="x" onClick={() => toast("a","invented")}>按钮</Button>', /仅允许/],
    ['<Button pfId="x" onClick={() => closeOverlay("extra")}>按钮</Button>', /最多接受 0/],
    ['<Button pfId="x" onClick={() => openModal("d")}>按钮</Button><Drawer pfId="d" id="d" />', /必须是 Modal/],
    ['<Button pfId="x" onClick={() => refresh("missing")}>按钮</Button>', /必须是 Table/],
    ['<Button pfId="x" onClick={(event) => toast("x")}>按钮</Button>', /动态表达式/],
    ['<Button pfId="x" onClick={{$kind:"actions",calls:1}}>按钮</Button>', /calls 数组/],
    ['<Button pfId="x" onClick={{$kind:"actions",calls:[{name:"toast",args:1}]}}>按钮</Button>', /args 数组/],
  ];
  for (const [body, error] of cases) {
    const code = source(body);
    assert.match(validateMaterialSource(code).join('\n'), error, body);
    assert.deepEqual(native.validateMaterialSource(code), validateMaterialSource(code));
  }
});

test('the strict parser rejects duplicate, spread, computed and discarded source before canonical printing', () => {
  const cases = [
    source('<Button pfId="x" size="small" size="large">按钮</Button>'),
    source('<Select pfId="x" options={[{label:"A",value:"first",value:"second"}]} />'),
    source('<Button pfId="x" {...props}>按钮</Button>'),
    source('<Select pfId="x" options={[{label:"A",["value"]:"a"}]} />'),
    source('<Text pfId="x">{someValue}</Text>'),
    source('<Card pfId="x">{...children}</Card>'),
    source('<Text pfId=" ">空白标识</Text>'),
    source('<Text>缺少稳定标识</Text>'),
    source('<Text pfId="x">A</Text><Text pfId="x">B</Text>'),
    `import {Button} from 'antd'; ${source('<Button pfId="x">按钮</Button>')}`,
    'export default function Page(){const ignored=1;return <Page pfId="p"/>}',
    'export default function Page(){"ignored directive";return <Page pfId="p"/>}',
    'export default function Page(){return <><Page pfId="p"/><Unknown pfId="x"/></>}',
  ];
  for (const code of cases) {
    assert.ok(validateMaterialSource(code).length > 0, code);
    assert.deepEqual(native.validateMaterialSource(code), validateMaterialSource(code));
    assert.throws(() => prepareProjectChanges(fixture(), [patch(code)]));
  }
});

test('supported structured options, field objects, layout and action chains survive save/reparse', () => {
  const code = canonical(`<Card width="1/2"><Form cols={2} fields={[{name:"enabled",type:"select",options:[{label:"启用",value:0,disabled:false}],allowClear:true,onChange:()=>toast("已选择")},{name:"date",type:"date",picker:"datetime"}]} /></Card>
    <TreeSelect name="department" options={[{label:"研发",value:"rd",children:[{label:"前端",value:"web"}]}]} />
    <Table pfId="table" columns={[{title:"编号",dataIndex:"id",width:100,sortable:true}]} rowActions={[{label:"查看",onClick:()=>openDrawer("detail")}]} />
    <Drawer id="detail"><Descriptions items={[{label:"数量",value:0}]} /></Drawer>`);
  assert.deepEqual(validateMaterialSource(code), []);
  const result = prepareProjectChanges(fixture(), [patch(code)]);
  assert.deepEqual(parsePageSource(result.next.stateSnapshot.pageSources.main).doc, parsePageSource(code).doc);
});

test('built-in pages use the same material contract supplied to AI', () => {
  const project = createProjectPayload({ ...fixture().meta, templateId: 'customs_erp' });
  for (const [pageId, code] of Object.entries(project.stateSnapshot.pageSources)) {
    assert.deepEqual(validateMaterialSource(code), [], pageId);
  }
});

test('mobile starter & hybrid projects, cross-platform isolation, and published mobile snapshots pass strict contracts', () => {
  const mobileProj = createProjectPayload({
    ...fixture().meta,
    projectId: 'mobile-starter-test',
    projectName: 'Nova 现代移动应用',
    templateId: 'mobile_starter',
    projectMode: 'mobile',
  });
  assert.equal(mobileProj.meta.projectMode, 'mobile');
  assert.equal(mobileProj.stateSnapshot.designerPages.length, 4);
  for (const [pageId, code] of Object.entries(mobileProj.stateSnapshot.pageSources)) {
    assert.deepEqual(validateMaterialSource(code), [], pageId);
    assert.deepEqual(pageContractErrors(code, mobileProj.stateSnapshot.dbTables), [], pageId);
  }

  // Cross-platform mixing must be rejected in both gates
  const pcInMobile = canonical('<Table pfId="t" />', true);
  assert.match(validateMaterialSource(pcInMobile).join('\n'), /不能混用 PC 管理端组件/);
  const mobileInPc = canonical('<MTopBar pfId="m" title="顶栏" />', false);
  assert.match(validateMaterialSource(mobileInPc).join('\n'), /不能混用 M\* 移动端物料/);

  // Publishing a mobile project produces a valid PublishedSnapshot
  loadProjectFromBinaryPayload(mobileProj);
  const pub = createPublishedSnapshot('mob-explore');
  assert.equal(pub.entryPageId, 'mob-explore');
  assert.ok(pub.pages.every((p) => p.doc.root.type === 'MobilePage'));
});

test('mobile picker never substitutes row identity, synthetic options or the wrong scalar type', () => {
  const [table] = createProjectPayload({ ...fixture().meta, templateId: 'mobile_starter' }).stateSnapshot.dbTables;
  const binding = { table, rows: [{ id: 'catalog-1', item_name: '商品', spec: 0 }], labelField: 'item_name', valueField: 'spec' };
  assert.deepEqual(mobileOptions(undefined, binding).options, [{ label: '商品', value: 0 }]);
  assert.deepEqual(mobileOptions('不应作为来源', { ...binding, rows: [] }), { options: [] });
  assert.match(mobileOptions(undefined, { ...binding, rows: [{ id: 'catalog-1', item_name: '商品' }] }).issue!, /spec/);
  assert.match(mobileOptions(undefined, { ...binding, valueField: undefined }).issue!, /存储字段/);
  assert.deepEqual(mobileOptions([{ label: '停用', value: 0, disabled: true }]).options, [{ label: '停用', value: 0, disabled: true }]);
});

test('host diagnostics report malformed action literals without crashing on historical pages', () => {
  const code = source('<Button pfId="x" onClick={{$kind:"actions",calls:null}}>按钮</Button>');
  assert.match(pageContractErrors(code, []).join('\n'), /calls 数组/);
  assert.ok(validatePageDoc(parsePageSource(code).doc!, []).some((issue) => issue.message.includes('calls 数组')));
});

test('the host rejects changed-page violations even if the same invalid property already existed', () => {
  const base = fixture();
  base.stateSnapshot.pageSources.legacy = source('<Text pfId="legacy" text="历史无效属性" />');
  base.stateSnapshot.designerPages.push({ pageId: 'legacy', title: '历史页', folderId: 'folder-project-pages' });
  assert.doesNotThrow(() => prepareProjectChanges(base, [patch(source('<Text pfId="text">有效更新</Text>'))]));
  base.stateSnapshot.pageSources.main = source('<Button pfId="x" imaginary="old">旧内容</Button>');
  loadProjectFromBinaryPayload(base);
  const before = projectRevision();
  assert.throws(() => prepareProjectChanges(captureProjectPayload(), [patch(source('<Button pfId="x" imaginary="new">新内容</Button>'))]), /imaginary.*未注册/);
  assert.equal(projectRevision(), before);
});

test('AI instructions and inspector diagnostics expose the exact material restrictions', () => {
  const prompt = generateAiSystemPrompt([]);
  assert.match(prompt, /size\?:"small"\|"middle"\|"large"/);
  assert.match(prompt, /Ant Design 官网.*不代表本项目/);
  assert.match(prompt, /valueSchema/);
  assert.match(prompt, /父级仅 Collapse/);
  assert.match(buildProtoFlowHermesSkillMarkdown([], [], []), /不能凭空编造/);
  const doc = parsePageSource(source('<Input pfId="x" mystery />')).doc!;
  assert.ok(validatePageDoc(doc, []).some((issue) => issue.severity === 'error' && issue.message.includes('mystery')));
  const node = doc.root.children[0] as ProtoNode;
  assert.equal(node.props.mystery, true, 'validator must not delete unsupported properties to disguise failure');
});

test('AI generation surfaces discover the current Table contract and can stage each supplied example', () => {
  for (const instructions of [generateAiSystemPrompt([]), buildProtoFlowHermesSkillMarkdown([], [], []), buildProtoFlowHermesSkillMarkdown([], [], [], 'project')]) {
    assert.match(instructions, /protoflow_get_contracts\(\{componentNames:\["Table"\]\}\)/);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-table-discovery-'));
  const file = path.join(dir, 'context.json');
  try {
    loadProjectFromBinaryPayload(fixture());
    const snapshot = projectContext();
    // A resumed conversation may carry the catalogue from before the material upgrade.
    atomicWrite(file, { active:true, runId:'table-examples', projectId:'material-contract', operations:[], snapshot:{ ...snapshot, contracts:{ ...snapshot.contracts, components:[] } } });
    const [table] = callTool(file, 'protoflow_get_contracts', { componentNames:['Table'] }).components;
    const examples = table.examples as { title:string; tsx:string }[];
    const configs = examples.map(example => {
      const code = source(example.tsx);
      assert.deepEqual(pageContractErrors(code, [], { tableRows:{} }), [], example.title);
      assert.equal(callTool(file, 'protoflow_apply_tsx_patch', { pageId:'main', source:code }).staged, true);
      return (parsePageSource(code).doc!.root.children[0] as ProtoNode).props;
    });
    assert.ok(configs.some(p => p.rowMode === 'tree' && p.parentField && p.treeKeyField));
    assert.ok(configs.some(p => p.rowMode === 'expandable' && Array.isArray(p.detailFields)));
    assert.ok(configs.some(p => Array.isArray(p.cellMerges)));
    const columns = configs.flatMap(p => Array.isArray(p.columns) ? p.columns : []) as Record<string, unknown>[];
    assert.ok(columns.some(c => c.mergeRows === true));
    const editors = table.props.find((p: {name:string}) => p.name === 'columns').valueSchema.items.properties.editor.enum;
    assert.deepEqual(new Set(columns.map(c => c.editor).filter(Boolean)), new Set(editors));
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});

test('MCP rejects invalid source without staging and accepts a corrected retry in the same turn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-contract-'));
  const file = path.join(dir, 'context.json');
  try {
    loadProjectFromBinaryPayload(fixture());
    atomicWrite(file, { active: true, runId: 'test', projectId: 'material-contract', snapshot: projectContext(), operations: [] });
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => callTool(file, 'protoflow_apply_tsx_patch', { pageId: 'new', title: '新页', folderId: 'folder-project-pages', source: source('<Button pfId="x" invented />') }), /x <Button>.invented.*未注册/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    const sourceCode = source('<Button pfId="x" loading={false} size="small">按钮</Button>');
    assert.equal(callTool(file, 'protoflow_apply_tsx_patch', { pageId: 'main', source: sourceCode }).staged, true);
    const context = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(context.operations.length, 1);
    assert.equal(context.snapshot.pageSources.main, sourceCode);
    const declared = callTool(file, 'protoflow_get_contracts', { componentNames: ['Select', 'TreeSelect', 'Collapse'] });
    assert.deepEqual(declared.components, getMaterialContracts().filter((c) => ['Select', 'TreeSelect', 'Collapse'].includes(c.name)));
    assert.ok(declared.materialValueDefinitions.treeOption);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('packaged MCP validates and repairs over stdio without node_modules or source files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-package-'));
  try {
    fs.mkdirSync(path.join(dir, 'generated'));
    for (const name of ['protoflow-mcp.cjs', 'protoflow-db-contract.cjs', 'hermes-context-bridge.cjs', 'context-transaction.cjs', 'generated/material-contract.cjs']) fs.copyFileSync(path.join(process.cwd(), 'electron', name), path.join(dir, name));
    const file = path.join(dir, 'context.json');
    atomicWrite(file, { active: true, runId: 'test', projectId: 'test', snapshot: { pageSources: { main: source('') }, designerPages: [] }, operations: [] });
    const requests = [source('<Select pfId="x" size="imaginary" />'), source('<Select pfId="x" options={[{label:"启用",value:0}]} />')].map((code, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name: 'protoflow_apply_tsx_patch', arguments: { pageId: 'main', source: code } } }));
    const child = spawnSync(process.execPath, [path.join(dir, 'protoflow-mcp.cjs'), file], { cwd: dir, input: requests.map((r) => JSON.stringify(r)).join('\n') + '\n', encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 0, child.stderr);
    const replies = child.stdout.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(replies[0].result.isError, true);
    assert.match(replies[0].result.content[0].text, /size.*仅允许/);
    assert.match(replies[0].result.content[0].text, /本次调用未暂存/);
    assert.notEqual(replies[1].result.isError, true);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).operations.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
