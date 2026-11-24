import type { ActionChain, ProtoDoc, ProtoNode } from '../types';
import { isActionChain, isNode, isRawExpr } from '../types';
import { parsePageSource } from '../dsl/parser';
import { ACTIONS } from '../runtime/actions';
import {
  DESKTOP_OVERLAY_TYPES,
  FIELD_TYPES,
  MOBILE_COMPONENT_NAMES,
  MOBILE_OVERLAY_TYPES,
  OVERLAY_TYPES,
  PAGE_ROOT_TYPES,
  UNIVERSAL_COMPONENT_NAMES,
} from './meta';
import { tableConfigErrors } from '../table/model';
import { materialOptions } from './antdOptions';
import { freeformSourceErrors, isJsonValue } from '../freeform/contract';
import { isChartType, chartConfigErrors } from '../charts/model';
import { FIELD_COMPONENT_NAMES, getMaterialContracts, MATERIAL_VALUE_DEFINITIONS, type ValueSchema } from './materialSchemas';

export { getMaterialContracts, MATERIAL_VALUE_DEFINITIONS } from './materialSchemas';
export interface MaterialIssue { pfId: string; path: string; message: string }
export const MATERIAL_CONTRACT_VERSION = 1;
export const getActionContracts = () => ACTIONS;
const contracts = new Map(getMaterialContracts().map((c) => [c.name, c]));
const actionSpecs = new Map(ACTIONS.map((a) => [a.name, a]));
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 100) ?? String(value);

export function validateMaterialDoc(doc: ProtoDoc): MaterialIssue[] {
  const issues: MaterialIssue[] = [];
  const nodes = new Map<string, ProtoNode>();
  const overlays = new Map<string, ProtoNode>();
  const report = (node: ProtoNode, path: string, message: string) => issues.push({ pfId: node.pfId, path, message: `${node.pfId} <${node.type}>.${path}: ${message}` });
  const collect = (node: ProtoNode) => {
    if (!node.pfId.trim() || nodes.has(node.pfId)) report(node, 'pfId', '必须是唯一非空标识');
    nodes.set(node.pfId, node);
    if (OVERLAY_TYPES.has(node.type) && typeof node.props.id === 'string') {
      if (overlays.has(node.props.id)) report(node, 'id', `弹层 ID 重复：${show(node.props.id)}`);
      overlays.set(node.props.id, node);
    }
    node.children.filter(isNode).forEach(collect);
  };
  collect(doc.root);

  const valueErrors = (value: unknown, schema: ValueSchema, path: string): string[] => {
    if (schema.$ref) return valueErrors(value, MATERIAL_VALUE_DEFINITIONS[schema.$ref], path);
    if (schema.anyOf) {
      const attempts = schema.anyOf.map((branch) => valueErrors(value, branch, path));
      if (attempts.some((result) => result.length === 0)) return [];
      // Prefer diagnostics from a branch with the matching container/value type.
      const matching = schema.anyOf.map((branch, i) => ({ branch, errors: attempts[i] })).filter(({ branch }) =>
        branch.type === 'object' ? object(value) : branch.type === 'array' ? Array.isArray(value) : branch.type === typeof value);
      return (matching.length ? matching.map((m) => m.errors) : attempts).sort((a, b) => a.length - b.length)[0];
    }
    const validType = schema.type === 'actions' ? isActionChain(value)
      : schema.type === 'array' ? Array.isArray(value)
      : schema.type === 'object' ? object(value) && !isRawExpr(value) && !isActionChain(value)
      : schema.type === 'null' ? value === null
      : typeof value === schema.type;
    if (!validType) return [`${path}: 需要 ${schema.type}，收到 ${show(value)}`];
    if (schema.enum && !schema.enum.includes(value as string)) return [`${path}: 仅允许 ${schema.enum.map(show).join(' | ')}，收到 ${show(value)}`];
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return [`${path}: 必须是有限数值`];
      if (schema.integer && !Number.isInteger(value)) return [`${path}: 必须是整数，收到 ${value}`];
      if (schema.minimum !== undefined && value < schema.minimum) return [`${path}: 必须 ≥ ${schema.minimum}，收到 ${value}`];
      if (schema.maximum !== undefined && value > schema.maximum) return [`${path}: 必须 ≤ ${schema.maximum}，收到 ${value}`];
    }
    if (typeof value === 'string' && schema.minLength && value.trim().length < schema.minLength) return [`${path}: 不能为空`];
    if (Array.isArray(value) && schema.items) return value.flatMap((item, i) => valueErrors(item, schema.items!, `${path}[${i}]`));
    if (object(value) && schema.type === 'object') {
      const errors: string[] = [];
      for (const key of schema.required ?? []) if (!own(value, key)) errors.push(`${path}.${key}: 缺少必填项`);
      for (const [key, item] of Object.entries(value)) {
        const child = schema.properties && own(schema.properties, key) ? schema.properties[key] : typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined;
        if (child) errors.push(...valueErrors(item, child, `${path}.${key}`));
        else if (schema.additionalProperties === false) errors.push(`${path}.${key}: 未注册属性；允许 ${Object.keys(schema.properties ?? {}).join(', ')}`);
      }
      return errors;
    }
    return [];
  };

  const validateActions = (node: ProtoNode, value: ActionChain, path: string) => {
    if (!Array.isArray(value.calls) || Object.keys(value).some((key) => !['$kind', 'calls'].includes(key))) {
      report(node, path, '动作链必须包含且仅包含 $kind 和 calls 数组');
      return;
    }
    for (const [index, call] of value.calls.entries()) {
      if (!object(call) || typeof call.name !== 'string' || !Array.isArray(call.args) || Object.keys(call).some((key) => !['name', 'args'].includes(key))) {
        report(node, `${path}[${index}]`, '动作必须包含 name 和 args 数组');
        continue;
      }
      const at = `${path}[${index}].${call.name}`;
      const spec = actionSpecs.get(call.name);
      if (!spec) { report(node, at, '未知动作'); continue; }
      if (call.args.length > spec.args.length) report(node, at, `最多接受 ${spec.args.length} 个参数`);
      for (const [i, arg] of spec.args.entries()) {
        const actual = call.args[i];
        if (actual === undefined) { if (!arg.optional) report(node, `${at}.${arg.name}`, '缺少必填参数'); continue; }
        const schema: ValueSchema = arg.kind === 'json' ? { type: 'object', additionalProperties: true } : arg.kind === 'number' ? { type: 'number' } : { type: 'string', ...(arg.options ? { enum: arg.options } : {}) };
        valueErrors(actual, schema, arg.name).forEach((e) => report(node, at, e));
        if (arg.kind === 'nodeRef' && typeof actual === 'string') {
          const target = nodes.get(actual);
          if (!target || (arg.refTypes && !arg.refTypes.includes(target.type))) report(node, `${at}.${arg.name}`, `目标 ${show(actual)} 必须是 ${arg.refTypes?.join('/') ?? '当前页面组件'} 的 pfId`);
        }
        if (arg.kind === 'overlay' && typeof actual === 'string') {
          const target = overlays.get(actual);
          const allowed = arg.refTypes;
          if (!target || (allowed && !allowed.includes(target.type))) {
            report(node, `${at}.${arg.name}`, `目标 ${show(actual)} 必须是 ${allowed?.join('/') ?? '弹层'} 的 id`);
          }
        }
      }
      if ((call.name === 'openModal' || call.name === 'openDrawer') && object(call.args[1])) {
        for (const reservedKey of ['row', 'tableId']) {
          if (own(call.args[1], reservedKey)) {
            report(
              node,
              `${at}.params.${reservedKey}`,
              '系统保留的行上下文字段 row/tableId 由列表/表格行事件自动传入，禁止在 params 中覆盖',
            );
          }
        }
      }
      if (call.name === 'switchTab' && typeof call.args[1] === 'number') {
        const target = nodes.get(String(call.args[0]));
        const tabs = target?.children.filter(isNode).length ?? 0;
        const count = target?.type === 'MPillTabs' && !tabs && Array.isArray(target.props.items) ? target.props.items.length : tabs;
        if (!Number.isInteger(call.args[1]) || call.args[1] < 0 || (target && call.args[1] >= count)) report(node, at, '页签索引超出范围');
      }
    }
  };

  const inspectExpressions = (node: ProtoNode, value: unknown, path: string, actionAllowed = false) => {
    if (isRawExpr(value)) { report(node, path, `不支持动态表达式 ${value.code}`); return; }
    if (isActionChain(value)) {
      if (!actionAllowed) report(node, path, '动作链只能放在已注册事件中');
      else validateActions(node, value, path);
      if (Array.isArray(value.calls)) value.calls.forEach((call, i) => {
        if (object(call) && Array.isArray(call.args)) call.args.forEach((arg, j) => inspectExpressions(node, arg, `${path}[${i}].args[${j}]`));
      });
      return;
    }
    if (Array.isArray(value)) value.forEach((item, i) => inspectExpressions(node, item, `${path}[${i}]`));
    else if (object(value)) for (const [key, item] of Object.entries(value)) {
      const nestedEvent =
        (/^rowActions\[\d+\]$/.test(path) && key === 'onClick' && ['Table', 'CardGrid', 'MTaskList'].includes(node.type)) ||
        (/^items\[\d+\]$/.test(path) && key === 'onClick' && ['MBentoGrid', 'MTabBar', 'MListGroup', 'NavMenu', 'Dropdown', 'Carousel', 'MBannerCarousel'].includes(node.type)) ||
        (/^fields\[\d+\]$/.test(path) && (key === 'onChange' || key === 'onClick') && ['Form', 'QueryForm'].includes(node.type));
      inspectExpressions(node, item, `${path}.${key}`, nestedEvent);
    }
  };

  const validateValues = (node: ProtoNode, type: string, values: Record<string, unknown>, prefix = '') => {
    if (type === 'MSheetPicker' && typeof values.table === 'string' &&
      (!values.labelField || !values.valueField)) report(node, 'table', '关联表必须明确配置显示字段和存储字段');
    if (type === 'Table') tableConfigErrors(values).forEach(message => report(node, 'table', message));
    if (['Table','CardGrid','MTaskList','MFeedList','MCardGrid'].includes(type) && values.sourceForeignKey !== undefined &&
      (typeof values.table !== 'string' || !values.table.trim() || typeof values.sourceForeignKey !== 'string' || !values.sourceForeignKey.trim()))
      report(node, 'sourceForeignKey', '按当前来源行读取明细必须同时指定真实 table ID 和非空外键字段名');
    if (isChartType(type)) chartConfigErrors(type, values).forEach(message => report(node, 'chart', message));
    if (type === 'Freeform') {
      freeformSourceErrors(values.source, values.css).forEach(message => report(node, 'source', message));
      if (values.data !== undefined && !isJsonValue(values.data)) report(node, 'data', '需要有效 JSON，禁止原型属性且嵌套最多 20 层');
      if (values.table !== undefined && (!Array.isArray(values.columns) || !values.columns.length)) report(node, 'columns', '绑定数据表时必须明确声明展示字段');
      if (values.columns !== undefined && values.table === undefined) report(node, 'table', '展示字段需要关联真实数据表');
      if (Array.isArray(values.columns) && new Set(values.columns).size !== values.columns.length) report(node, 'columns', '展示字段不能重复');
      if (values.table !== undefined && object(values.data) && own(values.data, 'rows')) report(node, 'data.rows', '绑定表时 rows 由表数据提供，不能重复声明');
      const names = new Set<string>();
      if (Array.isArray(values.eventFields)) values.eventFields.forEach((field, i) => {
        if (!object(field) || typeof field.name !== 'string') return;
        if (!/^[A-Za-z_][\w]*$/.test(field.name) || ['__proto__', 'constructor', 'prototype'].includes(field.name) || names.has(field.name)) report(node, `eventFields[${i}].name`, '交互结果名必须合法且唯一');
        names.add(field.name);
      });
      const checkEventRefs = (value: unknown) => {
        if (typeof value === 'string') for (const match of value.matchAll(/\{\{event\.([A-Za-z_][\w]*)\}\}/g)) if (!names.has(match[1])) report(node, 'onAction', `交互结果 ${match[1]} 未在 eventFields 声明`);
        if (Array.isArray(value)) value.forEach(checkEventRefs);
        else if (object(value)) Object.values(value).forEach(checkEventRefs);
      };
      checkEventRefs(values.onAction);
    }
    if (own(values, 'options')) {
      try { materialOptions(values.options, ['TreeSelect', 'Cascader'].includes(type)); }
      catch (error) { report(node, `${prefix}options`, error instanceof Error ? error.message : '选项配置无效'); }
    }
    for (const [low, high] of [['min', 'max'], ['minRows', 'maxRows']]) {
      const a = values[low], b = values[high];
      if (typeof a === 'number' && typeof b === 'number' && a > b) report(node, `${prefix}${low}`, `不能大于 ${high}`);
    }
    if (type === 'DatePicker' && values.showTime === true && values.picker && !['date', 'datetime'].includes(String(values.picker))) report(node, `${prefix}showTime`, '仅 date/datetime 粒度支持时间');
    for (const spec of contracts.get(type)?.props ?? []) {
      const value = values[spec.name];
      if (spec.kind === 'nodeRef' && typeof value === 'string') {
        const target = nodes.get(value);
        if (!target || (spec.refTypes && !spec.refTypes.includes(target.type))) report(node, `${prefix}${spec.name}`, `需要有效的 ${spec.refTypes?.join('/') ?? '组件'} pfId，收到 ${show(value)}`);
      }
      if (spec.kind === 'overlay' && typeof value === 'string' && !overlays.has(value)) report(node, `${prefix}${spec.name}`, `弹层 id 不存在：${show(value)}`);
    }
  };

  const isMobileRoot = doc.root.type === 'MobilePage';
  const visit = (node: ProtoNode, parent?: ProtoNode, inForm = false) => {
    const meta = contracts.get(node.type);
    if (!meta) { report(node, 'type', '未知组件；只能使用物料契约中的名称'); return; }
    if (PAGE_ROOT_TYPES.has(node.type) && parent) report(node, 'parent', `${node.type} 只能作为页面根节点`);
    if (parent) {
      if (isMobileRoot && !MOBILE_COMPONENT_NAMES.has(node.type) && !UNIVERSAL_COMPONENT_NAMES.has(node.type)) {
        report(node, 'type', '移动端页面 (MobilePage) 不能混用 PC 管理端组件，请改用 M* 移动专属物料');
      }
      if (!isMobileRoot && MOBILE_COMPONENT_NAMES.has(node.type)) {
        report(node, 'type', 'PC 管理端页面 (Page) 不能混用 M* 移动端物料，请使用 MobilePage 根容器');
      }
    }
    if (meta.parents && (!parent || !meta.parents.includes(parent.type))) report(node, 'parent', `只能放在 ${meta.parents.join('/')} 内`);
    if (DESKTOP_OVERLAY_TYPES.has(node.type) && parent?.type !== 'Page') report(node, 'parent', 'Modal/Drawer 必须声明在 Page 根部');
    if (MOBILE_OVERLAY_TYPES.has(node.type) && parent?.type !== 'MobilePage') report(node, 'parent', 'MBottomSheet/MDialog 必须声明在 MobilePage 根部');
    const kids = node.children.filter(isNode);
    if (!meta.container && kids.length) report(node, 'children', '该物料不接受子组件');
    if (!meta.textChild && node.children.some((child) => !isNode(child))) report(node, 'children', '不接受文本子内容，请使用已注册的文字属性或 Text 子组件');
    if (meta.childTypes && kids.some((kid) => !meta.childTypes.includes(kid.type))) report(node, 'children', `只接受 ${meta.childTypes.join('/')} 子组件`);
    if (node.type === 'Form' && kids.length && Array.isArray(node.props.fields) && node.props.fields.length) report(node, 'fields', '不能与子字段组件同时配置，否则 fields 不会渲染');
    const props = new Map(meta.props.map((p) => [p.name, p]));
    const events = new Set(meta.events.map((e) => e.name));
    for (const spec of meta.props) if (spec.required && !own(node.props, spec.name)) report(node, spec.name, '缺少必填属性');
    for (const [name, value] of Object.entries(node.props)) {
      const spec = props.get(name);
      if (!spec && !events.has(name)) { report(node, name, `未注册属性；允许 ${[...props.keys(), ...events].join(', ')}`); continue; }
      valueErrors(value, spec?.valueSchema ?? { type: 'actions' }, name).forEach((e) => report(node, name, e));
      inspectExpressions(node, value, name, events.has(name));
    }
    validateValues(node, node.type, node.props);
    if (['Form', 'QueryForm'].includes(node.type) && Array.isArray(node.props.fields)) {
      const names = new Set<string>();
      node.props.fields.forEach((field, i) => {
        if (!object(field)) return;
        if (typeof field.name === 'string') {
          if (names.has(field.name)) report(node, `fields[${i}].name`, '绑定名称重复，会读写同一个字段');
          names.add(field.name);
        }
        // Omitted type explicitly means Input in both Form renderers.
        const kind = field.type === undefined ? 'input' : field.type;
        if (typeof kind === 'string' && own(FIELD_COMPONENT_NAMES, kind)) validateValues(node, FIELD_COMPONENT_NAMES[kind], field, `fields[${i}].`);
      });
    }
    if (inForm && FIELD_TYPES.has(node.type) && (typeof node.props.name !== 'string' || !node.props.name.trim())) report(node, 'name', '表单字段必须显式声明绑定名称');
    kids.forEach((kid) => visit(kid, node, inForm || node.type === 'Form' || node.type === 'MForm'));
  };
  visit(doc.root);
  return issues;
}

/** This exact parser + registry + validator is bundled for the native MCP process. */
export function validateMaterialSource(source: string): string[] {
  const result = parsePageSource(source, { strict: true });
  const errors = result.issues.map((i) => i.message);
  if (result.normalized) errors.push('每个组件必须显式提供唯一非空 pfId；不能依赖自动生成或重分配');
  if (!result.doc) return errors;
  if (!PAGE_ROOT_TYPES.has(result.doc.root.type)) errors.push('根组件必须为 Page 或 MobilePage');
  return [...errors, ...validateMaterialDoc(result.doc).map((i) => i.message)];
}
