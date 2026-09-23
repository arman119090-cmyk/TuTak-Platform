"use client";

import { useState, useTransition } from "react";
import { addToCartAction } from "@/app/actions/cart";
import { useI18n } from "@/i18n/provider";
import { track, type AnalyticsItem } from "@/components/analytics/track";
import { useCartUI } from "@/components/cart/cart-ui";
import { IconCheck, IconPlus } from "@/components/ui/icons";

export function QuickAdd({ variantId, item, listName }: { variantId: string; item: AnalyticsItem; listName?: string }) {
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
      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-white/90 text-sm font-semibold text-ink shadow-sm backdrop-blur transition-all duration-300 hover:bg-white md:translate-y-2 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100 md:focus-visible:translate-y-0 md:focus-visible:opacity-100"
    >
      {state === "added" ? <IconCheck width={18} height={18} /> : <IconPlus width={18} height={18} />}
      <span>{state === "added" ? m.product.added : state === "error" ? m.product.unavailable : m.product.quickAdd}</span>
    </button>
  );
}
