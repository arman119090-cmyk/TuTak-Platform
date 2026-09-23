import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { canAccess, requireAdmin } from "@/lib/admin/auth";
import { publishBlockers } from "@/lib/admin/catalog";
import {
  amd,
  dt,
  FORMAT_LABEL,
  LOCALES,
  LOCALE_LABEL,
  MEDIA_KIND_LABEL,
  MEDIA_RIGHTS_LABEL,
  MOVEMENT_LABEL,
  PUBLISH_STATUS_LABEL,
  SOURCE_TYPE_LABEL,
  VERIFICATION_LABEL,
} from "@/lib/admin/format";
import { pickT } from "@/lib/catalog";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Badge, Card, Check, Empty, Field, Hidden, PageHeader, Select, TextArea } from "@/components/admin/ui";
import {
  addMedia,
  addVariant,
  adjustStock,
  deleteMedia,
  moveMedia,
  saveProductAccent,
  saveProductBasics,
  saveProductFacts,
  saveProductScent,
  saveProductTranslations,
  saveVariant,
  setProductStatus,
  updateMedia,
} from "../actions";

export const metadata: Metadata = { title: "Товар" };

const FACT_ROWS = [
  { key: "articleNumber", field: "ARTICLE_NUMBER", label: "Артикул" },
  { key: "ean", field: "EAN", label: "EAN (штрихкод)" },
  { key: "durationDays", field: "DURATION", label: "Срок действия, дней" },
  { key: "dimensions", field: "DIMENSIONS", label: "Размеры" },
  { key: "colorName", field: "COLOR", label: "Цвет (производитель)" },
  { key: "format", field: "FORMAT", label: "Формат" },
] as const;

const SCALE_0_5 = [0, 1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));
const SCALE_1_5 = SCALE_0_5.slice(1);
const NOT_CONFIRMED = "— не подтверждено —";

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("products");
  const { id } = await params;
  const product = await db.product.findUnique({
    where: { id },
    include: {
      translations: true,
      variants: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
      media: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      facts: true,
      scentTags: true,
      collection: { include: { translations: true } },
    },
  });
  if (!product) notFound();

  const commerce = canAccess(admin.role, "productCommerce");
  const inventory = canAccess(admin.role, "inventory");
  const [collections, families, tags, movements] = await Promise.all([
    db.collection.findMany({ orderBy: { sortOrder: "asc" }, include: { translations: true } }),
    db.fragranceFamily.findMany({ orderBy: { sortOrder: "asc" }, include: { translations: true } }),
    db.scentTag.findMany({ orderBy: { slug: "asc" }, include: { translations: true } }),
    inventory
      ? db.inventoryMovement.findMany({
          where: { variantId: { in: product.variants.map((v) => v.id) } },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { variant: { select: { sku: true } } },
        })
      : Promise.resolve([]),
  ]);

  const name = pickT(product.translations, "ru")?.name ?? product.slug;
  const blockers = publishBlockers(product);
  const tagSet = new Set(product.scentTags.map((t) => t.tagId));
  const editedFields = new Set<string>(FACT_ROWS.map((f) => f.field));
  const otherFacts = product.facts.filter((f) => !editedFields.has(f.field));
  const orderIds = [...new Set(movements.map((m) => m.orderId).filter((x): x is string => Boolean(x)))];
  const orders = orderIds.length ? await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true } }) : [];
  const orderNo = new Map(orders.map((o) => [o.id, o.number]));

  return (
    <>
      <PageHeader
        title={name}
        subtitle={
          <>
            <Link href="/admin/products" className="underline">
              Товары
            </Link>{" "}
            · {product.slug} · <Badge status={product.status}>{PUBLISH_STATUS_LABEL[product.status]}</Badge>
            {product.isDemo ? " · DEMO-товар" : ""}
          </>
        }
      />

      <nav aria-label="Разделы товара" className="mb-5 flex flex-wrap gap-2 text-sm">
        {[
          ["status", "Статус"],
          ["basics", "Основное"],
          ["translations", "Переводы"],
          ["facts", "Факты"],
          ["scent", "Аромат"],
          ["accent", "Цвета"],
          ["variants", "Варианты"],
          ["inventory", "Склад"],
          ["media", "Медиа"],
        ].map(([hash, label]) => (
          <a key={hash} href={`#${hash}`} className="chip">
            {label}
          </a>
        ))}
      </nav>

      <div className="grid gap-5">
        {/* ───── Status ───── */}
        <Card title="Статус публикации" id="status">
          {blockers.length ? (
            <div className="mb-3 rounded-lg bg-mist p-3 text-sm">
              <p className="font-semibold">Опубликовать пока нельзя:</p>
              <ul className="mt-1 list-disc pl-5">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mb-3 text-sm text-ok">Все условия для публикации выполнены.</p>
          )}
          {commerce ? (
            <ActionForm action={setProductStatus} inline>
              <Hidden name="productId" value={product.id} />
              {product.status !== "ACTIVE" ? (
                <SubmitButton name="status" value="ACTIVE">
                  Опубликовать
                </SubmitButton>
              ) : null}
              {product.status !== "DRAFT" ? (
                <SubmitButton variant="ghost" name="status" value="DRAFT">
                  {product.status === "ARCHIVED" ? "Вернуть из архива (черновик)" : "Снять с публикации"}
                </SubmitButton>
              ) : null}
              {product.status !== "ARCHIVED" ? (
                <SubmitButton variant="danger" name="status" value="ARCHIVED" confirm="Перенести товар в архив?">
                  В архив
                </SubmitButton>
              ) : null}
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">Статус меняют владелец и менеджер.</p>
          )}
        </Card>

        {/* ───── Basics ───── */}
        <Card title="Основное" id="basics">
          {commerce ? (
            <ActionForm action={saveProductBasics}>
              <Hidden name="productId" value={product.id} />
              <div className="adm-grid">
                <Field label="Slug (адрес)" name="slug" defaultValue={product.slug} required />
                <Select
                  label="Коллекция"
                  name="collectionId"
                  defaultValue={product.collectionId}
                  options={collections.map((c) => ({ value: c.id, label: pickT(c.translations, "ru")?.name ?? c.slug }))}
                />
                <Field label="Порядок сортировки" name="sortOrder" type="number" defaultValue={product.sortOrder} />
              </div>
              <div className="flex flex-wrap gap-x-6">
                <Check label="Рекомендуемый" name="isFeatured" defaultChecked={product.isFeatured} />
                <Check label="Бестселлер" name="isBestseller" defaultChecked={product.isBestseller} />
                <Check label="Новинка" name="isNew" defaultChecked={product.isNew} />
                <Check label="Подарок" name="isGift" defaultChecked={product.isGift} />
              </div>
              <div>
                <SubmitButton>Сохранить</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">
              Коллекция: {pickT(product.collection.translations, "ru")?.name ?? product.collection.slug}. Флаги и slug меняют владелец и
              менеджер.
            </p>
          )}
        </Card>

        {/* ───── Translations ───── */}
        <Card title="Переводы" id="translations">
          <ActionForm action={saveProductTranslations}>
            <Hidden name="productId" value={product.id} />
            <p className="text-sm text-muted">
              Пустое название на языке удаляет перевод целиком. Описание аромата — только из подтверждённых фактов.
            </p>
            <div className="grid gap-4 xl:grid-cols-2">
              {LOCALES.map((l) => {
                const t = product.translations.find((x) => x.locale === l);
                return (
                  <fieldset key={l} className="adm-fieldset grid gap-3" lang={l}>
                    <legend>
                      {LOCALE_LABEL[l]} {t?.name ? "" : <Badge tone="bad">нет</Badge>}
                    </legend>
                    <Field label="Название" name={`${l}_name`} defaultValue={t?.name} maxLength={160} />
                    <Field label="Короткий дескриптор аромата" name={`${l}_scentDescriptor`} defaultValue={t?.scentDescriptor} maxLength={200} />
                    <TextArea label="Описание профиля" name={`${l}_profileDescription`} defaultValue={t?.profileDescription} rows={3} />
                    <TextArea label="Официальное описание (производитель)" name={`${l}_officialDescription`} defaultValue={t?.officialDescription} rows={3} />
                    <TextArea label="Применение" name={`${l}_usage`} defaultValue={t?.usage} rows={2} />
                    <Field label="SEO title" name={`${l}_seoTitle`} defaultValue={t?.seoTitle} maxLength={70} />
                    <TextArea label="SEO description" name={`${l}_seoDescription`} defaultValue={t?.seoDescription} rows={2} maxLength={170} />
                  </fieldset>
                );
              })}
            </div>
            <div>
              <SubmitButton>Сохранить переводы</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        {/* ───── Facts ───── */}
        <Card title="Факты производителя" id="facts">
          <p className="mb-3 text-sm text-muted">
            Заполняйте только то, что подтверждено источником. Пустое значение — «не подтверждено», это нормально. Статус «Подтверждено» требует
            источника и записывает, кто и когда подтвердил.
          </p>
          <ActionForm action={saveProductFacts}>
            <Hidden name="productId" value={product.id} />
            <div className="grid gap-3">
              {FACT_ROWS.map((f) => {
                const fact = product.facts.find((x) => x.field === f.field);
                const value = product[f.key];
                return (
                  <fieldset key={f.key} className="adm-fieldset">
                    <legend>
                      {f.label}{" "}
                      {fact ? <Badge status={fact.verification}>{VERIFICATION_LABEL[fact.verification]}</Badge> : <Badge>без источника</Badge>}
                    </legend>
                    <div className="adm-grid">
                      {f.key === "format" ? (
                        <Select label="Значение" name="format" defaultValue={product.format} options={FORMAT_LABEL} empty={NOT_CONFIRMED} />
                      ) : (
                        <Field
                          label="Значение"
                          name={f.key}
                          defaultValue={value === null ? "" : String(value)}
                          type={f.key === "durationDays" ? "number" : "text"}
                          inputMode={f.key === "ean" ? "numeric" : undefined}
                        />
                      )}
                      <Select label="Источник" name={`${f.key}_sourceType`} defaultValue={fact?.sourceType} options={SOURCE_TYPE_LABEL} empty="— нет —" />
                      <Field label="Ссылка на источник" name={`${f.key}_sourceUrl`} defaultValue={fact?.sourceUrl} type="url" />
                      <Select
                        label="Проверка"
                        name={`${f.key}_verification`}
                        defaultValue={fact?.verification ?? "UNVERIFIED"}
                        options={VERIFICATION_LABEL}
                      />
                      <Field label="Заметка" name={`${f.key}_note`} defaultValue={fact?.note} maxLength={500} />
                    </div>
                    {fact?.verifiedAt ? (
                      <p className="mt-2 text-xs text-muted">
                        Подтверждено {dt(fact.verifiedAt)} · {fact.verifiedBy}
                      </p>
                    ) : null}
                  </fieldset>
                );
              })}
            </div>
            <div>
              <SubmitButton>Сохранить факты</SubmitButton>
            </div>
          </ActionForm>
          {otherFacts.length ? (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold">Другие записи об источниках (только просмотр)</h3>
              <p className="mb-2 text-xs text-muted">Название, коллекция, аромат, описание — их значения редактируются в переводах/профиле; здесь видно, откуда они.</p>
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th scope="col">Поле</th>
                      <th scope="col">Значение</th>
                      <th scope="col">Источник</th>
                      <th scope="col">Проверка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {otherFacts.map((f) => (
                      <tr key={f.id}>
                        <td className="font-mono text-xs">{f.field}</td>
                        <td>{f.value ?? "—"}</td>
                        <td className="text-xs">
                          {SOURCE_TYPE_LABEL[f.sourceType]}
                          {f.sourceUrl ? <div className="max-w-64 truncate">{f.sourceUrl}</div> : null}
                        </td>
                        <td>
                          <Badge status={f.verification}>{VERIFICATION_LABEL[f.verification]}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Card>

        {/* ───── Scent ───── */}
        <Card title="Профиль аромата" id="scent">
          <ActionForm action={saveProductScent}>
            <Hidden name="productId" value={product.id} />
            <p className="text-sm text-muted">Пустое значение = не подтверждено. Не угадывайте.</p>
            <div className="adm-grid">
              <Select
                label="Семейство"
                name="familyId"
                defaultValue={product.familyId}
                empty={NOT_CONFIRMED}
                options={families.map((f) => ({ value: f.id, label: pickT(f.translations, "ru")?.name ?? f.slug }))}
              />
              <Select label="Интенсивность (1–5)" name="intensity" defaultValue={product.intensity} options={SCALE_1_5} empty={NOT_CONFIRMED} />
              <Select label="Сладость (0–5)" name="sweetness" defaultValue={product.sweetness} options={SCALE_0_5} empty={NOT_CONFIRMED} />
              <Select label="Свежесть (0–5)" name="freshness" defaultValue={product.freshness} options={SCALE_0_5} empty={NOT_CONFIRMED} />
              <Select label="Древесность (0–5)" name="woodiness" defaultValue={product.woodiness} options={SCALE_0_5} empty={NOT_CONFIRMED} />
              <Select label="Фруктовость (0–5)" name="fruity" defaultValue={product.fruity} options={SCALE_0_5} empty={NOT_CONFIRMED} />
              <Select label="Цветочность (0–5)" name="floral" defaultValue={product.floral} options={SCALE_0_5} empty={NOT_CONFIRMED} />
            </div>
            <fieldset className="adm-fieldset">
              <legend>Теги аромата</legend>
              {tags.length === 0 ? (
                <p className="text-sm text-muted">Тегов в базе пока нет.</p>
              ) : (
                <div className="flex flex-wrap gap-x-5">
                  {tags.map((t) => (
                    <Check key={t.id} label={pickT(t.translations, "ru")?.name ?? t.slug} name="tagIds" value={t.id} defaultChecked={tagSet.has(t.id)} />
                  ))}
                </div>
              )}
            </fieldset>
            <div>
              <SubmitButton>Сохранить аромат</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        {/* ───── Accent ───── */}
        <Card title="Цвета оформления" id="accent">
          <ActionForm action={saveProductAccent}>
            <Hidden name="productId" value={product.id} />
            <p className="text-sm text-muted">Цвет интерфейса карточки, выбирается магазином (не факт производителя).</p>
            <div className="adm-grid items-end">
              <Field label="Акцент (#RRGGBB)" name="accentColor" defaultValue={product.accentColor} pattern="#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})" />
              <Field label="Цвет текста на акценте" name="accentInk" defaultValue={product.accentInk} pattern="#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})" />
              <div
                className="flex min-h-11 items-center justify-center rounded-lg border border-line text-sm font-semibold"
                style={{ background: product.accentColor ?? "#E9E7E1", color: product.accentInk ?? "#111111" }}
              >
                Пример
              </div>
            </div>
            <div>
              <SubmitButton>Сохранить цвета</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        {/* ───── Variants ───── */}
        <Card title="Варианты и цены" id="variants">
          <p className="mb-3 text-sm text-muted">Остаток здесь не редактируется — только через движения склада ниже.</p>
          {product.variants.length === 0 ? <Empty>Вариантов нет.</Empty> : null}
          <div className="grid gap-3">
            {product.variants.map((v) =>
              commerce ? (
                <fieldset key={v.id} className="adm-fieldset">
                  <legend>
                    {v.sku} {v.isActive ? <Badge tone="ok">активен</Badge> : <Badge>выключен</Badge>}
                  </legend>
                  <ActionForm action={saveVariant}>
                    <Hidden name="productId" value={product.id} />
                    <Hidden name="variantId" value={v.id} />
                    <VariantFields v={v} />
                    <div>
                      <SubmitButton>Сохранить вариант</SubmitButton>
                    </div>
                  </ActionForm>
                </fieldset>
              ) : (
                <div key={v.id} className="text-sm">
                  {v.sku} · {amd(v.priceAmd)} {v.isActive ? "" : "(выключен)"}
                </div>
              ),
            )}
            {commerce ? (
              <details className="adm-fieldset">
                <summary className="flex min-h-11 cursor-pointer items-center font-semibold">+ Добавить вариант</summary>
                <ActionForm action={addVariant} resetOnSuccess>
                  <Hidden name="productId" value={product.id} />
                  <VariantFields v={null} />
                  <div>
                    <SubmitButton>Добавить</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            ) : null}
          </div>
        </Card>

        {/* ───── Inventory ───── */}
        <Card title="Склад" id="inventory">
          {!inventory ? (
            <p className="text-sm text-muted">Склад доступен владельцу и менеджеру.</p>
          ) : (
            <>
              <div className="grid gap-3">
                {product.variants.map((v) => (
                  <div key={v.id} className="adm-fieldset">
                    <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
                      <span className="font-mono text-xs">{v.sku}</span>
                      <span>
                        На складе: <b className="tabular-nums">{v.stockOnHand}</b>
                      </span>
                      <span>
                        В резерве: <b className="tabular-nums">{v.reserved}</b>
                      </span>
                      <span>
                        Доступно:{" "}
                        <Badge tone={v.stockOnHand - v.reserved <= 0 ? "bad" : v.stockOnHand - v.reserved <= v.lowStockAt ? "warn" : "ok"}>
                          {v.stockOnHand - v.reserved}
                        </Badge>
                      </span>
                      <span className="text-muted">порог: {v.lowStockAt}</span>
                    </div>
                    <ActionForm action={adjustStock} resetOnSuccess>
                      <Hidden name="variantId" value={v.id} />
                      <div className="adm-grid items-end">
                        <Field label="Изменение (+/−)" name="delta" type="number" required step={1} />
                        <Select
                          label="Тип"
                          name="type"
                          options={{
                            PURCHASE: MOVEMENT_LABEL.PURCHASE!,
                            MANUAL_ADJUSTMENT: MOVEMENT_LABEL.MANUAL_ADJUSTMENT!,
                            RETURN_TO_STOCK: MOVEMENT_LABEL.RETURN_TO_STOCK!,
                            REFUND: MOVEMENT_LABEL.REFUND!,
                          }}
                        />
                        <Field label="Комментарий" name="note" maxLength={300} />
                        <div>
                          <SubmitButton>Провести</SubmitButton>
                        </div>
                      </div>
                    </ActionForm>
                  </div>
                ))}
              </div>
              <h3 className="mt-5 mb-2 text-sm font-semibold">Движения (последние 50)</h3>
              {movements.length === 0 ? (
                <Empty>Движений нет.</Empty>
              ) : (
                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th scope="col">Дата</th>
                        <th scope="col">SKU</th>
                        <th scope="col">Тип</th>
                        <th scope="col" className="num">
                          Δ склад
                        </th>
                        <th scope="col" className="num">
                          Δ резерв
                        </th>
                        <th scope="col" className="num">
                          После
                        </th>
                        <th scope="col">Кто / заказ</th>
                        <th scope="col">Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map((m) => (
                        <tr key={m.id}>
                          <td className="whitespace-nowrap">{dt(m.createdAt)}</td>
                          <td className="whitespace-nowrap font-mono text-xs">{m.variant.sku}</td>
                          <td>{MOVEMENT_LABEL[m.type] ?? m.type}</td>
                          <td className="num">{m.onHandDelta > 0 ? `+${m.onHandDelta}` : m.onHandDelta}</td>
                          <td className="num">{m.reservedDelta > 0 ? `+${m.reservedDelta}` : m.reservedDelta}</td>
                          <td className="num">
                            {m.onHandAfter} / {m.reservedAfter}
                          </td>
                          <td className="text-xs">
                            {m.actor}
                            {m.orderId ? (
                              <>
                                {" · "}
                                <Link href={`/admin/orders/${m.orderId}`}>{orderNo.get(m.orderId) ?? "заказ"}</Link>
                              </>
                            ) : null}
                          </td>
                          <td className="text-xs">{m.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>

        {/* ───── Media ───── */}
        <Card title="Медиа" id="media">
          {product.media.length === 0 ? <Empty>Изображений нет.</Empty> : null}
          <div className="grid gap-3">
            {product.media.map((m, i) => (
              <div key={m.id} className="adm-fieldset grid gap-3 md:grid-cols-[8rem_1fr]">
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of arbitrary URLs */}
                  <img src={m.url} alt="" width={128} height={128} className="h-32 w-32 rounded-lg bg-mist object-contain" loading="lazy" />
                  <div className="mt-1 text-xs text-muted">
                    {m.width}×{m.height} · #{i + 1}
                  </div>
                  <Badge status={m.rights}>{MEDIA_RIGHTS_LABEL[m.rights]}</Badge>
                </div>
                <div className="grid gap-2">
                  <div className="truncate text-xs text-muted" title={m.url}>
                    {m.url}
                  </div>
                  <ActionForm action={updateMedia}>
                    <Hidden name="mediaId" value={m.id} />
                    <div className="adm-grid">
                      <Select label="Тип" name="kind" defaultValue={m.kind} options={MEDIA_KIND_LABEL} />
                      <Select label="Права" name="rights" defaultValue={m.rights} options={MEDIA_RIGHTS_LABEL} />
                      <Field label="Заметка о правах" name="rightsNote" defaultValue={m.rightsNote} maxLength={300} />
                      <Field label="Alt HY" name="altHy" defaultValue={m.altHy} maxLength={200} />
                      <Field label="Alt RU" name="altRu" defaultValue={m.altRu} maxLength={200} />
                      <Field label="Alt IT" name="altIt" defaultValue={m.altIt} maxLength={200} />
                      <Field label="Alt EN" name="altEn" defaultValue={m.altEn} maxLength={200} />
                    </div>
                    <div>
                      <SubmitButton variant="ghost">Сохранить</SubmitButton>
                    </div>
                  </ActionForm>
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={moveMedia} inline>
                      <Hidden name="mediaId" value={m.id} />
                      {i > 0 ? (
                        <SubmitButton variant="ghost" name="dir" value="up">
                          ↑ Выше
                        </SubmitButton>
                      ) : null}
                      {i < product.media.length - 1 ? (
                        <SubmitButton variant="ghost" name="dir" value="down">
                          ↓ Ниже
                        </SubmitButton>
                      ) : null}
                    </ActionForm>
                    <ActionForm action={deleteMedia} inline>
                      <Hidden name="mediaId" value={m.id} />
                      <SubmitButton variant="danger" confirm="Удалить изображение?">
                        Удалить
                      </SubmitButton>
                    </ActionForm>
                  </div>
                </div>
              </div>
            ))}
            <details className="adm-fieldset">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold">+ Добавить по ссылке</summary>
              <ActionForm action={addMedia} resetOnSuccess>
                <Hidden name="productId" value={product.id} />
                <div className="adm-grid">
                  <Field label="URL (https://… или /…)" name="url" required className="col-span-full" />
                  <Field label="Ширина, px" name="width" type="number" required min={1} />
                  <Field label="Высота, px" name="height" type="number" required min={1} />
                  <Select label="Тип" name="kind" options={MEDIA_KIND_LABEL} defaultValue="PRODUCT" />
                  <Select label="Права" name="rights" options={MEDIA_RIGHTS_LABEL} defaultValue="UNCONFIRMED" />
                  <Field label="Заметка о правах" name="rightsNote" maxLength={300} />
                  <Field label="Alt HY" name="altHy" maxLength={200} />
                  <Field label="Alt RU" name="altRu" maxLength={200} />
                  <Field label="Alt IT" name="altIt" maxLength={200} />
                  <Field label="Alt EN" name="altEn" maxLength={200} />
                </div>
                <div>
                  <SubmitButton>Добавить</SubmitButton>
                </div>
              </ActionForm>
            </details>
          </div>
        </Card>
      </div>
    </>
  );
}

function VariantFields({
  v,
}: {
  v: {
    sku: string;
    label: string | null;
    priceAmd: number | null;
    compareAtAmd: number | null;
    priceIsDemo: boolean;
    isActive: boolean;
    isDefault: boolean;
    lowStockAt: number;
  } | null;
}) {
  return (
    <>
      <div className="adm-grid">
        <Field label="SKU" name="sku" defaultValue={v?.sku} required maxLength={60} />
        <Field label="Подпись (упаковка и т. п.)" name="label" defaultValue={v?.label} maxLength={80} />
        <Field label="Цена, ֏" name="priceAmd" type="number" min={0} defaultValue={v?.priceAmd} />
        <Field label="Старая цена, ֏" name="compareAtAmd" type="number" min={0} defaultValue={v?.compareAtAmd} />
        <Field label="Порог «мало на складе»" name="lowStockAt" type="number" min={0} defaultValue={v?.lowStockAt ?? 3} />
      </div>
      <div className="flex flex-wrap gap-x-6">
        <Check label="Активен" name="isActive" defaultChecked={v?.isActive ?? true} />
        <Check label="По умолчанию" name="isDefault" defaultChecked={v?.isDefault ?? false} />
        <Check label="Цена демонстрационная (DEMO)" name="priceIsDemo" defaultChecked={v?.priceIsDemo ?? false} />
      </div>
    </>
  );
}
