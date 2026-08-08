import type {
  CreateEvReservationRequestDto,
  EvReservationDto,
  EvSessionDto,
  EvStationDto,
  StartEvSessionRequestDto,
  StopEvSessionRequestDto,
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
    // The key is omitted rather than sent as undefined: the API validates
    // with `forbidNonWhitelisted`, and axios drops undefined values, but
    // being explicit keeps the intent readable — "pay in full" is the
    // absence of a bonus, not a bonus of nothing.
    const body: StopEvSessionRequestDto = bonusAmountToApply ? { bonusAmountToApply } : {};
    const { data } = await httpClient.post<ApiEnvelope<EvSessionDto>>(
      `/ev/sessions/${sessionId}/stop`,
      body,
    );
    return data.data;
  },

  /** The session currently charging, if any. */
  async activeSession() {
    const { data } = await httpClient.get<ApiEnvelope<EvSessionDto[]>>('/ev/sessions/me');
    return data.data.find((s) => s.status === 'CHARGING') ?? null;
  },

  async myHistory() {
    const { data } = await httpClient.get<ApiEnvelope<EvSessionDto[]>>('/ev/sessions/me');
    return data.data;
  },
};
