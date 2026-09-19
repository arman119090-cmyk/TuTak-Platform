import { Injectable } from '@nestjs/common';
import { AppLogger } from '../../common/logging/logger.service';

export interface SendOtpInput {
  readonly phone: string;
  readonly code: string;
  readonly locale: string;
}

export abstract class SmsGatewayPort {
  /** Returns false when the gateway refused; never throws into the request path. */
  abstract sendOtp(input: SendOtpInput): Promise<boolean>;
}

/**
 * The development gateway. It does not send anything.
 *
 * It logs the code at debug level so a developer can sign in locally, and it is
 * wired only when no real gateway is configured. A production deployment
 * without an SMS provider is a deployment where nobody can sign in — which is
 * the correct, visible failure, rather than one that silently accepts any code.
 */
@Injectable()
export class ConsoleSmsGateway extends SmsGatewayPort {
  constructor(private readonly logger: AppLogger) {
    super();
  }

  /** Test hook: the last code per phone, so specs need not scrape logs. */
  readonly lastCodes = new Map<string, string>();

  async sendOtp(input: SendOtpInput): Promise<boolean> {
    this.lastCodes.set(input.phone, input.code);
    this.logger.debug(`[dev-sms] ${input.phone} -> ${input.code}`, 'ConsoleSmsGateway');
    return true;
  }
}
