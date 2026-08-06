import type {
  CreateEvReservationRequestDto,
  EvReservationDto,
  EvSessionDto,
  EvStationDto,
  StartEvSessionRequestDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

export const evApi = {
  async listStations() {
    const { data } = await httpClient.get<ApiEnvelope<EvStationDto[]>>('/ev/stations');
    return data.data;
  },

  async nearbyStations(lat: number, lng: number, radiusKm = 10) {
    const { data } = await httpClient.get<ApiEnvelope<EvStationDto[]>>('/ev/stations/nearby', {
      params: { lat, lng, radiusKm },
    });
    return data.data;
  },

  async createReservation(dto: CreateEvReservationRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<EvReservationDto>>('/ev/reservations', dto);
    return data.data;
  },

  async myReservations() {
    const { data } = await httpClient.get<ApiEnvelope<EvReservationDto[]>>('/ev/reservations/me');
    return data.data;
  },

  async startSession(dto: StartEvSessionRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<EvSessionDto>>('/ev/sessions/start', dto);
    return data.data;
  },

  async stopSession(sessionId: string, bonusAmountToApply?: string) {
    const { data } = await httpClient.post<ApiEnvelope<EvSessionDto>>(
      `/ev/sessions/${sessionId}/stop`,
      { bonusAmountToApply },
    );
    return data.data;
  },

  async myHistory() {
    const { data } = await httpClient.get<ApiEnvelope<EvSessionDto[]>>('/ev/sessions/me');
    return data.data;
  },
};
