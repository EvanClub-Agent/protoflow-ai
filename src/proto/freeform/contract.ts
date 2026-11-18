import { parse } from '@babel/parser';
import type { DBTableSchema } from '../../store/useProtoStore';

export const FREEFORM_SOURCE_LIMIT = 60000;
export const FREEFORM_STYLE_LIMIT = 20000;
export const FREEFORM_DEFAULT_SOURCE = `export default function Component() {
  return <section className="welcome"><span className="mark">✦</span><h3>让想法自由生长</h3><p>选中这个区域，告诉 AI 你想呈现的效果。</p><div className="ideas"><span>交互座位图</span><span>创意流程</span><span>特色展示</span></div></section>;
}`;
export const FREEFORM_DEFAULT_CSS = `:root{background:transparent;color-scheme:var(--pf-color-scheme)}.welcome{min-height:240px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center;background:var(--pf-bg-layout,#f8fafc);border:1px dashed var(--pf-border,#cbd5e1);border-radius:16px;color:var(--pf-text,#334155)}.mark{font-size:32px;color:#6366f1}.welcome h3{font-size:19px;margin:12px 0 0}.welcome p{font-size:13px;color:var(--pf-text-secondary,#64748b);line-height:1.7}.ideas{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:8px}.ideas span{padding:5px 10px;border:1px solid var(--pf-border-secondary,#e2e8f0);border-radius:20px;font-size:11px;background:var(--pf-bg-container,white)}`;

const blockedTags = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base', 'html', 'head', 'body']);
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => isJsonValue(item, depth + 1));
  return !!value && typeof value === 'object' && Object.entries(value).every(([key, item]) => !forbiddenKeys.has(key) && isJsonValue(item, depth + 1));
}

/** Syntax/support contract, not a replacement for the iframe security boundary. */
export function freeformSourceErrors(source: unknown, css: unknown = ''): string[] {
  const errors: string[] = [];
  if (typeof source !== 'string' || !source.trim() || source.length > FREEFORM_SOURCE_LIMIT) return ['自由组件需要完整内容，且源码不能超过 60000 字符'];
  if (typeof css !== 'string' || css.length > FREEFORM_STYLE_LIMIT) errors.push('自由组件样式必须是文本，且不能超过 20000 字符');
  try {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    const entry = ast.program.body[0];
    if (ast.program.body.length !== 1 || entry?.type !== 'ExportDefaultDeclaration' || entry.declaration.type !== 'FunctionDeclaration' || entry.declaration.id?.name !== 'Component' || entry.declaration.async || entry.declaration.generator) {
      errors.push('自由组件内容必须为单个 export default function Component({ data, emit })；辅助函数写在组件内部，不使用 import');
    }
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'ImportExpression' || node.type === 'ImportDeclaration' || node.type === 'Import') errors.push('自由组件不支持加载外部模块');
      if (node.type === 'Identifier' && node.name.startsWith('__pf')) errors.push('__pf 前缀为自由组件运行环境保留');
      if (node.type === 'Identifier' && ['eval', 'Function'].includes(node.name)) errors.push('自由组件不支持动态执行字符串代码');
      if (node.type === 'JSXOpeningElement') {
        const name = node.name;
        if (name.type === 'JSXIdentifier' && (blockedTags.has(name.name.toLowerCase()) || !/^[a-z]/.test(name.name))) errors.push(`自由组件内部不支持 <${name.name}>；使用原生 HTML/SVG 元素`);
        if (name.type === 'JSXMemberExpression' && !(name.object.name === 'React' && name.property.name === 'Fragment')) errors.push('自由组件内部仅支持原生元素和 React.Fragment');
      }
      if (node.type === 'JSXAttribute' && node.name.name === 'dangerouslySetInnerHTML') errors.push('使用 JSX 元素表达内容，不使用 dangerouslySetInnerHTML');
      for (const [key, child] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'comments', 'tokens'].includes(key)) continue;
        if (Array.isArray(child)) child.forEach(visit);
        else if (child && typeof child === 'object') visit(child);
      }
    };
    visit(ast.program);
  } catch (error) { errors.push(`自由组件语法错误：${error instanceof Error ? error.message : String(error)}`); }
  return [...new Set(errors)];
}

export function freeformBindingErrors(props: Record<string, unknown>, tables: DBTableSchema[]): string[] {
  if (props.table === undefined) return props.columns === undefined ? [] : ['展示字段需要先关联数据表'];
  const table = tables.find(t => t.id === props.table);
  if (!table) return [`自由组件关联的数据表不存在：${String(props.table)}`];
  if (!Array.isArray(props.columns) || !props.columns.length) return ['自由组件关联数据表时必须明确指定展示字段 columns'];
  return props.columns.filter(name => typeof name !== 'string' || !table.columns.some(c => c.name === name)).map(name => `自由组件引用了不存在的字段：${table.id}.${String(name)}`);
}

export function freeformInputs(props: Record<string, unknown>, tables: DBTableSchema[], rows: Record<string, unknown>[]): Record<string, unknown> {
  const errors = freeformBindingErrors(props, tables);
  if (errors.length) throw new Error(errors.join('；'));
  const data = props.data === undefined ? {} : props.data;
  if (!data || Array.isArray(data) || typeof data !== 'object' || !isJsonValue(data)) throw new Error('自由组件输入数据必须是有效的 JSON 对象');
  if (props.table === undefined) return data as Record<string, unknown>;
  if (Object.hasOwn(data, 'rows')) throw new Error('绑定数据表时 data.rows 由表数据提供，不能重复设置');
  const columns = props.columns as string[];
  return { ...data, rows: rows.map((row, index) => Object.fromEntries(columns.map(name => {
    if (!Object.hasOwn(row, name)) throw new Error(`第 ${index + 1} 条数据缺少字段 ${name}`);
    if (!isJsonValue(row[name])) throw new Error(`第 ${index + 1} 条数据的字段 ${name} 不是有效 JSON`);
    return [name, row[name]];
  }))) };
}

export interface FreeformEventField { name: string; type: 'string' | 'number' | 'boolean' }
export function validateFreeformEvent(payload: unknown, fields: FreeformEventField[]): asserts payload is Record<string, unknown> {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object' || !isJsonValue(payload) || JSON.stringify(payload).length > 20000) throw new Error('自由组件事件数据无效');
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).length !== fields.length || fields.some(f => !Object.hasOwn(record, f.name) || typeof record[f.name] !== f.type)) throw new Error('自由组件事件数据与 eventFields 声明不一致');
}

/** An exact event placeholder preserves number/boolean types; missing fields fail. */
export function resolveFreeformEvent(value: unknown, payload: Record<string, unknown>): any {
  if (typeof value === 'string') {
    const get = (key: string) => {
      if (forbiddenKeys.has(key) || !Object.hasOwn(payload, key)) throw new Error(`事件数据缺少 ${key}`);
      return payload[key];
    };
    const exact = /^\{\{event\.([A-Za-z_][\w]*)\}\}$/.exec(value);
    if (exact) return get(exact[1]);
    return value.replace(/\{\{event\.([A-Za-z_][\w]*)\}\}/g, (_, key) => String(get(key)));
  }
  if (Array.isArray(value)) return value.map(item => resolveFreeformEvent(item, payload));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveFreeformEvent(item, payload)]));
  return value;
}
