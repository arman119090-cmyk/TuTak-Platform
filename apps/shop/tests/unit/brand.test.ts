import { describe, expect, it } from 'vitest';
import { brand, brandName, parsePhone, primaryPhone, siteUrl } from '@/config/brand';

/**
 * The brand is configuration, so these tests pin the contract the rest of the
 * app relies on: a name, at least one dialable phone, and normalisation that
 * accepts a number written the way a shop owner would actually type it.
 */
describe('brand configuration', () => {
  it('exposes a name and a monogram for the logo lockup', () => {
    expect(brand.name.trim().length).toBeGreaterThan(0);
    expect(brand.monogram.length).toBeGreaterThan(0);
  });

  it('has at least one phone, and a primary that can be dialled', () => {
    expect(brand.contacts.phones.length).toBeGreaterThan(0);
    expect(primaryPhone.dial).toMatch(/^\+374\d{8}$/);
  });

  it('keeps every configured phone dialable', () => {
    for (const phone of brand.contacts.phones) {
      expect(phone.dial, phone.display).toMatch(/^\+374\d{8}$/);
      expect(phone.display.length).toBeGreaterThan(0);
    }
  });

  it('normalises the local, international and spaced forms to one number', () => {
    const local = parsePhone('091200009');
    const international = parsePhone('+37491200009');
    const spaced = parsePhone('+374 91 200009');
    expect(local.dial).toBe('+37491200009');
    expect(international.dial).toBe(local.dial);
    expect(spaced.dial).toBe(local.dial);
    expect(local.display).toBe('+374 91 200009');
  });

  it('leaves an unrecognisable number visible instead of mangling it', () => {
    const odd = parsePhone('123');
    expect(odd.display).toBe('123');
  });

  it('gives the name in each of the three languages', () => {
    for (const locale of ['hy', 'ru', 'en'] as const) {
      expect(brandName(locale).trim().length).toBeGreaterThan(0);
    }
    expect(brandName('hy')).toBe(brand.names.hy);
    expect(brandName('ru')).toBe(brand.names.ru);
    expect(brandName('en')).toBe(brand.names.en);
  });

  // Only the shipped defaults are script-checked: an owner is free to override
  // the variables with one Latin wordmark for all three languages.
  it('writes the default Armenian and Russian names in their own scripts', () => {
    if (!process.env.NEXT_PUBLIC_BRAND_NAME_HY) {
      expect(brandName('hy')).toMatch(/\p{Script=Armenian}/u);
    }
    if (!process.env.NEXT_PUBLIC_BRAND_NAME_RU) {
      expect(brandName('ru')).toMatch(/\p{Script=Cyrillic}/u);
    }
    if (!process.env.NEXT_PUBLIC_BRAND_NAME_EN) {
      expect(brandName('en')).toMatch(/^[\p{Script=Latin}\s.'-]+$/u);
    }
  });

  it('drops the trailing slash from the site URL so canonicals do not double it', () => {
    expect(siteUrl.endsWith('/')).toBe(false);
  });
});
