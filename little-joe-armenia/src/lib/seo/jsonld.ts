import "server-only";
import type { Metadata } from "next";
import { locales, type Locale } from "@/i18n/config";
import { env } from "@/lib/env";

// Structured data and hreflang helpers.

export function absolute(path: string): string {
  return new URL(path, env().APP_URL).toString();
}

/**
 * Canonical + hreflang for a localised path. `pathFor(l)` returns the path
 * of the same page in locale l. x-default points to Armenian.
 */
export function alternates(locale: Locale, pathFor: (l: Locale) => string): Metadata["alternates"] {
  return {
    canonical: absolute(pathFor(locale)),
    languages: {
      ...Object.fromEntries(locales.map((l) => [l, absolute(pathFor(l))])),
      "x-default": absolute(pathFor("hy")),
    },
  };
}

export function organizationLd() {
  const e = env();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": absolute("/#organization"),
    name: e.STORE_NAME,
    url: absolute("/"),
    areaServed: { "@type": "Country", name: "Armenia" },
  };
}

export function websiteLd(locale: Locale) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": absolute(`/${locale}#website`),
    name: env().STORE_NAME,
    url: absolute(`/${locale}`),
    inLanguage: locale,
    publisher: { "@id": absolute("/#organization") },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: absolute(`/${locale}/shop?q={search_term_string}`) },
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absolute(it.path),
    })),
  };
}

export function productLd(p: {
  name: string;
  path: string;
  description: string | null;
  images: string[];
  sku: string | null;
  gtin13: string | null;
  mpn: string | null;
  brand: string;
  collection: string;
  priceAmd: number | null;
  available: boolean;
  rating: { average: number; count: number } | null;
  reviews: { authorName: string; rating: number; body: string; createdAt: Date }[];
}) {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    url: absolute(p.path),
    image: p.images.map(absolute),
    brand: { "@type": "Brand", name: p.brand },
    category: p.collection,
  };
  if (p.description) ld.description = p.description;
  if (p.sku) ld.sku = p.sku;
  // Only verified manufacturer identifiers are passed in.
  if (p.gtin13) ld.gtin13 = p.gtin13;
  if (p.mpn) ld.mpn = p.mpn;
  if (p.priceAmd !== null) {
    ld.offers = {
      "@type": "Offer",
      url: absolute(p.path),
      priceCurrency: "AMD",
      price: p.priceAmd,
      availability: p.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@id": absolute("/#organization") },
    };
  }
  // AggregateRating/Review only from real, approved reviews.
  if (p.rating && p.rating.count > 0) {
    ld.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Math.round(p.rating.average * 10) / 10,
      reviewCount: p.rating.count,
      bestRating: 5,
      worstRating: 1,
    };
    ld.review = p.reviews.slice(0, 5).map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.authorName },
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
      reviewBody: r.body,
      datePublished: r.createdAt.toISOString().slice(0, 10),
    }));
  }
  return ld;
}
