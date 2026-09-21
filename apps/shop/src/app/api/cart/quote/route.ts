import { NextResponse } from 'next/server';
import { quoteCart } from '@/lib/pricing/service';
import { quoteRequestSchema } from '@/lib/validation';
import { DEFAULT_LOCALE } from '@/lib/i18n';
import { clientKey, rateLimit } from '@/lib/rate-limit';

/**
 * The cart's single source of truth for money.
 *
 * The browser sends product ids, quantities and option keys; every price,
 * discount, delivery fee and total comes back from the server.
 */
export const POST = async (request: Request): Promise<Response> => {
  const limit = rateLimit(clientKey(request, 'quote'), 120, 60);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = quoteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  }

  const quote = await quoteCart(
    {
      items: parsed.data.items,
      promoCode: parsed.data.promoCode ?? null,
      delivery: parsed.data.delivery,
      services: parsed.data.services,
    },
    parsed.data.locale ?? DEFAULT_LOCALE,
  );
  return NextResponse.json(quote);
};
