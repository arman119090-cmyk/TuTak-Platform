import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { LOCALES, LOCALE_LABEL } from "@/lib/admin/format";
import { pickT } from "@/lib/catalog";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Field, PageHeader, Select } from "@/components/admin/ui";
import { createProduct } from "../actions";

export const metadata: Metadata = { title: "Новый товар" };

export default async function NewProductPage() {
  await requireAdmin("productCommerce");
  const collections = await db.collection.findMany({ orderBy: { sortOrder: "asc" }, include: { translations: true } });
  return (
    <>
      <PageHeader title="Новый товар" subtitle="Товар создаётся черновиком. Цены, остатки и публикация — на странице товара." />
      <Card>
        <ActionForm action={createProduct}>
          <div className="adm-grid">
            <Field label="Slug (адрес)" name="slug" required hint="например: little-joe-cherry" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
            <Select
              label="Коллекция"
              name="collectionId"
              required
              options={collections.map((c) => ({ value: c.id, label: pickT(c.translations, "ru")?.name ?? c.slug }))}
            />
          </div>
          <div className="adm-grid">
            {LOCALES.map((l) => (
              <Field key={l} label={`Название ${LOCALE_LABEL[l]}`} name={`name_${l}`} maxLength={160} />
            ))}
          </div>
          <div>
            <SubmitButton>Создать черновик</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
