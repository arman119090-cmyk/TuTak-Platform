import { Body, Controller, Headers, HttpCode, Post, Res } from '@nestjs/common';
import { PspCallbackKind } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PspCallbackInboxService } from './psp-callback-inbox.service';
import { PspPaymentService } from './psp-payment.service';
import { Inject } from '@nestjs/common';
import { PSP_ADAPTER, PspAdapter } from './psp-adapter.interface';

/**
 * Where the payment provider talks to us.
 *
 * ## Public by necessity, trusted by nothing
 *
 * These routes cannot carry a session: the caller is Idram's server, not a
 * person. So they are `@Public()` in the sense that no JWT is required, and
 * emphatically not public in the sense of trusted — every request is an
 * anonymous HTTP POST claiming somebody paid until its checksum says
 * otherwise. Verification happens in the adapter, before anything is
 * written, and an unverified callback is recorded as rejected rather than
 * acted on or discarded.
 *
 * ## Why the handler is this short
 *
 * Because the provider is waiting. The rule the whole design turns on is
 * that the synchronous path does the minimum that must be synchronous —
 * prove it genuine, write it down — and answers. Settling inside the request
 * is what exhausted the connection pool under a burst of retries and failed
 * every one of them, and a provider that sees failures retries harder.
 */
@Controller('psp/idram')
export class PspCallbackController {
  constructor(
    private readonly inbox: PspCallbackInboxService,
    private readonly payments: PspPaymentService,
    @Inject(PSP_ADAPTER) private readonly adapter: PspAdapter,
  ) {}

  /**
   * The provider's pre-check, and the final callback, on one route.
   *
   * One route because Idram distinguishes them by a field in the body rather
   * than by URL. Splitting them here would mean guessing at a routing scheme
   * the documentation does not establish.
   */
  @Public()
  @Post('callback')
  @HttpCode(200)
  async callback(
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    if (this.adapter.isPrecheck(body)) {
      const verdict = await this.payments.answerPrecheck(body);

      // Recorded for the audit trail, and recorded as PROCESSED because a
      // pre-check's entire effect is the answer we just gave. It can never
      // become work for the settlement worker.
      const request = this.adapter.readPrecheck(body);
      await this.inbox.record({
        provider: this.adapter.name,
        kind: PspCallbackKind.PRECHECK,
        billId: request.billId,
        providerTransactionId: null,
        reportedAmount: request.amount,
        verified: verdict.ok,
        rejectedReason: verdict.reason,
        raw: body,
      });

      const reply = this.adapter.precheckResponse({ ok: verdict.ok });
      res.type(reply.contentType).send(reply.body);
      return;
    }

    const confirmation = await this.adapter.verifyCallback(headers, body);

    await this.inbox.record({
      provider: this.adapter.name,
      kind: PspCallbackKind.FINAL,
      billId: confirmation.verified ? confirmation.billId : readBillId(body),
      providerTransactionId: confirmation.verified ? confirmation.providerTransactionId : null,
      reportedAmount: confirmation.verified ? confirmation.amount : readAmount(body),
      verified: confirmation.verified,
      rejectedReason: confirmation.verified ? undefined : confirmation.reason,
      raw: body,
    });

    /*
     * Answered the same way whether or not verification passed.
     *
     * A verifier that says "checksum mismatch" to an unauthenticated caller
     * tells an attacker which of their guesses was closer. The row records
     * the real reason; the wire does not.
     *
     * Acknowledging an unverified callback is deliberate too: Idram retrying
     * a forged request would achieve nothing except load.
     */
    const reply = this.adapter.finalResponse();
    res.type(reply.contentType).send(reply.body);
  }
}

/** Best-effort read of the bill from an unverified body, for the record. */
function readBillId(body: unknown): string | null {
  const payload = (body ?? {}) as Record<string, string>;
  return payload.EDP_BILL_NO ?? null;
}

function readAmount(body: unknown): Decimal | null {
  const payload = (body ?? {}) as Record<string, string>;
  if (payload.EDP_AMOUNT === undefined) return null;
  const amount = new Decimal(payload.EDP_AMOUNT);
  return amount.isFinite() ? amount : null;
}
