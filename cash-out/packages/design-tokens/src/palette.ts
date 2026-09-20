/**
 * The raw palette. Nothing in the product references these directly — screens
 * use the semantic roles in `theme.ts`, so that the light and dark themes
 * cannot drift apart.
 *
 * The brand hue is the emerald the design source of truth specifies
 * (#0A7A63). It holds 5.3:1 against white, so a primary button's label stays
 * legible in direct sunlight, and 4.7:1 against the warm light canvas, so
 * brand-coloured text passes AA without a darker "text variant". The dark
 * theme lifts it to the 400 step for text on the navy canvas and pairs the
 * button with a deep-emerald label; both are checked by the contrast tests.
 *
 * Neutrals are warm in light (a paper canvas, #F6F2EA) and navy in dark
 * (#0B1424 / #111D31), per the design system.
 */
export const palette = {
  emerald: {
    50: '#E6F4F0',
    100: '#C3E6DC',
    200: '#8FD1BF',
    300: '#5BBB9F',
    400: '#2FA485',
    500: '#158C6F',
    600: '#0A7A63',
    700: '#08624F',
    800: '#064B3D',
    900: '#04322A',
  },
  paper: {
    0: '#FFFFFF',
    25: '#FBF9F4',
    50: '#F6F2EA',
    100: '#EFEAE0',
    200: '#E3DDD1',
    300: '#CFC7B8',
  },
  ink: {
    0: '#FFFFFF',
    50: '#F5F7FA',
    100: '#E1E5EC',
    200: '#B7C0CE',
    300: '#8A9199',
    400: '#7E8A9C',
    500: '#5B6472',
    600: '#3A4453',
    700: '#2E4062',
    750: '#223250',
    800: '#17253D',
    850: '#111D31',
    900: '#0B1424',
    950: '#0A1322',
  },
  amber: {
    50: '#FFF6E6',
    100: '#FFE8BF',
    300: '#F5C26B',
    500: '#C07A00',
    600: '#9A6100',
    700: '#754A00',
    900: '#3A2A08',
  },
  crimson: {
    50: '#FDEDEB',
    100: '#FAD4CF',
    300: '#FF8A80',
    500: '#CB2E1B',
    600: '#A62416',
    700: '#7F1B10',
    900: '#3D1412',
  },
  sapphire: {
    50: '#EAF1FE',
    100: '#CFE0FD',
    300: '#8FB4FF',
    500: '#1D4ED8',
    600: '#1740AE',
    700: '#123285',
    900: '#14264A',
  },
} as const;
