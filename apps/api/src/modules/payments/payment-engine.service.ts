import { Inject, Injectable } from '@nestjs/common';
import {
  Currency,
  LedgerAccountType,
  PostingDirection,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { MONEY_SCALE, Money, parsePositiveMoney } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { PartnersService } from '../partners/partners.service';
import { PSP_ADAPTER, PspAdapter } from './psp-adapter.interface';

/**
 * Did this error come from the (userId, idempotencyKey) unique index?
 *
 * Narrow on purpose. A blanket "P2002 means already charged" would also
 * swallow a collision on `ledgerTransactionId` or `accruedLotId`, which are
 * real bugs that must not be reported to the caller as a successful replay.
 */
function isKeyCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return fields.some((f) => f.includes('idempotencyKey'));
}

export interface CapturePaymentParams {
  userId: string;
  partnerId: string;
  amount: Money;
  currency?: Currency;
  /** Opaque payment-method reference from the client SDK — never a raw PAN. */
  sourceToken: string;
  /** Caller-supplied; scoped per user by `IdempotencyService`. */
  idempotencyKey: string;
}

export interface PaymentResult {
  paymentId: string;
  status: PaymentStatus;
  amount: string;
  commissionAmount: string;
  declineReason?: string;
  pspReference?: string;
}

/**
 * Phase 3 of the financial core: turns a PSP charge into money the ledger
 * knows about.
 *
 * `capture` does three things atomically once the acquirer has actually
 * captured funds — writes the `Payment` row, posts DR PSP_RECEIVABLE / CR
 * PARTNER_PAYABLE + CR PLATFORM_REVENUE, and records the outbox event — or
 * does none of them if the card was declined, because nothing moved. The
 * whole operation sits behind `IdempotencyService`, so a client retry after
 * a dropped response replays the stored result instead of charging twice.
 *
 * Bonus accrual on a captured payment is deliberately out of scope here —
 * see `docs/FINANCIAL_CORE_DESIGN.md` §3: points are triggered by
 * settlement, not by capture, because a payment that is later charged back
 * must never have issued them.
 */
@Injectable()
export class PaymentEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly partners: PartnersService,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async capture(params: CapturePaymentParams): Promise<PaymentResult> {
    const amount = parsePositiveMoney(params.amount, 'amount');
    const currency = params.currency ?? Currency.AMD;
    // Read before the idempotency claim: a replayed call for a partner
    // deactivated since the original charge should still surface that,
    // not silently hand back a stale success.
    const partner = await this.partners.findActiveOrThrow(params.partnerId);

    return this.idempotency.run<PaymentResult>(
      {
        scope: `payment:${params.userId}`,
        key: params.idempotencyKey,
        request: {
          partnerId: partner.id,
          amount: amount.toString(),
          currency,
          sourceToken: params.sourceToken,
        },
      },
      () =>
        this.executeCapture({
          userId: params.userId,
          partner,
          amount,
          currency,
          sourceToken: params.sourceToken,
          idempotencyKey: params.idempotencyKey,
        }),
    );
  }

  private async executeCapture(params: {
    userId: string;
    partner: { id: string; paymentCommissionRateBps: number };
    amount: Decimal;
    currency: Currency;
    sourceToken: string;
    idempotencyKey: string;
  }): Promise<PaymentResult> {
    const { userId, partner, amount, currency, sourceToken, idempotencyKey } = params;

    // Before anything is charged: has this key already produced a payment?
    //
    // `IdempotencyService` normally answers this and this branch never runs.
    // It exists for the case where it cannot — the record was lost while the
    // payment it described survived. Killing Postgres mid-capture produces
    // exactly that: the failure path deletes the record, the committed
    // payment stays, and without this check the retry charges again.
    const already = await this.findByKey(userId, idempotencyKey);
    if (already) return this.toResult(already);

    // Outside any local transaction on purpose: an acquirer call is a network
    // round trip to a system this process does not control, and holding a
    // Postgres transaction open across it would tie up a connection for as
    // long as the PSP takes to answer.
    const result = await this.psp.charge({ amount, currency, sourceToken, idempotencyKey });

    if (result.outcome === 'DECLINED') {
      const payment = await this.prisma.payment.create({
        data: {
          userId,
          partnerId: partner.id,
          amount,
          currency,
          commissionAmount: new Decimal(0),
          status: PaymentStatus.DECLINED,
          declineReason: result.declineReason,
          idempotencyKey,
        },
      });
      return this.toResult(payment);
    }

    const commission = amount
      .times(partner.paymentCommissionRateBps)
      .dividedBy(10_000)
      .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
    const partnerNet = amount.minus(commission);

    const [pspAccount, partnerAccount, revenueAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PSP_RECEIVABLE, currency }),
      this.ledger.accountFor({
        type: LedgerAccountType.PARTNER_PAYABLE,
        partnerId: partner.id,
        currency,
      }),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE, currency }),
    ]);

    // The Payment row and its ledger transaction are created in one
    // database transaction so a CAPTURED payment can never exist without
    // the money movement that is supposed to back it, or vice versa.
    //
    // The unique index on (userId, idempotencyKey) is what makes a second
    // charge impossible rather than merely unlikely. Two attempts that both
    // get past the lookup above — because they are genuinely concurrent, or
    // because one is a retry after a lost record — race to this INSERT, and
    // the loser's whole transaction rolls back, ledger postings included.
    try {
      return await this.prisma.$transaction(async (tx) => {
        const paymentId = randomUUID();

        const ledgerTransaction = await this.ledger.post(
          {
            kind: 'payment.captured',
            sourceType: 'Payment',
            sourceId: paymentId,
            currency,
            postings: [
              { accountId: pspAccount.id, direction: PostingDirection.DEBIT, amount },
              {
                accountId: partnerAccount.id,
                direction: PostingDirection.CREDIT,
                amount: partnerNet,
              },
              {
                accountId: revenueAccount.id,
                direction: PostingDirection.CREDIT,
                amount: commission,
              },
            ],
            events: [
              {
                aggregateType: 'Payment',
                aggregateId: paymentId,
                eventType: 'payment.captured',
                payload: {
                  paymentId,
                  userId,
                  partnerId: partner.id,
                  amount: amount.toString(),
                  commissionAmount: commission.toString(),
                },
              },
            ],
          },
          tx,
        );

        const payment = await tx.payment.create({
          data: {
            id: paymentId,
            userId,
            partnerId: partner.id,
            amount,
            currency,
            commissionAmount: commission,
            status: PaymentStatus.CAPTURED,
            pspReference: result.pspReference,
            ledgerTransactionId: ledgerTransaction.id,
            idempotencyKey,
          },
        });

        return this.toResult(payment);
      });
    } catch (err) {
      if (!isKeyCollision(err)) throw err;
      const existing = await this.findByKey(userId, idempotencyKey);
      // The row must be there — the constraint that just fired is what
      // wrote it. If it somehow is not, re-throwing is right: silently
      // charging again is the one outcome that must never happen.
      if (!existing) throw err;
      return this.toResult(existing);
    }
  }

  private findByKey(userId: string, idempotencyKey: string) {
    return this.prisma.payment.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
  }

  private toResult(payment: {
    id: string;
    status: PaymentStatus;
    amount: Decimal;
    commissionAmount: Decimal;
    declineReason: string | null;
    pspReference: string | null;
  }): PaymentResult {
    return {
      paymentId: payment.id,
      status: payment.status,
      amount: payment.amount.toFixed(MONEY_SCALE),
      commissionAmount: payment.commissionAmount.toFixed(MONEY_SCALE),
      declineReason: payment.declineReason ?? undefined,
      pspReference: payment.pspReference ?? undefined,
    };
  }
}
