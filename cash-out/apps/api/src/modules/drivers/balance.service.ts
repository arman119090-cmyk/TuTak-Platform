import { Injectable } from '@nestjs/common';
import type { Park } from '@prisma/client';
import { BalanceDto } from '@cashout/contracts';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { PrismaService, TransactionClient } from '../../prisma/prisma.service';
import { Clock } from '../../common/clock';
import { AppLogger } from '../../common/logging/logger.service';
import { AppError } from '../../common/app-error';
import { ActiveContext, MembershipService, toParkSummary } from '../parks/membership.service';
import { YandexFleetPort } from '../yandex/yandex.port';

export interface DriverBalance {
  readonly available: Money;
  readonly reserved: Money;
  readonly withdrawable: Money;
  readonly park: Park;
  readonly asOf: Date;
  readonly fresh: boolean;
  readonly staleSeconds?: number;
}

/** How long a cached balance may be shown on the home screen. */
const DISPLAY_CACHE_SECONDS = 20;
/** How old a cached balance may be before it is refused even for display. */
const MAX_STALE_FOR_DISPLAY_SECONDS = 15 * 60;

/**
 * The driver's balance, always for the active park.
 *
 * Yandex is the source of truth. The mobile app's copy is for display; the
 * server's cache is for display; neither is ever the basis of a payout — that
 * is `requireFresh`, which reads Yandex or refuses.
 *
 * Every snapshot carries the park it was read for, and switching parks deletes
 * them anyway: a figure from one park is never shown under another.
 */
@Injectable()
export class BalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly yandex: YandexFleetPort,
    private readonly memberships: MembershipService,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {}

  async forDisplay(driverId: string): Promise<DriverBalance> {
    const context = await this.memberships.requireActive(driverId);
    const currency = context.park.currency as CurrencyCode;

    const cached = await this.prisma.balanceSnapshot.findFirst({
      where: { driverId, parkId: context.park.id },
      orderBy: { fetchedAt: 'desc' },
    });

    const cacheAgeSeconds = cached
      ? (this.clock.nowMs() - cached.fetchedAt.getTime()) / 1000
      : Number.POSITIVE_INFINITY;

    if (cached && cacheAgeSeconds < DISPLAY_CACHE_SECONDS) {
      return this.withReserved(
        context,
        Money.fromMinor(cached.balanceMinor, cached.currency as CurrencyCode),
        cached.fetchedAt,
        true,
      );
    }

    try {
      const fresh = await this.fetchAndStore(context);
      return this.withReserved(context, fresh.amount, fresh.fetchedAt, true);
    } catch (error) {
      this.logger.fail('Falling back to cached balance', error, { driverId });
      if (!cached || cacheAgeSeconds > MAX_STALE_FOR_DISPLAY_SECONDS) {
        throw new AppError('BALANCE_UNAVAILABLE', 'Could not read the balance from the fleet');
      }
      return this.withReserved(
        context,
        Money.fromMinor(cached.balanceMinor, currency),
        cached.fetchedAt,
        false,
        Math.round(cacheAgeSeconds),
      );
    }
  }

  /**
   * The balance a payout may be based on. No cache, no fallback: if Yandex
   * cannot tell us the balance right now, we do not debit it.
   */
  async requireFresh(driverId: string): Promise<DriverBalance> {
    const context = await this.memberships.requireActive(driverId);
    try {
      const fresh = await this.fetchAndStore(context);
      return this.withReserved(context, fresh.amount, fresh.fetchedAt, true);
    } catch (error) {
      this.logger.fail('Fresh balance required but unavailable', error, { driverId });
      throw new AppError('YANDEX_UNAVAILABLE', 'The fleet system is not responding');
    }
  }

  /** Drops every cached figure for the driver, whatever park it was for. */
  async invalidate(driverId: string, tx?: TransactionClient): Promise<void> {
    await (tx ?? this.prisma).balanceSnapshot.deleteMany({ where: { driverId } });
  }

  toDto(balance: DriverBalance): BalanceDto {
    return {
      available: balance.available.toJSON(),
      reservedByPendingWithdrawals: balance.reserved.toJSON(),
      withdrawable: balance.withdrawable.toJSON(),
      park: toParkSummary(balance.park),
      asOf: balance.asOf.toISOString(),
      fresh: balance.fresh,
      staleSeconds: balance.staleSeconds,
    };
  }

  private async fetchAndStore(context: ActiveContext) {
    const balance = await this.yandex.getBalance(
      context.park.yandexParkId,
      context.membership.externalProfileId,
    );
    await this.prisma.balanceSnapshot.create({
      data: {
        driverId: context.driver.id,
        parkId: context.park.id,
        balanceMinor: balance.amount.minor,
        currency: balance.amount.currency,
        yandexAccountId: balance.accountId,
      },
    });
    return balance;
  }

  /**
   * Money already committed to withdrawals that have not finished.
   *
   * Subtracting this is what stops a driver from spending the same balance
   * twice in the window between requesting a payout and Yandex reflecting the
   * debit. It is belt-and-braces with the one-live-withdrawal-per-driver index,
   * and it is the number the UI needs anyway.
   */
  async reservedFor(driverId: string, currency: string, tx?: TransactionClient): Promise<Money> {
    const client = tx ?? this.prisma;
    const result = await client.withdrawal.aggregate({
      where: {
        driverId,
        currency,
        state: {
          in: [
            'CREATED',
            'RISK_CHECK',
            'RISK_REVIEW',
            'RESERVING',
            'RESERVE_UNCERTAIN',
            'RESERVE_PENDING',
            'MANUAL_REVIEW',
          ],
        },
      },
      _sum: { grossMinor: true },
    });
    return Money.fromMinor(result._sum.grossMinor ?? 0n, currency as CurrencyCode);
  }

  private async withReserved(
    context: ActiveContext,
    available: Money,
    asOf: Date,
    fresh: boolean,
    staleSeconds?: number,
  ): Promise<DriverBalance> {
    const reserved = await this.reservedFor(context.driver.id, available.currency);
    const withdrawable = Money.max(available.subtract(reserved), Money.zero(available.currency));
    return { available, reserved, withdrawable, park: context.park, asOf, fresh, staleSeconds };
  }
}
