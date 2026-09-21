import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isDemoMode } from '@/config/brand';
import { otpVerifySchema } from '@/lib/validation';
import { hashPassword } from '@/lib/auth/password';
import { setSessionCookie, signSession } from '@/lib/auth/session';
import { clientKey, rateLimit } from '@/lib/rate-limit';

const DEMO_CODE = '111111';

/**
 * DEMO phone login, step 2. Accepts the fixed demo code and signs the customer
 * in, creating a lightweight account on first use.
 */
export const POST = async (request: Request): Promise<Response> => {
  if (!isDemoMode) return NextResponse.json({ error: 'otp_disabled' }, { status: 404 });

  const limit = rateLimit(clientKey(request, 'otp-verify'), 10, 300);
  if (!limit.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parsed = otpVerifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  if (parsed.data.code !== DEMO_CODE) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 401 });
  }

  const phone = parsed.data.phone;
  let user = await prisma.user.findFirst({ where: { phone } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: `phone-${phone.replace(/\D/g, '')}@demo.local`,
        phone,
        // The account has no usable password: it exists only for OTP sign-in.
        passwordHash: await hashPassword(`otp-only-${crypto.randomUUID()}`),
        firstName: 'Гость',
        role: 'CUSTOMER',
      },
    });
  }

  await setSessionCookie(
    await signSession({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`,
    }),
  );
  return NextResponse.json({ ok: true });
};
