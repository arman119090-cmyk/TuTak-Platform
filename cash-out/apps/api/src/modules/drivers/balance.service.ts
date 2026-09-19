import { Injectable } from '@nestjs/common';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { PrismaService, TransactionClient } from '../../prisma/prisma.service';
import { Clock } from '../../common/clock';
import { AppLogger } from '../../common/logging/logger.service';
import { AppError } from '../../common/app-error';
import { YandexFleetPort } from '../yandex/yandex.port';

export interface DriverBalance {
  readonly available: Money;
  readonly reserved: Money;
  readonly withdrawable: Money;
  readonly asOf: Date;
  readonly fresh: boolean;
  readonly staleSeconds?: number;
}

/** How long a cached balance may be shown on the home screen. */
const DISPLAY_CACHE_SECONDS = 20;
/** How old a cached balance may be before it is refused as a basis for a payout. */
const MAX_STALE_FOR_DISPLAY_SECONDS = 15 * 60;

@Injectable()
export class BalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly yandex: YandexFleetPort,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {}

  /**
   * The balance for the home screen.
   *
   * Yandex is the source of truth, but it is also a system we do not control,
   * and a driver opening the app during a Yandex outage should see their last
   * known balance with an honest "this may be out of date" rather than an error
   * screen. What they must *not* be able to do is start a payout against a
   * stale number — that is enforced separately, in `requireFresh`.
   */
  async forDisplay(driverId: string): Promise<DriverBalance> {
    const driver = await this.requireLinkedDriver(driverId);
    const currency = (driver.currency ?? 'AMD') as CurrencyCode;

    const cached = await this.prisma.balanceSnapshot.findFirst({
      where: { driverId },
      orderBy: { fetchedAt: 'desc' },
    });

    const cacheAgeSeconds = cached
      ? (this.clock.nowMs() - cached.fetchedAt.getTime()) / 1000
      : Number.POSITIVE_INFINITY;

    if (cached && cacheAgeSeconds < DISPLAY_CACHE_SECONDS) {
      return this.withReserved(
        driverId,
        Money.fromMinor(cached.balanceMinor, cached.currency as CurrencyCode),
        cached.fetchedAt,
        true,
      );
    }

    try {
      const fresh = await this.fetchAndStore(
        driverId,
        driver.parkId!,
        driver.yandexContractorProfileId!,
      );
      return this.withReserved(driverId, fresh.amount, fresh.fetchedAt, true);
    } catch (error) {
      this.logger.fail('Falling back to cached balance', error, { driverId });
      if (!cached || cacheAgeSeconds > MAX_STALE_FOR_DISPLAY_SECONDS) {
        throw new AppError('YANDEX_UNAVAILABLE', 'Could not read the balance from the fleet');
      }
      return this.withReserved(
        driverId,
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
    const driver = await this.requireLinkedDriver(driverId);
    try {
      const fresh = await this.fetchAndStore(
        driverId,
        driver.parkId!,
        driver.yandexContractorProfileId!,
      );
      return this.withReserved(driverId, fresh.amount, fresh.fetchedAt, true);
    } catch (error) {
      this.logger.fail('Fresh balance required but unavailable', error, { driverId });
      throw new AppError('YANDEX_UNAVAILABLE', 'The fleet system is not responding');
    }
  }

  private async fetchAndStore(driverId: string, parkId: string, profileId: string) {
    const balance = await this.yandex.getBalance(parkId, profileId);
    await this.prisma.balanceSnapshot.create({
      data: {
        driverId,
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
            'MANUAL_REVIEW',
          ],
        },
      },
      _sum: { grossMinor: true },
    });
    return Money.fromMinor(result._sum.grossMinor ?? 0n, currency as CurrencyCode);
  }

  private async withReserved(
    driverId: string,
    available: Money,
    asOf: Date,
    fresh: boolean,
    staleSeconds?: number,
  ): Promise<DriverBalance> {
    const reserved = await this.reservedFor(driverId, available.currency);
    const withdrawable = Money.max(available.subtract(reserved), Money.zero(available.currency));
    return { available, reserved, withdrawable, asOf, fresh, staleSeconds };
  }

  private async requireLinkedDriver(driverId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw AppError.notFound('Driver');
    if (driver.verificationStatus === 'BLOCKED') {
      throw new AppError('DRIVER_BLOCKED', driver.blockReason ?? 'Withdrawals are blocked');
    }
    if (
      driver.verificationStatus !== 'VERIFIED' ||
      !driver.parkId ||
      !driver.yandexContractorProfileId
    ) {
      throw new AppError('DRIVER_NOT_VERIFIED', 'This driver is not linked to a Yandex profile');
    }
    return driver;
  }
}
