/**
 * Single source of truth for everything white-label about the store.
 *
 * The demo ships as "ORNATA", but the name, palette, contacts and domain are
 * configuration: change the env vars (or this file's defaults) and the header,
 * footer, metadata, Open Graph tags, JSON-LD and generated artwork follow.
 * No component hard-codes the brand.
 */

export type BrandContacts = {
  phone: string;
  email: string;
  whatsapp: string;
  telegram: string;
  instagram: string;
};

const env = (key: string, fallback: string): string => {
  const value = process.env[key];
  return value && value.length > 0 ? value : fallback;
};

export const brand = {
  name: env('NEXT_PUBLIC_BRAND_NAME', 'ORNATA'),
  legalName: env('NEXT_PUBLIC_BRAND_LEGAL_NAME', 'ORNATA Home LLC'),
  domain: env('NEXT_PUBLIC_SITE_URL', 'http://localhost:3100'),
  /// Short brand mark used by the logo lockup and the generated artwork.
  monogram: env('NEXT_PUBLIC_BRAND_MONOGRAM', 'O'),
  tagline: {
    hy: env('NEXT_PUBLIC_BRAND_TAGLINE_HY', 'Կահույք իրական կյանքի համար'),
    ru: env('NEXT_PUBLIC_BRAND_TAGLINE_RU', 'Мебель для настоящей жизни'),
    en: env('NEXT_PUBLIC_BRAND_TAGLINE_EN', 'Furniture for real life'),
  },
  contacts: {
    phone: env('NEXT_PUBLIC_BRAND_PHONE', '+374 10 000 000'),
    email: env('NEXT_PUBLIC_BRAND_EMAIL', 'hello@ornata.demo'),
    whatsapp: env('NEXT_PUBLIC_BRAND_WHATSAPP', '+37410000000'),
    telegram: env('NEXT_PUBLIC_BRAND_TELEGRAM', 'ornata_demo'),
    instagram: env('NEXT_PUBLIC_BRAND_INSTAGRAM', 'ornata.demo'),
  } satisfies BrandContacts,
  address: {
    hy: env('NEXT_PUBLIC_BRAND_ADDRESS_HY', 'Երևան, Մաշտոցի պող. 42'),
    ru: env('NEXT_PUBLIC_BRAND_ADDRESS_RU', 'Ереван, пр. Маштоца 42'),
    en: env('NEXT_PUBLIC_BRAND_ADDRESS_EN', 'Yerevan, 42 Mashtots Ave'),
  },
  /// Showroom opening hours, shown in the footer and on the contacts page.
  hours: { weekdays: '10:00 — 20:00', weekend: '11:00 — 18:00' },
} as const;

export const isDemoMode = env('NEXT_PUBLIC_DEMO_MODE', '1') === '1';

export const siteUrl = brand.domain.replace(/\/$/, '');

/** Demo credentials surfaced in the UI — only ever when demo mode is on. */
export const demoCredentials = {
  customer: { email: 'demo@furniture.local', password: 'demo1234' },
  admin: { email: 'admin@furniture.local', password: 'admin1234' },
  otp: '111111',
} as const;
