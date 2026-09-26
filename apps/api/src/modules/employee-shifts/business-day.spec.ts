import { businessDateFor } from './business-day';

describe('businessDateFor', () => {
  // Asia/Yerevan is UTC+4 all year (no DST).
  it('puts 02:30 Yerevan time on the previous business day when the day starts at 05:00', () => {
    expect(businessDateFor(new Date('2026-09-25T22:30:00Z'), 'Asia/Yerevan', 300)).toBe('2026-09-25');
  });

  it('starts the new business day exactly at the configured minute', () => {
    expect(businessDateFor(new Date('2026-09-26T00:59:00Z'), 'Asia/Yerevan', 300)).toBe('2026-09-25');
    expect(businessDateFor(new Date('2026-09-26T01:00:00Z'), 'Asia/Yerevan', 300)).toBe('2026-09-26');
  });

  it('respects another branch timezone and a midnight start', () => {
    expect(businessDateFor(new Date('2026-09-26T03:00:00Z'), 'Europe/Moscow', 0)).toBe('2026-09-26');
    expect(businessDateFor(new Date('2026-09-25T20:59:00Z'), 'Europe/Moscow', 0)).toBe('2026-09-25');
  });

  it('handles month and year boundaries', () => {
    expect(businessDateFor(new Date('2027-01-01T00:30:00Z'), 'Asia/Yerevan', 300)).toBe('2026-12-31');
  });

  it('handles a DST zone', () => {
    // 2026-03-29 02:00 CET → 03:00 CEST; 01:30 UTC is 03:30 local, before a 04:00 start.
    expect(businessDateFor(new Date('2026-03-29T01:30:00Z'), 'Europe/Berlin', 240)).toBe('2026-03-28');
    expect(businessDateFor(new Date('2026-03-29T02:30:00Z'), 'Europe/Berlin', 240)).toBe('2026-03-29');
  });
});
