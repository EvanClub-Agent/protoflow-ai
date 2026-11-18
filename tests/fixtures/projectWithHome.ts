import { createProjectPayload } from '../../src/services/projectStorage';
import type { PflowProjectMetadata } from '../../src/utils/pflowBinaryCodec';
import { generateBlankPageSource } from '../../src/proto/ai/templates';

/** A saved project with a real starting menu, for editing and compatibility tests. */
export function projectWithHome(meta: PflowProjectMetadata) {
  const payload = createProjectPayload(meta);
  const page = { pageId: 'page-home', title: '首页', folderId: 'folder-project-pages' };
  payload.stateSnapshot.designerFolders.push({ id: page.folderId, title: '项目页面', parentFolderId: null });
  payload.stateSnapshot.designerPages.push(page);
  payload.stateSnapshot.pageSources[page.pageId] = generateBlankPageSource(page);
  payload.stateSnapshot.activePageId = page.pageId;
  payload.meta.pageCount = Object.keys(payload.stateSnapshot.pageSources).length;
  return payload;
}
