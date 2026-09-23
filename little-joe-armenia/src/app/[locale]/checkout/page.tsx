import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { env } from "@/lib/env";
import { paths } from "@/lib/paths";
import { db } from "@/lib/db";
import { getCartAction } from "@/app/actions/cart";
import { currentCustomer } from "@/lib/security/session";
import { deliveryEta, deliveryName, deliveryOptions } from "@/lib/domain/delivery";
import { availablePaymentMethods } from "@/lib/payments/registry";
import { CheckoutForm } from "@/components/checkout/checkout-form";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = getMessages(await resolveLocale(params));
  return { title: m.checkout.title, robots: { index: false, follow: false } };
}

export default async function CheckoutPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const cart = await getCartAction(locale);
  if (cart.lines.length === 0) redirect(paths.cart(locale));

  const [methods, payments, customer] = await Promise.all([deliveryOptions(null), availablePaymentMethods(), currentCustomer()]);
  const addresses = customer ? await db.address.findMany({ where: { customerId: customer.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }) : [];
  const lastOrder = customer ? await db.order.findFirst({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" } }) : null;

  return (
    <div className="container-lj py-8 md:py-12">
      <h1 className="text-h1 font-extrabold">{m.checkout.title}</h1>
      <CheckoutForm
        cart={cart}
        delivery={methods.map((d) => ({
          code: d.code,
          name: deliveryName(d, locale),
          eta: deliveryEta(d, locale),
          priceAmd: d.priceAmd,
          freeFromAmd: d.freeFromAmd,
          regions: d.regions,
        }))}
        payments={payments}
        sandbox={env().PAYMENTS_MODE === "mock"}
        signedIn={Boolean(customer)}
        defaults={{
          name: customer?.name ?? lastOrder?.customerName ?? "",
          phone: customer?.phone ?? lastOrder?.customerPhone ?? "",
          email: customer?.email ?? "",
        }}
        addresses={addresses.map((a) => ({
          id: a.id,
          region: a.region,
          city: a.city,
          street: a.street,
          building: a.building,
          apartment: a.apartment ?? "",
          entrance: a.entrance ?? "",
          floor: a.floor ?? "",
          comment: a.comment ?? "",
        }))}
      />
    </div>
  );
}
