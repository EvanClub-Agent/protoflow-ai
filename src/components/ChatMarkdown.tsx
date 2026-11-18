import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckSquare,
  Copy,
  Info,
  Lightbulb,
  Sparkles,
  Square,
  Terminal,
} from 'lucide-react';

interface ChatMarkdownProps {
  content: string;
  /** Whether the message is currently streaming (renders an inline spinner at the tail) */
  streaming?: boolean;
  /** Optional tone override for user bubble vs assistant surface */
  tone?: 'assistant' | 'user' | 'error';
}

type AlertKind = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'code'; lang: string; code: string; closed: boolean }
  | { type: 'alert'; kind: AlertKind; title: string; lines: string[] }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'list'; ordered: boolean; items: { text: string; checked?: boolean; index?: number }[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'hr' }
  | { type: 'paragraph'; text: string };

const ALERT_META: Record<
  AlertKind,
  { label: string; icon: React.FC<{ className?: string }>; boxCls: string; titleCls: string }
> = {
  NOTE: {
    label: '说明',
    icon: Info,
    boxCls: 'border-blue-200/90 bg-blue-50/70 text-slate-700',
    titleCls: 'text-blue-700',
  },
  TIP: {
    label: '建议',
    icon: Lightbulb,
    boxCls: 'border-emerald-200/90 bg-emerald-50/70 text-slate-700',
    titleCls: 'text-emerald-700',
  },
  IMPORTANT: {
    label: '重要',
    icon: Sparkles,
    boxCls: 'border-indigo-200/90 bg-indigo-50/70 text-slate-700',
    titleCls: 'text-indigo-700',
  },
  WARNING: {
    label: '注意',
    icon: AlertTriangle,
    boxCls: 'border-amber-200/90 bg-amber-50/75 text-slate-700',
    titleCls: 'text-amber-800',
  },
  CAUTION: {
    label: '警告',
    icon: AlertCircle,
    boxCls: 'border-rose-200/90 bg-rose-50/75 text-slate-700',
    titleCls: 'text-rose-700',
  },
};

function splitTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, '');
  return trimmed.split('|').map(cell => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') && !trimmed.includes('-')) return false;
  const cells = splitTableCells(trimmed);
  return cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(c));
}

export function parseMarkdownBlocks(raw: string): MarkdownBlock[] {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Skip blank lines
    if (!trimmed) {
      i++;
      continue;
    }

    // 2. Fenced code block: ```lang
    const fenceMatch = /^```([a-zA-Z0-9_+-]*)\s*$/.exec(trimmed);
    if (fenceMatch) {
      const lang = fenceMatch[1] || 'text';
      const codeLines: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (/^```\s*$/.test(lines[i].trim())) {
          closed = true;
          i++;
          break;
        }
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'code',
        lang,
        code: codeLines.join('\n'),
        closed,
      });
      continue;
    }

    // 3. Horizontal rule
    if (/^(?:---|\*\*\*|___)\s*$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 4. Heading (# .. ####)
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(4, headingMatch[1].length) as 1 | 2 | 3 | 4;
      blocks.push({ type: 'heading', level, text: headingMatch[2].trim() });
      i++;
      continue;
    }

    // 5. Blockquote or GitHub-style Alert (> [!NOTE] ...)
    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const alertHeader = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(
        quoteLines[0] ?? ''
      );
      if (alertHeader) {
        const kind = alertHeader[1].toUpperCase() as AlertKind;
        const customTitle = alertHeader[2].trim();
        const bodyLines = quoteLines.slice(1).filter(Boolean);
        blocks.push({
          type: 'alert',
          kind,
          title: customTitle || ALERT_META[kind].label,
          lines: bodyLines,
        });
      } else {
        blocks.push({
          type: 'blockquote',
          lines: quoteLines.filter((l, idx) => Boolean(l) || idx === 0),
        });
      }
      continue;
    }

    // 6. GFM Table (Header row + | --- | separator row)
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableCells(line);
      i += 2; // skip header and separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableCells(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // 7. Unordered or Ordered List
    const ulMatch = /^[-*+]\s+(.+)$/.exec(trimmed);
    const olMatch = /^(\d+)[.)]\s+(.+)$/.exec(trimmed);
    if (ulMatch || olMatch) {
      const ordered = Boolean(olMatch);
      const items: { text: string; checked?: boolean; index?: number }[] = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        const curUl = /^[-*+]\s+(.+)$/.exec(cur);
        const curOl = /^(\d+)[.)]\s+(.+)$/.exec(cur);
        if ((ordered && !curOl) || (!ordered && !curUl)) break;
        const rawItemText = ordered ? curOl![2] : curUl![1];
        const taskMatch = /^\[([ xX])\]\s+(.+)$/.exec(rawItemText);
        if (taskMatch) {
          items.push({
            text: taskMatch[2],
            checked: taskMatch[1].toLowerCase() === 'x',
            index: ordered ? Number(curOl![1]) : undefined,
          });
        } else {
          items.push({
            text: rawItemText,
            index: ordered ? Number(curOl![1]) : undefined,
          });
        }
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // 8. Paragraph (consume consecutive normal lines)
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        !next ||
        /^```/.test(next) ||
        /^(#{1,4})\s+/.test(next) ||
        /^>\s?/.test(next) ||
        /^(?:---|\*\*\*|___)\s*$/.test(next) ||
        /^[-*+]\s+/.test(next) ||
        /^\d+[.)]\s+/.test(next) ||
        (next.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
  }

  return blocks;
}

const INLINE_TOKEN_RE =
  /(`[^`\n]+`|\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|~~[^~\n]+~~|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;

export function renderInlineMarkdown(
  text: string,
  tone: 'assistant' | 'user' | 'error' = 'assistant'
): React.ReactNode[] {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) {
      result.push(<br key={`br-${lineIdx}`} />);
    }
    const parts = line.split(INLINE_TOKEN_RE);
    parts.forEach((part, partIdx) => {
      if (!part) return;
      const key = `${lineIdx}-${partIdx}`;

      // 1. Inline code: `code`
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        const code = part.slice(1, -1);
        result.push(
          <code
            key={key}
            className={
              tone === 'user'
                ? 'rounded-md bg-white/20 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white'
                : 'pf-md-inline-code rounded-md border border-slate-200/90 bg-slate-100/90 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-800'
            }
          >
            {code}
          </code>
        );
        return;
      }

      // 2. Bold + Italic: ***text***
      if (part.startsWith('***') && part.endsWith('***') && part.length > 6) {
        result.push(
          <strong key={key} className="font-semibold italic">
            {part.slice(3, -3)}
          </strong>
        );
        return;
      }

      // 3. Bold: **text** or __text__
      if (
        ((part.startsWith('**') && part.endsWith('**')) ||
          (part.startsWith('__') && part.endsWith('__'))) &&
        part.length > 4
      ) {
        result.push(
          <strong
            key={key}
            className={tone === 'user' ? 'font-bold text-white' : 'font-semibold text-slate-900'}
          >
            {part.slice(2, -2)}
          </strong>
        );
        return;
      }

      // 4. Italic: *text*
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        result.push(
          <em key={key} className="italic">
            {part.slice(1, -1)}
          </em>
        );
        return;
      }

      // 5. Strikethrough: ~~text~~
      if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) {
        result.push(
          <del key={key} className="line-through opacity-70">
            {part.slice(2, -2)}
          </del>
        );
        return;
      }

      // 6. Link: [label](https://...)
      const linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
      if (linkMatch) {
        result.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className={
              tone === 'user'
                ? 'font-medium text-white underline underline-offset-2'
                : 'font-medium text-blue-600 hover:text-blue-700 underline underline-offset-2'
            }
          >
            {linkMatch[1]}
          </a>
        );
        return;
      }

      result.push(part);
    });
  });

  return result;
}

const CodeBlockCard: React.FC<{ lang: string; code: string; closed: boolean }> = ({
  lang,
  code,
  closed,
}) => {
  const [copied, setCopied] = useState(false);
  const lineCount = code ? code.split('\n').length : 1;

  const handleCopy = () => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="pf-md-code-block my-1.5 overflow-hidden rounded-xl border border-slate-200/90 bg-slate-900 text-slate-100 shadow-2xs">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/80 px-3 py-1.5 text-[10px] text-slate-400">
        <span className="inline-flex items-center gap-1.5 font-mono font-semibold uppercase tracking-wider text-slate-300">
          <Terminal className="h-3 w-3 text-blue-400" />
          <span>{lang || 'code'}</span>
          <span className="font-normal text-slate-500">· {lineCount} 行</span>
          {!closed && <span className="text-blue-400 animate-pulse">· 编写中</span>}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer transition"
          title="复制代码"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400">已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <pre className="max-h-64 overflow-x-auto overflow-y-auto p-3 font-mono text-[11.5px] leading-[1.6] text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const ChatMarkdown: React.FC<ChatMarkdownProps> = React.memo(function ChatMarkdown({
  content,
  streaming = false,
  tone = 'assistant',
}) {
  const blocks = parseMarkdownBlocks(content);

  if (blocks.length === 0) {
    return streaming ? (
      <span className="inline-flex items-center gap-1.5 text-slate-500">
        <span>正在思考…</span>
      </span>
    ) : null;
  }

  return (
    <div className="pf-chat-markdown space-y-2 text-[0.78rem] leading-[1.65] [overflow-wrap:anywhere]">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'heading': {
            const sizeCls =
              block.level === 1
                ? 'text-[0.92rem] font-bold text-slate-900 border-b border-slate-200/80 pb-1 mt-2'
                : block.level === 2
                ? 'text-[0.86rem] font-bold text-slate-900 mt-1.5'
                : 'text-[0.81rem] font-semibold text-slate-800 mt-1';
            return (
              <div key={idx} className={`${sizeCls} [text-wrap:balance]`}>
                {renderInlineMarkdown(block.text, tone)}
              </div>
            );
          }

          case 'code':
            return (
              <CodeBlockCard
                key={idx}
                lang={block.lang}
                code={block.code}
                closed={block.closed}
              />
            );

          case 'alert': {
            const meta = ALERT_META[block.kind];
            const Icon = meta.icon;
            return (
              <div
                key={idx}
                className={`rounded-xl border px-3 py-2 space-y-1 ${meta.boxCls}`}
              >
                <div className={`flex items-center gap-1.5 text-[11px] font-bold ${meta.titleCls}`}>
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{block.title}</span>
                </div>
                {block.lines.length > 0 && (
                  <div className="text-[11.5px] leading-[1.6] space-y-1">
                    {block.lines.map((line, lIdx) => (
                      <p key={lIdx} className="[text-wrap:pretty]">
                        {renderInlineMarkdown(line, tone)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          case 'blockquote':
            return (
              <blockquote
                key={idx}
                className="border-l-2 border-blue-400/80 bg-slate-100/70 pl-2.5 pr-2 py-1 rounded-r-lg text-slate-600 space-y-1"
              >
                {block.lines.map((line, lIdx) => (
                  <p key={lIdx} className="[text-wrap:pretty]">
                    {renderInlineMarkdown(line, tone)}
                  </p>
                ))}
              </blockquote>
            );

          case 'list':
            return block.ordered ? (
              <ol key={idx} className="space-y-1 pl-0.5">
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-blue-50 border border-blue-200/80 px-1 text-[10px] font-bold tabular-nums text-blue-700">
                      {item.index ?? itemIdx + 1}
                    </span>
                    <span className="min-w-0 flex-1 [text-wrap:pretty]">
                      {renderInlineMarkdown(item.text, tone)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={idx} className="space-y-1 pl-0.5">
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="flex items-start gap-2">
                    {typeof item.checked === 'boolean' ? (
                      item.checked ? (
                        <CheckSquare className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      ) : (
                        <Square className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      )
                    ) : (
                      <span
                        aria-hidden="true"
                        className={
                          tone === 'user'
                            ? 'mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/80'
                            : 'mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500'
                        }
                      />
                    )}
                    <span
                      className={`min-w-0 flex-1 [text-wrap:pretty] ${
                        item.checked ? 'line-through opacity-65' : ''
                      }`}
                    >
                      {renderInlineMarkdown(item.text, tone)}
                    </span>
                  </li>
                ))}
              </ul>
            );

          case 'table':
            return (
              <div
                key={idx}
                className="my-1.5 overflow-x-auto rounded-xl border border-slate-200/90 bg-white shadow-2xs"
              >
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/90 text-slate-700">
                      {block.headers.map((header, hIdx) => (
                        <th
                          key={hIdx}
                          className="px-2.5 py-1.5 font-semibold [text-wrap:balance]"
                        >
                          {renderInlineMarkdown(header, tone)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {block.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50/60">
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="px-2.5 py-1.5 text-slate-700">
                            {renderInlineMarkdown(cell, tone)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case 'hr':
            return <hr key={idx} className="my-2 border-slate-200/80" />;

          case 'paragraph':
          default:
            return (
              <p key={idx} className="[text-wrap:pretty]">
                {renderInlineMarkdown(block.text, tone)}
              </p>
            );
        }
      })}
    </div>
  );
});
