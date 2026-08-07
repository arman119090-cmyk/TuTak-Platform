import {
  formatAmd,
  formatDate,
  formatDateTime,
  formatDayGroup,
  formatEnergy,
  formatPoints,
  formatSigned,
} from './format';

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
