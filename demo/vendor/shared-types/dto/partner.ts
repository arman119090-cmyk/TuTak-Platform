/**
 * What any authenticated caller sees.
 *
 * A customer needs the directory to find where their points are worth
 * something, so this is readable by everyone — which is exactly why it must
 * not carry tax IDs, individually negotiated commission rates, or the fact
 * that a business is currently blocked from being paid.
 */
export interface PartnerPublicDto {
  id: string;
  displayName: string;
  category: string;
  /** The cashback rate. Advertised by the partner; the customer is owed it. */
  bonusAccrualRateBps: number;
  isActive: boolean;
  createdAt: string;
}

/**
 * The full record. Returned only to a holder of PARTNER_MANAGE, or to the
 * partner's own people reading their own row.
 */
export interface PartnerDto extends PartnerPublicDto {
  legalName: string;
  taxId: string;
  paymentCommissionRateBps: number;
  payoutsBlockedAt: string | null;
  payoutsBlockedReason: string | null;
  updatedAt: string;
}

export interface CreatePartnerRequestDto {
  legalName: string;
  displayName: string;
  taxId: string;
  category: string;
  bonusAccrualRateBps: number;
  ownerUserId: string;
}

export interface PartnerAnalyticsDto {
  partnerId: string;
  periodFrom: string;
  periodTo: string;
  totalTransactions: number;
  totalRevenue: string;
  totalBonusIssued: string;
  totalBonusRedeemed: string;
  uniqueCustomers: number;
}
