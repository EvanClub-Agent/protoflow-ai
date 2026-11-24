import { importFigmaBinary } from './figBinary';

export interface FigWorkerInput {
  bytes: ArrayBuffer;
  fileName: string;
}

if (typeof self !== 'undefined' && typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function') {
  self.onmessage = (event: MessageEvent<FigWorkerInput>) => {
    try {
      const { bytes, fileName } = event.data;
      const document = importFigmaBinary(new Uint8Array(bytes), fileName);
      self.postMessage({ document }, { transfer: document.archive ? [bytes] : [] });
    } catch (error) {
      self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  };
}

// Fallback worker shim when bundled directly under Node test runners without Vite's ?worker&inline transform.
export default class FallbackFigWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private terminated = false;

  postMessage(data: FigWorkerInput) {
    queueMicrotask(() => {
      if (this.terminated) return;
      try {
        const document = importFigmaBinary(new Uint8Array(data.bytes), data.fileName);
        if (!this.terminated) this.onmessage?.({ data: { document } } as MessageEvent<unknown>);
      } catch (error) {
        if (!this.terminated) {
          this.onmessage?.({
            data: { error: error instanceof Error ? error.message : String(error) },
          } as MessageEvent<unknown>);
        }
      }
    });
  }

  terminate() {
    this.terminated = true;
  }
}
