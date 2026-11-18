/** User-facing progress text for Hermes ACP updates. Pure; no store access. */

export const THINKING_PROGRESS = '正在思考…';
export const DEFAULT_PROGRESS = 'Hermes 正在处理…';

const TOOL_LABELS: Record<string, string> = {
  get_project_brief: '读取项目摘要',
  get_project: '读取项目目录',
  get_contracts: '查阅组件契约',
  get_page_tsx: '读取页面源码',
  inspect_page: '检查页面结构',
  get_db_table: '读取数据表',
  get_table_rows: '读取演示数据',
  get_sticky_notes: '读取需求便签',
  get_project_notes: '读取项目笔记',
  get_implementation_guide: '查阅实现指南',
  search_history: '检索对话历史',
  review_db_requirements: '核对需求与表约束',
  apply_tsx_patch: '暂存页面源码',
  edit_page_block: '暂存页面区块',
  upsert_db_table: '暂存数据表',
  upsert_db_column: '暂存数据字段',
  add_preview_scenario: '暂存演示数据',
  upsert_sticky_contract: '暂存需求便签',
  upsert_project_agreement: '暂存项目约定',
  remove_project_agreement: '移除项目约定',
  set_project_plan: '暂存项目方案',
  revise_project_page: '暂存单页调整',
  upsert_folder: '暂存目录',
  move_sitemap_item: '调整菜单位置',
  ask_questions: '整理待确认问题',
  run_closed_loop_audit: '提交巡检结果',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '准备中',
  in_progress: '执行中',
  completed: '已完成',
  failed: '未成功',
};

/** Strips ACP/MCP prefixes (`mcp_protoflow_`, `mcp__protoflow__`, `protoflow_`) and any `: detail` suffix. */
export function protoflowToolName(title: string | undefined): string | null {
  if (typeof title !== 'string') return null;
  const head = title.split(':')[0].trim();
  const match = /^(?:mcp[_/.-]+protoflow[_/.-]+|protoflow[_/.-]+)(?:protoflow_)?([a-z_]+)$/i.exec(head);
  return match ? match[1].toLowerCase() : null;
}

export function toolProgressLabel(title: string | undefined, status: string | undefined): string {
  const tool = protoflowToolName(title);
  const label = (tool && TOOL_LABELS[tool]) || (title?.trim() ? title.trim() : '项目工具');
  const state = (status && STATUS_LABELS[status]) || (status?.trim() ? status : '执行中');
  return `${label} · ${state}`;
}

/** A thought chunk may only fill an idle slot; it never hides a running tool or plan step. */
export function thinkingProgress(current: string | undefined): string | null {
  if (!current || current === DEFAULT_PROGRESS || current === THINKING_PROGRESS || / · (已完成|未成功)$/.test(current)) {
    return current === THINKING_PROGRESS ? null : THINKING_PROGRESS;
  }
  return null;
}
