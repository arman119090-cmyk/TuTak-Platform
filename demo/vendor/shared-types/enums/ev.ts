/**
 * Mirrors OCPI 2.2.1 `Status` for EVSEs/connectors so the platform can
 * plug into FastCharge (or any OCPI CPO) without remapping vocab.
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
 * A station's control/tariff model — see docs/FASTCHARGE_INTEGRATION_2026-08-25.md.
 * `FASTCHARGE` stations are never started/stopped from TuTak (requirement 1);
 * the mobile map/list opens a deep link to the FastCharge app for one of
 * these instead of the ordinary Start button.
 */
export enum EvStationProvider {
  INTERNAL = 'INTERNAL',
  FASTCHARGE = 'FASTCHARGE',
}
