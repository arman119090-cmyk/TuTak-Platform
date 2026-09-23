import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { amd, dt } from "@/lib/admin/format";
import { REVENUE_STATUSES } from "@/lib/admin/queries";
import { Empty, PageHeader, Pager, qs } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Покупатели" };

const PER_PAGE = 50;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireAdmin("customers");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
  const digits = q.replace(/\D/g, "").replace(/^0/, "");
  const where: Prisma.CustomerWhereInput = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      }
    : {};
  const [total, customers] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { _count: { select: { orders: true } } },
    }),
  ]);
  const sums = customers.length
    ? await db.order.groupBy({
        by: ["customerId"],
        where: { customerId: { in: customers.map((c) => c.id) }, status: { in: REVENUE_STATUSES } },
        _sum: { totalAmd: true },
      })
    : [];
  const sumBy = new Map(sums.map((x) => [x.customerId, x._sum.totalAmd ?? 0]));

  return (
    <>
      <PageHeader title="Покупатели" subtitle={`Всего: ${total}. Сумма — по оплаченным/подтверждённым заказам.`} />
      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="label">
            Email, телефон или имя
          </label>
          <input id="q" name="q" defaultValue={q} className="field" />
        </div>
        <button type="submit" className="btn btn-ghost">
          Найти
        </button>
      </form>
      {customers.length === 0 ? (
        <Empty>Покупателей не найдено. Гостевые заказы без аккаунта здесь не отображаются — ищите их в заказах.</Empty>
      ) : (
        <div className="adm-card adm-table-wrap p-0">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Покупатель</th>
                <th scope="col">Контакты</th>
                <th scope="col">С нами с</th>
                <th scope="col" className="num">
                  Заказов
                </th>
                <th scope="col" className="num">
                  Сумма
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/customers/${c.id}`}>{c.name ?? "Без имени"}</Link>
                  </td>
                  <td className="text-xs">
                    {c.email ?? "—"}
                    <div>{c.phone ?? ""}</div>
                  </td>
                  <td className="whitespace-nowrap">{dt(c.createdAt)}</td>
                  <td className="num">{c._count.orders}</td>
                  <td className="num">{amd(sumBy.get(c.id) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={Math.ceil(total / PER_PAGE)} href={(p) => `/admin/customers${qs({ q, page: p })}`} />
    </>
  );
}
