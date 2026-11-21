import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Blocks,
  BookOpen,
  Check,
  ChevronDown,
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

const CLIENT_TARGETS: readonly ClientTargetSpec[] = [
  {
    id: 'json_ide',
    label: 'Cursor / Antigravity / Windsurf',
    shortHint: 'mcpServers JSON',
    remoteHttpFileHint: '.cursor/mcp.json · ~/.gemini/antigravity/mcp_config.json',
    stdioFileHint: '.cursor/mcp.json · ~/.gemini/antigravity/mcp_config.json',
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
    shortHint: 'CLI 一键命令',
    remoteHttpFileHint: '在项目终端直接执行注册命令',
    stdioFileHint: '在项目终端直接执行注册命令',
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

const EXPOSED_MCP_TOOLS: readonly {
  step: string;
  name: string;
  badge: string;
  desc: string;
}[] = [
  {
    step: '01',
    name: 'protoflow_get_project_overview',
    badge: '架构入口',
    desc: '全局菜单路由树、页面目录（含 RP 原稿/优化稿血缘）、共表摘要与静态体检',
  },
  {
    step: '02',
    name: 'protoflow_get_database_schema',
    badge: 'ER / DDL',
    desc: '物理表字段、主外键与组合唯一约束、PostgreSQL / MySQL 建表 DDL 及种子数据',
  },
  {
    step: '03',
    name: 'protoflow_get_page_spec',
    badge: '单页契约',
    desc: '页面大纲（含表格列与控件文案）、TSX 源码、交互动作链与挂载的产品便签',
  },
  {
    step: '04',
    name: 'protoflow_get_docs_and_flows',
    badge: '需求导图',
    desc: '关联产品需求笔记（自动转净版 Markdown）与 Mermaid 业务脑图 / 流程图',
  },
  {
    step: '05',
    name: 'protoflow_search_spec',
    badge: '跨层检索',
    desc: '按关键词跨物理表、字段注释、页面组件、产品便签与需求文档毫秒级定位',
  },
  {
    step: '06',
    name: 'protoflow_get_implementation_checklist',
    badge: '全栈核销',
    desc: '按模块推导建表任务、CRUD / 状态流转接口清单与便签业务规则核销表',
  },
];

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
        : target.innerText.trim();
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

    let message = ok ? '已复制' : '复制失败';
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
    return { valid: false, error: '请输入格式完整的在线分享链接', shareUrl: '', mcpHttpUrl: '' };
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalNetworkHost(u.hostname))) {
    return {
      valid: false,
      error: '公网分享地址必须使用 HTTPS（仅 localhost 与局域网 IP 允许 HTTP），已阻止生成明文配置与密码传输',
      shareUrl: '',
      mcpHttpUrl: '',
    };
  }
  if (u.username || u.password) {
    return {
      valid: false,
      error: '链接中请勿内嵌账号或密码，请使用下方独立的访问密码输入框',
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
      error: '链接路径须为 /p/<shareId> 或 /api/v1/mcp/<shareId>',
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
  const [capabilitiesExpanded, setCapabilitiesExpanded] = useState(true);
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
    const dir = currentProjectMeta.storageDir || '~/Desktop/ProtoFlowProjects';
    const file = currentProjectMeta.fileName || `${currentProjectMeta.projectName}.pflow`;
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
    currentProjectMeta.projectName,
    desktopInfo,
  ]);

  const parsedRemote = useMemo(() => shareUrlToMcpHttpUrl(customShareUrl), [customShareUrl]);
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
    [clientTarget]
  );

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

    // Local .pflow mode
    if (localRunner === 'desktop_builtin' && desktopInfo) {
      return formatStdioCommand(
        desktopInfo.execPath,
        [desktopInfo.scriptPath, '--project', resolvedLocalProjectPath],
        { ELECTRON_RUN_AS_NODE: '1' }
      );
    }
    if (localRunner === 'desktop_node' && desktopInfo) {
      return formatStdioCommand('node', [
        desktopInfo.scriptPath,
        '--project',
        resolvedLocalProjectPath,
      ]);
    }

    return formatStdioCommand('node', [
      './packages/protoflow-mcp/dist/cli.cjs',
      '--project',
      resolvedLocalProjectPath,
    ]);
  }, [
    tab,
    parsedRemote,
    activePasswordValue,
    remoteTransport,
    clientTarget,
    localRunner,
    desktopInfo,
    resolvedLocalProjectPath,
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
  const starterAgentPrompt = `请通过已连接的 protoflow MCP 工具读取原型工程「${projectDisplayName}」：先调用 protoflow_get_project_overview 和 protoflow_get_database_schema 对齐全局路由与数据库表结构，再逐页调用 protoflow_get_page_spec 还原前端交互、后端接口与组件便签规则，最后用 protoflow_get_implementation_checklist 逐项自检。`;

  const urlDescribedBy = parsedRemote.error
    ? urlAlertId
    : parsedRemote.valid
      ? urlEndpointHintId
      : undefined;

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
      className="m-auto w-[min(780px,calc(100vw-24px))] max-h-[calc(100vh-28px)] rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-[3px] overflow-hidden"
    >
      <div className="flex flex-col max-h-[calc(100vh-28px)]">
        {/* Studio Header */}
        <header className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0 bg-slate-50/80">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs border border-blue-500/30">
              <Blocks className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id={titleId} className="text-[15px] font-bold tracking-tight text-slate-900 truncate">
                  MCP 开发接入中心
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200/80 text-[10px] font-semibold text-emerald-700 shrink-0">
                  <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                  Read-Only 安全只读
                </span>
                <span className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[10px] font-mono font-medium text-slate-600 shrink-0">
                  MCP 2025-06-18
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500 truncate">
                当前工程：<span className="font-medium text-slate-700">{projectDisplayName}</span>
                {' · '}供 Coding Agent 按需读取 ER 物理表、页面契约与产品便签
              </p>
            </div>
          </div>

          <button
            type="button"
            autoFocus
            aria-label="关闭 MCP 接入窗口"
            onClick={onClose}
            className="min-w-8 min-h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-800 hover:bg-slate-200/70 cursor-pointer transition shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        {/* Scrollable Workspace Body */}
        <div className="px-6 py-5 overflow-y-auto space-y-5 text-xs">
          {/* Section 1: Source & Transport */}
          <section className="space-y-3" aria-label="数据源与传输方式">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-50 border border-blue-200 text-[10px] font-mono font-bold text-blue-700">
                  1
                </span>
                <span className="text-xs font-bold text-slate-900">选择规格数据源</span>
              </div>
              <span className="text-[11px] text-slate-500">
                {tab === 'remote'
                  ? usingHttpTransport
                    ? '云端无状态 Streamable HTTP · 零本地依赖'
                    : '本机进程桥接在线分享 · Stdio'
                  : '本机文件监听直读 · 保存 .pflow 毫秒级热生效'}
              </span>
            </div>

            {/* Source Cards */}
            {!isViewerOnly && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setTab('remote')}
                  aria-pressed={tab === 'remote'}
                  className={`group relative text-left p-3.5 rounded-xl border transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                    tab === 'remote'
                      ? 'border-blue-500 bg-blue-50/50 shadow-2xs'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 flex items-center gap-2">
                      <span
                        className={`w-6 h-6 rounded-lg flex items-center justify-center border ${
                          tab === 'remote'
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-slate-50 border-slate-200 text-slate-600'
                        }`}
                      >
                        <Radio className="w-3.5 h-3.5" aria-hidden="true" />
                      </span>
                      <span>远程在线链接直连</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100/80 border border-blue-200/70 text-blue-700 text-[10px] font-semibold">
                      团队协作推荐
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
                    研发免装客户端与 Node 环境，凭已发布的在线链接直接挂载 HTTP MCP 服务
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setTab('local')}
                  aria-pressed={tab === 'local'}
                  className={`group relative text-left p-3.5 rounded-xl border transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                    tab === 'local'
                      ? 'border-blue-500 bg-blue-50/50 shadow-2xs'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 flex items-center gap-2">
                      <span
                        className={`w-6 h-6 rounded-lg flex items-center justify-center border ${
                          tab === 'local'
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-slate-50 border-slate-200 text-slate-600'
                        }`}
                      >
                        <HardDrive className="w-3.5 h-3.5" aria-hidden="true" />
                      </span>
                      <span>本地 .pflow 工程直连</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-semibold">
                      离线实时热读
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
                    单机边改原型边写代码，自动检测磁盘 .pflow 修改时间并即时返回最新规格
                  </p>
                </button>
              </div>
            )}

            {/* Source Detail Configuration Box */}
            {tab === 'remote' ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label htmlFor="mcp-share-url-input" className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                    <span>{isViewerOnly ? '当前在线原型分享地址' : '在线分享链接 (/p/<shareId>)'}</span>
                  </label>
                  {!isViewerOnly && publications.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">快速载入已发布版本：</span>
                      <select
                        aria-label="选择已发布的分享链接"
                        value={selectedPub?.shareUrl ?? ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            userEditedShareUrlRef.current = true;
                            setCustomShareUrl(e.target.value);
                            setScopedPassword({ targetShareUrl: '', value: '' });
                          }
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-2xs cursor-pointer focus:border-blue-600 outline-none"
                      >
                        {!selectedPub && <option value="">-- 选择分享记录 ({publications.length}) --</option>}
                        {publications.map((pub) => (
                          <option key={pub.id} value={pub.shareUrl}>
                            {pub.title} (V{pub.version}){pub.passwordProtected ? ' · 含密码' : ''}
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
                    placeholder="粘贴已发布的在线链接，例如 https://proto.team.com/p/abc123..."
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
                        <span className="px-1.5 py-0.2 rounded bg-emerald-100 font-mono text-[10px] font-bold text-emerald-800 shrink-0">
                          POST
                        </span>
                        <span className="truncate font-mono">{parsedRemote.mcpHttpUrl}</span>
                      </span>
                      <span className="text-[10px] font-medium text-emerald-700 shrink-0">
                        已解析标准端点
                      </span>
                    </div>
                  )}

                  {!isViewerOnly && !customShareUrl.trim() && onOpenPublishModal && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-800">
                      <span>当前尚未填写在线分享链接，可先发布工程生成专属链接。</span>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenPublishModal();
                        }}
                        className="shrink-0 px-2.5 py-1 rounded-md bg-white border border-amber-300 font-semibold text-blue-700 hover:bg-blue-50 inline-flex items-center gap-1 cursor-pointer transition"
                      >
                        <span>去发布生成链接</span>
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
                          访问密码{needsPasswordHint ? '（受密码保护）' : '（公开链接留空）'}
                        </span>
                      </label>
                      {passwordHeaderInfo?.isBase64 && (
                        <span className="text-[10px] font-medium text-blue-700">
                          UTF-8 Base64 编码保真
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
                            ? '请先输入有效的分享链接'
                            : needsPasswordHint
                              ? '输入分享密码自动注入鉴权头'
                              : '无密码留空即可'
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white pl-3 pr-9 py-1.5 text-xs text-slate-800 shadow-2xs outline-none focus:border-blue-600 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                      {parsedRemote.valid && activePasswordValue.length > 0 && (
                        <button
                          type="button"
                          aria-label={showPassword ? '隐藏访问密码' : '显示访问密码'}
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

                  <div>
                    <span className="block text-[11px] font-medium text-slate-700 mb-1">
                      连接传输协议
                    </span>
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-200/70 p-0.5 w-full">
                      <button
                        type="button"
                        onClick={() => setRemoteTransport('http')}
                        className={`flex-1 py-1 px-2.5 rounded-md text-[11px] font-medium cursor-pointer transition ${
                          remoteTransport === 'http'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Streamable HTTP（推荐）
                      </button>
                      {desktopInfo && (
                        <button
                          type="button"
                          onClick={() => setRemoteTransport('stdio_local')}
                          className={`flex-1 py-1 px-2.5 rounded-md text-[11px] font-medium cursor-pointer transition ${
                            remoteTransport === 'stdio_local'
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          客户端内置 Stdio
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <FolderGit2 className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                    <span>当前工程本地路径</span>
                  </span>
                  {desktopInfo ? (
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-200/70 p-0.5">
                      <button
                        type="button"
                        onClick={() => setLocalRunner('desktop_builtin')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition ${
                          localRunner === 'desktop_builtin'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Alex 内置运行时（免装 Node）
                      </button>
                      <button
                        type="button"
                        onClick={() => setLocalRunner('desktop_node')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition ${
                          localRunner === 'desktop_node'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        本机 Node 直连脚本
                      </button>
                    </div>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[10px] font-medium text-slate-600">
                      开发态源码 CLI（已随 build:contracts 生成）
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-2xs">
                  <span
                    id={localPathCodeId}
                    className="font-mono text-[11px] text-slate-700 break-all"
                  >
                    {resolvedLocalProjectPath}
                  </span>
                  <McpCopyButton targetElementId={localPathCodeId} label="复制路径" />
                </div>
              </div>
            )}
          </section>

          {/* Section 2: Target Client Tabs & Dark Studio Code Snippet */}
          <section className="space-y-2.5" aria-label="客户端接入配置">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-50 border border-blue-200 text-[10px] font-mono font-bold text-blue-700">
                  2
                </span>
                <span className="text-xs font-bold text-slate-900">选择客户端并复制接入配置</span>
              </div>
              <span className="text-[11px] text-slate-500 hidden sm:inline">
                服务标识：<code className="font-mono text-slate-700">protoflow</code>
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
              {/* Accessible Single-Row Tablist with Non-Color Underline Indicator */}
              <div
                role="tablist"
                aria-label="目标 Coding Agent 客户端"
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

              {/* Dark Studio Terminal Panel */}
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
                      {activeClientSpec.languageLabel} · {usingHttpTransport ? 'HTTP' : 'STDIO'}
                    </span>
                  </div>

                  <McpCopyButton
                    targetElementId={snippetCodeId}
                    label="复制配置"
                    variant="dark"
                  />
                </div>

                <pre className="p-4 font-mono text-[11.5px] leading-relaxed text-slate-100 overflow-x-auto">
                  <code id={snippetCodeId}>{generatedConfig}</code>
                </pre>
              </div>
            </div>
          </section>

          {/* Section 3: Recommended Starter Prompt */}
          <section className="space-y-2" aria-label="推荐首句开发提示词">
            <div className="rounded-xl border border-blue-200/80 bg-blue-50/40 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-600 text-[10px] font-mono font-bold text-white">
                    3
                  </span>
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                    连接成功后发给 Coding Agent 的推荐首句指令
                  </span>
                </div>
                <McpCopyButton targetElementId={promptCodeId} label="复制提示词" />
              </div>
              <p
                id={promptCodeId}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-[11.5px] text-slate-700 leading-relaxed select-all shadow-2xs"
              >
                {starterAgentPrompt}
              </p>
            </div>
          </section>

          {/* Section 4: Progressive Read-Only Capability Matrix (6 Tools + 2 Prompts + 3 Resources) */}
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              aria-expanded={capabilitiesExpanded}
              onClick={() => setCapabilitiesExpanded((prev) => !prev)}
              className="w-full px-4 py-2.5 bg-slate-50/80 hover:bg-slate-100/70 flex items-center justify-between gap-2 text-left cursor-pointer transition"
            >
              <span className="font-semibold text-slate-800 flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                <span>渐进式规格能力清单</span>
                <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200/80 text-[10px] font-medium text-blue-700">
                  6 Tools · 2 Prompts · 3 Resources
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                <span>按需分片读取，不撑爆上下文</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${
                    capabilitiesExpanded ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
              </span>
            </button>

            {capabilitiesExpanded && (
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
                          <code className="font-mono text-[11px] font-semibold text-blue-700 truncate">
                            {tool.name}
                          </code>
                        </div>
                        <span className="px-1.5 py-0.2 rounded bg-white border border-slate-200 text-[10px] font-medium text-slate-600 shrink-0">
                          {tool.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug">{tool.desc}</p>
                    </div>
                  ))}
                </div>

                {/* Prompts & Direct URI Resources Strip */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                  <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 flex items-start gap-2">
                    <Workflow className="w-3.5 h-3.5 text-violet-600 mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold text-slate-800 block">
                        内置研发工作流 Prompts (2)
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 block mt-0.5">
                        /implement-module · /generate-db-layer
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 flex items-start gap-2">
                    <Database className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold text-slate-800 flex items-center gap-1">
                        <span>直读规格与 DDL Resources (3)</span>
                        <BookOpen className="w-3 h-3 text-slate-400" aria-hidden="true" />
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 block mt-0.5 truncate">
                        protoflow://spec/markdown · schema.postgres.sql · schema.mysql.sql
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Sticky Studio Footer */}
        <footer className="px-6 py-3 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-slate-500 inline-flex items-center gap-1.5 min-w-0">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
            <span className="truncate">
              严格只读隔离：外部 Agent 仅可读取原型规格与 DDL 草稿，无法修改工程数据
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer transition shadow-2xs shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            完成
          </button>
        </footer>
      </div>
    </dialog>
  );
};
