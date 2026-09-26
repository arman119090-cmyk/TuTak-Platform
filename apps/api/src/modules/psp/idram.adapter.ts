import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { wireField as field, wireMoney as money } from './psp-wire';
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
    this.assertReady();
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
   * Fails closed on configuration, before any row exists.
   *
   * The form action is deliberately checked here and not defaulted in
   * configuration: the previous default was the production URL, which meant
   * a deployment that forgot the variable would silently send real customers
   * to real Idram. Sandbox and production are both explicit choices now, and
   * a deployment with the route enabled and no action set does not open
   * bills at all.
   */
  assertReady(): void {
    const missing: string[] = [];
    if (!this.merchantId) missing.push('IDRAM_MERCHANT_ID');
    if (!this.secret) missing.push('IDRAM_SECRET_KEY');
    if (!this.formAction) missing.push('IDRAM_FORM_ACTION');
    if (missing.length > 0) {
      throw new Error(
        `Idram is not configured: ${missing.join(', ')} not set. Refusing to open a bill ` +
          'the platform could not hand off or later verify a callback for.',
      );
    }
  }

  /**
   * Idram announces a pre-check with `EDP_PRECHECK=YES`.
   *
   * Read from the body rather than from a header or a separate URL because
   * that is what the documentation establishes. If Idram later confirms a
   * distinct endpoint, this is the one place that changes.
   */
  isPrecheck(body: unknown): boolean {
    return field(body, 'EDP_PRECHECK') === 'YES';
  }

  readPrecheck(body: unknown): PrecheckRequest {
    const merchantAccount = field(body, 'EDP_REC_ACCOUNT') || null;
    return {
      billId: field(body, 'EDP_BILL_NO') || null,
      merchantAccount,
      merchantMatches: merchantAccount !== null && merchantAccount === this.merchantId,
      amount: money(field(body, 'EDP_AMOUNT')),
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
    // Every field read through `field()`: a public endpoint receives whatever
    // is sent, and an array where a string was expected, or no body at all,
    // must be a rejected callback rather than a 500 — see the note on
    // `field` below.
    const payload = {
      EDP_REC_ACCOUNT: field(body, 'EDP_REC_ACCOUNT'),
      EDP_AMOUNT: field(body, 'EDP_AMOUNT'),
      EDP_BILL_NO: field(body, 'EDP_BILL_NO'),
      EDP_PAYER_ACCOUNT: field(body, 'EDP_PAYER_ACCOUNT'),
      EDP_TRANS_ID: field(body, 'EDP_TRANS_ID'),
      EDP_TRANS_DATE: field(body, 'EDP_TRANS_DATE'),
      EDP_CHECKSUM: field(body, 'EDP_CHECKSUM'),
    };

    if (!this.secret) {
      return { verified: false, reason: 'IDRAM_SECRET_KEY is not configured', raw: body };
    }

    // The pre-check ping asks "does this bill exist?" and is not a payment.
    if (this.isPrecheck(body)) {
      return { verified: false, reason: 'precheck', raw: body };
    }

    // Idram's documented fields are all required on a final callback. An
    // empty bill number or transaction id cannot be settled against anything,
    // and a digest computed over blanks is still a digest — so the presence
    // check comes before the checksum, not after.
    for (const [name, value] of Object.entries(payload)) {
      if (name !== 'EDP_PAYER_ACCOUNT' && value === '') {
        return { verified: false, reason: `${name} missing`, raw: body };
      }
    }

    /*
     * The documented composition, and the order matters:
     *
     *   EDP_REC_ACCOUNT : EDP_AMOUNT : SECRET_KEY : EDP_BILL_NO
     *     : EDP_PAYER_ACCOUNT : EDP_TRANS_ID : EDP_TRANS_DATE
     *
     * The secret goes *third*, not last. The first version of this put it
     * last, and every locally-minted test callback agreed — because the
     * tests were minted by this same function. The suite was green while
     * every genuine Idram callback would have been thrown away as a forgery,
     * which is the failure mode that looks like "the provider never calls
     * back" from the outside. `idram.contract.spec.ts` pins the order with a
     * digest computed outside this codebase.
     */
    const expected = createHash('md5')
      .update(
        [
          payload.EDP_REC_ACCOUNT ?? '',
          payload.EDP_AMOUNT ?? '',
          this.secret,
          payload.EDP_BILL_NO ?? '',
          payload.EDP_PAYER_ACCOUNT ?? '',
          payload.EDP_TRANS_ID ?? '',
          payload.EDP_TRANS_DATE ?? '',
        ].join(':'),
      )
      .digest('hex')
      .toUpperCase();

    const given = payload.EDP_CHECKSUM.toUpperCase();
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

    const amount = money(payload.EDP_AMOUNT);
    if (amount === null || amount.lessThanOrEqualTo(0)) {
      return { verified: false, reason: 'amount not usable', raw: body };
    }

    return {
      verified: true,
      billId: payload.EDP_BILL_NO,
      providerTransactionId: payload.EDP_TRANS_ID,
      amount,
      currency: 'AMD',
      // Idram is not documented as reporting its fee. Deliberately absent
      // rather than zero: "we do not know" and "there was none" are
      // different facts, and recording the second would understate cost.
      raw: body,
    };
  }
}

