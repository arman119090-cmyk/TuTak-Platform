'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, ShoppingBag, Tag, Trash2, X } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { fill } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { FREE_DELIVERY_THRESHOLD_MINOR } from '@/config/site';
import type { Quote } from '@/lib/pricing/types';
import { Alert, Button, EmptyState, Input, LinkButton, Skeleton } from '@/components/ui';
import { QuantityStepper } from '@/components/product/option-picker';
import { useStore } from '@/components/providers/store-provider';
import { optionLabel } from '@/components/product/option-picker';

/**
 * Cart.
 *
 * The lines come from localStorage so the page paints instantly; every number
 * is then replaced by the server's quote. If the two disagree, the server wins.
 */
export const CartView = ({ locale, dict }: { locale: Locale; dict: Dictionary }) => {
  const { cart, ready, setQuantity, removeFromCart, promoCode, setPromoCode, toast } = useStore();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [promoInput, setPromoInput] = useState(promoCode ?? '');
  const [promoError, setPromoError] = useState<string | null>(null);

  const refresh = useCallback(
    async (code: string | null) => {
      if (cart.length === 0) {
        setQuote(null);
        return;
      }
      setLoading(true);
      try {
        const response = await fetch('/api/cart/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            items: cart.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              options: line.options,
              doorConfig: line.doorConfig,
            })),
            promoCode: code,
            locale,
          }),
        });
        if (!response.ok) return;
        const data = (await response.json()) as Quote;
        setQuote(data);
        if (code && data.promoRejection) {
          setPromoError(
            data.promoRejection === 'MIN_SUBTOTAL'
              ? fill(dict.cart.promoMinSubtotal, {
                  amount: formatMoney(data.promoMinSubtotalMinor ?? 0),
                })
              : dict.cart.promoInvalid,
          );
          setPromoCode(null);
        } else if (code) {
          setPromoError(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [cart, locale, dict, setPromoCode],
  );

  useEffect(() => {
    if (!ready) return;
    void refresh(promoCode);
  }, [ready, refresh, promoCode]);

  if (!ready) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Skeleton className="h-64" />
        <Skeleton className="h-56" />
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingBag width={40} height={40} strokeWidth={1.4} />}
        title={dict.cart.empty}
        text={dict.cart.emptyText}
        action={<LinkButton href={`/${locale}/catalog`}>{dict.cart.toCatalog}</LinkButton>}
      />
    );
  }

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoCode(code);
    await refresh(code);
  };

  const freeDeliveryGap = quote
    ? FREE_DELIVERY_THRESHOLD_MINOR - (quote.subtotalMinor - quote.promoDiscountMinor)
    : 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div>
        <ul className="space-y-3">
          {cart.map((line, index) => {
            const quoted = quote?.lines.find(
              (item) =>
                item.productId === line.productId &&
                JSON.stringify(item.options) === JSON.stringify(line.options),
            );
            const unit = quoted?.unitPriceMinor ?? line.preview.priceMinor;
            return (
              <li
                key={`${line.productId}-${index}`}
                className="flex gap-3 rounded-[var(--radius-md)] border border-line bg-surface p-3 sm:gap-4 sm:p-4"
              >
                <Link href={`/${locale}/product/${line.preview.slug}`} className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={line.preview.image}
                    alt=""
                    className="h-20 w-24 rounded-[var(--radius-sm)] bg-surface-2 object-cover sm:h-24 sm:w-32"
                  />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/${locale}/product/${line.preview.slug}`}
                      className="line-clamp-2 text-[14px] hover:text-accent"
                    >
                      {line.preview.name}
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        removeFromCart(index);
                        toast(dict.toast.removedFromCart, 'info');
                      }}
                      aria-label={dict.cart.removeItem}
                      className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-sale"
                    >
                      <Trash2 width={16} height={16} />
                    </button>
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {dict.common.sku}: {line.preview.sku}
                  </p>
                  {Object.keys(line.options).length > 0 ? (
                    <p className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-muted">
                      {Object.entries(line.options).map(([kind, value]) => (
                        <span key={kind}>
                          {optionLabel(
                            {
                              kind: kind as 'COLOR',
                              valueKey: value,
                              label: null,
                              priceDeltaMinor: 0,
                            },
                            locale,
                          )}
                        </span>
                      ))}
                    </p>
                  ) : null}
                  {line.doorConfig ? (
                    <p className="mt-1 text-[12px] text-muted">
                      {dict.door.configuratorTitle}: {Object.values(line.doorConfig).join(' · ')}
                    </p>
                  ) : null}
                  <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-3">
                    <QuantityStepper
                      value={line.quantity}
                      onChange={(value) => setQuantity(index, value)}
                      label={dict.common.quantity}
                    />
                    <div className="text-right">
                      <p className="text-[17px] font-semibold tabular-nums">
                        {formatMoney(unit * line.quantity)}
                      </p>
                      {line.quantity > 1 ? (
                        <p className="text-[12px] text-muted tabular-nums">
                          {formatMoney(unit)} × {line.quantity}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {quote && quote.warnings.length > 0 ? (
          <div className="mt-4">
            <Alert tone="warning">{dict.cart.deliveryCalculated}</Alert>
          </div>
        ) : null}
      </div>

      <aside className="lg:sticky lg:top-[170px] lg:self-start">
        <div className="rounded-[var(--radius-md)] border border-line bg-surface p-5">
          <h2 className="text-[19px]">{dict.checkout.yourOrder}</h2>

          <div className="mt-4">
            <div className="flex gap-2">
              <Input
                value={promoInput}
                onChange={(event) => setPromoInput(event.target.value.toUpperCase())}
                placeholder={dict.cart.promoPlaceholder}
                aria-label={dict.cart.promoPlaceholder}
              />
              <Button variant="secondary" onClick={applyPromo}>
                {dict.cart.promoApply}
              </Button>
            </div>
            {promoError ? <p className="mt-2 text-[12px] text-sale">{promoError}</p> : null}
            {quote?.promoCode ? (
              <p className="mt-2 flex items-center gap-2 text-[12px] text-success">
                <Tag width={13} height={13} />
                {fill(dict.cart.promoApplied, { code: quote.promoCode })}
                <button
                  type="button"
                  onClick={() => {
                    setPromoCode(null);
                    setPromoInput('');
                    void refresh(null);
                  }}
                  aria-label={dict.cart.promoRemove}
                  className="text-muted hover:text-sale"
                >
                  <X width={13} height={13} />
                </button>
              </p>
            ) : null}
          </div>

          <dl className="mt-5 space-y-2 border-t border-line pt-4 text-[14px]">
            <div className="flex justify-between">
              <dt className="text-muted">{dict.cart.subtotal}</dt>
              <dd className="tabular-nums">{quote ? formatMoney(quote.subtotalMinor) : '—'}</dd>
            </div>
            {quote && quote.itemsDiscountMinor > 0 ? (
              <div className="flex justify-between text-success">
                <dt>{dict.cart.discount}</dt>
                <dd className="tabular-nums">−{formatMoney(quote.itemsDiscountMinor)}</dd>
              </div>
            ) : null}
            {quote && quote.promoDiscountMinor > 0 ? (
              <div className="flex justify-between text-success">
                <dt>{dict.cart.promoDiscount}</dt>
                <dd className="tabular-nums">−{formatMoney(quote.promoDiscountMinor)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-muted">{dict.cart.delivery}</dt>
              <dd className="text-[13px] text-muted">{dict.cart.deliveryCalculated}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-3 text-base">
              <dt className="font-medium">{dict.cart.total}</dt>
              <dd className="text-[24px] font-semibold tabular-nums">
                {quote ? formatMoney(quote.subtotalMinor - quote.promoDiscountMinor) : '—'}
                {loading ? (
                  <Loader2 width={14} height={14} className="ml-2 inline animate-spin" />
                ) : null}
              </dd>
            </div>
          </dl>

          {freeDeliveryGap > 0 ? (
            <p className="mt-3 rounded-[var(--radius-sm)] bg-surface-2 px-3 py-2 text-[12px] text-muted">
              {fill(dict.product.freeDeliveryFrom, {
                price: formatMoney(FREE_DELIVERY_THRESHOLD_MINOR),
              })}
            </p>
          ) : null}

          <LinkButton href={`/${locale}/checkout`} size="lg" className="mt-5 w-full">
            {dict.cart.checkout}
          </LinkButton>
          <Link
            href={`/${locale}/catalog`}
            className="mt-3 block text-center text-[13px] text-muted hover:text-ink"
          >
            {dict.cart.continue}
          </Link>
        </div>
      </aside>
    </div>
  );
};
