import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { getDictionary } from '@/lib/i18n';
import { AdminHeading, AdminLink, Panel, StatCard, Table } from '@/components/admin/ui';
import { OrderStatusBadge } from '@/components/account/order-status-badge';

export const dynamic = 'force-dynamic';

/** Operations dashboard: turnover, order flow, what sells and what ran out. */
const AdminDashboard = async () => {
  const dict = getDictionary('ru');
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);

  const [
    revenue,
    monthRevenue,
    ordersCount,
    newOrders,
    productCount,
    outOfStock,
    latestOrders,
    topProducts,
    openRequests,
  ] = await Promise.all([
    prisma.order.aggregate({
      where: { status: { not: 'CANCELLED' } },
      _sum: { totalMinor: true },
      _avg: { totalMinor: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: { status: { not: 'CANCELLED' }, createdAt: { gte: monthAgo } },
      _sum: { totalMinor: true },
    }),
    prisma.order.count(),
    prisma.order.count({ where: { status: 'NEW' } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.product.findMany({
      where: { stockStatus: 'OUT_OF_STOCK', isActive: true },
      take: 8,
      select: { id: true, sku: true, slug: true, translations: { where: { locale: 'ru' }, select: { name: true } } },
    }),
    prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        number: true,
        status: true,
        totalMinor: true,
        createdAt: true,
        customerName: true,
      },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      orderBy: { salesCount: 'desc' },
      take: 6,
      select: {
        id: true,
        sku: true,
        salesCount: true,
        priceMinor: true,
        translations: { where: { locale: 'ru' }, select: { name: true } },
      },
    }),
    prisma.request.count({ where: { status: 'NEW' } }),
  ]);

  return (
    <>
      <AdminHeading title="Дашборд" subtitle="Оборот, заказы и товары — данные демонстрационные" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Оборот всего"
          value={formatMoney(revenue._sum.totalMinor ?? 0)}
          hint={`За 30 дней: ${formatMoney(monthRevenue._sum.totalMinor ?? 0)}`}
        />
        <StatCard label="Заказов" value={String(ordersCount)} hint={`Новых: ${newOrders}`} />
        <StatCard
          label="Средний чек"
          value={formatMoney(Math.round(revenue._avg.totalMinor ?? 0))}
          hint={`Оплаченных и в работе: ${revenue._count._all}`}
        />
        <StatCard
          label="Заявки без ответа"
          value={String(openRequests)}
          tone={openRequests > 0 ? 'warning' : 'default'}
          hint={`Товаров в каталоге: ${productCount}`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Последние заказы"
          action={<AdminLink href="/admin/orders">Все заказы</AdminLink>}
        >
          <Table head={['Номер', 'Клиент', 'Статус', 'Дата', 'Сумма']}>
            {latestOrders.map((order) => (
              <tr key={order.id}>
                <td className="px-4 py-2.5">
                  <AdminLink href={`/admin/orders/${order.id}`}>{order.number}</AdminLink>
                </td>
                <td className="px-4 py-2.5">{order.customerName}</td>
                <td className="px-4 py-2.5">
                  <OrderStatusBadge status={order.status} dict={dict} />
                </td>
                <td className="px-4 py-2.5 text-muted">{formatDate(order.createdAt, 'ru')}</td>
                <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                  {formatMoney(order.totalMinor)}
                </td>
              </tr>
            ))}
          </Table>
        </Panel>

        <div className="space-y-6">
          <Panel title="Популярные товары">
            <Table head={['Товар', 'Продаж', 'Цена']}>
              {topProducts.map((product) => (
                <tr key={product.id}>
                  <td className="px-4 py-2.5">
                    <AdminLink href={`/admin/products/${product.id}`}>
                      {product.translations[0]?.name ?? product.sku}
                    </AdminLink>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{product.salesCount}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(product.priceMinor)}</td>
                </tr>
              ))}
            </Table>
          </Panel>

          <Panel title={`Нет в наличии (${outOfStock.length})`}>
            {outOfStock.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">Все товары в наличии или под заказ.</p>
            ) : (
              <ul className="divide-y divide-line">
                {outOfStock.map((product) => (
                  <li key={product.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                    <Link href={`/admin/products/${product.id}`} className="truncate hover:text-accent">
                      {product.translations[0]?.name ?? product.sku}
                    </Link>
                    <span className="shrink-0 text-muted">{product.sku}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
};

export default AdminDashboard;
