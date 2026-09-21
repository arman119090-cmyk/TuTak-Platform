import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminApi } from '@/lib/auth/admin-api';
import { LOCALES } from '@/lib/i18n';

const createSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  parentId: z.string().max(64).nullish(),
  artKey: z.string().trim().min(2).max(40),
  names: z.object({
    hy: z.string().min(1).max(120),
    ru: z.string().min(1).max(120),
    en: z.string().min(1).max(120),
  }),
});

const updateSchema = z.object({
  id: z.string().min(1),
  names: z
    .object({
      hy: z.string().min(1).max(120),
      ru: z.string().min(1).max(120),
      en: z.string().min(1).max(120),
    })
    .optional(),
  isActive: z.boolean().optional(),
  sort: z.number().int().min(0).max(999).optional(),
});

export const POST = async (request: Request): Promise<Response> => {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const exists = await prisma.category.findUnique({ where: { slug: parsed.data.slug } });
  if (exists) return NextResponse.json({ error: 'duplicate_slug' }, { status: 409 });

  const created = await prisma.category.create({
    data: {
      slug: parsed.data.slug,
      parentId: parsed.data.parentId || null,
      artKey: parsed.data.artKey,
      translations: {
        create: LOCALES.map((locale) => ({ locale, name: parsed.data.names[locale] })),
      },
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: created.id });
};

export const PATCH = async (request: Request): Promise<Response> => {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const { id, names, isActive, sort } = parsed.data;

  await prisma.category.update({
    where: { id },
    data: {
      ...(isActive === undefined ? {} : { isActive }),
      ...(sort === undefined ? {} : { sort }),
    },
  });
  if (names) {
    for (const locale of LOCALES) {
      await prisma.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: id, locale } },
        update: { name: names[locale] },
        create: { categoryId: id, locale, name: names[locale] },
      });
    }
  }
  return NextResponse.json({ ok: true });
};
