// Match Electron's structured reply protocol, including errors crossing contextBridge.
export function publishingBridgeFixture(api: Record<string, (...args: any[]) => any>) {
  return Object.fromEntries(Object.entries(api).map(([method, call]) => [method, async (...args: any[]) => {
    try { return { ok: true, value: await call(...args) }; }
    catch (error: any) { return { ok: false, error: { message: error.message, status: error.status } }; }
  }]));
}
