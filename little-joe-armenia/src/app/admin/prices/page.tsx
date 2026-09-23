import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { amd } from "@/lib/admin/format";
import { pickT } from "@/lib/catalog";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Badge, Card, Field, Hidden, PageHeader } from "@/components/admin/ui";
import { setLinePrice } from "./actions";

export const metadata: Metadata = { title: "Цены и остатки" };

export default async function PricesPage() {
  await requireAdmin("products");
  const collections = await db.collection.findMany({
    where: { products: { some: { status: { not: "ARCHIVED" } } } },
    orderBy: { sortOrder: "asc" },
    include: {
      translations: true,
      products: { where: { status: { not: "ARCHIVED" } }, select: { variants: { where: { isActive: true }, select: { priceAmd: true, priceIsDemo: true, stockOnHand: true, reserved: true } } } },
    },
  });
  const rows = collections.map((c) => {
    const vs = c.products.flatMap((p) => p.variants);
    const prices = vs.map((v) => v.priceAmd).filter((p): p is number => p !== null);
    return {
      id: c.id,
      slug: c.slug,
      name: pickT(c.translations, "ru")?.name ?? c.slug,
      count: vs.length,
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      demo: vs.filter((v) => v.priceIsDemo).length,
      stock: vs.reduce((n, v) => n + Math.max(0, v.stockOnHand - v.reserved), 0),
    };
  });
  const demoTotal = rows.reduce((n, r) => n + r.demo, 0);

  return (
    <>
      <PageHeader
        title="Цены и остатки"
        subtitle={
          <>
            Цена и остаток сразу для всей линейки. Цена снимает отметку «демо». Отдельный товар можно поправить в{" "}
            <Link href="/admin/products" className="underline">
              карточке товара
            </Link>
            .
          </>
        }
      />
      {demoTotal > 0 ? (
        <p className="adm-msg adm-msg-bad mb-4">
          С демо-ценой: {demoTotal} товаров. Пока цены демо, на сайте у них стоит отметка «Демо-цена».
        </p>
      ) : (
        <p className="adm-msg adm-msg-ok mb-4">Все цены настоящие.</p>
      )}
      <div className="grid gap-3">
        {rows.map((r) => (
          <Card key={r.id}>
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <div className="min-w-0">
                <p className="font-semibold">{r.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>{r.count} товаров</span>
                  <span>·</span>
                  <span>{r.min === null ? "без цены" : r.min === r.max ? amd(r.min) : `${amd(r.min)} – ${amd(r.max!)}`}</span>
                  <span>·</span>
                  <span>в наличии {r.stock} шт.</span>
                  {r.demo > 0 ? <Badge tone="warn">демо-цена: {r.demo}</Badge> : <Badge tone="ok">цены настоящие</Badge>}
                </p>
              </div>
              <ActionForm action={setLinePrice} inline>
                <Hidden name="collectionId" value={r.id} />
                <Field label="Цена, ֏" name="priceAmd" type="number" min={1} inputMode="numeric" className="w-32" />
                <Field label="Остаток, шт." name="stock" type="number" min={0} inputMode="numeric" className="w-28" />
                <SubmitButton>Применить</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
