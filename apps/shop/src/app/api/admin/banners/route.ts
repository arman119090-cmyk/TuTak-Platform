import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminApi } from '@/lib/auth/admin-api';

const patchSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean().optional(),
  sort: z.number().int().min(0).max(99).optional(),
  href: z.string().max(200).optional(),
});

export const PATCH = async (request: Request): Promise<Response> => {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const { id, ...data } = parsed.data;

  const result = await prisma.banner.updateMany({ where: { id }, data });
  if (result.count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
};
