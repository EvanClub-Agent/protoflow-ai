import { FREEFORM_FRAME_RUNTIME } from './generatedRuntime';

export function freeformDocument(compiled: string, css: string, channel: string, viewerNonce?: string): string {
  const script = `window.__pfConfig=${JSON.stringify({ channel, css })};\n${FREEFORM_FRAME_RUNTIME}\n${compiled}\nwindow.__pfMount(Component);`;
  const bytes = new TextEncoder().encode(script);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const src = `data:text/javascript;base64,${btoa(binary)}`;
  // srcdoc also inherits the viewer response's CSP. Authorize this script with
  // the per-response Nginx request ID while keeping data: scripts off the host.
  const nonce = viewerNonce && /^[a-f0-9]{32}$/.test(viewerNonce) ? ` nonce="${viewerNonce}"` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src data:; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'"></head><body><div id="root"></div><script${nonce} src="${src}"></script></body></html>`;
}
