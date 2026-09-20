import { formatMinor, formatMoney, percentFromPpm, relativeAge } from '../lib/format';

describe('operator-facing formatting', () => {
  it('renders minor units without ever parsing them as a float', () => {
    expect(formatMinor('123456789', 'AMD')).toBe('1 234 567.89 AMD');
    expect(formatMinor('5', 'AMD')).toBe('0.05 AMD');
    expect(formatMinor('-250000', 'AMD')).toBe('−2 500.00 AMD');
    expect(formatMinor('9007199254740993', 'AMD')).toBe('90 071 992 547 409.93 AMD');
    expect(formatMoney({ minor: '100', currency: 'USD' })).toBe('1.00 USD');
  });

  it('shows a part-per-million rate as a percentage', () => {
    expect(percentFromPpm(15_000)).toBe('1.50%');
    expect(percentFromPpm(0)).toBe('0.00%');
  });

  it('describes age relative to now, and a missing timestamp as a dash', () => {
    expect(relativeAge(null)).toBe('—');
    expect(relativeAge(new Date(Date.now() - 30_000).toISOString())).toMatch(/^\d+s ago$/);
    expect(relativeAge(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('3h ago');
  });
});
