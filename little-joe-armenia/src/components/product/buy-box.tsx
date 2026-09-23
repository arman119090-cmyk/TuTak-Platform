"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { addToCartAction } from "@/app/actions/cart";
import { fmt } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import { formatAmd } from "@/lib/money";
import { paths } from "@/lib/paths";
import { track } from "@/components/analytics/track";
import { useCartUI } from "@/components/cart/cart-ui";
import { Stepper } from "@/components/cart/cart-contents";

type Variant = { id: string; sku: string; label: string | null; priceAmd: number | null; compareAtAmd: number | null; priceIsDemo: boolean; available: number };

export function BuyBox({ variants, name, slug, collection }: { variants: Variant[]; name: string; slug: string; collection: string }) {
  const { m, locale } = useI18n();
  const ui = useCartUI();
  const router = useRouter();
  const purchasable = variants.filter((v) => v.priceAmd !== null);
  const [variantId, setVariantId] = useState(purchasable[0]?.id ?? null);
  const v = purchasable.find((x) => x.id === variantId) ?? null;
  const [qty, setQty] = useState(1);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const [showSticky, setShowSticky] = useState(false);

  useEffect(() => {
    const el = ctaRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setShowSticky(!entry!.isIntersecting && entry!.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!v || v.priceAmd === null) {
    return <p className="mt-6 font-semibold text-muted">{m.product.unavailable}</p>;
  }
  const soldOut = v.available <= 0;
  const max = Math.max(1, Math.min(20, v.available));
  const item = { item_id: slug, item_name: name, price: v.priceAmd, item_category: collection };

  const add = (thenCheckout: boolean) =>
    start(async () => {
      try {
        const r = await addToCartAction(v.id, qty);
        if (!r.ok) {
          setMessage(r.error === "RATE_LIMITED" ? m.common.rateLimited : m.product.soldOut);
          return;
        }
        setMessage(r.limited ? fmt(m.cart.quantityReduced, { count: r.quantity ?? 0 }) : null);
        ui.setCount(r.count);
        ui.touch();
        track("add_to_cart", { currency: "AMD", value: v.priceAmd! * qty, items: [{ ...item, quantity: qty }] });
        if (thenCheckout) router.push(paths.checkout(locale));
        else ui.open();
      } catch {
        setMessage(m.common.networkError);
      }
    });

  return (
    <div className="mt-6">
      <div className="flex items-baseline gap-3">
        <p className="text-3xl font-bold tabular-nums" data-testid="pdp-price">
          {formatAmd(v.priceAmd, locale)}
        </p>
        {v.compareAtAmd && v.compareAtAmd > v.priceAmd ? <p className="text-muted line-through tabular-nums">{formatAmd(v.compareAtAmd, locale)}</p> : null}
        {v.priceIsDemo ? <span className="rounded-full bg-warn/10 px-2.5 py-1 text-xs font-bold uppercase text-warn">{m.common.demoPrice}</span> : null}
      </div>
      <p
        className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold ${soldOut ? "bg-bad/10 text-bad" : v.available <= 3 ? "bg-warn/10 text-warn" : "bg-ok/10 text-ok"}`}
        data-testid="stock-status"
      >
        {soldOut ? m.product.soldOut : v.available <= 3 ? fmt(m.product.lowStock, { count: v.available }) : m.product.inStock}
      </p>

      {purchasable.length > 1 ? (
        <div className="mt-5 flex flex-wrap gap-2" role="radiogroup" aria-label={m.product.format}>
          {purchasable.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={x.id === v.id} className="chip" onClick={() => { setVariantId(x.id); setQty(1); }}>
              {x.label ?? x.sku}
            </button>
          ))}
        </div>
      ) : null}

      <div ref={ctaRef} className="mt-6 flex flex-wrap items-center gap-3">
        {!soldOut ? <Stepper value={qty} max={max} onChange={setQty} disabled={pending} /> : null}
        <button type="button" disabled={soldOut || pending} onClick={() => add(false)} className="btn btn-primary min-w-44 flex-1" data-testid="add-to-cart">
          {soldOut ? m.product.soldOut : m.product.addToCart}
        </button>
        {!soldOut ? (
          <button type="button" disabled={pending} onClick={() => add(true)} className="btn btn-ghost flex-1 sm:flex-none" data-testid="buy-now">
            {m.product.buyNow}
          </button>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="mt-3 text-sm text-bad">
          {message}
        </p>
      ) : null}

      {/* Sticky mobile add-to-cart once the main CTA scrolls away. */}
      {!soldOut ? (
        <div
          aria-hidden={!showSticky}
          className={`fixed inset-x-0 bottom-[calc(3.5rem+var(--safe-bottom))] z-20 border-t border-line bg-white/95 px-4 py-3 backdrop-blur transition-[transform,opacity] duration-300 md:hidden ${showSticky ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"}`}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="text-sm tabular-nums text-ink-2">{formatAmd(v.priceAmd, locale)}</p>
            </div>
            <button type="button" tabIndex={showSticky ? 0 : -1} disabled={pending} onClick={() => add(false)} className="btn btn-primary">
              {m.product.addToCart}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
