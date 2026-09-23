import type { Locale } from "@/i18n/config";
import { LINES } from "../../prisma/seed-data/brandbook-lines";

// Presentation data for product lines that is not stored in the database:
// the brand-book tagline and the hero art cropped from the brand book
// (public/brand/lines/<slug>.webp, all 960×1212).
export type LineMeta = { slug: string; tagline: string; accent: string; hero: { url: string; width: number; height: number } | null };

export function lineMeta(slug: string, locale: Locale): LineMeta | null {
  const l = LINES.find((x) => x.slug === slug);
  if (!l) return null;
  return {
    slug,
    tagline: l.tagline[locale],
    accent: l.accent,
    hero: l.hero ? { url: `/brand/lines/${slug}.webp`, width: 960, height: 1212 } : null,
  };
}

/** Card title without the line prefix ("Little Joe Thumbs Up Vanilla" → "Vanilla"). */
export function shortName(name: string, collectionName: string): string {
  if (name.startsWith(`${collectionName} `)) return name.slice(collectionName.length + 1);
  return name.replace(/^Little Joe\s+/, "");
}
