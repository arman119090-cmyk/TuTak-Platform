import { NextResponse } from 'next/server';
import { isDemoMode } from '@/config/brand';
import { otpRequestSchema } from '@/lib/validation';
import { clientKey, rateLimit } from '@/lib/rate-limit';

/**
 * DEMO phone login, step 1.
 *
 * No SMS provider is connected: the code is always 111111 and the endpoint
 * refuses to work at all unless demo mode is explicitly on. Wiring a real
 * provider means replacing this file and the verify step — nothing else.
 */
export const POST = async (request: Request): Promise<Response> => {
  if (!isDemoMode) return NextResponse.json({ error: 'otp_disabled' }, { status: 404 });

  const limit = rateLimit(clientKey(request, 'otp-request'), 5, 300);
  if (!limit.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parsed = otpRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });

  return NextResponse.json({ ok: true, demo: true, hint: '111111' });
};
