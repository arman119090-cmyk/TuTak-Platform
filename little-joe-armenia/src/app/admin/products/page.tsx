import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { canAccess, requireAdmin } from "@/lib/admin/auth";
import { PRODUCT_TEXT_FIELDS, translationState } from "@/lib/admin/catalog";
import { amd, LOCALES, LOCALE_LABEL, PUBLISH_STATUS_LABEL } from "@/lib/admin/format";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Badge, Empty, Hidden, LinkButton, PageHeader } from "@/components/admin/ui";
import { setProductStatus } from "./actions";

export const metadata: Metadata = { title: "Товары" };

const STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const admin = await requireAdmin("products");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const status = STATUSES.find((s) => s === sp.status);

  const where: Prisma.ProductWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { slug: { contains: q, mode: "insensitive" } },
            { translations: { some: { name: { contains: q, mode: "insensitive" } } } },
            { variants: { some: { sku: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const products = await db.product.findMany({
    where,
    orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { slug: "asc" }],
    include: {
      translations: true,
      variants: { select: { priceAmd: true, isActive: true, stockOnHand: true, reserved: true } },
      collection: { select: { slug: true } },
    },
    take: 200,
  });
  const commerce = canAccess(admin.role, "productCommerce");

  return (
    <>
      <PageHeader
        title="Товары"
        subtitle={`${products.length} найдено`}
        actions={commerce ? <LinkButton href="/admin/products/new" variant="primary">+ Новый товар</LinkButton> : null}
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="label">
            Поиск (название, slug, SKU)
          </label>
          <input id="q" name="q" defaultValue={q} className="field" />
        </div>
        <div>
          <label htmlFor="status" className="label">
            Статус
          </label>
          <select id="status" name="status" defaultValue={status ?? ""} className="field">
            <option value="">Все</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {PUBLISH_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-ghost">
          Найти
        </button>
      </form>

      {products.length === 0 ? (
        <Empty>Ничего не найдено.</Empty>
      ) : (
        <div className="adm-card adm-table-wrap p-0">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Товар</th>
                <th scope="col">Статус</th>
                <th scope="col">Переводы</th>
                <th scope="col" className="num">
                  Цена
                </th>
                <th scope="col" className="num">
                  Доступно
                </th>
                {commerce ? <th scope="col">Действие</th> : null}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const name = p.translations.find((t) => t.locale === "ru")?.name ?? p.translations[0]?.name ?? p.slug;
                const prices = p.variants.filter((v) => v.isActive && v.priceAmd !== null).map((v) => v.priceAmd!);
                const avail = p.variants.filter((v) => v.isActive).reduce((sum, v) => sum + Math.max(0, v.stockOnHand - v.reserved), 0);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/admin/products/${p.id}`}>{name}</Link>
                      <div className="text-xs text-muted">
                        {p.slug} · {p.collection.slug}
                        {p.isDemo ? " · DEMO" : ""}
                      </div>
                    </td>
                    <td>
                      <Badge status={p.status}>{PUBLISH_STATUS_LABEL[p.status]}</Badge>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        {LOCALES.map((l) => {
                          const st = translationState(p.translations, l, PRODUCT_TEXT_FIELDS);
                          return (
                            <Badge key={l} tone={st === "ok" ? "ok" : st === "partial" ? "warn" : "bad"}>
                              <span title={st === "ok" ? "заполнено" : st === "partial" ? "есть пустые поля" : "нет названия"}>{LOCALE_LABEL[l]}</span>
                            </Badge>
                          );
                        })}
                      </div>
                    </td>
                    <td className="num">{prices.length ? amd(Math.min(...prices)) : "—"}</td>
                    <td className="num">{avail}</td>
                    {commerce ? (
                      <td>
                        <ActionForm action={setProductStatus} inline>
                          <Hidden name="productId" value={p.id} />
                          {p.status === "ARCHIVED" ? (
                            <SubmitButton variant="ghost" name="status" value="DRAFT">
                              Вернуть из архива
                            </SubmitButton>
                          ) : (
                            <SubmitButton variant="ghost" name="status" value="ARCHIVED" confirm="Перенести товар в архив? Он исчезнет с сайта.">
                              В архив
                            </SubmitButton>
                          )}
                        </ActionForm>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Переводы: зелёный — всё заполнено; жёлтый — есть название, но пусто описание/SEO; красный — нет названия.
      </p>
    </>
  );
}
