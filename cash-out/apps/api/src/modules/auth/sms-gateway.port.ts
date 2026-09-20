import { Injectable } from '@nestjs/common';
import { AppLogger } from '../../common/logging/logger.service';

export interface SendOtpInput {
  readonly phone: string;
  readonly code: string;
  readonly locale: string;
  /** Our own id for the challenge, for the provider's logs and ours. */
  readonly reference?: string;
}

/**
 * Every provider's answer, reduced to what the OTP flow can act on. A
 * provider-specific code goes in `detail`; the flow only reads `code` and
 * `retryable`.
 */
export type SmsErrorCode =
  | 'INVALID_NUMBER'
  | 'NUMBER_BLOCKED'
  | 'RATE_LIMITED'
  | 'INSUFFICIENT_FUNDS'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'AUTH_FAILED'
  | 'REJECTED'
  | 'UNKNOWN';

export interface SmsError {
  readonly code: SmsErrorCode;
  readonly retryable: boolean;
  readonly detail?: string;
}

export type SmsSendResult =
  | { readonly accepted: true; readonly providerMessageId: string | null }
  | { readonly accepted: false; readonly error: SmsError };

/**
 * The SMS gateway as the sign-in flow needs it. `sendOtp` never throws into
 * the request path: an outage is a result, so the challenge is still created
 * and marked undelivered, and support can see why nobody got a code.
 */
export abstract class SmsGatewayPort {
  abstract readonly name: string;
  abstract readonly mode: 'mock' | 'live';
  abstract sendOtp(input: SendOtpInput): Promise<SmsSendResult>;
  abstract ping(): Promise<boolean>;
}

/**
 * The development gateway. It does not send anything.
 *
 * It logs the code at debug level so a developer can sign in locally, and it is
 * wired only under SMS_MODE=mock, which production refuses: a production
 * deployment without an SMS provider is a deployment where nobody can sign in —
 * the correct, visible failure, rather than one that silently accepts any code.
 */
@Injectable()
export class ConsoleSmsGateway extends SmsGatewayPort {
  readonly name = 'sms-console';
  readonly mode = 'mock' as const;

  constructor(private readonly logger: AppLogger) {
    super();
  }

  /** Test hook: the last code per phone, so specs need not scrape logs. */
  readonly lastCodes = new Map<string, string>();
  /** Test hook: make the next sends fail as a provider outage would. */
  behaviour: 'deliver' | 'fail' = 'deliver';

  async sendOtp(input: SendOtpInput): Promise<SmsSendResult> {
    if (this.behaviour === 'fail') {
      return { accepted: false, error: { code: 'PROVIDER_UNAVAILABLE', retryable: true } };
    }
    this.lastCodes.set(input.phone, input.code);
    this.logger.debug(`[dev-sms] ${input.phone} -> ${input.code}`, 'ConsoleSmsGateway');
    return { accepted: true, providerMessageId: null };
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
