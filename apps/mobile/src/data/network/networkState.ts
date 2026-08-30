import { useSyncExternalStore } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

/**
 * One answer to "is this phone online", for the whole app.
 *
 * Deliberately not a second networking system next to TanStack Query: this
 * feeds Query's own `onlineManager`, so the pausing and resuming the library
 * already implements is driven by the real device state instead of the web
 * default (`navigator.onLine`, which React Native does not have). Screens read
 * the same value through `useIsOffline`, so a banner and a paused query can
 * never disagree.
 *
 * `isInternetReachable` is deliberately part of the test. A phone attached to
 * a captive-portal Wi-Fi is `isConnected: true` and reaches nothing; treating
 * that as online is how "no internet" becomes "something went wrong" five
 * screens deep. It is null until the first probe completes, and null is not
 * treated as offline — showing an offline banner for a moment on every cold
 * start would be worse than being briefly wrong.
 */
export function isStateOffline(
  state?: Partial<Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>> | null,
): boolean {
  // Nothing known yet — including a platform that answers with nothing at
  // all, which is what a bare JS environment does. Claiming "offline" on no
  // information would put a banner over a working app.
  if (!state) return false;
  if (state.isConnected === false) return true;
  return state.isInternetReachable === false;
}

let offline = false;
const listeners = new Set<() => void>();

function publish(next: boolean): void {
  if (next === offline) return;
  offline = next;
  for (const listener of listeners) listener();
}

/**
 * Starts listening, and hands Query the same signal. Returns the unsubscribe
 * so `App.tsx` can stop it on unmount — an app-level subscription that outlives
 * the app is the sort of thing that only shows up in a test run's open handles.
 */
export function startNetworkStateTracking(): () => void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      const isOffline = isStateOffline(state);
      publish(isOffline);
      setOnline(!isOffline);
    }),
  );

  const stop = NetInfo.addEventListener((state) => publish(isStateOffline(state)));
  return () => {
    stop();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: nothing in the app calls this. */
export function __setOfflineForTests(value: boolean): void {
  publish(value);
}

export function getIsOffline(): boolean {
  return offline;
}

export function useIsOffline(): boolean {
  return useSyncExternalStore(subscribe, getIsOffline, getIsOffline);
}
