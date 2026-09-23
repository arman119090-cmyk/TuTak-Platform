import type { Metadata } from "next";
import type { DeliveryMethod } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { REGION_CODES } from "@/lib/armenia";
import { getSetting, type SettingKey } from "@/lib/settings";
import { credentialStatus } from "@/lib/payments/adapters/pending";
import { adapterFor } from "@/lib/payments/registry";
import { requireAdmin } from "@/lib/admin/auth";
import { amd, PROVIDER_LABEL, REGION_LABEL } from "@/lib/admin/format";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Badge, Card, Check, Field, Hidden, PageHeader } from "@/components/admin/ui";
import { deleteDeliveryMethod, saveDeliveryMethod, savePaymentMethod, saveSetting } from "./actions";

export const metadata: Metadata = { title: "Настройки" };

const PROVIDERS = ["CASH_ON_DELIVERY", "IDRAM", "TELCELL", "BANK_CARD"] as const;

type FieldDef = { name: string; label: string; type?: "text" | "email" | "url" | "checkbox"; hint?: string };
const SETTING_FIELDS: Record<SettingKey, { title: string; fields: FieldDef[] }> = {
  contacts: {
    title: "Контакты",
    fields: [
      { name: "phone", label: "Телефон" },
      { name: "email", label: "Email", type: "email" },
      { name: "address", label: "Адрес" },
      { name: "hours", label: "Часы работы" },
    ],
  },
  social: {
    title: "Соцсети",
    fields: [
      { name: "instagram", label: "Instagram (ссылка)" },
      { name: "facebook", label: "Facebook (ссылка)" },
      { name: "tiktok", label: "TikTok (ссылка)" },
      { name: "telegram", label: "Telegram (ссылка)" },
    ],
  },
  business: {
    title: "Юридическое лицо",
    fields: [
      { name: "legalName", label: "Название юрлица" },
      { name: "taxId", label: "ИНН (ՀՎՀՀ)" },
      {
        name: "brandAuthorizationConfirmed",
        label: "Авторизация бренда Little Joe документально подтверждена",
        type: "checkbox",
        hint: "Отмечайте только при наличии документа от правообладателя/дистрибьютора.",
      },
    ],
  },
  seo: {
    title: "SEO",
    fields: [
      { name: "titleSuffix", label: "Суффикс заголовка страниц" },
      { name: "ogImageUrl", label: "Картинка для соцсетей (URL)" },
    ],
  },
  analytics: {
    title: "Аналитика",
    fields: [
      { name: "ga4Id", label: "GA4 Measurement ID" },
      { name: "metaPixelId", label: "Meta Pixel ID" },
      { name: "tiktokPixelId", label: "TikTok Pixel ID" },
    ],
  },
};

export default async function SettingsPage() {
  await requireAdmin("settings");
  const e = env();
  const creds = credentialStatus();
  const keys = Object.keys(SETTING_FIELDS) as SettingKey[];
  const [methods, payments, values] = await Promise.all([
    db.deliveryMethod.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    db.paymentMethodSetting.findMany(),
    Promise.all(keys.map((k) => getSetting(k))),
  ]);

  return (
    <>
      <PageHeader title="Настройки" subtitle="Доступно только владельцу. Все изменения пишутся в журнал действий." />
      <nav aria-label="Разделы настроек" className="mb-5 flex flex-wrap gap-2 text-sm">
        <a href="#delivery" className="chip">
          Доставка
        </a>
        <a href="#payments" className="chip">
          Оплата
        </a>
        {keys.map((k) => (
          <a key={k} href={`#s-${k}`} className="chip">
            {SETTING_FIELDS[k].title}
          </a>
        ))}
      </nav>

      <div className="grid gap-5">
        <Card title="Способы доставки" id="delivery">
          <div className="grid gap-3">
            {methods.map((m) => (
              <details key={m.id} className="adm-fieldset">
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2">
                  <b>{m.nameRu}</b>
                  <span className="font-mono text-xs text-muted">{m.code}</span>
                  <span className="text-sm">{amd(m.priceAmd)}</span>
                  {m.freeFromAmd !== null ? <span className="text-xs text-muted">бесплатно от {amd(m.freeFromAmd)}</span> : null}
                  {m.isActive ? <Badge tone="ok">активен</Badge> : <Badge>выключен</Badge>}
                </summary>
                <DeliveryForm m={m} />
                <ActionForm action={deleteDeliveryMethod} inline className="adm-inline-form mt-3">
                  <Hidden name="methodId" value={m.id} />
                  <SubmitButton variant="danger" confirm="Удалить способ доставки? В старых заказах название сохранится.">
                    Удалить
                  </SubmitButton>
                </ActionForm>
              </details>
            ))}
            <details className="adm-fieldset">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold">+ Новый способ доставки</summary>
              <DeliveryForm m={null} />
            </details>
          </div>
        </Card>

        <Card title="Способы оплаты" id="payments">
          <p className="mb-3 text-sm">
            Режим платежей: <Badge tone={e.PAYMENTS_MODE === "live" ? "ok" : "warn"}>{e.PAYMENTS_MODE === "live" ? "LIVE (боевой)" : "MOCK (песочница)"}</Badge>{" "}
            <span className="text-muted">— задаётся переменной окружения PAYMENTS_MODE на сервере.</span>
          </p>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Способ</th>
                  <th scope="col">Ключи</th>
                  <th scope="col">На кассе</th>
                  <th scope="col">Настройка</th>
                </tr>
              </thead>
              <tbody>
                {PROVIDERS.map((p) => {
                  const row = payments.find((x) => x.provider === p);
                  const cred = p === "CASH_ON_DELIVERY" ? null : creds[p];
                  const technically = p === "CASH_ON_DELIVERY" || adapterFor(p) !== null;
                  const shown = Boolean(row?.isEnabled) && technically;
                  return (
                    <tr key={p}>
                      <td className="font-semibold">{PROVIDER_LABEL[p]}</td>
                      <td>{cred === null ? <span className="text-muted">не нужны</span> : cred ? <Badge tone="ok">заданы</Badge> : <Badge tone="bad">нет</Badge>}</td>
                      <td>
                        {shown ? <Badge tone="ok">показывается</Badge> : <Badge>скрыт</Badge>}
                        {row?.isEnabled && !technically ? (
                          <div className="mt-1 text-xs text-muted">Включён, но интеграция недоступна в режиме {e.PAYMENTS_MODE}.</div>
                        ) : null}
                      </td>
                      <td>
                        <ActionForm action={savePaymentMethod} inline>
                          <Hidden name="provider" value={p} />
                          <Check label="Включён" name="isEnabled" defaultChecked={row?.isEnabled ?? false} />
                          <div className="w-24">
                            <Field label="Порядок" name="sortOrder" type="number" defaultValue={row?.sortOrder ?? 0} />
                          </div>
                          <SubmitButton variant="ghost">Сохранить</SubmitButton>
                        </ActionForm>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            Telcell и банковская карта не реализованы (нужен договор и спецификация провайдера) — в режиме LIVE они не показываются даже при заданных ключах.
          </p>
        </Card>

        {keys.map((k, i) => {
          const v = values[i] as Record<string, string | boolean>;
          return (
            <Card key={k} title={SETTING_FIELDS[k].title} id={`s-${k}`}>
              <ActionForm action={saveSetting}>
                <Hidden name="key" value={k} />
                <div className="adm-grid">
                  {SETTING_FIELDS[k].fields.map((f) =>
                    f.type === "checkbox" ? (
                      <div key={f.name} className="col-span-full">
                        <Check label={f.label} name={f.name} defaultChecked={Boolean(v[f.name])} />
                        {f.hint ? <p className="text-xs text-muted">{f.hint}</p> : null}
                      </div>
                    ) : (
                      <Field key={f.name} label={f.label} name={f.name} type={f.type ?? "text"} defaultValue={String(v[f.name] ?? "")} hint={f.hint} />
                    ),
                  )}
                </div>
                <div>
                  <SubmitButton>Сохранить</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function DeliveryForm({ m }: { m: DeliveryMethod | null }) {
  const regions = new Set(m?.regions ?? []);
  return (
    <ActionForm action={saveDeliveryMethod} resetOnSuccess={!m} className="adm-form mt-3">
      {m ? <Hidden name="methodId" value={m.id} /> : null}
      <div className="adm-grid">
        <Field label="Код" name="code" defaultValue={m?.code} required />
        <Field label="Цена, ֏" name="priceAmd" type="number" min={0} defaultValue={m?.priceAmd} required />
        <Field label="Бесплатно от, ֏" name="freeFromAmd" type="number" min={0} defaultValue={m?.freeFromAmd} />
        <Field label="Порядок" name="sortOrder" type="number" defaultValue={m?.sortOrder ?? 0} />
      </div>
      <Check label="Активен" name="isActive" defaultChecked={m?.isActive ?? true} />
      <div className="grid gap-3 lg:grid-cols-2">
        {(["Hy", "Ru", "It", "En"] as const).map((l) => (
          <fieldset key={l} className="adm-fieldset grid gap-2 sm:grid-cols-2" lang={l.toLowerCase()}>
            <legend>{l.toUpperCase()}</legend>
            <Field label="Название" name={`name${l}`} defaultValue={m?.[`name${l}`]} required maxLength={120} />
            <Field label="Срок" name={`eta${l}`} defaultValue={m?.[`eta${l}`]} maxLength={120} />
          </fieldset>
        ))}
      </div>
      <fieldset className="adm-fieldset">
        <legend>Регионы (ничего не отмечено — все регионы)</legend>
        <div className="flex flex-wrap gap-x-5">
          {REGION_CODES.map((r) => (
            <Check key={r} name="regions" value={r} label={`${REGION_LABEL[r]} (${r})`} defaultChecked={regions.has(r)} />
          ))}
        </div>
      </fieldset>
      <div>
        <SubmitButton>{m ? "Сохранить" : "Добавить"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
