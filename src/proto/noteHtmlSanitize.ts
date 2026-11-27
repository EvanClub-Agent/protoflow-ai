/**
 * Allow-list sanitizer for note HTML that leaves the editor (online shares, exports, viewer).
 * Unknown elements are unwrapped (their text survives); scripts, styles and embeds are removed;
 * only a handful of attributes are kept, and links / images are filtered through callbacks.
 * Requires a DOM (browser, Electron renderer or jsdom).
 */
const ALLOWED = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'MARK', 'CODE', 'PRE',
  'BLOCKQUOTE', 'HR', 'BR', 'TABLE', 'COLGROUP', 'COL', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'IMG', 'LABEL', 'INPUT', 'DIV', 'SPAN',
]);
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'FORM', 'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META', 'BASE']);
const ATTRS: Record<string, string[]> = {
  A: ['href'],
  IMG: ['src', 'alt'],
  UL: ['data-type'],
  LI: ['data-type', 'data-checked'],
  BLOCKQUOTE: ['data-callout'],
  CODE: ['class'],
  TD: ['colspan', 'rowspan', 'colwidth'],
  TH: ['colspan', 'rowspan', 'colwidth'],
  INPUT: ['type', 'checked'],
};
const VALID_CALLOUTS = new Set(['note', 'tip', 'important', 'warning', 'caution']);

export interface NoteSanitizeOptions {
  /** Return the src to keep (possibly rewritten), or null to drop the image. */
  resolveImage: (src: string) => string | null;
  /** Whether an in-app page link (`#pf-page:<id>`) should stay a link. Others become plain text. */
  keepPageLink?: (pageId: string) => boolean;
  /** Whether an in-app note link (`#pf-note:<id>`) should stay a link. */
  keepNoteLink?: (noteId: string) => boolean;
  /** Whether an in-app table link (`#pf-table:<id>`) should stay a link. */
  keepTableLink?: (tableId: string) => boolean;
  /** Whether an in-app mindmap link (`#pf-mindmap:<id>`) should stay a link. */
  keepMindmapLink?: (mindmapId: string) => boolean;
}

export function sanitizeNoteHtml(html: string, options: NoteSanitizeOptions): string {
  const Parser =
    typeof DOMParser !== 'undefined'
      ? DOMParser
      : typeof window !== 'undefined' && typeof window.DOMParser === 'function'
        ? window.DOMParser
        : undefined;
  if (!Parser) throw new Error('当前环境无法安全处理笔记内容');
  const doc = new Parser().parseFromString(`<body>${html}</body>`, 'text/html');
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName.toUpperCase();
      if (DROP_WITH_CONTENT.has(tag)) {
        child.remove();
        continue;
      }
      visit(child);
      if (!ALLOWED.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      const keep = new Set(ATTRS[tag] ?? []);
      for (const attr of Array.from(child.attributes)) {
        if (!keep.has(attr.name.toLowerCase())) child.removeAttribute(attr.name);
      }
      if (tag === 'A') {
        const href = child.getAttribute('href') ?? '';
        const pageId = href.startsWith('#pf-page:') ? href.slice('#pf-page:'.length) : null;
        if (pageId !== null && options.keepPageLink?.(pageId)) continue;
        const noteId = href.startsWith('#pf-note:') ? href.slice('#pf-note:'.length) : null;
        if (noteId !== null && options.keepNoteLink?.(noteId)) continue;
        const tableId = href.startsWith('#pf-table:') ? href.slice('#pf-table:'.length) : null;
        if (tableId !== null && options.keepTableLink?.(tableId)) continue;
        const mindmapId = href.startsWith('#pf-mindmap:') ? href.slice('#pf-mindmap:'.length) : null;
        if (mindmapId !== null && options.keepMindmapLink?.(mindmapId)) continue;
        if (/^https?:\/\//i.test(href)) {
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
          continue;
        }
        child.replaceWith(...Array.from(child.childNodes));
      } else if (tag === 'IMG') {
        const src = options.resolveImage(child.getAttribute('src') ?? '');
        if (src === null) child.remove();
        else child.setAttribute('src', src);
      } else if (tag === 'INPUT') {
        if ((child.getAttribute('type') ?? '').toLowerCase() !== 'checkbox') child.remove();
        else child.setAttribute('disabled', '');
      } else if (tag === 'LI' || tag === 'UL') {
        const type = child.getAttribute('data-type');
        if (type !== null && type !== 'taskItem' && type !== 'taskList') child.removeAttribute('data-type');
        const checked = child.getAttribute('data-checked');
        if (checked !== null && checked !== 'true' && checked !== 'false') child.removeAttribute('data-checked');
      } else if (tag === 'BLOCKQUOTE') {
        const callout = (child.getAttribute('data-callout') ?? '').toLowerCase();
        if (!VALID_CALLOUTS.has(callout)) child.removeAttribute('data-callout');
        else child.setAttribute('data-callout', callout);
      } else if (tag === 'CODE') {
        const cls = child.getAttribute('class') ?? '';
        const langMatch = /^language-[a-zA-Z0-9_+-]+$/.exec(cls.trim());
        if (!langMatch) child.removeAttribute('class');
      } else if (tag === 'TD' || tag === 'TH') {
        for (const name of ['colspan', 'rowspan']) {
          const value = child.getAttribute(name);
          if (value !== null && !/^[1-9]\d?$/.test(value)) child.removeAttribute(name);
        }
        const colwidth = child.getAttribute('colwidth');
        if (colwidth !== null && !/^\d{2,4}(?:,\d{2,4})*$/.test(colwidth)) {
          child.removeAttribute('colwidth');
        }
      }
    }
  };
  visit(doc.body);
  return doc.body.innerHTML;
}
