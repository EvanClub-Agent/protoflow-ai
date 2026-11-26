import { tr } from '../i18n/runtime';

/** User-facing progress text for Hermes ACP updates. Pure; no store access. */

export const THINKING_PROGRESS = '正在思考…';
export const DEFAULT_PROGRESS = 'Hermes 正在处理…';

export const getThinkingProgress = () => tr(THINKING_PROGRESS, 'Thinking…');
export const getDefaultProgress = () => tr(DEFAULT_PROGRESS, 'Hermes is working…');

const TOOL_LABELS: Record<string, [string, string]> = {
  get_project_brief: ['读取项目摘要', 'Reading project brief'],
  get_project: ['读取项目目录', 'Reading project catalog'],
  get_contracts: ['查阅组件契约', 'Checking component contracts'],
  get_page_tsx: ['读取页面源码', 'Reading page source'],
  inspect_page: ['检查页面结构', 'Inspecting page structure'],
  capture_preview: ['截取页面视觉预览', 'Capturing page preview'],
  inspect_axure_project: ['盘点 RP 导入页面', 'Inspecting Axure RP pages'],
  reshape_axure_page: ['流式重塑 RP 页面', 'Reshaping Axure RP page'],
  bind_axure_table: ['绑定 RP 数据表', 'Binding Axure table'],
  optimize_axure_block: ['优化 RP 组件区块', 'Optimizing Axure block'],
  inspect_figma_project: ['盘点 Figma 画板', 'Inspecting Figma frames'],
  reshape_figma_page: ['流式重塑 Figma 画板', 'Reshaping Figma frame'],
  get_db_table: ['读取数据表', 'Reading database table'],
  get_table_rows: ['读取演示数据', 'Reading sample rows'],
  get_sticky_notes: ['读取需求便签', 'Reading sticky notes'],
  get_project_notes: ['读取项目笔记', 'Reading project notes'],
  get_implementation_guide: ['查阅实现指南', 'Reading implementation guide'],
  search_history: ['检索对话历史', 'Searching chat history'],
  review_db_requirements: ['核对需求与表约束', 'Reviewing DB constraints'],
  apply_tsx_patch: ['暂存页面源码', 'Staging page source'],
  edit_page_block: ['暂存页面区块', 'Staging page block'],
  upsert_db_table: ['暂存数据表', 'Staging database table'],
  upsert_db_column: ['暂存数据字段', 'Staging database column'],
  add_preview_scenario: ['暂存演示数据', 'Staging sample rows'],
  upsert_sticky_contract: ['暂存需求便签', 'Staging sticky note'],
  upsert_project_agreement: ['暂存项目约定', 'Staging project agreement'],
  remove_project_agreement: ['移除项目约定', 'Removing project agreement'],
  set_project_plan: ['暂存项目方案', 'Staging project plan'],
  revise_project_page: ['暂存单页调整', 'Staging page revision'],
  upsert_folder: ['暂存目录', 'Staging folder'],
  move_sitemap_item: ['调整菜单位置', 'Moving menu item'],
  ask_questions: ['整理待确认问题', 'Preparing clarifying questions'],
  run_closed_loop_audit: ['提交巡检结果', 'Submitting closed-loop audit'],
};

const STATUS_LABELS: Record<string, [string, string]> = {
  pending: ['准备中', 'Pending'],
  in_progress: ['执行中', 'Running'],
  completed: ['已完成', 'Completed'],
  failed: ['未成功', 'Failed'],
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
  const toolPair = tool ? TOOL_LABELS[tool] : undefined;
  const label = toolPair ? tr(toolPair[0], toolPair[1]) : (title?.trim() ? title.trim() : tr('项目工具', 'Project Tool'));
  const statusPair = status ? STATUS_LABELS[status] : undefined;
  const state = statusPair ? tr(statusPair[0], statusPair[1]) : (status?.trim() ? status : tr('执行中', 'Running'));
  return `${label} · ${state}`;
}

/** A thought chunk may only fill an idle slot; it never hides a running tool or plan step. */
export function thinkingProgress(current: string | undefined): string | null {
  const target = getThinkingProgress();
  if (
    !current ||
    current === DEFAULT_PROGRESS ||
    current === 'Hermes is working…' ||
    current === THINKING_PROGRESS ||
    current === 'Thinking…' ||
    / · (已完成|未成功|Completed|Failed)$/.test(current)
  ) {
    return current === target ? null : target;
  }
  return null;
}
