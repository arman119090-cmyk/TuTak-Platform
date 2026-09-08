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
const DISPLAY_CAPACITY = 14;

/**
 * How much is kept for export, as opposed to shown.
 *
 * Photographing the panel was enough while the question was "does a second
 * `mount` follow the `focus`" — five rows answer that. It is not enough for
 * the registration screen, where the reported sequence spans two fields, a
 * keyboard that changes type, and whatever the window does around it. So the
 * log now keeps a longer tail than it draws, and the export button hands over
 * the whole of it.
 *
 * Not unbounded: this runs on a phone, in a build that is meant to be left
 * running while somebody reproduces a fault several times.
 */
const RETAINED_CAPACITY = 400;

export interface DiagnosticEvent {
  /** Milliseconds since the log started — relative, because that is what matters. */
  at: number;
  text: string;
}

/**
 * Identifies this JavaScript runtime, and nothing else.
 *
 * Generated once when the module is first evaluated, which happens exactly
 * once per JS context. It is the discriminator the previous round did not
 * have: a screen can remount for reasons entirely inside React, and an
 * activity can be recreated under a JS context that survives it, and the two
 * look identical in a list of `mount` lines. See `instanceTrace.ts` — the run
 * id says whether the whole runtime was replaced, the counters there say
 * whether anything below it was.
 *
 * Random rather than a timestamp so two logs exported minutes apart cannot
 * accidentally carry the same id.
 */
const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

/** The JS runtime this log belongs to. A new value means a new JS context. */
export function runId(): string {
  return RUN_ID;
}

let started = Date.now();
let startedAt = new Date();
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
    events = [...events, { at: Date.now() - started, text }].slice(-RETAINED_CAPACITY);
  }

  listeners.forEach((notify) => notify());
}

/** What the panel draws: the newest rows, as many as fit on a phone. */
export function getEvents(): DiagnosticEvent[] {
  return events.slice(-DISPLAY_CAPACITY);
}

/** Everything retained, oldest first. Used by the export button. */
export function getAllEvents(): DiagnosticEvent[] {
  return events;
}

/**
 * The whole log as text, with the header that makes it worth reading.
 *
 * A photograph of fourteen rows has been the transport so far, and it drops
 * exactly the things a second reader needs: which build this is, which JS
 * runtime the rows belong to, and how many rows were cut off the top. A
 * failed diagnosis over a screenshot costs another build and another day, so
 * the export carries its own provenance.
 *
 * Nothing here can contain anything anybody typed: the events are labels,
 * ids, sizes and counts, and every call site is written that way.
 */
export function serializeEvents(header: Record<string, string>): string {
  const lines = [
    `TuTak diagnostic log`,
    `run ${RUN_ID} started ${startedAt.toISOString()}`,
    ...Object.entries(header).map(([key, value]) => `${key} ${value}`),
    `events ${events.length}${events.length >= RETAINED_CAPACITY ? ' (older ones dropped)' : ''}`,
    '',
    ...events.map((event) => `${String(event.at).padStart(6, ' ')}ms  ${event.text}`),
  ];
  return lines.join('\n');
}

export function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/**
 * Used by the overlay's clear button, so one interaction can be isolated.
 *
 * The only thing that empties this log. Navigating between screens does not,
 * and must not: the sequence that explains a fault on the registration screen
 * starts before that screen is mounted, and a log that resets on arrival
 * would throw away its own first half.
 */
export function resetEvents(): void {
  started = Date.now();
  startedAt = new Date();
  events = [];
  listeners.forEach((notify) => notify());
}
