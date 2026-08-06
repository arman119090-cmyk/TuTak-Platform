import {
  EvConnectorStatus,
  EvConnectorType,
  EvReservationStatus,
  EvSessionStatus,
} from '../enums/ev';

export interface EvStationDto {
  id: string;
  partnerId: string;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  ocpiLocationId: string | null;
  connectors: EvConnectorDto[];
}

export interface EvConnectorDto {
  id: string;
  stationId: string;
  ocpiEvseUid: string | null;
  connectorType: EvConnectorType;
  status: EvConnectorStatus;
  powerKw: number;
  pricePerKwh: string;
}

export interface StartEvSessionRequestDto {
  connectorId: string;
  userId: string;
  reservationId?: string;
}

export interface EvSessionDto {
  id: string;
  connectorId: string;
  userId: string;
  status: EvSessionStatus;
  startedAt: string | null;
  stoppedAt: string | null;
  energyKwh: string | null;
  cost: string | null;
  bonusEarned: string | null;
  ocpiCdrId: string | null;
}

export interface CreateEvReservationRequestDto {
  connectorId: string;
  userId: string;
  startAt: string;
  holdMinutes?: number;
}

export interface EvReservationDto {
  id: string;
  connectorId: string;
  userId: string;
  status: EvReservationStatus;
  startAt: string;
  expiresAt: string;
}
