import type { ProjectMode } from '../proto/mobile/types';
import type { PflowBinaryPayload, PflowProjectMetadata } from '../utils/pflowBinaryCodec';
import type { WorkspaceLoader } from './workspace';

export type McpServerMode = 'readonly' | 'readwrite';

export interface ActiveEditorContext {
  transport: 'local_file' | 'desktop_bridge';
  projectPath: string | null;
  workspaceDir: string | null;
  projectId: string | null;
  projectName: string | null;
  projectMode: ProjectMode | null;
  revision: string | null;
  activePageId: string | null;
  selectedPfId: string | null;
  viewMode: string | null;
}

export interface ProjectFileSummary {
  filePath: string;
  fileName: string;
  size: number;
  updatedAt: string;
  projectId?: string;
  projectName?: string;
  projectMode?: ProjectMode;
  pageCount?: number;
  tableCount?: number;
  valid: boolean;
  error?: string;
}

export interface MutateResult<T> {
  revision: string;
  filePath: string;
  changed: boolean;
  result: T;
}

export interface CreateProjectOptions {
  filePath: string;
  projectName: string;
  templateId?: PflowProjectMetadata['templateId'];
  projectMode?: ProjectMode;
  overwrite?: boolean;
}

export interface CreateProjectResult {
  filePath: string;
  projectId: string;
  projectName: string;
  projectMode: ProjectMode;
  templateId: PflowProjectMetadata['templateId'];
  revision: string;
}

export interface SwitchProjectResult {
  filePath: string;
  projectId: string;
  projectName: string;
  projectMode: ProjectMode;
  revision: string;
}

export interface AuthoringWorkspace extends WorkspaceLoader {
  readonly mode: McpServerMode;
  readonly canWrite: boolean;
  readonly transport?: ActiveEditorContext['transport'];
  capturePreview?(options: import('./capturePreview').CaptureOptions): Promise<import('./capturePreview').CaptureResult>;
  hasActiveProject(): boolean;
  getContext(): Promise<ActiveEditorContext>;
  listProjects(dirPath?: string): Promise<{ directory: string; projects: ProjectFileSummary[] }>;
  createProject(options: CreateProjectOptions): Promise<CreateProjectResult>;
  switchProject(filePath: string): Promise<SwitchProjectResult>;
  mutate<T>(
    mutator: (draft: PflowBinaryPayload, base: PflowBinaryPayload) => T | Promise<T>,
    options?: { expectedRevision?: string; summary?: string }
  ): Promise<MutateResult<T>>;
}

export function isAuthoringWorkspace(loader: WorkspaceLoader): loader is AuthoringWorkspace {
  return (
    typeof (loader as AuthoringWorkspace).hasActiveProject === 'function' &&
    typeof (loader as AuthoringWorkspace).mutate === 'function' &&
    typeof (loader as AuthoringWorkspace).getContext === 'function'
  );
}
