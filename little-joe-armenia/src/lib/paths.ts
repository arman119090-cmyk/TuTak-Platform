import type { Locale } from "@/i18n/config";

// Canonical storefront URL builders. Clean, indexable paths:
//   /{locale}                     home
//   /{locale}/shop                catalog (filtered variants are noindex)
//   /{locale}/c/{collection}      collection
//   /{locale}/scents/{family}     fragrance family
//   /{locale}/p/{product}         product
export const paths = {
  home: (l: Locale) => `/${l}`,
  shop: (l: Locale, query?: string) => `/${l}/shop${query ? `?${query}` : ""}`,
  collection: (l: Locale, slug: string) => `/${l}/c/${slug}`,
  family: (l: Locale, slug: string) => `/${l}/scents/${slug}`,
  product: (l: Locale, slug: string) => `/${l}/p/${slug}`,
  finder: (l: Locale) => `/${l}/scent-finder`,
  compare: (l: Locale, ids?: string[]) => `/${l}/compare${ids && ids.length ? `?ids=${ids.join(",")}` : ""}`,
  favorites: (l: Locale) => `/${l}/favorites`,
  cart: (l: Locale) => `/${l}/cart`,
  checkout: (l: Locale) => `/${l}/checkout`,
  order: (l: Locale, number: string, token?: string) => `/${l}/order/${number}${token ? `?t=${encodeURIComponent(token)}` : ""}`,
  account: (l: Locale) => `/${l}/account`,
  signIn: (l: Locale) => `/${l}/account/sign-in`,
  page: (l: Locale, slug: string) => `/${l}/info/${slug}`,
};
