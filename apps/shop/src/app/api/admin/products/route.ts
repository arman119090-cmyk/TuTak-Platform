import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth/admin-api';
import { adminProductSchema, fieldErrors } from '@/lib/validation';
import { upsertProduct } from '@/lib/admin/product-write';

export const POST = async (request: Request): Promise<Response> => {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const parsed = adminProductSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', fields: fieldErrors(parsed.error) }, { status: 400 });
  }

  try {
    const product = await upsertProduct(parsed.data);
    return NextResponse.json({ ok: true, id: product.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    // A duplicate SKU or slug is a user mistake, not a server failure.
    const conflict = message.includes('Unique constraint');
    return NextResponse.json(
      { error: conflict ? 'duplicate_sku_or_slug' : 'create_failed' },
      { status: conflict ? 409 : 500 },
    );
  }
};
