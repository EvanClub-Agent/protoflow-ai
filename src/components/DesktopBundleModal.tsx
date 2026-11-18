import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Code2,
  Database,
  Download,
  FileCode2,
  FileDiff,
  FileJson,
  FileText,
  FolderGit2,
  FolderOutput,
  Package,
  StickyNote,
  X,
} from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { captureProjectPayload } from '../services/projectStorage';
import {
  encodePflowBinary,
  generateUnpackedGitFiles,
  writeUnpackedGitTreeToDirectoryHandle,
  type RecursiveDirectoryHandle,
  type UnpackedGitFileEntry,
  type PflowBinaryPayload,
} from '../utils/pflowBinaryCodec';

function lineDiff(before = '', after = '') {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (start <= endA && start <= endB && a[start] === b[start]) start++;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  return [
    ...a.slice(Math.max(0, start - 2), start).map((l) => `  ${l}`),
    ...a.slice(start, endA + 1).map((l) => `- ${l}`),
    ...b.slice(start, endB + 1).map((l) => `+ ${l}`),
    ...b.slice(endB + 1, Math.min(b.length, endB + 3)).map((l) => `  ${l}`),
  ].join('\n');
}

function fileIconForPath(path: string) {
  if (path.endsWith('.tsx') || path.endsWith('.ts')) {
    return <FileCode2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />;
  }
  if (path.endsWith('.sql')) {
    return <Database className="h-3.5 w-3.5 text-emerald-600 shrink-0" />;
  }
  if (path.endsWith('.pins.md')) {
    return <StickyNote className="h-3.5 w-3.5 text-amber-600 shrink-0" />;
  }
  if (path.endsWith('.json')) {
    return <FileJson className="h-3.5 w-3.5 text-indigo-600 shrink-0" />;
  }
  return <FileText className="h-3.5 w-3.5 text-slate-500 shrink-0" />;
}

/** Binary entries (note images) are summarised instead of dumping base64 into the preview/diff. */
const previewContent = (f: UnpackedGitFileEntry) =>
  f.encoding === 'base64'
    ? `[二进制图片 · ${Math.max(1, Math.round((f.content.length * 3) / 4 / 1024))} KB · 内容指纹 ${f.relativePath.split('/').pop()}]`
    : f.content;

export const DesktopBundleModal: React.FC = () => {
  const open = useProtoStore(s => s.isBundleModalOpen);
  const projectId = useProtoStore(s => s.currentProjectMeta.projectId);
  return open ? <ProjectFiles key={projectId} /> : null;
};

function ProjectFiles() {
  const open = useProtoStore((s) => s.isBundleModalOpen);
  const setOpen = useProtoStore((s) => s.setBundleModalOpen);
  const protoState = useProtoStore();
  const pageState = usePageStore();
  const [baseline, setBaseline] = useState<PflowBinaryPayload | null>(null);
  const [tab, setTab] = useState<'files' | 'diff'>('files');
  const [selectedPath, setSelectedPath] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);

  const current = useMemo(
    () => captureProjectPayload(),
    [
      open,
      protoState.currentProjectMeta,
      protoState.activePageId,
      protoState.projectPlan,
      protoState.projectAgreements,
      protoState.databaseRequirements,
      protoState.mindmaps,
      protoState.projectNotes,
      protoState.dbTables,
      protoState.stickyNotes,
      protoState.closedLoopIssues,
      pageState.pageSources,
      pageState.tableRows,
      pageState.designerPages,
      pageState.designerFolders,
      pageState.sitemapBase,
      pageState.sitemapOverrides,
      protoState.suppliers,
      protoState.purchaseOrderItems,
      protoState.acceptanceOrders,
      protoState.widgets,
      protoState.draftAcceptanceHeader,
      protoState.draftAcceptanceLines,
    ]
  );

  useEffect(() => {
    if (!open) {
      setBaseline(null);
      return;
    }
    setBaseline((prev) =>
      prev?.meta.projectId === current.meta.projectId
        ? prev
        : structuredClone(current)
    );
    setTab('files');
    setMessage(null);
  }, [open, current.meta.projectId]);

  const files = useMemo(() => generateUnpackedGitFiles(current), [current]);
  const diffs = useMemo(() => {
    if (!baseline) return [];
    const oldMap = new Map(
      generateUnpackedGitFiles(baseline).map((f) => [f.relativePath, previewContent(f)])
    );
    const nextMap = new Map(files.map((f) => [f.relativePath, previewContent(f)]));
    const paths = Array.from(
      new Set([...oldMap.keys(), ...nextMap.keys()])
    ).sort();
    return paths.flatMap((path) => {
      const before = oldMap.get(path);
      const after = nextMap.get(path);
      if (before === after) return [];
      const status =
        before === undefined
          ? 'added'
          : after === undefined
          ? 'deleted'
          : 'modified';
      return [{ path, status, diff: lineDiff(before, after) }];
    });
  }, [baseline, files]);

  if (!open) return null;

  const list =
    tab === 'files'
      ? files.map((f) => ({ path: f.relativePath, content: previewContent(f) }))
      : diffs.map((d) => ({
          path: d.path,
          content: d.diff,
          status: d.status,
        }));
  const active = list.find((item) => item.path === selectedPath) || list[0];

  const handleDownloadBinaryBundle = () => {
    setMessage(null);
    setFailed(false);
    try {
      // The click, not the last render, defines the exported snapshot.
      const snapshot = captureProjectPayload();
      const bytes = encodePflowBinary(snapshot);
      const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' }));
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = snapshot.meta.fileName;
        a.click();
        setMessage(`已触发下载 ${a.download}`);
      } finally { URL.revokeObjectURL(url); }
    } catch (err) {
      setFailed(true);
      setMessage(err instanceof Error ? err.message : '下载失败');
    }
  };

  const exportDirectory = async () => {
    if (exporting) return;
    setExporting(true);
    setMessage(null);
    setFailed(false);
    try {
      const snapshot = captureProjectPayload();
      const snapshotFiles = generateUnpackedGitFiles(snapshot);
      const bytes = encodePflowBinary(snapshot);
      const host = window as unknown as {
        protoflowDesktop?: { writeUnpackedGitTree?: (input: {
          rootDirPath: string; files: UnpackedGitFileEntry[];
          binaryBundle: { fileName: string; binaryBytes: Uint8Array };
        }) => Promise<{ saved: boolean; targetDir?: string }> };
        showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<RecursiveDirectoryHandle>;
      };
      if (host.protoflowDesktop?.writeUnpackedGitTree) {
        const result = await host.protoflowDesktop.writeUnpackedGitTree({
          rootDirPath: '', files: snapshotFiles,
          binaryBundle: { fileName: snapshot.meta.fileName, binaryBytes: bytes },
        });
        setMessage(result.saved
          ? `源码与工程文件已导出${result.targetDir ? `：${result.targetDir}` : ''}`
          : '已取消目录导出。');
      } else if (host.showDirectoryPicker) {
        // Freeze source files and archive together before waiting for the picker.
        const directory = await host.showDirectoryPicker({ mode: 'readwrite' });
        const count = await writeUnpackedGitTreeToDirectoryHandle(directory, snapshotFiles, { fileName: snapshot.meta.fileName, bytes });
        setMessage(`源码与工程文件已导出：${directory.name}（${count} 个文件）`);
      } else {
        setFailed(true);
        setMessage('当前运行环境不支持目录导出，请直接下载 .pflow 文件。');
      }
    } catch (err) {
      const cancelled = typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError';
      setFailed(!cancelled);
      setMessage(cancelled ? '已取消目录导出。' : err instanceof Error ? err.message : '目录导出失败');
    } finally { setExporting(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="工程文件与导出"
    >
      <div className="flex h-[84vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white text-slate-800 shadow-2xl">
        {/* Top Modal Header */}
        <header className="relative flex items-center justify-between gap-4 border-b border-slate-200/90 bg-gradient-to-r from-slate-50 via-white to-blue-50/30 px-5 py-4 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-xs">
              <FolderGit2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-tight text-slate-900 truncate">
                工程文件 · {current.meta.projectName}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                源码目录记录导出时的工程快照。工程更新后，请重新导出供研发使用。
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭工程文件"
            disabled={exporting}
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 cursor-pointer shrink-0"
          >
            <X size={16} />
          </button>
        </header>

        {/* Action & Tab Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/90 bg-slate-50/70 px-5 py-2.5 text-xs shrink-0">
          <div className="inline-flex rounded-xl border border-slate-200/90 bg-slate-200/60 p-0.5">
            <button
              type="button"
              onClick={() => setTab('files')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition cursor-pointer ${
                tab === 'files'
                  ? 'bg-white text-blue-700 font-semibold shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              {`当前文件 (${files.length})`}
            </button>
            <button
              type="button"
              onClick={() => setTab('diff')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition cursor-pointer ${
                tab === 'diff'
                  ? 'bg-white text-blue-700 font-semibold shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileDiff className="h-3.5 w-3.5" />
              {`本次查看期间的变化 (${diffs.length})`}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadBinaryBundle}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-3.5 py-1.5 font-semibold text-slate-700 shadow-2xs transition hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-700 cursor-pointer"
            >
              <Download size={14} className="text-blue-600" />
              下载 .pflow
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={exportDirectory}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 font-semibold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              <FolderOutput size={14} />
              {exporting ? '正在导出...' : '导出源码目录'}
            </button>
          </div>
        </div>

        {/* Status Message Banner */}
        {message && (
          <div
            role={failed ? 'alert' : 'status'}
            className={`flex items-center gap-2 border-b px-5 py-2 text-xs font-medium shrink-0 ${failed ? 'border-rose-100 bg-rose-50 text-rose-800' : 'border-blue-100 bg-blue-50/70 text-blue-900'}`}
          >
            {failed ? <AlertCircle className="h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />}
            <span>{message}</span>
          </div>
        )}

        {/* Main Split Explorer & Code Viewer */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left File Explorer Tree */}
          <aside className="w-80 shrink-0 overflow-y-auto border-r border-slate-200/90 bg-slate-50/50 p-3">
            <div className="mb-2 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <span>{tab === 'files' ? '工程产物目录树' : '变更文件列表'}</span>
              <span className="font-mono">{list.length} 项</span>
            </div>

            {tab === 'diff' && diffs.length === 0 ? (
              <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
                <Package className="mb-2 h-6 w-6 text-slate-400" />
                <span>本次查看期间没有变化。</span>
              </div>
            ) : (
              <div className="space-y-1">
                {list.map((item) => {
                  const isActive = active?.path === item.path;
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => setSelectedPath(item.path)}
                      className={`group flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition cursor-pointer ${
                        isActive
                          ? 'bg-blue-50/90 text-blue-700 font-semibold ring-1 ring-blue-200/80 shadow-2xs'
                          : 'text-slate-700 hover:bg-white hover:shadow-2xs'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        {fileIconForPath(item.path)}
                        <span className="truncate font-mono text-[11px]">
                          {item.path}
                        </span>
                      </span>
                      {'status' in item && (
                        <span
                          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                            item.status === 'added'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                              : item.status === 'deleted'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200/70'
                              : 'bg-amber-50 text-amber-700 border border-amber-200/70'
                          }`}
                        >
                          {item.status === 'added'
                            ? '新增'
                            : item.status === 'deleted'
                            ? '删除'
                            : '修改'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          {/* Right Code & Diff Viewer */}
          <main className="min-w-0 flex-1 flex flex-col overflow-hidden bg-slate-950 text-slate-100">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/90 px-4 py-2 text-xs shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Code2 className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span className="truncate font-mono text-[11px] text-slate-200">
                  {active?.path || '未选择文件'}
                </span>
              </div>
              {active?.content && (
                <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                  {active.content.split('\n').length} lines
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-200">
                {active?.content || '请选择左侧文件查看内容。'}
              </pre>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};
