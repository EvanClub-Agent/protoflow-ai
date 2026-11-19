import { isLosslessNumber, parse, stringify, type LosslessNumber } from 'lossless-json';
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
  shareUrl?: string;
  password?: string;
  help?: boolean;
  version?: boolean;
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
  return opts;
}

function usageText(): string {
  return [
    `${SPEC_MCP_SERVER_NAME} v${SPEC_MCP_SERVER_VERSION} — Alex (ProtoFlow AI) Read-Only Specification MCP Server`,
    '',
    'Usage:',
    '  protoflow-mcp --project <path/to/project.pflow>',
    '  protoflow-mcp --share <https://proto.example.com/p/shareId> [--password <secret>]',
    '',
    'Environment variables:',
    '  PROTOFLOW_PROJECT_PATH     Path to a local .pflow project file',
    '  PROTOFLOW_SHARE_URL        Online published share URL (/p/<shareId>)',
    '  PROTOFLOW_SHARE_PASSWORD   Optional password for protected online shares',
  ].join('\n');
}

export function buildWorkspaceLoaderFromCli(opts: CliOptions): WorkspaceLoader {
  if (opts.projectPath && opts.shareUrl) {
    throw new Error('请勿同时指定 --project 与 --share，每次连接请选择单一数据源');
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
  throw new Error('缺少数据源参数：请传入 --project <path.pflow> 或 --share <https://.../p/id>');
}

function parseStdioPayload(text: string): unknown {
  const numericIds = new WeakMap<object, LosslessNumber>();
  const payload = parse(text, function (this: object, key, value) {
    if (!isLosslessNumber(value)) return value;
    if (key === 'id') numericIds.set(this, value);
    return Number(value.value);
  }, { onDuplicateKey: ({ newValue }) => newValue });

  // Restore only envelope IDs. Tool arguments, including nested id fields, retain JSON.parse semantics.
  for (const request of Array.isArray(payload) ? payload : [payload]) {
    if (request && typeof request === 'object' && 'id' in request) {
      const id = numericIds.get(request);
      if (id) request.id = id;
    }
  }
  return payload;
}

export function startStdioMcpServer(loader: WorkspaceLoader): void {
  // Redirect accidental console.log calls to stderr so stdout only carries MCP JSON-RPC frames.
  const writeStderr = (...items: unknown[]) => {
    process.stderr.write(items.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
  };
  console.log = writeStderr;
  console.info = writeStderr;
  console.warn = writeStderr;

  let buffer = Buffer.alloc(0);
  let queue = Promise.resolve();

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
        const response = await handleSpecMcpPayload(loader, parsed);
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
