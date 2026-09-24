import { describe, expect, it } from 'vitest';
import { negotiateLocale, parseAcceptLanguage, swapLocaleInPath } from '@/i18n/negotiate';

describe('parseAcceptLanguage', () => {
  it('orders by q and strips regions', () => {
    expect(parseAcceptLanguage('en-US;q=0.5, hy-AM, ru;q=0.8')).toEqual(['hy', 'ru', 'en']);
  });
  it('ignores junk, wildcards and q=0', () => {
    expect(parseAcceptLanguage('*, de;q=0, ;q=1, fr;q=abc, it')).toEqual(['it']);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });
});

describe('negotiateLocale', () => {
  it('prefers the remembered manual choice', () => {
    expect(negotiateLocale({ cookie: 'hy', acceptLanguage: 'de' })).toBe('hy');
  });
  it('ignores an invalid cookie and uses the browser language', () => {
    expect(negotiateLocale({ cookie: 'xx', acceptLanguage: 'ja, fr-CA;q=0.9' })).toBe('fr');
  });
  it('falls back to English', () => {
    expect(negotiateLocale({ acceptLanguage: 'ja, zh' })).toBe('en');
    expect(negotiateLocale({})).toBe('en');
  });
});

describe('swapLocaleInPath', () => {
  it('replaces the locale segment and keeps the rest', () => {
    expect(swapLocaleInPath('/en/artworks/aknuni', 'hy')).toBe('/hy/artworks/aknuni');
    expect(swapLocaleInPath('/ru', 'de')).toBe('/de');
  });
  it('adds a locale to a bare path', () => {
    expect(swapLocaleInPath('/', 'it')).toBe('/it');
    expect(swapLocaleInPath('/about', 'fr')).toBe('/fr/about');
  });
});
