import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { profileSchema } from '@/lib/validation';
import { apiSession } from '@/lib/auth/guards';

export const PATCH = async (request: Request): Promise<Response> => {
  const session = await apiSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  // The e-mail and the role are deliberately not updatable from here.
  await prisma.user.update({
    where: { id: session.sub },
    data: {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName || null,
      phone: parsed.data.phone ?? null,
      locale: parsed.data.locale,
    },
  });
  return NextResponse.json({ ok: true });
};
