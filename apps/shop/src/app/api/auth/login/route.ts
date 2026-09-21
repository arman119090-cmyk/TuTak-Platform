import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loginSchema } from '@/lib/validation';
import { verifyPassword } from '@/lib/auth/password';
import { setSessionCookie, signSession } from '@/lib/auth/session';
import { authAttemptsLimit, clientKey, rateLimit } from '@/lib/rate-limit';

export const POST = async (request: Request): Promise<Response> => {
  // Brute-force protection: ten attempts per IP per five minutes.
  const limit = rateLimit(clientKey(request, 'login'), authAttemptsLimit(), 300);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfter: limit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_credentials' }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  // Same message and roughly the same work for "no such user" and "wrong
  // password": the response must not tell an attacker which one it was.
  if (!user || !user.isActive || !(await verifyPassword(user.passwordHash, parsed.data.password))) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const token = await signSession({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`,
  });
  await setSessionCookie(token);

  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, role: user.role, firstName: user.firstName },
  });
};
