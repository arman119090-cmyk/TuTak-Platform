import { BadRequestException } from '@nestjs/common';
import { SettlementPeriodicity } from '@prisma/client';

/**
 * A partner's settlement period, from its one authoritative cadence:
 * `Partner.settlementPeriodicity` + `Partner.settlementAnchorDay`.
 *
 * Periods are cut on Armenian wall-clock midnights and are a pure function
 * of (periodicity, anchor, instant), so every worker and every report
 * computes the same boundaries. `end` is exclusive.
 *
 *  - DAILY: each local day; the anchor is ignored.
 *  - WEEKLY: seven days starting on the anchor weekday (1 = Monday … 7 = Sunday).
 *  - BIWEEKLY: fourteen-day blocks starting on the anchor weekday, counted from
 *    the first such weekday on or after 1 January 2024 — so every worker
 *    agrees which week a block starts on.
 *  - MONTHLY: from the anchor day of one month to the same day of the next
 *    (1-28, so the day exists in February too).
 */
export const SETTLEMENT_TIME_ZONE = 'Asia/Yerevan';

const DAY_MS = 86_400_000;
const BIWEEKLY_EPOCH = Date.UTC(2024, 0, 1); // a Monday

export interface SettlementPeriodBounds {
  start: Date;
  end: Date;
}

/** Validates an anchor for its periodicity; DAILY stores 1 (unused). */
export function normaliseAnchorDay(periodicity: SettlementPeriodicity, anchorDay: number | undefined): number {
  if (periodicity === SettlementPeriodicity.DAILY) return 1;
  const day = anchorDay ?? 1;
  const max = periodicity === SettlementPeriodicity.MONTHLY ? 28 : 7;
  if (!Number.isInteger(day) || day < 1 || day > max) {
    throw new BadRequestException(`settlementAnchorDay for ${periodicity} must be 1-${max}, got ${anchorDay}`);
  }
  return day;
}

/** The UTC instant of a wall-clock midnight in `timeZone`. */
function zonedMidnight(civilUtc: number, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(civilUtc));
  const f = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(f('year'), f('month') - 1, f('day'), f('hour'), f('minute'));
  return new Date(civilUtc - (asUtc - civilUtc));
}

/** The local calendar date of `instant`, as a UTC-midnight civil timestamp. */
function localCivil(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const f = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(f('year'), f('month') - 1, f('day'));
}

/** Monday = 1 … Sunday = 7, like the anchor. */
const isoWeekday = (civil: number) => ((new Date(civil).getUTCDay() + 6) % 7) + 1;

function civilBounds(periodicity: SettlementPeriodicity, anchorDay: number, today: number): [number, number] {
  switch (periodicity) {
    case SettlementPeriodicity.DAILY:
      return [today, today + DAY_MS];
    case SettlementPeriodicity.WEEKLY: {
      const back = (isoWeekday(today) - anchorDay + 7) % 7;
      const start = today - back * DAY_MS;
      return [start, start + 7 * DAY_MS];
    }
    case SettlementPeriodicity.BIWEEKLY: {
      const first = BIWEEKLY_EPOCH + ((anchorDay - isoWeekday(BIWEEKLY_EPOCH) + 7) % 7) * DAY_MS;
      const blocks = Math.floor((today - first) / (14 * DAY_MS));
      const start = first + blocks * 14 * DAY_MS;
      return [start, start + 14 * DAY_MS];
    }
    case SettlementPeriodicity.MONTHLY: {
      const d = new Date(today);
      let year = d.getUTCFullYear();
      let month = d.getUTCMonth();
      if (d.getUTCDate() < anchorDay) month -= 1;
      if (month < 0) {
        month = 11;
        year -= 1;
      }
      return [Date.UTC(year, month, anchorDay), Date.UTC(year, month + 1, anchorDay)];
    }
  }
}

/** The period that contains `instant`. */
export function periodContaining(
  periodicity: SettlementPeriodicity,
  anchorDay: number,
  instant: Date,
  timeZone = SETTLEMENT_TIME_ZONE,
): SettlementPeriodBounds {
  const [start, end] = civilBounds(periodicity, normaliseAnchorDay(periodicity, anchorDay), localCivil(instant, timeZone));
  return { start: zonedMidnight(start, timeZone), end: zonedMidnight(end, timeZone) };
}

/** The most recent period that has fully ended at `now` — what is due for settlement. */
export function lastClosedPeriod(
  periodicity: SettlementPeriodicity,
  anchorDay: number,
  now: Date,
  timeZone = SETTLEMENT_TIME_ZONE,
): SettlementPeriodBounds {
  const current = periodContaining(periodicity, anchorDay, now, timeZone);
  return periodContaining(periodicity, anchorDay, new Date(current.start.getTime() - 1), timeZone);
}
