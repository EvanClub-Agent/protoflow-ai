import { isLosslessNumber, parse, type LosslessNumber } from 'lossless-json';

export function parseStdioPayload(text: string): unknown {
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
