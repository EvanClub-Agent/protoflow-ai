// Self-contained Kiwi binary schema & payload codec for Figma (.fig / fig-kiwi) archives.
// Implements Evan Wallace's Kiwi wire specification (null-terminated UTF-8 strings,
// varuint / zigzag varint, zero-compressed varfloat, and embedded .bkiwi schemas).

const utf8Decoder = new TextDecoder('utf-8');
const utf8Encoder = new TextEncoder();

export type KiwiDefKind = 'ENUM' | 'STRUCT' | 'MESSAGE';

export const KIWI_NATIVE_TYPES = [
  'bool',
  'byte',
  'int',
  'uint',
  'float',
  'string',
  'int64',
  'uint64',
] as const;

export type KiwiNativeType = (typeof KIWI_NATIVE_TYPES)[number];

export interface KiwiFieldDef {
  name: string;
  type: string;
  typeId: number; // < 0 => ~nativeIndex, >= 0 => definitions[typeId]
  isArray: boolean;
  value: number;
}

export interface KiwiDefinition {
  name: string;
  kind: KiwiDefKind;
  fields: KiwiFieldDef[];
}

export interface KiwiSchema {
  definitions: KiwiDefinition[];
}

export class KiwiByteBuffer {
  private pos = 0;
  private f32 = new Float32Array(1);
  private i32 = new Int32Array(this.f32.buffer);

  constructor(private data: Uint8Array) {}

  get offset(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.data.length - this.pos;
  }

  readByte(): number {
    if (this.pos >= this.data.length) throw new Error('Kiwi 二进制数据意外截断 (readByte)');
    return this.data[this.pos++];
  }

  readByteArray(): Uint8Array {
    const length = this.readVarUint();
    if (this.pos + length > this.data.length) throw new Error('Kiwi 字节数组越界');
    const slice = this.data.subarray(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  readVarFloat(): number {
    const first = this.readByte();
    if (first === 0) return 0;
    if (this.pos + 3 > this.data.length) throw new Error('Kiwi 浮点数截断');
    const bits =
      first |
      (this.data[this.pos] << 8) |
      (this.data[this.pos + 1] << 16) |
      (this.data[this.pos + 2] << 24);
    this.pos += 3;
    this.i32[0] = (bits << 23) | (bits >>> 9);
    return this.f32[0];
  }

  readVarUint(): number {
    let value = 0;
    let shift = 0;
    do {
      const byte = this.readByte();
      value |= (byte & 127) << shift;
      if ((byte & 128) === 0) return value >>> 0;
      shift += 7;
    } while (shift < 35);
    throw new Error('Kiwi VarUint 长度溢出');
  }

  readVarInt(): number {
    const value = this.readVarUint();
    return value & 1 ? ~(value >>> 1) : value >>> 1;
  }

  readVarUint64(): bigint {
    let value = 0n;
    let shift = 0n;
    let byte: number;
    for (let i = 0; i < 10; i++) {
      byte = i < 9 ? this.readByte() : this.readByte();
      if (i === 9) {
        value |= BigInt(byte) << 63n;
        return value;
      }
      value |= BigInt(byte & 127) << shift;
      if ((byte & 128) === 0) return value;
      shift += 7n;
    }
    return value;
  }

  readVarInt64(): bigint {
    const value = this.readVarUint64();
    return (value & 1n) !== 0n ? ~(value >> 1n) : value >> 1n;
  }

  readString(): string {
    const start = this.pos;
    while (this.pos < this.data.length && this.data[this.pos] !== 0) {
      this.pos++;
    }
    if (this.pos >= this.data.length) throw new Error('Kiwi 字符串缺少结尾符 \\0');
    const str = utf8Decoder.decode(this.data.subarray(start, this.pos));
    this.pos++; // consume null byte
    return str;
  }
}

export class KiwiByteWriter {
  private buf = new Uint8Array(1024);
  private len = 0;
  private f32 = new Float32Array(1);
  private u32 = new Uint32Array(this.f32.buffer);

  private ensure(extra: number) {
    if (this.len + extra <= this.buf.length) return;
    let nextCap = this.buf.length * 2;
    while (nextCap < this.len + extra) nextCap *= 2;
    const next = new Uint8Array(nextCap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }

  writeByte(b: number) {
    this.ensure(1);
    this.buf[this.len++] = b & 0xff;
  }

  writeByteArray(bytes: Uint8Array) {
    this.writeVarUint(bytes.length);
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  writeVarUint(value: number) {
    let v = value >>> 0;
    do {
      let byte = v & 127;
      v >>>= 7;
      if (v !== 0) byte |= 128;
      this.writeByte(byte);
    } while (v !== 0);
  }

  writeVarInt(value: number) {
    this.writeVarUint(((value << 1) ^ (value >> 31)) >>> 0);
  }

  writeVarFloat(value: number) {
    this.f32[0] = value;
    let bits = this.u32[0];
    // Exponent is bits 30..23; zero or denormal normalizes to single 0x00 byte
    if ((bits & 0x7f800000) === 0) {
      this.writeByte(0);
      return;
    }
    bits = ((bits >>> 23) | (bits << 9)) >>> 0;
    this.ensure(4);
    this.buf[this.len++] = bits & 0xff;
    this.buf[this.len++] = (bits >>> 8) & 0xff;
    this.buf[this.len++] = (bits >>> 16) & 0xff;
    this.buf[this.len++] = (bits >>> 24) & 0xff;
  }

  writeVarUint64(value: bigint) {
    let v = BigInt.asUintN(64, value);
    for (let i = 0; i < 9 && v >= 128n; i++) {
      this.writeByte(Number(v & 127n) | 128);
      v >>= 7n;
    }
    this.writeByte(Number(v & 255n));
  }

  writeVarInt64(value: bigint) {
    const u = value < 0n ? (~value << 1n) | 1n : value << 1n;
    this.writeVarUint64(u);
  }

  writeString(str: string) {
    const encoded = utf8Encoder.encode(str);
    this.ensure(encoded.length + 1);
    this.buf.set(encoded, this.len);
    this.len += encoded.length;
    this.buf[this.len++] = 0;
  }
}

const DEF_KINDS: KiwiDefKind[] = ['ENUM', 'STRUCT', 'MESSAGE'];

export function decodeBinarySchema(bytes: Uint8Array): KiwiSchema {
  const bb = new KiwiByteBuffer(bytes);
  const definitionCount = bb.readVarUint();
  if (definitionCount > 10000) throw new Error('Kiwi Schema 定义数量异常');

  const definitions: KiwiDefinition[] = [];
  for (let i = 0; i < definitionCount; i++) {
    const name = bb.readString();
    const kindByte = bb.readByte();
    const kind = DEF_KINDS[kindByte];
    if (!kind) throw new Error(`未知的 Kiwi 定义类型 ${kindByte}`);
    const fieldCount = bb.readVarUint();
    if (fieldCount > 10000) throw new Error(`Kiwi 定义 ${name} 字段过多`);
    const fields: KiwiFieldDef[] = [];
    for (let j = 0; j < fieldCount; j++) {
      const fieldName = bb.readString();
      const typeId = bb.readVarInt();
      const isArray = (bb.readByte() & 1) !== 0;
      const value = bb.readVarUint();
      fields.push({ name: fieldName, type: '', typeId, isArray, value });
    }
    definitions.push({ name, kind, fields });
  }

  for (const def of definitions) {
    for (const field of def.fields) {
      if (def.kind === 'ENUM') {
        field.type = 'uint';
        continue;
      }
      if (field.typeId < 0) {
        const nativeName = KIWI_NATIVE_TYPES[~field.typeId];
        if (!nativeName) throw new Error(`未知的 Kiwi 原生类型编号 ${field.typeId}`);
        field.type = nativeName;
      } else {
        const target = definitions[field.typeId];
        if (!target) throw new Error(`Kiwi 类型引用越界 ${field.typeId}`);
        field.type = target.name;
      }
    }
  }

  return { definitions };
}

export function encodeBinarySchema(schema: KiwiSchema): Uint8Array {
  const w = new KiwiByteWriter();
  const defIndex = new Map<string, number>();
  schema.definitions.forEach((d, i) => defIndex.set(d.name, i));

  w.writeVarUint(schema.definitions.length);
  for (const def of schema.definitions) {
    w.writeString(def.name);
    w.writeByte(DEF_KINDS.indexOf(def.kind));
    w.writeVarUint(def.fields.length);
    for (const f of def.fields) {
      w.writeString(f.name);
      let typeId = f.typeId;
      if (def.kind === 'ENUM') {
        typeId = 0;
      } else if (f.type) {
        const natIdx = (KIWI_NATIVE_TYPES as readonly string[]).indexOf(f.type);
        if (natIdx >= 0) typeId = ~natIdx;
        else if (defIndex.has(f.type)) typeId = defIndex.get(f.type)!;
      }
      w.writeVarInt(typeId);
      w.writeByte(f.isArray ? 1 : 0);
      w.writeVarUint(f.value);
    }
  }
  return w.toUint8Array();
}

export function decodeKiwiMessage(
  schema: KiwiSchema,
  bytes: Uint8Array,
  rootTypeName?: string,
): Record<string, any> {
  const bb = new KiwiByteBuffer(bytes);
  const defsById = schema.definitions;
  const enumValueMaps = defsById.map((def) => {
    if (def.kind !== 'ENUM') return null;
    const m = new Map<number, string>();
    for (const f of def.fields) m.set(f.value, f.name);
    return m;
  });
  const msgFieldMaps = defsById.map((def) => {
    if (def.kind !== 'MESSAGE') return null;
    const m = new Map<number, KiwiFieldDef>();
    for (const f of def.fields) m.set(f.value, f);
    return m;
  });

  const rootIdx = rootTypeName
    ? defsById.findIndex((d) => d.name === rootTypeName)
    : defsById.findIndex((d) => d.name === 'Message');
  if (rootIdx < 0) {
    throw new Error(`Kiwi Schema 中未找到根消息类型 ${rootTypeName ?? 'Message'}`);
  }

  let totalDecodedNodes = 0;
  const MAX_DECODED_ITEMS = 2_500_000;

  const readSingle = (typeId: number, depth: number): any => {
    if (depth > 80) throw new Error('Kiwi 嵌套层级过深');
    if (++totalDecodedNodes > MAX_DECODED_ITEMS) throw new Error('Figma 文件节点规模超出安全解析上限');

    if (typeId < 0) {
      const nativeIdx = ~typeId;
      switch (nativeIdx) {
        case 0:
          return bb.readByte() !== 0;
        case 1:
          return bb.readByte();
        case 2:
          return bb.readVarInt();
        case 3:
          return bb.readVarUint();
        case 4:
          return bb.readVarFloat();
        case 5:
          return bb.readString();
        case 6: {
          const v = bb.readVarInt64();
          return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
        }
        case 7: {
          const v = bb.readVarUint64();
          return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
        }
        default:
          throw new Error(`不支持的 Kiwi 原生类型 ${typeId}`);
      }
    }

    const def = defsById[typeId];
    if (!def) throw new Error(`无效的 Kiwi 类型引用 ${typeId}`);

    if (def.kind === 'ENUM') {
      const rawVal = bb.readVarUint();
      return enumValueMaps[typeId]?.get(rawVal) ?? rawVal;
    }

    if (def.kind === 'STRUCT') {
      const obj: Record<string, any> = {};
      for (const f of def.fields) {
        obj[f.name] = readField(f, depth + 1);
      }
      return obj;
    }

    // MESSAGE: tag-value loop terminated by tag === 0
    const obj: Record<string, any> = {};
    const fieldMap = msgFieldMaps[typeId]!;
    for (;;) {
      const tag = bb.readVarUint();
      if (tag === 0) break;
      const field = fieldMap.get(tag);
      if (!field) {
        throw new Error(`Kiwi 消息 ${def.name} 出现未知字段标签 ${tag}`);
      }
      obj[field.name] = readField(field, depth + 1);
    }
    return obj;
  };

  const readField = (field: KiwiFieldDef, depth: number): any => {
    if (!field.isArray) return readSingle(field.typeId, depth);
    // Fast-path for byte[] (e.g. image hashes, vector blobs)
    if (field.typeId === ~1) {
      return bb.readByteArray();
    }
    const len = bb.readVarUint();
    if (len > 500_000) throw new Error(`Kiwi 数组字段 ${field.name} 长度异常 (${len})`);
    const arr = new Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = readSingle(field.typeId, depth);
    }
    return arr;
  };

  return readSingle(rootIdx, 0);
}

export function encodeKiwiMessage(
  schema: KiwiSchema,
  message: Record<string, any>,
  rootTypeName = 'Message',
): Uint8Array {
  const w = new KiwiByteWriter();
  const defIndex = new Map<string, number>();
  schema.definitions.forEach((d, i) => defIndex.set(d.name, i));

  const rootIdx = defIndex.get(rootTypeName);
  if (rootIdx === undefined) throw new Error(`未找到 Kiwi 类型 ${rootTypeName}`);

  const writeSingle = (typeName: string, val: any) => {
    const natIdx = (KIWI_NATIVE_TYPES as readonly string[]).indexOf(typeName);
    if (natIdx >= 0) {
      switch (natIdx) {
        case 0:
          w.writeByte(val ? 1 : 0);
          return;
        case 1:
          w.writeByte(Number(val) & 0xff);
          return;
        case 2:
          w.writeVarInt(Number(val));
          return;
        case 3:
          w.writeVarUint(Number(val));
          return;
        case 4:
          w.writeVarFloat(Number(val));
          return;
        case 5:
          w.writeString(String(val ?? ''));
          return;
        case 6:
          w.writeVarInt64(BigInt(val ?? 0));
          return;
        case 7:
          w.writeVarUint64(BigInt(val ?? 0));
          return;
      }
    }
    const idx = defIndex.get(typeName);
    if (idx === undefined) throw new Error(`未知类型 ${typeName}`);
    const def = schema.definitions[idx];
    if (def.kind === 'ENUM') {
      const f = def.fields.find((item) => item.name === val);
      w.writeVarUint(f ? f.value : Number(val ?? 0));
      return;
    }
    if (def.kind === 'STRUCT') {
      for (const f of def.fields) {
        writeField(f, val?.[f.name]);
      }
      return;
    }
    // MESSAGE
    for (const f of def.fields) {
      const fv = val?.[f.name];
      if (fv === undefined || fv === null) continue;
      w.writeVarUint(f.value);
      writeField(f, fv);
    }
    w.writeVarUint(0);
  };

  const writeField = (f: KiwiFieldDef, val: any) => {
    const typeName =
      f.type ||
      (f.typeId < 0 ? KIWI_NATIVE_TYPES[~f.typeId] : schema.definitions[f.typeId]?.name);
    if (!f.isArray) {
      writeSingle(typeName, val);
      return;
    }
    if (typeName === 'byte' && val instanceof Uint8Array) {
      w.writeByteArray(val);
      return;
    }
    const arr = Array.isArray(val) ? val : [];
    w.writeVarUint(arr.length);
    for (const item of arr) writeSingle(typeName, item);
  };

  writeSingle(schema.definitions[rootIdx].name, message);
  return w.toUint8Array();
}
