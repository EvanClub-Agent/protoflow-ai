import { importAxureRp } from './import';

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try { self.postMessage({ project: await importAxureRp(new Uint8Array(event.data)) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
