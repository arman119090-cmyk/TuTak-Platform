import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { addressSchema } from '@/lib/validation';
import { apiSession } from '@/lib/auth/guards';

export const POST = async (request: Request): Promise<Response> => {
  const session = await apiSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = addressSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const data = parsed.data;
  if (data.isDefault) {
    await prisma.address.updateMany({ where: { userId: session.sub }, data: { isDefault: false } });
  }
  await prisma.address.create({
    data: {
      userId: session.sub,
      label: data.label,
      region: data.region,
      city: data.city,
      street: data.street,
      building: data.building,
      apartment: data.apartment || null,
      entrance: data.entrance || null,
      floor: data.floor ?? null,
      hasLift: data.hasLift,
      comment: data.comment || null,
      isDefault: data.isDefault,
    },
  });
  return NextResponse.json({ ok: true });
};

export const DELETE = async (request: Request): Promise<Response> => {
  const session = await apiSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  // deleteMany with the userId in the filter: one customer cannot delete
  // another customer's address by guessing an id.
  const result = await prisma.address.deleteMany({ where: { id, userId: session.sub } });
  if (result.count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
};
