import { translations, LOCALES } from '@cashout/i18n';

/**
 * Armenian words run long. The components that cannot wrap — the five bottom
 * tabs, the segmented control, the status pills — get a length budget here,
 * so a translation that would truncate fails a test rather than a screen.
 */
const TAB_BUDGET = 14;
const SEGMENT_BUDGET = 16;
const PILL_BUDGET = 22;

describe('layout-sensitive strings fit in every language', () => {
  it.each(LOCALES)('bottom tabs in %s', (locale) => {
    for (const label of Object.values(translations[locale].tabs)) {
      expect({ locale, label, fits: label.length <= TAB_BUDGET }).toEqual({
        locale,
        label,
        fits: true,
      });
    }
  });

  it.each(LOCALES)('history period segments in %s', (locale) => {
    // Appearance and language are Radio rows, which wrap; only the segmented
    // control, which cannot, is budgeted here.
    const segments = [
      translations[locale].history.period7d,
      translations[locale].history.period30d,
      translations[locale].history.periodAll,
    ];
    for (const label of segments) expect(label.length).toBeLessThanOrEqual(SEGMENT_BUDGET);
  });

  it.each(LOCALES)('status pills in %s', (locale) => {
    const pills = [
      translations[locale].history.userCompleted,
      translations[locale].history.userProcessing,
      translations[locale].history.userCancelled,
      translations[locale].history.userRejected,
      translations[locale].park.active,
      translations[locale].park.unavailable,
      translations[locale].park.suspended,
      translations[locale].park.ineligible,
      translations[locale].park.pendingReview,
    ];
    for (const label of pills) expect(label.length).toBeLessThanOrEqual(PILL_BUDGET);
  });

  it('Armenian tab labels are not cut to English', () => {
    for (const label of Object.values(translations.hy.tabs)) {
      expect(label).toMatch(/[԰-֏]/);
    }
  });
});
