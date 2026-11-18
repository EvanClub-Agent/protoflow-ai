import {
  NOTE_ASSET_SCHEME,
  NOTE_STATUS_OPTIONS,
  noteAssetDataUrl,
  noteHtmlToMarkdown,
  type NoteAsset,
  type NoteNode,
} from './notes';
import { sanitizeNoteHtml } from './noteHtmlSanitize';

type Note = Extract<NoteNode, { kind: 'note' }>;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const statusLabel = (id?: string) => NOTE_STATUS_OPTIONS.find((s) => s.id === (id ?? 'draft'))?.label ?? '';

/** One Markdown file for several notes, with images embedded so nothing is lost. */
export function buildNotesMarkdownBundle(
  projectName: string,
  notes: Note[],
  assets: Record<string, NoteAsset> | undefined
): string {
  const toc = notes.map((n, i) => `${i + 1}. ${n.title}`).join('\n');
  const body = notes
    .map((note) => {
      const meta = [
        `状态：${statusLabel(note.status)}`,
        note.priority ? `优先级：${note.priority}` : '',
        note.stakeholder ? `对接人：${note.stakeholder}` : '',
        note.meetingDate ? `沟通日期：${note.meetingDate}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const md = noteHtmlToMarkdown(note, { images: 'inline', assets }).replace(/^# /, '## ');
      return `${md.split('\n')[0]}\n\n> ${meta}\n${md.split('\n').slice(1).join('\n')}`;
    })
    .join('\n\n---\n\n');
  return `# ${projectName} · 需求文档包\n\n> 导出时间：${new Date().toLocaleString('zh-CN')} · 共 ${notes.length} 篇\n\n## 目录\n\n${toc}\n\n---\n\n${body}\n`;
}

/**
 * Self-contained, print-friendly HTML document (open in a browser, send by mail, or print to
 * PDF). Note HTML is allow-list sanitized and images are inlined.
 */
export function buildNotesHtmlDocument(
  projectName: string,
  notes: Note[],
  assets: Record<string, NoteAsset> | undefined
): string {
  const sections = notes
    .map((note, index) => {
      const html = sanitizeNoteHtml(note.content, {
        resolveImage: (src) => {
          if (!src.startsWith(NOTE_ASSET_SCHEME)) return null;
          const asset = assets?.[src.slice(NOTE_ASSET_SCHEME.length)];
          return asset ? noteAssetDataUrl(asset) : null;
        },
      });
      const meta = [
        statusLabel(note.status),
        note.priority ?? '',
        note.stakeholder ? `对接人 ${note.stakeholder}` : '',
        note.meetingDate ? `沟通日期 ${note.meetingDate}` : '',
      ]
        .filter(Boolean)
        .map((m) => `<span>${escapeHtml(m)}</span>`)
        .join('');
      return `<section id="note-${index + 1}"><h1>${escapeHtml(note.icon)} ${escapeHtml(note.title)}</h1><div class="meta">${meta}</div><div class="body">${html}</div></section>`;
    })
    .join('');
  const toc = notes.map((n, i) => `<li><a href="#note-${i + 1}">${escapeHtml(n.title)}</a></li>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escapeHtml(projectName)} · 需求文档包</title>
<style>
body{font:14px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1e293b;max-width:860px;margin:0 auto;padding:32px 24px;}
header{border-bottom:2px solid #2563eb;margin-bottom:24px;padding-bottom:12px}header h1{margin:0;font-size:24px}header p{color:#64748b;margin:4px 0 0}
nav{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 20px;margin-bottom:28px}nav a{color:#2563eb;text-decoration:none}
section{page-break-before:always;padding-top:8px}section:first-of-type{page-break-before:auto}
section>h1{font-size:20px;margin:0 0 6px}.meta span{display:inline-block;font-size:12px;color:#475569;background:#f1f5f9;border-radius:6px;padding:1px 8px;margin:0 6px 12px 0}
h2{font-size:17px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}h3{font-size:15px}
table{border-collapse:collapse;width:100%;font-size:13px;margin:12px 0}th,td{border:1px solid #e2e8f0;padding:6px 10px;text-align:left;vertical-align:top}th{background:#f8fafc}
blockquote{margin:12px 0;padding:10px 14px;border-left:4px solid #2563eb;background:#f8fafc;border-radius:0 8px 8px 0}
pre{background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}
mark{background:#fef08a}img{max-width:100%;border:1px solid #e2e8f0;border-radius:10px}
ul[data-type=taskList]{list-style:none;padding-left:4px}ul[data-type=taskList] li{display:flex;gap:8px}ul[data-type=taskList] li>label{flex:none}
li[data-checked=true]>div{text-decoration:line-through;color:#94a3b8}
@media print{body{padding:0}nav{display:none}}
</style></head><body>
<header><h1>${escapeHtml(projectName)} · 需求文档包</h1><p>导出时间 ${escapeHtml(new Date().toLocaleString('zh-CN'))} · 共 ${notes.length} 篇</p></header>
<nav><strong>目录</strong><ol>${toc}</ol></nav>
${sections}
</body></html>`;
}

export function downloadTextFile(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.replace(/[\\/:*?"<>|]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
