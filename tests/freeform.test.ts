import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { freeformSourceErrors, FREEFORM_DEFAULT_SOURCE, FREEFORM_DEFAULT_CSS, freeformInputs, validateFreeformEvent, resolveFreeformEvent } from '../src/proto/freeform/contract';
import { compileFreeform } from '../src/proto/freeform/compile';
import { freeformDocument } from '../src/proto/freeform/document';
import { parsePageSource } from '../src/proto/dsl/parser';
import { printPageSource } from '../src/proto/dsl/printer';
import { validateMaterialSource } from '../src/proto/registry/materialContract';
import { createProjectPayload, loadProjectFromBinaryPayload, captureProjectPayload } from '../src/services/projectStorage';
import { encodePflowBinary, decodePflowBinary } from '../src/utils/pflowBinaryCodec';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { validatePublishedSnapshot } from '../src/services/publishedSnapshot';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useProtoStore } from '../src/store/useProtoStore';
import { pageContractErrors } from '../src/services/hermesProject';
import { FreeformInspector } from '../src/proto/freeform/FreeformInspector';
import TestRenderer, { act } from 'react-test-renderer';

const native = require(process.cwd() + '/electron/generated/material-contract.cjs');
const page = (source = FREEFORM_DEFAULT_SOURCE, extra = '') => `export default function Page(){return <Page pfId="root"><Freeform pfId="free" title="自由组件" source={${JSON.stringify(source)}} css={${JSON.stringify(FREEFORM_DEFAULT_CSS)}} ${extra}/></Page>}`;

test('freeform TSX round-trips opaque source/CSS and shares the native validation gate', () => {
  const source = 'export default function Component(){return <p>{"{{row.id}} </script> 中文"}</p>}';
  const result = parsePageSource(page(source));
  const printed = printPageSource(result.doc!);
  assert.deepEqual(validateMaterialSource(printed), []);
  assert.deepEqual(native.validateMaterialSource(printed), []);
  assert.equal((parsePageSource(printed).doc!.root.children[0] as any).props.source, source);
  for (const invalid of [
    'import React from "react"; export default function Component(){return <p/>}',
    'export default function Component(){return <Table/>}',
    'export default function Component(){return <iframe/>}',
    'export default function Component(){return <div dangerouslySetInnerHTML={{__html:"x"}}/>}',
    'export default function Component(){return import("remote")}',
    'export default function Component(){return eval("x")}',
    'export default function Component(){return __pfGuard()}',
  ]) {
    assert.ok(freeformSourceErrors(invalid).length, invalid);
    assert.deepEqual(native.validateMaterialSource(page(invalid)), validateMaterialSource(page(invalid)));
  }
  assert.ok(validateMaterialSource(page(FREEFORM_DEFAULT_SOURCE, 'eventFields={[{name:"x",type:"string"},{name:"x",type:"number"}]}')).length);
  assert.match(validateMaterialSource(page(FREEFORM_DEFAULT_SOURCE, 'onAction={() => toast("{{event.missing}}") }')).join(' '), /未在 eventFields 声明/);
  assert.ok(validateMaterialSource('export default function Page(){return <Page pfId="root"><div pfId="native"/></Page>}').length);
});

test('freeform compiles typed React state and guards runaway loops', async () => {
  const code = await compileFreeform('export default function Component({data}) { const [n] = React.useState<number>(data.count); return <button>{n + 1}</button>; }');
  const html = vm.runInNewContext(`${code}; render(React.createElement(Component,{data:{count:4}}));`, { React, render: renderToStaticMarkup, __pfGuard() {} });
  assert.equal(html, '<button>5</button>');
  const loop = await compileFreeform('export default function Component(){while(true){} return <p/>}');
  let calls = 0;
  assert.throws(() => vm.runInNewContext(`${loop}; Component();`, { React, __pfGuard() { if (++calls > 10) throw new Error('budget'); } }, { timeout: 500 }), /budget/);
});

test('freeform receives only explicitly selected real fields and preserves event value types', () => {
  const table = { ...useProtoStore.getState().dbTables[0], id: 'freeform-table-id', tableName: 'freeform_physical_table' };
  const field = table.columns[0].name;
  const props = { table: table.id, columns: [field], data: { caption: '{{literal}}' } };
  assert.deepEqual(freeformInputs(props, [table], [{ [field]: 0, secret: 'hidden' }]), { caption: '{{literal}}', rows: [{ [field]: 0 }] });
  assert.throws(() => freeformInputs({ ...props, table: table.tableName }, [table], []), /不存在/);
  assert.throws(() => freeformInputs({ ...props, columns: ['missing'] }, [table], []), /不存在/);
  assert.throws(() => freeformInputs(props, [table], [{}]), /缺少字段/);
  const fields = [{ name: 'value', type: 'number' as const }];
  validateFreeformEvent({ value: 0 }, fields);
  assert.throws(() => validateFreeformEvent({ value: '0' }, fields), /不一致/);
  assert.throws(() => validateFreeformEvent({ value: 0, id: 'invented' }, fields), /不一致/);
  assert.deepEqual(resolveFreeformEvent({ value: '{{event.value}}', label: '值={{event.value}}' }, { value: 0 }), { value: 0, label: '值=0' });
  assert.throws(() => resolveFreeformEvent('{{event.id}}', { code: 'x' }), /缺少/);
  assert.match(pageContractErrors(page(FREEFORM_DEFAULT_SOURCE, `table="${table.id}" columns={["missing"]}`), [table]).join(' '), /不存在的字段/);
});

test('freeform document keeps source strings out of HTML and restricts the sandbox resources', async () => {
  const doc = freeformDocument(await compileFreeform(FREEFORM_DEFAULT_SOURCE), '</style><script>alert(1)</script>', 'test-channel');
  assert.equal(doc.includes('alert(1)'), false);
  assert.equal((doc.match(/<script /g) ?? []).length, 1);
  assert.match(doc, /connect-src 'none'/);
  assert.match(doc, /script-src data:/);
  const nonce = 'd3c166400db64ccb859861e59006dc24';
  const online = freeformDocument('function Component() {}', '', 'online', nonce);
  assert.ok(online.includes(`<script nonce="${nonce}" src="data:text/javascript;base64,`));
  const malformed = freeformDocument('function Component() {}', '', 'online', 'bad" onload="alert(1)');
  assert.doesNotMatch(malformed, /<script nonce=|onload=/);
});

test('freeform survives project archive, undo/redo and publishing; invalid source is rejected by the viewer', () => {
  const payload = createProjectPayload({ projectId: 'freeform-test', projectName: '自由组件测试', templateId: 'blank_project', storageDir: '/tmp', fileName: 'freeform.pflow', createdAt: '2026-11-01', updatedAt: '2026-11-01', pageCount: 0, tableCount: 0, stickyCount: 0 });
  payload.stateSnapshot.designerFolders = [{ id: 'folder-project-pages', title: '测试目录', parentFolderId: null }];
  payload.stateSnapshot.pageSources = { main: page() };
  payload.stateSnapshot.designerPages = [{ pageId: 'main', title: '自由组件测试', folderId: 'folder-project-pages' }];
  payload.stateSnapshot.activePageId = 'main';
  loadProjectFromBinaryPayload(payload);
  const changed = page('export default function Component(){return <p>已更新</p>}');
  usePageStore.getState().setPageSource('main', changed);
  usePageStore.getState().undo('main'); assert.equal(usePageStore.getState().pageSources.main, page());
  usePageStore.getState().redo('main'); assert.equal(usePageStore.getState().pageSources.main, changed);
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(captureProjectPayload())));
  assert.equal(usePageStore.getState().pageSources.main, changed);
  const published = createPublishedSnapshot('main');
  validatePublishedSnapshot(published);
  (published.pages[0].doc.root.children[0] as any).props.source = 'export default function Component(){return <iframe/>}';
  assert.throws(() => validatePublishedSnapshot(published), /自由组件未通过发布检查/);
});

test('freeform inspector leads with plain-language AI creation and hides code by default', () => {
  const doc = parsePageSource(page()).doc!, node = doc.root.children[0] as any;
  const prompts: string[] = [];
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(FreeformInspector, { node, doc, tables: [], enabled: true, onCommit() {}, onPropChange() {}, onConnect() {}, onGenerate: p => prompts.push(p) })); });
  try {
    assert.equal(renderer.root.findAllByType('textarea').length, 1);
    const input = renderer.root.findByProps({ 'aria-label': '描述自由组件效果' });
    act(() => input.props.onChange({ target: { value: '做一个座位图' } }));
    act(() => renderer.root.findAllByType('button').find(b => b.children.includes('让 AI 实现'))!.props.onClick());
    assert.match(prompts[0], /做一个座位图/);
    assert.match(prompts[0], /pfId=free/);
    act(() => renderer.root.findAllByType('button').find(b => b.children.includes('高级选项'))!.props.onClick());
    assert.equal(renderer.root.findAllByType('textarea').length, 4);
  } finally { act(() => renderer.unmount()); }
});
