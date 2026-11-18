import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { getHermesApi, type HermesImageAttachment } from '../../services/hermesClient';
import { validImageReference, type ChatImageDraft } from '../../services/chatImages';

export function ChatImageThumbnail({ name, preview, attachment }: { name: string; preview?: string; attachment?: HermesImageAttachment }) {
  const [storedPreview, setStoredPreview] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!attachment) return;
    let cancelled = false;
    setStoredPreview(''); setError('');
    const load = async () => {
      try {
        const api = getHermesApi();
        if (!api.readImage) throw new Error('请重启桌面应用查看图片');
        const record = await api.readImage(attachment);
        if (!validImageReference(record, attachment) || record.id !== attachment.id || record.mimeType !== attachment.mimeType || record.size !== attachment.size || record.name !== attachment.name || typeof record.data !== 'string')
          throw new Error('图片附件信息不匹配');
        if (!cancelled) setStoredPreview(`data:${record.mimeType};base64,${record.data}`);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
    };
    // Only read historical media when its bubble is near the visible viewport.
    if (typeof IntersectionObserver === 'undefined' || !container.current) { void load(); return () => { cancelled = true; }; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); }
    }, { rootMargin: '200px' });
    observer.observe(container.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [attachment?.projectId, attachment?.pageId, attachment?.kind, attachment?.threadId, attachment?.id, retry]);
  const src = preview ?? storedPreview;
  return <div ref={container} className="min-w-0">
    <button type="button" title={error || `查看图片：${name}`} aria-label={error ? `重新加载图片：${name}` : `查看图片：${name}`}
      onClick={() => error ? setRetry(n => n + 1) : dialog.current?.showModal()} disabled={!src && !error}
      className="w-full h-20 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center text-[10px] text-slate-500 cursor-pointer">
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : <span className="p-1">{error ? '图片未加载，点击重试' : '正在读取图片…'}</span>}
    </button>
    <dialog ref={dialog} aria-label={`图片预览：${name}`} className="m-auto max-w-[90vw] max-h-[90vh] rounded-xl p-3 backdrop:bg-slate-900/60 shadow-xl"
      onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="flex items-center justify-between gap-4 mb-2"><span className="text-sm truncate">{name}</span><button type="button" aria-label="关闭图片预览" onClick={() => dialog.current?.close()} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button></div>
      {src && <img src={src} alt={name} className="max-w-[85vw] max-h-[78vh] object-contain" />}
    </dialog>
  </div>;
}

export function ChatImageDraftList({ images, disabled, onRemove }: {
  images: ChatImageDraft[]; disabled: boolean; onRemove: (index: number) => void;
}) {
  if (!images.length) return null;
  return <div className="mb-1 grid max-w-sm grid-cols-4 gap-1.5 pt-0.5">
    {images.map((image, index) => <div key={index} className="relative min-w-0">
      <ChatImageThumbnail name={image.name} preview={image.preview}/>
      <button type="button" aria-label={`移除图片：${image.name}`} title="移除图片" disabled={disabled} onClick={() => onRemove(index)}
        className="absolute -top-1 -right-1 rounded-full bg-slate-700 p-0.5 text-white hover:bg-rose-600 disabled:opacity-40">
        <X size={12}/>
      </button>
    </div>)}
  </div>;
}
