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
 * Lines that may be sacrificed when the buffer is full, and the only ones.
 *
 * A capture was lost to this: scrolling wrote hundreds of samples and pushed
 * the focus events — the whole reason the log is taken — out of the ring. So
 * eviction is no longer "oldest first". It is "oldest *scroll* first", and a
 * focus, blur, REQ, mount, keyboard, experiment or app-state line is dropped
 * only once there is no scroll left to drop.
 *
 * Folding a burst into one line (see `logEventCoalesced`) already made that
 * rare. This makes it impossible, which is a different guarantee: a fault
 * that scrolls a lot must not be able to hide itself.
 */
const EVICTABLE = /^scroll /;

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

/**
 * Wall-clock epoch of the log's zero point, so a timestamp taken somewhere
 * else can be expressed in this log's own milliseconds.
 *
 * Every row's `at` counts from here. Android's focus observers stamp their
 * records with `System.currentTimeMillis()` at the moment the event happened,
 * and subtracting this from that is what puts a native event on the same
 * timeline as a JavaScript one — which matters because the row's own `at` is
 * when JavaScript *collected* the record, up to a drain interval later.
 */
export function startedAtMs(): number {
  return started;
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
    events = trim([...events, { at: Date.now() - started, text }]);
  }

  listeners.forEach((notify) => notify());
}

/** What the panel draws: the newest rows, as many as fit on a phone. */
/**
 * Brings the log back within capacity, spending scroll lines first.
 *
 * Ordering is preserved — a scroll is removed from wherever it sits, not
 * moved — because the sequence is the entire evidence and a reordered log
 * would be worse than a truncated one.
 */
function trim(next: DiagnosticEvent[]): DiagnosticEvent[] {
  if (next.length <= RETAINED_CAPACITY) return next;

  const kept = [...next];
  while (kept.length > RETAINED_CAPACITY) {
    const victim = kept.findIndex((event) => EVICTABLE.test(event.text));
    // No scroll left to spend: fall back to dropping the oldest line, which
    // is the behaviour this replaced and still the only option at that point.
    kept.splice(victim === -1 ? 0 : victim, 1);
  }
  return kept;
}

/**
 * Like `logEvent`, but folds a run of related lines into one.
 *
 * Written for scrolling, and written because a capture was lost to it: a
 * finger drag emits a sample every 16 ms, none of them textually identical,
 * so `logEvent`'s repeat counter never fired and sixty lines a second pushed
 * the focus events — the entire reason the log exists — off the end of the
 * buffer. The export came back saying "older ones dropped" and ended one line
 * before the interesting part.
 *
 * Folding keeps what the burst is worth: the timestamp of its **start**,
 * which is what a scroll has to be compared against a `focus` for, the value
 * it ended on, and how many samples it took. A scroll that happens inside
 * focus handling is one or two samples and stays perfectly legible; a drag
 * across the screen is one line instead of ninety.
 */
export function logEventCoalesced(
  prefix: string,
  /**
   * Given the line already standing (without its `×N` suffix) when this
   * continues a burst, or `undefined` when it starts one. Letting the caller
   * see what it is extending is what allows a range to be carried: the first
   * sample writes where it began, and every one after rewrites the end while
   * keeping that beginning.
   */
  build: (previous: string | undefined) => string,
): void {
  const last = events[events.length - 1];
  if (last && last.text.startsWith(prefix)) {
    const base = last.text.replace(/ ×\d+$/, '');
    const count = Number(/ ×(\d+)$/.exec(last.text)?.[1] ?? '1') + 1;
    // `last.at` on purpose: the burst is dated from when it began, which is
    // the timestamp a scroll has to be compared against a `focus` for.
    events = [...events.slice(0, -1), { at: last.at, text: `${build(base)} ×${count}` }];
    listeners.forEach((notify) => notify());
    return;
  }
  logEvent(build(undefined));
}

export function getEvents(): DiagnosticEvent[] {
  return events.slice(-DISPLAY_CAPACITY);
}

/** Everything retained, oldest first. Used by the export button. */
export function getAllEvents(): DiagnosticEvent[] {
  return events;
}

/**
 * How many rows the short export carries.
 *
 * Added because the long one did not arrive. Successive exports of run
 * `7FEV1Y` reported 319 and then 338 events, and the text that reached the
 * other end stopped at the same place both times, mid-word — so the cut is
 * somewhere in the transport, not in the buffer, and a shorter message is the
 * one thing that gets under it. Fifty rows is roughly one interaction with a
 * field, which is the unit a question is usually asked about.
 */
export const TAIL_CAPACITY = 50;

/**
 * The log as text, with the header that makes it worth reading.
 *
 * A photograph of fourteen rows has been the transport so far, and it drops
 * exactly the things a second reader needs: which build this is, which JS
 * runtime the rows belong to, and how many rows were cut off the top. A
 * failed diagnosis over a screenshot costs another build and another day, so
 * the export carries its own provenance.
 *
 * Nothing here can contain anything anybody typed: the events are labels,
 * ids, sizes and counts, and every call site is written that way.
 *
 * ## Why it ends with END
 *
 * An export is only evidence if the reader can tell it arrived whole. Text
 * handed to a share sheet passes through whichever app the operator picks,
 * and at least one of them silently truncated a 338-row log at the same
 * character twice, mid-word, with nothing to mark that it had. A trailing
 * `END records=N` makes that visible from the received text alone: the line
 * is missing, or the count on it disagrees with the rows below the header.
 * Neither can be mistaken for a log that simply had little to say.
 */
export function serializeEvents(
  header: Record<string, string>,
  options: { limit?: number } = {},
): string {
  const selected = options.limit === undefined ? events : events.slice(-options.limit);
  const evicted = events.length >= RETAINED_CAPACITY ? ' (older ones dropped)' : '';
  const lines = [
    `TuTak diagnostic log`,
    `run ${RUN_ID} started ${startedAt.toISOString()}`,
    ...Object.entries(header).map(([key, value]) => `${key} ${value}`),
    selected.length === events.length
      ? `events ${events.length}${evicted}`
      : `events ${selected.length} of ${events.length}${evicted} (last ${selected.length} only)`,
    '',
    ...selected.map((event) => `${String(event.at).padStart(6, ' ')}ms  ${event.text}`),
    '',
    // Deliberately the last line and deliberately carrying the count: see above.
    `END records=${selected.length}`,
  ];
  return lines.join('\n');
}

/** A file name that says which run and which build a saved log belongs to. */
export function exportFileName(commit: string): string {
  return `tutak-diag-${commit}-${RUN_ID}.txt`;
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
