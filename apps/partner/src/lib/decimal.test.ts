import { decimalEquals, multiplyExact, normalizeDecimal } from './decimal';

describe('exact decimals for the till check', () => {
  it('multiplies without floating-point drift', () => {
    expect(multiplyExact('33.3000', '480.0000')).toBe('15984.00000000');
    expect(decimalEquals(multiplyExact('33.3', '480')!, '15984.0000')).toBe(true);
    expect(decimalEquals(multiplyExact('1.1', '3')!, '3.3')).toBe(true);
  });

  it('still notices a genuinely different total', () => {
    expect(decimalEquals(multiplyExact('33.3', '480')!, '15985')).toBe(false);
  });

  it('reads a comma as the decimal separator and refuses anything else', () => {
    expect(normalizeDecimal(' 12,5 ')).toBe('12.5');
    expect(normalizeDecimal('1 250')).toBe('1250');
    expect(normalizeDecimal('12.5.1')).toBeNull();
    expect(normalizeDecimal('-3')).toBeNull();
    expect(normalizeDecimal('')).toBeNull();
    expect(multiplyExact('abc', '2')).toBeNull();
  });
});
