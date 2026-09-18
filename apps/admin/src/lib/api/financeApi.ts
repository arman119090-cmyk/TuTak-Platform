import {
  ReconciliationOutcome,
  type PartnerSettlementDto,
  type PartnerStatementDto,
  type UnsettledPositionDto,
} from '@tutak/shared-types';
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
  status: 'PENDING' | 'CONFIRMED';
  bankReference: string;
  bankTransactionId: string | null;
  createdAt: string;
  /** The maker and checker of the two-person rule. Ids for the check, names to read. */
  recordedByUserId: string | null;
  recordedByName: string | null;
  confirmedByUserId: string | null;
  confirmedByName: string | null;
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
    bankTransactionId: string,
    idempotencyKey: string,
  ) {
    const { data } = await httpClient.post('/payouts/collections', {
      partnerId,
      amount,
      bankReference,
      bankTransactionId,
      idempotencyKey,
    });
    return data.data;
  },

  /**
   * The checker half of the two-person rule on collections: a different
   * admin than whoever recorded it confirms a PENDING collection, which is
   * the moment it actually posts to the ledger. See
   * `PartnerCollectionService.confirm`'s own docblock.
   */
  async confirmCollection(collectionId: string) {
    const { data } = await httpClient.post(`/payouts/collections/${collectionId}/confirm`, {});
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

// ── Provider payments nobody can account for ────────────────────────────

export interface UnresolvedPspAttempt {
  id: string;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  providerBillId: string | null;
  providerTransactionId: string | null;
  createdAt: string;
  escalationCount: number;
  /** Set once somebody has read the provider's record and said what it shows. */
  reconciledByUserId: string | null;
  reconciliationEvidence: string | null;
  reconciliationProposedAt: string | null;
  purchaseIntent: {
    id: string;
    partnerId: string;
    customerId: string;
    grossAmount: string;
    status: string;
  };
}

export interface DeadLetteredCallback {
  id: string;
  provider: string;
  billId: string | null;
  providerTransactionId: string | null;
  receivedAt: string;
  attempts: number;
  lastError: string | null;
}

export interface LiquidityPosition {
  currency: string;
  platformBank: string;
  pspReceivable: string;
  unsettledAcquirerAmount: string;
  partnerPayable: string;
  partnerReceivable: string;
  pendingPspExposure: string;
  pendingRefunds: string;
  safeToPay: string;
  paymentsWithUnknownFee: number;
}

export const pspApi = {
  async unresolved() {
    const { data } = await httpClient.get<{ data: UnresolvedPspAttempt[] }>(
      '/admin/psp/attempts/unresolved',
    );
    return data.data;
  },

  async deadLettered() {
    const { data } = await httpClient.get<{ data: DeadLetteredCallback[] }>(
      '/admin/psp/callbacks/dead-lettered',
    );
    return data.data;
  },

  /**
   * "I have read the provider's record and it shows no payment."
   *
   * Moves nothing. The actor is whoever is signed in — there is no field for
   * it, deliberately, because one caller naming the second person is not two
   * people.
   */
  async proposeReconciliation(attemptId: string, evidence: string) {
    const { data } = await httpClient.post<{ data: UnresolvedPspAttempt }>(
      `/admin/psp/attempts/${attemptId}/reconciliation/propose`,
      { evidence },
    );
    return data.data;
  },

  /** A second person agrees, and the payment is released. */
  async confirmReconciliation(attemptId: string) {
    const { data } = await httpClient.post<{ data: UnresolvedPspAttempt }>(
      `/admin/psp/attempts/${attemptId}/reconciliation/confirm`,
    );
    return data.data;
  },
};

export const treasuryApi = {
  async position() {
    const { data } = await httpClient.get<{ data: LiquidityPosition }>('/admin/treasury/position');
    return data.data;
  },
};

/**
 * Partner settlements from the TuTak side: drafting one, and the two-person
 * path that gets it paid.
 *
 * Every write here is `SETTLEMENT_MANAGE`. The maker/checker split is not a
 * permission split — both halves need the same permission — it is an
 * *identity* split enforced by the service: whoever created a settlement
 * cannot approve it. The screen mirrors that so an admin is told before the
 * request rather than by a 409.
 */
export const settlementAdminApi = {
  async list(partnerId?: string): Promise<PartnerSettlementDto[]> {
    const { data } = await httpClient.get('/admin/partner-settlements', {
      params: partnerId ? { partnerId } : undefined,
    });
    return data.data;
  },

  async detail(id: string): Promise<PartnerStatementDto> {
    const { data } = await httpClient.get(`/admin/partner-settlements/${id}`);
    return data.data;
  },

  async unsettled(partnerId: string): Promise<UnsettledPositionDto> {
    const { data } = await httpClient.get(`/admin/partner-settlements/unsettled/${partnerId}`);
    return data.data;
  },

  async draft(partnerId: string, periodStart: string, periodEnd: string) {
    const { data } = await httpClient.post(`/admin/partner-settlements/drafts/${partnerId}`, {
      periodStart,
      periodEnd,
    });
    return data.data as PartnerSettlementDto;
  },

  async markReady(id: string, documentNumber?: string) {
    const { data } = await httpClient.post(`/admin/partner-settlements/${id}/ready`, {
      ...(documentNumber ? { documentNumber } : {}),
    });
    return data.data as PartnerSettlementDto;
  },

  /** The checker half. Refused by the server if you are the maker. */
  async approve(id: string) {
    const { data } = await httpClient.post(`/admin/partner-settlements/${id}/approve`);
    return data.data as PartnerSettlementDto;
  },

  async markPaymentPending(id: string) {
    const { data } = await httpClient.post(`/admin/partner-settlements/${id}/payment-pending`);
    return data.data as PartnerSettlementDto;
  },

  /** The only call that posts to the ledger. Needs the bank's own reference. */
  async markPaid(id: string, bankTransferReference: string) {
    const { data } = await httpClient.post(`/admin/partner-settlements/${id}/paid`, {
      bankTransferReference,
    });
    return data.data as PartnerSettlementDto;
  },

  async markFailed(id: string, reason: string) {
    const { data } = await httpClient.post(`/admin/partner-settlements/${id}/failed`, { reason });
    return data.data as PartnerSettlementDto;
  },

  async markAmbiguous(id: string, reason: string) {
    const { data } = await httpClient.post(
      `/admin/partner-settlements/${id}/requires-reconciliation`,
      { reason },
    );
    return data.data as PartnerSettlementDto;
  },

  async proposeReconciliation(id: string, outcome: ReconciliationOutcome, evidence: string) {
    const { data } = await httpClient.post(
      `/admin/partner-settlements/${id}/reconciliation/propose`,
      { outcome, evidence },
    );
    return data.data as PartnerSettlementDto;
  },

  async confirmReconciliation(id: string) {
    const { data } = await httpClient.post(
      `/admin/partner-settlements/${id}/reconciliation/confirm`,
    );
    return data.data as PartnerSettlementDto;
  },

  async cancel(id: string, reason: string) {
    const { data } = await httpClient.post(`/admin/partner-settlements/${id}/cancel`, { reason });
    return data.data as PartnerSettlementDto;
  },
};
