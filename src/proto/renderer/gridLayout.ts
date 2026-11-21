import { isNode, type ProtoNode } from '../types';
import { tr } from '../../i18n/runtime';

export const FLOW_GRID_CONTAINERS = new Set(['Page', 'Card', 'Tab', 'Modal', 'Drawer', 'Col', 'Form', 'CollapsePanel']);
const WIDTH_SPANS: Record<string, number> = { '1/4': 3, '1/3': 4, '1/2': 6, '2/3': 8, '3/4': 9, full: 12 };

/** Shared by the renderer and inspector so inherited widths have the same active state. */
export function flowGridSpan(node: ProtoNode, parent: ProtoNode | null, inline = false): number {
  const width = node.props.width;
  if (typeof width === 'string' && WIDTH_SPANS[width]) return WIDTH_SPANS[width];
  if (width === 'auto') return inline ? 2 : 4;
  if (parent?.type === 'Form') {
    const cols = Math.max(1, Math.min(4, Number(parent.props.cols ?? 2)));
    return Math.min(12, Math.max(1, Number(node.props.span ?? 1)) * Math.round(12 / cols));
  }
  if (parent?.type === 'Card' && parent.props.cols) return Math.round(12 / Math.max(1, Math.min(4, Number(parent.props.cols))));
  return 12;
}

export const columnSpan = (node: ProtoNode): number => Math.max(1, Math.min(24, Number(node.props.span ?? 12)));

export function columnWidthLabel(span: number): string {
  if (span === 24) return tr('整行', 'Full Row');
  let a = span, b = 24;
  while (b) [a, b] = [b, a % b];
  return `${span / a}/${24 / a}`;
}

/** Only the last column on a visual line can grow without moving its neighbours. */
export function trailingColumnSpace(row: ProtoNode | null, col: ProtoNode | null): { remaining: number; nextSpan: number } | null {
  if (row?.type !== 'Row' || col?.type !== 'Col') return null;
  const columns = row.children.filter(isNode);
  if (columns.some(node => node.type !== 'Col' || !Number.isInteger(columnSpan(node)))) return null;
  let used = 0;
  for (let i = 0; i < columns.length; i++) {
    const current = columns[i], span = columnSpan(current);
    if (used + span > 24) used = 0;
    used += span;
    if (current.pfId !== col.pfId) continue;
    const remaining = 24 - used;
    if (!remaining || (columns[i + 1] && columnSpan(columns[i + 1]) <= remaining)) return null;
    return { remaining, nextSpan: span + remaining };
  }
  return null;
}
