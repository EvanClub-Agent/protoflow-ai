import React, { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Sparkles, Layers } from 'lucide-react';
import type { ActionCall, ActionChain, PropValue, ProtoNode } from '../types';
import { genPfId } from '../dsl/parser';
import { ACTIONS, ACTION_MAP } from '../runtime/actions';

export interface OverlayDescriptor {
  pfId: string;
  overlayId: string;
  title: string;
  type: string;
  node: ProtoNode;
}

function overlayTargets(action: string, overlays: OverlayDescriptor[]) {
  const types = ACTION_MAP[action]?.args.find(arg => arg.kind === 'overlay')?.refTypes;
  return overlays.filter(overlay => types?.includes(overlay.type) && typeof overlay.node.props.id === 'string');
}

interface ActionChainEditorProps {
  label: string;
  eventName: string;
  value: ActionChain | undefined;
  overlays: OverlayDescriptor[];
  onChange: (next: ActionChain | undefined) => void;
  onCreateOverlayAndBind?: (type: 'Modal' | 'Drawer', id: string, title: string, next: ActionChain) => void;
}

export const ActionChainEditor: React.FC<ActionChainEditorProps> = ({
  label,
  eventName,
  value,
  overlays,
  onChange,
  onCreateOverlayAndBind,
}) => {
  const calls: ActionCall[] = value?.calls ?? [];
  const [newFn, setNewFn] = useState<string>('openModal');

  const updateCalls = (nextCalls: ActionCall[]) => {
    if (nextCalls.length === 0) {
      onChange(undefined);
    } else {
      onChange({ $kind: 'actions', calls: nextCalls });
    }
  };

  const getDefaultArgs = (name: string): PropValue[] => {
    if (name === 'openModal' || name === 'openDrawer') {
      const first = overlayTargets(name, overlays)[0];
      return first ? [first.overlayId] : [];
    }
    if (name === 'toast') return ['操作成功'];
    if (name === 'confirm') return ['确定执行此操作吗？'];
    if (name === 'submitForm' || name === 'resetForm') return ['form-main'];
    if (name === 'refresh') return ['tbl-main'];
    if (name === 'returnSelection') return ['tbl-po-picker', 'name'];
    if (name === 'updateRow') return [{ status: '已通过' }];
    return [];
  };

  const handleAddCall = (name: string) => {
    updateCalls([...calls, { name, args: getDefaultArgs(name) }]);
  };

  const handleQuickCreateOverlay = (idx: number, type: 'Modal' | 'Drawer') => {
    const prefix = type === 'Modal' ? 'm' : 'd';
    const id = genPfId(prefix);
    const title = type === 'Modal' ? '新建子页面弹框' : '新建子页面抽屉';
    const next = calls.map((c, i) => i === idx ? { ...c, args: [id, ...c.args.slice(1)] } : c);
    onCreateOverlayAndBind?.(type, id, title, { $kind: 'actions', calls: next });
  };

  const updateArg = (idx: number, argIndex: number, raw: string) => {
    const next = calls.map((c, i) => {
      if (i !== idx) return c;
      const args = [...c.args];
      if (c.name === 'updateRow') {
        try {
          args[0] = JSON.parse(raw) as PropValue;
        } catch {
          args[0] = { status: raw };
        }
      } else {
        args[argIndex] = raw;
      }
      return { ...c, args };
    });
    updateCalls(next);
  };

  const moveCall = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= calls.length) return;
    const next = [...calls];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    updateCalls(next);
  };

  const removeCall = (idx: number) => {
    updateCalls(calls.filter((_, i) => i !== idx));
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 space-y-2 min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-xs font-semibold text-slate-800 truncate">{label}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-600 shrink-0">
            {eventName}
          </span>
        </div>
        <span className="text-[10px] text-slate-500 shrink-0">{calls.length} 步</span>
      </div>

      {/* Action Steps List */}
      {calls.length === 0 ? (
        <div className="text-[11px] text-slate-400 py-2 px-2.5 rounded-lg border border-dashed border-slate-200 bg-white text-center">
          暂未绑定动作，点击下方添加弹框、抽屉、提交或提示动作
        </div>
      ) : (
        <div className="space-y-1.5 min-w-0">
          {calls.map((call, idx) => {
            const meta = ACTION_MAP[call.name];
            const isModalAction = call.name === 'openModal';
            const isDrawerAction = call.name === 'openDrawer';
            const firstArgStr =
              typeof call.args[0] === 'string'
                ? call.args[0]
                : call.args[0] !== undefined
                ? JSON.stringify(call.args[0])
                : '';

            return (
              <div
                key={`${call.name}-${idx}`}
                className="p-2 rounded-lg bg-white border border-slate-200 space-y-1.5 shadow-2xs min-w-0 overflow-hidden"
              >
                <div className="flex items-center justify-between gap-1.5 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="w-4 h-4 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <select
                      value={call.name}
                      onChange={(e) => {
                        const fnName = e.target.value;
                        const next = calls.map((c, i) =>
                          i === idx ? { name: fnName, args: getDefaultArgs(fnName) } : c
                        );
                        updateCalls(next);
                      }}
                      className="flex-1 min-w-0 truncate text-xs font-medium text-slate-800 bg-slate-50/70 border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-600"
                    >
                      {ACTIONS.map((a) => (
                        <option key={a.name} value={a.name}>
                          {a.title} ({a.name})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveCall(idx, -1)}
                      disabled={idx === 0}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                      title="上移步骤"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveCall(idx, 1)}
                      disabled={idx === calls.length - 1}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                      title="下移步骤"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCall(idx)}
                      className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                      title="移除此动作"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Argument Editor */}
                {isModalAction || isDrawerAction ? (
                  <div className="space-y-1.5 min-w-0">
                    <select
                      value={firstArgStr}
                      onChange={(e) => updateArg(idx, 0, e.target.value)}
                      className="w-full min-w-0 truncate text-xs px-2 py-1 rounded border border-slate-200 bg-slate-50 text-slate-800 font-mono focus:outline-none focus:border-blue-600"
                    >
                      <option value="">
                        -- 选择目标{isModalAction ? '弹框' : '抽屉'} --
                      </option>
                      {overlayTargets(call.name, overlays)
                        .map((o) => (
                          <option key={o.overlayId} value={o.overlayId}>
                            #{o.overlayId} · {o.title}
                          </option>
                        ))}
                    </select>
                    {onCreateOverlayAndBind && (
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-[10px] font-mono text-slate-400 truncate">
                          {firstArgStr ? `绑定: #${firstArgStr}` : '未选择弹层'}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleQuickCreateOverlay(idx, isModalAction ? 'Modal' : 'Drawer')
                          }
                          className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
                          title="自动新建对应的弹层子页面并绑定到此按钮"
                        >
                          <Layers className="w-3 h-3" />
                          <span>+新建{isModalAction ? '弹框' : '抽屉'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : call.name === 'closeOverlay' || call.name === 'deleteRow' ? (
                  <div className="text-[10px] text-slate-400 font-mono pl-5 truncate">
                    {call.name}() — {meta?.description}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <input
                      type="text"
                      value={firstArgStr}
                      onChange={(e) => updateArg(idx, 0, e.target.value)}
                      placeholder={meta?.args[0]?.label ?? '输入参数...'}
                      className="w-full min-w-0 text-xs px-2 py-1 rounded border border-slate-200 bg-slate-50 text-slate-800 font-mono focus:outline-none focus:border-blue-600"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Step Row */}
      <div className="flex items-center gap-1.5 pt-1 min-w-0">
        <select
          value={newFn}
          onChange={(e) => setNewFn(e.target.value)}
          className="flex-1 min-w-0 truncate text-xs px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-blue-600"
        >
          {ACTIONS.map((a) => (
            <option key={a.name} value={a.name}>
              + {a.title} ({a.name})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => handleAddCall(newFn)}
          className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1 shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>添加动作</span>
        </button>
      </div>

      {/* Quick Presets */}
      <div className="flex items-center gap-1 flex-wrap pt-0.5">
        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
          <Sparkles className="w-2.5 h-2.5" /> 快捷动作：
        </span>
        <button
          type="button"
          onClick={() => handleAddCall('openModal')}
          className="text-[10px] px-1.5 py-0.5 rounded bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 cursor-pointer"
        >
          打开弹框
        </button>
        <button
          type="button"
          onClick={() => handleAddCall('openDrawer')}
          className="text-[10px] px-1.5 py-0.5 rounded bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 cursor-pointer"
        >
          打开抽屉
        </button>
        <button
          type="button"
          onClick={() => handleAddCall('returnSelection')}
          className="text-[10px] px-1.5 py-0.5 rounded bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 cursor-pointer"
        >
          选单回填
        </button>
        <button
          type="button"
          onClick={() => handleAddCall('closeOverlay')}
          className="text-[10px] px-1.5 py-0.5 rounded bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 cursor-pointer"
        >
          关闭弹层
        </button>
      </div>
    </div>
  );
};
