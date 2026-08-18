import { ReferralInviteStatus } from '../enums/referral';

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
  status: ReferralInviteStatus;
  qualifyingAction: string | null;
  rewardAmount: string | null;
  createdAt: string;
  qualifiedAt: string | null;
  /** Who was invited — the whole point of this screen is showing that. */
  referee: { id: string; firstName: string; lastName: string } | null;
}
