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

/**
 * Whether a field re-renders when it gains or loses focus — the second arm,
 * and after the build-34 log the better-aimed one.
 *
 * That log separates two cases cleanly. A tap whose `REQ focus` produced **no
 * focus event** — the field already held focus — opened the keyboard and kept
 * it. Every tap that did produce a focus event lost the focus again 25–33 ms
 * later. So the trigger is the focus event itself, and the only thing this
 * app runs on one is `setFocused`, whose whole effect is a re-render.
 *
 * `true` is what ships. `false` skips the state change entirely: no
 * re-render, and therefore no focus ring in that arm — a visible cost that is
 * acceptable for a trial and would not be shipped.
 */
let focusRerender = true;

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

export function getFocusRerender(): boolean {
  return focusRerender;
}

/** Flips the second arm and records it. Called only by the overlay. */
export function toggleFocusRerender(): void {
  focusRerender = !focusRerender;
  logEvent(`exp focusRerender=${focusRerender ? 'on' : 'off'}`);
  listeners.forEach((notify) => notify());
}

/**
 * Short label for the panel header and the export.
 *
 * Both arms, always, so a trial can never be read against the wrong pair —
 * and so it is obvious at a glance if two were changed at once, which would
 * make the trial worthless.
 *
 * `CF` was here and is gone: it settled what it was built to settle, and
 * `collapsable={false}` is now unconditional in `TextField`. A switch that no
 * longer switches anything is worse than no switch, because the next person
 * to press it would read "nothing changed" as a result.
 */
export function experimentLabel(): string {
  return `SCF=${scrollsChildToFocus ? 'on' : 'off'} RR=${focusRerender ? 'on' : 'off'}`;
}

/** Cleared between tests. Never called by the app. */
export function resetExperiment(): void {
  scrollsChildToFocus = false;
  focusRerender = true;
  listeners = [];
}

/**
 * The current arm, re-rendering the caller when it is flipped.
 *
 * Outside a diagnostic build this never changes, so the subscription is not
 * even taken out.
 */
export function useScrollsChildToFocus(): boolean {
  return useArm(() => scrollsChildToFocus);
}

/** The re-render arm, re-rendering the caller when it is flipped. */
export function useFocusRerender(): boolean {
  return useArm(() => focusRerender);
}

function useArm(read: () => boolean): boolean {
  const [value, setValue] = useState(read);

  useEffect(() => {
    if (!isDiagnosticBuild()) return;
    const notify = () => setValue(read());
    listeners = [...listeners, notify];
    return () => {
      listeners = listeners.filter((l) => l !== notify);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return value;
}
