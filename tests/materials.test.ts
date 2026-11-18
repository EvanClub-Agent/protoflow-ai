import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { COMPONENTS, COMPONENT_MAP, FIELD_TYPES } from '../src/proto/registry/meta';
import { REGISTRY, type CompProps } from '../src/proto/registry/components';
import { AntdFieldControl, parseMaterialDate } from '../src/proto/registry/AntdFieldControl';
import { materialOptions } from '../src/proto/registry/antdOptions';
import { parseSnippetNode, validatePageDoc } from '../src/proto/ai/assistant';
import { parsePageSource } from '../src/proto/dsl/parser';
import { printPageSource } from '../src/proto/dsl/printer';
import { walk } from '../src/proto/dsl/tree';
import { formFieldSpecs, RuntimeProvider, useRuntimeController, type Runtime } from '../src/proto/runtime/runtime';
import { NodeView } from '../src/proto/renderer/NodeView';
import { StructuredPropEditor } from '../src/proto/designer/StructuredPropEditor';
import { OptionsPropEditor } from '../src/proto/designer/OptionsPropEditor';
import antdTheme from 'antd/es/theme';
import { AntdSurface, useResolvedTheme } from '../src/proto/registry/AntdSurface';
import { installTestDom } from './dom';

const added = ['Flex', 'Collapse', 'CollapsePanel', 'Avatar', 'Badge', 'Progress', 'Image', 'Skeleton', 'Spin', 'Tooltip', 'Popover', 'Popconfirm', 'TimePicker', 'Slider', 'Rate', 'Cascader', 'TreeSelect', 'AutoComplete', 'Segmented'];

test('query labels do not change column spans; width limits and collapsing preserve exact filter values', async () => {
  const restore = installTestDom();
  const filters: unknown[] = [];
  const rt = runtime(); rt.setFilter = (target, values) => { filters.push([target, values]); };
  const fields = Array.from({ length: 7 }, (_, i) => ({ name: `field_${i}`, label: `查询项${i}`, type: i === 0 ? 'dateRange' : 'input' }));
  const node = parseSnippetNode(`<QueryForm pfId="query" target="table" cols={4} labelWidth={104} defaultExpanded fields={${JSON.stringify(fields)}} />`)!;
  let renderer: TestRenderer.ReactTestRenderer;
  const render = () => React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node }));
  try {
    act(() => { renderer = TestRenderer.create(render()); });
    const controls = () => renderer!.root.findAllByType(AntdFieldControl);
    assert.equal(controls().length, 7);
    const cells = renderer!.root.findByProps({ 'data-query-fields': true }).findAll(n => n.type === 'div' && n.props.style?.gridColumn !== undefined);
    assert.equal(cells.length, 7);
    assert.ok(cells.every(cell => cell.props.style.gridColumn === 'span 1 / span 1'));
    assert.equal(controls()[0].parent!.props.style.maxWidth, 320);
    assert.equal(controls()[1].parent!.props.style.maxWidth, 240);
    act(() => controls()[6].props.onChange('保留的筛选值'));
    const button = (label: string) => renderer!.root.findAllByType('button').find(b => b.children.some(c => c === label))!;
    act(() => button('收起').props.onClick());
    assert.equal(controls().length, 4);
    const search = renderer!.root.findAllByType('button').find(b => b.findAll(n => n.type === 'span' && n.children.includes('查询')).length)!;
    act(() => search.props.onClick());
    assert.deepEqual(filters.at(-1), ['table', { field_6: '保留的筛选值' }]);
    act(() => button('展开').props.onClick());
    assert.equal(controls()[6].props.value, '保留的筛选值');
    act(() => button('重置').props.onClick());
    assert.deepEqual(filters.at(-1), ['table', {}]);
    node.props.controlMaxWidth = 180; node.props.rangeMaxWidth = 280;
    act(() => renderer!.update(render()));
    assert.equal(controls()[0].parent!.props.style.maxWidth, 280);
    assert.equal(controls()[1].parent!.props.style.maxWidth, 180);
  } finally { act(() => renderer?.unmount()); restore(); }
});

test('query width limits leave ordinary form fields on their existing twelve-column grid', () => {
  const restore = installTestDom();
  const node = parseSnippetNode('<Form cols={2} labelWidth={104} fields={[{name:"name",label:"名称"},{name:"remark",label:"备注",span:2}]} />')!;
  let renderer: TestRenderer.ReactTestRenderer;
  try {
    act(() => { renderer = TestRenderer.create(React.createElement(RuntimeProvider, { value: runtime() }, React.createElement(NodeView, { node }))); });
    const cells = renderer!.root.findAll(n => n.type === 'div' && n.props.style?.gridColumn !== undefined);
    assert.deepEqual(cells.map(c => c.props.style.gridColumn), ['span 6 / span 6', 'span 12 / span 12']);
    assert.ok(renderer!.root.findAllByType(AntdFieldControl).every(control => control.parent!.props.style?.maxWidth === undefined));
  } finally { act(() => renderer?.unmount()); restore(); }
});

function runtime(design = false): Runtime {
  return { isDesign: design, pageId: 'materials', vars: {}, hidden: {}, tabs: {}, filters: {}, pageNo: {}, selections: {}, formValues: {}, formErrors: {}, pickerValues: {}, overlays: [], toasts: [], run: async () => {}, setTab() {}, setPageNo() {}, setSelection() {}, setFilter() {}, setFormValue() {} } as unknown as Runtime;
}

test('every palette snippet round-trips and all 19 new materials share the registry contract', () => {
  assert.equal(new Set(COMPONENTS.map((c) => c.name)).size, COMPONENTS.length);
  for (const component of COMPONENTS) {
    assert.ok(REGISTRY[component.name], component.name);
    assert.equal(new Set(component.props.map((p) => p.name)).size, component.props.length, `${component.name}: duplicate property`);
    const node = parseSnippetNode(component.snippet)!;
    assert.ok(node, component.name);
    const doc = { header: [], root: node };
    assert.deepEqual(parsePageSource(printPageSource(doc)).doc, doc);
    walk(node, (child) => assert.ok(REGISTRY[child.type], child.type));
  }
  for (const name of added) {
    const node = parseSnippetNode(COMPONENT_MAP[name].snippet)!;
    assert.equal(validatePageDoc({ header: [], root: node }, []).filter((i) => i.id.startsWith('unknown')).length, 0);
  }
});

test('option labels never replace values, numeric values stay numeric, malformed identities fail', () => {
  assert.deepEqual(materialOptions(['启用', '停用']), [{ label: '启用', value: '启用' }, { label: '停用', value: '停用' }]);
  assert.deepEqual(materialOptions('甲，乙'), [{ label: '甲', value: '甲' }, { label: '乙', value: '乙' }]);
  assert.deepEqual(materialOptions([{ label: '零', value: 0, disabled: true }]), [{ label: '零', value: 0, disabled: true }]);
  assert.throws(() => materialOptions([{ label: '不得当主键', id: 'id-1', code: 'code-1' }]), /value/);
  assert.throws(() => materialOptions([{ label: 'A', value: 'x' }, { label: 'B', value: 'x' }]), /重复/);
  assert.throws(() => materialOptions([{ label: 'A', value: 'a', children: [{ label: 'B' }] }], true), /value/);
  assert.throws(() => materialOptions([{ label: 'A', value: 'a', disabled: 'false' }]), /布尔值/);
});

test('date adapters preserve existing stored formats and reject invalid or ambiguous values', () => {
  for (const [value, format] of [['2026-10-31', 'YYYY-MM-DD'], ['2026-10-31T09:30', 'YYYY-MM-DDTHH:mm'], ['2026-10', 'YYYY-MM'], ['2026', 'YYYY'], ['09:30:00', 'HH:mm:ss']]) {
    assert.equal(parseMaterialDate(value, format)?.format(format), value);
  }
  assert.equal(parseMaterialDate('', 'YYYY-MM-DD'), null);
  assert.throws(() => parseMaterialDate('2026-02-31', 'YYYY-MM-DD'), /不符合/);
  assert.throws(() => parseMaterialDate(123, 'YYYY-MM-DD'), /必须/);
});

test('new fields bind exact names, emit typed onChange values and reset with the runtime', async () => {
  const restore = installTestDom();
  const doc = parsePageSource(`export default function Page(){return <Page pfId="page"><Form pfId="form">
    <Select pfId="status" name="status_code" required options={[{label:"启用",value:0},{label:"停用",value:1}]} onChange={() => setVar('changed', 'yes')} />
    <TreeSelect pfId="dept" name="department_id" options={[{label:"部门",value:"department-1"}]} />
    <Rate pfId="rating" name="rating" required />
    <Input pfId="unbound" />
  </Form></Page>}`).doc!;
  let rt: Runtime;
  const Harness = () => {
    rt = useRuntimeController(doc, 'material-test', false);
    return React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node: doc.root }));
  };
  let renderer: TestRenderer.ReactTestRenderer;
  try {
    act(() => { renderer = TestRenderer.create(React.createElement(Harness)); });
    const field = (name: string) => renderer!.root.findAllByType(AntdFieldControl).find((c) => c.props.def.pfId === name)!;
    await act(async () => { field('status').props.onChange(0); field('dept').props.onChange('department-1'); field('rating').props.onChange(3.5); field('unbound').props.onChange('local only'); });
    assert.deepEqual(rt!.formValues.form, { status_code: 0, department_id: 'department-1', rating: 3.5 });
    assert.equal(field('status').props.value, 0);
    assert.equal(rt!.vars.changed, 'yes');
    const form = (doc.root.children[0] as any);
    assert.deepEqual(formFieldSpecs(form).filter((f) => f.required).map((f) => f.name), ['status_code', 'rating']);
    await act(async () => { await rt!.run({ $kind: 'actions', calls: [{ name: 'resetForm', args: ['form'] }] }, {}); });
    assert.equal(field('dept').props.value, '');
    assert.ok(FIELD_TYPES.has('TreeSelect'));
  } finally { act(() => renderer?.unmount()); restore(); }
});

test('readonly and disabled fields never write values or dispatch actions', () => {
  const restore = installTestDom();
  const writes: unknown[] = [];
  const rt = runtime(); rt.run = async (...args) => { writes.push(args); };
  const node = parseSnippetNode('<Select readOnly options={["A"]} onChange={() => toast("changed")} />')!;
  let renderer: TestRenderer.ReactTestRenderer;
  try {
    act(() => { renderer = TestRenderer.create(React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node }))); });
    const field = renderer!.root.findByType(AntdFieldControl);
    act(() => field.props.onChange('A'));
    assert.equal(renderer!.root.findByType(AntdFieldControl).props.value, '');
    assert.deepEqual(writes, []);
  } finally { act(() => renderer?.unmount()); restore(); }
});

test('onChange submission validates the new field value in the same event', async () => {
  const restore = installTestDom();
  const doc = parsePageSource(`export default function Page(){return <Page pfId="page"><Form pfId="form"><Select pfId="field" name="status_code" required options={[{label:"启用",value:0}]} onChange={() => {submitForm('form');setVar('submitted','yes');}} /></Form></Page>}`).doc!;
  let rt: Runtime;
  const Harness = () => {
    rt = useRuntimeController(doc, 'change-submit', false);
    return React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node: doc.root }));
  };
  let renderer: TestRenderer.ReactTestRenderer;
  try {
    act(() => { renderer = TestRenderer.create(React.createElement(Harness)); });
    await act(async () => { renderer!.root.findByType(AntdFieldControl).props.onChange(0); });
    assert.equal(rt!.vars.submitted, 'yes');
    assert.deepEqual(rt!.formErrors.form, {});
  } finally { act(() => renderer?.unmount()); restore(); }
});

test('visual option editor preserves typed values and requires explicit values for new rows', () => {
  const commits: unknown[] = [];
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(OptionsPropEditor, { value: [{ label: '启用', value: 0 }], onChange: (v) => commits.push(v) })); });
  try {
    act(() => renderer!.root.findByProps({ 'aria-label': '选项1显示文字' }).props.onChange({ target: { value: '可用' } }));
    const apply = () => renderer!.root.findAllByType('button').find((b) => b.children.includes('应用选项'))!;
    act(() => apply().props.onClick());
    assert.deepEqual(commits, [[{ label: '可用', value: 0, disabled: false }]]);
    act(() => renderer!.root.findAllByType('button').find((b) => b.children.includes('＋ 新增选项'))!.props.onClick());
    act(() => apply().props.onClick());
    assert.equal(commits.length, 1);
    assert.ok(renderer!.root.findByProps({ role: 'alert' }));
  } finally { act(() => renderer!.unmount()); }
});

test('invalid option edits stay local and do not overwrite a saved configuration', () => {
  const commits: unknown[] = [];
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(StructuredPropEditor, { label: '选项', value: [{ label: '启用', value: 0 }], optionsKind: 'flat', onChange: (v) => commits.push(v) })); });
  try {
    const edit = (value: string) => act(() => renderer!.root.findByType('textarea').props.onChange({ target: { value } }));
    edit('[{"label":"缺少值","code":"wrong"}]');
    act(() => renderer!.root.findByType('button').props.onClick());
    assert.equal(commits.length, 0);
    assert.ok(renderer!.root.findByProps({ role: 'alert' }));
    edit('[{"label":"有效","value":0,"disabled":false}]');
    act(() => renderer!.root.findByType('button').props.onClick());
    assert.deepEqual(commits, [[{ label: '有效', value: 0, disabled: false }]]);
  } finally { act(() => renderer!.unmount()); }
});

test('alert close actions run only in preview, and the canvas keeps the node editable', async () => {
  for (const design of [true, false]) {
    const calls: unknown[] = [];
    const rt = runtime(design); rt.run = async (...args) => { calls.push(args); };
    const node = parseSnippetNode('<Alert closable message="可关闭提示" onClose={() => toast("已关闭")} />')!;
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(REGISTRY.Alert, { node, p: node.props, root: {}, rt, scope: {} } as CompProps)); });
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '关闭提示' }).props.onClick(); });
    assert.equal(calls.length, design ? 0 : 1);
    assert.equal(renderer!.toJSON() === null, !design);
    act(() => renderer!.unmount());
  }
});

test('AntdSurface switches between Ant Design defaultAlgorithm and darkAlgorithm when html data-theme changes', () => {
  const restore = installTestDom();
  let observedTokens: { bgContainer: string; text: string; mode: string } | null = null;
  const Probe = () => {
    const { token } = antdTheme.useToken();
    const mode = useResolvedTheme();
    observedTokens = { bgContainer: token.colorBgContainer, text: token.colorText, mode };
    return null;
  };
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  const listeners: (() => void)[] = [];
  (globalThis as any).MutationObserver = class {
    constructor(cb: () => void) { listeners.push(cb); }
    observe() {}
    disconnect() {}
  };
  try {
    document.documentElement.dataset.theme = 'light';
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(AntdSurface, null, React.createElement(Probe))
      );
    });
    assert.equal(observedTokens?.mode, 'light');
    assert.equal(observedTokens?.bgContainer.toLowerCase(), '#ffffff');

    act(() => {
      document.documentElement.dataset.theme = 'dark';
      listeners.forEach(fn => fn());
    });
    assert.equal(observedTokens?.mode, 'dark');
    assert.equal(observedTokens?.bgContainer.toLowerCase(), '#141414');
  } finally {
    act(() => renderer?.unmount());
    delete (globalThis as any).MutationObserver;
    restore();
  }
});
