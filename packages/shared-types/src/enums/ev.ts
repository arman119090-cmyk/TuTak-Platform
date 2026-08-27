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
 * A station's control/tariff model. `INTERNAL` is a TuTak-owned or
 * plain-roaming charger, started/stopped by TuTak — the only behaviour that
 * exists today.
 */
export enum EvStationProvider {
  INTERNAL = 'INTERNAL',
}
