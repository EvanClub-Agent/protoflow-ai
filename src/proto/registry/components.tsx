import { rowsForSource, sourceForeignKeyErrors } from '../table/model';
import { useSourceRow } from '../runtime/sourceRow';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AntButton from 'antd/es/button';
import AntPagination from 'antd/es/pagination';
import Skeleton from 'antd/es/skeleton';
import Spin from 'antd/es/spin';
import { AntdSurface } from './AntdSurface';
import { PreviewDataContext, useMaterialTables } from '../runtime/PreviewData';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy as CopyIcon,
  Download,
  Eye,
  Info,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload as UploadIcon,
  X,
  XCircle,
  Check,
  TrendingUp,
  TrendingDown,
  Inbox,
  MousePointerSquareDashed,
} from 'lucide-react';
import { AntdFieldControl, ANTD_FIELD_KINDS } from './AntdFieldControl';
import { ANTD_COMPONENTS } from './antdComponents';
import { FreeformMaterial } from '../freeform/FreeformMaterial';
import { MOBILE_REGISTRY } from '../mobile/components';
import { EditableCell } from '../table/EditableCell';
import { defaultTableColumns, missingMergeRow, SAMPLE_FIELDS, SAMPLE_ROWS, prepareTableRows, tableCellSpans, tableConfigErrors, visibleTableRows, type TableColumn, type TableSort } from '../table/model';
import { ChartMaterial } from '../charts/ChartMaterial';
import { CHART_TYPES } from '../charts/model';
import type { PropValue, ProtoNode } from '../types';
import type { Runtime, Scope } from '../runtime/runtime';
import { usePageStore } from '../store/usePageStore';
import { useProtoStore } from '../../store/useProtoStore';
import { columnLabel, defaultDisplayColumns, type Row } from '../runtime/mock';

export type RootAttrs = {
  'data-pf-id'?: string;
  'data-pf-sel'?: string;
  'data-pf-hover'?: string;
  'data-pf-drop'?: string;
  'data-pf-sticky'?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  onMouseOver?: (e: React.MouseEvent) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
};

export interface CompProps {
  node: ProtoNode;
  p: Record<string, any>;
  text: string;
  kids: ProtoNode[];
  children: React.ReactNode[];
  root: RootAttrs;
  rt: Runtime;
  scope: Scope;
  live: boolean;
  staticOverlay: boolean;
  renderNode: (n: ProtoNode, scope?: Scope) => React.ReactNode;
  withScope: (s: Scope, el: React.ReactNode) => React.ReactNode;
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Merge design-time root attrs with the component's own root props. */
function rootWith(root: RootAttrs, extra: { className?: string; style?: React.CSSProperties; onClick?: (e: React.MouseEvent) => void }) {
  return {
    ...root,
    className: cx(extra.className, root.className),
    style: extra.style || root.style ? { ...extra.style, ...root.style } : undefined,
    onClick: root.onClick ?? extra.onClick,
  };
}

const DropHint: React.FC<{ rt: Runtime; label?: string }> = ({ rt, label }) =>
  rt.isDesign ? (
    <div className="pf-drop-hint col-span-12 w-full flex items-center justify-center gap-1.5 min-h-[44px] rounded border border-dashed border-slate-300 text-[11px] text-slate-400">
      <MousePointerSquareDashed className="w-3.5 h-3.5" />
      {label ?? '拖入组件'}
    </div>
  ) : null;

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  plus: Plus,
  search: Search,
  edit: Pencil,
  delete: Trash2,
  download: Download,
  upload: UploadIcon,
  check: Check,
  close: X,
  eye: Eye,
};

// ───────────────────────── Form & Inline Toolbar context ─────────────────────────
interface FormCtxValue {
  formId: string;
  cols: number;
  grid: 'twelve' | 'cells';
  controlMaxWidth?: number;
  rangeMaxWidth?: number;
  labelWidth?: number;
  autoLabelWidth?: boolean;
  layout?: 'horizontal' | 'vertical' | 'inline';
  labelAlign?: 'right' | 'left';
  colon?: boolean;
  size?: 'small' | 'middle' | 'large';
  values: Record<string, unknown>;
  errors: Record<string, string>;
  setValue: (name: string, v: unknown) => void;
  disabled?: boolean;
}
const FormCtx = createContext<FormCtxValue | null>(null);
export const InlineToolbarCtx = createContext<boolean>(false);

const asOptions = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];

const inputClsBase =
  'w-full rounded-md border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:bg-slate-50 disabled:text-slate-400 read-only:bg-slate-50/70';

const inputSizeCls: Record<string, string> = {
  small: 'h-7 px-2 text-[12px]',
  middle: 'h-8 px-2.5 text-[13px]',
  large: 'h-9 px-3 text-[14px]',
};

const inputCls = `${inputClsBase} ${inputSizeCls.middle}`;

export interface FieldDef {
  type: string;
  name?: string;
  label?: string;
  labelLayout?: '' | 'horizontal' | 'vertical' | 'inline';
  labelAlign?: '' | 'right' | 'left';
  labelWidth?: number;
  colon?: boolean;
  required?: boolean;
  allowClear?: boolean;
  readOnly?: boolean;
  extra?: string;
  placeholder?: string;
  options?: unknown;
  span?: number;
  width?: string;
  controlWidth?: 'sm' | 'md' | 'lg';
  size?: 'small' | 'middle' | 'large';
  disabled?: boolean;
  rows?: number;
  prefix?: string;
  suffix?: string;
  precision?: number;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  showCount?: boolean;
  password?: boolean;
  accept?: string;
  listType?: 'button' | 'dragger' | 'picture-card';
  buttonText?: string;
  multiple?: boolean;
  showSearch?: boolean;
  picker?: 'date' | 'month' | 'year' | 'datetime';
  showTime?: boolean;
  optionType?: 'default' | 'button';
  buttonStyle?: 'outline' | 'solid';
  direction?: 'horizontal' | 'vertical';
  checkedChildren?: string;
  unCheckedChildren?: string;
  overlay?: string;
  pfId?: string;
  onChange?: PropValue;
  status?: 'error' | 'warning';
  variant?: 'outlined' | 'borderless' | 'filled' | 'underlined';
  mode?: 'single' | 'multiple' | 'tags';
  loading?: boolean;
  maxTagCount?: number;
  maxCount?: number;
  popupMatchSelectWidth?: boolean;
  visibilityToggle?: boolean;
  autoSize?: boolean;
  minRows?: number;
  maxRows?: number;
  controls?: boolean;
  keyboard?: boolean;
  format?: string;
  use12Hours?: boolean;
  hourStep?: number;
  minuteStep?: number;
  secondStep?: number;
  range?: boolean;
  reverse?: boolean;
  dots?: boolean;
  tooltipVisible?: boolean;
  count?: number;
  allowHalf?: boolean;
  changeOnSelect?: boolean;
  expandTrigger?: 'click' | 'hover';
  treeCheckable?: boolean;
  treeDefaultExpandAll?: boolean;
  block?: boolean;
}

/** A labelled field control, bound to the surrounding Form when present. */
const FieldControl: React.FC<{ def: FieldDef; rt: Runtime; scope: Scope; inline?: boolean; root?: RootAttrs }> = ({ def, rt, scope, inline, root }) => {
  const form = useContext(FormCtx);
  const inToolbar = useContext(InlineToolbarCtx);
  const [local, setLocal] = useState<unknown>('');
  // Unbound controls keep local state; node identity is never a substitute for a business field.
  const name = def.name;
  const bound = form !== null && typeof name === 'string' && name.length > 0;
  const value = bound ? form.values[name] ?? '' : local;
  const setValue = (v: unknown) => {
    if (def.disabled || form?.disabled || def.readOnly) return;
    if (bound) form.setValue(name, v);
    else setLocal(v);
    if (!rt.isDesign && def.onChange) rt.run(def.onChange, { ...scope, params: { ...scope.params, value: v } });
  };
  const error = bound ? form.errors[name] : undefined;
  const disabled = Boolean(def.disabled || form?.disabled);
  const readOnly = Boolean(def.readOnly);
  const effSize = def.size || form?.size || 'middle';
  const curInputCls = `${inputClsBase} ${inputSizeCls[effSize] ?? inputSizeCls.middle}`;
  const placeholder = def.placeholder ?? (['select', 'date', 'dateRange', 'picker'].includes(def.type) ? `请选择${def.label ?? ''}` : `请输入${def.label ?? ''}`);

  let control: React.ReactNode;
  if (ANTD_FIELD_KINDS.has(def.type)) {
    control = <AntdFieldControl def={def} value={value} onChange={setValue} disabled={disabled} size={effSize} placeholder={placeholder} error={error} />;
  } else switch (def.type) {
    case 'upload': {
      const uType = def.listType ?? 'button';
      const btnLabel = def.buttonText || '点击上传';
      if (uType === 'dragger') {
        control = (
          <div
            onClick={() => !rt.isDesign && !disabled && setValue(`附件_${Date.now().toString().slice(-4)}.pdf`)}
            className="w-full py-4 px-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/50 hover:border-blue-400 hover:bg-blue-50/20 text-center cursor-pointer transition space-y-1"
          >
            <UploadIcon className="w-6 h-6 mx-auto text-blue-500" />
            <div className="text-[12px] text-slate-700 font-medium">
              {value ? String(value) : '点击或将文件拖拽到此区域上传'}
            </div>
            {def.accept && <div className="text-[11px] text-slate-400">支持格式：{def.accept}</div>}
          </div>
        );
      } else if (uType === 'picture-card') {
        control = (
          <button
            type="button"
            disabled={disabled}
            onClick={() => !rt.isDesign && setValue(`图片_${Date.now().toString().slice(-4)}.png`)}
            className="w-20 h-20 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 hover:border-blue-400 hover:text-blue-600 flex flex-col items-center justify-center gap-1 text-slate-500 text-[11px] cursor-pointer transition"
          >
            <Plus className="w-4 h-4" />
            <span>{value ? '已上传' : btnLabel}</span>
          </button>
        );
      } else {
        control = (
          <button
            type="button"
            disabled={disabled}
            onClick={() => !rt.isDesign && setValue(`附件_${Date.now().toString().slice(-4)}.pdf`)}
            className="h-8 px-3 rounded-md border border-dashed border-slate-300 bg-white text-[12px] text-slate-600 hover:border-blue-400 hover:text-blue-600 flex items-center gap-1.5 cursor-pointer"
          >
            <UploadIcon className="w-3.5 h-3.5" />
            <span>{value ? String(value) : btnLabel}</span>
            {def.accept && <span className="text-[10px] text-slate-400 font-mono">({def.accept})</span>}
          </button>
        );
      }
      break;
    }
    case 'picker': {
      const shown = (def.pfId && rt.pickerValues[def.pfId]) || (value == null ? '' : String(value));
      control = (
        <button
          type="button"
          disabled={disabled}
          onClick={() => !readOnly && def.overlay && def.pfId && rt.openPicker(def.overlay, { targetPfId: def.pfId!, formId: bound ? form.formId : undefined, name }, scope)}
          className={cx(curInputCls, 'flex items-center justify-between text-left')}
        >
          <span className={shown ? 'text-slate-800 truncate' : 'text-slate-400'}>{shown || placeholder}</span>
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        </button>
      );
      break;
    }
    default:
      control = <div role="alert" className="text-xs text-red-600">不支持的字段类型：{def.type}</div>;
  }

  const widthMap: Record<string, number> = {
    '1/4': 3,
    '1/3': 4,
    '1/2': 6,
    '2/3': 8,
    '3/4': 9,
    full: 12,
  };
  const baseColSpan = form ? Math.round(12 / Math.max(1, Math.min(4, form.cols))) : 12;
  const span12 =
    def.width && widthMap[def.width]
      ? widthMap[def.width]
      : Math.min(12, Math.max(1, Number(def.span ?? 1)) * baseColSpan);
  const rootAttrs = root ?? { 'data-pf-id': def.pfId ?? '' };
  if (inline) return <div {...rootWith(rootAttrs, {})}>{control}</div>;

  // QueryForm owns one cell per condition. Label sizing must never change grid spans.
  const gridStyle = form ? { gridColumn: form.grid === 'cells' ? 'span 1 / span 1' : `span ${span12} / span ${span12}` } : undefined;
  const controlStyle = form?.grid === 'cells' ? { maxWidth: def.type === 'dateRange' ? form.rangeMaxWidth : form.controlMaxWidth } : undefined;

  const effLayout =
    def.labelLayout ||
    (inToolbar || def.width === 'auto' ? 'inline' : form?.layout ?? 'horizontal');
  const effLabelAlign = def.labelAlign || form?.labelAlign || 'right';
  const effColon = def.colon !== undefined ? Boolean(def.colon) : Boolean(form?.colon);
  const effLabelWidth =
    typeof def.labelWidth === 'number' && def.labelWidth > 0
      ? def.labelWidth
      : form?.labelWidth;
  const labelSuffix = effColon ? '：' : '';

  // 1. Compact inline toolbar mode (when placed inside <Toolbar>, horizontal <Space>, or labelLayout === 'inline')
  if (effLayout === 'inline') {
    const ctrlWidthCls =
      def.controlWidth === 'sm'
        ? 'w-28'
        : def.controlWidth === 'lg'
        ? 'w-56'
        : ['radio', 'checkbox', 'switch', 'upload', 'dateRange'].includes(def.type)
        ? 'w-auto'
        : def.type === 'number'
        ? 'w-28'
        : 'w-40';
    return (
      <div
        {...rootWith(rootAttrs, {
          className: 'inline-flex items-center gap-1.5 min-w-0',
          style: form?.grid === 'cells' ? gridStyle : form ? { gridColumn: `span ${baseColSpan} / span ${baseColSpan}` } : undefined,
        })}
      >
        {def.label && (
          <label
            className="shrink-0 text-[12px] font-medium text-slate-600 whitespace-nowrap"
            title={def.label}
          >
            {def.required && <span className="text-rose-500 mr-0.5">*</span>}
            {def.label}
            {labelSuffix}
          </label>
        )}
        <div className={cx('min-w-0', ctrlWidthCls)} style={controlStyle}>
          {control}
          {def.extra && <div className="mt-0.5 text-[11px] text-slate-400">{def.extra}</div>}
          {error && <div className="mt-0.5 text-[11px] text-rose-500">{error}</div>}
        </div>
      </div>
    );
  }

  // 2. Vertical label above control (AntD layout="vertical")
  if (effLayout === 'vertical') {
    return (
      <div
        {...rootWith(rootAttrs, {
          className: 'flex flex-col gap-1 min-w-0',
          style: gridStyle,
        })}
      >
        {def.label && (
          <label
            className="text-[12px] font-medium text-slate-600 flex items-center gap-0.5 truncate"
            title={def.label}
          >
            {def.required && <span className="text-rose-500 shrink-0">*</span>}
            <span className="truncate">
              {def.label}
              {labelSuffix}
            </span>
          </label>
        )}
        <div className="min-w-0" style={controlStyle}>
          {control}
          {def.extra && <div className="mt-0.5 text-[11px] text-slate-400">{def.extra}</div>}
          {error && <div className="mt-0.5 text-[11px] text-rose-500">{error}</div>}
        </div>
      </div>
    );
  }

  // 3. Horizontal label beside control (AntD layout="horizontal")
  const useAutoLabel = (!form || form.autoLabelWidth) && !(typeof def.labelWidth === 'number' && def.labelWidth > 0);
  return (
    <div
      {...rootWith(rootAttrs, {
        className: 'flex items-center gap-2 min-w-0',
        style: gridStyle,
      })}
    >
      {def.label && (
        <label
          className={cx(
            'shrink-0 text-[12px] font-medium text-slate-600 whitespace-nowrap truncate',
            useAutoLabel
              ? 'min-w-[44px] max-w-[112px]'
              : effLabelAlign === 'left'
              ? 'text-left'
              : 'text-right'
          )}
          style={useAutoLabel ? undefined : { width: effLabelWidth ?? 88 }}
          title={def.label}
        >
          {def.required && <span className="text-rose-500 mr-0.5">*</span>}
          {def.label}
          {labelSuffix}
        </label>
      )}
      <div className="flex-1 min-w-0" style={controlStyle}>
        {control}
        {def.extra && <div className="mt-0.5 text-[11px] text-slate-400">{def.extra}</div>}
        {error && <div className="mt-0.5 text-[11px] text-rose-500">{error}</div>}
      </div>
    </div>
  );
};

const fieldFromProps = (type: string) =>
  function FieldComp({ p, rt, scope, root, node }: CompProps) {
    return <FieldControl def={{ ...(p as FieldDef), type, pfId: node.pfId }} rt={rt} scope={scope} root={root} />;
  };

// ───────────────────────── Components ─────────────────────────
const STATUS_COLOR: Record<string, string> = {
  已通过: 'green', 启用: 'green', 合格: 'green', qualified: 'green', confirmed: 'green', 已完成: 'green', 已入库: 'green',
  待审批: 'orange', 审批中: 'orange', pending: 'orange', 待处理: 'orange',
  已驳回: 'red', 停用: 'red', rejected: 'red', 异常: 'red',
  草稿: 'default', draft: 'default',
};
const TAG_CLS: Record<string, string> = {
  default: 'bg-slate-100 text-slate-600 border-slate-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  orange: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200',
};
const TagPill: React.FC<{
  color?: string;
  bordered?: boolean;
  round?: boolean;
  closable?: boolean;
  onClose?: () => void;
  children: React.ReactNode;
}> = ({ color = 'default', bordered = true, round, closable, onClose, children }) => (
  <span
    className={cx(
      'inline-flex items-center gap-1 px-2 py-px text-[12px] leading-5',
      round ? 'rounded-full' : 'rounded',
      bordered ? 'border' : 'border border-transparent',
      TAG_CLS[color] ?? TAG_CLS.default
    )}
  >
    {children}
    {closable && <button type="button" aria-label="关闭标签" onClick={onClose} className="opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>}
  </span>
);

const BTN_CLS: Record<string, string> = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600',
  default: 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300 hover:border-blue-400 hover:text-blue-600',
  dashed: 'bg-white hover:bg-slate-50 text-slate-700 border-dashed border-slate-300 hover:border-blue-400 hover:text-blue-600',
  danger: 'bg-white hover:bg-rose-50 text-rose-600 border-rose-300',
  text: 'bg-transparent hover:bg-slate-100 text-slate-700 border-transparent',
  link: 'bg-transparent text-blue-600 hover:text-blue-700 border-transparent px-1',
};

const Button: React.FC<CompProps> = ({ p, text, root, rt, scope }) => {
  const Icon = p.icon ? ICONS[p.icon as string] : null;
  return <AntdSurface><AntButton
    {...root}
    type={p.type === 'danger' ? 'default' : p.type}
    danger={p.danger || p.type === 'danger'} ghost={p.ghost} size={p.size}
    shape={p.shape} block={p.block} disabled={p.disabled} loading={p.loading}
    icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined} iconPlacement={p.iconPosition}
    onClick={(event) => {
      root.onClick?.(event);
      if (!rt.isDesign && !p.disabled && !p.loading) rt.run(p.onClick as PropValue, scope);
    }}
  >{p.shape === 'circle' && Icon ? null : text || '按钮'}</AntButton></AntdSurface>;
};

const Page: React.FC<CompProps> = ({ p, children, root, rt }) => {
  const padCls =
    p.padding === 'compact' ? 'p-3.5 gap-y-2.5' : p.padding === 'loose' ? 'p-7 gap-y-5' : 'p-4 gap-y-3.5';
  const bgCls =
    p.bg === 'white' ? 'bg-white' : p.bg === 'gray' ? 'bg-slate-100/80' : 'bg-[#f8fafc]';
  return (
    <div {...rootWith(root, { className: cx('flex-[1_0_auto] grid grid-cols-12 gap-x-4 items-start content-start rounded-[15px]', padCls, bgCls) })}>
      {children.length ? children : <div className="col-span-12"><DropHint rt={rt} label="从左侧物料库拖入组件" /></div>}
      {!p.title && null}
    </div>
  );
};

const Card: React.FC<CompProps> = ({ p, children, root, rt }) => {
  const isSmall = p.size === 'small';
  const headerBgCls =
    p.headerBg === 'white'
      ? 'bg-white'
      : p.headerBg === 'blue'
      ? 'bg-blue-50/50'
      : 'bg-slate-50/40';
  return (
    <div
      {...rootWith(root, {
        className: cx(
          'rounded-xl bg-white shadow-2xs transition',
          p.bordered === false ? '' : 'border border-slate-200/90',
          p.hoverable && 'hover:shadow-md hover:border-blue-200'
        ),
      })}
    >
      {(p.title || p.extra) && (
        <div
          className={cx(
            'flex items-center justify-between border-b border-slate-100 rounded-t-xl',
            isSmall ? 'px-3 h-8' : 'px-4 h-10',
            headerBgCls
          )}
        >
          <span className={cx('font-bold text-slate-900', isSmall ? 'text-[12px]' : 'text-[13px]')}>{p.title}</span>
          {p.extra && <span className="text-[11px] font-medium text-slate-500">{p.extra}</span>}
        </div>
      )}
      <div className={cx('grid grid-cols-12 gap-x-4 items-start', isSmall ? 'p-3 gap-y-2' : 'p-4 gap-y-3')}>
        {p.loading ? <div className="col-span-12"><AntdSurface><Skeleton active /></AntdSurface></div> : children.length ? children : <div className="col-span-12"><DropHint rt={rt} /></div>}
      </div>
    </div>
  );
};

const Row_: React.FC<CompProps> = ({ p, children, root, rt }) => (
  <div
    {...rootWith(root, {
      className: cx(
        'grid grid-cols-24',
        p.align === 'middle' ? 'items-center' : p.align === 'bottom' ? 'items-end' : 'items-start'
      ),
      style: { gap: Number(p.gutter ?? 16), gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' },
    })}
  >
    {children.length ? children : <div className="col-span-24"><DropHint rt={rt} label="拖入栅格列 Col" /></div>}
  </div>
);

const Col: React.FC<CompProps> = ({ children, root, rt }) => {
  return (
    <div {...rootWith(root, { className: 'min-w-0 grid grid-cols-12 gap-x-4 gap-y-3 items-start' })}>
      {children.length ? children : <div className="col-span-12"><DropHint rt={rt} /></div>}
    </div>
  );
};

const Space: React.FC<CompProps> = ({ p, children, root, rt }) => {
  const isVertical = p.direction === 'vertical';
  const gapCls = p.size === 'large' ? 'gap-5' : p.size === 'middle' ? 'gap-3.5' : 'gap-2';
  return (
    <div
      {...rootWith(root, {
        className: cx(
          'flex',
          gapCls,
          isVertical ? 'flex-col' : cx('flex-row items-center', p.wrap !== false && 'flex-wrap'),
          p.align === 'center' && 'justify-center',
          p.align === 'end' && 'justify-end',
          p.align === 'between' && 'justify-between'
        ),
      })}
    >
      <InlineToolbarCtx.Provider value={!isVertical}>
        {children.length ? children : <DropHint rt={rt} />}
      </InlineToolbarCtx.Provider>
    </div>
  );
};

const Tabs: React.FC<CompProps> = ({ node, p, kids, root, rt, renderNode }) => {
  const active = Math.min(rt.tabs[node.pfId] ?? 0, Math.max(0, kids.length - 1));
  const pos = (p.tabPosition as 'top' | 'left' | 'bottom' | 'right') ?? 'top';
  const isSide = pos === 'left' || pos === 'right';
  const tabSizeCls =
    p.size === 'small' ? 'px-2.5 h-7 text-[12px]' : p.size === 'large' ? 'px-4 h-10 text-[14px]' : 'px-3 h-9 text-[13px]';

  const tabBar = (
    <div
      className={cx(
        'flex gap-1 shrink-0',
        isSide
          ? cx('flex-col min-w-[128px]', pos === 'left' ? 'border-r border-slate-200 pr-2' : 'border-l border-slate-200 pl-2')
          : cx(
              'items-center',
              pos === 'bottom' ? 'mt-3 border-t border-slate-200 pt-1' : 'mb-3',
              p.type === 'segmented'
                ? 'bg-slate-100 p-1 rounded-lg w-fit'
                : p.type === 'card'
                ? 'border-b border-slate-200'
                : 'border-b border-slate-200',
              p.centered && 'justify-center'
            )
      )}
    >
      {kids.map((k, i) => (
        <button
          key={k.pfId}
          type="button"
          disabled={Boolean(k.props.disabled)}
          onClick={() => {
            rt.setTab(node.pfId, i);
            if (!rt.isDesign) rt.run(p.onChange as PropValue, {});
          }}
          className={cx(
            'relative transition flex items-center gap-1.5 cursor-pointer disabled:opacity-40',
            tabSizeCls,
            p.type === 'segmented'
              ? cx(
                  'rounded-md',
                  i === active ? 'bg-white text-slate-900 font-semibold shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                )
              : p.type === 'card'
              ? cx(
                  'rounded-t-md border border-b-0 -mb-px',
                  i === active
                    ? 'bg-white border-slate-200 text-blue-600 font-medium'
                    : 'bg-slate-50 border-transparent text-slate-600'
                )
              : i === active
              ? 'text-blue-600 font-medium'
              : 'text-slate-600 hover:text-slate-900'
          )}
        >
          {String(k.props.title ?? `页签${i + 1}`)}
          {typeof k.props.badge === 'number' && k.props.badge > 0 && (
            <span className="min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-4">{k.props.badge}</span>
          )}
          {p.type !== 'card' && p.type !== 'segmented' && i === active && (
            <span
              className={cx(
                'absolute bg-blue-600 rounded',
                isSide ? 'top-1.5 bottom-1.5 -right-2 w-0.5' : 'left-2 right-2 -bottom-px h-0.5'
              )}
            />
          )}
        </button>
      ))}
    </div>
  );

  const pane = (
    <div className="flex-1 min-w-0">
      {kids.length ? renderNode(kids[active]) : <DropHint rt={rt} label="拖入 Tab 页签项" />}
    </div>
  );

  return (
    <div
      {...rootWith(root, {
        className: cx('min-w-0', isSide && 'flex gap-4 items-start'),
      })}
    >
      {(pos === 'top' || pos === 'left') && tabBar}
      {pane}
      {(pos === 'bottom' || pos === 'right') && tabBar}
    </div>
  );
};

const Tab: React.FC<CompProps> = ({ children, root, rt }) => (
  <div {...rootWith(root, { className: 'grid grid-cols-12 gap-x-4 gap-y-3 items-start min-w-0' })}>
    {children.length ? children : <div className="col-span-12"><DropHint rt={rt} /></div>}
  </div>
);

const Divider: React.FC<CompProps> = ({ p, root }) => {
  const orient = (p.orientation as 'left' | 'center' | 'right') ?? 'center';
  const lineCls = cx(' border-t', p.dashed ? 'border-dashed border-slate-300' : 'border-slate-200');
  return (
    <div {...rootWith(root, { className: 'flex items-center gap-3 my-2' })}>
      <div className={cx(lineCls, p.text && orient === 'left' ? 'w-6 shrink-0' : 'flex-1')} />
      {p.text && <span className="text-[12px] text-slate-500 font-medium shrink-0">{p.text}</span>}
      {p.text && <div className={cx(lineCls, orient === 'right' ? 'w-6 shrink-0' : 'flex-1')} />}
    </div>
  );
};

const Steps: React.FC<CompProps> = ({ p, root }) => {
  const items = asOptions(p.items);
  const cur = Number(p.current ?? 0);
  const isVert = p.direction === 'vertical';
  const isSmall = p.size === 'small';
  const isErr = p.status === 'error';
  return (
    <div
      {...rootWith(root, {
        className: cx(isVert ? 'flex flex-col gap-3 py-1' : 'flex items-center gap-2 py-2'),
      })}
    >
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={cx(
                'rounded-full flex items-center justify-center border font-medium',
                isSmall ? 'w-5 h-5 text-[11px]' : 'w-6 h-6 text-[12px]',
                i < cur
                  ? 'border-blue-600 text-blue-600 bg-blue-50/40'
                  : i === cur
                  ? isErr
                    ? 'bg-rose-600 border-rose-600 text-white'
                    : 'bg-blue-600 border-blue-600 text-white'
                  : 'border-slate-300 text-slate-400'
              )}
            >
              {i < cur ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </span>
            <span
              className={cx(
                isSmall ? 'text-[12px]' : 'text-[13px]',
                i === cur
                  ? isErr
                    ? 'text-rose-600 font-semibold'
                    : 'text-slate-900 font-medium'
                  : 'text-slate-500'
              )}
            >
              {it}
            </span>
          </div>
          {i < items.length - 1 && !isVert && (
            <div className={cx('flex-1 h-px', i < cur ? 'bg-blue-600' : 'bg-slate-200')} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

const PageHeader: React.FC<CompProps> = ({ p, children, root, rt, scope }) => {
  const subTitle = p.subTitle ?? p.subtitle;
  return (
    <div {...rootWith(root, { className: cx('space-y-1 pb-1', p.divider && 'border-b border-slate-200 pb-3') })}>
      {Array.isArray(p.breadcrumb) && p.breadcrumb.length > 0 && (
        <div className="flex items-center gap-1 text-[11px] text-slate-500">
          {asOptions(p.breadcrumb).map((b, i, arr) => (
            <React.Fragment key={i}>
              <span className={i === arr.length - 1 ? 'text-slate-700 font-medium' : ''}>{b}</span>
              {i < arr.length - 1 && <ChevronRight className="w-3 h-3 text-slate-400" />}
            </React.Fragment>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2.5 flex-wrap">
        {p.back && (
          <button type="button" onClick={() => rt.run(p.onBack as PropValue, scope)} className="p-1 rounded hover:bg-slate-200/60 text-slate-600">
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <h1 className="text-[17px] font-bold text-slate-900 tracking-tight">{p.title}</h1>
        {p.tagText && <TagPill color={(p.tagColor as string) || 'blue'}>{p.tagText}</TagPill>}
        {subTitle && <span className="text-[12px] text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-md">{subTitle}</span>}
        <div className="ml-auto flex items-center gap-2">{children}</div>
      </div>
    </div>
  );
};

const Breadcrumb: React.FC<CompProps> = ({ p, root }) => {
  const sep = (p.separator as string) || '>';
  return (
    <div {...rootWith(root, { className: 'flex items-center gap-1.5 text-[12px] text-slate-500' })}>
      {asOptions(p.items).map((b, i, arr) => (
        <React.Fragment key={i}>
          <span className={i === arr.length - 1 ? 'text-slate-800 font-medium' : 'hover:text-blue-600 cursor-pointer'}>{b}</span>
          {i < arr.length - 1 && (
            sep === '>' ? <ChevronRight className="w-3 h-3" /> : <span className="text-slate-400">{sep}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

const Pager: React.FC<{
  total: number;
  pageSize: number;
  page: number;
  onChange: (n: number, pageSize: number) => void;
  size?: string;
  align?: string;
  showTotal?: boolean;
  showSizeChanger?: boolean;
  showQuickJumper?: boolean;
  simple?: boolean;
  disabled?: boolean;
  hideOnSinglePage?: boolean;
}> = ({ total, pageSize, page, onChange, size, align, showTotal = true, showSizeChanger = true, showQuickJumper, simple, disabled, hideOnSinglePage }) => (
  <AntdSurface><AntPagination total={total} pageSize={pageSize} current={page} onChange={onChange}
    size={size === 'small' ? 'small' : undefined} align={align === 'left' ? 'start' : align === 'center' ? 'center' : 'end'}
    showTotal={showTotal ? (count) => `共 ${count} 条` : undefined} showSizeChanger={showSizeChanger}
    showQuickJumper={showQuickJumper} simple={simple} disabled={disabled} hideOnSinglePage={hideOnSinglePage}
  /></AntdSurface>
);

function usePageSize(configured: number) {
  const [selection, setSelection] = useState<{ configured: number; value: number } | null>(null);
  return [selection?.configured === configured ? selection.value : configured, (value: number) => setSelection({ configured, value })] as const;
}

const Pagination: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const [pageSize, setPageSize] = usePageSize(Math.max(1, Number(p.pageSize ?? 10)));
  const page = Math.min(rt.pageNo[node.pfId] ?? 1, Math.max(1, Math.ceil(Number(p.total ?? 100) / pageSize)));
  return <div {...rootWith(root, {})}>
    <Pager total={Number(p.total ?? 100)} pageSize={pageSize} page={page}
      onChange={(current, nextSize) => {
        setPageSize(nextSize);
        rt.setPageNo(node.pfId, current);
        if (!rt.isDesign) rt.run(p.onChange, { ...scope, params: { ...scope.params, current, pageSize: nextSize } });
      }}
      size={p.size} align={p.align} showTotal={p.showTotal !== false} showSizeChanger={p.showSizeChanger !== false}
      showQuickJumper={p.showQuickJumper} simple={p.simple} disabled={p.disabled} hideOnSinglePage={p.hideOnSinglePage}
    />
  </div>;
};

const QueryForm: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const fields = (Array.isArray(p.fields) ? p.fields : []) as FieldDef[];
  const cols = Math.max(1, Math.min(4, Number(p.cols ?? 3)));
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [expanded, setExpanded] = useState(Boolean(p.defaultExpanded));
  useEffect(() => { setExpanded(Boolean(p.defaultExpanded)); }, [p.defaultExpanded]);
  const visible = expanded ? fields : fields.slice(0, cols);
  const columnCount = Math.min(cols, Math.max(1, visible.length));
  const columnMin = `min(100%, max(240px, calc((100% - ${(columnCount - 1) * 16}px) / ${columnCount})))`;
  const customLabelW = typeof p.labelWidth === 'number' && p.labelWidth > 0 ? p.labelWidth : undefined;
  const ctx: FormCtxValue = {
    formId: `query-${node.pfId}`,
    cols,
    grid: 'cells',
    controlMaxWidth: Number(p.controlMaxWidth ?? 240),
    rangeMaxWidth: Number(p.rangeMaxWidth ?? 320),
    labelWidth: customLabelW ?? 72,
    autoLabelWidth: !customLabelW,
    layout: (p.layout as 'horizontal' | 'vertical') ?? 'horizontal',
    labelAlign: (p.labelAlign as 'right' | 'left') ?? 'left',
    colon: Boolean(p.colon),
    size: (p.size as 'small' | 'middle' | 'large') ?? 'middle',
    values,
    errors: {},
    setValue: (n, v) => setValues((s) => ({ ...s, [n]: v })),
  };
  const search = () => {
    if (rt.isDesign) return;
    if (p.target) rt.setFilter(p.target as string, values);
    rt.run(p.onSearch as PropValue, scope);
  };
  return (
    <div {...rootWith(root, {})}>
      <FormCtx.Provider value={ctx}>
        <div className="flex gap-3 flex-wrap items-end">
          <div
            className="flex-1 min-w-0 basis-[280px] grid gap-x-4 gap-y-2.5 items-center"
            data-query-fields
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${columnMin}, 1fr))` }}
          >
            {visible.map((f, i) => (
              <FieldControl key={`${f.name}-${i}`} def={{ ...f, type: f.type ?? 'input', required: false, span: 1 }} rt={rt} scope={scope} />
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0 whitespace-nowrap ml-auto" data-query-actions>
            <button
              type="button"
              onClick={() => {
                setValues({});
                if (!rt.isDesign && p.target) rt.setFilter(p.target as string, {});
              }}
              className={cx('h-8 px-3 rounded-md border text-[13px] whitespace-nowrap cursor-pointer', BTN_CLS.default)}
            >
              {(p.resetText as string) || '重置'}
            </button>
            <button
              type="button"
              onClick={search}
              className={cx('h-8 px-3.5 rounded-md border text-[13px] inline-flex items-center gap-1 whitespace-nowrap cursor-pointer', BTN_CLS.primary)}
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span>{(p.searchText as string) || '查询'}</span>
            </button>
            {fields.length > cols && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="h-8 px-1 text-[12px] text-blue-600 inline-flex items-center gap-0.5 whitespace-nowrap cursor-pointer"
              >
                {expanded ? '收起' : '展开'}
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>
      </FormCtx.Provider>
      {fields.length === 0 && <DropHint rt={rt} label="在右侧属性面板配置查询条件" />}
    </div>
  );
};

const SearchInput: React.FC<CompProps> = ({ p, root, rt }) => {
  const [v, setV] = useState('');
  const sz = (p.size as string) || 'middle';
  const trigger = () => !rt.isDesign && p.target && rt.setFilter(p.target as string, { __keyword: v });
  return (
    <div {...rootWith(root, { className: 'relative inline-flex items-center w-60' })}>
      <div className="relative flex-1 min-w-0">
        <input
          className={cx(
            inputClsBase,
            inputSizeCls[sz] ?? inputSizeCls.middle,
            p.enterButton ? 'rounded-r-none border-r-0 pr-6' : 'pr-8'
          )}
          value={v}
          placeholder={p.placeholder ?? '搜索...'}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && trigger()}
        />
        {p.allowClear !== false && v && (
          <button
            type="button"
            onClick={() => {
              setV('');
              if (!rt.isDesign && p.target) rt.setFilter(p.target as string, { __keyword: '' });
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="w-3 h-3" />
          </button>
        )}
        {!p.enterButton && !v && (
          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        )}
      </div>
      {p.enterButton && (
        <button
          type="button"
          onClick={trigger}
          className={cx(
            'px-3 rounded-r-md bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center cursor-pointer',
            sz === 'small' ? 'h-7' : sz === 'large' ? 'h-9' : 'h-8'
          )}
        >
          <Search className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

function useTableRows(tableId: string | undefined): Row[] {
  const preview = useContext(PreviewDataContext);
  const stored = usePageStore((s) => (tableId ? s.tableRows[tableId] : undefined));
  const getRows = usePageStore((s) => s.getRows);
  // Drafts use actual snapshot rows (empty for new tables), never seed global mock data.
  return useMemo(() => preview ? (tableId ? preview.rows[tableId] ?? [] : []) : (tableId ? stored ?? getRows(tableId) : []), [preview, tableId, stored, getRows]);
}

function renderCell(v: unknown, render?: string, dataIndex?: string): React.ReactNode {
  if (v === undefined || v === null || v === '') return <span className="text-slate-300">—</span>;
  const s = String(v);
  if (render === 'tag' || (!render && dataIndex && /status/i.test(dataIndex))) return <TagPill color={STATUS_COLOR[s] ?? 'blue'}>{s}</TagPill>;
  if (render === 'money' || (!render && dataIndex && /(price|amount|tax)/i.test(dataIndex) && !/rate/i.test(dataIndex))) {
    const num = Number(v);
    if (!Number.isNaN(num)) {
      const digits = dataIndex && /no_tax/i.test(dataIndex) ? 6 : 2;
      return <span className="tabular-nums font-medium text-slate-800">¥ {num.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}</span>;
    }
  }
  if (render === 'link') return <span className="text-blue-600 hover:underline cursor-pointer">{s}</span>;
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'number') return <span className="tabular-nums">{v}</span>;
  return s;
}

const Table: React.FC<CompProps> = props => {
  const project = useProtoStore(s => s.currentProjectMeta.projectId);
  // Scope drafts and expansion to a single material, dataset and preview session.
  const { node, p, rt } = props;
  const identity = [project, rt.pageId, node.pfId, p.table, p.rowMode, p.treeKeyField, p.parentField, p.defaultExpandAll, rt.isDesign];
  return <TableView key={JSON.stringify(identity)} {...props} />;
};

const TableView: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const tables = useMaterialTables();
  const preview = useContext(PreviewDataContext);
  const tableId = typeof p.table === 'string' && p.table !== '' ? p.table : undefined;
  const table = tables.find(t => t.id === tableId);
  const boundRows = useTableRows(table?.id);
  const {row:sourceRow, tableId:sourceTableId} = useSourceRow(scope, rt.pageId, p.sourceForeignKey !== undefined);
  const [sampleRows, setSampleRows] = useState(SAMPLE_ROWS);
  const [sortCol, setSortCol] = useState<TableSort | null>(null);
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const [pageSize, setPageSize] = usePageSize(Math.max(1, Number(p.pageSize ?? 10)));
  const columns: TableColumn[] = Array.isArray(p.columns) && p.columns.length ? p.columns : defaultTableColumns(table);
  const records = table ? boundRows : sampleRows;
  const query = rt.filters[node.pfId];
  const model = useMemo(() => {
    try {
      if (tableId && !table) throw new Error(`未找到绑定的物理表 ${tableId}`);
      const errors = [...tableConfigErrors(p, table), ...sourceForeignKeyErrors(p, tables)];
      if (errors.length) throw new Error(errors[0]);
      const visibleRecords = typeof p.sourceForeignKey === 'string' ? rowsForSource(records, p.sourceForeignKey, tableId, {row:sourceRow,tableId:sourceTableId}, tables) : records;
      return prepareTableRows(visibleRecords, p, query ?? {}, sortCol);
    } catch (error) {
      return { error: error instanceof Error ? error.message : '表格配置无效' };
    }
  }, [p, tableId, table, records, query, sortCol, sourceRow, sourceTableId, tables]);
  if ('error' in model) {
    return <div {...rootWith(root, { className: 'rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800' })} role="alert">{model.error}</div>;
  }
  const isTree = p.rowMode === 'tree', isDetail = p.rowMode === 'expandable';
  const expandable = isTree || isDetail;
  const isOpen = (id: string) => model.forcedOpen.has(id) || (Boolean(p.defaultExpandAll) !== toggled.has(id));
  const showPagination = p.pagination !== false;
  const total = model.roots.length;
  const page = showPagination ? Math.min(rt.pageNo[node.pfId] ?? 1, Math.max(1, Math.ceil(total / pageSize))) : 1;
  const pageRoots = showPagination ? model.roots.slice((page - 1) * pageSize, page * pageSize) : model.roots;
  const mergeWarning = missingMergeRow(p.cellMerges ?? [], records);
  const visible = visibleTableRows(pageRoots, isOpen, (page - 1) * pageSize);
  const pageRows = visible.map(item => item.row);
  const spanAt = tableCellSpans(visible, columns, p.cellMerges ?? [], id => isDetail && isOpen(id));
  const detailFields: string[] = p.detailFields ?? columns.map(c => c.dataIndex);
  const fieldTitle = (field: string) => {
    const col = table?.columns.find(c => c.name === field);
    const title = table ? (col && columnLabel(col)) : SAMPLE_FIELDS.find(c => c.dataIndex === field)?.title;
    return columns.find(c => c.dataIndex === field)?.title ?? title ?? field;
  };
  const sel = rt.selections[node.pfId] ?? [];
  const actions = (Array.isArray(p.rowActions) ? p.rowActions : []) as { label: string; danger?: boolean; onClick?: PropValue }[];
  const showIndex = p.showIndex !== false;
  const showHeader = p.showHeader !== false;
  const isStriped = Boolean(p.striped);
  const isBordered = Boolean(p.bordered);
  const isRadioSel = p.selectionType === 'radio';
  const tblSize = (p.size as 'small' | 'middle' | 'large') || 'middle';
  const cellPadCls =
    tblSize === 'small'
      ? 'px-2.5 py-1.5 text-[12px]'
      : tblSize === 'large'
      ? 'px-4 py-3.5 text-[14px]'
      : 'px-3 py-2.5 text-[13px]';
  const borderCellCls = isBordered ? 'border-r border-slate-200 last:border-r-0' : '';

  const totalColumns = columns.length + Number(expandable) + Number(Boolean(p.selectable)) + Number(showIndex) + Number(actions.length > 0);
  const toggleRow = (id: string) => setToggled(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div {...rootWith(root, { className: 'space-y-2.5 min-w-0' })}>
      <p className="text-[10px] text-slate-400">{table ? '原型预览数据 · 保存在工程内' : '未绑定数据表 · 示例预览'}</p>
      {mergeWarning && <p role="alert" className="text-xs text-amber-700">{mergeWarning}</p>}
      {!table && rt.isDesign && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          未绑定物理表：在右侧属性中选择「绑定物理表」，列和数据会自动生成
        </div>
      )}
      <AntdSurface><Spin spinning={Boolean(p.loading)}><div className="overflow-auto rounded-lg border border-slate-200 bg-white" style={{ maxHeight: p.scrollY }}>
        {p.title && (
          <div className="px-3.5 py-2 bg-slate-50/70 border-b border-slate-200 text-[13px] font-bold text-slate-800">
            {p.title}
          </div>
        )}
        <table className="w-full text-[13px] border-collapse" style={{ minWidth: p.scrollX }}>
          {showHeader && (
            <thead className={p.sticky ? 'sticky top-0 z-10 bg-slate-50' : undefined}>
              <tr className="bg-slate-50/90 text-slate-600 text-[12px]">
                {expandable && <th aria-label="展开行" className={cx('w-8 border-b border-slate-200', cellPadCls, borderCellCls)} />}
                {p.selectable && (
                  <th className={cx('w-10 text-left border-b border-slate-200', cellPadCls, borderCellCls)}>
                    {!isRadioSel && (
                      <input
                        type="checkbox"
                        className="accent-blue-600"
                        checked={pageRows.length > 0 && pageRows.every((r) => sel.includes(r.id))}
                        onChange={(e) => rt.setSelection(node.pfId, e.target.checked ? pageRows.map((r) => r.id) : [])}
                      />
                    )}
                  </th>
                )}
                {showIndex && (
                  <th className={cx('w-12 text-left font-semibold border-b border-slate-200 whitespace-nowrap', cellPadCls, borderCellCls)}>
                    序号
                  </th>
                )}
                {columns.map((c) => {
                  const alignCls = c.align === 'center' ? 'text-center' : c.align === 'right' ? 'text-right' : 'text-left';
                  return (
                    <th
                      key={c.dataIndex}
                      style={{ width: c.width }}
                      onClick={() => {
                        if (c.sortable) {
                          setSortCol((prev) =>
                            prev?.key === c.dataIndex ? { key: c.dataIndex, asc: !prev.asc } : { key: c.dataIndex, asc: true }
                          );
                        }
                      }}
                      className={cx(
                        'font-semibold border-b border-slate-200 whitespace-nowrap',
                        cellPadCls,
                        alignCls,
                        borderCellCls,
                        c.sortable && 'cursor-pointer hover:bg-slate-100 select-none'
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.title}
                        {c.sortable && <ArrowUpDown className="w-3 h-3 text-slate-400" />}
                      </span>
                    </th>
                  );
                })}
                {actions.length > 0 && (
                  <th className={cx('text-left font-semibold border-b border-l border-slate-200 whitespace-nowrap sticky right-0 bg-slate-50 z-10 shadow-[-4px_0_8px_-4px_rgba(15,23,42,0.06)]', cellPadCls)}>
                    操作
                  </th>
                )}
              </tr>
            </thead>
          )}
          <tbody>
            {visible.map(({ row: r, depth, ordinal, hasChildren }, i) => (
              <React.Fragment key={r.id}>
              <tr data-row-id={r.id}
                onClick={() => rt.run(p.onRowClick as PropValue, { ...scope, row: r, tableId })}
                className={cx(
                  'group/row hover:bg-blue-50/40 border-b border-slate-100 last:border-0 transition-colors',
                  isStriped && i % 2 === 1 && 'bg-slate-50/75'
                )}
              >
                {expandable && <td className={cx('w-8 text-center', cellPadCls, borderCellCls)}>
                  {(isDetail || hasChildren) && <button type="button" aria-expanded={isOpen(r.id)} aria-label={`${isOpen(r.id) ? '收起' : '展开'}记录 ${r.id}`}
                    disabled={model.forcedOpen.has(r.id)} onClick={e => { if (!rt.isDesign) e.stopPropagation(); toggleRow(r.id); }}
                    className="inline-flex items-center justify-center rounded border border-slate-300 bg-white p-0.5 text-slate-600 hover:border-blue-400">
                    {isOpen(r.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>}
                </td>}
                {p.selectable && (
                  <td className={cx(cellPadCls, borderCellCls)} onClick={(e) => e.stopPropagation()}>
                    <input
                      type={isRadioSel ? 'radio' : 'checkbox'}
                      name={isRadioSel ? `radio-${node.pfId}` : undefined}
                      className="accent-blue-600"
                      checked={sel.includes(r.id)}
                      onChange={(e) =>
                        rt.setSelection(
                          node.pfId,
                          isRadioSel
                            ? [r.id]
                            : e.target.checked
                            ? [...sel, r.id]
                            : sel.filter((x) => x !== r.id)
                        )
                      }
                    />
                  </td>
                )}
                {showIndex && (
                  <td className={cx('text-slate-500 tabular-nums', cellPadCls, borderCellCls)}>
                    {ordinal}
                  </td>
                )}
                {columns.map((c, columnIndex) => {
                  const span = spanAt(i, columnIndex);
                  if (span === null) return null;
                  const alignCls = c.align === 'center' ? 'text-center' : c.align === 'right' ? 'text-right' : 'text-left';
                  const content = renderCell(r[c.dataIndex], c.render, c.dataIndex);
                  return (
                    <td key={c.dataIndex} {...span} data-field={c.dataIndex}
                      style={depth && columnIndex === 0 ? { paddingInlineStart: 12 + depth * 18 } : undefined}
                      className={cx('text-slate-800 whitespace-nowrap max-w-[240px] truncate', cellPadCls, alignCls, borderCellCls)}>
                      {c.editor ? <EditableCell key={c.editor} column={c} value={r[c.dataIndex]} readOnly={rt.isDesign || Boolean(preview)}
                        required={table?.columns.find(field => field.name === c.dataIndex)?.nullable === false}
                        onSave={value => {
                          if (table) usePageStore.getState().updateRow(table.id, r.id, { [c.dataIndex]: value });
                          else setSampleRows(prev => prev.map(row => row.id === r.id ? { ...row, [c.dataIndex]: value } : row));
                        }}>{content}</EditableCell> : content}
                    </td>
                  );
                })}
                {actions.length > 0 && (
                  <td
                    className={cx(
                      'whitespace-nowrap border-l border-slate-100 sticky right-0 z-10 shadow-[-4px_0_8px_-4px_rgba(15,23,42,0.06)]',
                      isStriped && i % 2 === 1 ? 'bg-[#f8fafc] group-hover/row:bg-[#f5f9ff]' : 'bg-white group-hover/row:bg-[#f5f9ff]',
                      cellPadCls
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {actions.map((a, ai) => (
                        <button
                          key={ai}
                          type="button"
                          onClick={(e) => {
                            if (rt.isDesign) return;
                            e.stopPropagation();
                            rt.run(a.onClick, { ...scope, row: r, tableId });
                          }}
                          className={cx(
                            'text-[12px] font-medium cursor-pointer transition',
                            a.danger ? 'text-rose-600 hover:text-rose-700' : 'text-blue-600 hover:text-blue-700'
                          )}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </td>
                )}
              </tr>
              {isDetail && isOpen(r.id) && <tr><td colSpan={totalColumns} className="border-b border-slate-200 bg-slate-50 px-5 py-3">
                <dl className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-6 gap-y-2">{detailFields.map(field => (
                  <div key={field}><dt className="text-xs text-slate-500">{fieldTitle(field)}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{renderCell(r[field], undefined, field)}</dd></div>
                ))}</dl>
              </td></tr>}
              </React.Fragment>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={totalColumns} className="py-10 text-center text-slate-400 text-[13px]">
                  <Inbox className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                  {(p.emptyText as string) || '暂无数据'}
                </td>
              </tr>
            )}
          </tbody>
          {Boolean(p.showSummary) && pageRows.length > 0 && (
            <tfoot>
              <tr className="bg-amber-50/45 border-t border-slate-200 font-semibold text-slate-800 text-[12px]">
                {expandable && <td className={cx(cellPadCls, borderCellCls)} />}
                {p.selectable && <td className={cx(cellPadCls, borderCellCls)} />}
                {showIndex && (
                  <td className={cx('text-amber-800 font-bold whitespace-nowrap', cellPadCls, borderCellCls)}>
                    合计
                  </td>
                )}
                {columns.map((c, idx) => {
                  if (idx === 0 && !showIndex) {
                    return (
                      <td key={c.dataIndex} className={cx('text-amber-800 font-bold', cellPadCls, borderCellCls)}>
                        {(p.summaryText as string) || '合计'}
                      </td>
                    );
                  }
                  if (idx === 0 && p.summaryText) {
                    return (
                      <td key={c.dataIndex} className={cx('text-slate-700', cellPadCls, borderCellCls)}>
                        {p.summaryText as string}
                      </td>
                    );
                  }
                  const nums = pageRows.map((r) => Number(r[c.dataIndex])).filter((n) => !Number.isNaN(n));
                  const isNumericCol =
                    nums.length === pageRows.length &&
                    (c.render === 'money' || /(qty|amount|price|tax|count|total|num)/i.test(c.dataIndex));
                  if (isNumericCol) {
                    const sum = nums.reduce((acc, v) => acc + v, 0);
                    return (
                      <td key={c.dataIndex} className={cx('tabular-nums text-slate-900', cellPadCls, borderCellCls)}>
                        {renderCell(sum, c.render, c.dataIndex)}
                      </td>
                    );
                  }
                  return <td key={c.dataIndex} className={cx('text-slate-400', cellPadCls, borderCellCls)}>—</td>;
                })}
                {actions.length > 0 && <td className={cx('border-l border-slate-200 bg-amber-50/45 sticky right-0', cellPadCls)} />}
              </tr>
            </tfoot>
          )}
        </table>
      </div></Spin></AntdSurface>
      {showPagination && total > 0 && (
        <Pager total={total} pageSize={pageSize} page={page} onChange={(n, size) => { setPageSize(size); rt.setPageNo(node.pfId, n); }} showSizeChanger={p.showSizeChanger !== false} showQuickJumper={p.showQuickJumper} />
      )}
    </div>
  );
};

const Descriptions: React.FC<CompProps> = ({ p, root, scope }) => {
  const tables = useMaterialTables();
  const table = tables.find((t) => t.id === p.table);
  const rows = useTableRows(table?.id);
  const row = (scope.row ?? (scope.params?.row as Row | undefined) ?? rows[0]) as Row | undefined;
  const items: { label: string; value: React.ReactNode }[] =
    Array.isArray(p.items) && p.items.length
      ? (p.items as { label: string; field?: string; value?: string }[]).map((it) => ({ label: it.label, value: it.field ? renderCell(row?.[it.field], undefined, it.field) : it.value ?? '—' }))
      : table
      ? table.columns.filter((c) => !c.isPrimaryKey).slice(0, 10).map((c) => ({ label: columnLabel(c), value: renderCell(row?.[c.name], undefined, c.name) }))
      : [
          { label: '字段一', value: '示例值' },
          { label: '字段二', value: '示例值' },
        ];
  const column = Math.max(1, Number(p.column ?? 2));
  const isBordered = Boolean(p.bordered);
  const isVert = p.layout === 'vertical';
  const showColon = p.colon !== false;
  const sz = (p.size as 'small' | 'middle' | 'large') || 'middle';
  const cellPad =
    sz === 'small' ? 'px-2.5 py-1.5 text-[12px]' : sz === 'large' ? 'px-4 py-3 text-[14px]' : 'px-3 py-2 text-[13px]';
  const customLabelW = typeof p.labelWidth === 'number' && p.labelWidth > 0 ? p.labelWidth : undefined;

  return (
    <div {...rootWith(root, { className: 'space-y-2' })}>
      {(p.title || p.extra) && (
        <div className="flex items-center justify-between">
          {p.title && <div className="text-[14px] font-semibold text-slate-900">{p.title}</div>}
          {p.extra && <div className="text-[12px] text-slate-500">{p.extra}</div>}
        </div>
      )}
      {isBordered ? (
        <div
          className="grid border-t border-l border-slate-200 rounded-lg overflow-hidden bg-white"
          style={{ gridTemplateColumns: `repeat(${column}, minmax(0, 1fr))` }}
        >
          {items.map((it, i) => (
            <div
              key={i}
              className={cx(
                'min-w-0 border-r border-b border-slate-200',
                isVert ? 'flex flex-col' : 'flex items-stretch'
              )}
            >
              <div
                className={cx(
                  'bg-slate-50/90 text-slate-600 font-medium shrink-0',
                  cellPad,
                  isVert ? 'border-b border-slate-200' : 'border-r border-slate-200 flex items-center'
                )}
                style={!isVert ? { width: customLabelW ?? 116 } : undefined}
              >
                <span className="truncate">{it.label}</span>
              </div>
              <div className={cx('flex-1 min-w-0 text-slate-800 flex items-center truncate', cellPad)}>
                {it.value}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className={cx('grid gap-x-6', sz === 'small' ? 'gap-y-1.5 text-[12px]' : sz === 'large' ? 'gap-y-3.5 text-[14px]' : 'gap-y-2.5 text-[13px]')}
          style={{ gridTemplateColumns: `repeat(${column}, minmax(0, 1fr))` }}
        >
          {items.map((it, i) => (
            <div key={i} className={cx('min-w-0', isVert ? 'flex flex-col gap-0.5' : 'flex items-baseline')}>
              <span
                className="shrink-0 text-slate-500 mr-1.5"
                style={customLabelW ? { width: customLabelW } : undefined}
              >
                {it.label}
                {showColon ? '：' : ''}
              </span>
              <span className="text-slate-800 truncate">{it.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const STAT_COLOR: Record<string, string> = {
  default: 'text-slate-900',
  blue: 'text-blue-600',
  green: 'text-emerald-600',
  orange: 'text-amber-600',
  red: 'text-rose-600',
};
const Statistic: React.FC<CompProps> = ({ p, root }) => {
  const rows = useTableRows((p.table as string) || undefined);
  const rawVal = p.table ? rows.length : p.value ?? 0;
  const formattedVal =
    typeof p.precision === 'number' && !Number.isNaN(Number(rawVal))
      ? Number(rawVal).toFixed(p.precision)
      : rawVal;
  return (
    <div
      {...rootWith(root, {
        className: cx(
          'rounded-lg bg-white px-4 py-3',
          p.bordered === false ? '' : 'border border-slate-200'
        ),
      })}
    >
      <div className="text-[13px] text-slate-500">{p.title}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        {p.prefix && <span className="text-[15px] font-medium text-slate-500">{p.prefix}</span>}
        <span className={cx('text-[24px] font-semibold tabular-nums', STAT_COLOR[(p.valueColor as string) || 'default'] ?? STAT_COLOR.default)}>
          {formattedVal}
        </span>
        {p.suffix && <span className="text-[13px] text-slate-500">{p.suffix}</span>}
        {p.trend === 'up' && <TrendingUp className="w-4 h-4 text-emerald-600 ml-1" />}
        {p.trend === 'down' && <TrendingDown className="w-4 h-4 text-rose-500 ml-1" />}
      </div>
    </div>
  );
};

const Tag: React.FC<CompProps> = ({ p, text, root, rt, scope }) => {
  const [closed, setClosed] = useState(false);
  if (closed && !rt.isDesign) return null;
  return <span {...rootWith(root, { className: 'inline-block' })}>
    <TagPill color={p.color} bordered={p.bordered !== false} round={p.round} closable={p.closable}
      onClose={() => { if (!rt.isDesign) { setClosed(true); rt.run(p.onClose, scope); } }}>
      {text || '标签'}
    </TagPill>
  </span>;
};

const Timeline: React.FC<CompProps> = ({ p, root }) => {
  const rawItems = (Array.isArray(p.items) ? p.items : []) as { title: string; time?: string; status?: string }[];
  const items = p.reverse ? [...rawItems].reverse() : rawItems;
  const dot: Record<string, string> = { done: 'bg-blue-600', current: 'bg-white border-2 border-blue-600', wait: 'bg-slate-300', error: 'bg-rose-500' };
  const isRight = p.mode === 'right';
  return (
    <div {...rootWith(root, { className: 'space-y-0' })}>
      {items.map((it, i) => (
        <div key={i} className={cx('relative pb-4 last:pb-0', isRight ? 'pr-6 text-right' : 'pl-6')}>
          {i < items.length - 1 && (
            <span className={cx('absolute top-3 bottom-0 w-px bg-slate-200', isRight ? 'right-[5px]' : 'left-[5px]')} />
          )}
          <span
            className={cx(
              'absolute top-1 w-3 h-3 rounded-full',
              isRight ? 'right-0' : 'left-0',
              dot[it.status ?? 'done'] ?? dot.done
            )}
          />
          <div className="text-[13px] text-slate-800">{it.title}</div>
          {it.time && <div className="text-[12px] text-slate-400">{it.time}</div>}
        </div>
      ))}
    </div>
  );
};

const TEXT_CLS: Record<string, string> = { default: 'text-slate-700', secondary: 'text-slate-500', success: 'text-emerald-600', warning: 'text-amber-600', danger: 'text-rose-600' };
const TEXT_SIZE: Record<string, string> = { xs: 'text-[11px]', sm: 'text-[13px]', base: 'text-[14px]', lg: 'text-[16px]' };
const Text: React.FC<CompProps> = ({ p, text, root }) => (
  <p
    {...rootWith(root, {
      className: cx(
        'leading-relaxed inline-flex items-center gap-1',
        TEXT_SIZE[(p.size as string) || 'sm'] ?? TEXT_SIZE.sm,
        TEXT_CLS[p.type as string] ?? TEXT_CLS.default,
        p.strong && 'font-semibold',
        p.italic && 'italic',
        p.underline && 'underline',
        p.delete && 'line-through',
        p.code && 'font-mono bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[12px]'
      ),
    })}
  >
    <span>{text || '文本'}</span>
    {p.copyable && <CopyIcon className="w-3 h-3 text-blue-500 cursor-pointer shrink-0" />}
  </p>
);

const Title: React.FC<CompProps> = ({ p, text, root }) => {
  const size = ['', 'text-[22px]', 'text-[18px]', 'text-[15px]', 'text-[14px]', 'text-[13px]'][Number(p.level ?? 3)] ?? 'text-[15px]';
  const alignCls = p.align === 'center' ? 'text-center' : p.align === 'right' ? 'text-right' : 'text-left';
  return (
    <div
      {...rootWith(root, {
        className: cx(
          'font-semibold text-slate-900',
          size,
          alignCls,
          p.mark && 'pl-2.5 border-l-4 border-blue-600'
        ),
      })}
    >
      {text || '标题'}
    </div>
  );
};

const Empty: React.FC<CompProps> = ({ p, root }) => {
  const iconSz = p.size === 'small' ? 'w-7 h-7' : p.size === 'large' ? 'w-14 h-14' : 'w-10 h-10';
  return (
    <div {...rootWith(root, { className: cx('text-center text-[13px] text-slate-400', p.size === 'small' ? 'py-4' : 'py-8') })}>
      <Inbox className={cx('mx-auto mb-2 text-slate-300', iconSz)} />
      {p.description ?? '暂无数据'}
    </div>
  );
};

const Form: React.FC<CompProps> = ({ node, p, children, root, rt, scope }) => {
  const tables = useMaterialTables();
  const boundTable = tables.find((t) => t.id === p.table);
  const values = rt.formValues[node.pfId] ?? {};
  const errors = rt.formErrors[node.pfId] ?? {};
  const cols = Math.max(1, Math.min(4, Number(p.cols ?? 2)));
  const row = (scope.row ?? scope.params?.row) as Row | undefined;
  // Edit mode: prefill from the row passed into the overlay
  useEffect(() => {
    if (!rt.isDesign && row && p.table && (scope.tableId ?? scope.params?.tableId) === p.table && Object.keys(values).length === 0) {
      const { id: _id, ...rest } = row;
      rt.setFormValues(node.pfId, rest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, scope.tableId, scope.params?.tableId, p.table]);
  const ctx: FormCtxValue = {
    formId: node.pfId,
    cols,
    grid: 'twelve',
    labelWidth: Number(p.labelWidth ?? 96),
    layout: (p.layout as 'horizontal' | 'vertical' | 'inline') ?? (cols >= 2 ? 'vertical' : 'horizontal'),
    labelAlign: (p.labelAlign as 'right' | 'left') ?? 'right',
    colon: Boolean(p.colon),
    size: (p.size as 'small' | 'middle' | 'large') ?? 'middle',
    disabled: Boolean(p.disabled),
    values,
    errors,
    setValue: (n, v) => rt.setFormValue(node.pfId, n, v),
  };
  const explicitFields = (Array.isArray(p.fields) ? p.fields : []) as FieldDef[];
  const fieldDefs: FieldDef[] =
    explicitFields.length > 0
      ? explicitFields
      : children.length === 0 && boundTable
      ? defaultDisplayColumns(boundTable, 8).map((col) => {
          const n = col.name.toLowerCase();
          const t = col.dataType.toUpperCase();
          const c = col.comment || '';
          const isSelect = n.includes('status') || c.includes('状态') || n.endsWith('_type');
          const isDate = t.startsWith('DATE') || t.startsWith('TIMESTAMP') || n.endsWith('_date');
          const isNumber = t.startsWith('DECIMAL') || t.startsWith('INT') || t.startsWith('BIGINT');
          return {
            name: col.name,
            label: columnLabel(col),
            type: isSelect ? 'select' : isDate ? 'date' : isNumber ? 'number' : 'input',
            options: isSelect ? '待审批,已通过,已驳回,草稿' : undefined,
            required: !col.nullable,
          };
        })
      : [];
  return (
    <div {...rootWith(root, {})}>
      <FormCtx.Provider value={ctx}>
        <div
          className={cx(
            ctx.layout === 'inline'
              ? 'flex flex-wrap items-center gap-x-4 gap-y-2.5'
              : 'grid grid-cols-12 gap-x-4 gap-y-3 items-start'
          )}
        >
          {children.length
            ? children
            : fieldDefs.map((f, i) => <FieldControl key={`${f.name}-${i}`} def={{ ...f, type: f.type ?? 'input' }} rt={rt} scope={scope} />)}
        </div>
        {children.length === 0 && fieldDefs.length === 0 && <DropHint rt={rt} label="拖入输入框、下拉框等字段，或绑定物理表生成" />}
      </FormCtx.Provider>
    </div>
  );
};

const Toolbar: React.FC<CompProps> = ({ p, children, root, rt }) => {
  const bgCls =
    p.bg === 'gray'
      ? 'bg-slate-50/90 px-3 py-2 rounded-lg border border-slate-200/80'
      : p.bg === 'blue'
      ? 'bg-blue-50/50 px-3 py-2 rounded-lg border border-blue-100'
      : '';
  return (
    <div
      {...rootWith(root, {
        className: cx(
          'flex flex-wrap items-center gap-2.5 min-h-8',
          p.align === 'right' && 'justify-end',
          p.align === 'center' && 'justify-center',
          (p.align === 'between' || p.title) && 'justify-between',
          bgCls,
          p.bordered && 'border-b border-slate-200 pb-2.5'
        ),
      })}
    >
      <InlineToolbarCtx.Provider value={true}>
        {(p.title || p.subTitle) && (
          <div className="flex items-baseline gap-2 mr-2">
            {p.title && <span className="text-[14px] font-semibold text-slate-900">{p.title}</span>}
            {p.subTitle && <span className="text-[12px] text-slate-500">{p.subTitle}</span>}
          </div>
        )}
        {children.length ? (p.title || p.subTitle ? <div className="flex flex-wrap items-center gap-2.5">{children}</div> : children) : <DropHint rt={rt} label="拖入按钮或筛选控件" />}
      </InlineToolbarCtx.Provider>
    </div>
  );
};

const ALERT_CLS: Record<string, { cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  info: { cls: 'bg-blue-50 border-blue-200 text-blue-800', Icon: Info },
  success: { cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', Icon: CheckCircle2 },
  warning: { cls: 'bg-amber-50 border-amber-200 text-amber-800', Icon: AlertTriangle },
  error: { cls: 'bg-rose-50 border-rose-200 text-rose-800', Icon: XCircle },
};
const Alert: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const [closed, setClosed] = useState(false);
  if (closed && !rt.isDesign) return null;
  const a = ALERT_CLS[p.type as string] ?? ALERT_CLS.info;
  const showIcon = p.showIcon !== false;
  return (
    <div
      {...rootWith(root, {
        className: cx(
          'flex items-start gap-2 px-3 py-2 border text-[13px]',
          p.banner ? 'rounded-none border-x-0' : 'rounded-md',
          a.cls
        ),
      })}
    >
      {showIcon && <a.Icon className="w-4 h-4 shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className="font-medium">{p.message}</div>
        {p.description && <div className="opacity-80 mt-0.5 text-[12px]">{p.description}</div>}
      </div>
      {p.closable && <button type="button" aria-label="关闭提示" onClick={() => { if (!rt.isDesign) { setClosed(true); rt.run(p.onClose, scope); } }} className="opacity-60 hover:opacity-100 shrink-0 mt-0.5"><X className="w-3.5 h-3.5" /></button>}
    </div>
  );
};

const Result: React.FC<CompProps> = ({ p, children, root }) => {
  const Icon = p.status === 'error' ? XCircle : p.status === 'warning' ? AlertTriangle : p.status === 'info' ? Info : CheckCircle2;
  const color = p.status === 'error' ? 'text-rose-500' : p.status === 'warning' ? 'text-amber-500' : p.status === 'info' ? 'text-blue-500' : 'text-emerald-500';
  return (
    <div {...rootWith(root, { className: 'py-8 text-center space-y-2' })}>
      <Icon className={cx('w-12 h-12 mx-auto', color)} />
      <div className="text-[18px] font-semibold text-slate-900">{p.title}</div>
      {p.subTitle && <div className="text-[13px] text-slate-500">{p.subTitle}</div>}
      {children.length > 0 && <div className="flex justify-center gap-2 pt-2">{children}</div>}
    </div>
  );
};

/** Modal / Drawer: live = stacked overlay in the preview frame; staticOverlay = framed editor in design mode. */
const OverlayFrame: React.FC<CompProps & { kind: 'modal' | 'drawer' }> = ({ kind, p, children, root, rt, scope, live, staticOverlay }) => {
  const width = Number(p.width ?? (kind === 'modal' ? 640 : 520));
  const close = () => rt.run({ $kind: 'actions', calls: [{ name: 'closeOverlay', args: [] }] }, scope);
  const showFooter = p.footer === undefined ? kind === 'modal' : p.footer !== false;
  const body = (
    <>
      <div className="flex items-center justify-between px-5 h-12 border-b border-slate-100 shrink-0">
        <span className="text-[15px] font-semibold text-slate-900">{p.title ?? (kind === 'modal' ? '弹框' : '抽屉')}</span>
        <button type="button" onClick={close} className="p-1 rounded hover:bg-slate-100 text-slate-500">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 grid grid-cols-12 gap-x-4 gap-y-3.5 items-start content-start">
        {children.length ? children : <div className="col-span-12"><DropHint rt={rt} label={`拖入组件设计${kind === 'modal' ? '弹框' : '抽屉'}内容`} /></div>}
      </div>
      {showFooter && (
        <div className="flex items-center justify-end gap-2 px-5 h-14 border-t border-slate-100 shrink-0">
          <button type="button" onClick={close} className={cx('h-8 px-3.5 rounded-md border text-[13px] cursor-pointer', BTN_CLS.default)}>
            {(p.cancelText as string) || '取消'}
          </button>
          <button type="button" onClick={() => (p.onOk ? rt.run(p.onOk as PropValue, scope) : close())} className={cx('h-8 px-3.5 rounded-md border text-[13px] cursor-pointer', BTN_CLS.primary)}>
            {(p.okText as string) || '确定'}
          </button>
        </div>
      )}
    </>
  );

  if (staticOverlay) {
    return (
      <div className="min-h-full p-8 bg-slate-500/25 flex items-start" style={{ justifyContent: kind === 'drawer' ? (p.placement === 'left' ? 'flex-start' : 'flex-end') : 'center' }}>
        <div {...rootWith(root, { className: cx('bg-white shadow-2xl flex flex-col', kind === 'modal' ? 'rounded-lg' : 'rounded-md min-h-[560px]'), style: { width, maxWidth: '100%' } })}>{body}</div>
      </div>
    );
  }
  if (!live) return null;
  const z = 40 + (scope.overlayIndex ?? 0) * 2;
  return (
    <div
      className="absolute inset-0 flex"
      style={{
        zIndex: z,
        justifyContent: kind === 'drawer' ? (p.placement === 'left' ? 'flex-start' : 'flex-end') : 'center',
        alignItems: kind === 'modal' ? (p.centered !== false ? 'center' : 'flex-start') : 'stretch',
      }}
    >
      <div className="absolute inset-0 bg-slate-900/45 pf-fade-in" onClick={close} />
      <div
        {...rootWith(root, {
          className: cx(
            'pf-paper relative bg-white shadow-2xl flex flex-col',
            kind === 'modal'
              ? cx('rounded-xl max-h-[calc(100%-3rem)] pf-pop-in', p.centered === false && 'mt-10')
              : 'h-full pf-slide-in'
          ),
          style: { width, maxWidth: 'calc(100% - 32px)' },
        })}
      >
        {body}
      </div>
    </div>
  );
};

export const REGISTRY: Record<string, React.FC<CompProps>> = {
  Freeform: FreeformMaterial,
  ...ANTD_COMPONENTS,
  Page,
  Card,
  Row: Row_,
  Col,
  Space,
  Tabs,
  Tab,
  Divider,
  Steps,
  PageHeader,
  Breadcrumb,
  Pagination,
  QueryForm,
  SearchInput,
  Table,
  Descriptions,
  Statistic,
  Tag,
  Timeline,
  Text,
  Title,
  Empty,
  Form,
  Input: fieldFromProps('input'),
  NumberInput: fieldFromProps('number'),
  Textarea: fieldFromProps('textarea'),
  Select: fieldFromProps('select'),
  DatePicker: fieldFromProps('date'),
  DateRange: fieldFromProps('dateRange'),
  Radio: fieldFromProps('radio'),
  Checkbox: fieldFromProps('checkbox'),
  Switch: fieldFromProps('switch'),
  Upload: fieldFromProps('upload'),
  PickerInput: fieldFromProps('picker'),
  TimePicker: fieldFromProps('time'),
  Slider: fieldFromProps('slider'),
  Rate: fieldFromProps('rate'),
  Cascader: fieldFromProps('cascader'),
  TreeSelect: fieldFromProps('treeSelect'),
  AutoComplete: fieldFromProps('autoComplete'),
  Segmented: fieldFromProps('segmented'),
  Button,
  Toolbar,
  Alert,
  Result,
  Modal: (props) => <OverlayFrame {...props} kind="modal" />,
  Drawer: (props) => <OverlayFrame {...props} kind="drawer" />,
  ...MOBILE_REGISTRY,
  ...Object.fromEntries(CHART_TYPES.map(type => [type, ChartMaterial])),
};
