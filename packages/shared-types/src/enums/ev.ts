/**
 * Mirrors OCPI 2.2.1 `Status` for EVSEs/connectors so the platform can
 * plug into any OCPI CPO without remapping vocab.
 */
export enum EvConnectorStatus {
  AVAILABLE = 'AVAILABLE',
  BLOCKED = 'BLOCKED',
  CHARGING = 'CHARGING',
  INOPERATIVE = 'INOPERATIVE',
  OUTOFORDER = 'OUTOFORDER',
  PLANNED = 'PLANNED',
  REMOVED = 'REMOVED',
  RESERVED = 'RESERVED',
  UNKNOWN = 'UNKNOWN',
}

export enum EvConnectorType {
  TYPE_2 = 'TYPE_2',
  CCS2 = 'CCS2',
  CHADEMO = 'CHADEMO',
  GBT_DC = 'GBT_DC',
}

export enum EvSessionStatus {
  RESERVED = 'RESERVED',
  AUTHORIZED = 'AUTHORIZED',
  CHARGING = 'CHARGING',
  SUSPENDED = 'SUSPENDED',
  /** Stopped, awaiting the roaming CPO's own trusted CDR before it can be billed. */
  AWAITING_SETTLEMENT = 'AWAITING_SETTLEMENT',
  COMPLETED = 'COMPLETED',
  INVALID = 'INVALID',
  CANCELLED = 'CANCELLED',
}

export enum EvReservationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  FULFILLED = 'FULFILLED',
}

/**
 * A station's control/tariff model — see docs/ROAMING_CPO_INTEGRATION_2026-08-25.md.
 * `ROAMING_CPO` stations are never started/stopped from TuTak (requirement 1)
 * and are excluded from customer discovery entirely (`EvStationsService.listNearby`) —
 * every session on one arrives already completed, settled server-to-server.
 */
export enum EvStationProvider {
  INTERNAL = 'INTERNAL',
  ROAMING_CPO = 'ROAMING_CPO',
}
