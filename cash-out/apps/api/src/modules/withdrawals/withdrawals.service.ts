import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, Withdrawal } from '@prisma/client';
import { ConfirmWithdrawalDto, WithdrawalDto, toDriverStatus } from '@cashout/contracts';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { ENV, Env } from '../../config/env';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService, isUniqueViolation } from '../../prisma/prisma.service';
import { withSerializationRetry } from '../../prisma/retry';
import { AuditService } from '../audit/audit.service';
import { BalanceService } from '../drivers/balance.service';
import { LimitsService } from '../limits/limits.service';
import { MembershipService } from '../parks/membership.service';
import { PayoutMethodsService } from '../payout-methods/payout-methods.service';
import { SecurityService } from '../security/security.service';
import { QuoteService } from './quote.service';
import { WithdrawalOrchestrator } from './withdrawal.orchestrator';

@Injectable()
export class WithdrawalsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly quotes: QuoteService,
    private readonly balances: BalanceService,
    private readonly limits: LimitsService,
    private readonly payoutMethods: PayoutMethodsService,
    private readonly memberships: MembershipService,
    private readonly security: SecurityService,
    private readonly orchestrator: WithdrawalOrchestrator,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Turns a signed quote into a withdrawal.
   *
   * This is the single most dangerous call in the product, so it is also the
   * most defended. In order:
   *
   *  1. **Idempotency by construction.** The client's key is a column with a
   *     unique constraint on `(driverId, idempotencyKey)`. A retried request
   *     does not create a second row; it collides and returns the first one.
   *     The key is checked against a hash of the request, so the same key with
   *     different contents is rejected rather than silently answered with the
   *     wrong withdrawal.
   *  2. **One live withdrawal per driver.** Enforced here for a good error
   *     message, and enforced again by a partial unique index for the case where
   *     two requests arrive at once on two servers.
   *  3. **Serialisable, under an advisory lock on the driver.** The balance
   *     read, the limit check and the insert cannot interleave with another
   *     request for the same driver.
   *  4. **The quote is re-validated**, and the balance re-read fresh. A quote
   *     that was affordable two minutes ago may not be now.
   *
   * Nothing external is called from inside the transaction. The orchestrator is
   * kicked afterwards, so a slow Yandex cannot hold a database transaction open.
   */
  async confirm(driverId: string, dto: ConfirmWithdrawalDto): Promise<WithdrawalDto> {
    const requestHash = hashRequest(dto);

    const existing = await this.prisma.withdrawal.findUnique({
      where: { driverId_idempotencyKey: { driverId, idempotencyKey: dto.idempotencyKey } },
    });
    if (existing) {
      return this.assertSameRequest(existing, requestHash);
    }

    const withdrawal = await withSerializationRetry(
      () => this.createWithdrawal(driverId, dto, requestHash),
      { onRetry: (attempt) => this.logger.info('Retrying withdrawal creation', { attempt }) },
    );

    // Fire-and-forget: the driver gets an immediate answer and the processing
    // screen polls. A failure here only delays the work — the worker sweeps up
    // anything the kick misses.
    this.orchestrator.kick(withdrawal.id);

    return this.toDto(withdrawal);
  }

  private async createWithdrawal(
    driverId: string,
    dto: ConfirmWithdrawalDto,
    requestHash: string,
    origin: WithdrawalOrigin = { kind: 'DRIVER' },
  ): Promise<Withdrawal> {
    const quote = await this.quotes.validate(driverId, dto.quoteId, dto.signature);
    // Active park, membership, eligibility and driver status — all re-checked
    // now, not trusted from the quote or from the client.
    const { membership, park } = await this.memberships.requireActive(driverId);

    await this.payoutMethods.requireUsable(driverId, quote.payoutMethodId);

    const gross = Money.fromMinor(quote.grossMinor, quote.currency as CurrencyCode);
    const balance = await this.balances.requireFresh(driverId);

    if (balance.withdrawable.lessThan(gross)) {
      throw new AppError('BALANCE_CHANGED', 'The balance changed since this quote was issued', {
        withdrawable: balance.withdrawable.toJSON(),
        requested: gross.toJSON(),
      });
    }

    return this.prisma.inSerializableTransaction(async (tx) => {
      await this.prisma.lockForUpdate(tx, 'driver', driverId);

      // The PIN/biometric proof is spent here, inside the same transaction as
      // the row it authorises. No token, no withdrawal; no withdrawal, no
      // spent token.
      const authorization =
        origin.kind === 'DRIVER'
          ? await this.security.consume(tx, {
              driverId,
              token: dto.authorizationToken,
              quoteId: quote.id,
              purpose: 'WITHDRAWAL',
            })
          : null;

      const live = await tx.withdrawal.findFirst({
        where: {
          driverId,
          state: { notIn: ['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED'] },
        },
        select: { id: true, reference: true },
      });
      if (live) {
        throw new AppError(
          'WITHDRAWAL_ALREADY_IN_PROGRESS',
          'A payout is already in progress for this driver',
          { withdrawalId: live.id, reference: live.reference },
        );
      }

      const decision = await this.limits.check({ driverId, parkId: park.id, gross }, tx);
      if (decision.outcome === 'DENY') {
        throw new AppError(decision.code, decision.message, decision.details);
      }

      const consumed = await tx.quote.updateMany({
        where: { id: quote.id, consumedAt: null },
        data: { consumedAt: this.clock.now() },
      });
      if (consumed.count === 0) {
        throw new AppError('QUOTE_MISMATCH', 'This quote has already been used');
      }

      let created: Withdrawal;
      try {
        created = await tx.withdrawal.create({
          data: {
            reference: this.crypto.generateReference(),
            driverId,
            payoutMethodId: quote.payoutMethodId,
            quoteId: quote.id,
            state: 'CREATED',
            currency: quote.currency,
            grossMinor: quote.grossMinor,
            platformFeeMinor: quote.platformFeeMinor,
            providerFeeMinor: quote.providerFeeMinor,
            netMinor: quote.netMinor,
            parkId: park.id,
            yandexParkId: park.yandexParkId,
            yandexContractorProfileId: membership.externalProfileId,
            yandexBalanceBeforeMinor: balance.available.minor,
            // Generated once, reused by every retry of every step.
            yandexIdempotencyToken: randomUUID().replace(/-/g, ''),
            providerIdempotencyKey: randomUUID(),
            idempotencyKey: dto.idempotencyKey,
            requestHash,
            slaDeadline: this.clock.plusSeconds(this.env.WITHDRAWAL_SLA_SECONDS),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Either the same key raced with itself, or the one-live-withdrawal
          // index fired. Both mean: this driver already has this request.
          throw new AppError(
            'WITHDRAWAL_ALREADY_IN_PROGRESS',
            'A payout is already in progress for this driver',
          );
        }
        throw error;
      }

      await tx.quote.update({
        where: { id: quote.id },
        data: { consumedByWithdrawalId: created.id },
      });
      if (authorization) {
        await this.security.bindConsumed(tx, dto.authorizationToken, created.id);
      }

      await tx.withdrawalEvent.create({
        data: {
          withdrawalId: created.id,
          fromState: null,
          toState: 'CREATED',
          actorType: origin.kind === 'DRIVER' ? 'DRIVER' : 'SYSTEM',
          actorId: origin.kind === 'DRIVER' ? driverId : origin.ruleId,
          note:
            origin.kind === 'DRIVER'
              ? `confirmed quote ${quote.id} (${authorization?.method ?? 'PIN'})`
              : `automatic payout rule ${origin.ruleId}: quote ${quote.id}`,
        },
      });

      await this.audit.record(
        {
          action: 'withdrawal.created',
          subjectType: 'withdrawal',
          subjectId: created.id,
          actorType: 'DRIVER',
          actorId: driverId,
          after: {
            reference: created.reference,
            gross: created.grossMinor.toString(),
            net: created.netMinor.toString(),
            currency: created.currency,
            authorization: authorization?.method ?? 'AUTO_PAYOUT',
          },
        },
        tx,
      );

      if (decision.outcome === 'MANUAL_REVIEW') {
        await tx.withdrawal.update({
          where: { id: created.id },
          data: { manualReviewReason: decision.reason },
        });
      }

      return created;
    });
  }

  private async assertSameRequest(
    existing: Withdrawal,
    requestHash: string,
  ): Promise<WithdrawalDto> {
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
        'This idempotency key was already used for a different request',
      );
    }
    return this.toDto(existing);
  }

  async get(driverId: string, withdrawalId: string): Promise<WithdrawalDto> {
    const withdrawal = await this.prisma.withdrawal.findFirst({
      where: { id: withdrawalId, driverId },
    });
    if (!withdrawal) throw AppError.notFound('Withdrawal');
    return this.toDto(withdrawal);
  }

  async list(
    driverId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: WithdrawalDto[]; nextCursor: string | null }> {
    const rows = await this.prisma.withdrawal.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const page = rows.slice(0, limit);
    return {
      items: await Promise.all(page.map((row) => this.toDto(row))),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async timeline(driverId: string, withdrawalId: string) {
    const withdrawal = await this.prisma.withdrawal.findFirst({
      where: { id: withdrawalId, driverId },
      select: { id: true },
    });
    if (!withdrawal) throw AppError.notFound('Withdrawal');

    const events = await this.prisma.withdrawalEvent.findMany({
      where: { withdrawalId },
      orderBy: { at: 'asc' },
    });
    return events.map((event) => ({
      state: event.toState,
      at: event.at.toISOString(),
      note: event.note,
    }));
  }

  async toDto(withdrawal: Withdrawal, includeInternalState = false): Promise<WithdrawalDto> {
    const method = await this.prisma.payoutMethod.findUnique({
      where: { id: withdrawal.payoutMethodId },
      select: { id: true, maskedIdentifier: true, displayName: true },
    });
    const money = (minor: bigint) =>
      Money.fromMinor(minor, withdrawal.currency as CurrencyCode).toJSON();

    return {
      id: withdrawal.id,
      reference: withdrawal.reference,
      status: toDriverStatus(withdrawal.state),
      ...(includeInternalState ? { state: withdrawal.state } : {}),
      gross: money(withdrawal.grossMinor),
      platformFee: money(withdrawal.platformFeeMinor),
      providerFee: money(withdrawal.providerFeeMinor),
      totalFee: money(withdrawal.platformFeeMinor + withdrawal.providerFeeMinor),
      net: money(withdrawal.netMinor),
      payoutMethod: {
        id: method?.id ?? withdrawal.payoutMethodId,
        maskedIdentifier: method?.maskedIdentifier ?? '••••',
        displayName: method?.displayName ?? null,
      },
      createdAt: withdrawal.createdAt.toISOString(),
      updatedAt: withdrawal.updatedAt.toISOString(),
      completedAt: withdrawal.completedAt?.toISOString() ?? null,
      failureCode: withdrawal.failureCode,
      estimatedArrival: withdrawal.slaDeadline?.toISOString() ?? null,
    };
  }
}

/**
 * The bytes an idempotency key is bound to. If a client reuses a key with a
 * different quote, that is a bug on their side and a hard error on ours — not
 * something to paper over by returning an unrelated withdrawal.
 */
function hashRequest(dto: ConfirmWithdrawalDto): string {
  return createHash('sha256').update(`${dto.quoteId}|${dto.signature}`).digest('base64url');
}

/**
 * Who is confirming. A driver confirms with a spent PIN/biometric
 * authorization; an automatic payout rule confirms on the strength of the
 * authorization the driver gave when enabling it, and names the rule.
 */
export type WithdrawalOrigin = { kind: 'DRIVER' } | { kind: 'AUTO_PAYOUT'; ruleId: string };

export type { Prisma };
