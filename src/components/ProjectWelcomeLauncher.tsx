import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  FolderOpen,
  Plus,
  Search,
  FileCode2,
  Database,
  Pin,
  Layers,
  CheckCircle2,
  ArrowRight,
  Download,
  FolderPlus,
  AlertCircle,
  Bot,
  Trash2,
  ArrowUpCircle,
  Smartphone,
  Monitor,
} from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import type { ProjectMode } from '../proto/mobile/types';
import { captureProjectPayload, createProjectPayload, loadProjectFromBinaryPayload, openRecentProject, readRecentProject, restoreRecentProjects, flushProjectChanges } from '../services/projectStorage';
import { newId } from '../utils/identity';
import { useHermesStore } from '../store/useHermesStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { HermesEnginePanel } from './HermesEngineModal';
import { AppUpdatePanel } from './AppUpdateModal';
import { AccountButton } from './AccountButton';
import { AlexLogo } from './AlexLogo';
import { DeleteConfirmation } from './DeleteConfirmation';
import { deleteProject, projectTrashApi } from '../services/projectDeletion';
import {
  encodePflowBinary,
  decodePflowBinary,
  generateUnpackedGitFiles,
  writeUnpackedGitTreeToDirectoryHandle,
  RecursiveDirectoryHandle,
  PflowProjectMetadata,
} from '../utils/pflowBinaryCodec';

export const ProjectWelcomeLauncher: React.FC<{
  /** Desktop app: the launcher fills its own compact native window (no outer backdrop / fake window chrome) */
  standalone?: boolean;
}> = ({ standalone = false }) => {
  const {
    recentProjects,
    setWelcomeScreenOpen,
    isProjectClosed,
  } = useProtoStore();

  const [activeNav, setActiveNav] = useState<'projects' | 'new_project' | 'hermes_engine' | 'app_update'>(() => {
    if (typeof window !== 'undefined') {
      const wt = new URLSearchParams(window.location.search).get('welcomeTab');
      if (wt === 'new_project' || wt === 'hermes_engine' || wt === 'projects' || wt === 'app_update') return wt;
    }
    return 'projects';
  });
  const {
    status: hermesStatus,
    currentVersion: hermesVer,
    updateAvailable: hermesUpdate,
  } = useHermesStore();
  const {
    currentVersion: appVersion,
    hasUpdate: appHasUpdate,
    latestRelease: appLatestRelease,
  } = useUpdateStore();
  const [searchText, setSearchText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PflowProjectMetadata | null>(null);

  // New Project Form State
  const [newProjName, setNewProjName] = useState('未命名原型项目');
  const [storageDirPath, setStorageDirPath] = useState('./AlexProjects');
  const [selectedDirHandle, setSelectedDirHandle] =
    useState<RecursiveDirectoryHandle | null>(null);
  const [projectMode, setProjectMode] = useState<ProjectMode>('desktop');
  const [templateId, setTemplateId] = useState<
    'saas_inventory' | 'crm_analytics' | 'blank_project' | 'mobile_starter'
  >('blank_project');
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    restoreRecentProjects();
    const desktopBridge = (
      window as unknown as {
        protoflowDesktop?: { defaultProjectsDirectory?: () => Promise<string> };
      }
    ).protoflowDesktop;
    void desktopBridge?.defaultProjectsDirectory?.().then((dir) => {
      if (typeof dir === 'string' && dir.trim()) setStorageDirPath(dir.trim());
    }).catch(() => {});
  }, []);
  const [isWorking, setIsWorking] = useState(false);
  const handleOpenRecentProject = async (projectId: string) => {
    if (isWorking) return;
    setIsWorking(true);
    try { await openRecentProject(projectId); }
    catch (error) { setStatusBanner({ type: 'error', text: String(error) }); }
    finally { setIsWorking(false); }
  };

  // 1. Choose a real computer directory (Electron IPC or Browser showDirectoryPicker)
  const handleChooseDirectory = async () => {
    const desktopBridge = (
      window as unknown as {
        protoflowDesktop?: {
          selectDirectory?: () => Promise<{
            selected: boolean;
            directoryPath?: string;
          }>;
        };
      }
    ).protoflowDesktop;

    try {
      if (desktopBridge?.selectDirectory) {
        const res = await desktopBridge.selectDirectory();
        if (res.selected && res.directoryPath) {
          setStorageDirPath(res.directoryPath);
          setStatusBanner({
            type: 'success',
            text: `已选择保存目录：${res.directoryPath}`,
          });
        }
        return;
      }

      const winWithPicker = window as unknown as {
        showDirectoryPicker?: (opts?: {
          mode?: string;
        }) => Promise<RecursiveDirectoryHandle>;
      };

      if (winWithPicker.showDirectoryPicker) {
        const dirHandle = await winWithPicker.showDirectoryPicker({
          mode: 'readwrite',
        });
        setSelectedDirHandle(dirHandle);
        setStorageDirPath(dirHandle.name);
        setStatusBanner({
          type: 'success',
          text: `已选择保存目录：${dirHandle.name}`,
        });
      }
    } catch {
      // User cancelled directory picker
    }
  };

  // Helper to write project file to disk
  const writeBinaryToDisk = async (
    meta: PflowProjectMetadata,
    bytes: Uint8Array
  ): Promise<string> => {
    const desktopBridge = (
      window as unknown as {
        protoflowDesktop?: {
          writeBinaryProject?: (p: {
            dirPath: string;
            fileName: string;
            binaryBytes: Uint8Array;
          }) => Promise<{ saved: boolean; filePath?: string }>;
        };
      }
    ).protoflowDesktop;

    if (desktopBridge?.writeBinaryProject) {
      const res = await desktopBridge.writeBinaryProject({
        dirPath: meta.storageDir,
        fileName: meta.fileName,
        binaryBytes: bytes,
      });
      if (!res.saved) throw new Error('已取消保存');
      if (!res.filePath) throw new Error('保存结果缺少文件路径');
      return res.filePath;
    }

    if (selectedDirHandle) {
      const fileHandle = await selectedDirHandle.getFileHandle(meta.fileName, {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return `${meta.storageDir}/${meta.fileName}`;
    }

    const blob = new Blob([bytes.buffer as ArrayBuffer], {
      type: 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = meta.fileName;
    a.click();
    URL.revokeObjectURL(url);
    return `${meta.storageDir}/${meta.fileName}`;
  };

  // Save and display exactly the same initialized snapshot.
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isWorking) return;
    setIsWorking(true);
    try {
      await flushProjectChanges();
      const name = newProjName.trim();
      if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('项目名称不能为空或包含路径分隔符');
      const parentDir = storageDirPath.trim().replace(/[\\/]+$/, '');
      if (!parentDir) throw new Error('请选择保存位置');
      const rootDir = `${parentDir}/${name}`;
      const now = new Date().toISOString();
      const payload = createProjectPayload({
        projectId: newId('proj'), projectName: name, storageDir: `${rootDir}/bundle`,
        fileName: `${name}.pflow`, templateId, projectMode, createdAt: now, updatedAt: now,
        pageCount: 0, tableCount: 0, stickyCount: 0,
      });
      const bytes = encodePflowBinary(payload);
      const files = generateUnpackedGitFiles(payload);
      const desktop = (window as unknown as { protoflowDesktop?: {
        writeUnpackedGitTree?: (p: { rootDirPath: string; files: typeof files; binaryBundle: { fileName: string; binaryBytes: Uint8Array } }) => Promise<{ saved: boolean }>;
      } }).protoflowDesktop;
      if (desktop?.writeUnpackedGitTree) {
        const result = await desktop.writeUnpackedGitTree({ rootDirPath: rootDir, files, binaryBundle: { fileName: payload.meta.fileName, binaryBytes: bytes } });
        if (!result.saved) return;
      } else if (selectedDirHandle) {
        const projectDir = await selectedDirHandle.getDirectoryHandle(name, { create: true });
        await writeUnpackedGitTreeToDirectoryHandle(projectDir, files, { fileName: payload.meta.fileName, bytes });
      } else {
        await writeBinaryToDisk(payload.meta, bytes);
      }
      loadProjectFromBinaryPayload(payload);
    } catch (error) {
      setStatusBanner({ type: 'error', text: `创建项目失败：${String(error)}` });
    } finally { setIsWorking(false); }
  };

  // 3. Open Existing Project File from Computer Disk
  const handleOpenBinaryFileClick = async () => {
    const desktopBridge = (
      window as unknown as {
        protoflowDesktop?: {
          openBinaryProject?: () => Promise<{
            opened: boolean;
            dirPath?: string;
            fileName?: string;
            binaryBytes?: Uint8Array;
          }>;
        };
      }
    ).protoflowDesktop;

    if (desktopBridge?.openBinaryProject) {
      if (isWorking) return;
      setIsWorking(true);
      try {
        await flushProjectChanges();
        const res = await desktopBridge.openBinaryProject();
        if (res.opened && res.binaryBytes) {
          const decoded = decodePflowBinary(res.binaryBytes);
          loadProjectFromBinaryPayload(decoded, res.dirPath, res.fileName);
        }
      } catch (error) {
        setStatusBanner({ type: 'error', text: `打开工程失败：${String(error)}` });
      } finally { setIsWorking(false); }
      return;
    }

    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await flushProjectChanges();
      const arrayBuffer = await file.arrayBuffer();
      const decoded = decodePflowBinary(arrayBuffer);
      loadProjectFromBinaryPayload(
        decoded,
        undefined,
        file.name
      );
    } catch (error) {
      setStatusBanner({
        type: 'error',
        text: `解析项目文件 ${file.name} 失败：${String(error)}`,
      });
    } finally {
      e.target.value = '';
    }
  };

  const filteredRecent = recentProjects.filter(
    (p) =>
      p.projectName.toLowerCase().includes(searchText.toLowerCase()) ||
      p.fileName.toLowerCase().includes(searchText.toLowerCase()) ||
      p.storageDir.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <div
      className={
        standalone
          ? 'fixed inset-0 z-50 bg-white flex select-none'
          : 'fixed inset-0 z-50 bg-slate-50 backdrop-blur-md flex items-center justify-center p-4 select-none'
      }
    >
      {/* Hidden File Input for Opening Local Project Files */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pflow,.bin,.json"
        onChange={handleFileInputChange}
        className="hidden"
      />

      <div
        className={
          standalone
            ? 'w-full h-full bg-white flex flex-col overflow-hidden'
            : 'w-full max-w-[940px] h-[620px] rounded-2xl bg-white border border-slate-300 shadow-2xl flex flex-col overflow-hidden'
        }
      >
        {/* Top Window Title Bar */}
        {(() => {
          const desktopBridge =
            typeof window !== 'undefined'
              ? (window as unknown as { protoflowDesktop?: { isElectron?: boolean; platform?: string } })
                  .protoflowDesktop
              : undefined;
          const hasMacTrafficLights = Boolean(
            standalone && desktopBridge?.isElectron && desktopBridge?.platform === 'darwin'
          );
          return (
            <div
              className={`h-10 pr-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0 ${
                hasMacTrafficLights ? 'pl-[84px]' : 'pl-4'
              }`}
              style={hasMacTrafficLights ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined}
            >
              <div className="flex items-center gap-2">
                {!standalone && (
                  <>
                    <span className="w-3 h-3 rounded-full bg-rose-500/90 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-amber-500/90 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500/90 inline-block" />
                  </>
                )}
                <AlexLogo size={18} className={`${standalone ? '' : 'ml-1.5 '}rounded-md shadow-2xs`} />
                <span className="text-xs font-bold text-slate-700">
                  Alex
                </span>
                <span className="text-[11px] text-slate-400">
                  AI 原型设计与数据建模工作台
                </span>
              </div>

              <div className="flex items-center gap-3"><AccountButton />
              <button
                type="button"
                onClick={() => setWelcomeScreenOpen(false)}
                disabled={isProjectClosed || isWorking}
                style={hasMacTrafficLights ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : undefined}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer transition disabled:opacity-40"
              >
                进入工作台 →
              </button>
              </div>
            </div>
          );
        })()}

        {/* Main Split Body: Left Sidebar + Right Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Navigation Sidebar */}
          <aside className="w-56 bg-slate-50 border-r border-slate-200 p-4 flex flex-col justify-between shrink-0">
            <div className="space-y-5">
              {/* Brand Identity */}
              <div className="flex items-center gap-2.5 px-1">
                <AlexLogo size={36} className="rounded-xl shadow-xs" />
                <div>
                  <div className="text-sm font-extrabold text-slate-900 tracking-tight">
                    Alex
                  </div>
                  <div className="text-[11px] text-slate-500">
                    原型 · 数据表 · AI 协同
                  </div>
                </div>
              </div>

              {/* Navigation Items */}
              <nav className="space-y-1 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveNav('projects')}
                  className={`w-full text-left px-3 py-2.5 rounded-xl font-semibold flex items-center justify-between transition cursor-pointer ${
                    activeNav === 'projects'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <FolderOpen className="w-4 h-4" />
                    <span>项目列表</span>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      activeNav === 'projects'
                        ? 'bg-black/20 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {recentProjects.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveNav('new_project')}
                  className={`w-full text-left px-3 py-2.5 rounded-xl font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                    activeNav === 'new_project'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <FolderPlus className="w-4 h-4" />
                  <span>新建项目</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveNav('hermes_engine')}
                  className={`w-full text-left px-3 py-2.5 rounded-xl font-semibold flex items-center justify-between transition cursor-pointer ${
                    activeNav === 'hermes_engine'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Bot className="w-4 h-4" />
                    <span>AI 管理中心</span>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      activeNav === 'hermes_engine'
                        ? 'bg-black/20 text-white'
                        : hermesStatus === 'running'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {hermesStatus === 'running'
                      ? hermesUpdate
                        ? '可升级'
                        : hermesVer
                      : '未启用'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveNav('app_update')}
                  className={`w-full text-left px-3 py-2.5 rounded-xl font-semibold flex items-center justify-between transition cursor-pointer ${
                    activeNav === 'app_update'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <ArrowUpCircle className="w-4 h-4" />
                    <span>版本更新</span>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      activeNav === 'app_update'
                        ? 'bg-black/20 text-white'
                        : appHasUpdate
                        ? 'bg-rose-100 text-rose-700 font-bold'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {appHasUpdate && appLatestRelease
                      ? `新 v${appLatestRelease.version}`
                      : `v${appVersion}`}
                  </span>
                </button>
              </nav>
            </div>

            {/* Bottom Compact Core Capabilities Summary */}
            <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1 text-[11px] text-slate-500">
              <div className="font-semibold text-slate-800">核心生产力工作流</div>
              <div>• 可视化画布 + 右侧 AI 连续对话</div>
              <div>• 多菜单共享 ER 数据库模型</div>
              <div>• 需求便签与闭环巡检</div>
            </div>
          </aside>

          {/* Right Main Content Area */}
          <div className="flex-1 flex flex-col overflow-hidden bg-white">
            {/* Status Banner if any */}
            {statusBanner && (
              <div
                className={`px-4 py-2 text-xs font-medium flex items-center justify-between border-b ${
                  statusBanner.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : statusBanner.type === 'error'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{statusBanner.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setStatusBanner(null)}
                  className="text-[11px] underline cursor-pointer"
                >
                  关闭
                </button>
              </div>
            )}

            {/* ===============================================================
                TAB 1: PROJECTS LIST
               =============================================================== */}
            {activeNav === 'projects' && (
              <div className="flex-1 flex flex-col overflow-hidden p-6 space-y-4">
                {/* Search + Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                  <search className="relative flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      aria-label="搜索项目名称"
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder="搜索项目名称..."
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-500"
                    />
                  </search>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleOpenBinaryFileClick}
                      className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
                      <span>打开本地项目...</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveNav('new_project')}
                      className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer transition"
                    >
                      <Plus className="w-4 h-4" />
                      <span>新建项目</span>
                    </button>
                  </div>
                </div>

                {/* Project Cards List */}
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                  {filteredRecent.length === 0 && <p className="py-8 text-center text-sm text-slate-500">暂无最近项目，请新建项目或打开本地工程文件。</p>}
                  {filteredRecent.map((proj, idx) => (
                    <div
                      key={proj.projectId}
                      onClick={() => void handleOpenRecentProject(proj.projectId)}
                      className={`p-4 rounded-xl border transition cursor-pointer flex items-center justify-between gap-4 ${
                        idx === 0
                          ? 'bg-blue-50/40 border-blue-300 hover:border-blue-400 shadow-2xs'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start gap-3.5 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${
                            idx === 0
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {proj.projectName.slice(0, 1)}
                        </div>

                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-900">
                              {proj.projectName}
                            </span>
                            {idx === 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">
                                最近打开
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                            <span className="flex items-center gap-1">
                              <FileCode2 className="w-3 h-3 text-blue-600" />
                              {proj.pageCount} 个页面
                            </span>
                            <span className="flex items-center gap-1">
                              <Database className="w-3 h-3 text-emerald-600" />
                              {proj.tableCount} 张数据表
                            </span>
                            <span className="flex items-center gap-1">
                              <Pin className="w-3 h-3 text-amber-600" />
                              {proj.stickyCount} 条便签
                            </span>
                            <span className="text-slate-400">
                              更新于 {proj.updatedAt}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-2 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button type="button" disabled={isWorking} aria-label={`删除项目${proj.projectName}`} title="删除项目并将工程文件移到废纸篓" onClick={() => setDeleteTarget(proj)} className="flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={12} />删除</button>
                        <button
                          type="button"
                          disabled={isWorking}
                          onClick={async () => {
                            try {
                              const payload = useProtoStore.getState().currentProjectMeta.projectId === proj.projectId
                                ? captureProjectPayload() : await readRecentProject(proj.projectId);
                              const savedPath = await writeBinaryToDisk(payload.meta, encodePflowBinary(payload));
                              setStatusBanner({ type: 'success', text: `已导出项目备份：${savedPath}` });
                            } catch (error) { setStatusBanner({ type: 'error', text: String(error) }); }
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                          title="导出项目备份文件"
                        >
                          <Download className="w-3 h-3 text-slate-500" />
                          <span>导出备份</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleOpenRecentProject(proj.projectId)}
                          disabled={isWorking}
                          className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <span>打开项目</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===============================================================
                TAB 2: NEW PROJECT (CLEAN & STREAMLINED)
               =============================================================== */}
            {activeNav === 'new_project' && (
              <form
                onSubmit={handleCreateProject}
                className="flex-1 overflow-y-auto p-6 space-y-5 flex flex-col justify-between"
              >
                <div className="space-y-5">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">新建项目</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      填写项目名称并选择起点模板，即可进入原型画布与数据库设计工作台
                    </p>
                  </div>

                  {/* Project Name & Location */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="new-project-name" className="text-xs font-semibold text-slate-700 block">
                        项目名称
                      </label>
                      <input
                        id="new-project-name"
                        name="projectName"
                        type="text"
                        required
                        value={newProjName}
                        onChange={(e) => setNewProjName(e.target.value)}
                        placeholder="例如：云仓电商进销存系统"
                        className="w-full px-3 py-2 text-xs rounded-xl bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-500 user-invalid:border-rose-600"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="new-project-dir" className="text-xs font-semibold text-slate-700 block">
                        保存位置
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id="new-project-dir"
                          name="storageDir"
                          type="text"
                          value={storageDirPath}
                          onChange={(e) => setStorageDirPath(e.target.value)}
                          className="flex-1 px-3 py-2 text-xs font-mono rounded-xl bg-slate-50 border border-slate-300 text-slate-700 focus:outline-none focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={handleChooseDirectory}
                          className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-medium flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
                          <span>浏览...</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Project Terminal Orientation */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-700 block">
                      选择工程终端形态（进入工作台后仍可按页面自由新建 PC 或移动页）
                    </label>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      {[
                        {
                          mode: 'desktop' as const,
                          title: 'PC 管理系统',
                          desc: '面向中后台管理系统，提供宽屏栅格、多列查询与业务表格物料',
                          icon: Monitor,
                          defaultTpl: 'blank_project' as const,
                        },
                        {
                          mode: 'mobile' as const,
                          title: '移动端应用 (C端/B端)',
                          desc: '现代移动设计语言，iPhone 真机视口 + 专属触控物料',
                          icon: Smartphone,
                          defaultTpl: 'mobile_starter' as const,
                        },
                        {
                          mode: 'hybrid' as const,
                          title: 'PC + 移动多端协同',
                          desc: '同一工程同时设计后台管理端与移动端，共用物理数据库表实时联动',
                          icon: Layers,
                          defaultTpl: 'mobile_starter' as const,
                        },
                      ].map((item) => {
                        const defaultNames = new Set(['未命名原型项目', '云仓电商进销存系统', 'CRM 销售数据看板', 'Nova 智能移动应用']);
                        const active = projectMode === item.mode;
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.mode}
                            type="button"
                            onClick={() => {
                              setProjectMode(item.mode);
                              setTemplateId(item.defaultTpl);
                              if (defaultNames.has(newProjName)) {
                                setNewProjName(item.mode === 'desktop' ? '未命名原型项目' : 'Nova 智能移动应用');
                              }
                            }}
                            className={`text-left p-3 rounded-xl border transition cursor-pointer space-y-1 ${
                              active
                                ? 'bg-blue-50/70 border-blue-500 ring-2 ring-blue-500/15'
                                : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 font-bold text-slate-900">
                              <Icon className={`w-3.5 h-3.5 ${active ? 'text-blue-600' : 'text-slate-500'}`} />
                              <span>{item.title}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-relaxed">{item.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Project Template Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-700 block">
                      选择起点模板
                    </label>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      {(projectMode === 'mobile'
                        ? [
                            {
                              id: 'blank_project' as const,
                              title: '空白移动项目',
                              desc: '从零开始创建移动端页面，或交给项目 AI 规划整套 App / 小程序。',
                              badge: '从零开始',
                              suggestedName: '未命名原型项目',
                            },
                            {
                              id: 'mobile_starter' as const,
                              title: '现代移动应用样板',
                              desc: '预置 C端探索瀑布流、B端协同待办、AI 对话助手、个人中心与 2 张物理表',
                              badge: '推荐样板',
                              suggestedName: 'Nova 智能移动应用',
                            },
                          ]
                        : projectMode === 'hybrid'
                        ? [
                            {
                              id: 'blank_project' as const,
                              title: '空白多端项目',
                              desc: '自由混排 PC 后台页面与移动端页面，共用同一套工程数据表。',
                              badge: '从零开始',
                              suggestedName: '未命名原型项目',
                            },
                            {
                              id: 'mobile_starter' as const,
                              title: 'PC 后台 + 移动协同样板',
                              desc: '同时包含 PC 电商供应链管理后台与现代移动端页面，演示跨端共表',
                              badge: '多端样板',
                              suggestedName: 'Nova 智能移动应用',
                            },
                            {
                              id: 'saas_inventory' as const,
                              title: 'SaaS 电商进销存样板',
                              desc: '以 PC 进销存后台为起点，随时可在目录中新增配套移动端审批/扫码页',
                              badge: '后台起点',
                              suggestedName: '云仓电商进销存系统',
                            },
                          ]
                        : [
                            {
                              id: 'blank_project' as const,
                              title: '空白项目',
                              desc: '没有预设目录或页面。可以自己创建，也可以交给项目 AI 规划。',
                              badge: '从零开始',
                              suggestedName: '未命名原型项目',
                            },
                            {
                              id: 'saas_inventory' as const,
                              title: 'SaaS 电商进销存后台',
                              desc: '含供应商准入、采购订单、到货入库主子表联动、4 张共表模型与需求便签示例',
                              badge: '推荐样板',
                              suggestedName: '云仓电商进销存系统',
                            },
                            {
                              id: 'crm_analytics' as const,
                              title: 'CRM 销售数据看板',
                              desc: '预置月度业绩折线图、大区 ARR 柱状图与企业客户商机 CRUD 台账',
                              badge: '图表与台账',
                              suggestedName: 'CRM 销售数据看板',
                            },
                          ]
                      ).map((tpl) => {
                        const defaultNames = new Set(['未命名原型项目', '云仓电商进销存系统', 'CRM 销售数据看板', 'Nova 智能移动应用']);
                        const isSelected = templateId === tpl.id;
                        return (
                          <div
                            key={tpl.id}
                            onClick={() => {
                              setTemplateId(tpl.id);
                              if (defaultNames.has(newProjName)) setNewProjName(tpl.suggestedName);
                            }}
                            className={`p-3.5 rounded-xl border transition cursor-pointer space-y-1.5 ${
                              isSelected
                                ? 'bg-blue-50/60 border-blue-500 ring-2 ring-blue-500/15'
                                : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-900">{tpl.title}</span>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                  isSelected
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {tpl.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                              {tpl.desc}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Bottom Submit Bar */}
                <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setActiveNav('projects')}
                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isWorking}
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>创建并进入工作台</span>
                  </button>
                </div>
              </form>
            )}

            {/* ===============================================================
                TAB 3: HERMES AGENT ENGINE MANAGER
               =============================================================== */}
            {activeNav === 'hermes_engine' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <HermesEnginePanel embedded />
              </div>
            )}

            {/* ===============================================================
                TAB 4: DESKTOP APP VERSION UPDATE CENTER
               =============================================================== */}
            {activeNav === 'app_update' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <AppUpdatePanel embedded />
              </div>
            )}
          </div>
        </div>
      </div>
      {deleteTarget && <DeleteConfirmation title="删除项目" confirmLabel="移到废纸篓并删除" disabled={!projectTrashApi()?.trashProject} onClose={() => setDeleteTarget(null)} onConfirm={async () => {
        setIsWorking(true);
        try {
          const result = await deleteProject(deleteTarget);
          setStatusBanner({ type: result.recordWarning ? 'info' : 'success', text: result.recordWarning || (result.missing ? '工程文件已不存在，已清理项目记录。' : '工程文件已移到废纸篓，项目记录已删除。') });
        } finally { setIsWorking(false); }
      }}>
        <p>确认删除 <strong className="text-slate-900">{deleteTarget.projectName}</strong>？</p>
        <p className="break-all rounded-lg bg-slate-50 px-3 py-2 text-xs">{deleteTarget.storageDir}/{deleteTarget.fileName}</p>
        <p>本地工程文件会移到系统废纸篓，并从项目列表移除。误删时可从废纸篓恢复，再重新打开工程。</p>
        {deleteTarget.projectId === useProtoStore.getState().currentProjectMeta.projectId && !isProjectClosed && <p className="text-xs text-rose-600">这是当前打开的项目，会先保存最新修改，再移到废纸篓并关闭工作台。</p>}
        <p className="text-xs text-slate-500">单独导出的文件、项目目录中的其他文件和已发布链接会保留。</p>
        {!projectTrashApi()?.trashProject && <p className="text-xs text-amber-700">请在桌面应用中操作。更新后如未出现删除能力，请重启桌面应用。</p>}
      </DeleteConfirmation>}
    </div>
  );
};
