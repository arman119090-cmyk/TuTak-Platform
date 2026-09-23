import Link from "next/link";
import type { Metadata } from "next";
import type { HomeBlock } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { PUBLISH_STATUS_LABEL } from "@/lib/admin/format";
import { pickT } from "@/lib/catalog";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Badge, Card, Check, Empty, Field, Hidden, PageHeader, Select, TextArea } from "@/components/admin/ui";
import { addFeatured, deleteHomeBlock, moveFeatured, saveHomeBlock } from "./actions";

export const metadata: Metadata = { title: "Главная страница" };

export default async function HomeCmsPage() {
  await requireAdmin("cms");
  const [blocks, featured, products] = await Promise.all([
    db.homeBlock.findMany({ orderBy: [{ kind: "desc" }, { sortOrder: "asc" }] }),
    db.homeFeaturedProduct.findMany({ orderBy: [{ sortOrder: "asc" }, { productId: "asc" }], include: { product: { include: { translations: true } } } }),
    db.product.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { slug: "asc" }, include: { translations: true } }),
  ]);
  const featuredIds = new Set(featured.map((f) => f.productId));
  return (
    <>
      <PageHeader title="Главная страница" subtitle="Блоки HERO и CAMPAIGN и подборка товаров. Ссылки — только внутренние (начинаются с «/»)." />
      <div className="grid gap-5">
        {blocks.map((bl) => (
          <Card key={bl.id} title={`${bl.kind} · ${bl.titleRu}`} actions={bl.isActive ? <Badge tone="ok">активен</Badge> : <Badge>выключен</Badge>}>
            <BlockForm block={bl} />
            <ActionForm action={deleteHomeBlock} inline className="adm-inline-form mt-3">
              <Hidden name="blockId" value={bl.id} />
              <SubmitButton variant="danger" confirm="Удалить блок?">
                Удалить блок
              </SubmitButton>
            </ActionForm>
          </Card>
        ))}
        <Card title="Новый блок">
          <BlockForm block={null} />
        </Card>

        <Card title="Подборка товаров на главной" id="featured">
          {featured.length === 0 ? <Empty>Подборка пуста.</Empty> : null}
          <ol className="grid gap-2">
            {featured.map((f, i) => (
              <li key={f.productId} className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
                <span className="w-6 text-sm text-muted tabular-nums">{i + 1}.</span>
                <Link href={`/admin/products/${f.productId}`} className="flex-1 font-semibold underline">
                  {pickT(f.product.translations, "ru")?.name ?? f.product.slug}
                </Link>
                {f.product.status !== "ACTIVE" ? <Badge status={f.product.status}>{PUBLISH_STATUS_LABEL[f.product.status]} — на сайте не виден</Badge> : null}
                <ActionForm action={moveFeatured} inline>
                  <Hidden name="productId" value={f.productId} />
                  {i > 0 ? (
                    <SubmitButton variant="ghost" name="op" value="up">
                      ↑
                    </SubmitButton>
                  ) : null}
                  {i < featured.length - 1 ? (
                    <SubmitButton variant="ghost" name="op" value="down">
                      ↓
                    </SubmitButton>
                  ) : null}
                  <SubmitButton variant="danger" name="op" value="remove">
                    Убрать
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ol>
          <ActionForm action={addFeatured} className="adm-form mt-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <Select
              label="Добавить товар"
              name="productId"
              required
              empty="— выберите —"
              options={products.filter((p) => !featuredIds.has(p.id)).map((p) => ({ value: p.id, label: pickT(p.translations, "ru")?.name ?? p.slug }))}
            />
            <div>
              <SubmitButton variant="ghost">Добавить</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

function BlockForm({ block }: { block: HomeBlock | null }) {
  return (
    <ActionForm action={saveHomeBlock} resetOnSuccess={!block}>
      {block ? <Hidden name="blockId" value={block.id} /> : null}
      <div className="adm-grid">
        <Select label="Тип" name="kind" defaultValue={block?.kind ?? "CAMPAIGN"} options={{ HERO: "HERO", CAMPAIGN: "CAMPAIGN" }} />
        <Field label="Ссылка (/…)" name="href" defaultValue={block?.href} maxLength={300} placeholder="/hy/catalog" />
        <Field label="Акцентный цвет" name="accentColor" defaultValue={block?.accentColor} pattern="#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})" />
        <Field label="Порядок" name="sortOrder" type="number" defaultValue={block?.sortOrder ?? 0} />
      </div>
      <Check label="Активен" name="isActive" defaultChecked={block?.isActive ?? true} />
      <div className="grid gap-3 lg:grid-cols-2">
        {(["Hy", "Ru", "It", "En"] as const).map((l) => (
          <fieldset key={l} className="adm-fieldset grid gap-2" lang={l.toLowerCase()}>
            <legend>{l.toUpperCase()}</legend>
            <Field label="Заголовок" name={`title${l}`} defaultValue={block?.[`title${l}`]} required maxLength={160} />
            <TextArea label="Текст" name={`body${l}`} defaultValue={block?.[`body${l}`]} rows={2} maxLength={1000} />
          </fieldset>
        ))}
      </div>
      <div>
        <SubmitButton>{block ? "Сохранить блок" : "Добавить блок"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
