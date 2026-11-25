import type { DBTableSchema, StickyNoteRule } from '../../store/useProtoStore';
import type { MindmapWorkspace } from '../mindmaps';
import type { NoteWorkspace } from '../notes';
import type { DesignerFolder } from '../sitemap';
import type { DesignerPage } from '../store/usePageStore';
import type { Row } from '../runtime/mock';
import type { ProjectDesignTokens } from '../theme/designTokens';
import { parsePageSource } from '../dsl/parser';
import { printPageSource } from '../dsl/printer';
import { isEnLocale, type Locale } from '../../i18n/runtime';

function norm(tsx: string): string {
  const res = parsePageSource(tsx);
  if (!res.doc) {
    throw new Error(`Failed to parse StarLink demo page source: ${res.issues.map((e) => e.message).join('; ')}`);
  }
  return printPageSource(res.doc);
}

export interface StarlinkDemoDataset {
  designTokens: ProjectDesignTokens;
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

const STARLINK_DESIGN_TOKENS: ProjectDesignTokens = {
  preset: 'modern_minimal',
  primaryColor: '#2563EB',
};

function createEnglishStarlinkDemoDataset(): StarlinkDemoDataset {
  const ticketsTable: DBTableSchema = {
    id: 't_srv_tickets',
    tableName: 'srv_tickets',
    cnName: 'Maintenance Service Tickets',
    domain: 'Field Service & SLA Fulfillment',
    description:
      'Master table for StarLink edge hardware maintenance tickets, tracking customer incidents, assigned field engineers, scheduled on-site windows, and full SLA lifecycle states across desktop and mobile.',
    modeling: {
      entity: 'Maintenance Service Ticket',
      grain: 'One row per on-site hardware maintenance work order (uniquely identified by ticket_no)',
      reason:
        'Centralizes SLA state transitions, cross-field visit scheduling, and foreign-key parent references for spare parts claims and field diagnostic logs.',
      pendingRules: [
        {
          rule: 'visit_end_date >= visit_start_date',
          reason: 'Enforced in real time via Poka-Yoke minField on forms and validated atomically on write',
        },
      ],
    },
    sharedByMenus: [
      {
        pageId: 'page_overview_dashboard',
        menuTitle: 'Dispatch & Analytics → Maintenance Ops Dashboard',
        accessMode: 'READ 查询',
        fieldMappingNote: 'Powers Bento KPI sparklines and ProTable filtering with row-context jump to the workbench',
      },
      {
        pageId: 'page_ticket_workbench',
        menuTitle: 'Dispatch & Analytics → Ticket Master-Detail Workbench',
        accessMode: 'CRUD 读写',
        fieldMappingNote: 'Popup-free Repeater master list driving isolated detail card, schedule form, state transitions, and undoable archive',
      },
      {
        pageId: 'page_kanban_schedule',
        menuTitle: 'Kanban & Scheduling → SLA Kanban & Dispatch Calendar',
        accessMode: 'STATE 状态流转',
        fieldMappingNote: '4-lane status Kanban drag/advance synced live with monthly/weekly engineer schedule calendar',
      },
      {
        pageId: 'page_mobile_field',
        menuTitle: 'Field Engineer Mobile → Mobile Field Dispatch & Parts',
        accessMode: 'STATE 状态流转',
        fieldMappingNote: 'iPhone field app sharing live ticket lanes, weekly route calendar, and bottom-sheet check-in updates',
      },
    ],
    columns: [
      { id: 'c_tk_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'Ticket Primary Key ID' },
      { id: 'c_tk_no', name: 'ticket_no', dataType: 'VARCHAR(64)', nullable: false, isUnique: true, comment: 'Work Order No. (Unique)' },
      { id: 'c_tk_cust', name: 'customer_name', dataType: 'VARCHAR(128)', nullable: false, comment: 'Enterprise Customer Name' },
      { id: 'c_tk_dev', name: 'device_model', dataType: 'VARCHAR(128)', nullable: false, comment: 'StarLink Hardware Model' },
      { id: 'c_tk_phone', name: 'contact_phone', dataType: 'VARCHAR(32)', nullable: false, comment: 'On-Site Contact Phone' },
      {
        id: 'c_tk_prio',
        name: 'priority',
        dataType: "ENUM('Normal','Urgent','Critical')",
        nullable: false,
        defaultValue: "'Urgent'",
        comment: 'SLA Response Priority',
      },
      {
        id: 'c_tk_status',
        name: 'status',
        dataType: "ENUM('Pending Dispatch','On-Site','Pending Sign-Off','Closed')",
        nullable: false,
        defaultValue: "'Pending Dispatch'",
        comment: 'Fulfillment Lifecycle Status',
      },
      { id: 'c_tk_eng', name: 'engineer_name', dataType: 'VARCHAR(64)', nullable: false, comment: 'Assigned Lead Engineer' },
      { id: 'c_tk_sdate', name: 'visit_start_date', dataType: 'DATE', nullable: false, comment: 'Scheduled Visit Start Date' },
      { id: 'c_tk_edate', name: 'visit_end_date', dataType: 'DATE', nullable: false, comment: 'Scheduled Visit End Date' },
      {
        id: 'c_tk_hours',
        name: 'sla_hours',
        dataType: 'DECIMAL(10,1)',
        nullable: false,
        defaultValue: '4.0',
        comment: 'Estimated Maintenance Hours (h)',
      },
    ],
  };

  const partUsagesTable: DBTableSchema = {
    id: 't_srv_part_usages',
    tableName: 'srv_part_usages',
    cnName: 'Spare Parts Claims',
    domain: 'Spare Parts & Van Inventory',
    description:
      'Spare parts claimed and consumed per maintenance ticket, enforcing RESTRICT foreign-key protection so tickets with unreturned parts cannot be archived prematurely.',
    modeling: {
      entity: 'Ticket Spare Part Claim',
      grain: 'One row per unique spare part SKU claimed under a maintenance ticket',
      reason:
        'Enforces composite uniqueness (ticket_id, part_code), stock-cap Poka-Yoke (apply_qty <= stock_available), and ON DELETE RESTRICT parent protection.',
      pendingRules: [
        {
          rule: 'apply_qty <= stock_available AND apply_qty >= 1',
          reason: 'Prevents over-claiming regional depot or van stock on both desktop and mobile forms',
        },
      ],
    },
    uniqueConstraints: [{ name: 'uq_srv_ticket_part', columnIds: ['c_pu_ticket', 'c_pu_code'] }],
    sharedByMenus: [
      {
        pageId: 'page_overview_dashboard',
        menuTitle: 'Dispatch & Analytics → Maintenance Ops Dashboard',
        accessMode: 'READ 查询',
        fieldMappingNote: 'Counts active spare-part fulfillment batches in top KPI cards',
      },
      {
        pageId: 'page_ticket_workbench',
        menuTitle: 'Dispatch & Analytics → Ticket Master-Detail Workbench',
        accessMode: 'CRUD 读写',
        fieldMappingNote: 'Filtered via sourceForeignKey="ticket_id" with PickerInput claim modal, maxField cap, and 5s Undo return',
      },
      {
        pageId: 'page_mobile_field',
        menuTitle: 'Field Engineer Mobile → Mobile Field Dispatch & Parts',
        accessMode: 'CRUD 读写',
        fieldMappingNote: 'Mobile bottom-sheet form with MSheetPicker ticket lookup and van stock maxField guard',
      },
    ],
    columns: [
      { id: 'c_pu_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'Part Claim ID' },
      {
        id: 'c_pu_ticket',
        name: 'ticket_id',
        dataType: 'VARCHAR(64)',
        nullable: false,
        isForeignKey: true,
        references: 'srv_tickets(id)',
        foreignKeyOptions: { name: 'fk_part_usage_ticket', cardinality: '1:N', onDelete: 'RESTRICT' },
        comment: 'Parent Ticket ID (RESTRICT)',
      },
      { id: 'c_pu_code', name: 'part_code', dataType: 'VARCHAR(64)', nullable: false, comment: 'Spare Part SKU Code' },
      { id: 'c_pu_name', name: 'part_name', dataType: 'VARCHAR(128)', nullable: false, comment: 'Spare Part Name' },
      {
        id: 'c_pu_stock',
        name: 'stock_available',
        dataType: 'INT',
        nullable: false,
        defaultValue: '20',
        comment: 'Available Depot / Van Stock',
      },
      { id: 'c_pu_qty', name: 'apply_qty', dataType: 'INT', nullable: false, comment: 'Claimed Quantity' },
    ],
  };

  const ticketLogsTable: DBTableSchema = {
    id: 't_srv_ticket_logs',
    tableName: 'srv_ticket_logs',
    cnName: 'Field Diagnostic Logs',
    domain: 'Field Service & SLA Fulfillment',
    description:
      'Chronological diagnostic and follow-up timeline entries per ticket, configured with ON DELETE CASCADE so logs archive and restore atomically alongside their parent ticket.',
    modeling: {
      entity: 'Ticket Field Follow-Up Log',
      grain: 'One row per diagnostic checkpoint or customer sign-off note on a ticket',
      reason: 'Lifecycle strictly follows the parent ticket via ON DELETE CASCADE and atomic 5-second Undo restoration.',
      pendingRules: [],
    },
    sharedByMenus: [
      {
        pageId: 'page_ticket_workbench',
        menuTitle: 'Dispatch & Analytics → Ticket Master-Detail Workbench',
        accessMode: 'CRUD 读写',
        fieldMappingNote: 'Displayed in detail tabs via sourceForeignKey="ticket_id" with undoable deletion and cascade recovery',
      },
    ],
    columns: [
      { id: 'c_lg_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'Log Entry ID' },
      {
        id: 'c_lg_ticket',
        name: 'ticket_id',
        dataType: 'VARCHAR(64)',
        nullable: false,
        isForeignKey: true,
        references: 'srv_tickets(id)',
        foreignKeyOptions: { name: 'fk_ticket_log_ticket', cardinality: '1:N', onDelete: 'CASCADE' },
        comment: 'Parent Ticket ID (CASCADE)',
      },
      {
        id: 'c_lg_stage',
        name: 'action_stage',
        dataType: "ENUM('Ticket Logged','Engineer Assigned','On-Site Diagnosis','Completed Follow-Up')",
        nullable: false,
        defaultValue: "'On-Site Diagnosis'",
        comment: 'Diagnostic Checkpoint Stage',
      },
      { id: 'c_lg_note', name: 'log_note', dataType: 'VARCHAR(255)', nullable: false, comment: 'Field Inspection & Action Note' },
      { id: 'c_lg_date', name: 'logged_date', dataType: 'DATE', nullable: false, comment: 'Logged Date' },
    ],
  };

  const tableRows: Record<string, Row[]> = {
    t_srv_tickets: [
      {
        id: 't_srv_tickets-001',
        ticket_no: 'WO-202611-01',
        customer_name: 'Aurora Precision Manufacturing',
        device_model: 'StarLink-X900 Edge Gateway',
        contact_phone: '+1-415-890-2410',
        priority: 'Critical',
        status: 'Pending Dispatch',
        engineer_name: 'Alex Lin',
        visit_start_date: '2026-11-25',
        visit_end_date: '2026-11-26',
        sla_hours: 4.0,
      },
      {
        id: 't_srv_tickets-002',
        ticket_no: 'WO-202611-02',
        customer_name: 'StarSea Photonics Campus',
        device_model: 'StarLink-P600 Phased-Array Base',
        contact_phone: '+1-408-772-5190',
        priority: 'Urgent',
        status: 'On-Site',
        engineer_name: 'Tina Zhou',
        visit_start_date: '2026-11-24',
        visit_end_date: '2026-11-26',
        sla_hours: 6.0,
      },
      {
        id: 't_srv_tickets-003',
        ticket_no: 'WO-202611-03',
        customer_name: 'CloudMap Wafer Fab Center',
        device_model: 'StarLink-M400 Industrial Router',
        contact_phone: '+1-650-431-8820',
        priority: 'Normal',
        status: 'Pending Dispatch',
        engineer_name: 'Alex Lin',
        visit_start_date: '2026-11-26',
        visit_end_date: '2026-11-28',
        sla_hours: 3.5,
      },
      {
        id: 't_srv_tickets-004',
        ticket_no: 'WO-202611-04',
        customer_name: 'Lingang Autonomous Port Terminal',
        device_model: 'StarLink-R800 Maritime Satcom',
        contact_phone: '+1-206-614-3308',
        priority: 'Critical',
        status: 'Pending Sign-Off',
        engineer_name: 'Liam Chen',
        visit_start_date: '2026-11-22',
        visit_end_date: '2026-11-25',
        sla_hours: 8.0,
      },
      {
        id: 't_srv_tickets-005',
        ticket_no: 'WO-202611-05',
        customer_name: 'Yizhuang V2X Corridor Hub',
        device_model: 'StarLink-V520 Roadside Unit',
        contact_phone: '+1-312-904-7721',
        priority: 'Urgent',
        status: 'On-Site',
        engineer_name: 'Ryan Zhao',
        visit_start_date: '2026-11-25',
        visit_end_date: '2026-11-27',
        sla_hours: 4.5,
      },
      {
        id: 't_srv_tickets-006',
        ticket_no: 'WO-202611-06',
        customer_name: 'Tianfu AI Supercomputing Cluster',
        device_model: 'StarLink-X900 Edge Gateway',
        contact_phone: '+1-512-783-1940',
        priority: 'Normal',
        status: 'Closed',
        engineer_name: 'Tina Zhou',
        visit_start_date: '2026-11-18',
        visit_end_date: '2026-11-20',
        sla_hours: 3.0,
      },
      {
        id: 't_srv_tickets-007',
        ticket_no: 'WO-202611-07',
        customer_name: 'Hefei Quantum Research Campus',
        device_model: 'StarLink-Q300 Precision Timing Node',
        contact_phone: '+1-617-520-6412',
        priority: 'Urgent',
        status: 'Pending Sign-Off',
        engineer_name: 'Liam Chen',
        visit_start_date: '2026-11-23',
        visit_end_date: '2026-11-25',
        sla_hours: 5.0,
      },
      {
        id: 't_srv_tickets-008',
        ticket_no: 'WO-202611-08',
        customer_name: 'Nansha Offshore Wind Control Hub',
        device_model: 'StarLink-P600 Phased-Array Base',
        contact_phone: '+1-713-842-9055',
        priority: 'Normal',
        status: 'Closed',
        engineer_name: 'Ryan Zhao',
        visit_start_date: '2026-11-15',
        visit_end_date: '2026-11-17',
        sla_hours: 6.5,
      },
    ],
    t_srv_part_usages: [
      {
        id: 't_srv_part_usages-001',
        ticket_id: 't_srv_tickets-001',
        part_code: 'SP-OPT-408',
        part_name: '10G SFP+ Optical Transceiver',
        stock_available: 18,
        apply_qty: 2,
      },
      {
        id: 't_srv_part_usages-002',
        ticket_id: 't_srv_tickets-001',
        part_code: 'SP-PWR-210',
        part_name: 'Redundant Industrial PSU Module',
        stock_available: 9,
        apply_qty: 1,
      },
      {
        id: 't_srv_part_usages-003',
        ticket_id: 't_srv_tickets-002',
        part_code: 'SP-RF-920',
        part_name: 'Ku-Band Phased-Array RF Board',
        stock_available: 6,
        apply_qty: 1,
      },
      {
        id: 't_srv_part_usages-004',
        ticket_id: 't_srv_tickets-004',
        part_code: 'SP-ANT-750',
        part_name: 'Gyro-Stabilized Radome Feed',
        stock_available: 5,
        apply_qty: 1,
      },
      {
        id: 't_srv_part_usages-005',
        ticket_id: 't_srv_tickets-004',
        part_code: 'SP-OPT-408',
        part_name: '10G SFP+ Optical Transceiver',
        stock_available: 16,
        apply_qty: 4,
      },
      {
        id: 't_srv_part_usages-006',
        ticket_id: 't_srv_tickets-005',
        part_code: 'SP-V2X-310',
        part_name: 'C-V2X Low-Latency Baseband Card',
        stock_available: 11,
        apply_qty: 2,
      },
      {
        id: 't_srv_part_usages-007',
        ticket_id: 't_srv_tickets-006',
        part_code: 'SP-OPT-408',
        part_name: '10G SFP+ Optical Transceiver',
        stock_available: 14,
        apply_qty: 2,
      },
      {
        id: 't_srv_part_usages-008',
        ticket_id: 't_srv_tickets-007',
        part_code: 'SP-CLK-105',
        part_name: 'OCXO Rubidium Holdover Oscillator',
        stock_available: 4,
        apply_qty: 1,
      },
    ],
    t_srv_ticket_logs: [
      {
        id: 't_srv_ticket_logs-001',
        ticket_id: 't_srv_tickets-001',
        action_stage: 'Ticket Logged',
        log_note: 'Telemetry detected -19.4 dBm optical attenuation on uplink port XE-0/1; auto-escalated to Critical SLA.',
        logged_date: '2026-11-25',
      },
      {
        id: 't_srv_ticket_logs-002',
        ticket_id: 't_srv_tickets-001',
        action_stage: 'Engineer Assigned',
        log_note: 'Assigned East Region lead Alex Lin; reserved 2x SP-OPT-408 transceivers and 1x backup PSU from Hangzhou depot.',
        logged_date: '2026-11-25',
      },
      {
        id: 't_srv_ticket_logs-003',
        ticket_id: 't_srv_tickets-002',
        action_stage: 'On-Site Diagnosis',
        log_note: 'Arrived at Building B rooftop; isolated azimuth beam-steering drift to RF board channel #3 and started swap.',
        logged_date: '2026-11-24',
      },
      {
        id: 't_srv_ticket_logs-004',
        ticket_id: 't_srv_tickets-003',
        action_stage: 'Ticket Logged',
        log_note: 'Quarterly cleanroom firmware upgrade & BGP failover drill scheduled; no hardware spare parts required.',
        logged_date: '2026-11-25',
      },
      {
        id: 't_srv_ticket_logs-005',
        ticket_id: 't_srv_tickets-004',
        action_stage: 'On-Site Diagnosis',
        log_note: 'Replaced salt-fog corroded radome feed seal on quay crane #07; satellite lock stabilized at SNR 14.8 dB.',
        logged_date: '2026-11-23',
      },
      {
        id: 't_srv_ticket_logs-006',
        ticket_id: 't_srv_tickets-005',
        action_stage: 'On-Site Diagnosis',
        log_note: 'Swapped C-V2X baseband card at intersection Pole #19; end-to-end roadside broadcast latency restored to 8.2 ms.',
        logged_date: '2026-11-25',
      },
      {
        id: 't_srv_ticket_logs-007',
        ticket_id: 't_srv_tickets-006',
        action_stage: 'Completed Follow-Up',
        log_note: 'Customer NOC signed off after 48-hour zero-packet-loss soak test.',
        logged_date: '2026-11-20',
      },
      {
        id: 't_srv_ticket_logs-008',
        ticket_id: 't_srv_tickets-007',
        action_stage: 'On-Site Diagnosis',
        log_note: 'Installed calibrated OCXO oscillator; PTP grandmaster phase offset verified within ±12 ns.',
        logged_date: '2026-11-24',
      },
    ],
  };

  const designerFolders: DesignerFolder[] = [
    { id: 'fld_workbench', title: 'Dispatch & Analytics', parentFolderId: null },
    { id: 'fld_schedule', title: 'Kanban & Scheduling', parentFolderId: null },
    { id: 'fld_mobile_engineer', title: 'Field Engineer Mobile', parentFolderId: null },
  ];

  const designerPages: DesignerPage[] = [
    { pageId: 'page_overview_dashboard', title: 'Maintenance Ops Dashboard', folderId: 'fld_workbench', platform: 'desktop' },
    { pageId: 'page_ticket_workbench', title: 'Ticket Master-Detail Workbench', folderId: 'fld_workbench', platform: 'desktop' },
    { pageId: 'page_kanban_schedule', title: 'SLA Kanban & Dispatch Calendar', folderId: 'fld_schedule', platform: 'desktop' },
    { pageId: 'page_mobile_field', title: 'Mobile Field Dispatch & Parts', folderId: 'fld_mobile_engineer', platform: 'mobile' },
  ];

  const dashboardSource = norm(`// @protoflow page: page_overview_dashboard
export default function Page() {
  return (
    <Page
      pfId="p_dash_root"
      title="Maintenance Ops Dashboard"
      description="Live monitoring of StarLink after-sales ticket throughput, 24h SLA compliance, and spare-part consumption"
      emptyTitle="No maintenance metrics yet — open the Master-Detail Workbench to create your first work order"
      errorFallback="result_500"
      errorTitle="Telemetry & SLA Aggregation Gateway Timeout"
      errorDescription="Upstream IoT heartbeats and ticket aggregation timed out. Retry shortly or switch UI Stack back to Ideal."
    >
      <PageHeader
        pfId="ph_dash_header"
        title="StarLink Maintenance & Spare Parts Command"
        subTitle="24×7 global edge hardware dispatch, SLA compliance tracking, and regional depot inventory cockpit"
        tagText="SLA Live Sync"
        tagColor="green"
        breadcrumb={['Dispatch & Analytics', 'Maintenance Ops Dashboard']}
      />
      <Toolbar
        pfId="tb_dash_actions"
        align="between"
        title="Quick Dispatch Entry"
        subTitle="Jump into the popup-free Master-Detail Workbench or drag tickets across SLA Kanban lanes"
      >
        <Space pfId="sp_dash_btns" size="middle">
          <Button
            pfId="btn_dash_to_wb"
            type="primary"
            icon="edit"
            onClick={() => navigate('page_ticket_workbench')}
          >
            Open Master-Detail Workbench
          </Button>
          <Button
            pfId="btn_dash_to_kb"
            icon="eye"
            onClick={() => navigate('page_kanban_schedule')}
          >
            Open SLA Kanban & Calendar
          </Button>
        </Space>
      </Toolbar>
      <Row pfId="row_dash_kpis" gutter={16}>
        <Col pfId="col_kpi_1" span={6}>
          <Card pfId="card_kpi_1" variant="bento" size="small">
            <Statistic
              pfId="stat_kpi_total"
              title="Active Service Tickets"
              table="t_srv_tickets"
              suffix=" tickets"
              trend="up"
              trendText="+14.6%"
              sparkline={true}
              valueColor="blue"
              bordered={false}
            />
          </Card>
        </Col>
        <Col pfId="col_kpi_2" span={6}>
          <Card pfId="card_kpi_2" variant="bento" size="small">
            <Statistic
              pfId="stat_kpi_sla"
              title="24h SLA On-Time Rate"
              value="98.4"
              suffix="%"
              trend="up"
              trendText="+2.1%"
              sparkline={true}
              valueColor="green"
              bordered={false}
            />
          </Card>
        </Col>
        <Col pfId="col_kpi_3" span={6}>
          <Card pfId="card_kpi_3" variant="bento" size="small">
            <Statistic
              pfId="stat_kpi_parts"
              title="Spare Part Claim Batches"
              table="t_srv_part_usages"
              suffix=" claims"
              trend="up"
              trendText="+8.5%"
              sparkline={true}
              valueColor="orange"
              bordered={false}
            />
          </Card>
        </Col>
        <Col pfId="col_kpi_4" span={6}>
          <Card pfId="card_kpi_4" variant="bento" size="small">
            <Statistic
              pfId="stat_kpi_mttr"
              title="Mean Time to Repair (MTTR)"
              value="3.2"
              suffix="h"
              trend="down"
              trendText="-18.0%"
              sparkline={true}
              valueColor="blue"
              bordered={false}
            />
          </Card>
        </Col>
      </Row>
      <AiCopilotCard
        pfId="ai_dash_copilot"
        title="AI Dispatch & Spare-Part Stock Insights"
        badge="AI Triage"
        tone="indigo"
        summary="Cross-checked live SLA deadlines against regional van & depot stock levels — 2 recommended actions:"
        primaryActionLabel="Triage in Workbench"
        onPrimaryAction={() => navigate('page_ticket_workbench')}
        items={[
          {
            title: 'Critical Optical Attenuation Escalation (WO-202611-01)',
            detail: 'Aurora Precision gateway uplink attenuation breached threshold with < 2h to SLA window; Alex Lin is 14 km away.',
            actionLabel: 'Dispatch Now',
            onClick: () => navigate('page_ticket_workbench'),
          },
          {
            title: '10G SFP+ Transceiver Safety Stock Alert',
            detail: 'SP-OPT-408 weekly claims rose 22% across East & Maritime hubs; verify scheduled jobs before locking buffer stock.',
            actionLabel: 'Inspect Schedule',
            onClick: () => navigate('page_kanban_schedule'),
          },
        ]}
      />
      <Row pfId="row_dash_charts" gutter={16}>
        <Col pfId="col_chart_bar" span={14}>
          <Card pfId="card_chart_bar" title="Regional Ticket Throughput by SLA Stage" extra="Rolling 7-Day Live Telemetry" headerBg="white">
            <BarChart
              pfId="chart_region_throughput"
              title="Regional Ticket Volume"
              source="inline"
              dimension="region"
              metrics={[
                { field: 'completed', label: 'Closed' },
                { field: 'visiting', label: 'On-Site' },
                { field: 'pending', label: 'Pending Dispatch' },
              ]}
              data={[
                { region: 'East Smart Mfg', completed: 46, visiting: 14, pending: 5 },
                { region: 'South Photonics', completed: 38, visiting: 11, pending: 4 },
                { region: 'North Energy Grid', completed: 29, visiting: 9, pending: 3 },
                { region: 'Southwest Compute', completed: 24, visiting: 7, pending: 2 },
              ]}
              height={300}
              palette="blue"
              showLegend={true}
            />
          </Card>
        </Col>
        <Col pfId="col_chart_donut" span={10}>
          <Card pfId="card_chart_donut" title="Spare Parts Consumption Mix" extra="Share by Claimed Units" headerBg="white">
            <DonutChart
              pfId="chart_part_category"
              title="Claimed Spare Part Mix"
              source="inline"
              dimension="category"
              metrics={[{ field: 'qty', label: 'Units' }]}
              data={[
                { category: '10G SFP+ Transceiver', qty: 42 },
                { category: 'Phased-Array RF Board', qty: 28 },
                { category: 'Redundant Industrial PSU', qty: 19 },
                { category: 'Maritime Radome Feed', qty: 15 },
              ]}
              height={300}
              palette="teal"
              showLegend={true}
              showLabel={true}
            />
          </Card>
        </Col>
      </Row>
      <Card
        pfId="card_dash_table"
        title="Priority Maintenance Ticket Ledger"
        extra="Click Open in Workbench to carry the exact clicked row context into Master-Detail"
        headerBg="white"
      >
        <QueryForm
          pfId="qf_dash_tickets"
          target="tbl_dash_tickets"
          fields={[
            { name: 'ticket_no', label: 'Ticket No.', type: 'input', placeholder: 'Search WO-202611-...' },
            { name: 'priority', label: 'Priority', type: 'select', options: 'Normal,Urgent,Critical' },
            { name: 'status', label: 'Status', type: 'select', options: 'Pending Dispatch,On-Site,Pending Sign-Off,Closed' },
          ]}
        />
        <Table
          pfId="tbl_dash_tickets"
          table="t_srv_tickets"
          striped={true}
          pageSize={5}
          columns={[
            { dataIndex: 'ticket_no', title: 'Ticket No.', render: 'link', width: 150 },
            { dataIndex: 'customer_name', title: 'Enterprise Account', width: 210 },
            { dataIndex: 'device_model', title: 'Hardware Model', width: 210 },
            { dataIndex: 'priority', title: 'Priority', render: 'tag', width: 110 },
            { dataIndex: 'status', title: 'SLA Status', render: 'tag', width: 140 },
            { dataIndex: 'engineer_name', title: 'Engineer', width: 120 },
            { dataIndex: 'visit_start_date', title: 'Visit Date', render: 'date', width: 125 },
            { dataIndex: 'sla_hours', title: 'Est. Hours', align: 'right', width: 105 },
          ]}
          rowActions={[
            { label: 'Open in Workbench', onClick: () => navigate('page_ticket_workbench', 'row') },
          ]}
        />
      </Card>
    </Page>
  );
}
`);

  const workbenchSource = norm(`// @protoflow page: page_ticket_workbench
export default function Page() {
  return (
    <Page
      pfId="p_wb_root"
      title="Ticket Master-Detail Workbench"
      description="Popup-free split workbench: select any ticket card on the left to inspect & edit schedules, spare parts, and logs on the right"
      emptyTitle="No active maintenance tickets — click New Ticket above to log an incident"
      errorFallback="result_500"
      errorTitle="Master-Detail Dispatch Service Unavailable"
      errorDescription="Ticket state synchronization & depot stock reservation timed out. Please retry."
    >
      <PageHeader
        pfId="ph_wb_header"
        title="Ticket Master-Detail Fulfillment Workbench"
        subTitle="Popup-free Repeater selection synced to isolated detail forms, RESTRICT/CASCADE child tables, Poka-Yoke guards & 5s Undo"
        tagText="Poka-Yoke Guards Active"
        tagColor="blue"
        breadcrumb={['Dispatch & Analytics', 'Ticket Master-Detail Workbench']}
      />
      <Toolbar
        pfId="tb_wb_global"
        align="between"
        title="Dispatch Action Bar"
        subTitle="Create unique work orders or switch to the SLA Kanban & Calendar view"
      >
        <Space pfId="sp_wb_global_btns" size="middle">
          <Button
            pfId="btn_wb_new_ticket"
            type="primary"
            icon="plus"
            onClick={() => openModal('mdl_new_ticket')}
          >
            New Ticket
          </Button>
          <Button
            pfId="btn_wb_to_kanban"
            icon="eye"
            onClick={() => navigate('page_kanban_schedule')}
          >
            SLA Kanban & Calendar
          </Button>
          <Button pfId="btn_wb_to_dash" onClick={() => navigate('page_overview_dashboard')}>
            Back to Dashboard
          </Button>
        </Space>
      </Toolbar>
      <Row pfId="row_wb_split" gutter={16}>
        <Col pfId="col_wb_master" span={9}>
          <Card pfId="card_wb_master" title="Work Order Queue" extra="Click card to switch" headerBg="white">
            <Toolbar pfId="tb_wb_search" align="left">
              <SearchInput
                pfId="si_wb_tickets"
                target="rep_ticket_list"
                placeholder="Search ticket No., customer, model, engineer..."
                allowClear={true}
                width="full"
              />
            </Toolbar>
            <Repeater
              pfId="rep_ticket_list"
              table="t_srv_tickets"
              cols={1}
              gap={12}
              pageSize={5}
              pagination={true}
              autoSelectFirst={true}
              emptyText="No matching maintenance tickets"
              onItemClick={() => selectRow()}
            >
              <Card
                pfId="rep_item_card"
                title={'{{row.ticket_no}}'}
                extra={'{{row.status}}'}
                size="small"
                hoverable={true}
                variant="subtle"
              >
                <Flex pfId="rep_item_top" justify="space-between" align="center" gap={8}>
                  <Text pfId="rep_item_cust" strong={true} size="base">{'{{row.customer_name}}'}</Text>
                  <Tag pfId="rep_item_prio" color="orange" round={true}>{'{{row.priority}}'}</Tag>
                </Flex>
                <Flex pfId="rep_item_meta" justify="space-between" align="center" gap={8}>
                  <Text pfId="rep_item_dev" type="secondary" size="xs">{'Model: {{row.device_model}}'}</Text>
                  <Text pfId="rep_item_eng" type="secondary" size="xs">
                    {'Eng: {{row.engineer_name}} · {{row.visit_start_date}}'}
                  </Text>
                </Flex>
              </Card>
            </Repeater>
          </Card>
        </Col>
        <Col pfId="col_wb_detail" span={15}>
          <Card
            pfId="card_wb_detail"
            title={'Active Ticket Fulfillment Pod ({{row.ticket_no}})'}
            extra={'Lead Engineer: {{row.engineer_name}}'}
            activeTable="t_srv_tickets"
            headerBg="blue"
          >
            <Toolbar pfId="tb_detail_actions" align="between" bg="gray" bordered={true}>
              <Space pfId="sp_detail_flow" size="small" wrap={true}>
                <Button
                  pfId="btn_act_start_visit"
                  type="primary"
                  icon="check"
                  disabledWhenField="status"
                  disabledWhenValue="!Pending Dispatch"
                  disabledReason="Only tickets in Pending Dispatch can start on-site dispatch"
                  onClick={() => {
                    updateRow({ status: 'On-Site' });
                    toast('Ticket transitioned to On-Site', 'success');
                  }}
                >
                  Start Visit
                </Button>
                <Button
                  pfId="btn_act_submit_accept"
                  icon="check"
                  disabledWhenField="status"
                  disabledWhenValue="!On-Site"
                  disabledReason="Only On-Site tickets can be submitted for customer sign-off"
                  onClick={() => {
                    updateRow({ status: 'Pending Sign-Off' });
                    toast('Submitted for customer sign-off (Pending Sign-Off)', 'success');
                  }}
                >
                  Sign-Off
                </Button>
                <Button
                  pfId="btn_act_apply_part"
                  icon="plus"
                  disabledWhenField="status"
                  disabledWhenValue="Closed"
                  disabledReason="Closed tickets cannot claim additional spare parts"
                  onClick={() => openModal('mdl_apply_part')}
                >
                  Claim Part
                </Button>
                <Button
                  pfId="btn_act_add_log"
                  icon="edit"
                  onClick={() => openModal('mdl_add_log')}
                >
                  Add Log
                </Button>
                <Button
                  pfId="btn_act_soft_delete"
                  icon="delete"
                  disabledWhenField="status"
                  disabledWhenValue="!Pending Dispatch"
                  disabledReason="Only Pending Dispatch tickets can be archived (blocked by RESTRICT if parts remain)"
                  onClick={() => deleteRow('undo')}
                >
                  Archive (Undo)
                </Button>
                <Button
                  pfId="btn_act_force_close"
                  danger={true}
                  disabledWhenField="status"
                  disabledWhenValue="Closed"
                  disabledReason="Ticket is already closed"
                  onClick={() => {
                    confirm('High-risk action: Force-closing locks parts & SLA logs. Type exact Ticket No. to confirm:', '{{row.ticket_no}}');
                    updateRow({ status: 'Closed' });
                    toast('Ticket force-closed after exact Ticket No. verification', 'warning');
                  }}
                >
                  Force Close
                </Button>
              </Space>
            </Toolbar>
            <Descriptions
              pfId="desc_ticket_info"
              title="Ticket Summary"
              table="t_srv_tickets"
              bordered={true}
              column={2}
              size="small"
              items={[
                { label: 'Work Order No.', field: 'ticket_no' },
                { label: 'SLA Status', field: 'status' },
                { label: 'Enterprise Account', field: 'customer_name' },
                { label: 'Priority', field: 'priority' },
                { label: 'Hardware Model', field: 'device_model' },
                { label: 'On-Site Contact', field: 'contact_phone' },
                { label: 'Visit Start Date', field: 'visit_start_date' },
                { label: 'Visit End Date', field: 'visit_end_date' },
              ]}
            />
            <Divider
              pfId="div_edit_schedule"
              text="Schedule & Contact Maintenance (Live Date & Phone Poka-Yoke)"
              orientation="left"
            />
            <Form pfId="frm_edit_ticket" table="t_srv_tickets" cols={2} layout="vertical">
              <Input
                pfId="inp_edit_eng"
                label="Assigned Lead Engineer"
                name="engineer_name"
                required={true}
                placeholder="Enter lead engineer name"
              />
              <Input
                pfId="inp_edit_phone"
                label="On-Site Contact Phone"
                name="contact_phone"
                required={true}
                formatRule="phone"
                validationMessage="Please enter a valid phone number (e.g. +1-415-890-2410)"
                placeholder="+1-415-890-2410"
              />
              <DatePicker pfId="dp_edit_sdate" label="Visit Start Date" name="visit_start_date" required={true} />
              <DatePicker
                pfId="dp_edit_edate"
                label="Visit End Date (≥ Start)"
                name="visit_end_date"
                required={true}
                minField="visit_start_date"
                validationMessage="Visit end date cannot be earlier than visit start date"
              />
              <Select
                pfId="sel_edit_prio"
                label="Response Priority"
                name="priority"
                required={true}
                options="Normal,Urgent,Critical"
              />
              <NumberInput
                pfId="num_edit_hours"
                label="Estimated Hours (h)"
                name="sla_hours"
                required={true}
                minValue={0.5}
                maxValue={72}
                step={0.5}
                suffix="h"
                validationMessage="Estimated SLA hours must be between 0.5 and 72 hours"
              />
            </Form>
            <Toolbar pfId="tb_save_ticket" align="right">
              <Button
                pfId="btn_save_ticket"
                type="primary"
                icon="check"
                onClick={() => {
                  submitForm('frm_edit_ticket');
                  toast('Schedule & contact details saved', 'success');
                }}
              >
                Save Schedule Update
              </Button>
            </Toolbar>
            <Divider pfId="div_child_tabs" text="Linked Spare Parts & Field Diagnostic Child Tables" orientation="left" />
            <Tabs pfId="tabs_ticket_children" type="card">
              <Tab pfId="tab_part_usages" title="Claimed Spare Parts (RESTRICT Delete Guard)">
                <Alert
                  pfId="alt_part_rule"
                  type="info"
                  showIcon={true}
                  message="Foreign-key guard: Unreturned spare parts block archiving the parent ticket (RESTRICT). Returning a part offers a 5-second Undo toast."
                />
                <Table
                  pfId="tbl_ticket_parts"
                  table="t_srv_part_usages"
                  sourceForeignKey="ticket_id"
                  size="small"
                  pagination={false}
                  emptyText="No spare parts claimed for this ticket (ready for CASCADE archive test)"
                  columns={[
                    { dataIndex: 'part_code', title: 'Part SKU', width: 135 },
                    { dataIndex: 'part_name', title: 'Spare Part Name', width: 210 },
                    { dataIndex: 'stock_available', title: 'Available Stock', align: 'right', width: 125 },
                    { dataIndex: 'apply_qty', title: 'Claimed Qty', align: 'right', width: 115 },
                  ]}
                  rowActions={[{ label: 'Return Part (Undo)', danger: true, onClick: () => deleteRow('undo') }]}
                />
              </Tab>
              <Tab pfId="tab_ticket_logs" title="Field Diagnostic Logs (CASCADE Archive)">
                <Table
                  pfId="tbl_ticket_logs"
                  table="t_srv_ticket_logs"
                  sourceForeignKey="ticket_id"
                  size="small"
                  pagination={false}
                  emptyText="No diagnostic logs recorded for this ticket"
                  columns={[
                    { dataIndex: 'action_stage', title: 'Checkpoint', render: 'tag', width: 150 },
                    { dataIndex: 'log_note', title: 'Field Diagnostic & Action Note', width: 280 },
                    { dataIndex: 'logged_date', title: 'Date', render: 'date', width: 115 },
                  ]}
                  rowActions={[{ label: 'Remove Log (Undo)', danger: true, onClick: () => deleteRow('undo') }]}
                />
              </Tab>
            </Tabs>
          </Card>
        </Col>
      </Row>
      <Modal
        pfId="mdl_new_ticket_node"
        id="mdl_new_ticket"
        title="Create Maintenance Service Ticket"
        width={680}
        okText="Create Ticket"
        onOk={() => {
          submitForm('frm_new_ticket');
          closeOverlay();
          toast('New service ticket created and added to dispatch queue', 'success');
        }}
      >
        <Form pfId="frm_new_ticket" table="t_srv_tickets" cols={2} layout="vertical">
          <Input
            pfId="inp_new_no"
            label="Work Order No. (Unique)"
            name="ticket_no"
            required={true}
            placeholder="e.g. WO-202611-18"
          />
          <Input
            pfId="inp_new_cust"
            label="Enterprise Customer"
            name="customer_name"
            required={true}
            placeholder="Enter customer organization name"
          />
          <Input
            pfId="inp_new_dev"
            label="StarLink Hardware Model"
            name="device_model"
            required={true}
            placeholder="e.g. StarLink-X900 Edge Gateway"
          />
          <Input
            pfId="inp_new_phone"
            label="On-Site Contact Phone"
            name="contact_phone"
            required={true}
            formatRule="phone"
            validationMessage="Enter a valid phone number"
            placeholder="+1-415-890-2410"
          />
          <Select
            pfId="sel_new_prio"
            label="Response Priority"
            name="priority"
            required={true}
            initialValue="Urgent"
            options="Normal,Urgent,Critical"
          />
          <Input
            pfId="inp_new_eng"
            label="Assigned Lead Engineer"
            name="engineer_name"
            required={true}
            initialValue="Alex Lin"
            placeholder="Enter engineer name"
          />
          <DatePicker pfId="dp_new_sdate" label="Visit Start Date" name="visit_start_date" required={true} />
          <DatePicker
            pfId="dp_new_edate"
            label="Visit End Date (≥ Start)"
            name="visit_end_date"
            required={true}
            minField="visit_start_date"
            validationMessage="Visit end date cannot be earlier than start date"
          />
          <NumberInput
            pfId="num_new_hours"
            label="Estimated Hours (h)"
            name="sla_hours"
            required={true}
            minValue={0.5}
            maxValue={72}
            step={0.5}
            suffix="h"
          />
        </Form>
      </Modal>
      <Modal
        pfId="mdl_apply_part_node"
        id="mdl_apply_part"
        title="Claim Spare Part (With Stock Cap Guard)"
        width={640}
        okText="Confirm Claim"
        onOk={() => {
          submitForm('frm_apply_part');
          closeOverlay();
          toast('Spare part claim recorded on ticket', 'success');
        }}
      >
        <Form pfId="frm_apply_part" table="t_srv_part_usages" cols={2} layout="vertical">
          <PickerInput
            pfId="pk_part_ticket"
            label="Parent Service Ticket"
            name="ticket_id"
            overlay="mdl_pick_ticket"
            placeholder="Select target service ticket"
            required={true}
            span={2}
          />
          <Input
            pfId="inp_part_code"
            label="Spare Part SKU"
            name="part_code"
            required={true}
            placeholder="e.g. SP-OPT-408 (unique per ticket)"
          />
          <Input
            pfId="inp_part_name"
            label="Spare Part Name"
            name="part_name"
            required={true}
            placeholder="e.g. 10G SFP+ Optical Transceiver"
          />
          <NumberInput
            pfId="num_part_stock"
            label="Available Depot Stock"
            name="stock_available"
            required={true}
            minValue={1}
            suffix="pcs"
          />
          <NumberInput
            pfId="num_part_qty"
            label="Claim Quantity (≤ Available)"
            name="apply_qty"
            required={true}
            minValue={1}
            maxField="stock_available"
            suffix="pcs"
            validationMessage="Claimed quantity cannot exceed available depot stock"
          />
        </Form>
      </Modal>
      <Modal
        pfId="mdl_add_log_node"
        id="mdl_add_log"
        title="Add Field Diagnostic Log"
        width={620}
        okText="Save Log"
        onOk={() => {
          submitForm('frm_add_log');
          closeOverlay();
          toast('Field diagnostic log saved', 'success');
        }}
      >
        <Form pfId="frm_add_log" table="t_srv_ticket_logs" cols={2} layout="vertical">
          <PickerInput
            pfId="pk_log_ticket"
            label="Parent Service Ticket"
            name="ticket_id"
            overlay="mdl_pick_ticket"
            placeholder="Select target service ticket"
            required={true}
          />
          <Select
            pfId="sel_log_stage"
            label="Diagnostic Checkpoint"
            name="action_stage"
            required={true}
            initialValue="On-Site Diagnosis"
            options="Ticket Logged,Engineer Assigned,On-Site Diagnosis,Completed Follow-Up"
          />
          <DatePicker pfId="dp_log_date" label="Logged Date" name="logged_date" required={true} span={2} />
          <Textarea
            pfId="ta_log_note"
            label="Field Inspection & Action Note"
            name="log_note"
            required={true}
            rows={3}
            span={2}
            placeholder="Record signal readings, replaced modules, and customer verification notes..."
          />
        </Form>
      </Modal>
      <Modal
        pfId="mdl_pick_ticket_node"
        id="mdl_pick_ticket"
        title="Select Service Ticket"
        width={760}
        okText="Select Ticket"
        onOk={() => returnSelection('tbl_pick_ticket', 'ticket_no', 'id')}
      >
        <Toolbar pfId="tb_pick_ticket" align="left">
          <SearchInput
            pfId="si_pick_ticket"
            target="tbl_pick_ticket"
            placeholder="Search ticket No. or customer..."
            allowClear={true}
            width="full"
          />
        </Toolbar>
        <Table
          pfId="tbl_pick_ticket"
          table="t_srv_tickets"
          selectable={true}
          selectionType="radio"
          size="small"
          pageSize={5}
          columns={[
            { dataIndex: 'ticket_no', title: 'Ticket No.', width: 145 },
            { dataIndex: 'customer_name', title: 'Customer', width: 200 },
            { dataIndex: 'device_model', title: 'Model', width: 190 },
            { dataIndex: 'status', title: 'Status', render: 'tag', width: 130 },
            { dataIndex: 'engineer_name', title: 'Engineer', width: 110 },
          ]}
        />
      </Modal>
    </Page>
  );
}
`);

  const kanbanScheduleSource = norm(`// @protoflow page: page_kanban_schedule
export default function Page() {
  return (
    <Page
      pfId="p_kb_root"
      title="SLA Kanban & Dispatch Calendar"
      description="4-stage SLA Kanban board and monthly/weekly engineer visit calendar backed by the same live ticket table"
      emptyTitle="No scheduled maintenance visits in this window — create a ticket in the workbench"
      errorFallback="banner"
      errorTitle="Live Schedule Sync Degraded"
      errorDescription="Showing cached local schedule snapshot while real-time dispatch gateway reconnects."
    >
      <PageHeader
        pfId="ph_kb_header"
        title="SLA Fulfillment Kanban & Dispatch Calendar"
        subTitle="Drag cards or click lane arrows to advance SLA status — synced immediately with the calendar below and mobile field app"
        tagText="Kanban + Calendar Synced"
        tagColor="blue"
        breadcrumb={['Kanban & Scheduling', 'SLA Kanban & Dispatch Calendar']}
      />
      <Toolbar
        pfId="tb_kb_top"
        align="between"
        title="Visual Dispatch Coordinator"
        subTitle="Status changes here propagate live to the Master-Detail Workbench and iPhone Field App"
      >
        <Space pfId="sp_kb_btns" size="middle">
          <Button
            pfId="btn_kb_to_wb"
            type="primary"
            icon="edit"
            onClick={() => navigate('page_ticket_workbench')}
          >
            Open Master-Detail Workbench
          </Button>
          <Button pfId="btn_kb_to_dash" onClick={() => navigate('page_overview_dashboard')}>
            Back to Dashboard
          </Button>
        </Space>
      </Toolbar>
      <Card
        pfId="card_kb_lanes"
        title="4-Stage SLA Fulfillment Kanban"
        extra="Drag cards or click the right arrow to advance ticket status"
        headerBg="white"
      >
        <QueryForm
          pfId="qf_kb_filter"
          target="kb_srv_tickets"
          fields={[
            { name: 'engineer_name', label: 'Engineer', type: 'input', placeholder: 'Filter by engineer name' },
            { name: 'priority', label: 'Priority', type: 'select', options: 'Normal,Urgent,Critical' },
          ]}
        />
        <Kanban
          pfId="kb_srv_tickets"
          table="t_srv_tickets"
          titleField="customer_name"
          subtitleField="engineer_name"
          metricField="ticket_no"
          tagField="priority"
          allowMove={true}
          onCardClick={() => openDrawer('drw_ticket_quick')}
          rowActions={[
            { label: 'Quick View', onClick: () => openDrawer('drw_ticket_quick') },
            { label: 'Triage', onClick: () => navigate('page_ticket_workbench', 'row') },
          ]}
        />
      </Card>
      <Card pfId="card_kb_calendar" title="Engineer On-Site Dispatch Calendar" extra="Click any scheduled block to open quick-view drawer" headerBg="white">
        <Calendar
          pfId="cal_srv_tickets"
          title="Monthly / Weekly Maintenance Schedule"
          table="t_srv_tickets"
          dateField="visit_start_date"
          endDateField="visit_end_date"
          titleField="customer_name"
          statusField="status"
          view="month"
          onEventClick={() => openDrawer('drw_ticket_quick')}
        />
      </Card>
      <Drawer
        pfId="drw_ticket_quick_node"
        id="drw_ticket_quick"
        title="Ticket Quick View & Handoff"
        width={520}
        placement="right"
        footer={false}
      >
        <Descriptions
          pfId="desc_kb_quick"
          title="Selected Ticket Profile"
          table="t_srv_tickets"
          bordered={true}
          column={1}
          size="small"
          items={[
            { label: 'Work Order No.', field: 'ticket_no' },
            { label: 'Enterprise Account', field: 'customer_name' },
            { label: 'Hardware Model', field: 'device_model' },
            { label: 'Priority', field: 'priority' },
            { label: 'Current SLA Status', field: 'status' },
            { label: 'Lead Engineer', field: 'engineer_name' },
            { label: 'On-Site Phone', field: 'contact_phone' },
            { label: 'Visit Start Date', field: 'visit_start_date' },
            { label: 'Visit End Date', field: 'visit_end_date' },
            { label: 'Estimated Hours (h)', field: 'sla_hours' },
          ]}
        />
        <Divider pfId="div_kb_quick" text="Cross-Page Actions" orientation="left" />
        <Toolbar pfId="tb_kb_drawer_btns" align="right">
          <Space pfId="sp_kb_drawer_btns" size="small">
            <Button pfId="btn_kb_close" onClick={() => closeOverlay()}>Close</Button>
            <Button
              pfId="btn_kb_deep_wb"
              type="primary"
              icon="edit"
              onClick={() => {
                closeOverlay();
                navigate('page_ticket_workbench', 'row');
              }}
            >
              Open in Workbench
            </Button>
          </Space>
        </Toolbar>
      </Drawer>
    </Page>
  );
}
`);

  const mobileFieldSource = norm(`// @protoflow page: page_mobile_field
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage
      pfId="mp_field_root"
      title="Mobile Field Dispatch & Parts"
      accent="gemini"
      surfaceBg="mist"
      padding="default"
      emptyTitle="No on-site visits assigned today — enjoy a clear shift"
      errorFallback="component"
      errorTitle="Field Cellular Link Fluctuating"
      errorDescription="Switched to offline cached work orders; check-ins & part claims will sync once signal recovers."
    >
      <MTopBar
        pfId="mtb_field"
        title="StarLink Field Ops"
        subtitle="East Smart Maint · Alex Lin"
        leftMode="sparkle"
        rightIcon="bell"
        onRightClick={() => toast('All active SLA windows on track — follow route order', 'info')}
      />
      <MScrollRow pfId="msr_kpis" title="Today's Shift Snapshot" gap={12} peek={true}>
        <MStatCard
          pfId="msc_pending"
          title="Assigned Visits"
          value="4"
          unit="jobs"
          trend="SLA 100%"
          trendTone="up"
          sparkline={true}
        />
        <MStatCard
          pfId="msc_ontime"
          title="First-Time Fix Rate"
          value="98.6"
          unit="%"
          trend="+2.4%"
          trendTone="up"
          sparkline={true}
        />
      </MScrollRow>
      <MAiInsightCard
        pfId="mai_field"
        title="AI Route & Van Stock Pre-Check"
        badge="AI Co-Pilot"
        summary="Sequenced today's stops by traffic & SLA countdown — complete pre-departure checks:"
        items={[
          {
            title: 'Priority Stop: Aurora Precision Mfg',
            detail: 'Edge gateway optical attenuation ticket has 1.5h left on SLA window; reserve SFP+ optics before departure.',
            actionLabel: 'Claim Part',
            onClick: () => openDrawer('msheet_apply_part'),
          },
          {
            title: 'Van Trunk 10G Optics Verified',
            detail: '12x SP-OPT-408 units available in van kit #04, sufficient for today’s scheduled swaps.',
            actionLabel: 'GPS Check-In',
            onClick: () => toast('GPS arrival check-in recorded', 'success'),
          },
        ]}
      />
      <MPillTabs
        pfId="mpt_filter"
        variant="pill"
        target="mkb_tickets"
        filterField="priority"
        items={[
          { title: 'All', value: '' },
          { title: 'Critical', value: 'Critical', badge: '2' },
          { title: 'Urgent', value: 'Urgent', badge: '3' },
          { title: 'Normal', value: 'Normal' },
        ]}
      />
      <MKanban
        pfId="mkb_tickets"
        table="t_srv_tickets"
        titleField="customer_name"
        subtitleField="device_model"
        metricField="ticket_no"
        allowMove={true}
        onCardClick={() => openDrawer('msheet_ticket_detail')}
        rowActions={[
          {
            label: 'Claim Part',
            primary: true,
            disabledWhenField: 'status',
            disabledWhenValue: 'Closed',
            disabledReason: 'Closed tickets cannot claim additional parts',
            onClick: () => openDrawer('msheet_apply_part'),
          },
        ]}
      />
      <MCalendar
        pfId="mcal_tickets"
        title="Weekly On-Site Route Stream"
        table="t_srv_tickets"
        dateField="visit_start_date"
        titleField="customer_name"
        subtitleField="device_model"
        statusField="status"
        mode="week"
        onEventClick={() => openDrawer('msheet_ticket_detail')}
      />
      <MBottomSheet
        pfId="msheet_detail_node"
        id="msheet_ticket_detail"
        title="Field Receipt & Contact Check"
        subtitle={'Ticket: {{row.ticket_no}} · {{row.customer_name}}'}
        size="medium"
      >
        <MSurface
          pfId="msurf_ticket_summary"
          title={'{{row.device_model}}'}
          subtitle={'Stage: {{row.status}} · Priority: {{row.priority}}'}
          tone="subtle"
          padding="sm"
        />
        <MForm pfId="mfrm_ticket_update" title="Verify On-Site Contact" table="t_srv_tickets">
          <MField
            pfId="mf_upd_eng"
            label="Field Engineer"
            name="engineer_name"
            required={true}
            placeholder="Enter engineer name"
          />
          <MField
            pfId="mf_upd_phone"
            label="Customer Site Phone"
            name="contact_phone"
            inputType="phone"
            formatRule="phone"
            required={true}
            validationMessage="Enter a valid contact phone number"
            placeholder="+1-415-890-2410"
          />
          <MChipSelect
            pfId="mcs_upd_status"
            label="Update SLA Stage"
            name="status"
            options="Pending Dispatch,On-Site,Pending Sign-Off,Closed"
            required={true}
          />
        </MForm>
        <MButton
          pfId="mbtn_save_ticket"
          variant="gradient"
          block={true}
          onClick={() => {
            submitForm('mfrm_ticket_update');
            closeOverlay();
            toast('Field status & contact synced to desktop workbench', 'success');
          }}
        >
          Save Field Receipt
        </MButton>
      </MBottomSheet>
      <MBottomSheet
        pfId="msheet_part_node"
        id="msheet_apply_part"
        title="Claim Van Spare Part"
        subtitle="Links live to srv_tickets and enforces van stock cap"
        size="tall"
      >
        <MForm pfId="mfrm_apply_part" title="Spare Part Requisition" table="t_srv_part_usages">
          <MSheetPicker
            pfId="msp_part_ticket"
            label="Service Ticket"
            name="ticket_id"
            table="t_srv_tickets"
            labelField="ticket_no"
            valueField="id"
            placeholder="Tap to pick active ticket"
            required={true}
          />
          <MField
            pfId="mf_part_code"
            label="Part SKU"
            name="part_code"
            placeholder="e.g. SP-OPT-408"
            required={true}
          />
          <MField
            pfId="mf_part_name"
            label="Spare Part Name"
            name="part_name"
            placeholder="e.g. 10G SFP+ Optical Transceiver"
            required={true}
          />
          <MField
            pfId="mf_part_stock"
            label="Van Available Stock"
            name="stock_available"
            inputType="number"
            minValue={1}
            required={true}
            helperText="Verified count in mobile van kit"
          />
          <MField
            pfId="mf_part_qty"
            label="Claim Qty (≤ Van Stock)"
            name="apply_qty"
            inputType="number"
            minValue={1}
            maxField="stock_available"
            required={true}
            validationMessage="Claim quantity cannot exceed available van stock"
            placeholder="Must not exceed available stock above"
          />
        </MForm>
        <MButton
          pfId="mbtn_submit_part"
          variant="gradient"
          block={true}
          onClick={() => {
            submitForm('mfrm_apply_part');
            closeOverlay();
            toast('Van spare part claim submitted & synced to desktop', 'success');
          }}
        >
          Confirm Claim & Deduct Van Stock
        </MButton>
      </MBottomSheet>
      <MTabBar
        pfId="mtab_bottom"
        variant="floating"
        activeKey="tasks"
        items={[
          { key: 'tasks', title: 'Field Jobs', icon: 'Layers', badge: '4' },
          {
            key: 'parts',
            title: 'Claim Parts',
            icon: 'Sparkles',
            onClick: () => openDrawer('msheet_apply_part'),
          },
          {
            key: 'checkin',
            title: 'GPS Check-In',
            icon: 'User',
            onClick: () => toast('GPS check-in verified: Aurora Precision Mfg', 'success'),
          },
        ]}
      />
    </MobilePage>
  );
}
`);

  const stickyNotes: StickyNoteRule[] = [
    {
      id: 'sn-sl-1',
      pageId: 'page_overview_dashboard',
      targetWidgetId: 'tbl_dash_tickets',
      targetWidgetName: 'Priority Maintenance Ticket Ledger',
      index: 1,
      text: 'Clicking "Open in Workbench" passes the exact clicked ticket row via navigate("page_ticket_workbench", "row") so Master-Detail focuses that work order without popups.',
      compiledRule: 'ROW_CONTEXT_NAV: navigate("page_ticket_workbench", "row") => activeRow(t_srv_tickets) = row.id',
      active: true,
    },
    {
      id: 'sn-sl-2',
      pageId: 'page_ticket_workbench',
      targetWidgetId: 'rep_ticket_list',
      targetWidgetName: 'Work Order Master Repeater',
      index: 1,
      text: 'Popup-free Master-Detail: autoSelectFirst selects the first ticket on load, and Card(activeTable="t_srv_tickets") isolates detail forms and child tables from cross-table source rows.',
      compiledRule: 'MASTER_DETAIL_ISOLATION: Repeater.selectRow() -> Card[activeTable="t_srv_tickets"]',
      active: true,
    },
    {
      id: 'sn-sl-3',
      pageId: 'page_ticket_workbench',
      targetWidgetId: 'dp_edit_edate',
      targetWidgetName: 'Visit End Date Picker',
      index: 2,
      text: 'Cross-field Poka-Yoke: visit_end_date enforces minField="visit_start_date" while contact_phone validates phone format and sla_hours enforces [0.5, 72] before writing.',
      compiledRule: 'POKA_YOKE: visit_end_date >= visit_start_date && PHONE(contact_phone) && sla_hours IN [0.5, 72]',
      active: true,
    },
    {
      id: 'sn-sl-4',
      pageId: 'page_ticket_workbench',
      targetWidgetId: 'btn_act_soft_delete',
      targetWidgetName: 'Archive Ticket (Undoable) Button',
      index: 3,
      text: 'Foreign-key closure: tickets with unreturned srv_part_usages rows are blocked by ON DELETE RESTRICT (try WO-202611-01); tickets with 0 parts archive cleanly with ON DELETE CASCADE on srv_ticket_logs and a 5s Undo toast (try WO-202611-03).',
      compiledRule: 'FK_CLOSURE: RESTRICT(srv_part_usages.ticket_id) && CASCADE_WITH_UNDO(srv_ticket_logs.ticket_id)',
      active: true,
    },
    {
      id: 'sn-sl-5',
      pageId: 'page_ticket_workbench',
      targetWidgetId: 'btn_act_force_close',
      targetWidgetName: 'Force Close High-Risk Button',
      index: 4,
      text: 'High-risk confirmation guard: requires typing the exact current {{row.ticket_no}} before transitioning status to Closed.',
      compiledRule: 'CONFIRM_MATCH_TEXT: input === row.ticket_no => status = "Closed"',
      active: true,
    },
    {
      id: 'sn-sl-6',
      pageId: 'page_ticket_workbench',
      targetWidgetId: 'num_part_qty',
      targetWidgetName: 'Claim Quantity NumberInput',
      index: 5,
      text: 'Anti-overclaim & deduplication: apply_qty enforces maxField="stock_available" and table srv_part_usages enforces composite unique uq_srv_ticket_part(ticket_id, part_code).',
      compiledRule: 'apply_qty <= stock_available && UNIQUE(ticket_id, part_code)',
      active: true,
    },
    {
      id: 'sn-sl-7',
      pageId: 'page_kanban_schedule',
      targetWidgetId: 'kb_srv_tickets',
      targetWidgetName: '4-Stage SLA Kanban',
      index: 1,
      text: 'Disambiguated status ENUM lanes: automatically binds srv_tickets.status (ignoring priority ENUM) and syncs lane moves live with the monthly/weekly Calendar below.',
      compiledRule: 'KANBAN_ENUM_SYNC: srv_tickets.status <-> Calendar[visit_start_date..visit_end_date]',
      active: true,
    },
    {
      id: 'sn-sl-8',
      pageId: 'page_mobile_field',
      targetWidgetId: 'mkb_tickets',
      targetWidgetName: 'Mobile Field Ticket Kanban',
      index: 1,
      text: 'Cross-platform shared ER dataset: status updates or van spare-part claims on iPhone update desktop KPIs, Kanban lanes, and Master-Detail child tables immediately.',
      compiledRule: 'SHARED_ER_SYNC: MobilePage(t_srv_tickets, t_srv_part_usages) <-> DesktopWorkbench',
      active: true,
    },
  ];

  const projectNotes: NoteWorkspace = {
    nodes: [
      {
        id: 'note-fld-sl-prd',
        kind: 'folder',
        title: 'StarLink Maintenance & Spare Parts PRD',
        parentId: null,
        icon: '📁',
        updatedAt: '2026-11-25T04:00:00.000Z',
      },
      {
        id: 'note-sl-sla-rules',
        kind: 'note',
        title: 'SLA State Machine, Foreign-Key Guards & Undo Recovery Spec',
        parentId: 'note-fld-sl-prd',
        icon: '🛠️',
        updatedAt: '2026-11-25T04:10:00.000Z',
        tags: ['SLA State Machine', 'Poka-Yoke', 'ER Foreign Keys'],
        cover: 'ocean',
        pinned: true,
        status: 'confirmed',
        priority: 'P0',
        stakeholder: 'VP Global Field Ops & Supply Chain Lead',
        meetingDate: '2026-11-25',
        shareable: true,
        content: [
          '<h2>1. Service Ticket Lifecycle (srv_tickets.status)</h2>',
          '<ul>',
          '<li><code>Pending Dispatch</code> → <code>On-Site</code> → <code>Pending Sign-Off</code> → <code>Closed</code>.</li>',
          '<li>Force-closing from non-terminal states requires typing the exact <code>ticket_no</code> in the confirmation modal.</li>',
          '</ul>',
          '<h2>2. Relational Foreign-Key &amp; Poka-Yoke Invariants</h2>',
          '<ol>',
          '<li><strong>Spare Parts Guard (RESTRICT)</strong>: <code>srv_part_usages.ticket_id</code> uses <code>ON DELETE RESTRICT</code> and composite unique <code>uq_srv_ticket_part(ticket_id, part_code)</code>, with <code>apply_qty &lt;= stock_available</code>.</li>',
          '<li><strong>Diagnostic Logs (CASCADE + 5s Undo)</strong>: <code>srv_ticket_logs.ticket_id</code> uses <code>ON DELETE CASCADE</code>; archiving a part-free ticket offers a 5-second atomic Undo that re-validates unique constraints before restoring parent + child rows.</li>',
          '<li><strong>UI Stack 5-State Matrix</strong>: Switch Ideal / Empty / Loading / Edge / Error in the top bar; Edge stress-test strings never leak back into stored project rows.</li>',
          '</ol>',
        ].join(''),
      },
    ],
    links: [
      { page: { kind: 'page', pageId: 'page_overview_dashboard' }, targetNodeId: 'note-sl-sla-rules' },
      { page: { kind: 'page', pageId: 'page_ticket_workbench' }, targetNodeId: 'note-sl-sla-rules' },
      { page: { kind: 'page', pageId: 'page_kanban_schedule' }, targetNodeId: 'note-sl-sla-rules' },
      { page: { kind: 'page', pageId: 'page_mobile_field' }, targetNodeId: 'note-sl-sla-rules' },
    ],
  };

  const mindmaps: MindmapWorkspace = {
    nodes: [
      {
        id: 'mm-sl-flow',
        kind: 'mindmap',
        title: 'StarLink Closed-Loop Maintenance & Spare Parts Flow',
        parentId: null,
        source: [
          'flowchart LR',
          '  A["IoT Alert / Customer Call\\n(srv_tickets · Pending Dispatch)"] --> B["Master-Detail Workbench\\nSchedule & Phone Poka-Yoke"]',
          '  B --> C["Desktop / Mobile Claim Parts\\n(srv_part_usages · apply_qty <= stock)"]',
          '  B --> D["Kanban & iPhone Field Sync\\n(On-Site -> Pending Sign-Off)"]',
          '  C --> E{"Archive Ticket?"}',
          '  E -- "Parts > 0" --> F["RESTRICT Blocked\\nReturn Parts First"]',
          '  E -- "Parts == 0" --> G["CASCADE Archive Logs\\n+ 5s Atomic Undo"]',
          '  D --> H["Customer Sign-Off / Exact No. Force Close\\n(Closed)"]',
        ].join('\n'),
      },
    ],
    links: [
      { page: { kind: 'folder', folderId: 'fld_workbench' }, targetNodeId: 'mm-sl-flow' },
      { page: { kind: 'folder', folderId: 'fld_mobile_engineer' }, targetNodeId: 'mm-sl-flow' },
    ],
  };

  return {
    designTokens: STARLINK_DESIGN_TOKENS,
    dbTables: [ticketsTable, partUsagesTable, ticketLogsTable],
    tableRows,
    designerFolders,
    designerPages,
    pageSources: {
      page_overview_dashboard: dashboardSource,
      page_ticket_workbench: workbenchSource,
      page_kanban_schedule: kanbanScheduleSource,
      page_mobile_field: mobileFieldSource,
    },
    stickyNotes,
    projectNotes,
    mindmaps,
    entryPageId: 'page_overview_dashboard',
  };
}

function createChineseStarlinkDemoDataset(): StarlinkDemoDataset {
  const ticketsTable: DBTableSchema = {
    id: 't_srv_tickets',
    tableName: 'srv_tickets',
    cnName: '维保工单主表',
    domain: '售后维保履约域',
    description:
      '星链智能边缘硬件售后维保工单核心主表，统一承载客户设备报修、主责工程师指派、预约上门排期窗口及 PC + iPhone 多端状态机流转。',
    modeling: {
      entity: '售后维保工单',
      grain: '一张客户设备现场维保服务工单对应一行记录（由 ticket_no 唯一标识）',
      reason: '维保工单具备独立单号唯一性与四阶段履约状态机，同时作为备件领用（RESTRICT）与现场日志（CASCADE）的父表事实源。',
      pendingRules: [
        {
          rule: 'visit_end_date >= visit_start_date',
          reason: '预约结束日期不得早于开始日期，由表单 minField 实时防错与写入层校验双重保障',
        },
      ],
    },
    sharedByMenus: [
      {
        pageId: 'page_overview_dashboard',
        menuTitle: '调度与数据总览 → 维保运营数据看板',
        accessMode: 'READ 查询',
        fieldMappingNote: '驱动顶部 Bento 趋势指标卡统计，底部监控台账多条件筛选并支持携带当前行直达主从工作台',
      },
      {
        pageId: 'page_ticket_workbench',
        menuTitle: '调度与数据总览 → 维保工单主从工作台',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '左列循环卡片选单秒切右侧详情舱、排期表单修改、新建工单、状态流转、单号核验结单与 5 秒可撤销归档',
      },
      {
        pageId: 'page_kanban_schedule',
        menuTitle: '履约看板与排班 → 履约流转看板与排期日历',
        accessMode: 'STATE 状态流转',
        fieldMappingNote: '四泳道状态看板拖拽/推进工单阶段，并与下方月/周工程师排期日历实时共享数据源',
      },
      {
        pageId: 'page_mobile_field',
        menuTitle: '工程师掌上现场端 → 工程师现场接单与领料端',
        accessMode: 'STATE 状态流转',
        fieldMappingNote: 'iPhone 现场端共表推进工单阶段、浏览周日程流并在半屏抽屉核实客户手机号与回执',
      },
    ],
    columns: [
      { id: 'c_tk_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '工单主键ID' },
      { id: 'c_tk_no', name: 'ticket_no', dataType: 'VARCHAR(64)', nullable: false, isUnique: true, comment: '维保工单编号(唯一)' },
      { id: 'c_tk_cust', name: 'customer_name', dataType: 'VARCHAR(128)', nullable: false, comment: '星链政企客户名称' },
      { id: 'c_tk_dev', name: 'device_model', dataType: 'VARCHAR(128)', nullable: false, comment: '星链硬件设备型号' },
      { id: 'c_tk_phone', name: 'contact_phone', dataType: 'VARCHAR(32)', nullable: false, comment: '现场联系人手机' },
      {
        id: 'c_tk_prio',
        name: 'priority',
        dataType: "ENUM('普通','加急','特急')",
        nullable: false,
        defaultValue: "'加急'",
        comment: '响应优先级',
      },
      {
        id: 'c_tk_status',
        name: 'status',
        dataType: "ENUM('待派单','上门中','待验收','已结单')",
        nullable: false,
        defaultValue: "'待派单'",
        comment: '工单履约状态',
      },
      { id: 'c_tk_eng', name: 'engineer_name', dataType: 'VARCHAR(64)', nullable: false, comment: '主责工程师姓名' },
      { id: 'c_tk_sdate', name: 'visit_start_date', dataType: 'DATE', nullable: false, comment: '预约上门开始日' },
      { id: 'c_tk_edate', name: 'visit_end_date', dataType: 'DATE', nullable: false, comment: '预约上门结束日' },
      {
        id: 'c_tk_hours',
        name: 'sla_hours',
        dataType: 'DECIMAL(10,1)',
        nullable: false,
        defaultValue: '4.0',
        comment: '预计维保工时(h)',
      },
    ],
  };

  const partUsagesTable: DBTableSchema = {
    id: 't_srv_part_usages',
    tableName: 'srv_part_usages',
    cnName: '备件领用明细表',
    domain: '备件仓储协同域',
    description: '工程师针对维保工单申领与核销的核心备件明细表，对父工单启用 RESTRICT 外键防误删保护并约束同单同备件编码唯一。',
    modeling: {
      entity: '工单备件领用明细',
      grain: '某张维保工单下申领的单一备件物料编码对应一行记录',
      reason: '一张维保工单可领用多类备件，需通过联合唯一约束防止重复建行，并在未退料前通过 RESTRICT 阻断父工单误删。',
      pendingRules: [
        {
          rule: 'apply_qty <= stock_available AND apply_qty >= 1',
          reason: '本次申领数量不得超过前置仓或随车可用库存余量，由 Poka-Yoke maxField 实时拦截',
        },
      ],
    },
    uniqueConstraints: [{ name: 'uq_srv_ticket_part', columnIds: ['c_pu_ticket', 'c_pu_code'] }],
    sharedByMenus: [
      {
        pageId: 'page_overview_dashboard',
        menuTitle: '调度与数据总览 → 维保运营数据看板',
        accessMode: 'READ 查询',
        fieldMappingNote: '顶部统计卡片实时汇总全网备件领用协同批次',
      },
      {
        pageId: 'page_ticket_workbench',
        menuTitle: '调度与数据总览 → 维保工单主从工作台',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '按当前选中工单 sourceForeignKey="ticket_id" 过滤明细，支持选单申领(maxField防超领)与 5 秒撤销退料',
      },
      {
        pageId: 'page_mobile_field',
        menuTitle: '工程师掌上现场端 → 工程师现场接单与领料端',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '移动半屏抽屉通过 MSheetPicker 关联工单并按随车库存余量上限校验提交领料单',
      },
    ],
    columns: [
      { id: 'c_pu_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '领用明细主键ID' },
      {
        id: 'c_pu_ticket',
        name: 'ticket_id',
        dataType: 'VARCHAR(64)',
        nullable: false,
        isForeignKey: true,
        references: 'srv_tickets(id)',
        foreignKeyOptions: { name: 'fk_part_usage_ticket', cardinality: '1:N', onDelete: 'RESTRICT' },
        comment: '所属维保工单ID(RESTRICT)',
      },
      { id: 'c_pu_code', name: 'part_code', dataType: 'VARCHAR(64)', nullable: false, comment: '备件物料编码' },
      { id: 'c_pu_name', name: 'part_name', dataType: 'VARCHAR(128)', nullable: false, comment: '核心维保备件名称' },
      {
        id: 'c_pu_stock',
        name: 'stock_available',
        dataType: 'INT',
        nullable: false,
        defaultValue: '20',
        comment: '当前可用库存余量',
      },
      { id: 'c_pu_qty', name: 'apply_qty', dataType: 'INT', nullable: false, comment: '本次申领数量' },
    ],
  };

  const ticketLogsTable: DBTableSchema = {
    id: 't_srv_ticket_logs',
    tableName: 'srv_ticket_logs',
    cnName: '工单现场跟进日志表',
    domain: '售后维保履约域',
    description: '记录维保工单从建单受理、指派、到场排查到完工回访的全过程作业轨迹，随父工单 CASCADE 级联归档与原子恢复。',
    modeling: {
      entity: '工单现场跟进日志',
      grain: '某张维保工单的一次现场排查或回访节点记录一行',
      reason: '过程跟进日志生命周期完全依附于父维保工单，适合通过 ON DELETE CASCADE 与 5 秒撤销栈同步管理。',
      pendingRules: [],
    },
    sharedByMenus: [
      {
        pageId: 'page_ticket_workbench',
        menuTitle: '调度与数据总览 → 维保工单主从工作台',
        accessMode: 'CRUD 读写',
        fieldMappingNote: '详情区子表页签按 ticket_id 联动展示跟进日志，支持新增记录、单条可撤销移除及随父工单级联恢复',
      },
    ],
    columns: [
      { id: 'c_lg_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '跟进日志主键ID' },
      {
        id: 'c_lg_ticket',
        name: 'ticket_id',
        dataType: 'VARCHAR(64)',
        nullable: false,
        isForeignKey: true,
        references: 'srv_tickets(id)',
        foreignKeyOptions: { name: 'fk_ticket_log_ticket', cardinality: '1:N', onDelete: 'CASCADE' },
        comment: '所属维保工单ID(CASCADE)',
      },
      {
        id: 'c_lg_stage',
        name: 'action_stage',
        dataType: "ENUM('建单受理','派单指派','到场排查','完工回访')",
        nullable: false,
        defaultValue: "'到场排查'",
        comment: '跟进处置节点',
      },
      { id: 'c_lg_note', name: 'log_note', dataType: 'VARCHAR(255)', nullable: false, comment: '现场排查处置记录' },
      { id: 'c_lg_date', name: 'logged_date', dataType: 'DATE', nullable: false, comment: '日志记录日期' },
    ],
  };

  const tableRows: Record<string, Row[]> = {
    t_srv_tickets: [
      {
        id: 't_srv_tickets-001',
        ticket_no: 'WO-202611-01',
        customer_name: '杭州极光智造精密基地',
        device_model: 'StarLink-X900 边缘计算网关',
        contact_phone: '13816289012',
        priority: '特急',
        status: '待派单',
        engineer_name: '林峰',
        visit_start_date: '2026-11-25',
        visit_end_date: '2026-11-26',
        sla_hours: 4.0,
      },
      {
        id: 't_srv_tickets-002',
        ticket_no: 'WO-202611-02',
        customer_name: '深圳星海光电产业园',
        device_model: 'StarLink-P600 相控阵基站',
        contact_phone: '13924087651',
        priority: '加急',
        status: '上门中',
        engineer_name: '周婷',
        visit_start_date: '2026-11-24',
        visit_end_date: '2026-11-26',
        sla_hours: 6.0,
      },
      {
        id: 't_srv_tickets-003',
        ticket_no: 'WO-202611-03',
        customer_name: '苏州云图晶圆洁净中心',
        device_model: 'StarLink-M400 工业万兆路由',
        contact_phone: '13751209834',
        priority: '普通',
        status: '待派单',
        engineer_name: '林峰',
        visit_start_date: '2026-11-26',
        visit_end_date: '2026-11-28',
        sla_hours: 3.5,
      },
      {
        id: 't_srv_tickets-004',
        ticket_no: 'WO-202611-04',
        customer_name: '上海临港深水港无人码头',
        device_model: 'StarLink-R800 船载卫通终端',
        contact_phone: '13601928374',
        priority: '特急',
        status: '待验收',
        engineer_name: '陈立',
        visit_start_date: '2026-11-22',
        visit_end_date: '2026-11-25',
        sla_hours: 8.0,
      },
      {
        id: 't_srv_tickets-005',
        ticket_no: 'WO-202611-05',
        customer_name: '北京亦庄自动驾驶路侧网',
        device_model: 'StarLink-V520 车路协同RSU',
        contact_phone: '13581726354',
        priority: '加急',
        status: '上门中',
        engineer_name: '赵航',
        visit_start_date: '2026-11-25',
        visit_end_date: '2026-11-27',
        sla_hours: 4.5,
      },
      {
        id: 't_srv_tickets-006',
        ticket_no: 'WO-202611-06',
        customer_name: '成都天府超算智算集群',
        device_model: 'StarLink-X900 边缘计算网关',
        contact_phone: '13880912345',
        priority: '普通',
        status: '已结单',
        engineer_name: '周婷',
        visit_start_date: '2026-11-18',
        visit_end_date: '2026-11-20',
        sla_hours: 3.0,
      },
      {
        id: 't_srv_tickets-007',
        ticket_no: 'WO-202611-07',
        customer_name: '合肥量子科学实验基地',
        device_model: 'StarLink-Q300 高稳授时终端',
        contact_phone: '13965018273',
        priority: '加急',
        status: '待验收',
        engineer_name: '陈立',
        visit_start_date: '2026-11-23',
        visit_end_date: '2026-11-25',
        sla_hours: 5.0,
      },
      {
        id: 't_srv_tickets-008',
        ticket_no: 'WO-202611-08',
        customer_name: '广州南沙海上风电集控站',
        device_model: 'StarLink-P600 相控阵基站',
        contact_phone: '13719283746',
        priority: '普通',
        status: '已结单',
        engineer_name: '赵航',
        visit_start_date: '2026-11-15',
        visit_end_date: '2026-11-17',
        sla_hours: 6.5,
      },
    ],
    t_srv_part_usages: [
      {
        id: 't_srv_part_usages-001',
        ticket_id: 't_srv_tickets-001',
        part_code: 'SP-OPT-408',
        part_name: '万兆光模块激光收发器',
        stock_available: 18,
        apply_qty: 2,
      },
      {
        id: 't_srv_part_usages-002',
        ticket_id: 't_srv_tickets-001',
        part_code: 'SP-PWR-210',
        part_name: '工业级双路冗余电源模块',
        stock_available: 9,
        apply_qty: 1,
      },
      {
        id: 't_srv_part_usages-003',
        ticket_id: 't_srv_tickets-002',
        part_code: 'SP-RF-920',
        part_name: '星链Ku波段相控阵射频板',
        stock_available: 6,
        apply_qty: 1,
      },
      {
        id: 't_srv_part_usages-004',
        ticket_id: 't_srv_tickets-004',
        part_code: 'SP-ANT-750',
        part_name: '抗盐雾船载陀螺稳像馈源',
        stock_available: 5,
        apply_qty: 1,
      },
      {
        id: 't_srv_part_usages-005',
        ticket_id: 't_srv_tickets-004',
        part_code: 'SP-OPT-408',
        part_name: '万兆光模块激光收发器',
        stock_available: 16,
        apply_qty: 4,
      },
      {
        id: 't_srv_part_usages-006',
        ticket_id: 't_srv_tickets-005',
        part_code: 'SP-V2X-310',
        part_name: 'C-V2X 超低时延基带处理卡',
        stock_available: 11,
        apply_qty: 2,
      },
      {
        id: 't_srv_part_usages-007',
        ticket_id: 't_srv_tickets-006',
        part_code: 'SP-OPT-408',
        part_name: '万兆光模块激光收发器',
        stock_available: 14,
        apply_qty: 2,
      },
      {
        id: 't_srv_part_usages-008',
        ticket_id: 't_srv_tickets-007',
        part_code: 'SP-CLK-105',
        part_name: 'OCXO 铷原子守时晶振模块',
        stock_available: 4,
        apply_qty: 1,
      },
    ],
    t_srv_ticket_logs: [
      {
        id: 't_srv_ticket_logs-001',
        ticket_id: 't_srv_tickets-001',
        action_stage: '建单受理',
        log_note: '物联遥测捕获上联口 XE-0/1 光衰达 -19.4 dBm，自动升级为特急 SLA 维保工单。',
        logged_date: '2026-11-25',
      },
      {
        id: 't_srv_ticket_logs-002',
        ticket_id: 't_srv_tickets-001',
        action_stage: '派单指派',
        log_note: '已指派华东组林峰接单，并从杭州前置仓锁定 2 只万兆光模块与 1 套冗余电源。',
        logged_date: '2026-11-25',
      },
      {
        id: 't_srv_ticket_logs-003',
        ticket_id: 't_srv_tickets-002',
        action_stage: '到场排查',
        log_note: '抵达光电园 B2 楼顶机房，定位相控阵 3 号射频通道波束偏置漂移，正在更换射频板。',
        logged_date: '2026-11-24',
      },
      {
        id: 't_srv_ticket_logs-004',
        ticket_id: 't_srv_tickets-003',
        action_stage: '建单受理',
        log_note: '晶圆厂洁净车间季度固件升级与双机热备倒换演练，无需领用硬件备件（可直接测试级联归档与撤销）。',
        logged_date: '2026-11-25',
      },
      {
        id: 't_srv_ticket_logs-005',
        ticket_id: 't_srv_tickets-004',
        action_stage: '到场排查',
        log_note: '完成 07 号岸桥卫通天线罩密封组件与馈源更换，卫星锁定信噪比恢复至 14.8 dB。',
        logged_date: '2026-11-23',
      },
      {
        id: 't_srv_ticket_logs-006',
        ticket_id: 't_srv_tickets-005',
        action_stage: '到场排查',
        log_note: '更换亦庄宏达路 19 号杆路侧基带卡，车路协同端到端广播时延回落至 8.2 ms。',
        logged_date: '2026-11-25',
      },
      {
        id: 't_srv_ticket_logs-007',
        ticket_id: 't_srv_tickets-006',
        action_stage: '完工回访',
        log_note: '连续 48 小时满载零丢包拷机验收通过，客户智算运维中心已完成签章结单。',
        logged_date: '2026-11-20',
      },
      {
        id: 't_srv_ticket_logs-008',
        ticket_id: 't_srv_tickets-007',
        action_stage: '到场排查',
        log_note: '完成高稳守时晶振校准更换，PTP 主时钟相位偏差稳定在 ±12 ns 指标内。',
        logged_date: '2026-11-24',
      },
    ],
  };

  const designerFolders: DesignerFolder[] = [
    { id: 'fld_workbench', title: '调度与数据总览', parentFolderId: null },
    { id: 'fld_schedule', title: '履约看板与排班', parentFolderId: null },
    { id: 'fld_mobile_engineer', title: '工程师掌上现场端', parentFolderId: null },
  ];

  const designerPages: DesignerPage[] = [
    { pageId: 'page_overview_dashboard', title: '维保运营数据看板', folderId: 'fld_workbench', platform: 'desktop' },
    { pageId: 'page_ticket_workbench', title: '维保工单主从工作台', folderId: 'fld_workbench', platform: 'desktop' },
    { pageId: 'page_kanban_schedule', title: '履约流转看板与排期日历', folderId: 'fld_schedule', platform: 'desktop' },
    { pageId: 'page_mobile_field', title: '工程师现场接单与领料端', folderId: 'fld_mobile_engineer', platform: 'mobile' },
  ];

  const dashboardSource = norm(`// @protoflow page: page_overview_dashboard
export default function Page() {
  return (
    <Page
      pfId="p_dash_root"
      title="维保运营数据看板"
      description="实时监控星链设备售后工单吞吐、SLA 准时率与备件申领分布"
      emptyTitle="当前暂无维保运营统计数据，请前往主从工作台新建工单"
      errorFallback="result_500"
      errorTitle="维保运营指标聚合服务异常"
      errorDescription="上游物联遥测与工单统计网关响应超时，请稍后重试或切回理想态"
    >
      <PageHeader
        pfId="ph_dash_header"
        title="星链设备维保运营总览"
        subTitle="全网智能边缘设备 7×24h 售后调度、SLA 达成率与备件周转驾驶舱"
        tagText="SLA 实时监控中"
        tagColor="green"
        breadcrumb={['调度与数据总览', '维保运营数据看板']}
      />
      <Toolbar
        pfId="tb_dash_actions"
        align="between"
        title="核心业务调度入口"
        subTitle="支持一键进入无弹窗主从工作台或履约泳道排班视图"
      >
        <Space pfId="sp_dash_btns" size="middle">
          <Button
            pfId="btn_dash_to_wb"
            type="primary"
            icon="edit"
            onClick={() => navigate('page_ticket_workbench')}
          >
            进入工单主从工作台
          </Button>
          <Button
            pfId="btn_dash_to_kb"
            icon="eye"
            onClick={() => navigate('page_kanban_schedule')}
          >
            查看履约看板与排班日历
          </Button>
        </Space>
      </Toolbar>
      <Row pfId="row_dash_kpis" gutter={16}>
        <Col pfId="col_kpi_1" span={6}>
          <Card pfId="card_kpi_1" variant="bento" size="small">
            <Statistic
              pfId="stat_kpi_total"
              title="在途维保工单总数"
              table="t_srv_tickets"
              suffix="单"
              trend="up"
              trendText="+14.6%"
              sparkline={true}
              valueColor="blue"
              bordered={false}
            />
          </Card>
        </Col>
        <Col pfId="col_kpi_2" span={6}>
          <Card pfId="card_kpi_2" variant="bento" size="small">
            <Statistic
              pfId="stat_kpi_sla"
              title="SLA 24h 准时达成率"
              value="98.4"
              suffix="%"
              trend="up"
              trendText="+2.1%"
              sparkline={true}
              valueColor="green"
              bordered={false}
            />
          </Card>
        </Col>
        <Col pfId="col_kpi_3" span={6}>
          <Card pfId="card_kpi_3" variant="bento" size="small">
            <Statistic
              pfId="stat_kpi_parts"
              title="备件领用协同批次"
              table="t_srv_part_usages"
              suffix="批"
              trend="up"
              trendText="+8.5%"
              sparkline={true}
              valueColor="orange"
              bordered={false}
            />
          </Card>
        </Col>
        <Col pfId="col_kpi_4" span={6}>
          <Card pfId="card_kpi_4" variant="bento" size="small">
            <Statistic
              pfId="stat_kpi_mttr"
              title="平均现场修复耗时(MTTR)"
              value="3.2"
              suffix="h"
              trend="down"
              trendText="-18.0%"
              sparkline={true}
              valueColor="blue"
              bordered={false}
            />
          </Card>
        </Col>
      </Row>
      <AiCopilotCard
        pfId="ai_dash_copilot"
        title="AI 智能调度与备件预警洞察"
        badge="AI 实时巡检"
        tone="indigo"
        summary="已交叉核验全网在途维保工单 SLA 时限与区域前置仓备件余量，建议优先跟进以下 2 项预警："
        primaryActionLabel="前往主从工作台处置"
        onPrimaryAction={() => navigate('page_ticket_workbench')}
        items={[
          {
            title: '华东大区特急工单派单提醒（WO-202611-01）',
            detail: '杭州极光智造基地边缘网关光衰告警距离承诺上门窗口不足 2 小时，建议优先指派就近工程师林峰',
            actionLabel: '立即派单',
            onClick: () => navigate('page_ticket_workbench'),
          },
          {
            title: '万兆光模块区域安全库存预警',
            detail: '近 7 日 SP-OPT-408 备件申领频次环比上升 22%，建议核查工单领料明细并锁定安全余量',
            actionLabel: '核查排期',
            onClick: () => navigate('page_kanban_schedule'),
          },
        ]}
      />
      <Row pfId="row_dash_charts" gutter={16}>
        <Col pfId="col_chart_bar" span={14}>
          <Card pfId="card_chart_bar" title="各大区维保工单阶段吞吐对比" extra="近 7 日实时履约统计" headerBg="white">
            <BarChart
              pfId="chart_region_throughput"
              title="各服务大区工单吞吐量"
              source="inline"
              dimension="region"
              metrics={[
                { field: 'completed', label: '已结单' },
                { field: 'visiting', label: '上门中' },
                { field: 'pending', label: '待派单' },
              ]}
              data={[
                { region: '华东智造大区', completed: 46, visiting: 14, pending: 5 },
                { region: '华南光电大区', completed: 38, visiting: 11, pending: 4 },
                { region: '华北能源大区', completed: 29, visiting: 9, pending: 3 },
                { region: '西南算力大区', completed: 24, visiting: 7, pending: 2 },
              ]}
              height={300}
              palette="blue"
              showLegend={true}
            />
          </Card>
        </Col>
        <Col pfId="col_chart_donut" span={10}>
          <Card pfId="card_chart_donut" title="核心维保备件申领品类占比" extra="按出库频次占比" headerBg="white">
            <DonutChart
              pfId="chart_part_category"
              title="备件领用品类结构"
              source="inline"
              dimension="category"
              metrics={[{ field: 'qty', label: '申领件数' }]}
              data={[
                { category: '万兆光模块收发器', qty: 42 },
                { category: '星链相控阵射频板', qty: 28 },
                { category: '工业级冗余电源模块', qty: 19 },
                { category: '船载稳像天线馈源', qty: 15 },
              ]}
              height={300}
              palette="teal"
              showLegend={true}
              showLabel={true}
            />
          </Card>
        </Col>
      </Row>
      <Card
        pfId="card_dash_table"
        title="全网重点维保工单实时监控台账"
        extra="点击行尾「进入工作台处置」可携带当前工单上下文直达主从工作台"
        headerBg="white"
      >
        <QueryForm
          pfId="qf_dash_tickets"
          target="tbl_dash_tickets"
          fields={[
            { name: 'ticket_no', label: '工单编号', type: 'input', placeholder: '输入 WO-202611-... 检索' },
            { name: 'priority', label: '响应优先级', type: 'select', options: '普通,加急,特急' },
            { name: 'status', label: '履约状态', type: 'select', options: '待派单,上门中,待验收,已结单' },
          ]}
        />
        <Table
          pfId="tbl_dash_tickets"
          table="t_srv_tickets"
          striped={true}
          pageSize={5}
          columns={[
            { dataIndex: 'ticket_no', title: '工单编号', render: 'link', width: 155 },
            { dataIndex: 'customer_name', title: '客户企业名称', width: 185 },
            { dataIndex: 'device_model', title: '星链设备型号', width: 195 },
            { dataIndex: 'priority', title: '响应优先级', render: 'tag', width: 110 },
            { dataIndex: 'status', title: '履约状态', render: 'tag', width: 110 },
            { dataIndex: 'engineer_name', title: '主责工程师', width: 110 },
            { dataIndex: 'visit_start_date', title: '预约上门日', render: 'date', width: 130 },
            { dataIndex: 'sla_hours', title: '预计工时(h)', align: 'right', width: 110 },
          ]}
          rowActions={[
            { label: '进入工作台处置', onClick: () => navigate('page_ticket_workbench', 'row') },
          ]}
        />
      </Card>
    </Page>
  );
}
`);

  const workbenchSource = norm(`// @protoflow page: page_ticket_workbench
export default function Page() {
  return (
    <Page
      pfId="p_wb_root"
      title="维保工单主从工作台"
      description="一屏无弹窗主从联动工作台：左侧切换工单卡片，右侧实时联动单据详情、排期表单与备件/日志双子表"
      emptyTitle="当前暂无待处理的售后维保工单，请点击上方新建维保工单"
      errorFallback="result_500"
      errorTitle="工单主从协同中心连接异常"
      errorDescription="工单派发与备件库存核验网关暂不可用，请稍后刷新重试"
    >
      <PageHeader
        pfId="ph_wb_header"
        title="维保工单主从处置工作台"
        subTitle="左列循环卡片点击秒切右侧详情、排期表单与关联双子表，内建 Poka-Yoke 实时防错与 5 秒撤销容错"
        tagText="Poka-Yoke 防错已启用"
        tagColor="blue"
        breadcrumb={['调度与数据总览', '维保工单主从工作台']}
      />
      <Toolbar
        pfId="tb_wb_global"
        align="between"
        title="工单全局调度栏"
        subTitle="支持新建维保工单（单号唯一校验）或一键切换泳道排班视图"
      >
        <Space pfId="sp_wb_global_btns" size="middle">
          <Button
            pfId="btn_wb_new_ticket"
            type="primary"
            icon="plus"
            onClick={() => openModal('mdl_new_ticket')}
          >
            新建维保工单
          </Button>
          <Button
            pfId="btn_wb_to_kanban"
            icon="eye"
            onClick={() => navigate('page_kanban_schedule')}
          >
            切换泳道与排期日历
          </Button>
          <Button pfId="btn_wb_to_dash" onClick={() => navigate('page_overview_dashboard')}>返回运营总览看板</Button>
        </Space>
      </Toolbar>
      <Row pfId="row_wb_split" gutter={16}>
        <Col pfId="col_wb_master" span={9}>
          <Card pfId="card_wb_master" title="维保工单队列" extra="点击卡片无弹窗切换" headerBg="white">
            <Toolbar pfId="tb_wb_search" align="left">
              <SearchInput
                pfId="si_wb_tickets"
                target="rep_ticket_list"
                placeholder="搜索工单号 / 客户 / 设备 / 工程师..."
                allowClear={true}
                width="full"
              />
            </Toolbar>
            <Repeater
              pfId="rep_ticket_list"
              table="t_srv_tickets"
              cols={1}
              gap={12}
              pageSize={5}
              pagination={true}
              autoSelectFirst={true}
              emptyText="未检索到匹配的维保工单"
              onItemClick={() => selectRow()}
            >
              <Card
                pfId="rep_item_card"
                title={'{{row.ticket_no}}'}
                extra={'{{row.status}}'}
                size="small"
                hoverable={true}
                variant="subtle"
              >
                <Flex pfId="rep_item_top" justify="space-between" align="center" gap={8}>
                  <Text pfId="rep_item_cust" strong={true} size="base">{'{{row.customer_name}}'}</Text>
                  <Tag pfId="rep_item_prio" color="orange" round={true}>{'{{row.priority}}'}</Tag>
                </Flex>
                <Flex pfId="rep_item_meta" justify="space-between" align="center" gap={8}>
                  <Text pfId="rep_item_dev" type="secondary" size="xs">{'设备：{{row.device_model}}'}</Text>
                  <Text pfId="rep_item_eng" type="secondary" size="xs">
                    {'工程师：{{row.engineer_name}} · {{row.visit_start_date}}'}
                  </Text>
                </Flex>
              </Card>
            </Repeater>
          </Card>
        </Col>
        <Col pfId="col_wb_detail" span={15}>
          <Card
            pfId="card_wb_detail"
            title={'当前选中工单闭环处置舱（{{row.ticket_no}}）'}
            extra={'主责工程师：{{row.engineer_name}}'}
            activeTable="t_srv_tickets"
            headerBg="blue"
          >
            <Toolbar pfId="tb_detail_actions" align="between" bg="gray" bordered={true}>
              <Space pfId="sp_detail_flow" size="small" wrap={true}>
                <Button
                  pfId="btn_act_start_visit"
                  type="primary"
                  icon="check"
                  disabledWhenField="status"
                  disabledWhenValue="!待派单"
                  disabledReason="仅【待派单】状态工单允许触发出发上门"
                  onClick={() => {
                    updateRow({ status: '上门中' });
                    toast('工单已流转至【上门中】状态', 'success');
                  }}
                >
                  出发上门
                </Button>
                <Button
                  pfId="btn_act_submit_accept"
                  icon="check"
                  disabledWhenField="status"
                  disabledWhenValue="!上门中"
                  disabledReason="仅【上门中】状态工单允许发起客户验收"
                  onClick={() => {
                    updateRow({ status: '待验收' });
                    toast('已提交客户现场验收，流转至【待验收】', 'success');
                  }}
                >
                  提交验收
                </Button>
                <Button
                  pfId="btn_act_apply_part"
                  icon="plus"
                  disabledWhenField="status"
                  disabledWhenValue="已结单"
                  disabledReason="已结单工单禁止追加申领备件"
                  onClick={() => openModal('mdl_apply_part')}
                >
                  申领备件
                </Button>
                <Button
                  pfId="btn_act_add_log"
                  icon="edit"
                  onClick={() => openModal('mdl_add_log')}
                >
                  记跟进日志
                </Button>
                <Button
                  pfId="btn_act_soft_delete"
                  icon="delete"
                  disabledWhenField="status"
                  disabledWhenValue="!待派单"
                  disabledReason="仅【待派单】工单允许归档（若含未退备件将触发 RESTRICT 拦截）"
                  onClick={() => deleteRow('undo')}
                >
                  归档(可撤销)
                </Button>
                <Button
                  pfId="btn_act_force_close"
                  danger={true}
                  disabledWhenField="status"
                  disabledWhenValue="已结单"
                  disabledReason="该工单已完成结单"
                  onClick={() => {
                    confirm('高危操作：强制结单将锁定备件与排期，请输入当前工单号确认', '{{row.ticket_no}}');
                    updateRow({ status: '已结单' });
                    toast('已完成单号匹配核验并强制结单', 'warning');
                  }}
                >
                  强制结单
                </Button>
              </Space>
            </Toolbar>
            <Descriptions
              pfId="desc_ticket_info"
              title="工单档案摘要"
              table="t_srv_tickets"
              bordered={true}
              column={2}
              size="small"
              items={[
                { label: '维保工单编号', field: 'ticket_no' },
                { label: '当前履约状态', field: 'status' },
                { label: '客户企业名称', field: 'customer_name' },
                { label: '响应优先级', field: 'priority' },
                { label: '星链设备型号', field: 'device_model' },
                { label: '现场联系人手机', field: 'contact_phone' },
                { label: '预约上门开始日', field: 'visit_start_date' },
                { label: '预约上门结束日', field: 'visit_end_date' },
              ]}
            />
            <Divider
              pfId="div_edit_schedule"
              text="派单排期与联系人维护（跨字段日期 & 手机号实时防错）"
              orientation="left"
            />
            <Form pfId="frm_edit_ticket" table="t_srv_tickets" cols={2} layout="vertical">
              <Input
                pfId="inp_edit_eng"
                label="主责工程师"
                name="engineer_name"
                required={true}
                placeholder="输入主责工程师姓名"
              />
              <Input
                pfId="inp_edit_phone"
                label="现场联系人手机"
                name="contact_phone"
                required={true}
                formatRule="phone"
                validationMessage="请输入合法的联系手机号码（如 13816289012）"
                placeholder="138xxxxxxxx"
              />
              <DatePicker pfId="dp_edit_sdate" label="预约上门开始日" name="visit_start_date" required={true} />
              <DatePicker
                pfId="dp_edit_edate"
                label="预约上门结束日(≥开始日)"
                name="visit_end_date"
                required={true}
                minField="visit_start_date"
                validationMessage="预约上门结束日期不得早于开始日期"
              />
              <Select
                pfId="sel_edit_prio"
                label="响应优先级"
                name="priority"
                required={true}
                options="普通,加急,特急"
              />
              <NumberInput
                pfId="num_edit_hours"
                label="预计维保工时(h)"
                name="sla_hours"
                required={true}
                minValue={0.5}
                maxValue={72}
                step={0.5}
                suffix="h"
                validationMessage="预计维保工时须在 0.5 ~ 72 小时范围内"
              />
            </Form>
            <Toolbar pfId="tb_save_ticket" align="right">
              <Button
                pfId="btn_save_ticket"
                type="primary"
                icon="check"
                onClick={() => {
                  submitForm('frm_edit_ticket');
                  toast('工单排期与联系信息已保存', 'success');
                }}
              >
                保存排期修改
              </Button>
            </Toolbar>
            <Divider pfId="div_child_tabs" text="关联备件领用与现场跟进子表" orientation="left" />
            <Tabs pfId="tabs_ticket_children" type="card">
              <Tab pfId="tab_part_usages" title="关联备件领用明细（RESTRICT 防误删保护）">
                <Alert
                  pfId="alt_part_rule"
                  type="info"
                  showIcon={true}
                  message="外键防错机制：存在未退回备件明细时将自动阻断父工单归档删除（可试点 WO-202611-01）；无备件工单（WO-202611-03）支持一键级联归档与 5 秒撤销恢复。"
                />
                <Table
                  pfId="tbl_ticket_parts"
                  table="t_srv_part_usages"
                  sourceForeignKey="ticket_id"
                  size="small"
                  pagination={false}
                  emptyText="当前工单暂未申领维保备件（可直接体验上方「归档工单(可撤销)」）"
                  columns={[
                    { dataIndex: 'part_code', title: '备件物料编码', width: 140 },
                    { dataIndex: 'part_name', title: '备件物料名称', width: 195 },
                    { dataIndex: 'stock_available', title: '可用库存余量', align: 'right', width: 120 },
                    { dataIndex: 'apply_qty', title: '本次申领数量', align: 'right', width: 120 },
                  ]}
                  rowActions={[{ label: '退回备件(可撤销)', danger: true, onClick: () => deleteRow('undo') }]}
                />
              </Tab>
              <Tab pfId="tab_ticket_logs" title="现场跟进日志（CASCADE 级联归档）">
                <Table
                  pfId="tbl_ticket_logs"
                  table="t_srv_ticket_logs"
                  sourceForeignKey="ticket_id"
                  size="small"
                  pagination={false}
                  emptyText="当前工单暂无现场跟进日志"
                  columns={[
                    { dataIndex: 'action_stage', title: '处置节点', render: 'tag', width: 120 },
                    { dataIndex: 'log_note', title: '现场排查与处理记录', width: 290 },
                    { dataIndex: 'logged_date', title: '记录日期', render: 'date', width: 120 },
                  ]}
                  rowActions={[{ label: '移除日志(可撤销)', danger: true, onClick: () => deleteRow('undo') }]}
                />
              </Tab>
            </Tabs>
          </Card>
        </Col>
      </Row>
      <Modal
        pfId="mdl_new_ticket_node"
        id="mdl_new_ticket"
        title="新建售后维保工单"
        width={680}
        okText="提交建单"
        onOk={() => {
          submitForm('frm_new_ticket');
          closeOverlay();
          toast('新维保工单已创建并纳入调度队列', 'success');
        }}
      >
        <Form pfId="frm_new_ticket" table="t_srv_tickets" cols={2} layout="vertical">
          <Input
            pfId="inp_new_no"
            label="维保工单编号(唯一)"
            name="ticket_no"
            required={true}
            placeholder="如 WO-202611-18"
          />
          <Input
            pfId="inp_new_cust"
            label="客户企业名称"
            name="customer_name"
            required={true}
            placeholder="请输入客户企业全称"
          />
          <Input
            pfId="inp_new_dev"
            label="星链设备型号"
            name="device_model"
            required={true}
            placeholder="如 StarLink-X900 边缘计算网关"
          />
          <Input
            pfId="inp_new_phone"
            label="现场联系人手机"
            name="contact_phone"
            required={true}
            formatRule="phone"
            validationMessage="请输入合法的联系手机号码"
            placeholder="请输入 11 位手机号"
          />
          <Select
            pfId="sel_new_prio"
            label="响应优先级"
            name="priority"
            required={true}
            initialValue="加急"
            options="普通,加急,特急"
          />
          <Input
            pfId="inp_new_eng"
            label="指派主责工程师"
            name="engineer_name"
            required={true}
            initialValue="林峰"
            placeholder="输入工程师姓名"
          />
          <DatePicker pfId="dp_new_sdate" label="预约上门开始日" name="visit_start_date" required={true} />
          <DatePicker
            pfId="dp_new_edate"
            label="预约上门结束日(≥开始日)"
            name="visit_end_date"
            required={true}
            minField="visit_start_date"
            validationMessage="预约结束日期不得早于开始日期"
          />
          <NumberInput
            pfId="num_new_hours"
            label="预计维保工时(h)"
            name="sla_hours"
            required={true}
            minValue={0.5}
            maxValue={72}
            step={0.5}
            suffix="h"
          />
        </Form>
      </Modal>
      <Modal
        pfId="mdl_apply_part_node"
        id="mdl_apply_part"
        title="申领维保备件（含库存防超领校验）"
        width={640}
        okText="确认申领"
        onOk={() => {
          submitForm('frm_apply_part');
          closeOverlay();
          toast('维保备件申领明细已写入当前工单', 'success');
        }}
      >
        <Form pfId="frm_apply_part" table="t_srv_part_usages" cols={2} layout="vertical">
          <PickerInput
            pfId="pk_part_ticket"
            label="关联维保工单"
            name="ticket_id"
            overlay="mdl_pick_ticket"
            placeholder="点击选择关联维保工单"
            required={true}
            span={2}
          />
          <Input
            pfId="inp_part_code"
            label="备件物料编码"
            name="part_code"
            required={true}
            placeholder="如 SP-OPT-408（同单同编码唯一）"
          />
          <Input
            pfId="inp_part_name"
            label="备件物料名称"
            name="part_name"
            required={true}
            placeholder="如 万兆光模块激光收发器"
          />
          <NumberInput
            pfId="num_part_stock"
            label="当前可用库存余量"
            name="stock_available"
            required={true}
            minValue={1}
            suffix="件"
          />
          <NumberInput
            pfId="num_part_qty"
            label="本次申领数量(≤可用余量)"
            name="apply_qty"
            required={true}
            minValue={1}
            maxField="stock_available"
            suffix="件"
            validationMessage="本次申领数量不得超过当前可用库存余量"
          />
        </Form>
      </Modal>
      <Modal
        pfId="mdl_add_log_node"
        id="mdl_add_log"
        title="新增现场跟进日志"
        width={620}
        okText="保存日志"
        onOk={() => {
          submitForm('frm_add_log');
          closeOverlay();
          toast('现场跟进日志已记录', 'success');
        }}
      >
        <Form pfId="frm_add_log" table="t_srv_ticket_logs" cols={2} layout="vertical">
          <PickerInput
            pfId="pk_log_ticket"
            label="关联维保工单"
            name="ticket_id"
            overlay="mdl_pick_ticket"
            placeholder="点击选择关联维保工单"
            required={true}
          />
          <Select
            pfId="sel_log_stage"
            label="跟进处置节点"
            name="action_stage"
            required={true}
            initialValue="到场排查"
            options="建单受理,派单指派,到场排查,完工回访"
          />
          <DatePicker pfId="dp_log_date" label="记录日期" name="logged_date" required={true} span={2} />
          <Textarea
            pfId="ta_log_note"
            label="现场排查与处理记录"
            name="log_note"
            required={true}
            rows={3}
            span={2}
            placeholder="请详细记录设备故障现象、光衰/信噪比检测数据与备件更换情况..."
          />
        </Form>
      </Modal>
      <Modal
        pfId="mdl_pick_ticket_node"
        id="mdl_pick_ticket"
        title="选择关联维保工单"
        width={760}
        okText="回填所选工单"
        onOk={() => returnSelection('tbl_pick_ticket', 'ticket_no', 'id')}
      >
        <Toolbar pfId="tb_pick_ticket" align="left">
          <SearchInput
            pfId="si_pick_ticket"
            target="tbl_pick_ticket"
            placeholder="搜索工单编号或客户名称..."
            allowClear={true}
            width="full"
          />
        </Toolbar>
        <Table
          pfId="tbl_pick_ticket"
          table="t_srv_tickets"
          selectable={true}
          selectionType="radio"
          size="small"
          pageSize={5}
          columns={[
            { dataIndex: 'ticket_no', title: '工单编号', width: 150 },
            { dataIndex: 'customer_name', title: '客户企业名称', width: 180 },
            { dataIndex: 'device_model', title: '设备型号', width: 185 },
            { dataIndex: 'status', title: '状态', render: 'tag', width: 100 },
            { dataIndex: 'engineer_name', title: '工程师', width: 100 },
          ]}
        />
      </Modal>
    </Page>
  );
}
`);

  const kanbanScheduleSource = norm(`// @protoflow page: page_kanban_schedule
export default function Page() {
  return (
    <Page
      pfId="p_kb_root"
      title="履约流转看板与排期日历"
      description="多列泳道状态流转与工程师月/周排班日历双视图协同"
      emptyTitle="当前排班周期暂无维保工单，请前往工作台新建派单"
      errorFallback="banner"
      errorTitle="排班日历实时同步受阻"
      errorDescription="已降级展示本地排期快照，待网关恢复后自动同步最新流转状态"
    >
      <PageHeader
        pfId="ph_kb_header"
        title="维保履约看板与排班日历"
        subTitle="支持拖拽或快捷箭头推进工单状态，并与下方工程师排期日历、iPhone 现场端实时共享同一张物理表"
        tagText="泳道 + 日历同源"
        tagColor="blue"
        breadcrumb={['履约看板与排班', '履约流转看板与排期日历']}
      />
      <Toolbar
        pfId="tb_kb_top"
        align="between"
        title="现场履约可视调度台"
        subTitle="在看板推进状态后，主从工作台与移动端现场任务将实时同步"
      >
        <Space pfId="sp_kb_btns" size="middle">
          <Button
            pfId="btn_kb_to_wb"
            type="primary"
            icon="edit"
            onClick={() => navigate('page_ticket_workbench')}
          >
            前往工单主从工作台
          </Button>
          <Button pfId="btn_kb_to_dash" onClick={() => navigate('page_overview_dashboard')}>返回运营数据看板</Button>
        </Space>
      </Toolbar>
      <Card
        pfId="card_kb_lanes"
        title="维保工单四阶段履约流转看板"
        extra="支持拖拽卡片或点击右侧箭头实时推进工单状态"
        headerBg="white"
      >
        <QueryForm
          pfId="qf_kb_filter"
          target="kb_srv_tickets"
          fields={[
            { name: 'engineer_name', label: '主责工程师', type: 'input', placeholder: '输入工程师姓名筛选' },
            { name: 'priority', label: '响应优先级', type: 'select', options: '普通,加急,特急' },
          ]}
        />
        <Kanban
          pfId="kb_srv_tickets"
          table="t_srv_tickets"
          titleField="customer_name"
          subtitleField="engineer_name"
          metricField="ticket_no"
          tagField="priority"
          allowMove={true}
          onCardClick={() => openDrawer('drw_ticket_quick')}
          rowActions={[
            { label: '速览', onClick: () => openDrawer('drw_ticket_quick') },
            { label: '深度处置', onClick: () => navigate('page_ticket_workbench', 'row') },
          ]}
        />
      </Card>
      <Card pfId="card_kb_calendar" title="工程师上门维保排期日历" extra="点击任意日程项可拉起右侧速览抽屉" headerBg="white">
        <Calendar
          pfId="cal_srv_tickets"
          title="月/周维保预约排期视图"
          table="t_srv_tickets"
          dateField="visit_start_date"
          endDateField="visit_end_date"
          titleField="customer_name"
          statusField="status"
          view="month"
          onEventClick={() => openDrawer('drw_ticket_quick')}
        />
      </Card>
      <Drawer
        pfId="drw_ticket_quick_node"
        id="drw_ticket_quick"
        title="维保工单速览与跨页协同"
        width={520}
        placement="right"
        footer={false}
      >
        <Descriptions
          pfId="desc_kb_quick"
          title="当前工单详情"
          table="t_srv_tickets"
          bordered={true}
          column={1}
          size="small"
          items={[
            { label: '维保工单编号', field: 'ticket_no' },
            { label: '客户企业名称', field: 'customer_name' },
            { label: '星链设备型号', field: 'device_model' },
            { label: '响应优先级', field: 'priority' },
            { label: '当前履约状态', field: 'status' },
            { label: '主责工程师', field: 'engineer_name' },
            { label: '现场联系人手机', field: 'contact_phone' },
            { label: '预约上门开始日', field: 'visit_start_date' },
            { label: '预约上门结束日', field: 'visit_end_date' },
            { label: '预计维保工时(h)', field: 'sla_hours' },
          ]}
        />
        <Divider pfId="div_kb_quick" text="协同流转操作" orientation="left" />
        <Toolbar pfId="tb_kb_drawer_btns" align="right">
          <Space pfId="sp_kb_drawer_btns" size="small">
            <Button pfId="btn_kb_close" onClick={() => closeOverlay()}>关闭抽屉</Button>
            <Button
              pfId="btn_kb_deep_wb"
              type="primary"
              icon="edit"
              onClick={() => {
                closeOverlay();
                navigate('page_ticket_workbench', 'row');
              }}
            >
              前往主从工作台处理
            </Button>
          </Space>
        </Toolbar>
      </Drawer>
    </Page>
  );
}
`);

  const mobileFieldSource = norm(`// @protoflow page: page_mobile_field
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage
      pfId="mp_field_root"
      title="工程师现场接单与领料端"
      accent="gemini"
      surfaceBg="mist"
      padding="default"
      emptyTitle="今日暂无待上门维保任务，祝工作顺心"
      errorFallback="component"
      errorTitle="现场移动网络信号波动"
      errorDescription="已切换至离线缓存工单模式，网络恢复后自动回传领料与签到记录"
    >
      <MTopBar
        pfId="mtb_field"
        title="星链现场工程师"
        subtitle="华东智能维保组 · 林峰"
        leftMode="sparkle"
        rightIcon="bell"
        onRightClick={() => toast('当前在途工单均在 SLA 窗口内，请按动线依次上门', 'info')}
      />
      <MScrollRow pfId="msr_kpis" title="今日现场履约概览" gap={12} peek={true}>
        <MStatCard
          pfId="msc_pending"
          title="今日待上门工单"
          value="4"
          unit="单"
          trend="SLA 100%"
          trendTone="up"
          sparkline={true}
        />
        <MStatCard
          pfId="msc_ontime"
          title="本月一次完修率"
          value="98.6"
          unit="%"
          trend="+2.4%"
          trendTone="up"
          sparkline={true}
        />
      </MScrollRow>
      <MAiInsightCard
        pfId="mai_field"
        title="AI 随行路线与备件预检"
        badge="AI 领航"
        summary="已结合园区路况与 SLA 时限重排今日上门顺序，出发前建议完成以下预检："
        items={[
          {
            title: '优先前往杭州极光智造基地',
            detail: '边缘网关光衰告警工单距承诺窗口仅剩 1.5 小时，建议立即核验随车光模块出发',
            actionLabel: '申领备件',
            onClick: () => openDrawer('msheet_apply_part'),
          },
          {
            title: '随车万兆光模块余量充足',
            detail: '随车周转箱当前可用 SP-OPT-408 共 12 件，满足今日现场更换需求',
            actionLabel: '签到打卡',
            onClick: () => toast('已完成现场 GPS 定位签到', 'success'),
          },
        ]}
      />
      <MPillTabs
        pfId="mpt_filter"
        variant="pill"
        target="mkb_tickets"
        filterField="priority"
        items={[
          { title: '全部任务', value: '' },
          { title: '特急响应', value: '特急', badge: '2' },
          { title: '加急工单', value: '加急', badge: '3' },
          { title: '普通巡检', value: '普通' },
        ]}
      />
      <MKanban
        pfId="mkb_tickets"
        table="t_srv_tickets"
        titleField="customer_name"
        subtitleField="device_model"
        metricField="ticket_no"
        allowMove={true}
        onCardClick={() => openDrawer('msheet_ticket_detail')}
        rowActions={[
          {
            label: '现场领备件',
            primary: true,
            disabledWhenField: 'status',
            disabledWhenValue: '已结单',
            disabledReason: '已结单工单禁止追加领料',
            onClick: () => openDrawer('msheet_apply_part'),
          },
        ]}
      />
      <MCalendar
        pfId="mcal_tickets"
        title="本周上门维保日程流"
        table="t_srv_tickets"
        dateField="visit_start_date"
        titleField="customer_name"
        subtitleField="device_model"
        statusField="status"
        mode="week"
        onEventClick={() => openDrawer('msheet_ticket_detail')}
      />
      <MBottomSheet
        pfId="msheet_detail_node"
        id="msheet_ticket_detail"
        title="现场工单回执与联系维护"
        subtitle={'工单号：{{row.ticket_no}} · {{row.customer_name}}'}
        size="medium"
      >
        <MSurface
          pfId="msurf_ticket_summary"
          title={'{{row.device_model}}'}
          subtitle={'当前履约阶段：{{row.status}} · 优先级：{{row.priority}}'}
          tone="subtle"
          padding="sm"
        />
        <MForm pfId="mfrm_ticket_update" title="现场对接信息核实" table="t_srv_tickets">
          <MField
            pfId="mf_upd_eng"
            label="现场执行工程师"
            name="engineer_name"
            required={true}
            placeholder="请输入执行工程师姓名"
          />
          <MField
            pfId="mf_upd_phone"
            label="客户现场联系手机"
            name="contact_phone"
            inputType="phone"
            formatRule="phone"
            required={true}
            validationMessage="请输入合法的联系手机号码"
            placeholder="请输入 11 位手机号"
          />
          <MChipSelect
            pfId="mcs_upd_status"
            label="更新现场履约状态"
            name="status"
            options="待派单,上门中,待验收,已结单"
            required={true}
          />
        </MForm>
        <MButton
          pfId="mbtn_save_ticket"
          variant="gradient"
          block={true}
          onClick={() => {
            submitForm('mfrm_ticket_update');
            closeOverlay();
            toast('现场工单状态与联系信息已同步至 PC 工作台', 'success');
          }}
        >
          保存现场回执
        </MButton>
      </MBottomSheet>
      <MBottomSheet
        pfId="msheet_part_node"
        id="msheet_apply_part"
        title="现场申领维保备件"
        subtitle="实时关联工单主表并校验随车库存防超领上限"
        size="tall"
      >
        <MForm pfId="mfrm_apply_part" title="填写备件领用单" table="t_srv_part_usages">
          <MSheetPicker
            pfId="msp_part_ticket"
            label="关联维保工单"
            name="ticket_id"
            table="t_srv_tickets"
            labelField="ticket_no"
            valueField="id"
            placeholder="点击选择当前维保工单"
            required={true}
          />
          <MField
            pfId="mf_part_code"
            label="备件物料编码"
            name="part_code"
            placeholder="例如 SP-OPT-408"
            required={true}
          />
          <MField
            pfId="mf_part_name"
            label="备件物料名称"
            name="part_name"
            placeholder="例如 万兆光模块激光收发器"
            required={true}
          />
          <MField
            pfId="mf_part_stock"
            label="随车可用库存余量"
            name="stock_available"
            inputType="number"
            minValue={1}
            required={true}
            helperText="请输入随车周转箱当前核定可用数"
          />
          <MField
            pfId="mf_part_qty"
            label="本次申领数量(≤可用余量)"
            name="apply_qty"
            inputType="number"
            minValue={1}
            maxField="stock_available"
            required={true}
            validationMessage="申领数量不得超过随车可用库存余量"
            placeholder="不得超过上方可用余量"
          />
        </MForm>
        <MButton
          pfId="mbtn_submit_part"
          variant="gradient"
          block={true}
          onClick={() => {
            submitForm('mfrm_apply_part');
            closeOverlay();
            toast('现场备件申领已提交并同步至调度工作台', 'success');
          }}
        >
          确认申领并扣减随车余量
        </MButton>
      </MBottomSheet>
      <MTabBar
        pfId="mtab_bottom"
        variant="floating"
        activeKey="tasks"
        items={[
          { key: 'tasks', title: '现场任务', icon: 'Layers', badge: '4' },
          {
            key: 'parts',
            title: '备件申领',
            icon: 'Sparkles',
            onClick: () => openDrawer('msheet_apply_part'),
          },
          {
            key: 'checkin',
            title: '到场签到',
            icon: 'User',
            onClick: () => toast('GPS 到场签到成功：杭州极光智造精密基地', 'success'),
          },
        ]}
      />
    </MobilePage>
  );
}
`);

  const stickyNotes: StickyNoteRule[] = [
    {
      id: 'sn-sl-1',
      pageId: 'page_overview_dashboard',
      targetWidgetId: 'tbl_dash_tickets',
      targetWidgetName: '全网重点维保工单实时监控台账',
      index: 1,
      text: '点击行尾「进入工作台处置」通过 navigate("page_ticket_workbench", "row") 携带当前选中工单上下文跳转，主从工作台右侧详情舱与子表自动聚焦该工单。',
      compiledRule: 'ROW_CONTEXT_NAV: navigate("page_ticket_workbench", "row") => activeRow(t_srv_tickets) = row.id',
      active: true,
    },
    {
      id: 'sn-sl-2',
      pageId: 'page_ticket_workbench',
      targetWidgetId: 'rep_ticket_list',
      targetWidgetName: '维保工单主列表循环卡片',
      index: 1,
      text: '无弹窗主从联动：autoSelectFirst 首屏自动选中首张工单，右侧详情 Card 声明 activeTable="t_srv_tickets" 严格隔离跨表来源行误写。',
      compiledRule: 'MASTER_DETAIL_ISOLATION: Repeater.selectRow() -> Card[activeTable="t_srv_tickets"]',
      active: true,
    },
    {
      id: 'sn-sl-3',
      pageId: 'page_ticket_workbench',
      targetWidgetId: 'dp_edit_edate',
      targetWidgetName: '预约上门结束日选择器',
      index: 2,
      text: 'Poka-Yoke 跨字段实时防错：预约结束日通过 minField="visit_start_date" 保证不早于开始日，联系手机校验合法号段，预计工时限制在 0.5 ~ 72 小时。',
      compiledRule: 'POKA_YOKE: visit_end_date >= visit_start_date && PHONE(contact_phone) && sla_hours IN [0.5, 72]',
      active: true,
    },
    {
      id: 'sn-sl-4',
      pageId: 'page_ticket_workbench',
      targetWidgetId: 'btn_act_soft_delete',
      targetWidgetName: '归档工单(可撤销)按钮',
      index: 3,
      text: '外键防误删与级联撤销闭环：含未退备件的工单（如 WO-202611-01）触发 RESTRICT 自动拦截；无备件工单（如 WO-202611-03）级联归档跟进日志并提供 5 秒一键原子撤销。',
      compiledRule: 'FK_CLOSURE: RESTRICT(srv_part_usages.ticket_id) && CASCADE_WITH_UNDO(srv_ticket_logs.ticket_id)',
      active: true,
    },
    {
      id: 'sn-sl-5',
      pageId: 'page_ticket_workbench',
      targetWidgetId: 'btn_act_force_close',
      targetWidgetName: '强制结单(单号确认)按钮',
      index: 4,
      text: '高危单据二次防错：强制结单前弹窗要求完整输入当前工单编号 {{row.ticket_no}}，单号完全一致后方可写回「已结单」。',
      compiledRule: 'CONFIRM_MATCH_TEXT: input === row.ticket_no => status = "已结单"',
      active: true,
    },
    {
      id: 'sn-sl-6',
      pageId: 'page_ticket_workbench',
      targetWidgetId: 'num_part_qty',
      targetWidgetName: '本次申领数量输入框',
      index: 5,
      text: '备件防超领与联合唯一约束：apply_qty 绑定 maxField="stock_available" 防止超库存领料，底层表启用 uq_srv_ticket_part(ticket_id, part_code) 防止同单重复申领同编码备件。',
      compiledRule: 'apply_qty <= stock_available && UNIQUE(ticket_id, part_code)',
      active: true,
    },
    {
      id: 'sn-sl-7',
      pageId: 'page_kanban_schedule',
      targetWidgetId: 'kb_srv_tickets',
      targetWidgetName: '维保工单四阶段流转看板',
      index: 1,
      text: '多枚举列智能消歧：表内同时存在 priority 与 status 枚举列时，看板自动锚定 status 状态机列生成四泳道，并与下方排期日历实时联动。',
      compiledRule: 'KANBAN_ENUM_SYNC: srv_tickets.status <-> Calendar[visit_start_date..visit_end_date]',
      active: true,
    },
    {
      id: 'sn-sl-8',
      pageId: 'page_mobile_field',
      targetWidgetId: 'mkb_tickets',
      targetWidgetName: '移动端现场工单看板',
      index: 1,
      text: 'PC + iPhone 跨端实时共表：工程师在手机端推进工单阶段或通过半屏抽屉申领随车备件后，PC 运营看板与主从工作台子表即时同步更新。',
      compiledRule: 'SHARED_ER_SYNC: MobilePage(t_srv_tickets, t_srv_part_usages) <-> DesktopWorkbench',
      active: true,
    },
  ];

  const projectNotes: NoteWorkspace = {
    nodes: [
      {
        id: 'note-fld-sl-prd',
        kind: 'folder',
        title: '星链售后维保与备件履约 PRD 规范',
        parentId: null,
        icon: '📁',
        updatedAt: '2026-11-25T04:00:00.000Z',
      },
      {
        id: 'note-sl-sla-rules',
        kind: 'note',
        title: '工单 SLA 状态机、外键防误删闭环与五态容错验收规范',
        parentId: 'note-fld-sl-prd',
        icon: '🛠️',
        updatedAt: '2026-11-25T04:10:00.000Z',
        tags: ['SLA 状态机', 'Poka-Yoke 防错', 'ER 外键策略'],
        cover: 'ocean',
        pinned: true,
        status: 'confirmed',
        priority: 'P0',
        stakeholder: '全球售后交付总监 & 备件供应链负责人',
        meetingDate: '2026-11-25',
        shareable: true,
        content: [
          '<h2>1. 售后维保工单状态机（srv_tickets.status）</h2>',
          '<ul>',
          '<li>标准履约流转：<code>待派单</code> → <code>上门中</code> → <code>待验收</code> → <code>已结单</code>（PC 主从工作台、泳道看板与 iPhone 现场端三处实时共表互通）。</li>',
          '<li>异常强制结单：非终态工单执行「强制结单」必须二次输入匹配当前 <code>ticket_no</code> 单号，防止误关在途高优工单。</li>',
          '</ul>',
          '<h2>2. 跨表外键约束与防错撤销红线</h2>',
          '<ol>',
          '<li><strong>备件防误删保护（RESTRICT）</strong>：<code>srv_part_usages.ticket_id</code> 声明 <code>ON DELETE RESTRICT</code> 与联合唯一约束 <code>(ticket_id, part_code)</code>，申领数量严格受限于 <code>apply_qty &lt;= stock_available</code>；未退回备件前禁止归档父工单。</li>',
          '<li><strong>日志级联归档与 5 秒原子撤销（CASCADE + Undo）</strong>：<code>srv_ticket_logs.ticket_id</code> 声明 <code>ON DELETE CASCADE</code>；归档无备件工单（如 <code>WO-202611-03</code>）时同步归档日志，并在 5 秒内支持一键原子恢复主子表记录（恢复前自动重验业务主键与联合唯一性）。</li>',
          '<li><strong>UI Stack 五态矩阵隔离</strong>：顶部工具栏可随时切换理想态 / 空数据 / 加载中 / 极值态 / 异常态；极值压测长文案仅供渲染展示，绝不污染底层工程数据。</li>',
          '</ol>',
        ].join(''),
      },
    ],
    links: [
      { page: { kind: 'page', pageId: 'page_overview_dashboard' }, targetNodeId: 'note-sl-sla-rules' },
      { page: { kind: 'page', pageId: 'page_ticket_workbench' }, targetNodeId: 'note-sl-sla-rules' },
      { page: { kind: 'page', pageId: 'page_kanban_schedule' }, targetNodeId: 'note-sl-sla-rules' },
      { page: { kind: 'page', pageId: 'page_mobile_field' }, targetNodeId: 'note-sl-sla-rules' },
    ],
  };

  const mindmaps: MindmapWorkspace = {
    nodes: [
      {
        id: 'mm-sl-flow',
        kind: 'mindmap',
        title: '星链售后维保与备件防错闭环流程图',
        parentId: null,
        source: [
          'flowchart LR',
          '  A["物联告警 / 客户报修\\n(srv_tickets · 待派单)"] --> B["无弹窗主从工作台\\n排期起止日 & 手机防错校验"]',
          '  B --> C["PC / 手机半屏申领备件\\n(srv_part_usages · apply_qty <= 库存)"]',
          '  B --> D["四泳道看板 & iPhone 现场端\\n(上门中 -> 待验收)"]',
          '  C --> E{"尝试归档父工单?"}',
          '  E -- "存在未退备件" --> F["RESTRICT 自动拦截\\n提示先退回备件"]',
          '  E -- "无未退备件" --> G["CASCADE 级联归档日志\\n+ 5 秒一键原子撤销"]',
          '  D --> H["客户验收 / 输入工单号强制结单\\n(已结单)"]',
        ].join('\n'),
      },
    ],
    links: [
      { page: { kind: 'folder', folderId: 'fld_workbench' }, targetNodeId: 'mm-sl-flow' },
      { page: { kind: 'folder', folderId: 'fld_mobile_engineer' }, targetNodeId: 'mm-sl-flow' },
    ],
  };

  return {
    designTokens: STARLINK_DESIGN_TOKENS,
    dbTables: [ticketsTable, partUsagesTable, ticketLogsTable],
    tableRows,
    designerFolders,
    designerPages,
    pageSources: {
      page_overview_dashboard: dashboardSource,
      page_ticket_workbench: workbenchSource,
      page_kanban_schedule: kanbanScheduleSource,
      page_mobile_field: mobileFieldSource,
    },
    stickyNotes,
    projectNotes,
    mindmaps,
    entryPageId: 'page_overview_dashboard',
  };
}

export function createStarlinkDemoDataset(locale?: Locale): StarlinkDemoDataset {
  const useEn = locale ? locale === 'en-US' : isEnLocale();
  return useEn ? createEnglishStarlinkDemoDataset() : createChineseStarlinkDemoDataset();
}
