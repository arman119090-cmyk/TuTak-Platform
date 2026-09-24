import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import source from '@/content/catalog.source.json';
import { getArtworks, getPopulatedCategories } from '@/content/catalog';
import { getArtists } from '@/content/artists';
import { searchEntries } from '@/lib/search';
import { buildSearchIndex } from '@/lib/page';

const root = join(__dirname, '../..');

/** Reads width/height from a WebP header (VP8, VP8L or VP8X). */
function webpSize(buf: Buffer): [number, number] {
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)];
  }
  if (chunk === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  throw new Error(`not a WebP: ${chunk}`);
}

describe('catalog', () => {
  const artworks = getArtworks();

  it('carries every entry of the owner catalog, in order', () => {
    expect(artworks.map((a) => a.slug)).toEqual(source.map((s) => s.slug));
  });

  it('keeps the owner facts verbatim and invents none', () => {
    for (const a of artworks) {
      const s = source.find((x) => x.slug === a.slug)!;
      expect(a.title).toBe(s.title);
      expect(a.dimensions).toBe(s.dimensions);
      expect(a.price).toBeNull();
      for (const field of ['material', 'year', 'origin', 'provenance', 'condition', 'status', 'placement', 'description'] as const) {
        expect(a[field], `${a.slug}.${field}`).toBeNull();
      }
    }
  });

  it('attributes only the two artists named by the owner', () => {
    const attributed = artworks.filter((a) => a.artistSlug).map((a) => a.slug);
    expect(attributed).toEqual(['david-davidyan', 'edouard-delabriere-hunter']);
    for (const artist of getArtists()) {
      expect(artist.biography).toBeNull();
      expect(artist.lifeDates).toBeNull();
    }
  });

  it('records the real pixel size of every image', () => {
    for (const a of artworks) {
      const size = webpSize(readFileSync(join(root, 'public', a.image.src)));
      expect(size, a.image.src).toEqual([a.image.width, a.image.height]);
    }
  });

  it('offers only categories that hold pieces', () => {
    expect(getPopulatedCategories()).toEqual(['paintings', 'sculpture', 'fountains-garden', 'decorative-arts']);
  });
});

describe('search', () => {
  const index = buildSearchIndex('ru');
  it('finds by title words, accent-insensitively, and by localised category', () => {
    expect(searchEntries(index, 'tatev').map((e) => e.slug)).toEqual(['sacred-heights-tatev']);
    expect(searchEntries(index, 'delabriere').map((e) => e.slug)).toEqual(['edouard-delabriere-hunter']);
    expect(searchEntries(index, 'фонтаны').length).toBe(3);
    expect(searchEntries(index, 'fountains garden').length).toBe(3);
  });
  it('returns nothing for an empty query', () => {
    expect(searchEntries(index, '   ')).toEqual([]);
  });
});
