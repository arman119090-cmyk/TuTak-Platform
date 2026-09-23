import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin, canAccess } from "@/lib/admin/auth";
import { amd, dt, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/admin/format";
import { daysAgo, lowStock, productNames, REVENUE_STATUSES, sweepReservations } from "@/lib/admin/queries";
import { Badge, Card, Empty, PageHeader, Stat } from "@/components/admin/ui";
import { env } from "@/lib/env";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = { title: "Обзор" };

export default async function DashboardPage() {
  const admin = await requireAdmin("dashboard");

  if (!canAccess(admin.role, "orders")) return <ContentDashboard />;

  await sweepReservations();
  const since = daysAgo(30);
  const revenueWhere = { status: { in: REVENUE_STATUSES } };

  const [all, last30, ordersTotal, orders30, popular, low, latest] = await Promise.all([
    db.order.aggregate({ where: revenueWhere, _sum: { totalAmd: true }, _count: true }),
    db.order.aggregate({ where: { ...revenueWhere, createdAt: { gte: since } }, _sum: { totalAmd: true }, _count: true }),
    db.order.count(),
    db.order.count({ where: { createdAt: { gte: since } } }),
    db.orderItem.groupBy({
      by: ["productSlug"],
      where: { order: revenueWhere },
      _sum: { quantity: true, lineAmd: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    }),
    lowStock(15),
    db.order.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const slugs = popular.map((p) => p.productSlug);
  const products = await db.product.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
  const idBySlug = new Map(products.map((p) => [p.slug, p.id]));
  const names = await productNames([...products.map((p) => p.id), ...low.map((l) => l.productId)]);

  const revenueAll = all._sum.totalAmd ?? 0;
  const revenue30 = last30._sum.totalAmd ?? 0;
  const avg = all._count > 0 ? Math.round(revenueAll / all._count) : 0;

  return (
    <>
      <PageHeader title="Обзор" subtitle="Выручка — заказы в статусах Оплачен, Подтверждён, Сборка, Передан в доставку, Доставлен." />
      <LaunchChecklist />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Выручка за 30 дней" value={amd(revenue30)} hint={`${last30._count} заказ(ов)`} />
        <Stat label="Выручка за всё время" value={amd(revenueAll)} hint={`${all._count} заказ(ов)`} />
        <Stat label="Заказов всего" value={ordersTotal} hint={`за 30 дней: ${orders30}`} />
        <Stat label="Средний чек" value={all._count ? amd(avg) : "—"} hint="по выручке за всё время" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Популярные товары" id="popular">
          {popular.length === 0 ? (
            <Empty>Продаж пока нет.</Empty>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Товар</th>
                    <th scope="col" className="num">
                      Шт.
                    </th>
                    <th scope="col" className="num">
                      Сумма
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {popular.map((p) => {
                    const id = idBySlug.get(p.productSlug);
                    return (
                      <tr key={p.productSlug}>
                        <td>
                          {id ? <Link href={`/admin/products/${id}`}>{names.get(id) ?? p.productSlug}</Link> : p.productSlug}
                        </td>
                        <td className="num">{p._sum.quantity ?? 0}</td>
                        <td className="num">{amd(p._sum.lineAmd ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Заканчивается на складе" id="low">
          {low.length === 0 ? (
            <Empty>Все активные варианты выше порога.</Empty>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">SKU</th>
                    <th scope="col">Товар</th>
                    <th scope="col" className="num">
                      Доступно
                    </th>
                    <th scope="col" className="num">
                      Порог
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {low.map((l) => (
                    <tr key={l.variantId}>
                      <td className="font-mono text-xs">{l.sku}</td>
                      <td>
                        <Link href={`/admin/products/${l.productId}#inventory`}>{names.get(l.productId) ?? l.slug}</Link>
                      </td>
                      <td className="num">
                        <Badge tone={l.stockOnHand - l.reserved <= 0 ? "bad" : "warn"}>{l.stockOnHand - l.reserved}</Badge>
                      </td>
                      <td className="num">{l.lowStockAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title="Последние заказы" id="latest" className="mt-5" actions={<Link href="/admin/orders" className="text-sm font-semibold underline">Все заказы</Link>}>
        {latest.length === 0 ? (
          <Empty>Заказов пока нет.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Номер</th>
                  <th scope="col">Дата</th>
                  <th scope="col">Покупатель</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Оплата</th>
                  <th scope="col" className="num">
                    Сумма
                  </th>
                </tr>
              </thead>
              <tbody>
                {latest.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/admin/orders/${o.id}`}>{o.number}</Link>
                    </td>
                    <td className="whitespace-nowrap">{dt(o.createdAt)}</td>
                    <td>{o.customerName}</td>
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
    </>
  );
}

async function ContentDashboard() {
  const [pendingReviews, openImports, products] = await Promise.all([
    db.review.count({ where: { status: "PENDING" } }),
    db.importReview.count({ where: { status: "OPEN" } }),
    db.product.findMany({ where: { status: { not: "ARCHIVED" } }, select: { translations: { select: { locale: true, name: true } } } }),
  ]);
  const incomplete = products.filter((p) => ["hy", "ru", "it", "en"].some((l) => !p.translations.find((t) => t.locale === l && t.name.trim()))).length;
  return (
    <>
      <PageHeader title="Обзор" subtitle="Контент и модерация" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href="/admin/reviews">
          <Stat label="Отзывы на модерации" value={pendingReviews} />
        </Link>
        <Link href="/admin/imports">
          <Stat label="Открытые пункты импорта" value={openImports} />
        </Link>
        <Link href="/admin/translations">
          <Stat label="Товары без названия на одном из языков" value={incomplete} />
        </Link>
      </div>
    </>
  );
}

/**
 * What is still missing before the shop can trade for real. Each line links
 * to the place where it is fixed; the site mode itself is an environment
 * setting (DEMO_MODE) switched by the developer once everything is green.
 */
const PAY_LABEL: Record<string, string> = { CASH_ON_DELIVERY: "наличными при получении", IDRAM: "Idram", TELCELL: "Telcell", BANK_CARD: "банковская карта" };

async function LaunchChecklist() {
  const e = env();
  const [demoPrices, contacts, business, delivery, payments] = await Promise.all([
    db.variant.count({ where: { priceIsDemo: true, isActive: true, product: { status: "ACTIVE" } } }),
    getSetting("contacts"),
    getSetting("business"),
    db.deliveryMethod.findMany({ where: { isActive: true }, select: { priceAmd: true } }),
    db.paymentMethodSetting.findMany({ where: { isEnabled: true }, select: { provider: true } }),
  ]);
  const items: { done: boolean; title: string; hint: string; href: string }[] = [
    { done: demoPrices === 0, title: "Настоящие цены", hint: demoPrices ? `С демо-ценой ещё ${demoPrices} товаров` : "Все цены настоящие", href: "/admin/prices" },
    { done: Boolean(contacts.phone && contacts.email), title: "Контакты магазина", hint: "Телефон и email для покупателей", href: "/admin/settings#s-contacts" },
    { done: Boolean(business.legalName && business.taxId), title: "Юридические данные", hint: "Название юрлица и ՀՎՀՀ — нужны в оферте и на страницах", href: "/admin/settings#s-business" },
    { done: delivery.length > 0, title: "Доставка", hint: delivery.length ? `Включено способов: ${delivery.length}` : "Нет ни одного включённого способа", href: "/admin/settings#delivery" },
    { done: payments.length > 0, title: "Оплата", hint: payments.length ? `Включено: ${payments.map((p) => PAY_LABEL[p.provider] ?? p.provider).join(", ")}` : "Нет ни одного способа оплаты", href: "/admin/settings#payments" },
  ];
  const ready = items.every((i) => i.done);
  return (
    <Card title="Готовность к запуску" id="launch">
      <ul className="grid gap-2">
        {items.map((i) => (
          <li key={i.title} className="flex items-start gap-3">
            <Badge tone={i.done ? "ok" : "warn"}>{i.done ? "готово" : "нужно"}</Badge>
            <span className="min-w-0">
              <Link href={i.href} className="font-semibold underline decoration-line-strong underline-offset-2">
                {i.title}
              </Link>
              <span className="block text-sm text-muted">{i.hint}</span>
            </span>
          </li>
        ))}
        <li className="flex items-start gap-3 border-t border-line pt-3">
          <Badge tone={e.DEMO_MODE ? "warn" : "ok"}>{e.DEMO_MODE ? "демо" : "работает"}</Badge>
          <span className="text-sm">
            {e.DEMO_MODE
              ? ready
                ? "Всё готово — можно переключать сайт в рабочий режим (убрать баннер «демо», открыть сайт для поисковиков)."
                : "Сайт в демо-режиме: сверху баннер «демо», поисковики его не индексируют. Переключим, когда пункты выше будут готовы."
              : "Сайт в рабочем режиме."}
          </span>
        </li>
      </ul>
    </Card>
  );
}
