/**
 * Pre-renders every width next/image may ask for, as static files:
 *   public/artworks/<name>.webp  →  public/artworks/_w/<width>/<name>.webp
 *
 * Why not the built-in /_next/image optimizer: in Next 16.3.6, a request
 * aborted while the optimizer is cold leaves that URL hanging for every later
 * visitor until the server restarts (reproduced 2026-09-24, see
 * docs/OTCHET_2026-09-24_LEVANI_ART_GOTOVNOST.md). Static variants remove
 * the runtime step entirely and cache well on any CDN.
 *
 * Widths live in ./image-widths.mjs.
 * Idempotent: an up-to-date variant is skipped.
 */
import { mkdir, readdir, stat, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { WIDTHS } from './image-widths.mjs';
const SRC = new URL('../public/artworks/', import.meta.url).pathname;

const files = (await readdir(SRC)).filter((f) => f.endsWith('.webp'));
let made = 0;
for (const file of files) {
  const input = join(SRC, file);
  const srcStat = await stat(input);
  const { width: srcWidth } = await sharp(input).metadata();
  for (const w of WIDTHS) {
    const dir = join(SRC, '_w', String(w));
    const out = join(dir, file);
    const outStat = await stat(out).catch(() => null);
    if (outStat && outStat.mtimeMs >= srcStat.mtimeMs) continue;
    await mkdir(dir, { recursive: true });
    if (w >= srcWidth) await copyFile(input, out); // never upscale
    else await sharp(input).resize({ width: w }).webp({ quality: 78, effort: 5 }).toFile(out);
    made++;
  }
}
console.log(`images: ${files.length} sources × ${WIDTHS.length} widths, ${made} written`);
