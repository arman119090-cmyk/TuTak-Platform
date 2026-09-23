// Locale configuration. Every public URL is locale-prefixed:
//   /hy/…  /ru/…  /it/…  /en/…
// "/" redirects to the visitor's saved or negotiated locale (default hy).
// x-default hreflang points to /hy. See docs/ARCHITECTURE.md §i18n.

export const locales = ["hy", "ru", "it", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "hy";
export const LOCALE_COOKIE = "lj_locale";

export const localeNames: Record<Locale, string> = {
  hy: "Հայերեն",
  ru: "Русский",
  it: "Italiano",
  en: "English",
};

// BCP-47 tags for Intl and <html lang>.
export const localeTags: Record<Locale, string> = {
  hy: "hy-AM",
  ru: "ru-AM",
  it: "it-IT",
  en: "en-AM",
};

export const ogLocales: Record<Locale, string> = {
  hy: "hy_AM",
  ru: "ru_RU",
  it: "it_IT",
  en: "en_US",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Picks the best supported locale from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale;
  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return defaultLocale;
}
