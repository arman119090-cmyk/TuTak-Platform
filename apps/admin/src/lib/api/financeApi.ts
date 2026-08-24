import { httpClient } from '../httpClient';

export interface AcquirerSettlement {
  id: string;
  amount: string;
  currency: string;
  reference: string;
  settledOn: string;
  createdAt: string;
}

export interface LedgerAccount {
  id: string;
  type: string;
  userId: string | null;
  partnerId: string | null;
  currency: string;
  balance: string;
  version: number;
  createdAt: string;
}

export interface LedgerPosting {
  id: string;
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
  currency: string;
  createdAt: string;
  transaction: { kind: string; sourceType: string; sourceId: string; postedAt: string };
}

export interface AccountPostings {
  account: LedgerAccount;
  storedBalance: string;
  replayedBalance: string;
  /** False means the ledger disagrees with itself — the most serious thing this UI can show. */
  inSync: boolean;
  postings: LedgerPosting[];
}

export interface ReconciliationFinding {
  account: string;
  partnerId?: string;
  expected: string;
  reported: string;
  drift: string;
}

export interface ReconciliationRun {
  id: string;
  periodStart: string;
  status: 'CLEAN' | 'DRIFT_DETECTED';
  findings: ReconciliationFinding[];
  createdAt: string;
}

export interface Payout {
  id: string;
  partnerId: string;
  amount: string;
  status: 'REQUESTED' | 'PAID' | 'FAILED';
  bankReference: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  /** The two-person rule's participants. Ids for the check, names to read. */
  requestedByUserId: string | null;
  confirmedByUserId: string | null;
  requestedByName: string | null;
  confirmedByName: string | null;
}

export interface PartnerCollection {
  id: string;
  partnerId: string;
  amount: string;
  bankReference: string;
  createdAt: string;
  recordedByUserId: string | null;
  recordedByName: string | null;
}

export interface PaymentRow {
  id: string;
  amount: string;
  refundedAmount: string;
  status: 'CAPTURED' | 'DECLINED';
  createdAt: string;
  partner: { displayName: string };
  user: { firstName: string; lastName: string; phone: string };
}

export interface RefundResult {
  refundId: string;
  amount: string;
  totalRefunded: string;
  bonusClawedBack: string;
}

/**
 * Every operation that moves money takes its idempotency key as an argument
 * rather than minting one here.
 *
 * This file used to generate a fresh key inside each call, which meant the
 * key described the HTTP attempt instead of the operator's intention — and a
 * request that timed out client-side after succeeding on the server came back
 * as a failure, was pressed again, and paid twice. `useIdempotencyKey`
 * explains the failure in full.
 *
 * Required, not optional, so a new call site cannot quietly omit it.
 */
export const financeApi = {
  async searchPayments(filter: { partnerId?: string; userId?: string }): Promise<PaymentRow[]> {
    const { data } = await httpClient.get('/payments/search', { params: filter });
    return data.data;
  },

  async refund(
    paymentId: string,
    reason: string,
    idempotencyKey: string,
    amount?: string,
  ): Promise<RefundResult> {
    const { data } = await httpClient.post('/refunds', {
      paymentId,
      reason,
      ...(amount ? { amount } : {}),
      idempotencyKey,
    });
    return data.data;
  },

  async ledgerAccounts(): Promise<LedgerAccount[]> {
    const { data } = await httpClient.get('/admin/ledger/accounts');
    return data.data;
  },

  async accountPostings(accountId: string): Promise<AccountPostings> {
    const { data } = await httpClient.get(`/admin/ledger/accounts/${accountId}/postings`);
    return data.data;
  },

  async reconciliationRuns(): Promise<ReconciliationRun[]> {
    const { data } = await httpClient.get('/admin/reconciliation');
    return data.data;
  },

  async runReconciliation(periodStart: string): Promise<{
    runId: string;
    status: 'CLEAN' | 'DRIFT_DETECTED';
    findings: ReconciliationFinding[];
    partnersBlocked: string[];
  }> {
    const { data } = await httpClient.post('/admin/reconciliation/run', { periodStart });
    return data.data;
  },

  async clearPayoutBlock(partnerId: string): Promise<void> {
    await httpClient.post(`/admin/partners/${partnerId}/payout-block/clear`, {});
  },

  async partnerBalance(partnerId: string): Promise<{ availableBalance: string }> {
    const { data } = await httpClient.get(`/payouts/partners/${partnerId}/balance`);
    return data.data;
  },

  async partnerPayouts(partnerId: string): Promise<Payout[]> {
    const { data } = await httpClient.get(`/payouts/partners/${partnerId}`);
    return data.data;
  },

  async requestPayout(partnerId: string, amount: string, idempotencyKey: string) {
    const { data } = await httpClient.post('/payouts', {
      partnerId,
      amount,
      idempotencyKey,
    });
    return data.data;
  },

  async confirmPayout(payoutId: string, bankReference: string): Promise<void> {
    await httpClient.post(`/payouts/${payoutId}/confirm`, { bankReference });
  },

  async failPayout(payoutId: string, failureReason: string): Promise<void> {
    await httpClient.post(`/payouts/${payoutId}/fail`, { failureReason });
  },

  // ── Money arriving from a partner ──────────────────────────────────────
  //
  // The other settlement direction (doc §2/§7): a partner's own bank
  // transfer paying down commission they owe TuTak.

  async partnerCollections(partnerId: string): Promise<PartnerCollection[]> {
    const { data } = await httpClient.get(`/payouts/partners/${partnerId}/collections`);
    return data.data;
  },

  async recordCollection(
    partnerId: string,
    amount: string,
    bankReference: string,
    idempotencyKey: string,
  ) {
    const { data } = await httpClient.post('/payouts/collections', {
      partnerId,
      amount,
      bankReference,
      idempotencyKey,
    });
    return data.data;
  },

  // ── Money arriving from the acquirer ───────────────────────────────────

  async outstandingReceivable(): Promise<{ outstandingReceivable: string; currency: string }> {
    const { data } = await httpClient.get('/payouts/acquirer/outstanding');
    return data.data;
  },

  async acquirerSettlements(): Promise<AcquirerSettlement[]> {
    const { data } = await httpClient.get('/payouts/acquirer/settlements');
    return data.data;
  },

  async recordAcquirerSettlement(input: {
    amount: string;
    reference: string;
    settledOn: string;
    idempotencyKey: string;
  }) {
    const { data } = await httpClient.post('/payouts/acquirer/settlements', input);
    return data.data;
  },
};
