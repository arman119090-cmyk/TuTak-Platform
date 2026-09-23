import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ORDER_STATUSES } from "@/lib/domain/order-state";
import { requireAdmin } from "@/lib/admin/auth";
import { parseYerevanLocal } from "@/lib/admin/forms";
import { amd, dt, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, PROVIDER_LABEL } from "@/lib/admin/format";
import { sweepReservations } from "@/lib/admin/queries";
import { Badge, Empty, PageHeader, Pager, qs } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Заказы" };

const PAYMENT_STATUSES = ["NOT_REQUIRED", "PENDING", "SUCCEEDED", "FAILED", "REFUNDED"] as const;
const PER_PAGE = 50;

type SP = { q?: string; status?: string; payment?: string; from?: string; to?: string; page?: string };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin("orders");
  await sweepReservations();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const status = ORDER_STATUSES.find((x) => x === sp.status);
  const payment = PAYMENT_STATUSES.find((x) => x === sp.payment);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : "";
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));

  const digits = q.replace(/\D/g, "");
  const createdAt: Prisma.DateTimeFilter = {};
  const fromD = from ? parseYerevanLocal(`${from}T00:00`) : null;
  const toD = to ? parseYerevanLocal(`${to}T00:00`) : null;
  if (fromD) createdAt.gte = fromD;
  if (toD) createdAt.lt = new Date(toD.getTime() + 24 * 3600_000);

  const where: Prisma.OrderWhereInput = {
    ...(status ? { status } : {}),
    ...(payment ? { paymentStatus: payment } : {}),
    ...(fromD || toD ? { createdAt } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { customerName: { contains: q, mode: "insensitive" } },
            { customerEmail: { contains: q, mode: "insensitive" } },
            // Phones are stored as +374XXXXXXXX; match on the digits typed.
            ...(digits.length >= 3 ? [{ customerPhone: { contains: digits.replace(/^0/, "") } }] : []),
          ],
        }
      : {}),
  };
  const [total, orders] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER_PAGE, take: PER_PAGE, include: { _count: { select: { items: true } } } }),
  ]);
  const base = { q, status, payment, from, to };

  return (
    <>
      <PageHeader title="Заказы" subtitle={`Найдено: ${total}`} />
      <form method="get" role="search" className="adm-card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <div className="lg:col-span-2">
          <label className="label" htmlFor="q">
            Номер, телефон, имя, email
          </label>
          <input id="q" name="q" defaultValue={q} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="status">
            Статус
          </label>
          <select id="status" name="status" defaultValue={status ?? ""} className="field">
            <option value="">Все</option>
            {ORDER_STATUSES.map((x) => (
              <option key={x} value={x}>
                {ORDER_STATUS_LABEL[x]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="payment">
            Оплата
          </label>
          <select id="payment" name="payment" defaultValue={payment ?? ""} className="field">
            <option value="">Все</option>
            {PAYMENT_STATUSES.map((x) => (
              <option key={x} value={x}>
                {PAYMENT_STATUS_LABEL[x]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="from">
            С даты
          </label>
          <input id="from" name="from" type="date" defaultValue={from} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="to">
            По дату
          </label>
          <input id="to" name="to" type="date" defaultValue={to} className="field" />
        </div>
        <div className="flex gap-2 lg:col-span-6">
          <button type="submit" className="btn btn-primary">
            Применить
          </button>
          <Link href="/admin/orders" className="btn btn-ghost">
            Сбросить
          </Link>
        </div>
      </form>

      {orders.length === 0 ? (
        <Empty>Заказов не найдено.</Empty>
      ) : (
        <div className="adm-card adm-table-wrap p-0">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Номер</th>
                <th scope="col">Дата</th>
                <th scope="col">Покупатель</th>
                <th scope="col">Статус</th>
                <th scope="col">Оплата</th>
                <th scope="col">Доставка</th>
                <th scope="col" className="num">
                  Сумма
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/admin/orders/${o.id}`}>{o.number}</Link>
                    <div className="text-xs text-muted">{o._count.items} поз.</div>
                  </td>
                  <td className="whitespace-nowrap">{dt(o.createdAt)}</td>
                  <td>
                    {o.customerName}
                    <div className="text-xs text-muted">{o.customerPhone}</div>
                  </td>
                  <td>
                    <Badge status={o.status}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                  </td>
                  <td>
                    <Badge status={o.paymentStatus}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</Badge>
                    <div className="text-xs text-muted">{PROVIDER_LABEL[o.paymentProvider]}</div>
                  </td>
                  <td className="text-xs">
                    {o.deliveryMethodName}
                    <div className="text-muted">{o.city}</div>
                  </td>
                  <td className="num">{amd(o.totalAmd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={Math.ceil(total / PER_PAGE)} href={(p) => `/admin/orders${qs({ ...base, page: p })}`} />
    </>
  );
}
