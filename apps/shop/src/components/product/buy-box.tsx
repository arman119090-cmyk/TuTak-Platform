'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Heart,
  Scale,
  Share2,
  ShieldCheck,
  Truck,
  Wrench,
  Ruler,
  MessageSquare,
} from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { fill } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { FREE_DELIVERY_THRESHOLD_MINOR, SERVICES, regionByKey } from '@/config/site';
import { Badge, Button, Price, Rating } from '@/components/ui';
import { OptionPicker, QuantityStepper, type ProductOptionView } from './option-picker';
import { RequestDialog } from '@/components/forms/request-dialog';
import { useStore } from '@/components/providers/store-provider';
import { cn } from '@/lib/utils';

export type BuyBoxProduct = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  image: string;
  brandName: string;
  collectionName: string | null;
  categorySlug: string;
  priceMinor: number;
  oldPriceMinor: number | null;
  discountPct: number;
  ratingAvg: number;
  reviewCount: number;
  stockStatus: 'IN_STOCK' | 'ON_ORDER' | 'OUT_OF_STOCK';
  stockQty: number;
  productionDays: number;
  warrantyMonths: number;
  isNew: boolean;
  isHit: boolean;
  isPremium: boolean;
  options: ProductOptionView[];
};

/**
 * Everything to the right of the gallery: variants, quantity, the two purchase
 * buttons, wishlist/compare/share and the service promises.
 */
export const BuyBox = ({
  product,
  locale,
  dict,
  hidePurchase = false,
}: {
  product: BuyBoxProduct;
  locale: Locale;
  dict: Dictionary;
  /** Doors buy through the configurator instead. */
  hidePurchase?: boolean;
}) => {
  const router = useRouter();
  const { addToCart, isFavorite, toggleFavorite, isCompared, toggleCompare, toast, pushRecent } =
    useStore();
  const [quantity, setQuantity] = useState(1);
  const [dialog, setDialog] = useState<null | 'price' | 'consultation' | 'custom'>(null);
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const option of product.options)
      if (!defaults[option.kind]) defaults[option.kind] = option.valueKey;
    return defaults;
  });

  useEffect(() => {
    pushRecent({ productId: product.id, slug: product.slug });
    void fetch('/api/recently-viewed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId: product.id }),
    }).catch(() => null);
  }, [product.id, product.slug, pushRecent]);

  const delta = Object.entries(selected).reduce((sum, [kind, valueKey]) => {
    const option = product.options.find((item) => item.kind === kind && item.valueKey === valueKey);
    return sum + (option?.priceDeltaMinor ?? 0);
  }, 0);
  const unitPrice = product.priceMinor + delta;
  const favorite = isFavorite(product.id);
  const compared = isCompared(product.id);
  const soldOut = product.stockStatus === 'OUT_OF_STOCK';

  const line = () => ({
    productId: product.id,
    quantity,
    options: selected,
    preview: {
      sku: product.sku,
      slug: product.slug,
      name: product.name,
      image: product.image,
      priceMinor: unitPrice,
    },
  });

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: product.name, url }).catch(() => null);
      return;
    }
    await navigator.clipboard.writeText(url).catch(() => null);
    toast(dict.toast.linkCopied);
  };

  const yerevan = regionByKey('yerevan');

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {product.discountPct > 0 ? <Badge tone="sale">−{product.discountPct}%</Badge> : null}
        {product.isNew ? <Badge tone="new">{dict.badges.new}</Badge> : null}
        {product.isHit ? <Badge tone="hit">{dict.badges.hit}</Badge> : null}
        {product.isPremium ? <Badge tone="premium">{dict.badges.premium}</Badge> : null}
      </div>

      <p className="text-[12px] uppercase tracking-[0.12em] text-muted">
        {product.brandName}
        {product.collectionName ? ` · ${product.collectionName}` : ''}
      </p>
      <h1 className="mt-2 text-[26px] leading-tight md:text-[34px]">{product.name}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <Rating value={product.ratingAvg} count={product.reviewCount} />
        <span className="text-muted">
          {dict.common.sku}: <span className="text-ink-soft">{product.sku}</span>
        </span>
        {product.stockStatus === 'IN_STOCK' ? (
          <span className="text-success">
            {fill(dict.product.inStockQty, { qty: product.stockQty })}
          </span>
        ) : product.stockStatus === 'ON_ORDER' ? (
          <span className="text-muted">
            {fill(dict.product.productionDays, { days: product.productionDays || 14 })}
          </span>
        ) : (
          <span className="text-sale">{dict.common.outOfStock}</span>
        )}
      </div>

      <div className="mt-5">
        <Price
          amountMinor={unitPrice}
          oldAmountMinor={product.oldPriceMinor ? product.oldPriceMinor + delta : null}
          size="lg"
        />
        <p className="mt-1 text-[12px] text-muted">{dict.product.installments}</p>
      </div>

      {product.options.length > 0 ? (
        <div className="mt-6">
          <OptionPicker
            options={product.options}
            selected={selected}
            onSelect={(kind, valueKey) =>
              setSelected((current) => ({ ...current, [kind]: valueKey }))
            }
            locale={locale}
            dict={dict}
          />
        </div>
      ) : null}

      {!hidePurchase ? (
        <div className="mt-7 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <QuantityStepper value={quantity} onChange={setQuantity} label={dict.common.quantity} />
            <Button
              size="lg"
              className="min-w-[180px] flex-1"
              disabled={soldOut}
              onClick={() => {
                addToCart(line());
                toast(dict.toast.addedToCart);
              }}
            >
              {soldOut ? dict.common.outOfStock : dict.common.addToCart}
            </Button>
          </div>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            disabled={soldOut}
            onClick={() => {
              addToCart(line());
              router.push(`/${locale}/checkout`);
            }}
          >
            {dict.common.buyNow}
          </Button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
        <button
          type="button"
          onClick={() => {
            toggleFavorite(product.id);
            toast(favorite ? dict.toast.removedFromFavorites : dict.toast.addedToFavorites);
          }}
          className={cn(
            'inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border px-3',
            favorite ? 'border-sale text-sale' : 'border-line hover:border-ink',
          )}
        >
          <Heart width={16} height={16} className={cn(favorite && 'fill-sale')} />
          {favorite ? dict.product.inFavorites : dict.product.addToFavorites}
        </button>
        <button
          type="button"
          onClick={() => {
            const result = toggleCompare({
              productId: product.id,
              categorySlug: product.categorySlug,
              slug: product.slug,
            });
            if (result === 'limit') toast(dict.compare.limitReached, 'error');
            else if (result === 'category') toast(dict.compare.differentCategory, 'error');
            else
              toast(result === 'added' ? dict.toast.addedToCompare : dict.compare.remove, 'info');
          }}
          className={cn(
            'inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border px-3',
            compared ? 'border-accent text-accent' : 'border-line hover:border-ink',
          )}
        >
          <Scale width={16} height={16} />
          {compared ? dict.product.inCompare : dict.product.addToCompare}
        </button>
        <button
          type="button"
          onClick={share}
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-line px-3 hover:border-ink"
        >
          <Share2 width={16} height={16} />
          {dict.common.share}
        </button>
      </div>

      <ul className="mt-6 space-y-3 rounded-[var(--radius-md)] bg-surface-2 p-4 text-[13px]">
        <li className="flex gap-3">
          <Truck width={17} height={17} className="mt-0.5 shrink-0 text-accent" />
          <span>
            {fill(dict.product.deliveryYerevan, {
              price: formatMoney(yerevan?.deliveryMinor ?? 5000),
            })}
            .{' '}
            <span className="text-muted">
              {fill(dict.product.freeDeliveryFrom, {
                price: formatMoney(FREE_DELIVERY_THRESHOLD_MINOR),
              })}
            </span>
          </span>
        </li>
        <li className="flex gap-3">
          <Wrench width={17} height={17} className="mt-0.5 shrink-0 text-accent" />
          <span>
            {fill(dict.product.assemblyFrom, { price: formatMoney(SERVICES.assembly.priceMinor) })}
          </span>
        </li>
        <li className="flex gap-3">
          <ShieldCheck width={17} height={17} className="mt-0.5 shrink-0 text-accent" />
          <span>{fill(dict.product.warrantyMonths, { months: product.warrantyMonths })}</span>
        </li>
      </ul>

      <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
        <button
          type="button"
          onClick={() => setDialog('price')}
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-line px-3 hover:border-ink"
        >
          <MessageSquare width={16} height={16} /> {dict.product.askPrice}
        </button>
        <button
          type="button"
          onClick={() => setDialog('custom')}
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-line px-3 hover:border-ink"
        >
          <Ruler width={16} height={16} /> {dict.product.customSize}
        </button>
        <button
          type="button"
          onClick={() => setDialog('consultation')}
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-line px-3 hover:border-ink"
        >
          {dict.product.consultation}
        </button>
      </div>

      {dialog ? (
        <RequestDialog
          type={
            dialog === 'price'
              ? 'PRICE_REQUEST'
              : dialog === 'custom'
                ? 'CUSTOM_SIZE'
                : 'CONSULTATION'
          }
          title={
            dialog === 'price'
              ? dict.forms.priceRequestTitle
              : dialog === 'custom'
                ? dict.forms.customSizeTitle
                : dict.forms.consultationTitle
          }
          text={dialog === 'custom' ? dict.forms.customSizeText : undefined}
          locale={locale}
          dict={dict}
          productId={product.id}
          payload={{ sku: product.sku, selected: JSON.stringify(selected) }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
};
