import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { registerSchema, fieldErrors } from '@/lib/validation';
import { hashPassword } from '@/lib/auth/password';
import { setSessionCookie, signSession } from '@/lib/auth/session';
import { authAttemptsLimit, clientKey, rateLimit } from '@/lib/rate-limit';

export const POST = async (request: Request): Promise<Response> => {
  const limit = rateLimit(
    clientKey(request, 'register'),
    Math.max(5, Math.floor(authAttemptsLimit() / 2)),
    600,
  );
  if (!limit.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return NextResponse.json({ error: 'email_taken' }, { status: 409 });

  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      phone: parsed.data.phone ?? null,
      passwordHash: await hashPassword(parsed.data.password),
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName || null,
      locale: parsed.data.locale,
      // New accounts are always customers: the admin role is never self-served.
      role: 'CUSTOMER',
    },
  });

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
