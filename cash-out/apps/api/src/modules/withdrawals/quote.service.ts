import { Inject, Injectable } from '@nestjs/common';
import { CreateQuoteDto, QuoteDto } from '@cashout/contracts';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { ENV, Env } from '../../config/env';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BalanceService } from '../drivers/balance.service';
import { FeesService } from '../fees/fees.service';
import { LimitsService } from '../limits/limits.service';
import { MembershipService } from '../parks/membership.service';
import { PayoutMethodsService } from '../payout-methods/payout-methods.service';

@Injectable()
export class QuoteService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly balances: BalanceService,
    private readonly fees: FeesService,
    private readonly limits: LimitsService,
    private readonly payoutMethods: PayoutMethodsService,
    private readonly memberships: MembershipService,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
  ) {}

  /**
   * Produces the numbers the driver is about to confirm.
   *
   * The quote is priced against a *fresh* balance — never a cached one — and is
   * signed. The confirm call replays the signature, so the fee a driver agreed
   * to is the fee that gets charged even if pricing changed in between, and a
   * modified client cannot submit a quote of its own invention.
   */
  async create(driverId: string, dto: CreateQuoteDto): Promise<QuoteDto> {
    // The active park is verified first: no membership, no quote.
    const { park } = await this.memberships.requireActive(driverId);

    const method = await this.payoutMethods.requireUsable(driverId, dto.payoutMethodId);
    const balance = await this.balances.requireFresh(driverId);

    if (method.currency !== balance.available.currency) {
      throw new AppError(
        'VALIDATION_FAILED',
        `That payout method is in ${method.currency}, but the balance is in ${balance.available.currency}`,
      );
    }

    const requested = dto.all
      ? balance.withdrawable
      : Money.fromMinor(dto.amount!.minor, dto.amount!.currency as CurrencyCode);

    if (!dto.all && requested.currency !== balance.available.currency) {
      throw new AppError('VALIDATION_FAILED', 'Currency does not match the balance');
    }
    if (!requested.isPositive) {
      throw new AppError('INSUFFICIENT_BALANCE', 'Nothing available to withdraw');
    }
    if (requested.greaterThan(balance.withdrawable)) {
      throw new AppError('INSUFFICIENT_BALANCE', 'That is more than the available balance', {
        withdrawable: balance.withdrawable.toJSON(),
      });
    }

    const priced = await this.fees.quote(park.id, requested).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AmountTooSmallError') {
        throw new AppError('AMOUNT_DOES_NOT_COVER_FEES', error.message);
      }
      throw error;
    });

    const decision = await this.limits.check({
      driverId,
      parkId: park.id,
      gross: priced.quote.gross,
    });
    if (decision.outcome === 'DENY') {
      throw new AppError(decision.code, decision.message, decision.details);
    }

    const expiresAt = this.clock.plusSeconds(this.env.QUOTE_TTL_SECONDS);
    const row = await this.prisma.quote.create({
      data: {
        driverId,
        parkId: park.id,
        payoutMethodId: method.id,
        currency: priced.quote.currency,
        grossMinor: priced.quote.gross.minor,
        platformFeeMinor: priced.quote.platformFee.minor,
        providerFeeMinor: priced.quote.providerFee.minor,
        netMinor: priced.quote.net.minor,
        balanceAtQuoteMinor: balance.available.minor,
        feeScheduleId: priced.feeScheduleId,
        signature: '',
        expiresAt,
      },
    });

    const signature = this.crypto.signQuote(canonicalise({ ...row, expiresAt }));
    await this.prisma.quote.update({ where: { id: row.id }, data: { signature } });

    return {
      quoteId: row.id,
      gross: priced.quote.gross.toJSON(),
      platformFee: priced.quote.platformFee.toJSON(),
      providerFee: priced.quote.providerFee.toJSON(),
      totalFee: priced.quote.totalFee.toJSON(),
      net: priced.quote.net.toJSON(),
      payoutMethodId: method.id,
      expiresAt: expiresAt.toISOString(),
      balanceAtQuote: balance.available.toJSON(),
      signature,
    };
  }

  /**
   * Re-validates a quote at confirmation time: right driver, unexpired, unspent,
   * and untampered. All four have to hold.
   */
  async validate(driverId: string, quoteId: string, signature: string) {
    const quote = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (!quote || quote.driverId !== driverId) {
      throw new AppError('NOT_FOUND', 'Unknown quote');
    }
    if (quote.consumedAt) {
      throw new AppError('QUOTE_MISMATCH', 'This quote has already been used');
    }
    if (quote.expiresAt.getTime() <= this.clock.nowMs()) {
      throw new AppError('QUOTE_EXPIRED', 'This quote has expired');
    }
    if (!this.crypto.verifyQuote(canonicalise(quote), signature)) {
      throw new AppError('QUOTE_MISMATCH', 'This quote has been altered');
    }
    return quote;
  }
}

/**
 * The exact bytes that are signed. Order matters and is fixed here; adding a
 * field to the quote without adding it here would leave that field unprotected.
 */
export function canonicalise(quote: {
  id: string;
  driverId: string;
  payoutMethodId: string;
  currency: string;
  grossMinor: bigint;
  platformFeeMinor: bigint;
  providerFeeMinor: bigint;
  netMinor: bigint;
  balanceAtQuoteMinor: bigint;
  feeScheduleId: string;
  expiresAt: Date;
  parkId?: string | null;
}): string {
  return [
    'v1',
    quote.id,
    quote.driverId,
    quote.payoutMethodId,
    quote.currency,
    quote.grossMinor.toString(),
    quote.platformFeeMinor.toString(),
    quote.providerFeeMinor.toString(),
    quote.netMinor.toString(),
    quote.balanceAtQuoteMinor.toString(),
    quote.feeScheduleId,
    quote.expiresAt.toISOString(),
    quote.parkId ?? '',
  ].join('|');
}
