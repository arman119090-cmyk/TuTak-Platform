import type { MediaAssetDto, PartnerMediaDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export type BrandKind = 'logo' | 'cover';

export const mediaApi = {
  async get(partnerId: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerMediaDto>>(
      `/partners/${partnerId}/media`,
    );
    return data.data;
  },

  /**
   * Submits a new logo or cover for review.
   *
   * The `Content-Type` header is deliberately left unset. The browser has to
   * append its own multipart boundary, and a hand-written
   * `multipart/form-data` without one produces a body the server rejects with
   * a message about the form rather than about the image — a classic, and an
   * unpleasant one to trace.
   *
   * Resolves once the asset exists. What it does *not* mean is that the logo
   * is live: an owner's submission lands `PENDING_REVIEW` and stays invisible
   * to every customer surface until a platform administrator confirms it
   * (TUTAK_V2_MEDIA_SYSTEM_SPEC.md §1). The page says so rather than implying
   * the upload was the publication.
   */
  async submit(partnerId: string, kind: BrandKind, file: File) {
    const form = new FormData();
    form.append('file', file, file.name);
    const { data } = await httpClient.put<ApiEnvelope<MediaAssetDto>>(
      `/partners/${partnerId}/${kind}`,
      form,
    );
    return data.data;
  },
};
