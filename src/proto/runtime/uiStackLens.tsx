import React, { createContext, useContext } from 'react';
import { AlertTriangle, Inbox, Lock, RefreshCw } from 'lucide-react';
import { useProtoStore, type DBColumnSchema, type DBTableSchema, type UIStateMatrix } from '../../store/useProtoStore';
import { sqlEnumValues } from '../database/enumContract';
import type { Row } from './mock';
import { PreviewDataContext } from './PreviewData';
import { useI18n } from '../../i18n';

export const UI_STACK_STATES: readonly UIStateMatrix[] = ['normal', 'empty', 'loading', 'edge', 'error'];

export const UIStackOverrideContext = createContext<UIStateMatrix | null>(null);

export function useUIStackState(): UIStateMatrix {
  const explicit = useContext(UIStackOverrideContext);
  const preview = useContext(PreviewDataContext);
  const storeState = useProtoStore((s) => s.uiState);
  if (explicit) return explicit;
  // Staged AI preview validation runs against exact synthetic rows unless explicitly overridden
  if (preview) return 'normal';
  return storeState ?? 'normal';
}

const DATE_COL_RE = /^(?:DATE|TIMESTAMP)/i;
const INT_COL_RE = /^(?:(?:TINY|SMALL|MEDIUM|BIG)?INT|INTEGER)\b/i;
const DEC_COL_RE = /^(?:DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL)\b/i;
const CHAR_COL_RE = /^(?:(?:VAR)?CHAR|TEXT)\b/i;

function isProtectedKeyOrEnum(col: DBColumnSchema): boolean {
  if (col.isPrimaryKey || col.isForeignKey || Boolean(col.references)) return true;
  if (sqlEnumValues(col) !== null) return true;
  if (/status|stage|state|type|mode|role/i.test(col.name)) return true;
  return false;
}

function stressColumnValue(col: DBColumnSchema, original: unknown, idx: number, isEn: boolean): unknown {
  if (isProtectedKeyOrEnum(col)) return original;
  const dt = col.dataType || '';
  if (DATE_COL_RE.test(dt) || /date|time|at$/i.test(col.name)) {
    return typeof original === 'string' && original ? original : '2026-12-31 23:59:59';
  }
  if (DEC_COL_RE.test(dt) || /amount|price|total|cost|fee|tax|balance/i.test(col.name)) {
    return idx === 0 ? 98765432.123456 : 0.000001;
  }
  if (INT_COL_RE.test(dt)) {
    return idx === 0 ? 999999 : 0;
  }
  if (CHAR_COL_RE.test(dt) || typeof original === 'string') {
    const base = original != null && String(original).trim() ? String(original) : col.comment || col.name;
    return isEn
      ? `[EDGE-STRESS] Global Multi-Entity Cross-Border Framework Supplement #${idx + 1} — ${base} (Overflow & Ellipsis Verification)`
      : `【极值长文本压测】跨国集团华东大区多币种长周期供应链框架补充协议第${idx + 1}批次·${base}（窄列折行与截断边界验证）`;
  }
  return original;
}

/**
 * Pure, non-mutating row lens for the 5-state UI Stack simulator.
 * Never mutates `usePageStore.tableRows`.
 */
export function applyUIStackRows(
  rows: Row[],
  tableSchema: DBTableSchema | undefined,
  uiState: UIStateMatrix,
  isEn = false,
): Row[] {
  if (uiState === 'empty') return [];
  if (uiState !== 'edge') return rows;
  if (!rows.length) return rows;

  return rows.map((row, idx) => {
    const clone: Row = { ...row };
    if (tableSchema) {
      for (const col of tableSchema.columns) {
        if (Object.prototype.hasOwnProperty.call(clone, col.name)) {
          clone[col.name] = stressColumnValue(col, clone[col.name], idx, isEn);
        }
      }
    } else {
      for (const [k, v] of Object.entries(clone)) {
        if (k === 'id' || /status|stage|date/i.test(k)) continue;
        if (typeof v === 'string') {
          clone[k] = isEn
            ? `[EDGE] Ultra-Long Enterprise Record Title & Boundary Overflow Check — ${v}`
            : `【极值压测】超长业务单据名称与跨端窄屏防溢出折行边界检查——${v}`;
        } else if (typeof v === 'number') {
          clone[k] = 98765432.88;
        }
      }
    }
    return clone;
  });
}

export const DATA_LOADING_SKELETON_TYPES = new Set([
  'Table',
  'CardGrid',
  'Repeater',
  'Kanban',
  'Calendar',
  'Descriptions',
  'Statistic',
  'MFeedList',
  'MTaskList',
  'MCardGrid',
  'MRepeater',
  'MKanban',
  'MCalendar',
  'MListGroup',
  'MStatCard',
]);

export const DATA_ERROR_VIEW_TYPES = new Set([
  'Table',
  'CardGrid',
  'Repeater',
  'Kanban',
  'Calendar',
  'MFeedList',
  'MTaskList',
  'MCardGrid',
  'MRepeater',
  'MKanban',
  'MCalendar',
]);

export const UIStackLoadingPlaceholder: React.FC<{ mobile?: boolean; compact?: boolean }> = ({ mobile, compact }) => {
  if (compact) {
    return (
      <div
        data-ui-stack="loading"
        className={`animate-pulse p-4 space-y-2.5 ${
          mobile ? 'rounded-[22px] bg-slate-200/50 dark:bg-zinc-800/60' : 'rounded-xl border border-slate-200 bg-white'
        }`}
      >
        <div className="h-3 w-24 rounded bg-slate-200 dark:bg-zinc-700" />
        <div className="h-6 w-32 rounded bg-slate-200 dark:bg-zinc-700" />
      </div>
    );
  }
  return (
    <div
      data-ui-stack="loading"
      className={`animate-pulse p-4 space-y-3 ${
        mobile ? 'rounded-[22px] bg-white/90 dark:bg-zinc-900' : 'rounded-xl border border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="h-3.5 w-36 rounded bg-slate-200 dark:bg-zinc-700" />
        <div className="h-6 w-20 rounded-full bg-slate-200 dark:bg-zinc-700" />
      </div>
      <div className="space-y-2 pt-1">
        <div className="h-9 w-full rounded-lg bg-slate-100 dark:bg-zinc-800" />
        <div className="h-9 w-full rounded-lg bg-slate-100 dark:bg-zinc-800" />
        <div className="h-9 w-4/5 rounded-lg bg-slate-100 dark:bg-zinc-800" />
      </div>
    </div>
  );
};

export const UIStackComponentErrorCard: React.FC<{
  mobile?: boolean;
  title?: string;
  onRetry?: () => void;
}> = ({ mobile, title, onRetry }) => {
  const { tr } = useI18n();
  return (
    <div
      data-ui-stack="error"
      role="alert"
      className={
        mobile
          ? 'rounded-[22px] border border-rose-200/80 bg-rose-50/90 dark:bg-rose-950/30 dark:border-rose-500/30 p-5 text-center space-y-2.5'
          : 'rounded-xl border border-rose-200 bg-rose-50/60 p-6 text-center space-y-2.5'
      }
    >
      <AlertTriangle className="w-6 h-6 mx-auto text-rose-500" aria-hidden="true" />
      <div className="text-[13px] font-semibold text-rose-900 dark:text-rose-200">
        {title || tr('数据加载异常 (503 Service Unavailable)', 'Data Load Failed (503)')}
      </div>
      <div className="text-xs text-rose-700/80 dark:text-rose-300/80">
        {tr('上游服务响应超时或网络中断，请检查连接后重试', 'Upstream request timed out or network disconnected. Retry to recover.')}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" />
          <span>{tr('重试恢复', 'Retry')}</span>
        </button>
      )}
    </div>
  );
};

export const UIStackPageErrorResult: React.FC<{
  mode: 'result_403' | 'result_500';
  title?: string;
  description?: string;
  mobile?: boolean;
  onRecover: () => void;
}> = ({ mode, title, description, mobile, onRecover }) => {
  const { tr } = useI18n();
  const is403 = mode === 'result_403';
  return (
    <div
      data-ui-stack={mode}
      className={`col-span-12 flex flex-col items-center justify-center text-center ${
        mobile ? 'py-14 px-5 rounded-[22px] bg-white/90 dark:bg-zinc-900' : 'py-16 px-6 rounded-xl border border-slate-200 bg-white'
      }`}
    >
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 ${is403 ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'}`}>
        {is403 ? <Lock className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
      </div>
      <div className="text-base font-bold text-slate-900 dark:text-zinc-100">
        {title || (is403 ? tr('403 暂无当前模块访问权限', '403 Permission Denied') : tr('500 服务暂时不可用', '500 Service Unavailable'))}
      </div>
      <p className="mt-1.5 max-w-md text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
        {description ||
          (is403
            ? tr('当前账号尚未开通该业务域的数据查看或审批授权，请联系系统管理员申请角色权限。', 'Your account lacks access to this business module. Request role authorization from an administrator.')
            : tr('核心业务接口响应异常，系统已自动保留本地草稿，请稍后点击下方按钮重新加载。', 'Backend service encountered an error. Local draft state is preserved; retry below.'))}
      </p>
      <button
        type="button"
        onClick={onRecover}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>{tr('恢复理想态预览', 'Restore Ideal State')}</span>
      </button>
    </div>
  );
};

export const UIStackEmptyBannerHint: React.FC<{ emptyTitle?: string }> = ({ emptyTitle }) => {
  const { tr } = useI18n();
  if (!emptyTitle) return null;
  return (
    <div data-ui-stack="empty-hint" className="col-span-12 rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-3 flex items-center gap-2.5 text-xs text-slate-600">
      <Inbox className="w-4 h-4 text-slate-400 shrink-0" />
      <span>{emptyTitle}</span>
    </div>
  );
};
