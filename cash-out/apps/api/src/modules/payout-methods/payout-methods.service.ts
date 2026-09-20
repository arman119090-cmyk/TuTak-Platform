import { Injectable } from '@nestjs/common';
import { AddPayoutMethodDto, PayoutMethodDto } from '@cashout/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/app-error';
import { CryptoService } from '../../common/crypto/crypto.service';
import { Clock } from '../../common/clock';
import { AuditService } from '../audit/audit.service';
import { IdramProviderPort } from '../idram/idram.port';
import {
  PaymentProviderPort,
  RegisteredInstrument,
} from '../payment-provider/payment-provider.port';

@Injectable()
export class PayoutMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProviderPort,
    private readonly idram: IdramProviderPort,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async list(driverId: string): Promise<PayoutMethodDto[]> {
    const methods = await this.prisma.payoutMethod.findMany({
      where: { driverId, disabledAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return methods.map(toDto);
  }

  /**
   * Registers a payout instrument.
   *
   * Cash Out never sees a card number. The app collects it inside the provider's
   * own SDK, which hands back a single-use token; this exchanges that token for
   * a durable one and stores it encrypted. What lands in our database is a
   * provider reference, a masked tail, and a peppered fingerprint — none of
   * which can be turned back into an instrument.
   */
  async add(driverId: string, dto: AddPayoutMethodDto): Promise<PayoutMethodDto> {
    const registered = await this.register(driverId, dto);

    if (registered.status === 'REJECTED') {
      throw new AppError(
        dto.kind === 'IDRAM' ? 'IDRAM_ACCOUNT_REJECTED' : 'PAYOUT_METHOD_NOT_VERIFIED',
        registered.rejectionReason ?? 'The provider rejected this payout method',
      );
    }

    const fingerprint = this.crypto.fingerprint('instrument', registered.instrumentFingerprint);

    const existing = await this.prisma.payoutMethod.findFirst({
      where: { driverId, fingerprint, disabledAt: null },
    });
    if (existing) {
      if (dto.setAsDefault) await this.makeDefault(driverId, existing.id);
      return toDto(
        await this.prisma.payoutMethod.findUniqueOrThrow({ where: { id: existing.id } }),
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const isFirst =
        (await tx.payoutMethod.count({ where: { driverId, disabledAt: null } })) === 0;
      const shouldDefault = dto.setAsDefault || isFirst;

      if (shouldDefault) {
        await tx.payoutMethod.updateMany({
          where: { driverId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.payoutMethod.create({
        data: {
          driverId,
          kind: dto.kind,
          status: registered.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING_VERIFICATION',
          currency: dto.currency,
          providerTokenEnc: this.crypto.encrypt(registered.token),
          fingerprint,
          maskedIdentifier: registered.maskedIdentifier,
          displayName: registered.displayName,
          holderName: registered.holderName ?? null,
          isDefault: shouldDefault,
          verifiedAt: registered.status === 'ACTIVE' ? this.clock.now() : null,
        },
      });
    });

    await this.audit.record({
      action: 'payout_method.added',
      subjectType: 'payout_method',
      subjectId: created.id,
      actorType: 'DRIVER',
      after: { kind: created.kind, masked: created.maskedIdentifier },
    });

    return toDto(created);
  }

  /**
   * Turns the driver's input into a stored instrument, by kind. A card comes
   * as the provider's single-use token; a bank account as an identifier the
   * provider validates; an iDram account is looked up with the wallet
   * provider, which also tells us the holder's name.
   */
  private async register(
    driverId: string,
    dto: AddPayoutMethodDto,
  ): Promise<RegisteredInstrument & { holderName?: string | null }> {
    if (dto.kind === 'IDRAM') {
      let verification;
      try {
        verification = await this.idram.verifyAccount({
          accountId: dto.accountId,
          holderName: dto.holderName,
          driverReference: driverId,
        });
      } catch {
        throw new AppError('IDRAM_UNAVAILABLE', 'iDram is not responding');
      }
      if (verification.status === 'UNKNOWN') {
        throw new AppError('IDRAM_UNAVAILABLE', 'iDram is not responding');
      }
      if (verification.status === 'REJECTED') {
        return {
          token: '',
          maskedIdentifier: verification.maskedIdentifier,
          displayName: 'iDram',
          instrumentFingerprint: '',
          status: 'REJECTED',
          rejectionReason: verification.reason,
        };
      }
      return {
        token: verification.instrumentToken,
        maskedIdentifier: verification.maskedIdentifier,
        displayName: 'iDram',
        holderName: verification.holderName,
        instrumentFingerprint: verification.fingerprint,
        status: verification.status === 'VERIFIED' ? 'ACTIVE' : 'PENDING_VERIFICATION',
      };
    }

    const singleUseToken =
      dto.kind === 'CARD' ? dto.providerToken : `bank:${dto.accountIdentifier}`;
    return this.provider.registerInstrument({
      singleUseToken,
      driverReference: driverId,
      currency: dto.currency,
    });
  }

  async makeDefault(driverId: string, payoutMethodId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const method = await tx.payoutMethod.findFirst({
        where: { id: payoutMethodId, driverId, disabledAt: null },
      });
      if (!method) throw new AppError('PAYOUT_METHOD_NOT_FOUND', 'No such payout method');
      await tx.payoutMethod.updateMany({
        where: { driverId, isDefault: true },
        data: { isDefault: false },
      });
      await tx.payoutMethod.update({ where: { id: payoutMethodId }, data: { isDefault: true } });
    });
  }

  /**
   * Soft-removes a method. The row stays, because withdrawals reference it and
   * "where did this money go" must remain answerable after a driver tidies up
   * their cards.
   */
  async remove(driverId: string, payoutMethodId: string): Promise<void> {
    const method = await this.prisma.payoutMethod.findFirst({
      where: { id: payoutMethodId, driverId, disabledAt: null },
    });
    if (!method) throw new AppError('PAYOUT_METHOD_NOT_FOUND', 'No such payout method');

    const inFlight = await this.prisma.withdrawal.count({
      where: {
        payoutMethodId,
        state: { notIn: ['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED'] },
      },
    });
    if (inFlight > 0) {
      throw new AppError(
        'WITHDRAWAL_ALREADY_IN_PROGRESS',
        'This card is being used by a payout in progress',
      );
    }

    await this.prisma.payoutMethod.update({
      where: { id: payoutMethodId },
      data: { disabledAt: this.clock.now(), status: 'DISABLED', isDefault: false },
    });

    await this.audit.record({
      action: 'payout_method.removed',
      subjectType: 'payout_method',
      subjectId: payoutMethodId,
      actorType: 'DRIVER',
    });
  }

  /** Resolves the instrument token for a payout. Only the orchestrator calls this. */
  async resolveToken(payoutMethodId: string): Promise<string> {
    const method = await this.prisma.payoutMethod.findUnique({ where: { id: payoutMethodId } });
    if (!method || method.disabledAt) {
      throw new AppError('PAYOUT_METHOD_NOT_FOUND', 'No such payout method');
    }
    if (method.status !== 'ACTIVE') {
      throw new AppError('PAYOUT_METHOD_NOT_VERIFIED', 'This payout method is not active');
    }
    return this.crypto.decrypt(method.providerTokenEnc);
  }

  async requireUsable(driverId: string, payoutMethodId: string) {
    const method = await this.prisma.payoutMethod.findFirst({
      where: { id: payoutMethodId, driverId, disabledAt: null },
    });
    if (!method) throw new AppError('PAYOUT_METHOD_NOT_FOUND', 'No such payout method');
    if (method.status !== 'ACTIVE') {
      throw new AppError('PAYOUT_METHOD_NOT_VERIFIED', 'This payout method is not active yet');
    }
    return method;
  }
}

export function toPayoutMethodDto(method: {
  id: string;
  kind: string;
  status: string;
  currency: string;
  maskedIdentifier: string;
  displayName: string | null;
  holderName: string | null;
  isDefault: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
}): PayoutMethodDto {
  return {
    id: method.id,
    kind: method.kind as PayoutMethodDto['kind'],
    status: method.status as PayoutMethodDto['status'],
    currency: method.currency as PayoutMethodDto['currency'],
    maskedIdentifier: method.maskedIdentifier,
    displayName: method.displayName,
    holderName: method.holderName,
    isDefault: method.isDefault,
    verifiedAt: method.verifiedAt?.toISOString() ?? null,
    createdAt: method.createdAt.toISOString(),
  };
}

const toDto = toPayoutMethodDto;
