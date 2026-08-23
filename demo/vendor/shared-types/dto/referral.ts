import { ReferralInviteStatus } from '../enums/referral';
import type { MediaImageDto } from './media';

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
  /**
   * Who was invited — the whole point of this screen is showing that.
   *
   * Level 1 only. Levels 2 and 3 stay aggregate count-only and never gain an
   * identity, let alone a face (spec §1.4/§4).
   *
   * `avatar` is present **only** when that person has actively turned consent
   * on (`User.avatarConsentReferralList`); it is null for everyone else,
   * including people who have an avatar and simply have not opted in. The
   * server decides this — the client is never sent a URL it is expected to
   * refrain from rendering.
   */
  referee: { id: string; firstName: string; lastName: string; avatar: MediaImageDto | null } | null;
}
