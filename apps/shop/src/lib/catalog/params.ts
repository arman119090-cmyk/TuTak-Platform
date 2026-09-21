import type { Locale } from '../i18n';
import type { CatalogQuery, CatalogSort } from './types';

const SORTS: CatalogSort[] = ['popular', 'price-asc', 'price-desc', 'new', 'rating', 'discount'];

const list = (value: string | null): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);

const int = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * URL <-> filter state.
 *
 * Filters live in the query string so every filtered view is linkable, works
 * with the browser Back button and can be shared — no hidden client state.
 */
export const parseCatalogSearchParams = (
  params: URLSearchParams,
  locale: Locale,
  categorySlug?: string,
): CatalogQuery => {
  const sortParam = params.get('sort') as CatalogSort | null;
  const specs: Record<string, string[]> = {};
  for (const [key, value] of params.entries()) {
    if (!key.startsWith('spec.')) continue;
    const specKey = key.slice(5);
    if (specKey) specs[specKey] = list(value);
  }

  return {
    locale,
    categorySlug: categorySlug ?? params.get('category') ?? undefined,
    search: params.get('q') ?? undefined,
    brands: list(params.get('brand')),
    colors: list(params.get('color')),
    materials: list(params.get('material')),
    styles: list(params.get('style')),
    priceMin: int(params.get('priceMin')),
    priceMax: int(params.get('priceMax')),
    widthMin: int(params.get('widthMin')),
    widthMax: int(params.get('widthMax')),
    inStock: params.get('inStock') === '1',
    discounted: params.get('discounted') === '1',
    ratingFrom: int(params.get('rating')),
    specs,
    sort: sortParam && SORTS.includes(sortParam) ? sortParam : 'popular',
    page: Math.max(1, int(params.get('page')) ?? 1),
  };
};

/** Serialises filter state back into a query string for links. */
export const buildCatalogHref = (
  base: string,
  params: URLSearchParams,
  changes: Record<string, string | string[] | null>,
): string => {
  const next = new URLSearchParams(params.toString());
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || (Array.isArray(value) && value.length === 0) || value === '')
      next.delete(key);
    else next.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  // Any filter change resets pagination — page 3 of a different result set is
  // never what the customer meant.
  if (!('page' in changes)) next.delete('page');
  const query = next.toString();
  return query ? `${base}?${query}` : base;
};

export const countActiveFilters = (params: URLSearchParams): number => {
  let count = 0;
  for (const [key, value] of params.entries()) {
    if (['sort', 'page', 'view', 'q'].includes(key)) continue;
    if (!value) continue;
    count +=
      key.startsWith('spec.') ||
      key === 'brand' ||
      key === 'color' ||
      key === 'material' ||
      key === 'style'
        ? value.split(',').filter(Boolean).length
        : 1;
  }
  return count;
};
