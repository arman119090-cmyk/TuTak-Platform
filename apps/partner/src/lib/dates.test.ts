import { localDay, utcDay } from './dates';

describe('panel dates', () => {
  it('dates a night sale by the day it happened in Yerevan, not in UTC', () => {
    // 01:30 on the 23rd in Yerevan is 21:30 on the 22nd in UTC.
    expect(localDay('2026-09-22T21:30:00.000Z', 'Asia/Yerevan')).toBe('2026-09-23');
    expect(utcDay('2026-09-22T21:30:00.000Z')).toBe('2026-09-22');
  });

  it('writes the day as YYYY-MM-DD', () => {
    expect(localDay('2026-01-05T08:00:00.000Z', 'Asia/Yerevan')).toBe('2026-01-05');
  });

  it('reads a settlement period boundary back as the date that was chosen', () => {
    expect(utcDay('2026-09-15T00:00:00.000Z')).toBe('2026-09-15');
  });
});
