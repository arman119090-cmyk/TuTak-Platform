import type {
  CreatePartnerPromoRequestDto,
  PartnerPromoAdminDto,
  UpdatePartnerPromoRequestDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

/**
 * Home "Partner Spotlight" placements — `/admin/promos`.
 *
 * Administrator-only on the server (the role, not the permission), so this
 * client never has to ask who is calling: a partner owner's token is refused
 * before the service is reached.
 */
export const promosApi = {
  async list() {
    const { data } = await httpClient.get<ApiEnvelope<PartnerPromoAdminDto[]>>('/admin/promos');
    return data.data;
  },

  async create(dto: CreatePartnerPromoRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerPromoAdminDto>>('/admin/promos', dto);
    return data.data;
  },

  async update(id: string, dto: UpdatePartnerPromoRequestDto) {
    const { data } = await httpClient.patch<ApiEnvelope<PartnerPromoAdminDto>>(
      `/admin/promos/${id}`,
      dto,
    );
    return data.data;
  },

  /**
   * Replaces the card's artwork. `Content-Type` is left to the browser so it
   * appends its own multipart boundary — see `mediaApi.submit` in the
   * partner panel for the bug that rule exists to prevent.
   */
  async setArtwork(id: string, file: File) {
    const form = new FormData();
    form.append('file', file, file.name);
    const { data } = await httpClient.put<ApiEnvelope<PartnerPromoAdminDto>>(
      `/admin/promos/${id}/artwork`,
      form,
    );
    return data.data;
  },
};
