import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { newsletterSchema } from '@/lib/validation';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const POST = async (request: Request): Promise<Response> => {
  const limit = rateLimit(clientKey(request, 'newsletter'), 5, 300);
  if (!limit.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parsed = newsletterSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });

  // Re-subscribing is not an error for the customer, so upsert quietly.
  await prisma.newsletterSubscriber.upsert({
    where: { email: parsed.data.email },
    update: { locale: parsed.data.locale },
    create: { email: parsed.data.email, locale: parsed.data.locale },
  });
  return NextResponse.json({ ok: true });
};
