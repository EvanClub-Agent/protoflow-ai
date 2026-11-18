import { createProjectPayload } from '../../src/services/projectStorage';
import type { DBTableSchema } from '../../src/store/useProtoStore';

export const expenseTables: DBTableSchema[] = [
  {id:'expenses',tableName:'expense_headers',cnName:'报销单',domain:'费用',description:'每条记录一张报销单',sharedByMenus:[{pageId:'oa-pc-expenses',menuTitle:'报销单',accessMode:'CRUD 读写',fieldMappingNote:'报销单录入'}],columns:[
    {id:'expense-key',name:'expense_no',dataType:'INTEGER',isPrimaryKey:true,nullable:false,comment:'真实报销单号'},
    {id:'expense-title',name:'title',dataType:'VARCHAR(64)',nullable:false,comment:'标题'},
  ]},
  {id:'expense-lines',tableName:'expense_items',cnName:'费用明细',domain:'费用',description:'每条记录一项费用',sharedByMenus:[],columns:[
    {id:'line-key',name:'id',dataType:'VARCHAR(64)',isPrimaryKey:true,nullable:false,comment:'明细编号'},
    {id:'expense-reference',name:'expense_no',dataType:'INTEGER',nullable:false,isForeignKey:true,references:'expense_headers(expense_no)',comment:'所属报销单'},
    {id:'line-title',name:'title',dataType:'VARCHAR(64)',nullable:false,comment:'费用内容'},
    {id:'line-checked',name:'checked',dataType:'BOOLEAN',nullable:false,comment:'已核对'},
  ]},
];
export const expenseRows = {
  expenses:[{id:'runtime-A',expense_no:0,title:'报销单甲'},{id:'runtime-B',expense_no:1,title:'报销单乙'}],
  'expense-lines':[{id:'line-A1',expense_no:0,title:'甲单交通费',checked:false},{id:'line-A2',expense_no:0,title:'甲单住宿费',checked:false},{id:'line-B1',expense_no:1,title:'乙单餐费',checked:false}],
};
export const expenseDetailSource = (type:'MTaskList'|'MFeedList'='MTaskList', scoped=true) => `<${type} pfId="expense-detail" table="expense-lines" titleField="title" ${scoped?'sourceForeignKey="expense_no"':''} ${type==='MTaskList'?'fields={[{dataIndex:"title",title:"费用"}]}':'layout="media"'}/>`;
export const expenseMobileSource = (detail=expenseDetailSource()) => `export default function Page(){return <MobilePage pfId="mobile-root" title="移动审批中心">
  <MTopBar pfId="topbar" title="移动审批中心"/>
  <MTaskList pfId="expense-list" table="expenses" titleField="title" onCardClick={()=>openDrawer("expense-sheet")} rowActions={[{label:"跨页明细",onClick:()=>navigate("oa-m-detail","row")}]} />
  <MBottomSheet pfId="sheet" id="expense-sheet" title="当前报销明细">${detail}</MBottomSheet>
</MobilePage>}`;
export function expenseFixture() {
  const payload=createProjectPayload({projectId:'expense-detail-regression',projectName:'报销明细隔离回归',templateId:'blank_project',projectMode:'hybrid',storageDir:'/tmp',fileName:'expense-details.pflow',createdAt:'2026-11-13',updatedAt:'2026-11-13',pageCount:0,tableCount:0,stickyCount:0});
  const s=payload.stateSnapshot;
  s.dbTables=structuredClone(expenseTables);s.tableRows=structuredClone(expenseRows);s.activePageId='oa-m-approvals';
  s.designerFolders=[{id:'expense-folder',title:'费用',parentFolderId:null}];
  s.designerPages=[{pageId:'oa-pc-expenses',title:'报销单',platform:'desktop',folderId:'expense-folder'},{pageId:'oa-m-approvals',title:'移动审批中心',platform:'mobile',folderId:'expense-folder'},{pageId:'oa-m-detail',title:'报销明细',platform:'mobile',folderId:'expense-folder'}];
  s.pageSources={
    'oa-pc-expenses':'export default function Page(){return <Page pfId="desktop-root"><Table pfId="expense-table" table="expenses" rowActions={[{label:"移动查看",onClick:()=>navigate("oa-m-detail","row")}]} /></Page>}',
    'oa-m-approvals':expenseMobileSource('<MListGroup pfId="pending"><MListItem pfId="pending-text" title="明细尚未接入"/></MListGroup>'),
    'oa-m-detail':`export default function Page(){return <MobilePage pfId="detail-root"><MTopBar pfId="detail-top" title="报销明细"/>${expenseDetailSource('MFeedList')}</MobilePage>}`,
  };
  s.projectPlan={summary:'按当前报销单核对费用明细',approved:true,folders:[],generatedPageIds:['oa-pc-expenses'],pages:s.designerPages.map(p=>({...p,requirements:p.title,
    dependencies:p.pageId==='oa-m-approvals'?[{kind:'foreignKey',sourcePageId:'oa-pc-expenses',sourceTableId:'expenses',sourceColumnId:'expense-key',tableId:'expense-lines',foreignKeyColumnId:'expense-reference',requirement:'查看当前报销明细'}]:[],
    acceptanceCases:p.pageId==='oa-m-approvals'?[{scenario:'查看当前报销明细',expected:'打开当前单据费用明细弹层',actionPfId:'expense-list',actionEvent:'onCardClick',actionKind:'openOverlay',targetId:'expense-sheet'}]:[],
  }))};
  return payload;
}
