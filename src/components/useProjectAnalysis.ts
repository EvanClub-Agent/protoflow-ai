import { useMemo } from 'react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { analyzeProject } from '../services/projectAnalysis';

export function useProjectAnalysis() {
  const project=useProtoStore(), pages=usePageStore();
  const analysis=useMemo(()=>analyzeProject({...project,...pages}),[
    project.currentProjectMeta.projectId,project.dbTables,project.stickyNotes,pages.pageSources,pages.designerPages,pages.designerFolders,pages.sitemapBase,pages.sitemapOverrides,
  ]);
  return {project,pages,analysis};
}
