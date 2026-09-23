import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/auth";
import { Card, PageHeader } from "@/components/admin/ui";
import { CollectionForm } from "../form";

export const metadata: Metadata = { title: "Новая коллекция" };

export default async function NewCollectionPage() {
  await requireAdmin("collections");
  return (
    <>
      <PageHeader title="Новая коллекция" />
      <Card>
        <CollectionForm c={null} />
      </Card>
    </>
  );
}
