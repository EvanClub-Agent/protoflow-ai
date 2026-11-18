import { freeformSourceErrors } from './contract';

const cache = new Map<string, string>();
export async function compileFreeform(source: string): Promise<string> {
  const previous = cache.get(source);
  if (previous !== undefined) return previous;
  const errors = freeformSourceErrors(source);
  if (errors.length) throw new Error(errors.join('；'));
  const Babel = await import('@babel/standalone');
  const result = Babel.transform(source, {
    filename: 'freeform.tsx',
    presets: [['react', { runtime: 'classic' }], 'typescript'],
    plugins: [({ types: t }: any) => ({ visitor: {
      ExportDefaultDeclaration(path: any) { path.replaceWith(path.node.declaration); },
      'Function|Loop'(path: any) {
        if (!path.node.body) return;
        const check = t.expressionStatement(t.callExpression(t.identifier('__pfGuard'), []));
        if (path.node.body.type !== 'BlockStatement') path.node.body = t.blockStatement(path.isFunction() ? [t.returnStatement(path.node.body)] : [path.node.body]);
        path.node.body.body.unshift(check);
      },
    } })],
  });
  if (!result?.code) throw new Error('自由组件未能生成可预览的内容');
  if (cache.size >= 30) cache.delete(cache.keys().next().value!);
  cache.set(source, result.code);
  return result.code;
}
