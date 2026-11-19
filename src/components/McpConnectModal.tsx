import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Blocks,
  Check,
  Copy,
  ExternalLink,
  HardDrive,
  LockKeyhole,
  Radio,
  ShieldCheck,
  Sparkles,
  Terminal,
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

type ClientTarget = 'json_ide' | 'claude_cli' | 'codex_cli';
type LocalRunnerMode = 'desktop_builtin' | 'desktop_node' | 'repo_cli';

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
  ariaLabel?: string;
}

const McpCopyButton: React.FC<CopyButtonProps> = ({ targetElementId, label, ariaLabel }) => {
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

  return (
    <span className="inline-flex items-center gap-2">
      <span
        role="status"
        className={`text-[11px] font-medium transition-opacity duration-150 ${
          statusState === 'copied'
            ? 'opacity-100 text-emerald-600'
            : statusState === 'failed'
              ? 'opacity-100 text-rose-600'
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
        aria-label={ariaLabel}
        className="min-w-6 min-h-6 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
      >
        {statusState === 'copied' ? (
          <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
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
function buildPasswordHeader(pw: string): { name: string; value: string } {
  const safeRawHeader = /^[\x21-\x7E](?:[\x20-\x7E]*[\x21-\x7E])?$/.test(pw);
  if (safeRawHeader) {
    return { name: 'X-Protoflow-Password', value: pw };
  }
  return { name: 'X-Protoflow-Password-Base64', value: encodeUtf8Base64(pw) };
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
  const snippetCodeId = useId().replace(/:/g, '_');
  const promptCodeId = useId().replace(/:/g, '_');
  const dialogRef = useRef<HTMLDialogElement>(null);

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
  const [remoteTransport, setRemoteTransport] = useState<'http' | 'stdio_local'>('http');
  const userEditedShareUrlRef = useRef(false);

  // Reset per-project and per-open state cleanly so old project links/credentials never carry over.
  useEffect(() => {
    userEditedShareUrlRef.current = false;
    setPublications([]);
    setScopedPassword({ targetShareUrl: '', value: '' });
    if (!open) {
      setCustomShareUrl('');
      return;
    }
    setTab(isViewerOnly ? 'remote' : initialTab);
    setRemoteTransport('http');
    setCustomShareUrl(viewerShareContext?.shareUrl ?? initialShareUrl ?? '');
  }, [open, isViewerOnly, initialTab, initialShareUrl, viewerShareContext?.shareUrl, currentProjectMeta.projectId]);

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
  }, [currentProjectMeta.storageDir, currentProjectMeta.fileName, currentProjectMeta.projectName, desktopInfo]);

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
          const headerPart = pwHeader ? ` --header ${shellQuote(`${pwHeader.name}: ${pwHeader.value}`)}` : '';
          return `claude mcp add --transport http protoflow ${shellQuote(mcpHttpUrl)}${headerPart}`;
        }
        if (clientTarget === 'codex_cli') {
          const lines = [
            '[mcp_servers.protoflow]',
            `url = ${JSON.stringify(mcpHttpUrl)}`,
          ];
          if (pwHeader) {
            lines.push(`http_headers = { ${JSON.stringify(pwHeader.name)} = ${JSON.stringify(pwHeader.value)} }`);
          }
          return lines.join('\n');
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

  const projectDisplayName = viewerShareContext?.title || currentProjectMeta.projectName;
  const starterAgentPrompt = `请通过已连接的 protoflow MCP 工具读取原型工程「${projectDisplayName}」：先调用 protoflow_get_project_overview 和 protoflow_get_database_schema 对齐全局路由与数据库表结构，再逐页调用 protoflow_get_page_spec 还原前端交互、后端接口与组件便签规则，最后用 protoflow_get_implementation_checklist 逐项自检。`;

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
      className="m-auto w-[min(680px,calc(100vw-24px))] max-h-[calc(100vh-32px)] rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/45 backdrop:backdrop-blur-[2px] overflow-hidden"
    >
      <div className="flex flex-col max-h-[calc(100vh-32px)]">
        {/* Header */}
        <header className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0 bg-slate-50/70">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
              <Blocks className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id={titleId} className="text-sm font-bold text-slate-900 truncate">
                  MCP 规格服务接入（Coding Agent 专用）
                </h2>
                <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] font-semibold text-emerald-700 shrink-0">
                  Read-Only 安全只读
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                让 Claude Code、Cursor、Antigravity、Codex 按需读取 ER 物理表、页面源码与产品便签
              </p>
            </div>
          </div>

          <button
            type="button"
            autoFocus
            aria-label="关闭 MCP 接入窗口"
            onClick={onClose}
            className="min-w-7 min-h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer transition"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        {/* Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Source Mode Switcher */}
          {!isViewerOnly && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setTab('remote')}
                className={`text-left p-3 rounded-xl border transition cursor-pointer ${
                  tab === 'remote'
                    ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                    远程在线链接直连
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-blue-100/80 text-blue-700 text-[10px] font-medium">
                    研发免装工具
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                  产品发布在线链接后，研发无需安装 Alex 或传文件，直接通过 HTTP MCP 远程读取
                </p>
              </button>

              <button
                type="button"
                onClick={() => setTab('local')}
                className={`text-left p-3 rounded-xl border transition cursor-pointer ${
                  tab === 'local'
                    ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
                    本地 .pflow 工程直连
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">
                    100% 离线实时热读
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                  在本机边调原型边开发，自动监测磁盘 .pflow 保存时间毫秒级热刷新
                </p>
              </button>
            </div>
          )}

          {/* Mode-specific Source Configuration */}
          {tab === 'remote' ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label htmlFor="mcp-share-url-input" className="font-semibold text-slate-800">
                  {isViewerOnly ? '当前在线原型分享地址' : '在线分享链接 (/p/<shareId>)'}
                </label>
                {!isViewerOnly && publications.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">已发布记录：</span>
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
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                    >
                      {!selectedPub && <option value="">-- 选择分享记录 --</option>}
                      {publications.map((pub) => (
                        <option key={pub.id} value={pub.shareUrl}>
                          {pub.title} (V{pub.version})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <input
                id="mcp-share-url-input"
                type="url"
                readOnly={isViewerOnly}
                value={customShareUrl}
                onChange={(e) => {
                  userEditedShareUrlRef.current = true;
                  setCustomShareUrl(e.target.value);
                  setScopedPassword({ targetShareUrl: '', value: '' });
                }}
                placeholder="粘贴已发布的在线链接，例如 https://proto.team.com/p/abc123..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-800 outline-none focus:border-blue-600"
              />

              {parsedRemote.error && (
                <p
                  role="alert"
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700"
                >
                  {parsedRemote.error}
                </p>
              )}

              {!isViewerOnly && !customShareUrl.trim() && onOpenPublishModal && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-800">
                  <span>当前工程尚未填入在线分享链接，可先一键发布生成链接。</span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenPublishModal();
                    }}
                    className="shrink-0 font-semibold text-blue-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>去发布生成链接</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                <div>
                  <label htmlFor="mcp-share-pw-input" className="block text-[11px] font-medium text-slate-600 mb-1">
                    <LockKeyhole className="w-3 h-3 inline mr-1 text-slate-400" aria-hidden="true" />
                    访问密码{needsPasswordHint ? '（此链接已开启密码保护）' : '（公开链接留空即可）'}
                  </label>
                  <input
                    id="mcp-share-pw-input"
                    type="password"
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
                          ? '输入分享密码以生成鉴权配置'
                          : '无密码留空'
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-600 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>

                <div>
                  <span className="block text-[11px] font-medium text-slate-600 mb-1">连接协议方式</span>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 w-full">
                    <button
                      type="button"
                      onClick={() => setRemoteTransport('http')}
                      className={`flex-1 py-1 px-2 rounded-md text-[11px] font-medium cursor-pointer transition ${
                        remoteTransport === 'http'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Streamable HTTP (推荐免装)
                    </button>
                    {desktopInfo && (
                      <button
                        type="button"
                        onClick={() => setRemoteTransport('stdio_local')}
                        className={`flex-1 py-1 px-2 rounded-md text-[11px] font-medium cursor-pointer transition ${
                          remoteTransport === 'stdio_local'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-600 hover:bg-slate-50'
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
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-semibold text-slate-800">当前工程文件路径</span>
                {desktopInfo ? (
                  <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                    <button
                      type="button"
                      onClick={() => setLocalRunner('desktop_builtin')}
                      className={`px-2.5 py-0.5 rounded text-[11px] font-medium cursor-pointer transition ${
                        localRunner === 'desktop_builtin'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      客户端内置运行时（免装 Node）
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocalRunner('desktop_node')}
                      className={`px-2.5 py-0.5 rounded text-[11px] font-medium cursor-pointer transition ${
                        localRunner === 'desktop_node'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      本机 Node 直连脚本
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-500">
                    浏览器开发态：在源码目录运行（已随 build:contracts 自动生成）
                  </span>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-[11px] text-slate-700 break-all">
                {resolvedLocalProjectPath}
              </div>
            </div>
          )}

          {/* Target Coding Agent Tabs & Generated Config */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setClientTarget('json_ide')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition ${
                    clientTarget === 'json_ide'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Cursor / Antigravity / Windsurf (JSON)
                </button>
                <button
                  type="button"
                  onClick={() => setClientTarget('claude_cli')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition ${
                    clientTarget === 'claude_cli'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Claude Code (一键命令)
                </button>
                <button
                  type="button"
                  onClick={() => setClientTarget('codex_cli')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition ${
                    clientTarget === 'codex_cli'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Codex (config.toml)
                </button>
              </div>

              <McpCopyButton
                targetElementId={snippetCodeId}
                label="复制配置"
                ariaLabel="复制 MCP 接入配置代码"
              />
            </div>

            <pre className="rounded-xl border border-slate-800 bg-slate-950 text-slate-100 p-3.5 font-mono text-[11px] leading-relaxed overflow-x-auto">
              <code id={snippetCodeId}>{generatedConfig}</code>
            </pre>
          </div>

          {/* Starter Prompt for Coding Agent */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                连上后发给 Coding Agent 的推荐首句指令
              </span>
              <McpCopyButton
                targetElementId={promptCodeId}
                label="复制提示词"
                ariaLabel="复制推荐发给 Coding Agent 的开发提示词"
              />
            </div>
            <p
              id={promptCodeId}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-700 leading-relaxed select-all"
            >
              {starterAgentPrompt}
            </p>
          </div>

          {/* Exposed Tools Overview */}
          <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                暴露给 Agent 的 6 个渐进式只读工具（省 Token 不撑爆上下文）
              </span>
              <span className="text-slate-400 inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                不修改原工程
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
              <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                <code className="font-mono font-semibold text-blue-700">protoflow_get_project_overview</code>
                <span className="text-slate-500 block">全局菜单路由树、共表摘要与静态体检</span>
              </div>
              <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                <code className="font-mono font-semibold text-blue-700">protoflow_get_database_schema</code>
                <span className="text-slate-500 block">ER 物理表、外键、Postgres/MySQL DDL 草稿与种子数据</span>
              </div>
              <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                <code className="font-mono font-semibold text-blue-700">protoflow_get_page_spec</code>
                <span className="text-slate-500 block">单页 TSX 结构、表单/按钮事件链与组件便签</span>
              </div>
              <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                <code className="font-mono font-semibold text-blue-700">protoflow_get_docs_and_flows</code>
                <span className="text-slate-500 block">关联需求文档 (Markdown) 与业务脑图/流程图</span>
              </div>
              <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                <code className="font-mono font-semibold text-blue-700">protoflow_search_spec</code>
                <span className="text-slate-500 block">跨物理表、页面组件、批注便签全文定位</span>
              </div>
              <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                <code className="font-mono font-semibold text-blue-700">protoflow_get_implementation_checklist</code>
                <span className="text-slate-500 block">自动推导全栈表、接口与业务规则核销清单</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
};
