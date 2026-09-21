import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentRoute } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE, parseMoney, parsePositiveMoney, roundCharge } from '../../common/utils/money';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustomerBalanceService } from '../customer-balance/customer-balance.service';
import { PartnersService } from '../partners/partners.service';

/**
 * Why a quote is refused, as a code the client can translate and a message
 * a log can read. The codes are the contract; the English is not shown to a
 * customer.
 */
export type FundingProblemCode =
  | 'BONUS_EXCEEDS_GROSS'
  | 'BONUS_EXCEEDS_PARTNER_MAX'
  | 'BONUS_EXCEEDS_AVAILABLE'
  | 'PREPAID_DISABLED'
  | 'PREPAID_EXCEEDS_AVAILABLE'
  | 'COMPONENTS_EXCEED_GROSS'
  | 'PROVIDER_DISABLED';

export interface FundingProblem {
  code: FundingProblemCode;
  message: string;
}

/**
 * What the customer's stored money looks like from the checkout's point of
 * view. `UNAVAILABLE` is not zero: it means the deployment does not let a
 * purchase draw on the balance, and the client must say so rather than
 * render an empty field.
 */
export type PrepaidAvailability =
  | { state: 'AVAILABLE'; availablePrepaidBalance: string; reservedPrepaid: string }
  | { state: 'UNAVAILABLE'; availablePrepaidBalance: null; reservedPrepaid: null };

/**
 * The server's authoritative breakdown of one purchase. Every number on the
 * checkout screen, the cashier's screen and the receipt comes from here —
 * the client chooses *sources*, never amounts.
 *
 *     grossAmount = bonusApplied + prepaidAmountApplied + externalAmountDue
 */
export interface FundingQuote {
  grossAmount: string;
  bonusApplied: string;
  prepaidAmountApplied: string;
  /** What the customer still hands over outside TuTak — at the till, or through the provider. */
  externalAmountDue: string;
  paymentRoute: PaymentRoute;
  availableBonus: string;
  /** The partner's ceiling on bonus for this gross, already rounded the way `create` rounds it. */
  maxBonusAllowed: string;
  prepaid: PrepaidAvailability;
  /** True only when `problems` is empty; a client must not offer "pay" on anything else. */
  canProceed: boolean;
  problems: FundingProblem[];
}

export interface FundingRequest {
  customerId: string;
  partnerId: string;
  grossAmount: string;
  bonusAmountRequested?: string;
  prepaidAmountApplied?: string;
  paymentRoute?: PaymentRoute;
}

/** The parsed, validated components `PurchaseIntentsService.create` builds a row from. */
export interface FundingComponents {
  grossAmount: Decimal;
  bonusAmountRequested: Decimal;
  prepaidAmountApplied: Decimal;
  ordinaryPaymentRemainder: Decimal;
  paymentRoute: PaymentRoute;
}

/**
 * One place that knows how a purchase is funded.
 *
 * `quote()` answers the app before a purchase exists; `create()` in
 * `PurchaseIntentsService` runs the same arithmetic through `components()`
 * and refuses on the first problem. Two entry points, one rule set, so the
 * number the customer was shown is the number the purchase is opened with.
 *
 * Deliberately arithmetic only. It reads balances and terms; it never
 * reserves, holds or posts. The hold belongs to the purchase's own creating
 * transaction (`CustomerBalanceService.holdForPurchase`), and the bonus
 * reservation to `BonusEngineService.reserve` — both of which re-check
 * availability atomically, so a quote that went stale between the screen
 * and the tap is refused there, not trusted here.
 */
@Injectable()
export class PurchaseFundingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly partnersService: PartnersService,
    private readonly customerBalance: CustomerBalanceService,
  ) {}

  async quote(request: FundingRequest): Promise<FundingQuote> {
    // Refuses PENDING_APPROVAL/SUSPENDED/REJECTED partners — a quote against
    // a business that cannot trade is an error, not a breakdown.
    const partner = await this.partnersService.findActiveOrThrow(request.partnerId);

    const grossAmount = parsePositiveMoney(request.grossAmount, 'grossAmount');
    const bonusAmountRequested = request.bonusAmountRequested
      ? parseMoney(request.bonusAmountRequested, 'bonusAmountRequested')
      : new Decimal(0);
    const prepaidAmountApplied = request.prepaidAmountApplied
      ? parseMoney(request.prepaidAmountApplied, 'prepaidAmountApplied')
      : new Decimal(0);
    const paymentRoute = request.paymentRoute ?? PaymentRoute.DIRECT_PARTNER;

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: request.customerId },
      select: { availableBonus: true },
    });
    const availableBonus = wallet?.availableBonus ?? new Decimal(0);
    const maxBonusAllowed = roundCharge(
      grossAmount.times(partner.maxBonusPaymentPercent).dividedBy(100),
    );

    const prepaidEnabled = this.customerBalance.purchasesEnabled();
    const prepaid: PrepaidAvailability = prepaidEnabled
      ? await this.customerBalance.getBalanceDetail(request.customerId).then((detail) => ({
          state: 'AVAILABLE' as const,
          availablePrepaidBalance: detail.available,
          reservedPrepaid: detail.reserved,
        }))
      : { state: 'UNAVAILABLE', availablePrepaidBalance: null, reservedPrepaid: null };

    const problems: FundingProblem[] = [];
    // Structural problems first — a split that does not add up is wrong
    // before any balance is consulted — then the ceilings, then the balances.
    if (bonusAmountRequested.greaterThan(grossAmount)) {
      problems.push({
        code: 'BONUS_EXCEEDS_GROSS',
        message: 'bonusAmountRequested cannot exceed grossAmount',
      });
    }
    if (bonusAmountRequested.plus(prepaidAmountApplied).greaterThan(grossAmount)) {
      problems.push({
        code: 'COMPONENTS_EXCEED_GROSS',
        message: 'bonusAmountRequested and prepaidAmountApplied together cannot exceed grossAmount',
      });
    }
    if (bonusAmountRequested.greaterThan(maxBonusAllowed)) {
      problems.push({
        code: 'BONUS_EXCEEDS_PARTNER_MAX',
        message: `This partner allows at most ${partner.maxBonusPaymentPercent}% of the purchase to be paid with bonus`,
      });
    }
    if (bonusAmountRequested.greaterThan(availableBonus)) {
      problems.push({
        code: 'BONUS_EXCEEDS_AVAILABLE',
        message: 'Insufficient available bonus balance',
      });
    }
    if (prepaidAmountApplied.greaterThan(0)) {
      if (prepaid.state === 'UNAVAILABLE') {
        problems.push({
          code: 'PREPAID_DISABLED',
          message: 'Paying from a stored balance is not available on this deployment',
        });
      } else if (prepaidAmountApplied.greaterThan(new Decimal(prepaid.availablePrepaidBalance))) {
        problems.push({
          code: 'PREPAID_EXCEEDS_AVAILABLE',
          message: 'Insufficient available balance',
        });
      }
    }
    if (
      paymentRoute === PaymentRoute.TUTAK_PSP &&
      !this.config.get('features.tutakPspEnabled', { infer: true })
    ) {
      problems.push({
        code: 'PROVIDER_DISABLED',
        message: 'Paying inside TuTak is not available yet',
      });
    }

    // Clamped at zero only for display when the components already exceed
    // the gross — that quote is refused above, so the clamp never reaches a
    // purchase row (the database would refuse it there as well).
    const external = grossAmount.minus(bonusAmountRequested).minus(prepaidAmountApplied);
    const externalAmountDue = external.lessThan(0) ? new Decimal(0) : external;

    return {
      grossAmount: grossAmount.toFixed(MONEY_SCALE),
      bonusApplied: bonusAmountRequested.toFixed(MONEY_SCALE),
      prepaidAmountApplied: prepaidAmountApplied.toFixed(MONEY_SCALE),
      externalAmountDue: externalAmountDue.toFixed(MONEY_SCALE),
      paymentRoute,
      availableBonus: availableBonus.toFixed(MONEY_SCALE),
      maxBonusAllowed: maxBonusAllowed.toFixed(MONEY_SCALE),
      prepaid,
      canProceed: problems.length === 0,
      problems,
    };
  }

  /**
   * The parsed components for a purchase that is about to be created, or a
   * `BadRequestException` naming the first thing wrong with them — the same
   * messages `create()` has always thrown, so nothing a client matched on
   * changes.
   *
   * `BONUS_EXCEEDS_AVAILABLE` is deliberately *not* refused here: the bonus
   * reservation itself is the atomic check for that, and refusing early on
   * a non-transactional read would only add a second, weaker answer to the
   * same question. The prepaid ceiling is likewise re-checked atomically by
   * the hold; the early refusal here is for the message, not the guarantee.
   */
  async components(request: FundingRequest): Promise<FundingComponents> {
    const quote = await this.quote(request);
    const fatal = quote.problems.find((p) => p.code !== 'BONUS_EXCEEDS_AVAILABLE');
    if (fatal) throw new BadRequestException(fatal.message);

    const grossAmount = new Decimal(quote.grossAmount);
    const bonusAmountRequested = new Decimal(quote.bonusApplied);
    const prepaidAmountApplied = new Decimal(quote.prepaidAmountApplied);
    return {
      grossAmount,
      bonusAmountRequested,
      prepaidAmountApplied,
      ordinaryPaymentRemainder: grossAmount.minus(bonusAmountRequested).minus(prepaidAmountApplied),
      paymentRoute: quote.paymentRoute,
    };
  }
}
