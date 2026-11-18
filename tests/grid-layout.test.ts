import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { parsePageSource } from '../src/proto/dsl/parser';
import { findNode, setProp } from '../src/proto/dsl/tree';
import { DesignProvider, NodeView, type DesignApi } from '../src/proto/renderer/NodeView';
import { RuntimeProvider, type Runtime } from '../src/proto/runtime/runtime';
import { NodeInspectorPanel } from '../src/proto/designer/NodeInspectorPanel';
import { flowGridSpan, trailingColumnSpace } from '../src/proto/renderer/gridLayout';

const page = (body: string) => parsePageSource(`export default function Page(){return <Page pfId="page">${body}</Page>}`).doc!;
const dashboard = () => page('<Row pfId="row"><Col pfId="left" span={12}><BarChart pfId="bar" source="sample"/></Col><Col pfId="right" span={9}><LineChart pfId="line" source="sample" width="full"/></Col></Row>');

test('fill-right grows only the last column of its visual line and respects wrapped rows', () => {
  for (const [spans, selected, expected] of [
    [[12, 9], 1, 12], [[12, 9], 0, null], [[12, 12], 1, null],
    [[12, 9, 4], 1, 12], [[12, 9, 2], 1, null], [[12, 9, 2], 2, 3],
    [[16, 12], 1, 24], [[8, 8, 8], 2, null],
  ] as [number[], number, number | null][]) {
    const doc = page(`<Row pfId="row">${spans.map((span, i) => `<Col pfId="col-${i}" span={${span}}/>`).join('')}</Row>`);
    assert.equal(trailingColumnSpace(findNode(doc.root, 'row'), findNode(doc.root, `col-${selected}`))?.nextSpan ?? null, expected);
  }
});

test('chart quick layout distinguishes its full inner width from the outer column and expands that exact column', () => {
  const initial = dashboard();
  let current = initial, commits = 0;
  const rt = { isDesign: true, hidden: {}, vars: {}, pageId: 'grid-layout', run: async () => {} } as unknown as Runtime;
  const Harness = () => {
    const [doc, setDoc] = React.useState(initial); current = doc;
    const design: DesignApi = { selectedId: 'line', hoverId: null, drop: null, stickyCounts: {}, select() {}, hover() {}, setDrop() {}, onDrop() {}, onDragStartNode() {}, onSelectParent() {}, onUpdateProp: (id, prop, value) => { commits++; setDoc(setProp(doc, id, prop, value)); } };
    return React.createElement(RuntimeProvider, { value: rt }, React.createElement(DesignProvider, { value: design }, React.createElement(NodeView, { node: doc.root })));
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    act(() => { renderer = TestRenderer.create(React.createElement(Harness)); });
    const button = (label: string) => renderer.root.findByProps({ 'data-pf-quickbar': '1' }).findAllByType('button').find(b => b.children.includes(label));
    assert.match(button('填满本列')!.props.className, /bg-blue-600/);
    assert.equal(renderer.root.findAllByType('span').some(span => span.children.includes('所在列 3/8')), true);
    act(() => button('填满右侧')!.props.onClick());
    assert.equal(commits, 1);
    assert.equal(findNode(current.root, 'right')!.props.span, 12);
    assert.deepEqual(findNode(current.root, 'left'), findNode(initial.root, 'left'));
    assert.deepEqual(findNode(current.root, 'line'), findNode(initial.root, 'line'));
    assert.equal(button('填满右侧'), undefined);
    assert.equal(renderer.root.findByProps({ 'data-pf-id': 'right' }).props.style.gridColumn, 'span 12 / span 12');
  } finally { act(() => renderer?.unmount()); }
});

test('inspector inherited width matches Card and Form rendering instead of incorrectly selecting full width', () => {
  const noop = () => {};
  for (const type of ['Card', 'Form']) {
    const doc = page(`<${type} pfId="container" cols={2}><Text pfId="text">内容</Text></${type}>`);
    const node = findNode(doc.root, 'text')!;
    assert.equal(flowGridSpan(node, findNode(doc.root, 'container')), 6);
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      act(() => { renderer = TestRenderer.create(React.createElement(NodeInspectorPanel, { pageId: 'grid-layout', doc, selectedNode: node, overlays: [], onSelectNode: noop, onPropChange: noop, onTextChange: noop, onMoveNode: noop, onDuplicateNode: noop, onRemoveNode: noop, onOpenOverlayDesigner: noop, onCreateOverlay: noop, onRunAiPrompt: noop })); });
      const buttons = renderer.root.findAllByType('button');
      assert.match(buttons.find(button => button.children.includes('1/2'))!.props.className, /bg-indigo-600/);
      assert.doesNotMatch(buttons.find(button => button.children.includes('整行'))!.props.className, /bg-indigo-600/);
    } finally { act(() => renderer?.unmount()); }
  }
});
