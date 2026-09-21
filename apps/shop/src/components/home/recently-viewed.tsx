'use client';

import { useEffect, useState } from 'react';
import type { Dictionary, Locale } from '@/lib/i18n';
import type { ProductCard } from '@/lib/catalog/types';
import { ProductRail } from '@/components/catalog/product-rail';
import { useStore } from '@/components/providers/store-provider';

/**
 * Recently viewed products.
 *
 * The list of ids lives in the browser; the cards are fetched from the server
 * so prices and stock are never stale.
 */
export const RecentlyViewed = ({
  locale,
  dict,
  excludeId,
  title,
}: {
  locale: Locale;
  dict: Dictionary;
  excludeId?: string;
  title?: string;
}) => {
  const { recent, ready } = useStore();
  const [products, setProducts] = useState<ProductCard[]>([]);

  const ids = recent
    .map((item) => item.productId)
    .filter((id) => id !== excludeId)
    .slice(0, 8);
  const key = ids.join(',');

  useEffect(() => {
    if (!ready || ids.length === 0) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/products/by-ids?ids=${key}&locale=${locale}`);
      if (!response.ok || cancelled) return;
      const data = (await response.json()) as { items: ProductCard[] };
      if (!cancelled) setProducts(data.items);
    })();
    return () => {
      cancelled = true;
    };
    // `key` is the stable serialisation of `ids`.
  }, [key, locale, ready, ids.length]);

  if (products.length === 0) return null;
  return (
    <ProductRail
      title={title ?? dict.home.recentlyViewed}
      products={products}
      locale={locale}
      dict={dict}
    />
  );
};
