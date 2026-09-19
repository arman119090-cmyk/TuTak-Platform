import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { canTransition } from '@cashout/contracts';
import { AppError } from '../../common/app-error';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService, isUniqueViolation } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  PaymentProviderPort,
  ProviderWebhookEvent,
} from '../payment-provider/payment-provider.port';
import { WithdrawalStateService } from './withdrawal-state.service';
import { WithdrawalOrchestrator } from './withdrawal.orchestrator';

export type WebhookResult =
  | { readonly status: 'processed'; readonly withdrawalId: string }
  | { readonly status: 'duplicate' }
  | { readonly status: 'ignored'; readonly reason: string };

/**
 * Inbound provider webhooks.
 *
 * Four things have to be true before an event is allowed to change anything:
 *
 *  1. **The signature verifies** over the raw body — which is why the route is
 *     mounted with a raw-body parser; re-serialising JSON changes the bytes and
 *     breaks the HMAC.
 *  2. **The timestamp is fresh.** A replayed delivery carries a perfectly valid
 *     signature, so the freshness window is the only thing standing between an
 *     attacker with an old capture and a repeated state change.
 *  3. **The delivery is new.** `(provider, externalId)` is unique, so the
 *     second copy of a redelivered event is recorded and discarded.
 *  4. **The transition is legal.** A `payout.confirmed` for a withdrawal that
 *     is already reversed does not resurrect it; it is logged and ignored.
 */
@Injectable()
export class ProviderWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProviderPort,
    private readonly states: WithdrawalStateService,
    private readonly orchestrator: WithdrawalOrchestrator,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {}

  async handle(raw: string, headers: Record<string, string | undefined>): Promise<WebhookResult> {
    const parsed = this.provider.parseWebhook(raw, headers);
    if (!parsed.ok) {
      this.logger.warning('Rejected a provider webhook', { reason: parsed.reason });
      // Deliberately a 403 and not a 400: a bad signature is not the provider
      // telling us something malformed, it is someone we cannot identify.
      throw new AppError('FORBIDDEN', `Webhook rejected: ${parsed.reason}`);
    }

    const event = parsed.event;
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { reference: event.reference },
    });

    try {
      await this.prisma.providerEvent.create({
        data: {
          provider: this.provider.name,
          externalId: event.externalId,
          type: event.type,
          withdrawalId: withdrawal?.id ?? null,
          signatureOk: true,
          payloadHash: hashOf(raw),
          payload: event.raw as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.info('Duplicate provider webhook ignored', { externalId: event.externalId });
        return { status: 'duplicate' };
      }
      throw error;
    }

    if (!withdrawal) {
      this.logger.warning('Provider webhook for an unknown reference', {
        reference: event.reference,
      });
      return { status: 'ignored', reason: 'unknown_reference' };
    }

    const result = await this.apply(withdrawal.id, event);

    await this.prisma.providerEvent.updateMany({
      where: { provider: this.provider.name, externalId: event.externalId },
      data: { processedAt: new Date() },
    });

    if (result.status === 'processed') {
      this.orchestrator.kick(withdrawal.id);
    }

    return result;
  }

  private async apply(withdrawalId: string, event: ProviderWebhookEvent): Promise<WebhookResult> {
    return this.prisma.inTransaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });

      // The provider's id must match the one we already have, if we have one.
      // A mismatch means this event is about a different transfer.
      if (
        withdrawal.providerTransactionId &&
        withdrawal.providerTransactionId !== event.providerTransactionId
      ) {
        this.logger.warning('Provider webhook transaction id mismatch', {
          withdrawalId,
          expected: withdrawal.providerTransactionId,
          received: event.providerTransactionId,
        });
        return { status: 'ignored', reason: 'transaction_id_mismatch' } as const;
      }

      const target = TARGET_STATE[event.type];
      if (!canTransition(withdrawal.state, target)) {
        this.logger.info('Provider webhook does not apply in the current state', {
          withdrawalId,
          state: withdrawal.state,
          event: event.type,
        });
        return { status: 'ignored', reason: `not_applicable_in_${withdrawal.state}` } as const;
      }

      await this.states.transition(tx, withdrawal, target, {
        note: `provider webhook ${event.type}`,
        actorType: 'PROVIDER',
        metadata: { externalId: event.externalId },
        data: {
          providerTransactionId: event.providerTransactionId,
          providerStatusRaw: event.type,
          failureCode: event.failureCode ?? withdrawal.failureCode,
          failureMessage: event.failureMessage ?? withdrawal.failureMessage,
          nextAttemptAt: null,
          attempts: 0,
        },
      });

      await this.audit.record(
        {
          action: `withdrawal.${event.type}`,
          subjectType: 'withdrawal',
          subjectId: withdrawalId,
          actorType: 'PROVIDER',
          after: { providerTransactionId: event.providerTransactionId },
        },
        tx,
      );

      return { status: 'processed', withdrawalId } as const;
    });
  }
}

const TARGET_STATE = {
  'payout.submitted': 'PAYOUT_SUBMITTED',
  'payout.confirmed': 'PAYOUT_CONFIRMED',
  'payout.failed': 'PAYOUT_FAILED',
  'payout.returned': 'PAYOUT_RETURNED',
} as const;

function hashOf(raw: string): string {
  return createHash('sha256').update(raw).digest('base64url');
}
