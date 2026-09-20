import { nextCheckAt } from '../../src/modules/auto-payout/schedule';
import { slotKey } from '../../src/modules/auto-payout/auto-payout.service';

describe('auto payout scheduling', () => {
  const base = { timezone: 'Asia/Yerevan', checkIntervalSeconds: 900 };

  it('checks an ON_THRESHOLD rule again after the interval', () => {
    const after = new Date('2026-09-20T10:00:00.000Z');
    expect(
      nextCheckAt({ ...base, cadence: 'ON_THRESHOLD', runHour: null, runWeekday: null }, after),
    ).toEqual(new Date('2026-09-20T10:15:00.000Z'));
  });

  it('schedules a DAILY rule at the local hour, today if still ahead, else tomorrow', () => {
    // 10:00 UTC is 14:00 in Yerevan. 18:00 local is 14:00 UTC today.
    const after = new Date('2026-09-20T10:00:00.000Z');
    expect(
      nextCheckAt({ ...base, cadence: 'DAILY', runHour: 18, runWeekday: null }, after),
    ).toEqual(new Date('2026-09-20T14:00:00.000Z'));
    // 09:00 local has passed: tomorrow at 05:00 UTC.
    expect(nextCheckAt({ ...base, cadence: 'DAILY', runHour: 9, runWeekday: null }, after)).toEqual(
      new Date('2026-09-21T05:00:00.000Z'),
    );
  });

  it('never returns the same instant it was given', () => {
    // Exactly 09:00 local: the next run is tomorrow, not now.
    const at = new Date('2026-09-20T05:00:00.000Z');
    expect(nextCheckAt({ ...base, cadence: 'DAILY', runHour: 9, runWeekday: null }, at)).toEqual(
      new Date('2026-09-21T05:00:00.000Z'),
    );
  });

  it('schedules a WEEKLY rule on the requested weekday', () => {
    // 2026-09-20 is a Sunday. Next Wednesday (3) at 08:00 local = 04:00 UTC.
    const after = new Date('2026-09-20T10:00:00.000Z');
    expect(nextCheckAt({ ...base, cadence: 'WEEKLY', runHour: 8, runWeekday: 3 }, after)).toEqual(
      new Date('2026-09-23T04:00:00.000Z'),
    );
    // Sunday at a later hour today: still today.
    expect(nextCheckAt({ ...base, cadence: 'WEEKLY', runHour: 20, runWeekday: 0 }, after)).toEqual(
      new Date('2026-09-20T16:00:00.000Z'),
    );
    // Sunday at an earlier hour: next Sunday.
    expect(nextCheckAt({ ...base, cadence: 'WEEKLY', runHour: 8, runWeekday: 0 }, after)).toEqual(
      new Date('2026-09-27T04:00:00.000Z'),
    );
  });

  it('falls back to UTC for an unknown zone', () => {
    const after = new Date('2026-09-20T10:00:00.000Z');
    expect(
      nextCheckAt(
        {
          cadence: 'DAILY',
          runHour: 12,
          runWeekday: null,
          timezone: 'Mars/Olympus',
          checkIntervalSeconds: 1,
        },
        after,
      ),
    ).toEqual(new Date('2026-09-20T12:00:00.000Z'));
  });

  it('derives a stable, URL-safe idempotency key per slot', () => {
    const slot = new Date('2026-09-20T10:00:00.000Z');
    const a = slotKey('3f1c2e9a-0000-4000-8000-000000000001', slot);
    const b = slotKey('3f1c2e9a-0000-4000-8000-000000000001', slot);
    const c = slotKey('3f1c2e9a-0000-4000-8000-000000000001', new Date(slot.getTime() + 1));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });
});
