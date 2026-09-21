import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requestSchema, fieldErrors } from '@/lib/validation';
import { clientKey, rateLimit } from '@/lib/rate-limit';

/**
 * Every lead form in the shop (callback, measurement, kitchen calculator, door
 * quote, custom size, consultation) lands here and becomes a row the admin
 * panel shows in its inbox.
 */
export const POST = async (request: Request): Promise<Response> => {
  const limit = rateLimit(clientKey(request, 'requests'), 10, 300);
  if (!limit.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    return NextResponse.json(
      { error: errors.phone === 'invalid_phone' ? 'invalid_phone' : 'invalid_request', fields: errors },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const created = await prisma.request.create({
    data: {
      type: data.type,
      name: data.name,
      phone: data.phone,
      email: data.email || null,
      comment: data.comment || null,
      locale: data.locale,
      productId: data.productId || null,
      payload: data.payload as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, id: created.id });
};
