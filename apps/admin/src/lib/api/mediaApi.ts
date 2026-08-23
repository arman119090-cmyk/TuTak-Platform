import type { MediaAssetDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

/** `GET /admin/media/pending` — the row plus the partner it belongs to. */
export interface PendingMediaRow extends MediaAssetDto {
  partnerDisplayName: string | null;
}

export const mediaApi = {
  async pending() {
    const { data } = await httpClient.get<ApiEnvelope<PendingMediaRow[]>>('/admin/media/pending');
    return data.data;
  },

  /**
   * Publishes a submission. The partner's previously published asset of the
   * same kind moves to REPLACED rather than being deleted — every operation
   * that snapshotted it keeps rendering it (spec §2.2).
   */
  async approve(partnerId: string, assetId: string) {
    const { data } = await httpClient.post<ApiEnvelope<MediaAssetDto>>(
      `/partners/${partnerId}/media/${assetId}/approve`,
    );
    return data.data;
  },

  /**
   * Takes a *published* logo or cover down.
   *
   * Distinct from rejecting a submission, and much heavier: revocation stops
   * the image being served everywhere, including on the historical operations
   * that snapshotted it, and those fall back to the neutral mark while
   * keeping the business's name. The derivatives are retained on the server
   * either way — nothing here deletes history.
   */
  async revoke(partnerId: string, kind: 'logo' | 'cover') {
    const { data } = await httpClient.delete<ApiEnvelope<{ revokedAssetId: string | null }>>(
      `/partners/${partnerId}/${kind}`,
    );
    return data.data;
  },
};
