import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { getDictionary } from '@/lib/i18n';
import { AdminHeading, AdminLink, Panel, Table } from '@/components/admin/ui';
import { OrderStatusBadge } from '@/components/account/order-status-badge';

export const dynamic = 'force-dynamic';

const STATUSES = [
  'NEW', 'CONFIRMED', 'PAID', 'IN_PRODUCTION', 'READY', 'SHIPPED', 'DELIVERED', 'CANCELLED',
] as const;

const AdminOrders = async ({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) => {
  const { status, q } = await searchParams;
  const dict = getDictionary('ru');

  const where: Prisma.OrderWhereInput = {
    ...(status && (STATUSES as readonly string[]).includes(status)
      ? { status: status as (typeof STATUSES)[number] }
      : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: 'insensitive' as const } },
            { customerName: { contains: q, mode: 'insensitive' as const } },
            { customerPhone: { contains: q } },
            { customerEmail: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [orders, counts] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { _count: { select: { items: true } } },
    }),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const countFor = (value: string) =>
    counts.find((item) => item.status === value)?._count._all ?? 0;

  return (
    <>
      <AdminHeading title="Заказы" subtitle={`Показано ${orders.length}`} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/admin/orders"
          className={`h-9 rounded-full border px-3 text-[13px] leading-[34px] ${!status ? 'border-ink bg-ink text-white' : 'border-line bg-surface'}`}
        >
          Все
        </Link>
        {STATUSES.map((item) => (
          <Link
            key={item}
            href={`/admin/orders?status=${item}`}
            className={`h-9 rounded-full border px-3 text-[13px] leading-[34px] ${status === item ? 'border-ink bg-ink text-white' : 'border-line bg-surface'}`}
          >
            {dict.orderStatus[item]} <span className="tabular-nums opacity-70">{countFor(item)}</span>
          </Link>
        ))}
      </div>

      <form className="mb-4 flex gap-2" action="/admin/orders">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Номер, имя, телефон или e-mail"
          className="h-10 min-w-64 flex-1 rounded-[var(--radius-sm)] border border-line bg-surface px-3 text-[13px]"
        />
        <button type="submit" className="h-10 rounded-[var(--radius-sm)] bg-surface-2 px-4 text-[13px]">
          Найти
        </button>
      </form>

      <Panel>
        <Table head={['Номер', 'Дата', 'Клиент', 'Позиции', 'Оплата', 'Статус', 'Сумма']}>
          {orders.map((order) => (
            <tr key={order.id}>
              <td className="px-4 py-2.5">
                <AdminLink href={`/admin/orders/${order.id}`}>{order.number}</AdminLink>
              </td>
              <td className="px-4 py-2.5 text-muted">{formatDate(order.createdAt, 'ru')}</td>
              <td className="px-4 py-2.5">
                {order.customerName}
                <span className="block text-[12px] text-muted">{order.customerPhone}</span>
              </td>
              <td className="px-4 py-2.5 tabular-nums">{order._count.items}</td>
              <td className="px-4 py-2.5 text-muted">{dict.paymentStatus[order.paymentStatus]}</td>
              <td className="px-4 py-2.5">
                <OrderStatusBadge status={order.status} dict={dict} />
              </td>
              <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                {formatMoney(order.totalMinor)}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
};

export default AdminOrders;
