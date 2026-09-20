import { Money } from '@cashout/money';
import {
  PayoutInstruction,
  PayoutOutcome,
  RegisterInstrumentInput,
  RegisteredInstrument,
  WebhookParseResult,
} from '../payment-provider/payment-provider.port';
import { IdramAccountVerification, IdramProviderPort, VerifyIdramAccountInput } from './idram.port';

export interface IdramLiveConfig {
  readonly baseUrl: string;
  readonly merchantId: string;
  readonly apiKey: string;
  readonly webhookSecret: string;
  readonly timeoutMs: number;
}

/**
 * Thrown by every method until the corresponding part of iDram's contract is
 * known and implemented. The message names exactly what is missing, so a
 * start-up failure reads as a to-do list rather than a mystery.
 */
export class IdramContractUnknownError extends Error {
  constructor(readonly unknown: IdramUnknown) {
    super(`iDram live adapter: ${unknown} is not known — see docs/IDRAM_INTEGRATION.md`);
    this.name = 'IdramContractUnknownError';
  }
}

export type IdramUnknown =
  | 'authentication scheme'
  | 'wallet verification endpoint'
  | 'payout endpoint and its idempotency semantics'
  | 'transaction status endpoint'
  | 'webhook envelope and signature scheme'
  | 'reversal / return semantics'
  | 'health / sandbox endpoint';

/**
 * The place the real iDram adapter goes. It fits `IdramProviderPort`, is
 * constructed from the `IDRAM_*` variables, and is wired under
 * `PROVIDER_MODE=live` — but every method throws `IdramContractUnknownError`
 * until iDram's documentation answers the question it names. `assertReady()`
 * runs at start-up so the process refuses to serve rather than fail on the
 * first payout.
 *
 * When the documentation arrives, each method is implemented in place; the
 * mock (`IdramMockAdapter`) stays for tests and local work and is never
 * consulted here.
 */
export class IdramLiveAdapter extends IdramProviderPort {
  readonly name = 'idram-live';

  constructor(private readonly config: IdramLiveConfig) {
    super();
  }

  /** Lists what is still unknown; empty means the adapter may serve. */
  static missing(): IdramUnknown[] {
    return [
      'authentication scheme',
      'wallet verification endpoint',
      'payout endpoint and its idempotency semantics',
      'transaction status endpoint',
      'webhook envelope and signature scheme',
      'reversal / return semantics',
      'health / sandbox endpoint',
    ];
  }

  assertReady(): void {
    const missing = IdramLiveAdapter.missing();
    if (missing.length > 0) {
      throw new Error(
        `PROVIDER_MODE=live: the iDram adapter cannot serve yet. Unknown: ${missing.join('; ')}. ` +
          `Base URL ${this.config.baseUrl}, merchant ${this.config.merchantId}. See docs/IDRAM_INTEGRATION.md.`,
      );
    }
  }

  async verifyAccount(_input: VerifyIdramAccountInput): Promise<IdramAccountVerification> {
    throw new IdramContractUnknownError('wallet verification endpoint');
  }

  async createPayout(_input: PayoutInstruction): Promise<PayoutOutcome> {
    throw new IdramContractUnknownError('payout endpoint and its idempotency semantics');
  }

  async probe(_idempotencyKey: string): Promise<PayoutOutcome> {
    throw new IdramContractUnknownError('transaction status endpoint');
  }

  async registerInstrument(_input: RegisterInstrumentInput): Promise<RegisteredInstrument> {
    // iDram destinations are wallets verified through verifyAccount; a card
    // token flow does not apply to this rail.
    throw new IdramContractUnknownError('wallet verification endpoint');
  }

  parseWebhook(_raw: string, _headers: Record<string, string | undefined>): WebhookParseResult {
    throw new IdramContractUnknownError('webhook envelope and signature scheme');
  }

  async ping(): Promise<boolean> {
    throw new IdramContractUnknownError('health / sandbox endpoint');
  }

  /** Kept so the fee engine's expectations are visible: iDram's own fee is unknown. */
  static providerFeeFor(_amount: Money): Money | null {
    return null;
  }
}
