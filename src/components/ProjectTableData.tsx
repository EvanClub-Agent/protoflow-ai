import React from 'react';
import { Database, Sparkles, Table2 } from 'lucide-react';
import type { DBTableSchema } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';

export function ProjectTableData({ table }: { table: DBTableSchema }) {
  const rows = usePageStore((s) => s.tableRows[table.id]);

  return (
    <div className="space-y-3 text-xs" data-project-table-data={table.id}>
      <div className="flex items-start gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
        <p>
          {table.tableName} · 工程内的原型预览数据，可能包含生成的示例记录；未连接业务数据库。
        </p>
      </div>

      {rows === undefined ? (
        <div className="flex flex-col items-start gap-2.5 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4 text-slate-600">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <Table2 className="h-4 w-4 text-slate-400 shrink-0" />
            <span>尚未加载该表的预览数据。</span>
          </div>
          <button
            type="button"
            onClick={() => usePageStore.getState().getRows(table.id)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-blue-700 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5" />
            加载原型数据（可生成示例）
          </button>
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200/90 bg-white shadow-2xs">
          <table className="w-full border-collapse text-left text-[11px]">
            <thead className="bg-slate-50/90">
              <tr>
                {table.columns.map((c) => (
                  <th
                    key={c.id}
                    title={c.comment}
                    className="whitespace-nowrap border-b border-slate-200 px-2.5 py-2 font-mono font-semibold text-slate-700"
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, 50).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/70 transition">
                  {table.columns.map((c) => (
                    <td
                      key={c.id}
                      className="max-w-72 px-2.5 py-2 break-words text-slate-700"
                    >
                      {Object.prototype.hasOwnProperty.call(row, c.name) ? (
                        row[c.name] === null ? (
                          <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-400">
                            NULL
                          </span>
                        ) : typeof row[c.name] === 'object' ? (
                          JSON.stringify(row[c.name])
                        ) : (
                          String(row[c.name])
                        )
                      ) : (
                        <span className="italic text-slate-400">未提供</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td
                    colSpan={Math.max(1, table.columns.length)}
                    className="p-6 text-center text-slate-400"
                  >
                    暂无预览记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {rows && (
        <p className="flex items-center justify-between text-[11px] text-slate-400 px-0.5">
          <span>已保存 {rows.length} 条，当前展示前 50 条。</span>
          <span className="font-mono">{table.columns.length} 列</span>
        </p>
      )}
    </div>
  );
}
