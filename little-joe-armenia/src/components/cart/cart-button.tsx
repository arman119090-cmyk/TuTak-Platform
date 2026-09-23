"use client";

import { fmt } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import { IconBag } from "@/components/ui/icons";
import { useCartUI } from "@/components/cart/cart-ui";

export function CartButton() {
  const { count, open } = useCartUI();
  const { m } = useI18n();
  return (
    <button
      type="button"
      onClick={open}
      data-testid="cart-button"
      className="tap relative inline-flex items-center justify-center rounded-full hover:bg-mist"
      aria-label={fmt(m.nav.cartCount, { count })}
    >
      <IconBag />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 grid min-w-[1.15rem] place-items-center rounded-full bg-ink px-1 text-[0.68rem] font-bold leading-[1.15rem] text-white"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}
