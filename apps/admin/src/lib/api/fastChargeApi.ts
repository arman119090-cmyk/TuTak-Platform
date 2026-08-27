import type { EvStationDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

/**
 * Admin visibility/edit of FastCharge station tariffs — see
 * docs/FASTCHARGE_INTEGRATION_2026-08-25.md's admin-panel requirement.
 * `/fastcharge/stations` is partner-scoped on the API side (a platform
 * admin's own scope check passes for any partner — see
 * `FastChargeController.listStations`); it is not repeated here.
 */
export const fastChargeApi = {
  async listStations(partnerId: string) {
    const { data } = await httpClient.get<ApiEnvelope<EvStationDto[]>>('/fastcharge/stations', {
      params: { partnerId },
    });
    return data.data;
  },
  async updateStationTariff(stationId: string, standardRetailRatePerKwh: string) {
    const { data } = await httpClient.patch<ApiEnvelope<EvStationDto>>(
      `/fastcharge/stations/${stationId}/tariff`,
      { standardRetailRatePerKwh },
    );
    return data.data;
  },
};
