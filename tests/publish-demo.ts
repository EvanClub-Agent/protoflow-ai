import { createProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { SITEMAP_TREE, useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';

export function createPublishDemo() {
  loadProjectFromBinaryPayload(createProjectPayload({ projectId: 'protoflow-publishing-demo-v1', projectName: '产品需求评审 · 在线原型演示', storageDir: '', fileName: 'demo.pflow', templateId: 'blank_project', createdAt: '2026-10-30', updatedAt: '2026-10-30', pageCount: 0, tableCount: 0, stickyCount: 0 }));
  usePageStore.setState({ sitemapBase: structuredClone(SITEMAP_TREE), designerFolders: [], designerPages: [{ pageId: 'page-home', title: '需求评审工作台', folderId: 'folder-base-data' }] });
  useProtoStore.setState({ dbTables: [{ id: 'review-items', tableName: 'review_items', cnName: '评审需求', domain: '基础资料域 (MDM)', description: '在线原型交互演示数据', sharedByMenus: [], columns: [{ id: 'col-id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '需求标识' }, { id: 'col-title', name: 'title', dataType: 'VARCHAR(128)', nullable: false, comment: '需求标题' }, { id: 'col-priority', name: 'priority', dataType: 'VARCHAR(32)', nullable: false, comment: '优先级' }] }] });
  usePageStore.setState({ tableRows: { 'review-items': [{ id: 'review-1', title: '支持一键发布原型并生成链接', priority: '高' }, { id: 'review-2', title: '浏览者通过密码访问评审内容', priority: '高' }, { id: 'review-3', title: '更新设计时沿用原有分享链接', priority: '中' }] } });
  usePageStore.getState().setPageSource('page-home', `export default function Page(){return <Page pfId="root" title="需求评审工作台" description="这是由 Electron 设计内容发布生成的在线原型。试试新增需求、切换页面，或重置演示。">
    <Card pfId="intro" title="让设计与评审在同一页面发生"><Text pfId="intro-text">本地设计 · 在线分享 · 即时演示</Text><Toolbar pfId="toolbar"><Button pfId="add" type="primary" onClick={()=>{openModal('add-review');}}>新增评审需求</Button><Button pfId="next" onClick={()=>{navigate('share-overview');}}>查看发布说明</Button></Toolbar></Card>
    <Card pfId="list-card" title="当前评审需求"><Table pfId="review-table" table="review-items" rowKey="id" pageSize={10} columns={[{dataIndex:'title',title:'需求标题'},{dataIndex:'priority',title:'优先级'}]}/></Card>
    <Modal pfId="modal" id="add-review" title="新增评审需求" footer={false}><Form pfId="review-form" table="review-items" cols={1}><Input pfId="input-title" name="title" label="需求标题" required={true}/><Input pfId="input-priority" name="priority" label="优先级" required={true}/></Form><Toolbar pfId="modal-tools"><Button pfId="cancel" onClick={()=>{closeOverlay();}}>取消</Button><Button pfId="submit" type="primary" onClick={()=>{submitForm('review-form');closeOverlay();toast('已保存到本次演示');}}>保存需求</Button></Toolbar></Modal>
  </Page>;}`);
  usePageStore.getState().createDesignerPage({ pageId: 'share-overview', title: '发布说明', folderId: 'folder-base-data' }, `export default function Page(){return <Page pfId="overview-root" title="发布说明"><Card pfId="overview-card" title="从本地原型到在线评审"><Text pfId="overview-text">分享链接展示发布时的设计快照。更新发布后链接不变。浏览者的操作只保留在自己的页面里，点击重置演示即可恢复。</Text><Button pfId="back" type="primary" onClick={()=>{navigate('page-home');}}>返回评审工作台</Button></Card></Page>;}`);
  usePageStore.getState().renameDesignerPage('page-home', '需求评审工作台');
  useProtoStore.setState({ stickyNotes: [
    { id: 'demo-note-table', pageId: 'page-home', targetWidgetId: 'review-table', targetWidgetName: '当前评审需求表格', index: 1, text: '展示本次评审的全部需求。\n新增需求后立即更新列表；演示数据只保留在当前浏览器页面中。', active: true, compiledRule: '' },
    { id: 'demo-note-form', pageId: 'page-home', targetWidgetId: 'review-form', targetWidgetName: '新增需求表单', index: 2, text: '需求标题与优先级为必填项。提交成功后关闭弹窗，并提示保存成功。', active: true, compiledRule: '' },
  ] });
  const settings = usePageStore.getState().createDesignerFolder('系统配置', null);
  const publishing = usePageStore.getState().createDesignerFolder('发布管理', settings.id);
  usePageStore.getState().createDesignerFolder('通知设置', settings.id);
  usePageStore.getState().moveSitemapItem({ kind: 'page', id: 'share-overview' }, publishing.id, useProtoStore.getState().currentProjectMeta.projectId);
  return createPublishedSnapshot('page-home');
}
