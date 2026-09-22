import type {
  PartnerActivityPageDto,
  PartnerSettlementDto,
  PartnerStatementDto,
  PurchaseBreakdownDto,
  UnsettledPositionDto,
} from '@tutak/shared-types';
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

/*
 * Settlement types now live in `@tutak/shared-types` — see
 * `PartnerSettlementDto`'s own docblock for why. They were typed here, they
 * were typed *wrong*, and the tests agreed with the mistake because the
 * fixture repeated it. A shared type makes the same mistake a `tsc` error in
 * every consumer instead of a NaN a partner has to notice.
 */

export const settlementApi = {
  async statements(partnerId: string): Promise<PartnerSettlementDto[]> {
    const { data } = await httpClient.get(`/partner/settlements/${partnerId}`);
    return data.data;
  },

  async statement(partnerId: string, id: string): Promise<PartnerStatementDto> {
    const { data } = await httpClient.get(`/partner/settlements/${partnerId}/statement/${id}`);
    return data.data;
  },

  async position(partnerId: string): Promise<UnsettledPositionDto> {
    const { data } = await httpClient.get(`/partner/settlements/${partnerId}/position`);
    return data.data;
  },

  /**
   * Every movement on the partner's own account, filtered and paged.
   *
   * The cursor is passed back exactly as it was received. Building one on
   * this side would mean relying on a sort order the server is free to
   * change, and a cursor the server did not issue is refused rather than
   * quietly restarting the list at the top.
   */
  async activity(
    partnerId: string,
    params: {
      from?: string;
      to?: string;
      branchId?: string;
      state?: 'UNSETTLED' | 'IN_SETTLEMENT' | 'UNDER_REVIEW' | 'PAID';
      cursor?: string;
      limit?: number;
    } = {},
  ): Promise<PartnerActivityPageDto> {
    const { data } = await httpClient.get(`/partner/settlements/${partnerId}/activity`, {
      params,
    });
    return data.data;
  },

  /** One purchase: what it cost, what funded it, and where its money stands. */
  async purchaseBreakdown(partnerId: string, purchaseIntentId: string): Promise<PurchaseBreakdownDto> {
    const { data } = await httpClient.get(
      `/partner/settlements/${partnerId}/purchases/${purchaseIntentId}/breakdown`,
    );
    return data.data;
  },

  /**
   * "The money you say you sent never arrived."
   *
   * `reason`, matching `ReportTransferProblemDto` — the server validates it
   * at 3-500 characters, so an empty complaint is refused there too.
   *
   * The answer is an acknowledgement, not the settlement: the report
   * changes no status and moves no figure, and a write that answered with a
   * financial record would be a second way to read one.
   */
  async reportProblem(
    partnerId: string,
    id: string,
    reason: string,
  ): Promise<{ id: string; status: string; reportedAt: string }> {
    const { data } = await httpClient.post(
      `/partner/settlements/${partnerId}/statement/${id}/report-problem`,
      { reason },
    );
    return data.data;
  },
};
