import type { PartnerBranchQrResolveResponseDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

/** Resolves a scanned `TUTAK-BRANCH:<token>` code server-side — see `PartnerBranchQrCode`. */
export const partnerBranchQrApi = {
  async resolve(token: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerBranchQrResolveResponseDto>>(
      `/partner-branch-qr/resolve/${encodeURIComponent(token)}`,
    );
    return data.data;
  },
};
