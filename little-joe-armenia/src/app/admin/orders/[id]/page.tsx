import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { nextStatuses, type OrderStatus } from "@/lib/domain/order-state";
import { requireAdmin } from "@/lib/admin/auth";
import { amd, dt, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, PROVIDER_LABEL, REGION_LABEL } from "@/lib/admin/format";
import { sweepReservations } from "@/lib/admin/queries";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Badge, Card, Empty, Field, Hidden, PageHeader, TextArea } from "@/components/admin/ui";
import { addOrderNote, transitionOrderAction } from "../actions";

export const metadata: Metadata = { title: "Заказ" };

const DANGEROUS: OrderStatus[] = ["CANCELLED", "REFUNDED"];

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("orders");
  await sweepReservations();
  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: { include: { variant: { select: { productId: true } } } },
      history: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "asc" }, include: { events: { orderBy: { receivedAt: "asc" } } } },
      customer: { select: { id: true, email: true, phone: true, name: true } },
      redemption: { include: { promotion: { select: { id: true, name: true, code: true } } } },
    },
  });
  if (!order) notFound();
  const next = nextStatuses(order.status as OrderStatus, "admin");

  return (
    <>
      <PageHeader
        title={`Заказ ${order.number}`}
        subtitle={
          <>
            <Link href="/admin/orders" className="underline">
              Заказы
            </Link>{" "}
            · {dt(order.createdAt)} · <Badge status={order.status}>{ORDER_STATUS_LABEL[order.status]}</Badge>{" "}
            <Badge status={order.paymentStatus}>Оплата: {PAYMENT_STATUS_LABEL[order.paymentStatus]}</Badge>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="grid gap-5 lg:col-span-2">
          <Card title="Смена статуса" id="transition">
            {next.length === 0 ? (
              <p className="text-sm text-muted">Статус финальный, переходов нет.</p>
            ) : (
              <ActionForm action={transitionOrderAction} resetOnSuccess>
                <Hidden name="orderId" value={order.id} />
                {/* Disabled default button: Enter in the comment field must not trigger the first transition. */}
                <button type="submit" disabled hidden aria-hidden="true" tabIndex={-1} />
                <Field label="Комментарий к переходу (необязательно)" name="note" maxLength={500} />
                <div className="flex flex-wrap gap-2">
                  {next.map((s) => (
                    <SubmitButton
                      key={s}
                      name="to"
                      value={s}
                      variant={DANGEROUS.includes(s) ? "danger" : "primary"}
                      confirm={DANGEROUS.includes(s) ? `Перевести заказ в статус «${ORDER_STATUS_LABEL[s]}»?` : undefined}
                    >
                      → {ORDER_STATUS_LABEL[s]}
                    </SubmitButton>
                  ))}
                </div>
              </ActionForm>
            )}
            {order.status === "AWAITING_PAYMENT" ? (
              <p className="mt-2 text-xs text-muted">
                «Оплачен» ставит только платёжная система после проверки подписи — вручную нельзя. Резерв до {dt(order.reservationExpiresAt)}.
              </p>
            ) : null}
            {order.status === "REFUNDED" || order.status === "DELIVERED" ? (
              <p className="mt-2 text-xs text-muted">Возврат не возвращает товар на склад автоматически — после осмотра проведите «Возврат на склад» в карточке товара.</p>
            ) : null}
          </Card>

          <Card title="Состав заказа" id="items">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Товар</th>
                    <th scope="col">SKU</th>
                    <th scope="col" className="num">
                      Цена
                    </th>
                    <th scope="col" className="num">
                      Кол-во
                    </th>
                    <th scope="col" className="num">
                      Сумма
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link href={`/admin/products/${i.variant.productId}`}>{i.name}</Link>
                      </td>
                      <td className="font-mono text-xs">{i.sku}</td>
                      <td className="num">{amd(i.unitAmd)}</td>
                      <td className="num">{i.quantity}</td>
                      <td className="num">{amd(i.lineAmd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-3 ml-auto grid max-w-xs grid-cols-2 gap-1 text-sm">
              <dt className="text-muted">Товары</dt>
              <dd className="text-right tabular-nums">{amd(order.subtotalAmd)}</dd>
              <dt className="text-muted">Скидка{order.promoCode ? ` (${order.promoCode})` : ""}</dt>
              <dd className="text-right tabular-nums">{order.discountAmd ? `−${amd(order.discountAmd)}` : "—"}</dd>
              <dt className="text-muted">Доставка</dt>
              <dd className="text-right tabular-nums">{amd(order.deliveryAmd)}</dd>
              <dt className="font-semibold">Итого</dt>
              <dd className="text-right font-bold tabular-nums">{amd(order.totalAmd)}</dd>
            </dl>
          </Card>

          <Card title="Оплата" id="payments">
            <p className="mb-2 text-sm">
              Способ: <b>{PROVIDER_LABEL[order.paymentProvider]}</b>
            </p>
            {order.payments.length === 0 ? (
              <Empty>Платёжных записей нет{order.paymentProvider === "CASH_ON_DELIVERY" ? " (оплата при получении)" : ""}.</Empty>
            ) : (
              <div className="grid gap-3">
                {order.payments.map((p) => (
                  <div key={p.id} className="adm-fieldset text-sm">
                    <div className="flex flex-wrap gap-3">
                      <span>
                        {PROVIDER_LABEL[p.provider]} · адаптер <code>{p.adapter}</code>
                      </span>
                      <Badge status={p.status}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                      <span className="tabular-nums">{amd(p.amountAmd)}</span>
                      <span className="text-muted">{dt(p.createdAt)}</span>
                      {p.providerRef ? <span className="text-muted">ref: {p.providerRef}</span> : null}
                    </div>
                    {p.events.length ? (
                      <div className="adm-table-wrap mt-2">
                        <table className="adm-table">
                          <thead>
                            <tr>
                              <th scope="col">Получено</th>
                              <th scope="col">Событие</th>
                              <th scope="col">Подпись</th>
                              <th scope="col">Результат</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.events.map((e) => (
                              <tr key={e.id}>
                                <td className="whitespace-nowrap">{dt(e.receivedAt)}</td>
                                <td className="font-mono text-xs">{e.eventId}</td>
                                <td>{e.signatureValid ? <Badge tone="ok">верна</Badge> : <Badge tone="bad">неверна</Badge>}</td>
                                <td className="text-xs">{e.outcome}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-muted">Уведомлений от провайдера нет.</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="История статусов" id="history">
            <ol className="grid gap-2 text-sm">
              {order.history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-2">
                  <span className="whitespace-nowrap text-muted">{dt(h.createdAt)}</span>
                  <span>
                    {h.from ? `${ORDER_STATUS_LABEL[h.from]} → ` : ""}
                    <b>{ORDER_STATUS_LABEL[h.to]}</b>
                  </span>
                  <span className="text-xs text-muted">{h.actor}</span>
                  {h.note ? <span className="text-xs">«{h.note}»</span> : null}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="grid content-start gap-5">
          <Card title="Покупатель">
            <dl className="grid gap-1 text-sm">
              <dt className="text-muted">Имя</dt>
              <dd>{order.customerName}</dd>
              <dt className="text-muted">Телефон</dt>
              <dd>
                <a href={`tel:${order.customerPhone}`} className="underline">
                  {order.customerPhone}
                </a>
              </dd>
              <dt className="text-muted">Email</dt>
              <dd>{order.customerEmail ?? "—"}</dd>
              <dt className="text-muted">Язык</dt>
              <dd>{order.locale.toUpperCase()}</dd>
            </dl>
            {order.customer ? (
              <Link href={`/admin/customers/${order.customer.id}`} className="mt-2 inline-block text-sm font-semibold underline">
                Профиль покупателя
              </Link>
            ) : (
              <p className="mt-2 text-xs text-muted">Гостевой заказ</p>
            )}
          </Card>
          <Card title="Доставка">
            <p className="text-sm font-semibold">{order.deliveryMethodName}</p>
            <address className="mt-1 text-sm not-italic">
              {REGION_LABEL[order.region] ?? order.region}, {order.city}
              <br />
              {order.street}, {order.building}
              {order.apartment ? `, кв. ${order.apartment}` : ""}
              {order.entrance ? `, подъезд ${order.entrance}` : ""}
              {order.floor ? `, этаж ${order.floor}` : ""}
            </address>
            {order.comment ? <p className="mt-2 rounded-lg bg-mist p-2 text-sm">«{order.comment}»</p> : null}
          </Card>
          {order.redemption ? (
            <Card title="Промокод">
              <Link href={`/admin/promotions/${order.redemption.promotion.id}`} className="text-sm underline">
                {order.redemption.promotion.code ?? order.redemption.promotion.name}
              </Link>
            </Card>
          ) : null}
          <Card title="Внутренние заметки" id="notes">
            <ActionForm action={addOrderNote} resetOnSuccess>
              <Hidden name="orderId" value={order.id} />
              <TextArea label="Новая заметка (видна только админам)" name="body" rows={3} maxLength={2000} required />
              <div>
                <SubmitButton variant="ghost">Добавить</SubmitButton>
              </div>
            </ActionForm>
            <ul className="mt-3 grid gap-2">
              {order.notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-mist p-2 text-sm">
                  <div className="text-xs text-muted">
                    {dt(n.createdAt)} · {n.author}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
