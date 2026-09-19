import { createTranslator, interpolate, translate, translations } from '../src/index';
import { formatAmountOnly, formatMoney, minorToDecimalString } from '../src/format';
import { LOCALES, Locale } from '../src/types';
import { ERROR_CODES_FOR_TEST } from './error-codes.fixture';

describe('locale completeness', () => {
  const sections = Object.keys(translations.en) as Array<keyof typeof translations.en>;

  it('gives every locale exactly the English key set', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(translations[locale]).sort()).toEqual([...sections].sort());
      for (const section of sections) {
        expect(Object.keys(translations[locale][section]).sort()).toEqual(
          Object.keys(translations.en[section]).sort(),
        );
      }
    }
  });

  it('leaves no empty or placeholder-only string', () => {
    for (const locale of LOCALES) {
      for (const section of sections) {
        for (const value of Object.values(translations[locale][section])) {
          expect(typeof value).toBe('string');
          expect(value.trim().length).toBeGreaterThan(0);
          expect(value).not.toMatch(/^TODO/i);
        }
      }
    }
  });

  it('keeps the same interpolation placeholders in every locale', () => {
    for (const section of sections) {
      for (const key of Object.keys(translations.en[section])) {
        const reference = placeholders(
          (translations.en[section] as Record<string, string>)[key] as string,
        );
        for (const locale of LOCALES) {
          const value = (translations[locale][section] as Record<string, string>)[key] as string;
          expect({ locale, section, key, placeholders: placeholders(value) }).toEqual({
            locale,
            section,
            key,
            placeholders: reference,
          });
        }
      }
    }
  });

  it('has a message for every API error code', () => {
    for (const code of ERROR_CODES_FOR_TEST) {
      for (const locale of LOCALES) {
        const message = (translations[locale].errors as Record<string, string>)[code];
        expect(message).toBeDefined();
        expect(message!.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('does not leave Armenian or Russian screens in English', () => {
    expect(translations.hy.home.withdrawCta).not.toBe(translations.en.home.withdrawCta);
    expect(translations.ru.home.withdrawCta).not.toBe(translations.en.home.withdrawCta);
  });
});

describe('translate', () => {
  it('resolves a key in each locale', () => {
    expect(translate('en', 'home.withdrawCta')).toBe('Withdraw');
    expect(translate('ru', 'home.withdrawCta')).toBe('Вывести');
    expect(translate('hy', 'home.withdrawCta')).toBe('Դուրս բերել');
  });

  it('interpolates values', () => {
    expect(translate('en', 'auth.otpSubtitle', { length: 6, phone: '+37411223344' })).toBe(
      'We sent a 6-digit code to +37411223344',
    );
  });

  it('leaves an unknown placeholder visible rather than printing "undefined"', () => {
    expect(interpolate('Hello {{name}}', {})).toBe('Hello {{name}}');
  });

  it('returns the key itself for an unknown key instead of throwing', () => {
    expect(translate('en', 'nope.nothing' as never)).toBe('nope.nothing');
  });

  it('binds a locale', () => {
    const t = createTranslator('ru');
    expect(t('common.cancel')).toBe('Отмена');
  });
});

describe('money formatting', () => {
  it('converts minor units without touching a float', () => {
    expect(minorToDecimalString('123456', 'AMD')).toBe('1234.56');
    expect(minorToDecimalString('-1', 'AMD')).toBe('-0.01');
    expect(minorToDecimalString('5', 'AMD')).toBe('0.05');
    expect(minorToDecimalString('90071992547409930000', 'AMD')).toBe('900719925474099300.00');
  });

  it('keeps full precision for amounts a double could not hold', () => {
    const formatted = formatMoney({ minor: '90071992547409930000', currency: 'AMD' }, 'en');
    expect(formatted).toContain('900,719,925,474,099,300');
  });

  it('hides a zero fraction by default and shows it when asked', () => {
    expect(formatAmountOnly({ minor: '500000', currency: 'AMD' }, 'en')).toBe('5,000');
    expect(
      formatMoney({ minor: '500000', currency: 'AMD' }, 'en', {
        showCurrency: false,
        hideZeroFraction: false,
      }),
    ).toBe('5,000.00');
  });

  it('shows the fraction when it is not zero', () => {
    expect(formatAmountOnly({ minor: '500050', currency: 'AMD' }, 'en')).toBe('5,000.50');
  });

  it('formats per locale', () => {
    for (const locale of LOCALES as readonly Locale[]) {
      const formatted = formatMoney({ minor: '123456', currency: 'AMD' }, locale);
      expect(formatted).toMatch(/1[\s\u00A0\u202F,]?234/);
    }
  });

  it('can force a sign for the ledger view', () => {
    expect(
      formatMoney({ minor: '100000', currency: 'AMD' }, 'en', {
        showCurrency: false,
        signDisplay: 'always',
      }),
    ).toBe('+1,000');
  });
});

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] as string).sort();
}
