/**
 * TuTak brand palette. Bonus-state colors are semantic and fixed by the
 * product spec: green = active/available, yellow = pending, blue = reserved.
 */
export const palette = {
  brandGreen: '#0B5D3B',
  brandGreenLight: '#E4F3EC',
  brandGreenDark: '#083F28',

  bonusAvailable: '#1DB954',
  bonusPending: '#F5A623',
  bonusReserved: '#2E7CF6',

  white: '#FFFFFF',
  black: '#0B0B0C',

  gray50: '#F7F7F8',
  gray100: '#EEEEF0',
  gray200: '#E1E1E5',
  gray300: '#C7C7CD',
  gray400: '#9B9BA1',
  gray500: '#6E6E76',
  gray600: '#4A4A52',
  gray700: '#2E2E34',
  gray800: '#1C1C20',
  gray900: '#101012',

  danger: '#E5484D',
  success: '#1DB954',
  warning: '#F5A623',
  info: '#2E7CF6',
} as const;

export interface AppTheme {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textInverse: string;
  primary: string;
  primarySurface: string;
  danger: string;
  bonusAvailable: string;
  bonusPending: string;
  bonusReserved: string;
}

export const lightTheme: AppTheme = {
  background: palette.white,
  surface: palette.gray50,
  surfaceAlt: palette.white,
  border: palette.gray200,
  textPrimary: palette.black,
  textSecondary: palette.gray500,
  textInverse: palette.white,
  primary: palette.brandGreen,
  primarySurface: palette.brandGreenLight,
  danger: palette.danger,
  bonusAvailable: palette.bonusAvailable,
  bonusPending: palette.bonusPending,
  bonusReserved: palette.bonusReserved,
};

export const darkTheme: AppTheme = {
  background: palette.gray900,
  surface: palette.gray800,
  surfaceAlt: palette.gray700,
  border: palette.gray700,
  textPrimary: palette.white,
  textSecondary: palette.gray400,
  textInverse: palette.black,
  primary: '#2FBE84',
  primarySurface: '#123D2A',
  danger: palette.danger,
  bonusAvailable: palette.bonusAvailable,
  bonusPending: palette.bonusPending,
  bonusReserved: palette.bonusReserved,
};
