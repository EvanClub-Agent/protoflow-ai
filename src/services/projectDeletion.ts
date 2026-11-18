import type { PflowProjectMetadata } from '../utils/pflowBinaryCodec';
import { useProtoStore } from '../store/useProtoStore';
import { useHermesStore } from '../store/useHermesStore';
import { forgetDeletedProject, prepareProjectDeletion, finishProjectDeletion } from './projectStorage';

export interface ProjectTrashApi {
  trashProject?: (input: { projectId: string; dirPath: string; fileName: string }) => Promise<{ deleted: boolean; missing: boolean }>;
}
export function projectTrashApi() {
  return (window as unknown as { protoflowDesktop?: ProjectTrashApi }).protoflowDesktop;
}
export async function deleteProject(meta: PflowProjectMetadata) {
  const current = useProtoStore.getState().recentProjects.find(p => p.projectId === meta.projectId);
  if (!current || current.storageDir !== meta.storageDir || current.fileName !== meta.fileName) throw new Error('项目记录已变化，请重新选择删除');
  const api = projectTrashApi();
  if (!api?.trashProject) throw new Error('请在桌面应用中删除本地工程；浏览器没有文件删除权限');
  if (useHermesStore.getState().runningProjects[meta.projectId]) throw new Error('该项目正在执行 AI 任务，请先停止生成后再删除');
  await prepareProjectDeletion(meta.projectId);
  let deleted = false;
  try {
    const result = await api.trashProject({ projectId: meta.projectId, dirPath: meta.storageDir, fileName: meta.fileName });
    if (result.deleted !== true && result.missing !== true) throw new Error('工程文件未移到废纸篓，项目记录已保留');
    deleted = true;
    const recordWarning = forgetDeletedProject(meta.projectId);
    return { ...result, recordWarning };
  } finally { finishProjectDeletion(meta.projectId, deleted); }
}
