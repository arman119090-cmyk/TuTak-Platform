import { useEffect } from 'react';
import { Dimensions } from 'react-native';
import { logEvent } from './eventLog';

/**
 * Records the window and the screen together, every time either changes.
 *
 * ## The question this exists to answer
 *
 * Two explanations for the sign-in fields survive elimination, both in the
 * Android layer rather than in this codebase, and they are told apart by what
 * the *window* does when the IME opens:
 *
 * * the window shrinks — the activity is in the legacy `adjustResize`
 *   behaviour rather than the edge-to-edge one this app is written against,
 *   so every layout that reads a window size re-lays-out underneath a
 *   keyboard that is still animating;
 * * the window does not shrink — the IME is an inset, the layout is stable,
 *   and whatever closes the keyboard is not a layout change at all.
 *
 * `useCompactLayout` was moved from the window to the screen for exactly the
 * first reason and did not fix the fault, which means either the window is
 * not moving or something else reads it. This says which, on the device,
 * instead of by argument.
 *
 * Both numbers on one line and rounded, because the comparison is the point
 * and a screenshot has to stay legible: a `win` height that drops while `scr`
 * holds still is the whole finding.
 */
export function useDimensionsTrace(): void {
  useEffect(() => {
    const line = () => {
      const w = Dimensions.get('window');
      const s = Dimensions.get('screen');
      return `win ${Math.round(w.width)}x${Math.round(w.height)} scr ${Math.round(s.width)}x${Math.round(s.height)}`;
    };

    logEvent(line());
    const subscription = Dimensions.addEventListener('change', () => logEvent(line()));
    return () => subscription.remove();
  }, []);
}
