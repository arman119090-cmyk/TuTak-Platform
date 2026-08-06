import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BonusEntryType, ReferralInviteStatus, TransactionStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';

/**
 * Floor on the purchase that qualifies a referral.
 *
 * The point is cost, not revenue: a reward worth 1000 points must not be
 * obtainable by fabricating a transaction worth one dram.
 */
const QUALIFYING_MINIMUM_AMOUNT = new Decimal('1000');

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
   * Rewards a referrer when their referee makes a genuine first purchase.
   *
   * What counts as "genuine" is the whole security of this feature. It used to
   * be any first COMPLETED transaction of any type and any amount, which — with
   * unverified registration and a self-issuable QR code — made the reward a
   * money printer: register a throwaway account with the attacker's code,
   * self-pay one dram, collect the reward, repeat
   * (docs/AUDIT_2026-08-B.md §C4). Qualification now requires:
   *
   *  * a real partner behind the transaction, so there is commerce to reward;
   *  * an amount at or above a floor, so fabricating one is not free;
   *  * a referrer who is not the referee.
   *
   * The claim and the accrual share one transaction, and the claim is a
   * conditional update rather than a read-then-write. Without that, two
   * concurrent completions both saw PENDING and both paid, and an accrual that
   * succeeded before a failing status write left the invite payable forever
   * (§C5).
   */
  async handleQualifyingTransaction(refereeUserId: string, transactionId: string) {
    const invite = await this.prisma.referralInvite.findUnique({ where: { refereeUserId } });
    if (!invite || invite.status !== ReferralInviteStatus.PENDING) {
      return null;
    }
    if (invite.referrerUserId === refereeUserId) {
      this.logger.warn(`Refusing self-referral on invite ${invite.id}`);
      return null;
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { partnerId: true, amount: true, status: true, userId: true },
    });
    if (
      !transaction ||
      transaction.userId !== refereeUserId ||
      transaction.status !== TransactionStatus.COMPLETED ||
      !transaction.partnerId ||
      transaction.amount.lessThan(QUALIFYING_MINIMUM_AMOUNT)
    ) {
      return null;
    }

    const rewardAmount = this.config.get('bonus.referralRewardAmount', { infer: true });

    return this.prisma.$transaction(async (tx) => {
      // Claim first, conditionally. Exactly one caller can move the invite out
      // of PENDING, and whoever loses does nothing.
      const claimed = await tx.referralInvite.updateMany({
        where: { id: invite.id, status: ReferralInviteStatus.PENDING },
        data: {
          status: ReferralInviteStatus.REWARDED,
          qualifyingAction: 'FIRST_QUALIFYING_PURCHASE',
          qualifiedAt: new Date(),
          rewardedAt: new Date(),
          rewardAmount,
        },
      });
      if (claimed.count === 0) return null;

      const referrerWallet = await tx.wallet.findUniqueOrThrow({
        where: { userId: invite.referrerUserId },
      });

      // Inside the same transaction, so a failure here rolls the claim back
      // and the referral stays payable rather than vanishing.
      await this.bonusEngine.accrue(
        {
          walletId: referrerWallet.id,
          type: BonusEntryType.ACCRUAL_REFERRAL,
          amount: rewardAmount,
          sourceTransactionId: transactionId,
          metadata: { refereeUserId, inviteId: invite.id },
        },
        tx,
      );

      this.logger.log(
        `Referral invite ${invite.id} rewarded ${rewardAmount} to ${invite.referrerUserId}`,
      );
      return tx.referralInvite.findUniqueOrThrow({ where: { id: invite.id } });
    });
  }
}
