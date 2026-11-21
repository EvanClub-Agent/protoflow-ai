import type { DBTableSchema, StickyNoteRule } from '../../store/useProtoStore';
import type { MindmapWorkspace } from '../mindmaps';
import type { NoteWorkspace } from '../notes';
import type { DesignerFolder } from '../sitemap';
import type { DesignerPage } from '../store/usePageStore';
import type { Row } from '../runtime/mock';
import { parsePageSource } from '../dsl/parser';
import { printPageSource } from '../dsl/printer';

function norm(tsx: string): string {
  const res = parsePageSource(tsx);
  return res.doc ? printPageSource(res.doc) : tsx;
}

export interface CrmStarterDataset {
  dbTables: DBTableSchema[];
  tableRows: Record<string, Row[]>;
  designerFolders: DesignerFolder[];
  designerPages: DesignerPage[];
  pageSources: Record<string, string>;
  stickyNotes: StickyNoteRule[];
  projectNotes: NoteWorkspace;
  mindmaps: MindmapWorkspace;
  entryPageId: string;
}

export function createCrmStarterDataset(): CrmStarterDataset {
  const customersTable: DBTableSchema = {
    id: 't_crm_customers',
    tableName: 't_crm_customers',
    cnName: '企业客户与商机表',
    domain: '客户增长域 (CRM)',
    description: '承载企业客户档案、18位统一社会信用代码、销售漏斗阶段与预计年度订阅额（ARR），支撑经营看板聚合、客户台账 CRUD 与合同签约选客。',
    modeling: {
      entity: '企业签约客户主体',
      grain: '每家独立法人企业一行（以统一社会信用代码与客户编码双唯一标识）',
      reason: '客户基础开票资质与商机跟进状态被合同、回款、开票多模块共享，集中维护避免税号不一致。',
      pendingRules: [
        {
          rule: '申请数电专票前须核验客户 credit_code 为 18 位合法统一社会信用代码',
          reason: '格式合法性与税局抬头核验需在应用服务层实现',
        },
      ],
    },
    sharedByMenus: [
      {
        pageId: 'crm-dashboard',
        menuTitle: '业财合同与客户中心 → 业财经营与回款看板',
        accessMode: 'READ 查询',
        fieldMappingNote: '按大区汇总客户预计 ARR 规模并统计活跃客户总数',
      },
      {
        pageId: 'crm-customers',
        menuTitle: '业财合同与客户中心 → 企业客户与商机台账',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '多条件筛选客户商机、新增客户档案、维护信用代码与商机阶段',
      },
      {
        pageId: 'crm-contracts',
        menuTitle: '业财合同与客户中心 → 销售合同审批与履约台账',
        accessMode: 'FK 外键引用',
        fieldMappingNote: '新建销售合同时通过弹框选择器关联签约客户 ID 与企业名称',
      },
    ],
    columns: [
      { id: 'c_crm_id', name: 'id', dataType: 'VARCHAR(36)', nullable: false, isPrimaryKey: true, comment: '客户主键ID' },
      { id: 'c_crm_code', name: 'customer_code', dataType: 'VARCHAR(40)', nullable: false, isUnique: true, comment: '客户编号' },
      { id: 'c_crm_credit', name: 'credit_code', dataType: 'VARCHAR(18)', nullable: false, isUnique: true, comment: '统一社会信用代码(18位)' },
      { id: 'c_crm_name', name: 'company_name', dataType: 'VARCHAR(120)', nullable: false, comment: '企业全称' },
      { id: 'c_crm_region', name: 'region', dataType: 'VARCHAR(32)', nullable: false, comment: '所属大区(华东/华南/华北/西南)' },
      { id: 'c_crm_ind', name: 'industry', dataType: 'VARCHAR(60)', nullable: false, comment: '所属行业' },
      { id: 'c_crm_owner', name: 'owner_name', dataType: 'VARCHAR(60)', nullable: false, comment: '销售负责人' },
      { id: 'c_crm_arr', name: 'annual_arr', dataType: 'DECIMAL(14,2)', nullable: false, defaultValue: '0.00', comment: '预计年订阅额(元)' },
      { id: 'c_crm_status', name: 'status', dataType: 'VARCHAR(32)', nullable: false, defaultValue: '跟进中', comment: '商机状态(线索初筛/跟进中/方案报价/已赢单)' },
      { id: 'c_crm_remark', name: 'remark', dataType: 'VARCHAR(255)', nullable: true, comment: '客户跟进备注' },
    ],
  };

  const contractsTable: DBTableSchema = {
    id: 't_crm_contracts',
    tableName: 't_crm_contracts',
    cnName: '销售合同主表',
    domain: '业财合同域 (Contract)',
    description: '记录正式销售合同金额、累计已回款金额、累计已开票金额及法务审批/履约状态，作为分期回款计划与增值税开票的核心上游主表。',
    modeling: {
      entity: '销售商务合同单据',
      grain: '每份正式签署或待审的商务合同主单一行',
      reason: '统一承载合同总额、已回款额与已开票额三大业财勾稽指标，驱动 PC 后台审批与销售移动端实时协同。',
      pendingRules: [
        {
          rule: 'received_amount <= contract_amount 且 invoiced_amount <= contract_amount',
          reason: '跨表回款核销与开票累计防超额需在后端事务内加行锁校验并原子累加',
        },
      ],
    },
    sharedByMenus: [
      {
        pageId: 'crm-dashboard',
        menuTitle: '业财合同与客户中心 → 业财经营与回款看板',
        accessMode: 'READ 查询',
        fieldMappingNote: '统计在途履约合同数量与合同总额指标',
      },
      {
        pageId: 'crm-contracts',
        menuTitle: '业财合同与客户中心 → 销售合同审批与履约台账',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '合同起草、法务会签审批流转、抽屉下钻查看分期回款计划明细',
      },
      {
        pageId: 'crm-finance',
        menuTitle: '业财合同与客户中心 → 回款核销与开票工作台',
        accessMode: 'FK 外键引用',
        fieldMappingNote: '核销分期回款与复核开票申请时校验关联合同状态及剩余可开票额度',
      },
      {
        pageId: 'mob-crm-approvals',
        menuTitle: '销售外勤移动工作台 → 移动审批与回款催办',
        accessMode: 'STATE 状态流转',
        fieldMappingNote: '销售总监在手机端一键审批待签合同并下钻查看分期回款进度',
      },
      {
        pageId: 'mob-crm-invoice',
        menuTitle: '销售外勤移动工作台 → 客户拜访与移动开票',
        accessMode: 'FK 外键引用',
        fieldMappingNote: '外勤销售提交开票申请时通过移动抽屉选择器关联合同主表',
      },
    ],
    columns: [
      { id: 'c_con_id', name: 'id', dataType: 'VARCHAR(36)', nullable: false, isPrimaryKey: true, comment: '合同主键ID' },
      { id: 'c_con_no', name: 'contract_no', dataType: 'VARCHAR(40)', nullable: false, isUnique: true, comment: '合同编号' },
      { id: 'c_con_title', name: 'contract_title', dataType: 'VARCHAR(120)', nullable: false, comment: '合同名称' },
      {
        id: 'c_con_cust_id',
        name: 'customer_id',
        dataType: 'VARCHAR(36)',
        nullable: false,
        isForeignKey: true,
        references: 't_crm_customers(id)',
        foreignKeyOptions: { name: 'fk_crm_contracts_customer', cardinality: '1:N', onDelete: 'RESTRICT' },
        comment: '签约客户ID',
      },
      { id: 'c_con_cust_name', name: 'customer_name', dataType: 'VARCHAR(120)', nullable: false, comment: '签约客户名称' },
      { id: 'c_con_date', name: 'sign_date', dataType: 'DATE', nullable: false, comment: '签约日期' },
      { id: 'c_con_amt', name: 'contract_amount', dataType: 'DECIMAL(14,2)', nullable: false, comment: '合同总金额(元)' },
      { id: 'c_con_rec', name: 'received_amount', dataType: 'DECIMAL(14,2)', nullable: false, defaultValue: '0.00', comment: '累计已回款(元)' },
      { id: 'c_con_inv', name: 'invoiced_amount', dataType: 'DECIMAL(14,2)', nullable: false, defaultValue: '0.00', comment: '累计已开票(元)' },
      { id: 'c_con_owner', name: 'owner_name', dataType: 'VARCHAR(60)', nullable: false, comment: '合同归属销售' },
      { id: 'c_con_status', name: 'status', dataType: 'VARCHAR(32)', nullable: false, defaultValue: '待法务审批', comment: '合同状态(草稿/待法务审批/履约中/已完结/已驳回)' },
      { id: 'c_con_remark', name: 'remark', dataType: 'VARCHAR(255)', nullable: true, comment: '付款与交付条款摘要' },
    ],
  };

  const paymentPlansTable: DBTableSchema = {
    id: 't_crm_payment_plans',
    tableName: 't_crm_payment_plans',
    cnName: '合同分期回款计划表',
    domain: '业财结算域 (Billing)',
    description: '按首付款、上线验收款、质保尾款等里程碑拆解合同应收账期，通过复合唯一约束保证同一合同期次不重复，支撑逾期预警与财务到账核销。',
    modeling: {
      entity: '合同分期应收回款里程碑',
      grain: '每份销售合同下的每一个回款期次（contract_id + stage_no）一行',
      reason: 'B端大额合同普遍按 3:6:1 或分阶段回款，独立建模可精准追踪单期逾期并支持主子表下钻核销。',
      pendingRules: [
        {
          rule: '同一合同下各期 plan_amount 之和须严格等于母合同 contract_amount',
          reason: '分期拆分总额守恒需在保存回款计划事务中聚合校验',
        },
      ],
    },
    uniqueConstraints: [
      { name: 'uq_contract_stage', columnIds: ['c_pp_contract_id', 'c_pp_stage'] },
    ],
    sharedByMenus: [
      {
        pageId: 'crm-dashboard',
        menuTitle: '业财合同与客户中心 → 业财经营与回款看板',
        accessMode: 'READ 查询',
        fieldMappingNote: '首页底部实时过滤展示已逾期未核销的回款预警清单',
      },
      {
        pageId: 'crm-contracts',
        menuTitle: '业财合同与客户中心 → 销售合同审批与履约台账',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '在合同详情抽屉内通过 sourceForeignKey=contract_id 隔离展示当前合同的分期计划并支持新增期次',
      },
      {
        pageId: 'crm-finance',
        menuTitle: '业财合同与客户中心 → 回款核销与开票工作台',
        accessMode: 'STATE 状态流转',
        fieldMappingNote: '财务核对银行流水后确认到账核销或标记逾期催收',
      },
      {
        pageId: 'mob-crm-approvals',
        menuTitle: '销售外勤移动工作台 → 移动审批与回款催办',
        accessMode: 'READ 查询',
        fieldMappingNote: '手机端点击任意合同卡片滑出半屏抽屉，实时查看该合同下的分期回款状态',
      },
    ],
    columns: [
      { id: 'c_pp_id', name: 'id', dataType: 'VARCHAR(36)', nullable: false, isPrimaryKey: true, comment: '回款计划ID' },
      {
        id: 'c_pp_contract_id',
        name: 'contract_id',
        dataType: 'VARCHAR(36)',
        nullable: false,
        isForeignKey: true,
        references: 't_crm_contracts(id)',
        foreignKeyOptions: { name: 'fk_payment_plans_contract', cardinality: '1:N', onDelete: 'RESTRICT' },
        comment: '所属合同ID',
      },
      { id: 'c_pp_con_no', name: 'contract_no', dataType: 'VARCHAR(40)', nullable: false, comment: '合同编号快照' },
      { id: 'c_pp_stage', name: 'stage_no', dataType: 'INT', nullable: false, comment: '期次序号(1/2/3)' },
      { id: 'c_pp_milestone', name: 'milestone_name', dataType: 'VARCHAR(80)', nullable: false, comment: '回款里程碑(首付款30%/上线验收款60%/质保尾款10%)' },
      { id: 'c_pp_due', name: 'due_date', dataType: 'DATE', nullable: false, comment: '应收截止日' },
      { id: 'c_pp_plan_amt', name: 'plan_amount', dataType: 'DECIMAL(14,2)', nullable: false, comment: '本期应收金额(元)' },
      { id: 'c_pp_act_amt', name: 'actual_received', dataType: 'DECIMAL(14,2)', nullable: false, defaultValue: '0.00', comment: '本期实收金额(元)' },
      { id: 'c_pp_overdue', name: 'is_overdue', dataType: 'TINYINT(1)', nullable: false, defaultValue: '0', comment: '是否逾期(0否/1是)' },
      { id: 'c_pp_status', name: 'status', dataType: 'VARCHAR(32)', nullable: false, defaultValue: '待回款', comment: '核销状态(待回款/已逾期/已核销)' },
    ],
  };

  const invoicesTable: DBTableSchema = {
    id: 't_crm_invoices',
    tableName: 't_crm_invoices',
    cnName: '增值税开票申请表',
    domain: '业财结算域 (Billing)',
    description: '承载销售端发起的数电专票/普票申请单，关联销售合同主表，支持外勤销售移动端随手提报与 PC 财务工作台复核开票。',
    modeling: {
      entity: '增值税发票开具申请单',
      grain: '每次向财务发起的开票申请单一行',
      reason: '销售在客户现场常需手机端即时提交开票诉求，财务在 PC 端核对合同履约状态与剩余可开票额度后统一开具数电票。',
      pendingRules: [
        {
          rule: '仅 status IN (履约中, 已完结) 的合同允许提交开票，且累计申请金额不得超过合同总额',
          reason: '防止草稿/驳回合同违规虚开或超额开票',
        },
      ],
    },
    sharedByMenus: [
      {
        pageId: 'crm-finance',
        menuTitle: '业财合同与客户中心 → 回款核销与开票工作台',
        accessMode: 'STATE 状态流转',
        fieldMappingNote: '财务复核购方税号与合同额度，执行开具数电票或驳回重填',
      },
      {
        pageId: 'mob-crm-invoice',
        menuTitle: '销售外勤移动工作台 → 客户拜访与移动开票',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '外勤销售在手机端查询开票进度并通过半屏抽屉关联生效合同发起开票申请',
      },
    ],
    columns: [
      { id: 'c_inv_id', name: 'id', dataType: 'VARCHAR(36)', nullable: false, isPrimaryKey: true, comment: '开票申请ID' },
      { id: 'c_inv_no', name: 'invoice_apply_no', dataType: 'VARCHAR(40)', nullable: false, isUnique: true, comment: '开票申请单号' },
      {
        id: 'c_inv_con_id',
        name: 'contract_id',
        dataType: 'VARCHAR(36)',
        nullable: false,
        isForeignKey: true,
        references: 't_crm_contracts(id)',
        foreignKeyOptions: { name: 'fk_invoices_contract', cardinality: '1:N', onDelete: 'RESTRICT' },
        comment: '关联销售合同ID',
      },
      { id: 'c_inv_buyer', name: 'buyer_title', dataType: 'VARCHAR(120)', nullable: false, comment: '购方发票抬头' },
      { id: 'c_inv_tax_no', name: 'tax_no', dataType: 'VARCHAR(18)', nullable: false, comment: '购方纳税人识别号' },
      { id: 'c_inv_type', name: 'invoice_type', dataType: 'VARCHAR(32)', nullable: false, defaultValue: '数电专票', comment: '发票类型(数电专票/数电普票)' },
      { id: 'c_inv_rate', name: 'tax_rate', dataType: 'DECIMAL(5,2)', nullable: false, defaultValue: '6.00', comment: '增值税率(%)' },
      { id: 'c_inv_amt', name: 'apply_amount', dataType: 'DECIMAL(14,2)', nullable: false, comment: '申请开票含税金额(元)' },
      { id: 'c_inv_user', name: 'applicant', dataType: 'VARCHAR(60)', nullable: false, comment: '申请人' },
      { id: 'c_inv_status', name: 'status', dataType: 'VARCHAR(32)', nullable: false, defaultValue: '待财务复核', comment: '开票状态(待财务复核/已开票/已驳回)' },
      { id: 'c_inv_remark', name: 'remark', dataType: 'VARCHAR(255)', nullable: true, comment: '接收邮箱或开票备注' },
    ],
  };

  const revenueTable: DBTableSchema = {
    id: 't_crm_monthly_revenue',
    tableName: 't_crm_monthly_revenue',
    cnName: '月度签约与回款趋势表',
    domain: '数据分析域 (BI)',
    description: '按月汇总实际签约额、实际到账回款额与经营目标额，驱动管理层看板多序列对比折线图。',
    modeling: {
      entity: '月度业财经营汇总快照',
      grain: '每个自然统计月份（YYYY-MM）一行',
      reason: '经营看板需要对比签约口径与现金流回款口径剪刀差，按月唯一归集便于趋势分析。',
    },
    sharedByMenus: [
      {
        pageId: 'crm-dashboard',
        menuTitle: '业财合同与客户中心 → 业财经营与回款看板',
        accessMode: 'READ 查询',
        fieldMappingNote: '驱动月度签约额 vs 实际回款额 vs 目标额三序列折线趋势图',
      },
    ],
    columns: [
      { id: 'c_rev_id', name: 'id', dataType: 'VARCHAR(36)', nullable: false, isPrimaryKey: true, comment: '主键ID' },
      { id: 'c_rev_month', name: 'month_label', dataType: 'VARCHAR(20)', nullable: false, isUnique: true, comment: '统计月份(YYYY-MM)' },
      { id: 'c_rev_signed', name: 'signed_amount', dataType: 'DECIMAL(14,2)', nullable: false, comment: '当月签约额(万元)' },
      { id: 'c_rev_received', name: 'received_amount', dataType: 'DECIMAL(14,2)', nullable: false, comment: '当月回款额(万元)' },
      { id: 'c_rev_target', name: 'target_amount', dataType: 'DECIMAL(14,2)', nullable: false, comment: '月度目标额(万元)' },
    ],
  };

  const dbTables: DBTableSchema[] = [
    customersTable,
    contractsTable,
    paymentPlansTable,
    invoicesTable,
    revenueTable,
  ];

  const tableRows: Record<string, Row[]> = {
    t_crm_customers: [
      {
        id: 'cust-1',
        customer_code: 'CUS-2026-001',
        credit_code: '91310115MA1K48921X',
        company_name: '星云智造科技股份有限公司',
        region: '华东',
        industry: '高端装备制造',
        owner_name: '林思远',
        annual_arr: 480000,
        status: '已赢单',
        remark: '集团战略标杆客户，二期全国工厂推广洽谈中',
      },
      {
        id: 'cust-2',
        customer_code: 'CUS-2026-002',
        credit_code: '91440300MA5F92018L',
        company_name: '深蓝互动数字传媒集团',
        region: '华南',
        industry: '企业数字营销',
        owner_name: '陈雨桐',
        annual_arr: 260000,
        status: '已赢单',
        remark: '已完成法务主协议用印，按季度结算',
      },
      {
        id: 'cust-3',
        customer_code: 'CUS-2026-003',
        credit_code: '91110108MA01X7732Q',
        company_name: '远景云端能源软件有限公司',
        region: '华北',
        industry: '新能源数字化',
        owner_name: '王海涛',
        annual_arr: 620000,
        status: '方案报价',
        remark: '技术POC验证通过，等待商务终轮议价',
      },
      {
        id: 'cust-4',
        customer_code: 'CUS-2026-004',
        credit_code: '91510100MA6C21904W',
        company_name: '锦城新零售冷链供应链集团',
        region: '西南',
        industry: '智慧物流冷链',
        owner_name: '周敏',
        annual_arr: 320000,
        status: '已赢单',
        remark: '首期 WMS+业财对账模块上线验收中',
      },
      {
        id: 'cust-5',
        customer_code: 'CUS-2026-005',
        credit_code: '91330106MA2H08415K',
        company_name: '极光精密光学仪器有限公司',
        region: '华东',
        industry: '半导体与光学',
        owner_name: '林思远',
        annual_arr: 390000,
        status: '跟进中',
        remark: '客户CIO关注私有化部署与数据主权安全',
      },
    ],
    t_crm_contracts: [
      {
        id: 'con-1',
        contract_no: 'HT-2026-0101',
        contract_title: '星云智造集团级数字化平台年度订阅合同',
        customer_id: 'cust-1',
        customer_name: '星云智造科技股份有限公司',
        sign_date: '2026-09-15',
        contract_amount: 480000,
        received_amount: 144000,
        invoiced_amount: 432000,
        owner_name: '林思远',
        status: '履约中',
        remark: '按 30% 首付款 / 60% 上线验收款 / 10% 质保尾款分三期结算',
      },
      {
        id: 'con-2',
        contract_no: 'HT-2026-0102',
        contract_title: '深蓝互动多品牌私域中台私有化许可合同',
        customer_id: 'cust-2',
        customer_name: '深蓝互动数字传媒集团',
        sign_date: '2026-10-08',
        contract_amount: 260000,
        received_amount: 260000,
        invoiced_amount: 260000,
        owner_name: '陈雨桐',
        status: '已完结',
        remark: '全款已到账核销完毕并完成数电专票交付',
      },
      {
        id: 'con-3',
        contract_no: 'HT-2026-0103',
        contract_title: '锦城冷链全国分仓协同系统建设合同',
        customer_id: 'cust-4',
        customer_name: '锦城新零售冷链供应链集团',
        sign_date: '2026-11-12',
        contract_amount: 320000,
        received_amount: 0,
        invoiced_amount: 0,
        owner_name: '周敏',
        status: '待法务审批',
        remark: '客户申请将违约金上限调整为合同额 15%，待法务总监会签',
      },
      {
        id: 'con-4',
        contract_no: 'HT-2026-0104',
        contract_title: '远景能源碳排监测数据底座采购合同',
        customer_id: 'cust-3',
        customer_name: '远景云端能源软件有限公司',
        sign_date: '2026-11-16',
        contract_amount: 620000,
        received_amount: 0,
        invoiced_amount: 0,
        owner_name: '王海涛',
        status: '待法务审批',
        remark: '含定制大屏与国产数据库适配服务条款，急需本周五前完成审批',
      },
    ],
    t_crm_payment_plans: [
      {
        id: 'pp-1',
        contract_id: 'con-1',
        contract_no: 'HT-2026-0101',
        stage_no: 1,
        milestone_name: '首付款 (30%)',
        due_date: '2026-09-25',
        plan_amount: 144000,
        actual_received: 144000,
        is_overdue: 0,
        status: '已核销',
      },
      {
        id: 'pp-2',
        contract_id: 'con-1',
        contract_no: 'HT-2026-0101',
        stage_no: 2,
        milestone_name: '上线验收款 (60%)',
        due_date: '2026-11-05',
        plan_amount: 288000,
        actual_received: 0,
        is_overdue: 1,
        status: '已逾期',
      },
      {
        id: 'pp-3',
        contract_id: 'con-1',
        contract_no: 'HT-2026-0101',
        stage_no: 3,
        milestone_name: '质保尾款 (10%)',
        due_date: '2027-03-15',
        plan_amount: 48000,
        actual_received: 0,
        is_overdue: 0,
        status: '待回款',
      },
      {
        id: 'pp-4',
        contract_id: 'con-2',
        contract_no: 'HT-2026-0102',
        stage_no: 1,
        milestone_name: '一次性全款 (100%)',
        due_date: '2026-10-15',
        plan_amount: 260000,
        actual_received: 260000,
        is_overdue: 0,
        status: '已核销',
      },
      {
        id: 'pp-5',
        contract_id: 'con-3',
        contract_no: 'HT-2026-0103',
        stage_no: 1,
        milestone_name: '合同首付款 (50%)',
        due_date: '2026-11-25',
        plan_amount: 160000,
        actual_received: 0,
        is_overdue: 0,
        status: '待回款',
      },
    ],
    t_crm_invoices: [
      {
        id: 'inv-1',
        invoice_apply_no: 'INV-202610-001',
        contract_id: 'con-1',
        buyer_title: '星云智造科技股份有限公司',
        tax_no: '91310115MA1K48921X',
        invoice_type: '数电专票',
        tax_rate: 6,
        apply_amount: 144000,
        applicant: '林思远',
        status: '已开票',
        remark: '首付款 30% 对应专票，已发送至客户财务邮箱',
      },
      {
        id: 'inv-2',
        invoice_apply_no: 'INV-202611-002',
        contract_id: 'con-1',
        buyer_title: '星云智造科技股份有限公司',
        tax_no: '91310115MA1K48921X',
        invoice_type: '数电专票',
        tax_rate: 6,
        apply_amount: 288000,
        applicant: '林思远',
        status: '待财务复核',
        remark: '客户要求先见验收款发票再走集团付款审批流程',
      },
      {
        id: 'inv-3',
        invoice_apply_no: 'INV-202610-003',
        contract_id: 'con-2',
        buyer_title: '深蓝互动数字传媒集团',
        tax_no: '91440300MA5F92018L',
        invoice_type: '数电专票',
        tax_rate: 6,
        apply_amount: 260000,
        applicant: '陈雨桐',
        status: '已开票',
        remark: '全款数电专票已归档',
      },
    ],
    t_crm_monthly_revenue: [
      { id: 'rev-1', month_label: '2026-06', signed_amount: 118, received_amount: 96, target_amount: 110 },
      { id: 'rev-2', month_label: '2026-07', signed_amount: 135, received_amount: 112, target_amount: 125 },
      { id: 'rev-3', month_label: '2026-08', signed_amount: 142, received_amount: 128, target_amount: 140 },
      { id: 'rev-4', month_label: '2026-09', signed_amount: 168, received_amount: 145, target_amount: 150 },
      { id: 'rev-5', month_label: '2026-10', signed_amount: 195, received_amount: 172, target_amount: 170 },
      { id: 'rev-6', month_label: '2026-11', signed_amount: 226, received_amount: 189, target_amount: 200 },
    ],
  };

  const designerFolders: DesignerFolder[] = [
    { id: 'fld-crm-main', title: '业财合同与客户中心', parentFolderId: null },
    { id: 'fld-crm-mobile', title: '销售外勤移动工作台', parentFolderId: null },
  ];

  const dashboardSource = norm(`// @protoflow page: crm-dashboard
export default function Page() {
  return (
    <Page title="业财经营与回款看板" description="实时贯通客户商机、合同签约、分期回款现金流与逾期预警">
      <PageHeader title="CRM 业财经营与回款总览" breadcrumb={['业财合同与客户中心', '业财经营与回款看板']} />
      <Toolbar align="between">
        <Tag color="blue">全链路共享 5 张物理表 · PC 后台与外勤移动端实时联动</Tag>
        <Button pfId="btn-dash-go-contracts" type="primary" onClick={() => navigate('crm-contracts')}>进入合同审批台账</Button>
      </Toolbar>
      <Row gutter={16}>
        <Col span={6}><Statistic pfId="stat-cust-total" title="建档企业客户" table="t_crm_customers" suffix="家" /></Col>
        <Col span={6}><Statistic pfId="stat-con-total" title="纳管销售合同" table="t_crm_contracts" suffix="份" /></Col>
        <Col span={6}><Statistic pfId="stat-rec-rate" title="本季现金回款达成率" value="94.5%" trend="up" /></Col>
        <Col span={6}><Statistic pfId="stat-overdue-cnt" title="逾期未核销期次" value="1" suffix="笔" trend="down" /></Col>
      </Row>
      <Row gutter={16}>
        <Col span={14}>
          <Card title="月度签约额 vs 实际回款额 vs 目标趋势">
            <LineChart
              pfId="chart-rev-trend"
              title="签约与回款剪刀差监控 (万元)"
              source="table"
              table="t_crm_monthly_revenue"
              dimension="month_label"
              metrics={[
                { field: 'signed_amount', label: '当月签约额' },
                { field: 'received_amount', label: '当月实际回款' },
                { field: 'target_amount', label: '经营目标额' }
              ]}
              smooth={true}
              height={280}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="各大区客户预计 ARR 规模分布">
            <BarChart
              pfId="chart-region-arr"
              title="大区预计年度订阅额汇总 (元)"
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
      <Card title="逾期未回款红线预警（实时过滤 status = 已逾期）">
        <Toolbar align="between" title="需销售负责人与财务联合催收的分期账款">
          <Button pfId="btn-dash-go-finance" type="primary" onClick={() => navigate('crm-finance')}>前往财务工作台核销</Button>
        </Toolbar>
        <Table
          pfId="tbl-dash-overdue"
          table="t_crm_payment_plans"
          filter={{ status: '已逾期' }}
          columns={[
            { dataIndex: 'contract_no', title: '合同编号' },
            { dataIndex: 'stage_no', title: '期次' },
            { dataIndex: 'milestone_name', title: '回款里程碑' },
            { dataIndex: 'due_date', title: '应收截止日' },
            { dataIndex: 'plan_amount', title: '逾期应收金额(元)' },
            { dataIndex: 'status', title: '状态' }
          ]}
          rowActions={[
            { label: '去财务台账处理', onClick: () => navigate('crm-finance') }
          ]}
        />
      </Card>
    </Page>
  );
}
`);

  const customersSource = norm(`// @protoflow page: crm-customers
export default function Page() {
  return (
    <Page title="企业客户与商机台账" description="统一维护企业工商信用代码、所属区域行业与商机漏斗阶段">
      <PageHeader title="企业客户与商机台账" breadcrumb={['业财合同与客户中心', '企业客户与商机台账']} />
      <Card>
        <QueryForm
          pfId="qf-customers"
          target="tbl-customers-all"
          cols={4}
          fields={[
            { name: 'company_name', label: '企业全称' },
            { name: 'credit_code', label: '统一社会信用代码' },
            { name: 'region', label: '所属大区', type: 'select', options: '华东,华南,华北,西南' },
            { name: 'status', label: '商机状态', type: 'select', options: '线索初筛,跟进中,方案报价,已赢单' }
          ]}
        />
      </Card>
      <Card>
        <Tabs pfId="tabs-customers">
          <Tab title="全部客户">
            <Toolbar align="between" title="企业客户主数据列表">
              <Button pfId="btn-create-customer" type="primary" icon="plus" onClick={() => openModal('m-create-customer')}>新建企业客户</Button>
              <Button onClick={() => navigate('crm-contracts')}>去起草销售合同</Button>
            </Toolbar>
            <Table
              pfId="tbl-customers-all"
              table="t_crm_customers"
              selectable={true}
              rowActions={[
                { label: '客户详情', onClick: () => openDrawer('d-customer-detail') },
                { label: '编辑资料', onClick: () => openModal('m-edit-customer') },
                { label: '标记赢单', onClick: () => { updateRow({ status: '已赢单' }); toast('客户商机已流转为已赢单'); } }
              ]}
            />
          </Tab>
          <Tab title="跟进与报价中">
            <Table
              pfId="tbl-customers-following"
              table="t_crm_customers"
              filter={{ status: '方案报价' }}
              rowActions={[
                { label: '查看详情', onClick: () => openDrawer('d-customer-detail') },
                { label: '确认赢单', onClick: () => { updateRow({ status: '已赢单' }); toast('已确认赢单，可发起正式合同审批'); } }
              ]}
            />
          </Tab>
          <Tab title="已赢单签约客户">
            <Table
              pfId="tbl-customers-won"
              table="t_crm_customers"
              filter={{ status: '已赢单' }}
              rowActions={[
                { label: '查看详情', onClick: () => openDrawer('d-customer-detail') }
              ]}
            />
          </Tab>
        </Tabs>
      </Card>
      <Modal id="m-create-customer" title="新建企业客户与商机档案" width={720} footer={false}>
        <Form pfId="form-create-customer" table="t_crm_customers" cols={2}>
          <Input label="客户编号" name="customer_code" placeholder="如 CUS-2026-006" required={true} />
          <Input pfId="input-credit-code" label="统一社会信用代码" name="credit_code" maxLength={18} placeholder="18位工商纳税识别号" required={true} />
          <Input label="企业全称" name="company_name" placeholder="须与营业执照及开票抬头完全一致" required={true} />
          <Select label="所属大区" name="region" options="华东,华南,华北,西南" required={true} />
          <Input label="所属行业" name="industry" placeholder="如 高端装备制造 / 智慧医疗" required={true} />
          <Input label="销售负责人" name="owner_name" required={true} />
          <NumberInput label="预计年订阅额(ARR)" name="annual_arr" prefix="¥" precision={2} min={0} required={true} />
          <Select label="当前商机阶段" name="status" options="线索初筛,跟进中,方案报价,已赢单" required={true} />
          <Textarea label="客户跟进备注" name="remark" span={2} />
        </Form>
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button pfId="btn-save-customer" type="primary" onClick={() => { submitForm('form-create-customer'); toast('企业客户建档成功'); closeOverlay(); refresh('tbl-customers-all'); }}>保存</Button>
        </Toolbar>
      </Modal>
      <Modal id="m-edit-customer" title="编辑企业客户资料" width={720} footer={false}>
        <Form pfId="form-edit-customer" table="t_crm_customers" cols={2}>
          <Input label="客户编号" name="customer_code" required={true} />
          <Input label="统一社会信用代码" name="credit_code" maxLength={18} required={true} />
          <Input label="企业全称" name="company_name" required={true} />
          <Select label="所属大区" name="region" options="华东,华南,华北,西南" required={true} />
          <Input label="所属行业" name="industry" required={true} />
          <Input label="销售负责人" name="owner_name" required={true} />
          <NumberInput label="预计年订阅额(ARR)" name="annual_arr" prefix="¥" precision={2} min={0} required={true} />
          <Select label="当前商机阶段" name="status" options="线索初筛,跟进中,方案报价,已赢单" required={true} />
          <Textarea label="客户跟进备注" name="remark" span={2} />
        </Form>
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button type="primary" onClick={() => { submitForm('form-edit-customer'); toast('客户资料已更新'); closeOverlay(); refresh('tbl-customers-all'); }}>保存修改</Button>
        </Toolbar>
      </Modal>
      <Drawer id="d-customer-detail" title="企业客户工商与商机详情" width={520}>
        <Descriptions table="t_crm_customers" column={1} />
      </Drawer>
    </Page>
  );
}
`);

  const contractsSource = norm(`// @protoflow page: crm-contracts
export default function Page() {
  return (
    <Page title="销售合同审批与履约台账" description="管理正式销售合同起草、法务审批流转，并支持主子表下钻维护分期回款计划">
      <PageHeader title="销售合同审批与履约台账" breadcrumb={['业财合同与客户中心', '销售合同审批与履约台账']} />
      <Alert type="info" message="业财主子表联动：点击任意合同行的【回款计划明细】即可通过外键 contract_id 隔离查看该合同下的分期里程碑。" />
      <Card>
        <QueryForm
          pfId="qf-contracts"
          target="tbl-contracts-all"
          cols={4}
          fields={[
            { name: 'contract_no', label: '合同编号' },
            { name: 'contract_title', label: '合同名称' },
            { name: 'customer_name', label: '签约客户' },
            { name: 'status', label: '合同状态', type: 'select', options: '草稿,待法务审批,履约中,已完结,已驳回' }
          ]}
        />
      </Card>
      <Card>
        <Tabs pfId="tabs-contracts">
          <Tab title="全部销售合同">
            <Toolbar align="between" title="销售合同主台账">
              <Button pfId="btn-open-new-contract" type="primary" icon="plus" onClick={() => openModal('m-create-contract')}>起草销售合同</Button>
              <Button onClick={() => navigate('crm-finance')}>前往财务回款与开票台账</Button>
            </Toolbar>
            <Table
              pfId="tbl-contracts-all"
              table="t_crm_contracts"
              selectable={true}
              rowActions={[
                { label: '回款计划明细', onClick: () => openDrawer('d-contract-detail') },
                { label: '法务会签', onClick: () => openModal('m-approve-contract') }
              ]}
            />
          </Tab>
          <Tab title="待法务审批" badge={2}>
            <Table
              pfId="tbl-contracts-pending"
              table="t_crm_contracts"
              filter={{ status: '待法务审批' }}
              rowActions={[
                { label: '回款计划明细', onClick: () => openDrawer('d-contract-detail') },
                { label: '审批通过', onClick: () => { updateRow({ status: '履约中' }); toast('法务审批通过，合同正式进入履约态'); } },
                { label: '驳回修改', danger: true, onClick: () => { updateRow({ status: '已驳回' }); toast('已驳回销售补充条款说明', 'warning'); } }
              ]}
            />
          </Tab>
          <Tab title="履约执行中">
            <Table
              pfId="tbl-contracts-active"
              table="t_crm_contracts"
              filter={{ status: '履约中' }}
              rowActions={[
                { label: '回款计划明细', onClick: () => openDrawer('d-contract-detail') }
              ]}
            />
          </Tab>
        </Tabs>
      </Card>
      <Modal id="m-create-contract" title="起草销售合同（关联企业客户主数据）" width={760} footer={false}>
        <Form pfId="form-create-contract" table="t_crm_contracts" cols={2}>
          <Input label="合同编号" name="contract_no" placeholder="如 HT-2026-0105" required={true} />
          <Input label="合同名称" name="contract_title" placeholder="请输入项目合同全称" required={true} />
          <PickerInput pfId="picker-contract-customer" label="选择签约客户(ID)" name="customer_id" overlay="m-pick-customer" required={true} />
          <Input label="签约客户名称" name="customer_name" placeholder="确认客户全称" required={true} />
          <DatePicker label="签约日期" name="sign_date" required={true} />
          <NumberInput pfId="input-contract-amount" label="合同总金额(元)" name="contract_amount" prefix="¥" precision={2} min={0.01} required={true} />
          <Input label="归属销售负责人" name="owner_name" required={true} />
          <Select label="初始状态" name="status" options="草稿,待法务审批" required={true} />
          <Textarea label="付款账期与违约责任摘要" name="remark" span={2} />
        </Form>
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button pfId="btn-submit-contract" type="primary" onClick={() => { submitForm('form-create-contract'); toast('销售合同已提交法务审批队列'); closeOverlay(); refresh('tbl-contracts-all'); }}>提交保存</Button>
        </Toolbar>
      </Modal>
      <Modal id="m-pick-customer" title="选择签约企业客户" width={820} footer={false}>
        <Table pfId="tbl-pick-customer" table="t_crm_customers" selectable={true} pageSize={5} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button type="primary" onClick={() => returnSelection('tbl-pick-customer', 'company_name', 'id')}>确认选入客户</Button>
        </Toolbar>
      </Modal>
      <Modal id="m-approve-contract" title="销售合同法务与风控会签" width={580} footer={false}>
        <Descriptions table="t_crm_contracts" column={2} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button pfId="btn-reject-contract" type="danger" onClick={() => { updateRow({ status: '已驳回' }); toast('合同已驳回至起草人', 'warning'); closeOverlay(); }}>驳回重签</Button>
          <Button pfId="btn-pass-contract" type="primary" onClick={() => { updateRow({ status: '履约中' }); toast('会签通过，合同已生效进入履约中'); closeOverlay(); }}>审批生效</Button>
        </Toolbar>
      </Modal>
      <Drawer id="d-contract-detail" title="合同主单信息与分期回款计划（主子表联动）" width={780}>
        <Descriptions table="t_crm_contracts" column={2} />
        <Card title="本合同分期回款里程碑（按外键 contract_id 精确隔离）">
          <Table
            pfId="tbl-contract-plans"
            table="t_crm_payment_plans"
            sourceForeignKey="contract_id"
            columns={[
              { dataIndex: 'stage_no', title: '期次' },
              { dataIndex: 'milestone_name', title: '里程碑说明' },
              { dataIndex: 'due_date', title: '应收日期' },
              { dataIndex: 'plan_amount', title: '本期应收(元)' },
              { dataIndex: 'actual_received', title: '本期实收(元)' },
              { dataIndex: 'status', title: '核销状态' }
            ]}
          />
        </Card>
      </Drawer>
    </Page>
  );
}
`);

  const financeSource = norm(`// @protoflow page: crm-finance
export default function Page() {
  return (
    <Page title="回款核销与开票工作台" description="财务部统一执行银行到账分期核销、逾期账款标记及数电增值税发票复核开具">
      <PageHeader title="财务回款核销与增值税开票工作台" breadcrumb={['业财合同与客户中心', '回款核销与开票工作台']} />
      <Card>
        <Tabs pfId="tabs-finance-workbench">
          <Tab title="分期回款到账核销" badge={1}>
            <QueryForm
              pfId="qf-payment-plans"
              target="tbl-finance-plans"
              cols={3}
              fields={[
                { name: 'contract_no', label: '合同编号' },
                { name: 'milestone_name', label: '回款里程碑' },
                { name: 'status', label: '核销状态', type: 'select', options: '待回款,已逾期,已核销' }
              ]}
            />
            <Toolbar align="between" title="合同分期应收与实收核销列表">
              <Tag color="orange">核销红线：实收累加不得超出母合同总额，全额核销后自动驱动合同完结</Tag>
              <Button onClick={() => navigate('crm-contracts')}>对照销售合同主表</Button>
            </Toolbar>
            <Table
              pfId="tbl-finance-plans"
              table="t_crm_payment_plans"
              rowActions={[
                { label: '确认到账核销', onClick: () => openModal('m-reconcile-plan') },
                { label: '标记逾期催收', danger: true, onClick: () => { updateRow({ status: '已逾期', is_overdue: 1 }); toast('已标记为逾期账款并同步看板预警', 'warning'); } }
              ]}
            />
          </Tab>
          <Tab title="增值税开票申请复核" badge={1}>
            <Toolbar align="between" title="数电专票 / 普票申请复核队列（含销售移动端提报单据）">
              <Button pfId="btn-pc-new-invoice" type="primary" icon="plus" onClick={() => openModal('m-create-invoice')}>登记开票申请</Button>
            </Toolbar>
            <Table
              pfId="tbl-finance-invoices"
              table="t_crm_invoices"
              rowActions={[
                { label: '复核开具数电票', onClick: () => openModal('m-review-invoice') },
                { label: '驳回重填', danger: true, onClick: () => { updateRow({ status: '已驳回' }); toast('已驳回开票申请，请销售核对税号与额度', 'warning'); } }
              ]}
            />
          </Tab>
        </Tabs>
      </Card>
      <Modal id="m-reconcile-plan" title="财务银行水单到账核销确认" width={560} footer={false}>
        <Descriptions table="t_crm_payment_plans" column={2} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button pfId="btn-confirm-reconcile" type="primary" onClick={() => { updateRow({ status: '已核销', is_overdue: 0 }); toast('本期应收款已完成银行水单核销'); closeOverlay(); }}>确认足额核销</Button>
        </Toolbar>
      </Modal>
      <Modal id="m-review-invoice" title="财务数电发票额度与税务资质复核" width={580} footer={false}>
        <Descriptions table="t_crm_invoices" column={2} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button type="danger" onClick={() => { updateRow({ status: '已驳回' }); toast('已驳回该笔开票申请', 'warning'); closeOverlay(); }}>驳回申请</Button>
          <Button pfId="btn-issue-invoice" type="primary" onClick={() => { updateRow({ status: '已开票' }); toast('数电发票复核通过并已推送交付'); closeOverlay(); }}>确认开具发票</Button>
        </Toolbar>
      </Modal>
      <Modal id="m-create-invoice" title="新增增值税开票申请" width={720} footer={false}>
        <Form pfId="form-pc-invoice" table="t_crm_invoices" cols={2}>
          <Input label="开票申请单号" name="invoice_apply_no" placeholder="如 INV-202611-004" required={true} />
          <PickerInput label="关联销售合同" name="contract_id" overlay="m-pick-invoice-contract" required={true} />
          <Input label="购方发票抬头" name="buyer_title" required={true} />
          <Input pfId="input-invoice-taxno" label="购方纳税人识别号" name="tax_no" maxLength={18} required={true} />
          <Select label="发票类型" name="invoice_type" options="数电专票,数电普票" required={true} />
          <NumberInput label="增值税率(%)" name="tax_rate" precision={2} min={0} max={13} required={true} />
          <NumberInput pfId="input-invoice-amount" label="申请开票含税金额(元)" name="apply_amount" prefix="¥" precision={2} min={0.01} required={true} />
          <Input label="申请人" name="applicant" required={true} />
          <Select label="初始状态" name="status" options="待财务复核" required={true} />
          <Textarea label="接收邮箱或备注说明" name="remark" span={2} />
        </Form>
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button pfId="btn-save-pc-invoice" type="primary" onClick={() => { submitForm('form-pc-invoice'); toast('开票申请已进入待财务复核队列'); closeOverlay(); refresh('tbl-finance-invoices'); }}>保存提交</Button>
        </Toolbar>
      </Modal>
      <Modal id="m-pick-invoice-contract" title="选择关联的履约销售合同" width={820} footer={false}>
        <Table pfId="tbl-pick-contract" table="t_crm_contracts" selectable={true} pageSize={5} />
        <Toolbar align="right">
          <Button onClick={() => closeOverlay()}>取消</Button>
          <Button type="primary" onClick={() => returnSelection('tbl-pick-contract', 'contract_title', 'id')}>确认选入合同</Button>
        </Toolbar>
      </Modal>
    </Page>
  );
}
`);

  const mobileTabBar = (activeKey: string) => `<MTabBar variant="floating" activeKey="${activeKey}" items={[
        { key: 'approvals', title: '合同待办', icon: 'Layers', badge: '2', page: 'mob-crm-approvals' },
        { key: 'invoice', title: '移动开票', icon: 'Sparkles', page: 'mob-crm-invoice' }
      ]} />`;

  const mobileApprovalsSource = norm(`// @protoflow page: mob-crm-approvals
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title="移动审批与回款催办" accent="gemini" surfaceBg="mist">
      <MTopBar title="业财移动审批舱" leftMode="sparkle" rightIcon="bell" onRightClick={() => navigate('mob-crm-invoice')} />
      <MStatCard pfId="mstat-pending-contracts" title="待会签合同总额" value="¥940,000" trend="2 份加急待批" trendTone="up" sparkline={true} />
      <MSearchPill placeholder="搜索合同名称、编号或签约客户..." target="mlist-contracts" showFilter={false} />
      <MPillTabs variant="pill" target="mlist-contracts" filterField="status" items={[
        { title: '全部', value: '' },
        { title: '待法务审批', value: '待法务审批', badge: '2' },
        { title: '履约中', value: '履约中' }
      ]} />
      <MTaskList
        pfId="mlist-contracts"
        table="t_crm_contracts"
        titleField="contract_title"
        statusField="status"
        fields={[
          { dataIndex: 'contract_no', title: '合同编号' },
          { dataIndex: 'customer_name', title: '签约客户' },
          { dataIndex: 'contract_amount', title: '合同总额', render: 'money' },
          { dataIndex: 'owner_name', title: '归属销售' }
        ]}
        rowActions={[
          { label: '驳回', danger: true, onClick: () => { updateRow({ status: '已驳回' }); toast('已在手机端驳回该合同', 'warning'); } },
          { label: '审批生效', primary: true, onClick: () => { updateRow({ status: '履约中' }); toast('合同已审批生效，PC端台账实时同步'); } }
        ]}
        onCardClick={() => openDrawer('sheet-contract-plans')}
      />
      ${mobileTabBar('approvals')}
      <MBottomSheet id="sheet-contract-plans" title="合同分期回款计划明细" subtitle="点击合同卡片通过外键 contract_id 自动隔离拉取子表" size="tall">
        <MTaskList
          pfId="mlist-contract-plans"
          table="t_crm_payment_plans"
          sourceForeignKey="contract_id"
          titleField="milestone_name"
          statusField="status"
          fields={[
            { dataIndex: 'stage_no', title: '期次' },
            { dataIndex: 'due_date', title: '应收日期' },
            { dataIndex: 'plan_amount', title: '本期应收', render: 'money' }
          ]}
        />
      </MBottomSheet>
    </MobilePage>
  );
}
`);

  const mobileInvoiceSource = norm(`// @protoflow page: mob-crm-invoice
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title="客户拜访与移动开票" accent="gemini" surfaceBg="mist">
      <MTopBar title="销售外勤开票快办" leftMode="back" rightIcon="plus" onLeftClick={() => navigate('mob-crm-approvals')} onRightClick={() => openDrawer('sheet-apply-invoice')} />
      <MHeroHeader mode="greeting" eyebrow="与 PC 财务工作台实时共表" title="现场提报数电发票" subtitle="客户验收签字后随手提报，财务端秒级接收复核" />
      <MPillTabs variant="pill" target="mlist-invoices" filterField="status" items={[
        { title: '全部申请', value: '' },
        { title: '待财务复核', value: '待财务复核', badge: '1' },
        { title: '已开票', value: '已开票' }
      ]} />
      <MTaskList
        pfId="mlist-invoices"
        table="t_crm_invoices"
        titleField="buyer_title"
        statusField="status"
        fields={[
          { dataIndex: 'invoice_apply_no', title: '申请单号' },
          { dataIndex: 'invoice_type', title: '发票类型' },
          { dataIndex: 'apply_amount', title: '开票金额', render: 'money' },
          { dataIndex: 'applicant', title: '提报销售' }
        ]}
      />
      ${mobileTabBar('invoice')}
      <MBottomSheet id="sheet-apply-invoice" title="发起增值税开票申请" subtitle="直连 t_crm_invoices 表，提交后自动同步至 PC 财务复核队列" size="tall">
        <MForm pfId="mform-invoice" title="填写购方税务与合同信息" table="t_crm_invoices">
          <MField label="开票申请单号" name="invoice_apply_no" placeholder="如 INV-202611-008" required={true} />
          <MSheetPicker
            pfId="mpicker-invoice-contract"
            label="关联销售合同"
            name="contract_id"
            table="t_crm_contracts"
            labelField="contract_title"
            valueField="id"
            placeholder="点击选择已生效合同"
            required={true}
          />
          <MField label="购方发票抬头" name="buyer_title" placeholder="须与合同签约客户全称一致" required={true} />
          <MField label="18位纳税人识别号" name="tax_no" placeholder="请输入统一社会信用代码" required={true} />
          <MChipSelect label="发票类型" name="invoice_type" options="数电专票,数电普票" required={true} />
          <MField label="增值税率(%)" name="tax_rate" inputType="number" placeholder="默认 6" required={true} />
          <MField pfId="mfield-invoice-amount" label="申请开票含税金额(元)" name="apply_amount" inputType="amount" placeholder="0.00" required={true} />
          <MField label="提报申请人" name="applicant" placeholder="请输入销售姓名" required={true} />
          <MChipSelect label="单据初始状态" name="status" options="待财务复核" required={true} />
          <MField label="接收邮箱与备注" name="remark" inputType="textarea" placeholder="填写客户财务收票邮箱..." />
        </MForm>
        <MBottomDock
          pfId="mdock-submit-invoice"
          mode="action"
          secondaryText="取消"
          primaryText="提交开票申请"
          onSecondary={() => closeOverlay()}
          onPrimary={() => { submitForm('mform-invoice'); toast('开票申请已提交，PC财务台账可立即复核'); closeOverlay(); refresh('mlist-invoices'); }}
        />
      </MBottomSheet>
    </MobilePage>
  );
}
`);

  const pageSources: Record<string, string> = {
    'crm-dashboard': dashboardSource,
    'crm-customers': customersSource,
    'crm-contracts': contractsSource,
    'crm-finance': financeSource,
    'mob-crm-approvals': mobileApprovalsSource,
    'mob-crm-invoice': mobileInvoiceSource,
  };

  const designerPages: DesignerPage[] = [
    { pageId: 'crm-dashboard', title: '业财经营与回款看板', folderId: 'fld-crm-main', platform: 'desktop' },
    { pageId: 'crm-customers', title: '企业客户与商机台账', folderId: 'fld-crm-main', platform: 'desktop' },
    { pageId: 'crm-contracts', title: '销售合同审批与履约台账', folderId: 'fld-crm-main', platform: 'desktop' },
    { pageId: 'crm-finance', title: '回款核销与开票工作台', folderId: 'fld-crm-main', platform: 'desktop' },
    { pageId: 'mob-crm-approvals', title: '移动审批与回款催办', folderId: 'fld-crm-mobile', platform: 'mobile' },
    { pageId: 'mob-crm-invoice', title: '客户拜访与移动开票', folderId: 'fld-crm-mobile', platform: 'mobile' },
  ];

  const stickyNotes: StickyNoteRule[] = [
    {
      id: 'sn-crm-1',
      pageId: 'crm-dashboard',
      targetWidgetId: 'tbl-dash-overdue',
      targetWidgetName: '逾期未回款红线预警表',
      index: 1,
      text: '每日凌晨定时任务扫描 t_crm_payment_plans：当 due_date < CURRENT_DATE 且 status = 待回款 时，自动将 status 置为「已逾期」、is_overdue = 1，并推送催收待办。',
      compiledRule: 'OVERDUE_CRON: due_date < CURRENT_DATE AND status = "待回款" => status = "已逾期", is_overdue = 1',
      active: true,
    },
    {
      id: 'sn-crm-2',
      pageId: 'crm-customers',
      targetWidgetId: 'input-credit-code',
      targetWidgetName: '统一社会信用代码输入框',
      index: 1,
      text: '统一社会信用代码必须满足 18 位大写字母与数字正则校验（^[0-9A-Z]{18}$），且全表唯一（UNIQUE）；若存在关联未完结合同，禁止物理删除客户。',
      compiledRule: 'UNIQUE(credit_code) && REGEX(/^[0-9A-Z]{18}$/) && ON_DELETE_RESTRICT(t_crm_contracts)',
      active: true,
    },
    {
      id: 'sn-crm-3',
      pageId: 'crm-contracts',
      targetWidgetId: 'btn-submit-contract',
      targetWidgetName: '起草销售合同保存按钮',
      index: 1,
      text: '新建合同时 contract_no 服务端按「HT-YYYY-四位流水」唯一生成或幂等判重；contract_amount 精确到 2 位小数且必须 > 0；关联客户必须已建档存在。',
      compiledRule: 'UNIQUE(contract_no) && contract_amount > 0 && FK_EXISTS(customer_id -> t_crm_customers.id)',
      active: true,
    },
    {
      id: 'sn-crm-4',
      pageId: 'crm-contracts',
      targetWidgetId: 'btn-pass-contract',
      targetWidgetName: '法务审批生效按钮',
      index: 2,
      text: '状态机守卫：仅允许「待法务审批」状态的合同执行审批通过（流转为「履约中」）或驳回（流转为「已驳回」）；「已驳回」修改重提后方可再次进入审批。',
      compiledRule: 'STATE_GUARD: status == "待法务审批" -> ["履约中", "已驳回"]',
      active: true,
    },
    {
      id: 'sn-crm-5',
      pageId: 'crm-contracts',
      targetWidgetId: 'tbl-contract-plans',
      targetWidgetName: '合同分期回款计划子表',
      index: 3,
      text: '同一份合同下的期次序号 stage_no 具有表级复合唯一约束 uq_contract_stage(contract_id, stage_no)，且所有分期 plan_amount 汇总必须严格等于母合同 contract_amount。',
      compiledRule: 'UNIQUE(contract_id, stage_no) && SUM(plan_amount WHERE contract_id) == contract.contract_amount',
      active: true,
    },
    {
      id: 'sn-crm-6',
      pageId: 'crm-finance',
      targetWidgetId: 'btn-confirm-reconcile',
      targetWidgetName: '确认足额核销按钮',
      index: 1,
      text: '防超额核销事务规则：确认核销时以 SELECT ... FOR UPDATE 锁定母合同行，校验 received_amount + plan_amount <= contract_amount；核销后原子累加母合同 received_amount，若相等则自动将母合同状态更新为「已完结」。',
      compiledRule: 'TX_LOCK(t_crm_contracts): received_amount + plan_amount <= contract_amount; IF equal THEN contract.status = "已完结"',
      active: true,
    },
    {
      id: 'sn-crm-7',
      pageId: 'crm-finance',
      targetWidgetId: 'btn-issue-invoice',
      targetWidgetName: '确认开具发票按钮',
      index: 2,
      text: '防超额开票与资质校验：1) 关联合同状态必须为「履约中」或「已完结」；2) 母合同 invoiced_amount + apply_amount <= contract_amount；3) 数电专票必须核验 tax_no 长度为 18 位；复核通过后原子累加母合同 invoiced_amount。',
      compiledRule: 'contract.status IN ("履约中","已完结") && invoiced_amount + apply_amount <= contract_amount && LEN(tax_no) == 18',
      active: true,
    },
    {
      id: 'sn-crm-8',
      pageId: 'mob-crm-approvals',
      targetWidgetId: 'mlist-contracts',
      targetWidgetName: '移动端合同审批列表',
      index: 1,
      text: '移动端审批与 PC 端共用同一套状态机与乐观锁校验：若财务或法务已在 PC 端处理完该合同，移动端重复点击需友好提示「单据状态已更新」并刷新列表。',
      compiledRule: 'OPTIMISTIC_STATE_CHECK: UPDATE t_crm_contracts WHERE id = :id AND status = "待法务审批"',
      active: true,
    },
    {
      id: 'sn-crm-9',
      pageId: 'mob-crm-invoice',
      targetWidgetId: 'mdock-submit-invoice',
      targetWidgetName: '移动端提交开票底部操作坞',
      index: 1,
      text: '外勤销售提交开票时，后端须实时计算该合同剩余可开票额度 = contract_amount - invoiced_amount - 待复核申请总额；超出剩余额度时直接拦截并返回具体差额。',
      compiledRule: 'apply_amount <= contract_amount - invoiced_amount - SUM(pending.apply_amount)',
      active: true,
    },
  ];

  const projectNotes: NoteWorkspace = {
    nodes: [
      {
        id: 'note-fld-crm-prd',
        kind: 'folder',
        title: '业财合同与回款开票 PRD 规范',
        parentId: null,
        icon: '📁',
        updatedAt: '2026-11-19T10:00:00.000Z',
      },
      {
        id: 'note-crm-state-machine',
        kind: 'note',
        title: '合同—分期回款—增值税开票状态机与勾稽口径说明',
        parentId: 'note-fld-crm-prd',
        icon: '📑',
        updatedAt: '2026-11-19T10:15:00.000Z',
        tags: ['状态机', '业财勾稽', '核心契约'],
        cover: 'ocean',
        pinned: true,
        status: 'confirmed',
        priority: 'P0',
        stakeholder: '财务总监 & 销售运营负责人',
        meetingDate: '2026-11-19',
        shareable: true,
        content: [
          '<h2>一、核心单据状态流转定义</h2>',
          '<ul>',
          '<li><strong>销售合同（t_crm_contracts.status）</strong>：<code>草稿</code> → <code>待法务审批</code> →（会签通过）→ <code>履约中</code> →（全额回款核销完毕）→ <code>已完结</code>；会签不通过退回 <code>已驳回</code>，修改后可重新提审。</li>',
          '<li><strong>分期回款计划（t_crm_payment_plans.status）</strong>：<code>待回款</code> →（超期未核销）→ <code>已逾期</code> →（水单核销）→ <code>已核销</code>。</li>',
          '<li><strong>增值税开票申请（t_crm_invoices.status）</strong>：<code>待财务复核</code> →（复核通过开票）→ <code>已开票</code>；资质或额度不符退回 <code>已驳回</code>。</li>',
          '</ul>',
          '<h2>二、跨表红线勾稽不变量（服务端事务必验）</h2>',
          '<ol>',
          '<li><strong>分期计划守恒</strong>：同一 <code>contract_id</code> 下各期 <code>plan_amount</code> 之和应等于合同 <code>contract_amount</code>，且 <code>(contract_id, stage_no)</code> 复合唯一。</li>',
          '<li><strong>防超额回款核销</strong>：支持「先票后款」或「先款后票」，但任意时刻 <code>received_amount &lt;= contract_amount</code>；当最后一期核销令 <code>received_amount == contract_amount</code> 时，同一数据库事务内将合同状态置为 <code>已完结</code>。</li>',
          '<li><strong>防超额申请开票</strong>：仅 <code>履约中</code> 与 <code>已完结</code> 合同可发起开票，且 <code>已开票总额 + 待财务复核总额 + 本次申请金额 &lt;= contract_amount</code>。</li>',
          '</ol>',
        ].join(''),
      },
      {
        id: 'note-crm-money-precision',
        kind: 'note',
        title: 'B端金额精度(DECIMAL 14,2)与价税分离尾差处理规范',
        parentId: 'note-fld-crm-prd',
        icon: '🧮',
        updatedAt: '2026-11-19T10:30:00.000Z',
        tags: ['金额精度', '税务计算', '后端规范'],
        cover: 'emerald',
        pinned: true,
        status: 'confirmed',
        priority: 'P0',
        stakeholder: '税务会计 & 研发架构组',
        meetingDate: '2026-11-19',
        shareable: true,
        content: [
          '<h2>一、存储与传输精度要求</h2>',
          '<ul>',
          '<li>所有货币金额字段统一采用 <code>DECIMAL(14,2)</code>（禁止使用二进制浮点数 <code>FLOAT</code> / <code>DOUBLE</code> 进行加减乘除），API 层序列化保留两位小数或以分/字符串精确传输。</li>',
          '<li>增值税率字段采用 <code>DECIMAL(5,2)</code>（常见档位：现代服务 <code>6.00%</code>、软件硬件销售 <code>13.00%</code>）。</li>',
          '</ul>',
          '<h2>二、价税分离与尾差倒算规则</h2>',
          '<p>开票申请中的 <code>apply_amount</code> 定义为<strong>价税合计含税金额</strong>：</p>',
          '<ul>',
          '<li><code>不含税金额 = ROUND(apply_amount / (1 + tax_rate / 100), 2)</code>（四舍五入保留 2 位小数）；</li>',
          '<li><code>税额 = apply_amount - 不含税金额</code>（严格用减法倒算，彻底杜绝不含税金额 + 税额 ≠ 价税合计的 1 分钱尾差）。</li>',
          '</ul>',
        ].join(''),
      },
    ],
    links: [
      { page: { kind: 'page', pageId: 'crm-contracts' }, targetNodeId: 'note-crm-state-machine' },
      { page: { kind: 'page', pageId: 'crm-finance' }, targetNodeId: 'note-crm-state-machine' },
      { page: { kind: 'page', pageId: 'mob-crm-approvals' }, targetNodeId: 'note-crm-state-machine' },
      { page: { kind: 'page', pageId: 'mob-crm-invoice' }, targetNodeId: 'note-crm-state-machine' },
      { page: { kind: 'page', pageId: 'crm-dashboard' }, targetNodeId: 'note-crm-money-precision' },
      { page: { kind: 'page', pageId: 'crm-finance' }, targetNodeId: 'note-crm-money-precision' },
    ],
  };

  const mindmaps: MindmapWorkspace = {
    nodes: [
      {
        id: 'mm-crm-flow',
        kind: 'mindmap',
        title: 'CRM从商机赢单到回款开票完结全链路闭环',
        parentId: null,
        source: [
          'flowchart LR',
          '  A["企业客户建档\\n(t_crm_customers · 18位税号唯一)"] --> B["销售起草合同\\n(t_crm_contracts · 待法务审批)"]',
          '  B --> C{"PC法务 / 移动总监会签"}',
          '  C -- "通过" --> D["合同履约中\\n拆解分期回款计划 (uq_contract_stage)"]',
          '  C -- "驳回" --> B',
          '  D --> E["销售移动端/PC提报开票\\n(t_crm_invoices · 防超额校验)"]',
          '  E --> F["财务复核开具数电票\\n累加 invoiced_amount"]',
          '  D --> G["银行水单分期到账核销\\n累加 received_amount"]',
          '  G --> H{"实收总额 == 合同总额?"}',
          '  H -- "是" --> I["合同自动流转为 已完结"]',
          '  H -- "超期未到账" --> J["标记 已逾期 · 看板红线预警"]',
        ].join('\n'),
      },
    ],
    links: [
      { page: { kind: 'folder', folderId: 'fld-crm-main' }, targetNodeId: 'mm-crm-flow' },
      { page: { kind: 'folder', folderId: 'fld-crm-mobile' }, targetNodeId: 'mm-crm-flow' },
    ],
  };

  return {
    dbTables,
    tableRows,
    designerFolders,
    designerPages,
    pageSources,
    stickyNotes,
    projectNotes,
    mindmaps,
    entryPageId: 'crm-dashboard',
  };
}
