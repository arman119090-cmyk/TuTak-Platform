'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Dictionary } from '@/lib/i18n';
import { buildCatalogHref } from '@/lib/catalog/params';
import { cn } from '@/lib/utils';

/** Page links stay real <a> elements so they can be opened in a new tab. */
export const Pagination = ({
  page,
  pageCount,
  basePath,
  dict,
}: {
  page: number;
  pageCount: number;
  basePath: string;
  dict: Dictionary;
}) => {
  const params = useSearchParams();
  if (pageCount <= 1) return null;

  const href = (target: number) =>
    buildCatalogHref(basePath, params, { page: target === 1 ? null : String(target) });

  const pages = new Set<number>([1, pageCount, page, page - 1, page + 1]);
  const visible = [...pages].filter((item) => item >= 1 && item <= pageCount).sort((a, b) => a - b);

  return (
    <nav className="mt-10 flex items-center justify-center gap-1.5" aria-label={dict.catalog.page}>
      <Link
        href={href(Math.max(1, page - 1))}
        aria-disabled={page === 1}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] border border-line',
          page === 1 && 'pointer-events-none opacity-40',
        )}
      >
        <ChevronLeft width={16} height={16} />
      </Link>
      {visible.map((item, index) => (
        <span key={item} className="flex items-center gap-1.5">
          {index > 0 && item - visible[index - 1]! > 1 ? (
            <span className="px-1 text-muted">…</span>
          ) : null}
          <Link
            href={href(item)}
            aria-current={item === page}
            className={cn(
              'flex h-10 min-w-10 items-center justify-center rounded-[var(--radius-sm)] border px-3 text-[13px] tabular-nums',
              item === page ? 'border-ink bg-ink text-white' : 'border-line hover:border-ink',
            )}
          >
            {item}
          </Link>
        </span>
      ))}
      <Link
        href={href(Math.min(pageCount, page + 1))}
        aria-disabled={page === pageCount}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] border border-line',
          page === pageCount && 'pointer-events-none opacity-40',
        )}
      >
        <ChevronRight width={16} height={16} />
      </Link>
    </nav>
  );
};
