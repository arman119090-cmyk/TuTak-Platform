import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { amd, dt } from "@/lib/admin/format";
import { Badge, Empty, LinkButton, PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Промокоды" };

export default async function PromotionsPage() {
  await requireAdmin("promotions");
  const rows = await db.promotion.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { products: true, collections: true } } },
  });
  const now = new Date();
  return (
    <>
      <PageHeader title="Промокоды" actions={<LinkButton href="/admin/promotions/new" variant="primary">+ Новый промокод</LinkButton>} />
      {rows.length === 0 ? (
        <Empty>Промокодов нет.</Empty>
      ) : (
        <div className="adm-card adm-table-wrap p-0">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Код</th>
                <th scope="col">Скидка</th>
                <th scope="col">Период</th>
                <th scope="col">Условия</th>
                <th scope="col" className="num">
                  Использован
                </th>
                <th scope="col">Состояние</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const live = p.isActive && (!p.startsAt || p.startsAt <= now) && (!p.endsAt || p.endsAt >= now) && (p.usageLimit === null || p.usedCount < p.usageLimit);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/admin/promotions/${p.id}`} className="font-mono">
                        {p.code ?? "—"}
                      </Link>
                      <div className="text-xs text-muted">{p.name}</div>
                    </td>
                    <td>{p.type === "PERCENT" ? `${p.value}%` : amd(p.value)}</td>
                    <td className="text-xs">
                      {p.startsAt ? dt(p.startsAt) : "∞"} — {p.endsAt ? dt(p.endsAt) : "∞"}
                    </td>
                    <td className="text-xs">
                      {p.minSubtotalAmd ? `от ${amd(p.minSubtotalAmd)}` : "без минимума"}
                      {p._count.products || p._count.collections ? ` · товаров ${p._count.products}, коллекций ${p._count.collections}` : " · весь заказ"}
                    </td>
                    <td className="num">
                      {p.usedCount}
                      {p.usageLimit !== null ? ` / ${p.usageLimit}` : ""}
                    </td>
                    <td>{live ? <Badge tone="ok">действует</Badge> : p.isActive ? <Badge tone="warn">вне периода/лимита</Badge> : <Badge>выключен</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
