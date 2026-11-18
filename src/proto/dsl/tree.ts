import type { PropValue, ProtoChild, ProtoDoc, ProtoNode } from '../types';
import { isNode } from '../types';
import { genPfId } from './parser';

export function findNode(root: ProtoNode, pfId: string): ProtoNode | null {
  if (root.pfId === pfId) return root;
  for (const c of root.children) {
    if (isNode(c)) {
      const r = findNode(c, pfId);
      if (r) return r;
    }
  }
  return null;
}

export function findParent(root: ProtoNode, pfId: string): { parent: ProtoNode; index: number } | null {
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    if (isNode(c)) {
      if (c.pfId === pfId) return { parent: root, index: i };
      const r = findParent(c, pfId);
      if (r) return r;
    }
  }
  return null;
}

export function walk(root: ProtoNode, fn: (n: ProtoNode, depth: number, parent: ProtoNode | null) => void, depth = 0, parent: ProtoNode | null = null) {
  fn(root, depth, parent);
  for (const c of root.children) if (isNode(c)) walk(c, fn, depth + 1, root);
}

/** Path of pfIds from root to the target (inclusive). */
export function pathTo(root: ProtoNode, pfId: string): ProtoNode[] {
  if (root.pfId === pfId) return [root];
  for (const c of root.children) {
    if (isNode(c)) {
      const p = pathTo(c, pfId);
      if (p.length) return [root, ...p];
    }
  }
  return [];
}

function mapNode(root: ProtoNode, pfId: string, fn: (n: ProtoNode) => ProtoNode | null): ProtoNode {
  if (root.pfId === pfId) {
    const r = fn(root);
    return r ?? root;
  }
  let changed = false;
  const children: ProtoChild[] = [];
  for (const c of root.children) {
    if (isNode(c)) {
      if (c.pfId === pfId) {
        changed = true;
        const r = fn(c);
        if (r) children.push(r);
        continue;
      }
      const nc = mapNode(c, pfId, fn);
      if (nc !== c) changed = true;
      children.push(nc);
    } else children.push(c);
  }
  return changed ? { ...root, children } : root;
}

const withRoot = (doc: ProtoDoc, root: ProtoNode): ProtoDoc => (root === doc.root ? doc : { ...doc, root });

export function setProp(doc: ProtoDoc, pfId: string, key: string, value: PropValue | undefined): ProtoDoc {
  return withRoot(
    doc,
    mapNode(doc.root, pfId, (n) => {
      const props = { ...n.props };
      if (value === undefined || value === '') delete props[key];
      else props[key] = value;
      return { ...n, props };
    })
  );
}

export function setText(doc: ProtoDoc, pfId: string, text: string): ProtoDoc {
  return withRoot(
    doc,
    mapNode(doc.root, pfId, (n) => ({
      ...n,
      children: [{ kind: 'text', value: text }, ...n.children.filter(isNode)],
    }))
  );
}

export function removeNode(doc: ProtoDoc, pfId: string): ProtoDoc {
  if (doc.root.pfId === pfId) return doc;
  return withRoot(doc, mapNode(doc.root, pfId, () => null));
}

/** Give fresh pfIds to a subtree (used when pasting / duplicating / inserting AI snippets). */
export function reassignIds(n: ProtoNode): ProtoNode {
  return {
    ...n,
    pfId: genPfId(n.type),
    children: n.children.map((c) => (isNode(c) ? reassignIds(c) : c)),
  };
}

export function insertNode(doc: ProtoDoc, parentPfId: string, index: number, node: ProtoNode): ProtoDoc {
  return withRoot(
    doc,
    mapNode(doc.root, parentPfId, (p) => {
      const children = [...p.children];
      const i = Math.max(0, Math.min(index < 0 ? children.length : index, children.length));
      children.splice(i, 0, node);
      return { ...p, children };
    })
  );
}

export function replaceNode(doc: ProtoDoc, pfId: string, node: ProtoNode): ProtoDoc {
  if (doc.root.pfId === pfId) return { ...doc, root: node };
  return withRoot(doc, mapNode(doc.root, pfId, () => node));
}

/** Move node to a new parent/index. Prevents moving a node into its own subtree. */
export function moveNode(doc: ProtoDoc, pfId: string, newParentPfId: string, index: number): ProtoDoc {
  const node = findNode(doc.root, pfId);
  if (!node || pfId === doc.root.pfId) return doc;
  if (findNode(node, newParentPfId)) return doc;
  const from = findParent(doc.root, pfId);
  let idx = index;
  if (from && from.parent.pfId === newParentPfId && from.index < index) idx -= 1;
  const removed = removeNode(doc, pfId);
  return insertNode(removed, newParentPfId, idx, node);
}

export function duplicateNode(doc: ProtoDoc, pfId: string): { doc: ProtoDoc; newId: string | null } {
  const node = findNode(doc.root, pfId);
  const loc = findParent(doc.root, pfId);
  if (!node || !loc) return { doc, newId: null };
  const copy = reassignIds(node);
  return { doc: insertNode(doc, loc.parent.pfId, loc.index + 1, copy), newId: copy.pfId };
}

/** Collect overlay (Modal / Drawer) nodes anywhere in the page. */
export function collectOverlays(root: ProtoNode, overlayTypes: Set<string>): ProtoNode[] {
  const out: ProtoNode[] = [];
  walk(root, (n) => {
    if (overlayTypes.has(n.type)) out.push(n);
  });
  return out;
}

export function nodeText(n: ProtoNode): string {
  return n.children
    .filter((c) => !isNode(c))
    .map((c) => (c as { value: string }).value)
    .join(' ');
}
