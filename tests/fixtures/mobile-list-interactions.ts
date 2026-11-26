import type { DBTableSchema } from '../../src/store/useProtoStore';

export const MOBILE_TEST_TABLES: DBTableSchema[] = [
  {
    id: 't_milestones',
    tableName: 'ops_milestones',
    cnName: '巡检里程碑表',
    domain: '业务单据',
    description: '区域巡检与备件达成进度',
    sharedByMenus: [],
    columns: [
      { id: 'cm_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
      { id: 'cm_name', name: 'milestone_name', dataType: 'VARCHAR(128)', nullable: false, comment: '分项名称' },
      { id: 'cm_val', name: 'progress_pct', dataType: 'INT', nullable: true, comment: '当前进度' },
      { id: 'cm_target', name: 'target_pct', dataType: 'INT', nullable: true, comment: '计划目标' },
      { id: 'cm_status', name: 'health_status', dataType: "ENUM('正常','风险')", nullable: false, comment: '状态' },
    ],
  },
  {
    id: 't_ledger',
    tableName: 'ops_part_ledger',
    cnName: '备件出入库流水表',
    domain: '业务单据',
    description: '现场备件领用与退库金额流水',
    sharedByMenus: [],
    columns: [
      { id: 'cl_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
      { id: 'cl_title', name: 'item_title', dataType: 'VARCHAR(128)', nullable: false, comment: '流水标题' },
      { id: 'cl_time', name: 'biz_time', dataType: 'VARCHAR(64)', nullable: false, comment: '发生时间' },
      { id: 'cl_price', name: 'unit_price', dataType: 'DECIMAL(10,2)', nullable: true, comment: '备件单价' },
      { id: 'cl_amt', name: 'delta_amount', dataType: 'VARCHAR(64)', nullable: true, comment: '变动金额' },
      { id: 'cl_dir', name: 'direction', dataType: "ENUM('入库','领用')", nullable: false, comment: '方向' },
    ],
  },
  {
    id: 't_sub_logs',
    tableName: 'ops_ledger_logs',
    cnName: '流水核销子记录表',
    domain: '业务单据',
    description: '单条流水关联核销记录',
    sharedByMenus: [],
    columns: [
      { id: 'cs_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
      {
        id: 'cs_fk',
        name: 'ledger_id',
        dataType: 'VARCHAR(64)',
        nullable: false,
        isForeignKey: true,
        references: 'ops_part_ledger(id)',
        foreignKeyOptions: { name: 'fk_sub_logs_ledger', cardinality: '1:N', onDelete: 'CASCADE' },
        comment: '所属流水',
      },
      { id: 'cs_title', name: 'log_title', dataType: 'VARCHAR(128)', nullable: false, comment: '核销说明' },
      { id: 'cs_qty', name: 'qty_text', dataType: 'VARCHAR(64)', nullable: false, comment: '数量' },
    ],
  },
];

export function interactionRows() {
  return {
    t_ledger: [{ id: 'parent', item_title: 'Parent ledger', biz_time: '09:00', delta_amount: '-13.00', direction: '入库' }],
    t_sub_logs: [{ id: 'detail', ledger_id: 'parent', log_title: 'Parent detail', qty_text: '2' }],
    t_milestones: [],
  };
}

export const interactionSource = `export default function Page() {
  return (<MobilePage pfId="page" appearance="dark" motion="smooth">
    <MProgressList pfId="progress" items={[{label:"Inventory",value:60}]} />
    <MActivityList pfId="ledger" table="t_ledger" titleField="item_title" amountField="delta_amount"
      typeField="direction" autoSelectFirst={true} onItemClick={() => openDrawer("parent-sheet")}
      rowActions={[
        {label:"First inventory action",onClick:()=>toast("Action 1")},
        {label:"Second inventory action",onClick:()=>toast("Action 2")},
        {label:"Third inventory action",onClick:()=>toast("Action 3")},
        {label:"Fourth inventory action",onClick:()=>toast("Action 4")}
      ]} />
    <MBottomSheet pfId="parent-sheet" id="parent-sheet" title="Parent">
      <MActivityList pfId="bound-details" table="t_sub_logs" titleField="log_title" amountField="qty_text" sourceForeignKey="ledger_id" />
      <MActivityList pfId="static-activity" items={[{title:"New entry",amount:"1"}]} onItemClick={()=>openDrawer("create")} />
      <MProgressList pfId="static-progress" items={[{label:"New entry",value:50,onClick:()=>openDrawer("create")}]} />
    </MBottomSheet>
    <MBottomSheet pfId="create" id="create" title="Create">
      <MActivityList pfId="create-details" table="t_sub_logs" titleField="log_title" amountField="qty_text" sourceForeignKey="ledger_id" emptyText="No linked rows" />
      <MListItem pfId="more" title="More details" onClick={()=>openModal("nested")} />
      <MForm pfId="form" table="t_ledger">
        <MField pfId="title" name="item_title" label="Title" required={true} />
        <MField pfId="time" name="biz_time" label="Time" />
        <MField pfId="direction" name="direction" label="Direction" />
      </MForm>
      <MBottomDock pfId="save" primaryText="Save" onPrimary={()=>{submitForm("form");closeOverlay()}} />
    </MBottomSheet>
    <MDialog pfId="nested" id="nested" title="Nested">
      <MActivityList pfId="nested-details" table="t_sub_logs" titleField="log_title" amountField="qty_text" sourceForeignKey="ledger_id" emptyText="No linked rows" />
    </MDialog>
  </MobilePage>);
}`;
