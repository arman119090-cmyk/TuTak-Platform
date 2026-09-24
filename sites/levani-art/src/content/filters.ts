import type { Artwork } from './types';

/**
 * Facets the collection can filter by. Only `category` is live in v1 (it is
 * routed as /collection/[category]). The rest are defined so they can be
 * switched on once the catalog carries the data — each is hidden until at
 * least one artwork has a value for it.
 */
export interface Facet {
  key: string;
  enabled: boolean;
  valueOf: (a: Artwork) => string | null;
}

export const facets: Facet[] = [
  { key: 'category', enabled: true, valueOf: (a) => a.category },
  { key: 'artist', enabled: false, valueOf: (a) => a.artistSlug },
  { key: 'material', enabled: false, valueOf: (a) => a.material?.en ?? null },
  { key: 'placement', enabled: false, valueOf: (a) => a.placement },
  { key: 'status', enabled: false, valueOf: (a) => a.status },
];

export function activeFacets(items: Artwork[]): Facet[] {
  return facets.filter((f) => f.enabled && items.some((a) => f.valueOf(a) !== null));
}
