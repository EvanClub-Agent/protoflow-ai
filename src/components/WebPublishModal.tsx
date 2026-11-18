import React, { useEffect, useState } from 'react';
import { OnlinePublishModal } from './OnlinePublishModal';
import {
  Globe,
  Play,
  Download,
  X,
  Lock,
  Layers,
  Pin,
  Database,
  CheckCircle2,
} from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { createWebExport } from '../services/webExport';

const OfflineWebExportModal: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const {
    isWebPublishModalOpen,
    setWebPublishModalOpen,
    setWebPlayerMode,
    currentProjectMeta,
    suppliers,
    purchaseOrderItems,
    draftAcceptanceLines,
    stickyNotes,
    dbTables,
  } = useProtoStore();

  const [includeStickyNotes, setIncludeStickyNotes] = useState(true);
  const [includeDbSchema, setIncludeDbSchema] = useState(true);
  const [enableInteractiveFlow, setEnableInteractiveFlow] = useState(true);
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [accessPassword, setAccessPassword] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedHtml, setExportedHtml] = useState(false);

  if (!isWebPublishModalOpen) return null;

  // Generate a 100% standalone, zero-dependency, interactive HTML file (like Axure "Publish -> Generate HTML Files")
  const handleExportStandaloneHtml = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const htmlContent = await createWebExport({ currentProjectMeta, suppliers, purchaseOrderItems, draftAcceptanceLines, stickyNotes, dbTables }, {
        includeStickyNotes, includeDbSchema, enableInteractiveFlow, passwordProtected, accessPassword,
      });

      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentProjectMeta.projectName}_Web交互演示页.html`;
      a.click();
      URL.revokeObjectURL(url);
      setExportedHtml(true);
      setTimeout(() => setExportedHtml(false), 3000);
    } catch (error) { setExportError(String(error)); }
    finally { setExporting(false); }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !exporting) setWebPublishModalOpen(false);
      }}
      className="fixed inset-0 bg-slate-950/35 backdrop-blur-[3px] flex items-center justify-center z-50 p-4 select-none"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Compact Modal Header */}
        <div className="px-5 py-3.5 bg-slate-50/60 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center shrink-0">
              <Globe className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <span>导出离线模板演示 HTML</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  单文件离线包
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                生成零依赖独立 HTML 文件，双击即可在浏览器中交互演示
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setWebPublishModalOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onBack}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              ← 返回在线发布与分享
            </button>
            <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-md">
              离线包仅含内置业务模板，完整画布请用在线发布
            </span>
          </div>

          {/* Publish Configuration Switches */}
          <div className="space-y-2">
            <label className="p-3 rounded-xl bg-slate-50/60 border border-slate-200 flex items-center justify-between gap-3 cursor-pointer hover:border-slate-300 transition">
              <div className="flex items-center gap-2.5 min-w-0">
                <Layers className="w-4 h-4 text-blue-600 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800">
                    启用跨模块真实数据流转与公式计算
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    支持在网页中审批供应商、转入采购明细并实时重算单价
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={enableInteractiveFlow}
                onChange={(e) => setEnableInteractiveFlow(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-blue-600 shrink-0"
              />
            </label>

            <label className="p-3 rounded-xl bg-slate-50/60 border border-slate-200 flex items-center justify-between gap-3 cursor-pointer hover:border-slate-300 transition">
              <div className="flex items-center gap-2.5 min-w-0">
                <Pin className="w-4 h-4 text-amber-600 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800">
                    附带组件级需求便签开关 (共 {stickyNotes.length} 条)
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    支持在网页顶部一键切换“纯净演示视图”与“需求评审视图”
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={includeStickyNotes}
                onChange={(e) => setIncludeStickyNotes(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-blue-600 shrink-0"
              />
            </label>

            <label className="p-3 rounded-xl bg-slate-50/60 border border-slate-200 flex items-center justify-between gap-3 cursor-pointer hover:border-slate-300 transition">
              <div className="flex items-center gap-2.5 min-w-0">
                <Database className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800">
                    附带只读数据库表结构字典 (共 {dbTables.length} 张表)
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    方便研发人员在浏览原型时直接查阅页面绑定的物理表字段
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={includeDbSchema}
                onChange={(e) => setIncludeDbSchema(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-blue-600 shrink-0"
              />
            </label>

            <div className="p-3 rounded-xl bg-slate-50/60 border border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800">设置离线 HTML 访问密码</div>
                  <div className="text-[11px] text-slate-400 truncate">
                    开启后导出的 HTML 文件将加密，需输入密码方可解密查看
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {passwordProtected && (
                  <input
                    type="password"
                    placeholder="输入访问密码"
                    value={accessPassword}
                    onChange={(e) => setAccessPassword(e.target.value)}
                    className="w-28 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 outline-none focus:border-blue-600"
                  />
                )}
                <input
                  type="checkbox"
                  checked={passwordProtected}
                  onChange={(e) => setPasswordProtected(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-blue-600"
                />
              </div>
            </div>
          </div>

          {exportError && (
            <p
              role="alert"
              className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2"
            >
              {exportError}
            </p>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 bg-slate-50/70 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              setWebPublishModalOpen(false);
              setWebPlayerMode(true);
            }}
            className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-medium flex items-center gap-1.5 cursor-pointer transition"
          >
            <Play className="w-3.5 h-3.5 text-blue-600" />
            <span>本机全屏交互预览</span>
          </button>

          <button
            type="button"
            onClick={handleExportStandaloneHtml}
            disabled={exporting}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center gap-1.5 shadow-2xs cursor-pointer transition disabled:opacity-40"
          >
            {exportedHtml ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>已生成单文件 HTML</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>导出独立单文件 HTML</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export const WebPublishModal: React.FC = () => {
  const open = useProtoStore(s => s.isWebPublishModalOpen);
  const projectId = useProtoStore(s => s.currentProjectMeta.projectId);
  const [offline, setOffline] = useState(false);
  useEffect(() => { setOffline(false); }, [open, projectId]);
  if (!open) return null;
  return offline ? <OfflineWebExportModal onBack={() => setOffline(false)} /> : <OnlinePublishModal key={projectId} onClose={() => useProtoStore.getState().setWebPublishModalOpen(false)} onOffline={() => setOffline(true)} />;
};
