import type { Metadata } from "next";
import type { FragranceFamily, FragranceFamilyTranslation, ScentTag, ScentTagTranslation } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { LOCALES, LOCALE_LABEL } from "@/lib/admin/format";
import { pickT } from "@/lib/catalog";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Badge, Card, Empty, Field, Hidden, PageHeader, TextArea } from "@/components/admin/ui";
import { deleteFamily, deleteTag, saveFamily, saveTag } from "./actions";

export const metadata: Metadata = { title: "Семейства и теги" };

export default async function ScentPage() {
  await requireAdmin("scent");
  const [families, tags] = await Promise.all([
    db.fragranceFamily.findMany({ orderBy: [{ sortOrder: "asc" }, { slug: "asc" }], include: { translations: true, _count: { select: { products: true } } } }),
    db.scentTag.findMany({ orderBy: { slug: "asc" }, include: { translations: true, _count: { select: { products: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="Семейства и теги ароматов" subtitle="Словарь каталога: семейство — одно на товар, тегов — сколько угодно. Назначаются в карточке товара (раздел «Аромат»)." />
      <div className="grid gap-5">
        <Card title="Семейства" id="families">
          {families.length === 0 ? <Empty>Семейств нет.</Empty> : null}
          <div className="grid gap-3">
            {families.map((f) => (
              <details key={f.id} className="adm-fieldset">
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full border border-line" style={{ background: f.accentColor ?? "transparent" }} />
                  <b>{pickT(f.translations, "ru")?.name ?? f.slug}</b>
                  <span className="font-mono text-xs text-muted">{f.slug}</span>
                  <span className="text-xs text-muted">товаров: {f._count.products}</span>
                  <Langs rows={f.translations} />
                </summary>
                <FamilyForm f={f} />
                <ActionForm action={deleteFamily} inline className="adm-inline-form mt-3">
                  <Hidden name="familyId" value={f.id} />
                  <SubmitButton variant="danger" confirm="Удалить семейство?">
                    Удалить
                  </SubmitButton>
                </ActionForm>
              </details>
            ))}
            <details className="adm-fieldset">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold">+ Новое семейство</summary>
              <FamilyForm f={null} />
            </details>
          </div>
        </Card>

        <Card title="Теги" id="tags">
          {tags.length === 0 ? <Empty>Тегов нет.</Empty> : null}
          <div className="grid gap-3">
            {tags.map((t) => (
              <details key={t.id} className="adm-fieldset">
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2">
                  <b>{pickT(t.translations, "ru")?.name ?? t.slug}</b>
                  <span className="font-mono text-xs text-muted">{t.slug}</span>
                  <span className="text-xs text-muted">товаров: {t._count.products}</span>
                  <Langs rows={t.translations} />
                </summary>
                <TagForm t={t} />
                <ActionForm action={deleteTag} inline className="adm-inline-form mt-3">
                  <Hidden name="tagId" value={t.id} />
                  <SubmitButton variant="danger" confirm={`Удалить тег? Он будет снят с ${t._count.products} товар(ов).`}>
                    Удалить
                  </SubmitButton>
                </ActionForm>
              </details>
            ))}
            <details className="adm-fieldset">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold">+ Новый тег</summary>
              <TagForm t={null} />
            </details>
          </div>
        </Card>
      </div>
    </>
  );
}

function Langs({ rows }: { rows: { locale: string; name: string }[] }) {
  return (
    <span className="flex gap-1">
      {LOCALES.map((l) => (
        <Badge key={l} tone={rows.find((r) => r.locale === l && r.name.trim()) ? "ok" : "bad"}>
          {LOCALE_LABEL[l]}
        </Badge>
      ))}
    </span>
  );
}

function FamilyForm({ f }: { f: (FragranceFamily & { translations: FragranceFamilyTranslation[] }) | null }) {
  return (
    <ActionForm action={saveFamily} resetOnSuccess={!f} className="adm-form mt-3">
      {f ? <Hidden name="familyId" value={f.id} /> : null}
      <div className="adm-grid">
        <Field label="Slug" name="slug" defaultValue={f?.slug} required />
        <Field label="Порядок" name="sortOrder" type="number" defaultValue={f?.sortOrder ?? 0} />
        <Field label="Акцентный цвет (#RRGGBB)" name="accentColor" defaultValue={f?.accentColor} pattern="#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {LOCALES.map((l) => {
          const t = f?.translations.find((x) => x.locale === l);
          return (
            <fieldset key={l} className="adm-fieldset grid gap-2" lang={l}>
              <legend>{LOCALE_LABEL[l]}</legend>
              <Field label="Название" name={`${l}_name`} defaultValue={t?.name} maxLength={80} />
              <TextArea label="Описание" name={`${l}_description`} defaultValue={t?.description} rows={2} maxLength={1000} />
            </fieldset>
          );
        })}
      </div>
      <div>
        <SubmitButton>{f ? "Сохранить" : "Добавить семейство"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

function TagForm({ t }: { t: (ScentTag & { translations: ScentTagTranslation[] }) | null }) {
  return (
    <ActionForm action={saveTag} resetOnSuccess={!t} className="adm-form mt-3">
      {t ? <Hidden name="tagId" value={t.id} /> : null}
      <div className="adm-grid">
        <Field label="Slug" name="slug" defaultValue={t?.slug} required />
        {LOCALES.map((l) => (
          <Field key={l} label={`Название ${LOCALE_LABEL[l]}`} name={`${l}_name`} defaultValue={t?.translations.find((x) => x.locale === l)?.name} maxLength={60} />
        ))}
      </div>
      <div>
        <SubmitButton>{t ? "Сохранить" : "Добавить тег"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
