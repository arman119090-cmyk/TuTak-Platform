import { useEffect, useRef, useState } from 'react';
import { Dimensions } from 'react-native';
import { logEvent } from '../../diagnostics/eventLog';

/** Below this the decorative vertical space on the auth screens has to give way. */
const COMPACT_HEIGHT = 700;

/** The device's screen height — not the window's. See the note below. */
function screenHeight(): number {
  return Dimensions.get('screen').height;
}

/**
 * Whether this *device* is short enough that decorative vertical space has to
 * give way.
 *
 * The auth screens open with 64 points of padding, a mark, a title and 40
 * points under the subtitle. That is right on a modern phone and wrong on a
 * 5-inch one, where it pushes the first field most of the way down a window
 * the keyboard has already halved. The forms scroll, so nothing is
 * unreachable either way — but a person should not have to scroll to reach
 * the field they just tapped into.
 *
 * 700 points is the line: below it are the small and older Android handsets
 * this has to work on, above it everything from a Pixel upwards.
 *
 * ## Screen, not window — this is the bug fix
 *
 * This asked `useWindowDimensions()`, and a window is not a device. On
 * Android the window shrinks when the keyboard opens, so on any handset
 * whose windowed height straddles 700 the flag flipped *mid-interaction*:
 * keyboard opens → window shrinks → `compact` flips → the form re-lays-out
 * underneath the keyboard that is still animating → the field loses focus and
 * the keyboard closes again. Reported from a Samsung foldable as "the
 * keyboard appears for a second and goes straight back out", which is exactly
 * that sequence seen from outside.
 *
 * The previous revision of this file named that as a suspect and left it in
 * place to be confirmed. It is confirmed by construction rather than by
 * measurement: the question this hook asks is *"is this a small phone"*, and
 * the honest input to that question is the size of the screen. A screen does
 * not shrink because a keyboard opened, so the flag cannot flip during an
 * interaction and there is no loop to enter — the same reasoning that made
 * `useKeyboardInset` safe where `KeyboardAvoidingView` was not.
 *
 * It still reacts: a rotation and a foldable opening both change the screen,
 * and `Dimensions` reports both. What it no longer reacts to is the keyboard.
 */
export function useCompactLayout(): boolean {
  const [height, setHeight] = useState(screenHeight);

  useEffect(() => {
    // `screen`, never `window`: the handler fires for both, and reading the
    // wrong member here would put the keyboard straight back into the input.
    const subscription = Dimensions.addEventListener('change', ({ screen }) => {
      const next = screen?.height ?? screenHeight();
      setHeight((previous) => (Math.abs(previous - next) < 1 ? previous : next));
    });
    // A rotation between first render and this effect would otherwise be
    // missed until the next one.
    setHeight((previous) => {
      const next = screenHeight();
      return Math.abs(previous - next) < 1 ? previous : next;
    });
    return () => subscription.remove();
  }, []);

  const compact = height < COMPACT_HEIGHT;
  const previous = useRef<{ height: number; compact: boolean } | null>(null);

  useEffect(() => {
    const last = previous.current;
    if (last && last.height === height) return;

    previous.current = { height, compact };
    // The flip is the interesting part, so it is called out rather than left
    // to be worked out from the number. `scr` rather than `win` because which
    // dimension this reads is the whole point of the fix — a diagnostic build
    // that says `win` is running the old code.
    logEvent(
      last && last.compact !== compact
        ? `scr h=${Math.round(height)} compact→${compact}`
        : `scr h=${Math.round(height)}`,
    );
  }, [height, compact]);

  return compact;
}
