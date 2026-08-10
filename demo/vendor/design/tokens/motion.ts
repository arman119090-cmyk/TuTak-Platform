/**
 * Motion.
 *
 * Movement is used to explain state change, never to entertain. Durations
 * stay under a quarter second so the product feels instant; easing is
 * asymmetric (fast out, gentle in) so things feel physical rather than
 * mechanical.
 */

export const duration = {
  instant: 90,
  fast: 140,
  normal: 200,
  slow: 280,
  /** Only for a balance counting up or a bar re-proportioning. */
  deliberate: 420,
} as const;

export const easing = {
  /** Default for entrances and most transitions. */
  standard: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** Elements leaving the screen. */
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  /** Sheets and anything that should feel weighted. */
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  linear: 'linear',
} as const;

/** React Native Animated spring config matching `easing.spring`. */
export const springConfig = {
  gentle: { damping: 18, stiffness: 180, mass: 1 },
  snappy: { damping: 22, stiffness: 260, mass: 0.9 },
} as const;

export const transition = {
  base: `all ${duration.normal}ms ${easing.standard}`,
  colors: `background-color ${duration.fast}ms ${easing.standard}, border-color ${duration.fast}ms ${easing.standard}, color ${duration.fast}ms ${easing.standard}`,
  transform: `transform ${duration.fast}ms ${easing.standard}`,
} as const;
