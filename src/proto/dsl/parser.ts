import { readPageHeader } from './header';
import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import type {
  ActionCall,
  ParseIssue,
  ParseResult,
  PropValue,
  ProtoChild,
  ProtoNode,
} from '../types';

let idCounter = 0;
export const genPfId = (type: string) => {
  idCounter = (idCounter + 1) % 1679616;
  const rand = Math.floor(Math.random() * 1679616)
    .toString(36)
    .padStart(4, '0');
  return `${type.replace(/[^A-Za-z]/g, '').toLowerCase().slice(0, 8) || 'node'}-${rand}${idCounter.toString(36)}`;
};

/** Parse a Alex page TSX source into a ProtoDoc tree. Never throws. */
export function parsePageSource(source: string, options: { strict?: boolean } = {}): ParseResult {
  const issues: ParseIssue[] = [];
  let normalized = false;

  let file: t.File;
  try {
    file = parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    }) as unknown as t.File;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { doc: null, issues: [{ level: 'error', message: `语法错误：${msg}` }], normalized };
  }

  if (options.strict) {
    const declaration = file.program.body.length === 1 && file.program.body[0].type === 'ExportDefaultDeclaration'
      ? file.program.body[0].declaration : null;
    if (!declaration || declaration.type !== 'FunctionDeclaration' || declaration.id?.name !== 'Page' || declaration.async || declaration.generator || declaration.params.length || declaration.body.directives.length || declaration.body.body.length !== 1 || declaration.body.body[0].type !== 'ReturnStatement' || declaration.body.body[0].argument?.type !== 'JSXElement' || file.program.directives.length) {
      issues.push({ level: 'error', message: 'AI 源码仅支持 export default function Page() { return (<Page ... />); }（移动端为 <MobilePage ... />）；不能包含 import、变量、额外函数或其他被忽略的语句' });
    }
  }

  const header = readPageHeader(source);

  const rootJsx = findRootJsx(file);
  if (!rootJsx) {
    return {
      doc: null,
      issues: [{ level: 'error', message: '未找到页面根组件：请在 export default function Page() 中 return 一个 <Page> 或 <MobilePage> 元素' }],
      normalized,
    };
  }

  const seenIds = new Set<string>();

  const exprToValue = (expr: t.Node): PropValue => {
    switch (expr.type) {
      case 'StringLiteral':
        return expr.value;
      case 'NumericLiteral':
        return expr.value;
      case 'BooleanLiteral':
        return expr.value;
      case 'NullLiteral':
        return null;
      case 'TemplateLiteral':
        if (expr.expressions.length === 0) return expr.quasis.map((q) => q.value.cooked ?? '').join('');
        return { $kind: 'raw', code: source.slice(expr.start ?? 0, expr.end ?? 0) };
      case 'UnaryExpression':
        if (expr.operator === '-' && expr.argument.type === 'NumericLiteral') return -expr.argument.value;
        break;
      case 'ArrayExpression':
        return expr.elements.map((el) => (el ? exprToValue(el) : null));
      case 'ObjectExpression': {
        const obj: Record<string, PropValue> = {};
        for (const p of expr.properties) {
          if (p.type !== 'ObjectProperty') {
            return { $kind: 'raw', code: source.slice(expr.start ?? 0, expr.end ?? 0) };
          }
          const key = !p.computed ?
            p.key.type === 'Identifier'
              ? p.key.name
              : p.key.type === 'StringLiteral'
              ? p.key.value
              : null : null;
          if (key === null) return { $kind: 'raw', code: source.slice(expr.start ?? 0, expr.end ?? 0) };
          if (Object.prototype.hasOwnProperty.call(obj, key)) issues.push({ level: 'error', message: `对象属性 ${key} 重复，不能静默覆盖` });
          Object.defineProperty(obj, key, { value: exprToValue(p.value), enumerable: true, configurable: true, writable: true });
        }
        return obj;
      }
      case 'ArrowFunctionExpression':
      case 'FunctionExpression': {
        if (expr.params.length || expr.async || (expr.type === 'FunctionExpression' && expr.generator)) break;
        const calls = extractCalls(expr.body);
        if (calls) return { $kind: 'actions', calls };
        break;
      }
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
        return exprToValue(expr.expression);
      default:
        break;
    }
    return { $kind: 'raw', code: source.slice(expr.start ?? 0, expr.end ?? 0) };
  };

  const extractCalls = (body: t.Node): ActionCall[] | null => {
    const out: ActionCall[] = [];
    const pushCall = (e: t.Node): boolean => {
      if (e.type === 'AwaitExpression') return pushCall(e.argument);
      if (e.type !== 'CallExpression' || e.callee.type !== 'Identifier') return false;
      out.push({
        name: e.callee.name,
        args: e.arguments.map((a) => exprToValue(a as t.Node)),
      });
      return true;
    };
    if (body.type === 'BlockStatement') {
      if (body.directives.length) return null;
      for (const st of body.body) {
        if (st.type !== 'ExpressionStatement' || !pushCall(st.expression)) return null;
      }
      return out;
    }
    if (body.type === 'SequenceExpression') {
      return body.expressions.every((e) => pushCall(e)) ? out : null;
    }
    return pushCall(body) ? out : null;
  };

  const elementName = (n: t.JSXElement['openingElement']['name']): string => {
    if (n.type === 'JSXIdentifier') return n.name;
    if (n.type === 'JSXMemberExpression') {
      return `${elementName(n.object as t.JSXElement['openingElement']['name'])}.${n.property.name}`;
    }
    return `${n.namespace.name}:${n.name.name}`;
  };

  const convert = (el: t.JSXElement): ProtoNode => {
    const type = elementName(el.openingElement.name);
    const props: Record<string, PropValue> = {};
    let pfId: string | null = null;
    const seenAttrs = new Set<string>();

    for (const attr of el.openingElement.attributes) {
      if (attr.type === 'JSXSpreadAttribute') {
        issues.push({ level: 'warning', message: `<${type}> 中的展开属性 {...} 不受支持，已忽略` });
        continue;
      }
      const name = attr.name.type === 'JSXIdentifier' ? attr.name.name : `${attr.name.namespace.name}:${attr.name.name.name}`;
      if (seenAttrs.has(name)) issues.push({ level: 'error', message: `<${type}> 属性 ${name} 重复，不能静默覆盖` });
      seenAttrs.add(name);
      let value: PropValue;
      if (attr.value === null || attr.value === undefined) value = true;
      else if (attr.value.type === 'StringLiteral') value = attr.value.value;
      else if (attr.value.type === 'JSXExpressionContainer') {
        value =
          attr.value.expression.type === 'JSXEmptyExpression'
            ? true
            : exprToValue(attr.value.expression);
      } else value = { $kind: 'raw', code: source.slice(attr.value.start ?? 0, attr.value.end ?? 0) };

      if (name === 'pfId' && typeof value === 'string') pfId = value;
      else Object.defineProperty(props, name, { value, enumerable: true, configurable: true, writable: true });
    }

    if (!pfId || seenIds.has(pfId)) {
      if (pfId && seenIds.has(pfId)) {
        issues.push({ level: 'warning', message: `pfId "${pfId}" 重复，已自动重新分配`, pfId });
      }
      pfId = genPfId(type);
      normalized = true;
    }
    seenIds.add(pfId);

    const children: ProtoChild[] = [];
    for (const ch of el.children) {
      if (ch.type === 'JSXElement') children.push(convert(ch));
      else if (ch.type === 'JSXText') {
        const txt = ch.value.replace(/\s+/g, ' ').trim();
        if (txt) children.push({ kind: 'text', value: txt });
      } else if (ch.type === 'JSXExpressionContainer') {
        if (ch.expression.type === 'StringLiteral') children.push({ kind: 'text', value: ch.expression.value });
        else if (ch.expression.type === 'TemplateLiteral' && ch.expression.expressions.length === 0) {
          children.push({ kind: 'text', value: ch.expression.quasis.map((q) => q.value.cooked ?? '').join('') });
        } else if (ch.expression.type !== 'JSXEmptyExpression') {
          issues.push({ level: 'warning', message: `<${type}> 内的表达式子节点不受支持，已忽略` });
        }
      } else if (ch.type === 'JSXFragment') {
        issues.push({ level: 'warning', message: `<${type}> 内的 Fragment <>…</> 已展开` });
        for (const fc of ch.children) if (fc.type === 'JSXElement') children.push(convert(fc));
      } else if (ch.type === 'JSXSpreadChild') {
        issues.push({ level: 'error', message: `<${type}> 内的展开子节点 {...} 不受支持` });
      }
    }

    return { kind: 'node', pfId, type, props, children };
  };

  const root = convert(rootJsx);
  return { doc: { header, root }, issues, normalized };
}

function findRootJsx(file: t.File): t.JSXElement | null {
  const fromNode = (n: t.Node | null | undefined): t.JSXElement | null => {
    if (!n) return null;
    if (n.type === 'JSXElement') return n;
    if (n.type === 'ParenthesizedExpression') return fromNode(n.expression);
    if (n.type === 'JSXFragment') {
      const first = n.children.find((c) => c.type === 'JSXElement');
      return (first as t.JSXElement) ?? null;
    }
    if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration') {
      if (n.body.type === 'BlockStatement') {
        for (const st of n.body.body) if (st.type === 'ReturnStatement') return fromNode(st.argument);
        return null;
      }
      return fromNode(n.body);
    }
    return null;
  };

  for (const st of file.program.body) {
    if (st.type === 'ExportDefaultDeclaration') {
      const r = fromNode(st.declaration as t.Node);
      if (r) return r;
    }
  }
  for (const st of file.program.body) {
    if (st.type === 'FunctionDeclaration') {
      const r = fromNode(st);
      if (r) return r;
    }
    if (st.type === 'ExpressionStatement') {
      const r = fromNode(st.expression);
      if (r) return r;
    }
  }
  return null;
}
