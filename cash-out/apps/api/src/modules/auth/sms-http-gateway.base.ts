import { AppLogger } from '../../common/logging/logger.service';
import { IntegrationHealthRecorder } from '../integration-health/integration-health.recorder';
import { SendOtpInput, SmsError, SmsGatewayPort, SmsSendResult } from './sms-gateway.port';

export interface SmsHttpGatewayOptions {
  readonly timeoutMs: number;
  /** Retries after the first attempt, on retryable errors only. */
  readonly maxRetries: number;
  readonly retryBaseDelayMs?: number;
}

/**
 * What every real SMS provider adapter shares, so a provider adapter is only
 * the request and the response mapping.
 *
 *  - **Timeout**: one `AbortController` per attempt; a hung provider becomes
 *    `TIMEOUT`, retryable.
 *  - **Retries**: only on retryable errors (timeout, 5xx, rate limit), with
 *    exponential backoff, and never on `INVALID_NUMBER`, `NUMBER_BLOCKED`,
 *    `AUTH_FAILED` or `REJECTED` — a retried rejection is a second bill for the
 *    same refusal. The OTP flow's own cooldown means a driver cannot cause a
 *    retry storm.
 *  - **Never throws**: an exception from the provider call is normalised to
 *    `PROVIDER_UNAVAILABLE`.
 *  - **Health**: every final outcome is recorded under the gateway's name, so
 *    the Integrations tile and the `sms_unavailable` alert see it.
 *  - **Never logs the code.** Only the phone's last digits, the reference and
 *    the normalised error reach the log.
 *
 * A provider adapter implements `request` (one attempt, may throw) and
 * `ping`. It must map the provider's status to `SmsSendResult` — see
 * docs/LIVE_READINESS.md for what to confirm with the provider.
 */
export abstract class SmsHttpGatewayBase extends SmsGatewayPort {
  readonly mode = 'live' as const;

  protected constructor(
    protected readonly options: SmsHttpGatewayOptions,
    protected readonly logger: AppLogger,
    protected readonly health: IntegrationHealthRecorder,
  ) {
    super();
  }

  /** One attempt against the provider. May throw; may return a normalised failure. */
  protected abstract request(input: SendOtpInput, signal: AbortSignal): Promise<SmsSendResult>;

  async sendOtp(input: SendOtpInput): Promise<SmsSendResult> {
    let attempt = 0;
    let last: SmsSendResult = {
      accepted: false,
      error: { code: 'UNKNOWN', retryable: false },
    };
    while (attempt <= this.options.maxRetries) {
      last = await this.attempt(input);
      if (last.accepted || !last.error.retryable) break;
      attempt += 1;
      if (attempt <= this.options.maxRetries) {
        await sleep((this.options.retryBaseDelayMs ?? 250) * 2 ** (attempt - 1));
      }
    }

    await this.health.record(this.name, last.accepted, last.accepted ? undefined : last.error.code);
    if (!last.accepted) {
      this.logger.warning('SMS not accepted', {
        gateway: this.name,
        phoneTail: input.phone.slice(-4),
        reference: input.reference ?? null,
        error: last.error.code,
        detail: last.error.detail ?? null,
        attempts: attempt + 1,
      });
    }
    return last;
  }

  private async attempt(input: SendOtpInput): Promise<SmsSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.request(input, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        return { accepted: false, error: { code: 'TIMEOUT', retryable: true } };
      }
      return {
        accepted: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          retryable: true,
          detail: error instanceof Error ? error.message.slice(0, 200) : String(error),
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Maps an HTTP status to the normalised error most providers mean by it. */
export function smsErrorFromStatus(status: number, detail?: string): SmsError {
  if (status === 401 || status === 403) return { code: 'AUTH_FAILED', retryable: false, detail };
  if (status === 402) return { code: 'INSUFFICIENT_FUNDS', retryable: false, detail };
  if (status === 429) return { code: 'RATE_LIMITED', retryable: true, detail };
  if (status >= 500) return { code: 'PROVIDER_UNAVAILABLE', retryable: true, detail };
  if (status >= 400) return { code: 'REJECTED', retryable: false, detail };
  return { code: 'UNKNOWN', retryable: false, detail };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
