import { Injectable, Logger } from '@nestjs/common';
import { OcpiAdapter } from './ocpi-adapter.interface';

/**
 * No-op OCPI adapter — active until a real roaming partner's credential set
 * is configured via OCPI_* env vars. All
 * TuTak-owned stations (no `ocpiEvseUid`) never call this adapter at all;
 * it only guards the roaming-station code path so that path fails loudly
 * and safely instead of silently pretending to control real hardware.
 */
@Injectable()
export class NoopOcpiAdapter implements OcpiAdapter {
  private readonly logger = new Logger(NoopOcpiAdapter.name);

  // These satisfy an async interface without doing async work, so they
  // return resolved promises rather than being marked `async` — the real
  // adapter will await network calls here.
  startRemoteSession(): Promise<{ accepted: boolean; ocpiSessionId?: string }> {
    this.logger.warn('OCPI roaming is not configured — rejecting remote session start');
    return Promise.resolve({ accepted: false });
  }

  stopRemoteSession(): Promise<{ accepted: boolean }> {
    this.logger.warn('OCPI roaming is not configured — rejecting remote session stop');
    return Promise.resolve({ accepted: false });
  }

  fetchCdr(): Promise<null> {
    return Promise.resolve(null);
  }
}
