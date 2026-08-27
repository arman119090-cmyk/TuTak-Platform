import type { EvStationDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

/**
 * Admin visibility/edit of roaming-CPO station tariffs — see
 * docs/ROAMING_CPO_INTEGRATION_2026-08-25.md's admin-panel requirement.
 * `/roaming-cpo/stations` is partner-scoped on the API side (a platform
 * admin's own scope check passes for any partner — see
 * `RoamingCpoController.listStations`); it is not repeated here.
 */
export const roamingCpoApi = {
  async listStations(partnerId: string) {
    const { data } = await httpClient.get<ApiEnvelope<EvStationDto[]>>('/roaming-cpo/stations', {
      params: { partnerId },
    });
    return data.data;
  },
  async updateStationTariff(stationId: string, standardRetailRatePerKwh: string) {
    const { data } = await httpClient.patch<ApiEnvelope<EvStationDto>>(
      `/roaming-cpo/stations/${stationId}/tariff`,
      { standardRetailRatePerKwh },
    );
    return data.data;
  },
};
