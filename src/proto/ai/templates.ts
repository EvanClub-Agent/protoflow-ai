import type { DBColumnSchema, DBTableSchema } from '../../store/useProtoStore';
import { parsePageSource } from '../dsl/parser';
import { printPageSource } from '../dsl/printer';
import { diagramRelations } from '../database/relations';
import { columnLabel, defaultDisplayColumns } from '../runtime/mock';
import type { PagePlatform } from '../mobile/types';

const STATUS_OPTIONS = '待审批,已通过,已驳回,草稿';

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function fieldTypeOf(col: DBColumnSchema): string {
  const n = col.name.toLowerCase();
  const t = col.dataType.toUpperCase();
  const c = col.comment || '';
  if (n.includes('status') || c.includes('状态') || n.endsWith('_type') || n === 'supplier_id' || /\([^)]*\/[^)]*\)/.test(c)) {
    return 'select';
  }
  if (n.includes('remark') || n.includes('desc') || c.includes('备注')) return 'textarea';
  if (t.startsWith('DATE') || t.startsWith('TIMESTAMP') || n.endsWith('_date')) return 'date';
  if (t.startsWith('DECIMAL') || t.startsWith('INT') || t.startsWith('BIGINT') || n.includes('qty') || n.includes('amount')) return 'number';
  return 'input';
}

function selectOptionsOf(col: DBColumnSchema): string {
  const c = col.comment || '';
  const n = col.name.toLowerCase();
  if (n === 'supplier_id') {
    return '杭州极光智能数码有限公司,深圳星海光电科技有限公司,苏州云图精密配件有限公司';
  }
  const match = c.match(/\(([^)]*\/[^)]*)\)/);
  if (match && match[1] && !match[1].includes('pending')) {
    return match[1]
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(',');
  }
  return STATUS_OPTIONS;
}

function fieldObj(col: DBColumnSchema, opts: { required?: boolean } = {}): string {
  const type = fieldTypeOf(col);
  const parts = [`name: ${q(col.name)}`, `label: ${q(columnLabel(col))}`];
  if (type !== 'input') parts.push(`type: ${q(type)}`);
  if (type === 'select') parts.push(`options: ${q(selectOptionsOf(col))}`);
  if (type === 'textarea') parts.push('span: 2');
  if (opts.required ?? !col.nullable) parts.push('required: true');
  return `{ ${parts.join(', ')} }`;
}

function formFields(table: DBTableSchema, max = 8): string {
  const cols = table.columns
    .filter((c) => !c.isPrimaryKey && !/^(created_at|updated_at|is_deleted|version)$/i.test(c.name))
    .slice(0, max);
  return `[${cols.map((c) => fieldObj(c)).join(', ')}]`;
}

function queryFields(table: DBTableSchema): string {
  const cols = table.columns.filter((c) => !c.isPrimaryKey);
  const picked: DBColumnSchema[] = [];
  const add = (pred: (c: DBColumnSchema) => boolean) => {
    const c = cols.find((x) => pred(x) && !picked.includes(x));
    if (c) picked.push(c);
  };
  add((c) => /name/i.test(c.name));
  add((c) => /(_no|_code|number)$/i.test(c.name));
  add((c) => /status/i.test(c.name));
  add((c) => fieldTypeOf(c) === 'date');
  while (picked.length < 3 && picked.length < cols.length) add(() => true);
  return `[${picked.map((c) => fieldObj(c, { required: false })).join(', ')}]`;
}

function normalize(tsx: string): string {
  const res = parsePageSource(tsx);
  return res.doc ? printPageSource(res.doc) : tsx;
}

export interface ListPageOptions {
  pageId: string;
  title?: string;
  menuPath?: string[];
  relatedTable?: DBTableSchema;
  withStatusTabs?: boolean;
}

/**
 * Standard CRUD module page: query form + toolbar + table + pagination,
 * create / edit modals, detail drawer, nested related-records modal → drawer,
 * and (optional) status tabs with an approval modal.
 */
export function generateListPageSource(table: DBTableSchema, _tables: DBTableSchema[], opts: ListPageOptions): string {
  const title = opts.title || table.cnName.replace(/\s*\(.*?\)\s*/g, '').replace(/表$/, '') + '管理';
  const entity = title.replace(/管理$/, '');
  const statusCol = table.columns.find((c) => /status/i.test(c.name));
  const tabs = !!(opts.withStatusTabs && statusCol);
  const menu = opts.menuPath ?? ['业务模块', title];
  const related = opts.relatedTable && opts.relatedTable.id !== table.id ? opts.relatedTable : undefined;
  const displayFirst = defaultDisplayColumns(table, 1)[0];
  const labelField = displayFirst?.name ?? 'id';

  const rowActions = (approve: boolean) => `[
    { label: '查看', onClick: () => openDrawer('d-detail') },
    { label: '编辑', onClick: () => openModal('m-edit') },${
      approve ? `\n    { label: '审批', onClick: () => openModal('m-approve') },` : ''
    }
    { label: '删除', danger: true, onClick: () => { confirm('确定删除该${entity}吗？'); deleteRow(); toast('已删除'); } },
  ]`;

  const toolbar = `
          <Toolbar align="between" title="${entity}列表">
            <Button type="primary" icon="plus" onClick={() => openModal('m-create')}>新增${entity}</Button>
            <Button icon="download" onClick={() => toast('已导出 Excel', 'info')}>导出</Button>
          </Toolbar>`;

  const mainTable = `<Table pfId="tbl-main" table="${table.id}" selectable rowActions={${rowActions(false)}} />`;

  const listBody = tabs
    ? `
      <Card>
        <Tabs pfId="tabs-status">
          <Tab title="全部">${toolbar}
            ${mainTable}
          </Tab>
          <Tab title="待审批" badge={3}>
            <Table pfId="tbl-pending" table="${table.id}" filter={{ ${statusCol!.name}: '待审批' }} rowActions={${rowActions(true)}} />
          </Tab>
          <Tab title="已通过">
            <Table pfId="tbl-approved" table="${table.id}" filter={{ ${statusCol!.name}: '已通过' }} rowActions={${rowActions(false)}} />
          </Tab>
        </Tabs>
      </Card>`
    : `
      <Card>${toolbar}
        ${mainTable}
      </Card>`;

  const formModal = (id: string, formId: string, modalTitle: string, okToast: string) => `
      <Modal id="${id}" title="${modalTitle}" width={720} footer={false}>
        <Form pfId="${formId}" table="${table.id}" cols={2} fields={${formFields(table)}} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button type="primary" onClick={() => { submitForm('${formId}'); toast('${okToast}'); closeOverlay(); refresh('tbl-main'); }}>保存</Button>
        </Toolbar>
      </Modal>`;

  const relatedPart = related
    ? `
      <Modal id="m-related" title="关联${related.cnName.replace(/\s*\(.*?\)\s*/g, '')}" width={900} footer={false}>
        <Alert type="info" message="弹框中可以继续打开抽屉：点击行操作【查看】" />
        <Table pfId="tbl-related" table="${related.id}" pageSize={5} rowActions={[{ label: '查看', onClick: () => openDrawer('d-related-detail') }]} />
      </Modal>
      <Drawer id="d-related-detail" title="明细详情" width={480}>
        <Descriptions table="${related.id}" column={1} />
      </Drawer>`
    : '';

  const approvePart = tabs
    ? `
      <Modal id="m-approve" title="${entity}审批" width={560} footer={false}>
        <Descriptions table="${table.id}" column={2} />
        <Form pfId="form-approve" cols={1}>
          <Radio label="审批结论" name="decision" options={['通过', '驳回']} required />
          <Textarea label="审批意见" name="opinion" />
        </Form>
        <Toolbar align="right">
          <Button type="danger" onClick={() => { updateRow({ ${statusCol!.name}: '已驳回' }); toast('已驳回', 'warning'); closeOverlay(); }}>驳回</Button>
          <Button type="primary" onClick={() => { submitForm('form-approve'); updateRow({ ${statusCol!.name}: '已通过' }); toast('审批通过'); closeOverlay(); }}>通过</Button>
        </Toolbar>
      </Modal>`
    : '';

  const tsx = `// @protoflow page: ${opts.pageId}
// 模板：标准列表页（查询 + 页签 + 列表 + 分页 + 新增/编辑弹框 + 详情抽屉 + 嵌套弹层）
export default function Page() {
  return (
    <Page title="${title}" description="由 Alex 标准列表页模板生成，绑定物理表 ${table.tableName}">
      <PageHeader title="${title}" breadcrumb={[${menu.map(q).join(', ')}]} />
      <Card>
        <QueryForm target="tbl-main" cols={3} fields={${queryFields(table)}} />
      </Card>${listBody}${formModal('m-create', 'form-create', `新增${entity}`, '新增成功')}${formModal('m-edit', 'form-edit', `编辑${entity}`, '保存成功')}
      <Drawer id="d-detail" title="${entity}详情" width={560}>
        <Descriptions title="基本信息" table="${table.id}" column={2} />
        <Divider text="操作记录" />
        <Timeline items={[{ title: '创建记录', time: '2026-10-20 09:12', status: 'done' }, { title: '提交审批', time: '2026-10-21 14:30', status: 'done' }, { title: '待部门审批', time: '', status: 'current' }]} />
        <Toolbar align="right">
          ${related ? `<Button onClick={() => openModal('m-related')}>查看关联明细</Button>` : ''}
          <Button type="primary" icon="edit" onClick={() => openModal('m-edit')}>编辑</Button>
        </Toolbar>
      </Drawer>${relatedPart}${approvePart}
    </Page>
  );
}
`;
  void labelField;
  return normalize(tsx);
}

export function generateFormPageSource(table: DBTableSchema, opts: { pageId: string; title?: string }): string {
  const title = opts.title || `新增${table.cnName.replace(/\s*\(.*?\)\s*/g, '').replace(/表$/, '')}`;
  return normalize(`// @protoflow page: ${opts.pageId}
// 模板：单据表单页
export default function Page() {
  return (
    <Page title="${title}">
      <PageHeader title="${title}" back />
      <Card title="基本信息">
        <Form pfId="form-main" table="${table.id}" cols={3} fields={${formFields(table, 12)}} />
      </Card>
      <Toolbar align="center">
        <Button onClick={() => resetForm('form-main')}>重置</Button>
        <Button type="primary" onClick={() => { submitForm('form-main'); toast('提交成功'); }}>提交</Button>
      </Toolbar>
    </Page>
  );
}
`);
}

export function generateDetailPageSource(table: DBTableSchema, opts: { pageId: string; title?: string }): string {
  const title = opts.title || `${table.cnName.replace(/\s*\(.*?\)\s*/g, '').replace(/表$/, '')}详情`;
  return normalize(`// @protoflow page: ${opts.pageId}
// 模板：详情页
export default function Page() {
  return (
    <Page title="${title}">
      <PageHeader title="${title}" back />
      <Row gutter={16}>
        <Col span={8}><Statistic title="记录总数" table="${table.id}" suffix="条" /></Col>
        <Col span={8}><Statistic title="本月新增" value="12" trend="up" /></Col>
        <Col span={8}><Statistic title="待处理" value="3" trend="down" /></Col>
      </Row>
      <Card title="基本信息">
        <Descriptions table="${table.id}" column={3} />
      </Card>
      <Card title="处理记录">
        <Timeline items={[{ title: '提交', time: '2026-10-20 09:12', status: 'done' }, { title: '审批中', time: '', status: 'current' }]} />
      </Card>
    </Page>
  );
}
`);
}

export function generateMasterDetailPageSource(
  headerTable: DBTableSchema,
  detailTable: DBTableSchema,
  pickerTable: DBTableSchema | undefined,
  supplierTable: DBTableSchema | undefined,
  opts: { pageId: string; title: string; menuPath?: string[] }
): string {
  const menu = opts.menuPath ?? ['验收入库管理', opts.title];
  const pickTblId = pickerTable?.id ?? detailTable.id;
  const supTblId = supplierTable?.id ?? headerTable.id;

  return normalize(`// @protoflow page: ${opts.pageId}
// 模板：主子表复合单据页（单据头表单 + 明细表 + 弹窗选单回填 + 三级嵌套弹框/抽屉）
export default function Page() {
  return (
    <Page title="${opts.title}" description="主子表复合单据原型，支持弹窗选单回填及 Modal → Drawer → Modal 多级弹层嵌套">
      <PageHeader title="${opts.title}" subTitle="支持主表填写、采购订单弹窗选单转入、多级抽屉联查" breadcrumb={[${menu.map(q).join(', ')}] } />
      <Card>
        <Steps current={1} items={['填写验收单据头', '转入采购订单明细', '核对实收数量与税价', '提交入库闭环']} />
      </Card>
      <Card title="一、验收单据头信息 (${headerTable.tableName})" extra="必填项已做校验标记">
        <Form pfId="field-supplier-select" table="${headerTable.id}" cols={3} fields={${formFields(headerTable, 9)}} />
      </Card>
      <Card title="二、到货验收明细行 (${detailTable.tableName})" extra="支持采购订单弹窗选单与质检抽屉联查">
        <Toolbar>
          <Button pfId="btn-import-po" type="primary" icon="plus" onClick={() => { submitForm('field-supplier-select'); openModal('m-pick-po'); }}>从采购订单转入明细</Button>
          <Button icon="plus" onClick={() => openModal('m-add-line')}>手工新增明细行</Button>
          <Button icon="eye" onClick={() => openDrawer('d-supplier-profile')}>查看供方档案抽屉</Button>
        </Toolbar>
        <Table
          pfId="acceptance-detail-grid"
          table="${detailTable.id}"
          selectable
          pageSize={5}
          rowActions={[
            { label: '质检抽屉', onClick: () => openDrawer('d-line-detail') },
            { label: '编辑行', onClick: () => openModal('m-edit-line') },
            { label: '删除', danger: true, onClick: () => { confirm('确定移除该验收明细行吗？'); deleteRow(); toast('已移除明细行'); } },
          ]}
        />
      </Card>
      <Toolbar align="right">
        <Button onClick={() => { resetForm('field-supplier-select'); toast('已重置单据头', 'info'); }}>重置表单</Button>
        <Button onClick={() => { submitForm('field-supplier-select'); toast('草稿已保存', 'info'); }}>暂存草稿</Button>
        <Button pfId="btn-submit-acceptance" type="primary" icon="check" onClick={() => { submitForm('field-supplier-select'); toast('验收单已提交入库！'); }}>提交验收单</Button>
      </Toolbar>
      <Modal id="m-pick-po" title="选择待转入采购订单明细（一级弹框 → 可继续打开二级抽屉）" width={920} footer={false}>
        <Alert type="info" message="提示：勾选采购订单行后点击底部【转入选中明细】；也可点击行右侧【供方档案】在当前弹框之上继续打开二级抽屉！" />
        <QueryForm target="tbl-po-picker" cols={3} fields={${queryFields(pickerTable ?? detailTable)}} />
        <Table
          pfId="tbl-po-picker"
          table="${pickTblId}"
          selectable
          pageSize={5}
          rowActions={[
            { label: '供方档案(二级抽屉)', onClick: () => openDrawer('d-supplier-profile') },
            { label: '质检标准(三级弹框)', onClick: () => openModal('m-qc-spec') },
          ]}
        />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button type="primary" icon="check" onClick={() => { importPurchaseOrderLines('tbl-po-picker', 'acceptance-detail-grid', 'field-supplier-select'); closeOverlay(); }}>转入选中明细</Button>
        </Toolbar>
      </Modal>
      <Modal id="m-add-line" title="手工新增验收明细行" width={680} footer={false}>
        <Form pfId="form-add-line" table="${detailTable.id}" cols={2} fields={${formFields(detailTable, 8)}} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button type="primary" onClick={() => { submitForm('form-add-line'); toast('已新增验收明细行'); closeOverlay(); refresh('acceptance-detail-grid'); }}>确认添加</Button>
        </Toolbar>
      </Modal>
      <Modal id="m-edit-line" title="编辑验收明细行" width={680} footer={false}>
        <Form pfId="form-edit-line" table="${detailTable.id}" cols={2} fields={${formFields(detailTable, 8)}} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button type="primary" onClick={() => { submitForm('form-edit-line'); toast('明细行已更新'); closeOverlay(); refresh('acceptance-detail-grid'); }}>保存修改</Button>
        </Toolbar>
      </Modal>
      <Drawer id="d-line-detail" title="验收明细行质检详情（抽屉内可再调起弹框）" width={540}>
        <Descriptions title="明细行字段信息" table="${detailTable.id}" column={2} />
        <Divider text="抽检操作" />
        <Toolbar align="right">
          <Button onClick={() => openModal('m-qc-spec')}>打开物料质检标准弹框</Button>
          <Button type="primary" onClick={() => openModal('m-edit-line')}>编辑此行</Button>
        </Toolbar>
      </Drawer>
      <Drawer id="d-supplier-profile" title="供应商主数据资质档案（二级嵌套抽屉）" width={560}>
        <Alert type="success" message="当前处于嵌套抽屉中，您还可以点击下方按钮继续弹出第三层【物料质检标准】弹框！" />
        <Descriptions title="供应商工商与税务档案" table="${supTblId}" column={2} />
        <Divider text="近期履约记录" />
        <Timeline items={[{ title: '年度资质年审通过', time: '2026-09-01 10:00', status: 'done' }, { title: '首批集采合同签署', time: '2026-10-12 15:20', status: 'done' }, { title: '本次到货验收流转中', time: '当前', status: 'current' }]} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>关闭抽屉</Button>
          <Button type="primary" onClick={() => openModal('m-qc-spec')}>调起三级弹框：物料质检标准</Button>
        </Toolbar>
      </Drawer>
      <Modal id="m-qc-spec" title="国家/企业物料质检标准规范（三级嵌套弹框）" width={600} footer={false}>
        <Alert type="warning" message="三级弹层演示：主页面 → 一级选单弹框 → 二级供方抽屉 → 三级质检标准弹框" />
        <Descriptions
          title="质检抽样与允收标准 (AQL)"
          items={[
            { label: '检验标准号', value: 'GB/T 2828.1-2012' },
            { label: '抽样水平', value: '一般检验水平 II' },
            { label: '合格质量限 (AQL)', value: '主缺陷 0.65 / 次缺陷 2.5' },
            { label: '单价容差上限', value: '±0.50% (超出自动触发审计预警)' },
          ]}
          column={2}
        />
        <Toolbar align="right">
          <Button type="primary" onClick={() => closeOverlay()}>我已知晓，返回上一层</Button>
        </Toolbar>
      </Modal>
    </Page>
  );
}
`);
}

export function generateBlankPageSource(opts: { pageId: string; title: string; platform?: PagePlatform }): string {
  if (opts.platform === 'mobile') {
    return generateBlankMobilePageSource(opts);
  }
  return normalize(`// @protoflow page: ${opts.pageId}
export default function Page() {
  return (
    <Page title="${opts.title}">
      <PageHeader title="${opts.title}" />
      <Card title="内容区">
        <Empty description="从左侧物料库拖入组件开始设计" />
      </Card>
    </Page>
  );
}
`);
}

export function generateBlankMobilePageSource(opts: { pageId: string; title: string }): string {
  return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="back" rightIcon="avatar" />
      <MSurface title={${JSON.stringify(opts.title)}} subtitle="Gemini 现代移动页面 · 可从左侧拖入 M* 移动物料">
        <MButton variant="tonal" block={true}>开始体验</MButton>
      </MSurface>
    </MobilePage>
  );
}
`);
}

export type PageTemplateKind =
  | 'list'
  | 'master_detail'
  | 'form'
  | 'detail'
  | 'blank'
  | 'mobile_explore'
  | 'mobile_workspace'
  | 'mobile_ai'
  | 'mobile_form'
  | 'mobile_profile';

export const PAGE_TEMPLATES: { kind: PageTemplateKind; title: string; description: string; needsTable: boolean }[] = [
  { kind: 'list', title: '标准列表页', description: '查询条件 + 页签 + 列表 + 分页 + 新增/编辑弹框 + 详情抽屉', needsTable: true },
  { kind: 'master_detail', title: '主子表复合单据页', description: '单据头表单 + 明细表 + 弹窗选单回填 + 三级嵌套弹框/抽屉', needsTable: true },
  { kind: 'form', title: '单据表单页', description: '多列表单 + 提交/重置', needsTable: true },
  { kind: 'detail', title: '详情页', description: '指标卡 + 描述列表 + 处理记录', needsTable: true },
  { kind: 'blank', title: '空白页', description: '从零开始拖拽设计', needsTable: false },
];

export const MOBILE_PAGE_TEMPLATES: { kind: PageTemplateKind; title: string; description: string; needsTable: boolean }[] = [
  { kind: 'mobile_explore', title: 'C端探索/商城首页', description: '流光问候头 + 胶囊搜索 + Bento 宫格 + 瀑布流卡片 + 规格半屏抽屉 + 悬浮底栏', needsTable: false },
  { kind: 'mobile_workspace', title: 'B端移动审批/待办页', description: '趋势指标卡 + 胶囊状态切换 + 业务单据流 + 详情与新建半屏抽屉', needsTable: true },
  { kind: 'mobile_ai', title: 'Gemini 智能助手页', description: '顶部模型切换顶栏 + 对话消息流 + 启发磁贴 + 底部多模态胶囊输入舱', needsTable: false },
  { kind: 'mobile_form', title: '移动端触控录入页', description: '48px 柔和填充式输入框 + 半屏选择器 + 胶囊点选组 + 底部悬浮提交坞', needsTable: true },
  { kind: 'mobile_profile', title: '现代个人中心页', description: '品牌视觉头卡 + 快捷 Bento 磁贴 + 圆角分组列表 + 悬浮胶囊底栏', needsTable: false },
  { kind: 'blank', title: '空白移动页', description: '极简顶栏 + 空白移动画布，从零自由搭建', needsTable: false },
];

function generateMobileFromTemplate(
  kind: PageTemplateKind,
  table: DBTableSchema | undefined,
  tables: DBTableSchema[],
  opts: { pageId: string; title: string }
): string {
  if (kind === 'blank') return generateBlankMobilePageSource(opts);
  const cols = table ? defaultDisplayColumns(table, 4) : [];
  const firstCol = cols[0]?.name;
  const secondCol = cols[1]?.name;
  const relations = table ? diagramRelations(tables).relations : [];
  const editableCols = table?.columns.filter(c => !c.isPrimaryKey && !c.defaultValue);
  const fieldsTsx = editableCols && table
    ? editableCols.map((c) => {
        const labelLit = JSON.stringify(columnLabel(c));
        const nameLit = JSON.stringify(c.name);
        const req = !c.nullable;
        if (c.isForeignKey || c.references) {
          const rel = relations.find((edge) => edge.toTableId === table.id && edge.toColumnId === c.id);
          const fromTable = rel ? tables.find((t) => t.id === rel.fromTableId) : undefined;
          if (rel && fromTable) {
            const displayCol = defaultDisplayColumns(fromTable, 1)[0]?.name || rel.fromColumnName;
            return `<MSheetPicker label={${labelLit}} name={${nameLit}} table={${JSON.stringify(fromTable.id)}} labelField={${JSON.stringify(displayCol)}} valueField={${JSON.stringify(rel.fromColumnName)}} required={${req}} />`;
          }
        }
        if (/^(DATE|TIMESTAMP|DATETIME)/i.test(c.dataType) || /_date$/i.test(c.name)) {
          return `<MSheetPicker label={${labelLit}} name={${nameLit}} mode="date" required={${req}} />`;
        }
        if (/^TIME/i.test(c.dataType)) {
          return `<MSheetPicker label={${labelLit}} name={${nameLit}} mode="time" required={${req}} />`;
        }
        if (/remark|desc/i.test(c.name) || (c.comment || '').includes('备注')) {
          return `<MField label={${labelLit}} name={${nameLit}} multiline={true} required={${req}} />`;
        }
        const inputType = /^(DECIMAL|NUMERIC|INT|BIGINT|SMALLINT|FLOAT|DOUBLE)/i.test(c.dataType) ? 'number' : 'text';
        return `<MField label={${labelLit}} name={${nameLit}} inputType="${inputType}" required={${req}} />`;
      }).join('\n        ')
    : '<MField label="标题名称" name="name" required={true} />';

  if (kind === 'mobile_ai') {
    return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="sparkle" titleDropdown={true} rightIcon="avatar" />
      <MHeroHeader mode="greeting" eyebrow="Gemini 移动智能体" title="你好，Alex" subtitle="我可以帮你检索业务数据、生成洞察或起草方案" />
      <MBentoGrid cols={2} layout="equal" items={[
        { title: '智能经营总结', subtitle: '一键汇总核心指标趋势', icon: 'Sparkles', badge: 'AI', tone: 'violet' },
        { title: '异常单据筛查', subtitle: '定位超期与高风险环节', icon: 'Zap', tone: 'blue' }
      ]} />
      <MChatStream assistantName="Gemini" messages={[
        { role: 'user', title: '帮我看看今天有哪些重点关注事项？' },
        { role: 'assistant', title: '已为你梳理今日重点：当前业务流转平稳，建议优先确认高优审批事项。', highlight: '提示：点击底部输入舱可继续追问或发送语音指令。' }
      ]} />
      <MComposerBar placeholder="向 Gemini 提问或输入指令..." suggestions="总结今日待办,生成周报摘要,分析转化趋势" docked={true} onSend={() => toast('已发送指令')} />
    </MobilePage>
  );
}
`);
  }

  if (kind === 'mobile_profile') {
    return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="none" rightIcon="bell" />
      <MHeroHeader mode="banner" eyebrow="PRO 会员空间" title="Alex · 数字化工作台" subtitle="多端数据实时同步 · 现代移动体验" actionText="会员权益" onAction={() => openModal('dlg-member')} />
      <MBentoGrid cols={2} layout="equal" items={[
        { title: '我的待办', subtitle: '待处理事项 3 项', icon: 'Layers', badge: '3', tone: 'blue' },
        { title: '我的收藏', subtitle: '已保存 12 项内容', icon: 'Bookmark', tone: 'violet' }
      ]} />
      <MListGroup title="偏好与账户安全" items={[
        { title: '工作空间切换', value: '默认空间', icon: 'Compass', arrow: true },
        { title: '消息推送提醒', value: '已开启', icon: 'Bell', arrow: true },
        { title: '隐私与安全保护', value: '已认证', icon: 'Shield', arrow: true }
      ]} />
      <MTabBar variant="floating" activeKey="mine" items={[
        { key: 'home', title: '首页', icon: 'Sparkles' },
        { key: 'tasks', title: '事项', icon: 'Layers' },
        { key: 'mine', title: '我的', icon: 'User' }
      ]} />
      <MDialog id="dlg-member" title="会员权益已开启" description="已为你解锁全部跨端组件与同源物理表实时预览能力。" confirmText="我知道了" />
    </MobilePage>
  );
}
`);
  }

  if (kind === 'mobile_form' || kind === 'form') {
    return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="back" rightIcon="more" />
      <MForm pfId="mform-main" ${table ? `table="${table.id}" ` : ''}title="填写基本信息">
        ${fieldsTsx}
      </MForm>
      <MBottomDock mode="action" secondaryText="重置" primaryText="确认提交" onSecondary={() => { resetForm('mform-main'); toast('已重置', 'info'); }} onPrimary={() => { submitForm('mform-main'); toast('提交成功'); }} />
    </MobilePage>
  );
}
`);
  }

  if (kind === 'mobile_workspace' || kind === 'list' || kind === 'master_detail' || kind === 'detail') {
    const fieldItems = cols
      .slice(1, 4)
      .map((c) => `{ dataIndex: ${q(c.name)}, title: ${q(columnLabel(c))} }`)
      .join(', ');
    return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="back" rightIcon="plus" onRightClick={() => openDrawer('sheet-create')} />
      <MStatCard title="当前事项概览" value="18" unit="项" trend="+12.5%" trendTone="up" sparkline={true} />
      <MSearchPill placeholder="搜索关键词..." target="mtask-main" showFilter={false} />
      <MTaskList
        pfId="mtask-main"
        ${table ? `table="${table.id}" ${firstCol ? `titleField={${JSON.stringify(firstCol)}} ` : ''}${fieldItems ? `fields={[${fieldItems}]} ` : ''}` : ''}
        rowActions={[
          { label: '详情', onClick: () => openDrawer('sheet-detail') }
        ]}
        onCardClick={() => openDrawer('sheet-detail')}
      />
      <MTabBar variant="floating" activeKey="tasks" items={[
        { key: 'home', title: '探索', icon: 'Sparkles' },
        { key: 'tasks', title: '事项', icon: 'Layers', badge: '3' },
        { key: 'mine', title: '我的', icon: 'User' }
      ]} />
      <MBottomSheet id="sheet-detail" title={${JSON.stringify(opts.title + '详情')}} size="medium">
        <MListGroup title="单据详情" ${table ? `table="${table.id}" ` : ''}/>
        <MBottomDock mode="action" primaryText="关闭" onPrimary={() => closeOverlay()} />
      </MBottomSheet>
      <MBottomSheet id="sheet-create" title="新建记录" size="tall">
        <MForm pfId="mform-create" ${table ? `table="${table.id}" ` : ''}>
          ${fieldsTsx}
        </MForm>
        <MBottomDock mode="action" secondaryText="取消" primaryText="保存提交" onSecondary={() => closeOverlay()} onPrimary={() => { submitForm('mform-create'); toast('已保存'); closeOverlay(); }} />
      </MBottomSheet>
    </MobilePage>
  );
}
`);
  }

  // Default: mobile_explore (C-end + B-end modern feed)
  return normalize(`// @protoflow page: ${opts.pageId}
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title={${JSON.stringify(opts.title)}} accent="gemini" surfaceBg="mist">
      <MTopBar title={${JSON.stringify(opts.title)}} leftMode="sparkle" titleDropdown={true} rightIcon="avatar" />
      <MHeroHeader mode="greeting" eyebrow="AI 驱动现代体验" title="你好，Alex" subtitle="欢迎体验 Gemini 风格移动端界面" />
      <MSearchPill placeholder="搜索精选内容或服务..." target="mfeed-main" showFilter={true} filterOverlay="sheet-pick" />
      <MBentoGrid cols={2} layout="equal" items={[
        { title: '智能推荐', subtitle: '个性化精选内容流', icon: 'Sparkles', badge: 'HOT', tone: 'violet' },
        { title: '快捷预约', subtitle: '极速响应一键直达', icon: 'Zap', tone: 'blue' }
      ]} />
      <MSurface title="热门推荐" extra="更多" tone="card" onExtraClick={() => openDrawer('sheet-pick')}>
        <MFeedList
          pfId="mfeed-main"
          ${table ? `table="${table.id}" ${firstCol ? `titleField={${JSON.stringify(firstCol)}} ` : ''}${secondCol ? `subtitleField="${secondCol}" ` : ''}` : ''}
          layout="waterfall"
          actionText="查看"
          onItemClick={() => openDrawer('sheet-pick')}
        />
      </MSurface>
      <MTabBar variant="floating" activeKey="home" items={[
        { key: 'home', title: '探索', icon: 'Sparkles' },
        { key: 'tasks', title: '事项', icon: 'Layers' },
        { key: 'mine', title: '我的', icon: 'User' }
      ]} />
      <MBottomSheet id="sheet-pick" title="选择规格与偏好" size="medium">
        <MForm pfId="mform-pick">
          <MChipSelect label="规格选项" name="spec" options="标准版,Pro 进阶版,旗舰尊享版" />
        </MForm>
        <MBottomDock mode="commerce" summaryLabel="尊享价" price="¥299.00" primaryText="立即确认" onPrimary={() => { submitForm('mform-pick'); toast('操作成功'); closeOverlay(); }} />
      </MBottomSheet>
    </MobilePage>
  );
}
`);
}

export function generateFromTemplate(
  kind: PageTemplateKind,
  table: DBTableSchema | undefined,
  tables: DBTableSchema[],
  opts: { pageId: string; title: string; menuPath?: string[]; platform?: PagePlatform }
): string {
  if (opts.platform === 'mobile' || kind.startsWith('mobile_')) {
    return generateMobileFromTemplate(kind, table, tables, opts);
  }
  if (kind === 'blank' || !table) return generateBlankPageSource(opts);
  if (kind === 'form') return generateFormPageSource(table, opts);
  if (kind === 'detail') return generateDetailPageSource(table, opts);
  if (kind === 'master_detail') {
    const detail = tables.find((t) => t.id !== table.id && t.tableName.includes('detail')) ?? tables.find((t) => t.id !== table.id) ?? table;
    const picker = tables.find((t) => t.id === 't_pms_po_item') ?? detail;
    const sup = tables.find((t) => t.id === 't_base_supplier');
    return generateMasterDetailPageSource(table, detail, picker, sup, opts);
  }
  const related = tables.find((t) => t.id !== table.id && t.columns.some((c) => c.references?.includes(table.id)));
  return generateListPageSource(table, tables, {
    ...opts,
    relatedTable: related,
    withStatusTabs: table.columns.some((c) => /status/i.test(c.name)),
  });
}
