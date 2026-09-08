import { logEvent } from './eventLog';

/**
 * Which input React Native itself believes is focused, at the moment the
 * keyboard appears or goes away.
 *
 * ## Why this is not the same as the ring on screen
 *
 * `TextField` draws its focus ring from its own React state, set in
 * `onFocus`. Reading focus off that ring — or off a photograph of it — is
 * reading the app's opinion about an event it received, which is exactly the
 * inference this whole investigation keeps having to un-make. It is also
 * useless for the question at hand: the reported sequence has a *border*
 * appearing on the referral field and then a *numeric* keyboard, and if
 * those two disagree, the ring is the half that cannot be trusted.
 *
 * So each field registers its live input handle here, and this asks React
 * Native's own `isFocused()` when a keyboard event arrives. That answer comes
 * from `TextInputState`, which is updated by the native focus and blur
 * callbacks rather than by this app's rendering.
 *
 * ## What it still is not
 *
 * **It is not a query to Android.** No React Native API exposes "which native
 * view currently holds focus"; `isFocused()` is React Native's record of the
 * focus events it has been told about. If Android moves focus without telling
 * the bridge, this reports the stale answer — and that disagreement is itself
 * a finding, because it would show as a keyboard appearing while every input
 * says `false`.
 *
 * Read it that way: agreement is context, disagreement is evidence.
 */
interface RegisteredInput {
  /** Stable ASCII id, never a translated label and never a value. */
  traceId: string;
  /** What this field asks the IME for — `number-pad`, `default`, and so on. */
  keyboardType: string;
  /** React Native's own answer, not this app's `focused` state. */
  isFocused(): boolean;
  /**
   * The native handle this field sits on, for matching a focus *command*
   * back to a field name — see `focusCommandTrace.ts`. Optional so a caller
   * that only wants the focus summary need not provide one.
   */
  node?(): unknown;
}

const inputs = new Set<RegisteredInput>();

/** Registers a live input. Returns the function that removes it again. */
export function registerInput(input: RegisteredInput): () => void {
  inputs.add(input);
  return () => {
    inputs.delete(input);
  };
}

/** Cleared between tests. Never called by the app. */
export function resetFocusRegistry(): void {
  inputs.clear();
}

/**
 * `on=<field> kbd=<type>` for the log, or `on=none` when nothing claims it.
 *
 * Every registered field is asked, not just the first one that says yes: two
 * inputs both reporting focus would be a finding worth more than either
 * answer alone, and a summary that stopped at the first would hide it.
 *
 * A field that has not registered — anything outside `TextField` — cannot be
 * named here, which is why the count is included when it disagrees.
 */
export function describeFocus(): string {
  const focused: RegisteredInput[] = [];
  for (const input of inputs) {
    try {
      if (input.isFocused()) focused.push(input);
    } catch {
      // A handle whose component is being torn down. Not knowing is an
      // answer; throwing inside a keyboard listener is not.
    }
  }

  if (focused.length === 0) return `on=none of=${inputs.size}`;
  if (focused.length === 1) {
    return `on=${focused[0].traceId} kbd=${focused[0].keyboardType}`;
  }
  return `on=${focused.map((input) => input.traceId).join('+')} kbd=multiple`;
}

/**
 * Which field a focus command was aimed at, or a description of why not.
 *
 * React Native hands these commands the *inner* host instance, while a `ref`
 * on `TextInput` gives the outer one, so both are compared — `getNativeRef()`
 * is the documented way across. A command aimed at something this app did not
 * register is still worth a line: it means focus is being moved somewhere
 * other than these two fields.
 */
export function nameForNode(node: unknown): string {
  if (node == null) return 'nothing';
  for (const input of inputs) {
    try {
      const own = input.node?.();
      if (own == null) continue;
      if (own === node) return input.traceId;
      const inner: unknown = (own as { getNativeRef?: () => unknown }).getNativeRef?.();
      if (inner != null && inner === node) return input.traceId;
    } catch {
      // A handle mid-teardown. Keep looking at the others.
    }
  }
  return 'other-input';
}

/** `logEvent` with the focus summary appended — used by the keyboard events. */
export function logWithFocus(text: string): void {
  logEvent(`${text} ${describeFocus()}`);
}
