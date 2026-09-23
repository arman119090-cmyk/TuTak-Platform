"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  applyPromoAction,
  getCartAction,
  removeItemAction,
  removePromoAction,
  saveForLaterAction,
  setQuantityAction,
  type CartSnapshot,
} from "@/app/actions/cart";
import { fmt } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import { formatAmd } from "@/lib/money";
import { paths } from "@/lib/paths";
import type { CartLineDTO } from "@/lib/domain/cart";
import { track } from "@/components/analytics/track";
import { useCartUI } from "@/components/cart/cart-ui";
import { ProductImage } from "@/components/product/product-image";
import { IconMinus, IconPlus } from "@/components/ui/icons";

/** Shared by the cart drawer and the /cart page. */
export function useCart(initial?: CartSnapshot) {
  const { locale } = useI18n();
  const ui = useCartUI();
  const [cart, setCart] = useState<CartSnapshot | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const next = await getCartAction(locale);
      setCart(next);
      ui.setCount(next.count);
      setError(null);
    } catch {
      setError("network");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const run = useCallback(
    (fn: () => Promise<unknown>) =>
      startTransition(async () => {
        try {
          await fn();
          await refresh();
        } catch {
          setError("network");
        }
      }),
    [refresh],
  );

  return { cart, setCart, refresh, run, pending, error, setError };
}

export function CartContents({ compact, initial }: { compact?: boolean; initial?: CartSnapshot }) {
  const { m, locale } = useI18n();
  const ui = useCartUI();
  const { cart, refresh, run, pending, error } = useCart(initial);

  useEffect(() => {
    if (!initial || ui.version > 0) void refresh();
  }, [ui.version, refresh, initial]);

  if (!cart) {
    return (
      <div className="space-y-3 p-5" aria-busy="true" aria-label={m.common.loading}>
        {[0, 1].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-mist" />
        ))}
      </div>
    );
  }

  if (cart.lines.length === 0 && cart.saved.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <p className="text-lg font-semibold">{m.cart.empty}</p>
        <Link href={paths.shop(locale)} onClick={ui.close} className="btn btn-primary mt-6">
          {m.cart.emptyCta}
        </Link>
      </div>
    );
  }

  const remove = (l: CartLineDTO) =>
    run(async () => {
      await removeItemAction(l.id);
      track("remove_from_cart", { currency: "AMD", value: l.lineAmd, items: [{ item_id: l.sku, item_name: l.name, price: l.unitAmd, quantity: l.quantity }] });
    });

  return (
    <div className={compact ? "px-5 py-4" : ""}>
      {error ? (
        <p role="alert" className="mb-4 rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">
          {m.common.networkError}
        </p>
      ) : null}
      <FreeDeliveryBar remaining={cart.totals.freeDeliveryRemainingAmd} threshold={cart.freeDeliveryFromAmd} />
      <ul className="divide-y divide-line" aria-busy={pending}>
        {cart.lines.map((l) => (
          <li key={l.id} className="flex gap-4 py-4" data-testid="cart-line">
            <Link href={paths.product(locale, l.slug)} onClick={ui.close} className="shrink-0">
              <div className="size-20 overflow-hidden rounded-2xl sm:size-24" style={{ background: l.accent }}>
                <ProductImage media={l.image} accent={l.accent} sizes="96px" />
              </div>
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted">{l.collectionName}</p>
                  <Link href={paths.product(locale, l.slug)} onClick={ui.close} className="block truncate font-semibold hover:underline">
                    {l.name}
                  </Link>
                </div>
                <p className="shrink-0 font-semibold tabular-nums">{formatAmd(l.lineAmd, locale)}</p>
              </div>
              {!l.purchasable ? (
                <p className="mt-1 text-sm text-bad">
                  {l.available > 0 ? fmt(m.cart.quantityReduced, { count: l.available }) : m.cart.itemUnavailable}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Stepper
                  value={l.quantity}
                  max={Math.max(1, Math.min(20, l.available))}
                  disabled={pending}
                  onChange={(q) => run(() => setQuantityAction(l.id, q))}
                />
                <button type="button" className="tap text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => run(() => saveForLaterAction(l.id, true))}>
                  {m.cart.saveForLater}
                </button>
                <button type="button" className="tap text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => remove(l)}>
                  {m.common.remove}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {cart.saved.length > 0 ? (
        <section className="mt-6">
          <h3 className="eyebrow mb-2">{m.cart.savedForLater}</h3>
          <ul className="divide-y divide-line">
            {cart.saved.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-3">
                <div className="size-12 shrink-0 overflow-hidden rounded-xl" style={{ background: l.accent }}>
                  <ProductImage media={l.image} accent={l.accent} sizes="48px" />
                </div>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</p>
                <button type="button" className="tap text-sm font-semibold underline-offset-4 hover:underline" onClick={() => run(() => saveForLaterAction(l.id, false))}>
                  {m.cart.moveToCart}
                </button>
                <button type="button" className="tap text-sm text-muted" onClick={() => run(() => removeItemAction(l.id))}>
                  {m.common.remove}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cart.lines.length > 0 ? (
        <>
          <PromoForm code={cart.promoCode} promoOk={cart.promo?.ok ?? false} onChange={refresh} />
          <dl className="mt-5 space-y-2 text-[0.95rem]">
            <Row label={m.cart.subtotal} value={formatAmd(cart.totals.subtotalAmd, locale)} />
            {cart.totals.discountAmd > 0 ? <Row label={m.cart.discount} value={formatAmd(-cart.totals.discountAmd, locale)} /> : null}
            <Row label={m.cart.delivery} value={m.cart.deliveryAtCheckout} muted />
            <div className="flex items-baseline justify-between border-t border-line pt-3 text-lg font-bold">
              <dt>{m.cart.total}</dt>
              <dd className="tabular-nums" data-testid="cart-total">
                {formatAmd(cart.totals.subtotalAmd - cart.totals.discountAmd, locale)}
              </dd>
            </div>
          </dl>
          <div className="mt-5 grid gap-2">
            <Link
              href={paths.checkout(locale)}
              onClick={ui.close}
              aria-disabled={cart.hasProblems}
              className={`btn btn-primary w-full ${cart.hasProblems ? "pointer-events-none opacity-45" : ""}`}
              data-testid="checkout-link"
            >
              {m.cart.checkout}
            </Link>
            {compact ? (
              <Link href={paths.cart(locale)} onClick={ui.close} className="btn btn-ghost w-full">
                {m.cart.viewCart}
              </Link>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-2">{label}</dt>
      <dd className={`tabular-nums ${muted ? "text-sm text-muted" : "font-medium"}`}>{value}</dd>
    </div>
  );
}

function FreeDeliveryBar({ remaining, threshold }: { remaining: number | null; threshold: number | null }) {
  const { m, locale } = useI18n();
  if (remaining === null || threshold === null || threshold <= 0) return null;
  const pct = Math.min(100, Math.round(((threshold - remaining) / threshold) * 100));
  return (
    <div className="mb-2 rounded-2xl bg-mist px-4 py-3">
      <p className="text-sm font-medium">
        {remaining > 0 ? fmt(m.cart.freeDeliveryLeft, { amount: formatAmd(remaining, locale) }) : m.cart.freeDeliveryReached}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Stepper({
  value,
  max,
  onChange,
  disabled,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const { m } = useI18n();
  return (
    <div className="inline-flex items-center rounded-full ring-1 ring-line-strong" role="group" aria-label={m.product.quantity}>
      <button
        type="button"
        className="tap inline-flex items-center justify-center rounded-full disabled:opacity-35"
        aria-label={m.product.decrease}
        disabled={disabled || value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <IconMinus width={18} height={18} />
      </button>
      <output className="w-7 text-center font-semibold tabular-nums" aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        className="tap inline-flex items-center justify-center rounded-full disabled:opacity-35"
        aria-label={m.product.increase}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        <IconPlus width={18} height={18} />
      </button>
    </div>
  );
}

function PromoForm({ code, promoOk, onChange }: { code: string | null; promoOk: boolean; onChange: () => void }) {
  const { m, locale } = useI18n();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (code && promoOk) {
    return (
      <div className="mt-5 flex items-center justify-between rounded-2xl bg-ok/10 px-4 py-3 text-sm">
        <span className="font-medium text-ok" data-testid="promo-applied">
          {fmt(m.cart.promoApplied, { code })}
        </span>
        <button type="button" className="tap font-semibold underline" onClick={() => start(async () => { await removePromoAction(); onChange(); })}>
          {m.cart.promoRemove}
        </button>
      </div>
    );
  }

  return (
    <form
      className="mt-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          try {
            const r = await applyPromoAction(value);
            if (r.ok) {
              setMessage(null);
              setValue("");
              onChange();
            } else if (r.reason === "RATE_LIMITED" || r.reason === "INVALID") {
              setMessage(r.reason === "RATE_LIMITED" ? m.common.rateLimited : m.cart.promoErrors.NOT_FOUND);
            } else {
              setMessage(fmt(m.cart.promoErrors[r.reason], { amount: r.minSubtotalAmd ? formatAmd(r.minSubtotalAmd, locale) : "" }));
            }
          } catch {
            setMessage(m.common.networkError);
          }
        });
      }}
    >
      <label htmlFor="promo" className="label">
        {m.cart.promoCode}
      </label>
      <div className="flex gap-2">
        <input
          id="promo"
          name="promo"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          className="field"
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? "promo-msg" : undefined}
        />
        <button type="submit" className="btn btn-ghost shrink-0" disabled={pending || value.trim().length < 2}>
          {m.cart.promoApply}
        </button>
      </div>
      {message ? (
        <p id="promo-msg" role="alert" className="mt-2 text-sm text-bad">
          {message}
        </p>
      ) : null}
    </form>
  );
}
