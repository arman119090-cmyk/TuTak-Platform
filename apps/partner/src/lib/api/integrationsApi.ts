import type { CreatePartnerIntegrationRequestDto, PartnerIntegrationDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export const integrationsApi = {
  async list(partnerId: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerIntegrationDto[]>>(
      `/partners/${partnerId}/integrations`,
    );
    return data.data;
  },

  async create(partnerId: string, dto: CreatePartnerIntegrationRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerIntegrationDto>>(
      `/partners/${partnerId}/integrations`,
      dto,
    );
    return data.data;
  },
};
