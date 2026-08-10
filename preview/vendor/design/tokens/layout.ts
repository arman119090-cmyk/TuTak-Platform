/** 4pt spacing grid. Everything on every surface snaps to this. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 40,
  9: 48,
  10: 64,
  11: 80,
  12: 96,
} as const;

/**
 * Radii. Large, soft corners are a core part of the premium feel — but the
 * scale is deliberately short so nothing looks arbitrary.
 */
export const radius = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 28,
  full: 9999,
} as const;

/**
 * Elevation. Shadows are almost invisible by design: depth comes from a
 * hairline border plus a very soft ambient shadow, never from a dark drop
 * shadow. Web values are CSS box-shadow; native values are RN shadow props.
 */
export const elevation = {
  none: {
    web: 'none',
    native: { shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  },
  sm: {
    web: '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.04)',
    native: {
      shadowColor: '#101828',
      shadowOpacity: 0.05,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
  },
  md: {
    web: '0 2px 4px rgba(16, 24, 40, 0.03), 0 6px 16px rgba(16, 24, 40, 0.06)',
    native: {
      shadowColor: '#101828',
      shadowOpacity: 0.07,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
  },
  lg: {
    web: '0 4px 8px rgba(16, 24, 40, 0.03), 0 16px 32px rgba(16, 24, 40, 0.08)',
    native: {
      shadowColor: '#101828',
      shadowOpacity: 0.1,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8,
    },
  },
} as const;

/** Page gutters. Mobile is a single column; dashboards centre on a max width. */
export const layout = {
  screenPaddingX: space[5],
  screenPaddingY: space[6],
  contentMaxWidth: 1240,
  sidebarWidth: 260,
  topBarHeight: 64,
  tabBarHeight: 84,
  /** Minimum touch target — never ship an interactive element smaller. */
  minTouchTarget: 44,
} as const;
