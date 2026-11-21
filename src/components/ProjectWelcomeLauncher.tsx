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
import { LanguageSwitch } from './LanguageSwitch';
import { AlexLogo } from './AlexLogo';
import { DeleteConfirmation } from './DeleteConfirmation';
import { deleteProject, projectTrashApi } from '../services/projectDeletion';
import { useI18n } from '../i18n';
import {
  encodePflowBinary,
  decodePflowBinary,
  generateUnpackedGitFiles,
  writeUnpackedGitTreeToDirectoryHandle,
  RecursiveDirectoryHandle,
  PflowProjectMetadata,
} from '../utils/pflowBinaryCodec';

const DEFAULT_PROJECT_NAME_PAIRS: readonly [string, string][] = [
  ['未命名原型项目', 'Untitled Prototype'],
  ['云仓电商进销存系统', 'Cloud Inventory SaaS'],
  ['CRM 销售数据看板', 'CRM Sales Analytics'],
  ['CRM 合同与回款业财系统', 'CRM Contracts & Billing'],
  ['Nova 智能移动应用', 'Nova Smart Mobile App'],
];
const ALL_DEFAULT_PROJECT_NAMES = new Set(DEFAULT_PROJECT_NAME_PAIRS.flat());

export const ProjectWelcomeLauncher: React.FC<{
  /** Desktop app: the launcher fills its own compact native window (no outer backdrop / fake window chrome) */
  standalone?: boolean;
  onImportRp?: () => void;
}> = ({ standalone = false, onImportRp }) => {
  const { isEn, tr, td } = useI18n();
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
  const [newProjName, setNewProjName] = useState(() => tr('未命名原型项目', 'Untitled Prototype'));
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
    setNewProjName((prev) => {
      for (const [zh, en] of DEFAULT_PROJECT_NAME_PAIRS) {
        if (isEn && prev === zh) return en;
        if (!isEn && prev === en) return zh;
      }
      return prev;
    });
  }, [isEn]);

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
    catch (error) { setStatusBanner({ type: 'error', text: td(error instanceof Error ? error.message : String(error)) }); }
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
            text: tr(`已选择保存目录：${res.directoryPath}`, `Selected directory: ${res.directoryPath}`),
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
          text: tr(`已选择保存目录：${dirHandle.name}`, `Selected directory: ${dirHandle.name}`),
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
      if (!res.saved) throw new Error(tr('已取消保存', 'Save cancelled'));
      if (!res.filePath) throw new Error(tr('保存结果缺少文件路径', 'Saved result is missing file path'));
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
      if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error(tr('项目名称不能为空或包含路径分隔符', 'Project name cannot be empty or contain path separators'));
      const parentDir = storageDirPath.trim().replace(/[\\/]+$/, '');
      if (!parentDir) throw new Error(tr('请选择保存位置', 'Please select a save location'));
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
      const msg = td(error instanceof Error ? error.message : String(error));
      setStatusBanner({ type: 'error', text: tr(`创建项目失败：${String(error)}`, `Failed to create project: ${msg}`) });
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
        const msg = td(error instanceof Error ? error.message : String(error));
        setStatusBanner({ type: 'error', text: tr(`打开工程失败：${String(error)}`, `Failed to open project: ${msg}`) });
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
      const msg = td(error instanceof Error ? error.message : String(error));
      setStatusBanner({
        type: 'error',
        text: tr(`解析项目文件 ${file.name} 失败：${String(error)}`, `Failed to parse project file ${file.name}: ${msg}`),
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
              <div className="flex items-center gap-2 min-w-0">
                {!standalone && (
                  <>
                    <span className="w-3 h-3 rounded-full bg-rose-500/90 inline-block shrink-0" />
                    <span className="w-3 h-3 rounded-full bg-amber-500/90 inline-block shrink-0" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500/90 inline-block shrink-0" />
                  </>
                )}
                <AlexLogo size={18} className={`${standalone ? '' : 'ml-1.5 '}rounded-md shadow-2xs shrink-0`} />
                <span className="text-xs font-bold text-slate-700 shrink-0">
                  Alex
                </span>
                <span className="text-[11px] text-slate-400 truncate">
                  {tr('AI 原型设计与数据建模工作台', 'AI Prototyping & Data Modeling Studio')}
                </span>
              </div>

              <div
                className="flex items-center gap-2.5 shrink-0"
                style={hasMacTrafficLights ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : undefined}
              >
                <LanguageSwitch variant="pill" tooltipAlign="right" />
                <AccountButton />
                <button
                  type="button"
                  onClick={() => setWelcomeScreenOpen(false)}
                  disabled={isProjectClosed || isWorking}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer transition disabled:opacity-40 shrink-0 whitespace-nowrap"
                >
                  {tr('进入工作台 →', 'Enter Workspace →')}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Main Split Body: Left Sidebar + Right Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Navigation Sidebar */}
          <aside className="w-60 bg-slate-50 border-r border-slate-200 p-4 flex flex-col justify-between shrink-0">
            <div className="space-y-5">
              {/* Brand Identity */}
              <div className="flex items-center gap-2.5 px-1 min-w-0">
                <AlexLogo size={36} className="rounded-xl shadow-xs shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-extrabold text-slate-900 tracking-tight truncate">
                    Alex
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {tr('原型 · 数据表 · AI 协同', 'Prototypes · Schema · AI')}
                  </div>
                </div>
              </div>

              {/* Navigation Items */}
              <nav className="space-y-1 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveNav('projects')}
                  className={`w-full text-left px-3 py-2.5 rounded-xl font-semibold flex items-center justify-between gap-2 transition cursor-pointer ${
                    activeNav === 'projects'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FolderOpen className="w-4 h-4 shrink-0" />
                    <span className="truncate">{tr('项目列表', 'Projects')}</span>
                  </div>
                  <span
                    className={`text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded shrink-0 ${
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
                  className={`w-full text-left px-3 py-2.5 rounded-xl font-semibold flex items-center gap-2.5 min-w-0 transition cursor-pointer ${
                    activeNav === 'new_project'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <FolderPlus className="w-4 h-4 shrink-0" />
                  <span className="truncate">{tr('新建项目', 'New Project')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveNav('hermes_engine')}
                  className={`w-full text-left px-3 py-2.5 rounded-xl font-semibold flex items-center justify-between gap-2 transition cursor-pointer ${
                    activeNav === 'hermes_engine'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Bot className="w-4 h-4 shrink-0" />
                    <span className="truncate">{tr('AI 管理中心', 'AI Center')}</span>
                  </div>
                  <span
                    className={`text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded shrink-0 ${
                      activeNav === 'hermes_engine'
                        ? 'bg-black/20 text-white'
                        : hermesStatus === 'running'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {hermesStatus === 'running'
                      ? hermesUpdate
                        ? tr('可升级', 'Update')
                        : hermesVer
                      : tr('未启用', 'Off')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveNav('app_update')}
                  className={`w-full text-left px-3 py-2.5 rounded-xl font-semibold flex items-center justify-between gap-2 transition cursor-pointer ${
                    activeNav === 'app_update'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ArrowUpCircle className="w-4 h-4 shrink-0" />
                    <span className="truncate">{tr('版本更新', 'App Updates')}</span>
                  </div>
                  <span
                    className={`text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded shrink-0 ${
                      activeNav === 'app_update'
                        ? 'bg-black/20 text-white'
                        : appHasUpdate
                        ? 'bg-rose-100 text-rose-700 font-bold'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {appHasUpdate && appLatestRelease
                      ? tr(`新 v${appLatestRelease.version}`, `New v${appLatestRelease.version}`)
                      : `v${appVersion}`}
                  </span>
                </button>
              </nav>
            </div>

            {/* Bottom Compact Core Capabilities Summary */}
            <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1 text-[11px] text-slate-500">
              <div className="font-semibold text-slate-800">{tr('核心生产力工作流', 'Core Workflow')}</div>
              <div className="truncate">{tr('• 可视化画布 + 右侧 AI 连续对话', '• Visual canvas + live AI chat')}</div>
              <div className="truncate">{tr('• 多菜单共享 ER 数据库模型', '• Shared ER database schema')}</div>
              <div className="truncate">{tr('• 需求便签与闭环巡检', '• Spec pins & closed-loop audit')}</div>
            </div>
          </aside>

          {/* Right Main Content Area */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-white">
            {/* Status Banner if any */}
            {statusBanner && (
              <div
                className={`px-4 py-2 text-xs font-medium flex items-center justify-between gap-2 border-b ${
                  statusBanner.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : statusBanner.type === 'error'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="break-words">{statusBanner.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setStatusBanner(null)}
                  className="text-[11px] underline cursor-pointer shrink-0"
                >
                  {tr('关闭', 'Dismiss')}
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
                      aria-label={tr('搜索项目名称', 'Search projects')}
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder={tr('搜索项目名称...', 'Search projects...')}
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-500"
                    />
                  </search>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleOpenBinaryFileClick}
                      className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span>{tr('打开本地项目...', 'Open Local...')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveNav('new_project')}
                      className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer transition whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4 shrink-0" />
                      <span>{tr('新建项目', 'New Project')}</span>
                    </button>
                  </div>
                </div>

                <button type="button" disabled={isWorking} onClick={onImportRp}
                  className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-left text-xs text-slate-600 hover:border-blue-400 hover:bg-blue-50">
                  <strong className="mr-2 text-slate-800">{tr('导入 Axure 原型', 'Import Axure RP')}</strong>{tr('拖入 RP 9 或 11 的 .rp 文件，或点击选择', 'Drop an RP 9 or 11 .rp file here, or click to browse')}
                </button>
                {/* Project Cards List */}
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                  {filteredRecent.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{tr('暂无最近项目，请新建项目或打开本地工程文件。', 'No recent projects. Create a new project or open a local .pflow file.')}</p>}
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
                            <span className="text-sm font-bold text-slate-900 truncate max-w-full">
                              {proj.projectName}
                            </span>
                            {idx === 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold shrink-0">
                                {tr('最近打开', 'Recent')}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 tabular-nums">
                            <span className="flex items-center gap-1">
                              <FileCode2 className="w-3 h-3 text-blue-600" />
                              {tr(`${proj.pageCount} 个页面`, `${proj.pageCount} pages`)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Database className="w-3 h-3 text-emerald-600" />
                              {tr(`${proj.tableCount} 张数据表`, `${proj.tableCount} tables`)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Pin className="w-3 h-3 text-amber-600" />
                              {tr(`${proj.stickyCount} 条便签`, `${proj.stickyCount} pins`)}
                            </span>
                            <span className="text-slate-400">
                              {tr(`更新于 ${proj.updatedAt}`, `Updated ${proj.updatedAt}`)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-2 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button type="button" disabled={isWorking} aria-label={tr(`删除项目${proj.projectName}`, `Delete ${proj.projectName}`)} title={tr('删除项目并将工程文件移到废纸篓', 'Delete project and move files to Trash')} onClick={() => setDeleteTarget(proj)} className="flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 whitespace-nowrap"><Trash2 size={12} />{tr('删除', 'Delete')}</button>
                        <button
                          type="button"
                          disabled={isWorking}
                          onClick={async () => {
                            try {
                              const payload = useProtoStore.getState().currentProjectMeta.projectId === proj.projectId
                                ? captureProjectPayload() : await readRecentProject(proj.projectId);
                              const savedPath = await writeBinaryToDisk(payload.meta, encodePflowBinary(payload));
                              setStatusBanner({ type: 'success', text: tr(`已导出项目备份：${savedPath}`, `Exported project backup: ${savedPath}`) });
                            } catch (error) { setStatusBanner({ type: 'error', text: td(error instanceof Error ? error.message : String(error)) }); }
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          title={tr('导出项目备份文件', 'Export project backup file')}
                        >
                          <Download className="w-3 h-3 text-slate-500" />
                          <span>{tr('导出备份', 'Backup')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleOpenRecentProject(proj.projectId)}
                          disabled={isWorking}
                          className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <span>{tr('打开项目', 'Open')}</span>
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
                    <h2 className="text-base font-bold text-slate-900">{tr('新建项目', 'New Project')}</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {tr('填写项目名称并选择起点模板，即可进入原型画布与数据库设计工作台', 'Enter a project name and choose a starter template to launch the canvas and schema studio.')}
                    </p>
                  </div>

                  {/* Project Name & Location */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="new-project-name" className="text-xs font-semibold text-slate-700 block">
                        {tr('项目名称', 'Project Name')}
                      </label>
                      <input
                        id="new-project-name"
                        name="projectName"
                        type="text"
                        required
                        value={newProjName}
                        onChange={(e) => setNewProjName(e.target.value)}
                        placeholder={tr('例如：云仓电商进销存系统', 'e.g., Cloud Inventory SaaS')}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-500 user-invalid:border-rose-600"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="new-project-dir" className="text-xs font-semibold text-slate-700 block">
                        {tr('保存位置', 'Save Location')}
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id="new-project-dir"
                          name="storageDir"
                          type="text"
                          value={storageDirPath}
                          onChange={(e) => setStorageDirPath(e.target.value)}
                          className="flex-1 min-w-0 px-3 py-2 text-xs font-mono rounded-xl bg-slate-50 border border-slate-300 text-slate-700 focus:outline-none focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={handleChooseDirectory}
                          className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-medium flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
                          <span>{tr('浏览...', 'Browse...')}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Project Terminal Orientation */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-700 block">
                      {tr('选择工程终端形态（进入工作台后仍可按页面自由新建 PC 或移动页）', 'Target Platform (you can still add Desktop or Mobile pages anytime inside the workspace)')}
                    </label>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      {[
                        {
                          mode: 'desktop' as const,
                          title: tr('PC 管理系统', 'Desktop Admin'),
                          desc: tr('面向中后台管理系统，提供宽屏栅格、多列查询与业务表格物料', 'Widescreen grid, multi-column filters, and enterprise table components'),
                          icon: Monitor,
                          defaultTpl: 'blank_project' as const,
                        },
                        {
                          mode: 'mobile' as const,
                          title: tr('移动端应用 (C端/B端)', 'Mobile App (B2C/B2B)'),
                          desc: tr('现代移动设计语言，iPhone 真机视口 + 专属触控物料', 'Modern mobile UI with iPhone viewport and touch-ready components'),
                          icon: Smartphone,
                          defaultTpl: 'mobile_starter' as const,
                        },
                        {
                          mode: 'hybrid' as const,
                          title: tr('PC + 移动多端协同', 'Desktop + Mobile'),
                          desc: tr('同一工程同时设计后台管理端与移动端，共用物理数据库表实时联动', 'Design admin and mobile apps together sharing live ER database tables'),
                          icon: Layers,
                          defaultTpl: 'mobile_starter' as const,
                        },
                      ].map((item) => {
                        const active = projectMode === item.mode;
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.mode}
                            type="button"
                            onClick={() => {
                              setProjectMode(item.mode);
                              setTemplateId(item.defaultTpl);
                              if (ALL_DEFAULT_PROJECT_NAMES.has(newProjName)) {
                                setNewProjName(
                                  item.mode === 'desktop'
                                    ? tr('未命名原型项目', 'Untitled Prototype')
                                    : tr('Nova 智能移动应用', 'Nova Smart Mobile App')
                                );
                              }
                            }}
                            className={`min-w-0 text-left p-3 rounded-xl border transition cursor-pointer space-y-1 ${
                              active
                                ? 'bg-blue-50/70 border-blue-500 ring-2 ring-blue-500/15'
                                : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0 font-bold text-slate-900">
                              <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-blue-600' : 'text-slate-500'}`} />
                              <span className="truncate">{item.title}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">{item.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Project Template Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-700 block">
                      {tr('选择起点模板', 'Starter Template')}
                    </label>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      {(projectMode === 'mobile'
                        ? [
                            {
                              id: 'blank_project' as const,
                              title: tr('空白移动项目', 'Blank Mobile'),
                              desc: tr('从零开始创建移动端页面，或交给项目 AI 规划整套 App / 小程序。', 'Start from scratch or let Project AI plan your full mobile app.'),
                              badge: tr('从零开始', 'Blank'),
                              suggestedName: tr('未命名原型项目', 'Untitled Prototype'),
                            },
                            {
                              id: 'mobile_starter' as const,
                              title: tr('现代移动应用样板', 'Modern Mobile Starter'),
                              desc: tr('预置 C端探索瀑布流、B端协同待办、AI 对话助手、个人中心与 2 张物理表', 'Includes explore feed, B2B tasks, AI chat, profile center, and 2 DB tables.'),
                              badge: tr('推荐样板', 'Starter'),
                              suggestedName: tr('Nova 智能移动应用', 'Nova Smart Mobile App'),
                            },
                          ]
                        : projectMode === 'hybrid'
                        ? [
                            {
                              id: 'blank_project' as const,
                              title: tr('空白多端项目', 'Blank Hybrid'),
                              desc: tr('自由混排 PC 后台页面与移动端页面，共用同一套工程数据表。', 'Freely combine desktop admin and mobile pages sharing unified DB tables.'),
                              badge: tr('从零开始', 'Blank'),
                              suggestedName: tr('未命名原型项目', 'Untitled Prototype'),
                            },
                            {
                              id: 'crm_analytics' as const,
                              title: tr('CRM 合同与业财回款系统', 'CRM Contracts & Billing'),
                              desc: tr('含商机、合同审批、分期回款核销、数电开票、5 张共表、便签规则与销售移动工作台', 'Deals, contract approvals, billing, e-invoicing, 5 shared tables, and mobile CRM.'),
                              badge: tr('旗舰多端样板', 'Flagship'),
                              suggestedName: tr('CRM 合同与回款业财系统', 'CRM Contracts & Billing'),
                            },
                            {
                              id: 'mobile_starter' as const,
                              title: tr('PC 后台 + 移动协同样板', 'Admin + Mobile Starter'),
                              desc: tr('同时包含 PC 电商供应链管理后台与现代移动端页面，演示跨端共表', 'Pairs desktop supply-chain admin with modern mobile screens over shared tables.'),
                              badge: tr('多端样板', 'Hybrid'),
                              suggestedName: tr('Nova 智能移动应用', 'Nova Smart Mobile App'),
                            },
                          ]
                        : [
                            {
                              id: 'blank_project' as const,
                              title: tr('空白项目', 'Blank Project'),
                              desc: tr('没有预设目录或页面。可以自己创建，也可以交给项目 AI 规划。', 'No preset folders or pages. Create your own or let Project AI plan them.'),
                              badge: tr('从零开始', 'Blank'),
                              suggestedName: tr('未命名原型项目', 'Untitled Prototype'),
                            },
                            {
                              id: 'saas_inventory' as const,
                              title: tr('SaaS 电商进销存后台', 'SaaS Inventory Admin'),
                              desc: tr('含供应商准入、采购订单、到货入库主子表联动、4 张共表模型与需求便签示例', 'Supplier onboarding, POs, master-detail receiving, 4 shared tables, and spec pins.'),
                              badge: tr('推荐样板', 'Recommended'),
                              suggestedName: tr('云仓电商进销存系统', 'Cloud Inventory SaaS'),
                            },
                            {
                              id: 'crm_analytics' as const,
                              title: tr('CRM 合同与业财回款系统', 'CRM Contracts & Billing'),
                              desc: tr('含客户商机、合同主子表、分期回款核销、数电开票、便签规则、PRD 笔记与移动联动', 'Leads, master-detail contracts, billing, invoicing, PRD notes, and mobile sync.'),
                              badge: tr('业财标杆', 'Enterprise'),
                              suggestedName: tr('CRM 合同与回款业财系统', 'CRM Contracts & Billing'),
                            },
                          ]
                      ).map((tpl) => {
                        const isSelected = templateId === tpl.id;
                        return (
                          <div
                            key={tpl.id}
                            onClick={() => {
                              setTemplateId(tpl.id);
                              if (ALL_DEFAULT_PROJECT_NAMES.has(newProjName)) setNewProjName(tpl.suggestedName);
                            }}
                            className={`min-w-0 p-3.5 rounded-xl border transition cursor-pointer space-y-1.5 ${
                              isSelected
                                ? 'bg-blue-50/60 border-blue-500 ring-2 ring-blue-500/15'
                                : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1.5 min-w-0">
                              <span className="font-bold text-slate-900 truncate">{tpl.title}</span>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 whitespace-nowrap ${
                                  isSelected
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {tpl.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">
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
                    {tr('取消', 'Cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isWorking}
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{tr('创建并进入工作台', 'Create & Enter Workspace')}</span>
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
      {deleteTarget && <DeleteConfirmation title={tr('删除项目', 'Delete Project')} confirmLabel={tr('移到废纸篓并删除', 'Move to Trash & Delete')} disabled={!projectTrashApi()?.trashProject} onClose={() => setDeleteTarget(null)} onConfirm={async () => {
        setIsWorking(true);
        try {
          const result = await deleteProject(deleteTarget);
          setStatusBanner({
            type: result.recordWarning ? 'info' : 'success',
            text: result.recordWarning
              ? td(result.recordWarning)
              : result.missing
                ? tr('工程文件已不存在，已清理项目记录。', 'Project file was already missing; removed project record.')
                : tr('工程文件已移到废纸篓，项目记录已删除。', 'Moved project files to Trash and removed project record.'),
          });
        } finally { setIsWorking(false); }
      }}>
        <p>{tr('确认删除 ', 'Delete ')}<strong className="text-slate-900">{deleteTarget.projectName}</strong>{tr('？', '?')}</p>
        <p className="break-all rounded-lg bg-slate-50 px-3 py-2 text-xs">{deleteTarget.storageDir}/{deleteTarget.fileName}</p>
        <p>{tr('本地工程文件会移到系统废纸篓，并从项目列表移除。误删时可从废纸篓恢复，再重新打开工程。', 'Local project files will be moved to the system Trash and removed from your project list. You can restore them from Trash anytime.')}</p>
        {deleteTarget.projectId === useProtoStore.getState().currentProjectMeta.projectId && !isProjectClosed && <p className="text-xs text-rose-600">{tr('这是当前打开的项目，会先保存最新修改，再移到废纸篓并关闭工作台。', 'This project is currently open. Latest changes will be saved before moving to Trash and closing the workspace.')}</p>}
        <p className="text-xs text-slate-500">{tr('单独导出的文件、项目目录中的其他文件和已发布链接会保留。', 'Separately exported files, other files in the directory, and published share links are preserved.')}</p>
        {!projectTrashApi()?.trashProject && <p className="text-xs text-amber-700">{tr('请在桌面应用中操作。更新后如未出现删除能力，请重启桌面应用。', 'Available in the desktop app. Restart the desktop app if Trash deletion is unavailable after updating.')}</p>}
      </DeleteConfirmation>}
    </div>
  );
};
