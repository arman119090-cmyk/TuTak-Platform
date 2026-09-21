import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminApi } from '@/lib/auth/admin-api';
import { adminOrderStatusSchema } from '@/lib/validation';

/**
 * Order status change.
 *
 * Writes the new status and appends an event, so the customer's "order
 * history" in their account shows exactly what the operator did and when.
 */
export const PATCH = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const parsed = adminOrderStatusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const order = await prisma.order.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { status, comment } = parsed.data;
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.order.update({
      where: { id },
      data: {
        status,
        // Marking an order paid also settles its payment state.
        ...(status === 'PAID' ? { paymentStatus: 'PAID' as const, paidAt: new Date() } : {}),
        ...(status === 'CANCELLED' ? { paymentStatus: 'FAILED' as const } : {}),
      },
      select: { id: true, status: true, number: true },
    });
    await tx.orderEvent.create({
      data: { orderId: id, status, comment: comment || null, actorId: guard.session.sub },
    });
    return result;
  });

  return NextResponse.json({ ok: true, status: updated.status, number: updated.number });
};
