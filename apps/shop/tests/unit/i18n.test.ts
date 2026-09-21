import { describe, expect, it } from 'vitest';
import { hy } from '@/lib/i18n/hy';
import { en } from '@/lib/i18n/en';
import { ru } from '@/lib/i18n/ru';
import { fill, getDictionary, isLocale, localizePath, negotiateLocale, LOCALES } from '@/lib/i18n';
import { COLORS, MATERIALS, SPEC_LABELS, specValueLabel } from '@/data/attributes';
import { TAXONOMY, productLeaves, totalSeedProducts } from '@/data/taxonomy';
import { CONTENT_PAGES } from '@/data/content-pages';

const leafKeys = (value: unknown, prefix = ''): string[] => {
  if (typeof value === 'string') return [prefix];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      leafKeys(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
};

describe('dictionaries', () => {
  it('cover exactly the same keys in all three languages', () => {
    const russian = leafKeys(ru).sort();
    expect(leafKeys(hy).sort()).toEqual(russian);
    expect(leafKeys(en).sort()).toEqual(russian);
  });

  it('has no empty or placeholder-looking strings on the UI', () => {
    for (const dictionary of [ru, hy, en]) {
      for (const key of leafKeys(dictionary)) {
        const value = key
          .split('.')
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown>)[part],
            dictionary,
          ) as string;
        expect(value.trim().length).toBeGreaterThan(0);
        // A key leaking into the UI would look like "nav.catalog".
        expect(value).not.toMatch(/^[a-z]+\.[a-zA-Z.]+$/);
      }
    }
  });

  it('keeps the Armenian dictionary actually Armenian where it matters', () => {
    expect(hy.nav.cart).toMatch(/[԰-֏]/);
    expect(hy.checkout.placeOrder).toMatch(/[԰-֏]/);
  });

  it('resolves a dictionary for every supported locale', () => {
    for (const locale of LOCALES) expect(getDictionary(locale).nav.cart.length).toBeGreaterThan(0);
  });
});

describe('locale helpers', () => {
  it('substitutes placeholders', () => {
    expect(fill('Заказ {number} оформлен', { number: 'ORD-1' })).toBe('Заказ ORD-1 оформлен');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(fill('{a} и {b}', { a: '1' })).toBe('1 и {b}');
  });

  it('recognises supported locales only', () => {
    expect(isLocale('ru')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('negotiates from an Accept-Language header', () => {
    expect(negotiateLocale('hy-AM,hy;q=0.9,en;q=0.5')).toBe('hy');
    expect(negotiateLocale('en-GB,en;q=0.9')).toBe('en');
    expect(negotiateLocale(null)).toBe('ru');
  });

  it('swaps the locale segment while keeping the rest of the path', () => {
    expect(localizePath('/ru/catalog/sofas?color=grey', 'hy')).toBe('/hy/catalog/sofas?color=grey');
    expect(localizePath('/catalog', 'en')).toBe('/en/catalog');
  });
});

describe('catalogue vocabulary', () => {
  it('translates every colour and material into all three languages', () => {
    for (const [key, color] of Object.entries(COLORS)) {
      for (const locale of LOCALES) expect(color.label[locale], key).toBeTruthy();
      expect(color.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    for (const [key, material] of Object.entries(MATERIALS)) {
      for (const locale of LOCALES) expect(material.label[locale], key).toBeTruthy();
    }
  });

  it('renders booleans as words, not as true/false', () => {
    expect(specValueLabel('linenBox', true, 'ru')).toBe('Есть');
    expect(specValueLabel('linenBox', false, 'hy')).toBe('Ոչ');
  });

  it('falls back to the raw value for free-form specs', () => {
    expect(specValueLabel('mattressSize', '1600 × 2000 мм', 'ru')).toBe('1600 × 2000 мм');
  });

  it('has a label for every spec key the seed can produce', () => {
    for (const key of ['mechanism', 'coating', 'openingSide', 'kitchenLength', 'maxLoad']) {
      expect(SPEC_LABELS[key]).toBeDefined();
    }
  });
});

describe('taxonomy', () => {
  it('has 16 root categories without windows', () => {
    expect(TAXONOMY).toHaveLength(16);
    expect(TAXONOMY.some((root) => /window|окн/i.test(root.slug))).toBe(false);
  });

  it('plans between 250 and 300 demo products', () => {
    expect(totalSeedProducts()).toBeGreaterThanOrEqual(250);
    expect(totalSeedProducts()).toBeLessThanOrEqual(300);
  });

  it('gives every product-bearing leaf a name in all three languages', () => {
    for (const { node } of productLeaves()) {
      for (const locale of LOCALES) expect(node.names[locale], node.slug).toBeTruthy();
    }
  });
});

describe('content pages', () => {
  it('translates every page and section into all three languages', () => {
    for (const page of CONTENT_PAGES) {
      for (const locale of LOCALES) {
        expect(page.title[locale], page.slug).toBeTruthy();
        expect(page.intro[locale], page.slug).toBeTruthy();
        for (const section of page.sections) {
          expect(section.heading[locale]).toBeTruthy();
          for (const paragraph of section.body) expect(paragraph[locale]).toBeTruthy();
        }
      }
    }
  });

  it('marks the legally sensitive pages so they render a demo disclaimer', () => {
    for (const slug of ['privacy', 'terms', 'offer']) {
      expect(CONTENT_PAGES.find((page) => page.slug === slug)?.legal).toBe(true);
    }
  });
});
