import { COLORS } from '@/data/attributes';

export type ArtPalette = {
  body: string;
  shade: string;
  highlight: string;
  wallTop: string;
  wallBottom: string;
  floor: string;
  floorShade: string;
  accent: string;
  prop: string;
  line: string;
};

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
};

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;

/** Lightens (amount > 0) or darkens (amount < 0) a hex colour. */
export const shift = (hex: string, amount: number): string => {
  const [r, g, b] = hexToRgb(hex);
  const target = amount > 0 ? 255 : 0;
  const ratio = Math.abs(amount);
  return rgbToHex(r + (target - r) * ratio, g + (target - g) * ratio, b + (target - b) * ratio);
};

export const relativeLuminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

/**
 * Builds a complete scene palette from the product colour, so every piece of
 * generated artwork looks like it was shot in the same studio: warm colours get
 * a warm wall, cool ones a cool wall, and the furniture always separates from
 * the background.
 */
export const buildPalette = (colorKey: string): ArtPalette => {
  const color = COLORS[colorKey] ?? COLORS.beige!;
  const body = color.hex;
  const luminance = relativeLuminance(body);
  const cool = color.family === 'cool';
  const warmWallTop = cool ? '#EDEFF1' : '#F4EFE8';
  const warmWallBottom = cool ? '#DFE3E7' : '#E8E0D5';

  return {
    body,
    shade: color.shade,
    highlight: shift(body, luminance > 0.6 ? -0.06 : 0.18),
    wallTop: warmWallTop,
    wallBottom: warmWallBottom,
    floor: cool ? '#D7D2CB' : '#DCD2C4',
    floorShade: cool ? '#C3BDB5' : '#C9BDAC',
    accent: color.family === 'accent' ? shift(body, 0.3) : '#B08B5E',
    prop: '#6F7A63',
    line: shift(body, -0.35),
  };
};
