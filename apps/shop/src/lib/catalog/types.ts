import type { Locale } from '../i18n';

export type ProductCard = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  shortDescription: string;
  priceMinor: number;
  oldPriceMinor: number | null;
  discountPct: number;
  currency: string;
  image: string;
  imageHover: string;
  brandName: string;
  categorySlug: string;
  rootCategorySlug: string;
  stockStatus: 'IN_STOCK' | 'ON_ORDER' | 'OUT_OF_STOCK';
  stockQty: number;
  productionDays: number;
  ratingAvg: number;
  reviewCount: number;
  isNew: boolean;
  isHit: boolean;
  isPremium: boolean;
  colorKeys: string[];
  materialKeys: string[];
  widthMm: number | null;
  depthMm: number | null;
  heightMm: number | null;
  /** Category-specific specs; the comparison table builds its rows from these. */
  specs: Record<string, string | number | boolean>;
};

export type CatalogSort = 'popular' | 'price-asc' | 'price-desc' | 'new' | 'rating' | 'discount';

export type CatalogFilters = {
  categorySlug?: string;
  search?: string;
  brands?: string[];
  colors?: string[];
  materials?: string[];
  styles?: string[];
  priceMin?: number;
  priceMax?: number;
  widthMin?: number;
  widthMax?: number;
  inStock?: boolean;
  discounted?: boolean;
  ratingFrom?: number;
  /** Category-specific specification filters: { mechanism: ['eurobook'] }. */
  specs?: Record<string, string[]>;
};

export type FacetValue = { key: string; label: string; count: number };

export type CatalogFacets = {
  brands: FacetValue[];
  colors: FacetValue[];
  materials: FacetValue[];
  styles: FacetValue[];
  specs: { key: string; label: string; values: FacetValue[] }[];
  priceMinMinor: number;
  priceMaxMinor: number;
  inStockCount: number;
  discountedCount: number;
};

export type CatalogResult = {
  items: ProductCard[];
  total: number;
  page: number;
  pageCount: number;
  facets: CatalogFacets;
};

export type CatalogQuery = CatalogFilters & {
  sort?: CatalogSort;
  page?: number;
  pageSize?: number;
  locale: Locale;
};
