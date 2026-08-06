/**
 * Money and date formatting.
 *
 * Bonus points are shown without decimals when whole (3 000, not 3 000.00)
 * because a balance should read as a single glanceable quantity — the
 * fractional part only appears when it actually exists.
 */

const groupSeparator = ' '; // narrow visual grouping reads cleaner than commas

function group(value: number, maxFractionDigits: number): string {
  const fixed = value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
  return fixed.replace(/,/g, groupSeparator);
}

export function formatPoints(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '0';
  return group(n, Number.isInteger(n) ? 0 : 2);
}

export function formatAmd(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '0 ֏';
  return `${group(n, Number.isInteger(n) ? 0 : 2)} ֏`;
}

/** Signed amount for ledger/transaction rows. */
export function formatSigned(value: string | number, currency: 'points' | 'amd' = 'points'): string {
  const n = typeof value === 'string' ? Number(value) : value;
  const body = currency === 'amd' ? formatAmd(Math.abs(n)) : formatPoints(Math.abs(n));
  return `${n < 0 ? '−' : '+'}${body}`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "Today", "Yesterday", or a date — used to group transaction lists. */
export function formatDayGroup(value: string): string {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return formatDate(value);
}

export function formatEnergy(kwh: string | number): string {
  const n = typeof kwh === 'string' ? Number(kwh) : kwh;
  if (!Number.isFinite(n)) return '0 kWh';
  return `${group(n, 2)} kWh`;
}
