import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { Plus } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { formatMoney } from '@/lib/money';
import { AdminHeading, AdminLink, Panel, Table } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

const AdminProducts = async ({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; stock?: string }>;
}) => {
  const { q, page: pageParam, stock } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const where: Prisma.ProductWhereInput = {
    ...(q ? { searchText: { contains: q.toLowerCase() } } : {}),
    ...(stock === 'out' ? { stockStatus: 'OUT_OF_STOCK' as const } : {}),
  };

  const [total, products, categories] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        sku: true,
        priceMinor: true,
        oldPriceMinor: true,
        stockStatus: true,
        stockQty: true,
        isActive: true,
        images: { take: 1, orderBy: { sort: 'asc' }, select: { url: true } },
        translations: { where: { locale: 'ru' }, select: { name: true } },
        category: { select: { slug: true, translations: { where: { locale: 'ru' }, select: { name: true } } } },
      },
    }),
    prisma.category.count(),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <AdminHeading
        title="Товары"
        subtitle={`${total} позиций · ${categories} категорий`}
        action={
          <Link
            href="/admin/products/new"
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] bg-ink px-4 text-[13px] font-medium text-white"
          >
            <Plus width={16} height={16} /> Добавить товар
          </Link>
        }
      />

      <form className="mb-4 flex flex-wrap gap-2" action="/admin/products">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Поиск по названию, артикулу, материалу…"
          className="h-10 min-w-64 flex-1 rounded-[var(--radius-sm)] border border-line bg-surface px-3 text-[13px]"
        />
        <select
          name="stock"
          defaultValue={stock ?? ''}
          className="h-10 rounded-[var(--radius-sm)] border border-line bg-surface px-3 text-[13px]"
        >
          <option value="">Все остатки</option>
          <option value="out">Нет в наличии</option>
        </select>
        <button type="submit" className="h-10 rounded-[var(--radius-sm)] bg-surface-2 px-4 text-[13px]">
          Найти
        </button>
      </form>

      <Panel>
        <Table head={['', 'Товар', 'Категория', 'Цена', 'Остаток', 'Статус', '']}>
          {products.map((product) => (
            <tr key={product.id}>
              <td className="py-2 pl-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={product.images[0]?.url ?? ''}
                  alt=""
                  className="h-10 w-14 rounded-[var(--radius-xs)] bg-surface-2 object-cover"
                  loading="lazy"
                />
              </td>
              <td className="px-4 py-2">
                <AdminLink href={`/admin/products/${product.id}`}>
                  {product.translations[0]?.name ?? product.sku}
                </AdminLink>
                <span className="block text-[12px] text-muted">{product.sku}</span>
              </td>
              <td className="px-4 py-2 text-muted">
                {product.category.translations[0]?.name ?? product.category.slug}
              </td>
              <td className="px-4 py-2 tabular-nums">
                {formatMoney(product.priceMinor)}
                {product.oldPriceMinor ? (
                  <span className="ml-1 text-[11px] text-muted line-through">
                    {formatMoney(product.oldPriceMinor)}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-2 tabular-nums">{product.stockQty}</td>
              <td className="px-4 py-2">
                <span
                  className={
                    product.stockStatus === 'IN_STOCK'
                      ? 'text-success'
                      : product.stockStatus === 'ON_ORDER'
                        ? 'text-muted'
                        : 'text-sale'
                  }
                >
                  {product.stockStatus === 'IN_STOCK'
                    ? 'В наличии'
                    : product.stockStatus === 'ON_ORDER'
                      ? 'Под заказ'
                      : 'Нет'}
                </span>
                {!product.isActive ? <span className="ml-2 text-[11px] text-sale">скрыт</span> : null}
              </td>
              <td className="px-4 py-2 text-right">
                <AdminLink href={`/admin/products/${product.id}`}>Изменить</AdminLink>
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      {pageCount > 1 ? (
        <nav className="mt-4 flex flex-wrap gap-1.5">
          {Array.from({ length: pageCount }, (_, index) => index + 1)
            .filter((item) => item === 1 || item === pageCount || Math.abs(item - page) <= 2)
            .map((item) => (
              <Link
                key={item}
                href={`/admin/products?${new URLSearchParams({ ...(q ? { q } : {}), ...(stock ? { stock } : {}), page: String(item) })}`}
                className={`flex h-9 min-w-9 items-center justify-center rounded-[var(--radius-sm)] border px-2.5 text-[13px] tabular-nums ${
                  item === page ? 'border-ink bg-ink text-white' : 'border-line bg-surface'
                }`}
              >
                {item}
              </Link>
            ))}
        </nav>
      ) : null}
    </>
  );
};

export default AdminProducts;
