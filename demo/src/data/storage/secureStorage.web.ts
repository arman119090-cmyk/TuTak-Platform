/**
 * Where the app keeps its tokens — the web implementation.
 *
 * Metro selects this file over `secureStorage.ts` when bundling for a
 * browser. See that file for why the split exists.
 *
 * ## This is not equivalent to the native store, and will not pretend to be
 *
 * The native build puts tokens in the Keychain or the Keystore, where the OS
 * encrypts them and no other app can read them. A browser page has nothing of
 * the sort. `localStorage` is readable by any script running on the origin, so
 * a single XSS takes the session — the same trade-off the two dashboards
 * already document, and acceptable here for the same reason: the web target
 * is a way to look at the app on a laptop while developing. The product ships
 * to phones.
 *
 * If the web build ever becomes something customers use, this is the first
 * thing that has to change, and the fix is a backend that exchanges a
 * httpOnly cookie for a short-lived token — not a cleverer place to hide a
 * string inside a page.
 */

/**
 * Reading `localStorage` throws rather than returning null in Safari private
 * mode and wherever a browser blocks storage outright. A throw here would
 * break hydration exactly the way `expo-secure-store` did, so a blocked
 * browser degrades to an in-memory map: the session lasts as long as the tab,
 * which is a worse experience and not a broken one.
 */
const memory = new Map<string, string>();

function webStore(): Storage | null {
  try {
    // Touching the property is itself what throws when storage is blocked,
    // so the probe has to happen inside the try.
    const store = globalThis.localStorage;
    store.getItem('__tutak_probe__');
    return store;
  } catch {
    return null;
  }
}

export async function getItem(key: string): Promise<string | null> {
  const store = webStore();
  return store ? store.getItem(key) : (memory.get(key) ?? null);
}

export async function setItem(key: string, value: string): Promise<void> {
  const store = webStore();
  if (store) store.setItem(key, value);
  else memory.set(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  const store = webStore();
  if (store) store.removeItem(key);
  else memory.delete(key);
}
