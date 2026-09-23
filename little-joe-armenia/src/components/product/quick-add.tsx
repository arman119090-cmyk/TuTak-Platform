"use client";

import { useState, useTransition } from "react";
import { addToCartAction } from "@/app/actions/cart";
import { useI18n } from "@/i18n/provider";
import { track, type AnalyticsItem } from "@/components/analytics/track";
import { useCartUI } from "@/components/cart/cart-ui";
import { IconCheck, IconPlus } from "@/components/ui/icons";

export function QuickAdd({
  variantId,
  item,
  listName,
  compact,
}: {
  variantId: string;
  item: AnalyticsItem;
  listName?: string;
  /** Round "+" button (product cards); the label stays available to screen readers. */
  compact?: boolean;
}) {
  const { m } = useI18n();
  const ui = useCartUI();
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "added" | "error">("idle");

  return (
    <button
      type="button"
      disabled={pending}
      data-testid="quick-add"
      onClick={() =>
        start(async () => {
          try {
            const r = await addToCartAction(variantId, 1);
            if (!r.ok) {
              setState("error");
              return;
            }
            ui.setCount(r.count);
            ui.touch();
            setState("added");
            track("add_to_cart", { currency: "AMD", value: item.price, items: [{ ...item, quantity: 1 }], item_list_name: listName });
            setTimeout(() => setState("idle"), 1600);
            ui.open();
          } catch {
            setState("error");
          }
        })
      }
      aria-label={compact ? (state === "added" ? m.product.added : state === "error" ? m.product.unavailable : m.product.addToCart) : undefined}
      title={compact ? m.product.addToCart : undefined}
      className={
        compact
          ? "grid size-11 shrink-0 place-items-center rounded-full bg-brand text-white shadow-[0_10px_20px_-10px_rgb(0_104_184/0.9)] transition-[background-color,transform] duration-300 hover:bg-brand-600 active:scale-95 disabled:opacity-50"
          : "btn btn-primary min-h-10 w-full rounded-xl px-3 text-sm"
      }
    >
      {compact ? (
        state === "added" ? <IconCheck width={18} height={18} /> : <IconPlus width={18} height={18} />
      ) : (
        <>
          {state === "added" ? <IconCheck width={18} height={18} /> : null}
          <span>{state === "added" ? m.product.added : state === "error" ? m.product.unavailable : m.product.addToCart}</span>
        </>
      )}
    </button>
  );
}
