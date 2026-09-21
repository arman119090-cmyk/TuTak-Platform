'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, Heart, Scale, ShoppingBag } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { fill } from '@/lib/i18n';
import { COLORS } from '@/data/attributes';
import type { ProductCard as ProductCardType } from '@/lib/catalog/types';
import { Badge, Price, Rating } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useStore } from '@/components/providers/store-provider';
import { QuickView } from './quick-view';

const StockLine = ({ product, dict }: { product: ProductCardType; dict: Dictionary }) => {
  if (product.stockStatus === 'IN_STOCK') {
    return <span className="text-[12px] text-success">{dict.common.inStock}</span>;
  }
  if (product.stockStatus === 'ON_ORDER') {
    return (
      <span className="text-[12px] text-muted">
        {fill(dict.product.productionDays, { days: product.productionDays || 14 })}
      </span>
    );
  }
  return <span className="text-[12px] text-muted">{dict.common.outOfStock}</span>;
};

export const ProductCardView = ({
  product,
  locale,
  dict,
  layout = 'grid',
  className,
}: {
  product: ProductCardType;
  locale: Locale;
  dict: Dictionary;
  layout?: 'grid' | 'list';
  className?: string;
}) => {
  const { addToCart, isFavorite, toggleFavorite, isCompared, toggleCompare, toast } = useStore();
  const [quickView, setQuickView] = useState(false);
  const favorite = isFavorite(product.id);
  const compared = isCompared(product.id);
  const soldOut = product.stockStatus === 'OUT_OF_STOCK';

  const add = () => {
    addToCart({
      productId: product.id,
      quantity: 1,
      options: {},
      preview: {
        sku: product.sku,
        slug: product.slug,
        name: product.name,
        image: product.image,
        priceMinor: product.priceMinor,
      },
    });
    toast(dict.toast.addedToCart);
  };

  const onCompare = () => {
    const result = toggleCompare({
      productId: product.id,
      categorySlug: product.categorySlug,
      slug: product.slug,
    });
    if (result === 'limit') toast(dict.compare.limitReached, 'error');
    else if (result === 'category') toast(dict.compare.differentCategory, 'error');
    else toast(result === 'added' ? dict.toast.addedToCompare : dict.compare.remove, 'info');
  };

  const badges = (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col items-start gap-1.5">
      {product.discountPct > 0 ? <Badge tone="sale">−{product.discountPct}%</Badge> : null}
      {product.isNew ? <Badge tone="new">{dict.badges.new}</Badge> : null}
      {product.isHit ? <Badge tone="hit">{dict.badges.hit}</Badge> : null}
      {product.isPremium ? <Badge tone="premium">{dict.badges.premium}</Badge> : null}
      {product.stockStatus === 'IN_STOCK' ? (
        <Badge tone="stock">{dict.badges.inStock}</Badge>
      ) : null}
    </div>
  );

  const actions = (
    <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
      <button
        type="button"
        onClick={() => {
          toggleFavorite(product.id);
          toast(favorite ? dict.toast.removedFromFavorites : dict.toast.addedToFavorites);
        }}
        aria-label={dict.product.addToFavorites}
        aria-pressed={favorite}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface/95 shadow-[var(--shadow-card)] hover:bg-surface"
      >
        <Heart width={16} height={16} className={cn(favorite && 'fill-sale text-sale')} />
      </button>
      <button
        type="button"
        onClick={onCompare}
        aria-label={dict.product.addToCompare}
        aria-pressed={compared}
        className="hidden h-9 w-9 items-center justify-center rounded-full bg-surface/95 shadow-[var(--shadow-card)] hover:bg-surface sm:flex"
      >
        <Scale width={16} height={16} className={cn(compared && 'text-accent')} />
      </button>
      <button
        type="button"
        onClick={() => setQuickView(true)}
        aria-label={dict.common.quickView}
        className="hidden h-9 w-9 items-center justify-center rounded-full bg-surface/95 shadow-[var(--shadow-card)] hover:bg-surface sm:flex"
      >
        <Eye width={16} height={16} />
      </button>
    </div>
  );

  const swatches = product.colorKeys
    .slice(0, 5)
    .map((key) => (
      <span
        key={key}
        title={COLORS[key]?.label[locale] ?? key}
        className="h-3.5 w-3.5 rounded-full border border-line"
        style={{ background: COLORS[key]?.hex ?? '#ccc' }}
      />
    ));

  if (layout === 'list') {
    return (
      <>
        <article
          className={cn(
            'group relative flex gap-4 rounded-[var(--radius-md)] border border-line bg-surface p-3 sm:gap-6 sm:p-4',
            className,
          )}
        >
          <Link
            href={`/${locale}/product/${product.slug}`}
            className="relative block w-32 shrink-0 sm:w-56"
          >
            {badges}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image}
              alt={product.name}
              className="aspect-[4/3] w-full rounded-[var(--radius-sm)] bg-surface-2 object-cover"
              loading="lazy"
            />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-[12px] uppercase tracking-[0.1em] text-muted">{product.brandName}</p>
            <Link
              href={`/${locale}/product/${product.slug}`}
              className="mt-1 line-clamp-2 text-[15px] hover:text-accent"
            >
              {product.name}
            </Link>
            <p className="mt-1 line-clamp-1 text-[13px] text-muted">{product.shortDescription}</p>
            <div className="mt-2 flex items-center gap-3">
              <Rating value={product.ratingAvg} count={product.reviewCount} size={13} />
              <StockLine product={product} dict={dict} />
            </div>
            <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-3">
              <Price amountMinor={product.priceMinor} oldAmountMinor={product.oldPriceMinor} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setQuickView(true)}
                  className="h-10 rounded-[var(--radius-sm)] border border-line px-3 text-[13px] hover:border-ink"
                >
                  {dict.common.quickView}
                </button>
                <button
                  type="button"
                  onClick={add}
                  disabled={soldOut}
                  className="h-10 rounded-[var(--radius-sm)] bg-ink px-4 text-[13px] font-medium text-white disabled:opacity-40"
                >
                  {dict.common.addToCart}
                </button>
              </div>
            </div>
          </div>
          {actions}
        </article>
        {quickView ? (
          <QuickView
            slug={product.slug}
            locale={locale}
            dict={dict}
            onClose={() => setQuickView(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <article className={cn('group relative flex flex-col', className)}>
        <div className="relative overflow-hidden rounded-[var(--radius-md)] bg-surface-2">
          {badges}
          {actions}
          <Link href={`/${locale}/product/${product.slug}`} aria-label={product.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image}
              alt={product.name}
              className="aspect-[4/3] w-full object-cover transition-opacity duration-300 group-hover:opacity-0"
              loading="lazy"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.imageHover}
              alt=""
              aria-hidden
              className="absolute inset-0 aspect-[4/3] w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              loading="lazy"
            />
          </Link>
          <button
            type="button"
            onClick={add}
            disabled={soldOut}
            className="absolute inset-x-3 bottom-3 flex h-11 translate-y-2 items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-ink text-[13px] font-medium text-white opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 disabled:bg-muted max-md:hidden"
          >
            <ShoppingBag width={16} height={16} />
            {soldOut ? dict.common.outOfStock : dict.common.addToCart}
          </button>
        </div>

        <div className="flex flex-1 flex-col pt-3">
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted">{product.brandName}</p>
          <Link
            href={`/${locale}/product/${product.slug}`}
            className="mt-1 line-clamp-2 text-[14px] leading-snug hover:text-accent"
          >
            {product.name}
          </Link>
          <div className="mt-1.5 flex items-center gap-2">
            <Rating
              value={product.ratingAvg}
              count={product.reviewCount}
              size={12}
              showValue={false}
            />
            <span className="text-[12px] text-muted tabular-nums">
              {product.ratingAvg.toFixed(1)}
            </span>
          </div>
          {swatches.length > 1 ? <div className="mt-2 flex gap-1">{swatches}</div> : null}
          <div className="mt-auto pt-2.5">
            <Price
              amountMinor={product.priceMinor}
              oldAmountMinor={product.oldPriceMinor}
              size="sm"
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <StockLine product={product} dict={dict} />
              <button
                type="button"
                onClick={add}
                disabled={soldOut}
                aria-label={dict.common.addToCart}
                className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-surface-2 text-ink disabled:opacity-40 md:hidden"
              >
                <ShoppingBag width={17} height={17} />
              </button>
            </div>
          </div>
        </div>
      </article>
      {quickView ? (
        <QuickView
          slug={product.slug}
          locale={locale}
          dict={dict}
          onClose={() => setQuickView(false)}
        />
      ) : null}
    </>
  );
};
