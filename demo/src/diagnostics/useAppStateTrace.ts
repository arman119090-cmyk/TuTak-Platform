import { useEffect } from 'react';
import { AppState } from 'react-native';
import { logEvent } from './eventLog';
import { isDiagnosticBuild } from './isDiagnosticBuild';

/**
 * Records the app moving between foreground and background.
 *
 * It belongs in this timeline for one reason: an activity being recreated is
 * not silent at this level. A configuration change the manifest does not
 * claim to handle takes the activity down and builds a new one, and the
 * app-state stream around that is not the flat `active` of an app nobody
 * touched. Equally, `active → inactive → active` around a keyboard appearing
 * is the system putting something in front of the app, which is a different
 * story from the app losing its own focus.
 *
 * Read together with the mount counters, never alone: app state alone cannot
 * distinguish an activity restart from a notification shade being pulled
 * down, and neither can a mount count. The pair can.
 *
 * Subscribed only in a diagnostic build. Every other build carries no
 * listener at all — this is an instrument, and an instrument that is always
 * on is a cost every user pays for a question only we are asking.
 */
export function useAppStateTrace(): void {
  useEffect(() => {
    if (!isDiagnosticBuild()) return;

    logEvent(`appState ${AppState.currentState}`);
    const subscription = AppState.addEventListener('change', (state) =>
      logEvent(`appState ${state}`),
    );
    return () => subscription.remove();
  }, []);
}
