'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid, List, SlidersHorizontal } from 'lucide-react';
import type { Dictionary } from '@/lib/i18n';
import type { CatalogFacets } from '@/lib/catalog/types';
import { buildCatalogHref, countActiveFilters } from '@/lib/catalog/params';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/modal';
import { FiltersPanel } from './filters-panel';

export const CatalogToolbar = ({
  total,
  basePath,
  facets,
  dict,
}: {
  total: number;
  basePath: string;
  facets: CatalogFacets;
  dict: Dictionary;
}) => {
  const router = useRouter();
  const params = useSearchParams();
  const [mobileFilters, setMobileFilters] = useState(false);
  const view = params.get('view') === 'list' ? 'list' : 'grid';
  const activeFilters = countActiveFilters(params);

  const sorts: { value: string; label: string }[] = [
    { value: 'popular', label: dict.catalog.sortPopular },
    { value: 'price-asc', label: dict.catalog.sortPriceAsc },
    { value: 'price-desc', label: dict.catalog.sortPriceDesc },
    { value: 'new', label: dict.catalog.sortNew },
    { value: 'rating', label: dict.catalog.sortRating },
    { value: 'discount', label: dict.catalog.sortDiscount },
  ];

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-line pb-4">
        <p className="mr-auto text-[13px] text-muted">
          {dict.catalog.found}{' '}
          <span className="font-semibold text-ink tabular-nums">{total}</span> {dict.catalog.products}
        </p>

        <button
          type="button"
          onClick={() => setMobileFilters(true)}
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-line-strong px-3 text-[13px] lg:hidden"
        >
          <SlidersHorizontal width={16} height={16} />
          {dict.catalog.filters}
          {activeFilters > 0 ? (
            <span className="rounded-full bg-accent px-1.5 text-[11px] text-white">{activeFilters}</span>
          ) : null}
        </button>

        <select
          value={params.get('sort') ?? 'popular'}
          onChange={(event) =>
            router.push(buildCatalogHref(basePath, params, { sort: event.target.value }), { scroll: false })
          }
          aria-label={dict.catalog.sort}
          className="h-10 rounded-[var(--radius-sm)] border border-line-strong bg-surface px-3 text-[13px]"
        >
          {sorts.map((sort) => (
            <option key={sort.value} value={sort.value}>
              {sort.label}
            </option>
          ))}
        </select>

        <div className="hidden items-center gap-1 rounded-[var(--radius-sm)] border border-line-strong p-0.5 sm:flex">
          {(['grid', 'list'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-label={mode === 'grid' ? dict.catalog.viewGrid : dict.catalog.viewList}
              aria-pressed={view === mode}
              onClick={() =>
                router.push(buildCatalogHref(basePath, params, { view: mode === 'grid' ? null : 'list', page: params.get('page') ?? '' }), {
                  scroll: false,
                })
              }
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-[var(--radius-xs)]',
                view === mode ? 'bg-ink text-white' : 'text-muted hover:bg-surface-2',
              )}
            >
              {mode === 'grid' ? <LayoutGrid width={16} height={16} /> : <List width={16} height={16} />}
            </button>
          ))}
        </div>
      </div>

      {mobileFilters ? (
        <Modal title={dict.catalog.filters} onClose={() => setMobileFilters(false)}>
          <FiltersPanel
            facets={facets}
            basePath={basePath}
            dict={dict}
            onApplied={() => setMobileFilters(false)}
          />
        </Modal>
      ) : null}
    </>
  );
};
