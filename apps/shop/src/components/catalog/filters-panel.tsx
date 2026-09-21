'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, X } from 'lucide-react';
import { COLORS } from '@/data/attributes';
import type { Dictionary } from '@/lib/i18n';
import { fill } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import type { CatalogFacets } from '@/lib/catalog/types';
import { buildCatalogHref } from '@/lib/catalog/params';
import { cn } from '@/lib/utils';
import { Button, Checkbox, Input } from '@/components/ui';

type Props = {
  facets: CatalogFacets;
  basePath: string;
  dict: Dictionary;
  onApplied?: () => void;
};

const Group = ({
  title,
  children,
  defaultOpen = true,
  count,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line py-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="text-[14px] font-medium">
          {title}
          {count ? <span className="ml-1.5 text-[12px] text-accent">{count}</span> : null}
        </span>
        <ChevronDown
          width={16}
          height={16}
          className={cn('text-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
};

/**
 * Filter panel.
 *
 * Every change is written to the query string, so filtered views are
 * shareable, the Back button behaves, and the server renders the result — no
 * duplicated filtering logic in the browser.
 */
export const FiltersPanel = ({ facets, basePath, dict, onApplied }: Props) => {
  const router = useRouter();
  const routeParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  /**
   * Filtering is a server round trip, so a freshly ticked checkbox would sit
   * unticked for a moment. `optimistic` holds the params the customer just
   * asked for and is dropped as soon as the real URL catches up.
   */
  const [optimistic, setOptimistic] = useState<URLSearchParams | null>(null);
  const params = optimistic ?? routeParams;
  const [priceMin, setPriceMin] = useState(routeParams.get('priceMin') ?? '');
  const [priceMax, setPriceMax] = useState(routeParams.get('priceMax') ?? '');

  useEffect(() => {
    setOptimistic(null);
  }, [routeParams]);

  const navigate = (href: string, next: URLSearchParams) => {
    setOptimistic(next);
    startTransition(() => router.push(href, { scroll: false }));
    onApplied?.();
  };

  const selected = useMemo(() => {
    const read = (key: string) => (params.get(key) ?? '').split(',').filter(Boolean);
    return {
      brand: read('brand'),
      color: read('color'),
      material: read('material'),
      style: read('style'),
      specs: Object.fromEntries(
        [...params.entries()]
          .filter(([key]) => key.startsWith('spec.'))
          .map(([key, value]) => [key.slice(5), value.split(',').filter(Boolean)]),
      ) as Record<string, string[]>,
    };
  }, [params]);

  /** Applies one change to the query string and navigates to the result. */
  const apply = (changes: Record<string, string | string[] | null>) => {
    const href = buildCatalogHref(basePath, params, changes);
    const next = new URLSearchParams(href.split('?')[1] ?? '');
    navigate(href, next);
  };

  const toggle = (key: string, value: string) => {
    const current = (params.get(key) ?? '').split(',').filter(Boolean);
    apply({
      [key]: current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    });
  };

  const setFlag = (key: string, value: boolean) => apply({ [key]: value ? '1' : null });

  const applyPrice = () =>
    apply({
      priceMin: priceMin ? String(Number(priceMin)) : null,
      priceMax: priceMax ? String(Number(priceMax)) : null,
    });

  const reset = () => {
    const keep = new URLSearchParams();
    const query = routeParams.get('q');
    if (query) keep.set('q', query);
    setPriceMin('');
    setPriceMax('');
    navigate(keep.toString() ? `${basePath}?${keep.toString()}` : basePath, keep);
  };

  const activeCount =
    selected.brand.length +
    selected.color.length +
    selected.material.length +
    selected.style.length +
    Object.values(selected.specs).reduce((sum, values) => sum + values.length, 0) +
    (params.get('priceMin') ? 1 : 0) +
    (params.get('priceMax') ? 1 : 0) +
    (params.get('inStock') === '1' ? 1 : 0) +
    (params.get('discounted') === '1' ? 1 : 0) +
    (params.get('rating') ? 1 : 0);

  return (
    <div className={isPending ? 'opacity-70 transition-opacity' : undefined} aria-busy={isPending}>
      {activeCount > 0 ? (
        <button
          type="button"
          onClick={reset}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-surface-2 py-2.5 text-[13px] hover:bg-surface-3"
        >
          <X width={14} height={14} /> {dict.catalog.resetFilters} ({activeCount})
        </button>
      ) : null}

      <Group title={dict.catalog.price}>
        <div className="flex items-center gap-2">
          <Input
            inputMode="numeric"
            placeholder={`${dict.catalog.priceFrom} ${Math.round(facets.priceMinMinor / 1000)}к`}
            value={priceMin}
            onChange={(event) => setPriceMin(event.target.value.replace(/\D/g, ''))}
            className="h-10"
            aria-label={dict.catalog.priceFrom}
          />
          <span className="text-muted">—</span>
          <Input
            inputMode="numeric"
            placeholder={`${dict.catalog.priceTo} ${Math.round(facets.priceMaxMinor / 1000)}к`}
            value={priceMax}
            onChange={(event) => setPriceMax(event.target.value.replace(/\D/g, ''))}
            className="h-10"
            aria-label={dict.catalog.priceTo}
          />
        </div>
        <p className="mt-2 text-[12px] text-muted">
          {formatMoney(facets.priceMinMinor)} — {formatMoney(facets.priceMaxMinor)}
        </p>
        <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={applyPrice}>
          {dict.common.apply}
        </Button>
      </Group>

      <Group title={dict.catalog.availability}>
        <Checkbox
          label={`${dict.catalog.onlyInStock} (${facets.inStockCount})`}
          checked={params.get('inStock') === '1'}
          onChange={(event) => setFlag('inStock', event.target.checked)}
        />
        <Checkbox
          label={`${dict.catalog.onlyDiscount} (${facets.discountedCount})`}
          checked={params.get('discounted') === '1'}
          onChange={(event) => setFlag('discounted', event.target.checked)}
        />
      </Group>

      {facets.colors.length > 1 ? (
        <Group title={dict.catalog.color} count={selected.color.length}>
          <div className="flex flex-wrap gap-2">
            {facets.colors.map((facet) => (
              <button
                key={facet.key}
                type="button"
                title={`${facet.label} (${facet.count})`}
                aria-label={facet.label}
                aria-pressed={selected.color.includes(facet.key)}
                onClick={() => toggle('color', facet.key)}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border-2',
                  selected.color.includes(facet.key)
                    ? 'border-ink'
                    : 'border-transparent hover:border-line-strong',
                )}
              >
                <span
                  className="h-6 w-6 rounded-full border border-line"
                  style={{ background: COLORS[facet.key]?.hex ?? '#ccc' }}
                />
              </button>
            ))}
          </div>
        </Group>
      ) : null}

      {facets.materials.length > 1 ? (
        <Group title={dict.catalog.material} count={selected.material.length}>
          <div className="max-h-56 overflow-y-auto pr-1">
            {facets.materials.map((facet) => (
              <Checkbox
                key={facet.key}
                label={`${facet.label} (${facet.count})`}
                checked={selected.material.includes(facet.key)}
                onChange={() => toggle('material', facet.key)}
              />
            ))}
          </div>
        </Group>
      ) : null}

      {facets.brands.length > 1 ? (
        <Group title={dict.catalog.brand} count={selected.brand.length} defaultOpen={false}>
          <div className="max-h-56 overflow-y-auto pr-1">
            {facets.brands.map((facet) => (
              <Checkbox
                key={facet.key}
                label={`${facet.label} (${facet.count})`}
                checked={selected.brand.includes(facet.key)}
                onChange={() => toggle('brand', facet.key)}
              />
            ))}
          </div>
        </Group>
      ) : null}

      {facets.styles.length > 1 ? (
        <Group title={dict.catalog.style} count={selected.style.length} defaultOpen={false}>
          {facets.styles.map((facet) => (
            <Checkbox
              key={facet.key}
              label={`${facet.label} (${facet.count})`}
              checked={selected.style.includes(facet.key)}
              onChange={() => toggle('style', facet.key)}
            />
          ))}
        </Group>
      ) : null}

      {/* Category-specific filters: door opening side, sofa mechanism, … */}
      {facets.specs.map((spec) => (
        <Group
          key={spec.key}
          title={spec.label}
          count={selected.specs[spec.key]?.length}
          defaultOpen={false}
        >
          {spec.values.map((value) => (
            <Checkbox
              key={value.key}
              label={`${value.label} (${value.count})`}
              checked={(selected.specs[spec.key] ?? []).includes(value.key)}
              onChange={() => toggle(`spec.${spec.key}`, value.key)}
            />
          ))}
        </Group>
      ))}

      <Group title={dict.catalog.rating} defaultOpen={false}>
        {[4, 4.5].map((value) => (
          <Checkbox
            key={value}
            label={fill(dict.catalog.ratingFrom, { value })}
            checked={params.get('rating') === String(value)}
            onChange={(event) => apply({ rating: event.target.checked ? String(value) : null })}
          />
        ))}
      </Group>
    </div>
  );
};
