import React from 'react';
import Svg, { Circle, Line, Path } from 'react-native-svg';

/**
 * The show/hide mark on a password field.
 *
 * Deliberately not part of the `V2NavIcon` family: that family's boundary rule
 * says a brand mark "never replaces the control label, semantic name or status
 * text", and here the glyph *is* the control. So this is a plain outline icon,
 * and the control that draws it carries a real `accessibilityLabel` — the icon
 * is never the only way to know what the button does.
 *
 * ## Which glyph means what
 *
 * An open eye means "tap to reveal"; a struck-through eye means "tap to hide".
 * That is the convention both platforms use, and it is the one that reads as
 * an *action* rather than as a status: the icon says what pressing it will do,
 * not what the field is currently doing. Getting this backwards is the common
 * mistake and it makes the control feel inverted.
 *
 * `crossed` therefore follows the revealed state, not the hidden one.
 *
 * Stroke-only, `currentColor`-style: the caller owns the colour, the same way
 * every other icon in this app works.
 */
export function EyeIcon({
  size = 20,
  color,
  crossed = false,
}: {
  size?: number;
  color: string;
  /** Draws the strike-through — pass `true` while the password is visible. */
  crossed?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* The lid: one symmetric curve out and back, so the shape stays even
          at 20px where a hand-tuned asymmetry would read as a wobble. */}
      <Path
        d="M2.5 12C4.6 7.9 8.1 5.8 12 5.8s7.4 2.1 9.5 6.2c-2.1 4.1-5.6 6.2-9.5 6.2S4.6 16.1 2.5 12Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3.1} stroke={color} strokeWidth={1.6} />
      {crossed ? (
        <Line
          x1={4}
          y1={20}
          x2={20}
          y2={4}
          stroke={color}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      ) : null}
    </Svg>
  );
}
