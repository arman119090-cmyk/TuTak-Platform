import { useEffect, useRef } from 'react';
import { logEvent, runId } from './eventLog';

/**
 * Mount and unmount lines that can be told apart from one another.
 *
 * ## The distinction this exists to draw
 *
 * The previous round logged `mount Login` and read a second one as Android
 * recreating the activity. That reading was too strong, and this file is the
 * correction: **a repeated mount line is not evidence of an activity
 * restart.** Three different things produce one, and they need different
 * fixes:
 *
 * 1. **A React remount.** Something above the component changed its identity
 *    — a `key`, a conditional branch, a parent that re-created it. The JS
 *    runtime is untouched, everything else in the app keeps running.
 * 2. **A React Native surface restart.** The activity was recreated and the
 *    root view re-rendered, while the JS context survived. The root component
 *    mounts again, and so does everything under it.
 * 3. **A new JS context.** The process was restarted, or the bundle reloaded.
 *    Nothing in memory survives.
 *
 * Three counters answer it, and they answer it from one line of log:
 *
 * * `runId` is generated when `eventLog` is first evaluated — once per JS
 *   context. A different run id between two exports is case 3, and only
 *   case 3.
 * * The counter here is module scope, so it survives a component being
 *   unmounted and mounted again but not a new JS context. `mount App #2`
 *   means the root component mounted twice in one runtime.
 *
 *   Read that narrowly. It says the React tree below `Root` was torn down and
 *   rebuilt while the JS context survived. A surface restart produces it; so
 *   does anything above `Root` that changes identity. Distinguishing those
 *   needs a native trace of the activity lifecycle, which JavaScript cannot
 *   see — so `mount App #2` is **consistent with** case 2 and is not proof of
 *   it, and an activity recreation must not be declared on this line alone.
 * * `mount OtpRegister #2` with `mount App #1` still standing above it is
 *   case 1: only the screen was rebuilt.
 *
 * The instance suffix (`@3`) is the other half. It names *which* component
 * instance a line belongs to, so two fields that mount, unmount and mount
 * again cannot be read as one field mounting twice — which is exactly the
 * ambiguity the registration screen introduces, with two inputs where the
 * sign-in screen had one interesting one.
 */

/** How many times each traced name has mounted in this JS context. */
const mounts = new Map<string, number>();

/** Every instance ever created, so an id is never reused within a run. */
let instances = 0;

/** Cleared between tests. Never called by the app. */
export function resetInstanceTrace(): void {
  mounts.clear();
  instances = 0;
}

/**
 * Records `mount <name> #n @id` and the matching `unmount`.
 *
 * `n` counts mounts of this name in this runtime; `id` names this particular
 * instance. A field that is replaced rather than re-rendered shows a new `id`
 * with an `n` one higher, and a field that merely re-renders shows neither.
 *
 * Safe to call from anything: it logs into the ring buffer, which does
 * nothing visible outside a diagnostic build.
 */
export function useMountTrace(name: string): void {
  // Assigned during the first render rather than in the effect, so the id is
  // stable across the effect running twice under StrictMode.
  const instance = useRef<number | null>(null);
  if (instance.current === null) {
    instances += 1;
    instance.current = instances;
  }

  /*
   * The name is read through a ref and the effect has no dependencies, so
   * these lines mean mount and unmount and nothing else.
   *
   * With `[name]` in the dependency list, a field whose trace id falls back
   * to its translated label would log an unmount and a mount when the
   * interface language changed — a component that never went anywhere,
   * appearing in the log as one that was replaced. That is precisely the
   * distinction this file exists to make, so it must not be the first thing
   * the file gets wrong.
   */
  const traced = useRef(name);
  traced.current = name;

  useEffect(() => {
    const label = traced.current;
    const count = (mounts.get(label) ?? 0) + 1;
    mounts.set(label, count);
    logEvent(`mount ${label} #${count} @${instance.current}`);
    return () => logEvent(`unmount ${label} @${instance.current}`);
  }, []);
}

/** The header the export carries, so a log states what produced it. */
export function traceSummary(): string {
  return `run ${runId()} instances ${instances}`;
}
