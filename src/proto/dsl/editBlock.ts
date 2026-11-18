import { parsePageSource } from './parser';
import { printPageSource } from './printer';
import { findNode, replaceNode } from './tree';
import { isNode } from '../types';
import { COMPONENT_MAP } from '../registry/meta';
import { validateMaterialSource } from '../registry/materialContract';

/** Incremental tool edits still produce a complete page for the existing commit gate. */
export function editPageBlock(source: string, targetPfId: string, mode: string, tsx: string): string {
  const before = validateMaterialSource(source);
  if (before.length) throw new Error(`当前页面需要先通过完整页面工具修复：${before.join('；')}`);
  const doc = parsePageSource(source).doc!;
  const target = findNode(doc.root, targetPfId);
  if (!target) throw new Error(`目标 pfId 不存在：${targetPfId}`);
  if (!['append_children', 'replace_node'].includes(mode)) throw new Error('mode 仅支持 append_children / replace_node');
  // This wrapper is parser-only, never a project/node identity or persisted value.
  const fragment = parsePageSource(`export default function Page(){return <Page pfId="__protoflow_fragment__">${tsx}</Page>}`, { strict: true });
  if (!fragment.doc || fragment.issues.length || fragment.normalized) throw new Error('区块必须是完整 TSX 组件，每个组件显式提供唯一 pfId；不能含不受支持的表达式或展开属性');
  const children = fragment.doc.root.children;
  if (!children.length || !children.every(isNode)) throw new Error('区块必须包含组件，文本请放在 Text 等物料中');
  let next;
  if (mode === 'append_children') {
    if (!COMPONENT_MAP[target.type]?.container) throw new Error(`${target.type} 不接受子组件`);
    next = replaceNode(doc, targetPfId, { ...target, children: [...target.children, ...children] });
  } else {
    if (children.length !== 1 || children[0].pfId !== targetPfId) throw new Error('替换时必须提供一个组件并保留目标 pfId');
    next = replaceNode(doc, targetPfId, children[0]);
  }
  const result = printPageSource(next);
  const errors = validateMaterialSource(result);
  if (errors.length) throw new Error(errors.join('\n'));
  return result;
}
