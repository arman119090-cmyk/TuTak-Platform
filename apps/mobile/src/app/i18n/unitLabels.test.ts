import { i18nResources, SUPPORTED_LOCALES, UNIT_OF_MEASURE_KEYS, unitLabelKey } from '@tutak/i18n';

/**
 * Every unit the financial schema can hold has a label in every locale.
 *
 * A missing label is not cosmetic here: the cashier confirming "50 × 300"
 * reads the unit off the screen, and a screen showing `LITER` because a
 * translation was missed is a screen that trains people to ignore it.
 */
describe('unit of measure labels', () => {
  it.each(SUPPORTED_LOCALES)('%s labels every unit', (locale) => {
    const bundle = i18nResources[locale].translation as Record<string, unknown>;
    const labels = bundle.unitOfMeasure as Record<string, string> | undefined;
    expect(labels).toBeDefined();

    for (const unit of UNIT_OF_MEASURE_KEYS) {
      expect(labels?.[unit]).toBeTruthy();
    }
  });

  it('keys them by the enum value, not by the label', () => {
    // The key is the financial identifier. If this ever became the label,
    // the two would drift and a lookup would silently fall back to the key.
    expect(unitLabelKey('LITER')).toBe('unitOfMeasure.LITER');
  });

  it('has no label the schema cannot produce', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const bundle = i18nResources[locale].translation as Record<string, unknown>;
      const labels = Object.keys(bundle.unitOfMeasure as Record<string, string>);
      expect(labels.sort()).toEqual([...UNIT_OF_MEASURE_KEYS].sort());
    }
  });
});
