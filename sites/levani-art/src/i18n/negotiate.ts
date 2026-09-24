import { i18nConfig, isLocale, type Locale } from './config';

/**
 * Parses an Accept-Language header into primary language subtags ordered by
 * q-value. `hy-AM;q=0.8` becomes `hy`. Invalid entries are skipped.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag: (tag ?? '').trim().toLowerCase(), quality, index };
    })
    .filter((e) => e.tag && e.tag !== '*' && Number.isFinite(e.quality) && e.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((e) => e.tag.split('-')[0]!);
}

/**
 * Chooses the locale for a request without a locale in its path:
 * a remembered manual choice first, then the browser language, then the
 * configured fallback.
 */
export function negotiateLocale(input: {
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (i18nConfig.persistManualSelection && isLocale(input.cookie)) return input.cookie;
  if (i18nConfig.detectBrowserLanguage) {
    for (const lang of parseAcceptLanguage(input.acceptLanguage)) {
      if (isLocale(lang)) return lang;
    }
  }
  return i18nConfig.defaultLocale;
}

/** Replaces (or adds) the locale segment of a pathname. */
export function swapLocaleInPath(pathname: string, next: Locale): string {
  const parts = pathname.split('/');
  if (isLocale(parts[1])) {
    parts[1] = next;
    return parts.join('/') || `/${next}`;
  }
  return `/${next}${pathname === '/' ? '' : pathname}`;
}
