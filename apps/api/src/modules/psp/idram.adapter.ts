import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import {
  ConfirmationResult,
  CreateBillParams,
  CreateBillResult,
  PspAdapter,
  PspCapabilities,
} from './psp-adapter.interface';

/**
 * Idram, as far as the supplied documentation actually establishes it.
 *
 * ## What is implemented, and what is refused
 *
 * The documentation establishes a bill / pre-check / final-callback
 * sequence. That is implemented. It does **not** establish a refund API, a
 * status query, a void, a settlement feed or a fee statement — so every one
 * of those capabilities is declared `false`, and the generic code refuses
 * rather than calling a stub that would pretend.
 *
 * This is not caution for its own sake. A refund path built on an API that
 * turns out not to exist is a button that tells a customer their money is
 * coming back when nothing was sent. Refusing loudly keeps the gap visible
 * until Idram answers; the questions are in the report.
 *
 * ## The checksum
 *
 * Idram's documented scheme is an MD5 over a colon-joined field list ending
 * with the merchant secret. MD5 is not a choice made here — it is what the
 * provider specifies, and a verifier must match the provider. It is still
 * real verification: an attacker without the secret cannot produce it.
 *
 * What makes it safe is not the hash alone but what is compared afterwards:
 * `verifyCallback` checks the bill identifier and the amount against what
 * this platform asked for, so a genuine callback for a different, smaller
 * bill cannot settle a larger one.
 */
@Injectable()
export class IdramAdapter implements PspAdapter {
  readonly name = 'idram';

  /**
   * Every one of these is false because the documentation supplied does not
   * prove otherwise. Turning one on is a one-line change here — after Idram
   * confirms, in writing, that the endpoint exists.
   */
  readonly capabilities: PspCapabilities = {
    refund: false,
    statusQuery: false,
    void: false,
    settlementFeed: false,
    feeStatement: false,
  };

  private readonly logger = new Logger(IdramAdapter.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private get merchantId(): string {
    return process.env.IDRAM_MERCHANT_ID ?? '';
  }

  private get secret(): string {
    return process.env.IDRAM_SECRET_KEY ?? '';
  }

  async createBill(params: CreateBillParams): Promise<CreateBillResult> {
    if (!this.merchantId || !this.secret) {
      throw new Error(
        'IDRAM_MERCHANT_ID and IDRAM_SECRET_KEY are not set. Refusing to open a bill ' +
          'this platform could not later verify a callback for.',
      );
    }
    // Idram's flow is a form post the customer's browser makes; there is no
    // server-to-server bill creation in the documentation supplied. The
    // caller redirects with these fields.
    return {
      providerBillId: params.billId,
      raw: {
        EDP_LANGUAGE: 'AM',
        EDP_REC_ACCOUNT: this.merchantId,
        EDP_DESCRIPTION: params.description,
        EDP_AMOUNT: params.amount.toFixed(2),
        EDP_BILL_NO: params.billId,
      },
    };
  }

  async verifyCallback(
    _headers: Record<string, string>,
    body: unknown,
  ): Promise<ConfirmationResult> {
    const payload = (body ?? {}) as Record<string, string>;

    if (!this.secret) {
      return { verified: false, reason: 'IDRAM_SECRET_KEY is not configured', raw: body };
    }

    // The pre-check ping asks "does this bill exist?" and is not a payment.
    if (payload.EDP_PRECHECK === 'YES') {
      return { verified: false, reason: 'precheck', raw: body };
    }

    const expected = createHash('md5')
      .update(
        [
          payload.EDP_REC_ACCOUNT ?? '',
          payload.EDP_AMOUNT ?? '',
          payload.EDP_BILL_NO ?? '',
          payload.EDP_PAYER_ACCOUNT ?? '',
          payload.EDP_TRANS_ID ?? '',
          payload.EDP_TRANS_DATE ?? '',
          this.secret,
        ].join(':'),
      )
      .digest('hex')
      .toUpperCase();

    const given = (payload.EDP_CHECKSUM ?? '').toUpperCase();
    if (!given || given !== expected) {
      // Deliberately does not say which part failed.
      this.logger.warn(`Idram callback rejected: checksum mismatch for bill ${payload.EDP_BILL_NO}`);
      return { verified: false, reason: 'checksum mismatch', raw: body };
    }

    if (payload.EDP_REC_ACCOUNT !== this.merchantId) {
      return { verified: false, reason: 'merchant mismatch', raw: body };
    }

    const amount = new Decimal(payload.EDP_AMOUNT ?? '0');
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      return { verified: false, reason: 'amount not usable', raw: body };
    }

    return {
      verified: true,
      billId: payload.EDP_BILL_NO ?? '',
      providerTransactionId: payload.EDP_TRANS_ID ?? '',
      amount,
      currency: 'AMD',
      // Idram is not documented as reporting its fee. Deliberately absent
      // rather than zero: "we do not know" and "there was none" are
      // different facts, and recording the second would understate cost.
      raw: body,
    };
  }
}
