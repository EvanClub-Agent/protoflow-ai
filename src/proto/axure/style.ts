import { field, type Graph, type RpObject, type Value } from './binary';
import type { ProtoNode, PropValue } from '../types';

type Props = ProtoNode['props'];
export const part = (o: RpObject, key: string) => field(o.body, key);
const doa = (index: number) => 0xc0000000 + index;
function values(props?: Value) {
  const result = new Map<number, Value>();
  for (const p of props?.items ?? []) {
    const key = field(p, 'DOAName')?.n, value = field(p, 'Value');
    if (key !== undefined && value) result.set(key, value);
  }
  return result;
}
export function documentDefaults(graph: Graph) {
  const sheet = part(graph.root, 'StyleSheet');
  if (!sheet || graph.isNull(sheet)) return values();
  const ref = part(graph.object(sheet), 'DefaultStyle');
  return values(ref && !graph.isNull(ref) ? part(graph.object(ref), 'PropList') : undefined);
}
export function cssColor(n: number) {
  const argb = (n >>> 0).toString(16).padStart(8, '0');
  return '#' + argb.slice(2) + (argb.startsWith('ff') ? '' : argb.slice(0, 2));
}
const solid = (v?: Value) => {
  const argb = field(v, 'fill-color')?.n;
  return field(v, 'fill-type')?.text === 'solid' && argb !== undefined ? cssColor(argb) : undefined;
};
export function diagramStyles(graph: Graph, defaults: Map<number, Value>, account: (size: number) => void) {
  const styles = new Map<number, Map<number, Value>>();
  for (const style of field(part(graph.root, 'StyleCache'), 'Styles')?.items ?? []) {
    const id = field(field(style, 'Info'), 'Id')?.n;
    if (id !== undefined) styles.set(id, values(field(style, 'Props')));
  }
  return (w: RpObject) => {
    const ref = part(w, 'MyStyle');
    const local = values(ref && !graph.isNull(ref) ? part(graph.object(ref), 'PropList') : undefined);
    const base = styles.get(local.get(doa(0))?.n!);
    const prop = (i: number) => local.get(doa(i)) ?? base?.get(doa(i)) ?? defaults.get(doa(i));
    const frame: Props = {};
    const geometry = (i: number) => local.get(doa(i)) ?? base?.get(doa(i));
    for (const [key, value] of Object.entries({ x: field(geometry(101), 'X'), y: field(geometry(101), 'Y'),
      width: field(geometry(105), 'Width'), height: field(geometry(105), 'Height') })) {
      if (value?.n !== undefined && Number.isFinite(value.n)) frame[key] = value.n;
    }
    const label = field(part(w, 'name-block'), 'text')?.text;
    if (label) frame.label = label;
    if (prop(110)?.n === 0 || part(w, 'VisibleFromSettings')?.n === 0) frame.hidden = true;
    const visual: Props = {};
    const size = prop(2)?.n;
    for (const [key, value] of Object.entries({ color: solid(prop(6)), background: solid(prop(7)), borderColor: solid(prop(8)),
      borderWidth: prop(15)?.n, radius: prop(71)?.n, fontSize: size === undefined ? undefined : size * 4 / 3,
      fontFamily: prop(1)?.text, fontWeight: prop(1001)?.n, align: ['left','center','right'][prop(9)?.n!],
      vertical: ['top','middle','bottom'][prop(10)?.n!], opacity: prop(70)?.n })) {
      if (value !== undefined && (typeof value !== 'number' || Number.isFinite(value))) visual[key] = value;
    }
    const padding = [12,13,14,11].map(i => prop(i)?.n);
    if (padding.every(n => n !== undefined && Number.isFinite(n))) visual.padding = padding.map(n => n + 'px').join(' ');
    const paragraphs = field(field(part(w, 'RichTextBlock'), 'attributed-string'), 'Paragraphs')?.items;
    let text = field(part(w, 'TextBlock'), 'text')?.text;
    const runs: Props[] = [];
    if (!paragraphs && text) account(text.length);
    if (paragraphs) {
      for (const [i, p] of paragraphs.entries()) {
        if (i) runs.push({ text: '\n' });
        for (const run of field(p, 'Inlines')?.items ?? []) {
          const s = field(run, 'Text')?.text;
          if (!s) continue;
          account(s.length + 1);
          const seg: Props = { text: s };
          const family = field(run, 'Family')?.text;
          if (family && !local.has(doa(1))) seg.fontFamily = family;
          const color = field(run, 'Color')?.n, weight = field(run, 'Weight')?.n, size = field(run, 'Size')?.n;
          if (color !== undefined && !local.has(doa(6))) seg.color = cssColor(color);
          if (weight !== undefined && !local.has(doa(1001))) seg.fontWeight = weight;
          if (size !== undefined && Number.isFinite(size) && !local.has(doa(2))) seg.fontSize = size * 4 / 3;
          runs.push(seg);
        }
      }
      text = runs.map(r => r.text).join('');
      if (!local.has(doa(9))) {
        const align = ['left','center','right'][field(paragraphs[0], 'HorizontalAlignment')?.n!];
        if (align) visual.align = align;
      }
    }
    const parts = runs.filter(r => r.text !== '\n');
    for (const key of ['color', 'fontWeight', 'fontSize', 'fontFamily']) {
      if (parts.length && parts[0][key] !== undefined && parts.every(r => r[key] === parts[0][key])) {
        visual[key] = parts[0][key]; parts.forEach(r => { delete r[key]; });
      }
    }
    return { frame, visual, text, runs: runs.some(r => Object.keys(r).length > 1) ? runs : undefined, prop };
  };
}

export function vectorPath(w: RpObject): string | undefined {
  const contours = part(w, 'ControlPoints')?.items;
  if (!contours || part(w, 'Shape')?.n === 0) return;
  const point = (p: Value, key: string) => {
    const v = field(p,key), x = field(v,'X')?.n, y = field(v,'Y')?.n;
    if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y))
      return Number(x.toFixed(5)) + ' ' + Number(y.toFixed(5));
  };
  const paths: string[] = [];
  for (const c of contours) {
    const points = c.items;
    if (!points?.length) continue;
    const first = point(points[0], 'Path');
    if (!first) return;
    paths.push('M' + first);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const end = point(b, 'Path');
      if (!end) return;
      if (field(a, 'HigherSegmentExists')?.n === 0) { if (i+1 < points.length) paths.push('M' + end); continue; }
      const c1 = point(a, 'HigherHandle'), c2 = point(b, 'LowerHandle');
      paths.push(c1 || c2 ? 'C' + (c1 ?? point(a, 'Path')) + ' ' + (c2 ?? end) + ' ' + end : 'L' + end);
      if (i === points.length - 1) paths.push('Z');
    }
  }
  return paths.length ? paths.join('') : undefined;
}
export function cellEdges(w: RpObject, visual: Record<string, PropValue>) {
  const sides = ['top','right','bottom','left'];
  for (const [key, fieldName] of [['edgeWidths', 'width'], ['edgeColors', 'color']]) {
    const nums = sides.map(s => part(w,s + '-border-' + fieldName)?.n);
    if (nums.every(n => n !== undefined && Number.isFinite(n))) {
      const formatted = nums.map(n => fieldName === 'width' ? n + 'px' : cssColor(n!));
      if (nums.every(n => n === nums[0])) visual[fieldName === 'width' ? 'borderWidth' : 'borderColor'] = fieldName === 'width' ? nums[0]! : formatted[0];
      else visual[key] = formatted.join(' ');
    }
  }
}
