import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { generateNumericCode, sha256Hex } from '../../common/utils/crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SMS_PROVIDER, SmsProvider } from '../../infrastructure/sms/sms-provider.interface';
import { NotificationsService } from '../notifications/notifications.service';

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

/** Same account-level ceilings as password reset, for the same reason. */
const MAX_CODES_PER_WINDOW = 5;
const MAX_ATTEMPTS_PER_WINDOW = 15;
const WINDOW_MS = 60 * 60_000;

/**
 * Proves that whoever registered controls the number they registered.
 *
 * `isPhoneVerified` has existed since the first schema and was never set and
 * never read, so any well-formed `+374XXXXXXXX` string produced a funded
 * wallet. That is what made every abuse path repeatable: the individual holes
 * were closed one by one, but fabricating the accounts to walk through them
 * cost nothing. A verification code is the cheapest thing that makes an
 * account cost something real.
 *
 * Deliberately not enforced at registration. A customer must be able to
 * create an account and then verify, because a failed SMS at signup would
 * otherwise strand them with no account and no recourse. What verification
 * gates is *earning*, which is where the abuse lives — see
 * `assertCanEarn`.
 */
@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /** Issues a code to the number on the account. */
  async request(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.isPhoneVerified) {
      throw new BadRequestException('This number is already verified');
    }

    const issued = await this.prisma.phoneVerificationToken.count({
      where: { userId, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
    });
    if (issued >= MAX_CODES_PER_WINDOW) {
      throw new BadRequestException('Too many verification codes requested. Try again later.');
    }

    const code = generateNumericCode(6);

    await this.prisma.$transaction(async (tx) => {
      // One live challenge at a time; older codes stop being guessable.
      await tx.phoneVerificationToken.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.phoneVerificationToken.create({
        data: {
          userId,
          codeHash: sha256Hex(code),
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      });
    });

    // Unlike a password reset, the caller here is already authenticated, so a
    // delivery failure can be reported honestly — it reveals nothing.
    await this.sms.send({
      to: user.phone,
      body: `TuTak: your verification code is ${code}`,
      templateParams: [code],
    });

    await this.notifications.send({
      userId,
      channel: NotificationChannel.SMS,
      titleKey: 'notifications.phoneVerificationTitle',
      bodyKey: 'notifications.phoneVerificationBody',
      params: { code },
    });

    return { success: true };
  }

  /** Consumes a code and marks the number verified. */
  async confirm(userId: string, code: string) {
    const invalid = new UnauthorizedException('Verification code is invalid or has expired');

    const spent = await this.prisma.phoneVerificationToken.aggregate({
      where: { userId, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
      _sum: { attempts: true },
    });
    if ((spent._sum.attempts ?? 0) >= MAX_ATTEMPTS_PER_WINDOW) throw invalid;

    const challenge = await this.prisma.phoneVerificationToken.findFirst({
      where: { userId, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw invalid;

    if (challenge.codeHash !== sha256Hex(code)) {
      const attempts = challenge.attempts + 1;
      await this.prisma.phoneVerificationToken.update({
        where: { id: challenge.id },
        data: {
          attempts,
          ...(attempts >= MAX_ATTEMPTS ? { consumedAt: new Date() } : {}),
        },
      });
      throw invalid;
    }

    const consumed = await this.prisma.phoneVerificationToken.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw invalid;

    await this.prisma.user.update({
      where: { id: userId },
      data: { isPhoneVerified: true },
    });

    this.logger.log(`Phone verified for user ${userId}`);
    return { success: true };
  }

  /**
   * Gate on earning bonus.
   *
   * Spending points, paying and charging all stay open to an unverified
   * account — those cost the customer money and are not worth farming. What
   * an unverified account may not do is *acquire* points, because that is the
   * only direction in which a free account is profitable.
   */
  async assertCanEarn(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { isPhoneVerified: true },
    });
    if (!user.isPhoneVerified) {
      throw new BadRequestException(
        'Verify your phone number before you can earn bonus points',
      );
    }
  }
}
