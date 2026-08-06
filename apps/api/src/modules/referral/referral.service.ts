import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BonusEntryType, ReferralInviteStatus } from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusEngine: BonusEngineService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly auditService: AuditService,
  ) {}

  getMyCode(userId: string) {
    return this.prisma.referralCode.findUniqueOrThrow({ where: { userId } });
  }

  async listMyInvites(userId: string) {
    return this.prisma.referralInvite.findMany({
      where: { referrerUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        referee: { select: { id: true, firstName: true, lastName: true, createdAt: true } },
      },
    });
  }

  /**
   * Called when a referee completes their first qualifying action
   * (currently: first COMPLETED transaction of any type). Rewards the
   * referrer once, idempotently — a non-PENDING invite is a no-op.
   */
  async handleQualifyingTransaction(refereeUserId: string, transactionId: string) {
    const invite = await this.prisma.referralInvite.findUnique({
      where: { refereeUserId },
    });
    if (!invite || invite.status !== ReferralInviteStatus.PENDING) {
      return null;
    }

    const completedCount = await this.prisma.transaction.count({
      where: { userId: refereeUserId, status: 'COMPLETED' },
    });
    if (completedCount > 1) {
      // Not the referee's first completed transaction — already handled or n/a.
      return null;
    }

    const rewardAmount = this.config.get('bonus.referralRewardAmount', { infer: true });
    const referrerWallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId: invite.referrerUserId },
    });

    await this.bonusEngine.accrue({
      walletId: referrerWallet.id,
      type: BonusEntryType.ACCRUAL_REFERRAL,
      amount: rewardAmount,
      sourceTransactionId: transactionId,
      metadata: { refereeUserId, inviteId: invite.id },
    });

    const updated = await this.prisma.referralInvite.update({
      where: { id: invite.id },
      data: {
        status: ReferralInviteStatus.REWARDED,
        qualifyingAction: 'FIRST_TRANSACTION_COMPLETED',
        qualifiedAt: new Date(),
        rewardedAt: new Date(),
        rewardAmount,
      },
    });

    this.logger.log(`Referral invite ${invite.id} rewarded ${rewardAmount} to ${invite.referrerUserId}`);
    return updated;
  }
}
