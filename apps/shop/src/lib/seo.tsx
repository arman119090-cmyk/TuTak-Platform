import { brand, brandName, siteUrl } from '@/config/brand';
import type { Locale } from './i18n';
import { htmlLang } from './i18n';

/** Structured data helpers. Rendered as <script type="application/ld+json">. */

export const breadcrumbJsonLd = (
  items: { name: string; url: string }[],
): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: `${siteUrl}${item.url}`,
  })),
});

export const productJsonLd = ({
  name,
  description,
  sku,
  brandName,
  images,
  priceMinor,
  currency,
  inStock,
  ratingAvg,
  reviewCount,
  url,
}: {
  name: string;
  description: string;
  sku: string;
  brandName: string;
  images: string[];
  priceMinor: number;
  currency: string;
  inStock: boolean;
  ratingAvg: number;
  reviewCount: number;
  url: string;
}): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name,
  description,
  sku,
  brand: { '@type': 'Brand', name: brandName },
  image: images.map((image) => `${siteUrl}${image}`),
  offers: {
    '@type': 'Offer',
    // AMD has no minor unit, so the integer amount is already the price.
    price: priceMinor,
    priceCurrency: currency,
    availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder',
    url: `${siteUrl}${url}`,
    seller: { '@type': 'Organization', name: brand.name },
  },
  ...(reviewCount > 0
    ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: ratingAvg.toFixed(1),
          reviewCount,
        },
      }
    : {}),
});

export const organizationJsonLd = (locale: Locale): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'FurnitureStore',
  name: brandName(locale),
  // The other spellings of the same shop, so search engines connect them.
  alternateName: [...new Set(Object.values(brand.names))].filter(
    (value) => value !== brandName(locale),
  ),
  description: brand.tagline[locale],
  url: siteUrl,
  telephone: brand.contacts.phones.map((phone) => phone.dial),
  email: brand.contacts.email,
  address: {
    '@type': 'PostalAddress',
    addressCountry: 'AM',
    addressLocality: 'Yerevan',
    streetAddress: brand.address[locale],
  },
  inLanguage: htmlLang(locale),
});

export const JsonLd = ({ data }: { data: Record<string, unknown> }) => (
  <script
    type="application/ld+json"
    // The payload is built from our own database rows, never user input.
    dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
  />
);
