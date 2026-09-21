import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminApi } from '@/lib/auth/admin-api';
import { adminPromoSchema, fieldErrors } from '@/lib/validation';

export const POST = async (request: Request): Promise<Response> => {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const parsed = adminPromoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const existing = await prisma.promoCode.findUnique({ where: { code: data.code } });
  if (existing) return NextResponse.json({ error: 'duplicate_code' }, { status: 409 });

  const promo = await prisma.promoCode.create({
    data: {
      code: data.code,
      discountType: data.discountType,
      value: data.value,
      minSubtotalMinor: data.minSubtotalMinor ?? null,
      maxDiscountMinor: data.maxDiscountMinor ?? null,
      freeDelivery: data.freeDelivery,
      usageLimit: data.usageLimit ?? null,
      isActive: data.isActive,
      description: data.description,
      startsAt: data.startsAt ? new Date(data.startsAt) : null,
      endsAt: data.endsAt ? new Date(data.endsAt) : null,
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: promo.id });
};
