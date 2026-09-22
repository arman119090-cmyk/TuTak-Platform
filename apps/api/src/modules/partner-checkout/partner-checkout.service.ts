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
  PaymentRoute,
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

/** What a key may do, resolved per request from its integration. */
interface PosScope {
  integrationId: string;
  /** The integration's branch, when it has one: the only branch the key sells at. */
  partnerBranchId: string | null;
}

/** Every semantic input of a create request — see `assertSameRequest`. */
interface CheckoutFingerprint {
  externalReference: string;
  grossAmount: Decimal;
  partnerBranchId: string | null;
  quantity: Decimal | null;
  quantityUnit: string | null;
  unitPrice: Decimal | null;
  occurredAt: Date | null;
}

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
   * The key authenticates; the integration authorises — and the two are
   * bound to each other (audit 21.09.2026, D17).
   *
   * Resolved on every request, never cached in the token: a key revoked, an
   * integration suspended or a key re-pointed elsewhere loses access on the
   * very next call. Three refusals, all deliberate:
   *
   *  - a key issued partner-wide (no integration) is not a POS credential;
   *  - a key whose integration is not `POS` is somebody else's credential
   *    (a roaming-CPO key must not open till sales);
   *  - an integration that is not `ACTIVE` opens nothing, whatever its key.
   *
   * The scope it returns is the integration's own branch, when it has one:
   * a till installed at one location opens sales at that location only.
   */
  private async posScope(identity: PartnerApiIdentity): Promise<PosScope> {
    const key = await this.prisma.partnerApiKey.findUnique({
      where: { id: identity.apiKeyId },
      select: {
        partnerId: true,
        revokedAt: true,
        integration: { select: { id: true, type: true, status: true, partnerBranchId: true } },
      },
    });
    if (!key || key.revokedAt || key.partnerId !== identity.partnerId) {
      throw new ForbiddenException('This API key is not valid for this partner');
    }
    if (!key.integration) {
      throw new ForbiddenException('This API key is not issued for a POS integration');
    }
    if (key.integration.type !== PartnerIntegrationType.POS) {
      throw new ForbiddenException('This API key belongs to a different kind of integration');
    }
    if (key.integration.status !== PartnerIntegrationStatus.ACTIVE) {
      throw new ForbiddenException('This partner has no active POS integration');
    }
    return { integrationId: key.integration.id, partnerBranchId: key.integration.partnerBranchId };
  }

  /**
   * A checkout the key may act on: the key's own partner *and* the key's own
   * integration. Another integration's checkout at the same partner is not
   * found, for the same reason another partner's is not.
   */
  private async checkoutForKey(identity: PartnerApiIdentity, scope: PosScope, checkoutId: string) {
    const checkout = await this.prisma.partnerCheckout.findFirst({
      where: {
        id: checkoutId,
        partnerId: identity.partnerId,
        apiKey: { integrationId: scope.integrationId },
      },
      include: { purchaseIntent: true },
    });
    if (!checkout) throw new NotFoundException('Checkout not found');
    return checkout;
  }

  async create(identity: PartnerApiIdentity, dto: CreatePartnerCheckoutDto) {
    this.assertEnabled();
    const partner = await this.partnersService.findActiveOrThrow(identity.partnerId);
    const scope = await this.posScope(identity);

    // A till installed at one branch sells at that branch. Naming another
    // is refused; naming none means the till's own.
    if (scope.partnerBranchId && dto.partnerBranchId && dto.partnerBranchId !== scope.partnerBranchId) {
      throw new ForbiddenException('This API key is scoped to a different branch');
    }
    const partnerBranchId = dto.partnerBranchId ?? scope.partnerBranchId ?? null;
    const grossAmount = parsePositiveMoney(dto.grossAmount, 'grossAmount');
    const lineItem = this.parseLineItem(dto, grossAmount);
    const request: CheckoutFingerprint = {
      externalReference: dto.externalReference,
      grossAmount,
      partnerBranchId,
      quantity: lineItem.quantity,
      quantityUnit: lineItem.quantityUnit ?? null,
      unitPrice: lineItem.unitPrice,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : null,
    };

    // Same shape of replay as everywhere else: a client that has a key gets
    // the row it already created back, and a different request under the
    // same key is a conflict, never a second sale. "Different" is every
    // semantic input — branch, line item, timestamp — not only the receipt
    // and the gross (audit 21.09.2026, D11).
    if (dto.idempotencyKey) {
      const existing = await this.prisma.partnerCheckout.findUnique({
        where: { partnerId_idempotencyKey: { partnerId: partner.id, idempotencyKey: dto.idempotencyKey } },
      });
      if (existing) {
        this.assertSameRequest(existing, request);
        return this.toPosView(existing);
      }
    }

    // The same branch rule the QR path applies at creation, applied where
    // the till is: a partner with locations names the location.
    if (partnerBranchId) {
      const branch = await this.prisma.partnerBranch.findUnique({ where: { id: partnerBranchId } });
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
          partnerBranchId,
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
        // Two creates raced under one key; the first one's row is the
        // answer — if it is the same request. The same fingerprint check as
        // above: a race is not a licence to replay a different sale.
        const existing = await this.prisma.partnerCheckout.findUnique({
          where: { partnerId_idempotencyKey: { partnerId: partner.id, idempotencyKey: dto.idempotencyKey! } },
        });
        if (existing) {
          this.assertSameRequest(existing, request);
          return this.toPosView(existing);
        }
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

  /**
   * The semantic fingerprint of a create request, compared field by field
   * against the row an idempotency key already produced. Decimal fields are
   * compared as numbers, not strings; the timestamp only when the request
   * named one (a client that omits it gets "now" and would never replay
   * equal).
   */
  private assertSameRequest(
    existing: {
      externalReference: string;
      grossAmount: Decimal;
      partnerBranchId: string | null;
      quantity: Decimal | null;
      quantityUnit: string | null;
      unitPrice: Decimal | null;
      occurredAt: Date;
    },
    request: CheckoutFingerprint,
  ): void {
    const sameDecimal = (a: Decimal | null, b: Decimal | null) =>
      a === null || b === null ? a === b : a.equals(b);
    const same =
      existing.externalReference === request.externalReference &&
      existing.grossAmount.equals(request.grossAmount) &&
      existing.partnerBranchId === request.partnerBranchId &&
      sameDecimal(existing.quantity, request.quantity) &&
      (existing.quantityUnit ?? null) === request.quantityUnit &&
      sameDecimal(existing.unitPrice, request.unitPrice) &&
      (request.occurredAt === null || existing.occurredAt.getTime() === request.occurredAt.getTime());
    if (!same) {
      throw new ConflictException('This idempotency key was already used for a different checkout');
    }
  }

  /** The till's own view — never another partner's, nor another integration's, by key. */
  async statusForPartner(identity: PartnerApiIdentity, checkoutId: string) {
    const scope = await this.posScope(identity);
    const checkout = await this.checkoutForKey(identity, scope, checkoutId);
    return this.toPosView(checkout, checkout.purchaseIntent);
  }

  /** A till withdraws a sale nobody has claimed. After a claim, the purchase's own paths apply. */
  async cancel(identity: PartnerApiIdentity, checkoutId: string) {
    const scope = await this.posScope(identity);
    const checkout = await this.checkoutForKey(identity, scope, checkoutId);
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
    // Re-checked here, not only at create: a key or integration switched
    // off between the scan and the confirm loses the confirm (D17).
    const scope = await this.posScope(identity);
    const checkout = await this.checkoutForKey(identity, scope, checkoutId);
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
        // A lost answer replays the same purchase — provided the customer
        // is asking for the same thing. A different funding choice on a
        // sale already opened is a conflict, not a silent return of the
        // old choice (audit D11): cancel the purchase and scan again.
        const intent = await this.purchaseIntents.findByIdOrThrow(checkout.purchaseIntentId);
        this.assertSameFunding(intent, dto);
        return intent;
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
      /*
       * The purchase and its binding to this checkout commit together
       * (audit 21.09.2026, D10). The binding runs inside the purchase's own
       * insert transaction, so there is no moment where a purchase exists
       * and the checkout does not yet name it — the moment the old code's
       * catch below would have reopened the checkout to a second customer
       * while the first customer's purchase was already live. A binding
       * that finds the checkout changed underneath it rolls the purchase
       * back with it.
       */
      return await this.purchaseIntents.create(
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
        { bind: (tx, intentId) => this.bindCheckoutToPurchase(tx, checkout.id, customerId, intentId) },
      );
    } catch (error) {
      // Hand the code back: the till's sale is still real, this customer
      // just could not fund it this way. Only a claim with no purchase is
      // released — and since the binding commits with the purchase, "no
      // purchase bound" now means "no purchase committed".
      await this.prisma.partnerCheckout
        .updateMany({
          where: { id: checkout.id, status: PartnerCheckoutStatus.CLAIMED, purchaseIntentId: null },
          data: { status: PartnerCheckoutStatus.OPEN, claimedByUserId: null, claimedAt: null },
        })
        .catch((e) => this.logger.error(`Could not release checkout ${checkout.id} after a failed claim: ${e}`));
      throw error;
    }
  }

  /**
   * Ties the checkout to the purchase being inserted, in that insert's
   * transaction. Conditional on the claim still being ours and unbound: if
   * the till cancelled, the sweep expired it or a concurrent claim won, the
   * update finds nothing and the throw rolls the purchase back.
   */
  private async bindCheckoutToPurchase(
    tx: Prisma.TransactionClient,
    checkoutId: string,
    customerId: string,
    intentId: string,
  ): Promise<void> {
    const bound = await tx.partnerCheckout.updateMany({
      where: {
        id: checkoutId,
        status: PartnerCheckoutStatus.CLAIMED,
        claimedByUserId: customerId,
        purchaseIntentId: null,
      },
      data: { purchaseIntentId: intentId },
    });
    if (bound.count === 0) {
      throw new ConflictException('This checkout changed while the purchase was being opened — scan again');
    }
  }

  /** A replayed claim must ask for what the purchase already is. */
  private assertSameFunding(
    intent: { bonusAmountRequested: Decimal; prepaidAmountApplied: Decimal; paymentRoute: PaymentRoute },
    dto: ClaimPartnerCheckoutDto,
  ): void {
    const wanted = (value: string | undefined) => (value === undefined ? null : parseMoney(value, 'amount'));
    const bonus = wanted(dto.bonusAmountRequested);
    const prepaid = wanted(dto.prepaidAmountApplied);
    const same =
      (bonus === null || bonus.equals(intent.bonusAmountRequested)) &&
      (prepaid === null || prepaid.equals(intent.prepaidAmountApplied)) &&
      (dto.paymentRoute === undefined || dto.paymentRoute === intent.paymentRoute);
    if (!same) {
      throw new ConflictException(
        'This checkout is already your purchase with a different funding choice — cancel that purchase before choosing again',
      );
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
