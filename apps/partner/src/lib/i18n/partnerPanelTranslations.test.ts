import { i18nResources, SUPPORTED_LOCALES } from '@tutak/i18n';

/**
 * The partner panel says the same things in all three languages.
 *
 * A key present in one bundle and missing from another does not fail
 * loudly: i18next falls back to Armenian, and the screen quietly shows one
 * sentence in a language the rest of the page is not in. That is the kind
 * of defect nobody reports and everybody notices, so it is a test.
 *
 * Empty strings are refused as well as missing ones. A key whose value is
 * `""` passes a "does the key exist" check and renders as a blank label.
 */
type Leaves = Record<string, string>;

function flatten(value: unknown, prefix = ''): Leaves {
  if (typeof value === 'string') return { [prefix]: value };
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as Record<string, unknown>).reduce<Leaves>((acc, [key, child]) => {
    return { ...acc, ...flatten(child, prefix ? `${prefix}.${key}` : key) };
  }, {});
}

const bundles = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [
    locale,
    flatten(
      (i18nResources[locale].translation as Record<string, unknown>).partnerPanel ?? {},
      'partnerPanel',
    ),
  ]),
) as Record<(typeof SUPPORTED_LOCALES)[number], Leaves>;

describe('partner panel translations', () => {
  it('has the section at all, in every language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(bundles[locale]).length).toBeGreaterThan(50);
    }
  });

  it('has exactly the same keys in every language', () => {
    const reference = Object.keys(bundles.hy).sort();
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(bundles[locale]).sort()).toEqual(reference);
    }
  });

  it('has no blank value anywhere', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const blank = Object.entries(bundles[locale])
        .filter(([, value]) => value.trim().length === 0)
        .map(([key]) => key);
      expect(blank).toEqual([]);
    }
  });

  it('keeps every interpolation placeholder in every language', () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

    for (const [key, armenian] of Object.entries(bundles.hy)) {
      const expected = placeholders(armenian);
      for (const locale of SUPPORTED_LOCALES) {
        // A translation that drops `{{amount}}` renders a sentence about a
        // figure with the figure missing, and nothing throws.
        expect({ key, locale, placeholders: placeholders(bundles[locale][key]) }).toEqual({
          key,
          locale,
          placeholders: expected,
        });
      }
    }
  });

  it('actually translates: the three languages are not the same strings', () => {
    const sample = 'partnerPanel.settlements.stateOwedToYou';
    expect(bundles.ru[sample]).not.toBe(bundles.en[sample]);
    expect(bundles.hy[sample]).not.toBe(bundles.en[sample]);
    expect(bundles.hy[sample]).not.toBe(bundles.ru[sample]);
  });
});
