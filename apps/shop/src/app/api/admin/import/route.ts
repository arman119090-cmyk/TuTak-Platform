import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminApi } from '@/lib/auth/admin-api';
import { importRowSchema, type ImportRow } from '@/lib/validation';
import { csvToObjects } from '@/lib/admin/csv';
import { upsertProduct } from '@/lib/admin/product-write';
import { slugify } from '@/lib/utils';

const bodySchema = z.object({
  format: z.enum(['csv', 'json']),
  payload: z.string().min(2).max(2_000_000),
  /** Dry run reports what would happen without writing anything. */
  dryRun: z.boolean().default(false),
});

type RowResult = { sku: string; status: 'created' | 'updated' | 'skipped'; reason?: string };

/**
 * Bulk product import (CSV or JSON).
 *
 * Rows are validated one by one: a bad row is reported and skipped rather than
 * failing the whole file, which is what an operator pasting a spreadsheet
 * actually needs. Categories and brands are matched by slug and must exist.
 */
export const POST = async (request: Request): Promise<Response> => {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  let rawRows: unknown[];
  if (parsed.data.format === 'csv') {
    rawRows = csvToObjects(parsed.data.payload);
  } else {
    try {
      const json: unknown = JSON.parse(parsed.data.payload);
      rawRows = Array.isArray(json) ? json : [json];
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
  }

  if (rawRows.length === 0) return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  if (rawRows.length > 500) return NextResponse.json({ error: 'too_many_rows' }, { status: 400 });

  const [categories, brands] = await Promise.all([
    prisma.category.findMany({ select: { id: true, slug: true } }),
    prisma.brand.findMany({ select: { id: true, slug: true } }),
  ]);
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));
  const brandBySlug = new Map(brands.map((brand) => [brand.slug, brand.id]));

  const results: RowResult[] = [];

  for (const raw of rawRows) {
    const row = importRowSchema.safeParse(raw);
    if (!row.success) {
      const sku = (raw as { sku?: string })?.sku ?? '—';
      results.push({ sku, status: 'skipped', reason: row.error.issues[0]?.message ?? 'invalid_row' });
      continue;
    }

    const data: ImportRow = row.data;
    const categoryId = categoryBySlug.get(data.categorySlug);
    const brandId = brandBySlug.get(data.brandSlug);
    if (!categoryId || !brandId) {
      results.push({
        sku: data.sku,
        status: 'skipped',
        reason: !categoryId ? `category_not_found:${data.categorySlug}` : `brand_not_found:${data.brandSlug}`,
      });
      continue;
    }

    if (parsed.data.dryRun) {
      results.push({ sku: data.sku, status: 'created' });
      continue;
    }

    const existing = await prisma.product.findUnique({ where: { sku: data.sku }, select: { id: true } });
    const colorKeys = (data.colorKeys ?? 'beige').split(/[,;|]/).map((key) => key.trim()).filter(Boolean);
    const materialKeys = (data.materialKeys ?? 'mdf').split(/[,;|]/).map((key) => key.trim()).filter(Boolean);

    await upsertProduct(
      {
        sku: data.sku,
        slug: slugify(`${data.nameRu}-${data.sku}`),
        categoryId,
        brandId,
        collectionId: null,
        priceMinor: data.priceMinor,
        oldPriceMinor: data.oldPriceMinor ?? null,
        stockStatus: data.stockQty > 0 ? 'IN_STOCK' : 'ON_ORDER',
        stockQty: data.stockQty,
        productionDays: data.stockQty > 0 ? 0 : 14,
        widthMm: data.widthMm ?? null,
        heightMm: data.heightMm ?? null,
        depthMm: data.depthMm ?? null,
        weightGram: null,
        country: 'AM',
        warrantyMonths: 24,
        styleKey: data.styleKey ?? 'modern',
        purposeKey: 'home',
        roomKey: 'living',
        colorKeys,
        materialKeys,
        specs: {},
        isNew: true,
        isHit: false,
        isPremium: false,
        isFeatured: false,
        smallSpace: false,
        isActive: true,
        translations: [
          {
            locale: 'ru',
            name: data.nameRu,
            shortDescription: '',
            description: data.descriptionRu ?? '',
          },
          {
            locale: 'hy',
            name: data.nameHy || data.nameRu,
            shortDescription: '',
            description: data.descriptionRu ?? '',
          },
          {
            locale: 'en',
            name: data.nameEn || data.nameRu,
            shortDescription: '',
            description: data.descriptionRu ?? '',
          },
        ],
        images: [],
        options: [],
      },
      existing?.id,
    );

    results.push({ sku: data.sku, status: existing ? 'updated' : 'created' });
  }

  return NextResponse.json({
    ok: true,
    dryRun: parsed.data.dryRun,
    total: results.length,
    created: results.filter((result) => result.status === 'created').length,
    updated: results.filter((result) => result.status === 'updated').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    results: results.slice(0, 100),
  });
};
