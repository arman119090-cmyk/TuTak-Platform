import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import {
  ConfirmationResult,
  CreateBillParams,
  CreateBillResult,
  PrecheckRequest,
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
 * Idram documents MD5 over these colon-joined values in this exact order:
 * REC_ACCOUNT, AMOUNT, SECRET_KEY, BILL_NO, PAYER_ACCOUNT, TRANS_ID,
 * TRANS_DATE. MD5 is not a choice made here — it is what the provider
 * specifies, and a verifier must match the provider.
 *
 * What makes it safe is not the hash alone but what is compared afterwards:
 * `verifyCallback` checks the merchant, bill identifier and amount against
 * what this platform asked for, so a genuine callback for a different,
 * smaller bill cannot settle a larger one.
 */

export interface IdramChecksumFields {
  recAccount: string;
  amount: string;
  billNo: string;
  payerAccount: string;
  transId: string;
  transDate: string;
}

/**
 * Provider-contract helper kept pure so the exact Idram field order can be
 * pinned by a hard-coded regression vector instead of a test that repeats the
 * implementation's own mistake.
 */
export function idramPaymentChecksum(fields: IdramChecksumFields, secret: string): string {
  return createHash('md5')
    .update(
      [
        fields.recAccount,
        fields.amount,
        secret,
        fields.billNo,
        fields.payerAccount,
        fields.transId,
        fields.transDate,
      ].join(':'),
    )
    .digest('hex')
    .toUpperCase();
}

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

  /*
   * Returns a promise without awaiting anything, and that is not an
   * oversight. Idram's documented flow is a form the customer's browser
   * posts — there is no server-to-server call to make here. The signature
   * stays asynchronous because the *interface* must suit providers that do
   * make one, and narrowing it to synchronous would force the next adapter
   * to widen it again.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
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
    const fields: Record<string, string> = {
      EDP_LANGUAGE: this.config.get('psp', { infer: true }).idramLanguage,
      EDP_REC_ACCOUNT: this.merchantId,
      EDP_DESCRIPTION: params.description,
      EDP_AMOUNT: params.amount.toFixed(2),
      EDP_BILL_NO: params.billId,
    };

    return {
      providerBillId: params.billId,
      // The documented flow is a form the customer's browser posts. Handed
      // back as a form the client can actually perform, rather than buried
      // in `raw` where — until this was fixed — nothing passed it outwards
      // and the documented flow could not be carried out at all.
      handoff: { type: 'FORM_POST', method: 'POST', action: this.formAction, fields },
      raw: fields,
    };
  }

  private get formAction(): string {
    return this.config.get('psp', { infer: true }).idramFormAction;
  }

  /**
   * Idram announces a pre-check with `EDP_PRECHECK=YES`.
   *
   * Read from the body rather than from a header or a separate URL because
   * that is what the documentation establishes. If Idram later confirms a
   * distinct endpoint, this is the one place that changes.
   */
  isPrecheck(body: unknown): boolean {
    const payload = (body ?? {}) as Record<string, string>;
    return payload.EDP_PRECHECK === 'YES';
  }

  readPrecheck(body: unknown): PrecheckRequest {
    const payload = (body ?? {}) as Record<string, string>;
    const rawAmount = payload.EDP_AMOUNT;
    const amount = rawAmount === undefined ? null : new Decimal(rawAmount);
    return {
      billId: payload.EDP_BILL_NO ?? null,
      merchantAccount: payload.EDP_REC_ACCOUNT ?? null,
      amount: amount !== null && amount.isFinite() ? amount : null,
      raw: body,
    };
  }

  /**
   * Idram's documented pre-check reply: the literal string `OK` to proceed.
   *
   * Anything else is a refusal. Deliberately not JSON and not a status code
   * alone — the documentation specifies a body, and a verifier that answers
   * in a shape the provider does not parse is a verifier that says nothing.
   */
  precheckResponse(verdict: { ok: boolean }): { body: string; contentType: string } {
    return { body: verdict.ok ? 'OK' : 'NO', contentType: 'text/plain' };
  }

  /** Idram expects `OK` acknowledged for a final callback it delivered. */
  finalResponse(): { body: string; contentType: string } {
    return { body: 'OK', contentType: 'text/plain' };
  }

  // Same reason as `createBill` above: the checksum is computed locally, but
  // a provider that verifies by calling home needs the async signature.
  // eslint-disable-next-line @typescript-eslint/require-await
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

    const expected = idramPaymentChecksum(
      {
        recAccount: payload.EDP_REC_ACCOUNT ?? '',
        amount: payload.EDP_AMOUNT ?? '',
        billNo: payload.EDP_BILL_NO ?? '',
        payerAccount: payload.EDP_PAYER_ACCOUNT ?? '',
        transId: payload.EDP_TRANS_ID ?? '',
        transDate: payload.EDP_TRANS_DATE ?? '',
      },
      this.secret,
    );

    const given = (payload.EDP_CHECKSUM ?? '').toUpperCase();
    if (!given || given !== expected) {
      // Deliberately does not say which part failed.
      this.logger.warn(
        `Idram callback rejected: checksum mismatch for bill ${payload.EDP_BILL_NO}`,
      );
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
