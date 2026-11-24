import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  ExternalLink,
  FileUp,
  KeyRound,
  Layers,
  Link2,
  LoaderCircle,
  Monitor,
  Smartphone,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import FigWorker from '../proto/figma/import.worker?worker&inline';
import { MAX_FIG_BYTES } from '../proto/figma/figBinary';
import { compileFigmaSelectionToProject } from '../proto/figma/import';
import type { FigmaDocumentIR, FigmaImportReportItem } from '../proto/figma/ir';
import {
  fetchFigmaDocumentFromUrl,
  loadSavedFigmaToken,
  materializeFigmaSelectionImages,
  parseFigmaUrl,
  saveFigmaToken,
} from '../proto/figma/restApi';
import { createPublishedSnapshot } from '../services/createPublishedSnapshot';
import { publicationSizeWarning } from '../services/publishingClient';
import { createFigmaProject } from '../services/figmaProject';
import { flushProjectChanges, loadProjectFromBinaryPayload } from '../services/projectStorage';
import { encodePflowBinary } from '../utils/pflowBinaryCodec';
import { useI18n, tr as syncTr } from '../i18n';
import { FigmaBrandLogo } from './DesignToolLogos';

interface ImportBridge {
  isElectron?: boolean;
  defaultProjectsDirectory(): Promise<string>;
  writeBinaryProject(input: { dirPath: string; fileName: string; binaryBytes: Uint8Array }): Promise<{ saved: boolean }>;
}

export type FigmaImportTab = 'file' | 'url';

interface ImportResult {
  warnings: string[];
  publishWarning?: string;
  pages: FigmaImportReportItem[];
}

interface FigmaImportDialogProps {
  initialFiles?: File[] | null;
  initialTab?: FigmaImportTab;
  onClose: (result?: ImportResult) => void;
}

export const FigmaImportDialog: React.FC<FigmaImportDialogProps> = ({
  initialFiles,
  initialTab = 'file',
  onClose,
}) => {
  const { tr, td } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeWorkerRef = useRef<Worker | null>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);

  const [tab, setTab] = useState<FigmaImportTab>(initialTab);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tokenPersistenceHint, setTokenPersistenceHint] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [doc, setDoc] = useState<FigmaDocumentIR | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(() => new Set());

  // REST API Tab state
  const [figmaUrl, setFigmaUrl] = useState('');
  const [figmaToken, setFigmaToken] = useState('');
  const [rememberToken, setRememberToken] = useState(true);
  const rememberTokenRef = useRef(rememberToken);
  rememberTokenRef.current = rememberToken;
  const tokenTouchedRef = useRef(false);
  const pendingClear = useRef<Promise<boolean> | null>(null);
  const [clearingToken, setClearingToken] = useState(false);

  const requestClose = async () => {
    if (pendingClear.current && !await pendingClear.current) return;
    if (mountedRef.current) onClose();
  };

  const changeRememberToken = (checked: boolean) => {
    tokenTouchedRef.current = true;
    rememberTokenRef.current = checked;
    setRememberToken(checked);
    if (checked) return;
    setTokenPersistenceHint('');
    setClearingToken(true);
    pendingClear.current = saveFigmaToken('').then(result => {
      if (!result.saved) throw new Error(result.error || tr('无法删除已保存的 Figma Token', 'Could not remove the saved Figma token'));
      return true;
    }).catch((err: unknown) => {
      if (mountedRef.current) {
        rememberTokenRef.current = true;
        setRememberToken(true);
        setError(err instanceof Error ? err.message : String(err));
      }
      return false;
    }).finally(() => {
      pendingClear.current = null;
      if (mountedRef.current) setClearingToken(false);
    });
  };
  const [scopeToUrlNode, setScopeToUrlNode] = useState(true);

  const detectedUrlNodeId = useMemo(() => {
    try {
      return figmaUrl.trim() ? parseFigmaUrl(figmaUrl).nodeId : undefined;
    } catch {
      return undefined;
    }
  }, [figmaUrl]);

  useEffect(() => {
    mountedRef.current = true;
    const el = dialogRef.current;
    if (el && !el.open) {
      el.showModal();
    }
    void loadSavedFigmaToken().then((saved) => {
      if (mountedRef.current && !tokenTouchedRef.current && rememberTokenRef.current && saved) {
        setFigmaToken(saved);
      }
    });
    return () => {
      mountedRef.current = false;
      activeWorkerRef.current?.terminate();
      activeWorkerRef.current = null;
      if (el?.open) el.close();
    };
  }, []);

  const applyParsedDocument = (parsedDoc: FigmaDocumentIR, label: string) => {
    setDoc(parsedDoc);
    setSourceLabel(label);
    const defaults = new Set<string>();
    for (const c of parsedDoc.canvases) {
      for (const f of c.frames) {
        if (f.defaultSelected) defaults.add(f.pageId);
      }
    }
    setSelectedPageIds(defaults);
  };

  const parseLocalFigFile = async (file: File) => {
    if (file.size > MAX_FIG_BYTES) {
      setError(tr('文件超过 160 MiB 本地导入上限', 'File exceeds the 160 MiB local import limit'));
      return;
    }
    setParsing(true);
    setError('');
    setDoc(null);
    let worker: Worker | undefined;
    try {
      const bytes = await file.arrayBuffer();
      const parsed = await new Promise<FigmaDocumentIR>((resolve, reject) => {
        worker = new FigWorker();
        activeWorkerRef.current = worker;
        worker.onmessage = ({ data }: MessageEvent<{ document: FigmaDocumentIR } | { error: string }>) => {
          if ('error' in data) reject(new Error(data.error));
          else resolve(data.document);
        };
        worker.onerror = () => reject(new Error(syncTr('本地 .fig 解析器运行失败，请确认文件完整', 'Local .fig parser failed — please verify the file')));
        worker.postMessage({ bytes, fileName: file.name }, [bytes]);
      });
      if (mountedRef.current) applyParsedDocument(parsed, file.name);
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      worker?.terminate();
      if (activeWorkerRef.current === worker) activeWorkerRef.current = null;
      if (mountedRef.current) setParsing(false);
    }
  };

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      setTab('file');
      if (initialFiles.length > 1) {
        setError(tr('请每次选择一个 .fig 文件', 'Please select one .fig file at a time'));
        return;
      }
      void parseLocalFigFile(initialFiles[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  const handleFetchFromUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsing || saving || pendingClear.current) return;
    setParsing(true);
    setError('');
    setDoc(null);
    try {
      if (rememberToken) {
        const savedRes = await saveFigmaToken(figmaToken);
        if (!savedRes.saved) {
          throw new Error(savedRes.error || tr('无法保存 Figma Token，请检查用户目录权限', 'Failed to save Figma token; please check user directory permissions'));
        }
        setTokenPersistenceHint(
          savedRes.persisted
            ? ''
            : tr(
                '当前环境不支持系统级安全加密存储，Token 仅在本次会话内存中保留，不会明文写入本地磁盘。',
                'OS secure storage is unavailable; your token stays in memory for this session only and is never written in plaintext.',
              ),
        );
      } else {
        const clearRes = await saveFigmaToken('');
        if (!clearRes.saved) {
          throw new Error(clearRes.error || tr('无法清除已保存的 Figma Token，请检查用户目录权限', 'Failed to remove saved Figma token; please check user directory permissions'));
        }
        setTokenPersistenceHint('');
      }
      const parsed = await fetchFigmaDocumentFromUrl(figmaUrl, figmaToken, {
        scopeToUrlNode: Boolean(detectedUrlNodeId && scopeToUrlNode),
        deferImageDownload: true,
      });
      if (mountedRef.current) applyParsedDocument(parsed, parsed.name);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setParsing(false);
    }
  };

  const togglePage = (pageId: string) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  };

  const toggleCanvas = (framePageIds: string[], select: boolean) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      for (const id of framePageIds) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const summary = useMemo(() => {
    if (!doc) return null;
    let totalFrames = 0;
    let selectedCount = 0;
    let desktopCount = 0;
    let mobileCount = 0;
    let autoLayouts = 0;
    let links = 0;
    let skippedSpecs = 0;
    for (const c of doc.canvases) {
      for (const f of c.frames) {
        totalFrames++;
        if (f.isComponentSheet && !selectedPageIds.has(f.pageId)) skippedSpecs++;
        if (selectedPageIds.has(f.pageId)) {
          selectedCount++;
          if (f.platform === 'mobile') mobileCount++;
          else desktopCount++;
          autoLayouts += f.autoLayoutCount;
          links += f.linkCount;
        }
      }
    }
    const modeLabel =
      desktopCount > 0 && mobileCount > 0
        ? tr('多端混合工程 (Hybrid)', 'Hybrid Project')
        : mobileCount > 0
        ? tr('移动端工程 (Mobile)', 'Mobile Project')
        : tr('桌面端工程 (Desktop)', 'Desktop Project');
    return { totalFrames, selectedCount, desktopCount, mobileCount, autoLayouts, links, skippedSpecs, modeLabel };
  }, [doc, selectedPageIds, tr]);

  const handleConfirmImport = async () => {
    if (!doc || busyRef.current || pendingClear.current || selectedPageIds.size === 0) return;
    busyRef.current = true;
    setSaving(true);
    setError('');
    try {
      const readyDoc =
        doc.sourceKind === 'rest-api'
          ? await materializeFigmaSelectionImages(doc, selectedPageIds)
          : doc;
      const compiled = compileFigmaSelectionToProject(readyDoc, selectedPageIds);
      const desktop = (window as unknown as { protoflowDesktop?: ImportBridge }).protoflowDesktop;
      const parentDir = desktop?.isElectron ? await desktop.defaultProjectsDirectory() : './AlexProjects';
      const payload = createFigmaProject(sourceLabel || doc.name, parentDir, compiled);
      const binaryBytes = encodePflowBinary(payload);
      await flushProjectChanges();
      if (desktop?.isElectron) {
        const res = await desktop.writeBinaryProject({
          dirPath: payload.meta.storageDir,
          fileName: payload.meta.fileName,
          binaryBytes,
        });
        if (!res.saved) throw new Error(tr('工程未保存，请重试', 'Project was not saved — please retry'));
      } else {
        const url = URL.createObjectURL(new Blob([binaryBytes], { type: 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = payload.meta.fileName;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      loadProjectFromBinaryPayload(payload);
      let publishWarning: string | undefined;
      try {
        const snapshot = createPublishedSnapshot(payload.stateSnapshot.activePageId);
        publishWarning = publicationSizeWarning({ snapshot, access: { passwordAction: 'remove', password: '', expiresAt: null } });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        publishWarning = tr(`在线发布检查未通过：${detail}`, `Publication check failed: ${detail}`);
      }
      const pages = compiled.report.filter(page => page.warnings.length || page.omittedImages);
      const warnings = [...new Set(readyDoc.warnings)];
      onClose(publishWarning || pages.length || warnings.length ? { publishWarning, warnings, pages } : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="figma-import-heading"
      onCancel={(e) => {
        e.preventDefault();
        if (!saving && !parsing) void requestClose();
      }}
      className="m-auto w-[680px] max-w-[95vw] max-h-[88vh] overscroll-contain rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-slate-900/45"
    >
      <div className="flex max-h-[88vh] flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 shadow-xs">
              <FigmaBrandLogo className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 id="figma-import-heading" className="text-base font-bold text-slate-900">
                {tr('导入 Figma 设计稿', 'Import Figma Design')}
              </h1>
              <p className="truncate text-xs text-slate-500">
                {tr(
                  '支持本地 .fig 文件离线解析与 Figma REST API 在线拉取，自动识别 Auto Layout 与桌面/移动端画板',
                  'Supports offline .fig archives & Figma REST API links with Auto Layout and Desktop/Mobile frame detection',
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={saving || parsing}
            onClick={() => void requestClose()}
            aria-label={tr('关闭弹窗', 'Close dialog')}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Source Channel Switcher (shown before parsing or when switching source) */}
          {!doc && (
            <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
              <button
                type="button"
                disabled={parsing}
                onClick={() => {
                  setTab('file');
                  setError('');
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition cursor-pointer ${
                  tab === 'file' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileUp className="h-3.5 w-3.5 text-violet-600" aria-hidden="true" />
                <span>{tr('本地 .fig 文件', 'Local .fig File')}</span>
              </button>
              <button
                type="button"
                disabled={parsing}
                onClick={() => {
                  setTab('url');
                  setError('');
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition cursor-pointer ${
                  tab === 'url' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Link2 className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                <span>{tr('Figma 在线链接 (REST API)', 'Figma Link (REST API)')}</span>
              </button>
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
              {td(error)}
            </div>
          )}

          {/* Tab 1: Local .fig File Dropzone */}
          {!doc && tab === 'file' && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".fig"
                hidden
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) void parseLocalFigFile(f);
                  e.currentTarget.value = '';
                }}
              />
              {parsing ? (
                <div role="status" className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 py-12 text-center">
                  <LoaderCircle className="h-7 w-7 animate-spin text-violet-600" aria-hidden="true" />
                  <div className="text-sm font-semibold text-slate-800">
                    {tr('正在本机解析 .fig 文件结构与图层…', 'Parsing .fig schema & layers locally…')}
                  </div>
                  <div className="text-xs text-slate-500">
                    {tr('全程离线解码 Kiwi 二进制树、Auto Layout 与内嵌位图', 'Decoding Kiwi binary scene graph, Auto Layout & embedded images offline')}
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const dropped = Array.from(e.dataTransfer?.files ?? []).find((f) => /\.fig$/i.test(f.name));
                    if (dropped) void parseLocalFigFile(dropped);
                    else setError(tr('请拖入后缀为 .fig 的 Figma 本地文件', 'Please drop a .fig file exported from Figma'));
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className="group flex flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/70 px-6 py-10 text-center transition hover:border-violet-400 hover:bg-violet-50/35 cursor-pointer"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-xs border border-slate-200 group-hover:scale-105 transition">
                    <FigmaBrandLogo className="w-6 h-6" />
                  </div>
                  <div className="text-sm font-semibold text-slate-800">
                    {tr('点击选择或直接拖入 .fig 设计稿文件', 'Click to browse or drop a .fig file here')}
                  </div>
                  <p className="max-w-md text-xs text-slate-500 leading-relaxed">
                    {tr(
                      '在 Figma 中通过 File → Save local copy… 即可导出 .fig 文件。无需配置 Token，支持离线解析完整画板与图片。',
                      'In Figma, choose File → Save local copy… to export a .fig archive. No API token needed.',
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Online Figma REST API */}
          {!doc && tab === 'url' && (
            <form onSubmit={handleFetchFromUrl} className="space-y-3.5">
              <div className="space-y-1.5">
                <label htmlFor="figma-url-input" className="block text-xs font-semibold text-slate-700">
                  {tr('Figma 文件或画板链接', 'Figma File or Frame URL')}
                </label>
                <input
                  id="figma-url-input"
                  type="url"
                  required
                  autoFocus
                  disabled={parsing}
                  value={figmaUrl}
                  onChange={(e) => setFigmaUrl(e.target.value)}
                  placeholder="https://www.figma.com/design/abc123XYZ/Product-Design?node-id=..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>

              {detectedUrlNodeId && (
                <label className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2 text-xs text-blue-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scopeToUrlNode}
                    onChange={(e) => setScopeToUrlNode(e.target.checked)}
                    className="rounded border-blue-300 text-blue-600"
                  />
                  <span>
                    {tr(
                      `链接包含指定节点 (${detectedUrlNodeId})，仅拉取该节点/画板（大幅加快大型设计稿读取速度）`,
                      `URL specifies node (${detectedUrlNodeId}) — fetch only this node/frame for faster loading`,
                    )}
                  </span>
                </label>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="figma-token-input" className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <KeyRound className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    <span>{tr('Figma Personal Access Token', 'Figma Personal Access Token')}</span>
                  </label>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    {tr('Figma Settings → Security → Personal access tokens', 'Figma Settings → Security → Personal access tokens')}
                  </span>
                </div>
                <input
                  id="figma-token-input"
                  type="password"
                  required
                  disabled={parsing}
                  value={figmaToken}
                  onChange={(e) => {
                    tokenTouchedRef.current = true;
                    setFigmaToken(e.target.value);
                  }}
                  placeholder="figd_..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                />
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberToken}
                    disabled={clearingToken || parsing || saving}
                    onChange={e => changeRememberToken(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>{tr('在本机安全记住此 Token，下次免填', 'Remember token securely on this device')}</span>
                </label>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={parsing || clearingToken || !figmaUrl.trim() || !figmaToken.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {parsing && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  <span>{parsing ? tr('正在连接 Figma 拉取画板…', 'Fetching frames from Figma…') : tr('读取画板目录', 'Fetch Frames')}</span>
                </button>
              </div>
            </form>
          )}

          {/* Step 2: Frame & Canvas Tree Picker */}
          {doc && summary && (
            <div className="space-y-3">
              {/* Summary Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900 truncate">{doc.name}</span>
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                      {summary.modeLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 tabular-nums">
                    {tr(
                      `已选 ${summary.selectedCount} / ${summary.totalFrames} 个画板（桌面 ${summary.desktopCount} · 移动 ${summary.mobileCount}）· ${summary.autoLayouts} 处 Auto Layout · ${summary.links} 条原型跳转`,
                      `${summary.selectedCount} / ${summary.totalFrames} frames selected (${summary.desktopCount} desktop · ${summary.mobileCount} mobile) · ${summary.autoLayouts} Auto Layouts · ${summary.links} links`,
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setDoc(null);
                    setError('');
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  {tr('更换来源', 'Change Source')}
                </button>
              </div>

              {tokenPersistenceHint && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-800">
                  {tokenPersistenceHint}
                </div>
              )}

              {(doc.imagesIndexError || doc.warnings.length > 0) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 space-y-0.5">
                  {doc.imagesIndexError && (
                    <div>
                      {tr(
                        `Figma 图片下载地址索引获取异常（${doc.imagesIndexError}），所选画板中的位图将自动降级为占位显示。`,
                        `Figma image index request failed (${doc.imagesIndexError}); bitmap layers on selected frames will use placeholders.`,
                      )}
                    </div>
                  )}
                  {doc.warnings.map((w, idx) => (
                    <div key={idx}>{td(w)}</div>
                  ))}
                </div>
              )}

              {summary.skippedSpecs > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-800">
                  <span>
                    {tr(
                      `已自动识别并默认跳过 ${summary.skippedSpecs} 个组件规范/图标库画板，避免污染业务菜单；如需导入可在下方手动勾选。`,
                      `Auto-skipped ${summary.skippedSpecs} design-system/component sheet(s) to keep your sitemap clean. You can still check them manually below.`,
                    )}
                  </span>
                </div>
              )}

              {/* Quick Selection Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                  <span>{tr('勾选要生成页面的顶层画板 (Frame)', 'Select top-level Frames to import as pages')}</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = new Set<string>();
                      for (const c of doc.canvases) {
                        for (const f of c.frames) {
                          if (!f.isComponentSheet) next.add(f.pageId);
                        }
                      }
                      setSelectedPageIds(next);
                    }}
                    className="text-blue-600 hover:underline cursor-pointer"
                  >
                    {tr('仅选业务画板', 'Business Only')}
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = new Set<string>();
                      for (const c of doc.canvases) for (const f of c.frames) next.add(f.pageId);
                      setSelectedPageIds(next);
                    }}
                    className="text-slate-600 hover:text-slate-900 hover:underline cursor-pointer"
                  >
                    {tr('全选', 'Select All')}
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedPageIds(new Set())}
                    className="text-slate-600 hover:text-slate-900 hover:underline cursor-pointer"
                  >
                    {tr('清空', 'Clear')}
                  </button>
                </div>
              </div>

              {/* Canvas -> Frame Tree */}
              <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                {doc.canvases.map((canvas) => {
                  const frameIds = canvas.frames.map((f) => f.pageId);
                  const checkedInCanvas = frameIds.filter((id) => selectedPageIds.has(id)).length;
                  const allChecked = checkedInCanvas === frameIds.length && frameIds.length > 0;
                  return (
                    <div key={canvas.id} className="bg-white">
                      <div className="flex items-center justify-between gap-2 bg-slate-50/90 px-3.5 py-2">
                        <button
                          type="button"
                          onClick={() => toggleCanvas(frameIds, !allChecked)}
                          className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer min-w-0"
                        >
                          {allChecked ? (
                            <CheckSquare className="h-4 w-4 text-blue-600 shrink-0" aria-hidden="true" />
                          ) : (
                            <Square className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                          )}
                          <span className="truncate">{canvas.name}</span>
                          {canvas.isDesignSystemCanvas && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 shrink-0">
                              {tr('组件/规范页', 'Design System')}
                            </span>
                          )}
                        </button>
                        <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                          {checkedInCanvas} / {frameIds.length}
                        </span>
                      </div>
                      <ul className="divide-y divide-slate-100">
                        {canvas.frames.map((frame) => {
                          const checked = selectedPageIds.has(frame.pageId);
                          return (
                            <li key={frame.pageId}>
                              <label className="flex items-center justify-between gap-3 px-4 py-2 text-xs hover:bg-slate-50 cursor-pointer">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePage(frame.pageId)}
                                    className="rounded border-slate-300 text-blue-600 shrink-0"
                                  />
                                  {frame.sectionName && (
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 shrink-0">
                                      {frame.sectionName}
                                    </span>
                                  )}
                                  <span className="font-medium text-slate-800 truncate">{frame.name}</span>
                                  {frame.isComponentSheet && !canvas.isDesignSystemCanvas && (
                                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 shrink-0">
                                      {tr('组件', 'Component')}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0 tabular-nums text-[11px] text-slate-500">
                                  <span>{frame.nodeCount} {tr('图层', 'layers')}</span>
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                      frame.platform === 'mobile'
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : 'bg-blue-50 text-blue-700'
                                    }`}
                                  >
                                    {frame.platform === 'mobile' ? (
                                      <Smartphone className="h-3 w-3" aria-hidden="true" />
                                    ) : (
                                      <Monitor className="h-3 w-3" aria-hidden="true" />
                                    )}
                                    {frame.width}×{frame.height}
                                  </span>
                                </div>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-start gap-2 rounded-xl bg-blue-50/60 border border-blue-100 px-3.5 py-2.5 text-[11px] text-slate-600">
                <Sparkles className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  {tr(
                    '导入后将生成保留 Auto Layout 与可编辑图层的 .pflow 工程；进入工作台后可在「AI 助手」一键将设计画板语义重构为标准业务表格、表单并自动建表。',
                    'Creates an editable .pflow project preserving Auto Layout and layers. Inside the workspace, use AI Assistant to reshape frames into standard Tables, Forms, and DB schemas.',
                  )}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-3.5 bg-slate-50/60">
          <button
            type="button"
            disabled={saving}
            onClick={() => void requestClose()}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
          >
            {tr('取消', 'Cancel')}
          </button>
          {doc && (
            <button
              type="button"
              disabled={saving || clearingToken || selectedPageIds.size === 0}
              onClick={() => void handleConfirmImport()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700 cursor-pointer disabled:opacity-50"
            >
              {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              <span>
                {saving
                  ? tr('正在生成工程…', 'Creating Project…')
                  : tr(`导入所选 ${selectedPageIds.size} 个画板为新工程`, `Import ${selectedPageIds.size} Frame(s) as New Project`)}
              </span>
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
};

function FigmaImportResult({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { tr, td } = useI18n();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby="figma-result-title" onCancel={onClose}
      className="m-auto w-[560px] max-w-[95vw] max-h-[85vh] overflow-auto rounded-2xl p-6 text-slate-800 backdrop:bg-slate-900/45">
      <h2 id="figma-result-title" className="font-bold">{tr('工程已保存，导入完成', 'Project saved and imported')}</h2>
      {result.publishWarning && <p className="mt-3 text-sm text-amber-800">{result.publishWarning}</p>}
      {result.warnings.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-sm">{result.warnings.map(w => <li key={w}>{td(w)}</li>)}</ul>
      )}
      {result.pages.map(page => (
        <section key={page.pageId} className="mt-3 text-sm">
          <h3 className="font-semibold">{page.title}{page.omittedImages > 0 && tr(`（${page.omittedImages} 处缺图）`, ` (${page.omittedImages} missing images)`)}</h3>
          <ul className="mt-1 list-disc pl-5">{page.warnings.map(w => <li key={w}>{td(w)}</li>)}</ul>
        </section>
      ))}
      <button type="button" autoFocus className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white" onClick={onClose}>
        {tr('完成', 'Done')}
      </button>
    </dialog>
  );
}

export function useFigmaImport() {
  const [modalState, setModalState] = useState<{
    open: boolean;
    result?: ImportResult;
    files?: File[] | null;
    tab?: FigmaImportTab;
  }>({ open: false });

  useEffect(() => {
    const dragover = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const dropped = Array.from(e.dataTransfer?.files ?? []);
      const figFiles = dropped.filter((f) => /\.fig$/i.test(f.name));
      if (!figFiles.length) return;
      e.preventDefault();
      e.stopPropagation();
      setModalState((cur) => (cur.open || cur.result ? cur : { open: true, files: figFiles, tab: 'file' }));
    };
    window.addEventListener('dragover', dragover, true);
    window.addEventListener('drop', drop, true);
    return () => {
      window.removeEventListener('dragover', dragover, true);
      window.removeEventListener('drop', drop, true);
    };
  }, []);

  return {
    openFigma: (tab: FigmaImportTab = 'file') => setModalState({ open: true, files: null, tab }),
    openFigmaFiles: (files: File[]) => setModalState({ open: true, files, tab: 'file' }),
    ui: modalState.open ? (
      <FigmaImportDialog
        initialFiles={modalState.files}
        initialTab={modalState.tab}
        onClose={result => setModalState({ open: false, result })}
      />
    ) : modalState.result ? (
      <FigmaImportResult result={modalState.result} onClose={() => setModalState({ open: false })} />
    ) : null,
  };
}
