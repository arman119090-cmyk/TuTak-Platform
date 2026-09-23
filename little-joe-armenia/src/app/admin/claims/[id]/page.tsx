import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { dt, SOURCE_TYPE_LABEL, VERIFICATION_LABEL } from "@/lib/admin/format";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Field, Hidden, PageHeader, Select, TextArea } from "@/components/admin/ui";
import { saveClaim } from "../actions";

export const metadata: Metadata = { title: "Заявление о бренде" };

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("cms");
  const { id } = await params;
  const c = await db.brandClaim.findUnique({ where: { id } });
  if (!c) notFound();
  return (
    <>
      <PageHeader
        title={c.titleRu}
        subtitle={
          <>
            <Link href="/admin/claims" className="underline">
              Заявления о бренде
            </Link>{" "}
            · {c.key}
            {c.verifiedAt ? ` · подтверждено ${dt(c.verifiedAt)}` : ""}
          </>
        }
      />
      <Card>
        <ActionForm action={saveClaim}>
          <Hidden name="claimId" value={c.id} />
          <div className="adm-grid">
            <Select label="Проверка" name="verification" defaultValue={c.verification} options={VERIFICATION_LABEL} />
            <Select label="Тип источника" name="sourceType" defaultValue={c.sourceType} options={SOURCE_TYPE_LABEL} />
            <Field label="Ссылка на источник" name="sourceUrl" type="url" defaultValue={c.sourceUrl} />
            <Field label="Порядок" name="sortOrder" type="number" defaultValue={c.sortOrder} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {(["Hy", "Ru", "It", "En"] as const).map((l) => (
              <fieldset key={l} className="adm-fieldset grid gap-2" lang={l.toLowerCase()}>
                <legend>{l.toUpperCase()}</legend>
                <Field label="Заголовок" name={`title${l}`} defaultValue={c[`title${l}`]} required maxLength={200} />
                <TextArea label="Текст" name={`body${l}`} defaultValue={c[`body${l}`]} rows={3} maxLength={2000} />
              </fieldset>
            ))}
          </div>
          <div>
            <SubmitButton>Сохранить</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
