import { JSDOM } from 'jsdom';

/** CSS-in-JS and native controls need a real document, even with TestRenderer. */
export function installTestDom() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  dom.window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true });
  const values: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element, SVGElement: dom.window.SVGElement, ShadowRoot: dom.window.ShadowRoot,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return () => {
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  };
}
