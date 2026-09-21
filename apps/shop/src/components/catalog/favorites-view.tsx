'use client';

import { Heart } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { Button, EmptyState, LinkButton } from '@/components/ui';
import { useStore } from '@/components/providers/store-provider';
import { ClientProductGrid, useProductsByIds } from './client-product-list';

export const FavoritesView = ({ locale, dict }: { locale: Locale; dict: Dictionary }) => {
  const { favorites, ready, addToCart, toast } = useStore();
  const products = useProductsByIds(favorites, locale);

  if (ready && favorites.length === 0) {
    return (
      <EmptyState
        icon={<Heart width={40} height={40} strokeWidth={1.4} />}
        title={dict.favorites.empty}
        text={dict.favorites.emptyText}
        action={<LinkButton href={`/${locale}/catalog`}>{dict.cart.toCatalog}</LinkButton>}
      />
    );
  }

  return (
    <>
      {products && products.length > 0 ? (
        <div className="mb-6">
          <Button
            variant="outline"
            onClick={() => {
              for (const product of products) {
                if (product.stockStatus === 'OUT_OF_STOCK') continue;
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
              }
              toast(dict.toast.addedToCart);
            }}
          >
            {dict.favorites.addAllToCart}
          </Button>
        </div>
      ) : null}
      <ClientProductGrid products={products} locale={locale} dict={dict} />
    </>
  );
};
