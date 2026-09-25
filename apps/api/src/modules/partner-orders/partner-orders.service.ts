import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  Currency,
  LedgerAccountType,
  OrderEscalationType,
  PartnerIntegrationStatus,
  PartnerIntegrationType,
  PartnerOrderAdjustmentStatus,
  PartnerOrderAdjustmentType,
  PartnerOrderPaymentStatus,
  PartnerOrderStatus,
  PostingDirection,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { parsePositiveMoney, roundCharge, sumDecimals } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { CustomerBalanceService } from '../customer-balance/customer-balance.service';
import { PartnersService } from '../partners/partners.service';
import { CommissionRuleService } from './commission-rule.service';
import { OrderEscalationService } from './order-escalation.service';
import { CreatePartnerOrderDto } from './dto/create-partner-order.dto';
import { RejectStockDto } from './dto/reject-stock.dto';

type Tx = Prisma.TransactionClient;

const PARTNER_VISIBLE_STATUSES: PartnerOrderStatus[] = Object.values(PartnerOrderStatus).filter(
  (s) => s !== PartnerOrderStatus.CREATED,
);

/**
 * Partner Commerce (docs/PARTNER_COMMERCE_2026-09-25.md) — spec §3-16.
 * Structural template is `PurchaseIntentsService`: a commercial snapshot
 * frozen at creation, a claim-then-act transition pattern for every status
 * change, and financial effects that only ever happen inside the same
 * database transaction as the claim that authorised them.
 */
@Injectable()
export class PartnerOrdersService {
  private readonly logger = new Logger(PartnerOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly customerBalance: CustomerBalanceService,
    private readonly partnersService: PartnersService,
    private readonly commissionRules: CommissionRuleService,
    private readonly escalations: OrderEscalationService,
    private readonly auditService: AuditService,
  ) {}

  async findByIdOrThrow(id: string) {
    const order = await this.prisma.partnerOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /**
   * Server-to-server creation — spec §3. `partnerId`/`integrationId` come
   * from the verified `PartnerApiKey`, never from the request body: the
   * whole point of API-key auth here is that a caller cannot claim to be a
   * different partner by typing a different id.
   */
  async create(partnerId: string, integrationId: string, dto: CreatePartnerOrderDto) {
    const integration = await this.prisma.partnerIntegration.findUnique({ where: { id: integrationId } });
    if (
      !integration ||
      integration.partnerId !== partnerId ||
      integration.type !== PartnerIntegrationType.WEBSITE ||
      integration.status !== PartnerIntegrationStatus.ACTIVE
    ) {
      throw new ForbiddenException('This API key is not authorised to create orders');
    }

    // Refuses PENDING_APPROVAL/SUSPENDED/REJECTED partners — see
    // PartnersService.findActiveOrThrow, same guard PurchaseIntentsService
    // applies.
    const partner = await this.partnersService.findActiveOrThrow(partnerId);

    const items = dto.items.map((item) => {
      const unitPrice = parsePositiveMoney(item.unitPrice, 'items[].unitPrice');
      const totalPrice = roundCharge(unitPrice.times(item.quantity));
      return { ...item, unitPrice, totalPrice };
    });
    const subtotal = sumDecimals(items.map((i) => i.totalPrice));
    const totalAmount = subtotal; // no shipping/tax leg yet — see PartnerOrder.totalAmount docblock

    const { rule, rateBps } = await this.commissionRules.resolve(partnerId, dto.category);
    const commissionAmount = roundCharge(totalAmount.times(rateBps).dividedBy(10_000));
    const partnerAmount = totalAmount.minus(commissionAmount);

    try {
      const order = await this.prisma.partnerOrder.create({
        data: {
          partnerId,
          integrationId,
          externalOrderId: dto.externalOrderId,
          currency: dto.currency ?? Currency.AMD,
          subtotal,
          totalAmount,
          commissionRuleId: rule?.id,
          commissionRateBps: rateBps,
          commissionAmount,
          partnerAmount,
          sourcingAllowed: partner.allowExternalSourcing,
          items: {
            create: items.map((item) => ({
              externalProductId: item.externalProductId,
              name: item.name,
              sku: item.sku,
              oemNumber: item.oemNumber,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              imageUrl: item.imageUrl,
              description: item.description,
              metadata: item.metadata as Prisma.InputJsonValue | undefined,
            })),
          },
        },
        include: { items: true },
      });

      await this.auditService.record({
        action: AuditAction.PARTNER_ORDER_CREATED,
        entityType: 'PartnerOrder',
        entityId: order.id,
        metadata: { partnerId, integrationId, externalOrderId: dto.externalOrderId, totalAmount: totalAmount.toString() },
      });

      return order;
    } catch (err) {
      // Idempotent create — a retried call with the same externalOrderId
      // returns the existing order rather than failing or duplicating it.
      // Same pattern as SettlementService.getOrCreate.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.partnerOrder.findUniqueOrThrow({
          where: { integrationId_externalOrderId: { integrationId, externalOrderId: dto.externalOrderId } },
          include: { items: true },
        });
      }
      throw err;
    }
  }

  /**
   * TuTak Checkout's own read — spec §5. Anyone authenticated may view an
   * unclaimed order (`customerId: null`) so the checkout screen can render
   * before the customer has paid; once claimed, only that customer can see
   * it. Never exposes internal-only fields (partner staff/admin identities,
   * SLA bookkeeping) — see `toCustomerDto`.
   */
  async getCheckoutOrThrow(orderId: string, requestingUserId: string) {
    const order = await this.findByIdOrThrow(orderId);
    if (order.customerId && order.customerId !== requestingUserId) {
      throw new ForbiddenException('This order belongs to a different customer');
    }
    return order;
  }

  /**
   * Spec §6: only TuTak may set PAID, and it happens here — captures the
   * order's full total from the customer's `CUSTOMER_PREPAID_BALANCE` into
   * `PARTNER_ORDER_ESCROW` and claims the order for this customer, atomically.
   * `insufficientBalance: true` is not an error — the checkout screen shows a
   * top-up prompt for it, per spec §5.
   */
  async pay(orderId: string, customerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.partnerOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Order not found');
      if (order.customerId && order.customerId !== customerId) {
        throw new ForbiddenException('This order belongs to a different customer');
      }
      if (order.paymentStatus !== PartnerOrderPaymentStatus.PAYMENT_PENDING) {
        // Idempotent: a retried pay() on an already-paid order is a no-op
        // success, not an error — the same double-tap protection every
        // claim-then-act flow in this codebase applies.
        return { order, insufficientBalance: false };
      }

      const capture = await this.customerBalance.debitForPartnerOrder(
        customerId,
        order.totalAmount,
        order.currency,
        order.partnerId,
        { type: 'PartnerOrder', id: order.id },
        tx,
      );
      if (!capture.collected) {
        return { order, insufficientBalance: true };
      }

      // Conditional on customerId still being unset (or already this
      // customer's) AND still PAYMENT_PENDING — the claim, run inside the
      // SAME transaction as the debit above. If two customers race to pay
      // the same order, both debits can start, but only one claim below can
      // succeed; the loser throws, which rolls back its own debit along
      // with it — nothing is ever stranded in escrow with no claimed order
      // to match it.
      const claimed = await tx.partnerOrder.updateMany({
        where: {
          id: orderId,
          paymentStatus: PartnerOrderPaymentStatus.PAYMENT_PENDING,
          OR: [{ customerId: null }, { customerId }],
        },
        data: {
          customerId,
          paymentStatus: PartnerOrderPaymentStatus.PAID,
          orderStatus: PartnerOrderStatus.PAID,
          paidAt: new Date(),
          captureLedgerTransactionId: capture.ledgerTransactionId,
        },
      });
      if (claimed.count === 0) {
        // Lost the race to a concurrent payer — abort so the debit above
        // rolls back with it.
        throw new ForbiddenException('This order was just claimed by another customer');
      }

      await this.auditService.record({
        actorUserId: customerId,
        action: AuditAction.PARTNER_ORDER_PAID,
        entityType: 'PartnerOrder',
        entityId: orderId,
        metadata: { totalAmount: order.totalAmount.toString() },
      });

      return { order: await tx.partnerOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } }), insufficientBalance: false };
    });
  }

  listForCustomer(customerId: string) {
    return this.prisma.partnerOrder.findMany({
      where: { customerId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Spec §7: never shows an order the customer has not actually paid for yet. */
  listForPartner(partnerId: string, status?: PartnerOrderStatus) {
    return this.prisma.partnerOrder.findMany({
      where: {
        partnerId,
        orderStatus: status ? status : { in: PARTNER_VISIBLE_STATUSES },
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Spec §7 Action 1 — acknowledgment only, never proof of stock. */
  async markSeen(orderId: string, staffUserId: string) {
    const claimed = await this.prisma.partnerOrder.updateMany({
      where: { id: orderId, orderStatus: PartnerOrderStatus.PAID },
      data: { orderStatus: PartnerOrderStatus.PARTNER_SEEN, partnerSeenAt: new Date(), partnerSeenByUserId: staffUserId },
    });
    if (claimed.count > 0) {
      await this.auditService.record({
        actorUserId: staffUserId,
        action: AuditAction.PARTNER_ORDER_SEEN,
        entityType: 'PartnerOrder',
        entityId: orderId,
      });
      await this.escalations.resolveOpenByType(orderId, [OrderEscalationType.NOT_SEEN_5MIN]);
    }
    return this.findByIdOrThrow(orderId);
  }

  /**
   * Spec §7 Action 2, "В наличии": releases the captured amount out of
   * escrow — `partnerAmount` to `PARTNER_PAYABLE`, `commissionAmount` to
   * `PLATFORM_REVENUE` — in one balanced three-leg posting. This is the
   * only place money ever reaches the partner; a partner cannot self-declare
   * stock confirmed and settle their own order any faster than this method
   * allows.
   */
  async confirmStock(orderId: string, staffUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.partnerOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Order not found');
      if (
        order.orderStatus !== PartnerOrderStatus.PAID &&
        order.orderStatus !== PartnerOrderStatus.PARTNER_SEEN
      ) {
        return order; // already resolved — idempotent, not an error
      }
      return this.releaseEscrowToPartner(tx, order, staffUserId, [order.orderStatus]);
    });
  }

  /**
   * The sourcing-resolved counterpart to `confirmStock` — same money
   * movement, reached from `SourcingTaskService` once an item is confirmed
   * available (found at the same price, or a price/alternate adjustment the
   * customer already accepted) rather than from the partner's own "В
   * наличии" button. Always called from inside the caller's own
   * transaction, since it follows a sourcing/adjustment write that must
   * commit atomically with it.
   */
  async confirmSourcedStock(
    tx: Tx,
    order: { id: string; partnerId: string; currency: Currency; totalAmount: Decimal; partnerAmount: Decimal; commissionAmount: Decimal },
    actorUserId: string,
  ) {
    return this.releaseEscrowToPartner(tx, order, actorUserId, [
      PartnerOrderStatus.SOURCING_REQUIRED,
      PartnerOrderStatus.SOURCING_IN_PROGRESS,
      PartnerOrderStatus.CUSTOMER_DECISION_REQUIRED,
    ]);
  }

  /**
   * Applies a resolved price change (spec §15) and settles the order in one
   * step: `newTotalAmount` replaces `totalAmount`, `commissionAmount`/
   * `partnerAmount` are recomputed off the order's own frozen
   * `commissionRateBps` (never a live re-resolve), and:
   *
   *  - a decrease refunds the difference from escrow back to the customer;
   *  - an increase assumes the difference was *already* captured into
   *    escrow by a prior `payAdditionalAmount` call — this method only
   *    updates the accounting, it never captures money itself;
   *  - no change (an alternate found at the same price) does neither.
   *
   * Either way, ends by releasing the (now-correct) full escrowed amount to
   * the partner/platform exactly like `confirmSourcedStock` — this is its
   * caller for every resolution path that does not need a price change.
   */
  async resolveWithNewPrice(
    tx: Tx,
    order: {
      id: string;
      partnerId: string;
      customerId: string | null;
      currency: Currency;
      totalAmount: Decimal;
      commissionRateBps: number;
    },
    newTotalAmount: Decimal,
    actorUserId: string,
    fromStatuses: PartnerOrderStatus[],
  ) {
    const delta = newTotalAmount.minus(order.totalAmount);
    let refundLedgerTransactionId: string | undefined;

    if (delta.lessThan(0) && order.customerId) {
      refundLedgerTransactionId = await this.customerBalance.creditFromPartnerOrderEscrow(
        order.customerId,
        delta.abs(),
        order.currency,
        order.partnerId,
        order.id,
        'partner_order.price_decrease_refund',
        tx,
      );
    }

    const newCommissionAmount = roundCharge(newTotalAmount.times(order.commissionRateBps).dividedBy(10_000));
    const newPartnerAmount = newTotalAmount.minus(newCommissionAmount);

    const updated = await tx.partnerOrder.update({
      where: { id: order.id },
      data: {
        totalAmount: newTotalAmount,
        commissionAmount: newCommissionAmount,
        partnerAmount: newPartnerAmount,
        ...(refundLedgerTransactionId
          ? {
              refundedAmount: { increment: delta.abs() },
              refundLedgerTransactionId,
            }
          : {}),
      },
    });

    return this.releaseEscrowToPartner(tx, updated, actorUserId, fromStatuses);
  }

  private async releaseEscrowToPartner(
    tx: Tx,
    order: { id: string; partnerId: string; currency: Currency; totalAmount: Decimal; partnerAmount: Decimal; commissionAmount: Decimal },
    actorUserId: string,
    fromStatuses: PartnerOrderStatus[],
  ) {
    const escrowAccount = await this.ledger.accountFor(
      { type: LedgerAccountType.PARTNER_ORDER_ESCROW, partnerId: order.partnerId, currency: order.currency },
      tx,
    );
    const partnerAccount = await this.ledger.accountFor(
      { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: order.partnerId, currency: order.currency },
      tx,
    );
    const platformAccount = await this.ledger.accountFor(
      { type: LedgerAccountType.PLATFORM_REVENUE, currency: order.currency },
      tx,
    );

    const postings: { accountId: string; direction: PostingDirection; amount: Decimal }[] = [
      { accountId: escrowAccount.id, direction: PostingDirection.DEBIT, amount: order.totalAmount },
    ];
    if (order.partnerAmount.greaterThan(0)) {
      postings.push({ accountId: partnerAccount.id, direction: PostingDirection.CREDIT, amount: order.partnerAmount });
    }
    if (order.commissionAmount.greaterThan(0)) {
      postings.push({ accountId: platformAccount.id, direction: PostingDirection.CREDIT, amount: order.commissionAmount });
    }

    const settlement = await this.ledger.post(
      {
        kind: 'partner_order.settlement',
        sourceType: 'PartnerOrder',
        sourceId: order.id,
        currency: order.currency,
        postings,
      },
      tx,
    );

    const claimed = await tx.partnerOrder.updateMany({
      where: { id: order.id, orderStatus: { in: fromStatuses } },
      data: {
        orderStatus: PartnerOrderStatus.STOCK_CONFIRMED,
        stockConfirmedAt: new Date(),
        stockConfirmedByUserId: actorUserId,
        settlementLedgerTransactionId: settlement.id,
      },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('This order was already updated by someone else');
    }

    await this.auditService.record({
      actorUserId,
      action: AuditAction.PARTNER_ORDER_STOCK_CONFIRMED,
      entityType: 'PartnerOrder',
      entityId: order.id,
      metadata: { partnerAmount: order.partnerAmount.toString(), commissionAmount: order.commissionAmount.toString() },
    });
    await this.escalations.resolveAllForOrder(order.id, tx);

    return tx.partnerOrder.findUniqueOrThrow({ where: { id: order.id } });
  }

  /**
   * Spec §7 Action 2, "Нет в наличии" — spec §12: not always a refund.
   * Branches on the order's own frozen `sourcingAllowed` snapshot (spec §14)
   * rather than re-reading `Partner.allowExternalSourcing` live, so a
   * partner flipping the setting mid-flight cannot change what happens to
   * an order already in progress.
   */
  async rejectStock(orderId: string, staffUserId: string, dto: RejectStockDto) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.partnerOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Order not found');
      if (
        order.orderStatus !== PartnerOrderStatus.PAID &&
        order.orderStatus !== PartnerOrderStatus.PARTNER_SEEN
      ) {
        return order; // already resolved — idempotent
      }

      const nextStatus = order.sourcingAllowed
        ? PartnerOrderStatus.SOURCING_REQUIRED
        : PartnerOrderStatus.OUT_OF_STOCK;

      const claimed = await tx.partnerOrder.updateMany({
        where: { id: orderId, orderStatus: order.orderStatus },
        data: {
          orderStatus: nextStatus,
          stockRejectedAt: new Date(),
          stockRejectedByUserId: staffUserId,
          rejectionReason: dto.reason,
        },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('This order was already updated by someone else');
      }

      await this.auditService.record({
        actorUserId: staffUserId,
        action: AuditAction.PARTNER_ORDER_STOCK_REJECTED,
        entityType: 'PartnerOrder',
        entityId: orderId,
        metadata: { sourcingAllowed: order.sourcingAllowed, reason: dto.reason },
      });

      if (order.sourcingAllowed) {
        await tx.sourcingTask.create({ data: { orderId } });
        return tx.partnerOrder.findUniqueOrThrow({ where: { id: orderId } });
      }

      // Spec §14: sourcing disabled — refund outright, no employee search.
      return this.refundInternal(tx, order, PartnerOrderAdjustmentType.OUT_OF_STOCK_REFUND, 'sourcing_disabled');
    });
  }

  /**
   * Full refund of whatever remains captured in escrow — used for
   * OUT_OF_STOCK_REFUND (sourcing disabled) and, by `SourcingTaskService`,
   * SOURCING_FAILED_REFUND (spec §16). Always the *full* captured amount:
   * nothing has been released to the partner yet at this point in either
   * flow (that only happens in `confirmStock`), so there is nothing partial
   * to compute.
   */
  async refundInternal(
    tx: Tx,
    order: { id: string; customerId: string | null; totalAmount: Decimal; currency: Currency; partnerId: string },
    type: PartnerOrderAdjustmentType,
    reason: string,
  ) {
    if (!order.customerId) {
      // Should be unreachable — an order only reaches OUT_OF_STOCK/sourcing
      // after PAID, which always sets customerId. Guarded anyway: refunding
      // to nobody is a bug, not a state this method should silently accept.
      throw new BadRequestException('Cannot refund an order that was never claimed by a customer');
    }

    // Claim first, act second — same discipline as `releaseEscrowToPartner`.
    // A concurrent second call (e.g. a race between this sweep-triggered
    // refund and a partner confirming stock at the same instant) sees
    // `count === 0` here and returns without moving money twice; this is
    // what makes `refundInternal` safe to call from more than one caller
    // (`rejectStock`, `SourcingTaskService`, `PartnerOrderAdjustmentService`)
    // without each of them re-deriving its own guard.
    const claimed = await tx.partnerOrder.updateMany({
      where: { id: order.id, paymentStatus: PartnerOrderPaymentStatus.PAID },
      data: { paymentStatus: PartnerOrderPaymentStatus.REFUNDED },
    });
    if (claimed.count === 0) {
      return tx.partnerOrder.findUniqueOrThrow({ where: { id: order.id } });
    }

    const refundLedgerTransactionId = await this.customerBalance.creditFromPartnerOrderEscrow(
      order.customerId,
      order.totalAmount,
      order.currency,
      order.partnerId,
      order.id,
      'partner_order.refund',
      tx,
    );

    await tx.partnerOrder.update({
      where: { id: order.id },
      data: {
        orderStatus: PartnerOrderStatus.REFUNDED,
        refundedAmount: order.totalAmount,
        refundedAt: new Date(),
        refundLedgerTransactionId,
      },
    });

    await tx.partnerOrderAdjustment.create({
      data: {
        orderId: order.id,
        type,
        status: PartnerOrderAdjustmentStatus.APPLIED,
        previousTotalAmount: order.totalAmount,
        newTotalAmount: 0,
        deltaAmount: order.totalAmount.negated(),
        reason,
        ledgerTransactionId: refundLedgerTransactionId,
        appliedAt: new Date(),
      },
    });

    await this.auditService.record({
      action: AuditAction.PARTNER_ORDER_REFUNDED,
      entityType: 'PartnerOrder',
      entityId: order.id,
      metadata: { reason, amount: order.totalAmount.toString() },
    });
    await this.escalations.resolveAllForOrder(order.id, tx);

    return tx.partnerOrder.findUniqueOrThrow({ where: { id: order.id } });
  }
}
