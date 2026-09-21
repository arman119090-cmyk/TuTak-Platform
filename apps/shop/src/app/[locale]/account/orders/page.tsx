import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Package } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { getDictionary, isLocale } from '@/lib/i18n';
import { requireUser } from '@/lib/auth/guards';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { EmptyState, LinkButton } from '@/components/ui';
import { OrderStatusBadge } from '@/components/account/order-status-badge';

const OrdersPage = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const session = await requireUser(locale);

  const orders = await prisma.order.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: 'desc' },
    include: { items: { take: 4 } },
  });

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<Package width={40} height={40} strokeWidth={1.4} />}
        title={dict.account.noOrders}
        text={dict.account.noOrdersText}
        action={<LinkButton href={`/${locale}/catalog`}>{dict.cart.toCatalog}</LinkButton>}
      />
    );
  }

  return (
    <ul className="space-y-4">
      {orders.map((order) => (
        <li key={order.id} className="rounded-[var(--radius-md)] border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/${locale}/account/orders/${order.number}`} className="text-[15px] font-medium hover:text-accent">
              {order.number}
            </Link>
            <span className="text-[13px] text-muted">{formatDate(order.createdAt, locale)}</span>
            <OrderStatusBadge status={order.status} dict={dict} />
            <span className="ml-auto text-[17px] font-semibold tabular-nums">
              {formatMoney(order.totalMinor)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {order.items.map((item) => (
              <Link key={item.id} href={`/${locale}/product/${item.slugSnapshot}`} title={item.nameSnapshot}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl}
                  alt={item.nameSnapshot}
                  className="h-14 w-20 rounded-[var(--radius-xs)] bg-surface-2 object-cover"
                  loading="lazy"
                />
              </Link>
            ))}
          </div>
          <Link
            href={`/${locale}/account/orders/${order.number}`}
            className="mt-3 inline-block text-[13px] text-accent hover:underline"
          >
            {dict.account.orderDetails} →
          </Link>
        </li>
      ))}
    </ul>
  );
};

export default OrdersPage;
