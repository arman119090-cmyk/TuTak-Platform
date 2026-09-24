import type { Artist } from './types';

/**
 * Artists named in the owner's catalog. Only the name is confirmed; every
 * other field stays null until the owner supplies it. No biography is
 * written to fill space.
 */
const artists: Artist[] = [
  {
    slug: 'david-davidyan',
    name: 'David Davidyan',
    lifeDates: null,
    country: null,
    biography: null,
    exhibitions: null,
    provenanceNotes: null,
  },
  {
    slug: 'edouard-delabriere',
    name: 'Édouard Delabrière',
    lifeDates: null,
    country: null,
    biography: null,
    exhibitions: null,
    provenanceNotes: null,
  },
];

export function getArtists(): Artist[] {
  return artists;
}

export function getArtist(slug: string | null): Artist | undefined {
  return slug ? artists.find((a) => a.slug === slug) : undefined;
}

export function artistSlugForName(name: string): string {
  const found = artists.find((a) => a.name === name);
  if (!found) throw new Error(`artists: "${name}" is in the catalog but not in artists.ts`);
  return found.slug;
}
