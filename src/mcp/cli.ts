import { parseStdioPayload } from './wire';
import { createDesktopRelay } from './desktopRelay';
import { stringify } from 'lossless-json';
import { tr } from '../i18n/runtime';
import { createLocalAuthoringWorkspace, type McpServerMode } from './authoringWorkspace';
import {
  handleSpecMcpPayload,
  SPEC_MCP_SERVER_NAME,
  SPEC_MCP_SERVER_VERSION,
} from './protocol';
import {
  createLocalWorkspaceLoader,
  createRemoteWorkspaceLoader,
  type WorkspaceLoader,
} from './workspace';

export interface CliOptions {
  projectPath?: string;
  desktopBridge?: string;
  shareUrl?: string;
  password?: string;
  mode?: McpServerMode;
  workspaceDir?: string;
  help?: boolean;
  version?: boolean;
}

function parseServerMode(raw: string): McpServerMode {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'readonly' || normalized === 'read-only' || normalized === 'ro') {
    return 'readonly';
  }
  if (normalized === 'readwrite' || normalized === 'read-write' || normalized === 'rw') {
    return 'readwrite';
  }
  throw new Error(
    tr(
      `无效的 --mode 参数 "${raw}"；仅支持 readonly 或 readwrite`,
      `Invalid --mode value "${raw}"; expected "readonly" or "readwrite"`
    )
  );
}

export function parseCliArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const opts: CliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--version' || arg === '-v') {
      opts.version = true;
    } else if (arg === '--project' || arg === '-p') {
      opts.projectPath = argv[++i];
    } else if (arg.startsWith('--project=')) {
      opts.projectPath = arg.slice('--project='.length);
    } else if (arg === '--share' || arg === '-s') {
      opts.shareUrl = argv[++i];
    } else if (arg.startsWith('--share=')) {
      opts.shareUrl = arg.slice('--share='.length);
    } else if (arg === '--password') {
      opts.password = argv[++i];
    } else if (arg.startsWith('--password=')) {
      opts.password = arg.slice('--password='.length);
    } else if (arg === '--mode' || arg === '-m') {
      const next = argv[++i];
      if (!next) throw new Error(tr('参数 --mode 缺少值', 'Missing value for --mode'));
      opts.mode = parseServerMode(next);
    } else if (arg.startsWith('--mode=')) {
      opts.mode = parseServerMode(arg.slice('--mode='.length));
    } else if (arg === '--desktop-bridge' || arg.startsWith('--desktop-bridge=')) {
      const value = arg === '--desktop-bridge' ? argv[++i] : arg.slice('--desktop-bridge='.length);
      if (!value?.trim() || value.startsWith('-')) throw new Error('Missing path for --desktop-bridge');
      opts.desktopBridge = value;
    } else if (arg === '--readwrite' || arg === '--rw') {
      opts.mode = 'readwrite';
    } else if (arg === '--workspace' || arg === '-w') {
      opts.workspaceDir = argv[++i];
    } else if (arg.startsWith('--workspace=')) {
      opts.workspaceDir = arg.slice('--workspace='.length);
    } else if (!arg.startsWith('-') && !opts.projectPath && !opts.shareUrl) {
      if (/^https?:\/\//i.test(arg)) opts.shareUrl = arg;
      else opts.projectPath = arg;
    }
  }

  if (!opts.projectPath && env.PROTOFLOW_PROJECT_PATH) {
    opts.projectPath = env.PROTOFLOW_PROJECT_PATH;
  }
  if (!opts.shareUrl && env.PROTOFLOW_SHARE_URL) {
    opts.shareUrl = env.PROTOFLOW_SHARE_URL;
  }
  if (opts.password === undefined && env.PROTOFLOW_SHARE_PASSWORD) {
    opts.password = env.PROTOFLOW_SHARE_PASSWORD;
  }
  if (!opts.mode && env.PROTOFLOW_MCP_MODE) {
    opts.mode = parseServerMode(env.PROTOFLOW_MCP_MODE);
  }
  if (!opts.workspaceDir && env.PROTOFLOW_WORKSPACE_DIR) {
    opts.workspaceDir = env.PROTOFLOW_WORKSPACE_DIR;
  }
  if (opts.desktopBridge && (opts.mode !== 'readwrite' || opts.projectPath || opts.shareUrl || opts.workspaceDir)) {
    throw new Error('--desktop-bridge requires --mode readwrite and a single desktop data source');
  }
  return opts;
}

function usageText(): string {
  return [
    `${SPEC_MCP_SERVER_NAME} v${SPEC_MCP_SERVER_VERSION} — Alex (ProtoFlow AI) Specification & Authoring MCP Server`,
    '',
    'Usage:',
    '  protoflow-mcp --project <path/to/project.pflow>',
    '  protoflow-mcp --share <https://proto.example.com/p/shareId> [--password <secret>]',
    '  protoflow-mcp --mode readwrite [--project <path/to/project.pflow>] [--workspace <dir>]',
    '',
    '  protoflow-mcp --mode readwrite --desktop-bridge <connection.json>',
    '',
    'Options:',
    '  -m, --mode <readonly|readwrite>   Server permission mode (default: readonly)',
    '      --readwrite, --rw             Shorthand for --mode readwrite',
    '  -w, --workspace <dir>             Default directory for creating/listing .pflow files',
    '  -p, --project <path.pflow>        Local .pflow project file',
    '  -s, --share <url>                 Online published share URL (/p/<shareId>, readonly only)',
    '      --desktop-bridge <file>       Live connection file generated by Alex Desktop (readwrite only)',
    '      --password <secret>           Optional password for protected online shares',
    '',
    'Environment variables:',
    '  PROTOFLOW_MCP_MODE         readonly (default) or readwrite',
    '  PROTOFLOW_WORKSPACE_DIR    Default directory for creating/listing .pflow files',
    '  PROTOFLOW_PROJECT_PATH     Path to a local .pflow project file',
    '  PROTOFLOW_SHARE_URL        Online published share URL (/p/<shareId>)',
    '  PROTOFLOW_SHARE_PASSWORD   Optional password for protected online shares',
  ].join('\n');
}

export function buildWorkspaceLoaderFromCli(opts: CliOptions): WorkspaceLoader {
  if (opts.desktopBridge) throw new Error('Desktop connections use the live stdio relay');
  const mode: McpServerMode = opts.mode ?? 'readonly';

  if (opts.projectPath && opts.shareUrl) {
    throw new Error(
      tr(
        '请勿同时指定 --project 与 --share，每次连接请选择单一数据源',
        'Do not specify both --project and --share; connect to a single data source per instance'
      )
    );
  }

  if (mode === 'readwrite') {
    if (opts.shareUrl) {
      throw new Error(
        tr(
          '在线分享链接（--share）仅支持只读模式；读写模式（--mode readwrite）只能连接本地 .pflow 工程或工作目录',
          'Remote share URLs (--share) are strictly read-only; --mode readwrite only supports local .pflow projects or --workspace directories'
        )
      );
    }
    return createLocalAuthoringWorkspace({
      projectPath: opts.projectPath,
      workspaceDir: opts.workspaceDir,
    });
  }

  if (opts.projectPath) {
    return createLocalWorkspaceLoader(opts.projectPath);
  }
  if (opts.shareUrl) {
    return createRemoteWorkspaceLoader({
      shareUrl: opts.shareUrl,
      password: opts.password,
    });
  }
  throw new Error(
    tr(
      '缺少数据源参数：请传入 --project <path.pflow> 或 --share <https://.../p/id>（若使用读写创作模式，请传 --mode readwrite）',
      'Missing data source: pass --project <path.pflow> or --share <https://.../p/id> (or pass --mode readwrite for authoring mode)'
    )
  );
}

export function startStdioMcpServer(loader: WorkspaceLoader | ReturnType<typeof createDesktopRelay>): void {
  // Redirect accidental console.log calls to stderr so stdout only carries MCP JSON-RPC frames.
  const writeStderr = (...items: unknown[]) => {
    process.stderr.write(items.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
  };
  console.log = writeStderr;
  console.info = writeStderr;
  console.warn = writeStderr;

  let buffer = Buffer.alloc(0);
  let queue = Promise.resolve();
  const connection = { modern: false };

  const dispatchMessage = (rawJson: string, useContentLength: boolean) => {
    const trimmed = rawJson.trim();
    if (!trimmed) return;
    queue = queue
      .then(async () => {
        let parsed: unknown;
        try {
          parsed = parseStdioPayload(trimmed);
        } catch {
          const errFrame = JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          });
          if (useContentLength) {
            process.stdout.write(`Content-Length: ${Buffer.byteLength(errFrame, 'utf8')}\r\n\r\n${errFrame}`);
          } else {
            process.stdout.write(`${errFrame}\n`);
          }
          return;
        }
        const response = typeof loader === 'function'
          ? await loader(parsed)
          : await handleSpecMcpPayload(loader, parsed, connection);
        if (!response) return;
        const encoded = stringify(response)!;
        if (useContentLength) {
          process.stdout.write(`Content-Length: ${Buffer.byteLength(encoded, 'utf8')}\r\n\r\n${encoded}`);
        } else {
          process.stdout.write(`${encoded}\n`);
        }
      })
      .catch((err) => {
        writeStderr('[protoflow-spec] unhandled error:', err instanceof Error ? err.message : String(err));
      });
  };

  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      // Auto-detect Content-Length framing vs standard MCP newline-delimited JSON-RPC
      const asciiPrefix = buffer.subarray(0, Math.min(buffer.length, 32)).toString('ascii');
      if (/^Content-Length:/i.test(asciiPrefix)) {
        const sepIdx = buffer.indexOf('\r\n\r\n');
        if (sepIdx < 0) return;
        const headerText = buffer.subarray(0, sepIdx).toString('ascii');
        const match = /Content-Length:\s*(\d+)/i.exec(headerText);
        if (!match) {
          buffer = buffer.subarray(sepIdx + 4);
          continue;
        }
        const byteLen = Number(match[1]);
        const bodyStart = sepIdx + 4;
        if (buffer.length < bodyStart + byteLen) return;
        const body = buffer.subarray(bodyStart, bodyStart + byteLen).toString('utf8');
        buffer = buffer.subarray(bodyStart + byteLen);
        dispatchMessage(body, true);
      } else {
        const nlIdx = buffer.indexOf(0x0a); // '\n'
        if (nlIdx < 0) return;
        const line = buffer.subarray(0, nlIdx).toString('utf8');
        buffer = buffer.subarray(nlIdx + 1);
        dispatchMessage(line, false);
      }
    }
  });

  process.stdin.on('end', () => {
    if (buffer.length > 0) {
      const tail = buffer.toString('utf8');
      buffer = Buffer.alloc(0);
      dispatchMessage(tail, false);
    }
  });
}

export function runCli(argv = process.argv.slice(2)): void {
  let opts: CliOptions;
  try {
    opts = parseCliArgs(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${usageText()}\n`);
    process.exit(1);
    return;
  }

  if (opts.help) {
    process.stdout.write(`${usageText()}\n`);
    return;
  }
  if (opts.version) {
    process.stdout.write(`${SPEC_MCP_SERVER_VERSION}\n`);
    return;
  }

  let loader: WorkspaceLoader;
  try {
    if (opts.desktopBridge) {
      startStdioMcpServer(createDesktopRelay(opts.desktopBridge));
      return;
    }
    loader = buildWorkspaceLoaderFromCli(opts);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${usageText()}\n`);
    process.exit(1);
    return;
  }

  startStdioMcpServer(loader);
}

// Run immediately when invoked as main script
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  runCli();
}
