import { EMBEDDED_SKILL_ENTRIES, EMBEDDED_SKILL_FRONTMATTER } from './generatedSkillBundle';

export const MCP_SKILLS_EXTENSION_ID = 'io.modelcontextprotocol/skills';
export const DESIGNER_SKILL_NAME = 'alex-protoflow-designer';
export const DESIGNER_SKILL_ROOT_URI = `skill://${DESIGNER_SKILL_NAME}`;
export const DESIGNER_SKILL_ENTRY_URI = `${DESIGNER_SKILL_ROOT_URI}/SKILL.md`;
const SKILL_CACHE_TTL_MS = 300_000;

export class McpRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'McpRpcError';
    this.code = code;
    this.data = data;
  }
}

export interface McpSkillResourceManifestItem {
  uri: string;
  digest: string;
  size: number;
}

export interface McpSkillEntry {
  uri: string;
  frontmatter: Record<string, unknown>;
  resources: McpSkillResourceManifestItem[];
}

interface LoadedSkillBundle {
  entry: McpSkillEntry;
  filesByUri: Map<string, string>;
  directoriesByUri: Map<string, { uri: string; name: string; mimeType: string }[]>;
}

let cachedBundle: LoadedSkillBundle | null = null;

function getSkillBundle(): LoadedSkillBundle {
  if (cachedBundle) return cachedBundle;
  const filesByUri = new Map<string, string>();
  const resources: McpSkillResourceManifestItem[] = [];
  const rootChildren: { uri: string; name: string; mimeType: string }[] = [];
  const subdirs = new Map<string, { uri: string; name: string; mimeType: string }[]>();

  for (const item of EMBEDDED_SKILL_ENTRIES) {
    const uri = `${DESIGNER_SKILL_ROOT_URI}/${item.relPath}`;
    filesByUri.set(uri, item.text);
    resources.push({ uri, digest: item.digest, size: item.size });

    const segments = item.relPath.split('/');
    if (segments.length === 1) {
      rootChildren.push({ uri, name: segments[0], mimeType: 'text/markdown' });
    } else if (segments.length === 2) {
      const [dirName, fileName] = segments;
      const dirUri = `${DESIGNER_SKILL_ROOT_URI}/${dirName}`;
      if (!subdirs.has(dirUri)) {
        subdirs.set(dirUri, []);
        rootChildren.push({ uri: dirUri, name: dirName, mimeType: 'inode/directory' });
      }
      subdirs.get(dirUri)!.push({ uri, name: fileName, mimeType: 'text/markdown' });
    }
  }

  const directoriesByUri = new Map<string, { uri: string; name: string; mimeType: string }[]>([
    [DESIGNER_SKILL_ROOT_URI, rootChildren],
    ...subdirs.entries(),
  ]);

  cachedBundle = {
    entry: {
      uri: DESIGNER_SKILL_ENTRY_URI,
      frontmatter: EMBEDDED_SKILL_FRONTMATTER,
      resources,
    },
    filesByUri,
    directoriesByUri,
  };
  return cachedBundle;
}

export function listMcpSkills(cursor?: unknown) {
  if (cursor !== undefined) {
    throw new McpRpcError(-32602, 'Invalid pagination cursor');
  }
  const { entry } = getSkillBundle();
  return {
    resultType: 'complete' as const,
    skills: [entry],
    ttlMs: SKILL_CACHE_TTL_MS,
    cacheScope: 'public' as const,
  };
}

export function getMcpSkill(uri: unknown) {
  if (typeof uri !== 'string' || !uri) {
    throw new McpRpcError(-32602, 'Missing or invalid skill uri');
  }
  const { entry } = getSkillBundle();
  if (uri !== entry.uri) {
    throw new McpRpcError(-32602, `Unknown skill URI: ${uri}`);
  }
  return {
    resultType: 'complete' as const,
    skill: entry,
    ttlMs: SKILL_CACHE_TTL_MS,
    cacheScope: 'public' as const,
  };
}

export function readMcpSkillResource(uri: string) {
  const { filesByUri } = getSkillBundle();
  const text = filesByUri.get(uri);
  if (text === undefined) {
    throw new McpRpcError(-32602, `Unknown skill resource URI: ${uri}`);
  }
  return {
    resultType: 'complete' as const,
    contents: [
      {
        uri,
        mimeType: 'text/markdown',
        text,
      },
    ],
    ttlMs: SKILL_CACHE_TTL_MS,
    cacheScope: 'public' as const,
  };
}

export function readMcpSkillDirectory(uri: unknown, cursor?: unknown) {
  if (cursor !== undefined) {
    throw new McpRpcError(-32602, 'Invalid pagination cursor');
  }
  if (typeof uri !== 'string' || !uri || uri.endsWith('/')) {
    throw new McpRpcError(-32602, 'Invalid directory URI (must be a non-empty URI without trailing slash)');
  }
  const { directoriesByUri } = getSkillBundle();
  const children = directoriesByUri.get(uri);
  if (!children) {
    throw new McpRpcError(-32602, `Unknown skill directory URI: ${uri}`);
  }
  return {
    resultType: 'complete' as const,
    resources: children,
    ttlMs: SKILL_CACHE_TTL_MS,
    cacheScope: 'public' as const,
  };
}
