import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getDictionary, isLocale } from '@/lib/i18n';
import { requireUser } from '@/lib/auth/guards';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { OrderStatusBadge } from '@/components/account/order-status-badge';
import { ProfileForm } from '@/components/account/profile-form';
import { RecentlyViewed } from '@/components/home/recently-viewed';

const AccountPage = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const session = await requireUser(locale);

  const [user, orders] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.sub },
      select: { firstName: true, lastName: true, phone: true, email: true, locale: true },
    }),
    prisma.order.findMany({
      where: { userId: session.sub },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { number: true, status: true, totalMinor: true, createdAt: true },
    }),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-4 text-[22px]">{dict.account.profile}</h2>
        <ProfileForm
          locale={locale}
          dict={dict}
          profile={{
            firstName: user.firstName,
            lastName: user.lastName ?? '',
            phone: user.phone ?? '',
            email: user.email,
            locale: user.locale,
          }}
        />
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-[22px]">{dict.account.orders}</h2>
          <Link href={`/${locale}/account/orders`} className="text-[13px] text-accent hover:underline">
            {dict.common.showAll}
          </Link>
        </div>
        {orders.length === 0 ? (
          <p className="text-sm text-muted">{dict.account.noOrdersText}</p>
        ) : (
          <ul className="space-y-2">
            {orders.map((order) => (
              <li key={order.number}>
                <Link
                  href={`/${locale}/account/orders/${order.number}`}
                  className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-line bg-surface px-4 py-3 text-[14px] hover:border-ink"
                >
                  <span className="font-medium">{order.number}</span>
                  <span className="text-muted">{formatDate(order.createdAt, locale)}</span>
                  <OrderStatusBadge status={order.status} dict={dict} />
                  <span className="ml-auto font-semibold tabular-nums">{formatMoney(order.totalMinor)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="-mx-4 md:mx-0">
        <RecentlyViewed locale={locale} dict={dict} title={dict.account.recentlyViewed} />
      </section>
    </div>
  );
};

export default AccountPage;
