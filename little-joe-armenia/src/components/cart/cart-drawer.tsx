"use client";

import { useI18n } from "@/i18n/provider";
import { Sheet } from "@/components/ui/sheet";
import { useCartUI } from "@/components/cart/cart-ui";
import { CartContents } from "@/components/cart/cart-contents";

export function CartDrawer() {
  const { isOpen, close } = useCartUI();
  const { m } = useI18n();
  return (
    <Sheet open={isOpen} onClose={close} label={m.cart.title} closeLabel={m.common.close}>
      {/* Mounted only while open so the cart is fetched fresh each time. */}
      {isOpen ? <CartContents compact /> : null}
    </Sheet>
  );
}
