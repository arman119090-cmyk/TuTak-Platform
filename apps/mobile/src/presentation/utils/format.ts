/**
 * Money and date formatting.
 *
 * Bonus points are shown without decimals when whole (3 000, not 3 000.00)
 * because a balance should read as a single glanceable quantity — the
 * fractional part only appears when it actually exists.
 */

// The global i18next instance — the same object `app/i18n/i18n.ts`
// initialises — not that module itself: importing the module would boot
// the whole translation table into every unit test that merely formats a
// number, and the screen tests rely on an uninitialised instance so they
// can assert on keys rather than on one language's copy.
import i18n from 'i18next';
import { DEFAULT_LOCALE, isSupportedLocale } from '@tutak/i18n';

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

/**
 * Dates, in the interface language.
 *
 * `undefined` as the locale used to mean "whatever the OS reports", which
 * on a phone set to English shows "Sep 19" in a Russian interface. The
 * interface language is the one the customer chose in Settings, so every
 * date follows `i18n.language`. Month names, day order and the 24-hour
 * clock come from `Intl` — nothing hand-listed.
 *
 * Hermes ships `Intl.DateTimeFormat` on both platforms; a runtime that
 * somehow lacks the requested locale falls back to an ISO-style date rather
 * than crashing a list.
 */
function currentLocale(): string {
  const lng = i18n.language;
  return isSupportedLocale(lng) ? lng : DEFAULT_LOCALE;
}

/**
 * Armenian short month names exactly as ICU prints them ("17 սեպ, 2026 թ."),
 * for a runtime whose `Intl` has no Armenian data. Such a runtime does not
 * throw — it quietly answers in English ("Sep 17, 2026"), which is what the
 * web demo's Chromium does — so the gap has to be detected, not caught.
 * Russian and English need no list: every runtime the app targets ships
 * them.
 */
const HY_SHORT_MONTHS = ['հնվ', 'փտվ', 'մրտ', 'ապր', 'մյս', 'հնս', 'հլս', 'օգս', 'սեպ', 'հոկ', 'նոյ', 'դեկ'];

function runtimeHasLocale(locale: string): boolean {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

function formatArmenianByHand(date: Date, options: Intl.DateTimeFormatOptions): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const dayMonth = `${date.getDate()} ${HY_SHORT_MONTHS[date.getMonth()]}`;
  if (options.hour) return `${dayMonth}, ${two(date.getHours())}:${two(date.getMinutes())}`;
  return options.year ? `${dayMonth}, ${date.getFullYear()} թ.` : dayMonth;
}

function safeFormat(date: Date, options: Intl.DateTimeFormatOptions): string {
  if (Number.isNaN(date.getTime())) return '';
  const locale = currentLocale();
  if (locale === 'hy' && !runtimeHasLocale('hy')) return formatArmenianByHand(date, options);
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** "19 сент. 2026 г." / "19 սեպ, 2026 թ." / "Sep 19, 2026". */
export function formatDate(value: string): string {
  return safeFormat(new Date(value), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Day and month plus a 24-hour time: "19 сент., 11:52". */
export function formatDateTime(value: string): string {
  return safeFormat(new Date(value), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** "Today", "Yesterday", or a date — used to group transaction lists. */
export function formatDayGroup(value: string): string {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return i18n.t('common.today');
  if (sameDay(d, yesterday)) return i18n.t('common.yesterday');
  return formatDate(value);
}

export function formatEnergy(kwh: string | number): string {
  const n = typeof kwh === 'string' ? Number(kwh) : kwh;
  if (!Number.isFinite(n)) return '0 kWh';
  return `${group(n, 2)} kWh`;
}
