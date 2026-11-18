import React from 'react';
import type { RequirementAudit } from '../proto/database/requirementReview';

export function RequirementAuditPanel({ report }: { report?: RequirementAudit }) {
  if (!report?.lines.length) return null;
  return <details className="mt-2 rounded-lg border border-slate-200 px-3 py-2 text-xs">
    <summary className="cursor-pointer font-medium">
      需求原文与数据库约束 · {report.lines.length} 项
      {report.uncovered > 0 && <span className="ml-2 text-amber-700">{report.uncovered} 项未覆盖</span>}
      {report.conflicts.length > 0 && <span className="ml-2 text-red-700">{report.conflicts.length} 项案例冲突，须修正后应用</span>}
    </summary>
    <div className="mt-2 max-h-64 space-y-2 overflow-auto whitespace-pre-wrap break-words">
      {report.conflicts.map((conflict,i)=><p key={i} className="text-red-700">{conflict}</p>)}
      {report.lines.map((line,i)=><p key={i}>{line}</p>)}
    </div>
  </details>;
}
