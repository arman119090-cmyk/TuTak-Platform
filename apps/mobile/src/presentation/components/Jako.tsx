import React from 'react';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import {
  JAKO_VIEWBOX,
  jakoDefaultColors,
  jakoEye,
  jakoPaths,
  jakoPremiumColors,
  jakoSilhouette,
  type JakoColors,
} from '@tutak/design';
import { useTheme } from '../../app/theme/ThemeProvider';

interface JakoProps {
  size?: number;
  colors?: Partial<JakoColors>;
}

/**
 * The full Jako mark. Used at exactly three moments in the app: the splash,
 * the auth header, and empty states. Never as page decoration — if Jako is
 * on screen more than once, something has gone wrong.
 *
 * Defaults to whichever palette matches the active theme — `jakoPremiumColors`
 * on dark, where the white-surface defaults would put a green wing on a bird
 * sitting in a blue app and draw the plumage in greys that vanish against
 * #0A0A0F; `jakoDefaultColors` on light, tuned the other way for the same
 * reason. A caller that passes its own `colors` (an empty state dimming the
 * mark, a watermark recolouring it) still wins outright — this default only
 * fills in what nobody overrode.
 */
export function Jako({ size = 48, colors }: JakoProps) {
  const { mode } = useTheme();
  const base = mode === 'light' ? jakoDefaultColors : jakoPremiumColors;
  const c = { ...base, ...colors };
  const fillFor: Record<string, string> = {
    brand: c.brand,
    body: c.body,
    crown: c.crown,
    beak: c.beak,
    beakShadow: c.beakShadow,
    scallops: c.scallops,
  };

  return (
    <Svg width={size} height={size} viewBox={JAKO_VIEWBOX} fill="none">
      {jakoPaths.map((p) => (
        <Path
          key={p.id}
          d={p.d}
          fill={fillFor[p.token]}
          opacity={'opacity' in p ? (p as { opacity: number }).opacity : 1}
        />
      ))}
      <Ellipse {...jakoEye.patch} fill={c.eyePatch} />
      <Circle {...jakoEye.pupil} fill={c.pupil} />
      <Circle {...jakoEye.catchlight} fill={c.catchlight} />
    </Svg>
  );
}

/**
 * Ghosted single-colour silhouette. This is the "subtle brand element"
 * treatment: Jako sits behind the balance card at very low opacity, large
 * and cropped, so it registers as texture rather than as a picture of a
 * bird. Decorative-only, hence aria-hidden equivalent (no accessibility
 * role) on native.
 */
export function JakoWatermark({
  size = 200,
  color = '#FFFFFF',
  opacity = 0.07,
}: {
  size?: number;
  color?: string;
  opacity?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox={JAKO_VIEWBOX} fill="none" opacity={opacity}>
      <Path d={jakoSilhouette} fill={color} />
    </Svg>
  );
}
