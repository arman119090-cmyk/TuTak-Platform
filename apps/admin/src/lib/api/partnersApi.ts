import type { CreatePartnerRequestDto, PartnerDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export const partnersApi = {
  async list() {
    const { data } = await httpClient.get<ApiEnvelope<PartnerDto[]>>('/partners');
    return data.data;
  },
  async create(dto: CreatePartnerRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerDto>>('/partners', dto);
    return data.data;
  },
  async setActive(id: string, isActive: boolean) {
    const { data } = await httpClient.patch<ApiEnvelope<PartnerDto>>(`/partners/${id}/active`, {
      isActive,
    });
    return data.data;
  },
};
