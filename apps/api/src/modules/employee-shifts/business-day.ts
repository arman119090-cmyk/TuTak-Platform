/**
 * The branch-local business day an instant belongs to (Q4): a branch whose
 * business day starts at 05:00 Asia/Yerevan puts 02:30 local time on the
 * *previous* calendar day — the night shift that started yesterday evening
 * is still yesterday's shift. Returned as `YYYY-MM-DD`.
 *
 * Plain `Intl` rather than a date library: the only operation needed is
 * "what are this instant's wall-clock fields in that zone", which the
 * platform already does correctly for every IANA zone, DST included.
 */
export function businessDateFor(instant: Date, timeZone: string, businessDayStartMinute: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const field = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const minutes = field('hour') * 60 + field('minute');
  // Calendar arithmetic on a UTC-anchored date, so no zone offset can shift it.
  const day = new Date(Date.UTC(field('year'), field('month') - 1, field('day')));
  if (minutes < businessDayStartMinute) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → the `Date` Prisma writes to a `@db.Date` column. */
export function toDbDate(businessDate: string): Date {
  return new Date(`${businessDate}T00:00:00.000Z`);
}

/** A `@db.Date` column value → `YYYY-MM-DD`. */
export function fromDbDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Throws for anything `Intl` does not recognise as an IANA zone. */
export function assertValidTimeZone(timeZone: string): void {
  new Intl.DateTimeFormat('en-US', { timeZone });
}
