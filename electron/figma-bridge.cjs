const dns = require('node:dns');
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');

const MAX_SINGLE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_REDIRECTS = 5;

function parseIpv4Bytes(input) {
  if (typeof input !== 'string' || net.isIPv4(input) === false) return null;
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out[i] = n;
  }
  return out;
}

function parseIpv6Bytes(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!raw || raw.includes('%')) return null;
  if (net.isIPv6(raw) === false) return null;

  let normalized = raw;
  // Convert trailing dotted-quad IPv4 (e.g. ::ffff:127.0.0.1) into two 16-bit hex groups.
  const lastColon = normalized.lastIndexOf(':');
  if (lastColon >= 0 && normalized.slice(lastColon + 1).includes('.')) {
    const v4 = parseIpv4Bytes(normalized.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    normalized = `${normalized.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const dblParts = normalized.split('::');
  if (dblParts.length > 2) return null;

  const parseGroups = (seg) => {
    if (!seg) return [];
    const tokens = seg.split(':');
    const nums = [];
    for (const t of tokens) {
      if (!/^[0-9a-f]{1,4}$/.test(t)) return null;
      nums.push(parseInt(t, 16));
    }
    return nums;
  };

  let groups;
  if (dblParts.length === 2) {
    const left = parseGroups(dblParts[0]);
    const right = parseGroups(dblParts[1]);
    if (!left || !right || left.length + right.length > 7) return null;
    const zeros = new Array(8 - left.length - right.length).fill(0);
    groups = [...left, ...zeros, ...right];
  } else {
    groups = parseGroups(dblParts[0]);
    if (!groups || groups.length !== 8) return null;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i] & 0xff;
  }
  return bytes;
}

function isNonPublicIpv4Bytes(b) {
  if (!b || b.length !== 4) return true;
  const [a, c, d] = b;
  if (a === 0) return true; // 0.0.0.0/8 "This network"
  if (a === 10) return true; // 10.0.0.0/8 RFC 1918 private
  if (a === 100 && (c & 0xc0) === 64) return true; // 100.64.0.0/10 RFC 6598 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 Loopback
  if (a === 169 && c === 254) return true; // 169.254.0.0/16 Link-local / Metadata
  if (a === 172 && (c & 0xf0) === 16) return true; // 172.16.0.0/12 RFC 1918 private
  if (a === 192 && c === 0 && d === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && c === 0 && d === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && c === 88 && d === 99) return true; // 192.88.99.0/24 6to4 relay anycast
  if (a === 192 && c === 168) return true; // 192.168.0.0/16 RFC 1918 private
  if (a === 198 && (c === 18 || c === 19)) return true; // 198.18.0.0/15 Benchmarking
  if (a === 198 && c === 51 && d === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && c === 0 && d === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 Multicast + 240.0.0.0/4 Reserved/Broadcast
  return false;
}

function allZero(bytes, start, end) {
  for (let i = start; i < end; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

function isNonPublicIpv6Bytes(b) {
  if (!b || b.length !== 16) return true;
  // ::/128 unspecified & ::1/128 loopback & ::/96 deprecated IPv4-compatible
  if (allZero(b, 0, 12)) {
    return true;
  }
  // ::ffff:0:0/96 IPv4-mapped IPv6 (covers WHATWG hex serialization like ::ffff:7f00:1)
  if (allZero(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) {
    return isNonPublicIpv4Bytes(b.subarray(12, 16));
  }
  // ::ffff:0:0:0/96 SIIT IPv4-translated
  if (allZero(b, 0, 8) && b[8] === 0xff && b[9] === 0xff && b[10] === 0 && b[11] === 0) {
    return isNonPublicIpv4Bytes(b.subarray(12, 16));
  }
  // 64:ff9b::/96 RFC 6052 Well-Known NAT64 prefix -> check embedded IPv4 in bytes 12..15
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && allZero(b, 4, 12)) {
    return isNonPublicIpv4Bytes(b.subarray(12, 16));
  }
  // 64:ff9b:1::/48 RFC 8215 Local-Use NAT64 prefix
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b[4] === 0x00 && b[5] === 0x01) {
    return true;
  }
  // 100::/64 Discard-Only prefix
  if (b[0] === 0x01 && b[1] === 0x00 && allZero(b, 2, 8)) {
    return true;
  }
  // 2001::/32 Teredo, 2001:2::/48 Benchmarking, 2001:db8::/32 Documentation
  if (b[0] === 0x20 && b[1] === 0x01) {
    if (b[2] === 0x00 && b[3] === 0x00) return true; // Teredo
    if (b[2] === 0x00 && b[3] === 0x02 && b[4] === 0x00 && b[5] === 0x00) return true; // Benchmarking
    if (b[2] === 0x0d && b[3] === 0xb8) return true; // Documentation
  }
  // 2002::/16 6to4 -> embedded IPv4 is in bytes 2..5
  if (b[0] === 0x20 && b[1] === 0x02) {
    return isNonPublicIpv4Bytes(b.subarray(2, 6));
  }
  // fc00::/7 Unique Local
  if ((b[0] & 0xfe) === 0xfc) return true;
  // fe80::/10 Link-Local & fec0::/10 deprecated Site-Local
  if (b[0] === 0xfe && ((b[1] & 0xc0) === 0x80 || (b[1] & 0xc0) === 0xc0)) return true;
  // ff00::/8 Multicast
  if (b[0] === 0xff) return true;
  // Everything outside Global Unicast 2000::/3 is reserved by IETF
  if ((b[0] & 0xe0) !== 0x20) return true;
  return false;
}

function isPrivateOrLocalHostname(hostname) {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host.includes('%')) return true; // Scoped IPv6 zone IDs are link-local
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;

  const v4 = parseIpv4Bytes(host);
  if (v4) return isNonPublicIpv4Bytes(v4);

  const v6 = parseIpv6Bytes(host);
  if (v6) return isNonPublicIpv6Bytes(v6);

  // If net.isIP reports an IP that failed strict parsing, treat as non-public.
  if (net.isIP(host) !== 0) return true;
  return false;
}

function sniffRasterImageMime(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return null;
}

async function readResponseBytesWithLimit(resp, maxBytes, abortController) {
  const limit = Math.max(1, Math.min(MAX_SINGLE_IMAGE_BYTES, Number(maxBytes) || MAX_SINGLE_IMAGE_BYTES));
  const contentLength = Number(resp.headers?.get?.('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    try { abortController?.abort(); } catch { /* ignore */ }
    try { await resp.body?.cancel?.(); } catch { /* ignore */ }
    throw new Error('IMAGE_TOO_LARGE');
  }
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    const ab = await resp.arrayBuffer();
    if (ab.byteLength > limit) throw new Error('IMAGE_TOO_LARGE');
    return new Uint8Array(ab);
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > limit) {
        try { abortController?.abort(); } catch { /* ignore */ }
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new Error('IMAGE_TOO_LARGE');
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

async function validatePublicHttpsImageUrl(parsedUrl, lookupHost) {
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username ||
    parsedUrl.password ||
    isPrivateOrLocalHostname(parsedUrl.hostname)
  ) {
    return { ok: false, error: 'Only public HTTPS image URLs are allowed' };
  }
  if (typeof lookupHost === 'function' && net.isIP(parsedUrl.hostname.replace(/^\[|\]$/g, '')) === 0) {
    const records = await lookupHost(parsedUrl.hostname, { all: true, verbatim: true });
    const list = Array.isArray(records) ? records : records ? [records] : [];
    if (list.length === 0 || list.some((entry) => isPrivateOrLocalHostname(entry?.address))) {
      return { ok: false, error: 'Image hostname resolved to a non-public IP address' };
    }
  }
  return { ok: true };
}

function createPinnedHttpsFetch(lookupFn) {
  return (urlString, init = {}) =>
    new Promise((resolve, reject) => {
      const parsed = new URL(urlString);
      const safeLookup = (hostname, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        const wantAll = typeof opts === 'object' && opts !== null && opts.all === true;
        Promise.resolve(lookupFn(hostname, { all: true, verbatim: true }))
          .then((records) => {
            const rawList = Array.isArray(records) ? records : records ? [records] : [];
            if (rawList.length === 0 || rawList.some((r) => !r || typeof r.address !== 'string' || isPrivateOrLocalHostname(r.address))) {
              callback(new Error('Image hostname resolved to a non-public IP address'));
              return;
            }
            if (wantAll) {
              callback(null, rawList);
            } else {
              callback(null, rawList[0].address, rawList[0].family || (net.isIP(rawList[0].address) || 4));
            }
          })
          .catch((err) => callback(err));
      };

      const req = https.request(
        parsed,
        {
          method: init.method || 'GET',
          headers: init.headers,
          lookup: net.isIP(parsed.hostname.replace(/^\[|\]$/g, '')) === 0 ? safeLookup : undefined,
        },
        (res) => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) v.forEach((item) => headers.append(k, item));
            else if (typeof v === 'string') headers.set(k, v);
          }
          const status = res.statusCode || 0;
          if (status === 204 || status === 304 || (status >= 300 && status < 400)) {
            res.resume();
            resolve(new Response(null, { status, headers }));
            return;
          }
          const stream = new ReadableStream({
            start(controller) {
              res.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
              res.on('end', () => controller.close());
              res.on('error', (err) => controller.error(err));
            },
            cancel() {
              res.destroy();
            },
          });
          resolve(new Response(stream, { status, headers }));
        },
      );

      if (init.signal) {
        if (init.signal.aborted) {
          req.destroy(new Error('Aborted'));
          reject(new Error('Aborted'));
          return;
        }
        init.signal.addEventListener(
          'abort',
          () => {
            req.destroy(new Error('Aborted'));
          },
          { once: true },
        );
      }
      req.on('error', reject);
      req.end();
    });
}

function createFigmaBridge({ dataDir, safeStorage, fetchImpl, lookupHost }) {
  const effectiveLookupHost =
    lookupHost !== undefined ? lookupHost : fetchImpl ? null : dns.promises.lookup;
  const effectiveFetch = fetchImpl ?? fetch;
  const effectiveImageFetch = fetchImpl ?? createPinnedHttpsFetch(effectiveLookupHost || dns.promises.lookup);
  const settingsFile = path.join(dataDir, 'figma-settings.json');
  let sessionToken = '';
  let tokenGeneration = 0;
  let tokenQueue = Promise.resolve();

  const enqueueTokenOp = (work) => {
    const next = tokenQueue.catch(() => {}).then(work);
    tokenQueue = next.catch(() => {});
    return next;
  };

  // Only treat ENOENT as already deleted; propagate permission/IO errors to callers.
  const removeSettingsFileStrict = () => {
    try {
      fs.unlinkSync(settingsFile);
    } catch (err) {
      if (err && err.code === 'ENOENT') return;
      throw err;
    }
  };

  const writeEncryptedPayload = (encryptedBuf) => {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    const tmp = `${settingsFile}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ encryptedToken: Buffer.from(encryptedBuf).toString('base64') }),
      { encoding: 'utf-8', mode: 0o600 },
    );
    fs.renameSync(tmp, settingsFile);
  };

  const canEncrypt = async () => {
    if (!safeStorage) return false;
    const available =
      typeof safeStorage.isAsyncEncryptionAvailable === 'function'
        ? Boolean(await safeStorage.isAsyncEncryptionAvailable())
        : Boolean(safeStorage.isEncryptionAvailable?.());
    if (!available) return false;
    if (safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false;
    return true;
  };

  const encryptToken = async (plain) => {
    if (typeof safeStorage.encryptStringAsync === 'function') {
      return await safeStorage.encryptStringAsync(plain);
    }
    return safeStorage.encryptString(plain);
  };

  const decryptToken = async (buf) => {
    if (typeof safeStorage.decryptStringAsync === 'function') {
      const unwrapped = await safeStorage.decryptStringAsync(buf);
      if (typeof unwrapped === 'string') {
        return { plain: unwrapped, shouldReEncrypt: false };
      }
      return {
        plain: typeof unwrapped?.result === 'string' ? unwrapped.result : '',
        shouldReEncrypt: unwrapped?.shouldReEncrypt === true,
      };
    }
    const syncPlain = safeStorage.decryptString(buf);
    return { plain: typeof syncPlain === 'string' ? syncPlain : '', shouldReEncrypt: false };
  };

  return {
    settingsFile,

    getToken() {
      const capturedGen = tokenGeneration;
      return enqueueTokenOp(async () => {
        if (capturedGen !== tokenGeneration) return sessionToken;
        try {
          if (!fs.existsSync(settingsFile)) return sessionToken;
          const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
          // Never read or retain legacy plaintext tokens on disk.
          if ('token' in (parsed ?? {})) {
            try { removeSettingsFileStrict(); } catch { /* ignore on read */ }
            return sessionToken;
          }
          if (typeof parsed?.encryptedToken === 'string' && (await canEncrypt())) {
            if (capturedGen !== tokenGeneration) return sessionToken;
            const { plain, shouldReEncrypt } = await decryptToken(Buffer.from(parsed.encryptedToken, 'base64'));
            if (capturedGen !== tokenGeneration) return sessionToken;
            sessionToken = plain;
            if (plain && shouldReEncrypt) {
              try {
                const rotated = await encryptToken(plain);
                if (capturedGen === tokenGeneration) {
                  writeEncryptedPayload(rotated);
                }
              } catch {
                // keep decrypted token in memory even if key-rotation write fails
              }
            }
            return sessionToken;
          }
          return sessionToken;
        } catch {
          return sessionToken;
        }
      });
    },

    setToken(rawToken) {
      const clean = typeof rawToken === 'string' ? rawToken.trim() : '';
      const myGen = ++tokenGeneration;
      if (!clean) {
        sessionToken = '';
      }
      return enqueueTokenOp(async () => {
        // If a newer setToken call superseded this one, do not overwrite its state.
        if (myGen !== tokenGeneration) {
          return { saved: true, persisted: !sessionToken };
        }
        if (!clean) {
          sessionToken = '';
          try {
            removeSettingsFileStrict();
            return { saved: true, persisted: true };
          } catch (err) {
            return {
              saved: false,
              persisted: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
        try {
          const okToEncrypt = await canEncrypt();
          if (myGen !== tokenGeneration) {
            return { saved: true, persisted: !sessionToken };
          }
          if (!okToEncrypt) {
            removeSettingsFileStrict();
            sessionToken = clean;
            return { saved: true, persisted: false, reason: 'encryption_unavailable' };
          }
          const encrypted = await encryptToken(clean);
          if (myGen !== tokenGeneration) {
            return { saved: true, persisted: !sessionToken };
          }
          writeEncryptedPayload(encrypted);
          sessionToken = clean;
          return { saved: true, persisted: true };
        } catch (err) {
          return {
            saved: false,
            persisted: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      });
    },

    async fetchJson(input) {
      try {
        const rawUrl = typeof input?.url === 'string' ? input.url : '';
        const token = typeof input?.token === 'string' ? input.token.trim() : '';
        const parsedUrl = new URL(rawUrl);
        if (
          parsedUrl.origin !== 'https://api.figma.com' ||
          !parsedUrl.pathname.startsWith('/v1/') ||
          parsedUrl.username ||
          parsedUrl.password
        ) {
          return { ok: false, status: 400, error: 'Only https://api.figma.com/v1/* endpoints are allowed' };
        }
        const headers = token.startsWith('figu_')
          ? { Authorization: `Bearer ${token}` }
          : { 'X-Figma-Token': token };
        const resp = await effectiveFetch(parsedUrl.toString(), {
          method: 'GET',
          redirect: 'error',
          headers,
          signal: AbortSignal.timeout(30000),
        });
        if (!resp.ok) {
          return { ok: false, status: resp.status, error: `HTTP ${resp.status}` };
        }
        const data = await resp.json();
        return { ok: true, status: resp.status, data };
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async fetchImage(input) {
      try {
        const rawUrl = typeof input?.url === 'string' ? input.url.trim() : '';
        const maxBytes = Math.min(
          MAX_SINGLE_IMAGE_BYTES,
          Math.max(1, Math.floor(Number(input?.maxBytes) || MAX_SINGLE_IMAGE_BYTES)),
        );
        let currentUrl = new URL(rawUrl);
        let resp = null;

        const preflightLookup = fetchImpl ? effectiveLookupHost : null;
        for (let hop = 0; hop <= MAX_IMAGE_REDIRECTS; hop++) {
          const check = await validatePublicHttpsImageUrl(currentUrl, preflightLookup);
          if (!check.ok) {
            return { ok: false, error: check.error };
          }
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          try {
            resp = await effectiveImageFetch(currentUrl.toString(), {
              method: 'GET',
              redirect: 'manual',
              signal: controller.signal,
            });
            if (resp.status >= 300 && resp.status < 400) {
              try { await resp.body?.cancel?.(); } catch { /* ignore */ }
              if (hop === MAX_IMAGE_REDIRECTS) {
                return { ok: false, error: 'Too many image redirects' };
              }
              const location = resp.headers?.get?.('location');
              if (!location) {
                return { ok: false, error: 'Redirect missing Location header' };
              }
              currentUrl = new URL(location, currentUrl);
              continue;
            }
            if (!resp.ok) {
              try { await resp.body?.cancel?.(); } catch { /* ignore */ }
              return { ok: false, error: `HTTP ${resp.status}` };
            }
            const bytes = await readResponseBytesWithLimit(resp, maxBytes, controller);
            const mime = sniffRasterImageMime(bytes);
            if (!mime) {
              return { ok: false, error: 'Unsupported image format' };
            }
            const dataUri = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
            return {
              ok: true,
              byteLength: bytes.byteLength,
              encodedLength: dataUri.length,
              dataUri,
            };
          } finally {
            clearTimeout(timeout);
          }
        }
        return { ok: false, error: 'Too many image redirects' };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

module.exports = {
  MAX_IMAGE_REDIRECTS,
  MAX_SINGLE_IMAGE_BYTES,
  createFigmaBridge,
  isNonPublicIpv4Bytes,
  isNonPublicIpv6Bytes,
  isPrivateOrLocalHostname,
  parseIpv4Bytes,
  parseIpv6Bytes,
  sniffRasterImageMime,
};
