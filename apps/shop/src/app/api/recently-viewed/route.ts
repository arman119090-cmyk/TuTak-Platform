import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiSession } from '@/lib/auth/guards';

const bodySchema = z.object({ productId: z.string().min(1).max(64) });

/** Mirrors the browser's "recently viewed" list for signed-in customers. */
export const POST = async (request: Request): Promise<Response> => {
  const session = await apiSession();
  if (!session) return NextResponse.json({ ok: true });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const exists = await prisma.product.findUnique({
    where: { id: parsed.data.productId },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ ok: true });

  await prisma.recentlyViewed.upsert({
    where: { userId_productId: { userId: session.sub, productId: parsed.data.productId } },
    update: { viewedAt: new Date() },
    create: { userId: session.sub, productId: parsed.data.productId },
  });
  return NextResponse.json({ ok: true });
};
