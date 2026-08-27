import type { PartnerBrandDto } from './media';
import {
  EvConnectorStatus,
  EvConnectorType,
  EvReservationStatus,
  EvSessionStatus,
  EvStationProvider,
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
  /** See `EvStationProvider` — `FASTCHARGE` stations never show Start/Stop. */
  provider: EvStationProvider;
  externalStationId: string | null;
  /** Display/audit only — a specific session may settle at a different rate; see `EvSessionDto.appliedCustomerRatePerKwh`. */
  standardRetailRatePerKwh: string | null;
  connectors: EvConnectorDto[];
  /** Only set by `GET /ev/stations/nearby` — absent from `listStations`/`listAll`. */
  distanceKm?: number;
}

export interface EvConnectorDto {
  id: string;
  stationId: string;
  ocpiEvseUid: string | null;
  externalConnectorId: string | null;
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
  /** Set only on a FastCharge-settled session — see docs/FASTCHARGE_INTEGRATION_2026-08-25.md. */
  appliedCustomerRatePerKwh?: string | null;
  stationRetailRatePerKwh?: string | null;
  /**
   * Present on the list endpoints, which join it. A session on its own says
   * nothing a customer can read — the price and the station name live here.
   */
  connector?: EvConnectorDto & { station: Omit<EvStationDto, 'connectors'> };
  /**
   * The operator's identity — spec §1.3's "charging-session detail/history".
   *
   * Present on the history endpoint. Taken from the session's own transaction
   * snapshot once it has one, so a completed session keeps showing the brand
   * it was charged under; a session still running falls back to the station's
   * partner as it is right now, which is the honest answer for something
   * happening now.
   */
  partnerBrand?: PartnerBrandDto | null;
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
