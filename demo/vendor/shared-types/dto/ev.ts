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
  /** Only set by `GET /ev/stations/nearby` — absent from `listStations`/`listAll`. */
  distanceKm?: number;
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

/**
 * No `userId`. The session belongs to whoever holds the token, and the API
 * validates with `forbidNonWhitelisted`, so a client that sent one — as this
 * type used to require — got a 400 rather than a session. Nothing caught it
 * because no screen had ever called it.
 */
export interface StartEvSessionRequestDto {
  connectorId: string;
  reservationId?: string;
}

export interface StopEvSessionRequestDto {
  /** Points to spend against the session's cost. Omit to pay in full. */
  bonusAmountToApply?: string;
  /**
   * Identifies the stop so a retry after a lost answer returns the original
   * result instead of being refused. Optional on the wire for the sake of any
   * client that predates it; the mobile app always sends one.
   */
  idempotencyKey?: string;
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
  /**
   * Present on the list endpoints, which join it. A session on its own says
   * nothing a customer can read — the price and the station name live here.
   */
  connector?: EvConnectorDto & { station: Omit<EvStationDto, 'connectors'> };
}

/** See StartEvSessionRequestDto on why there is no `userId`. */
export interface CreateEvReservationRequestDto {
  connectorId: string;
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
