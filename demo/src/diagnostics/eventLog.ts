/**
 * A ring buffer of what the app just did, so a phone can answer a question
 * instead of a person describing an impression.
 *
 * ## Why this exists
 *
 * Four hypotheses about the flickering input fields have now been wrong. Each
 * was reasoned from the source, each was consistent with everything known at
 * the time, and each was falsified by the next fact that arrived from a
 * handset. The fault reproduces on three Android devices and on none of the
 * automated checks here — react-native-web has no IME, and Jest has no window.
 *
 * The failure mode of the last four attempts was not bad reasoning. It was
 * reasoning against a description. "It flickers" is compatible with a render
 * loop, a keyboard opening and closing, a scroll fighting an animation, and
 * the OS drawing over the app; those have different fixes and there is no way
 * to choose between them from the outside.
 *
 * So this records the events themselves, on the device, with timestamps, and
 * puts them on the screen where a screenshot captures them. It replaces the
 * question "what does it look like" with "what happened, in what order, how
 * many times".
 *
 * ## What it must never become
 *
 * It is switched on by `extra.diagnostics`, which only the `diagnostic` build
 * profile sets. It is not `__DEV__`, and it is not on in preview or
 * production. Nothing here reads or records anything a person types — field
 * *labels* are recorded, never values, because the point is the sequence of
 * events and a password in a screenshot would be a much worse bug than the
 * one being chased.
 */

/** Enough to see a loop, few enough to fit on a phone screen. */
const CAPACITY = 14;

export interface DiagnosticEvent {
  /** Milliseconds since the log started — relative, because that is what matters. */
  at: number;
  text: string;
}

let started = Date.now();
let events: DiagnosticEvent[] = [];
let listeners: Array<() => void> = [];

/**
 * Repeats are counted rather than appended.
 *
 * A loop firing forty times would otherwise push everything else off the
 * screen and hide the very sequence that explains it — and "×40" is the
 * finding, so it should be legible rather than inferred by counting rows.
 */
export function logEvent(text: string): void {
  const last = events[events.length - 1];
  const base = last?.text.replace(/ ×\d+$/, '');

  if (last && base === text) {
    const count = Number(/ ×(\d+)$/.exec(last.text)?.[1] ?? '1') + 1;
    events = [...events.slice(0, -1), { at: last.at, text: `${text} ×${count}` }];
  } else {
    events = [...events, { at: Date.now() - started, text }].slice(-CAPACITY);
  }

  listeners.forEach((notify) => notify());
}

export function getEvents(): DiagnosticEvent[] {
  return events;
}

export function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Used by the overlay's clear button, so one interaction can be isolated. */
export function resetEvents(): void {
  started = Date.now();
  events = [];
  listeners.forEach((notify) => notify());
}
