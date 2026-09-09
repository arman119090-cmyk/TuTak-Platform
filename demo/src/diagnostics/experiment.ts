import { useEffect, useState } from 'react';
import { logEvent } from './eventLog';
import { isDiagnosticBuild } from './isDiagnosticBuild';

/**
 * One switch, flipped by hand on the device, so a candidate can be judged by
 * comparison instead of by coincidence.
 *
 * ## Why a runtime toggle rather than two builds
 *
 * Everything the log has produced so far about `scrollsChildToFocus` is
 * correlation. Two facts make that unavoidable from a passive log:
 *
 *  * `focus → scroll → blur` is an ordering, not a cause. Something else can
 *    produce both.
 *  * The absence of a scroll proves nothing either. `ReactScrollView`
 *    computes the delta first and only then acts —
 *    `if (scrollDelta != 0) { scrollBy(0, scrollDelta); }` — so on a short
 *    form where the field is already fully visible, `scrollToChild` runs and
 *    emits no scroll event at all.
 *
 * What separates cause from coincidence is varying exactly one thing and
 * seeing whether the fault follows it. Two APKs would vary one *committed*
 * thing and a dozen incidental ones — build id, install, session, whatever
 * the phone was doing that minute. A switch inside one build varies the prop
 * and nothing else: same binary, same launch, same handset, minutes apart.
 *
 * The arm is written into the log on every change and carried in the export
 * header, so no trial can be attributed to the wrong side.
 *
 * Diagnostic builds only. In every other build this is a constant and the
 * button that flips it does not exist.
 */

/** `false` is what the app ships; `true` restores React Native's default. */
let scrollsChildToFocus = false;
let listeners: Array<() => void> = [];

export function getScrollsChildToFocus(): boolean {
  return scrollsChildToFocus;
}

/** Flips the arm and records it. Called only by the diagnostic overlay. */
export function toggleScrollsChildToFocus(): void {
  scrollsChildToFocus = !scrollsChildToFocus;
  logEvent(`exp scrollsChildToFocus=${scrollsChildToFocus ? 'on' : 'off'}`);
  listeners.forEach((notify) => notify());
}

/** Short label for the panel header and the export. */
export function experimentLabel(): string {
  return `SCF=${scrollsChildToFocus ? 'on' : 'off'}`;
}

/** Cleared between tests. Never called by the app. */
export function resetExperiment(): void {
  scrollsChildToFocus = false;
  listeners = [];
}

/**
 * The current arm, re-rendering the caller when it is flipped.
 *
 * Outside a diagnostic build this never changes, so the subscription is not
 * even taken out.
 */
export function useScrollsChildToFocus(): boolean {
  const [value, setValue] = useState(scrollsChildToFocus);

  useEffect(() => {
    if (!isDiagnosticBuild()) return;
    const notify = () => setValue(scrollsChildToFocus);
    listeners = [...listeners, notify];
    return () => {
      listeners = listeners.filter((l) => l !== notify);
    };
  }, []);

  return value;
}
