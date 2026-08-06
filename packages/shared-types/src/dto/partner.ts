export interface PartnerDto {
  id: string;
  legalName: string;
  displayName: string;
  taxId: string;
  category: string;
  bonusAccrualRateBps: number;
  isActive: boolean;
  createdAt: string;
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
