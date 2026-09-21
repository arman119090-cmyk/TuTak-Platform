/**
 * Single source of truth for everything white-label about the store.
 *
 * The name, contacts, palette and domain are configuration: change the env vars
 * (or these defaults) and the header, footer, contacts page, metadata, Open
 * Graph tags, JSON-LD and generated artwork all follow. No component hard-codes
 * the brand, and nothing technical (cookies, storage keys, container names)
 * carries it either — so a rename never becomes a migration.
 */

export type Phone = {
  /** As printed on the site. */
  display: string;
  /** Digits only, for tel: and messenger links. */
  dial: string;
};

export type BrandContacts = {
  phones: Phone[];
  email: string;
  whatsapp: string;
  telegram: string;
  instagram: string;
};

const env = (key: string, fallback: string): string => {
  const value = process.env[key];
  return value && value.length > 0 ? value : fallback;
};

/**
 * Accepts an Armenian number in any of the usual shapes — `091200009`,
 * `+37491200009`, `+374 91 200009` — and returns both the printed and the
 * dialable form, so the env var can be filled in however is convenient.
 */
export const parsePhone = (input: string): Phone => {
  const digits = input.replace(/\D/g, '');
  const national = digits.startsWith('374')
    ? digits.slice(3)
    : digits.startsWith('0')
      ? digits.slice(1)
      : digits;
  if (national.length !== 8) return { display: input, dial: `+${digits}` };
  const operator = national.slice(0, 2);
  const number = national.slice(2);
  return { display: `+374 ${operator} ${number}`, dial: `+374${national}` };
};

const phones = [
  env('NEXT_PUBLIC_BRAND_PHONE', '091200009'),
  env('NEXT_PUBLIC_BRAND_PHONE_SECONDARY', '095200003'),
]
  .filter((value) => value.trim().length > 0)
  .map(parsePhone);

const baseName = env('NEXT_PUBLIC_BRAND_NAME', 'Hoviki Mebel');

/**
 * The shop name per language.
 *
 * An Armenian shop often writes its name in Armenian letters for local
 * customers and in Latin for everyone else, so the name is a translation like
 * any other string. Leave a locale's variable empty and it falls back to the
 * base name, which keeps a single Latin wordmark everywhere.
 */
const localizedNames = {
  hy: env('NEXT_PUBLIC_BRAND_NAME_HY', 'Հովիկի Մեբել') || baseName,
  ru: env('NEXT_PUBLIC_BRAND_NAME_RU', 'Ховики Мебель') || baseName,
  en: env('NEXT_PUBLIC_BRAND_NAME_EN', 'Hoviki Mebel') || baseName,
} as const;

export const brand = {
  name: baseName,
  names: localizedNames,
  legalName: env('NEXT_PUBLIC_BRAND_LEGAL_NAME', baseName),
  /**
   * Public address of the deployment. `SITE_URL` is read at runtime, so a
   * hosting provider that only learns the address after the first deploy can
   * set it without rebuilding the image; it is only ever read on the server
   * (metadata, robots.txt, sitemap, JSON-LD), never in the browser bundle.
   */
  domain: env('SITE_URL', env('NEXT_PUBLIC_SITE_URL', 'http://localhost:3100')),
  /// Short brand mark used by the logo lockup and the generated artwork.
  monogram: env('NEXT_PUBLIC_BRAND_MONOGRAM', 'H'),
  tagline: {
    hy: env('NEXT_PUBLIC_BRAND_TAGLINE_HY', 'Կահույք իրական կյանքի համար'),
    ru: env('NEXT_PUBLIC_BRAND_TAGLINE_RU', 'Мебель для настоящей жизни'),
    en: env('NEXT_PUBLIC_BRAND_TAGLINE_EN', 'Furniture for real life'),
  },
  contacts: {
    phones,
    email: env('NEXT_PUBLIC_BRAND_EMAIL', 'info@hoviki-mebel.demo'),
    whatsapp: env('NEXT_PUBLIC_BRAND_WHATSAPP', phones[0]?.dial ?? ''),
    telegram: env('NEXT_PUBLIC_BRAND_TELEGRAM', 'hoviki_mebel'),
    instagram: env('NEXT_PUBLIC_BRAND_INSTAGRAM', 'hoviki.mebel'),
  } satisfies BrandContacts,
  address: {
    hy: env('NEXT_PUBLIC_BRAND_ADDRESS_HY', 'Երևան, Մաշտոցի պող. 42'),
    ru: env('NEXT_PUBLIC_BRAND_ADDRESS_RU', 'Ереван, пр. Маштоца 42'),
    en: env('NEXT_PUBLIC_BRAND_ADDRESS_EN', 'Yerevan, 42 Mashtots Ave'),
  },
  /// Showroom opening hours, shown in the footer and on the contacts page.
  hours: { weekdays: '10:00 — 20:00', weekend: '11:00 — 18:00' },
} as const;

/** The shop name as written in the given language. */
export const brandName = (locale: 'hy' | 'ru' | 'en'): string => brand.names[locale];

/** The number used wherever a single phone has to be shown. */
export const primaryPhone: Phone = brand.contacts.phones[0] ?? {
  display: '',
  dial: '',
};

export const isDemoMode = env('NEXT_PUBLIC_DEMO_MODE', '1') === '1';

export const siteUrl = brand.domain.replace(/\/$/, '');

/** Demo credentials surfaced in the UI — only ever when demo mode is on. */
export const demoCredentials = {
  customer: { email: 'demo@furniture.local', password: 'demo1234' },
  admin: { email: 'admin@furniture.local', password: 'admin1234' },
  otp: '111111',
} as const;
