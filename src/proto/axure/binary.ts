// RP record grammar and manifest layout adapted from zee-rp's rp-records.mjs
// and parse-payload.mjs (MIT, see public/licenses/zee-rp.txt). This reader follows
// manifest offsets and decodes only the records requested by the importer.
const utf8 = new TextDecoder('utf-8', { fatal: true });
export const MAX_RP_BYTES = 128 * 1024 * 1024;
const MAX_RECORD = 48 * 1024 * 1024;
const ZERO_GUID = '0'.repeat(32);
const hex = Array.from({ length: 256 }, (_, n) => n.toString(16).padStart(2, '0'));

function invalid(reason: string): never { throw new Error(`RP 文件结构无效：${reason}`); }

class Cursor {
  private pos = 0;
  private view: DataView;
  constructor(private data: Uint8Array) { this.view = new DataView(data.buffer, data.byteOffset, data.byteLength); }
  get remaining() { return this.data.length - this.pos; }
  take(n: number) {
    if (n > this.remaining) invalid('数据截断');
    const start = this.pos;
    this.pos += n;
    return start;
  }
  bytes(n: number) { const start = this.take(n); return this.data.subarray(start, start + n); }
  byte() { return this.data[this.take(1)]; }
  u32() { return this.view.getUint32(this.take(4), true); }
  double() { return this.view.getFloat64(this.take(8), true); }
  varuint() {
    let n = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const b = this.byte();
      n += (b & 127) * 2 ** shift;
      if (!(b & 128)) return n;
    }
    return invalid('清单长度');
  }
}

function manifestJson(data: Uint8Array) {
  const cursor = new Cursor(data);
  const blocks: Uint8Array[] = [];
  let total = 0;
  while (cursor.remaining) {
    const flags = cursor.byte();
    if (flags !== 0 && flags !== 1) invalid('不支持的清单编码');
    const size = cursor.varuint();
    total += size;
    if (total > 8 * 1024 * 1024 || blocks.length >= 4096) invalid('清单过大');
    if (flags === 0) { blocks.push(cursor.bytes(size)); continue; }
    const block = new Cursor(cursor.bytes(cursor.varuint()));
    const out = new Uint8Array(size);
    let pos = 0;
    const length = (n: number) => {
      if (n !== 15) return n;
      let b: number;
      do { b = block.byte(); n += b; } while (b === 255);
      return n;
    };
    while (block.remaining) {
      const token = block.byte();
      const literal = length(token >> 4);
      if (pos + literal > size) invalid('清单解压长度');
      out.set(block.bytes(literal), pos);
      pos += literal;
      if (!block.remaining) break;
      const offset = block.byte() + block.byte() * 256;
      const count = length(token & 15) + 4;
      if (!offset || offset > pos || pos + count > size) invalid('清单解压引用');
      for (let i = 0; i < count; i++, pos++) out[pos] = out[pos - offset];
    }
    if (pos !== size) invalid('清单不完整');
    blocks.push(out);
  }
  const result = new Uint8Array(total);
  let at = 0;
  for (const b of blocks) { result.set(b, at); at += b.length; }
  return JSON.parse(utf8.decode(result));
}

export interface Value {
  tag: number;
  n?: number;
  text?: string;
  bytes?: Uint8Array;
  pair?: [number, number];
  items?: Value[];
  fields?: Map<string | number, Value>;
}
export interface RpObject { id: number; type: string; body: Value }
export const field = (v: Value | undefined, key: string | number) => v?.fields?.get(key);
export function list(v: Value | undefined): Value[] {
  if (!v?.items) return invalid('缺少列表');
  return v.items;
}
export class Graph {
  readonly objects = new Map<number, RpObject>();
  readonly strings: string[] = [];
  private guids: string[] = [];
  readonly root: RpObject;
  constructor(data: Uint8Array, expectedType: string) {
    const c = new Cursor(data);
    c.take(20);
    if (c.u32() !== 0xc351) invalid('对象记录头');
    c.take(4);
    const count = c.u32();
    if (count > 400000) invalid('字符串表过大');
    for (let i = 0; i < count; i++) this.strings.push(utf8.decode(c.bytes(c.u32())));
    let nodes = 0;
    const read = (depth: number): Value => {
      if (depth > 100 || ++nodes > 1500000) invalid('对象记录过大');
      const tag = c.u32();
      switch (tag) {
        case 1: {
          const fields = new Map<string | number, Value>();
          const length = c.u32();
          for (let i = 0; i < length; i++) {
            const key = read(depth + 1);
            const value = read(depth + 1);
            // Structured dictionary keys occur in style caches. We consume them,
            // but only scalar field names and reference keys are queried below.
            const name = key.tag === 3 ? key.n : key.text;
            if (name !== undefined) {
              if (fields.has(name)) invalid('重复字段或对象映射');
              fields.set(name, value);
            }
          }
          return { tag, fields };
        }
        case 2: {
          const items: Value[] = [];
          const length = c.u32();
          for (let i = 0; i < length; i++) items.push(read(depth + 1));
          return { tag, items };
        }
        case 3: case 5: case 15: case 17: case 18: case 20: case 22: return { tag, n: c.u32() };
        case 4: return { tag, bytes: c.bytes(c.u32()) };
        case 6: return { tag, n: c.double() };
        case 8: return { tag, text: this.string(c.u32()) };
        case 9: {
          const id = c.u32(), type = this.string(c.u32()), body = read(depth + 1);
          if (this.objects.has(id)) invalid('重复对象编号');
          this.objects.set(id, { id, type, body });
          return { tag, n: id };
        }
        case 16: case 19: return { tag, pair: [c.u32(), c.u32()] };
        case 25: return { tag, n: c.byte() };
        case 26: case 28: return { tag };
        case 29: c.take(8); return { tag };
        case 30: {
          const length = c.u32();
          if (length > 400000 || this.guids.length) invalid('GUID 表异常');
          for (let i = 0; i < length; i++) this.guids.push(Array.from(c.bytes(16), b => hex[b]).join(''));
          return { tag };
        }
        default: return invalid(`不支持的对象类型 0x${tag.toString(16)}`);
      }
    };
    let rootId: number | undefined;
    while (c.remaining) { const v = read(0); if (v.tag === 15) rootId = v.n; }
    const root = rootId === undefined ? undefined : this.objects.get(rootId);
    if (root?.type !== expectedType) invalid(`缺少 ${expectedType} 根对象`);
    this.root = root;
  }
  string(index: number) { return this.strings[index - 1] ?? invalid('字符串引用越界'); }
  guid(index: number | undefined) {
    const id = index === undefined ? undefined : this.guids[index - 1];
    if (!id || id === ZERO_GUID) return invalid('对象 GUID 缺失');
    return id;
  }
  isNullGuid(index: number) { return this.guids[index - 1] === ZERO_GUID; }
  isNull(ref: Value | undefined) { return ref?.tag === 3 && this.guids[ref.n! - 1] === ZERO_GUID; }
  object(ref: Value | undefined, expectedType?: string) {
    const obj = ref?.tag === 3 ? this.objects.get(ref.n!) : undefined;
    if (!obj || (expectedType && obj.type !== expectedType)) return invalid(`对象引用缺失或类型错误 ${expectedType ?? ''}`);
    return obj;
  }
}

interface ManifestEntry { parts?: { package?: number }; children?: Record<string, ManifestEntry> }

export class RpArchive {
  readonly version: 9 | 11;
  private dataStart: number;
  private packages = new Map<string, number>();
  private documentOffset: number;
  private expanded = 0;
  constructor(private data: Uint8Array) {
    if (data.length > MAX_RP_BYTES) throw new Error('RP 文件超过 128 MiB');
    if (data[0] !== 0xac || data[1] !== 0xef) throw new Error('请选择 Axure RP 二进制源文件（.rp）');
    const c = new Cursor(data);
    c.take(2);
    const version = c.byte() + 256 * c.byte();
    if (version !== 9 && version !== 11) throw new Error(`当前支持 Axure RP 9 和 11，文件版本为 ${version}`);
    this.version = version;
    const length = c.u32();
    this.dataStart = 8 + length;
    const manifest = manifestJson(c.bytes(length));
    this.documentOffset = manifest.root?.parts?.DesignDocument;
    // Document PackageInfos reference root packages. Nested packages such as
    // panel states belong to their parent and may reuse GUIDs on another page.
    const index = (children: Record<string, ManifestEntry>, parent: string, depth: number) => {
      if (depth > 48) invalid('包层级过深');
      for (const [key, child] of Object.entries(children)) {
        if (child.parts?.package === undefined) continue;
        if (!/^[0-9a-f]{32}$/i.test(key)) invalid('包 GUID 格式');
        const b = key.toLowerCase().match(/../g)!;
        const guid = [...b.slice(0, 4).reverse(), ...b.slice(4, 6).reverse(), ...b.slice(6, 8).reverse(), ...b.slice(8)].join('');
        const path = parent ? parent + '/' + guid : guid;
        if (this.packages.has(path)) invalid('重复包路径');
        this.packages.set(path, child.parts.package);
        if (child.children) index(child.children, path, depth + 1);
      }
    };
    index(manifest.root?.children ?? {}, '', 0);
  }
  document() { return this.record(this.documentOffset, 'Axure:DesignDocument'); }
  hasDiagram(path: string) { return this.packages.has(path); }
  async diagram(path: string, type: 'Axure:Page' | 'Axure:Master' | 'Axure:PanelState') {
    const graph = await this.record(this.packages.get(path), type);
    if (graph.guid(2) !== path.split('/').pop()) invalid('图表记录与清单 GUID 不一致');
    return graph;
  }
  private async record(relative: number | undefined, type: string) {
    if (relative === undefined || !Number.isSafeInteger(relative) || relative < 0 || this.dataStart + relative + 8 > this.data.length) return invalid('包位置无效');
    const start = this.dataStart + relative + 8;
    const view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    const length = view.getUint32(start - 4, true);
    if (length < 18 || start + length > this.data.length) invalid('包长度异常');
    const size = view.getUint32(start + length - 4, true);
    if (size > MAX_RECORD || (this.expanded += size) > 256 * 1024 * 1024) invalid('解压内容过大');
    const bytes = this.data.subarray(start, start + length);
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const out = new Uint8Array(size);
    let pos = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (pos + value.length > size) { await reader.cancel(); invalid('解压大小不符'); }
      out.set(value, pos); pos += value.length;
    }
    if (pos !== size) invalid('包内容截断');
    return new Graph(out, type);
  }
}
