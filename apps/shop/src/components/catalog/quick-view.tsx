'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { Button, Price, Rating, Skeleton } from '@/components/ui';
import { Modal } from '@/components/ui/modal';
import { OptionPicker, QuantityStepper, type ProductOptionView } from '@/components/product/option-picker';
import { useStore } from '@/components/providers/store-provider';

type QuickViewData = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  shortDescription: string;
  priceMinor: number;
  oldPriceMinor: number | null;
  ratingAvg: number;
  reviewCount: number;
  stockStatus: 'IN_STOCK' | 'ON_ORDER' | 'OUT_OF_STOCK';
  images: string[];
  options: ProductOptionView[];
  brandName: string;
};

/** Lightweight product preview so browsing a grid never loses scroll position. */
export const QuickView = ({
  slug,
  locale,
  dict,
  onClose,
}: {
  slug: string;
  locale: Locale;
  dict: Dictionary;
  onClose: () => void;
}) => {
  const { addToCart, toast } = useStore();
  const [data, setData] = useState<QuickViewData | null>(null);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/product/${slug}?locale=${locale}`);
      if (!response.ok || cancelled) return;
      const payload = (await response.json()) as QuickViewData;
      if (cancelled) return;
      setData(payload);
      const defaults: Record<string, string> = {};
      for (const option of payload.options) {
        if (!defaults[option.kind]) defaults[option.kind] = option.valueKey;
      }
      setSelected(defaults);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, locale]);

  const deltas = data
    ? Object.entries(selected).reduce((sum, [kind, valueKey]) => {
        const option = data.options.find((item) => item.kind === kind && item.valueKey === valueKey);
        return sum + (option?.priceDeltaMinor ?? 0);
      }, 0)
    : 0;

  return (
    <Modal title={data?.name ?? dict.common.loading} onClose={onClose} size="lg">
      {!data ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <Skeleton className="aspect-[4/3] w-full" />
          <div className="space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.images[active] ?? data.images[0]}
              alt={data.name}
              className="aspect-[4/3] w-full rounded-[var(--radius-md)] bg-surface-2 object-cover"
            />
            <div className="mt-2 flex gap-2">
              {data.images.slice(0, 4).map((image, index) => (
                <button
                  key={image}
                  type="button"
                  onClick={() => setActive(index)}
                  className={`overflow-hidden rounded-[var(--radius-xs)] border-2 ${index === active ? 'border-ink' : 'border-transparent'}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="" className="h-14 w-20 bg-surface-2 object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col">
            <p className="text-[12px] uppercase tracking-[0.1em] text-muted">{data.brandName}</p>
            <div className="mt-2 flex items-center gap-3">
              <Rating value={data.ratingAvg} count={data.reviewCount} />
              <span className="text-[12px] text-muted">
                {dict.common.sku}: {data.sku}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted">{data.shortDescription}</p>
            <div className="mt-4">
              <Price amountMinor={data.priceMinor + deltas} oldAmountMinor={data.oldPriceMinor ? data.oldPriceMinor + deltas : null} size="lg" />
            </div>
            <div className="mt-5">
              <OptionPicker
                options={data.options}
                selected={selected}
                onSelect={(kind, valueKey) => setSelected((current) => ({ ...current, [kind]: valueKey }))}
                locale={locale}
                dict={dict}
              />
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <QuantityStepper value={quantity} onChange={setQuantity} label={dict.common.quantity} />
              <Button
                size="lg"
                className="flex-1"
                disabled={data.stockStatus === 'OUT_OF_STOCK'}
                onClick={() => {
                  addToCart({
                    productId: data.id,
                    quantity,
                    options: selected,
                    preview: {
                      sku: data.sku,
                      slug: data.slug,
                      name: data.name,
                      image: data.images[0] ?? '',
                      priceMinor: data.priceMinor + deltas,
                    },
                  });
                  toast(dict.toast.addedToCart);
                  onClose();
                }}
              >
                {dict.common.addToCart}
              </Button>
            </div>
            <Link
              href={`/${locale}/product/${data.slug}`}
              className="mt-4 text-[13px] text-accent hover:underline"
            >
              {dict.product.description} →
            </Link>
          </div>
        </div>
      )}
      {!data ? <Loader2 className="sr-only animate-spin" /> : null}
    </Modal>
  );
};
