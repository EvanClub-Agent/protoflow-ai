import { createProjectPayload } from './projectStorage';
import { tr } from '../i18n/runtime';
import { validateProjectPayload } from './projectValidation';
import { newId } from '../utils/identity';
import type { FigmaCompiledImport } from '../proto/figma/ir';

export function createFigmaProject(sourceName: string, parentDir: string, imported: FigmaCompiledImport) {
  const cleanName = sourceName.replace(/\.(fig|json)$/i, '').trim() || imported.documentName.trim() || 'Figma 设计稿';
  if (!parentDir.trim()) {
    throw new Error(tr('缺少工程保存目录', 'Missing project save directory'));
  }
  const projectId = newId('proj');
  const now = new Date().toISOString();
  const safeFileName = Array.from(cleanName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')).slice(0, 40).join('');
  const templateId = imported.projectMode === 'mobile' ? 'mobile_starter' : 'blank_project';

  const payload = createProjectPayload({
    projectId,
    projectName: cleanName,
    templateId,
    projectMode: imported.projectMode,
    storageDir: `${parentDir.replace(/[\\/]+$/, '')}/${projectId}/bundle`,
    fileName: `Figma-${safeFileName || 'Design'}.pflow`,
    createdAt: now,
    updatedAt: now,
    pageCount: 0,
    tableCount: 0,
    stickyCount: 0,
  });

  const { designerFolders, designerPages, pageSources } = imported;
  if (designerPages.length === 0) {
    throw new Error(tr('没有可导入的 Figma 画板页面', 'No importable Figma frame pages found'));
  }

  Object.assign(payload.stateSnapshot, {
    designerFolders,
    designerPages,
    pageSources,
    dbTables: [],
    tableRows: {},
    stickyNotes: [],
    closedLoopIssues: [],
    activePageId: designerPages[0].pageId,
  });
  payload.meta.pageCount = designerPages.length;
  payload.meta.tableCount = 0;
  payload.meta.stickyCount = 0;

  validateProjectPayload(payload);
  return payload;
}
