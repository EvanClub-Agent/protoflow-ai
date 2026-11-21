import React, { useEffect, useRef, useState } from 'react';
import RpWorker from '../proto/axure/import.worker?worker&inline';
import { MAX_RP_BYTES } from '../proto/axure/binary';
import type { AxureImport } from '../proto/axure/import';
import { flushProjectChanges, loadProjectFromBinaryPayload } from '../services/projectStorage';
import { createAxureProject } from '../services/axureProject';
import { encodePflowBinary } from '../utils/pflowBinaryCodec';

interface ImportBridge {
  isElectron?: boolean;
  defaultProjectsDirectory(): Promise<string>;
  writeBinaryProject(input: { dirPath: string; fileName: string; binaryBytes: Uint8Array }): Promise<{ saved: boolean }>;
}

function ImportDialog({ files, close }: { files: File[]; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<AxureImport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    let disposed = false;
    let worker: Worker | undefined;
    async function read() {
      if (files.length !== 1) throw new Error('请每次选择一个 .rp 文件');
      const file = files[0];
      if (file.size > MAX_RP_BYTES) throw new Error('文件超过 128 MiB 导入上限');
      const bytes = await file.arrayBuffer();
      if (disposed) return;
      worker = new RpWorker();
      worker.onmessage = ({ data }: MessageEvent<{ project: AxureImport } | { error: string }>) => {
        if ('error' in data) setError(data.error); else setProject(data.project);
        worker?.terminate();
      };
      worker.onerror = () => { setError('本地解析器运行失败，请重新选择文件'); worker?.terminate(); };
      worker.postMessage(bytes, [bytes]);
    }
    void read().catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; worker?.terminate(); el.close(); };
  }, [files]);

  const save = async () => {
    if (!project || busy.current) return;
    busy.current = true; setSaving(true); setError('');
    try {
      const desktop = (window as unknown as { protoflowDesktop?: ImportBridge }).protoflowDesktop;
      const parent = desktop?.isElectron ? await desktop.defaultProjectsDirectory() : './AlexProjects';
      const payload = createAxureProject(files[0].name, parent, project);
      const binaryBytes = encodePflowBinary(payload);
      await flushProjectChanges();
      if (desktop?.isElectron) {
        const result = await desktop.writeBinaryProject({ dirPath: payload.meta.storageDir, fileName: payload.meta.fileName, binaryBytes });
        if (!result.saved) throw new Error('工程未保存，请重试');
      } else {
        const url = URL.createObjectURL(new Blob([binaryBytes], { type: 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url; a.download = payload.meta.fileName; a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      loadProjectFromBinaryPayload(payload);
      close();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { busy.current = false; setSaving(false); }
  };

  return <dialog ref={dialog} aria-labelledby="rp-import-title" onCancel={e => { e.preventDefault(); if (!busy.current) close(); }}
    className="m-auto w-[520px] max-w-[94vw] max-h-[85vh] overscroll-contain rounded-2xl border border-slate-200 bg-white p-5 text-slate-800 shadow-xl backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-slate-900/40">
    <h2 id="rp-import-title" className="text-base font-semibold">导入 Axure 原型</h2>
    <p className="mt-1 break-all text-xs text-slate-500">{files.map(f => f.name).join('、')}</p>
    {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {!project && !error && <p role="status" className="mt-4 text-sm">正在本机解析 RP 文件…</p>}
    {project && <div className="my-4 space-y-2 text-sm">
      <p>Axure RP {project.version} · {project.report.length} 个页面 · {project.report.reduce((n, p) => n + p.widgets, 0)} 个已转换元件 · {project.report.reduce((n, p) => n + p.clicks, 0)} 个已转换点击事件（含 {project.report.reduce((n, p) => n + p.links, 0)} 个页面跳转）</p>
      <p className="text-xs text-slate-600">生成可编辑的 .pflow 工程。表格单元格、文本和表单控件可单独编辑。{project.report.filter(p => p.warnings.length > 0).length} 页有转换限制，可在下方核对。</p>
      <ul className="max-h-52 space-y-2 overflow-auto rounded-lg border border-slate-200 p-3">
        {project.report.map((p, i) => <li key={project.designerPages[i].pageId}><b>{p.title}</b> · {p.widgets} 个元件
          {p.warnings.length > 0 && <div className="mt-1 text-xs text-amber-700">{p.warnings.join('；')}</div>}</li>)}
      </ul>
    </div>}
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" autoFocus disabled={saving} onClick={close} className="rounded-lg border px-3 py-2 text-xs">取消</button>
      {project && <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-blue-600 px-3 py-2 text-xs text-white disabled:opacity-50">
        {saving ? '正在保存…' : '导入为新工程'}</button>}
    </div>
  </dialog>;
}

export function useAxureImport() {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[] | null>(null);
  useEffect(() => {
    const dragover = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const dropped = Array.from(e.dataTransfer?.files ?? []);
      if (!dropped.some(f => /\.rp$/i.test(f.name))) return;
      e.preventDefault(); e.stopPropagation();
      setFiles(current => current ?? dropped);
    };
    // Capture actual OS file drops before the designer's own node-reorder
    // handlers. In-app component and attachment drags keep their normal path.
    window.addEventListener('dragover', dragover, true);
    window.addEventListener('drop', drop, true);
    return () => {
      window.removeEventListener('dragover', dragover, true);
      window.removeEventListener('drop', drop, true);
    };
  }, []);
  return { pick: () => input.current?.click(), ui: <>
    <input ref={input} type="file" accept=".rp" hidden aria-label="选择 Axure RP 文件" onChange={e => {
      const file = e.currentTarget.files?.[0];
      if (file) setFiles([file]);
      e.currentTarget.value = '';
    }} />
    {files && <ImportDialog files={files} close={() => setFiles(null)} />}
  </> };
}
