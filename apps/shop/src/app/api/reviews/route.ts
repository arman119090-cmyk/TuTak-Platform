import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { reviewSchema } from '@/lib/validation';
import { apiSession } from '@/lib/auth/guards';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const POST = async (request: Request): Promise<Response> => {
  const session = await apiSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limit = rateLimit(clientKey(request, 'reviews'), 5, 600);
  if (!limit.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { firstName: true, lastName: true },
  });

  await prisma.review.create({
    data: {
      productId: parsed.data.productId,
      userId: session.sub,
      authorName: `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || 'Покупатель',
      rating: parsed.data.rating,
      title: parsed.data.title || null,
      body: parsed.data.body,
      locale: parsed.data.locale,
    },
  });

  // Keep the denormalised rating consistent with the review table.
  const aggregate = await prisma.review.aggregate({
    where: { productId: parsed.data.productId, isPublished: true },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await prisma.product.update({
    where: { id: parsed.data.productId },
    data: {
      ratingAvg: Number((aggregate._avg.rating ?? 0).toFixed(2)),
      reviewCount: aggregate._count._all,
    },
  });

  return NextResponse.json({ ok: true });
};
