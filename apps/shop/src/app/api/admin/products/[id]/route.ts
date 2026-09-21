import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminApi } from '@/lib/auth/admin-api';
import { adminProductSchema, fieldErrors } from '@/lib/validation';
import { upsertProduct } from '@/lib/admin/product-write';

export const PATCH = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = adminProductSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  await upsertProduct(parsed.data, id);
  return NextResponse.json({ ok: true, id });
};

export const DELETE = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  // Soft delete: orders reference products, and history must not lose its rows.
  const result = await prisma.product.updateMany({ where: { id }, data: { isActive: false } });
  if (result.count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
};
