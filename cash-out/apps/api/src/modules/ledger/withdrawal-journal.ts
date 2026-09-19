import { Money } from '@cashout/money';
import { GLOBAL_ACCOUNT_KEY } from '@cashout/contracts';
import { PostEntryInput, PostingSpec } from './ledger.service';

export interface WithdrawalJournalContext {
  readonly withdrawalId: string;
  readonly driverId: string;
  readonly parkId: string;
  readonly gross: Money;
  readonly platformFee: Money;
  readonly providerFee: Money;
  readonly net: Money;
  readonly providerAccountKey: string;
}

/**
 * The four journal entries a withdrawal can produce, written once so that the
 * orchestrator cannot invent a fifth shape at three in the morning.
 *
 * The story they tell, in order:
 *
 *  1. `reserve` — Yandex confirmed the debit. The park now owes us the gross
 *     amount, and we now owe the driver the same.
 *  2. `feeCapture` — our commission and the provider's are taken out of what we
 *     owe the driver, leaving exactly the net.
 *  3. `settlement` — the transfer settled: our balance at the provider goes
 *     down, our debt to the driver is discharged.
 *  4. `compensation` — the payout failed or was returned: the inverse of 1 and 2
 *     in one entry, which puts the driver's balance back and takes our revenue
 *     off the books.
 */
export const withdrawalJournal = {
  reserve(context: WithdrawalJournalContext): PostEntryInput {
    return {
      type: 'WITHDRAWAL_RESERVE',
      idempotencyKey: `${context.withdrawalId}:WITHDRAWAL_RESERVE`,
      withdrawalId: context.withdrawalId,
      description: `Yandex balance debited for withdrawal ${context.withdrawalId}`,
      postings: [
        debit('PARK_RECEIVABLE', context.parkId, context.gross),
        credit('DRIVER_PAYABLE', context.driverId, context.gross),
      ],
    };
  },

  feeCapture(context: WithdrawalJournalContext): PostEntryInput {
    const postings: PostingSpec[] = [
      debit('DRIVER_PAYABLE', context.driverId, context.platformFee.add(context.providerFee)),
    ];
    if (context.platformFee.isPositive) {
      postings.push(credit('PLATFORM_FEE_REVENUE', GLOBAL_ACCOUNT_KEY, context.platformFee));
    }
    if (context.providerFee.isPositive) {
      postings.push(credit('PROVIDER_FEE_REVENUE', GLOBAL_ACCOUNT_KEY, context.providerFee));
    }
    return {
      type: 'FEE_CAPTURE',
      idempotencyKey: `${context.withdrawalId}:FEE_CAPTURE`,
      withdrawalId: context.withdrawalId,
      description: `Fees captured for withdrawal ${context.withdrawalId}`,
      postings,
    };
  },

  settlement(context: WithdrawalJournalContext): PostEntryInput {
    return {
      type: 'PAYOUT_SETTLEMENT',
      idempotencyKey: `${context.withdrawalId}:PAYOUT_SETTLEMENT`,
      withdrawalId: context.withdrawalId,
      description: `Payout settled for withdrawal ${context.withdrawalId}`,
      postings: [
        debit('DRIVER_PAYABLE', context.driverId, context.net),
        credit('PSP_SETTLEMENT', context.providerAccountKey, context.net),
      ],
    };
  },

  /**
   * Note what this does *not* do: it never touches `PSP_SETTLEMENT`. Compensation
   * only ever runs when the money did not leave — or came back — so the only
   * thing to undo is the reservation and the fees we charged for it.
   */
  compensation(context: WithdrawalJournalContext, reason: string): PostEntryInput {
    const postings: PostingSpec[] = [
      debit('DRIVER_PAYABLE', context.driverId, context.net),
      credit('PARK_RECEIVABLE', context.parkId, context.gross),
    ];
    if (context.platformFee.isPositive) {
      postings.push(debit('PLATFORM_FEE_REVENUE', GLOBAL_ACCOUNT_KEY, context.platformFee));
    }
    if (context.providerFee.isPositive) {
      postings.push(debit('PROVIDER_FEE_REVENUE', GLOBAL_ACCOUNT_KEY, context.providerFee));
    }
    return {
      type: 'COMPENSATION',
      idempotencyKey: `${context.withdrawalId}:COMPENSATION`,
      withdrawalId: context.withdrawalId,
      description: `Withdrawal ${context.withdrawalId} compensated: ${reason}`,
      postings,
      metadata: { reason },
    };
  },

  /** What the provider actually charged us, once it tells us. */
  providerCost(withdrawalId: string, providerAccountKey: string, cost: Money): PostEntryInput {
    return {
      type: 'PROVIDER_COST',
      idempotencyKey: `${withdrawalId}:PROVIDER_COST`,
      withdrawalId,
      description: `Provider cost for withdrawal ${withdrawalId}`,
      postings: [
        debit('PROVIDER_FEE_EXPENSE', GLOBAL_ACCOUNT_KEY, cost),
        credit('PSP_SETTLEMENT', providerAccountKey, cost),
      ],
    };
  },
};

function debit(
  accountType: PostingSpec['accountType'],
  accountKey: string,
  amount: Money,
): PostingSpec {
  return { accountType, accountKey, direction: 'DEBIT', amount };
}

function credit(
  accountType: PostingSpec['accountType'],
  accountKey: string,
  amount: Money,
): PostingSpec {
  return { accountType, accountKey, direction: 'CREDIT', amount };
}
