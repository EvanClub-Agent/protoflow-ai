import type { DBTableSchema } from '../../store/useProtoStore';
import { parsePageSource } from '../dsl/parser';
import { getMaterialContracts } from '../registry/materialSchemas';
import { freeformInputs } from '../freeform/contract';
import { isActionChain, isNode, type ActionCall, type ProtoNode } from '../types';
import { pageContractErrors } from './pageContract';
import { extractPageActionSemantics } from './actionSemantics';
import { isChartType, prepareChartData, chartConfigErrors } from '../charts/model';

const contracts = new Map(getMaterialContracts().map(c => [c.name, c]));
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
interface NodeSummary { pfId: string; type: string; title: string; parentPfId: string | null }
interface Warning { pfId: string; code: string; message: string }

/** Read-only evidence for the model. Never executes source, generates rows or implies a runtime test. */
export function inspectPage(source: string, tables: DBTableSchema[], tableRows: Record<string, unknown>, selectedPfId?: string) {
  if (selectedPfId !== undefined && (typeof selectedPfId !== 'string' || !selectedPfId.trim())) throw new Error('selectedPfId 必须是准确的非空组件标识');
  const errors = pageContractErrors(source, tables, { tableRows });
  const parsed = parsePageSource(source, { strict: true });
  const nodes: NodeSummary[] = [];
  const interactions: { pfId: string; path: string; calls: ActionCall[] }[] = [];
  const bindings: { pfId: string; tableId: string; tableExists: boolean; hasSavedRows: boolean; savedRowCount: number | null }[] = [];
  const warnings: Warning[] = [];
  let selected: { node: NodeSummary; ancestors: NodeSummary[]; subtreePfIds: string[] } | null = null;
  const report = (node: ProtoNode, code: string, message: string) => warnings.push({ pfId: node.pfId, code, message });
  const event = (node: ProtoNode, path: string, value: unknown) => {
    if (isActionChain(value) && Array.isArray(value.calls)) interactions.push({ pfId: node.pfId, path, calls: value.calls });
  };
  const visit = (node: ProtoNode, ancestors: NodeSummary[]) => {
    const summary = { pfId: node.pfId, type: node.type, title: contracts.get(node.type)?.title ?? node.type, parentPfId: ancestors.length ? ancestors[ancestors.length - 1].pfId : null };
    nodes.push(summary);
    if (node.pfId === selectedPfId) selected = { node: summary, ancestors, subtreePfIds: [] };
    if (node.pfId === selectedPfId || ancestors.some(a => a.pfId === selectedPfId)) selected?.subtreePfIds.push(node.pfId);
    const contract = contracts.get(node.type);
    for (const spec of contract?.events ?? []) event(node, spec.name, node.props[spec.name]);
    for (const prop of contract?.props ?? []) {
      const items = node.props[prop.name];
      if (!Array.isArray(items)) continue;
      for (const field of prop.itemFields ?? []) {
        if (field.kind !== 'actions') continue;
        items.forEach((item, index) => {
          if (object(item)) event(node, `${prop.name}[${index}].${field.name}`, item[field.name]);
        });
      }
    }
    if (['Form', 'QueryForm'].includes(node.type) && Array.isArray(node.props.fields)) node.props.fields.forEach((field, index) => {
      if (!object(field)) return;
      event(node, `fields[${index}].onChange`, field.onChange);
      if (field.type === 'upload') report(node, 'upload-demo-only', `fields[${index}] 只演示附件名称，未上传真实文件`);
      if (node.type === 'QueryForm' && (['dateRange', 'checkbox', 'cascader'].includes(String(field.type)) || field.multiple === true || field.treeCheckable === true || field.range === true)) {
        report(node, 'query-array-filter-unimplemented', `fields[${index}] 的数组查询值会被当前 Table 筛选忽略；不能把控件展示当作有效筛选`);
      }
    });
    if (typeof node.props.table === 'string') {
      const hasSavedRows = Object.hasOwn(tableRows, node.props.table);
      const rows = tableRows[node.props.table];
      bindings.push({ pfId: node.pfId, tableId: node.props.table, tableExists: tables.some(t => t.id === node.props.table), hasSavedRows, savedRowCount: hasSavedRows && Array.isArray(rows) ? rows.length : null });
      if (node.type === 'Freeform') {
        if (!hasSavedRows) report(node, 'freeform-data-missing', '关联表尚无已保存的预览数据，自由组件无法读取 data.rows；需要准备数据，不能伪造业务记录');
        else if (!Array.isArray(rows) || !rows.every(object)) report(node, 'freeform-data-invalid', '已保存预览数据不是记录数组');
        else {
          try { freeformInputs(node.props, tables, rows); }
          catch (error) { report(node, 'freeform-data-invalid', error instanceof Error ? error.message : String(error)); }
        }
      }
    }
    if (node.type === 'Upload') report(node, 'upload-demo-only', '当前上传只演示附件名称，未上传真实文件');
    if (node.type === 'MMediaInput' && (node.props.variant === 'image' || node.props.variant === 'scan')) {
      report(node, 'upload-demo-only', '当前多媒体控件只演示模拟拍照/扫码，未调用真实相机或上传文件');
    }
    if (node.type === 'Freeform') report(node, 'freeform-runtime-unverified', '已检查源码契约与数据声明，但尚未执行组件；需在预览中核对显示和交互');
    if (isChartType(node.type)) {
      if (node.props.source === 'sample') report(node, 'chart-sample-data', '当前图表使用明确的示例数据，不是项目统计结果');
      if (!chartConfigErrors(node.type, node.props, tables).length) {
        try { prepareChartData(node.type, node.props, node.props.source === 'table' ? tableRows[String(node.props.table)] : node.props.data); }
        catch (e) { report(node, 'chart-data-invalid', e instanceof Error ? e.message : String(e)); }
      }
      report(node, 'chart-runtime-unverified', '已检查图表配置与字段，尚未在浏览器验证显示、缩放和点击联动');
    }
    if (node.type === 'Button' && !node.props.onClick && node.props.disabled !== true) report(node, 'button-no-action', '按钮未声明点击动作；若用户要求可操作流程，需要补齐行为');
    if (node.type === 'MButton' && !node.props.onClick && node.props.disabled !== true) report(node, 'button-no-action', '移动按钮未声明点击动作；若用户要求可操作流程，需要补齐行为');
    if (node.type === 'MBottomDock' && !node.props.onPrimary) report(node, 'button-no-action', '底部操作坞未声明主按钮动作；若用户要求可操作流程，需要补齐行为');
    if ((node.type === 'Button' || node.type === 'MButton' || node.type === 'MBottomDock') && node.props.disabled !== true) {
      const actionProp = node.type === 'MBottomDock' ? node.props.onPrimary : node.props.onClick;
      const label = node.type === 'MBottomDock'
        ? (typeof node.props.primaryText === 'string' ? node.props.primaryText : '')
        : node.children.flatMap(c => (c.kind === 'text' ? [c.value] : [])).join(' ');
      if (/(保存|提交|确认保存|确认提交)/.test(label) && isActionChain(actionProp) && Array.isArray(actionProp.calls) && actionProp.calls.length > 0 &&
          actionProp.calls.every(call => call.name === 'toast' || call.name === 'closeOverlay')) {
        report(node, 'button-fake-save', '保存/提交按钮仅调用了提示或关窗，缺少 submitForm/updateRow 等实际数据写入动作；不能用提示消息冒充保存完成');
      }
    }
    node.children.filter(isNode).forEach(child => visit(child, [...ancestors, summary]));
  };
  if (parsed.doc) {
    visit(parsed.doc.root, []);
    const sem = extractPageActionSemantics(parsed.doc.root, Array.isArray(tables) ? tables : []);
    for (const slot of sem.slots) {
      for (const call of slot.calls) {
        if (call.name === 'submitForm' && typeof call.args[0] === 'string') {
          const formInfo = sem.forms.get(call.args[0]);
          if (formInfo && !formInfo.tableId) {
            warnings.push({
              pfId: slot.pfId,
              code: 'unbound-submit-form',
              message: `${slot.path} 调用了 submitForm("${call.args[0]}")，但目标表单未绑定物理数据表（缺少 table 属性），运行时不会写入记录`,
            });
          }
        }
      }
    }
  }
  if (selectedPfId !== undefined && !selected) throw new Error(`选中组件不存在：${selectedPfId}；请读取当前页面，不能用其他标识替代`);
  return {
    validation: { valid: errors.length === 0, errors, runtimeVerified: false, scope: '静态源码、物料契约、表字段绑定与图表预览记录；不执行浏览器、不核验需求完整性或远程服务' },
    selected, nodes, interactions, bindings, warnings,
  };
}
