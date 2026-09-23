import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Hidden, PageHeader } from "@/components/admin/ui";
import { PromotionForm } from "../form";
import { deletePromotion } from "../actions";

export const metadata: Metadata = { title: "Промокод" };

export default async function PromotionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("promotions");
  const { id } = await params;
  const p = await db.promotion.findUnique({ where: { id }, include: { products: true, collections: true } });
  if (!p) notFound();
  return (
    <>
      <PageHeader
        title={p.code ?? p.name}
        subtitle={
          <>
            <Link href="/admin/promotions" className="underline">
              Промокоды
            </Link>{" "}
            · использован {p.usedCount} раз{p.usageLimit !== null ? ` из ${p.usageLimit}` : ""}
          </>
        }
      />
      <div className="grid gap-5">
        <Card>
          <PromotionForm p={p} />
        </Card>
        <Card title="Удаление">
          <ActionForm action={deletePromotion} inline>
            <Hidden name="promotionId" value={p.id} />
            <SubmitButton variant="danger" confirm="Удалить промокод?">
              Удалить
            </SubmitButton>
            <span className="text-sm text-muted">Только если промокод ни разу не применялся.</span>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
