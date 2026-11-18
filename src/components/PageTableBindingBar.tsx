import React, { useState } from 'react';
import {
  Database,
  Plus,
  Link2,
  CheckSquare,
  Square,
  ArrowUpRight,
  Table2,
  X,
  ShieldCheck,
} from 'lucide-react';
import { useProtoStore, PageNodeId } from '../store/useProtoStore';

interface PageTableBindingBarProps {
  pageId: PageNodeId;
  pageTitle: string;
}

export const PageTableBindingBar: React.FC<PageTableBindingBarProps> = ({
  pageId,
  pageTitle,
}) => {
  const {
    dbTables,
    toggleTableBindingForMenu,
    createNewTable,
    setSelectedTableId,
    setViewMode,
    setLeftSidebarTab,
    closedLoopIssues,
    setAuditScopeFilter,
  } = useProtoStore();

  const moduleOpenIssuesCount = closedLoopIssues.filter(
    (i) =>
      i.status === 'open' &&
      (i.pageId === pageId ||
        (pageId === 'acceptance-new' && (i.id === 'loop-gap-3' || i.id === 'loop-gap-5')))
  ).length;

  const [showSelectDropdown, setShowSelectDropdown] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [newTableName, setNewTableName] = useState('');
  const [newCnName, setNewCnName] = useState('');
  const [newDomain, setNewDomain] = useState('');

  const domains = [...new Set(dbTables.map(t => t.domain))];
  const boundTables = dbTables.filter((t) =>
    t.sharedByMenus.some((m) => m.pageId === pageId)
  );

  const handleCreateTableInMenu = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTableName.trim() || !newCnName.trim() || !newDomain.trim()) return;
    createNewTable(newTableName.trim(), newCnName.trim(), newDomain.trim(), {
      pageId,
      menuTitle: pageTitle,
    });
    setNewTableName('');
    setNewCnName('');
    setShowCreateModal(false);
  };

  return (
    <div className="inline-flex items-center gap-1 select-none relative shrink-0">
      {/* Bound Table Pills */}
      <div className="flex items-center gap-1 max-w-[260px] overflow-x-auto no-scrollbar">
        {boundTables.map((tbl) => {
          const menuRel = tbl.sharedByMenus.find((m) => m.pageId === pageId);
          const accessLabel = menuRel?.accessMode.split(' ')[0] || '读写';
          return (
            <div key={tbl.id} className="relative group flex items-center shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSelectedTableId(tbl.id);
                  setLeftSidebarTab('tables');
                  setViewMode('db_designer');
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-50 hover:bg-blue-50/70 border border-slate-200/90 hover:border-blue-300 text-[11px] cursor-pointer transition shrink-0"
              >
                <Table2 className="w-3 h-3 text-blue-600 shrink-0" />
                <span className="font-mono font-medium text-slate-700">{tbl.tableName}</span>
                <ArrowUpRight className="w-3 h-3 text-slate-400 group-hover:text-blue-600" />
              </button>
              <div
                role="tooltip"
                className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
              >
                <span className="relative z-10 text-xs font-medium tracking-tight">
                  {tbl.cnName} ({accessLabel}) · 点击跳转表设计
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* IDEA-style Icon Actions: Link Table | New Table | Closed-Loop Check */}
      <div className="flex items-center gap-0.5 shrink-0">
        <div className="relative group flex items-center">
          <button
            type="button"
            aria-label={`关联选表 (${dbTables.length})`}
            onClick={() => setShowSelectDropdown((v) => !v)}
            className={`relative w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer transition ${
              showSelectDropdown
                ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-200'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            {boundTables.length === 0 && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
          </button>
          <div
            role="tooltip"
            className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
          >
            <span className="relative z-10 text-xs font-medium tracking-tight">
              关联数据表 ({boundTables.length}/{dbTables.length})
            </span>
          </div>
        </div>

        {showSelectDropdown && (
          <div className="absolute right-0 top-9 w-80 rounded-xl bg-white border border-slate-200 shadow-xl p-3 z-50 space-y-2 whitespace-normal">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-semibold text-slate-900">
                勾选当前页面关联的数据表
              </span>
              <button
                type="button"
                onClick={() => setShowSelectDropdown(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
              {dbTables.map((tbl) => {
                const isBound = tbl.sharedByMenus.some((m) => m.pageId === pageId);
                return (
                  <div
                    key={tbl.id}
                    onClick={() => toggleTableBindingForMenu(tbl.id, pageId, pageTitle)}
                    className={`p-2 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition ${
                      isBound
                        ? 'bg-blue-50/60 border-blue-200'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isBound ? (
                        <CheckSquare className="w-4 h-4 text-blue-600 shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-mono font-semibold text-xs text-slate-800 truncate">
                          {tbl.tableName}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">{tbl.cnName}</div>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      {tbl.sharedByMenus.length} 处引用
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="relative group flex items-center">
          <button
            type="button"
            aria-label="新建物理表"
            onClick={() => setShowCreateModal(true)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer transition"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <div
            role="tooltip"
            className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
          >
            <span className="relative z-10 text-xs font-medium tracking-tight">
              新建物理表并绑定当前页
            </span>
          </div>
        </div>

        <div className="relative group flex items-center">
          <button
            type="button"
            aria-label={moduleOpenIssuesCount > 0 ? `闭环检查 (${moduleOpenIssuesCount})` : '已闭环'}
            onClick={() => {
              setAuditScopeFilter('current_module');
              setViewMode('closed_loop_audit');
            }}
            className="relative w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer transition"
          >
            <ShieldCheck
              className={`w-3.5 h-3.5 ${
                moduleOpenIssuesCount > 0 ? 'text-rose-500' : 'text-emerald-600'
              }`}
            />
            {moduleOpenIssuesCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-rose-500 text-white text-[9px] font-semibold flex items-center justify-center leading-none">
                {moduleOpenIssuesCount}
              </span>
            )}
          </button>
          <div
            role="tooltip"
            className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
          >
            <span className="relative z-10 text-xs font-medium tracking-tight">
              {moduleOpenIssuesCount > 0
                ? `模块闭环检查 (${moduleOpenIssuesCount} 项待处理)`
                : '模块需求闭环检查：已闭环'}
            </span>
          </div>
        </div>
      </div>

      {/* Modal: Create New Table inside Current Menu */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-semibold text-slate-900">
                  新建物理表并关联至【{pageTitle}】
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTableInMenu} className="p-4 space-y-3.5 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-[11px] leading-relaxed">
                新建的表将自动绑定到当前页面，并同步加入左侧全局数据库表目录与 ER 模型画布。
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  所属业务域 (Domain)
                </label>
                <input aria-label="所属业务域" list="table-domains-page" required maxLength={80} value={newDomain}
                  onChange={e => setNewDomain(e.target.value)} placeholder="选择现有业务域或输入名称"
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 focus:outline-none focus:border-blue-600" />
                <datalist id="table-domains-page">{domains.map(domain => <option key={domain} value={domain} />)}</datalist>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  物理表名 (Table Name)
                </label>
                <input
                  type="text"
                  required
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  placeholder="例如：t_wms_quality_sample"
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 font-mono focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  表中文注释 (Comment)
                </label>
                <input
                  type="text"
                  required
                  value={newCnName}
                  onChange={(e) => setNewCnName(e.target.value)}
                  placeholder="例如：到货质检抽样记录表"
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium cursor-pointer"
                >
                  创建并绑定
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
