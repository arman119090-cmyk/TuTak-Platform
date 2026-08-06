import type { EvStationDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export const evApi = {
  async listStations() {
    const { data } = await httpClient.get<ApiEnvelope<EvStationDto[]>>('/ev/stations');
    return data.data;
  },
};
