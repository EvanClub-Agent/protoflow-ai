import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { CompProps } from '../registry/components';
import type { PropValue, ProtoNode } from '../types';
import { useI18n } from '../../i18n';

type AnyProps = Record<string, any>;

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

function applyBackground(bg: unknown): React.CSSProperties {
  if (typeof bg !== 'string' || !bg.trim()) return {};
  const val = bg.trim();
  if (val.startsWith('linear-gradient(') || val.startsWith('radial-gradient(')) {
    return { backgroundImage: val };
  }
  return { backgroundColor: val };
}

function surfaceDecorationStyle(p: AnyProps): React.CSSProperties {
  const hasBorder = num(p.borderWidth, 0) > 0 && typeof p.borderColor === 'string' && p.borderColor;
  return {
    boxSizing: 'border-box',
    ...applyBackground(p.background),
    borderRadius: typeof p.cornerRadii === 'string' && p.cornerRadii ? p.cornerRadii : p.radius,
    borderWidth: hasBorder ? p.borderWidth : undefined,
    borderColor: hasBorder ? p.borderColor : undefined,
    borderStyle: hasBorder ? (p.borderStyle === 'dashed' ? 'dashed' : 'solid') : undefined,
    boxShadow: typeof p.shadow === 'string' && p.shadow ? p.shadow : undefined,
    backdropFilter: num(p.backdropBlur, 0) > 0 ? `blur(${num(p.backdropBlur, 0)}px)` : undefined,
    WebkitBackdropFilter: num(p.backdropBlur, 0) > 0 ? `blur(${num(p.backdropBlur, 0)}px)` : undefined,
    opacity: typeof p.opacity === 'number' ? p.opacity : undefined,
    transform: num(p.rotation, 0) !== 0 ? `rotate(${num(p.rotation, 0)}deg)` : undefined,
  };
}

function renderLayoutChildren(
  parentProps: AnyProps,
  kids: ProtoNode[],
  children: React.ReactNode[],
  hiddenMap: Record<string, boolean | undefined>,
  originOffset = { x: 0, y: 0 },
): React.ReactNode {
  const layoutMode = parentProps.layoutMode === 'row' || parentProps.layoutMode === 'column' ? parentProps.layoutMode : 'none';
  const isRow = layoutMode === 'row';

  if (layoutMode === 'none') {
    return children.map((child, idx) => {
      const kid = kids[idx];
      if (!kid) return null;
      const kp = kid.props as AnyProps;
      if (hiddenMap[kid.pfId] ?? kp.hidden === true) return null;
      const w = Math.max(0, num(kp.width, 80));
      const h = Math.max(0, num(kp.height, 28));
      const sizingH = kp.sizingH as string | undefined;
      const sizingV = kp.sizingV as string | undefined;
      return (
        <div
          key={kid.pfId}
          className="[&>div]:h-full [&>div]:w-full"
          style={{
            position: 'absolute',
            left: num(kp.x, 0) - originOffset.x,
            top: num(kp.y, 0) - originOffset.y,
            width: sizingH === 'hug' ? 'max-content' : w || undefined,
            maxWidth: sizingH === 'hug' && w > 0 ? Math.max(w * 1.35, w + 48) : undefined,
            height: sizingV === 'hug' ? 'auto' : h || undefined,
            minHeight: sizingV === 'hug' && h > 0 ? h : undefined,
          }}
        >
          {child}
        </div>
      );
    });
  }

  return children.map((child, idx) => {
    const kid = kids[idx];
    if (!kid) return null;
    const kp = kid.props as AnyProps;
    if (hiddenMap[kid.pfId] ?? kp.hidden === true) return null;
    const isAbs = kp.positioning === 'absolute';
    const w = Math.max(0, num(kp.width, 0));
    const h = Math.max(0, num(kp.height, 0));
    const sizingH = (kp.sizingH as string) || 'fixed';
    const sizingV = (kp.sizingV as string) || 'fixed';

    if (isAbs) {
      return (
        <div
          key={kid.pfId}
          className="[&>div]:h-full [&>div]:w-full"
          style={{
            position: 'absolute',
            left: num(kp.x, 0),
            top: num(kp.y, 0),
            width: sizingH === 'hug' ? 'max-content' : w || undefined,
            height: sizingV === 'hug' ? 'auto' : h || undefined,
            zIndex: 2,
          }}
        >
          {child}
        </div>
      );
    }

    // Main-axis sizing uses flex shorthand (single source of truth per CSS Flexbox spec);
    // cross-axis sizing uses alignSelf / definite cross dimension.
    const mainSizing = isRow ? sizingH : sizingV;
    const crossSizing = isRow ? sizingV : sizingH;
    const mainPx = isRow ? w : h;
    const crossPx = isRow ? h : w;

    const flex =
      mainSizing === 'fill'
        ? '1 1 0%'
        : mainSizing === 'hug'
        ? '0 0 auto'
        : mainPx > 0
        ? `0 0 ${mainPx}px`
        : '0 0 auto';

    const crossStyle: React.CSSProperties =
      crossSizing === 'fill'
        ? { alignSelf: 'stretch' }
        : crossSizing === 'fixed' && crossPx > 0
        ? isRow
          ? { height: crossPx }
          : { width: crossPx }
        : {};

    const fillStretchCls = cx(
      'min-w-0',
      (sizingH === 'fill' || sizingH === 'fixed') && '[&>div]:w-full',
      (sizingV === 'fill' || sizingV === 'fixed') && '[&>div]:h-full',
    );

    return (
      <div
        key={kid.pfId}
        className={fillStretchCls}
        style={{
          flex,
          ...crossStyle,
        }}
      >
        {child}
      </div>
    );
  });
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const FigmaCanvas: React.FC<CompProps> = ({ p, kids, children, rt }) => {
  const frameWidth = Math.max(24, num(p.frameWidth, 1280));
  const frameHeight = Math.max(24, num(p.frameHeight, 800));
  const layoutMode = p.layoutMode === 'row' || p.layoutMode === 'column' ? p.layoutMode : 'none';
  const isMobileSized = frameWidth >= 260 && frameWidth <= 540;

  const surfaceStyle: React.CSSProperties = {
    position: 'relative',
    boxSizing: 'border-box',
    width: isMobileSized ? '100%' : frameWidth,
    minHeight: frameHeight,
    height: layoutMode === 'none' ? frameHeight : undefined,
    ...applyBackground(p.background ?? '#FFFFFF'),
    borderRadius: p.radius,
    padding: p.padding,
    overflow: p.clip !== false ? 'clip' : undefined,
    ...(layoutMode !== 'none'
      ? {
          display: 'flex',
          flexDirection: layoutMode,
          gap: num(p.gap, 0),
          justifyContent: p.justify || 'flex-start',
          alignItems: p.align || 'flex-start',
          flexWrap: p.wrap ? 'wrap' : 'nowrap',
        }
      : {}),
  };

  // When inside a 390px MobileViewportShell and original Figma mobile frame was e.g. 375px or 430px,
  // scale free-positioned mobile frames proportionally to fit cleanly without horizontal clipping.
  const inner = (
    <div style={surfaceStyle}>
      {renderLayoutChildren(p, kids, children, rt.hidden)}
    </div>
  );

  if (isMobileSized) {
    return <div className="w-full overflow-x-clip">{inner}</div>;
  }

  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200/80 shadow-2xs bg-slate-100/50">
      {inner}
    </div>
  );
};

export const FigmaFrame: React.FC<CompProps> = ({ node, p, kids, children, rt, scope }) => {
  if (rt.hidden[node.pfId] ?? p.hidden === true) return null;
  const layoutMode = p.layoutMode === 'row' || p.layoutMode === 'column' ? p.layoutMode : 'none';
  const clickable = Boolean(p.onClick) && !p.disabled && !rt.isDesign;

  const style: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: p.sizingV === 'hug' && layoutMode !== 'none' ? 'auto' : '100%',
    minHeight: p.sizingV === 'hug' && num(p.height, 0) > 0 ? num(p.height, 0) : undefined,
    padding: p.padding,
    overflow: p.clip ? 'clip' : undefined,
    cursor: clickable ? 'pointer' : undefined,
    ...surfaceDecorationStyle(p),
    ...(layoutMode !== 'none'
      ? {
          display: 'flex',
          flexDirection: layoutMode,
          columnGap: layoutMode === 'row' ? num(p.gap, 0) : num(p.counterGap ?? p.gap, 0),
          rowGap: layoutMode === 'column' ? num(p.gap, 0) : num(p.counterGap ?? p.gap, 0),
          justifyContent: p.justify || 'flex-start',
          alignItems: p.align || 'flex-start',
          flexWrap: p.wrap ? 'wrap' : 'nowrap',
        }
      : {}),
  };

  return (
    <div
      style={style}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              void rt.run(p.onClick as PropValue, scope);
            }
          : undefined
      }
    >
      {renderLayoutChildren(p, kids, children, rt.hidden)}
    </div>
  );
};

const VERT_ALIGN: Record<string, string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

const HORIZ_JUSTIFY: Record<string, string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
  justify: 'flex-start',
};

export const FigmaText: React.FC<CompProps> = ({ node, p, rt, scope }) => {
  if (rt.hidden[node.pfId] ?? p.hidden === true) return null;
  const clickable = Boolean(p.onClick) && !p.disabled && !rt.isDesign;
  const rawText = typeof p.text === 'string' ? p.text : '';
  const runs = Array.isArray(p.runs) ? (p.runs as AnyProps[]) : null;
  const useRuns = Boolean(runs && runs.length > 0 && runs.map((r) => String(r.text ?? '')).join('') === rawText);

  const textStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    width: '100%',
    height: p.sizingV === 'hug' ? 'auto' : '100%',
    display: 'flex',
    alignItems: VERT_ALIGN[String(p.vertical ?? 'top')] ?? 'flex-start',
    justifyContent: HORIZ_JUSTIFY[String(p.align ?? 'left')] ?? 'flex-start',
    color: p.color || '#0F172A',
    fontFamily: p.fontFamily,
    fontSize: num(p.fontSize, 14),
    fontWeight: p.fontWeight ?? 400,
    fontStyle: p.italic ? 'italic' : undefined,
    textDecoration: p.decoration && p.decoration !== 'none' ? p.decoration : undefined,
    lineHeight: p.lineHeight || 1.4,
    letterSpacing: typeof p.letterSpacing === 'number' ? `${p.letterSpacing}px` : undefined,
    textAlign: (p.align as React.CSSProperties['textAlign']) || 'left',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    opacity: typeof p.opacity === 'number' ? p.opacity : undefined,
    cursor: clickable ? 'pointer' : undefined,
  };

  return (
    <div
      style={textStyle}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              void rt.run(p.onClick as PropValue, scope);
            }
          : undefined
      }
    >
      <span>
        {useRuns
          ? runs!.map((r, idx) => (
              <span
                key={idx}
                style={{
                  color: r.color || undefined,
                  fontSize: typeof r.fontSize === 'number' ? r.fontSize : undefined,
                  fontWeight: r.fontWeight || undefined,
                  fontFamily: r.fontFamily || undefined,
                  fontStyle: r.italic ? 'italic' : undefined,
                  textDecoration: r.underline ? 'underline' : r.lineThrough ? 'line-through' : undefined,
                }}
              >
                {String(r.text ?? '')}
              </span>
            ))
          : rawText}
      </span>
    </div>
  );
};

export const FigmaVector: React.FC<CompProps> = ({ node, p, rt, scope }) => {
  if (rt.hidden[node.pfId] ?? p.hidden === true) return null;
  const clickable = Boolean(p.onClick) && !p.disabled && !rt.isDesign;
  const w = Math.max(1, num(p.width, 24));
  const h = Math.max(1, num(p.height, 24));
  const paths = Array.isArray(p.paths) ? (p.paths as AnyProps[]) : [];
  const hasSvg = (typeof p.svgPath === 'string' && p.svgPath.trim().length > 0) || paths.length > 0;
  const viewBox = typeof p.viewBox === 'string' && p.viewBox.trim() ? p.viewBox : `0 0 ${w} ${h}`;

  const wrapperStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    minWidth: p.sizingH === 'fixed' ? w : undefined,
    minHeight: p.sizingV === 'fixed' ? h : undefined,
    cursor: clickable ? 'pointer' : undefined,
    ...surfaceDecorationStyle(p),
  };

  const handleClick = clickable
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        void rt.run(p.onClick as PropValue, scope);
      }
    : undefined;

  if (!hasSvg) {
    return (
      <div
        style={{
          ...wrapperStyle,
          ...(!p.background && typeof p.fill === 'string' ? applyBackground(p.fill) : {}),
          ...(typeof p.stroke === 'string' && p.stroke && !p.borderColor
            ? { borderColor: p.stroke, borderWidth: num(p.strokeWidth, 1), borderStyle: 'solid' }
            : {}),
        }}
        onClick={handleClick}
      />
    );
  }

  return (
    <div style={wrapperStyle} onClick={handleClick}>
      <svg
        viewBox={viewBox}
        preserveAspectRatio="none"
        className="block h-full w-full"
        aria-label={typeof p.label === 'string' ? p.label : undefined}
      >
        {paths.length > 0 ? (
          paths.map((seg, i) => (
            <path
              key={i}
              d={String(seg.d ?? '')}
              fill={typeof seg.fill === 'string' ? seg.fill : (p.fill ?? 'none')}
              fillRule={seg.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'}
              stroke={typeof seg.stroke === 'string' ? seg.stroke : p.stroke}
              strokeWidth={typeof seg.strokeWidth === 'number' ? seg.strokeWidth : p.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))
        ) : (
          <path
            d={String(p.svgPath)}
            fill={p.fill ?? 'currentColor'}
            stroke={p.stroke}
            strokeWidth={p.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  );
};

export const FigmaImage: React.FC<CompProps> = ({ node, p, rt, scope }) => {
  const { tr } = useI18n();
  if (rt.hidden[node.pfId] ?? p.hidden === true) return null;
  const clickable = Boolean(p.onClick) && !p.disabled && !rt.isDesign;
  const src = typeof p.src === 'string' ? p.src.trim() : '';

  const boxStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    overflow: 'clip',
    cursor: clickable ? 'pointer' : undefined,
    ...surfaceDecorationStyle(p),
  };

  return (
    <div
      style={boxStyle}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              void rt.run(p.onClick as PropValue, scope);
            }
          : undefined
      }
    >
      {src ? (
        <img
          src={src}
          alt={String(p.alt || p.label || '')}
          className="block h-full w-full"
          style={{ objectFit: (p.objectFit as React.CSSProperties['objectFit']) || 'cover' }}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-slate-100 text-slate-400 p-2 text-center">
          <ImageIcon className="h-5 w-5 opacity-60" aria-hidden="true" />
          <span className="text-[10px] leading-tight truncate max-w-full">
            {String(p.label || tr('图片占位', 'Image placeholder'))}
          </span>
        </div>
      )}
    </div>
  );
};

export const FIGMA_COMPONENTS: Record<string, React.FC<CompProps>> = {
  FigmaCanvas,
  FigmaFrame,
  FigmaText,
  FigmaVector,
  FigmaImage,
};
