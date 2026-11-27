import { DesktopAuthoringControls } from './DesktopAuthoringControls';
import { useDesktopAuthoring } from '../services/desktopAuthoring';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Blocks,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  FolderGit2,
  Globe,
  HardDrive,
  LockKeyhole,
  Radio,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
  X,
} from 'lucide-react';
import {
  listPublications,
  publishingSettings,
  type Publication,
} from '../services/publishingClient';
import { useProtoStore } from '../store/useProtoStore';
import { useI18n, tr as syncTr } from '../i18n';

interface DesktopMcpRuntimeInfo {
  execPath: string;
  scriptPath: string;
  isPackaged: boolean;
  homeDir: string;
  pathSep: string;
}

type ClientTarget = 'json_ide' | 'vscode_ide' | 'claude_cli' | 'codex_cli';
type LocalRunnerMode = 'desktop_builtin' | 'desktop_node' | 'repo_cli';

interface ClientTargetSpec {
  id: ClientTarget;
  label: string;
  shortHint: string;
  remoteHttpFileHint: string;
  stdioFileHint: string;
  languageLabel: string;
}

function getClientTargets(t: (zh: string, en: string) => string): readonly ClientTargetSpec[] {
  return [
    {
      id: 'json_ide',
      label: 'WorkBuddy / Cursor / Antigravity',
      shortHint: 'mcpServers JSON',
      remoteHttpFileHint: '~/.workbuddy/mcp.json · .cursor/mcp.json · ~/.gemini/antigravity/mcp_config.json',
      stdioFileHint: '~/.workbuddy/mcp.json · .cursor/mcp.json · ~/.gemini/antigravity/mcp_config.json',
      languageLabel: 'JSON',
    },
    {
      id: 'vscode_ide',
      label: 'VS Code',
      shortHint: '.vscode/mcp.json',
      remoteHttpFileHint: '.vscode/mcp.json (GitHub Copilot Agent)',
      stdioFileHint: '.vscode/mcp.json (GitHub Copilot Agent)',
      languageLabel: 'JSON',
    },
    {
      id: 'claude_cli',
      label: 'Claude Code',
      shortHint: t('CLI 一键命令', 'CLI one-liner'),
      remoteHttpFileHint: t('在项目终端直接执行注册命令', 'Run registration command directly in project terminal'),
      stdioFileHint: t('在项目终端直接执行注册命令', 'Run registration command directly in project terminal'),
      languageLabel: 'Shell',
    },
    {
      id: 'codex_cli',
      label: 'Codex',
      shortHint: 'config.toml',
      remoteHttpFileHint: '~/.codex/config.toml',
      stdioFileHint: '~/.codex/config.toml',
      languageLabel: 'TOML',
    },
  ];
}

function getExposedMcpTools(t: (zh: string, en: string) => string) {
  return [
    {
      step: '01',
      name: 'protoflow_get_project_overview',
      badge: t('架构入口', 'Overview'),
      desc: t('全局菜单路由树、页面目录（含 RP 原稿/优化稿血缘）、共表摘要与静态体检', 'Global menu routing tree, page directory (with RP lineage), shared table summary & audit'),
    },
    {
      step: '02',
      name: 'protoflow_get_database_schema',
      badge: 'ER / DDL',
      desc: t('物理表字段、主外键与组合唯一约束、PostgreSQL / MySQL 建表 DDL 及种子数据', 'Physical columns, PK/FK & unique constraints, PostgreSQL / MySQL DDL, and seed rows'),
    },
    {
      step: '03',
      name: 'protoflow_get_page_spec',
      badge: t('单页契约', 'Page Spec'),
      desc: t('页面大纲（含表格列与控件文案）、TSX 源码、交互动作链与挂载的产品便签', 'Page outline (table columns & widget copy), TSX source, action chains, and spec pins'),
    },
    {
      step: '04',
      name: 'protoflow_get_docs_and_flows',
      badge: t('需求导图', 'Docs & Flows'),
      desc: t('关联产品需求笔记（自动转净版 Markdown）与 Mermaid 业务脑图 / 流程图', 'Linked PRD notes (clean Markdown) and Mermaid business mindmaps / flowcharts'),
    },
    {
      step: '05',
      name: 'protoflow_search_spec',
      badge: t('跨层检索', 'Search'),
      desc: t('按关键词跨物理表、字段注释、页面组件、产品便签与需求文档毫秒级定位', 'Instant keyword search across tables, column comments, widgets, spec pins, and docs'),
    },
    {
      step: '06',
      name: 'protoflow_get_implementation_checklist',
      badge: t('全栈核销', 'Checklist'),
      desc: t('按模块推导建表任务、CRUD / 状态流转接口清单与便签业务规则核销表', 'Per-module DDL tasks, CRUD / state-transition API endpoints, and spec pin checklist'),
    },
  ] as const;
}

let lastAnnouncedCopyMessage = '';

function legacyCopyText(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const field = Object.assign(document.createElement('textarea'), { value: text });
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.append(field);
  field.select();
  try {
    return document.execCommand('copy');
  } finally {
    field.remove();
  }
}

interface CopyButtonProps {
  targetElementId: string;
  label: string;
  variant?: 'light' | 'dark';
}

const McpCopyButton: React.FC<CopyButtonProps> = ({
  targetElementId,
  label,
  variant = 'light',
}) => {
  const btnRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [statusState, setStatusState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [liveMessage, setLiveMessage] = useState('');

  const performCopy = async () => {
    const target = document.getElementById(targetElementId);
    if (!target) return;
    const text =
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        ? target.value
        : (target.innerText || target.textContent || '').trim();
    if (!text) return;

    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = legacyCopyText(text);
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    setStatusState('idle');
    setLiveMessage('');

    let message = ok ? syncTr('已复制', 'Copied') : syncTr('复制失败', 'Copy failed');
    if (message === lastAnnouncedCopyMessage) {
      message += '\u00A0';
    }
    lastAnnouncedCopyMessage = message;

    requestAnimationFrame(() => {
      setStatusState(ok ? 'copied' : 'failed');
      setLiveMessage(message);
    });

    timerRef.current = setTimeout(() => {
      setStatusState('idle');
      setLiveMessage('');
    }, 2000);
  };

  useEffect(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const supportsCommandEvent = typeof window !== 'undefined' && 'CommandEvent' in window;
    if (supportsCommandEvent) {
      const onCommand = (event: Event) => {
        const cmdEvt = event as Event & { source?: Element; command?: string };
        if (cmdEvt.source === btn && cmdEvt.command === '--copy') {
          void performCopy();
        }
      };
      document.addEventListener('command', onCommand, true);
      return () => {
        document.removeEventListener('command', onCommand, true);
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }
    const onClick = () => {
      void performCopy();
    };
    btn.addEventListener('click', onClick);
    return () => {
      btn.removeEventListener('click', onClick);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [targetElementId]);

  const isDark = variant === 'dark';

  return (
    <span className="inline-flex items-center gap-2 shrink-0">
      <span
        role="status"
        className={`text-[11px] font-medium transition-opacity duration-150 ${
          statusState === 'copied'
            ? isDark
              ? 'opacity-100 text-emerald-400'
              : 'opacity-100 text-emerald-600'
            : statusState === 'failed'
              ? isDark
                ? 'opacity-100 text-rose-400'
                : 'opacity-100 text-rose-600'
              : 'opacity-0 pointer-events-none select-none'
        }`}
      >
        {liveMessage}
      </span>
      <button
        ref={btnRef}
        type="button"
        {...({
          command: '--copy',
          commandfor: targetElementId,
        } as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        data-copied={statusState === 'copied' ? '' : undefined}
        data-failed={statusState === 'failed' ? '' : undefined}
        className={
          isDark
            ? 'min-w-6 min-h-6 px-2.5 py-1 rounded-md border border-slate-700 bg-slate-800/90 hover:bg-slate-700 text-slate-100 text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
            : 'min-w-6 min-h-6 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition shadow-2xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600'
        }
      >
        {statusState === 'copied' ? (
          <Check
            className={`w-3.5 h-3.5 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}
            aria-hidden="true"
          />
        ) : (
          <Copy
            className={`w-3.5 h-3.5 ${isDark ? 'text-slate-300' : 'text-slate-500'}`}
            aria-hidden="true"
          />
        )}
        <span>{label}</span>
      </button>
    </span>
  );
};

function isLocalNetworkHost(host: string): boolean {
  if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return true;
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  const parts = host.split('.').map(Number);
  return (
    parts.every((n) => n <= 255) &&
    (parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31))
  );
}

export function shareUrlToMcpHttpUrl(rawUrl: string): {
  valid: boolean;
  error?: string;
  shareUrl: string;
  mcpHttpUrl: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { valid: false, shareUrl: '', mcpHttpUrl: '' };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { valid: false, error: syncTr('请输入格式完整的在线分享链接', 'Please enter a valid full share URL'), shareUrl: '', mcpHttpUrl: '' };
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalNetworkHost(u.hostname))) {
    return {
      valid: false,
      error: syncTr(
        '公网分享地址必须使用 HTTPS（仅 localhost 与局域网 IP 允许 HTTP），已阻止生成明文配置与密码传输',
        'Public share URLs must use HTTPS (HTTP is allowed only for localhost and LAN IPs). Plaintext config generation blocked.'
      ),
      shareUrl: '',
      mcpHttpUrl: '',
    };
  }
  if (u.username || u.password) {
    return {
      valid: false,
      error: syncTr(
        '链接中请勿内嵌账号或密码，请使用下方独立的访问密码输入框',
        'Do not embed credentials in the URL — use the dedicated Access Password field below'
      ),
      shareUrl: '',
      mcpHttpUrl: '',
    };
  }
  const pMatch = /^\/p\/([A-Za-z0-9_-]{20,80})\/?$/.exec(u.pathname);
  const mcpMatch = /^\/api\/v1\/mcp\/([A-Za-z0-9_-]{20,80})\/?$/.exec(u.pathname);
  const id = pMatch?.[1] ?? mcpMatch?.[1];
  if (!id) {
    return {
      valid: false,
      error: syncTr(
        '链接路径须为 /p/<shareId> 或 /api/v1/mcp/<shareId>',
        'URL path must be /p/<shareId> or /api/v1/mcp/<shareId>'
      ),
      shareUrl: '',
      mcpHttpUrl: '',
    };
  }
  return {
    valid: true,
    shareUrl: `${u.origin}/p/${id}`,
    mcpHttpUrl: `${u.origin}/api/v1/mcp/${id}`,
  };
}

function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** HTTP headers strip leading/trailing OWS and reject non-ISO-8859-1 chars; use Base64 header when needed so valid passwords are never altered. */
function buildPasswordHeader(pw: string): { name: string; value: string; isBase64: boolean } {
  const safeRawHeader = /^[\x21-\x7E](?:[\x20-\x7E]*[\x21-\x7E])?$/.test(pw);
  if (safeRawHeader) {
    return { name: 'X-Protoflow-Password', value: pw, isBase64: false };
  }
  return { name: 'X-Protoflow-Password-Base64', value: encodeUtf8Base64(pw), isBase64: true };
}

export interface McpConnectModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: 'local' | 'remote';
  initialShareUrl?: string | null;
  /** Used in PublishedViewer (/p/<id>) where only the remote online share exists. */
  viewerShareContext?: {
    title: string;
    shareUrl: string;
    passwordProtected: boolean;
  };
  onOpenPublishModal?: () => void;
}

export const McpConnectModal: React.FC<McpConnectModalProps> = ({
  open,
  onClose,
  initialTab = 'local',
  initialShareUrl = null,
  viewerShareContext,
  onOpenPublishModal,
}) => {
  const { locale, tr } = useI18n();
  const CLIENT_TARGETS = useMemo(() => getClientTargets(tr), [locale, tr]);
  const EXPOSED_MCP_TOOLS = useMemo(() => getExposedMcpTools(tr), [locale, tr]);
  const titleId = useId();
  const baseId = useId().replace(/:/g, '_');
  const snippetCodeId = `${baseId}_snippet`;
  const promptCodeId = `${baseId}_prompt`;
  const localPathCodeId = `${baseId}_local_path`;
  const urlAlertId = `${baseId}_url_alert`;
  const urlEndpointHintId = `${baseId}_url_endpoint`;
  const codePanelId = `${baseId}_tabpanel`;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<Record<ClientTarget, HTMLButtonElement | null>>({
    json_ide: null,
    vscode_ide: null,
    claude_cli: null,
    codex_cli: null,
  });

  const currentProjectMeta = useProtoStore((s) => s.currentProjectMeta);
  const isViewerOnly = Boolean(viewerShareContext);

  const [tab, setTab] = useState<'local' | 'remote'>(isViewerOnly ? 'remote' : initialTab);
  const [clientTarget, setClientTarget] = useState<ClientTarget>('json_ide');
  const [localRunner, setLocalRunner] = useState<LocalRunnerMode>('desktop_builtin');
  const [desktopInfo, setDesktopInfo] = useState<DesktopMcpRuntimeInfo | null>(null);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [customShareUrl, setCustomShareUrl] = useState<string>(
    viewerShareContext?.shareUrl ?? initialShareUrl ?? ''
  );
  // Bind any entered password strictly to the exact canonical share URL it was typed for,
  // so switching shares or projects can never leak Share A's password into Share B's headers/CLI.
  const [scopedPassword, setScopedPassword] = useState<{ targetShareUrl: string; value: string }>({
    targetShareUrl: '',
    value: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [remoteTransport, setRemoteTransport] = useState<'http' | 'stdio_local'>('http');
  const [promptPreset, setPromptPreset] = useState<'full_system' | 'refine_page' | 'prd_flows'>('full_system');
  const userEditedShareUrlRef = useRef(false);

  // Reset per-project and per-open state cleanly so old project links/credentials never carry over.
  useEffect(() => {
    userEditedShareUrlRef.current = false;
    setPublications([]);
    setScopedPassword({ targetShareUrl: '', value: '' });
    setShowPassword(false);
    if (!open) {
      setCustomShareUrl('');
      return;
    }
    setTab(isViewerOnly ? 'remote' : initialTab);
    setRemoteTransport('http');
    setCustomShareUrl(viewerShareContext?.shareUrl ?? initialShareUrl ?? '');
  }, [
    open,
    isViewerOnly,
    initialTab,
    initialShareUrl,
    viewerShareContext?.shareUrl,
    currentProjectMeta.projectId,
  ]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }

    const handleClose = () => {
      dialog.returnValue = '';
      onClose();
    };
    dialog.addEventListener('close', handleClose);

    // Fallback light-dismiss for engines without native <dialog closedby="any">
    let removeFallback: (() => void) | undefined;
    if (typeof HTMLDialogElement !== 'undefined' && !('closedBy' in HTMLDialogElement.prototype)) {
      const isOutside = (e: PointerEvent) => {
        if (e.target !== dialog) return false;
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      let pressedOutside = false;
      const onDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) dialog.close();
      };
      dialog.addEventListener('pointerdown', onDown);
      dialog.addEventListener('pointerup', onUp);
      removeFallback = () => {
        dialog.removeEventListener('pointerdown', onDown);
        dialog.removeEventListener('pointerup', onUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      removeFallback?.();
      if (dialog.open) dialog.close();
    };
  }, [open, onClose]);

  // Load desktop runtime paths & active publications scoped strictly to currentProjectMeta.projectId
  useEffect(() => {
    if (!open || isViewerOnly) return;
    const expectedProjectId = currentProjectMeta.projectId;
    let alive = true;
    const bridge = (
      window as unknown as {
        protoflowDesktop?: {
          isElectron?: boolean;
          mcpRuntimeInfo?: () => Promise<DesktopMcpRuntimeInfo>;
        };
      }
    ).protoflowDesktop;

    if (bridge?.isElectron && bridge.mcpRuntimeInfo) {
      void bridge
        .mcpRuntimeInfo()
        .then((info) => {
          if (alive) {
            setDesktopInfo(info);
            setLocalRunner('desktop_builtin');
          }
        })
        .catch(() => {
          if (alive) {
            setDesktopInfo(null);
            setLocalRunner('repo_cli');
          }
        });
    } else {
      setDesktopInfo(null);
      setLocalRunner('repo_cli');
    }

    void publishingSettings()
      .then(async (cfg) => {
        if (!alive || !cfg.configured) return;
        const items = await listPublications(expectedProjectId);
        if (!alive || useProtoStore.getState().currentProjectMeta.projectId !== expectedProjectId) return;
        const active = items.filter(
          (r) =>
            r.projectId === expectedProjectId &&
            !r.revokedAt &&
            (!r.expiresAt || Date.parse(r.expiresAt) > Date.now())
        );
        setPublications(active);
        if (!initialShareUrl && !userEditedShareUrlRef.current) {
          setCustomShareUrl(active[0]?.shareUrl ?? '');
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [open, isViewerOnly, currentProjectMeta.projectId, initialShareUrl]);

  const resolvedLocalProjectPath = useMemo(() => {
    const { storageDir: dir, fileName: file } = currentProjectMeta;
    if (!dir || !file) return null;
    const sep = desktopInfo?.pathSep || '/';
    let expandedDir = dir;
    if (desktopInfo?.homeDir && (dir === '~' || dir.startsWith('~/'))) {
      expandedDir =
        dir === '~'
          ? desktopInfo.homeDir
          : desktopInfo.homeDir + sep + dir.slice(2).split('/').join(sep);
    }
    const cleanDir = expandedDir.endsWith(sep) ? expandedDir.slice(0, -1) : expandedDir;
    return `${cleanDir}${sep}${file}`;
  }, [
    currentProjectMeta.storageDir,
    currentProjectMeta.fileName,
    desktopInfo,
  ]);

  const parsedRemote = useMemo(() => shareUrlToMcpHttpUrl(customShareUrl), [customShareUrl, locale]);
  const selectedPub = useMemo(
    () => publications.find((p) => p.shareUrl === parsedRemote.shareUrl),
    [publications, parsedRemote.shareUrl]
  );
  const needsPasswordHint =
    viewerShareContext?.passwordProtected || Boolean(selectedPub?.passwordProtected);

  const activePasswordValue =
    parsedRemote.valid && scopedPassword.targetShareUrl === parsedRemote.shareUrl
      ? scopedPassword.value
      : '';

  const passwordHeaderInfo = useMemo(
    () => (activePasswordValue.length > 0 ? buildPasswordHeader(activePasswordValue) : null),
    [activePasswordValue]
  );

  const activeClientSpec = useMemo(
    () => CLIENT_TARGETS.find((item) => item.id === clientTarget) ?? CLIENT_TARGETS[0],
    [CLIENT_TARGETS, clientTarget]
  );

  const connectionPath = useDesktopAuthoring(s => s.connectionPath);
  const live = tab === 'local' && !isViewerOnly && connectionPath !== null;
  const usingHttpTransport = tab === 'remote' && remoteTransport === 'http';

  const generatedConfig = useMemo(() => {
    const formatStdioCommand = (
      command: string,
      args: string[],
      env?: Record<string, string>
    ): string => {
      if (clientTarget === 'claude_cli') {
        const envFlags = env
          ? Object.entries(env)
              .map(([k, v]) => ` -e ${shellQuote(`${k}=${v}`)}`)
              .join('')
          : '';
        return `claude mcp add protoflow${envFlags} -- ${shellQuote(command)} ${args.map(shellQuote).join(' ')}`;
      }
      if (clientTarget === 'codex_cli') {
        const lines = [
          '[mcp_servers.protoflow]',
          `command = ${JSON.stringify(command)}`,
          `args = ${JSON.stringify(args)}`,
        ];
        if (env && Object.keys(env).length > 0) {
          const pairs = Object.entries(env)
            .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
            .join(', ');
          lines.push(`env = { ${pairs} }`);
        }
        return lines.join('\n');
      }
      if (clientTarget === 'vscode_ide') {
        return JSON.stringify(
          {
            servers: {
              protoflow: {
                type: 'stdio',
                command,
                args,
                ...(env && Object.keys(env).length > 0 ? { env } : {}),
              },
            },
          },
          null,
          2
        );
      }
      return JSON.stringify(
        {
          mcpServers: {
            protoflow: {
              command,
              args,
              ...(env && Object.keys(env).length > 0 ? { env } : {}),
            },
          },
        },
        null,
        2
      );
    };

    if (tab === 'remote') {
      const mcpHttpUrl = parsedRemote.mcpHttpUrl || 'https://proto.example.com/api/v1/mcp/<shareId>';
      const sharePageUrl = parsedRemote.shareUrl || 'https://proto.example.com/p/<shareId>';
      // Preserve exact password bytes without .trim(): valid share passwords may include leading/trailing spaces or Unicode.
      const pw = activePasswordValue;

      if (remoteTransport === 'http') {
        const pwHeader = pw.length > 0 ? buildPasswordHeader(pw) : null;
        if (clientTarget === 'claude_cli') {
          const headerPart = pwHeader
            ? ` --header ${shellQuote(`${pwHeader.name}: ${pwHeader.value}`)}`
            : '';
          return `claude mcp add --transport http protoflow ${shellQuote(mcpHttpUrl)}${headerPart}`;
        }
        if (clientTarget === 'codex_cli') {
          const lines = [
            '[mcp_servers.protoflow]',
            `url = ${JSON.stringify(mcpHttpUrl)}`,
          ];
          if (pwHeader) {
            lines.push(
              `http_headers = { ${JSON.stringify(pwHeader.name)} = ${JSON.stringify(pwHeader.value)} }`
            );
          }
          return lines.join('\n');
        }
        if (clientTarget === 'vscode_ide') {
          const vscodeEntry: Record<string, unknown> = {
            type: 'http',
            url: mcpHttpUrl,
          };
          if (pwHeader) {
            vscodeEntry.headers = { [pwHeader.name]: pwHeader.value };
          }
          return JSON.stringify({ servers: { protoflow: vscodeEntry } }, null, 2);
        }
        const serverEntry: Record<string, unknown> = { url: mcpHttpUrl };
        if (pwHeader) {
          serverEntry.headers = { [pwHeader.name]: pwHeader.value };
        }
        return JSON.stringify({ mcpServers: { protoflow: serverEntry } }, null, 2);
      }

      // Local stdio bridge for remote share URL (uses real desktop binary or built repo CLI, never an unpublished npm package)
      if (desktopInfo) {
        const args = [desktopInfo.scriptPath, '--share', sharePageUrl];
        const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' };
        if (pw.length > 0) env.PROTOFLOW_SHARE_PASSWORD = pw;
        return formatStdioCommand(desktopInfo.execPath, args, env);
      }
      const cliArgs = ['./packages/protoflow-mcp/dist/cli.cjs', '--share', sharePageUrl];
      const cliEnv = pw.length > 0 ? { PROTOFLOW_SHARE_PASSWORD: pw } : undefined;
      return formatStdioCommand('node', cliArgs, cliEnv);
    }

    if (!live && !resolvedLocalProjectPath) return null;
    const sourceArgs = live ? ['--mode', 'readwrite', '--desktop-bridge', connectionPath] : ['--project', resolvedLocalProjectPath!];
    if (localRunner === 'desktop_builtin' && desktopInfo) {
      return formatStdioCommand(desktopInfo.execPath, [desktopInfo.scriptPath, ...sourceArgs], { ELECTRON_RUN_AS_NODE: '1' });
    }
    const script = localRunner === 'desktop_node' && desktopInfo ? desktopInfo.scriptPath : './packages/protoflow-mcp/dist/cli.cjs';
    return formatStdioCommand('node', [script, ...sourceArgs]);
  }, [
    tab,
    parsedRemote,
    activePasswordValue,
    remoteTransport,
    clientTarget,
    localRunner,
    desktopInfo,
    resolvedLocalProjectPath, connectionPath, live,
  ]);

  const handleClientTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIdx = -1;
    if (e.key === 'ArrowRight') {
      nextIdx = (index + 1) % CLIENT_TARGETS.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = (index - 1 + CLIENT_TARGETS.length) % CLIENT_TARGETS.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = CLIENT_TARGETS.length - 1;
    }
    if (nextIdx >= 0) {
      e.preventDefault();
      const nextSpec = CLIENT_TARGETS[nextIdx];
      setClientTarget(nextSpec.id);
      tabRefs.current[nextSpec.id]?.focus();
    }
  };

  const projectDisplayName = viewerShareContext?.title || currentProjectMeta.projectName;
  const livePromptTemplates = useMemo(
    () => [
      {
        id: 'full_system' as const,
        label: tr('从零生成整套系统', 'Build a full system'),
        prompt: tr(
          '请连接我当前打开的 Alex 原型工程，帮我设计一套完整的【在这里填写系统名称，例如：中学图书管理系统】原型：包含清晰的菜单目录、业务数据表与仿真演示数据、功能闭环的业务页面，以及工作台数据看板，完成后帮我全面检查页面交互与数据关联。',
          'Connect to my open Alex prototype project and design a complete [System Name, e.g. School Library Management System]: create clear menu folders, shared business tables with realistic sample data, closed-loop workflow pages, and a dashboard with charts, then verify all interactions and data links.'
        ),
      },
      {
        id: 'refine_page' as const,
        label: tr('修改当前打开的页面', 'Refine active page'),
        prompt: tr(
          '请查看我在 Alex 画布中当前打开的页面（及选中的组件），帮我按以下产品想法优化布局、字段和交互动作：【在这里写你想怎么改】，修改完成后截图检查一下实际视觉效果。',
          'Check the page (and selected component) currently open on my Alex canvas, and refine its layout, fields, and interactions as follows: [describe your product changes], then capture a preview to verify the visual layout.'
        ),
      },
      {
        id: 'prd_flows' as const,
        label: tr('补齐产品便签与流程图', 'Add PRD notes & flows'),
        prompt: tr(
          '请梳理当前 Alex 原型中的页面与业务数据表，在关键表单和按钮上帮我补齐严谨的产品规则便签（字段校验、状态流转、计算公式），并生成配套的业务流程图与需求说明文档。',
          'Review the pages and tables in my open Alex prototype, attach clear product-rule sticky notes to key forms and buttons (validations, state transitions, formulas), and generate matching business flowcharts and PRD notes.'
        ),
      },
    ],
    [locale, tr]
  );

  const liveDesignCapabilities = useMemo(
    () => [
      {
        badge: tr('菜单与表结构', 'Menus & Data'),
        title: tr('自动规划菜单目录与业务表', 'Plan Sitemap & Business Tables'),
        desc: tr('根据业务描述自动搭建系统模块目录、多页共享的数据表结构，并填入逼真的业务演示数据。', 'Automatically organizes module folders, shared ER tables, and realistic sample records from your product goals.'),
      },
      {
        badge: tr('桌面与移动端', 'PC & Mobile'),
        title: tr('实时绘制高保真交互页面', 'Draw Interactive Pages Live'),
        desc: tr('支持管理后台表格表单、ECharts 数据看板与手机端界面，按钮点击与弹框流转真实可用。', 'Builds admin tables/forms, ECharts dashboards, and mobile screens with working dialogs and actions.'),
      },
      {
        badge: tr('便签与流程图', 'Notes & Flows'),
        title: tr('自动挂载产品规则便签与流程图', 'Attach Sticky Specs & Flowcharts'),
        desc: tr('在对应控件旁直接生成编号产品便签、PRD 需求文档与业务流转图，省去手写繁琐文档。', 'Pins numbered product rules onto widgets and drafts PRD notes and Mermaid flowcharts automatically.'),
      },
      {
        badge: tr('视觉走查体检', 'Visual Check'),
        title: tr('自动截图检查排版与漏项体检', 'Auto Preview Check & Health Audit'),
        desc: tr('AI 改完页面后会自动截图检查文字折行与排版裁切，并核对所有跳转链接与字段绑定是否完整。', 'Captures rendered previews to inspect layout/wrapping and audits every page link and field binding.'),
      },
    ],
    [locale, tr]
  );

  const activeLiveTemplate =
    livePromptTemplates.find((item) => item.id === promptPreset) ?? livePromptTemplates[0];
  const starterAgentPrompt = live
    ? activeLiveTemplate.prompt
    : tr(
        `请通过已连接的 protoflow MCP 工具读取原型工程「${projectDisplayName}」：先对齐全局菜单路由与数据库表结构，再逐页还原前端界面交互、后端接口与组件上的产品便签规则，最后对照实现核对清单逐项自检。`,
        `Read the prototype project "${projectDisplayName}" using the connected protoflow MCP tools: align global routes and database tables first, then implement each page's UI interactions, APIs, and product sticky-note rules, and verify against the implementation checklist.`
      );

  const urlDescribedBy = parsedRemote.error
    ? urlAlertId
    : parsedRemote.valid
      ? urlEndpointHintId
      : undefined;

  if (!open) return null;

  const starterPromptSection = (
    <div className="rounded-xl border border-blue-200/80 bg-blue-50/40 p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-600 text-[10px] font-mono font-bold text-white">
            3
          </span>
          <span className="font-bold text-slate-900 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
            <span>
              {live
                ? tr('第三步：打开 AI 聊天框，复制一句大白话开始创作', 'Step 3: Open your AI chat and copy a plain-language prompt to start')
                : tr('第三步：将这句提示词一并发给研发同学', 'Step 3: Share this starter prompt with your developer')}
            </span>
          </span>
        </div>
        <McpCopyButton targetElementId={promptCodeId} label={tr('复制提示词', 'Copy Prompt')} />
      </div>

      {live && (
        <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label={tr('常用提需求模板', 'Prompt templates')}>
          <span className="text-[11px] text-slate-500 mr-0.5">{tr('切换场景模板：', 'Scenario:')}</span>
          {livePromptTemplates.map((tpl) => {
            const active = tpl.id === activeLiveTemplate.id;
            return (
              <button
                key={tpl.id}
                type="button"
                aria-pressed={active}
                onClick={() => setPromptPreset(tpl.id)}
                className={`min-h-6 px-2.5 py-0.5 rounded-full border text-[11px] font-medium cursor-pointer transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  active
                    ? 'border-blue-500 bg-blue-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {tpl.label}
              </button>
            );
          })}
        </div>
      )}

      <p
        id={promptCodeId}
        className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-[11.5px] text-slate-700 leading-relaxed select-all shadow-2xs"
      >
        {starterAgentPrompt}
      </p>
    </div>
  );

  const clientConfigPanel = (
    <div className="space-y-3">
      {tab === 'local' && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-semibold text-slate-800 flex items-center gap-1.5">
              <FolderGit2 className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
              <span>{live ? tr('双向设计连接文件（自动复用）', 'Live connection file (reused automatically)') : tr('当前工程本地路径', 'Local Project File Path')}</span>
            </span>
            {desktopInfo ? (
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-200/70 p-0.5">
                <button
                  type="button"
                  onClick={() => setLocalRunner('desktop_builtin')}
                  className={`min-h-6 px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition ${
                    localRunner === 'desktop_builtin'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tr('Alex 内置环境（免装 Node）', 'Alex Built-in Runtime (No Node needed)')}
                </button>
                <button
                  type="button"
                  onClick={() => setLocalRunner('desktop_node')}
                  className={`min-h-6 px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition ${
                    localRunner === 'desktop_node'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tr('本机 Node 脚本', 'Local Node Script')}
                </button>
              </div>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[10px] font-medium text-slate-600">
                {tr('开发态源码 CLI', 'Dev CLI')}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-2xs">
            <span
              id={localPathCodeId}
              className="font-mono text-[11px] text-slate-700 break-all"
            >
              {live ? connectionPath : resolvedLocalProjectPath ?? tr('请先打开已保存的本地工程', 'Open a saved local project first')}
            </span>
            {(live || resolvedLocalProjectPath) && (
              <McpCopyButton
                targetElementId={localPathCodeId}
                label={live ? tr('复制连接文件路径', 'Copy connection file path') : tr('复制路径', 'Copy Path')}
              />
            )}
          </div>
        </div>
      )}

      <p className="rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-900 leading-relaxed">
        {live
          ? tr(
              '温馨提示：如果你已经点了上方的「安装 Antigravity 插件」或「导出 Claude Desktop 扩展」，就不需要下面这段代码了。请千万不要把下面这段配置代码直接发进 AI 聊天框里——它仅供研发同学填进 Cursor / VS Code / Codex 的软件设置中。',
              'Note: If you already clicked "Install Antigravity plugin" or "Export Claude Desktop extension" above, skip this snippet. Never paste this JSON into an AI chat message — it goes into MCP settings files in Cursor, VS Code, or Codex.'
            )
          : tr(
              '温馨提示：请复制下方配置发给研发同学，粘贴到其编程软件（Cursor / VS Code / Claude Code / Codex）的 MCP 设置中，请勿直接粘贴到 AI 聊天输入框里。',
              'Tip: Copy and send the snippet below to your developer to add in their IDE’s MCP settings (Cursor, VS Code, Claude Code, or Codex) — do not paste it into the chat prompt.'
            )}
      </p>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
        <div
          role="tablist"
          aria-label={tr('目标编程软件客户端', 'Target AI Clients')}
          className="flex items-center overflow-x-auto border-b border-slate-200 bg-slate-50/80 px-2 pt-1 gap-1"
        >
          {CLIENT_TARGETS.map((spec, idx) => {
            const selected = clientTarget === spec.id;
            return (
              <button
                key={spec.id}
                ref={(el) => {
                  tabRefs.current[spec.id] = el;
                }}
                id={`${baseId}_tab_${spec.id}`}
                role="tab"
                type="button"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setClientTarget(spec.id)}
                onKeyDown={(e) => handleClientTabKeyDown(e, idx)}
                className={`relative shrink-0 whitespace-nowrap px-3 py-2 text-[11px] font-semibold cursor-pointer transition rounded-t-lg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600 ${
                  selected
                    ? 'text-blue-700 bg-white after:content-[""] after:absolute after:inset-x-2 after:bottom-0 after:border-b-2 after:border-current'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                }`}
              >
                <span>{spec.label}</span>
                <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                  {spec.shortHint}
                </span>
              </button>
            );
          })}
        </div>

        <div
          id={codePanelId}
          role="tabpanel"
          aria-labelledby={`${baseId}_tab_${activeClientSpec.id}`}
          className="bg-slate-950"
        >
          <div className="flex items-center justify-between gap-3 px-3.5 py-2 border-b border-slate-800 bg-slate-900">
            <div className="flex items-center gap-2 min-w-0">
              <FileCode2 className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
              <span className="font-mono text-[11px] text-slate-300 truncate">
                {usingHttpTransport
                  ? activeClientSpec.remoteHttpFileHint
                  : activeClientSpec.stdioFileHint}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-sky-300 shrink-0">
                {activeClientSpec.languageLabel}
              </span>
            </div>

            {generatedConfig && (
              <McpCopyButton
                targetElementId={snippetCodeId}
                label={tr('复制配置', 'Copy Config')}
                variant="dark"
              />
            )}
          </div>

          <pre
            role="region"
            aria-label={tr('客户端接入配置代码', 'Client configuration snippet')}
            tabIndex={0}
            className="p-4 font-mono text-[11.5px] leading-relaxed text-slate-100 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-400"
          >
            <code id={snippetCodeId}>{generatedConfig ?? tr('请打开已保存的本地工程以生成配置', 'Open a saved project to generate a configuration')}</code>
          </pre>
        </div>
      </div>
    </div>
  );

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
      className="m-auto w-[min(780px,calc(100vw-24px))] max-h-[calc(100vh-28px)] rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-[3px] overflow-hidden"
    >
      <div className="flex flex-col max-h-[calc(100vh-28px)]">
        {/* Friendly PM Header */}
        <header className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0 bg-slate-50/80">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs border border-blue-500/30">
              <Blocks className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id={titleId} className="text-[15px] font-bold tracking-tight text-slate-900 truncate">
                  {tr('连接外部 AI 助手 & 研发移交', 'Connect External AI & Dev Handoff')}
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200/80 text-[10px] font-semibold text-emerald-700 shrink-0">
                  <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                  {live ? tr('AI 实时共创中', 'Live AI Co-Design') : tr('只读保护（不改原型）', 'Read-Only Protected')}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500 truncate">
                {tr('当前工程：', 'Project: ')}
                <span className="font-medium text-slate-700">{projectDisplayName}</span>
                {' · '}
                {tr('用大白话让外部 AI 直接帮你画原型，或将定稿需求无损交给研发写代码', 'Design prototypes by chatting in external AI apps, or hand off specs to developers')}
              </p>
            </div>
          </div>

          <button
            type="button"
            autoFocus
            aria-label={tr('关闭 MCP 接入窗口', 'Close MCP integration dialog')}
            onClick={onClose}
            className="min-w-8 min-h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-800 hover:bg-slate-200/70 cursor-pointer transition shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        {/* Scrollable Workspace Body */}
        <div className="px-6 py-5 overflow-y-auto space-y-4 text-xs">
          {/* Scenario Picker */}
          <div className="space-y-3">
            {!isViewerOnly && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">
                    {tr('你想用它做什么？', 'What would you like to do?')}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {tab === 'local'
                      ? live
                        ? tr('已开启实时画布连接', 'Live canvas connected')
                        : tr('连接本机工程文件', 'Connected to local project file')
                      : tr('通过在线分享链接移交研发', 'Share specs via online link')}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setTab('local')}
                    aria-pressed={tab === 'local'}
                    className={`group relative text-left p-3.5 rounded-xl border transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 min-w-0 ${
                      tab === 'local'
                        ? 'border-blue-500 bg-blue-50/50 shadow-2xs'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 flex items-center gap-2 min-w-0">
                        <span
                          className={`w-6 h-6 rounded-lg flex items-center justify-center border shrink-0 ${
                            tab === 'local'
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                        >
                          <HardDrive className="w-3.5 h-3.5" aria-hidden="true" />
                        </span>
                        <span className="truncate">
                          {live
                            ? tr('让外部 AI 帮我画原型', 'Let External AI Design Here')
                            : tr('本机 AI 画原型 · 本地 .pflow 工程直连', 'Local AI Design · Local .pflow File')}
                        </span>
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-blue-100/80 border border-blue-200/70 text-blue-700 text-[10px] font-semibold shrink-0">
                        {live ? tr('实时共创中', 'Live Active') : tr('产品设计常用', 'For PM Design')}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-600 leading-relaxed">
                      {tr(
                        '在 Antigravity、Claude 等外部 AI 里直接聊天提需求，自动在当前画布生成目录、数据表、页面和便签',
                        'Chat in Antigravity or Claude to create and edit menus, tables, pages, and sticky notes live on your canvas'
                      )}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab('remote')}
                    aria-pressed={tab === 'remote'}
                    className={`group relative text-left p-3.5 rounded-xl border transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 min-w-0 ${
                      tab === 'remote'
                        ? 'border-blue-500 bg-blue-50/50 shadow-2xs'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 flex items-center gap-2 min-w-0">
                        <span
                          className={`w-6 h-6 rounded-lg flex items-center justify-center border shrink-0 ${
                            tab === 'remote'
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                        >
                          <Radio className="w-3.5 h-3.5" aria-hidden="true" />
                        </span>
                        <span className="truncate">{tr('把定稿原型交给研发写代码', 'Hand Off Prototype to Developers')}</span>
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-semibold shrink-0">
                        {tr('研发协作推荐', 'For Dev Handoff')}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-600 leading-relaxed">
                      {tr(
                        '通过已发布的在线分享链接生成配置发给研发同学，免装客户端即可让编程 AI 精准还原你的原型与便签规则',
                        'Generate a ready-to-use config from a published share link so developers can code directly from your specs'
                      )}
                    </p>
                  </button>
                </div>
              </>
            )}

            {/* Mode Content */}
            {tab === 'remote' ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label htmlFor="mcp-share-url-input" className="font-bold text-slate-900 flex items-center gap-1.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-50 border border-blue-200 text-[10px] font-mono font-bold text-blue-700">
                      1
                    </span>
                    <Globe className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                    <span>{isViewerOnly ? tr('当前在线原型分享地址', 'Current Online Share URL') : tr('第一步：选择或粘贴已发布的原型分享链接', 'Step 1: Select or paste a published prototype share link')}</span>
                  </label>
                  {!isViewerOnly && publications.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">{tr('选择已发布版本：', 'Published version:')}</span>
                      <select
                        aria-label={tr('选择已发布的分享链接', 'Select published share link')}
                        value={selectedPub?.shareUrl ?? ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            userEditedShareUrlRef.current = true;
                            setCustomShareUrl(e.target.value);
                            setScopedPassword({ targetShareUrl: '', value: '' });
                          }
                        }}
                        className="min-h-6 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-2xs cursor-pointer focus:border-blue-600 outline-none"
                      >
                        {!selectedPub && <option value="">{tr(`-- 选择分享记录 (${publications.length}) --`, `-- Select share (${publications.length}) --`)}</option>}
                        {publications.map((pub) => (
                          <option key={pub.id} value={pub.shareUrl}>
                            {pub.title} (V{pub.version}){pub.passwordProtected ? tr(' · 含密码', ' · Password') : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <input
                    id="mcp-share-url-input"
                    type="url"
                    readOnly={isViewerOnly}
                    aria-invalid={Boolean(parsedRemote.error) || undefined}
                    aria-describedby={urlDescribedBy}
                    value={customShareUrl}
                    onChange={(e) => {
                      userEditedShareUrlRef.current = true;
                      setCustomShareUrl(e.target.value);
                      setScopedPassword({ targetShareUrl: '', value: '' });
                    }}
                    placeholder={tr('粘贴已发布的在线链接，例如 https://proto.team.com/p/abc123...', 'Paste a published share link, e.g. https://proto.team.com/p/abc123...')}
                    className={`w-full rounded-lg border bg-white px-3 py-2 font-mono text-xs text-slate-800 shadow-2xs outline-none transition ${
                      parsedRemote.error
                        ? 'border-rose-300 focus:border-rose-500'
                        : 'border-slate-200 focus:border-blue-600'
                    }`}
                  />

                  {parsedRemote.error && (
                    <p
                      id={urlAlertId}
                      role="alert"
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700"
                    >
                      {parsedRemote.error}
                    </p>
                  )}

                  {parsedRemote.valid && (
                    <div
                      id={urlEndpointHintId}
                      className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50/60 px-3 py-1.5 text-[11px]"
                    >
                      <span className="flex items-center gap-1.5 min-w-0 text-emerald-800">
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                        <span className="truncate">{tr('分享链接验证通过，已自动生成下方研发接入配置', 'Share link verified — developer config generated below')}</span>
                      </span>
                      <span className="text-[10px] font-mono text-emerald-700 shrink-0 hidden sm:inline truncate max-w-56">
                        {parsedRemote.mcpHttpUrl}
                      </span>
                    </div>
                  )}

                  {!isViewerOnly && !customShareUrl.trim() && onOpenPublishModal && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-800">
                      <span>{tr('还没有在线分享链接？先发布一下当前原型就能生成专属链接发给研发。', 'No share link yet? Publish your prototype first to generate a link for developers.')}</span>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenPublishModal();
                        }}
                        className="min-h-6 shrink-0 px-2.5 py-1 rounded-md bg-white border border-amber-300 font-semibold text-blue-700 hover:bg-blue-50 inline-flex items-center gap-1 cursor-pointer transition"
                      >
                        <span>{tr('去发布生成链接', 'Publish & Get Link')}</span>
                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start pt-0.5">
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <label htmlFor="mcp-share-pw-input" className="text-[11px] font-medium text-slate-700 flex items-center gap-1">
                        <LockKeyhole className="w-3 h-3 text-slate-400" aria-hidden="true" />
                        <span>
                          {tr('访问密码', 'Access Password')}{needsPasswordHint ? tr('（该链接设有密码）', ' (password-protected)') : tr('（无密码留空即可）', ' (leave blank if public)')}
                        </span>
                      </label>
                      {passwordHeaderInfo?.isBase64 && (
                        <span className="text-[10px] font-medium text-blue-700">
                          {tr('已自动安全编码特殊字符', 'Auto-encoded special characters')}
                        </span>
                      )}
                    </div>
                    <div className="relative flex items-center">
                      <input
                        id="mcp-share-pw-input"
                        type={showPassword ? 'text' : 'password'}
                        disabled={!parsedRemote.valid}
                        value={activePasswordValue}
                        onChange={(e) => {
                          if (!parsedRemote.valid) return;
                          setScopedPassword({
                            targetShareUrl: parsedRemote.shareUrl,
                            value: e.target.value,
                          });
                        }}
                        placeholder={
                          !parsedRemote.valid
                            ? tr('请先选择或粘贴分享链接', 'Select or paste a share URL first')
                            : needsPasswordHint
                              ? tr('输入分享密码，将自动写入下方配置', 'Enter share password to include automatically')
                              : tr('公开链接无需填写', 'Leave blank if public')
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white pl-3 pr-9 py-1.5 text-xs text-slate-800 shadow-2xs outline-none focus:border-blue-600 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                      {parsedRemote.valid && activePasswordValue.length > 0 && (
                        <button
                          type="button"
                          aria-label={showPassword ? tr('隐藏访问密码', 'Hide access password') : tr('显示访问密码', 'Show access password')}
                          onClick={() => setShowPassword((prev) => !prev)}
                          className="absolute right-1 min-w-7 min-h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          {showPassword ? (
                            <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {desktopInfo && (
                    <div>
                      <span className="block text-[11px] font-medium text-slate-700 mb-1">
                        {tr('连接方式（默认云端直连即可）', 'Connection mode (Cloud direct recommended)')}
                      </span>
                      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-200/70 p-0.5 w-full">
                        <button
                          type="button"
                          onClick={() => setRemoteTransport('http')}
                          className={`min-h-6 flex-1 py-1 px-2.5 rounded-md text-[11px] font-medium cursor-pointer transition ${
                            remoteTransport === 'http'
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {tr('云端免安装直连（推荐）', 'Cloud Direct (Recommended)')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoteTransport('stdio_local')}
                          className={`min-h-6 flex-1 py-1 px-2.5 rounded-md text-[11px] font-medium cursor-pointer transition ${
                            remoteTransport === 'stdio_local'
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {tr('本机中转（客户端内置 Stdio）', 'Via Local App (Built-in Stdio)')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              desktopInfo && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <DesktopAuthoringControls />
                </div>
              )
            )}
          </div>

          {/* In Live PM Mode: Show Step 3 (Plain-Language Prompt) FIRST, and collapse Developer JSON behind <details>! */}
          {live ? (
            <>
              {starterPromptSection}

              <details className="group rounded-xl border border-slate-200 bg-white overflow-hidden">
                <summary className="list-none px-4 py-3 bg-slate-50/80 hover:bg-slate-100/70 flex items-center justify-between gap-2 cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5 min-w-0">
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 transition-transform group-open:rotate-90 shrink-0" aria-hidden="true" />
                    <Terminal className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {tr('技术人员高级配置：连接 Cursor / VS Code / Codex 或查看文件路径', 'Developer options: Connect Cursor / VS Code / Codex or view file path')}
                    </span>
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-medium text-slate-600 shrink-0">
                    {tr('已装上方插件无需点开', 'Skip if using plugin above')}
                  </span>
                </summary>
                <div className="p-4 border-t border-slate-200">
                  {clientConfigPanel}
                </div>
              </details>
            </>
          ) : (
            <>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-50 border border-blue-200 text-[10px] font-mono font-bold text-blue-700">
                      2
                    </span>
                    <span className="text-xs font-bold text-slate-900">
                      {tr('第二步：选择研发使用的编程工具，复制配置发给开发同学', 'Step 2: Choose your developer’s coding tool & copy config')}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 hidden sm:inline">
                    {tr('服务名：', 'Server: ')}<code className="font-mono text-slate-700">protoflow</code>
                  </span>
                </div>
                {clientConfigPanel}
              </div>

              {starterPromptSection}
            </>
          )}

          {/* Friendly Capability Disclosure */}
          <details className="group rounded-xl border border-slate-200 bg-white overflow-hidden">
            <summary className="list-none px-4 py-2.5 bg-slate-50/80 hover:bg-slate-100/70 flex items-center justify-between gap-2 cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 transition-transform group-open:rotate-90 shrink-0" aria-hidden="true" />
                <BookOpen className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                <span>
                  {live
                    ? tr('了解连接后 AI 能帮你完成哪些原型设计工作', 'See what AI can build for you once connected')
                    : tr('了解研发同学连接后能读取哪些原型与需求细节', 'See what prototype specs developers get after connecting')}
                </span>
              </span>
              <span className="text-[11px] text-slate-500 shrink-0">
                {live ? tr('全流程原型共创', 'End-to-end co-design') : tr('按需精准读取，不漏便签规则', 'Reads pages, tables & sticky rules')}
              </span>
            </summary>

            {live ? (
              <div className="p-3.5 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {liveDesignCapabilities.map((item) => (
                  <div key={item.title} className="rounded-lg border border-slate-200/90 bg-slate-50/60 px-3 py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">{item.title}</span>
                      <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-medium text-blue-700 shrink-0">
                        {item.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3.5 border-t border-slate-200 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {EXPOSED_MCP_TOOLS.map((tool) => (
                    <div
                      key={tool.name}
                      className="rounded-lg border border-slate-200/90 bg-slate-50/60 px-3 py-2 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-[10px] font-bold text-slate-400">
                            {tool.step}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-800 truncate">
                            {tool.badge}
                          </span>
                        </div>
                        <code className="px-1.5 py-0.2 rounded bg-white border border-slate-200 font-mono text-[10px] text-slate-500 shrink-0 truncate max-w-44">
                          {tool.name}
                        </code>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-snug">{tool.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                  <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 flex items-start gap-2">
                    <Workflow className="w-3.5 h-3.5 text-violet-600 mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold text-slate-800 block">
                        {tr('配套研发快捷指令', 'Built-in Dev Workflow Shortcuts')}
                      </span>
                      <span className="text-[11px] text-slate-500 block mt-0.5">
                        {tr('一键按模块生成前后端代码与建表脚本', 'Generate module code and database layers in one step')}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 flex items-start gap-2">
                    <Database className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold text-slate-800 block">
                        {tr('自动导出标准建表 SQL 与需求文档', 'Ready-to-Use SQL Schemas & Clean PRD')}
                      </span>
                      <span className="text-[11px] text-slate-500 block mt-0.5">
                        {tr('研发可直接读取 PostgreSQL / MySQL 建表语句与 Markdown 规格', 'Direct access to PostgreSQL / MySQL DDL and Markdown specs')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </details>
        </div>

        {/* Sticky Studio Footer */}
        <footer className="px-6 py-3 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-slate-600 inline-flex items-center gap-1.5 min-w-0">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {live
                ? tr('安心保障：AI 修改内容自动保存，随时可按 ⌘Z / Ctrl+Z 一键撤销', 'Peace of mind: AI edits autosave and can be undone anytime with ⌘Z / Ctrl+Z')
                : tr('安全保障：当前为只读模式，研发 AI 仅可读取需求与表结构，绝不会改动你的原型', 'Safe read-only mode: Developer AI can read specs & tables without ever changing your prototype')}
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-7 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer transition shadow-2xs shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {tr('完成', 'Done')}
          </button>
        </footer>
      </div>
    </dialog>
  );
};
