import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Currency, LedgerAccountType, PostingDirection } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE, Money, parsePositiveMoney } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';

export interface RecordAcquirerSettlementParams {
  amount: Money;
  currency?: Currency;
  /** The acquirer's own reference for the transfer, from the statement. */
  reference: string;
  /** The day the money landed, per the statement. */
  settledOn: Date;
  /** The operator keying this in; recorded and scopes the idempotency key. */
  actorId: string;
  idempotencyKey: string;
}

export interface AcquirerSettlementResult {
  settlementId: string;
  amount: string;
  /** What the acquirer still owes the platform after this transfer. */
  outstandingReceivable: string;
}

/**
 * The acquirer paying the platform what it has been holding.
 *
 * This is the counterpart to `PayoutEngineService` and the half of the cash
 * cycle that was missing. Capture credits PSP_RECEIVABLE — a claim on the
 * acquirer, not cash. Payouts spend PLATFORM_BANK. With nothing joining the
 * two, PSP_RECEIVABLE grew for the life of the platform and PLATFORM_BANK
 * only ever went down, so neither could be compared against a real bank
 * statement and reconciliation had nothing to check them against.
 *
 * Entered by an operator from the remittance advice rather than driven by a
 * webhook. An inbound settlement is an assertion that money arrived; taking
 * that assertion from anything other than a human reading the bank's own
 * statement would let a compromised integration create cash out of nothing.
 */
@Injectable()
export class AcquirerSettlementService {
  private readonly logger = new Logger(AcquirerSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** What the acquirer currently owes, as a positive figure. */
  async outstandingReceivable(currency: Currency = Currency.AMD): Promise<Decimal> {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { type: LedgerAccountType.PSP_RECEIVABLE, partnerId: null, userId: null, currency },
    });
    // Debit-normal: a receivable of 93,000 is stored as +93,000.
    return account?.balance ?? new Decimal(0);
  }

  async record(params: RecordAcquirerSettlementParams): Promise<AcquirerSettlementResult> {
    const amount = parsePositiveMoney(params.amount, 'settlement amount');
    const currency = params.currency ?? Currency.AMD;
    const reference = params.reference.trim();
    if (!reference) {
      throw new BadRequestException('A statement reference is required');
    }

    return this.idempotency.run<AcquirerSettlementResult>(
      {
        scope: `acquirer-settlement:${params.actorId}`,
        key: params.idempotencyKey,
        request: { amount: amount.toString(), currency, reference },
      },
      () => this.execute(amount, currency, reference, params.settledOn, params.actorId),
    );
  }

  private async execute(
    amount: Decimal,
    currency: Currency,
    reference: string,
    settledOn: Date,
    actorId: string,
  ): Promise<AcquirerSettlementResult> {
    const [receivableAccount, bankAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PSP_RECEIVABLE, currency }),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_BANK, currency }),
    ]);

    const settlement = await this.prisma.$transaction(async (tx) => {
      // Same lock as the payout engine, for the same reason: `ledger.post`
      // below moves this balance, so a conditional claim that also moved it
      // would double-count. Locking states the intent — exclude concurrent
      // readers — without touching the number.
      const locked = await tx.$queryRaw<Array<{ balance: string }>>`
        SELECT balance FROM "ledger_accounts" WHERE id = ${receivableAccount.id} FOR UPDATE
      `;
      const outstanding = new Decimal(locked[0]?.balance ?? 0);

      // The acquirer cannot pay more than it holds. A statement line larger
      // than the receivable means the two sides disagree about what was
      // captured, and posting it anyway would drive PSP_RECEIVABLE negative
      // — an acquirer owing the platform a negative amount is not a state
      // anyone can reason about, and it would hide the disagreement.
      if (amount.greaterThan(outstanding)) {
        throw new ConflictException(
          `Settlement of ${amount.toString()} exceeds the ${outstanding.toString()} the acquirer holds. ` +
            'Reconcile the capture history against the statement before recording it.',
        );
      }

      const created = await tx.acquirerSettlement.create({
        data: { amount, currency, reference, settledOn, recordedByUserId: actorId },
      });

      const ledgerTransaction = await this.ledger.post(
        {
          kind: 'acquirer.settled',
          sourceType: 'AcquirerSettlement',
          sourceId: created.id,
          currency,
          postings: [
            { accountId: bankAccount.id, direction: PostingDirection.DEBIT, amount },
            { accountId: receivableAccount.id, direction: PostingDirection.CREDIT, amount },
          ],
          events: [
            {
              aggregateType: 'AcquirerSettlement',
              aggregateId: created.id,
              eventType: 'acquirer.settled',
              payload: { settlementId: created.id, amount: amount.toString(), reference },
            },
          ],
        },
        tx,
      );

      return tx.acquirerSettlement.update({
        where: { id: created.id },
        data: { ledgerTransactionId: ledgerTransaction.id },
      });
    });

    const outstanding = await this.outstandingReceivable(currency);
    this.logger.log(
      `Acquirer settlement ${settlement.id} recorded: ${amount.toString()} ref ${reference}`,
    );

    return {
      settlementId: settlement.id,
      amount: amount.toFixed(MONEY_SCALE),
      outstandingReceivable: outstanding.toFixed(MONEY_SCALE),
    };
  }

  list(limit = 30) {
    return this.prisma.acquirerSettlement.findMany({
      orderBy: { settledOn: 'desc' },
      take: limit,
    });
  }
}
