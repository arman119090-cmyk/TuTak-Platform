import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkoutSchema, fieldErrors } from '@/lib/validation';
import { quoteCart } from '@/lib/pricing/service';
import { apiSession } from '@/lib/auth/guards';
import { clientKey, rateLimit } from '@/lib/rate-limit';

/**
 * Order creation.
 *
 * The request carries what the customer chose; the totals are recomputed here
 * from the catalogue and written to the order. A tampered client can change
 * what it *asks* for, never what it pays.
 *
 * Card payment is mocked: `demoOutcome` lets the demo walk both the successful
 * and the declined path. A declined card leaves no order behind, exactly like a
 * real shop that only confirms after authorisation.
 */
const nextOrderNumber = async (tx: Prisma.TransactionClient): Promise<string> => {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;
  const last = await tx.order.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const lastSeq = last ? Number.parseInt(last.number.slice(prefix.length), 10) : 1000;
  return `${prefix}${(Number.isFinite(lastSeq) ? lastSeq : 1000) + 1}`;
};

export const POST = async (request: Request): Promise<Response> => {
  const limit = rateLimit(clientKey(request, 'checkout'), 20, 600);
  if (!limit.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', fields: fieldErrors(parsed.error) }, { status: 400 });
  }
  const input = parsed.data;
  const session = await apiSession();

  const quote = await quoteCart(
    {
      items: input.items,
      promoCode: input.promoCode ?? null,
      delivery: {
        method: input.delivery.method,
        regionKey: input.delivery.regionKey ?? null,
        floor: input.delivery.floor ?? null,
        hasLift: input.delivery.hasLift,
      },
      services: input.services,
    },
    input.locale,
  );

  if (quote.lines.length === 0) {
    return NextResponse.json({ error: 'empty_cart', warnings: quote.warnings }, { status: 400 });
  }

  // Mocked authorisation. A real integration replaces this block with a call to
  // the acquirer and a webhook that flips paymentStatus.
  const paymentDeclined = input.payment.method === 'CARD' && input.payment.demoOutcome === 'FAILURE';
  if (paymentDeclined) {
    return NextResponse.json({ error: 'payment_declined' }, { status: 402 });
  }
  const paid = input.payment.method === 'CARD';

  const order = await prisma.$transaction(async (tx) => {
    const promo = quote.promoCode
      ? await tx.promoCode.findUnique({ where: { code: quote.promoCode } })
      : null;

    const created = await tx.order.create({
      data: {
        number: await nextOrderNumber(tx),
        userId: session?.sub ?? null,
        status: paid ? 'PAID' : 'NEW',
        locale: input.locale,
        customerName: `${input.contacts.firstName}${input.contacts.lastName ? ` ${input.contacts.lastName}` : ''}`,
        customerPhone: input.contacts.phone,
        customerEmail: input.contacts.email,
        deliveryMethod: input.delivery.method,
        region: input.delivery.regionKey ?? null,
        city: input.delivery.city ?? null,
        street: input.delivery.street ?? null,
        building: input.delivery.building ?? null,
        apartment: input.delivery.apartment ?? null,
        entrance: input.delivery.entrance ?? null,
        floor: input.delivery.floor ?? null,
        hasLift: input.delivery.hasLift,
        pickupPoint: input.delivery.pickupPoint ?? null,
        deliverySlot: input.delivery.slot ?? null,
        comment: input.delivery.comment ?? null,
        liftService: Boolean(input.services.lift),
        assemblyService: Boolean(input.services.assembly),
        doorInstallService: Boolean(input.services.doorInstall),
        currency: quote.currency,
        subtotalMinor: quote.subtotalMinor,
        discountMinor: quote.itemsDiscountMinor,
        promoDiscountMinor: quote.promoDiscountMinor,
        deliveryMinor: quote.deliveryMinor,
        servicesMinor: quote.servicesMinor,
        totalMinor: quote.totalMinor,
        promoCodeId: promo?.id ?? null,
        promoCodeText: quote.promoCode,
        paymentMethod: input.payment.method,
        paymentStatus: paid ? 'PAID' : 'PENDING',
        paidAt: paid ? new Date() : null,
        paymentRef: paid ? `demo-${Date.now().toString(36)}` : null,
        items: {
          create: quote.lines.map((line) => ({
            productId: line.productId,
            sku: line.sku,
            nameSnapshot: line.name,
            imageUrl: line.imageUrl,
            slugSnapshot: line.slug,
            unitPriceMinor: line.unitPriceMinor,
            quantity: line.quantity,
            lineTotalMinor: line.lineTotalMinor,
            optionsSnapshot: {
              ...line.options,
              ...(line.doorConfig ? { door: line.doorConfig } : {}),
            } as Prisma.InputJsonValue,
          })),
        },
        events: {
          create: [
            { status: 'NEW', comment: 'Заказ создан на сайте' },
            ...(paid ? [{ status: 'PAID' as const, comment: 'DEMO-оплата картой проведена' }] : []),
          ],
        },
      },
      select: { id: true, number: true, totalMinor: true },
    });

    if (promo) {
      await tx.promoCode.update({
        where: { id: promo.id },
        data: { usedCount: { increment: 1 } },
      });
    }

    // Reserve stock for items that were sold from the warehouse.
    for (const line of quote.lines) {
      if (line.stockStatus !== 'IN_STOCK') continue;
      await tx.product.update({
        where: { id: line.productId },
        data: {
          stockQty: { decrement: line.quantity },
          salesCount: { increment: line.quantity },
        },
      });
    }
    await tx.product.updateMany({
      where: { stockQty: { lte: 0 }, stockStatus: 'IN_STOCK' },
      data: { stockStatus: 'ON_ORDER', stockQty: 0, productionDays: 14 },
    });

    return created;
  });

  return NextResponse.json({
    ok: true,
    number: order.number,
    totalMinor: order.totalMinor,
    paymentStatus: paid ? 'PAID' : 'PENDING',
  });
};
