import { prisma } from '@/lib/prisma';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { AdminHeading, Panel, Table } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

const AdminCustomers = async ({ searchParams }: { searchParams: Promise<{ q?: string }> }) => {
  const { q } = await searchParams;

  const customers = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { firstName: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      role: true,
      createdAt: true,
      orders: { select: { totalMinor: true, status: true } },
    },
  });

  return (
    <>
      <AdminHeading title="Клиенты" subtitle={`${customers.length} записей`} />
      <form className="mb-4 flex gap-2" action="/admin/customers">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="E-mail, имя или телефон"
          className="h-10 min-w-64 flex-1 rounded-[var(--radius-sm)] border border-line bg-surface px-3 text-[13px]"
        />
        <button
          type="submit"
          className="h-10 rounded-[var(--radius-sm)] bg-surface-2 px-4 text-[13px]"
        >
          Найти
        </button>
      </form>

      <Panel>
        <Table head={['Клиент', 'Контакты', 'Роль', 'Заказов', 'Сумма', 'Регистрация']}>
          {customers.map((customer) => {
            const paid = customer.orders.filter((order) => order.status !== 'CANCELLED');
            const total = paid.reduce((sum, order) => sum + order.totalMinor, 0);
            return (
              <tr key={customer.id}>
                <td className="px-4 py-2.5">
                  {customer.firstName} {customer.lastName ?? ''}
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {customer.email}
                  {customer.phone ? <span className="block">{customer.phone}</span> : null}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={
                      customer.role === 'ADMIN'
                        ? 'rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent-strong'
                        : 'text-muted'
                    }
                  >
                    {customer.role === 'ADMIN' ? 'Администратор' : 'Покупатель'}
                  </span>
                </td>
                <td className="px-4 py-2.5 tabular-nums">{paid.length}</td>
                <td className="px-4 py-2.5 tabular-nums">{formatMoney(total)}</td>
                <td className="px-4 py-2.5 text-muted">{formatDate(customer.createdAt, 'ru')}</td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </>
  );
};

export default AdminCustomers;
