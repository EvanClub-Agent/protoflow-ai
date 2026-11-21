import type { HermesOperation } from '../../services/hermesClient';

// Large RP pages share nearly all their source with the imported page. Keep
// exact ranges of original lines in the pending review instead of persisting
// multiple complete copies in the chat's localStorage entry.
type Lines = (string | [number,number])[];
type Digest = (text:string)=>Promise<string>;

function sourceLines(base:string, candidate:string):Lines {
  const lines = base.split('\n');
  const indices = new Map<string,number>();
  lines.forEach((line,i)=>{ if (!indices.has(line)) indices.set(line,i); });
  const parts:Lines = [];
  for (const line of candidate.split('\n')) {
    const last = parts.at(-1);
    if (Array.isArray(last) && lines[last[0]+last[1]] === line) {
      last[1]++;
    } else {
      const index = indices.get(line);
      parts.push(index === undefined ? line : [index,1]);
    }
  }
  return parts;
}

const optimizedId = /^rp-optimized-([a-f0-9]{32})$/;
function baselineId(sources:Record<string,string>, target:string) {
  const guid = optimizedId.exec(target)?.[1];
  if (!guid) throw new Error('RP 优化版页面 ID 无效');
  return Object.hasOwn(sources,target) ? target : 'rp-page-' + guid;
}

export async function compactRpReview(sources:Record<string,string>, operations:HermesOperation[], digest:Digest) {
  const result:HermesOperation[] = [];
  for (const op of operations) {
    const {pageId,source,...args} = op.args;
    if (op.tool !== 'protoflow_apply_tsx_patch' || typeof pageId !== 'string' || typeof source !== 'string' || !optimizedId.test(pageId)) {
      result.push(op);
      continue;
    }
    const id = baselineId(sources,pageId);
    if (!Object.hasOwn(sources,id)) {
      result.push(op);
      continue;
    }
    const parts = sourceLines(sources[id],source);
    if (JSON.stringify(parts).length + 160 >= source.length) result.push(op);
    else result.push({tool:op.tool,args:{...args,pageId,rpSourcePatch:{parts,length:source.length,digest:await digest(source)}}});
  }
  return result;
}

// Called after the project revision check, before the normal host validation.
// Verify the reconstructed TSX is byte-for-byte the reviewed candidate.
export async function expandRpReview(sources:Record<string,string>, operations:HermesOperation[], digest:Digest) {
  const result:HermesOperation[] = [];
  for (const op of operations) {
    if (!Object.hasOwn(op.args,'rpSourcePatch')) { result.push(op); continue; }
    const {rpSourcePatch,...args} = op.args;
    if (op.tool !== 'protoflow_apply_tsx_patch' || typeof args.pageId !== 'string' || Object.hasOwn(args,'source'))
      throw new Error('RP 变更来源格式错误');
    const id = baselineId(sources,args.pageId);
    if (!Object.hasOwn(sources,id)) throw new Error('RP 变更的源页不存在');
    const patch = rpSourcePatch as {parts:Lines;length:number;digest:string};
    if (!patch || !Array.isArray(patch.parts) || !Number.isSafeInteger(patch.length) || patch.length < 0 || !/^[a-f0-9]{64}$/.test(patch.digest))
      throw new Error('RP 变更记录不完整');
    const lines = sources[id].split('\n'), pieces:string[] = [];
    let size = 0;
    for (const part of patch.parts) {
      let piece:string;
      if (typeof part === 'string') piece = part;
      else if (Array.isArray(part) && part.length === 2 && part.every(Number.isSafeInteger) && part[0]>=0 && part[1]>0 && part[0]+part[1]<=lines.length)
        piece = lines.slice(part[0],part[0]+part[1]).join('\n');
      else throw new Error('RP 变更引用的原文范围无效');
      size += piece.length + (pieces.length ? 1 : 0);
      if (size>patch.length) throw new Error('RP 变更内容与确认单不一致');
      pieces.push(piece);
    }
    const source = pieces.join('\n');
    if (size !== patch.length || await digest(source) !== patch.digest) throw new Error('RP 变更内容与确认单不一致');
    result.push({tool:op.tool,args:{...args,source}});
  }
  return result;
}

export function formatRpReviewArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (!Object.hasOwn(args, 'rpSourcePatch')) return args;
  const { rpSourcePatch, ...rest } = args;
  const patch = rpSourcePatch as { parts?: unknown[]; length?: number } | undefined;
  if (!patch || !Array.isArray(patch.parts)) return args;
  const unchangedLines = patch.parts.reduce<number>(
    (sum, part) => sum + (Array.isArray(part) && typeof part[1] === 'number' ? part[1] : 0),
    0,
  );
  const changedLines = patch.parts.filter((part): part is string => typeof part === 'string');
  return { ...rest, unchangedSourceLines: unchangedLines, changedTsxLines: changedLines };
}
