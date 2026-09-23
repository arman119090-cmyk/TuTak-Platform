/**
 * The calendar day an event happened on, as the person reading the panel
 * lives it: `YYYY-MM-DD` in the browser's own time zone.
 *
 * `toISOString().slice(0, 10)` reads the day in UTC. Yerevan is UTC+4, so a
 * sale rung up at 01:30 on the 23rd was listed under the 22nd in the activity
 * feed — while the purchase card, one click away, showed 23/09 01:30. A café
 * reconciling its night takings against the panel would find them under the
 * wrong day.
 *
 * For timestamps only. A settlement's `periodStart`/`periodEnd` are calendar
 * dates stored as UTC midnights; they are read with {@link utcDay}, which
 * gives back exactly the date that was chosen.
 */
export function localDay(iso: string, timeZone?: string): string {
  // `en-CA` writes dates as YYYY-MM-DD; `timeZone` left undefined means the
  // browser's own zone. It is a parameter so the rule can be tested against
  // Yerevan on a machine that is not in Yerevan.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** A calendar date stored as a UTC midnight, read back as that same date. */
export function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
