import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  V2_NAV_ICON_VIEWBOX,
  V2_WING_MARK_VIEWBOX,
  jakoWingMarkStrokes,
  v2NavIconPaths,
  v2QrIconDot,
  type V2NavIconName,
} from '@tutak/design';

/**
 * The v2 bottom-navigation / referral-entry icon family — see
 * `packages/design/src/brand/v2-icons.ts` for the source and provenance of
 * every path. Always `currentColor` outline art; a caller controls colour
 * through `color`, exactly like the `Ionicons` glyphs this replaces.
 *
 * `accessibilityLabel` is required, not optional: the master spec's Jako
 * icon-boundary rule ("never replaces the control label, semantic name or
 * status text") means this component is never the only way to identify what
 * it does — the caller still owns a real label, this is just the mark next
 * to (or under) it.
 */
export function V2NavIcon({
  name,
  size = 24,
  color,
  strokeWidth,
}: {
  name: V2NavIconName;
  size?: number;
  color: string;
  /** Overrides every stroke's own width, scaled proportionally — used when
   * rendering well below the 48px source canvas so strokes stay visible. */
  strokeWidth?: number;
}) {
  const strokes = v2NavIconPaths[name];
  return (
    <Svg width={size} height={size} viewBox={V2_NAV_ICON_VIEWBOX} fill="none">
      {strokes.map((s, i) => (
        <Path
          key={i}
          d={s.d}
          fill={s.fill === 'currentColor' ? color : 'none'}
          stroke={s.fill === 'currentColor' ? 'none' : color}
          strokeWidth={strokeWidth ?? s.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {name === 'qr' ? <Circle {...v2QrIconDot} fill={color} /> : null}
    </Svg>
  );
}

/**
 * `jako-wing-mark.svg` — the small CTA signature. See the boundary rule in
 * `v2-icons.ts`'s docblock before adding a new call site: safe primary/
 * secondary actions, the Home/referral entry and the branded navigation
 * only — never danger, disabled, or a dense operational control.
 */
export function JakoWingMark({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox={V2_WING_MARK_VIEWBOX} fill="none">
      {jakoWingMarkStrokes.map((s, i) => (
        <Path
          key={i}
          d={s.d}
          fill="none"
          stroke={color}
          strokeWidth={s.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
