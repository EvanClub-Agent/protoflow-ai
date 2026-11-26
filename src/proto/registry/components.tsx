import { AXURE_LEAF_KINDS } from '../axure/metadata';
import { AxureCanvas, AxureWidget, DynamicPanel, OutlineTree, TreeItem, StaticTable, textFrameStyle } from '../axure/materials';
import { FIGMA_COMPONENTS } from '../figma/materials';
import { MODERN_DESKTOP_COMPONENTS, resolveSemanticIcon } from './modernComponents';
import { rowsForSource, sourceForeignKeyErrors } from '../table/model';
import { resolveCanonicalRow, useAutoSelectFirstRow, useCollectionSourceRow, useSourceRow } from '../runtime/sourceRow';
import { matchesWhenCondition } from '../runtime/pokaYoke';
import React, { createContext, useContext, useEffect, useId, useMemo, useState } from 'react';
import AntButton from 'antd/es/button';
import AntPagination from 'antd/es/pagination';
import Skeleton from 'antd/es/skeleton';
import Spin from 'antd/es/spin';
import { CaptureMode } from '../../capture/CaptureMode';
import { AntdSurface, useResolvedTheme } from './AntdSurface';
import { useDesktopOverlayExitAnimation } from './DesktopOverlayStack';
import {
  CanvasThemeContext,
  CardBodyContext,
  DesktopOverlayPositionContext,
  useCanvasTheme,
  useInsideCardBody,
  type CanvasThemeContextValue,
} from '../theme/ProtoCanvasThemeScope';
import {
  normalizeDesktopAccent,
  normalizeDesktopMotion,
  normalizeDesktopSurfaceBg,
  resolveDesktopAccentColor,
  resolveDesktopAppearance,
  resolveDesignTokens,
} from '../theme/designTokens';
import {
  applyUIStackRows,
  UIStackEmptyBannerHint,
  UIStackPageErrorResult,
  useUIStackState,
} from '../runtime/uiStackLens';
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
import { materialOptions } from './antdOptions';
import { ANTD_COMPONENTS } from './antdComponents';
import { FreeformMaterial } from '../freeform/FreeformMaterial';
import { MOBILE_REGISTRY, SplitMetricText } from '../mobile/components';
import { EditableCell } from '../table/EditableCell';
import { defaultTableColumns, missingMergeRow, SAMPLE_FIELDS, SAMPLE_ROWS, prepareTableRows, tableCellSpans, tableConfigErrors, visibleTableRows, type TableColumn, type TableSort } from '../table/model';
import { ChartMaterial } from '../charts/ChartMaterial';
import { CHART_TYPES } from '../charts/model';
import type { PropValue, ProtoNode } from '../types';
import { childRowScope, resolveFormInstanceKey, type Runtime, type Scope } from '../runtime/runtime';
import { usePageStore } from '../store/usePageStore';
import { useProtoStore } from '../../store/useProtoStore';
import { columnLabel, defaultDisplayColumns, type Row } from '../runtime/mock';
import {
  buildForeignKeyOptionsFromRows,
  currentProjectDataContext,
  fieldTypeOf,
  projectBuiltinFixedRows,
  resolveBoundForeignKeySpec,
  resolveFieldSelectOptions,
} from '../ai/templates';
import { tr as trStatic, useI18n } from '../../i18n';

export type RootAttrs = {
  'data-pf-id'?: string;
  'data-pf-mirror-of'?: string;
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
  renderMirroredNode?: (n: ProtoNode, scope?: Scope) => React.ReactNode;
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

const DropHint: React.FC<{ rt: Runtime; label?: string }> = ({ rt, label }) => {
  const { tr } = useI18n();
  return rt.isDesign ? (
    <div className="pf-drop-hint col-span-12 w-full flex items-center justify-center gap-1.5 min-h-[44px] rounded border border-dashed border-slate-300 text-[11px] text-slate-400">
      <MousePointerSquareDashed className="w-3.5 h-3.5" />
      {label ?? tr('拖入组件', 'Drop components here')}
    </div>
  ) : null;
};

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
  /** AST pfId of the Form node (used for schema & FK validation) */
  formId: string;
  /** Runtime draft bucket key (may include `::row:<tableId>:<rowId>`) */
  formKey?: string;
  tableId?: string;
  isQueryForm?: boolean;
  editingSource?: boolean;
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

const QUERY_CHOICE_TYPES = new Set(['select', 'radio', 'segmented']);

// These CSV presets shipped before the query material had a separate clear value.
const LEGACY_QUERY_OPTIONS = new Set([
  '全部,启用,停用', 'All,Enabled,Disabled',
  '全部,待审批,已通过,已驳回,已归档', 'All,Pending,Approved,Rejected,Archived',
]);

export function normalizeQueryChoiceOptions(options: unknown): { options: unknown; legacyClearTokens: Set<string> } {
  const legacyClearTokens = new Set<string>();
  if (typeof options !== 'string' || !LEGACY_QUERY_OPTIONS.has(options)) return { options, legacyClearTokens };
  const [clear, ...choices] = materialOptions(options);
  legacyClearTokens.add(clear.label);
  return { options: [{ ...clear, value: '' }, ...choices], legacyClearTokens };
}

function useForeignKeyRows(tableId: string | undefined): Row[] {
  const preview = useContext(PreviewDataContext);
  const hasSaved = usePageStore((s) => (tableId ? Object.hasOwn(s.tableRows, tableId) : false));
  const savedRows = usePageStore((s) => (tableId && Object.hasOwn(s.tableRows, tableId) ? s.tableRows[tableId] : undefined));
  const templateId = useProtoStore((s) => s.currentProjectMeta.templateId);
  const suppliers = useProtoStore((s) => s.suppliers);
  const purchaseOrderItems = useProtoStore((s) => s.purchaseOrderItems);
  return useMemo(() => {
    if (!tableId) return [];
    if (preview) return preview.rows[tableId] ?? [];
    if (hasSaved) return savedRows ?? [];
    const fixed = projectBuiltinFixedRows({ templateId, suppliers, purchaseOrderItems });
    return fixed[tableId] ?? [];
  }, [preview, tableId, hasSaved, savedRows, templateId, suppliers, purchaseOrderItems]);
}

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
  initialValue?: string;
  layoutFrame?: Record<string, unknown>;
  onClick?: PropValue;
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
  const { locale, isEn, tr, td } = useI18n();
  const form = useContext(FormCtx);
  const preview = useContext(PreviewDataContext);
  const tables = useMaterialTables();
  const projectId = useProtoStore((s) => s.currentProjectMeta.projectId);
  const inToolbar = useContext(InlineToolbarCtx);
  const [local, setLocal] = useState<unknown>(def.initialValue ?? '');
  // Unbound controls keep local state; node identity is never a substitute for a business field.
  const name = def.name;
  const bound = form !== null && typeof name === 'string' && name.length > 0;
  const fkSpec = useMemo(
    () =>
      form?.tableId && def.type === 'select' && typeof name === 'string' && name
        ? resolveBoundForeignKeySpec(form.tableId, name, tables)
        : null,
    [form?.tableId, def.type, name, tables],
  );
  const fkRows = useForeignKeyRows(fkSpec?.refTable.id);
  const queryChoiceNormalized = useMemo(
    () =>
      form?.isQueryForm && QUERY_CHOICE_TYPES.has(def.type)
        ? normalizeQueryChoiceOptions(def.options)
        : null,
    [form?.isQueryForm, def.type, def.options],
  );
  const effectiveDef = useMemo(() => {
    if (fkSpec) {
      const liveOptions = buildForeignKeyOptionsFromRows(fkRows, fkSpec.valueCol, fkSpec.labelCol, {
        qualifiedOnly: fkSpec.qualifiedOnly,
        locale,
        translateDemoSupplierNames: !preview && projectId === 'proj-default-erp',
      });
      return { ...def, options: liveOptions };
    }
    if (queryChoiceNormalized && queryChoiceNormalized.options !== def.options) {
      return { ...def, options: queryChoiceNormalized.options };
    }
    return def;
  }, [def, fkSpec, fkRows, locale, preview, projectId, queryChoiceNormalized]);
  const rawInitial = form?.editingSource ? '' : def.initialValue ?? '';
  const initialValue =
    queryChoiceNormalized && typeof rawInitial === 'string' && queryChoiceNormalized.legacyClearTokens.has(rawInitial)
      ? ''
      : rawInitial;
  const rawBoundVal = bound ? (Object.hasOwn(form.values, name) ? form.values[name] : initialValue) : local;
  const value =
    queryChoiceNormalized && typeof rawBoundVal === 'string' && queryChoiceNormalized.legacyClearTokens.has(rawBoundVal)
      ? ''
      : rawBoundVal;
  const setValue = (rawNext: unknown) => {
    if (def.disabled || form?.disabled || def.readOnly) return;
    const v =
      queryChoiceNormalized && typeof rawNext === 'string' && queryChoiceNormalized.legacyClearTokens.has(rawNext)
        ? ''
        : rawNext;
    if (bound) form.setValue(name, v);
    else setLocal(v);
    if (!rt.isDesign && def.onChange) rt.run(def.onChange, { ...scope, params: { ...scope.params, value: v } });
  };
  const rawError = bound ? form.errors[name] : undefined;
  const error = rawError ? td(rawError) : undefined;
  const disabled = Boolean(def.disabled || form?.disabled);
  const readOnly = Boolean(def.readOnly);
  const effSize = def.size || form?.size || 'middle';
  const curInputCls = `${inputClsBase} ${inputSizeCls[effSize] ?? inputSizeCls.middle}`;
  const placeholder =
    def.placeholder ??
    (['select', 'date', 'dateRange', 'picker'].includes(def.type)
      ? isEn
        ? def.label
          ? `Select ${def.label}`
          : 'Select...'
        : `请选择${def.label ?? ''}`
      : isEn
      ? def.label
        ? `Enter ${def.label}`
        : 'Enter...'
      : `请输入${def.label ?? ''}`);

  let control: React.ReactNode;
  if (ANTD_FIELD_KINDS.has(effectiveDef.type)) {
    control = <AntdFieldControl def={effectiveDef} value={value} onChange={setValue} disabled={disabled} size={effSize} placeholder={placeholder} error={error} onClick={effectiveDef.onClick && !rt.isDesign && !disabled ? () => rt.run(effectiveDef.onClick,scope) : undefined} />;
  } else switch (def.type) {
    case 'upload': {
      const uType = def.listType ?? 'button';
      const btnLabel = def.buttonText || tr('点击上传', 'Click to Upload');
      if (uType === 'dragger') {
        control = (
          <div
            onClick={() => !rt.isDesign && !disabled && setValue(tr(`附件_${Date.now().toString().slice(-4)}.pdf`, `Attachment_${Date.now().toString().slice(-4)}.pdf`))}
            className="w-full py-4 px-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/50 hover:border-blue-400 hover:bg-blue-50/20 text-center cursor-pointer transition space-y-1"
          >
            <UploadIcon className="w-6 h-6 mx-auto text-blue-500" />
            <div className="text-[12px] text-slate-700 font-medium">
              {value ? String(value) : tr('点击或将文件拖拽到此区域上传', 'Click or drag files here to upload')}
            </div>
            {def.accept && <div className="text-[11px] text-slate-400">{tr(`支持格式：${def.accept}`, `Accepted: ${def.accept}`)}</div>}
          </div>
        );
      } else if (uType === 'picture-card') {
        control = (
          <button
            type="button"
            disabled={disabled}
            onClick={() => !rt.isDesign && setValue(tr(`图片_${Date.now().toString().slice(-4)}.png`, `Image_${Date.now().toString().slice(-4)}.png`))}
            className="w-20 h-20 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 hover:border-blue-400 hover:text-blue-600 flex flex-col items-center justify-center gap-1 text-slate-500 text-[11px] cursor-pointer transition"
          >
            <Plus className="w-4 h-4" />
            <span>{value ? tr('已上传', 'Uploaded') : btnLabel}</span>
          </button>
        );
      } else {
        control = (
          <button
            type="button"
            disabled={disabled}
            onClick={() => !rt.isDesign && setValue(tr(`附件_${Date.now().toString().slice(-4)}.pdf`, `Attachment_${Date.now().toString().slice(-4)}.pdf`))}
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
      const draftKey = bound ? (form.formKey ?? form.formId) : undefined;
      const pickerKey =
        def.pfId && bound && form && draftKey && draftKey !== form.formId
          ? `${draftKey}::picker:${def.pfId}`
          : def.pfId;
      const shown = (pickerKey && rt.pickerValues[pickerKey]) || (value == null ? '' : String(value));
      control = (
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            !readOnly &&
            def.overlay &&
            def.pfId &&
            rt.openPicker(
              def.overlay,
              {
                targetPfId: def.pfId!,
                pickerKey,
                formId: bound ? form.formId : undefined,
                formKey: draftKey,
                name,
              },
              scope,
            )
          }
          className={cx(curInputCls, 'flex items-center justify-between text-left')}
        >
          <span className={shown ? 'text-slate-800 truncate' : 'text-slate-400'}>{shown || placeholder}</span>
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        </button>
      );
      break;
    }
    default:
      control = <div role="alert" className="text-xs text-red-600">{tr(`不支持的字段类型：${def.type}`, `Unsupported field type: ${def.type}`)}</div>;
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
  const rootAttrs = root ?? (def.pfId ? { 'data-pf-id': def.pfId } : {});
  if (def.layoutFrame && !form && !def.label) return <div className="h-full w-full">{control}</div>;
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
  const labelSuffix = effColon ? tr('：', ': ') : '';

  const isFieldDark = useCanvasTheme()?.effectiveMode === 'dark';
  const fieldLabelToneCls = isFieldDark ? 'text-zinc-300' : 'text-slate-600';
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
            className={cx('shrink-0 text-[12px] font-medium whitespace-nowrap', fieldLabelToneCls)}
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
            className={cx('text-[12px] font-medium flex items-center gap-0.5 truncate', fieldLabelToneCls)}
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
            'shrink-0 text-[12px] font-medium whitespace-nowrap truncate',
            fieldLabelToneCls,
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
    return <FieldControl key={p.initialValue} def={{ ...(p as FieldDef), type, pfId: node.pfId }} rt={rt} scope={scope} root={root} />;
  };

// ───────────────────────── Components ─────────────────────────
const STATUS_COLOR: Record<string, string> = {
  已通过: 'green', 启用: 'green', 合格: 'green', qualified: 'green', confirmed: 'green', 已完成: 'green', 已入库: 'green', 已结单: 'green', 正常: 'green',
  Approved: 'green', Enabled: 'green', Active: 'green', Pass: 'green', Completed: 'green', Done: 'green', Stored: 'green', Closed: 'green',
  上门中: 'blue', 处理中: 'blue', 进行中: 'blue', 执行中: 'blue', 派单中: 'blue',
  'On-Site': 'blue', 'In Progress': 'blue', Processing: 'blue',
  待审批: 'orange', 审批中: 'orange', pending: 'orange', 待处理: 'orange', 待签字: 'orange', 待接单: 'orange', 待验收: 'orange',
  Pending: 'orange', Reviewing: 'orange', Queued: 'orange',
  已驳回: 'red', 停用: 'red', rejected: 'red', 异常: 'red', 超时: 'red', 高危: 'red',
  Rejected: 'red', Disabled: 'red', Fail: 'red', Error: 'red', Overdue: 'red',
  草稿: 'default', draft: 'default', Draft: 'default',
};
const TAG_CLS_LIGHT: Record<string, string> = {
  default: 'bg-slate-100/90 text-slate-600 border-slate-200/80',
  blue: 'bg-blue-50/90 text-blue-700 border-blue-200/80',
  green: 'bg-emerald-50/90 text-emerald-700 border-emerald-200/80',
  orange: 'bg-amber-50/90 text-amber-700 border-amber-200/80',
  red: 'bg-rose-50/90 text-rose-700 border-rose-200/80',
  purple: 'bg-purple-50/90 text-purple-700 border-purple-200/80',
  cyan: 'bg-cyan-50/90 text-cyan-700 border-cyan-200/80',
};
const TAG_CLS_DARK: Record<string, string> = {
  default: 'bg-zinc-800/90 text-zinc-300 border-zinc-700/80',
  blue: 'bg-blue-500/16 text-blue-300 border-blue-400/25',
  green: 'bg-emerald-500/16 text-emerald-300 border-emerald-400/25',
  orange: 'bg-amber-500/16 text-amber-300 border-amber-400/25',
  red: 'bg-rose-500/16 text-rose-300 border-rose-400/25',
  purple: 'bg-purple-500/16 text-purple-300 border-purple-400/25',
  cyan: 'bg-cyan-500/16 text-cyan-300 border-cyan-400/25',
};
const TAG_DOT_CLS: Record<string, string> = {
  default: 'bg-slate-400',
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  orange: 'bg-amber-500',
  red: 'bg-rose-500',
  purple: 'bg-purple-500',
  cyan: 'bg-cyan-500',
};
const TagPill: React.FC<{
  color?: string;
  bordered?: boolean;
  round?: boolean;
  dot?: boolean;
  closable?: boolean;
  onClose?: () => void;
  children: React.ReactNode;
}> = ({ color = 'default', bordered = true, round, dot, closable, onClose, children }) => {
  const { tr } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const palette = isDark ? TAG_CLS_DARK : TAG_CLS_LIGHT;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11.5px] font-medium leading-4',
        round ? 'rounded-full' : 'rounded-md',
        bordered ? 'border' : 'border border-transparent',
        palette[color] ?? palette.default,
      )}
    >
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full shrink-0', TAG_DOT_CLS[color] ?? TAG_DOT_CLS.default)} aria-hidden="true" />}
      {children}
      {closable && <button type="button" aria-label={tr('关闭标签', 'Close tag')} onClick={onClose} className="opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>}
    </span>
  );
};

const BTN_CLS: Record<string, string> = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600',
  default: 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300 hover:border-blue-400 hover:text-blue-600',
  dashed: 'bg-white hover:bg-slate-50 text-slate-700 border-dashed border-slate-300 hover:border-blue-400 hover:text-blue-600',
  danger: 'bg-white hover:bg-rose-50 text-rose-600 border-rose-300',
  text: 'bg-transparent hover:bg-slate-100 text-slate-700 border-transparent',
  link: 'bg-transparent text-blue-600 hover:text-blue-700 border-transparent px-1',
};

const Button: React.FC<CompProps> = ({ p, text, root, rt, scope }) => {
  const { tr } = useI18n();
  const hasWhenGuard = Boolean(p.disabledWhenField || p.hiddenWhenField);
  const source = useSourceRow(scope, rt.pageId, hasWhenGuard);
  const ctxRow = (scope.row ?? scope.params?.row ?? source.row) as Record<string, unknown> | undefined;
  if (!rt.isDesign && matchesWhenCondition(ctxRow, p.hiddenWhenField, p.hiddenWhenValue)) {
    return null;
  }
  const guardedDisabled = !rt.isDesign && matchesWhenCondition(ctxRow, p.disabledWhenField, p.disabledWhenValue);
  const isDisabled = Boolean(p.disabled) || guardedDisabled;
  const disabledReason =
    guardedDisabled && typeof p.disabledReason === 'string' && p.disabledReason.trim()
      ? p.disabledReason.trim()
      : undefined;
  const Icon = p.icon ? ICONS[p.icon as string] : null;
  return <AntdSurface><AntButton
    {...root}
    title={disabledReason}
    data-disabled-reason={disabledReason}
    autoInsertSpace={p.layoutFrame ? false : undefined}
    style={p.layoutFrame ? { ...textFrameStyle(p.layoutFrame), boxShadow: 'none' } : root.style}
    type={p.type === 'danger' ? 'default' : p.type}
    danger={p.danger || p.type === 'danger'} ghost={p.ghost} size={p.size}
    shape={p.shape} block={p.block} disabled={isDisabled} loading={p.loading}
    icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined} iconPlacement={p.iconPosition}
    onClick={(event) => {
      root.onClick?.(event);
      if (!rt.isDesign && !isDisabled && !p.loading) rt.run(p.onClick as PropValue, scope);
    }}
  >{p.shape === 'circle' && Icon ? null : text || tr('按钮', 'Button')}</AntButton></AntdSurface>;
};

const Page: React.FC<CompProps> = ({ p, children, root, rt }) => {
  const { tr } = useI18n();
  const canvasTheme = useCanvasTheme();
  const resolvedHostMode = useResolvedTheme();
  const isCapture = useContext(CaptureMode);
  const uiState = useUIStackState();
  const density = canvasTheme?.resolved.density ?? 'comfortable';
  const effectivePad =
    p.padding === 'compact' || (p.padding === undefined && density === 'compact')
      ? 'p-3.5 gap-y-3'
      : p.padding === 'loose' || (p.padding === undefined && density === 'spacious')
      ? 'p-6 gap-y-5'
      : 'p-5 gap-y-4';

  const surfaceBg = normalizeDesktopSurfaceBg(p.surfaceBg) ?? canvasTheme?.surfaceBg ?? null;
  const accent = normalizeDesktopAccent(p.accent) ?? canvasTheme?.accent ?? null;
  const motion = p.motion !== undefined ? normalizeDesktopMotion(p.motion) : (canvasTheme?.motion ?? 'smooth');
  const effectiveMode = canvasTheme?.hasPageScope
    ? canvasTheme.effectiveMode
    : resolveDesktopAppearance(p.appearance, resolvedHostMode, undefined, p.surfaceBg);
  const isDarkCanvas = effectiveMode === 'dark';

  const fallbackCtx = useMemo<CanvasThemeContextValue>(() => {
    const resolved = canvasTheme?.resolved ?? resolveDesignTokens(null);
    return {
      rawTokens: canvasTheme?.rawTokens ?? null,
      resolved,
      effectiveMode,
      surfaceBg,
      accent,
      accentColor: resolveDesktopAccentColor(accent, effectiveMode, resolved.primaryColor),
      motion,
      hasPageScope: true,
    };
  }, [canvasTheme, effectiveMode, surfaceBg, accent, motion]);

  const bgCls = isDarkCanvas
    ? surfaceBg === 'oled_carbon'
      ? 'pf-desktop-surface-oled bg-[#0B0C0E] text-zinc-100'
      : surfaceBg === 'aurora'
      ? 'pf-desktop-surface-aurora-dark bg-[#0D1017] text-zinc-100'
      : surfaceBg === 'sage_field'
      ? 'pf-desktop-surface-sage-dark bg-[#0D1310] text-zinc-100'
      : surfaceBg === 'pure'
      ? 'bg-[#0E0E11] text-zinc-100'
      : surfaceBg !== null
      ? 'bg-[#101114] text-zinc-100'
      : 'bg-[#0a0a0a] text-zinc-100'
    : surfaceBg === 'sage_field'
    ? 'pf-desktop-surface-sage bg-[#EAEEE8] text-[#132018]'
    : surfaceBg === 'warm_paper'
    ? 'pf-desktop-surface-warm bg-[#F6F3EC] text-[#1C1917]'
    : surfaceBg === 'aurora'
    ? 'pf-desktop-surface-aurora bg-[#F3F5FB] text-slate-900'
    : surfaceBg === 'mist'
    ? 'pf-desktop-surface-mist bg-[#F1F5F9] text-slate-900'
    : surfaceBg === 'pure'
    ? 'bg-white text-slate-900'
    : p.bg === 'white'
    ? 'bg-white text-slate-900'
    : p.bg === 'gray'
    ? 'bg-slate-100/80 text-slate-900'
    : canvasTheme?.rawTokens
    ? 'bg-[var(--pf-bg-layout)] text-[var(--pf-text)]'
    : 'bg-[#f8fafc] text-slate-900';

  const pageErrorMode =
    uiState === 'error' && (p.errorFallback === 'result_403' || p.errorFallback === 'result_500')
      ? (p.errorFallback as 'result_403' | 'result_500')
      : null;

  const content = (
    <div
      data-pf-mode={!canvasTheme?.hasPageScope ? effectiveMode : undefined}
      data-desktop-appearance={effectiveMode}
      data-surface-bg={surfaceBg ?? undefined}
      data-accent={accent ?? undefined}
      data-motion={motion}
      data-design-mode={rt.isDesign ? '1' : undefined}
      data-capture-mode={isCapture ? '1' : undefined}
      {...rootWith(root, {
        className: cx(
          'pf-desktop-page pf-desktop-bento flex-[1_0_auto] grid grid-cols-12 gap-x-4 items-start content-start rounded-[16px]',
          effectivePad,
          bgCls,
        ),
        style: { colorScheme: effectiveMode },
      })}
    >
      {uiState === 'empty' && typeof p.emptyTitle === 'string' && p.emptyTitle.trim() && (
        <UIStackEmptyBannerHint emptyTitle={p.emptyTitle.trim()} />
      )}
      {pageErrorMode ? (
        <UIStackPageErrorResult
          mode={pageErrorMode}
          title={typeof p.errorTitle === 'string' ? p.errorTitle : undefined}
          description={typeof p.errorDescription === 'string' ? p.errorDescription : undefined}
          onRecover={() => useProtoStore.getState().setUIState('normal')}
        />
      ) : children.length ? (
        children
      ) : (
        <div className="col-span-12"><DropHint rt={rt} label={tr('从左侧物料库拖入组件', 'Drop components from the left palette')} /></div>
      )}
      {!p.title && null}
    </div>
  );

  return canvasTheme?.hasPageScope ? (
    content
  ) : (
    <CanvasThemeContext.Provider value={fallbackCtx}>{content}</CanvasThemeContext.Provider>
  );
};

const Card: React.FC<CompProps> = ({ node, p, children, root, rt }) => {
  const canvasTheme = useCanvasTheme();
  const isSmall = p.size === 'small' || (!p.size && canvasTheme?.resolved.density === 'compact');
  const isDark = canvasTheme?.effectiveMode === 'dark';
  const variant =
    (p.variant as 'default' | 'subtle' | 'accent' | 'bento' | 'inverted' | 'glow') || 'default';
  const isInverted = variant === 'inverted';
  const effectiveDark = isDark || isInverted;
  const surfaceMode = canvasTheme?.resolved.surfaceVariant ?? 'bordered';
  const cardRadiusStyle = canvasTheme?.rawTokens ? { borderRadius: canvasTheme.resolved.cardRadiusPx } : undefined;
  const hasExplicitHeaderBg = node.props.headerBg !== undefined;

  const invertedCtx = useMemo<CanvasThemeContextValue | null>(() => {
    if (!isInverted || isDark) return null;
    const resolved = canvasTheme?.resolved ?? resolveDesignTokens(null);
    return {
      rawTokens: canvasTheme?.rawTokens ?? null,
      resolved,
      effectiveMode: 'dark',
      surfaceBg: canvasTheme?.surfaceBg ?? null,
      accent: canvasTheme?.accent ?? null,
      accentColor: resolveDesktopAccentColor(canvasTheme?.accent ?? null, 'dark', resolved.primaryColor),
      motion: canvasTheme?.motion ?? 'smooth',
      hasPageScope: true,
    };
  }, [isInverted, isDark, canvasTheme]);

  const boxVariantCls = isInverted
    ? 'pf-desktop-card-inverted bg-[#14171D] text-zinc-100 ring-1 ring-inset ring-white/[0.1] shadow-[0_14px_34px_-12px_rgba(0,0,0,0.45)]'
    : isDark
    ? variant === 'subtle'
      ? 'bg-zinc-900/65 ring-1 ring-inset ring-white/[0.06] text-zinc-100'
      : variant === 'accent'
      ? 'bg-gradient-to-br from-indigo-950/65 via-[#16181D] to-[#16181D] ring-1 ring-inset ring-indigo-400/25 text-zinc-100 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.6)]'
      : variant === 'glow'
      ? 'pf-desktop-card-glow-dark bg-[#16181D] ring-1 ring-inset ring-indigo-400/35 shadow-[0_10px_28px_-10px_rgba(79,70,229,0.28)] text-zinc-100'
      : variant === 'bento'
      ? 'bg-[#16181D] ring-1 ring-inset ring-white/[0.08] shadow-[0_8px_24px_-10px_rgba(0,0,0,0.65)] text-zinc-100'
      : cx('bg-[#16181D] text-zinc-100 shadow-[0_6px_20px_-8px_rgba(0,0,0,0.6)]', p.bordered === false ? '' : 'ring-1 ring-inset ring-white/[0.08]')
    : variant === 'subtle'
    ? 'bg-slate-50/90 ring-1 ring-inset ring-slate-900/[0.05]'
    : variant === 'accent'
    ? 'bg-gradient-to-br from-blue-50/75 via-white to-indigo-50/35 ring-1 ring-inset ring-blue-500/20 shadow-[0_4px_18px_-6px_rgba(37,99,235,0.08)]'
    : variant === 'glow'
    ? 'pf-desktop-card-glow bg-white ring-1 ring-inset ring-indigo-500/25 shadow-[0_8px_26px_-8px_rgba(79,70,229,0.14)]'
    : variant === 'bento'
    ? 'bg-white ring-1 ring-inset ring-slate-900/[0.05] shadow-[0_6px_22px_-8px_rgba(15,23,42,0.07)]'
    : surfaceMode === 'subtle'
    ? 'bg-white shadow-[0_2px_12px_-4px_rgba(15,23,42,0.04)] ring-1 ring-inset ring-slate-900/[0.04]'
    : surfaceMode === 'elevated'
    ? 'bg-white shadow-[0_6px_20px_-6px_rgba(15,23,42,0.07)] ring-1 ring-inset ring-slate-900/[0.05]'
    : cx('bg-white shadow-[0_2px_14px_-4px_rgba(15,23,42,0.05)]', p.bordered === false ? '' : 'ring-1 ring-inset ring-slate-900/[0.06]');

  const headerTinted = hasExplicitHeaderBg && (p.headerBg === 'gray' || p.headerBg === 'blue');
  const headerBgCls = effectiveDark
    ? headerTinted
      ? 'bg-white/[0.03] border-b border-white/[0.07]'
      : 'border-b border-white/[0.06]'
    : p.headerBg === 'blue' || variant === 'accent'
    ? 'bg-blue-50/45 border-b border-blue-100/80'
    : headerTinted
    ? 'bg-slate-50/60 border-b border-slate-100'
    : 'border-b border-slate-900/[0.05]';

  const bodyNode = (
    <CardBodyContext.Provider value={true}>
      <div className={cx('grid grid-cols-12 gap-x-4 items-start', isSmall ? 'p-3.5 gap-y-2.5' : 'p-4 sm:p-5 gap-y-3.5')}>
        {p.loading ? (
          <div className="col-span-12"><AntdSurface><Skeleton active /></AntdSurface></div>
        ) : children.length ? (
          children
        ) : (
          <div className="col-span-12"><DropHint rt={rt} /></div>
        )}
      </div>
    </CardBodyContext.Provider>
  );

  return (
    <div
      data-card-variant={variant}
      data-pf-mode={isInverted ? 'dark' : undefined}
      {...rootWith(root, {
        className: cx(
          'rounded-[18px] transition duration-200',
          boxVariantCls,
          p.hoverable &&
            (effectiveDark
              ? 'hover:-translate-y-0.5 hover:ring-white/20 hover:shadow-[0_14px_32px_-10px_rgba(0,0,0,0.75)]'
              : 'hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-8px_rgba(15,23,42,0.1)] hover:ring-blue-500/25'),
        ),
        style: isInverted ? { ...cardRadiusStyle, colorScheme: 'dark' } : cardRadiusStyle,
      })}
    >
      {(p.title || p.extra) && (
        <div
          className={cx(
            'flex items-center justify-between gap-2 rounded-t-[18px]',
            isSmall ? 'px-3.5 py-2.5' : 'px-5 py-3.5',
            headerBgCls,
          )}
          style={
            cardRadiusStyle
              ? { borderTopLeftRadius: cardRadiusStyle.borderRadius, borderTopRightRadius: cardRadiusStyle.borderRadius }
              : undefined
          }
        >
          <span
            className={cx(
              'font-semibold tracking-tight',
              effectiveDark ? 'text-zinc-100' : 'text-slate-900',
              isSmall ? 'text-[12.5px]' : 'text-[14px]',
            )}
          >
            {p.title}
          </span>
          {p.extra && (
            <span
              className={cx(
                'text-[11.5px] font-medium',
                effectiveDark ? 'text-zinc-400' : 'text-slate-500',
              )}
            >
              {p.extra}
            </span>
          )}
        </div>
      )}
      {invertedCtx ? (
        <CanvasThemeContext.Provider value={invertedCtx}>{bodyNode}</CanvasThemeContext.Provider>
      ) : (
        bodyNode
      )}
    </div>
  );
};

const Row_: React.FC<CompProps> = ({ p, children, root, rt }) => {
  const { tr } = useI18n();
  return (
    <div
      {...rootWith(root, {
        className: cx(
          'grid grid-cols-24',
          p.align === 'middle' ? 'items-center' : p.align === 'bottom' ? 'items-end' : 'items-start'
        ),
        style: { gap: Number(p.gutter ?? 16), gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' },
      })}
    >
      {children.length ? children : <div className="col-span-24"><DropHint rt={rt} label={tr('拖入栅格列 Col', 'Drop Col grid columns')} /></div>}
    </div>
  );
};

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
  const { tr } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const active = Math.min(rt.tabs[node.pfId] ?? 0, Math.max(0, kids.length - 1));
  const pos = (p.tabPosition as 'top' | 'left' | 'bottom' | 'right') ?? 'top';
  const isSide = pos === 'left' || pos === 'right';
  const tabSizeCls =
    p.size === 'small' ? 'px-2.5 h-7 text-[12px]' : p.size === 'large' ? 'px-4 h-10 text-[14px]' : 'px-3 h-9 text-[13px]';
  const borderLineCls = isDark ? 'border-zinc-800' : 'border-slate-200';

  const tabBar = (
    <div
      className={cx(
        'flex gap-1 shrink-0',
        isSide
          ? cx('flex-col min-w-[128px]', pos === 'left' ? `border-r ${borderLineCls} pr-2` : `border-l ${borderLineCls} pl-2`)
          : cx(
              'items-center',
              pos === 'bottom' ? `mt-3 border-t ${borderLineCls} pt-1` : 'mb-3',
              p.type === 'segmented'
                ? cx('p-1 rounded-xl w-fit', isDark ? 'bg-zinc-800/80' : 'bg-slate-100/90')
                : `border-b ${borderLineCls}`,
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
                  'rounded-lg',
                  i === active
                    ? isDark
                      ? 'bg-zinc-900 text-zinc-100 font-semibold shadow-2xs ring-1 ring-inset ring-white/10'
                      : 'bg-white text-slate-900 font-semibold shadow-2xs'
                    : isDark
                    ? 'text-zinc-400 hover:text-zinc-100'
                    : 'text-slate-600 hover:text-slate-900'
                )
              : p.type === 'card'
              ? cx(
                  'rounded-t-lg border border-b-0 -mb-px',
                  i === active
                    ? isDark
                      ? 'bg-[#16181D] border-zinc-800 text-blue-400 font-medium'
                      : 'bg-white border-slate-200 text-blue-600 font-medium'
                    : isDark
                    ? 'bg-zinc-900/60 border-transparent text-zinc-400'
                    : 'bg-slate-50 border-transparent text-slate-600'
                )
              : i === active
              ? isDark
                ? 'text-blue-400 font-medium'
                : 'text-blue-600 font-medium'
              : isDark
              ? 'text-zinc-400 hover:text-zinc-100'
              : 'text-slate-600 hover:text-slate-900'
          )}
        >
          {String(k.props.title ?? tr(`页签${i + 1}`, `Tab ${i + 1}`))}
          {typeof k.props.badge === 'number' && k.props.badge > 0 && (
            <span className="min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-4">{k.props.badge}</span>
          )}
          {p.type !== 'card' && p.type !== 'segmented' && i === active && (
            <span
              className={cx(
                'absolute rounded',
                isDark ? 'bg-blue-400' : 'bg-blue-600',
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
      {kids.length ? renderNode(kids[active]) : <DropHint rt={rt} label={tr('拖入 Tab 页签项', 'Drop Tab panes')} />}
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
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const orient = (p.orientation as 'left' | 'center' | 'right') ?? 'center';
  const lineCls = cx(
    'border-t',
    p.dashed
      ? isDark
        ? 'border-dashed border-zinc-700'
        : 'border-dashed border-slate-300'
      : isDark
      ? 'border-zinc-800'
      : 'border-slate-200/80',
  );
  return (
    <div {...rootWith(root, { className: 'flex items-center gap-3 my-2' })}>
      <div className={cx(lineCls, p.text && orient === 'left' ? 'w-6 shrink-0' : 'flex-1')} />
      {p.text && <span className={cx('text-[12px] font-medium shrink-0', isDark ? 'text-zinc-400' : 'text-slate-500')}>{p.text}</span>}
      {p.text && <div className={cx(lineCls, orient === 'right' ? 'w-6 shrink-0' : 'flex-1')} />}
    </div>
  );
};

const Steps: React.FC<CompProps> = ({ p, root }) => {
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
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
                  ? isDark
                    ? 'border-blue-400 text-blue-300 bg-blue-500/15'
                    : 'border-blue-600 text-blue-600 bg-blue-50/40'
                  : i === cur
                  ? isErr
                    ? 'bg-rose-600 border-rose-600 text-white'
                    : 'bg-blue-600 border-blue-600 text-white'
                  : isDark
                  ? 'border-zinc-700 text-zinc-500'
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
                    ? 'text-rose-500 font-semibold'
                    : isDark
                    ? 'text-zinc-100 font-semibold'
                    : 'text-slate-900 font-medium'
                  : isDark
                  ? 'text-zinc-400'
                  : 'text-slate-500'
              )}
            >
              {it}
            </span>
          </div>
          {i < items.length - 1 && !isVert && (
            <div className={cx('flex-1 h-px', i < cur ? 'bg-blue-500' : isDark ? 'bg-zinc-800' : 'bg-slate-200')} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

const PageHeader: React.FC<CompProps> = ({ p, children, root, rt, scope }) => {
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const subTitle = p.subTitle ?? p.subtitle;
  return (
    <div {...rootWith(root, { className: cx('space-y-1.5 pb-1', p.divider && (isDark ? 'border-b border-zinc-800 pb-3' : 'border-b border-slate-200/80 pb-3')) })}>
      {Array.isArray(p.breadcrumb) && p.breadcrumb.length > 0 && (
        <div className={cx('flex items-center gap-1 text-[11.5px]', isDark ? 'text-zinc-400' : 'text-slate-500')}>
          {asOptions(p.breadcrumb).map((b, i, arr) => (
            <React.Fragment key={i}>
              <span className={i === arr.length - 1 ? (isDark ? 'text-zinc-200 font-medium' : 'text-slate-700 font-medium') : ''}>{b}</span>
              {i < arr.length - 1 && <ChevronRight className={cx('w-3 h-3', isDark ? 'text-zinc-600' : 'text-slate-400')} />}
            </React.Fragment>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap min-w-0">
          {p.back && (
            <button
              type="button"
              onClick={() => rt.run(p.onBack as PropValue, scope)}
              className={cx(
                'p-1.5 rounded-lg cursor-pointer transition',
                isDark ? 'hover:bg-white/10 text-zinc-300' : 'hover:bg-slate-200/60 text-slate-600',
              )}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <h1 className={cx('text-[19px] font-bold tracking-tight', isDark ? 'text-zinc-50' : 'text-slate-900')}>{p.title}</h1>
          {p.tagText && <TagPill color={(p.tagColor as string) || 'blue'} round dot>{p.tagText}</TagPill>}
          {subTitle && (
            <span
              className={cx(
                'text-[12px] px-2.5 py-0.5 rounded-full',
                isDark ? 'text-zinc-400 bg-white/[0.06] ring-1 ring-inset ring-white/[0.06]' : 'text-slate-500 bg-slate-900/[0.045]',
              )}
            >
              {subTitle}
            </span>
          )}
        </div>
        {children.length > 0 && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
      </div>
    </div>
  );
};

const Breadcrumb: React.FC<CompProps> = ({ p, root }) => {
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const sep = (p.separator as string) || '>';
  return (
    <div {...rootWith(root, { className: cx('flex items-center gap-1.5 text-[12px]', isDark ? 'text-zinc-400' : 'text-slate-500') })}>
      {asOptions(p.items).map((b, i, arr) => (
        <React.Fragment key={i}>
          <span className={i === arr.length - 1 ? (isDark ? 'text-zinc-100 font-medium' : 'text-slate-800 font-medium') : 'hover:text-blue-500 cursor-pointer'}>{b}</span>
          {i < arr.length - 1 && (
            sep === '>' ? <ChevronRight className="w-3 h-3" /> : <span className={isDark ? 'text-zinc-600' : 'text-slate-400'}>{sep}</span>
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
}> = ({ total, pageSize, page, onChange, size, align, showTotal = true, showSizeChanger = true, showQuickJumper, simple, disabled, hideOnSinglePage }) => {
  const { tr } = useI18n();
  return (
    <AntdSurface><AntPagination total={total} pageSize={pageSize} current={page} onChange={onChange}
      size={size === 'small' ? 'small' : undefined} align={align === 'left' ? 'start' : align === 'center' ? 'center' : 'end'}
      showTotal={showTotal ? (count) => tr(`共 ${count} 条`, `Total ${count}`) : undefined} showSizeChanger={showSizeChanger}
      showQuickJumper={showQuickJumper} simple={simple} disabled={disabled} hideOnSinglePage={hideOnSinglePage}
    /></AntdSurface>
  );
};

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
  const { tr } = useI18n();
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
    isQueryForm: true,
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
    const effectiveValues: Record<string, unknown> = {};
    for (const f of fields) {
      if (f?.name && f.initialValue !== undefined) effectiveValues[f.name] = f.initialValue;
    }
    Object.assign(effectiveValues, values);
    for (const f of fields) {
      if (!f?.name || !QUERY_CHOICE_TYPES.has(f.type ?? 'input')) continue;
      const { legacyClearTokens } = normalizeQueryChoiceOptions(f.options);
      const cur = effectiveValues[f.name];
      if (typeof cur === 'string' && legacyClearTokens.has(cur)) {
        effectiveValues[f.name] = '';
      }
    }
    if (p.target) rt.setFilter(p.target as string, effectiveValues);
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
                setValues(Object.fromEntries(fields.filter((f) => f?.name && f.initialValue !== undefined).map((f) => [f.name!, ''])));
                if (!rt.isDesign && p.target) rt.setFilter(p.target as string, {});
              }}
              className={cx('h-8 px-3 rounded-md border text-[13px] whitespace-nowrap cursor-pointer', BTN_CLS.default)}
            >
              {(p.resetText as string) || tr('重置', 'Reset')}
            </button>
            <button
              type="button"
              onClick={search}
              className={cx('h-8 px-3.5 rounded-md border text-[13px] inline-flex items-center gap-1 whitespace-nowrap cursor-pointer', BTN_CLS.primary)}
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span>{(p.searchText as string) || tr('查询', 'Search')}</span>
            </button>
            {fields.length > cols && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="h-8 px-1 text-[12px] text-blue-600 inline-flex items-center gap-0.5 whitespace-nowrap cursor-pointer"
              >
                {expanded ? tr('收起', 'Collapse') : tr('展开', 'Expand')}
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>
      </FormCtx.Provider>
      {fields.length === 0 && <DropHint rt={rt} label={tr('在右侧属性面板配置查询条件', 'Configure query fields in the right inspector')} />}
    </div>
  );
};

const SearchInput: React.FC<CompProps> = ({ p, root, rt }) => {
  const { tr } = useI18n();
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
          placeholder={p.placeholder ?? tr('搜索...', 'Search...')}
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
  const { isEn } = useI18n();
  const preview = useContext(PreviewDataContext);
  const uiState = useUIStackState();
  const tables = useMaterialTables();
  const schema = useMemo(() => tables.find((t) => t.id === tableId), [tables, tableId]);
  const stored = usePageStore((s) => (tableId ? s.tableRows[tableId] : undefined));
  const getRows = usePageStore((s) => s.getRows);
  // Drafts use actual snapshot rows (empty for new tables), never seed global mock data.
  return useMemo(() => {
    const raw = preview ? (tableId ? preview.rows[tableId] ?? [] : []) : (tableId ? stored ?? getRows(tableId) : []);
    return applyUIStackRows(raw, schema, uiState, isEn);
  }, [preview, tableId, stored, getRows, schema, uiState, isEn]);
}

const SAMPLE_FIELD_EN_TITLES: Record<string, string> = {
  id: 'ID',
  parentId: 'Parent ID',
  name: 'Name',
  status: 'Status',
  remark: 'Notes',
  quantity: 'Quantity',
  updated: 'Updated',
  enabled: 'Enabled',
};

function renderCell(v: unknown, render?: string, dataIndex?: string, isDark = false): React.ReactNode {
  if (v === undefined || v === null || v === '') return <span className={isDark ? 'text-zinc-600' : 'text-slate-300'}>—</span>;
  const s = String(v);
  if (render === 'tag' || (!render && dataIndex && /status/i.test(dataIndex))) return <TagPill color={STATUS_COLOR[s] ?? 'blue'} round dot>{s}</TagPill>;
  if (render === 'money' || (!render && dataIndex && /(price|amount|tax)/i.test(dataIndex) && !/rate/i.test(dataIndex))) {
    const num = Number(v);
    if (!Number.isNaN(num)) {
      const digits = dataIndex && /no_tax/i.test(dataIndex) ? 6 : 2;
      return <span className={cx('tabular-nums font-semibold', isDark ? 'text-zinc-100' : 'text-slate-900')}>¥ {num.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}</span>;
    }
  }
  if (render === 'link') return <span className={cx('hover:underline cursor-pointer font-medium', isDark ? 'text-blue-400' : 'text-blue-600')}>{s}</span>;
  if (typeof v === 'boolean') return v ? trStatic('是', 'Yes') : trStatic('否', 'No');
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
  const { isEn, tr, td } = useI18n();
  const tables = useMaterialTables();
  const preview = useContext(PreviewDataContext);
  const tableId = typeof p.table === 'string' && p.table !== '' ? p.table : undefined;
  const table = tables.find(t => t.id === tableId);
  const boundRows = useTableRows(table?.id);
  const { row: sourceRow, tableId: sourceTableId, fkSourceTableId } = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const [sampleRows, setSampleRows] = useState(SAMPLE_ROWS);
  const [sortCol, setSortCol] = useState<TableSort | null>(null);
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const [pageSize, setPageSize] = usePageSize(Math.max(1, Number(p.pageSize ?? 10)));
  const columns: TableColumn[] =
    Array.isArray(p.columns) && p.columns.length
      ? p.columns
      : !table && isEn
      ? defaultTableColumns(table).map((c) => ({
          ...c,
          title: SAMPLE_FIELD_EN_TITLES[c.dataIndex] ?? c.title,
        }))
      : defaultTableColumns(table);
  const uiState = useUIStackState();
  const records = useMemo(
    () => (table ? boundRows : applyUIStackRows(sampleRows, undefined, uiState, isEn)),
    [table, boundRows, sampleRows, uiState, isEn],
  );
  const query = rt.filters[node.pfId];
  const model = useMemo(() => {
    try {
      if (tableId && !table) throw new Error(tr(`未找到绑定的物理表 ${tableId}`, `Bound physical table "${tableId}" not found`));
      const errors = [...tableConfigErrors(p, table), ...sourceForeignKeyErrors(p, tables)];
      if (errors.length) throw new Error(errors[0]);
      const visibleRecords = typeof p.sourceForeignKey === 'string' ? rowsForSource(records, p.sourceForeignKey, tableId, {row:sourceRow,tableId:sourceTableId}, tables) : records;
      return prepareTableRows(visibleRecords, p, query ?? {}, sortCol);
    } catch (error) {
      return { error: error instanceof Error ? error.message : tr('表格配置无效', 'Invalid table configuration') };
    }
  }, [p, tableId, table, records, query, sortCol, sourceRow, sourceTableId, tables, tr]);
  const autoSelectFirst = Boolean(p.autoSelectFirst);
  const activeRowId = tableId ? rt.activeRows?.[tableId] : undefined;
  const validRootRows = 'error' in model ? [] : model.roots.map((b) => b.row);
  useAutoSelectFirstRow({
    rt,
    tableId,
    sourceTableId: fkSourceTableId,
    sourceRowId: sourceRow?.id,
    visibleRows: validRootRows,
    autoSelectFirst,
    runtimeQuery: query,
  });
  if ('error' in model) {
    return <div {...rootWith(root, { className: 'rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800' })} role="alert">{td(model.error)}</div>;
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
    const sampleTitle = SAMPLE_FIELDS.find(c => c.dataIndex === field)?.title;
    const title = table
      ? (col && columnLabel(col))
      : isEn
      ? (SAMPLE_FIELD_EN_TITLES[field] ?? sampleTitle)
      : sampleTitle;
    return columns.find(c => c.dataIndex === field)?.title ?? title ?? field;
  };
  const sel = rt.selections[node.pfId] ?? [];
  const actions = (Array.isArray(p.rowActions) ? p.rowActions : []) as {
    label: string;
    danger?: boolean;
    disabledWhenField?: string;
    disabledWhenValue?: string;
    disabledReason?: string;
    hiddenWhenField?: string;
    hiddenWhenValue?: string;
    onClick?: PropValue;
  }[];
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
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const insideCard = useInsideCardBody();
  const borderCellCls = isBordered
    ? isDark
      ? 'border-r border-zinc-800 last:border-r-0'
      : 'border-r border-slate-200 last:border-r-0'
    : '';

  const totalColumns = columns.length + Number(expandable) + Number(Boolean(p.selectable)) + Number(showIndex) + Number(actions.length > 0);
  const toggleRow = (id: string) => setToggled(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const tableRegionLabel = String(
    p.title || table?.cnName || table?.tableName || tr('数据表格', 'Data table'),
  );

  return (
    <div {...rootWith(root, { className: 'space-y-2.5 min-w-0' })}>
      {rt.isDesign && (
        <p className={cx('text-[10px]', isDark ? 'text-zinc-500' : 'text-slate-400')}>
          {table ? tr('原型预览数据 · 保存在工程内', 'Prototype preview data · Stored in project') : tr('未绑定数据表 · 示例预览', 'Unbound table · Sample preview')}
        </p>
      )}
      {mergeWarning && <p role="alert" className={cx('text-xs', isDark ? 'text-amber-300' : 'text-amber-700')}>{td(mergeWarning)}</p>}
      {!table && rt.isDesign && (
        <div className={cx('text-[11px] rounded px-2 py-1 border', isDark ? 'text-amber-200 bg-amber-500/15 border-amber-400/25' : 'text-amber-700 bg-amber-50 border-amber-200')}>
          {tr('未绑定物理表：在右侧属性中选择「绑定物理表」，列和数据会自动生成', 'Unbound table: select a physical table in the right inspector to auto-generate columns and data')}
        </div>
      )}
      <AntdSurface><Spin spinning={Boolean(p.loading)}><div
        role="region"
        aria-label={tableRegionLabel}
        tabIndex={0}
        className={cx(
          'table-wrapper overflow-auto transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
          insideCard ? 'rounded-xl' : 'rounded-[16px]',
          isDark
            ? cx('bg-[#16181D] ring-1 ring-inset ring-white/[0.08]', !insideCard && 'shadow-[0_6px_20px_-8px_rgba(0,0,0,0.6)]')
            : cx('bg-white ring-1 ring-inset ring-slate-900/[0.06]', !insideCard && 'shadow-[0_2px_12px_-4px_rgba(15,23,42,0.04)]'),
        )}
        style={{ maxHeight: p.scrollY }}
      >
        {p.title && (
          <div className={cx('px-4 py-2.5 border-b text-[13.5px] font-semibold tracking-tight', isDark ? 'bg-white/[0.02] border-white/[0.07] text-zinc-100' : 'bg-slate-50/50 border-slate-200/75 text-slate-900')}>
            {p.title}
          </div>
        )}
        <table className="w-full text-[13px] border-collapse" style={{ minWidth: p.scrollX }}>
          {showHeader && (
            <thead className={p.sticky ? cx('sticky top-0 z-10', isDark ? 'bg-[#1A1D24]' : 'bg-slate-50') : undefined}>
              <tr className={cx('text-[11.5px] tracking-tight', isDark ? 'bg-white/[0.03] text-zinc-400' : 'bg-slate-50/75 text-slate-500')}>
                {expandable && <th aria-label={tr('展开行', 'Expand row')} className={cx('w-8 border-b', isDark ? 'border-white/[0.07]' : 'border-slate-200/75', cellPadCls, borderCellCls)} />}
                {p.selectable && (
                  <th className={cx('w-10 text-left border-b', isDark ? 'border-white/[0.07]' : 'border-slate-200/75', cellPadCls, borderCellCls)}>
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
                  <th className={cx('w-12 text-left font-semibold border-b whitespace-nowrap', isDark ? 'border-white/[0.07]' : 'border-slate-200/75', cellPadCls, borderCellCls)}>
                    {tr('序号', '#')}
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
                        'font-semibold border-b whitespace-nowrap',
                        isDark ? 'border-white/[0.07]' : 'border-slate-200/75',
                        cellPadCls,
                        alignCls,
                        borderCellCls,
                        c.sortable && (isDark ? 'cursor-pointer hover:bg-white/[0.05] select-none' : 'cursor-pointer hover:bg-slate-100/80 select-none')
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.title}
                        {c.sortable && <ArrowUpDown className={cx('w-3 h-3', isDark ? 'text-zinc-500' : 'text-slate-400')} />}
                      </span>
                    </th>
                  );
                })}
                {actions.length > 0 && (
                  <th className={cx('text-left font-semibold border-b border-l whitespace-nowrap sticky right-0 z-10 shadow-[-4px_0_8px_-4px_rgba(15,23,42,0.06)]', isDark ? 'border-white/[0.07] bg-[#1A1D24]' : 'border-slate-200/75 bg-slate-50', cellPadCls)}>
                    {tr('操作', 'Actions')}
                  </th>
                )}
              </tr>
            </thead>
          )}
          <tbody>
            {visible.map(({ row: r, depth, ordinal, hasChildren }, i) => {
              const isRowActive = Boolean(tableId && activeRowId === r.id);
              return (
              <React.Fragment key={r.id}>
              <tr data-row-id={r.id}
                data-active-row={isRowActive ? '1' : undefined}
                onClick={() => {
                  if (!rt.isDesign && autoSelectFirst && tableId) rt.setActiveRow?.(tableId, r.id, fkSourceTableId);
                  void rt.run(p.onRowClick as PropValue, childRowScope(scope, r, tableId, fkSourceTableId));
                }}
                className={cx(
                  'group/row border-b last:border-0 transition-colors',
                  isDark ? 'border-white/[0.05] hover:bg-white/[0.04]' : 'border-slate-100 hover:bg-blue-50/35',
                  (autoSelectFirst || Boolean(p.onRowClick)) && !rt.isDesign && 'cursor-pointer',
                  isRowActive
                    ? isDark
                      ? 'bg-blue-500/14 shadow-[inset_3px_0_0_0_var(--pf-primary,#60a5fa)]'
                      : 'bg-blue-50/75 shadow-[inset_3px_0_0_0_var(--pf-primary,#2563eb)]'
                    : isStriped && i % 2 === 1 && (isDark ? 'bg-white/[0.015]' : 'bg-slate-50/60')
                )}
              >
                {expandable && <td className={cx('w-8 text-center', cellPadCls, borderCellCls)}>
                  {(isDetail || hasChildren) && <button type="button" aria-expanded={isOpen(r.id)} aria-label={tr(`${isOpen(r.id) ? '收起' : '展开'}记录 ${r.id}`, `${isOpen(r.id) ? 'Collapse' : 'Expand'} record ${r.id}`)}
                    disabled={model.forcedOpen.has(r.id)} onClick={e => { if (!rt.isDesign) e.stopPropagation(); toggleRow(r.id); }}
                    className={cx('inline-flex items-center justify-center rounded border p-0.5', isDark ? 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-blue-400' : 'border-slate-300 bg-white text-slate-600 hover:border-blue-400')}>
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
                  <td className={cx('tabular-nums', isDark ? 'text-zinc-500' : 'text-slate-400', cellPadCls, borderCellCls)}>
                    {ordinal}
                  </td>
                )}
                {columns.map((c, columnIndex) => {
                  const span = spanAt(i, columnIndex);
                  if (span === null) return null;
                  const alignCls = c.align === 'center' ? 'text-center' : c.align === 'right' ? 'text-right' : 'text-left';
                  const content = renderCell(r[c.dataIndex], c.render, c.dataIndex, isDark);
                  return (
                    <td key={c.dataIndex} {...span} data-field={c.dataIndex}
                      style={depth && columnIndex === 0 ? { paddingInlineStart: 12 + depth * 18 } : undefined}
                      className={cx('whitespace-nowrap max-w-[240px] truncate', isDark ? 'text-zinc-200' : 'text-slate-800', cellPadCls, alignCls, borderCellCls)}>
                      {c.editor ? <EditableCell key={c.editor} column={c} value={r[c.dataIndex]} readOnly={rt.isDesign || Boolean(preview) || uiState !== 'normal'}
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
                      'whitespace-nowrap border-l sticky right-0 z-10 shadow-[-4px_0_8px_-4px_rgba(15,23,42,0.06)]',
                      isDark
                        ? cx('border-white/[0.06]', isRowActive ? 'bg-[#182235]' : 'bg-[#16181D] group-hover/row:bg-[#1C2028]')
                        : cx('border-slate-100', isRowActive ? 'bg-[#eff6ff]' : isStriped && i % 2 === 1 ? 'bg-[#f8fafc] group-hover/row:bg-[#f5f9ff]' : 'bg-white group-hover/row:bg-[#f5f9ff]'),
                      cellPadCls
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      {actions.map((a, ai) => {
                        if (!rt.isDesign && matchesWhenCondition(r, a.hiddenWhenField, a.hiddenWhenValue)) return null;
                        const actDisabled = !rt.isDesign && matchesWhenCondition(r, a.disabledWhenField, a.disabledWhenValue);
                        return (
                          <button
                            key={ai}
                            type="button"
                            disabled={actDisabled}
                            title={actDisabled && a.disabledReason ? a.disabledReason : undefined}
                            onClick={(e) => {
                              if (rt.isDesign || actDisabled) return;
                              e.stopPropagation();
                              rt.run(a.onClick, childRowScope(scope, r, tableId, fkSourceTableId));
                            }}
                            className={cx(
                              'rounded-md px-2 py-0.5 text-[12px] font-medium transition',
                              actDisabled
                                ? isDark
                                  ? 'text-zinc-600 opacity-50 cursor-not-allowed'
                                  : 'text-slate-400 opacity-50 cursor-not-allowed'
                                : cx(
                                    'cursor-pointer',
                                    a.danger
                                      ? isDark
                                        ? 'text-rose-400 hover:bg-rose-500/15'
                                        : 'text-rose-600 hover:bg-rose-50'
                                      : isDark
                                      ? 'text-blue-400 hover:bg-blue-500/15'
                                      : 'text-blue-600 hover:bg-blue-50',
                                  )
                            )}
                          >
                            {a.label}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                )}
              </tr>
              {isDetail && isOpen(r.id) && <tr><td colSpan={totalColumns} className={cx('border-b px-5 py-3', isDark ? 'border-white/[0.07] bg-white/[0.02]' : 'border-slate-200 bg-slate-50')}>
                <dl className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-6 gap-y-2">{detailFields.map(field => (
                  <div key={field}><dt className={cx('text-xs', isDark ? 'text-zinc-400' : 'text-slate-500')}>{fieldTitle(field)}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{renderCell(r[field], undefined, field, isDark)}</dd></div>
                ))}</dl>
              </td></tr>}
              </React.Fragment>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={totalColumns} className={cx('py-10 text-center text-[13px]', isDark ? 'text-zinc-500' : 'text-slate-400')}>
                  <Inbox className={cx('w-8 h-8 mx-auto mb-1', isDark ? 'text-zinc-600' : 'text-slate-300')} />
                  {(p.emptyText as string) || tr('暂无数据', 'No data')}
                </td>
              </tr>
            )}
          </tbody>
          {Boolean(p.showSummary) && pageRows.length > 0 && (
            <tfoot>
              <tr className={cx('border-t font-semibold text-[12px]', isDark ? 'bg-amber-500/10 border-white/[0.08] text-zinc-100' : 'bg-amber-50/45 border-slate-200 text-slate-800')}>
                {expandable && <td className={cx(cellPadCls, borderCellCls)} />}
                {p.selectable && <td className={cx(cellPadCls, borderCellCls)} />}
                {showIndex && (
                  <td className={cx('font-bold whitespace-nowrap', isDark ? 'text-amber-300' : 'text-amber-800', cellPadCls, borderCellCls)}>
                    {tr('合计', 'Total')}
                  </td>
                )}
                {columns.map((c, idx) => {
                  if (idx === 0 && !showIndex) {
                    return (
                      <td key={c.dataIndex} className={cx('font-bold', isDark ? 'text-amber-300' : 'text-amber-800', cellPadCls, borderCellCls)}>
                        {(p.summaryText as string) || tr('合计', 'Total')}
                      </td>
                    );
                  }
                  if (idx === 0 && p.summaryText) {
                    return (
                      <td key={c.dataIndex} className={cx(isDark ? 'text-zinc-300' : 'text-slate-700', cellPadCls, borderCellCls)}>
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
                      <td key={c.dataIndex} className={cx('tabular-nums', isDark ? 'text-zinc-100' : 'text-slate-900', cellPadCls, borderCellCls)}>
                        {renderCell(sum, c.render, c.dataIndex, isDark)}
                      </td>
                    );
                  }
                  return <td key={c.dataIndex} className={cx(isDark ? 'text-zinc-600' : 'text-slate-400', cellPadCls, borderCellCls)}>—</td>;
                })}
                {actions.length > 0 && <td className={cx('border-l sticky right-0', isDark ? 'border-white/[0.08] bg-[#1E1C16]' : 'border-slate-200 bg-amber-50/45', cellPadCls)} />}
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

const Descriptions: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const tables = useMaterialTables();
  const table = tables.find((t) => t.id === p.table);
  const rows = useTableRows(table?.id);
  const hasFieldItems = Array.isArray(p.items) && p.items.some((it: unknown) => Boolean(it && typeof it === 'object' && 'field' in it && (it as { field?: unknown }).field));
  const navSource = useSourceRow(scope, rt.pageId, Boolean(table || hasFieldItems), table?.id);
  const scopedRow =
    navSource.row && (!table || !navSource.tableId || navSource.tableId === table.id)
      ? navSource.row
      : undefined;
  const row = (scopedRow ?? (!navSource.tableId ? rows[0] : undefined)) as Row | undefined;
  const items: { label: string; value: React.ReactNode }[] =
    Array.isArray(p.items) && p.items.length
      ? (p.items as { label: string; field?: string; value?: string }[]).map((it) => ({ label: it.label, value: it.field ? renderCell(row?.[it.field], undefined, it.field, isDark) : it.value ?? '—' }))
      : table
      ? table.columns.filter((c) => !c.isPrimaryKey).slice(0, 10).map((c) => ({ label: columnLabel(c), value: renderCell(row?.[c.name], undefined, c.name, isDark) }))
      : [
          { label: tr('字段一', 'Field 1'), value: tr('示例值', 'Sample') },
          { label: tr('字段二', 'Field 2'), value: tr('示例值', 'Sample') },
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
    <div {...rootWith(root, { className: 'space-y-2.5' })}>
      {(p.title || p.extra) && (
        <div className="flex items-center justify-between">
          {p.title && <div className={cx('text-[14px] font-semibold', isDark ? 'text-zinc-100' : 'text-slate-900')}>{p.title}</div>}
          {p.extra && <div className={cx('text-[12px]', isDark ? 'text-zinc-400' : 'text-slate-500')}>{p.extra}</div>}
        </div>
      )}
      {isBordered ? (
        <div
          className={cx(
            'grid border-t border-l rounded-xl overflow-hidden',
            isDark ? 'border-white/[0.08] bg-[#16181D]' : 'border-slate-200/85 bg-white',
          )}
          style={{ gridTemplateColumns: `repeat(${column}, minmax(0, 1fr))` }}
        >
          {items.map((it, i) => (
            <div
              key={i}
              className={cx(
                'min-w-0 border-r border-b',
                isDark ? 'border-white/[0.08]' : 'border-slate-200/85',
                isVert ? 'flex flex-col' : 'flex items-stretch'
              )}
            >
              <div
                className={cx(
                  'font-medium shrink-0',
                  isDark ? 'bg-white/[0.03] text-zinc-400' : 'bg-slate-50/80 text-slate-500',
                  cellPad,
                  isVert
                    ? cx('border-b', isDark ? 'border-white/[0.08]' : 'border-slate-200/85')
                    : cx('border-r flex items-center', isDark ? 'border-white/[0.08]' : 'border-slate-200/85'),
                )}
                style={!isVert ? { width: customLabelW ?? 116 } : undefined}
              >
                <span className="truncate">{it.label}</span>
              </div>
              <div className={cx('flex-1 min-w-0 flex items-center truncate', isDark ? 'text-zinc-100' : 'text-slate-800', cellPad)}>
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
                className={cx('shrink-0 mr-1.5', isDark ? 'text-zinc-400' : 'text-slate-500')}
                style={customLabelW ? { width: customLabelW } : undefined}
              >
                {it.label}
                {showColon ? tr('：', ': ') : ''}
              </span>
              <span className={cx('truncate', isDark ? 'text-zinc-100' : 'text-slate-800')}>{it.value}</span>
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
const STAT_COLOR_DARK: Record<string, string> = {
  default: 'text-zinc-50',
  blue: 'text-blue-400',
  green: 'text-emerald-400',
  orange: 'text-amber-400',
  red: 'text-rose-400',
};
const Statistic: React.FC<CompProps> = ({ node, p, root }) => {
  const sparkGradId = useId();
  const canvasTheme = useCanvasTheme();
  const insideCard = useInsideCardBody();
  const isDark = canvasTheme?.effectiveMode === 'dark';
  const tone = (p.tone as 'card' | 'inverted' | 'subtle') || 'card';
  const effectiveDark = isDark || tone === 'inverted';
  const rows = useTableRows((p.table as string) || undefined);
  const hasTable = typeof p.table === 'string' && p.table.trim().length > 0;
  const isMissingValue =
    !hasTable &&
    (p.value === undefined || p.value === null || String(p.value).trim() === '');
  const rawVal = hasTable ? rows.length : p.value;
  const formattedVal =
    !isMissingValue && typeof p.precision === 'number' && !Number.isNaN(Number(rawVal))
      ? Number(rawVal).toFixed(p.precision)
      : rawVal;
  const trendText = typeof p.trendText === 'string' ? p.trendText.trim() : '';
  const statusBadge = typeof p.statusBadge === 'string' ? p.statusBadge.trim() : '';
  const isDown = p.trend === 'down' || trendText.startsWith('-');
  const showSparkline = Boolean(p.sparkline);
  const splitDec = p.splitDecimal !== false;
  const IconComp = typeof p.icon === 'string' && p.icon.trim() ? resolveSemanticIcon(p.icon) : null;
  const radiusStyle = canvasTheme?.rawTokens ? { borderRadius: canvasTheme.resolved.cardRadiusPx } : undefined;
  const strokeColor = isDown
    ? effectiveDark
      ? '#fb7185'
      : '#e11d48'
    : tone === 'inverted'
    ? '#34d399'
    : canvasTheme?.accentColor || canvasTheme?.resolved.primaryColor || '#2563eb';
  const linePath = isDown
    ? 'M2 6 C18 8, 28 14, 44 19 S62 24, 78 26'
    : 'M2 25 C18 23, 30 18, 46 11 S62 5, 78 3';
  const areaPath = `${linePath} L78 30 L2 30 Z`;

  const surfaceCls =
    tone === 'inverted'
      ? 'pf-mobile-wallet-mesh text-white ring-1 ring-inset ring-white/12 shadow-[0_14px_32px_-10px_rgba(0,0,0,0.45)]'
      : effectiveDark
      ? tone === 'subtle'
        ? 'bg-white/[0.04] ring-1 ring-inset ring-white/[0.06] text-zinc-100'
        : 'bg-[#16181D] ring-1 ring-inset ring-white/[0.08] shadow-[0_6px_22px_-8px_rgba(0,0,0,0.6)] text-zinc-100'
      : tone === 'subtle'
      ? 'bg-slate-50/90 ring-1 ring-inset ring-slate-900/[0.05] text-slate-900'
      : insideCard && node.props.bordered === undefined
      ? 'bg-slate-50/65 ring-1 ring-inset ring-slate-900/[0.045] text-slate-900'
      : cx(
          'bg-white text-slate-900 shadow-[0_2px_14px_-4px_rgba(15,23,42,0.05)]',
          p.bordered === false ? '' : 'ring-1 ring-inset ring-slate-900/[0.06]',
        );

  return (
    <div
      data-stat-tone={tone}
      {...rootWith(root, {
        className: cx('rounded-[18px] px-4 py-3.5 flex items-end justify-between gap-3 min-w-0', surfaceCls),
        style: tone === 'inverted' ? { ...radiusStyle, colorScheme: 'dark' } : radiusStyle,
      })}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className={cx('text-[12.5px] font-medium truncate', effectiveDark ? 'text-zinc-400' : 'text-slate-500')}>
            {p.title}
          </div>
          {IconComp && (
            <span
              className={cx(
                'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                effectiveDark ? 'bg-white/[0.08] text-zinc-200' : 'bg-slate-900/[0.045] text-slate-700',
              )}
            >
              <IconComp className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5 flex-wrap">
          {!isMissingValue && p.prefix && (
            <span className={cx('text-[15px] font-semibold', effectiveDark ? 'text-zinc-400' : 'text-slate-500')}>
              {p.prefix}
            </span>
          )}
          {isMissingValue ? (
            <span
              data-missing-value="1"
              className={cx('text-[28px] font-bold tracking-tight tabular-nums opacity-45 leading-none', effectiveDark ? 'text-zinc-400' : 'text-slate-400')}
            >
              —
            </span>
          ) : (
            <SplitMetricText
              value={formattedVal as string | number}
              splitDecimal={splitDec}
              className={cx(
                'text-[28px] font-bold tracking-tight leading-none',
                effectiveDark
                  ? STAT_COLOR_DARK[(p.valueColor as string) || 'default'] ?? STAT_COLOR_DARK.default
                  : STAT_COLOR[(p.valueColor as string) || 'default'] ?? STAT_COLOR.default,
              )}
            />
          )}
          {!isMissingValue && p.suffix && (
            <span className={cx('text-[12.5px] font-medium', effectiveDark ? 'text-zinc-400' : 'text-slate-500')}>
              {p.suffix}
            </span>
          )}
          {p.trend === 'up' && !trendText && <TrendingUp className="w-4 h-4 text-emerald-500 ml-1" />}
          {p.trend === 'down' && !trendText && <TrendingDown className="w-4 h-4 text-rose-500 ml-1" />}
          {trendText && (
            <span
              className={cx(
                'ml-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                isDown
                  ? effectiveDark
                    ? 'bg-rose-500/20 text-rose-300'
                    : 'bg-rose-500/12 text-rose-600'
                  : effectiveDark
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-emerald-500/12 text-emerald-600',
              )}
            >
              {isDown ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
              <span>{trendText}</span>
            </span>
          )}
          {statusBadge && (
            <span
              className={cx(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium',
                effectiveDark ? 'bg-white/[0.08] text-zinc-300' : 'bg-slate-900/[0.05] text-slate-600',
              )}
            >
              {statusBadge}
            </span>
          )}
        </div>
      </div>
      {showSparkline && (
        <svg viewBox="0 0 80 32" className="w-[80px] h-[32px] shrink-0 overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={sparkGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity={effectiveDark ? 0.32 : 0.22} />
              <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${sparkGradId})`} />
          <path
            d={linePath}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      )}
    </div>
  );
};

const Tag: React.FC<CompProps> = ({ p, text, root, rt, scope }) => {
  const { tr } = useI18n();
  const [closed, setClosed] = useState(false);
  if (closed && !rt.isDesign) return null;
  return <span {...rootWith(root, { className: 'inline-block' })}>
    <TagPill color={p.color} bordered={p.bordered !== false} round={p.round} closable={p.closable}
      onClose={() => { if (!rt.isDesign) { setClosed(true); rt.run(p.onClose, scope); } }}>
      {text || tr('标签', 'Tag')}
    </TagPill>
  </span>;
};

const Timeline: React.FC<CompProps> = ({ p, root }) => {
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const rawItems = (Array.isArray(p.items) ? p.items : []) as { title: string; time?: string; status?: string }[];
  const items = p.reverse ? [...rawItems].reverse() : rawItems;
  const dot: Record<string, string> = {
    done: 'bg-blue-600',
    current: isDark ? 'bg-[#16181D] border-2 border-blue-400' : 'bg-white border-2 border-blue-600',
    wait: isDark ? 'bg-zinc-700' : 'bg-slate-300',
    error: 'bg-rose-500',
  };
  const isRight = p.mode === 'right';
  return (
    <div {...rootWith(root, { className: 'space-y-0' })}>
      {items.map((it, i) => (
        <div key={i} className={cx('relative pb-4 last:pb-0', isRight ? 'pr-6 text-right' : 'pl-6')}>
          {i < items.length - 1 && (
            <span className={cx('absolute top-3 bottom-0 w-px', isDark ? 'bg-zinc-800' : 'bg-slate-200', isRight ? 'right-[5px]' : 'left-[5px]')} />
          )}
          <span
            className={cx(
              'absolute top-1 w-3 h-3 rounded-full',
              isRight ? 'right-0' : 'left-0',
              dot[it.status ?? 'done'] ?? dot.done
            )}
          />
          <div className={cx('text-[13px]', isDark ? 'text-zinc-200' : 'text-slate-800')}>{it.title}</div>
          {it.time && <div className={cx('text-[12px]', isDark ? 'text-zinc-500' : 'text-slate-400')}>{it.time}</div>}
        </div>
      ))}
    </div>
  );
};

const TEXT_CLS: Record<string, string> = { default: 'text-slate-700', secondary: 'text-slate-500', success: 'text-emerald-600', warning: 'text-amber-600', danger: 'text-rose-600' };
const TEXT_CLS_DARK: Record<string, string> = { default: 'text-zinc-200', secondary: 'text-zinc-400', success: 'text-emerald-400', warning: 'text-amber-400', danger: 'text-rose-400' };
const TEXT_SIZE: Record<string, string> = { xs: 'text-[11px]', sm: 'text-[13px]', base: 'text-[14px]', lg: 'text-[16px]' };
const Text: React.FC<CompProps> = ({ p, text, root }) => {
  const { tr } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const palette = isDark ? TEXT_CLS_DARK : TEXT_CLS;
  return (
    <p
      {...rootWith(root, {
        className: cx(
          'leading-relaxed inline-flex items-center gap-1',
          TEXT_SIZE[(p.size as string) || 'sm'] ?? TEXT_SIZE.sm,
          palette[p.type as string] ?? palette.default,
          p.strong && 'font-semibold',
          p.italic && 'italic',
          p.underline && 'underline',
          p.delete && 'line-through',
          p.code && (isDark ? 'font-mono bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded text-[12px]' : 'font-mono bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[12px]')
        ),
        style: p.layoutFrame && textFrameStyle(p.layoutFrame),
      })}
    >
      <span>{text || tr('文本', 'Text')}</span>
      {p.copyable && <CopyIcon className="w-3 h-3 text-blue-500 cursor-pointer shrink-0" />}
    </p>
  );
};

const Title: React.FC<CompProps> = ({ p, text, root }) => {
  const { tr } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const size = ['', 'text-[22px]', 'text-[18px]', 'text-[15px]', 'text-[14px]', 'text-[13px]'][Number(p.level ?? 3)] ?? 'text-[15px]';
  const alignCls = p.align === 'center' ? 'text-center' : p.align === 'right' ? 'text-right' : 'text-left';
  return (
    <div
      {...rootWith(root, {
        className: cx(
          'font-semibold tracking-tight',
          isDark ? 'text-zinc-100' : 'text-slate-900',
          size,
          alignCls,
          p.mark && 'pl-2.5 border-l-4 border-blue-600'
        ),
      })}
    >
      {text || tr('标题', 'Title')}
    </div>
  );
};

const Empty: React.FC<CompProps> = ({ p, root }) => {
  const { tr } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const iconSz = p.size === 'small' ? 'w-7 h-7' : p.size === 'large' ? 'w-14 h-14' : 'w-10 h-10';
  return (
    <div {...rootWith(root, { className: cx('text-center text-[13px]', isDark ? 'text-zinc-500' : 'text-slate-400', p.size === 'small' ? 'py-4' : 'py-8') })}>
      <Inbox className={cx('mx-auto mb-2', isDark ? 'text-zinc-600' : 'text-slate-300', iconSz)} />
      {p.description ?? tr('暂无数据', 'No data')}
    </div>
  );
};

const Form: React.FC<CompProps> = ({ node, p, children, root, rt, scope }) => {
  const { locale, tr } = useI18n();
  const preview = useContext(PreviewDataContext);
  const tables = useMaterialTables();
  const boundTable = tables.find((t) => t.id === p.table);
  const instanceId = resolveFormInstanceKey(node.pfId, p.table, scope);
  const values = rt.formValues[instanceId] ?? {};
  const errors = rt.formErrors[instanceId] ?? {};
  const cols = Math.max(1, Math.min(4, Number(p.cols ?? 2)));
  const row = (scope.row ?? scope.params?.row) as Row | undefined;
  // Edit mode: prefill from the canonical unprojected row so UI Stack `edge` stress text never enters form state
  const editingSource = Boolean(row && p.table && (scope.tableId ?? scope.params?.tableId) === p.table);
  useEffect(() => {
    if (!rt.isDesign && row && editingSource && Object.keys(values).length === 0) {
      const canonical = resolveCanonicalRow(p.table, row, preview?.rows) ?? row;
      const { id: _id, ...rest } = canonical;
      rt.setFormValues(instanceId, rest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, row?.id, scope.tableId, scope.params?.tableId, p.table]);
  const ctx: FormCtxValue = {
    formId: node.pfId,
    formKey: instanceId,
    tableId: typeof p.table === 'string' && p.table ? p.table : undefined,
    editingSource,
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
    setValue: (n, v) => rt.setFormValue(instanceId, n, v),
  };
  const explicitFields = (Array.isArray(p.fields) ? p.fields : []) as FieldDef[];
  const fieldDefs: FieldDef[] =
    explicitFields.length > 0
      ? explicitFields
      : children.length === 0 && boundTable
      ? defaultDisplayColumns(boundTable, 8).map((col) => {
          const type = fieldTypeOf(col);
          return {
            name: col.name,
            label: columnLabel(col, locale),
            type,
            options: type === 'select' ? resolveFieldSelectOptions(col, locale, boundTable, tables, currentProjectDataContext(tables)) : undefined,
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
        {children.length === 0 && fieldDefs.length === 0 && <DropHint rt={rt} label={tr('拖入输入框、下拉框等字段，或绑定物理表生成', 'Drop inputs/selects or bind a physical table')} />}
      </FormCtx.Provider>
    </div>
  );
};

const Toolbar: React.FC<CompProps> = ({ p, children, root, rt }) => {
  const { tr } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const bgCls =
    p.bg === 'gray'
      ? isDark
        ? 'bg-white/[0.04] px-3.5 py-2 rounded-xl ring-1 ring-inset ring-white/[0.07]'
        : 'bg-slate-50/90 px-3.5 py-2 rounded-xl ring-1 ring-inset ring-slate-900/[0.06]'
      : p.bg === 'blue'
      ? isDark
        ? 'bg-blue-500/12 px-3.5 py-2 rounded-xl ring-1 ring-inset ring-blue-400/25'
        : 'bg-blue-50/55 px-3.5 py-2 rounded-xl ring-1 ring-inset ring-blue-200/70'
      : '';
  return (
    <div
      {...rootWith(root, {
        className: cx(
          'flex flex-wrap items-center gap-2 min-h-8 min-w-0',
          p.align === 'right' && 'justify-end',
          p.align === 'center' && 'justify-center',
          (p.align === 'between' || p.title) && 'justify-between',
          bgCls,
          p.bordered && (isDark ? 'border-b border-white/[0.07] pb-2.5' : 'border-b border-slate-200/80 pb-2.5')
        ),
      })}
    >
      <InlineToolbarCtx.Provider value={true}>
        {(p.title || p.subTitle) && (
          <div className="flex items-baseline gap-2 mr-2 min-w-0">
            {p.title && <span className={cx('text-[14px] font-semibold truncate', isDark ? 'text-zinc-100' : 'text-slate-900')}>{p.title}</span>}
            {p.subTitle && <span className={cx('text-[12px] truncate', isDark ? 'text-zinc-400' : 'text-slate-500')}>{p.subTitle}</span>}
          </div>
        )}
        {children.length ? (p.title || p.subTitle ? <div className="flex flex-wrap items-center gap-2">{children}</div> : children) : <DropHint rt={rt} label={tr('拖入按钮或筛选控件', 'Drop buttons or inline filters')} />}
      </InlineToolbarCtx.Provider>
    </div>
  );
};

const ALERT_CLS: Record<string, { light: string; dark: string; Icon: React.ComponentType<{ className?: string }> }> = {
  info: { light: 'bg-blue-50/85 border-blue-200/80 text-blue-900', dark: 'bg-blue-500/15 border-blue-400/25 text-blue-200', Icon: Info },
  success: { light: 'bg-emerald-50/85 border-emerald-200/80 text-emerald-900', dark: 'bg-emerald-500/15 border-emerald-400/25 text-emerald-200', Icon: CheckCircle2 },
  warning: { light: 'bg-amber-50/85 border-amber-200/80 text-amber-900', dark: 'bg-amber-500/15 border-amber-400/25 text-amber-200', Icon: AlertTriangle },
  error: { light: 'bg-rose-50/85 border-rose-200/80 text-rose-900', dark: 'bg-rose-500/15 border-rose-400/25 text-rose-200', Icon: XCircle },
};
const Alert: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const [closed, setClosed] = useState(false);
  if (closed && !rt.isDesign) return null;
  const a = ALERT_CLS[p.type as string] ?? ALERT_CLS.info;
  const showIcon = p.showIcon !== false;
  return (
    <div
      {...rootWith(root, {
        className: cx(
          'flex items-start gap-2.5 px-3.5 py-2.5 border text-[13px]',
          p.banner ? 'rounded-none border-x-0' : 'rounded-xl',
          isDark ? a.dark : a.light,
        ),
      })}
    >
      {showIcon && <a.Icon className="w-4 h-4 shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className="font-medium">{p.message}</div>
        {p.description && <div className="opacity-80 mt-0.5 text-[12px]">{p.description}</div>}
      </div>
      {p.closable && <button type="button" aria-label={tr('关闭提示', 'Close alert')} onClick={() => { if (!rt.isDesign) { setClosed(true); rt.run(p.onClose, scope); } }} className="opacity-60 hover:opacity-100 shrink-0 mt-0.5"><X className="w-3.5 h-3.5" /></button>}
    </div>
  );
};

const Result: React.FC<CompProps> = ({ p, children, root }) => {
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const Icon = p.status === 'error' ? XCircle : p.status === 'warning' ? AlertTriangle : p.status === 'info' ? Info : CheckCircle2;
  const color = p.status === 'error' ? 'text-rose-500' : p.status === 'warning' ? 'text-amber-500' : p.status === 'info' ? 'text-blue-500' : 'text-emerald-500';
  return (
    <div {...rootWith(root, { className: 'py-8 text-center space-y-2' })}>
      <Icon className={cx('w-12 h-12 mx-auto', color)} />
      <div className={cx('text-[18px] font-semibold', isDark ? 'text-zinc-100' : 'text-slate-900')}>{p.title}</div>
      {p.subTitle && <div className={cx('text-[13px]', isDark ? 'text-zinc-400' : 'text-slate-500')}>{p.subTitle}</div>}
      {children.length > 0 && <div className="flex justify-center gap-2 pt-2">{children}</div>}
    </div>
  );
};

/** Modal / Drawer: live = stacked overlay in the preview frame; staticOverlay = framed editor in design mode. */
const OverlayFrame: React.FC<CompProps & { kind: 'modal' | 'drawer' }> = ({ kind, p, children, root, rt, scope, live, staticOverlay }) => {
  const { tr } = useI18n();
  const canvasTheme = useCanvasTheme();
  const overlayPosition = useContext(DesktopOverlayPositionContext);
  const isDark = canvasTheme?.effectiveMode === 'dark';
  const isCapture = useContext(CaptureMode);
  const motionMode = canvasTheme?.motion ?? 'smooth';
  const overlayExit = useDesktopOverlayExitAnimation(live, staticOverlay, isCapture, motionMode);
  const width = Number(p.width ?? (kind === 'modal' ? 640 : 520));
  const placement = p.placement === 'left' ? 'left' : 'right';
  const close = () => rt.run({ $kind: 'actions', calls: [{ name: 'closeOverlay', args: [] }] }, scope);
  const showFooter = p.footer === undefined ? kind === 'modal' : p.footer !== false;
  const body = (
    <>
      <div className={cx('flex items-center justify-between px-5 h-13 border-b shrink-0', isDark ? 'border-white/[0.08]' : 'border-slate-100')}>
        <span className={cx('text-[15px] font-semibold tracking-tight', isDark ? 'text-zinc-100' : 'text-slate-900')}>{p.title ?? (kind === 'modal' ? tr('弹框', 'Modal') : tr('抽屉', 'Drawer'))}</span>
        <button
          type="button"
          aria-label={tr('关闭弹层', 'Close overlay')}
          onClick={close}
          className={cx('p-1.5 rounded-lg transition cursor-pointer', isDark ? 'hover:bg-white/10 text-zinc-400' : 'hover:bg-slate-100 text-slate-500')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 grid grid-cols-12 gap-x-4 gap-y-3.5 items-start content-start">
        {children.length ? children : <div className="col-span-12"><DropHint rt={rt} label={kind === 'modal' ? tr('拖入组件设计弹框内容', 'Drop components to design modal content') : tr('拖入组件设计抽屉内容', 'Drop components to design drawer content')} /></div>}
      </div>
      {showFooter && (
        <div className={cx('flex items-center justify-end gap-2 px-5 h-14 border-t shrink-0', isDark ? 'border-white/[0.08]' : 'border-slate-100')}>
          <button
            type="button"
            onClick={close}
            className={cx(
              'h-8 px-3.5 rounded-lg border text-[13px] cursor-pointer transition',
              isDark
                ? 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border-zinc-700'
                : BTN_CLS.default,
            )}
          >
            {(p.cancelText as string) || tr('取消', 'Cancel')}
          </button>
          <button type="button" onClick={() => (p.onOk ? rt.run(p.onOk as PropValue, scope) : close())} className={cx('h-8 px-4 rounded-lg border text-[13px] font-medium cursor-pointer transition', BTN_CLS.primary)}>
            {(p.okText as string) || tr('确定', 'OK')}
          </button>
        </div>
      )}
    </>
  );

  if (staticOverlay) {
    return (
      <div className="min-h-full p-8 bg-slate-500/25 flex items-start" style={{ justifyContent: kind === 'drawer' ? (placement === 'left' ? 'flex-start' : 'flex-end') : 'center' }}>
        <div
          {...rootWith(root, {
            className: cx(
              'shadow-2xl flex flex-col',
              isDark ? 'bg-[#16181D] text-zinc-100 ring-1 ring-inset ring-white/10' : 'bg-white text-slate-900',
              kind === 'modal' ? 'rounded-[20px]' : 'rounded-xl min-h-[560px]',
            ),
            style: { width, maxWidth: '100%' },
          })}
        >
          {body}
        </div>
      </div>
    );
  }
  if (!overlayExit.mounted) return null;
  const z = 40 + (scope.overlayIndex ?? 0) * 2;
  return (
    <div
      data-overlay-kind={kind}
      data-motion={motionMode}
      data-closing={overlayExit.closing ? '1' : undefined}
      {...(overlayExit.inertProps as unknown as React.HTMLAttributes<HTMLDivElement>)}
      className={overlayPosition === 'fixed' ? 'fixed inset-0 flex' : 'absolute inset-0 flex'}
      style={{
        zIndex: z,
        justifyContent: kind === 'drawer' ? (placement === 'left' ? 'flex-start' : 'flex-end') : 'center',
        alignItems: kind === 'modal' ? (p.centered !== false ? 'center' : 'flex-start') : 'stretch',
      }}
    >
      <div
        ref={overlayExit.backdropRef}
        data-closing={overlayExit.closing ? '1' : undefined}
        className="pf-modal-backdrop absolute inset-0 bg-slate-950/48 backdrop-blur-[2px]"
        onClick={close}
      />
      <div
        ref={overlayExit.panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={String(p.title ?? (kind === 'modal' ? tr('弹框', 'Modal') : tr('抽屉', 'Drawer')))}
        data-closing={overlayExit.closing ? '1' : undefined}
        data-placement={kind === 'drawer' ? placement : undefined}
        {...rootWith(root, {
          className: cx(
            'pf-paper relative shadow-2xl flex flex-col',
            isDark
              ? 'bg-[#16181D] text-zinc-100 ring-1 ring-inset ring-white/[0.1]'
              : 'bg-white text-slate-900 ring-1 ring-inset ring-slate-900/[0.06]',
            kind === 'modal'
              ? cx('rounded-[20px] max-h-[calc(100%-3rem)] pf-modal-panel', p.centered === false && 'mt-10')
              : 'h-full pf-drawer-panel',
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
  AxureCanvas, AxureWidget, PositionedGroup: AxureCanvas, PanelState: AxureCanvas, DynamicPanel, OutlineTree, TreeItem, StaticTable,
  ...Object.fromEntries(Object.keys(AXURE_LEAF_KINDS).map(name => [name, AxureWidget])),
  ...FIGMA_COMPONENTS,
  Freeform: FreeformMaterial,
  ...ANTD_COMPONENTS,
  ...MODERN_DESKTOP_COMPONENTS,
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
