import * as React from 'react';
import { cx, Surface } from './primitives';

export type MetricTone = 'default' | 'available' | 'pending' | 'reserved' | 'brand';

const TONE_TEXT: Record<MetricTone, string> = {
  default: 'text-ink',
  available: 'text-available-text',
  pending: 'text-pending-text',
  reserved: 'text-reserved-text',
  brand: 'text-brand',
};

/**
 * The dashboards' unit of measurement. Label small and grey, value large and
 * tabular — so a row of tiles scans as a single line of numbers rather than
 * as separate cards competing for attention.
 */
export function StatTile({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string;
  value: string | number;
  tone?: MetricTone;
  hint?: string;
}) {
  return (
    <Surface>
      <div className="text-[13px] text-muted">{label}</div>
      <div
        className={cx(
          'tabular mt-2 text-[30px] font-semibold tracking-[-0.02em]',
          TONE_TEXT[tone],
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-[12px] text-faint">{hint}</div> : null}
    </Surface>
  );
}

/**
 * Web twin of the mobile balance bar. Same three hues, same proportional
 * segments — a partner or admin looking at platform bonus liability sees
 * the identical picture a customer sees of their own wallet, which is the
 * point of running one design system across all three surfaces.
 */
export function BonusCompositionBar({
  available,
  pending,
  reserved,
  labels,
  showLegend = true,
}: {
  available: number | string;
  pending: number | string;
  reserved: number | string;
  labels?: { available: string; pending: string; reserved: string };
  showLegend?: boolean;
}) {
  const a = Number(available) || 0;
  const p = Number(pending) || 0;
  const r = Number(reserved) || 0;
  const total = a + p + r;

  const l = labels ?? { available: 'Available', pending: 'Pending', reserved: 'Reserved' };
  const segments = [
    { key: 'available', value: a, label: l.available, bar: 'bg-available', dot: 'bg-available', text: 'text-available-text' },
    { key: 'pending', value: p, label: l.pending, bar: 'bg-pending', dot: 'bg-pending', text: 'text-pending-text' },
    { key: 'reserved', value: r, label: l.reserved, bar: 'bg-reserved', dot: 'bg-reserved', text: 'text-reserved-text' },
  ];

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');

  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-canvas">
        {total > 0
          ? segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <div
                  key={s.key}
                  className={cx(s.bar, 'transition-[flex-grow] duration-500')}
                  style={{ flexGrow: s.value }}
                  title={`${s.label}: ${fmt(s.value)}`}
                />
              ))
          : null}
      </div>

      {showLegend ? (
        <div className="mt-4 grid grid-cols-3 gap-4">
          {segments.map((s) => (
            <div key={s.key}>
              <div className="flex items-center gap-1.5">
                <span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} />
                <span className="text-[12px] text-muted">{s.label}</span>
              </div>
              <div className={cx('tabular mt-1 text-[17px] font-semibold', s.text)}>
                {fmt(s.value)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Horizontal breakdown used for "transactions by type" style data. A plain
 * bar list rather than a pie: proportions stay comparable and the labels
 * stay readable, which a pie chart never manages at this size.
 */
export function BarList({
  items,
  valueFormatter,
}: {
  items: { label: string; value: number; hint?: string }[];
  valueFormatter?: (n: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const fmt = valueFormatter ?? ((n: number) => n.toLocaleString('en-US'));

  return (
    <div className="space-y-3.5">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-4">
            <span className="text-[14px] text-ink">{item.label}</span>
            <span className="tabular text-[14px] font-medium text-ink">
              {fmt(item.value)}
              {item.hint ? <span className="ml-2 text-[12px] text-faint">{item.hint}</span> : null}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
