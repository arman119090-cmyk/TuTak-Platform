import Link from "next/link";
import type { Metadata } from "next";
import { fmt, getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { formatAmd } from "@/lib/money";
import { paths } from "@/lib/paths";
import { shopper } from "@/lib/security/session";
import { findOrderForViewer } from "@/lib/domain/checkout";
import { canRetryPayment } from "@/lib/payments/service";
import { TrackPurchase } from "@/components/analytics/track-purchase";
import { OrderRefresh, RetryPayment } from "@/components/checkout/order-actions";

type Props = { params: Promise<{ locale: string; number: string }>; searchParams: Promise<{ t?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { number } = await params;
  return { title: fmt(getMessages(locale).order.title, { number }), robots: { index: false, follow: false } };
}

// Purchase is tracked for COD orders at placement and for online orders only
// once the provider-verified payment made the order PAID.
const PURCHASE_STATUSES = new Set(["PENDING", "PAID", "CONFIRMED", "PACKING", "SHIPPED", "DELIVERED"]);

export default async function OrderPage({ params, searchParams }: Props) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const { number } = await params;
  const { t } = await searchParams;
  const order = await findOrderForViewer(decodeURIComponent(number), t, await shopper());
  if (!order) {
    return (
      <div className="container-lj max-w-xl py-20 text-center">
        <h1 className="text-h2 font-extrabold">{m.order.notFound}</h1>
        <Link href={paths.home(locale)} className="btn btn-primary mt-8">
          {m.errors.goHome}
        </Link>
      </div>
    );
  }

  const cod = order.paymentProvider === "CASH_ON_DELIVERY";
  const statusMessage =
    order.status === "AWAITING_PAYMENT"
      ? m.order.awaitingPayment
      : order.status === "PAYMENT_FAILED"
        ? m.order.paymentFailed
        : order.status === "PAID"
          ? m.order.paid
          : null;

  return (
    <div className="container-lj max-w-3xl py-10 md:py-14">
      {PURCHASE_STATUSES.has(order.status) && !order.purchaseTrackedAt ? (
        <TrackPurchase
          number={order.number}
          token={t ?? ""}
          params={{
            transaction_id: order.number,
            currency: "AMD",
            value: order.totalAmd,
            shipping: order.deliveryAmd,
            items: order.items.map((i) => ({ item_id: i.productSlug, item_name: i.name, price: i.unitAmd, quantity: i.quantity })),
          }}
        />
      ) : null}
      <p className="eyebrow">{fmt(m.order.title, { number: order.number })}</p>
      <h1 className="mt-2 text-h1 font-extrabold" data-testid="order-heading">
        {order.status === "PAYMENT_FAILED" || order.status === "CANCELLED" ? m.order.statuses[order.status] : m.order.thanks}
      </h1>
      {cod && order.status === "PENDING" ? <p className="mt-3 text-lg text-ink-2">{m.order.thanksCod}</p> : null}
      {statusMessage ? (
        <p className={`mt-4 rounded-2xl px-4 py-3 ${order.status === "PAYMENT_FAILED" ? "bg-bad/10 text-bad" : order.status === "PAID" ? "bg-ok/10 text-ok" : "bg-mist"}`} role="status">
          {statusMessage}
        </p>
      ) : null}
      {order.status === "AWAITING_PAYMENT" ? <OrderRefresh /> : null}
      {canRetryPayment(order) ? <RetryPayment number={order.number} token={t ?? ""} /> : null}

      <dl className="mt-10 grid gap-6 sm:grid-cols-2">
        <Info k={m.order.status} v={<span data-testid="order-status">{m.order.statuses[order.status]}</span>} />
        <Info k={m.order.placedAt} v={order.createdAt.toLocaleString(locale === "hy" ? "hy-AM" : locale, { timeZone: "Asia/Yerevan", dateStyle: "medium", timeStyle: "short" })} />
        <Info k={m.order.paymentMethod} v={m.checkout.payments[order.paymentProvider]} />
        <Info
          k={m.order.deliveryTo}
          v={`${m.regions[order.region as keyof typeof m.regions] ?? order.region}, ${order.city}, ${order.street} ${order.building}${order.apartment ? `, ${order.apartment}` : ""} — ${order.deliveryMethodName}`}
        />
      </dl>

      <h2 className="mt-12 mb-4 text-xl font-bold">{m.order.items}</h2>
      <ul className="divide-y divide-line border-y border-line">
        {order.items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-4 py-4">
            <Link href={paths.product(locale, i.productSlug)} className="font-medium hover:underline">
              {i.name} <span className="text-muted">× {i.quantity}</span>
            </Link>
            <span className="font-semibold tabular-nums">{formatAmd(i.lineAmd, locale)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 ml-auto max-w-xs space-y-2 text-sm">
        <Line k={m.cart.subtotal} v={formatAmd(order.subtotalAmd, locale)} />
        {order.discountAmd > 0 ? <Line k={m.cart.discount} v={formatAmd(-order.discountAmd, locale)} /> : null}
        <Line k={m.cart.delivery} v={order.deliveryAmd === 0 ? m.checkout.free : formatAmd(order.deliveryAmd, locale)} />
        <div className="flex justify-between border-t border-line pt-2 text-base font-bold">
          <dt>{m.cart.total}</dt>
          <dd className="tabular-nums" data-testid="order-total">
            {formatAmd(order.totalAmd, locale)}
          </dd>
        </div>
      </dl>
      <div className="mt-10">
        <Link href={paths.shop(locale)} className="btn btn-ghost">
          {m.cart.continueShopping}
        </Link>
      </div>
    </div>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{k}</dt>
      <dd className="mt-1 font-semibold">{v}</dd>
    </div>
  );
}
function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-2">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
