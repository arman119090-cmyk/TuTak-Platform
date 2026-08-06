// Preview-only stub: expo-font's .web build imports node:async_hooks, which
// has no browser equivalent and is never exercised in the harness.
export class AsyncLocalStorage {
  getStore() { return undefined; }
  run(_store, fn) { return fn(); }
}
export default { AsyncLocalStorage };
