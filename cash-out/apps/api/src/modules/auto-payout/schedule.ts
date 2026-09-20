/**
 * When a rule is next due. Pure, so it can be tested without a database.
 *
 * Time zones: the product ships in Armenia, which has kept UTC+4 without
 * daylight saving since 2012. Rather than pull in a tz database for one zone,
 * the offsets the product supports are listed here; an unknown zone falls back
 * to UTC and the rule row records the zone it was created with.
 */
const OFFSET_MINUTES: Readonly<Record<string, number>> = {
  'Asia/Yerevan': 240,
  UTC: 0,
};

export function offsetMinutesFor(timezone: string): number {
  return OFFSET_MINUTES[timezone] ?? 0;
}

export interface ScheduleInput {
  readonly cadence: 'ON_THRESHOLD' | 'DAILY' | 'WEEKLY';
  readonly runHour: number | null;
  readonly runWeekday: number | null;
  readonly timezone: string;
  readonly checkIntervalSeconds: number;
}

/**
 * The next instant at or after `after` when the rule should be evaluated.
 *
 *  - ON_THRESHOLD: `after` + the configured interval.
 *  - DAILY: the next `runHour`:00 local time strictly after `after`.
 *  - WEEKLY: the next `runWeekday` at `runHour`:00 local time strictly after `after`.
 */
export function nextCheckAt(input: ScheduleInput, after: Date): Date {
  if (input.cadence === 'ON_THRESHOLD') {
    return new Date(after.getTime() + input.checkIntervalSeconds * 1000);
  }

  const offsetMs = offsetMinutesFor(input.timezone) * 60_000;
  const local = new Date(after.getTime() + offsetMs);
  const hour = input.runHour ?? 0;

  // Candidate: today at runHour, local.
  const candidate = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, 0, 0, 0),
  );
  if (candidate.getTime() <= local.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  if (input.cadence === 'WEEKLY') {
    const weekday = input.runWeekday ?? 0;
    while (candidate.getUTCDay() !== weekday) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
  }

  return new Date(candidate.getTime() - offsetMs);
}
