// Bundled as an isolated browser runtime, with no editor/store/Electron imports.
import React from 'react';
import { createRoot } from 'react-dom/client';

declare global {
  interface Window {
    __pfConfig: { channel: string; css: string };
    __pfMount: (component: React.ComponentType<any>) => void;
    React: typeof React;
    __pfGuard: () => void;
  }
}
const config = window.__pfConfig;
const post = (type: string, payload?: unknown) => parent.postMessage({ channel: config.channel, type, payload }, '*');
let sliceStarted: number | undefined;
let exhausted = false;
window.__pfGuard = () => {
  if (exhausted) throw new Error('交互计算时间过长，请简化后重试');
  if (sliceStarted === undefined) {
    sliceStarted = performance.now();
    queueMicrotask(() => { sliceStarted = undefined; });
  }
  if (performance.now() - sliceStarted > 120) {
    exhausted = true;
    post('error', '交互计算时间过长，请简化后重试');
    throw new Error('自由组件执行超时');
  }
};
window.React = React;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
addEventListener('error', event => post('error', event.message));
addEventListener('unhandledrejection', event => post('error', errorText(event.reason)));
const style = document.createElement('style');
// Legacy components used a light canvas and inherited slate text. Keep these
// defaults together. Components that support both themes opt in through CSS.
style.textContent =
  ':root{--pf-bg-layout:#f8fafc;--pf-bg-container:#ffffff;--pf-bg-elevated:#ffffff;--pf-fill-alter:#fafafa;--pf-border:#d9d9d9;--pf-border-secondary:#f0f0f0;--pf-text:rgba(0,0,0,0.88);--pf-text-secondary:rgba(0,0,0,0.65);--pf-text-tertiary:rgba(0,0,0,0.45);--pf-primary:#2563eb;--pf-color-scheme:light;color-scheme:only light}' +
  ':root[data-theme="dark"]{--pf-bg-layout:#0a0a0a;--pf-bg-container:#141414;--pf-bg-elevated:#1f1f1f;--pf-fill-alter:#1d1d1d;--pf-border:#424242;--pf-border-secondary:#303030;--pf-text:rgba(255,255,255,0.88);--pf-text-secondary:rgba(255,255,255,0.65);--pf-text-tertiary:rgba(255,255,255,0.45);--pf-primary:#1668dc;--pf-color-scheme:dark}' +
  ':where(:root[data-theme="dark"]){background-color:#fff}' +
  '*{box-sizing:border-box}html,body{margin:0;padding:0}body{font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#334155}button,input,select,textarea{font:inherit}button{cursor:pointer}' +
  config.css;
document.head.appendChild(style);
const root = createRoot(document.getElementById('root')!);
class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { post('error', error.message); }
  render() { return this.state.failed ? null : this.props.children; }
}
window.__pfMount = Component => {
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.channel !== config.channel) return;
    if (event.data.type === 'theme' && (event.data.payload === 'dark' || event.data.payload === 'light')) {
      document.documentElement.dataset.theme = event.data.payload;
      return;
    }
    if (event.data.type !== 'input') return;
    if (event.data.theme === 'dark' || event.data.theme === 'light') {
      document.documentElement.dataset.theme = event.data.theme;
    }
    root.render(<Boundary><Component data={event.data.payload} emit={(payload: unknown) => post('action', payload)} /></Boundary>);
  });
  post('ready');
  let lastHeight = 0;
  new ResizeObserver(() => {
    const height = Math.ceil(document.getElementById('root')!.getBoundingClientRect().height);
    if (height !== lastHeight) { lastHeight = height; post('height', height); }
  }).observe(document.getElementById('root')!);
};
