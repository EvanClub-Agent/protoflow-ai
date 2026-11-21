import type { ActionCall, PropValue, ProtoChild, ProtoDoc, ProtoNode } from '../types';
import { isActionChain, isNode, isRawExpr } from '../types';

const IND = '  ';
const JS_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Print a value as a JS expression (used inside `{...}`). */
export function printExpr(v: PropValue, depth = 0): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return quote(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isRawExpr(v)) return v.code;
  if (isActionChain(v)) return printActions(v.calls, depth);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const items = v.map((x) => printExpr(x, depth + 1));
    const inline = `[${items.join(', ')}]`;
    if (inline.length <= 72 && !inline.includes('\n')) return inline;
    const pad = IND.repeat(depth + 1);
    return `[\n${items.map((i) => pad + i).join(',\n')},\n${IND.repeat(depth)}]`;
  }
  const entries = Object.entries(v);
  if (entries.length === 0) return '{}';
  const parts = entries.map(([k, val]) => `${JS_IDENT.test(k) ? k : quote(k)}: ${printExpr(val, depth + 1)}`);
  const inline = `{ ${parts.join(', ')} }`;
  if (inline.length <= 80 && !inline.includes('\n')) return inline;
  const pad = IND.repeat(depth + 1);
  return `{\n${parts.map((p) => pad + p).join(',\n')},\n${IND.repeat(depth)}}`;
}

function printActions(calls: ActionCall[], depth: number): string {
  const callStr = (c: ActionCall) => `${c.name}(${c.args.map((a) => printExpr(a, depth + 1)).join(', ')})`;
  if (calls.length === 0) return '() => {}';
  if (calls.length === 1) return `() => ${callStr(calls[0])}`;
  const pad = IND.repeat(depth + 1);
  return `() => {\n${calls.map((c) => `${pad}${callStr(c)};`).join('\n')}\n${IND.repeat(depth)}}`;
}

function quote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}'`;
}

function printAttr(name: string, v: PropValue, depth: number): string {
  if (v === true) return name;
  if (typeof v === 'string' && !/["\r\n\u2028\u2029\\{}&]/.test(v)) return `${name}="${v}"`;
  return `${name}={${printExpr(v, depth)}}`;
}

function escapeText(s: string): string {
  return /[{}<>&]|^\s|\s$|\s{2}|[^\S ]/u.test(s) ? `{${quote(s)}}` : s;
}

function printNode(n: ProtoNode, depth: number): string {
  const pad = IND.repeat(depth);
  const attrs = [printAttr('pfId', n.pfId, 0), ...Object.entries(n.props).map(([k, v]) => printAttr(k, v, 0))];
  const oneLineAttrs = attrs.join(' ');
  const multiline = oneLineAttrs.length + pad.length + n.type.length > 96 || attrs.some((a) => a.includes('\n'));
  const open = multiline
    ? `<${n.type}\n${attrs.map((a) => `${IND.repeat(depth + 1)}${a.replace(/\n/g, `\n${IND.repeat(depth + 1)}`)}`).join('\n')}\n${pad}`
    : `<${n.type} ${oneLineAttrs}`;

  if (n.children.length === 0) return `${pad}${open}${multiline ? '/>' : ' />'}`;

  const onlyText = n.children.length === 1 && !isNode(n.children[0]);
  if (onlyText && !multiline) {
    const txt = escapeText((n.children[0] as { value: string }).value);
    const line = `${pad}${open}>${txt}</${n.type}>`;
    if (line.length <= 110) return line;
  }
  const kids = n.children.map((c) => printChild(c, depth + 1)).join('\n');
  return `${pad}${open}>\n${kids}\n${pad}</${n.type}>`;
}

function printChild(c: ProtoChild, depth: number): string {
  if (isNode(c)) return printNode(c, depth);
  return `${IND.repeat(depth)}${escapeText(c.value)}`;
}

/** Print a whole page doc as canonical TSX. */
export function printPageSource(doc: ProtoDoc): string {
  const header = doc.header.length ? `${doc.header.join('\n')}\n` : '';
  return `${header}export default function Page() {\n${IND}return (\n${printNode(doc.root, 2)}\n${IND});\n}\n`;
}

/** Print a single node (used for AI scoped patches and clipboard). */
export function printNodeSource(n: ProtoNode): string {
  return printNode(n, 0);
}
