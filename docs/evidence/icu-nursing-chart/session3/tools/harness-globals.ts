// Node shims for the controller harness, imported FIRST: the app modules read window /
// sessionStorage at import time (runtimeConfig, the clock prime). apiBaseUrl null = the no-API
// mode, so nothing in the bundle can reach a network; every transport is injected by the harness.
const store = new Map<string, string>()
export const fakeStorage: Storage = {
  getItem: k => (store.has(k) ? store.get(k)! : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: k => { store.delete(k) },
  clear: () => store.clear(),
  key: i => [...store.keys()][i] ?? null,
  get length() { return store.size },
}
const g = globalThis as unknown as Record<string, unknown>
g.window = { AURORA_RUNTIME_CONFIG: { apiBaseUrl: null }, dispatchEvent: () => true, setInterval, clearInterval, setTimeout, clearTimeout }
g.sessionStorage = fakeStorage
