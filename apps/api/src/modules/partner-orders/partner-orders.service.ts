import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  Currency,
  OrderEscalationType,
  PartnerIntegrationStatus,
  PartnerIntegrationType,
  PartnerOrderActorType,
  PartnerOrderAdjustmentStatus,
  PartnerOrderDisputeStatus,
  PartnerOrderOperationalStatus as Op,
  PartnerOrderPaymentStatus as Pay,
  PartnerOrderSourcingStatus as Sourcing,
  PaymentLegPurpose,
  PaymentLegStatus,
  PaymentLegType,
  Prisma,
  SourcingTaskStatus,
  TransactionType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { parseMoney, parsePositiveMoney, roundCharge, sumDecimals } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommissionDistributionService } from '../commission-distribution/commission-distribution.service';
import { CustomerBalanceService } from '../customer-balance/customer-balance.service';
import { EmployeeShiftService } from '../employee-shifts/employee-shift.service';
import { PartnersService } from '../partners/partners.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CommerceRulesService } from './commerce-rules.service';
import { OrderEscalationService } from './order-escalation.service';
import { PartnerOrderNotifier } from './partner-order-notifier.service';
import { PartnerOrderPaymentsService, PaymentSplit } from './partner-order-payments.service';
import { CreatePartnerOrderDto } from './dto/create-partner-order.dto';
import { RejectStockDto } from './dto/reject-stock.dto';
import { SubmitPartnerOrderDto } from './dto/submit-partner-order.dto';

type Tx = Prisma.TransactionClient;

const ZERO = new Decimal(0);

/** Before the goods leave the partner — the only window a plain cancellation exists in (spec §43). */
export const PRE_HANDOVER: Op[] = [Op.SUBMITTED, Op.SEEN, Op.STOCK_CONFIRMED, Op.OUT_OF_STOCK];
/** Where the customer's "Получил заказ" is available (spec §31: only after stock is confirmed). */
export const RECEIPT_ALLOWED_FROM: Op[] = [Op.STOCK_CONFIRMED, Op.HANDED_OVER];
/** Everything a partner works on — never an unconfirmed DRAFT or an EXPIRED cart. */
export const PARTNER_VISIBLE: Op[] = Object.values(Op).filter((s) => s !== Op.DRAFT && s !== Op.EXPIRED);

export type PartnerOrderQueueFilter =
  | 'new'
  | 'seen'
  | 'stock_confirmed'
  | 'out_of_stock'
  | 'handed_over'
  | 'completed'
  | 'cancelled'
  | 'refund'
  | 'dispute';

const ORDER_INCLUDE = {
  items: true,
  paymentLegs: { orderBy: { createdAt: 'asc' } },
  adjustments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PartnerOrderInclude;

export type PartnerOrderWithRelations = Prisma.PartnerOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

export type AdminQueue =
  | 'all'
  | 'new'
  | 'not_seen'
  | 'stock_not_confirmed'
  | 'sourcing_required'
  | 'searching'
  | 'customer_action'
  | 'payment_issue'
  | 'refund_required'
  | 'disputes'
  | 'critical'
  | 'manual_review'
  | 'completed';

export interface Actor {
  type: PartnerOrderActorType;
  userId: string | null;
}

/**
 * Partner Commerce — online partner orders (docs/PARTNER_COMMERCE.md).
 *
 * Four independent state dimensions (spec §57, see the schema's enums):
 * `operationalStatus` (the goods), `paymentStatus` (the money),
 * `sourcingStatus`, `disputeStatus`. Every transition is a conditional
 * `updateMany` claim on the *from* state, and every financial effect it
 * authorises runs inside the same transaction — so a race between two
 * transitions ("received × cancel", "in stock × out of stock", a double
 * submit) has exactly one winner and the loser changes nothing.
 *
 * Money (Q1–Q3): the customer's discount and TuTak-money legs are captured
 * into PARTNER_ORDER_ESCROW at "Подтвердить заказ"; they become partner
 * receivable, and the existing 20/30/30/20 distribution runs, only at
 * completion — after the customer's "Получил заказ" and once every external
 * leg is confirmed (interim rule pending Q10). Nothing is ever released on a
 * timer.
 */
@Injectable()
export class PartnerOrdersService {
  private readonly logger = new Logger(PartnerOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly partnersService: PartnersService,
    private readonly rules: CommerceRulesService,
    private readonly payments: PartnerOrderPaymentsService,
    private readonly distribution: CommissionDistributionService,
    private readonly transactions: TransactionsService,
    private readonly customerBalance: CustomerBalanceService,
    private readonly shifts: EmployeeShiftService,
    private readonly escalations: OrderEscalationService,
    private readonly notifier: PartnerOrderNotifier,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async findByIdOrThrow(id: string): Promise<PartnerOrderWithRelations> {
    const order = await this.prisma.partnerOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // ── Creation (partner website, server-to-server) — spec §3, §15 ─────────

  /**
   * `partnerId`/`integrationId` come from the verified `PartnerApiKey`,
   * never from the request body. Idempotent on (integration,
   * externalOrderId). Creates a DRAFT: nothing is reserved, no SLA runs,
   * and it expires if nobody confirms it (an abandoned cart, spec §15).
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
    const existing = await this.prisma.partnerOrder.findUnique({
      where: { integrationId_externalOrderId: { integrationId, externalOrderId: dto.externalOrderId } },
      include: ORDER_INCLUDE,
    });
    if (existing) return existing;

    const partner = await this.partnersService.findActiveOrThrow(partnerId);
    if (dto.currency && dto.currency !== Currency.AMD) {
      throw new BadRequestException('Only AMD orders are accepted');
    }
    if (dto.branchId) {
      const branch = await this.prisma.partnerBranch.findUnique({ where: { id: dto.branchId } });
      if (!branch || branch.partnerId !== partnerId || !branch.isActive) {
        throw new BadRequestException('This branch does not belong to the partner or is closed');
      }
    }

    const items = dto.items.map((item) => {
      const unitPrice = parsePositiveMoney(item.unitPrice, 'items[].unitPrice');
      return { ...item, unitPrice, totalPrice: roundCharge(unitPrice.times(item.quantity)) };
    });
    const subtotal = sumDecimals(items.map((i) => i.totalPrice));
    const totalAmount = subtotal;
    const scope = { serviceType: dto.serviceType, category: dto.category };
    const { rule, rateBps } = await this.rules.resolveCommission(partner, scope);
    const prepayment = await this.rules.resolvePrepayment(partnerId, scope, totalAmount);
    const draftTtlHours = this.config.get('partnerOrderPolicy.draftTtlHours', { infer: true });

    try {
      const order = await this.prisma.partnerOrder.create({
        data: {
          partnerId,
          integrationId,
          externalOrderId: dto.externalOrderId,
          branchId: dto.branchId,
          serviceType: dto.serviceType?.trim() || null,
          category: dto.category?.trim() || null,
          currency: Currency.AMD,
          subtotal,
          totalAmount,
          commissionRuleId: rule?.id,
          commissionRateBps: rateBps,
          commissionAmount: this.distribution.poolFor(totalAmount, rateBps),
          prepaymentRuleId: prepayment.rule?.id,
          prepaymentRequiredAmount: prepayment.amount,
          sourcingAllowed: partner.allowExternalSourcing,
          draftExpiresAt: new Date(Date.now() + draftTtlHours * 3_600_000),
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
        include: ORDER_INCLUDE,
      });
      await this.auditService.record({
        action: AuditAction.PARTNER_ORDER_CREATED,
        entityType: 'PartnerOrder',
        entityId: order.id,
        metadata: {
          partnerId,
          integrationId,
          externalOrderId: dto.externalOrderId,
          totalAmount: totalAmount.toString(),
          commissionRateBps: rateBps,
          commissionRuleId: rule?.id ?? null,
        },
      });
      return order;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.partnerOrder.findUniqueOrThrow({
          where: { integrationId_externalOrderId: { integrationId, externalOrderId: dto.externalOrderId } },
          include: ORDER_INCLUDE,
        });
      }
      throw err;
    }
  }

  // ── Customer: checkout, "Подтвердить заказ" — spec §4, §20-23, §30 ─────

  /**
   * Anyone authenticated may open an unclaimed DRAFT (the checkout link);
   * once claimed, only its customer can. Returns what the customer needs to
   * decide (spec §69): both balances, kept apart (Q1), the partner's
   * discount cap, and the prepayment requirement shown *before* confirming.
   */
  async getCheckout(orderId: string, customerId: string) {
    let order = await this.findByIdOrThrow(orderId);
    this.assertCustomerMayView(order, customerId);
    if (order.operationalStatus === Op.DRAFT && order.draftExpiresAt <= new Date()) {
      await this.expireDraft(order.id);
      order = await this.findByIdOrThrow(orderId);
    }
    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: order.partnerId },
      select: { displayName: true, maxBonusPaymentPercent: true },
    });
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: customerId } });
    const money = await this.customerBalance.getBalance(customerId);
    const maxDiscount = roundCharge(order.totalAmount.times(partner.maxBonusPaymentPercent).dividedBy(100));
    return {
      order,
      partner: { id: order.partnerId, displayName: partner.displayName },
      balances: {
        discountAvailable: (wallet?.availableBonus ?? ZERO).toFixed(4),
        tutakMoney: money.balance,
      },
      limits: {
        maxDiscountAmount: maxDiscount.toFixed(4),
        prepaymentRequiredAmount: order.prepaymentRequiredAmount.toFixed(4),
      },
    };
  }

  /**
   * "Подтвердить заказ" — the customer's explicit consent (spec §4), the
   * moment the order becomes the partner's to act on (`submittedAt`, the
   * SLA clock, spec §15). Electronic legs are captured into escrow in the
   * same transaction that claims the DRAFT, so a duplicated confirmation
   * (§61) either finds the order already submitted or loses the claim — it
   * can never capture twice.
   */
  async submit(orderId: string, customerId: string, dto: SubmitPartnerOrderDto) {
    const order = await this.findByIdOrThrow(orderId);
    this.assertCustomerMayView(order, customerId);

    // A retry of the same confirmation — or any repeat once this customer
    // already confirmed it — is a lookup, never a second capture.
    if (order.customerId === customerId && order.submittedAt) return order;
    if (order.operationalStatus !== Op.DRAFT) {
      throw new ConflictException('This order can no longer be confirmed');
    }
    if (order.draftExpiresAt <= new Date()) {
      await this.expireDraft(order.id);
      throw new BadRequestException('This order has expired — please start again from the store');
    }
    // Same self-dealing guard as a QR purchase: nobody on the partner's side
    // buys from their own partner and collects the distribution.
    if (await this.partnersService.isAffiliated(order.partnerId, customerId)) {
      throw new BadRequestException('You cannot buy from a partner you belong to');
    }

    const split = await this.validateSplit(order.partnerId, order.totalAmount, dto.discountAmount, dto.tutakMoneyAmount);
    if (split.discount.plus(split.tutakMoney).lessThan(order.prepaymentRequiredAmount)) {
      throw new BadRequestException({
        message: `This order needs at least ${order.prepaymentRequiredAmount.toFixed(0)} AMD paid through TuTak in advance`,
        error: 'PREPAYMENT_REQUIRED',
      });
    }

    const partner = await this.prisma.partner.findUniqueOrThrow({ where: { id: order.partnerId }, select: { displayName: true } });
    const transaction = await this.transactions.create({
      userId: customerId,
      partnerId: order.partnerId,
      partnerBranchId: order.branchId ?? undefined,
      type: TransactionType.PARTNER_PURCHASE,
      amount: order.totalAmount,
      bonusAppliedAmount: split.discount,
      description: `Order #${order.orderNumber} at ${partner.displayName}`,
      metadata: { channel: 'PARTNER_ORDER', partnerOrderId: order.id },
    });

    let reservationId: string | null = null;
    try {
      reservationId = await this.payments.reserveDiscount(customerId, split.discount, transaction.id);
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const claimed = await tx.partnerOrder.updateMany({
          where: {
            id: order.id,
            operationalStatus: Op.DRAFT,
            submittedAt: null,
            draftExpiresAt: { gt: now },
            OR: [{ customerId: null }, { customerId }],
          },
          data: {
            customerId,
            operationalStatus: Op.SUBMITTED,
            paymentStatus: split.external.greaterThan(0) ? Pay.RESERVED : Pay.FUNDED,
            submittedAt: now,
            discountAmount: split.discount,
            tutakMoneyAmount: split.tutakMoney,
            externalAmount: split.external,
            submitIdempotencyKey: dto.idempotencyKey,
            sourceTransactionId: transaction.id,
          },
        });
        if (claimed.count === 0) throw new ConflictException('This order was just confirmed or changed — please reload');

        await this.payments.captureLegs(tx, order, customerId, split, {
          purpose: PaymentLegPurpose.ORDER,
          discountReservationId: reservationId,
          source: { sourceType: 'PartnerOrder', sourceId: order.id },
        });

        await this.auditService.record(
          {
            actorUserId: customerId,
            action: AuditAction.PARTNER_ORDER_SUBMITTED,
            entityType: 'PartnerOrder',
            entityId: order.id,
            metadata: {
              totalAmount: order.totalAmount.toString(),
              discountAmount: split.discount.toString(),
              tutakMoneyAmount: split.tutakMoney.toString(),
              externalAmount: split.external.toString(),
              prepaymentRequiredAmount: order.prepaymentRequiredAmount.toString(),
            },
          },
          tx,
        );
      });
    } catch (err) {
      await this.payments.compensateDiscount(reservationId, 'partner_order_submit_failed');
      await this.transactions
        .markFailed(transaction.id, err instanceof Error ? err.message : 'submit_failed')
        .catch(() => undefined);
      // The unique (customer, idempotencyKey) — a concurrent duplicate of this
      // exact confirmation already won: return its result.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const current = await this.findByIdOrThrow(orderId);
        if (current.customerId === customerId && current.submittedAt) return current;
      }
      if (err instanceof ConflictException) {
        const current = await this.findByIdOrThrow(orderId);
        if (current.customerId === customerId && current.submittedAt) return current;
      }
      throw err;
    }
    const submitted = await this.findByIdOrThrow(orderId);
    await this.notifier.orderSubmitted(submitted);
    return submitted;
  }

  /**
   * Parses and checks a customer's chosen split for `amount`: the partner's
   * discount cap applies to the discount only (as for a QR purchase); the
   * external part is whatever remains. Balances themselves are enforced by
   * the capture (bonus reservation / money claim), not trusted from here.
   */
  async validateSplit(partnerId: string, amount: Decimal, discountRaw?: string, moneyRaw?: string): Promise<PaymentSplit> {
    const discount = discountRaw ? parseMoney(discountRaw, 'discountAmount') : ZERO;
    const tutakMoney = moneyRaw ? parseMoney(moneyRaw, 'tutakMoneyAmount') : ZERO;
    if (discount.plus(tutakMoney).greaterThan(amount)) {
      throw new BadRequestException('Discount plus TuTak money cannot exceed the order total');
    }
    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: partnerId },
      select: { maxBonusPaymentPercent: true },
    });
    const maxDiscount = roundCharge(amount.times(partner.maxBonusPaymentPercent).dividedBy(100));
    if (discount.greaterThan(maxDiscount)) {
      throw new BadRequestException(
        `This partner allows at most ${partner.maxBonusPaymentPercent}% of the order to be paid with the discount balance`,
      );
    }
    return { discount, tutakMoney, external: amount.minus(discount).minus(tutakMoney) };
  }

  private assertCustomerMayView(order: { customerId: string | null }, customerId: string) {
    if (order.customerId && order.customerId !== customerId) {
      // Spec §63 "reused checkout URLs": once claimed, nobody else sees it.
      throw new NotFoundException('Order not found');
    }
  }

  // ── Partner: seen / stock / handover — spec §16, §31 ────────────────────

  /** Acknowledgement only — not a stock claim. Idempotent. */
  async markSeen(orderId: string, staffUserId: string) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.partnerOrder.updateMany({
        where: { id: orderId, operationalStatus: Op.SUBMITTED },
        data: { operationalStatus: Op.SEEN, partnerSeenAt: now, partnerSeenByUserId: staffUserId },
      });
      if (claimed.count === 0) return;
      await this.escalations.resolveTypes(orderId, [OrderEscalationType.NOT_SEEN_5MIN], staffUserId, tx);
      await this.audit(tx, staffUserId, AuditAction.PARTNER_ORDER_SEEN, orderId, {});
    });
    return this.findByIdOrThrow(orderId);
  }

  /**
   * "В наличии". No money moves (v1 error E2 fixed): the electronic legs stay
   * in escrow until the customer confirms receipt. Also accepted from
   * OUT_OF_STOCK while TuTak has not yet proposed anything to the customer
   * (the partner found it after all) — which is the "sourcing × stock
   * confirmed" race of §61: exactly one of this and the sourcing result wins
   * the order row.
   */
  async confirmStock(orderId: string, staffUserId: string) {
    const now = new Date();
    let changed = false;
    await this.prisma.$transaction(async (tx) => {
      const direct = await tx.partnerOrder.updateMany({
        where: { id: orderId, operationalStatus: { in: [Op.SUBMITTED, Op.SEEN] } },
        data: {
          operationalStatus: Op.STOCK_CONFIRMED,
          stockConfirmedAt: now,
          stockConfirmedByUserId: staffUserId,
        },
      });
      let viaSourcing = false;
      if (direct.count === 0) {
        const late = await tx.partnerOrder.updateMany({
          where: {
            id: orderId,
            operationalStatus: Op.OUT_OF_STOCK,
            sourcingStatus: { in: [Sourcing.REQUIRED, Sourcing.SEARCHING] },
          },
          data: {
            operationalStatus: Op.STOCK_CONFIRMED,
            sourcingStatus: Sourcing.RESOLVED,
            stockConfirmedAt: now,
            stockConfirmedByUserId: staffUserId,
          },
        });
        if (late.count === 0) {
          const current = await tx.partnerOrder.findUnique({ where: { id: orderId } });
          if (current?.operationalStatus === Op.STOCK_CONFIRMED) return; // idempotent
          throw new ConflictException('This order can no longer be confirmed as in stock');
        }
        viaSourcing = true;
        await tx.sourcingTask.updateMany({
          where: { orderId, status: { in: [SourcingTaskStatus.OPEN, SourcingTaskStatus.SEARCHING] } },
          data: { status: SourcingTaskStatus.RESOLVED, resolvedAt: now, resultNotes: 'Partner confirmed stock' },
        });
      }
      await tx.partnerOrder.updateMany({ where: { id: orderId, partnerSeenAt: null }, data: { partnerSeenAt: now, partnerSeenByUserId: staffUserId } });
      await this.escalations.resolveTypes(orderId, Object.values(OrderEscalationType).filter((t) => t !== OrderEscalationType.PAYMENT_ISSUE && t !== OrderEscalationType.RECEIPT_NOT_CONFIRMED_48H), staffUserId, tx);
      await this.audit(tx, staffUserId, AuditAction.PARTNER_ORDER_STOCK_CONFIRMED, orderId, { viaSourcing });
      changed = true;
    });
    const order = await this.findByIdOrThrow(orderId);
    if (changed) await this.notifier.stockConfirmed(order);
    return order;
  }

  /**
   * "Нет в наличии" — spec §35, §38. Not always a refund: if the order's
   * snapshot allows sourcing, a TuTak employee gets a task; otherwise the
   * order is cancelled with every leg back to its source.
   */
  async rejectStock(orderId: string, staffUserId: string, dto: RejectStockDto) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.partnerOrder.findUniqueOrThrow({ where: { id: orderId } });
      const claimed = await tx.partnerOrder.updateMany({
        where: { id: orderId, operationalStatus: { in: [Op.SUBMITTED, Op.SEEN] } },
        data: {
          operationalStatus: Op.OUT_OF_STOCK,
          stockRejectedAt: now,
          stockRejectedByUserId: staffUserId,
          rejectionReason: dto.reason,
          sourcingStatus: order.sourcingAllowed ? Sourcing.REQUIRED : Sourcing.NONE,
        },
      });
      if (claimed.count === 0) {
        if (order.operationalStatus === Op.OUT_OF_STOCK) return; // idempotent
        throw new ConflictException('This order can no longer be marked out of stock');
      }
      await tx.partnerOrder.updateMany({ where: { id: orderId, partnerSeenAt: null }, data: { partnerSeenAt: now, partnerSeenByUserId: staffUserId } });
      await this.escalations.resolveTypes(orderId, [OrderEscalationType.NOT_SEEN_5MIN, OrderEscalationType.STOCK_NOT_CONFIRMED_30MIN, OrderEscalationType.STOCK_NOT_CONFIRMED_REPEAT], staffUserId, tx);
      await this.audit(tx, staffUserId, AuditAction.PARTNER_ORDER_STOCK_REJECTED, orderId, { reason: dto.reason ?? null, sourcingAllowed: order.sourcingAllowed });

      if (order.sourcingAllowed) {
        await tx.sourcingTask.create({ data: { orderId } });
      } else {
        await tx.partnerOrderAdjustment.create({
          data: {
            orderId,
            type: 'OUT_OF_STOCK_REFUND',
            status: PartnerOrderAdjustmentStatus.APPLIED,
            previousTotalAmount: order.totalAmount,
            newTotalAmount: order.totalAmount,
            deltaAmount: ZERO,
            reason: dto.reason,
            appliedAt: now,
          },
        });
        await this.cancelInTx(tx, orderId, { type: PartnerOrderActorType.SYSTEM, userId: null }, 'out_of_stock_no_sourcing', [Op.OUT_OF_STOCK]);
      }
    });
    const order = await this.findByIdOrThrow(orderId);
    if (order.operationalStatus === Op.CANCELLED) await this.notifier.cancelled(order);
    return order;
  }

  /** "Передан клиенту / курьеру" — starts the 24h/48h receipt clock (spec §34). No shift needed. */
  async markHandedOver(orderId: string, staffUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.partnerOrder.updateMany({
        where: { id: orderId, operationalStatus: Op.STOCK_CONFIRMED },
        data: { operationalStatus: Op.HANDED_OVER, handedOverAt: new Date(), handedOverByUserId: staffUserId },
      });
      if (claimed.count === 0) {
        const current = await tx.partnerOrder.findUnique({ where: { id: orderId } });
        if (current && ([Op.HANDED_OVER, Op.RECEIVED, Op.COMPLETED] as Op[]).includes(current.operationalStatus)) return;
        throw new ConflictException('Only an order confirmed in stock can be handed over');
      }
      await this.audit(tx, staffUserId, AuditAction.PARTNER_ORDER_HANDED_OVER, orderId, {});
    });
    return this.findByIdOrThrow(orderId);
  }

  // ── Partner: external payment — spec §24-28 ─────────────────────────────

  /**
   * "Подтвердить внешнюю оплату". Financially binding (spec §26): an
   * employee on an active shift, recorded with shift, branch and time. A
   * repeated or concurrent confirmation is a no-op (the conditional claim on
   * PENDING). Confirming the last external leg may complete the order.
   */
  async confirmExternalPayment(legId: string, staffUserId: string) {
    const leg = await this.prisma.partnerOrderPaymentLeg.findUnique({ where: { id: legId } });
    if (!leg || leg.type !== PaymentLegType.EXTERNAL) throw new NotFoundException('External payment not found');
    const split = await this.planIfCompletable(leg.orderId);
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.partnerOrder.findUniqueOrThrow({ where: { id: leg.orderId } });
      if (!([Op.SUBMITTED, Op.SEEN, Op.STOCK_CONFIRMED, Op.HANDED_OVER, Op.RECEIVED] as Op[]).includes(order.operationalStatus)) {
        if (leg.status === PaymentLegStatus.CONFIRMED) return;
        throw new ConflictException('This order is not awaiting payment');
      }
      const stamp = await this.shifts.stampFor(tx, { userId: staffUserId, partnerId: order.partnerId, branchId: order.branchId });
      const claimed = await tx.partnerOrderPaymentLeg.updateMany({
        where: { id: legId, status: PaymentLegStatus.PENDING },
        data: {
          status: PaymentLegStatus.CONFIRMED,
          confirmedByUserId: staffUserId,
          confirmedShiftId: stamp.shiftId,
          confirmedBranchId: stamp.branchId,
          confirmedAt: new Date(),
        },
      });
      if (claimed.count === 0) return; // already confirmed — idempotent
      await this.audit(tx, staffUserId, AuditAction.PARTNER_ORDER_EXTERNAL_PAYMENT_CONFIRMED, order.id, {
        legId,
        amount: leg.amount.minus(leg.refundedAmount).toString(),
        shiftId: stamp.shiftId,
        branchId: stamp.branchId,
        withoutShift: stamp.withoutShift,
      });
      await this.refreshFunding(tx, order.id);
      await this.tryComplete(tx, order.id, split);
    });
    return this.findByIdOrThrow(leg.orderId);
  }

  /**
   * Spec §27: a mistaken confirmation may be undone only before the goods
   * are handed over, only by OWNER/MANAGER (checked by the controller), on
   * shift, with a reason, audited. The confirmed leg is kept as CORRECTED
   * and a fresh PENDING leg for the same amount replaces it — history is
   * never rewritten. After handover this is refused: PAYMENT_DISPUTE.
   */
  async correctExternalPayment(legId: string, staffUserId: string, reason: string) {
    const leg = await this.prisma.partnerOrderPaymentLeg.findUnique({ where: { id: legId } });
    if (!leg || leg.type !== PaymentLegType.EXTERNAL) throw new NotFoundException('External payment not found');
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.partnerOrder.findUniqueOrThrow({ where: { id: leg.orderId } });
      if (!([Op.SUBMITTED, Op.SEEN, Op.STOCK_CONFIRMED] as Op[]).includes(order.operationalStatus)) {
        throw new BadRequestException({
          message: 'The goods were already handed over — open a payment dispute instead',
          error: 'USE_PAYMENT_DISPUTE',
        });
      }
      const stamp = await this.shifts.stampFor(tx, { userId: staffUserId, partnerId: order.partnerId, branchId: order.branchId });
      const now = new Date();
      const claimed = await tx.partnerOrderPaymentLeg.updateMany({
        where: { id: legId, status: PaymentLegStatus.CONFIRMED },
        data: {
          status: PaymentLegStatus.CORRECTED,
          correctedByUserId: staffUserId,
          correctedShiftId: stamp.shiftId,
          correctedAt: now,
          correctionReason: reason,
        },
      });
      if (claimed.count === 0) throw new ConflictException('Only a confirmed payment can be corrected');
      await tx.partnerOrderPaymentLeg.create({
        data: {
          orderId: order.id,
          type: PaymentLegType.EXTERNAL,
          purpose: leg.purpose,
          adjustmentId: leg.adjustmentId,
          status: PaymentLegStatus.PENDING,
          amount: leg.amount.minus(leg.refundedAmount),
        },
      });
      await this.audit(tx, staffUserId, AuditAction.PARTNER_ORDER_EXTERNAL_PAYMENT_CORRECTED, order.id, {
        legId,
        reason,
        shiftId: stamp.shiftId,
        withoutShift: stamp.withoutShift,
      });
      await this.refreshFunding(tx, order.id);
    });
    return this.findByIdOrThrow(leg.orderId);
  }

  /** After a cancel: the partner confirms it handed a confirmed external payment back. On shift. */
  async confirmExternalReturn(legId: string, staffUserId: string) {
    const leg = await this.prisma.partnerOrderPaymentLeg.findUnique({ where: { id: legId } });
    if (!leg || leg.type !== PaymentLegType.EXTERNAL) throw new NotFoundException('External payment not found');
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.partnerOrder.findUniqueOrThrow({ where: { id: leg.orderId } });
      const stamp = await this.shifts.stampFor(tx, { userId: staffUserId, partnerId: order.partnerId, branchId: order.branchId });
      const claimed = await tx.partnerOrderPaymentLeg.updateMany({
        where: { id: legId, status: PaymentLegStatus.RETURN_PENDING },
        data: {
          status: PaymentLegStatus.RETURNED,
          returnConfirmedByUserId: staffUserId,
          returnConfirmedShiftId: stamp.shiftId,
          returnConfirmedAt: new Date(),
          returnedAt: new Date(),
        },
      });
      if (claimed.count === 0) return;
      await this.audit(tx, staffUserId, AuditAction.PARTNER_ORDER_EXTERNAL_REFUND_CONFIRMED, order.id, {
        legId,
        amount: leg.amount.minus(leg.refundedAmount).toString(),
        shiftId: stamp.shiftId,
        withoutShift: stamp.withoutShift,
      });
      const stillPending = await tx.partnerOrderPaymentLeg.count({
        where: { orderId: order.id, status: PaymentLegStatus.RETURN_PENDING },
      });
      if (stillPending === 0) {
        await tx.partnerOrder.updateMany({
          where: { id: order.id, paymentStatus: Pay.REFUND_PENDING },
          data: { paymentStatus: Pay.REFUNDED },
        });
      }
    });
    return this.findByIdOrThrow(leg.orderId);
  }

  // ── Customer: "Получил заказ" — spec §32, Q3 ────────────────────────────

  /**
   * The customer confirms they physically received the order (the app asks
   * a second time before calling this). Idempotent. Completes the order in
   * the same transaction when nothing else is outstanding; otherwise the
   * escrow stays put until it is.
   */
  async confirmReceived(orderId: string, customerId: string) {
    const order = await this.findByIdOrThrow(orderId);
    if (order.customerId !== customerId) throw new NotFoundException('Order not found');
    if (([Op.RECEIVED, Op.COMPLETED] as Op[]).includes(order.operationalStatus)) return order;
    const split = await this.planIfCompletable(orderId, true);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.partnerOrder.updateMany({
        where: { id: orderId, customerId, operationalStatus: { in: RECEIPT_ALLOWED_FROM } },
        data: { operationalStatus: Op.RECEIVED, customerReceivedAt: new Date() },
      });
      if (claimed.count === 0) {
        const current = await tx.partnerOrder.findUniqueOrThrow({ where: { id: orderId } });
        if (([Op.RECEIVED, Op.COMPLETED] as Op[]).includes(current.operationalStatus)) return;
        throw new ConflictException('This order cannot be confirmed as received right now');
      }
      await this.audit(tx, customerId, AuditAction.PARTNER_ORDER_RECEIVED, orderId, {});
      await this.escalations.resolveTypes(orderId, [OrderEscalationType.RECEIPT_NOT_CONFIRMED_48H], null, tx);
      await this.tryComplete(tx, orderId, split);
    });
    return this.findByIdOrThrow(orderId);
  }

  /**
   * Resolves the referral chain and the 20/30/30/20 split *before* the
   * transaction that may complete the order — the chain is immutable once
   * attributed, so reading it early is safe (same as `settlePurchase`).
   * Returns null when the order is nowhere near completable, to skip the work.
   */
  private async planIfCompletable(orderId: string, receiptBeingConfirmed = false) {
    const order = await this.prisma.partnerOrder.findUnique({ where: { id: orderId } });
    if (!order || !order.customerId) return null;
    const receivedOrReceiving =
      order.operationalStatus === Op.RECEIVED ||
      (receiptBeingConfirmed && RECEIPT_ALLOWED_FROM.includes(order.operationalStatus));
    if (!receivedOrReceiving) return null;
    return this.distribution.plan(order.customerId, order.totalAmount, order.commissionRateBps);
  }

  /**
   * RECEIVED → COMPLETED, when — and only when — the customer has received
   * the goods, every external leg is confirmed (interim rule pending Q10:
   * nothing is released before everything the commission is computed on is
   * confirmed), nothing is disputed and no customer decision is pending.
   * Then, in this same transaction: escrow → PARTNER_PAYABLE for every
   * captured electronic leg, the existing distribution (green, black,
   * referral chain, TuTak) on the full total, and the customer's
   * transaction completed. The claim makes "two completions" impossible.
   */
  async tryComplete(tx: Tx, orderId: string, split: Awaited<ReturnType<CommissionDistributionService['plan']>> | null) {
    const order = await tx.partnerOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (order.operationalStatus !== Op.RECEIVED || order.disputeStatus === PartnerOrderDisputeStatus.OPEN) return false;
    const pendingExternal = await tx.partnerOrderPaymentLeg.count({
      where: { orderId, type: PaymentLegType.EXTERNAL, status: PaymentLegStatus.PENDING },
    });
    if (pendingExternal > 0) return false;
    const pendingDecision = await tx.partnerOrderAdjustment.count({
      where: { orderId, status: PartnerOrderAdjustmentStatus.PENDING_CUSTOMER },
    });
    if (pendingDecision > 0) return false;

    const plan =
      split && split.pool.equals(this.distribution.poolFor(order.totalAmount, order.commissionRateBps))
        ? split
        : await this.distribution.plan(order.customerId!, order.totalAmount, order.commissionRateBps);

    const claimed = await tx.partnerOrder.updateMany({
      where: { id: orderId, operationalStatus: Op.RECEIVED, disputeStatus: { not: PartnerOrderDisputeStatus.OPEN } },
      data: {
        operationalStatus: Op.COMPLETED,
        paymentStatus: Pay.SETTLED,
        completedAt: new Date(),
        commissionAmount: plan.pool,
        ...this.distribution.snapshotOf(plan),
      },
    });
    if (claimed.count === 0) return false;

    const release = await this.payments.releaseForCompletion(tx, order);
    await tx.partnerOrder.update({
      where: { id: orderId },
      data: { completionLedgerTransactionId: release.ledgerTransactionId },
    });
    await this.transactions.markCompleted(order.sourceTransactionId!, {}, tx);
    await this.distribution.apply(
      plan,
      {
        customerId: order.customerId!,
        partnerId: order.partnerId,
        turnoverAmount: order.totalAmount,
        sourceTransactionId: order.sourceTransactionId!,
        ledgerSource: { sourceType: 'PartnerOrder', sourceId: orderId },
      },
      tx,
    );
    await this.escalations.resolveTypes(orderId, Object.values(OrderEscalationType), null, tx);
    await this.audit(tx, null, AuditAction.PARTNER_ORDER_COMPLETED, orderId, {
      totalAmount: order.totalAmount.toString(),
      electronicReleased: release.released.toString(),
      pool: plan.pool.toString(),
    });
    return true;
  }

  // ── Cancel — spec §43 ────────────────────────────────────────────────────

  /**
   * Customer-initiated cancellation: allowed before the goods are handed
   * over, full release to every source, never a penalty. After handover
   * it is a return, not a cancellation.
   */
  async cancelByCustomer(orderId: string, customerId: string, reason?: string) {
    const order = await this.findByIdOrThrow(orderId);
    if (order.customerId !== customerId && !(order.customerId === null && order.operationalStatus === Op.DRAFT)) {
      throw new NotFoundException('Order not found');
    }
    if (order.operationalStatus === Op.CANCELLED) return order;
    await this.prisma.$transaction((tx) =>
      this.cancelInTx(tx, orderId, { type: PartnerOrderActorType.CUSTOMER, userId: customerId }, reason ?? 'customer_cancelled', [
        Op.DRAFT,
        ...PRE_HANDOVER,
      ]),
    );
    const cancelled = await this.findByIdOrThrow(orderId);
    if (cancelled.submittedAt) await this.notifier.cancelled(cancelled);
    return cancelled;
  }

  /** Admin cancellation (manual review / sourcing outcome). Same rules, same money path. */
  async cancelByAdmin(orderId: string, adminUserId: string, reason: string) {
    await this.prisma.$transaction((tx) =>
      this.cancelInTx(tx, orderId, { type: PartnerOrderActorType.ADMIN, userId: adminUserId }, reason, [Op.DRAFT, ...PRE_HANDOVER]),
    );
    const cancelled = await this.findByIdOrThrow(orderId);
    if (cancelled.submittedAt) await this.notifier.cancelled(cancelled);
    return cancelled;
  }

  /**
   * The one cancellation path. Claims the order out of `from`, then returns
   * every leg to its own source (F4). A confirmed external leg stays
   * RETURN_PENDING until the partner confirms handing the cash back.
   */
  async cancelInTx(tx: Tx, orderId: string, actor: Actor, reason: string, from: Op[]) {
    const order = await tx.partnerOrder.findUniqueOrThrow({ where: { id: orderId } });
    const claimed = await tx.partnerOrder.updateMany({
      where: { id: orderId, operationalStatus: { in: from } },
      data: {
        operationalStatus: Op.CANCELLED,
        cancelledAt: new Date(),
        cancelledByType: actor.type,
        cancelledByUserId: actor.userId,
        cancelledReason: reason,
        ...(order.sourcingStatus === Sourcing.REQUIRED ||
        order.sourcingStatus === Sourcing.SEARCHING ||
        order.sourcingStatus === Sourcing.AWAITING_CUSTOMER
          ? { sourcingStatus: Sourcing.FAILED }
          : {}),
      },
    });
    if (claimed.count === 0) {
      if (order.operationalStatus === Op.CANCELLED) return false;
      throw new ConflictException('This order can no longer be cancelled');
    }

    const wasFunded = order.submittedAt !== null;
    const { externalPending } = wasFunded
      ? await this.payments.returnAllLegs(tx, order, reason)
      : { externalPending: false };
    await tx.partnerOrder.update({
      where: { id: orderId },
      data: { paymentStatus: externalPending ? Pay.REFUND_PENDING : wasFunded ? Pay.REFUNDED : Pay.UNFUNDED },
    });
    await tx.partnerOrderAdjustment.updateMany({
      where: { orderId, status: PartnerOrderAdjustmentStatus.PENDING_CUSTOMER },
      data: { status: PartnerOrderAdjustmentStatus.CUSTOMER_DECLINED, customerRespondedAt: new Date() },
    });
    await tx.sourcingTask.updateMany({
      where: { orderId, status: { in: [SourcingTaskStatus.OPEN, SourcingTaskStatus.SEARCHING] } },
      data: { status: SourcingTaskStatus.RESOLVED, resolvedAt: new Date(), resultNotes: `Order cancelled: ${reason}` },
    });
    if (order.sourceTransactionId) {
      await this.transactions.markFailed(order.sourceTransactionId, `partner_order_cancelled: ${reason}`, tx);
    }
    await this.escalations.resolveTypes(orderId, Object.values(OrderEscalationType), actor.userId, tx);
    await this.audit(tx, actor.userId, AuditAction.PARTNER_ORDER_CANCELLED, orderId, {
      reason,
      actorType: actor.type,
      refunded: wasFunded,
      externalRefundPending: externalPending,
    });
    return true;
  }

  /** An abandoned DRAFT: nothing was ever reserved, so nothing to return. Idempotent. */
  async expireDraft(orderId: string) {
    const expired = await this.prisma.partnerOrder.updateMany({
      where: { id: orderId, operationalStatus: Op.DRAFT, draftExpiresAt: { lte: new Date() } },
      data: { operationalStatus: Op.EXPIRED },
    });
    if (expired.count > 0) {
      await this.auditService.record({
        action: AuditAction.PARTNER_ORDER_EXPIRED,
        entityType: 'PartnerOrder',
        entityId: orderId,
        metadata: {},
      });
    }
    return expired.count > 0;
  }

  async expireStaleDrafts(now = new Date()): Promise<number> {
    const stale = await this.prisma.partnerOrder.findMany({
      where: { operationalStatus: Op.DRAFT, draftExpiresAt: { lte: now } },
      select: { id: true },
      take: 500,
    });
    let count = 0;
    for (const o of stale) if (await this.expireDraft(o.id)) count += 1;
    return count;
  }

  // ── Funding state ────────────────────────────────────────────────────────

  /** RESERVED ⇄ FUNDED as external legs are confirmed or corrected. */
  async refreshFunding(tx: Tx, orderId: string) {
    const pending = await tx.partnerOrderPaymentLeg.count({
      where: { orderId, type: PaymentLegType.EXTERNAL, status: PaymentLegStatus.PENDING },
    });
    await tx.partnerOrder.updateMany({
      where: { id: orderId, paymentStatus: { in: [Pay.RESERVED, Pay.FUNDED, Pay.PARTIALLY_FUNDED] } },
      data: { paymentStatus: pending > 0 ? Pay.RESERVED : Pay.FUNDED },
    });
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  listForCustomer(customerId: string) {
    return this.prisma.partnerOrder.findMany({
      where: { customerId },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Branch-scoped staff see their branches' orders plus branchless ones; `null` = every branch. */
  listForPartner(partnerId: string, filter?: PartnerOrderQueueFilter, branchIds?: string[] | null) {
    const where: Prisma.PartnerOrderWhereInput = { partnerId, operationalStatus: { in: PARTNER_VISIBLE } };
    switch (filter) {
      case 'new':
        where.operationalStatus = Op.SUBMITTED;
        break;
      case 'seen':
        where.operationalStatus = Op.SEEN;
        break;
      case 'stock_confirmed':
        where.operationalStatus = Op.STOCK_CONFIRMED;
        break;
      case 'out_of_stock':
        where.operationalStatus = Op.OUT_OF_STOCK;
        break;
      case 'handed_over':
        where.operationalStatus = { in: [Op.HANDED_OVER, Op.RECEIVED] };
        break;
      case 'completed':
        where.operationalStatus = Op.COMPLETED;
        break;
      case 'cancelled':
        where.operationalStatus = Op.CANCELLED;
        break;
      case 'refund':
        where.paymentStatus = { in: [Pay.REFUND_PENDING, Pay.PARTIALLY_REFUNDED, Pay.REFUNDED] };
        break;
      case 'dispute':
        where.disputeStatus = PartnerOrderDisputeStatus.OPEN;
        break;
    }
    if (branchIds) where.OR = [{ branchId: null }, { branchId: { in: branchIds } }];
    return this.prisma.partnerOrder.findMany({
      where,
      include: { ...ORDER_INCLUDE, returns: true, disputes: true },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Spec §55's admin queues. Elapsed time is `now - submittedAt`, computed
   * by the client from the timestamps returned (spec §76: show where the
   * problem is and how long it has been there).
   */
  listAdminQueue(queue: AdminQueue, now = new Date()) {
    const minutes = (m: number) => new Date(now.getTime() - m * 60_000);
    const policy = this.config.get('partnerOrderPolicy', { infer: true });
    const where: Prisma.PartnerOrderWhereInput = { operationalStatus: { in: PARTNER_VISIBLE } };
    switch (queue) {
      case 'new':
        where.operationalStatus = Op.SUBMITTED;
        break;
      case 'not_seen':
        where.operationalStatus = Op.SUBMITTED;
        where.submittedAt = { lt: minutes(policy.notSeenAlertMinutes) };
        break;
      case 'stock_not_confirmed':
        where.operationalStatus = { in: [Op.SUBMITTED, Op.SEEN] };
        where.submittedAt = { lt: minutes(policy.stockConfirmDeadlineMinutes) };
        break;
      case 'sourcing_required':
        where.sourcingStatus = Sourcing.REQUIRED;
        break;
      case 'searching':
        where.sourcingStatus = Sourcing.SEARCHING;
        break;
      case 'customer_action':
        where.sourcingStatus = Sourcing.AWAITING_CUSTOMER;
        break;
      case 'payment_issue':
        where.OR = [
          { paymentIssueAt: { not: null }, operationalStatus: Op.RECEIVED },
          { manualReviewReason: 'price_decrease_needs_external_refund', operationalStatus: { in: PRE_HANDOVER } },
        ];
        break;
      case 'refund_required':
        where.OR = [
          { paymentStatus: Pay.REFUND_PENDING },
          { returns: { some: { status: { in: ['PENDING_EXTERNAL_REFUND', 'MANUAL_REVIEW'] } } } },
        ];
        break;
      case 'disputes':
        where.disputeStatus = PartnerOrderDisputeStatus.OPEN;
        break;
      case 'critical':
        where.escalations = {
          some: {
            resolvedAt: null,
            type: { in: [OrderEscalationType.STOCK_NOT_CONFIRMED_30MIN, OrderEscalationType.STOCK_NOT_CONFIRMED_REPEAT] },
          },
        };
        break;
      case 'manual_review':
        where.manualReviewAt = { not: null };
        where.operationalStatus = { notIn: [Op.COMPLETED, Op.CANCELLED, Op.EXPIRED, Op.DRAFT] };
        break;
      case 'completed':
        where.operationalStatus = Op.COMPLETED;
        break;
    }
    return this.prisma.partnerOrder.findMany({
      where,
      include: {
        ...ORDER_INCLUDE,
        partner: { select: { id: true, displayName: true, legalName: true } },
        branch: { select: { id: true, name: true, address: true } },
        customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
        escalations: { where: { resolvedAt: null } },
        returns: true,
        disputes: { where: { status: 'OPEN' } },
      },
      orderBy: { submittedAt: 'asc' },
      take: 200,
    });
  }

  /**
   * Manual review outcome (spec §34): after checking with the customer and
   * the partner, an operator may record the receipt on the customer's
   * behalf. A deliberate, audited human decision — never a timer.
   */
  async confirmReceivedByAdmin(orderId: string, adminUserId: string, reason: string) {
    const order = await this.findByIdOrThrow(orderId);
    if (!order.customerId) throw new BadRequestException('This order has no customer');
    const split = await this.planIfCompletable(orderId, true);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.partnerOrder.updateMany({
        where: { id: orderId, operationalStatus: { in: RECEIPT_ALLOWED_FROM } },
        data: { operationalStatus: Op.RECEIVED, customerReceivedAt: new Date() },
      });
      if (claimed.count === 0) throw new ConflictException('This order cannot be marked received right now');
      await this.audit(tx, adminUserId, AuditAction.PARTNER_ORDER_RECEIVED, orderId, { byAdmin: true, reason });
      await this.escalations.resolveTypes(orderId, [OrderEscalationType.RECEIPT_NOT_CONFIRMED_48H], adminUserId, tx);
      await this.tryComplete(tx, orderId, split);
    });
    return this.findByIdOrThrow(orderId);
  }

  private audit(tx: Tx, actorUserId: string | null, action: AuditAction, orderId: string, metadata: Record<string, unknown>) {
    return this.auditService.record(
      { actorUserId: actorUserId ?? undefined, action, entityType: 'PartnerOrder', entityId: orderId, metadata },
      tx,
    );
  }
}
