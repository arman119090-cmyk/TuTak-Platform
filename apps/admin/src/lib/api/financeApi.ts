import { httpClient } from '../httpClient';

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
 * A fresh key per attempt, so a retry the operator initiates deliberately is
 * a new refund rather than a replay of the last one. Retrying a *failed*
 * request safely is the server's job; this is the client saying "I mean it
 * again", which is a different thing.
 */
const newIdempotencyKey = () =>
  `adm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const financeApi = {
  async searchPayments(filter: { partnerId?: string; userId?: string }): Promise<PaymentRow[]> {
    const { data } = await httpClient.get('/payments/search', { params: filter });
    return data.data;
  },

  async refund(paymentId: string, reason: string, amount?: string): Promise<RefundResult> {
    const { data } = await httpClient.post('/refunds', {
      paymentId,
      reason,
      ...(amount ? { amount } : {}),
      idempotencyKey: newIdempotencyKey(),
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

  async requestPayout(partnerId: string, amount: string) {
    const { data } = await httpClient.post('/payouts', {
      partnerId,
      amount,
      idempotencyKey: newIdempotencyKey(),
    });
    return data.data;
  },

  async confirmPayout(payoutId: string, bankReference: string): Promise<void> {
    await httpClient.post(`/payouts/${payoutId}/confirm`, { bankReference });
  },

  async failPayout(payoutId: string, failureReason: string): Promise<void> {
    await httpClient.post(`/payouts/${payoutId}/fail`, { failureReason });
  },
};
