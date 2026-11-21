import { isEnLocale, tr } from '../i18n/runtime';

const ITERATIONS = 600_000;
const base64 = (bytes: Uint8Array) => {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
};

/** Encrypt all document content; the exported shell contains neither plaintext nor the password. */
export async function encryptExportHtml(html: string, password: string): Promise<string> {
  if (!crypto.subtle) throw new Error(tr('当前环境不支持加密导出，请在桌面端或安全连接中使用', 'Encrypted export requires Web Crypto (use the desktop app or a secure HTTPS origin)'));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(html));
  const payload = JSON.stringify({ salt: base64(salt), iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)), iterations: ITERATIONS });
  if (isEnLocale()) {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Protected Prototype · Alex</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;background-image:radial-gradient(ellipse at top,rgba(37,99,235,0.09),transparent 60%);color:#0f172a;display:grid;place-items:center;min-height:100vh;padding:24px}
form{background:#fff;border:1px solid rgba(226,232,240,0.95);border-radius:16px;padding:30px;width:100%;max-width:400px;box-shadow:0 20px 25px -5px rgba(15,23,42,0.06),0 8px 10px -6px rgba(15,23,42,0.04)}
.brand{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #f1f5f9}
.brand-left{display:flex;align-items:center;gap:10px}
.brand-icon{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#0f172a,#1d4ed8);display:grid;place-items:center;color:#fff;font-weight:800;font-size:15px;box-shadow:0 2px 6px rgba(29,78,216,0.25)}
.brand-title{font-size:13px;font-weight:800;color:#0f172a}
.brand-sub{font-size:11px;color:#64748b}
.badge{font-size:11px;font-weight:600;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;padding:2px 8px;border-radius:99px}
h1{font-size:17px;font-weight:700;color:#0f172a;margin-bottom:6px}
label{display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:8px}
input{font:inherit;padding:10px 12px;width:100%;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;color:#0f172a;transition:all .15s}
input:focus{outline:none;background:#fff;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,0.14)}
button{font:inherit;font-weight:600;padding:10px 14px;margin-top:14px;width:100%;background:#2563eb;color:#fff;border:0;border-radius:10px;cursor:pointer;transition:background .15s;box-shadow:0 2px 6px rgba(37,99,235,0.2)}
button:hover{background:#1d4ed8}
button:disabled{opacity:.6;cursor:default}
#error{color:#be123c;font-size:12px;font-weight:500;margin-top:10px;min-height:18px}
.footer{margin-top:16px;padding-top:12px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8}
</style></head>
<body><form id="unlock"><div class="brand"><div class="brand-left"><div class="brand-icon">A</div><div><div class="brand-title">Alex</div><div class="brand-sub">Offline Encrypted Prototype</div></div></div><span class="badge">AES-256 Protected</span></div><h1>Open Prototype</h1><label for="password">Enter the access password provided by the publisher to unlock</label><input id="password" type="password" placeholder="Enter access password..." required autofocus autocomplete="current-password"><button>Unlock Prototype</button><p id="error" role="alert"></p><div class="footer"><span>Alex · Offline Sandbox</span><span>Decrypted Locally in Browser</span></div></form>
<script id="encrypted-payload" type="application/json">${payload}</script>
<script>
const payload = JSON.parse(document.getElementById('encrypted-payload').textContent);
const bytes = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
document.getElementById('unlock').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button'); button.disabled = true;
  const error = document.getElementById('error'); error.textContent = '';
  if (!crypto.subtle) { error.textContent = 'This browser does not support Web Crypto decryption. Please open in a modern browser.'; button.disabled = false; return; }
  try {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(document.getElementById('password').value), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(payload.salt),iterations:payload.iterations,hash:'SHA-256'}, material, {name:'AES-GCM',length:256}, false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(payload.iv)}, key, bytes(payload.ciphertext));
    document.open(); document.write(new TextDecoder().decode(plaintext)); document.close();
  } catch { error.textContent = 'Incorrect password or corrupted file'; button.disabled = false; }
});
</script></body></html>`;
  }
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>受保护的原型 · Alex</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;background-image:radial-gradient(ellipse at top,rgba(37,99,235,0.09),transparent 60%);color:#0f172a;display:grid;place-items:center;min-height:100vh;padding:24px}
form{background:#fff;border:1px solid rgba(226,232,240,0.95);border-radius:16px;padding:30px;width:100%;max-width:400px;box-shadow:0 20px 25px -5px rgba(15,23,42,0.06),0 8px 10px -6px rgba(15,23,42,0.04)}
.brand{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #f1f5f9}
.brand-left{display:flex;align-items:center;gap:10px}
.brand-icon{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#0f172a,#1d4ed8);display:grid;place-items:center;color:#fff;font-weight:800;font-size:15px;box-shadow:0 2px 6px rgba(29,78,216,0.25)}
.brand-title{font-size:13px;font-weight:800;color:#0f172a}
.brand-sub{font-size:11px;color:#64748b}
.badge{font-size:11px;font-weight:600;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;padding:2px 8px;border-radius:99px}
h1{font-size:17px;font-weight:700;color:#0f172a;margin-bottom:6px}
label{display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:8px}
input{font:inherit;padding:10px 12px;width:100%;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;color:#0f172a;transition:all .15s}
input:focus{outline:none;background:#fff;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,0.14)}
button{font:inherit;font-weight:600;padding:10px 14px;margin-top:14px;width:100%;background:#2563eb;color:#fff;border:0;border-radius:10px;cursor:pointer;transition:background .15s;box-shadow:0 2px 6px rgba(37,99,235,0.2)}
button:hover{background:#1d4ed8}
button:disabled{opacity:.6;cursor:default}
#error{color:#be123c;font-size:12px;font-weight:500;margin-top:10px;min-height:18px}
.footer{margin-top:16px;padding-top:12px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8}
</style></head>
<body><form id="unlock"><div class="brand"><div class="brand-left"><div class="brand-icon">A</div><div><div class="brand-title">Alex</div><div class="brand-sub">离线加密原型包</div></div></div><span class="badge">AES-256 加密保护</span></div><h1>查看原型</h1><label for="password">请输入发布者提供的访问密码以解锁演示</label><input id="password" type="password" placeholder="输入访问密码..." required autofocus autocomplete="current-password"><button>解锁并查看原型</button><p id="error" role="alert"></p><div class="footer"><span>Alex · 离线演示沙盒</span><span>本地浏览器解密</span></div></form>
<script id="encrypted-payload" type="application/json">${payload}</script>
<script>
const payload = JSON.parse(document.getElementById('encrypted-payload').textContent);
const bytes = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
document.getElementById('unlock').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button'); button.disabled = true;
  const error = document.getElementById('error'); error.textContent = '';
  if (!crypto.subtle) { error.textContent = '此浏览器不支持解密，请使用现代浏览器打开本地文件。'; button.disabled = false; return; }
  try {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(document.getElementById('password').value), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(payload.salt),iterations:payload.iterations,hash:'SHA-256'}, material, {name:'AES-GCM',length:256}, false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(payload.iv)}, key, bytes(payload.ciphertext));
    document.open(); document.write(new TextDecoder().decode(plaintext)); document.close();
  } catch { error.textContent = '密码错误或文件已损坏'; button.disabled = false; }
});
</script></body></html>`;
}
