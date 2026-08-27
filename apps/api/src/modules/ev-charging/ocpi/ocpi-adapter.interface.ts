/**
 * Contract for a roaming CPO/eMSP bridge implementing OCPI 2.2.1
 * (Locations, Sessions, CDRs, Commands modules). TuTak owns its own
 * stations directly today; this interface is what a FastCharge (or any
 * other OCPI-speaking network) integration will implement so the rest of
 * the EV module never needs to change when that partner is connected —
 * it only needs an EvStation row with `ocpiEvseUid` populated.
 */
export interface OcpiAdapter {
  /** Pushes a start-charging command to the remote CPO for a roaming EVSE. */
  startRemoteSession(params: {
    ocpiEvseUid: string;
    userId: string;
    localSessionId: string;
  }): Promise<{ accepted: boolean; ocpiSessionId?: string }>;

  /** Pushes a stop-charging command to the remote CPO. */
  stopRemoteSession(params: {
    ocpiSessionId: string;
  }): Promise<{ accepted: boolean }>;

  /** Pulls the final Charge Detail Record once the remote CPO has settled the session. */
  fetchCdr(ocpiSessionId: string): Promise<{
    ocpiCdrId: string;
    totalEnergyKwh: number;
    totalCost: number;
    totalTimeSec: number;
    raw: unknown;
  } | null>;
}

export const OCPI_ADAPTER = 'OCPI_ADAPTER';
