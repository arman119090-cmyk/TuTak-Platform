/**
 * The raw palette. Nothing in the product references these directly — screens
 * use the semantic roles in `theme.ts`, so that the light and (eventually) dark
 * themes cannot drift apart.
 *
 * The brand hue is a deep jade: it reads as "money" without being the flat
 * banking green everyone else uses, it holds up on the cheap, washed-out LCD
 * panels a lot of drivers actually have, and it keeps 4.5:1 against white at
 * the 600 step so the primary button's label is legible in direct sunlight.
 */
export const palette = {
  jade: {
    50: '#EDF9F4',
    100: '#D2F0E4',
    200: '#A6E1CA',
    300: '#6FCCAB',
    400: '#35B189',
    500: '#12926C',
    600: '#0B7557',
    700: '#085B44',
    800: '#064434',
    900: '#042C22',
  },
  ink: {
    0: '#FFFFFF',
    25: '#FBFCFC',
    50: '#F4F6F5',
    100: '#E8ECEA',
    200: '#D5DBD8',
    300: '#B3BDB8',
    400: '#8A9691',
    500: '#65726D',
    600: '#4A5551',
    700: '#333B38',
    800: '#1F2523',
    900: '#0E1211',
  },
  amber: {
    50: '#FFF6E6',
    100: '#FFE8BF',
    500: '#C07A00',
    600: '#9A6100',
    700: '#754A00',
  },
  crimson: {
    50: '#FDEDEB',
    100: '#FAD4CF',
    500: '#CB2E1B',
    600: '#A62416',
    700: '#7F1B10',
  },
  sapphire: {
    50: '#EAF1FE',
    100: '#CFE0FD',
    500: '#1D4ED8',
    600: '#1740AE',
    700: '#123285',
  },
} as const;
