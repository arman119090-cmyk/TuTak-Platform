import type { Collection, CollectionTranslation } from "@/generated/prisma/client";
import { LOCALES, LOCALE_LABEL, SOURCE_TYPE_LABEL, VERIFICATION_LABEL, dt } from "@/lib/admin/format";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Check, Field, Hidden, Select, TextArea } from "@/components/admin/ui";
import { createCollection, saveCollection } from "./actions";

export function CollectionForm({ c }: { c: (Collection & { translations: CollectionTranslation[] }) | null }) {
  return (
    <ActionForm action={c ? saveCollection : createCollection}>
      {c ? <Hidden name="collectionId" value={c.id} /> : null}
      <div className="adm-grid">
        <Field label="Slug" name="slug" defaultValue={c?.slug} required />
        <Field label="Порядок" name="sortOrder" type="number" defaultValue={c?.sortOrder ?? 0} />
        <Field label="Акцентный цвет (#RRGGBB)" name="accentColor" defaultValue={c?.accentColor} pattern="#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})" />
        <div className="flex items-end">
          <Check label="Показывать на сайте" name="isVisible" defaultChecked={c?.isVisible ?? true} />
        </div>
      </div>
      <fieldset className="adm-fieldset">
        <legend>Источник и проверка</legend>
        <div className="adm-grid">
          <Select label="Проверка" name="verification" defaultValue={c?.verification ?? "UNVERIFIED"} options={VERIFICATION_LABEL} />
          <Select label="Тип источника" name="sourceType" defaultValue={c?.sourceType} options={SOURCE_TYPE_LABEL} empty="— нет —" />
          <Field label="Ссылка на источник" name="sourceUrl" defaultValue={c?.sourceUrl} type="url" />
        </div>
        {c?.verifiedAt ? <p className="mt-2 text-xs text-muted">Подтверждено: {dt(c.verifiedAt)}</p> : null}
      </fieldset>
      <div className="grid gap-4 xl:grid-cols-2">
        {LOCALES.map((l) => {
          const t = c?.translations.find((x) => x.locale === l);
          return (
            <fieldset key={l} className="adm-fieldset grid gap-3" lang={l}>
              <legend>{LOCALE_LABEL[l]}</legend>
              <Field label="Название" name={`${l}_name`} defaultValue={t?.name} maxLength={120} />
              <TextArea label="Описание" name={`${l}_description`} defaultValue={t?.description} />
              <Field label="SEO title" name={`${l}_seoTitle`} defaultValue={t?.seoTitle} maxLength={70} />
              <TextArea label="SEO description" name={`${l}_seoDescription`} defaultValue={t?.seoDescription} rows={2} maxLength={170} />
            </fieldset>
          );
        })}
      </div>
      <div>
        <SubmitButton>{c ? "Сохранить" : "Создать коллекцию"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
