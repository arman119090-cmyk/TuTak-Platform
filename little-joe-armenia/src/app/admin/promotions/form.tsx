import type { Promotion } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { pickT } from "@/lib/catalog";
import { toYerevanLocal } from "@/lib/admin/forms";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Check, Field, Hidden, Select } from "@/components/admin/ui";
import { createPromotion, savePromotion } from "./actions";

export async function PromotionForm({
  p,
}: {
  p: (Promotion & { products: { productId: string }[]; collections: { collectionId: string }[] }) | null;
}) {
  const [products, collections] = await Promise.all([
    db.product.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { slug: "asc" }, include: { translations: true } }),
    db.collection.findMany({ orderBy: { sortOrder: "asc" }, include: { translations: true } }),
  ]);
  const pSet = new Set(p?.products.map((x) => x.productId));
  const cSet = new Set(p?.collections.map((x) => x.collectionId));
  return (
    <ActionForm action={p ? savePromotion : createPromotion}>
      {p ? <Hidden name="promotionId" value={p.id} /> : null}
      <div className="adm-grid">
        <Field label="Код" name="code" defaultValue={p?.code} required hint="Сохраняется в верхнем регистре без пробелов" maxLength={40} />
        <Field label="Название (для админки)" name="name" defaultValue={p?.name} required maxLength={120} />
        <Select label="Тип" name="type" defaultValue={p?.type ?? "PERCENT"} options={{ PERCENT: "Процент", FIXED: "Фиксированная сумма, ֏" }} />
        <Field label="Значение" name="value" type="number" min={1} defaultValue={p?.value} required hint="Процент 1–100 или сумма в драмах" />
        <Field label="Начало (Ереван)" name="startsAt" type="datetime-local" defaultValue={toYerevanLocal(p?.startsAt)} />
        <Field label="Окончание (Ереван)" name="endsAt" type="datetime-local" defaultValue={toYerevanLocal(p?.endsAt)} />
        <Field label="Мин. сумма заказа, ֏" name="minSubtotalAmd" type="number" min={0} defaultValue={p?.minSubtotalAmd} />
        <Field label="Лимит использований" name="usageLimit" type="number" min={1} defaultValue={p?.usageLimit} />
      </div>
      <Check label="Активен" name="isActive" defaultChecked={p?.isActive ?? true} />
      <fieldset className="adm-fieldset">
        <legend>Ограничить товарами / коллекциями (пусто — на весь заказ)</legend>
        <p className="mb-1 text-xs font-semibold text-muted">Коллекции</p>
        <div className="flex flex-wrap gap-x-5">
          {collections.map((c) => (
            <Check key={c.id} name="collectionIds" value={c.id} label={pickT(c.translations, "ru")?.name ?? c.slug} defaultChecked={cSet.has(c.id)} />
          ))}
        </div>
        <p className="mt-2 mb-1 text-xs font-semibold text-muted">Товары</p>
        <div className="grid gap-x-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((x) => (
            <Check key={x.id} name="productIds" value={x.id} label={pickT(x.translations, "ru")?.name ?? x.slug} defaultChecked={pSet.has(x.id)} />
          ))}
        </div>
      </fieldset>
      <div>
        <SubmitButton>{p ? "Сохранить" : "Создать промокод"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
