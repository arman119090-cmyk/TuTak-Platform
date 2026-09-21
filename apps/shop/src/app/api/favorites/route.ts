import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiSession } from '@/lib/auth/guards';

const bodySchema = z.object({
  productId: z.string().min(1).max(64),
  action: z.enum(['add', 'remove']),
});

export const GET = async (): Promise<Response> => {
  const session = await apiSession();
  if (!session) return NextResponse.json({ productIds: [] });
  const rows = await prisma.favorite.findMany({
    where: { userId: session.sub },
    select: { productId: true },
  });
  return NextResponse.json({ productIds: rows.map((row) => row.productId) });
};

export const POST = async (request: Request): Promise<Response> => {
  const session = await apiSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const { productId, action } = parsed.data;
  if (action === 'add') {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    await prisma.favorite.upsert({
      where: { userId_productId: { userId: session.sub, productId } },
      update: {},
      create: { userId: session.sub, productId },
    });
  } else {
    await prisma.favorite
      .delete({ where: { userId_productId: { userId: session.sub, productId } } })
      .catch(() => null);
  }
  return NextResponse.json({ ok: true });
};
