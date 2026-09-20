import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  PartnerCheckoutStatus,
  PartnerIntegrationStatus,
  PartnerIntegrationType,
  Prisma,
  PurchaseIntentStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE, parseMoney, parsePositiveMoney } from '../../common/utils/money';
import { generateOpaqueToken } from '../../common/utils/crypto';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PartnersService } from '../partners/partners.service';
import { PurchaseIntentsService } from '../purchase-intents/purchase-intents.service';
import { ClaimPartnerCheckoutDto } from './dto/claim-partner-checkout.dto';
import { CreatePartnerCheckoutDto } from './dto/create-partner-checkout.dto';
import { PartnerApiIdentity } from './partner-api-key.guard';

/** The QR payload a till renders. Only the token travels. */
export const checkoutQrPayload = (token: string) => `tutak://checkout/${token}`;

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.toLowerCase().replace(/_/g, '').includes(field.toLowerCase());
}

/**
 * Till-opened purchases (POS) — brief §20–21, 20.09.2026.
 *
 * ## What this is, and is not
 *
 * A *front door* to the one purchase engine, not a second one. A till opens
 * a checkout (partner-originated gross, its own receipt id, an opaque
 * token), renders the token as a dynamic QR, and the customer's scan claims
 * it: the claim calls `PurchaseIntentsService.create` with the till's
 * numbers and the customer's funding choice, and from there the purchase is
 * indistinguishable from one opened by scanning a branch QR — same hold,
 * same reservation, same postings, same refunds. `partner-checkout.int-spec`
 * proves the two paths produce identical ledgers (§40).
 *
 * ## Provider-neutral on purpose
 *
 * No POS vendor has specified a protocol. What is here is the internal
 * domain contract every vendor adapter would have to land on — partner and
 * branch, external reference, gross, optional line item, timestamp,
 * idempotency, status query — behind the partner's own M2M credential.
 * Anything vendor-specific (their webhook shape, their signature, their
 * retry semantics) is a thin adapter on top and is deliberately absent:
 * BLOCKED BY PARTNER-POS until one exists.
 */
@Injectable()
export class PartnerCheckoutService {
  private readonly logger = new Logger(PartnerCheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly partnersService: PartnersService,
    private readonly purchaseIntents: PurchaseIntentsService,
    private readonly audit: AuditService,
  ) {}

  private assertEnabled(): void {
    if (!this.config.get('features.partnerPosPurchasesEnabled', { infer: true })) {
      throw new ForbiddenException('POS purchases are not enabled on this deployment');
    }
  }

  /**
   * The key is the partner's; the integration is the second lock. A partner
   * whose POS integration is not ACTIVE cannot open checkouts even with a
   * valid key — the key authenticates, the integration authorises.
   */
  private async assertPosIntegration(partnerId: string): Promise<void> {
    const active = await this.prisma.partnerIntegration.count({
      where: { partnerId, type: PartnerIntegrationType.POS, status: PartnerIntegrationStatus.ACTIVE },
    });
    if (active === 0) {
      throw new ForbiddenException('This partner has no active POS integration');
    }
  }

  async create(identity: PartnerApiIdentity, dto: CreatePartnerCheckoutDto) {
    this.assertEnabled();
    const partner = await this.partnersService.findActiveOrThrow(identity.partnerId);
    await this.assertPosIntegration(partner.id);

    // Same shape of replay as everywhere else: a client that has a key gets
    // the row it already created back, and a different request under the
    // same key is a conflict, never a second sale.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.partnerCheckout.findUnique({
        where: { partnerId_idempotencyKey: { partnerId: partner.id, idempotencyKey: dto.idempotencyKey } },
      });
      if (existing) {
        if (
          existing.externalReference !== dto.externalReference ||
          !existing.grossAmount.equals(parsePositiveMoney(dto.grossAmount, 'grossAmount'))
        ) {
          throw new ConflictException('This idempotency key was already used for a different checkout');
        }
        return this.toPosView(existing);
      }
    }

    const grossAmount = parsePositiveMoney(dto.grossAmount, 'grossAmount');
    const lineItem = this.parseLineItem(dto, grossAmount);

    // The same branch rule the QR path applies at creation, applied where
    // the till is: a partner with locations names the location.
    if (dto.partnerBranchId) {
      const branch = await this.prisma.partnerBranch.findUnique({ where: { id: dto.partnerBranchId } });
      if (!branch || branch.partnerId !== partner.id) {
        throw new BadRequestException('This branch does not belong to the given partner');
      }
      if (!branch.isActive) throw new BadRequestException('This branch is not currently open');
    } else {
      const openBranches = await this.prisma.partnerBranch.count({
        where: { partnerId: partner.id, isActive: true },
      });
      if (openBranches > 0 || partner.category === 'fuel') {
        throw new BadRequestException('partnerBranchId is required for a partner with branches');
      }
    }

    const ttlSeconds = this.config.get('partnerCheckout.ttlSeconds', { infer: true });
    try {
      const checkout = await this.prisma.partnerCheckout.create({
        data: {
          partnerId: partner.id,
          partnerBranchId: dto.partnerBranchId ?? null,
          apiKeyId: identity.apiKeyId,
          externalReference: dto.externalReference,
          idempotencyKey: dto.idempotencyKey ?? null,
          grossAmount,
          ...lineItem,
          occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
          token: generateOpaqueToken(24),
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        },
      });
      await this.audit.record({
        action: AuditAction.PURCHASE_INTENT_CREATED,
        entityType: 'PartnerCheckout',
        entityId: checkout.id,
        metadata: {
          event: 'pos_checkout_opened',
          partnerId: partner.id,
          apiKeyId: identity.apiKeyId,
          externalReference: dto.externalReference,
          grossAmount: grossAmount.toString(),
        },
      });
      return this.toPosView(checkout);
    } catch (error) {
      if (isUniqueViolation(error, 'externalReference')) {
        throw new ConflictException(
          `A checkout with external reference ${dto.externalReference} already exists for this partner`,
        );
      }
      if (isUniqueViolation(error, 'idempotencyKey')) {
        // Two identical creates raced; the first one's row is the answer.
        const existing = await this.prisma.partnerCheckout.findUnique({
          where: { partnerId_idempotencyKey: { partnerId: partner.id, idempotencyKey: dto.idempotencyKey! } },
        });
        if (existing) return this.toPosView(existing);
      }
      throw error;
    }
  }

  private parseLineItem(
    dto: { quantity?: string; quantityUnit?: string; unitPrice?: string },
    grossAmount: Decimal,
  ) {
    const given = [dto.quantity, dto.quantityUnit, dto.unitPrice].filter((v) => v !== undefined).length;
    if (given === 0) return { quantity: null, quantityUnit: null, unitPrice: null };
    if (given !== 3) {
      throw new BadRequestException('quantity, quantityUnit and unitPrice travel together or not at all');
    }
    const quantity = parsePositiveMoney(dto.quantity!, 'quantity');
    const unitPrice = parseMoney(dto.unitPrice!, 'unitPrice');
    if (!quantity.times(unitPrice).equals(grossAmount)) {
      throw new BadRequestException(
        `${quantity.toString()} × ${unitPrice.toString()} is not ${grossAmount.toString()}`,
      );
    }
    return {
      quantity,
      quantityUnit: dto.quantityUnit as Prisma.PartnerCheckoutUncheckedCreateInput['quantityUnit'],
      unitPrice,
    };
  }

  /** The till's own view — never another partner's, by key. */
  async statusForPartner(identity: PartnerApiIdentity, checkoutId: string) {
    const checkout = await this.prisma.partnerCheckout.findFirst({
      where: { id: checkoutId, partnerId: identity.partnerId },
      include: { purchaseIntent: true },
    });
    if (!checkout) throw new NotFoundException('Checkout not found');
    return this.toPosView(checkout, checkout.purchaseIntent);
  }

  /** A till withdraws a sale nobody has claimed. After a claim, the purchase's own paths apply. */
  async cancel(identity: PartnerApiIdentity, checkoutId: string) {
    const checkout = await this.prisma.partnerCheckout.findFirst({
      where: { id: checkoutId, partnerId: identity.partnerId },
    });
    if (!checkout) throw new NotFoundException('Checkout not found');
    if (checkout.status === PartnerCheckoutStatus.CANCELLED) return this.toPosView(checkout);
    if (checkout.status !== PartnerCheckoutStatus.OPEN) {
      throw new ConflictException(
        `This checkout is ${checkout.status}; a claimed purchase is rejected by staff, not cancelled by the till`,
      );
    }
    await this.prisma.partnerCheckout.updateMany({
      where: { id: checkout.id, status: PartnerCheckoutStatus.OPEN },
      data: { status: PartnerCheckoutStatus.CANCELLED, cancelledAt: new Date() },
    });
    return this.statusForPartner(identity, checkoutId);
  }

  /**
   * The till confirms the sale — the integrated partner's own event
   * finalising the purchase, which the confirm docblock in
   * `PurchaseIntentsService` records as policy. The merchant approval names
   * the API key; the line item is echoed from what the till itself stated.
   */
  async confirm(identity: PartnerApiIdentity, checkoutId: string) {
    this.assertEnabled();
    const checkout = await this.prisma.partnerCheckout.findFirst({
      where: { id: checkoutId, partnerId: identity.partnerId },
    });
    if (!checkout) throw new NotFoundException('Checkout not found');
    if (checkout.status !== PartnerCheckoutStatus.CLAIMED || !checkout.purchaseIntentId) {
      throw new ConflictException('Nobody has claimed this checkout yet — there is nothing to confirm');
    }
    await this.purchaseIntents.confirm(
      checkout.purchaseIntentId,
      { apiKeyId: identity.apiKeyId },
      {
        quantity: checkout.quantity?.toString(),
        quantityUnit: checkout.quantityUnit ?? undefined,
        unitPrice: checkout.unitPrice?.toString(),
      },
    );
    return this.statusForPartner(identity, checkoutId);
  }

  /** What a scan learns: who is selling, and for how much. Never the customer's balances. */
  async resolve(token: string) {
    const checkout = await this.prisma.partnerCheckout.findUnique({
      where: { token },
      include: { partner: { select: { displayName: true } }, branch: { select: { name: true } } },
    });
    if (!checkout) throw new NotFoundException('This code is not valid');
    if (checkout.status === PartnerCheckoutStatus.OPEN && checkout.expiresAt < new Date()) {
      throw new GoneException('This code has expired — ask the till for a new one');
    }
    return {
      checkoutId: checkout.id,
      status: checkout.status,
      partnerId: checkout.partnerId,
      partnerBranchId: checkout.partnerBranchId,
      partnerDisplayName: checkout.partner.displayName,
      branchName: checkout.branch?.name ?? null,
      grossAmount: checkout.grossAmount.toFixed(MONEY_SCALE),
      quantity: checkout.quantity?.toFixed(MONEY_SCALE) ?? null,
      quantityUnit: checkout.quantityUnit,
      unitPrice: checkout.unitPrice?.toFixed(MONEY_SCALE) ?? null,
      expiresAt: checkout.expiresAt,
      purchaseIntentId: checkout.purchaseIntentId,
    };
  }

  /**
   * The customer takes the till's sale as their own purchase.
   *
   * The claim is a conditional flip OPEN → CLAIMED (still unexpired), so two
   * phones scanning the same screen resolve to exactly one owner. Then the
   * ordinary engine opens the purchase with the till's numbers and this
   * customer's funding choice. If that refuses — insufficient balance, a
   * live purchase elsewhere, a closed branch — the claim is handed back so
   * the till's code is still good; a crash between the two leaves a claim
   * with no purchase, which the same customer's retry picks up and any
   * other customer is refused.
   */
  async claim(token: string, customerId: string, dto: ClaimPartnerCheckoutDto) {
    this.assertEnabled();
    const checkout = await this.prisma.partnerCheckout.findUnique({ where: { token } });
    if (!checkout) throw new NotFoundException('This code is not valid');
    if (checkout.status === PartnerCheckoutStatus.CLAIMED && checkout.purchaseIntentId) {
      if (checkout.claimedByUserId === customerId) {
        return this.purchaseIntents.findByIdOrThrow(checkout.purchaseIntentId); // idempotent
      }
      throw new ConflictException('This checkout was already claimed by another customer');
    }
    if (checkout.status !== PartnerCheckoutStatus.OPEN && checkout.status !== PartnerCheckoutStatus.CLAIMED) {
      throw new ConflictException(`This checkout is ${checkout.status}`);
    }

    const now = new Date();
    const claimed = await this.prisma.partnerCheckout.updateMany({
      where: {
        id: checkout.id,
        expiresAt: { gt: now },
        OR: [
          { status: PartnerCheckoutStatus.OPEN },
          // A claim of ours that never got its purchase — see the docblock.
          { status: PartnerCheckoutStatus.CLAIMED, purchaseIntentId: null, claimedByUserId: customerId },
        ],
      },
      data: { status: PartnerCheckoutStatus.CLAIMED, claimedByUserId: customerId, claimedAt: now },
    });
    if (claimed.count === 0) {
      if (checkout.expiresAt <= now) throw new GoneException('This code has expired — ask the till for a new one');
      throw new ConflictException('This checkout was already claimed by another customer');
    }

    try {
      const intent = await this.purchaseIntents.create(
        {
          partnerId: checkout.partnerId,
          partnerBranchId: checkout.partnerBranchId ?? undefined,
          grossAmount: checkout.grossAmount.toString(),
          quantity: checkout.quantity?.toString(),
          quantityUnit: checkout.quantityUnit ?? undefined,
          unitPrice: checkout.unitPrice?.toString(),
          bonusAmountRequested: dto.bonusAmountRequested,
          prepaidAmountApplied: dto.prepaidAmountApplied,
          paymentRoute: dto.paymentRoute,
        },
        customerId,
      );
      await this.prisma.partnerCheckout.update({
        where: { id: checkout.id },
        data: { purchaseIntentId: intent.id },
      });
      return intent;
    } catch (error) {
      // Hand the code back: the till's sale is still real, this customer
      // just could not fund it this way.
      await this.prisma.partnerCheckout
        .updateMany({
          where: { id: checkout.id, status: PartnerCheckoutStatus.CLAIMED, purchaseIntentId: null },
          data: { status: PartnerCheckoutStatus.OPEN, claimedByUserId: null, claimedAt: null },
        })
        .catch((e) => this.logger.error(`Could not release checkout ${checkout.id} after a failed claim: ${e}`));
      throw error;
    }
  }

  /** Sweep: a code nobody scanned in time stops being scannable. */
  async expireStale(): Promise<number> {
    const result = await this.prisma.partnerCheckout.updateMany({
      where: { status: PartnerCheckoutStatus.OPEN, expiresAt: { lt: new Date() } },
      data: { status: PartnerCheckoutStatus.EXPIRED },
    });
    return result.count;
  }

  /**
   * What the till shows. Once claimed, the amounts are the purchase's —
   * `externalAmountDue` is what the cashier collects, and it is the
   * server's figure, not the till's arithmetic (§19, §28).
   */
  private toPosView(
    checkout: {
      id: string;
      status: PartnerCheckoutStatus;
      externalReference: string;
      grossAmount: Decimal;
      token: string;
      expiresAt: Date;
      purchaseIntentId: string | null;
      claimedAt: Date | null;
      createdAt: Date;
    },
    intent?: {
      status: PurchaseIntentStatus;
      bonusAmountRequested: Decimal;
      prepaidAmountApplied: Decimal;
      ordinaryPaymentRemainder: Decimal;
      confirmedAt: Date | null;
    } | null,
  ) {
    return {
      checkoutId: checkout.id,
      status: checkout.status,
      externalReference: checkout.externalReference,
      grossAmount: checkout.grossAmount.toFixed(MONEY_SCALE),
      token: checkout.token,
      qrPayload: checkoutQrPayload(checkout.token),
      expiresAt: checkout.expiresAt,
      claimedAt: checkout.claimedAt,
      purchaseIntentId: checkout.purchaseIntentId,
      purchase: intent
        ? {
            status: intent.status,
            bonusApplied: intent.bonusAmountRequested.toFixed(MONEY_SCALE),
            prepaidAmountApplied: intent.prepaidAmountApplied.toFixed(MONEY_SCALE),
            externalAmountDue: intent.ordinaryPaymentRemainder.toFixed(MONEY_SCALE),
            confirmedAt: intent.confirmedAt,
          }
        : null,
    };
  }
}
