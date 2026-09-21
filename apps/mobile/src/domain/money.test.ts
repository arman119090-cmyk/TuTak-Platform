import { compare, moneyToString, parseMoney, percentOfFloor, subtract } from './money';

describe('money', () => {
  it('parses what people type and keeps four decimals exactly', () => {
    expect(moneyToString(parseMoney('1500')!)).toBe('1500.0000');
    expect(moneyToString(parseMoney('4999.9999')!)).toBe('4999.9999');
    expect(moneyToString(parseMoney('12,5')!)).toBe('12.5000');
    expect(moneyToString(parseMoney(' 7 ')!)).toBe('7.0000');
  });

  it('refuses what is not an amount rather than guessing', () => {
    for (const bad of ['', '-1', '1.23456', 'abc', '1e3', '1.', '.5']) {
      expect(parseMoney(bad)).toBeNull();
    }
  });

  it('does not lose a ten-thousandth the way Number does', () => {
    const gross = parseMoney('0.3')!;
    const bonus = parseMoney('0.1')!;
    expect(moneyToString(subtract(gross, bonus))).toBe('0.2000');
    // The same difference in floating point is 0.19999999999999998.
    expect(Number('0.3') - Number('0.1')).not.toBe(0.2);
    expect(moneyToString(subtract(parseMoney('4999.9999')!, parseMoney('0.0001')!))).toBe('4999.9998');
  });

  it('compares and never hides a negative remainder', () => {
    const gross = parseMoney('1000')!;
    const bonus = parseMoney('1200')!;
    expect(compare(subtract(gross, bonus), 0n)).toBe(-1);
    expect(moneyToString(subtract(gross, bonus))).toBe('-200.0000');
  });

  it('rounds a percentage ceiling down, never up', () => {
    expect(moneyToString(percentOfFloor(parseMoney('333.3333')!, 50))).toBe('166.6666');
    expect(moneyToString(percentOfFloor(parseMoney('1000')!, 30))).toBe('300.0000');
  });
});
