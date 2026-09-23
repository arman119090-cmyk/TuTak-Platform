import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/auth";
import { Card, PageHeader } from "@/components/admin/ui";
import { PromotionForm } from "../form";

export const metadata: Metadata = { title: "Новый промокод" };

export default async function NewPromotionPage() {
  await requireAdmin("promotions");
  return (
    <>
      <PageHeader title="Новый промокод" />
      <Card>
        <PromotionForm p={null} />
      </Card>
    </>
  );
}
