/** Absolute origin for canonical URLs, sitemap and Open Graph. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

/**
 * Absolute URL of a localized page, in the form the static host serves it
 * (trailing slash, see next.config.ts). `path` is locale-less: '' or '/about'.
 */
export function pageUrl(locale: string, path: string): string {
  return `${siteUrl()}/${locale}${path}/`;
}
