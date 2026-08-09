import { useWindowDimensions } from 'react-native';

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
 */
export function useCompactLayout(): boolean {
  const { height } = useWindowDimensions();
  return height < 700;
}
