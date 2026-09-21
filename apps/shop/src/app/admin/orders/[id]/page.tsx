import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import { getDictionary } from '@/lib/i18n';
import { regionByKey, PICKUP_POINTS, SERVICES } from '@/config/site';
import { AdminHeading, Panel, Table } from '@/components/admin/ui';
import { OrderStatusBadge } from '@/components/account/order-status-badge';
import { OrderStatusControl } from '@/components/admin/order-status-control';

export const dynamic = 'force-dynamic';

const AdminOrderDetail = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const dict = getDictionary('ru');

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: true,
      events: {
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { firstName: true } } },
      },
      user: { select: { id: true, email: true } },
    },
  });
  if (!order) notFound();

  const region = order.region ? regionByKey(order.region) : undefined;
  const pickup = PICKUP_POINTS.find((point) => point.key === order.pickupPoint);

  return (
    <>
      <AdminHeading
        title={`Заказ ${order.number}`}
        subtitle={`Создан ${formatDateTime(order.createdAt, 'ru')}`}
        action={<OrderStatusBadge status={order.status} dict={dict} />}
      />

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Состав заказа">
            <Table head={['Товар', 'Артикул', 'Цена', 'Кол-во', 'Сумма']}>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/ru/product/${item.slugSnapshot}`} className="hover:text-accent">
                      {item.nameSnapshot}
                    </Link>
                    {Object.keys(item.optionsSnapshot ?? {}).length > 0 ? (
                      <span className="block text-[12px] text-muted">
                        {JSON.stringify(item.optionsSnapshot)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{item.sku}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatMoney(item.unitPriceMinor)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{item.quantity}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                    {formatMoney(item.lineTotalMinor)}
                  </td>
                </tr>
              ))}
            </Table>
            <dl className="space-y-1.5 border-t border-line px-4 py-4 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-muted">Товары</dt>
                <dd className="tabular-nums">{formatMoney(order.subtotalMinor)}</dd>
              </div>
              {order.promoDiscountMinor > 0 ? (
                <div className="flex justify-between text-success">
                  <dt>Промокод {order.promoCodeText}</dt>
                  <dd className="tabular-nums">−{formatMoney(order.promoDiscountMinor)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-muted">Доставка</dt>
                <dd className="tabular-nums">{formatMoney(order.deliveryMinor)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Услуги</dt>
                <dd className="tabular-nums">{formatMoney(order.servicesMinor)}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2 text-[15px] font-semibold">
                <dt>Итого</dt>
                <dd className="tabular-nums">{formatMoney(order.totalMinor)}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="История статусов">
            <ol className="divide-y divide-line">
              {order.events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-start justify-between gap-3 px-4 py-2.5 text-[13px]"
                >
                  <span>
                    <span className="font-medium">{dict.orderStatus[event.status]}</span>
                    {event.comment ? (
                      <span className="block text-muted">{event.comment}</span>
                    ) : null}
                    {event.actor ? (
                      <span className="block text-[12px] text-muted">
                        оператор: {event.actor.firstName}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-muted">
                    {formatDateTime(event.createdAt, 'ru')}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Смена статуса">
            <div className="p-4">
              <OrderStatusControl orderId={order.id} status={order.status} />
            </div>
          </Panel>

          <Panel title="Клиент">
            <dl className="space-y-2 p-4 text-[13px]">
              <div>
                <dt className="text-muted">Имя</dt>
                <dd>{order.customerName}</dd>
              </div>
              <div>
                <dt className="text-muted">Телефон</dt>
                <dd>
                  <a href={`tel:${order.customerPhone}`} className="text-accent hover:underline">
                    {order.customerPhone}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-muted">E-mail</dt>
                <dd>{order.customerEmail}</dd>
              </div>
              {order.user ? (
                <div>
                  <dt className="text-muted">Аккаунт</dt>
                  <dd>
                    <Link
                      href={`/admin/customers?q=${order.user.email}`}
                      className="text-accent hover:underline"
                    >
                      {order.user.email}
                    </Link>
                  </dd>
                </div>
              ) : (
                <div className="text-muted">Оформлено без регистрации</div>
              )}
            </dl>
          </Panel>

          <Panel title="Доставка и услуги">
            <dl className="space-y-2 p-4 text-[13px]">
              <div>
                <dt className="text-muted">Способ</dt>
                <dd>{order.deliveryMethod === 'PICKUP' ? 'Самовывоз' : 'Доставка'}</dd>
              </div>
              <div>
                <dt className="text-muted">Адрес</dt>
                <dd>
                  {order.deliveryMethod === 'PICKUP'
                    ? (pickup?.names.ru ?? '—')
                    : [region?.names.ru, order.city, order.street, order.building, order.apartment]
                        .filter(Boolean)
                        .join(', ')}
                </dd>
              </div>
              {order.floor ? (
                <div>
                  <dt className="text-muted">Этаж / лифт</dt>
                  <dd>
                    {order.floor} · {order.hasLift ? 'есть' : 'нет'}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted">Услуги</dt>
                <dd>
                  {[
                    order.liftService ? SERVICES.lift.names.ru : null,
                    order.assemblyService ? SERVICES.assembly.names.ru : null,
                    order.doorInstallService ? SERVICES.doorInstall.names.ru : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </dd>
              </div>
              {order.comment ? (
                <div>
                  <dt className="text-muted">Комментарий</dt>
                  <dd>{order.comment}</dd>
                </div>
              ) : null}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
};

export default AdminOrderDetail;
