'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, X, Loader2 } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { ProductCard } from '@/lib/catalog/types';

type Suggestions = {
  products: ProductCard[];
  categories: { slug: string; name: string; count: number }[];
};

const POPULAR_QUERIES = [
  'диван угловой',
  'кровать 160',
  'шкаф-купе',
  'стол обеденный',
  'двери межкомнатные',
];

/**
 * Catalogue search with autocomplete.
 *
 * Queries are debounced and matched server-side against a per-product haystack
 * that contains the SKU, the name in all three languages, colours, materials
 * and the category — so "серый диван" finds grey sofas, and so does "SF-COR".
 */
export const SearchBox = ({
  locale,
  dict,
  variant = 'desktop',
  onClose,
}: {
  locale: Locale;
  dict: Dictionary;
  variant?: 'desktop' | 'mobile';
  onClose?: () => void;
}) => {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Suggestions | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setData(null);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/search/suggest?q=${encodeURIComponent(query)}&locale=${locale}`,
        );
        if (response.ok) setData((await response.json()) as Suggestions);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, locale]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const submit = (value: string) => {
    const term = value.trim();
    if (!term) return;
    setOpen(false);
    onClose?.();
    router.push(`/${locale}/search?q=${encodeURIComponent(term)}`);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit(query);
        }}
      >
        <div className="flex h-11 items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-surface px-3 focus-within:border-ink">
          <Search width={18} height={18} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={dict.nav.searchPlaceholder}
            aria-label={dict.search.title}
            className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted/80"
          />
          {loading ? <Loader2 width={16} height={16} className="animate-spin text-muted" /> : null}
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label={dict.common.clear}>
              <X width={16} height={16} className="text-muted hover:text-ink" />
            </button>
          ) : null}
        </div>
      </form>

      {open ? (
        <div
          className={cn(
            'absolute left-0 right-0 top-[52px] z-50 overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface shadow-[var(--shadow-pop)]',
            variant === 'mobile' && 'fixed left-3 right-3 top-[118px]',
          )}
        >
          {!data && query.trim().length < 2 ? (
            <div className="p-4">
              <p className="eyebrow mb-3">{dict.search.popularQueries}</p>
              <div className="flex flex-wrap gap-2">
                {POPULAR_QUERIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => submit(item)}
                    className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft hover:border-ink"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {data && data.categories.length > 0 ? (
            <div className="border-b border-line p-3">
              <p className="eyebrow mb-2 px-1">{dict.search.categories}</p>
              {data.categories.map((category) => (
                <Link
                  key={category.slug}
                  href={`/${locale}/catalog/${category.slug}`}
                  onClick={() => {
                    setOpen(false);
                    onClose?.();
                  }}
                  className="flex items-center justify-between rounded-[var(--radius-xs)] px-1 py-2 text-sm hover:bg-surface-2"
                >
                  <span>{category.name}</span>
                  <span className="text-[12px] text-muted">{category.count}</span>
                </Link>
              ))}
            </div>
          ) : null}

          {data && data.products.length > 0 ? (
            <div className="p-3">
              <p className="eyebrow mb-2 px-1">{dict.search.products}</p>
              <ul>
                {data.products.map((product) => (
                  <li key={product.id}>
                    <Link
                      href={`/${locale}/product/${product.slug}`}
                      onClick={() => {
                        setOpen(false);
                        onClose?.();
                      }}
                      className="flex items-center gap-3 rounded-[var(--radius-xs)] p-1.5 hover:bg-surface-2"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={product.image}
                        alt=""
                        width={56}
                        height={42}
                        className="h-[42px] w-14 rounded-[var(--radius-xs)] bg-surface-2 object-cover"
                        loading="lazy"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{product.name}</span>
                        <span className="block text-[12px] text-muted">{product.brandName}</span>
                      </span>
                      <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                        {formatMoney(product.priceMinor)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => submit(query)}
                className="mt-2 w-full rounded-[var(--radius-xs)] bg-surface-2 py-2.5 text-[13px] font-medium hover:bg-surface-3"
              >
                {dict.search.showAllResults}
              </button>
            </div>
          ) : null}

          {data && data.products.length === 0 && data.categories.length === 0 && !loading ? (
            <div className="p-5 text-center text-sm text-muted">
              {dict.search.nothingFound.replace('{query}', query)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
