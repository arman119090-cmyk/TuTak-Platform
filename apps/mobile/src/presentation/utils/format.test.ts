import {
  formatAmd,
  formatDate,
  formatDateTime,
  formatDayGroup,
  formatEnergy,
  formatPoints,
  formatSigned,
} from './format';
import i18n from '../../app/i18n/i18n';

describe('formatPoints', () => {
  it('drops decimals for a whole number', () => {
    expect(formatPoints(3000)).toBe('3 000');
  });

  it('keeps up to two decimals for a fractional amount', () => {
    expect(formatPoints(1234.5)).toBe('1 234.5');
  });

  it('parses a numeric string', () => {
    expect(formatPoints('2500')).toBe('2 500');
  });

  it('falls back to "0" for a non-finite value', () => {
    expect(formatPoints('not-a-number')).toBe('0');
    expect(formatPoints(Infinity)).toBe('0');
  });

  it('groups large numbers with a narrow space, not a comma', () => {
    expect(formatPoints(1234567)).toBe('1 234 567');
  });
});

describe('formatAmd', () => {
  it('appends the dram sign', () => {
    expect(formatAmd(10000)).toBe('10 000 ֏');
  });

  it('falls back to "0 ֏" for a non-finite value', () => {
    expect(formatAmd(NaN)).toBe('0 ֏');
  });
});

describe('formatSigned', () => {
  it('prefixes a positive amount with +', () => {
    expect(formatSigned(500, 'points')).toBe('+500');
  });

  it('prefixes a negative amount with the minus sign and shows the absolute value', () => {
    expect(formatSigned(-500, 'points')).toBe('−500');
  });

  it('formats a negative AMD amount with the currency sign', () => {
    expect(formatSigned('-10000', 'amd')).toBe('−10 000 ֏');
  });

  it('treats zero as positive', () => {
    expect(formatSigned(0)).toBe('+0');
  });
});

describe('formatDate / formatDateTime', () => {
  it('formats an ISO string into a short date', () => {
    // Any valid ISO date round-trips through Date without throwing; the exact
    // locale rendering is Intl's job, not this module's.
    expect(() => formatDate('2026-08-07T12:00:00.000Z')).not.toThrow();
    expect(formatDate('2026-08-07T12:00:00.000Z')).toEqual(expect.any(String));
  });

  it('formats an ISO string into a date and time', () => {
    expect(formatDateTime('2026-08-07T12:00:00.000Z')).toEqual(expect.any(String));
  });
});

describe('formatDayGroup', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('labels today as "Today"', () => {
    expect(formatDayGroup(new Date().toISOString())).toBe('Today');
  });

  it('labels yesterday as "Yesterday"', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatDayGroup(yesterday.toISOString())).toBe('Yesterday');
  });

  it('falls back to a formatted date for anything older', () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const result = formatDayGroup(lastMonth.toISOString());
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Yesterday');
  });
});

describe('formatEnergy', () => {
  it('appends kWh', () => {
    expect(formatEnergy(12.5)).toBe('12.5 kWh');
  });

  it('falls back to "0 kWh" for a non-finite value', () => {
    expect(formatEnergy('n/a')).toBe('0 kWh');
  });
});

describe('dates follow the interface language', () => {
  const iso = '2026-09-19T11:52:00.000Z';
  const expected = (locale: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options).format(new Date(iso));

  afterEach(async () => {
    await i18n.changeLanguage('ru');
  });

  it.each(['ru', 'hy', 'en'])('formatDate renders %s month names, not the OS locale', async (locale) => {
    await i18n.changeLanguage(locale);
    const out = formatDate(iso);
    expect(out).toBe(expected(locale, { day: 'numeric', month: 'short', year: 'numeric' }));
    expect(out).toContain('2026');
  });

  it('uses three different month spellings for the three languages', async () => {
    const seen = new Set<string>();
    for (const locale of ['ru', 'hy', 'en']) {
      await i18n.changeLanguage(locale);
      seen.add(formatDate(iso));
    }
    expect(seen.size).toBe(3);
  });

  it.each(['ru', 'hy', 'en'])('formatDateTime keeps a 24-hour clock in %s', async (locale) => {
    await i18n.changeLanguage(locale);
    expect(formatDateTime(iso)).toBe(
      expected(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }),
    );
    expect(formatDateTime(iso)).not.toMatch(/AM|PM/);
  });

  it.each([
    ['ru', 'Сегодня', 'Вчера'],
    ['hy', 'Այսօր', 'Երեկ'],
    ['en', 'Today', 'Yesterday'],
  ])('formatDayGroup says today/yesterday in %s', async (locale, today, yesterday) => {
    await i18n.changeLanguage(locale);
    const now = new Date();
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    expect(formatDayGroup(now.toISOString())).toBe(today);
    expect(formatDayGroup(y.toISOString())).toBe(yesterday);
  });

  it('never throws on a bad date', () => {
    expect(formatDate('not a date')).toBe('');
  });

  it('prints Armenian by hand, letter for letter as ICU would, on a runtime without Armenian data', async () => {
    await i18n.changeLanguage('hy');
    const icu = (options: Intl.DateTimeFormatOptions, date: Date) => new Intl.DateTimeFormat('hy', options).format(date);
    const dates = Array.from({ length: 12 }, (_, month) => new Date(2026, month, 17, 12, 5));
    const withIcu = dates.map((d) => [icu({ day: 'numeric', month: 'short', year: 'numeric' }, d), icu({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }, d)]);

    // The Playwright Chromium the web demo runs in: `supportedLocalesOf(['hy'])` is [] and
    // `format` silently answers in English. Simulate exactly that.
    const supported = jest.spyOn(Intl.DateTimeFormat, 'supportedLocalesOf').mockReturnValue([]);
    try {
      const byHand = dates.map((d) => [formatDate(d.toISOString()), formatDateTime(d.toISOString())]);
      expect(byHand).toEqual(withIcu);
    } finally {
      supported.mockRestore();
    }
  });
});
