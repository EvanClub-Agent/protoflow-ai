import type { DBTableSchema } from '../../store/useProtoStore';
import type { DesignerFolder } from '../sitemap';
import type { DesignerPage } from '../store/usePageStore';
import type { Row } from '../runtime/mock';
import { parsePageSource } from '../dsl/parser';
import { printPageSource } from '../dsl/printer';

function norm(tsx: string): string {
  const res = parsePageSource(tsx);
  return res.doc ? printPageSource(res.doc) : tsx;
}

export function createMobileStarterDataset(): {
  dbTables: DBTableSchema[];
  tableRows: Record<string, Row[]>;
  designerFolders: DesignerFolder[];
  designerPages: DesignerPage[];
  pageSources: Record<string, string>;
  entryPageId: string;
} {
  const dbTables: DBTableSchema[] = [
    {
      id: 't_mob_catalog',
      tableName: 't_mob_catalog',
      cnName: '精选服务与商品表',
      domain: '移动端体验',
      description: '支撑 C 端探索瀑布流与在线预约/选购的数据表',
      sharedByMenus: [
        {
          pageId: 'mob-explore',
          menuTitle: '探索首页',
          accessMode: 'READ 查询',
          fieldMappingNote: '只读展示目录，预订在本次演示中确认，不修改商品',
        },
      ],
      columns: [
        { id: 'c_mc_id', name: 'id', dataType: 'VARCHAR(36)', nullable: false, isPrimaryKey: true, comment: '主键ID' },
        { id: 'c_mc_title', name: 'item_name', dataType: 'VARCHAR(120)', nullable: false, comment: '商品/服务名称' },
        { id: 'c_mc_sub', name: 'subtitle', dataType: 'VARCHAR(200)', nullable: true, comment: '核心卖点说明' },
        { id: 'c_mc_price', name: 'price_text', dataType: 'VARCHAR(40)', nullable: false, comment: '展示价格' },
        { id: 'c_mc_tag', name: 'tag', dataType: 'VARCHAR(40)', nullable: true, comment: '精选标签' },
        { id: 'c_mc_spec', name: 'spec', dataType: 'VARCHAR(60)', nullable: true, comment: '默认规格' },
      ],
    },
    {
      id: 't_mob_tasks',
      tableName: 't_mob_tasks',
      cnName: '移动协同待办单据表',
      domain: '移动端体验',
      description: '支撑 B 端移动审批、任务流转与现场巡检录入的数据表',
      sharedByMenus: [
        {
          pageId: 'mob-tasks',
          menuTitle: '协同事项',
          accessMode: 'STATE 状态流转',
          fieldMappingNote: '胶囊页签按状态筛选，支持一键通过与半屏抽屉新建事项',
        },
      ],
      columns: [
        { id: 'c_mt_id', name: 'id', dataType: 'VARCHAR(36)', nullable: false, isPrimaryKey: true, comment: '主键ID' },
        { id: 'c_mt_title', name: 'task_title', dataType: 'VARCHAR(120)', nullable: false, comment: '事项标题' },
        { id: 'c_mt_dept', name: 'owner_dept', dataType: 'VARCHAR(80)', nullable: false, comment: '发起部门' },
        { id: 'c_mt_amt', name: 'budget_amount', dataType: 'DECIMAL(12,2)', nullable: true, comment: '预算金额' },
        { id: 'c_mt_status', name: 'status', dataType: 'VARCHAR(32)', nullable: false, comment: '流转状态(待处理/已完成/已驳回)' },
        { id: 'c_mt_remark', name: 'remark', dataType: 'VARCHAR(255)', nullable: true, comment: '补充备注' },
      ],
    },
  ];

  const tableRows: Record<string, Row[]> = {
    t_mob_catalog: [
      { id: 'cat-1', item_name: '空间音频降噪耳机 Ultra', subtitle: '自适应通透 · 42h 续航', price_text: '¥1,499', tag: 'AI 硬件', spec: '星际银' },
      { id: 'cat-2', item_name: '智能会议语音转写胶囊', subtitle: '多语种实时纪要与脑图生成', price_text: '¥899', tag: '效率神器', spec: 'Pro 套装' },
      { id: 'cat-3', item_name: '极简桌面磁吸供电站', subtitle: '氮化镓 140W · 隐藏式线缆', price_text: '¥459', tag: '桌面美学', spec: '曜石黑' },
      { id: 'cat-4', item_name: '企业专属知识库订阅', subtitle: '端到端加密 · 团队多端同步', price_text: '¥99/月', tag: '云端服务', spec: '团队版' },
    ],
    t_mob_tasks: [
      { id: 'tsk-1', task_title: 'Q4 旗舰门店视觉焕新采购单', owner_dept: '品牌体验中心', budget_amount: 68500, status: '待处理', remark: '含上海静安旗舰店展陈物料' },
      { id: 'tsk-2', task_title: '华东区智能终端补货调拨申请', owner_dept: '供应链运营部', budget_amount: 124000, status: '待处理', remark: '需周五前完成出库扫描核验' },
      { id: 'tsk-3', task_title: '年度核心客户 VIP 权益升级方案', owner_dept: '商业增长部', budget_amount: 32000, status: '已完成', remark: '已完成法务与财务会签' },
    ],
  };

  const designerFolders: DesignerFolder[] = [
    { id: 'fld-mobile-app', title: '移动端主界面', parentFolderId: null },
  ];

  const tabBarSnippet = (activeKey: string) => `<MTabBar variant="floating" activeKey="${activeKey}" items={[
        { key: 'explore', title: '探索', icon: 'Sparkles', page: 'mob-explore' },
        { key: 'tasks', title: '事项', icon: 'Layers', badge: '2', page: 'mob-tasks' },
        { key: 'ai', title: '助手', icon: 'Compass', page: 'mob-assistant' },
        { key: 'mine', title: '我的', icon: 'User', page: 'mob-profile' }
      ]} />`;

  const pageSources: Record<string, string> = {
    'mob-explore': norm(`// @protoflow page: mob-explore
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title="探索首页" accent="gemini" surfaceBg="mist">
      <MTopBar title="Nova 空间" leftMode="sparkle" titleDropdown={true} rightIcon="avatar" onRightClick={() => navigate('mob-profile')} />
      <MHeroHeader mode="greeting" eyebrow="Gemini 现代视觉体验" title="你好，Alex" subtitle="兼顾 C 端消费质感与 B 端高效流转" />
      <MSearchPill placeholder="搜索精选好物、服务或灵感..." target="feed-main" showFilter={false} />
      <MBentoGrid cols={2} layout="equal" items={[
        { title: 'AI 灵感助手', subtitle: '自然语言对话与总结', icon: 'Sparkles', badge: 'NEW', tone: 'violet', onClick: () => navigate('mob-assistant') },
        { title: '协同待办流', subtitle: '2 项高优申请待确认', icon: 'Layers', badge: '2', tone: 'blue', onClick: () => navigate('mob-tasks') }
      ]} />
      <MSurface title="本季精选推荐" tone="card">
        <MFeedList
          pfId="feed-main"
          table="t_mob_catalog"
          layout="waterfall"
          titleField="item_name"
          subtitleField="subtitle"
          priceField="price_text"
          tagField="tag"
          actionText="选购"
          onItemClick={() => openDrawer('sheet-order')}
        />
      </MSurface>
      ${tabBarSnippet('explore')}
      <MBottomSheet id="sheet-order" title="选择规格与确认预订" subtitle="仅演示确认流程，不会生成订单或修改商品" size="medium">
        <MListGroup title="预订项目" items={[{ title: '商品名称', value: '{{row.item_name}}' }]} />
        <MForm pfId="mform-catalog" title="定制偏好">
          <MChipSelect label="版本规格" name="spec" options="标准套装,Pro 进阶版,企业尊享版" required={true} />
        </MForm>
        <MBottomDock mode="commerce" summaryLabel="目录价格" price="{{row.price_text}}" primaryText="确认预订" onPrimary={() => { submitForm('mform-catalog'); toast('预订演示已确认'); closeOverlay(); }} />
      </MBottomSheet>
    </MobilePage>
  );
}
`),
    'mob-tasks': norm(`// @protoflow page: mob-tasks
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title="协同事项" accent="gemini" surfaceBg="mist">
      <MTopBar title="移动协同中心" leftMode="back" rightIcon="plus" onLeftClick={() => navigate('mob-explore')} onRightClick={() => openDrawer('sheet-new-task')} />
      <MStatCard title="本周待处理总额" value="¥192,500" trend="+14.2%" trendTone="up" sparkline={true} />
      <MSearchPill placeholder="搜索事项标题或发起部门..." target="task-list-main" showFilter={false} />
      <MPillTabs variant="pill" target="task-list-main" filterField="status" items={[
        { title: '全部', value: '' },
        { title: '待处理', value: '待处理', badge: '2' },
        { title: '已完成', value: '已完成' }
      ]} />
      <MTaskList
        pfId="task-list-main"
        table="t_mob_tasks"
        titleField="task_title"
        statusField="status"
        fields={[
          { dataIndex: 'owner_dept', title: '发起部门' },
          { dataIndex: 'budget_amount', title: '预算金额', render: 'money' },
          { dataIndex: 'remark', title: '备注说明' }
        ]}
        rowActions={[
          { label: '驳回', danger: true, onClick: () => { updateRow({ status: '已驳回' }); toast('已标记为驳回', 'warning'); } },
          { label: '通过', primary: true, onClick: () => { updateRow({ status: '已完成' }); toast('已审批通过'); } }
        ]}
        onCardClick={() => openDrawer('sheet-task-detail')}
      />
      ${tabBarSnippet('tasks')}
      <MBottomSheet id="sheet-task-detail" title="事项单据详情" size="medium">
        <MListGroup title="单据核心信息" table="t_mob_tasks" />
        <MBottomDock mode="action" secondaryText="关闭" primaryText="审批通过" onSecondary={() => closeOverlay()} onPrimary={() => { updateRow({ status: '已完成' }); toast('审批已完成'); closeOverlay(); }} />
      </MBottomSheet>
      <MBottomSheet id="sheet-new-task" title="发起移动事项" size="tall">
        <MForm pfId="mform-new-task" table="t_mob_tasks">
          <MField label="事项名称" name="task_title" placeholder="请输入申请事项标题" required={true} />
          <MSheetPicker label="发起部门" name="owner_dept" options="品牌体验中心,供应链运营部,AI 平台研发部,商业增长部" required={true} />
          <MField label="申请预算(元)" name="budget_amount" inputType="amount" placeholder="0.00" />
          <MChipSelect label="初始状态" name="status" required={true} options="待处理,已完成" />
          <MField label="补充说明" name="remark" inputType="textarea" placeholder="填写背景说明..." />
        </MForm>
        <MBottomDock mode="action" secondaryText="取消" primaryText="提交申请" onSecondary={() => closeOverlay()} onPrimary={() => { submitForm('mform-new-task'); toast('新事项已创建'); closeOverlay(); }} />
      </MBottomSheet>
    </MobilePage>
  );
}
`),
    'mob-assistant': norm(`// @protoflow page: mob-assistant
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title="AI 智能助手" accent="gemini" surfaceBg="mist">
      <MTopBar title="Gemini 2.5 Pro" leftMode="back" titleDropdown={true} rightIcon="more" onLeftClick={() => navigate('mob-explore')} />
      <MChatStream assistantName="Gemini" messages={[
        { role: 'user', title: '帮我汇总当前待处理的移动事项与重点商品动态' },
        { role: 'assistant', title: '已同步工程实时数据：目前共有 2 笔待处理事项（合计 ¥192,500），其中华东区智能终端补货需在周五前完成出库。', highlight: '点击下方快捷指令可直接跳转协同中心审批，或继续追问经营细节。' }
      ]} />
      <MBentoGrid cols={2} layout="equal" items={[
        { title: '前往审批待办', subtitle: '立即处理 2 笔积压单据', icon: 'Zap', tone: 'blue', onClick: () => navigate('mob-tasks') },
        { title: '浏览精选目录', subtitle: '查看 4 款热门服务', icon: 'ShoppingBag', tone: 'emerald', onClick: () => navigate('mob-explore') }
      ]} />
      <MComposerBar placeholder="向 Gemini 提问或下达业务指令..." suggestions="总结今日经营周报,筛查超期单据,生成促销文案" docked={true} onSend={() => toast('已发送指令给智能助手')} />
    </MobilePage>
  );
}
`),
    'mob-profile': norm(`// @protoflow page: mob-profile
// @protoflow platform: mobile
export default function Page() {
  return (
    <MobilePage title="个人中心" accent="gemini" surfaceBg="mist">
      <MTopBar title="个人空间" leftMode="none" rightIcon="bell" onRightClick={() => toast('暂无新通知', 'info')} />
      <MHeroHeader mode="banner" eyebrow="PRO 尊享会员" title="Alex · 产品架构师" subtitle="已开启多端实时云同步与 AI 辅助决策" actionText="查看权益" onAction={() => openModal('dlg-vip')} />
      <MBentoGrid cols={2} layout="equal" items={[
        { title: '我的待办', subtitle: '实时联动业务表', icon: 'Layers', badge: '2', tone: 'blue', onClick: () => navigate('mob-tasks') },
        { title: '收藏清单', subtitle: '已保存 12 项灵感', icon: 'Bookmark', tone: 'violet', onClick: () => navigate('mob-explore') }
      ]} />
      <MListGroup title="偏好与通用设置" items={[
        { title: '工作空间切换', description: '当前：总部数字化空间', value: '已认证', icon: 'Compass', arrow: true },
        { title: '智能通知提醒', description: '高优单据实时推送至锁屏', value: '已开启', icon: 'Bell', arrow: true },
        { title: '数据安全与隐私', value: '端到端保护', icon: 'Shield', arrow: true }
      ]} />
      ${tabBarSnippet('mine')}
      <MDialog id="dlg-vip" title="Pro 空间权益已激活" description="当前账号支持无限次多端原型预览、同源物理表联动与 AI 实时生成。" confirmText="太棒了" />
    </MobilePage>
  );
}
`),
  };

  const designerPages: DesignerPage[] = [
    { pageId: 'mob-explore', title: '探索首页', folderId: 'fld-mobile-app', platform: 'mobile' },
    { pageId: 'mob-tasks', title: '协同事项', folderId: 'fld-mobile-app', platform: 'mobile' },
    { pageId: 'mob-assistant', title: 'AI 智能助手', folderId: 'fld-mobile-app', platform: 'mobile' },
    { pageId: 'mob-profile', title: '个人中心', folderId: 'fld-mobile-app', platform: 'mobile' },
  ];

  return {
    dbTables,
    tableRows,
    designerFolders,
    designerPages,
    pageSources,
    entryPageId: 'mob-explore',
  };
}
