import { Injectable } from '@nestjs/common';
import { DriverProfileDto, LinkDriverDto } from '@cashout/contracts';
import { PrismaService, isUniqueViolation } from '../../prisma/prisma.service';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppLogger } from '../../common/logging/logger.service';
import { AuditService } from '../audit/audit.service';
import { YandexFleetPort } from '../yandex/yandex.port';

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly yandex: YandexFleetPort,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {}

  async profile(userId: string): Promise<DriverProfileDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { driver: true },
    });
    if (!user?.driver) throw AppError.notFound('Driver');

    return {
      id: user.driver.id,
      phone: user.phone,
      firstName: user.driver.firstName,
      lastName: user.driver.lastName,
      locale: user.locale as DriverProfileDto['locale'],
      verificationStatus: user.driver.verificationStatus,
      parkId: user.driver.parkId,
      parkName: null,
      yandexContractorProfileId: user.driver.yandexContractorProfileId,
      currency: user.driver.currency,
    };
  }

  /**
   * Links a Cash Out account to a Yandex contractor profile.
   *
   * Matching on the phone number alone is not enough: phone numbers get reused,
   * a park can hold several profiles for one number, and the consequence of
   * getting this wrong is paying one driver another driver's earnings. So:
   *
   *  - exactly one candidate must match the phone in that park — several means a
   *    human decides;
   *  - if the park holds a licence number, the driver must also produce its last
   *    four digits;
   *  - the `(parkId, contractorProfileId)` pair is unique across all drivers, so
   *    a second account can never attach to a profile that is already claimed.
   */
  async link(userId: string, dto: LinkDriverDto): Promise<DriverProfileDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { driver: true },
    });
    const driver = user.driver;
    if (!driver) throw AppError.notFound('Driver');
    if (driver.verificationStatus === 'VERIFIED') {
      return this.profile(userId);
    }
    if (driver.verificationStatus === 'BLOCKED') {
      throw new AppError('DRIVER_BLOCKED', driver.blockReason ?? 'Blocked');
    }

    let candidates;
    try {
      candidates = await this.yandex.findProfilesByPhone(dto.parkId, user.phone);
    } catch (error) {
      this.logger.fail('Yandex profile lookup failed', error, { userId });
      throw new AppError('YANDEX_UNAVAILABLE', 'The fleet system is not responding');
    }

    if (candidates.length === 0) {
      throw new AppError(
        'PHONE_NOT_LINKED_TO_DRIVER',
        'No driver profile with this phone number was found in that fleet',
      );
    }

    if (candidates.length > 1) {
      await this.markPending(driver.id, dto.parkId, 'multiple_profiles_matched_phone');
      throw new AppError(
        'PHONE_NOT_LINKED_TO_DRIVER',
        'Several driver profiles match this number; support will resolve it',
      );
    }

    const candidate = candidates[0]!;

    if (candidate.licenceNumber) {
      if (!dto.licenceLast4) {
        throw new AppError('VALIDATION_FAILED', 'The last four digits of the licence are required');
      }
      const actualLast4 = candidate.licenceNumber.replace(/\D/g, '').slice(-4);
      if (actualLast4 !== dto.licenceLast4) {
        throw new AppError('PHONE_NOT_LINKED_TO_DRIVER', 'Those licence digits do not match');
      }
    }

    if (candidate.blocked) {
      await this.markPending(driver.id, dto.parkId, 'yandex_profile_not_working');
      throw new AppError('DRIVER_BLOCKED', 'This profile is not active in the fleet');
    }

    try {
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: {
          parkId: candidate.parkId,
          yandexContractorProfileId: candidate.id,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          currency: candidate.balance?.amount.currency ?? 'AMD',
          licenceLast4Hash: dto.licenceLast4
            ? this.crypto.fingerprint('licence', dto.licenceLast4)
            : null,
          verificationStatus: 'VERIFIED',
          verifiedAt: this.clock.now(),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'PHONE_NOT_LINKED_TO_DRIVER',
          'That driver profile is already linked to another Cash Out account',
        );
      }
      throw error;
    }

    await this.audit.record({
      action: 'driver.linked',
      subjectType: 'driver',
      subjectId: driver.id,
      actorType: 'DRIVER',
      actorId: userId,
      after: { parkId: candidate.parkId, contractorProfileId: candidate.id },
    });

    return this.profile(userId);
  }

  private async markPending(driverId: string, parkId: string, reason: string): Promise<void> {
    await this.prisma.driver.update({
      where: { id: driverId },
      data: { verificationStatus: 'PENDING', parkId, blockReason: reason },
    });
  }

  async setLocale(userId: string, locale: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { locale } });
  }
}
