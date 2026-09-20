import { Injectable } from '@nestjs/common';
import { DriverProfileDto } from '@cashout/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { MembershipService } from '../parks/membership.service';

/**
 * The driver's profile.
 *
 * There is no "link me to a park" call any more: the roster decides. Every
 * read of the profile re-runs the resolution, so a roster row imported after
 * the driver signed in is picked up on their next screen, not their next
 * reinstall.
 */
@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipService,
  ) {}

  async profile(userId: string): Promise<DriverProfileDto> {
    return this.memberships.resolve(userId);
  }

  async setLocale(userId: string, locale: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { locale } });
  }
}
