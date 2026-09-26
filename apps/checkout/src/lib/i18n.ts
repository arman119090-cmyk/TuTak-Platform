import { DEFAULT_LOCALE, i18nResources, isSupportedLocale, type SupportedLocale } from '@tutak/i18n';

/**
 * The same hy/ru/en resources the mobile app uses (`@tutak/i18n`), so the
 * checkout says exactly what the app says — the web checkout only adds its
 * own sign-in strings (partnerOrder.web*).
 */
export function translate(locale: SupportedLocale, key: string, params: Record<string, string | number> = {}): string {
  const walk = (tree: unknown): string | undefined => {
    let node: unknown = tree;
    for (const part of key.split('.')) {
      if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) node = (node as Record<string, unknown>)[part];
      else return undefined;
    }
    return typeof node === 'string' ? node : undefined;
  };
  const raw = walk(i18nResources[locale].translation) ?? walk(i18nResources.en.translation) ?? key;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, name: string) => (name in params ? String(params[name]) : ''));
}

export function pickLocale(requested: string | null | undefined, browser: readonly string[] = []): SupportedLocale {
  if (requested && isSupportedLocale(requested)) return requested;
  for (const tag of browser) {
    const short = tag.slice(0, 2).toLowerCase();
    if (isSupportedLocale(short)) return short;
  }
  return DEFAULT_LOCALE;
}

export type { SupportedLocale };
