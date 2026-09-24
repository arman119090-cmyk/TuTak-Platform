import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import imageLoader from '@/lib/image-loader';
// @ts-expect-error — plain .mjs module, no type declarations
import { WIDTHS } from '../../scripts/image-widths.mjs';

describe('pre-rendered image widths', () => {
  it('cover every width next/image can request', () => {
    const asked = [...(nextConfig.images?.deviceSizes ?? []), ...(nextConfig.images?.imageSizes ?? [])];
    expect([...asked].sort((a, b) => a - b)).toEqual([...WIDTHS].sort((a: number, b: number) => a - b));
  });

  it('loader maps artworks to their variant and leaves other files alone', () => {
    expect(imageLoader({ src: '/artworks/13-aknuni.webp', width: 480 })).toBe('/artworks/_w/480/13-aknuni.webp');
    expect(imageLoader({ src: '/brand/logo.jpg', width: 96 })).toBe('/brand/logo.jpg?w=96');
  });
});
