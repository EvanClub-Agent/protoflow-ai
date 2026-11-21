import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tr } from '../i18n/runtime';
import type { ProjectMode } from '../proto/mobile/types';
import { createProjectPayload, normalizeProjectPayload } from '../services/projectStorage';
import { validateProjectPayload } from '../services/projectValidation';
import {
  decodePflowBinary,
  encodePflowBinary,
  type PflowBinaryPayload,
  type PflowProjectMetadata,
} from '../utils/pflowBinaryCodec';
import type { LoadedWorkspace } from './workspace';

import type { AuthoringWorkspace, ActiveEditorContext, ProjectFileSummary, CreateProjectOptions, CreateProjectResult, SwitchProjectResult, MutateResult } from './authoringTypes';
export * from './authoringTypes';

const LOCK_RETRY_INTERVAL_MS = 25;
const LOCK_TIMEOUT_MS = 3000;
const MAX_LIST_PROJECTS = 100;

function computeRevision(stat: fs.Stats, bytes: Buffer): string {
  const digest = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  return `${Math.trunc(stat.mtimeMs)}-${stat.size}-${digest}`;
}

function resolveTargetPflowPath(rawPath: string, baseDir: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error(tr('工程文件路径不能为空', 'Project file path cannot be empty'));
  }
  const resolved = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(baseDir, trimmed);
  if (!resolved.toLowerCase().endsWith('.pflow')) {
    throw new Error(
      tr(
        `工程文件必须以 .pflow 结尾：${resolved}`,
        `Project file path must end with .pflow: ${resolved}`
      )
    );
  }
  return resolved;
}

function assertRegularExistingPflowFile(filePath: string): fs.Stats {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    throw new Error(tr(`找不到本地工程文件：${filePath}`, `Local project file not found: ${filePath}`));
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(
      tr(
        `指定路径不是有效的普通 .pflow 文件：${filePath}`,
        `Path is not a regular .pflow file: ${filePath}`
      )
    );
  }
  return stat;
}

function readAndNormalizeProject(filePath: string): {
  stat: fs.Stats;
  revision: string;
  payload: PflowBinaryPayload;
} {
  const stat = assertRegularExistingPflowFile(filePath);
  const bytes = fs.readFileSync(filePath);
  const revision = computeRevision(stat, bytes);
  const decoded = decodePflowBinary(bytes);
  const payload = normalizeProjectPayload(decoded);
  return { stat, revision, payload };
}

function writeFileAtomically(filePath: string, bytes: Uint8Array, existingMode?: number): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  const mode = existingMode !== undefined ? existingMode & 0o777 : 0o600;
  try {
    const fd = fs.openSync(tmpPath, 'wx', mode);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

async function withAdvisoryFileLock<T>(filePath: string, work: () => Promise<T>): Promise<T> {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = `${filePath}.mcp.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let acquired = false;

  while (!acquired) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      } finally {
        fs.closeSync(fd);
      }
      acquired = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') throw err;
      // An old mtime does not prove the owning process finished its write.
      if (Date.now() >= deadline) {
        throw new Error(
          tr(
            `等待工程文件写锁超时（${lockPath}）；请确认所有写入进程都已退出，再移除遗留锁并重试`,
            `Timed out waiting for project write lock (${lockPath}); check for active writers before removing an abandoned lock and retrying`
          )
        );
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));
    }
  }

  try {
    return await work();
  } finally {
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      // Ignore lock cleanup failure
    }
  }
}

function defaultProjectModeForTemplate(templateId: PflowProjectMetadata['templateId']): ProjectMode {
  if (templateId === 'mobile_starter') return 'mobile';
  if (templateId === 'crm_analytics') return 'hybrid';
  return 'desktop';
}

export function createLocalAuthoringWorkspace(options: {
  projectPath?: string;
  workspaceDir?: string;
}): AuthoringWorkspace {
  let currentProjectPath: string | null = options.projectPath !== undefined ? resolveTargetPflowPath(options.projectPath, process.cwd()) : null;
  const defaultWorkspaceDir = options.workspaceDir
    ? path.resolve(options.workspaceDir)
    : currentProjectPath
      ? path.dirname(currentProjectPath)
      : path.join(os.homedir(), 'AlexProjects');

  let cached: { filePath: string; revision: string; workspace: LoadedWorkspace } | null = null;
  let mutationQueue: Promise<void> = Promise.resolve();

  const enqueueMutation = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = mutationQueue.catch(() => undefined).then(fn);
    mutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  const loadPath = (filePath: string): LoadedWorkspace => {
    const stat = assertRegularExistingPflowFile(filePath);
    const bytes = fs.readFileSync(filePath);
    const revision = computeRevision(stat, bytes);
    if (cached && cached.filePath === filePath && cached.revision === revision) {
      return cached.workspace;
    }
    const decoded = decodePflowBinary(bytes);
    const payload = normalizeProjectPayload(decoded);
    const workspace: LoadedWorkspace = {
      sourceKind: 'local',
      sourceLabel: filePath,
      revision,
      payload,
      uniqueConstraintsComplete: true,
    };
    cached = { filePath, revision, workspace };
    return workspace;
  };

  return {
    mode: 'readwrite',
    canWrite: true,

    hasActiveProject(): boolean {
      return currentProjectPath !== null;
    },

    async load(): Promise<LoadedWorkspace> {
      if (!currentProjectPath) {
        throw new Error(
          tr(
            '当前会话尚未绑定 .pflow 工程文件。请先调用 protoflow_workspace（action="create_project"、"list_projects" 或 "switch_project"）打开或创建工程。',
            'No active .pflow project is loaded yet. Call protoflow_workspace (action="create_project", "list_projects", or "switch_project") first.'
          )
        );
      }
      return loadPath(currentProjectPath);
    },

    async getContext(): Promise<ActiveEditorContext> {
      if (!currentProjectPath) {
        return {
          transport: 'local_file',
          projectPath: null,
          workspaceDir: defaultWorkspaceDir,
          projectId: null,
          projectName: null,
          projectMode: null,
          revision: null,
          activePageId: null,
          selectedPfId: null,
          viewMode: null,
        };
      }
      const loaded = loadPath(currentProjectPath);
      const { meta, stateSnapshot } = loaded.payload;
      return {
        transport: 'local_file',
        projectPath: currentProjectPath,
        workspaceDir: defaultWorkspaceDir,
        projectId: meta.projectId,
        projectName: meta.projectName,
        projectMode: meta.projectMode ?? 'desktop',
        revision: loaded.revision,
        activePageId: stateSnapshot.activePageId || null,
        selectedPfId: null,
        viewMode: null,
      };
    },

    async listProjects(dirPath?: string): Promise<{ directory: string; projects: ProjectFileSummary[] }> {
      const targetDir = dirPath?.trim()
        ? path.isAbsolute(dirPath.trim())
          ? path.resolve(dirPath.trim())
          : path.resolve(defaultWorkspaceDir, dirPath.trim())
        : currentProjectPath
          ? path.dirname(currentProjectPath)
          : defaultWorkspaceDir;

      if (!fs.existsSync(targetDir)) {
        return { directory: targetDir, projects: [] };
      }
      const dirStat = fs.lstatSync(targetDir);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
        throw new Error(tr(`目录无效：${targetDir}`, `Not a valid directory: ${targetDir}`));
      }

      const entries = fs
        .readdirSync(targetDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.pflow'))
        .slice(0, MAX_LIST_PROJECTS);

      const projects: ProjectFileSummary[] = entries.map((entry) => {
        const fullPath = path.join(targetDir, entry.name);
        try {
          const stat = fs.lstatSync(fullPath);
          if (stat.isSymbolicLink() || !stat.isFile()) {
            return {
              filePath: fullPath,
              fileName: entry.name,
              size: 0,
              updatedAt: '',
              valid: false,
              error: tr('不是普通文件', 'Not a regular file'),
            };
          }
          const bytes = fs.readFileSync(fullPath);
          const payload = normalizeProjectPayload(decodePflowBinary(bytes));
          return {
            filePath: fullPath,
            fileName: entry.name,
            size: stat.size,
            updatedAt: payload.meta.updatedAt,
            projectId: payload.meta.projectId,
            projectName: payload.meta.projectName,
            projectMode: payload.meta.projectMode ?? 'desktop',
            pageCount: Object.keys(payload.stateSnapshot.pageSources).length,
            tableCount: payload.stateSnapshot.dbTables.length,
            valid: true,
          };
        } catch (err) {
          return {
            filePath: fullPath,
            fileName: entry.name,
            size: 0,
            updatedAt: '',
            valid: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      });

      projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return { directory: targetDir, projects };
    },

    async createProject(opts: CreateProjectOptions): Promise<CreateProjectResult> {
      const projectName = typeof opts.projectName === 'string' ? opts.projectName.trim() : '';
      if (!projectName) {
        throw new Error(tr('projectName 不能为空', 'projectName cannot be empty'));
      }
      const targetPath = resolveTargetPflowPath(opts.filePath, defaultWorkspaceDir);
      const templateId = opts.templateId ?? 'blank_project';
      const projectMode = opts.projectMode ?? defaultProjectModeForTemplate(templateId);

      return enqueueMutation(() =>
        withAdvisoryFileLock(targetPath, async () => {
          let existingMode: number | undefined;
          try {
            const st = fs.lstatSync(targetPath);
            if (st.isSymbolicLink() || !st.isFile()) {
              throw new Error(
                tr(
                  `目标路径存在符号链接或非常规文件，拒绝覆盖：${targetPath}`,
                  `Refusing to overwrite symlink or non-regular file at: ${targetPath}`
                )
              );
            }
            if (!opts.overwrite) {
              throw new Error(
                tr(
                  `工程文件已存在：${targetPath}（如需覆盖请显式传 overwrite: true，或改用 switch_project 打开）`,
                  `Project file already exists: ${targetPath} (pass overwrite: true to replace, or use switch_project)`
                )
              );
            }
            existingMode = st.mode;
          } catch (err) {
            if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
          }

          const now = new Date().toISOString();
          const payload = createProjectPayload({
            projectId: `proj-${crypto.randomUUID().slice(0, 12)}`,
            projectName,
            storageDir: path.dirname(targetPath),
            fileName: path.basename(targetPath),
            templateId,
            projectMode,
            createdAt: now,
            updatedAt: now,
            pageCount: 0,
            tableCount: 0,
            stickyCount: 0,
          });
          payload.meta.storageDir = path.dirname(targetPath);
          payload.meta.fileName = path.basename(targetPath);
          payload.meta.projectMode = projectMode;
          validateProjectPayload(payload);

          const bytes = encodePflowBinary(payload);
          writeFileAtomically(targetPath, bytes, existingMode);
          currentProjectPath = targetPath;
          cached = null;
          const loaded = loadPath(targetPath);
          return {
            filePath: targetPath,
            projectId: loaded.payload.meta.projectId,
            projectName: loaded.payload.meta.projectName,
            projectMode: loaded.payload.meta.projectMode ?? projectMode,
            templateId,
            revision: loaded.revision,
          };
        })
      );
    },

    async switchProject(filePath: string): Promise<SwitchProjectResult> {
      const targetPath = resolveTargetPflowPath(filePath, defaultWorkspaceDir);
      const loaded = loadPath(targetPath);
      currentProjectPath = targetPath;
      return {
        filePath: targetPath,
        projectId: loaded.payload.meta.projectId,
        projectName: loaded.payload.meta.projectName,
        projectMode: loaded.payload.meta.projectMode ?? 'desktop',
        revision: loaded.revision,
      };
    },

    async mutate<T>(
      mutator: (draft: PflowBinaryPayload, base: PflowBinaryPayload) => T | Promise<T>,
      mutateOptions?: { expectedRevision?: string; summary?: string }
    ): Promise<MutateResult<T>> {
      if (!currentProjectPath) {
        throw new Error(
          tr(
            '当前会话尚未绑定 .pflow 工程文件，无法写入。请先通过 protoflow_workspace 创建或打开工程。',
            'No active .pflow project is loaded for mutation. Create or switch to a project via protoflow_workspace first.'
          )
        );
      }
      const targetPath = currentProjectPath;

      return enqueueMutation(() =>
        withAdvisoryFileLock(targetPath, async () => {
          const { stat, revision: currentRevision, payload: base } = readAndNormalizeProject(targetPath);
          if (
            mutateOptions?.expectedRevision !== undefined &&
            mutateOptions.expectedRevision !== currentRevision
          ) {
            throw new Error(
              tr(
                `工程版本冲突（期望 ${mutateOptions.expectedRevision}，当前 ${currentRevision}）。请先重新读取最新工程后再试。`,
                `Revision conflict: expected ${mutateOptions.expectedRevision}, current ${currentRevision}. Reload the project before retrying.`
              )
            );
          }

          const draft = structuredClone(base);
          const result = await mutator(draft, base);

          if (draft.meta.projectId !== base.meta.projectId) {
            throw new Error(
              tr(
                '写入操作不允许篡改工程 projectId',
                'Mutation must not alter project meta.projectId'
              )
            );
          }

          draft.meta = {
            ...draft.meta,
            storageDir: path.dirname(targetPath),
            fileName: path.basename(targetPath),
            updatedAt: new Date().toISOString(),
            pageCount: Object.keys(draft.stateSnapshot.pageSources).length,
            tableCount: draft.stateSnapshot.dbTables.length,
            stickyCount: draft.stateSnapshot.stickyNotes.length,
          };

          validateProjectPayload(draft);
          const encoded = encodePflowBinary(draft);
          writeFileAtomically(targetPath, encoded, stat.mode);

          cached = null;
          const nextLoaded = loadPath(targetPath);
          return {
            revision: nextLoaded.revision,
            filePath: targetPath,
            changed: true,
            result,
          };
        })
      );
    },
  };
}
