import type { DBTableSchema } from '../../store/useProtoStore';
import type { ActionCall, ActionChain, PropValue, ProtoDoc, ProtoNode } from '../types';
import { isActionChain } from '../types';
import { COMPONENTS, COMPONENT_MAP, OVERLAY_TYPES } from '../registry/meta';
import { ACTIONS } from '../runtime/actions';
import { collectOverlays, findNode, insertNode, reassignIds, replaceNode, setProp, walk } from '../dsl/tree';
import { parsePageSource } from '../dsl/parser';
import { printPageSource } from '../dsl/printer';
import { generateListPageSource, generateMasterDetailPageSource } from './templates';
import type { CustomCompositeBlock } from '../store/usePageStore';
import { getMaterialContracts, validateMaterialDoc } from '../registry/materialContract';
import type { ValueSchema } from '../registry/materialSchemas';
import { MATERIAL_GENERATION_RULES } from './materialInstructions';
import { tableConfigErrors } from '../table/model';
import { freeformBindingErrors } from '../freeform/contract';
import { isChartType, chartConfigErrors } from '../charts/model';
import { isEnLocale, tr } from '../../i18n/runtime';

export interface PageValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  pfId: string;
  nodeType: string;
  message: string;
  fixLabel?: string;
  fixAction?:
    | { kind: 'create_overlay'; overlayType: 'Modal' | 'Drawer'; overlayId: string; title: string }
    | { kind: 'bind_table'; tableId: string };
}

export function collectActionCalls(val: PropValue | undefined, out: ActionCall[] = []): ActionCall[] {
  if (!val || typeof val !== 'object') return out;
  if (isActionChain(val)) {
    // Invalid literal chains are diagnosed by the shared material validator.
    // Diagnostic/fix discovery must remain safe for manually edited source too.
    if (Array.isArray(val.calls)) out.push(...val.calls.filter((call) => call && typeof call.name === 'string' && Array.isArray(call.args)));
    return out;
  }
  if (Array.isArray(val)) {
    val.forEach((v) => collectActionCalls(v, out));
    return out;
  }
  Object.values(val).forEach((v) => collectActionCalls(v, out));
  return out;
}

/** Parse a JSX snippet (e.g. `<Modal id="m-1">...</Modal>`) into a ProtoNode. */
export function parseSnippetNode(snippet: string): ProtoNode | null {
  const res = parsePageSource(`export default function Page() { return (<Page>${snippet}</Page>); }`);
  const first = res.doc?.root.children.find((c): c is ProtoNode => c.kind === 'node');
  return first ?? null;
}

/**
 * Static AST validator for constrained React TSX pages:
 * - Checks unknown component tags
 * - Checks openModal/openDrawer references against declared <Modal id="..."> / <Drawer id="...">
 * - Checks table="..." bindings against project DBTableSchema[]
 */
export function validatePageDoc(doc: ProtoDoc, dbTables: DBTableSchema[]): PageValidationIssue[] {
  const issues: PageValidationIssue[] = validateMaterialDoc(doc).map((issue, index) => ({
    id: `material-${issue.pfId}-${issue.path}-${index}`, severity: 'error', pfId: issue.pfId,
    nodeType: findNode(doc.root, issue.pfId)?.type ?? doc.root.type, message: issue.message,
  }));
  const overlayNodes = collectOverlays(doc.root, OVERLAY_TYPES);
  const overlayIds = new Set(
    overlayNodes.map((o) => (typeof o.props.id === 'string' ? o.props.id : o.pfId))
  );
  const tableIds = new Set(dbTables.map((t) => t.id));

  walk(doc.root, (node) => {
    if (isChartType(node.type)) chartConfigErrors(node.type, node.props, dbTables).forEach((message, index) => issues.push({ id: `chart-${node.pfId}-${index}`, severity: 'error', pfId: node.pfId, nodeType: node.type, message }));
    if (node.type === 'Table' && node.props.table) {
      const table = dbTables.find(t => t.id === node.props.table);
      if (table) tableConfigErrors(node.props, table).forEach((message, index) => issues.push({ id: `table-${node.pfId}-${index}`, severity: 'error', pfId: node.pfId, nodeType: node.type, message }));
    }
    if (node.type === 'Freeform') freeformBindingErrors(node.props, dbTables).forEach((message, index) => issues.push({ id: `freeform-${node.pfId}-${index}`, severity: 'error', pfId: node.pfId, nodeType: node.type, message }));
    if (
      (node.type === 'Table' || node.type === 'Form' || node.type === 'Descriptions') &&
      typeof node.props.table === 'string'
    ) {
      const tbl = node.props.table;
      if (tbl && !tableIds.has(tbl)) {
        issues.push({
          id: `tbl-${node.pfId}`,
          severity: 'error',
          pfId: node.pfId,
          nodeType: node.type,
          message: tr(
            `<${node.type}> 绑定的物理表 "${tbl}" 在当前数据库模型中不存在，请选择真实业务表`,
            `<${node.type}> is bound to non-existent database table "${tbl}". Select an existing table.`
          ),
        });
      }
    }

    if (node.type === 'PickerInput' && typeof node.props.overlay === 'string') {
      const targetId = node.props.overlay;
      if (targetId && !overlayIds.has(targetId)) {
        const pickerLabel = typeof node.props.label === 'string' ? node.props.label : tr('数据', 'Record');
        issues.push({
          id: `picker-${node.pfId}-${targetId}`,
          severity: 'error',
          pfId: node.pfId,
          nodeType: node.type,
          message: tr(
            `选择器 <PickerInput> 引用了未定义的弹框 id="${targetId}"`,
            `<PickerInput> references undefined Modal id="${targetId}"`
          ),
          fixLabel: tr(`自动生成弹框 #${targetId}`, `Generate Modal #${targetId}`),
          fixAction: {
            kind: 'create_overlay',
            overlayType: 'Modal',
            overlayId: targetId,
            title: tr(`${pickerLabel}选择弹框`, `Select ${pickerLabel}`),
          },
        });
      }
    }

    const calls: ActionCall[] = [];
    Object.values(node.props).forEach((v) => collectActionCalls(v, calls));
    calls.forEach((c, idx) => {
      if ((c.name === 'openModal' || c.name === 'openDrawer') && typeof c.args[0] === 'string') {
        const targetId = c.args[0];
        if (targetId && !overlayIds.has(targetId)) {
          const isModal = c.name === 'openModal';
          issues.push({
            id: `overlay-ref-${node.pfId}-${targetId}-${idx}`,
            severity: 'error',
            pfId: node.pfId,
            nodeType: node.type,
            message: tr(
              `动作 ${c.name}('${targetId}') 指向的${isModal ? '弹框 <Modal>' : '抽屉 <Drawer>'} 尚未创建`,
              `Action ${c.name}('${targetId}') references missing ${isModal ? '<Modal>' : '<Drawer>'}`
            ),
            fixLabel: tr(
              `一键生成 ${isModal ? 'Modal' : 'Drawer'} #${targetId}`,
              `Create ${isModal ? 'Modal' : 'Drawer'} #${targetId}`
            ),
            fixAction: {
              kind: 'create_overlay',
              overlayType: isModal ? 'Modal' : 'Drawer',
              overlayId: targetId,
              title: isModal
                ? tr(`新建业务弹框 (${targetId})`, `New Modal (${targetId})`)
                : tr(`业务详情抽屉 (${targetId})`, `Detail Drawer (${targetId})`),
            },
          });
        }
      }
    });
  });

  return issues;
}

export function buildOverlayNode(
  overlayType: 'Modal' | 'Drawer' | 'MBottomSheet' | 'MDialog',
  overlayId: string,
  title: string,
  defaultTable?: string
): ProtoNode {
  const en = isEnLocale();
  if (overlayType === 'MBottomSheet') {
    const mobileSnippet = en
      ? `<MBottomSheet id="${overlayId}" title="${title}" size="medium">
      <MForm pfId="mform-${overlayId}">
        <MField label="Name" name="name" placeholder="Enter value..." required={true} />
      </MForm>
      <MBottomDock mode="action" secondaryText="Cancel" primaryText="Save" onSecondary={() => closeOverlay()} onPrimary={() => { submitForm('mform-${overlayId}'); toast('Saved'); closeOverlay(); }} />
    </MBottomSheet>`
      : `<MBottomSheet id="${overlayId}" title="${title}" size="medium">
      <MForm pfId="mform-${overlayId}">
        <MField label="名称" name="name" placeholder="请输入..." required={true} />
      </MForm>
      <MBottomDock mode="action" secondaryText="取消" primaryText="确认保存" onSecondary={() => closeOverlay()} onPrimary={() => { submitForm('mform-${overlayId}'); toast('保存成功'); closeOverlay(); }} />
    </MBottomSheet>`;
    return (
      parseSnippetNode(mobileSnippet) ?? {
        kind: 'node',
        pfId: `pf_${overlayId}`,
        type: 'MBottomSheet',
        props: { id: overlayId, title, size: 'medium' },
        children: [],
      }
    );
  }
  if (overlayType === 'MDialog') {
    const desc = tr('请确认是否执行此操作？', 'Are you sure you want to proceed?');
    const confirmTxt = tr('确认', 'Confirm');
    const cancelTxt = tr('取消', 'Cancel');
    const dlgSnippet = `<MDialog id="${overlayId}" title="${title}" description="${desc}" confirmText="${confirmTxt}" cancelText="${cancelTxt}" />`;
    return (
      parseSnippetNode(dlgSnippet) ?? {
        kind: 'node',
        pfId: `pf_${overlayId}`,
        type: 'MDialog',
        props: { id: overlayId, title, description: desc, confirmText: confirmTxt, cancelText: cancelTxt },
        children: [],
      }
    );
  }
  const snippet =
    overlayType === 'Modal'
      ? en
        ? `<Modal id="${overlayId}" title="${title}" width={680} footer={false}>
          <Form pfId="form-${overlayId}" ${defaultTable ? `table="${defaultTable}"` : ''} cols={2} />
          <Toolbar align="right">
            <Button onClick={() => closeOverlay()}>Cancel</Button>
            <Button type="primary" onClick={() => { submitForm('form-${overlayId}'); toast('Saved'); closeOverlay(); }}>Save</Button>
          </Toolbar>
        </Modal>`
        : `<Modal id="${overlayId}" title="${title}" width={680} footer={false}>
          <Form pfId="form-${overlayId}" ${defaultTable ? `table="${defaultTable}"` : ''} cols={2} />
          <Toolbar align="right">
            <Button onClick={() => closeOverlay()}>取消</Button>
            <Button type="primary" onClick={() => { submitForm('form-${overlayId}'); toast('保存成功'); closeOverlay(); }}>保存</Button>
          </Toolbar>
        </Modal>`
      : en
        ? `<Drawer id="${overlayId}" title="${title}" width={540}>
          <Descriptions title="Details" ${defaultTable ? `table="${defaultTable}"` : ''} column={2} />
          <Toolbar align="right">
            <Button onClick={() => closeOverlay()}>Close</Button>
          </Toolbar>
        </Drawer>`
        : `<Drawer id="${overlayId}" title="${title}" width={540}>
          <Descriptions title="详细信息" ${defaultTable ? `table="${defaultTable}"` : ''} column={2} />
          <Toolbar align="right">
            <Button onClick={() => closeOverlay()}>关闭</Button>
          </Toolbar>
        </Drawer>`;
  return (
    parseSnippetNode(snippet) ?? {
      kind: 'node',
      pfId: `pf_${overlayId}`,
      type: overlayType,
      props: { id: overlayId, title, width: overlayType === 'Modal' ? 680 : 540 },
      children: [],
    }
  );
}

/**
 * Generates the official "代码为底，控件为表" AI System Prompt from component & action registries.
 */
export function generateAiSystemPrompt(dbTables: DBTableSchema[]): string {
  const describe = (schema: ValueSchema): string => {
    if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join('|');
    if (schema.$ref) return `对象(${schema.$ref})`;
    if (schema.anyOf) return schema.anyOf.length > 4 ? '结构化对象（按 valueSchema）' : schema.anyOf.map(describe).join('|');
    if (schema.type === 'array') return `Array<${schema.items ? describe(schema.items) : 'unknown'}>`;
    if (schema.type === 'object') return `对象{${Object.keys(schema.properties ?? {}).join(',')}}`;
    return `${schema.integer ? 'integer' : schema.type}${schema.minimum !== undefined ? `≥${schema.minimum}` : ''}${schema.maximum !== undefined ? `≤${schema.maximum}` : ''}`;
  };
  const compLines = getMaterialContracts().map((c) => {
    const props = c.props.map((p) => `${p.name}${p.required ? '(必填)' : '?'}:${describe(p.valueSchema)}`).join(', ');
    const evts = (c.events ?? []).map((e) => `${e.name}={() => ...}`).join(', ');
    const attrStr = [props, evts].filter(Boolean).join(', ');
    return `- ${c.name}: ${attrStr} // ${c.title}${c.parents ? `；父级仅 ${c.parents.join('/')}` : ''}${c.childTypes ? `；子级仅 ${c.childTypes.join('/')}` : ''}${c.textChild ? '；支持文本子内容' : c.container ? '；支持子组件' : '；无子内容'}`;
  }).join('\n');

  const actionLines = ACTIONS.map(
    (a) => `- ${a.name}(${a.args.map((arg) => arg.name).join(', ')})  // ${a.title}: ${a.description}`
  ).join('\n');

  const tableLines = dbTables
    .map(
      (t) =>
        `- ${t.id} (${t.cnName}): [${t.columns
          .slice(0, 8)
          .map((c) => `${c.name}:${c.comment.split('（')[0]}`)
          .join(', ')}]`
    )
    .join('\n');

  return `# Alex 原型生成规范（代码为底 · 控件为表）
你是一个企业级中后台原型架构师。页面源码使用受约束的 React TSX（单个 export default function Page()），通过项目 MCP 工具提交。外层页面严禁原生 <div>/<style> 或未注册标签；Freeform.source 内部遵循自由组件契约。每个外层组件必须有唯一且稳定的 pfId。最终文字回复解释真实操作结果。

${MATERIAL_GENERATION_RULES}

## 1. 可用高语义物料组件 (${COMPONENTS.length} 个)
${compLines}

## 2. 受约束交互动作白名单 (事件属性内仅允许调用以下动作函数)
${actionLines}

## 3. 当前项目可绑定物理数据表 (${dbTables.length} 张)
${tableLines}

## 4. 弹框与抽屉嵌套规则
- 桌面端 <Page> 将所有 <Modal id="..."> 与 <Drawer id="..."> 声明在根组件末尾；移动端 <MobilePage> 将所有 <MBottomSheet id="...">（由 openDrawer 打开）与 <MDialog id="...">（由 openModal 打开）声明在根组件末尾。
- 弹层内部的按钮或表格行操作可以继续调用 openModal('...') 或 openDrawer('...') 实现多级弹层嵌套；桌面端单选关联字段可调用 returnSelection('表格pfId', '显示字段', '来源键字段')，将名称显示在界面并把真实引用值写入主表单。${
    isEnLocale()
      ? '\n\n## 5. Language Preference (Active UI Locale: English)\n- Unless the user explicitly requests Chinese, reply in English and generate all default UI labels, button text, titles, placeholders, and summaries in idiomatic English.'
      : ''
  }`;
}
