import { unzipSync } from 'fflate';
import { MAX_SINGLE_FIGMA_IMAGE_BYTES, type FigmaImageArchive } from './ir';

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return 'image/png';
}

// Decode selected entries in traversal order, in batches bounded by the single-image limit.
// A later selection can always read a different set of entries from the original ZIP.
export function archiveImageReader(archive: FigmaImageArchive, refs: Set<string>) {
  const ordered = [...refs];
  const positions = new Map(ordered.map((ref, index) => [ref, index]));
  const accepted = new Map<string, string>();
  let batch: Record<string, Uint8Array> = {};
  let readIndividually = false;

  return (ref: string, remaining: number): { src: string } | { reason: string } => {
    const entry = archive.entries[ref];
    const position = positions.get(ref);
    if (!entry || position === undefined) return { reason: '归档中缺少位图文件' };
    if (entry.size > MAX_SINGLE_FIGMA_IMAGE_BYTES) return { reason: '单图超过 4 MiB' };
    const budgetExceeded = '超过内嵌图片额度';
    if (22 + 4 * Math.ceil(entry.size / 3) > remaining) return { reason: budgetExceeded };
    const cached = accepted.get(ref);
    if (cached) return cached.length <= remaining ? { src: cached } : { reason: budgetExceeded };

    if (!Object.hasOwn(batch, entry.name)) {
      const names = new Set<string>([entry.name]);
      let bytes = entry.size;
      for (let i = position + 1; !readIndividually && i < ordered.length; i++) {
        const candidate = archive.entries[ordered[i]];
        if (!candidate || candidate.size > MAX_SINGLE_FIGMA_IMAGE_BYTES) continue;
        if (bytes + candidate.size > MAX_SINGLE_FIGMA_IMAGE_BYTES) break;
        names.add(candidate.name);
        bytes += candidate.size;
      }
      try {
        batch = unzipSync(archive.bytes, { filter: file => names.has(file.name) });
      } catch {
        // Isolate an unreadable entry so its neighbors still import normally.
        readIndividually = true;
        if (names.size === 1) return { reason: '位图文件无法解压' };
        try {
          batch = unzipSync(archive.bytes, { filter: file => file.name === entry.name });
        } catch {
          return { reason: '位图文件无法解压' };
        }
      }
    }
    const data = batch[entry.name];
    const src = `data:${sniffImageMime(data)};base64,${uint8ToBase64(data)}`;
    if (src.length > remaining) return { reason: budgetExceeded };
    accepted.set(ref, src);
    return { src };
  };
}
