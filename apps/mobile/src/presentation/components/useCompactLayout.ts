import { useEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import { logEvent } from '../../diagnostics/eventLog';

/**
 * Whether this screen is short enough that decorative vertical space has to
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
 * A hook rather than a constant because it has to react — an Android phone
 * can be rotated, and a foldable changes height without being rotated at all.
 *
 * ## Why it is instrumented
 *
 * On Android the window height also changes when the keyboard opens. So this
 * hook re-evaluates mid-interaction, and if a device's height crosses 700 at
 * that moment the whole form re-lays-out — different top padding, different
 * spacing — while the keyboard is animating. That is a candidate for the
 * flickering that four hypotheses have missed, and it is untested because
 * nothing here has a window at all.
 *
 * It is a candidate, not a conclusion. The log records the height and the
 * flag so a screenshot can settle it, rather than a fifth guess.
 */
export function useCompactLayout(): boolean {
  const { height } = useWindowDimensions();
  const compact = height < 700;
  const previous = useRef<{ height: number; compact: boolean } | null>(null);

  useEffect(() => {
    const last = previous.current;
    if (last && last.height === height) return;

    previous.current = { height, compact };
    // The flip is the interesting part, so it is called out rather than left
    // to be worked out from the number.
    logEvent(
      last && last.compact !== compact
        ? `win h=${Math.round(height)} compact→${compact}`
        : `win h=${Math.round(height)}`,
    );
  }, [height, compact]);

  return compact;
}
