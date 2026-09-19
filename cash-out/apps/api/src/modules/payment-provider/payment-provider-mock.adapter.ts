import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { ENV, Env } from '../../config/env';
import { Clock } from '../../common/clock';
import { constantTimeEquals } from '../../common/crypto/crypto.service';
import {
  PayoutInstruction,
  PayoutOutcome,
  PaymentProviderPort,
  ProviderWebhookEvent,
  RegisterInstrumentInput,
  RegisteredInstrument,
  WebhookParseResult,
} from './payment-provider.port';

/**
 * An in-memory payment provider.
 *
 * **This does not move money.** It exists so that the orchestrator, the ledger
 * and the reconciliation job can be exercised end to end, and so that the ugly
 * cases — a transfer that settles after we time out, a success followed by a
 * reversal, a webhook delivered twice — can be produced on demand instead of
 * waited for in production. `PROVIDER_MODE=mock` is rejected when
 * `NODE_ENV=production`.
 *
 * Its webhook signing deliberately uses the same scheme the live adapter must
 * use (HMAC-SHA256 over `timestamp.body`, with a freshness window), so the
 * verification path under test is the real one.
 */
@Injectable()
export class PaymentProviderMockAdapter extends PaymentProviderPort {
  readonly name = 'mock-psp';

  private readonly payouts = new Map<string, MockPayout>();
  private readonly instruments = new Map<string, RegisteredInstrument>();

  behaviour: MockProviderBehaviour = { mode: 'confirm' };
  callLog: Array<{ method: string; idempotencyKey?: string }> = [];

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly clock: Clock,
  ) {
    super();
  }

  reset(): void {
    this.payouts.clear();
    this.instruments.clear();
    this.behaviour = { mode: 'confirm' };
    this.callLog = [];
  }

  payoutCount(): number {
    return this.payouts.size;
  }

  payoutFor(idempotencyKey: string): MockPayout | undefined {
    return this.payouts.get(idempotencyKey);
  }

  async createPayout(input: PayoutInstruction): Promise<PayoutOutcome> {
    this.callLog.push({ method: 'createPayout', idempotencyKey: input.idempotencyKey });

    const existing = this.payouts.get(input.idempotencyKey);
    if (existing) {
      // Idempotent replay. A provider that did not do this is the reason
      // `probe` exists.
      return this.outcomeFor(existing);
    }

    switch (this.behaviour.mode) {
      case 'reject':
        return {
          status: 'REJECTED',
          code: this.behaviour.code ?? 'mock_declined',
          message: 'mock provider declined the payout',
        };
      case 'timeout':
        return { status: 'UNKNOWN', reason: 'mock_timeout' };
      case 'submitted_but_timeout': {
        this.record(input, 'SUBMITTED');
        return { status: 'UNKNOWN', reason: 'mock_submitted_but_timeout' };
      }
      case 'unavailable':
        return { status: 'UNKNOWN', reason: 'mock_unavailable' };
      case 'submit': {
        const payout = this.record(input, 'SUBMITTED');
        return { status: 'SUBMITTED', providerTransactionId: payout.providerTransactionId };
      }
      case 'confirm':
      default: {
        const payout = this.record(input, 'CONFIRMED');
        return {
          status: 'CONFIRMED',
          providerTransactionId: payout.providerTransactionId,
          providerCost: this.costFor(input.amount),
        };
      }
    }
  }

  async probe(idempotencyKey: string): Promise<PayoutOutcome> {
    this.callLog.push({ method: 'probe', idempotencyKey });
    if (this.behaviour.mode === 'unavailable') {
      return { status: 'UNKNOWN', reason: 'mock_unavailable' };
    }
    const payout = this.payouts.get(idempotencyKey);
    if (!payout) return { status: 'NOT_FOUND' };
    return this.outcomeFor(payout);
  }

  /** Test hook: settle a payout that was only submitted. */
  settle(idempotencyKey: string): ProviderWebhookEvent | null {
    const payout = this.payouts.get(idempotencyKey);
    if (!payout) return null;
    payout.status = 'CONFIRMED';
    return this.eventFor(payout, 'payout.confirmed');
  }

  /** Test hook: the provider takes a settled payout back. */
  reverse(idempotencyKey: string, reason = 'mock_reversal'): ProviderWebhookEvent | null {
    const payout = this.payouts.get(idempotencyKey);
    if (!payout) return null;
    payout.status = 'RETURNED';
    payout.failureCode = reason;
    return this.eventFor(payout, 'payout.returned');
  }

  /** Test hook: the provider fails a submitted payout. */
  fail(idempotencyKey: string, reason = 'mock_failed'): ProviderWebhookEvent | null {
    const payout = this.payouts.get(idempotencyKey);
    if (!payout) return null;
    payout.status = 'REJECTED';
    payout.failureCode = reason;
    return this.eventFor(payout, 'payout.failed');
  }

  async registerInstrument(input: RegisterInstrumentInput): Promise<RegisteredInstrument> {
    this.callLog.push({ method: 'registerInstrument' });
    const existing = this.instruments.get(input.singleUseToken);
    if (existing) return existing;

    if (input.singleUseToken.startsWith('tok_reject')) {
      const rejected: RegisteredInstrument = {
        token: `pm_${randomUUID()}`,
        maskedIdentifier: '•••• 0000',
        displayName: null,
        instrumentFingerprint: `fp_${input.singleUseToken}`,
        status: 'REJECTED',
        rejectionReason: 'mock rejection',
      };
      this.instruments.set(input.singleUseToken, rejected);
      return rejected;
    }

    const last4 = input.singleUseToken.slice(-4).padStart(4, '0').replace(/\D/g, '4');
    const instrument: RegisteredInstrument = {
      token: `pm_${randomUUID()}`,
      maskedIdentifier: `•••• ${last4}`,
      displayName: 'Mock Bank',
      /** Same card across two drivers gives the same fingerprint, on purpose. */
      instrumentFingerprint: `fp_${last4}`,
      status: 'ACTIVE',
    };
    this.instruments.set(input.singleUseToken, instrument);
    return instrument;
  }

  /**
   * Signs a payload the way the mock provider would, so tests can build
   * realistic deliveries — including deliberately bad ones.
   */
  signPayload(body: string, timestamp: number): Record<string, string> {
    const secret = this.webhookSecret();
    return {
      'x-provider-timestamp': String(timestamp),
      'x-provider-signature': createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex'),
    };
  }

  parseWebhook(raw: string, headers: Record<string, string | undefined>): WebhookParseResult {
    const signature = headers['x-provider-signature'];
    const timestampHeader = headers['x-provider-timestamp'];

    if (!signature) return { ok: false, reason: 'missing_signature' };
    if (!timestampHeader) return { ok: false, reason: 'missing_timestamp' };

    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) return { ok: false, reason: 'missing_timestamp' };

    // Freshness first: a replayed delivery has a valid signature by definition.
    const skewSeconds = Math.abs(this.clock.nowMs() / 1000 - timestamp);
    if (skewSeconds > this.env.WEBHOOK_MAX_SKEW_SECONDS) {
      return { ok: false, reason: 'stale_timestamp' };
    }

    const expected = createHmac('sha256', this.webhookSecret())
      .update(`${timestamp}.${raw}`)
      .digest('hex');
    if (!constantTimeEquals(Buffer.from(expected), Buffer.from(signature))) {
      return { ok: false, reason: 'bad_signature' };
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const type = String(parsed.type ?? '');
      if (!isKnownEventType(type)) return { ok: false, reason: 'malformed_payload' };
      const externalId = String(parsed.id ?? '');
      const reference = String(parsed.reference ?? '');
      const providerTransactionId = String(parsed.provider_transaction_id ?? '');
      if (!externalId || !reference || !providerTransactionId) {
        return { ok: false, reason: 'malformed_payload' };
      }
      const currency = String(parsed.currency ?? 'AMD') as CurrencyCode;
      const costMinor = parsed.provider_cost_minor;

      return {
        ok: true,
        event: {
          externalId,
          type,
          reference,
          providerTransactionId,
          occurredAt: parsed.occurred_at ? new Date(String(parsed.occurred_at)) : this.clock.now(),
          failureCode: parsed.failure_code ? String(parsed.failure_code) : undefined,
          failureMessage: parsed.failure_message ? String(parsed.failure_message) : undefined,
          providerCost:
            typeof costMinor === 'string' || typeof costMinor === 'number'
              ? Money.fromMinor(String(costMinor), currency)
              : undefined,
          raw: parsed,
        },
      };
    } catch {
      return { ok: false, reason: 'malformed_payload' };
    }
  }

  async ping(): Promise<boolean> {
    return this.behaviour.mode !== 'unavailable';
  }

  buildWebhookBody(
    idempotencyKey: string,
    type: ProviderWebhookEvent['type'],
    overrides: Record<string, unknown> = {},
  ): string {
    const payout = this.payouts.get(idempotencyKey);
    return JSON.stringify({
      id: `evt_${randomUUID()}`,
      type,
      reference: payout?.reference ?? 'unknown',
      provider_transaction_id: payout?.providerTransactionId ?? 'unknown',
      occurred_at: this.clock.now().toISOString(),
      currency: payout?.amount.currency ?? 'AMD',
      ...overrides,
    });
  }

  private webhookSecret(): string {
    return this.env.PROVIDER_WEBHOOK_SECRET ?? 'mock-webhook-secret-mock-webhook-secret';
  }

  private record(input: PayoutInstruction, status: MockPayout['status']): MockPayout {
    const payout: MockPayout = {
      idempotencyKey: input.idempotencyKey,
      reference: input.reference,
      amount: input.amount,
      instrumentToken: input.instrumentToken,
      providerTransactionId: `psp_${this.payouts.size + 1}_${input.reference}`,
      status,
      createdAt: this.clock.now(),
    };
    this.payouts.set(input.idempotencyKey, payout);
    return payout;
  }

  private outcomeFor(payout: MockPayout): PayoutOutcome {
    switch (payout.status) {
      case 'CONFIRMED':
        return {
          status: 'CONFIRMED',
          providerTransactionId: payout.providerTransactionId,
          providerCost: this.costFor(payout.amount),
        };
      case 'SUBMITTED':
        return { status: 'SUBMITTED', providerTransactionId: payout.providerTransactionId };
      case 'RETURNED':
      case 'REJECTED':
      default:
        return {
          status: 'REJECTED',
          code: payout.failureCode ?? 'mock_failed',
          message: 'mock provider failed the payout',
          providerTransactionId: payout.providerTransactionId,
        };
    }
  }

  private eventFor(payout: MockPayout, type: ProviderWebhookEvent['type']): ProviderWebhookEvent {
    return {
      externalId: `evt_${randomUUID()}`,
      type,
      reference: payout.reference,
      providerTransactionId: payout.providerTransactionId,
      occurredAt: this.clock.now(),
      failureCode: payout.failureCode,
      raw: {},
    };
  }

  /** A flat 0.4% of the net, so provider-cost bookkeeping has something to do. */
  private costFor(amount: Money): Money {
    return amount.multiplyRatio(40n, 10_000n, 'HALF_UP');
  }
}

export interface MockProviderBehaviour {
  mode: 'confirm' | 'submit' | 'reject' | 'timeout' | 'submitted_but_timeout' | 'unavailable';
  code?: string;
}

export interface MockPayout {
  idempotencyKey: string;
  reference: string;
  amount: Money;
  instrumentToken: string;
  providerTransactionId: string;
  status: 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'RETURNED';
  createdAt: Date;
  failureCode?: string;
}

function isKnownEventType(value: string): value is ProviderWebhookEvent['type'] {
  return ['payout.submitted', 'payout.confirmed', 'payout.failed', 'payout.returned'].includes(
    value,
  );
}
