import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { amd, dt, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, REGION_LABEL } from "@/lib/admin/format";
import { REVENUE_STATUSES } from "@/lib/admin/queries";
import { Badge, Card, Empty, PageHeader, Stat } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Покупатель" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("customers");
  const { id } = await params;
  const c = await db.customer.findUnique({
    where: { id },
    include: { orders: { orderBy: { createdAt: "desc" } }, addresses: true, _count: { select: { reviews: true, favorites: true } } },
  });
  if (!c) notFound();
  const paid = c.orders.filter((o) => (REVENUE_STATUSES as string[]).includes(o.status));
  const total = paid.reduce((s, o) => s + o.totalAmd, 0);
  return (
    <>
      <PageHeader
        title={c.name ?? "Без имени"}
        subtitle={
          <>
            <Link href="/admin/customers" className="underline">
              Покупатели
            </Link>{" "}
            · {c.email ?? "без email"} · {c.phone ?? "без телефона"} · язык {c.locale.toUpperCase()} · с {dt(c.createdAt)}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Заказов" value={c.orders.length} />
        <Stat label="Сумма (оплач./подтв.)" value={amd(total)} />
        <Stat label="Отзывов" value={c._count.reviews} />
        <Stat label="В избранном" value={c._count.favorites} />
      </div>
      <Card title="Заказы" className="mt-5">
        {c.orders.length === 0 ? (
          <Empty>Заказов нет.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Номер</th>
                  <th scope="col">Дата</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Оплата</th>
                  <th scope="col" className="num">
                    Сумма
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/admin/orders/${o.id}`}>{o.number}</Link>
                    </td>
                    <td className="whitespace-nowrap">{dt(o.createdAt)}</td>
                    <td>
                      <Badge status={o.status}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                    </td>
                    <td>
                      <Badge status={o.paymentStatus}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</Badge>
                    </td>
                    <td className="num">{amd(o.totalAmd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Адреса" className="mt-5">
        {c.addresses.length === 0 ? (
          <Empty>Сохранённых адресов нет.</Empty>
        ) : (
          <ul className="grid gap-2 text-sm">
            {c.addresses.map((a) => (
              <li key={a.id}>
                {a.label ? <b>{a.label}: </b> : null}
                {REGION_LABEL[a.region] ?? a.region}, {a.city}, {a.street} {a.building}
                {a.apartment ? `, кв. ${a.apartment}` : ""} {a.isDefault ? <Badge tone="ok">основной</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
