import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { pickT } from "@/lib/catalog";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Hidden, PageHeader } from "@/components/admin/ui";
import { CollectionForm } from "../form";
import { deleteCollection } from "../actions";

export const metadata: Metadata = { title: "Коллекция" };

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("collections");
  const { id } = await params;
  const c = await db.collection.findUnique({ where: { id }, include: { translations: true, _count: { select: { products: true } } } });
  if (!c) notFound();
  return (
    <>
      <PageHeader
        title={pickT(c.translations, "ru")?.name ?? c.slug}
        subtitle={
          <>
            <Link href="/admin/collections" className="underline">
              Коллекции
            </Link>{" "}
            · товаров: {c._count.products}
          </>
        }
      />
      <div className="grid gap-5">
        <Card>
          <CollectionForm c={c} />
        </Card>
        <Card title="Удаление">
          <ActionForm action={deleteCollection} inline>
            <Hidden name="collectionId" value={c.id} />
            <SubmitButton variant="danger" confirm="Удалить коллекцию безвозвратно?">
              Удалить коллекцию
            </SubmitButton>
            <span className="text-sm text-muted">Возможно только для пустой коллекции.</span>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
