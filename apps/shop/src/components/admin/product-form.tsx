'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { COLORS, MATERIALS, ROOMS, PURPOSES, STYLES } from '@/data/attributes';
import { LOCALES, type Locale } from '@/lib/i18n';
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from '@/components/ui';
import { cn } from '@/lib/utils';

export type ProductFormValue = {
  id?: string;
  sku: string;
  slug: string;
  categoryId: string;
  brandId: string;
  collectionId: string | null;
  priceMinor: number;
  oldPriceMinor: number | null;
  stockStatus: 'IN_STOCK' | 'ON_ORDER' | 'OUT_OF_STOCK';
  stockQty: number;
  productionDays: number;
  widthMm: number | null;
  heightMm: number | null;
  depthMm: number | null;
  weightGram: number | null;
  country: string;
  warrantyMonths: number;
  styleKey: string;
  purposeKey: string;
  roomKey: string;
  colorKeys: string[];
  materialKeys: string[];
  specs: Record<string, string | number | boolean>;
  isNew: boolean;
  isHit: boolean;
  isPremium: boolean;
  isFeatured: boolean;
  smallSpace: boolean;
  isActive: boolean;
  translations: { locale: Locale; name: string; shortDescription: string; description: string }[];
  options: { kind: 'COLOR' | 'MATERIAL' | 'SIZE'; valueKey: string; label: string | null; priceDeltaMinor: number; isDefault: boolean }[];
};

/**
 * Product editor.
 *
 * Handles both create and edit; the same payload shape the bulk import uses, so
 * one server-side validator covers both paths. Prices are entered in whole
 * drams because AMD has no sub-unit.
 */
export const ProductForm = ({
  value,
  categories,
  brands,
  collections,
}: {
  value: ProductFormValue;
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  collections: { id: string; name: string }[];
}) => {
  const router = useRouter();
  const [form, setForm] = useState<ProductFormValue>(value);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [specsText, setSpecsText] = useState(JSON.stringify(value.specs, null, 2));

  const set = <K extends keyof ProductFormValue>(key: K, val: ProductFormValue[K]) =>
    setForm((current) => ({ ...current, [key]: val }));

  const setTranslation = (locale: Locale, key: 'name' | 'shortDescription' | 'description', val: string) =>
    setForm((current) => ({
      ...current,
      translations: current.translations.map((translation) =>
        translation.locale === locale ? { ...translation, [key]: val } : translation,
      ),
    }));

  const toggleKey = (field: 'colorKeys' | 'materialKeys', key: string) =>
    setForm((current) => ({
      ...current,
      [field]: current[field].includes(key)
        ? current[field].filter((item) => item !== key)
        : [...current[field], key],
    }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    let specs: Record<string, string | number | boolean>;
    try {
      specs = JSON.parse(specsText || '{}') as Record<string, string | number | boolean>;
    } catch {
      setMessage({ tone: 'error', text: 'Характеристики: некорректный JSON' });
      setSaving(false);
      return;
    }

    // Only languages that were actually filled in are submitted: a shop should
    // not be blocked from publishing because the Armenian copy is not ready.
    const translations = form.translations.filter((translation) => translation.name.trim().length >= 3);
    if (translations.length === 0) {
      setMessage({ tone: 'error', text: 'Укажите название хотя бы на одном языке (минимум 3 символа)' });
      setSaving(false);
      return;
    }

    const payload = { ...form, translations, specs, images: [] as { url: string; alt: string }[] };
    const response = await fetch(
      form.id ? `/api/admin/products/${form.id}` : '/api/admin/products',
      {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    setSaving(false);

    if (response.ok) {
      const data = (await response.json()) as { id: string };
      setMessage({ tone: 'success', text: 'Сохранено' });
      if (!form.id) {
        // Adopt the new id immediately: navigation to the edit route is async,
        // and a second save before it lands must update this product, not
        // create a duplicate.
        setForm((current) => ({ ...current, id: data.id }));
        router.push(`/admin/products/${data.id}`);
      }
      router.refresh();
      return;
    }
    const error = (await response.json().catch(() => ({}))) as { error?: string };
    setMessage({
      tone: 'error',
      text:
        error.error === 'duplicate_sku_or_slug'
          ? 'Артикул или URL уже заняты'
          : 'Не удалось сохранить: проверьте обязательные поля',
    });
  };

  const archive = async () => {
    if (!form.id) return;
    const response = await fetch(`/api/admin/products/${form.id}`, { method: 'DELETE' });
    if (response.ok) {
      setMessage({ tone: 'success', text: 'Товар скрыт из каталога' });
      set('isActive', false);
      router.refresh();
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      {message ? <Alert tone={message.tone === 'success' ? 'success' : 'error'}>{message.text}</Alert> : null}

      <section className="rounded-[var(--radius-md)] border border-line bg-surface p-5">
        <h2 className="mb-4 text-[15px] font-sans font-semibold">Основное</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Артикул (SKU)" required>
            <Input required value={form.sku} onChange={(event) => set('sku', event.target.value)} />
          </Field>
          <Field label="URL (slug)" required>
            <Input required value={form.slug} onChange={(event) => set('slug', event.target.value)} />
          </Field>
          <Field label="Категория" required>
            <Select value={form.categoryId} onChange={(event) => set('categoryId', event.target.value)}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Бренд" required>
            <Select value={form.brandId} onChange={(event) => set('brandId', event.target.value)}>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Коллекция">
            <Select
              value={form.collectionId ?? ''}
              onChange={(event) => set('collectionId', event.target.value || null)}
            >
              <option value="">—</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Страна (ISO-2)">
            <Input maxLength={2} value={form.country} onChange={(event) => set('country', event.target.value.toUpperCase())} />
          </Field>
        </div>
      </section>

      <section className="rounded-[var(--radius-md)] border border-line bg-surface p-5">
        <h2 className="mb-4 text-[15px] font-sans font-semibold">Цена и остатки</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Цена, ֏" required>
            <Input
              required
              inputMode="numeric"
              value={String(form.priceMinor)}
              onChange={(event) => set('priceMinor', Number(event.target.value.replace(/\D/g, '')) || 0)}
            />
          </Field>
          <Field label="Старая цена, ֏" hint="Пусто — без скидки">
            <Input
              inputMode="numeric"
              value={form.oldPriceMinor === null ? '' : String(form.oldPriceMinor)}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, '');
                set('oldPriceMinor', digits ? Number(digits) : null);
              }}
            />
          </Field>
          <Field label="Наличие">
            <Select
              value={form.stockStatus}
              onChange={(event) => set('stockStatus', event.target.value as ProductFormValue['stockStatus'])}
            >
              <option value="IN_STOCK">В наличии</option>
              <option value="ON_ORDER">Под заказ</option>
              <option value="OUT_OF_STOCK">Нет в наличии</option>
            </Select>
          </Field>
          <Field label="Остаток, шт.">
            <Input
              inputMode="numeric"
              value={String(form.stockQty)}
              onChange={(event) => set('stockQty', Number(event.target.value.replace(/\D/g, '')) || 0)}
            />
          </Field>
          <Field label="Срок изготовления, дней">
            <Input
              inputMode="numeric"
              value={String(form.productionDays)}
              onChange={(event) => set('productionDays', Number(event.target.value.replace(/\D/g, '')) || 0)}
            />
          </Field>
          <Field label="Гарантия, мес.">
            <Input
              inputMode="numeric"
              value={String(form.warrantyMonths)}
              onChange={(event) => set('warrantyMonths', Number(event.target.value.replace(/\D/g, '')) || 0)}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-[var(--radius-md)] border border-line bg-surface p-5">
        <h2 className="mb-4 text-[15px] font-sans font-semibold">Размеры</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          {(
            [
              ['widthMm', 'Ширина, мм'],
              ['depthMm', 'Глубина, мм'],
              ['heightMm', 'Высота, мм'],
              ['weightGram', 'Вес, г'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <Input
                inputMode="numeric"
                value={form[key] === null ? '' : String(form[key])}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '');
                  set(key, digits ? Number(digits) : null);
                }}
              />
            </Field>
          ))}
        </div>
      </section>

      <section className="rounded-[var(--radius-md)] border border-line bg-surface p-5">
        <h2 className="mb-4 text-[15px] font-sans font-semibold">Свойства</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Стиль">
            <Select value={form.styleKey} onChange={(event) => set('styleKey', event.target.value)}>
              {Object.entries(STYLES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label.ru}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Комната">
            <Select value={form.roomKey} onChange={(event) => set('roomKey', event.target.value)}>
              {Object.entries(ROOMS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label.ru}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Назначение">
            <Select value={form.purposeKey} onChange={(event) => set('purposeKey', event.target.value)}>
              {Object.entries(PURPOSES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label.ru}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-5">
          <span className="mb-2 block text-[13px] font-medium text-ink-soft">Цвета</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(COLORS).map(([key, color]) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleKey('colorKeys', key)}
                title={color.label.ru}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-full border px-2.5 text-[12px]',
                  form.colorKeys.includes(key) ? 'border-ink bg-surface-2' : 'border-line',
                )}
              >
                <span className="h-4 w-4 rounded-full border border-line" style={{ background: color.hex }} />
                {color.label.ru}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <span className="mb-2 block text-[13px] font-medium text-ink-soft">Материалы</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(MATERIALS).map(([key, material]) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleKey('materialKeys', key)}
                className={cn(
                  'h-9 rounded-full border px-3 text-[12px]',
                  form.materialKeys.includes(key) ? 'border-ink bg-surface-2' : 'border-line',
                )}
              >
                {material.label.ru}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-6">
          {(
            [
              ['isNew', 'NEW'],
              ['isHit', 'HIT'],
              ['isPremium', 'PREMIUM'],
              ['isFeatured', 'На главной'],
              ['smallSpace', 'Для малых квартир'],
              ['isActive', 'Опубликован'],
            ] as const
          ).map(([key, label]) => (
            <Checkbox
              key={key}
              label={label}
              checked={form[key]}
              onChange={(event) => set(key, event.target.checked)}
            />
          ))}
        </div>
      </section>

      <section className="rounded-[var(--radius-md)] border border-line bg-surface p-5">
        <h2 className="mb-4 text-[15px] font-sans font-semibold">Характеристики (JSON)</h2>
        <Textarea
          value={specsText}
          onChange={(event) => setSpecsText(event.target.value)}
          className="min-h-40 font-mono text-[12px]"
        />
        <p className="mt-2 text-[12px] text-muted">
          Ключи и значения берутся из словаря характеристик — например{' '}
          <code>{'{ "mechanism": "eurobook", "seats": 3 }'}</code>.
        </p>
      </section>

      <section className="rounded-[var(--radius-md)] border border-line bg-surface p-5">
        <h2 className="mb-4 text-[15px] font-sans font-semibold">Тексты</h2>
        <div className="space-y-5">
          {LOCALES.map((locale) => {
            const translation = form.translations.find((item) => item.locale === locale);
            return (
              <div key={locale} className="rounded-[var(--radius-sm)] border border-line p-4">
                <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">{locale}</p>
                <div className="space-y-3">
                  <Field label="Название" required={locale === 'ru'}>
                    <Input
                      value={translation?.name ?? ''}
                      onChange={(event) => setTranslation(locale, 'name', event.target.value)}
                    />
                  </Field>
                  <Field label="Короткое описание">
                    <Input
                      value={translation?.shortDescription ?? ''}
                      onChange={(event) => setTranslation(locale, 'shortDescription', event.target.value)}
                    />
                  </Field>
                  <Field label="Описание">
                    <Textarea
                      value={translation?.description ?? ''}
                      onChange={(event) => setTranslation(locale, 'description', event.target.value)}
                    />
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-line bg-bg py-4">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? <Loader2 width={16} height={16} className="animate-spin" /> : <Save width={16} height={16} />}
          Сохранить
        </Button>
        {form.id ? (
          <Button type="button" variant="ghost" onClick={archive} className="text-sale">
            <Trash2 width={16} height={16} /> Скрыть из каталога
          </Button>
        ) : null}
        <span className="text-[12px] text-muted">
          Изображения генерируются автоматически из категории и цвета товара.
        </span>
      </div>
    </form>
  );
};
