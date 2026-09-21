'use client';

import { useMemo, useState } from 'react';
import { Check, ShoppingBag } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { DOOR_GROUP_ORDER, REQUIRED_DOOR_GROUPS } from '@/lib/pricing/door';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';
import { useStore } from '@/components/providers/store-provider';

export type DoorOptionDto = {
  groupKey: string;
  optionKey: string;
  priceMinor: number;
  labels: Record<string, string>;
};

const GROUP_LABELS = (dict: Dictionary): Record<string, string> => ({
  size: dict.door.size,
  coating: dict.door.coating,
  color: dict.door.color,
  frame: dict.door.frame,
  casing: dict.door.casing,
  handle: dict.door.handle,
  lock: dict.door.lock,
  opening: dict.door.opening,
  installation: dict.door.installation,
});

/**
 * Door configurator.
 *
 * Shows a live total as the customer builds the set. The number here is a
 * preview computed from the same option rows the server uses; when the line
 * reaches the cart, `computeDoorConfig` recalculates it server-side and that
 * result is what the order is charged.
 */
export const DoorConfigurator = ({
  product,
  options,
  locale,
  dict,
}: {
  product: { id: string; sku: string; slug: string; name: string; image: string; priceMinor: number };
  options: DoorOptionDto[];
  locale: Locale;
  dict: Dictionary;
}) => {
  const { addToCart, toast } = useStore();
  const labels = GROUP_LABELS(dict);

  const groups = useMemo(() => {
    const map = new Map<string, DoorOptionDto[]>();
    for (const option of options) {
      const list = map.get(option.groupKey) ?? [];
      list.push(option);
      map.set(option.groupKey, list);
    }
    return DOOR_GROUP_ORDER.filter((key) => map.has(key)).map((key) => ({
      key,
      label: labels[key] ?? key,
      required: (REQUIRED_DOOR_GROUPS as readonly string[]).includes(key),
      options: map.get(key)!,
    }));
  }, [options, labels]);

  const [selection, setSelection] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((group) => [group.key, group.options[0]!.optionKey])),
  );

  const optionsTotal = groups.reduce((sum, group) => {
    const chosen = group.options.find((option) => option.optionKey === selection[group.key]);
    return sum + (chosen?.priceMinor ?? 0);
  }, 0);
  const total = product.priceMinor + optionsTotal;
  const missing = groups.filter((group) => group.required && !selection[group.key]);

  return (
    <div className="rounded-[var(--radius-md)] border border-line bg-surface p-5">
      <h2 className="text-xl">{dict.door.configuratorTitle}</h2>
      <p className="mt-1 text-[13px] text-muted">{dict.door.configuratorSubtitle}</p>

      <div className="mt-5 space-y-4">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-ink-soft">
                {group.label}
                {group.required ? <span className="ml-1 text-sale">*</span> : null}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {group.options.map((option) => {
                const active = selection[group.key] === option.optionKey;
                return (
                  <button
                    key={option.optionKey}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setSelection((current) => ({ ...current, [group.key]: option.optionKey }))
                    }
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-1.5 text-left text-[13px] transition-colors',
                      active ? 'border-ink bg-ink text-white' : 'border-line-strong hover:border-ink',
                    )}
                  >
                    {active ? <Check width={14} height={14} /> : null}
                    <span>{option.labels[locale] ?? option.optionKey}</span>
                    <span className={cn('text-[11px]', active ? 'text-white/70' : 'text-muted')}>
                      {option.priceMinor > 0 ? `+${formatMoney(option.priceMinor)}` : dict.door.included}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <dl className="mt-6 space-y-1.5 border-t border-line pt-4 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-muted">{dict.door.basePrice}</dt>
          <dd className="tabular-nums">{formatMoney(product.priceMinor)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{dict.door.optionsPrice}</dt>
          <dd className="tabular-nums">{formatMoney(optionsTotal)}</dd>
        </div>
        <div className="flex items-baseline justify-between pt-2 text-base">
          <dt className="font-medium">{dict.door.totalPrice}</dt>
          <dd className="text-[22px] font-semibold tabular-nums">{formatMoney(total)}</dd>
        </div>
      </dl>

      <Button
        size="lg"
        className="mt-4 w-full"
        disabled={missing.length > 0}
        onClick={() => {
          addToCart({
            productId: product.id,
            quantity: 1,
            options: {},
            doorConfig: selection,
            preview: {
              sku: product.sku,
              slug: product.slug,
              name: product.name,
              image: product.image,
              priceMinor: total,
            },
          });
          toast(dict.toast.addedToCart);
        }}
      >
        <ShoppingBag width={18} height={18} />
        {dict.door.addConfigured}
      </Button>
    </div>
  );
};
