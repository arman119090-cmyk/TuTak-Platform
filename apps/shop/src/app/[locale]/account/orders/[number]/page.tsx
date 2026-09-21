import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getDictionary, isLocale } from '@/lib/i18n';
import { requireUser } from '@/lib/auth/guards';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import { regionByKey, PICKUP_POINTS } from '@/config/site';
import { OrderStatusBadge } from '@/components/account/order-status-badge';

const OrderDetailPage = async ({
  params,
}: {
  params: Promise<{ locale: string; number: string }>;
}) => {
  const { locale, number } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const session = await requireUser(locale);

  const order = await prisma.order.findFirst({
    // Scoped by userId: knowing an order number is not authorisation to read it.
    where: { number, userId: session.sub },
    include: { items: true, events: { orderBy: { createdAt: 'asc' } } },
  });
  if (!order) notFound();

  const region = order.region ? regionByKey(order.region) : undefined;
  const pickup = PICKUP_POINTS.find((point) => point.key === order.pickupPoint);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[24px]">
          {dict.account.order} {order.number}
        </h2>
        <OrderStatusBadge status={order.status} dict={dict} />
        <Link href={`/${locale}/account/orders`} className="ml-auto text-[13px] text-accent hover:underline">
          ← {dict.account.orders}
        </Link>
      </div>

      <section>
        <h3 className="mb-3 text-[17px]">{dict.account.orderItems}</h3>
        <ul className="divide-y divide-line rounded-[var(--radius-md)] border border-line bg-surface">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.imageUrl} alt="" className="h-16 w-24 rounded-[var(--radius-xs)] bg-surface-2 object-cover" />
              <div className="min-w-0 flex-1">
                <Link href={`/${locale}/product/${item.slugSnapshot}`} className="text-[14px] hover:text-accent">
                  {item.nameSnapshot}
                </Link>
                <p className="text-[12px] text-muted">
                  {dict.common.sku}: {item.sku} · {formatMoney(item.unitPriceMinor)} × {item.quantity}
                </p>
              </div>
              <span className="font-medium tabular-nums">{formatMoney(item.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1.5 text-[14px]">
          <div className="flex justify-between">
            <dt className="text-muted">{dict.cart.subtotal}</dt>
            <dd className="tabular-nums">{formatMoney(order.subtotalMinor)}</dd>
          </div>
          {order.promoDiscountMinor > 0 ? (
            <div className="flex justify-between text-success">
              <dt>
                {dict.cart.promoDiscount} {order.promoCodeText ? `(${order.promoCodeText})` : ''}
              </dt>
              <dd className="tabular-nums">−{formatMoney(order.promoDiscountMinor)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-muted">{dict.cart.delivery}</dt>
            <dd className="tabular-nums">
              {order.deliveryMinor === 0 ? dict.cart.freeDelivery : formatMoney(order.deliveryMinor)}
            </dd>
          </div>
          {order.servicesMinor > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">{dict.cart.services}</dt>
              <dd className="tabular-nums">{formatMoney(order.servicesMinor)}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between border-t border-line pt-2">
            <dt className="font-medium">{dict.cart.total}</dt>
            <dd className="text-[20px] font-semibold tabular-nums">{formatMoney(order.totalMinor)}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-line bg-surface p-4 text-[14px]">
          <h3 className="mb-2 text-[16px]">{dict.account.deliveryTo}</h3>
          <p className="text-muted">
            {order.deliveryMethod === 'PICKUP'
              ? (pickup?.names[locale] ?? dict.checkout.pickup)
              : [region?.names[locale], order.city, order.street, order.building, order.apartment]
                  .filter(Boolean)
                  .join(', ')}
          </p>
          <p className="mt-2 text-muted">
            {order.customerName} · {order.customerPhone}
          </p>
          <p className="mt-2 text-[13px] text-muted">
            {dict.checkout.paymentMethod}:{' '}
            {order.paymentMethod === 'CARD'
              ? dict.checkout.card
              : order.paymentMethod === 'CASH'
                ? dict.checkout.cash
                : dict.checkout.cashOnDelivery}{' '}
            · {dict.paymentStatus[order.paymentStatus]}
          </p>
        </div>

        <div className="rounded-[var(--radius-md)] border border-line bg-surface p-4">
          <h3 className="mb-3 text-[16px]">{dict.account.orderHistory}</h3>
          <ol className="space-y-3">
            {order.events.map((event) => (
              <li key={event.id} className="flex gap-3 text-[13px]">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                <span>
                  <span className="block font-medium">{dict.orderStatus[event.status]}</span>
                  <span className="block text-muted">{formatDateTime(event.createdAt, locale)}</span>
                  {event.comment ? <span className="block text-muted">{event.comment}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
};

export default OrderDetailPage;
