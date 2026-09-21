'use client';

import { useEffect, useState } from 'react';
import type { Dictionary, Locale } from '@/lib/i18n';
import type { ProductCard } from '@/lib/catalog/types';
import { ProductCardView } from './product-card';
import { Skeleton } from '@/components/ui';

/**
 * Renders a list of products whose ids live in the browser (wishlist,
 * comparison). Ids come from localStorage; the cards come from the server.
 */
export const useProductsByIds = (ids: string[], locale: Locale) => {
  const [products, setProducts] = useState<ProductCard[] | null>(null);
  const key = ids.join(',');

  useEffect(() => {
    if (ids.length === 0) {
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
  }, [key, locale, ids.length]);

  return products;
};

export const ClientProductGrid = ({
  products,
  locale,
  dict,
}: {
  products: ProductCard[] | null;
  locale: Locale;
  dict: Dictionary;
}) => {
  if (products === null) {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index}>
            <Skeleton className="aspect-[4/3] w-full" />
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-2 h-4 w-1/3" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCardView key={product.id} product={product} locale={locale} dict={dict} />
      ))}
    </div>
  );
};
