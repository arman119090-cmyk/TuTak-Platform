"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toggleFavoriteAction } from "@/app/actions/cart";
import { useI18n } from "@/i18n/provider";
import { IconHeart } from "@/components/ui/icons";

export function FavoriteButton({ productId, initial, variant = "floating" }: { productId: string; initial: boolean; variant?: "floating" | "inline" }) {
  const { m } = useI18n();
  const [fav, setFav] = useState(initial);
  const [optimistic, setOptimistic] = useOptimistic(fav);
  const [, start] = useTransition();
  const label = optimistic ? m.product.removeFavorite : m.product.addFavorite;
  return (
    <button
      type="button"
      aria-pressed={optimistic}
      aria-label={label}
      title={label}
      data-testid="favorite-button"
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic);
          try {
            const r = await toggleFavoriteAction(productId);
            if (r.ok) setFav(r.favorite);
          } catch {
            /* optimistic value reverts */
          }
        })
      }
      className={
        variant === "floating"
          ? "tap inline-flex items-center justify-center rounded-full bg-[#fff8f1]/70 text-ink-2 backdrop-blur transition hover:bg-[#fff8f1] hover:text-brand"
          : "btn btn-ghost aspect-square px-0"
      }
    >
      <IconHeart filled={optimistic} className={optimistic ? "text-brand" : ""} width={20} height={20} />
    </button>
  );
}
