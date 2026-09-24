import source from './catalog.source.json';
import type { Artwork, ArtworkImage, Category } from './types';
import { categories } from './types';
import { artistSlugForName } from './artists';

/**
 * The initial catalog, built from the owner's `catalog.json` (kept verbatim in
 * catalog.source.json). Only the facts in that file are used. The overlay
 * below adds presentation data — image dimensions and editorial placement —
 * never facts.
 *
 * To connect a CMS later, replace `getArtworks()` with a fetch that returns
 * the same `Artwork[]` shape. Components depend on the type, not on this file.
 */

interface SourceEntry {
  slug: string;
  title: string;
  category: string;
  artist: string | null;
  dimensions: string | null;
  price: number | null;
  image: string;
}

// Pixel sizes of the files in public/artworks (checked by tests/unit/catalog.test.ts).
const imageSizes: Record<string, [number, number]> = {
  '01-majestic-elephant.webp': [709, 708],
  '02-imperial-malachite-pedestal.webp': [709, 884],
  '03-timeless-elegance-clock.webp': [709, 707],
  '04-egyptian-queen.webp': [709, 708],
  '05-sea-turtle-fountain.webp': [709, 472],
  '06-lion-serpent.webp': [709, 681],
  '07-golden-city-bridge.webp': [709, 708],
  '08-bronze-bear-cub.webp': [709, 706],
  '09-old-town-street.webp': [709, 705],
  '10-imperial-wild-boar.webp': [709, 471],
  '11-ethereal-grace-nude.webp': [709, 953],
  '12-grace-in-bronze-crane.webp': [709, 952],
  '13-aknuni.webp': [709, 680],
  '14-royal-dominion-lion-fountain.webp': [709, 949],
  '15-david-davidyan.webp': [709, 708],
  '16-eternal-harmony-fountain.webp': [709, 952],
  '17-sacred-heights-tatev.webp': [709, 698],
  '18-edouard-delabriere-hunter.webp': [709, 707],
};

const featured: Record<string, Artwork['featured']> = {
  'edouard-delabriere-hunter': 'hero',
  'sacred-heights-tatev': 'lead',
  'timeless-elegance-clock': 'pair',
  'egyptian-queen': 'pair',
  'royal-dominion': 'moment',
};

function toImage(path: string): ArtworkImage {
  const file = path.split('/').pop()!;
  const size = imageSizes[file];
  if (!size) throw new Error(`catalog: no dimensions recorded for ${file}`);
  return { src: `/artworks/${file}`, width: size[0], height: size[1] };
}

function toCategory(value: string): Category {
  if ((categories as readonly string[]).includes(value)) return value as Category;
  throw new Error(`catalog: unknown category "${value}"`);
}

const artworks: Artwork[] = (source as SourceEntry[]).map((entry) => ({
  slug: entry.slug,
  title: entry.title,
  subtitle: null,
  category: toCategory(entry.category),
  artistSlug: entry.artist ? artistSlugForName(entry.artist) : null,
  dimensions: entry.dimensions,
  material: null,
  year: null,
  origin: null,
  provenance: null,
  condition: null,
  status: null,
  placement: null,
  description: null,
  deliveryNotes: null,
  installationNotes: null,
  // The source carries `price: null` for every entry. A number would only
  // appear here once the owner confirms it.
  price: entry.price === null ? null : { amount: entry.price, currency: 'USD' },
  image: toImage(entry.image),
  featured: featured[entry.slug] ?? null,
}));

export function getArtworks(): Artwork[] {
  return artworks;
}

export function getArtwork(slug: string): Artwork | undefined {
  return artworks.find((a) => a.slug === slug);
}

export function getArtworksByCategory(category: Category): Artwork[] {
  return artworks.filter((a) => a.category === category);
}

export function getFeatured(kind: NonNullable<Artwork['featured']>): Artwork[] {
  return artworks.filter((a) => a.featured === kind);
}

/** Categories that currently hold at least one piece, in canonical order. */
export function getPopulatedCategories(): Category[] {
  return categories.filter((c) => artworks.some((a) => a.category === c));
}

/** Large objects get the architectural presentation on the detail page. */
export function isLargeObject(a: Artwork): boolean {
  return a.category === 'fountains-garden' || a.category === 'sculpture';
}
