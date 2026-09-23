"use client";

import { useSyncExternalStore } from "react";

// Tiny localStorage-backed store for per-browser conveniences (consent,
// compare list). useSyncExternalStore keeps SSR (null snapshot) and the
// client consistent without setState-in-effect.

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = () => cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
  for (const l of listeners) l();
}

/** Raw string value; `undefined` during SSR / before hydration. */
export function useLocal(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => readLocal(key),
    () => undefined,
  );
}
