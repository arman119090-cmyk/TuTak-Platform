'use client';

import { COLORS, MATERIALS } from '@/data/attributes';
import type { Dictionary, Locale } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

export type ProductOptionView = {
  kind: 'COLOR' | 'MATERIAL' | 'SIZE';
  valueKey: string;
  label: string | null;
  priceDeltaMinor: number;
};

export const optionLabel = (option: ProductOptionView, locale: Locale): string => {
  if (option.kind === 'COLOR') return COLORS[option.valueKey]?.label[locale] ?? option.valueKey;
  if (option.kind === 'MATERIAL')
    return MATERIALS[option.valueKey]?.label[locale] ?? option.valueKey;
  return option.label ?? option.valueKey;
};

/**
 * Colour / material / size selector.
 *
 * Price deltas are shown next to each option, but they are only a preview: the
 * cart quote recomputes them server-side from the same rows.
 */
export const OptionPicker = ({
  options,
  selected,
  onSelect,
  locale,
  dict,
}: {
  options: ProductOptionView[];
  selected: Record<string, string>;
  onSelect: (kind: string, valueKey: string) => void;
  locale: Locale;
  dict: Dictionary;
}) => {
  const groups: { kind: 'COLOR' | 'MATERIAL' | 'SIZE'; label: string }[] = [
    { kind: 'COLOR', label: dict.product.color },
    { kind: 'MATERIAL', label: dict.product.material },
    { kind: 'SIZE', label: dict.product.size },
  ];

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const items = options.filter((option) => option.kind === group.kind);
        if (items.length === 0) return null;
        const active = selected[group.kind];
        return (
          <div key={group.kind}>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-ink-soft">{group.label}</span>
              {active ? (
                <span className="text-[12px] text-muted">
                  {optionLabel(items.find((item) => item.valueKey === active) ?? items[0]!, locale)}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {items.map((option) => {
                const isActive = active === option.valueKey;
                const label = optionLabel(option, locale);
                if (group.kind === 'COLOR') {
                  return (
                    <button
                      key={option.valueKey}
                      type="button"
                      title={`${label}${option.priceDeltaMinor ? ` · +${formatMoney(option.priceDeltaMinor)}` : ''}`}
                      aria-label={label}
                      aria-pressed={isActive}
                      onClick={() => onSelect(group.kind, option.valueKey)}
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors',
                        isActive ? 'border-ink' : 'border-transparent hover:border-line-strong',
                      )}
                    >
                      <span
                        className="h-7 w-7 rounded-full border border-line"
                        style={{ background: COLORS[option.valueKey]?.hex ?? '#ccc' }}
                      />
                    </button>
                  );
                }
                return (
                  <button
                    key={option.valueKey}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onSelect(group.kind, option.valueKey)}
                    className={cn(
                      'inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 text-[13px] transition-colors',
                      isActive
                        ? 'border-ink bg-ink text-white'
                        : 'border-line-strong hover:border-ink',
                    )}
                  >
                    {label}
                    {option.priceDeltaMinor > 0 ? (
                      <span
                        className={cn('text-[11px]', isActive ? 'text-white/70' : 'text-muted')}
                      >
                        +{formatMoney(option.priceDeltaMinor)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const QuantityStepper = ({
  value,
  onChange,
  max = 20,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  max?: number;
  label: string;
}) => (
  <div
    className="inline-flex h-12 items-center rounded-[var(--radius-sm)] border border-line-strong"
    role="group"
    aria-label={label}
  >
    <button
      type="button"
      className="flex h-full w-11 items-center justify-center text-lg disabled:opacity-40"
      onClick={() => onChange(Math.max(1, value - 1))}
      disabled={value <= 1}
      aria-label="−"
    >
      −
    </button>
    <span className="w-10 text-center text-sm tabular-nums">{value}</span>
    <button
      type="button"
      className="flex h-full w-11 items-center justify-center text-lg disabled:opacity-40"
      onClick={() => onChange(Math.min(max, value + 1))}
      disabled={value >= max}
      aria-label="+"
    >
      +
    </button>
  </div>
);
