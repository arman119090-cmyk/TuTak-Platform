import type { Metadata } from "next";
import { getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { getCartAction } from "@/app/actions/cart";
import { CartContents } from "@/components/cart/cart-contents";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = getMessages(await resolveLocale(params));
  return { title: m.cart.title, robots: { index: false } };
}

export default async function CartPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const cart = await getCartAction(locale);
  return (
    <div className="container-lj max-w-3xl py-10 md:py-14">
      <h1 className="mb-6 text-h1 font-extrabold">{m.cart.title}</h1>
      <CartContents initial={cart} />
    </div>
  );
}
