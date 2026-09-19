/**
 * WCAG relative-luminance and contrast maths.
 *
 * This lives in the design system, not in a designer's head, because the
 * contrast requirements are testable — and are tested. A palette change that
 * drops the primary button's label below 4.5:1 fails CI rather than shipping to
 * a driver squinting at a phone in the sun.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function parseHexColor(hex: string): Rgb {
  const normalised = hex.trim().replace(/^#/, '');
  const expanded =
    normalised.length === 3
      ? normalised
          .split('')
          .map((char) => char + char)
          .join('')
      : normalised;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new RangeError(`parseHexColor: "${hex}" is not a 3- or 6-digit hex colour`);
  }
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

function channelLuminance(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: string | Rgb): number {
  const { r, g, b } = typeof color === 'string' ? parseHexColor(color) : color;
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

/** Returns the WCAG 2.1 contrast ratio, between 1 and 21. */
export function contrastRatio(foreground: string | Rgb, background: string | Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export type ContrastLevel = 'AA' | 'AAA';
export type TextSize = 'normal' | 'large';

/** AA: 4.5:1 for body text, 3:1 for large text. AAA: 7:1 and 4.5:1. */
export function meetsContrast(
  foreground: string,
  background: string,
  level: ContrastLevel = 'AA',
  size: TextSize = 'normal',
): boolean {
  const ratio = contrastRatio(foreground, background);
  const required = level === 'AAA' ? (size === 'large' ? 4.5 : 7) : size === 'large' ? 3 : 4.5;
  return ratio >= required;
}
