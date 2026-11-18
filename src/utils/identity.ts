/** Business and editor identities must remain unique within synchronous batches. */
export function newId(prefix: string): string {
  if (typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  // LAN HTTP viewers lack randomUUID (secure-context only). Generate the same
  // UUID v4 format using Web Crypto, which also works in an HTTP context.
  // Never substitute an existing business field or a timestamp for the new ID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
