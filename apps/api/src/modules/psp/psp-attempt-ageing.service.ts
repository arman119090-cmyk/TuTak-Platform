import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PspAttemptStatus } from '@prisma/client';
import { ALERT_CHANNEL, AlertChannel } from '../../infrastructure/alerts/alert-channel.interface';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PSP_ADAPTER, PspAdapter } from './psp-adapter.interface';

/**
 * Ageing, and the one thing it is not allowed to do.
 *
 * Arman's decision of 15.09.2026: **time creates alerts and escalation, and
 * never a resolution.** An attempt nobody has answered for an hour is exactly
 * as unsafe as one nobody has answered for a minute — the provider may hold
 * the customer's money in both cases, and the only difference is how long
 * somebody has failed to look.
 *
 * So this sweep does two things and refuses a third:
 *
 *  1. moves a stale live attempt to `EXPIRED`. That is not a resolution:
 *     `EXPIRED` is in `MONEY_MAY_HAVE_MOVED`, so the purchase stays blocked
 *     for another route and a new attempt is still refused. What it changes
 *     is that the bill is no longer presented as payable.
 *  2. escalates anything unresolved, repeatedly, so it gets louder.
 *  3. **never** writes `FAILED`. The database refuses it too — see
 *     `psp_attempt_timeout_never_resolves` — because a rule this expensive to
 *     get wrong should not depend on nobody adding a fourth step here.
 */
@Injectable()
export class PspAttemptAgeingService {
  private readonly logger = new Logger(PspAttemptAgeingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ALERT_CHANNEL) private readonly alerts: AlertChannel,
    @Inject(PSP_ADAPTER) private readonly adapter: PspAdapter,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * The thresholds for one provider.
   *
   * Per provider because thirty minutes was a number I picked, not a fact
   * about payments: a provider whose customers finish inside an app and one
   * that settles in overnight batches deserve different answers, and Arman's
   * decision of 15.09.2026 is that this is configuration. Neither number ever
   * resolves anything — see the class docblock.
   */
  private policyFor(provider: string): { staleAfterMs: number; escalateEveryMs: number } {
    const psp = this.config.get('psp', { infer: true });
    const override = psp.perProvider[provider] ?? {};
    return {
      staleAfterMs: override.staleAfterMs ?? psp.defaultStaleAfterMs,
      escalateEveryMs: override.escalateEveryMs ?? psp.defaultEscalateEveryMs,
    };
  }

  /**
   * Runs regardless of `TUTAK_PSP_ENABLED`, for the same reason the callback
   * worker does: this sweep does not start payments, it raises the alarm on
   * ones that started and went quiet. An attempt left unresolved by an
   * emergency switch-off is precisely the attempt a human most needs to be
   * told about, and a gate here would have silenced exactly that.
   */
  async escalateStaleAttempts(): Promise<{ expired: number; escalated: number }> {

    const now = Date.now();
    // The adapter's own name is the key, so a second provider is a second
    // entry in the config rather than a branch in here.
    const providerName = this.adapter.name;
    const { staleAfterMs, escalateEveryMs } = this.policyFor(providerName);

    /*
     * Step 1. A live bill nobody came back to.
     *
     * `liveKey` is cleared in the same write, which is what stops the
     * purchase offering a "pay now" button for a bill the provider has almost
     * certainly abandoned. `resolutionBasis` is deliberately left null: this
     * is not the provider telling us anything, and the column would be a lie.
     */
    const stale = await this.prisma.pspPaymentAttempt.findMany({
      where: {
        status: { in: [PspAttemptStatus.INITIATED, PspAttemptStatus.PENDING_CONFIRMATION] },
        createdAt: { lt: new Date(now - staleAfterMs) },
      },
      select: { id: true, purchaseIntentId: true, amount: true, providerBillId: true },
    });

    let expired = 0;
    for (const attempt of stale) {
      // Conditional on it still being live: a callback may have landed
      // between the read above and this write, and a callback beats a clock.
      const claimed = await this.prisma.pspPaymentAttempt.updateMany({
        where: {
          id: attempt.id,
          status: { in: [PspAttemptStatus.INITIATED, PspAttemptStatus.PENDING_CONFIRMATION] },
        },
        data: { status: PspAttemptStatus.EXPIRED, liveKey: null, resolvedAt: new Date() },
      });
      if (claimed.count === 0) continue;
      expired += 1;
      this.logger.warn(
        `PSP attempt ${attempt.id} (bill ${attempt.providerBillId ?? '—'}) timed out. ` +
          'This is NOT a failure: the provider may hold the money, and the purchase ' +
          'stays blocked until the provider answers or two people reconcile it.',
      );
    }

    /*
     * Step 2. Everything still unresolved gets louder.
     *
     * `SUCCEEDED` is excluded — it is resolved, and the money is accounted
     * for. `FAILED` is excluded for the same reason. What is left is the set
     * where a customer may be out of pocket with nothing to show for it.
     */
    const unresolved = await this.prisma.pspPaymentAttempt.findMany({
      where: {
        status: {
          in: [
            PspAttemptStatus.INITIATED,
            PspAttemptStatus.PENDING_CONFIRMATION,
            PspAttemptStatus.EXPIRED,
            PspAttemptStatus.REQUIRES_RECONCILIATION,
          ],
        },
        createdAt: { lt: new Date(now - staleAfterMs) },
        OR: [{ escalatedAt: null }, { escalatedAt: { lt: new Date(now - escalateEveryMs) } }],
      },
      select: {
        id: true,
        purchaseIntentId: true,
        status: true,
        amount: true,
        currency: true,
        provider: true,
        providerBillId: true,
        createdAt: true,
        escalationCount: true,
      },
    });

    for (const attempt of unresolved) {
      const ageHours = Math.floor((now - attempt.createdAt.getTime()) / 3_600_000);
      await this.alerts.send({
        // Escalating: the first hour is a warning, a payment nobody has
        // accounted for by the next day is not.
        severity: attempt.escalationCount >= 4 ? 'critical' : 'warning',
        title: 'Payment attempt unresolved',
        body:
          `A ${attempt.provider} payment of ${attempt.amount.toFixed(2)} ${attempt.currency} ` +
          `has been ${attempt.status} for ${ageHours}h. The provider may be holding the ` +
          'customer’s money. This will not resolve itself and must not be marked failed ' +
          'on age alone — get an authoritative answer from the provider, or reconcile it ' +
          'with two people and the provider’s statement.',
        key: 'psp.attempt-unresolved',
        context: {
          attemptId: attempt.id,
          purchaseIntentId: attempt.purchaseIntentId,
          status: attempt.status,
          providerBillId: attempt.providerBillId ?? '—',
          ageHours,
          escalations: attempt.escalationCount + 1,
        },
      });

      // Status is deliberately untouched here, and the trigger enforces that
      // the two can never move in one write.
      await this.prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: { escalatedAt: new Date(), escalationCount: { increment: 1 } },
      });
    }

    if (expired > 0 || unresolved.length > 0) {
      this.logger.warn(
        `PSP ageing sweep: ${expired} timed out, ${unresolved.length} escalated. None failed — ` +
          'time never resolves an attempt.',
      );
    }
    return { expired, escalated: unresolved.length };
  }
}
