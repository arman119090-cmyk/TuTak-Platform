import type { Locale } from '@/i18n/config';

/**
 * Content model. Fact fields are nullable on purpose: `null` means "not
 * confirmed by the owner" and the UI never renders a null field. Nothing in
 * this file may be filled with a guess — see CONTENT_TODO.md.
 */

/** Text that may differ per locale. Missing locales fall back to `en`. */
export type LocalizedText = Partial<Record<Locale, string>> & { en: string };

export const categories = [
  'paintings',
  'sculpture',
  'fountains-garden',
  'decorative-arts',
  'collectibles',
] as const;
export type Category = (typeof categories)[number];

export type AvailabilityStatus = 'available' | 'on-request' | 'reserved' | 'sold';
export type Placement = 'indoor' | 'outdoor' | 'indoor-outdoor';

/** A real price. v1 has none — `price: null` renders "Price on request". */
export interface Price {
  amount: number;
  currency: 'AMD' | 'USD' | 'EUR' | 'RUB' | 'GBP';
}

export interface ArtworkImage {
  src: string;
  width: number;
  height: number;
}

export interface Artwork {
  slug: string;
  /** Proper title as supplied by the owner; not translated. */
  title: string;
  subtitle: LocalizedText | null;
  category: Category;
  /** Slug into `artists`; null when authorship is not confirmed. */
  artistSlug: string | null;
  dimensions: string | null;
  material: LocalizedText | null;
  year: string | null;
  origin: LocalizedText | null;
  provenance: LocalizedText | null;
  condition: LocalizedText | null;
  status: AvailabilityStatus | null;
  placement: Placement | null;
  description: LocalizedText | null;
  deliveryNotes: LocalizedText | null;
  installationNotes: LocalizedText | null;
  price: Price | null;
  image: ArtworkImage;
  /** Curated order and editorial emphasis on the home page. */
  featured: 'hero' | 'lead' | 'pair' | 'moment' | null;
}

export interface Artist {
  slug: string;
  name: string;
  lifeDates: string | null;
  country: LocalizedText | null;
  biography: LocalizedText | null;
  exhibitions: LocalizedText[] | null;
  provenanceNotes: LocalizedText | null;
}
