/**
 * The adapter boundary for the roaming-CPO wholesale-resale integration
 * (docs/ROAMING_CPO_INTEGRATION_2026-08-25.md).
 *
 * No real partner API documentation exists yet, so this is deliberately
 * NOT a client TuTak uses to call a real partner endpoint (there is
 * nothing real to call). It is the mirror image of
 * `../ev-charging/ocpi/ocpi-adapter.interface.ts`: instead of TuTak pushing
 * start/stop commands to a remote CPO, the partner pushes data TO TuTak —
 * `RoamingCpoController`'s `stations/sync` and `sessions/settle` routes are
 * the inbound half of this boundary, guarded by `RoamingCpoApiKeyGuard`'s
 * M2M credential. This interface is the outbound half: the one piece of
 * information TuTak owes the partner back, "at minimum, the linked TuTak
 * user id" (requirement 4) — everything else in the relationship is the
 * partner calling TuTak, never the other way round, so there is no
 * "start charging"/"fetch tariff" method here the way `OcpiAdapter` has one.
 *
 * When a real partner is signed and its documentation exists, only the
 * concrete implementation of this interface changes (e.g. an
 * `HttpRoamingCpoProvider` posting to their real "customer linked" webhook,
 * the same relationship `HttpOcpiAdapter` already has to `NoopOcpiAdapter`)
 * — no caller of `ROAMING_CPO_PROVIDER` needs to change, and nothing here
 * hardcodes which partner it is.
 */
export interface RoamingCpoProvider {
  /**
   * Tells the partner which of their customer ids now maps to which TuTak
   * user — called once, right after `RoamingCpoCustomersService.link`
   * creates the mapping. The partner is not required to act on this (nothing
   * TuTak does depends on the call succeeding, and it should never block or
   * fail the customer's own linking action) — see
   * `NoopRoamingCpoProvider` for the placeholder implementation and
   * the completion report for exactly what a real implementation would
   * need to send this over.
   */
  notifyCustomerLinked(params: {
    partnerId: string;
    externalCustomerId: string;
    tutakUserId: string;
  }): Promise<void>;
}

export const ROAMING_CPO_PROVIDER = 'ROAMING_CPO_PROVIDER';

/**
 * What the partner must report per completed session — requirement 4's list,
 * typed. `RoamingCpoSessionSettleDto` (the actual HTTP DTO, validated at the
 * controller boundary) is shaped to match this one field for field; this
 * type exists separately so `RoamingCpoSettlementService`'s core logic is
 * expressed against a plain interface, not a class-validator DTO.
 */
export interface RoamingCpoSessionReport {
  externalSessionId: string;
  externalCustomerId: string;
  externalStationId: string;
  externalConnectorId: string;
  /** kWh delivered, as the partner's own meter reported it. */
  energyKwh: string;
  /** The tariff actually applied to this customer for this session — never a station default. */
  appliedCustomerRatePerKwh: string;
  /** The final amount the partner charged the customer for this session. */
  finalAmount: string;
  /** AMD of the final amount the customer asked to pay from their TuTak bonus balance, if any. */
  bonusAmountToApply?: string;
  startedAt?: string;
  stoppedAt?: string;
}

/** What the partner must report per station/connector for the sync endpoint. */
export interface RoamingCpoStationSync {
  externalStationId: string;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  /** The station's current standard/walk-in tariff — display/audit only, see `EvStation.standardRetailRatePerKwh`. */
  standardRetailRatePerKwh: string;
  connectors: Array<{
    externalConnectorId: string;
    connectorType: string;
    powerKw: string;
  }>;
}
