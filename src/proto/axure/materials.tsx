import React from 'react';
import { isNode } from '../types';
import type { CompProps } from '../registry/components';
import { AXURE_LEAF_KINDS } from './metadata';

const finite = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
type Appearance = Record<string, any>;
export function positionedStyle(p: Appearance): React.CSSProperties {
  return {
    boxSizing: 'border-box', width: '100%', height: '100%', color: p.color, backgroundColor: p.background,
    fontFamily: p.fontFamily, fontSize: p.fontSize, fontWeight: p.fontWeight, textAlign: p.align,
    borderColor: p.edgeColors ?? p.borderColor, borderWidth: p.edgeWidths ?? p.borderWidth,
    borderRadius: p.radius, borderStyle: p.edgeWidths || p.borderWidth ? 'solid' : undefined,
    padding: p.padding, opacity: p.opacity, lineHeight: 1.2,
  };
}
const justify = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;
const align = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;
export function textFrameStyle(p: Appearance): React.CSSProperties {
  return { ...positionedStyle(p), display: 'flex', alignItems: align[p.vertical as keyof typeof align] ?? 'center',
    justifyContent: justify[p.align as keyof typeof justify] ?? 'center', overflow: 'hidden', whiteSpace: 'pre-wrap' };
}
export function AxureCanvas({ node, p, kids, children, rt, scope }: CompProps) {
  const topLevel = node.type === 'AxureCanvas';
  const frames = kids.map(kid => {
    const f = (kid.props.layoutFrame ?? kid.props) as Appearance;
    const pinned = !rt.isDesign && kid.type === 'DynamicPanel' && f.pinX && f.pinY;
    let width = Math.max(0,finite(f.width,96)), height = Math.max(0,finite(f.height,30));
    if (!rt.isDesign && kid.type === 'DynamicPanel' && f.fitContent) {
      const state = kid.children.filter(isNode)[rt.tabs[kid.pfId] ?? finite(f.activeState,1) - 1];
      if (state) {
        width = 0; height = 0;
        for (const child of state.children.filter(isNode)) {
          const c = (child.props.layoutFrame ?? child.props) as Appearance;
          if (rt.hidden[child.pfId] ?? c.hidden) continue;
          width = Math.max(width, finite(c.x,0) + finite(c.width,96));
          height = Math.max(height, finite(c.y,0) + finite(c.height,30));
        }
      }
    }
    let pinStyle: React.CSSProperties | undefined;
    if (pinned) {
      const mx = finite(f.pinMarginX,0), my = finite(f.pinMarginY,0);
      pinStyle = { position:'fixed', zIndex:f.pinInFront ? 1 : undefined,
        left:f.pinX === 'left' ? mx : f.pinX === 'center' ? `calc(50% + ${mx}px)` : undefined,
        right:f.pinX === 'right' ? mx : undefined,
        top:f.pinY === 'top' ? my : f.pinY === 'middle' ? `calc(50% + ${my}px)` : undefined,
        bottom:f.pinY === 'bottom' ? my : undefined,
        transform:`translate(${f.pinX === 'center' ? '-50%' : '0'}, ${f.pinY === 'middle' ? '-50%' : '0'})` };
    }
    return { x:finite(f.x,0), y:finite(f.y,0), width, height, pinStyle, hidden:rt.hidden[kid.pfId] ?? (f.hidden === true) };
  });
  const visible = frames.filter(f => !f.hidden && !f.pinStyle);
  const left = topLevel ? visible.reduce((min,f) => Math.min(min,f.x),0) : 0;
  const top = topLevel ? visible.reduce((min,f) => Math.min(min,f.y),0) : 0;
  const width = visible.reduce((max,f) => Math.max(max,f.x+f.width-left),1);
  const height = visible.reduce((max,f) => Math.max(max,f.y+f.height-top),1);
  const content = <div className="relative h-full w-full" style={topLevel ? { minWidth: width, minHeight: height } : { overflow: p.clip ? 'hidden' : undefined }}
    onClick={p.onClick && !p.disabled && !rt.isDesign ? () => rt.run(p.onClick,scope) : undefined}>
    {children.map((child,i) => {
      const f = frames[i];
      if (f.hidden) return null;
      const scroll = ['Form','QueryForm','Table'].includes(kids[i].type);
      return <div key={kids[i].pfId} className="absolute [&>div]:h-full" style={{ left: f.x-left, top: f.y-top, width: f.width, height: f.height,
        ...f.pinStyle, overflow: scroll ? 'auto' : undefined,
        pointerEvents: kids[i].type === 'PositionedGroup' && !kids[i].props.onClick ? 'none' : 'auto' }}>{child}</div>;
    })}
  </div>;
  return topLevel ? <div className="max-w-full overflow-auto">{content}</div> : content;
}

export function DynamicPanel({ node, p, children, rt, scope }: CompProps) {
  const initial = finite(p.activeState, 1) - 1;
  const index = rt.isDesign ? initial : rt.tabs[node.pfId] ?? initial;
  const fit = !rt.isDesign && p.fitContent;
  return <div className="h-full w-full [&>div]:h-full" style={{ width: fit ? '100%' : p.width, height: fit ? '100%' : p.height, overflow: p.clip ? 'hidden' : undefined }}
    onClick={p.onClick && !p.disabled && !rt.isDesign ? () => rt.run(p.onClick,scope) : undefined}>{children[index]}</div>;
}
export function OutlineTree({ p, children, rt, scope }: CompProps) {
  return <div style={{ width: p.width, minHeight: p.height }} onClick={p.onClick && !p.disabled && !rt.isDesign ? () => rt.run(p.onClick,scope) : undefined}>{children}</div>;
}
function styledText(p: Appearance) {
  if (!Array.isArray(p.runs) || p.runs.map((r: Appearance) => r.text).join('') !== p.text) return p.text;
  return p.runs.map((r: Appearance, i: number) => <span key={i}
    style={{ fontSize: r.fontSize, fontWeight: r.fontWeight, color: r.color, fontFamily: r.fontFamily }}>{r.text}</span>);
}
export function TreeItem({ node, p, children, rt, scope }: CompProps) {
  if (rt.hidden[node.pfId] ?? p.hidden) return null;
  const row: React.CSSProperties = { minHeight: p.height, fontSize: p.fontSize, color: p.color, fontWeight: p.fontWeight, fontFamily: p.fontFamily };
  const text = styledText(p);
  const click = () => { if (!rt.isDesign && !p.disabled && p.onClick) rt.run(p.onClick,scope); };
  if (!children.length) return <div style={{ ...row, marginLeft:p.indent, paddingLeft:'1em' }}>{p.onClick ? <button disabled={p.disabled} onClick={click}>{text}</button> : text}</div>;
  return <details open={p.expanded} style={{ marginLeft:p.indent }}><summary style={{ ...row, display:'list-item', cursor:'pointer' }}
    onClick={event => { if (rt.isDesign || p.disabled) event.preventDefault(); click(); }}>{text}</summary>{children}</details>;
}
const CellStyle = React.createContext<Appearance>({});
export function StaticTable({ p, kids, children, rt, scope }: CompProps) {
  const widths: number[] = Array.isArray(p.columnWidths) ? p.columnWidths : [];
  const heights: number[] = Array.isArray(p.rowHeights) ? p.rowHeights : [];
  if (!widths.length || kids.length !== widths.length * heights.length) return <div role="status">请核对表格的行高、列宽和单元格数量</div>;
  return <CellStyle.Provider value={p.cellStyle ?? {}}><table aria-label={p.label} style={{ borderSpacing: 0, borderCollapse: 'collapse', tableLayout: 'fixed', width: widths.reduce((a,b) => a+b,0) }}
    onClick={p.onClick && !p.disabled && !rt.isDesign ? () => rt.run(p.onClick,scope) : undefined}>
    <colgroup>{widths.map((width,i) => <col key={i} style={{ width }} />)}</colgroup>
    <tbody>{heights.map((height,row) => <tr key={row}>{widths.map((_,col) => {
      const i = row * widths.length + col;
      const a = { ...p.cellStyle, ...kids[i].props };
      return <td key={kids[i].pfId} style={{ height, padding: 0, position: 'relative', borderStyle: 'solid', borderWidth: a.edgeWidths ?? a.borderWidth ?? 0, borderColor: a.edgeColors ?? a.borderColor }}>
        <div className="absolute inset-0 [&>div]:h-full">{children[i]}</div></td>;
    })}</tr>)}</tbody>
  </table></CellStyle.Provider>;
}

export function AxureWidget({ p, node, rt, scope }: CompProps) {
  const kind = AXURE_LEAF_KINDS[node.type] ?? p.kind;
  const cell = React.useContext(CellStyle);
  const a = kind === 'cell' ? { ...cell, ...p } : p;
  const run = () => { if (!rt.isDesign && !p.disabled && p.onClick) rt.run(p.onClick,scope); };
  const style = textFrameStyle(a);
  if (kind === 'cell') { style.borderWidth = 0; style.borderStyle = 'none'; }
  if (rt.isDesign) style.pointerEvents = 'none';
  const label = p.label || p.text || undefined;
  const common = { style, 'aria-label': label, disabled: p.disabled, onClick: run };
  if (kind === 'input' || kind === 'textarea') {
    const Tag = kind === 'input' ? 'input' : 'textarea';
    return <Tag key={p.text} {...common} className="border border-slate-400 px-1" defaultValue={p.text} readOnly={p.readOnly} placeholder={p.placeholder} />;
  }
  if (kind === 'checkbox' || kind === 'radio') {
    return <label style={style} className="flex items-center gap-1"><input key={String(p.checked)} type={kind} aria-label={label}
      defaultChecked={p.checked} name={kind === 'radio' ? p.radioGroup : undefined} disabled={p.disabled} onClick={run} />{p.text}</label>;
  }
  if (kind === 'select' || kind === 'list') {
    const selected = Array.isArray(p.selectedOptions) ? p.selectedOptions.map(String) : [];
    const options: unknown[] = Array.isArray(p.choices) ? p.choices : [];
    return <select key={JSON.stringify([selected, options, p.multiple])} {...common} multiple={p.multiple}
      size={kind === 'list' ? Math.max(2, options.length) : undefined} defaultValue={p.multiple ? selected : selected[0] ?? ''}>
      {!p.multiple && !selected.length && <option value="" hidden />}
      {options.map((opt,i) => <option key={i} value={i}>{String(opt)}</option>)}
    </select>;
  }
  if (kind === 'hotspot') return p.onClick ? <button type="button" {...common} style={{ ...style, background: 'transparent' }} aria-label={label ?? '交互热区'} /> : <div style={style} />;
  const content = kind === 'image' && typeof p.image === 'string' && /^data:image\/(png|jpeg);base64,/.test(p.image)
    ? <img className="w-full h-full" src={p.image} alt={p.label ?? ''} />
    : <span style={{ position: 'relative' }}>{styledText(a)}</span>;
  const Tag = p.onClick ? 'button' : 'div';
  if (p.path) { style.backgroundColor = 'transparent'; style.borderWidth = 0; }
  return <Tag {...common} title={p.label} className={'relative ' + (kind === 'placeholder' ? 'border border-dashed border-slate-400 text-slate-600' : '')}>
    {p.path && <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
      <path d={p.path} fill={p.background ?? 'none'} fillRule="evenodd" stroke={p.borderColor ?? 'none'} strokeWidth={p.borderWidth ?? 0} vectorEffect="non-scaling-stroke" />
    </svg>}{content}
  </Tag>;
}
