import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { LOCALES, LOCALE_LABEL } from "@/lib/admin/format";
import { pickT } from "@/lib/catalog";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Check, Field, Hidden, PageHeader, TextArea } from "@/components/admin/ui";
import { savePage } from "../actions";

export const metadata: Metadata = { title: "Страница" };

export default async function PageEdit({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("cms");
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, include: { translations: true } });
  if (!page) notFound();
  return (
    <>
      <PageHeader
        title={pickT(page.translations, "ru")?.title ?? page.slug}
        subtitle={
          <>
            <Link href="/admin/pages" className="underline">
              Страницы
            </Link>{" "}
            · /{page.slug}
          </>
        }
      />
      <Card>
        <ActionForm action={savePage}>
          <Hidden name="pageId" value={page.id} />
          <p className="text-sm text-muted">Текст — обычный текст: абзацы через пустую строку, подзаголовки начинаются с «## ». HTML не поддерживается.</p>
          <Check
            label="Требуется юридическая проверка текста"
            name="legalReviewRequired"
            defaultChecked={page.legalReviewRequired}
          />
          <div className="grid gap-4">
            {LOCALES.map((l) => {
              const t = page.translations.find((x) => x.locale === l);
              return (
                <fieldset key={l} className="adm-fieldset grid gap-3" lang={l}>
                  <legend>{LOCALE_LABEL[l]}</legend>
                  <Field label="Заголовок" name={`${l}_title`} defaultValue={t?.title} maxLength={160} />
                  <TextArea label="Текст" name={`${l}_body`} defaultValue={t?.body} rows={12} />
                  <TextArea label="SEO description" name={`${l}_seoDescription`} defaultValue={t?.seoDescription} rows={2} maxLength={170} />
                </fieldset>
              );
            })}
          </div>
          <div>
            <SubmitButton>Сохранить</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
