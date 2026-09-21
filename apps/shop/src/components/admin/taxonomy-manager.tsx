'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/ui/modal';
import { Panel, Table } from './ui';

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  parentName: string | null;
  productCount: number;
  isActive: boolean;
};

export type BrandRow = {
  id: string;
  slug: string;
  name: string;
  country: string;
  productCount: number;
};
export type CollectionRow = { id: string; slug: string; name: string; productCount: number };

/** Create/rename categories, brands and collections without leaving the panel. */
export const TaxonomyManager = ({
  categories,
  brands,
  collections,
}: {
  categories: CategoryRow[];
  brands: BrandRow[];
  collections: CollectionRow[];
}) => {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | 'category' | 'brand' | 'collection'>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    slug: '',
    nameRu: '',
    nameHy: '',
    nameEn: '',
    parentId: '',
    artKey: 'shelving',
    country: 'AM',
    isPremium: false,
    brandId: '',
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const endpoint = dialog === 'category' ? '/api/admin/categories' : '/api/admin/brands';
    const body =
      dialog === 'category'
        ? {
            slug: form.slug,
            parentId: form.parentId || null,
            artKey: form.artKey,
            names: {
              ru: form.nameRu,
              hy: form.nameHy || form.nameRu,
              en: form.nameEn || form.nameRu,
            },
          }
        : dialog === 'collection'
          ? {
              kind: 'collection',
              slug: form.slug,
              name: form.nameRu,
              brandId: form.brandId || null,
            }
          : {
              slug: form.slug,
              name: form.nameRu,
              country: form.country,
              isPremium: form.isPremium,
              tagline: '',
              description: '',
            };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      setDialog(null);
      setForm({ ...form, slug: '', nameRu: '', nameHy: '', nameEn: '' });
      router.refresh();
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setError(data.error === 'duplicate_slug' ? 'Такой slug уже занят' : 'Проверьте поля формы');
  };

  const toggleCategory = async (category: CategoryRow) => {
    await fetch('/api/admin/categories', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: category.id, isActive: !category.isActive }),
    });
    router.refresh();
  };

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-sans font-semibold">Категории ({categories.length})</h2>
          <Button size="sm" onClick={() => setDialog('category')}>
            <Plus width={15} height={15} /> Категория
          </Button>
        </div>
        <Panel>
          <Table head={['Название', 'Родитель', 'Slug', 'Товаров', 'Статус']}>
            {categories.map((category) => (
              <tr key={category.id}>
                <td className="px-4 py-2.5">{category.name}</td>
                <td className="px-4 py-2.5 text-muted">{category.parentName ?? '—'}</td>
                <td className="px-4 py-2.5 text-muted">{category.slug}</td>
                <td className="px-4 py-2.5 tabular-nums">{category.productCount}</td>
                <td className="px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleCategory(category)}
                    className={category.isActive ? 'text-success' : 'text-muted'}
                  >
                    {category.isActive ? 'Активна' : 'Скрыта'}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-sans font-semibold">Бренды ({brands.length})</h2>
          <Button size="sm" onClick={() => setDialog('brand')}>
            <Plus width={15} height={15} /> Бренд
          </Button>
        </div>
        <Panel>
          <Table head={['Бренд', 'Slug', 'Страна', 'Товаров']}>
            {brands.map((brand) => (
              <tr key={brand.id}>
                <td className="px-4 py-2.5">{brand.name}</td>
                <td className="px-4 py-2.5 text-muted">{brand.slug}</td>
                <td className="px-4 py-2.5 text-muted">{brand.country}</td>
                <td className="px-4 py-2.5 tabular-nums">{brand.productCount}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-sans font-semibold">Коллекции ({collections.length})</h2>
          <Button size="sm" onClick={() => setDialog('collection')}>
            <Plus width={15} height={15} /> Коллекция
          </Button>
        </div>
        <Panel>
          <Table head={['Коллекция', 'Slug', 'Товаров']}>
            {collections.map((collection) => (
              <tr key={collection.id}>
                <td className="px-4 py-2.5">{collection.name}</td>
                <td className="px-4 py-2.5 text-muted">{collection.slug}</td>
                <td className="px-4 py-2.5 tabular-nums">{collection.productCount}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </section>

      {dialog ? (
        <Modal
          title={
            dialog === 'category'
              ? 'Новая категория'
              : dialog === 'brand'
                ? 'Новый бренд'
                : 'Новая коллекция'
          }
          onClose={() => setDialog(null)}
        >
          <form onSubmit={submit} className="space-y-4">
            <Field label="Slug (латиницей)" required>
              <Input
                required
                value={form.slug}
                onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })}
              />
            </Field>
            <Field label="Название (RU)" required>
              <Input
                required
                value={form.nameRu}
                onChange={(event) => setForm({ ...form, nameRu: event.target.value })}
              />
            </Field>
            {dialog === 'category' ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Название (HY)">
                    <Input
                      value={form.nameHy}
                      onChange={(event) => setForm({ ...form, nameHy: event.target.value })}
                    />
                  </Field>
                  <Field label="Название (EN)">
                    <Input
                      value={form.nameEn}
                      onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Родительская категория">
                  <Select
                    value={form.parentId}
                    onChange={(event) => setForm({ ...form, parentId: event.target.value })}
                  >
                    <option value="">— корневая —</option>
                    {categories
                      .filter((category) => category.parentName === null)
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Ключ иллюстрации" hint="например sofa, bed, door, kitchen">
                  <Input
                    value={form.artKey}
                    onChange={(event) => setForm({ ...form, artKey: event.target.value })}
                  />
                </Field>
              </>
            ) : null}
            {dialog === 'brand' ? (
              <>
                <Field label="Страна (ISO-2)">
                  <Input
                    maxLength={2}
                    value={form.country}
                    onChange={(event) =>
                      setForm({ ...form, country: event.target.value.toUpperCase() })
                    }
                  />
                </Field>
                <Checkbox
                  label="Премиальный бренд"
                  checked={form.isPremium}
                  onChange={(event) => setForm({ ...form, isPremium: event.target.checked })}
                />
              </>
            ) : null}
            {dialog === 'collection' ? (
              <Field label="Бренд">
                <Select
                  value={form.brandId}
                  onChange={(event) => setForm({ ...form, brandId: event.target.value })}
                >
                  <option value="">—</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {error ? <p className="text-[13px] text-sale">{error}</p> : null}
            <Button type="submit" className="w-full">
              Создать
            </Button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
};
