export interface ReferralCodeDto {
  code: string;
  userId: string;
  totalInvites: number;
  totalRewardedInvites: number;
  createdAt: string;
}

export interface ReferralInviteDto {
  id: string;
  referrerUserId: string;
  refereeUserId: string;
  status: 'PENDING' | 'QUALIFIED' | 'REWARDED' | 'EXPIRED' | 'FRAUD_BLOCKED';
  qualifyingAction: string | null;
  rewardAmount: string | null;
  createdAt: string;
  qualifiedAt: string | null;
}
