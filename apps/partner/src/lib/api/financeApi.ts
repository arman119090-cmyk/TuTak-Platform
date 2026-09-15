import { httpClient } from '../httpClient';

export interface Settlement {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: string;
  commissionAmount: string;
  netAmount: string;
  bonusAccrued: string;
  paymentCount: number;
}

export interface Payout {
  id: string;
  amount: string;
  status: 'REQUESTED' | 'PAID' | 'FAILED';
  bankReference: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface PartnerCollection {
  id: string;
  amount: string;
  bankReference: string;
  createdAt: string;
}

/** Real QR/PurchaseIntent activity, grouped by day — see `dailyActivity` below. */
export interface ActivityDay {
  periodStart: string;
  grossAmount: string;
  discountGivenAmount: string;
  commissionOwedAmount: string;
  netAmount: string;
  purchaseCount: number;
}

export const financeApi = {
  async balance(partnerId: string): Promise<{ availableBalance: string; currency: string }> {
    const { data } = await httpClient.get(`/payouts/partners/${partnerId}/balance`);
    return data.data;
  },

  async settlements(partnerId: string): Promise<Settlement[]> {
    const { data } = await httpClient.get(`/payouts/partners/${partnerId}/settlements`);
    return data.data;
  },

  async payouts(partnerId: string): Promise<Payout[]> {
    const { data } = await httpClient.get(`/payouts/partners/${partnerId}`);
    return data.data;
  },

  /** The other settlement direction: this partner's own transfers to TuTak. */
  async collections(partnerId: string): Promise<PartnerCollection[]> {
    const { data } = await httpClient.get(`/payouts/partners/${partnerId}/collections`);
    return data.data;
  },

  /**
   * Real confirmed-purchase activity for a partner running the live QR flow
   * — `settlements` above only ever has rows for the legacy card-payment
   * pipeline, which stays off in production.
   */
  async dailyActivity(partnerId: string): Promise<ActivityDay[]> {
    const { data } = await httpClient.get('/purchase-intents/activity/daily', {
      params: { partnerId },
    });
    return data.data;
  },
};

/**
 * A settlement TuTak has drafted for this partner: one period, one net
 * figure, one bank transfer somebody makes by hand.
 *
 * Typed here rather than in `@tutak/shared-types` to match the rest of this
 * file — the dashboard's settlement DTOs have no second consumer yet, and
 * moving them is a change worth making when one appears, not before.
 */
export interface PartnerSettlementRow {
  id: string;
  partnerId: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  accruedAmount: string;
  deductionsAmount: string;
  netAmount: string;
  currency: string;
  transferReference: string | null;
  paidAt: string | null;
  createdAt: string;
  _count?: { entries: number };
}

/** One line of a statement, traced to the posting that produced it. */
export interface PartnerSettlementEntryRow {
  id: string;
  kind: string;
  amount: string;
  occurredAt: string;
  sourceType: string | null;
  sourceId: string | null;
}

export interface PartnerStatement {
  settlement: PartnerSettlementRow;
  entries: PartnerSettlementEntryRow[];
}

/** What has accrued since the last settlement and nobody has drafted yet. */
export interface UnsettledPosition {
  partnerId: string;
  accrued: string;
  deductions: string;
  net: string;
  entries: PartnerSettlementEntryRow[];
  /** Posting kinds nobody has classified. Shown, never silently dropped. */
  unrecognised: string[];
}

/**
 * The partner's own view of what TuTak owes them.
 *
 * Read-only, and that is the design rather than an omission: a payee who can
 * adjust what they are owed is not a payee. The one write a partner has is
 * reporting a problem with a transfer, which asserts nothing about whether
 * money moved — deciding that takes two people on the TuTak side.
 */
export const settlementApi = {
  async statements(partnerId: string): Promise<PartnerSettlementRow[]> {
    const { data } = await httpClient.get(`/partner/settlements/${partnerId}`);
    return data.data;
  },

  async statement(partnerId: string, id: string): Promise<PartnerStatement> {
    const { data } = await httpClient.get(`/partner/settlements/${partnerId}/statement/${id}`);
    return data.data;
  },

  async position(partnerId: string): Promise<UnsettledPosition> {
    const { data } = await httpClient.get(`/partner/settlements/${partnerId}/position`);
    return data.data;
  },

  // `reason`, matching `ReportTransferProblemDto` — the server validates it
  // at 3-500 characters, so an empty complaint is refused there too.
  async reportProblem(partnerId: string, id: string, reason: string): Promise<PartnerSettlementRow> {
    const { data } = await httpClient.post(
      `/partner/settlements/${partnerId}/statement/${id}/report-problem`,
      { reason },
    );
    return data.data;
  },
};
