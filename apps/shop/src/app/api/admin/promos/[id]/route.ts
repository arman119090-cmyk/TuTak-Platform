import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminApi } from '@/lib/auth/admin-api';

const patchSchema = z.object({ isActive: z.boolean() });

export const PATCH = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const result = await prisma.promoCode.updateMany({
    where: { id },
    data: { isActive: parsed.data.isActive },
  });
  if (result.count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
};

export const DELETE = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  // Codes already used by an order are deactivated instead of deleted so the
  // order keeps its reference.
  const used = await prisma.order.count({ where: { promoCodeId: id } });
  if (used > 0) {
    await prisma.promoCode.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await prisma.promoCode.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
};
