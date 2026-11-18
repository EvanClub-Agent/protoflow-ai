import type { DBTableSchema } from '../../store/useProtoStore';
import type { DesignerFolder } from '../sitemap';
import type { DesignerPage } from '../store/usePageStore';
import type { Row } from '../runtime/mock';
import { parsePageSource } from '../dsl/parser';
import { printPageSource } from '../dsl/printer';
import { reassignIds } from '../dsl/tree';
import { generateListPageSource } from '../ai/templates';

function norm(tsx: string): string {
  const res = parsePageSource(tsx);
  if (!res.doc) return tsx;
  res.doc.root = reassignIds(res.doc.root);
  return printPageSource(res.doc);
}

export function createCrmStarterDataset(): {
  dbTables: DBTableSchema[];
  tableRows: Record<string, Row[]>;
  designerFolders: DesignerFolder[];
  designerPages: DesignerPage[];
  pageSources: Record<string, string>;
  entryPageId: string;
} {
  const customersTable: DBTableSchema = {
    id: 't_crm_customers',
    tableName: 't_crm_customers',
    cnName: '企业客户与商机表',
    domain: '客户增长域 (CRM)',
    description: '承载企业客户线索、销售漏斗阶段与区域年度订阅额（ARR），同时支撑销售看板聚合图表与客户列表 CRUD',
    sharedByMenus: [
      {
        pageId: 'crm-dashboard',
        menuTitle: 'CRM 销售中心 → 销售数据看板',
        accessMode: 'READ 查询',
        fieldMappingNote: '按区域汇总客户 ARR 规模与统计总客户数',
      },
      {
        pageId: 'crm-customers',
        menuTitle: 'CRM 销售中心 → 企业客户与商机台账',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '支持客户多条件检索、新增客户商机、编辑与跟进审批',
      },
    ],
    columns: [
      { id: 'c_crm_id', name: 'id', dataType: 'VARCHAR(36)', nullable: false, isPrimaryKey: true, comment: '主键ID' },
      { id: 'c_crm_code', name: 'customer_code', dataType: 'VARCHAR(40)', nullable: false, comment: '客户编号' },
      { id: 'c_crm_name', name: 'company_name', dataType: 'VARCHAR(120)', nullable: false, comment: '企业名称' },
      { id: 'c_crm_region', name: 'region', dataType: 'VARCHAR(32)', nullable: false, comment: '所属大区(华东/华南/华北/西南)' },
      { id: 'c_crm_owner', name: 'owner_name', dataType: 'VARCHAR(60)', nullable: false, comment: '负责人' },
      { id: 'c_crm_arr', name: 'annual_arr', dataType: 'DECIMAL(12,2)', nullable: false, comment: '预计年订阅额(元)' },
      { id: 'c_crm_status', name: 'status', dataType: 'VARCHAR(32)', nullable: false, comment: '商机状态(待审批/已通过/已驳回/草稿)' },
    ],
  };

  const revenueTable: DBTableSchema = {
    id: 't_crm_monthly_revenue',
    tableName: 't_crm_monthly_revenue',
    cnName: '月度销售业绩趋势表',
    domain: '数据分析域 (BI)',
    description: '按月记录团队实际签约额与目标额，驱动销售看板折线趋势图',
    sharedByMenus: [
      {
        pageId: 'crm-dashboard',
        menuTitle: 'CRM 销售中心 → 销售数据看板',
        accessMode: 'READ 查询',
        fieldMappingNote: '折线图绑定 month_label 与 signed_amount / target_amount 双指标对比',
      },
    ],
    columns: [
      { id: 'c_rev_id', name: 'id', dataType: 'VARCHAR(36)', nullable: false, isPrimaryKey: true, comment: '主键ID' },
      { id: 'c_rev_month', name: 'month_label', dataType: 'VARCHAR(20)', nullable: false, comment: '统计月份' },
      { id: 'c_rev_signed', name: 'signed_amount', dataType: 'DECIMAL(12,2)', nullable: false, comment: '实际签约额(万元)' },
      { id: 'c_rev_target', name: 'target_amount', dataType: 'DECIMAL(12,2)', nullable: false, comment: '月度目标额(万元)' },
    ],
  };

  const dbTables: DBTableSchema[] = [customersTable, revenueTable];

  const tableRows: Record<string, Row[]> = {
    t_crm_customers: [
      { id: 'cust-1', customer_code: 'CUS-2026-001', company_name: '星云智造科技有限公司', region: '华东', owner_name: '林思远', annual_arr: 186000, status: '已通过' },
      { id: 'cust-2', customer_code: 'CUS-2026-002', company_name: '深蓝互动数字传媒', region: '华南', owner_name: '陈雨桐', annual_arr: 128000, status: '待审批' },
      { id: 'cust-3', customer_code: 'CUS-2026-003', company_name: '远景云端软件股份', region: '华北', owner_name: '王海涛', annual_arr: 245000, status: '已通过' },
      { id: 'cust-4', customer_code: 'CUS-2026-004', company_name: '锦城新零售供应链集团', region: '西南', owner_name: '周敏', annual_arr: 96000, status: '待审批' },
      { id: 'cust-5', customer_code: 'CUS-2026-005', company_name: '极光智能硬件实验室', region: '华东', owner_name: '林思远', annual_arr: 152000, status: '已通过' },
    ],
    t_crm_monthly_revenue: [
      { id: 'rev-1', month_label: '2026-06', signed_amount: 118, target_amount: 110 },
      { id: 'rev-2', month_label: '2026-07', signed_amount: 135, target_amount: 125 },
      { id: 'rev-3', month_label: '2026-08', signed_amount: 142, target_amount: 140 },
      { id: 'rev-4', month_label: '2026-09', signed_amount: 168, target_amount: 150 },
      { id: 'rev-5', month_label: '2026-10', signed_amount: 195, target_amount: 170 },
      { id: 'rev-6', month_label: '2026-11', signed_amount: 226, target_amount: 200 },
    ],
  };

  const designerFolders: DesignerFolder[] = [
    { id: 'fld-crm-main', title: 'CRM 销售中心', parentFolderId: null },
  ];

  const dashboardSource = norm(`// @protoflow page: crm-dashboard
export default function Page() {
  return (
    <Page title="销售数据看板" description="实时汇总企业客户 ARR 与月度签约业绩趋势">
      <PageHeader title="CRM 销售业绩与漏斗看板" breadcrumb={['CRM 销售中心', '销售数据看板']} />
      <Toolbar align="between">
        <Tag color="blue">数据实时绑定工程物理表 t_crm_customers / t_crm_monthly_revenue</Tag>
        <Button type="primary" onClick={() => navigate('crm-customers')}>管理客户与商机台账</Button>
      </Toolbar>
      <Row gutter={16}>
        <Col span={8}><Statistic title="企业客户总数" table="t_crm_customers" suffix="家" /></Col>
        <Col span={8}><Statistic title="本季度目标达成率" value="113.0%" trend="up" /></Col>
        <Col span={8}><Statistic title="活跃跟进商机" value="18" suffix="个" trend="up" /></Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Card title="月度实际签约 vs 目标趋势">
            <LineChart
              title="月度签约趋势 (万元)"
              source="table"
              table="t_crm_monthly_revenue"
              dimension="month_label"
              metrics={[
                { field: 'signed_amount', label: '实际签约额' },
                { field: 'target_amount', label: '月度目标额' }
              ]}
              smooth={true}
              height={280}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="各大区客户预计 ARR 分布">
            <BarChart
              title="区域订阅规模汇总 (元)"
              source="table"
              table="t_crm_customers"
              dimension="region"
              metrics={[{ field: 'annual_arr', label: '预计年订阅额' }]}
              aggregation="sum"
              palette="blue"
              height={280}
            />
          </Card>
        </Col>
      </Row>
    </Page>
  );
}
`);

  const customersSource = generateListPageSource(customersTable, dbTables, {
    pageId: 'crm-customers',
    title: '企业客户与商机台账',
    menuPath: ['CRM 销售中心', '企业客户与商机台账'],
    withStatusTabs: true,
  });

  const pageSources: Record<string, string> = {
    'crm-dashboard': dashboardSource,
    'crm-customers': customersSource,
  };

  const designerPages: DesignerPage[] = [
    { pageId: 'crm-dashboard', title: '销售数据看板', folderId: 'fld-crm-main', platform: 'desktop' },
    { pageId: 'crm-customers', title: '企业客户与商机台账', folderId: 'fld-crm-main', platform: 'desktop' },
  ];

  return {
    dbTables,
    tableRows,
    designerFolders,
    designerPages,
    pageSources,
    entryPageId: 'crm-dashboard',
  };
}
