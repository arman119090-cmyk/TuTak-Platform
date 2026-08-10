import type { ReferralCodeDto, ReferralInviteDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

export const referralApi = {
  async getMyCode() {
    const { data } = await httpClient.get<ApiEnvelope<ReferralCodeDto>>('/referral/me/code');
    return data.data;
  },

  async listMyInvites() {
    const { data } = await httpClient.get<ApiEnvelope<ReferralInviteDto[]>>('/referral/me/invites');
    return data.data;
  },
};
