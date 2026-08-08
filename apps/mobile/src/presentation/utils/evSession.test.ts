import { estimateSessionCost, formatElapsed } from './evSession';

describe('formatElapsed', () => {
  const start = '2026-08-08T10:00:00.000Z';
  const at = (seconds: number) => new Date(start).getTime() + seconds * 1000;

  it('shows minutes and seconds for a short session', () => {
    expect(formatElapsed(start, at(0))).toBe('00:00');
    expect(formatElapsed(start, at(9))).toBe('00:09');
    expect(formatElapsed(start, at(75))).toBe('01:15');
    expect(formatElapsed(start, at(3599))).toBe('59:59');
  });

  it('adds an hours field once the session passes an hour', () => {
    expect(formatElapsed(start, at(3600))).toBe('1:00:00');
    expect(formatElapsed(start, at(3661))).toBe('1:01:01');
    expect(formatElapsed(start, at(36000))).toBe('10:00:00');
  });

  it('never counts backwards when the phone clock is behind the server', () => {
    // A device a few seconds slow would otherwise render "-1:-5".
    expect(formatElapsed(start, at(-30))).toBe('00:00');
  });

  it('degrades to a dash rather than NaN on an unparseable timestamp', () => {
    expect(formatElapsed('not a date', Date.now())).toBe('—');
  });
});

describe('estimateSessionCost', () => {
  it('multiplies delivered energy by the connector price', () => {
    expect(estimateSessionCost('12.5', '95')).toBe(1187.5);
  });

  it('treats a session with no reading yet as costing nothing', () => {
    expect(estimateSessionCost(null, '95')).toBe(0);
    expect(estimateSessionCost('0', '95')).toBe(0);
  });

  it('returns null when there is no price, rather than guessing zero', () => {
    // A session whose connector was not joined into the response has no
    // price. Showing "0 ֏" there would read as free.
    expect(estimateSessionCost('12.5', null)).toBeNull();
    expect(estimateSessionCost('12.5', undefined)).toBeNull();
    expect(estimateSessionCost('12.5', '')).toBeNull();
  });

  it('returns null on values that are not numbers', () => {
    expect(estimateSessionCost('abc', '95')).toBeNull();
    expect(estimateSessionCost('12.5', 'free')).toBeNull();
  });
});
