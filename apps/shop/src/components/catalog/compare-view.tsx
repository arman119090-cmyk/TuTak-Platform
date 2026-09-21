'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Scale, X } from 'lucide-react';
import { COLORS, MATERIALS, specLabel, specValueLabel } from '@/data/attributes';
import type { Dictionary, Locale } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { Button, Checkbox, EmptyState, LinkButton, Rating } from '@/components/ui';
import { useStore } from '@/components/providers/store-provider';
import { cn } from '@/lib/utils';
import { useProductsByIds } from './client-product-list';

type Row = { label: string; values: string[] };

/**
 * Comparison table.
 *
 * Rows where the products differ are highlighted, and "differences only" hides
 * the rest — which is the only reason anyone opens a comparison table.
 */
export const CompareView = ({ locale, dict }: { locale: Locale; dict: Dictionary }) => {
  const { compare, ready, toggleCompare, clearCompare, addToCart, toast } = useStore();
  const [onlyDiff, setOnlyDiff] = useState(false);
  const products = useProductsByIds(
    compare.map((item) => item.productId),
    locale,
  );

  if (ready && compare.length === 0) {
    return (
      <EmptyState
        icon={<Scale width={40} height={40} strokeWidth={1.4} />}
        title={dict.compare.empty}
        text={dict.compare.emptyText}
        action={<LinkButton href={`/${locale}/catalog`}>{dict.cart.toCatalog}</LinkButton>}
      />
    );
  }
  if (!products || products.length === 0) return null;

  const specKeys = [...new Set(products.flatMap((product) => Object.keys(product.specs)))];

  const rows: Row[] = [
    {
      label: dict.common.price,
      values: products.map((product) => formatMoney(product.priceMinor)),
    },
    { label: dict.catalog.brand, values: products.map((product) => product.brandName) },
    { label: dict.catalog.rating, values: products.map((product) => product.ratingAvg.toFixed(1)) },
    {
      label: dict.catalog.availability,
      values: products.map((product) =>
        product.stockStatus === 'IN_STOCK'
          ? dict.common.inStock
          : product.stockStatus === 'ON_ORDER'
            ? dict.common.onOrder
            : dict.common.outOfStock,
      ),
    },
    {
      label: dict.catalog.color,
      values: products.map((product) =>
        product.colorKeys.map((key) => COLORS[key]?.label[locale] ?? key).join(', '),
      ),
    },
    {
      label: dict.catalog.material,
      values: products.map((product) =>
        product.materialKeys.map((key) => MATERIALS[key]?.label[locale] ?? key).join(', '),
      ),
    },
    {
      label: dict.product.dimensions,
      values: products.map((product) =>
        [product.widthMm, product.depthMm, product.heightMm]
          .filter(Boolean)
          .map((value) => Math.round((value as number) / 10))
          .join(' × '),
      ),
    },
    ...specKeys.map((key) => ({
      label: specLabel(key, locale),
      values: products.map((product) => {
        const value = product.specs[key];
        return value === undefined ? '—' : specValueLabel(key, value, locale);
      }),
    })),
  ];

  const isDifferent = (row: Row) => new Set(row.values).size > 1;
  const visibleRows = onlyDiff ? rows.filter(isDifferent) : rows;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Checkbox
          label={dict.compare.onlyDifferences}
          checked={onlyDiff}
          onChange={(event) => setOnlyDiff(event.target.checked)}
        />
        <button
          type="button"
          onClick={clearCompare}
          className="text-[13px] text-muted hover:text-sale"
        >
          {dict.compare.clearAll}
        </button>
      </div>

      <div className="hide-scrollbar overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="w-40 bg-surface p-2 text-left align-top" />
              {products.map((product) => (
                <th key={product.id} className="w-56 p-2 text-left align-top font-normal">
                  <div className="relative rounded-[var(--radius-md)] border border-line bg-surface p-3">
                    <button
                      type="button"
                      onClick={() =>
                        toggleCompare({
                          productId: product.id,
                          categorySlug: product.categorySlug,
                          slug: product.slug,
                        })
                      }
                      aria-label={dict.compare.remove}
                      className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-2"
                    >
                      <X width={15} height={15} />
                    </button>
                    <Link href={`/${locale}/product/${product.slug}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={product.image}
                        alt=""
                        className="aspect-[4/3] w-full rounded-[var(--radius-sm)] bg-surface-2 object-cover"
                      />
                      <span className="mt-2 block line-clamp-2 text-[13px]">{product.name}</span>
                    </Link>
                    <Rating
                      value={product.ratingAvg}
                      showValue={false}
                      size={12}
                      className="mt-1"
                    />
                    <p className="mt-1.5 text-[15px] font-semibold tabular-nums">
                      {formatMoney(product.priceMinor)}
                    </p>
                    <Button
                      size="sm"
                      className="mt-2 w-full"
                      onClick={() => {
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
                      }}
                    >
                      {dict.common.addToCart}
                    </Button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr
                key={`${row.label}-${index}`}
                className={cn(isDifferent(row) ? 'bg-accent-soft/40' : 'odd:bg-surface-2/40')}
              >
                <th scope="row" className="p-3 text-left align-top font-medium text-muted">
                  {row.label}
                </th>
                {row.values.map((value, valueIndex) => (
                  <td key={valueIndex} className="p-3 align-top">
                    {value || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};
