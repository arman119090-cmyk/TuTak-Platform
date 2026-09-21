import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminApi } from '@/lib/auth/admin-api';
import { LOCALES } from '@/lib/i18n';

const brandSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(2).max(80),
  country: z.string().trim().length(2).default('AM'),
  isPremium: z.boolean().default(false),
  tagline: z.string().trim().max(160).default(''),
  description: z.string().trim().max(600).default(''),
});

const collectionSchema = z.object({
  kind: z.literal('collection'),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(2).max(80),
  brandId: z.string().max(64).nullish(),
});

export const POST = async (request: Request): Promise<Response> => {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);

  const asCollection = collectionSchema.safeParse(body);
  if (asCollection.success) {
    const exists = await prisma.collection.findUnique({ where: { slug: asCollection.data.slug } });
    if (exists) return NextResponse.json({ error: 'duplicate_slug' }, { status: 409 });
    const created = await prisma.collection.create({
      data: {
        slug: asCollection.data.slug,
        name: asCollection.data.name,
        brandId: asCollection.data.brandId || null,
        translations: {
          create: LOCALES.map((locale) => ({ locale, name: asCollection.data.name })),
        },
      },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, id: created.id });
  }

  const parsed = brandSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const exists = await prisma.brand.findUnique({ where: { slug: parsed.data.slug } });
  if (exists) return NextResponse.json({ error: 'duplicate_slug' }, { status: 409 });

  const created = await prisma.brand.create({
    data: {
      slug: parsed.data.slug,
      name: parsed.data.name,
      country: parsed.data.country,
      isPremium: parsed.data.isPremium,
      translations: {
        create: LOCALES.map((locale) => ({
          locale,
          tagline: parsed.data.tagline,
          description: parsed.data.description,
        })),
      },
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: created.id });
};
