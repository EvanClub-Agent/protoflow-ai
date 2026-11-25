import React from 'react';
import { Layers } from 'lucide-react';
import { useProtoStore, type UIStateMatrix } from '../../store/useProtoStore';
import { UI_STACK_STATES } from '../runtime/uiStackLens';
import { useI18n } from '../../i18n';

const LABELS: Record<UIStateMatrix, { zh: string; en: string; tipZh: string; tipEn: string }> = {
  normal: {
    zh: '理想',
    en: 'Ideal',
    tipZh: '正常演示数据态（Ideal State）',
    tipEn: 'Normal sample/bound data (Ideal State)',
  },
  empty: {
    zh: '空白',
    en: 'Empty',
    tipZh: '零数据冷启动态（不删除真实表数据，仅投影空集验收引导）',
    tipEn: 'Zero-data cold-start lens without deleting table rows',
  },
  loading: {
    zh: '加载',
    en: 'Loading',
    tipZh: '异步骨架屏与按钮防连点加载态',
    tipEn: 'Skeleton & async button loading state',
  },
  edge: {
    zh: '极值',
    en: 'Edge',
    tipZh: '超长文本、高精度大额数值与万级记录压力边界态',
    tipEn: 'Ultra-long strings & extreme numeric precision stress lens',
  },
  error: {
    zh: '异常',
    en: 'Error',
    tipZh: '接口报错重试 / 403 无权限异常兜底态',
    tipEn: 'Network failure / 403 permission error fallback state',
  },
};

export const UIStackSwitcher: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { isEn, tr } = useI18n();
  const uiState = useProtoStore((s) => s.uiState);
  const setUIState = useProtoStore((s) => s.setUIState);

  return (
    <div
      role="group"
      aria-label={tr('UI 五态模拟器', 'UI Stack 5-State Simulator')}
      data-testid="ui-stack-switcher"
      className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100/90 p-0.5 shrink-0"
    >
      {!compact && (
        <span
          className="hidden 2xl:inline-flex items-center gap-1 px-1.5 text-[10.5px] font-medium text-slate-500"
          title={tr('UI Stack 五态滤镜（底层物理表数据零修改）', 'UI Stack 5-State Lens (zero mutation to tableRows)')}
        >
          <Layers className="w-3 h-3" />
        </span>
      )}
      {UI_STACK_STATES.map((st) => {
        const active = uiState === st;
        const meta = LABELS[st];
        return (
          <button
            key={st}
            type="button"
            data-ui-state-btn={st}
            aria-pressed={active}
            title={isEn ? meta.tipEn : meta.tipZh}
            onClick={() => setUIState(st)}
            className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition cursor-pointer ${
              active
                ? st === 'error'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : st === 'edge'
                  ? 'bg-amber-500 text-white shadow-2xs'
                  : st === 'normal'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'bg-blue-600 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {isEn ? meta.en : meta.zh}
          </button>
        );
      })}
    </div>
  );
};
