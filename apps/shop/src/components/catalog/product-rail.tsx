'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import type { ProductCard } from '@/lib/catalog/types';
import { ProductCardView } from './product-card';

/**
 * Homepage product rail: a scroll-snapped row on phones, a four-up grid from
 * the large breakpoint. Scrolling horizontally is how people actually browse a
 * shop on a phone, so the mobile version is the primary one here.
 */
export const ProductRail = ({
  title,
  subtitle,
  href,
  products,
  locale,
  dict,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  products: ProductCard[];
  locale: Locale;
  dict: Dictionary;
}) => {
  if (products.length === 0) return null;

  return (
    <section className="container-page py-10 md:py-14">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[26px] md:text-[32px]">{title}</h2>
          {subtitle ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{subtitle}</p> : null}
        </div>
        {href ? (
          <Link
            href={href}
            className="hidden shrink-0 items-center gap-1.5 text-[13px] text-accent hover:underline md:inline-flex"
          >
            {dict.common.showAll} <ArrowRight width={15} height={15} />
          </Link>
        ) : null}
      </div>

      <div className="hide-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-3 md:gap-6 md:overflow-visix md:px-0 lg:grid-cols-4">
        {products.slice(0, 8).map((product) => (
          <div
            key={product.id}
            className="w-[66vw] shrink-0 snap-start xs:w-[58vw] sm:w-[44vw] md:w-auto"
          >
            <ProductCardView product={product} locale={locale} dict={dict} />
          </div>
        ))}
      </div>

      {href ? (
        <Link
          href={href}
          className="mt-6 flex h-12 items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-line-strong text-sm md:hidden"
        >
          {dict.common.showAll} <ArrowRight width={16} height={16} />
        </Link>
      ) : null}
    </section>
  );
};
