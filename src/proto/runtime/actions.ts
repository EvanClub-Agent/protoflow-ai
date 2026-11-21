/**
 * Whitelisted interaction actions. In page TSX they are written as plain function calls
 * inside an arrow function, e.g.
 *   onClick={() => { submitForm('form-add'); toast('保存成功'); closeOverlay(); refresh('tbl-main'); }}
 */

export type ActionArgKind = 'overlay' | 'page' | 'string' | 'nodeRef' | 'json' | 'number' | 'select';

export interface ActionArgSpec {
  name: string;
  label: string;
  kind: ActionArgKind;
  optional?: boolean;
  options?: string[];
  refTypes?: string[];
}

export interface ActionSpec {
  name: string;
  title: string;
  description: string;
  args: ActionArgSpec[];
  /** Interrupts the remaining chain when it returns false (validation / confirmation) */
  canAbort?: boolean;
}

export const ACTIONS: ActionSpec[] = [
  {
    name: 'openModal',
    title: '打开弹框',
    description: '打开页面中定义的 Modal（移动端为 MDialog）。在列表/表格行操作中调用时，当前行与所属表会自动注入 row/tableId；params 仅用于传递自定义参数，禁止覆盖 row 或 tableId。',
    args: [
      { name: 'id', label: '弹框', kind: 'overlay', refTypes: ['Modal', 'MDialog'] },
      { name: 'params', label: '参数', kind: 'json', optional: true },
    ],
  },
  {
    name: 'openDrawer',
    title: '打开抽屉',
    description: '打开页面中定义的 Drawer（移动端为 MBottomSheet 半屏抽屉）。在列表/表格行操作中调用时，当前行与所属表会自动注入 row/tableId；params 仅用于传递自定义参数，禁止覆盖 row 或 tableId。',
    args: [
      { name: 'id', label: '抽屉', kind: 'overlay', refTypes: ['Drawer', 'MBottomSheet'] },
      { name: 'params', label: '参数', kind: 'json', optional: true },
    ],
  },
  { name: 'closeOverlay', title: '关闭当前弹层', description: '关闭最上层的弹框或抽屉。', args: [] },
  {
    name: 'submitForm',
    title: '提交表单',
    description: '校验表单必填项并写入表单绑定的物理表（有 row 参数时为更新）。校验失败会中断后续动作。',
    canAbort: true,
    args: [{ name: 'form', label: '表单', kind: 'nodeRef', refTypes: ['Form', 'MForm'] }],
  },
  {
    name: 'resetForm',
    title: '重置表单',
    description: '清空表单的值和校验提示。',
    args: [{ name: 'form', label: '表单', kind: 'nodeRef', refTypes: ['Form', 'MForm'] }],
  },
  {
    name: 'confirm',
    title: '二次确认',
    description: '弹出确认框，用户取消时中断后续动作。',
    canAbort: true,
    args: [{ name: 'message', label: '确认文案', kind: 'string' }],
  },
  {
    name: 'toast',
    title: '消息提示',
    description: '顶部轻提示。',
    args: [
      { name: 'message', label: '文案', kind: 'string' },
      { name: 'type', label: '类型', kind: 'select', options: ['success', 'info', 'warning', 'error'], optional: true },
    ],
  },
  {
    name: 'refresh',
    title: '刷新列表/表格',
    description: '重新加载表格或移动列表数据（回到第一页）。',
    args: [{ name: 'table', label: '表格/列表', kind: 'nodeRef', refTypes: ['Table', 'MFeedList', 'MTaskList'] }],
  },
  {
    name: 'deleteRow',
    title: '删除当前行',
    description: '删除当前上下文中的行（用于表格行操作或带 row 参数的弹层）。',
    args: [],
  },
  {
    name: 'updateRow',
    title: '更新当前行字段',
    description: '修改当前行的字段值，如审批通过：updateRow({ status: "已通过" })。',
    args: [{ name: 'values', label: '字段值', kind: 'json' }],
  },
  {
    name: 'importPurchaseOrderLines', title: '采购明细转入验收', canAbort: true,
    description: '将选中的已确认采购明细写入已保存的验收单，保留来源外键并避免重复转入。',
    args: [
      { name: 'source', label: '采购选单表格', kind: 'nodeRef', refTypes: ['Table'] },
      { name: 'target', label: '验收明细表格', kind: 'nodeRef', refTypes: ['Table'] },
      { name: 'form', label: '验收单表头', kind: 'nodeRef', refTypes: ['Form'] },
    ],
  },
  {
    name: 'returnSelection',
    title: '回填选中行',
    description: '在选择弹框中使用：把表格勾选的行回填到打开它的 PickerInput，并关闭弹框。',
    args: [
      { name: 'table', label: '表格', kind: 'nodeRef', refTypes: ['Table'] },
      { name: 'labelField', label: '显示字段', kind: 'string' },
      { name: 'valueField', label: '单选存储字段（保留原类型）', kind: 'string', optional: true },
    ],
  },
  {
    name: 'switchTab',
    title: '切换页签',
    description: '按从 0 开始的索引切换页签或动态面板状态。',
    args: [
      { name: 'tabs', label: '页签组件', kind: 'nodeRef', refTypes: ['Tabs', 'MPillTabs', 'DynamicPanel'] },
      { name: 'index', label: '序号', kind: 'number' },
    ],
  },
  {
    name: 'navigate',
    title: '跳转页面',
    description: '跳转到左侧目录中的另一个菜单页面。',
    args: [{ name: 'page', label: '页面', kind: 'page' }, {name:'source',label:'携带当前行',kind:'select',options:['row'],optional:true}],
  },
  {
    name: 'setVar',
    title: '设置变量',
    description: '设置页面变量，可在文本中用 {{vars.名称}} 显示。',
    args: [
      { name: 'name', label: '变量名', kind: 'string' },
      { name: 'value', label: '值', kind: 'string' },
    ],
  },
  { name: 'show', title: '显示组件', description: '显示被隐藏的组件。', args: [{ name: 'target', label: '组件', kind: 'nodeRef' }] },
  { name: 'hide', title: '隐藏组件', description: '隐藏组件。', args: [{ name: 'target', label: '组件', kind: 'nodeRef' }] },
];

export const ACTION_MAP: Record<string, ActionSpec> = Object.fromEntries(ACTIONS.map((a) => [a.name, a]));
