import { Keyboard } from 'react-native';
import { logEvent } from './eventLog';
import { isDiagnosticBuild } from './isDiagnosticBuild';
import { nameForNode } from './focusRegistry';

/**
 * Who *asked* for focus to move — as opposed to who was told that it had.
 *
 * ## The question this exists to settle
 *
 * The device log shows, three times over, a sequence no person can perform:
 *
 * ```
 * 14197 focus Номер телефона kbd=number-pad
 * 14205 kbShow h=332 on=Номер телефона kbd=number-pad
 * 14222 blur  Номер телефона          ← 17ms after the keyboard appeared
 * 14222 focus Пароль kbd=default
 * 14250 blur  Пароль
 * 14251 focus Номер телефона
 * 14251 blur  Номер телефона
 * 14272 kbHide on=none of=2
 * ```
 *
 * Every one of those lines comes from `onFocus`/`onBlur`, and those fire when
 * React Native is *told* focus moved. They cannot say who moved it. The two
 * answers need different fixes and there is no way to choose between them
 * from the outside:
 *
 * * **A — JavaScript asked.** Something in this app, in React Native itself,
 *   or in a library called `focus()` or `blur()`. Then the fix is here, and
 *   this file names the caller.
 * * **B — nobody asked.** No command was issued and the focus moved anyway:
 *   Android, the autofill service, the IME or the compatibility-mode window
 *   did it, and React Native only reported the result. Then the fix is in the
 *   Android configuration, and no amount of editing this codebase would have
 *   found it.
 *
 * ## How it can tell
 *
 * React Native keeps these two things in separate functions, which is what
 * makes the distinction cleanly observable:
 *
 * * `TextInputState.focusInput` / `blurInput` are *bookkeeping*, called from
 *   `TextInput`'s own `_onFocus`/`_onBlur` — the record of what native said.
 *   Those are deliberately **not** patched here; they would log case B as if
 *   it were case A.
 * * `TextInputState.focusTextInput` / `blurTextInput` (and the `…Field`
 *   variants) are *commands* — they dispatch to native to actually move
 *   focus, and every `ref.focus()`, `ref.blur()` and `Keyboard.dismiss()`
 *   goes through them.
 *
 * So a `REQ focus …` line before a `focus …` line is case A. A `focus …`
 * line with no `REQ` before it is case B.
 *
 * Two callers are already known to exist inside React Native and are the
 * reason this patches the shared module rather than this app's own code —
 * neither would appear in any search of `apps/mobile`:
 *
 * * `ScrollView` blurs the focused input on a touch whose target is not that
 *   input. Its guard is `keyboardShouldPersistTaps !== true && !== 'always'`,
 *   and this app passes `'handled'`, so that path **is live here**.
 * * `Keyboard.dismiss()` is `blurTextInput(currentlyFocusedInput())`.
 *
 * ## Cost and safety
 *
 * It reaches into `react-native/Libraries/…`, which is not a public entry
 * point and can move between versions. Hence: installed only in a diagnostic
 * build, wrapped so that a module that is not there or has changed shape
 * leaves the app exactly as it was, and it always calls through to the
 * original. Nothing about focus behaviour changes — that is the point, since
 * an instrument that alters what it measures would waste the one remaining
 * capture.
 */

interface TextInputStateModule {
  focusTextInput?: (node: unknown) => void;
  blurTextInput?: (node: unknown) => void;
  focusField?: (tag: unknown) => void;
  blurField?: (tag: unknown) => void;
}

let installed = false;

/**
 * A short hint at who called, from the stack.
 *
 * Release bundles are minified and Hermes stacks are thin, so this is a
 * bonus rather than the finding: the presence or absence of the `REQ` line
 * is what answers the question. Frames belonging to this file and to the
 * React Native internals being patched are dropped, so what is left is the
 * first frame that is actually a caller.
 */
function callerHint(): string {
  const stack = new Error().stack ?? '';
  const frames = stack
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(
      (line) =>
        !line.includes('focusCommandTrace') &&
        !line.includes('callerHint') &&
        line.length > 0,
    );
  const frame = frames[0] ?? '';
  // Just the function name where there is one — a path in a phone-width log
  // row pushes everything else off the screen.
  const named = /at\s+([A-Za-z0-9_$.]+)/.exec(frame);
  return named?.[1] ?? (frame ? frame.slice(0, 40) : 'unknown');
}

/**
 * Patches the focus commands so every programmatic request is recorded.
 *
 * Idempotent, and a no-op outside a diagnostic build.
 */
export function installFocusCommandTrace(): void {
  if (installed || !isDiagnosticBuild()) return;
  installed = true;

  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const module = require('react-native/Libraries/Components/TextInput/TextInputState') as {
      default?: TextInputStateModule;
    } & TextInputStateModule;
    /* eslint-enable @typescript-eslint/no-require-imports */
    const state: TextInputStateModule = module.default ?? module;

    const wrapNode = (key: 'focusTextInput' | 'blurTextInput', verb: string) => {
      const original = state[key];
      if (typeof original !== 'function') return;
      state[key] = (node: unknown) => {
        logEvent(`REQ ${verb} ${nameForNode(node)} src=${callerHint()}`);
        original(node);
      };
    };

    const wrapField = (key: 'focusField' | 'blurField', verb: string) => {
      const original = state[key];
      if (typeof original !== 'function') return;
      state[key] = (tag: unknown) => {
        logEvent(`REQ ${verb} tag=${String(tag)} src=${callerHint()}`);
        original(tag);
      };
    };

    wrapNode('focusTextInput', 'focus');
    wrapNode('blurTextInput', 'blur');
    wrapField('focusField', 'focus');
    wrapField('blurField', 'blur');

    // `Keyboard.dismiss` reaches the same command underneath, so this is not
    // strictly a second signal — it is a better-named one, because "the app
    // dismissed the keyboard" and "something blurred the focused input" are
    // the same act with very different intents behind them.
    const dismiss = Keyboard.dismiss.bind(Keyboard);
    Keyboard.dismiss = () => {
      logEvent(`REQ dismiss src=${callerHint()}`);
      dismiss();
    };

    logEvent('trace focus-commands armed');
  } catch (err) {
    // A React Native version that moved the module. The rest of the log is
    // unaffected, and this line says the discriminator is missing rather than
    // letting its silence be read as "nothing asked for focus".
    logEvent(`trace focus-commands UNAVAILABLE (${(err as Error).message.slice(0, 40)})`);
  }
}

/** Cleared between tests. Never called by the app. */
export function resetFocusCommandTrace(): void {
  installed = false;
}
