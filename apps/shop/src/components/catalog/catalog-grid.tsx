'use client';

import { useSearchParams } from 'next/navigation';
import type { Dictionary, Locale } from '@/lib/i18n';
import type { ProductCard } from '@/lib/catalog/types';
import { ProductCardView } from './product-card';

export const CatalogGrid = ({
  products,
  locale,
  dict,
}: {
  products: ProductCard[];
  locale: Locale;
  dict: Dictionary;
}) => {
  const params = useSearchParams();
  const view = params.get('view') === 'list' ? 'list' : 'grid';

  if (view === 'list') {
    return (
      <div className="flex flex-col gap-3">
        {products.map((product) => (
          <ProductCardView
            key={product.id}
            product={product}
            locale={locale}
            dict={dict}
            layout="list"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 md:gap-x-6">
      {products.map((product) => (
        <ProductCardView key={product.id} product={product} locale={locale} dict={dict} />
      ))}
    </div>
  );
};
