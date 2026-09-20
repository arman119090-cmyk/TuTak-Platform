import { Injectable } from '@nestjs/common';
import type { PayoutMethod } from '@prisma/client';
import { LinkIdramAccountDto, PayoutMethodDto } from '@cashout/contracts';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toPayoutMethodDto } from '../payout-methods/payout-methods.service';
import { IdramProviderPort } from './idram.port';

/**
 * The driver's iDram account: the payout destination.
 *
 * One active iDram destination per driver. Linking a new one verifies it with
 * the provider first, then replaces the previous one — unless a payout is in
 * flight to it, in which case the replacement waits. The account id itself is
 * stored only encrypted as the provider's instrument token; every read returns
 * the masked form.
 */
@Injectable()
export class IdramService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idram: IdramProviderPort,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {}

  async current(driverId: string): Promise<PayoutMethodDto | null> {
    const method = await this.currentRow(driverId);
    return method ? toPayoutMethodDto(method) : null;
  }

  async link(driverId: string, dto: LinkIdramAccountDto): Promise<PayoutMethodDto> {
    let verification;
    try {
      verification = await this.idram.verifyAccount({
        accountId: dto.accountId,
        holderName: dto.holderName,
        driverReference: driverId,
      });
    } catch (error) {
      this.logger.fail('iDram account verification failed', error, { driverId });
      throw new AppError('IDRAM_UNAVAILABLE', 'iDram is not responding');
    }

    if (verification.status === 'UNKNOWN') {
      throw new AppError('IDRAM_UNAVAILABLE', 'iDram is not responding');
    }
    if (verification.status === 'REJECTED') {
      await this.audit.record({
        action: 'idram.account_rejected',
        subjectType: 'driver',
        subjectId: driverId,
        actorType: 'DRIVER',
        after: { masked: verification.maskedIdentifier, reason: verification.reason },
      });
      throw new AppError('IDRAM_ACCOUNT_REJECTED', verification.reason);
    }

    const fingerprint = this.crypto.fingerprint('instrument', verification.fingerprint);
    const previous = await this.currentRow(driverId);

    if (previous && previous.fingerprint === fingerprint) {
      // Linking the same wallet again is a no-op, not a second row.
      return toPayoutMethodDto(previous);
    }

    if (previous) {
      const inFlight = await this.prisma.withdrawal.count({
        where: {
          payoutMethodId: previous.id,
          state: { notIn: ['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED'] },
        },
      });
      if (inFlight > 0) {
        throw new AppError(
          'WITHDRAWAL_ALREADY_IN_PROGRESS',
          'A payout to the current iDram account is still in progress',
        );
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (previous) {
        await tx.payoutMethod.update({
          where: { id: previous.id },
          data: { disabledAt: this.clock.now(), status: 'DISABLED', isDefault: false },
        });
      }
      await tx.payoutMethod.updateMany({
        where: { driverId, isDefault: true },
        data: { isDefault: false },
      });
      return tx.payoutMethod.create({
        data: {
          driverId,
          kind: 'IDRAM',
          status: verification.status === 'VERIFIED' ? 'ACTIVE' : 'PENDING_VERIFICATION',
          currency: 'AMD',
          providerTokenEnc: this.crypto.encrypt(verification.instrumentToken),
          fingerprint,
          maskedIdentifier: verification.maskedIdentifier,
          displayName: 'iDram',
          holderName: verification.holderName,
          isDefault: true,
          verifiedAt: verification.status === 'VERIFIED' ? this.clock.now() : null,
        },
      });
    });

    await this.audit.record({
      action: previous ? 'idram.account_replaced' : 'idram.account_linked',
      subjectType: 'payout_method',
      subjectId: created.id,
      actorType: 'DRIVER',
      before: previous ? { masked: previous.maskedIdentifier } : undefined,
      after: { masked: created.maskedIdentifier, status: created.status },
    });

    return toPayoutMethodDto(created);
  }

  async unlink(driverId: string): Promise<void> {
    const current = await this.currentRow(driverId);
    if (!current) return;
    const inFlight = await this.prisma.withdrawal.count({
      where: {
        payoutMethodId: current.id,
        state: { notIn: ['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED'] },
      },
    });
    if (inFlight > 0) {
      throw new AppError(
        'WITHDRAWAL_ALREADY_IN_PROGRESS',
        'A payout to this iDram account is still in progress',
      );
    }
    await this.prisma.payoutMethod.update({
      where: { id: current.id },
      data: { disabledAt: this.clock.now(), status: 'DISABLED', isDefault: false },
    });
    await this.audit.record({
      action: 'idram.account_unlinked',
      subjectType: 'payout_method',
      subjectId: current.id,
      actorType: 'DRIVER',
      before: { masked: current.maskedIdentifier },
    });
  }

  private currentRow(driverId: string): Promise<PayoutMethod | null> {
    return this.prisma.payoutMethod.findFirst({
      where: { driverId, kind: 'IDRAM', disabledAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }
}
