/**
 * Formatting for the operator's screen.
 *
 * Amounts arrive as integer minor-unit strings and are never parsed into a
 * JavaScript number — the admin panel reads the same values the ledger holds,
 * and a figure an operator quotes to a driver has to match to the last dram.
 */
export function formatMinor(minor: string, currency = 'AMD'): string {
  const negative = minor.startsWith('-');
  const digits = (negative ? minor.slice(1) : minor).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negative ? '−' : ''}${grouped}.${fraction} ${currency}`;
}

export function formatMoney(money: { minor: string; currency: string }): string {
  return formatMinor(money.minor, money.currency);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

export function relativeAge(iso: string | null | undefined): string {
  if (!iso) return '—';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

export function percentFromPpm(ppm: number): string {
  return `${(ppm / 10_000).toFixed(2)}%`;
}
