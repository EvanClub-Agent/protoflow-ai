import { createProjectPayload } from './projectStorage';
import { validateProjectPayload } from './projectValidation';
import { newId } from '../utils/identity';
import type { AxureImport } from '../proto/axure/import';

export function createAxureProject(sourceName: string, parentDir: string, imported: AxureImport) {
  const name = sourceName.replace(/\.rp$/i, '');
  if (!name.trim() || !parentDir.trim()) throw new Error('缺少工程名称或保存目录');
  const projectId = newId('proj');
  const now = new Date().toISOString();
  // Use the new project ID for the on-disk directory. Repeated imports of the
  // same file are independent projects, including on case-insensitive disks.
  const fileName = Array.from(name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')).slice(0, 40).join('');
  const payload = createProjectPayload({
    projectId, projectName: name, templateId: 'blank_project', projectMode: 'desktop',
    storageDir: `${parentDir.replace(/[\\/]+$/, '')}/${projectId}/bundle`,
    fileName: `Axure-${fileName}.pflow`, createdAt: now, updatedAt: now,
    pageCount: 0, tableCount: 0, stickyCount: 0,
  });
  const { designerFolders, designerPages, pageSources } = imported;
  if (designerPages.length === 0) throw new Error('没有可导入的页面');
  Object.assign(payload.stateSnapshot, { designerFolders, designerPages, pageSources, activePageId: designerPages[0].pageId });
  payload.meta.pageCount = designerPages.length;
  validateProjectPayload(payload);
  return payload;
}
