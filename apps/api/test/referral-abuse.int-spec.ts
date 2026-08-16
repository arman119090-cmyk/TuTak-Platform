import {
  PrismaClient,
  ReferralChallengeParticipantStatus,
  ReferrerType,
  RoleName,
  TransactionType,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../src/config/configuration';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
import { ReferralService } from '../src/modules/referral/referral.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { QrCodeType } from '@prisma/client';
import { createCustomer, createDynamicInvoiceQr, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * Regression suite for docs/AUDIT_2026-08-B.md §C4 and §C5, carried forward
 * onto the Referral Challenge (spec §18-20,
 * docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md §3) that replaced the flat
 * one-time reward this suite originally covered.
 *
 * The reward was farmable because three gaps composed: registration is
 * unverified, any customer could self-issue a payable QR code and redeem it,
 * and the reward fired on any first completed transaction of any kind.
 * Register a throwaway account with the attacker's code, self-pay a dram,
 * collect the reward. Repeat. Every gap this suite closes still applies to
 * the Challenge: it is the same money-for-a-fabricated-signup shape, just
 * cumulative instead of single-purchase and paid to both sides instead of
 * one.
 */
describe('Referral abuse (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let referral: ReferralService;
  let qrPayments: QrPaymentsService;
  let transactions: TransactionsService;
  let qualificationAmount: string;
  let rewardAmount: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    referral = harness.app.get(ReferralService);
    qrPayments = harness.app.get(QrPaymentsService);
    transactions = harness.app.get(TransactionsService);
    const config = harness.app.get<ConfigService<AppConfig, true>>(ConfigService);
    qualificationAmount = config.get('purchasePolicy.challengeQualificationAmount', { infer: true });
    rewardAmount = config.get('purchasePolicy.challengeRewardAmount', { infer: true });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const asUser = (id: string): RequestUser => ({
    id,
    phone: '+37400000000',
    roles: [RoleName.CUSTOMER],
    permissions: [],
    partnerScopes: {},
    mustChangePassword: false,
  });

  /**
   * A referrer, a referee, and both the attribution row and the Challenge
   * participant row `AuthService.register` would have created together —
   * built directly here so this suite does not depend on the registration
   * flow to exercise the reward logic in isolation.
   */
  const invited = async () => {
    const referrer = await createCustomer(prisma);
    const referee = await createCustomer(prisma);
    const invite = await prisma.referralInvite.create({
      data: {
        referrerType: ReferrerType.USER,
        referrerUserId: referrer.user.id,
        refereeUserId: referee.user.id,
      },
    });
    const participant = await prisma.referralChallengeParticipant.create({
      data: {
        referrerUserId: referrer.user.id,
        refereeUserId: referee.user.id,
        requiredAmount: qualificationAmount,
      },
    });
    return { referrer, referee, invite, participant };
  };

  /**
   * A real, partner-backed purchase by the referee, driven through
   * `advanceChallengeProgress` explicitly rather than through the
   * `transaction.completed` listener: that listener is fire-and-forget, so
   * awaiting `redeem` guarantees nothing about whether it has run. (That
   * progress can be lost entirely if the process dies before the listener
   * fires is a real gap, recorded in the report rather than papered over
   * here — same gap this suite already noted for the old mechanic.)
   */
  const purchase = async (userId: string, amount: string) => {
    const partner = await createPartner(prisma);
    const tx = await transactions.create({
      userId,
      partnerId: partner.id,
      type: TransactionType.QR_PAYMENT,
      amount,
    });
    await transactions.markCompleted(tx.id);
    await referral.advanceChallengeProgress(userId, tx.id);
    return tx;
  };

  const participantOf = (id: string) =>
    prisma.referralChallengeParticipant.findUniqueOrThrow({ where: { id } });

  // ── §C4 the farming loop ───────────────────────────────────────────────

  describe('the §C4 farming loop', () => {
    it('refuses to let a customer redeem their own QR code', async () => {
      const { user } = await createCustomer(prisma);

      // The vehicle for the loop: a self-issued token with an amount on it,
      // redeemed by its own issuer, producing a COMPLETED transaction out of
      // nothing.
      const qr = await qrPayments.issue(
        { type: QrCodeType.USER_PAY_TOKEN, amount: '1' },
        asUser(user.id),
      );

      await expect(
        qrPayments.redeem({ token: qr.token, idempotencyKey: 'self-pay-1' }, user.id),
      ).rejects.toThrow(/cannot redeem a code you issued/);

      expect(await prisma.transaction.count({ where: { status: 'COMPLETED' } })).toBe(0);
    });

    it('does not advance a referral on a transaction with no partner', async () => {
      const { referrer, participant } = await invited();

      // A completed partnerless transaction must not progress the
      // challenge at all: there is no commerce behind it to reward, and it
      // is exactly the shape of the self-issued-QR farming loop the test
      // above closes — see the guard in `advanceChallengeProgress`.
      const tx = await transactions.create({
        userId: participant.refereeUserId,
        type: TransactionType.QR_PAYMENT,
        amount: qualificationAmount,
      });
      await transactions.markCompleted(tx.id);
      await referral.advanceChallengeProgress(participant.refereeUserId, tx.id);

      const after = await participantOf(participant.id);
      expect(after.status).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);
      expect(after.progressAmount.toFixed(4)).toBe('0.0000');
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { id: referrer.wallet.id } })).lifetimeEarned
          .toFixed(4),
      ).toBe('0.0000');
    });

    it('does not reward a referral below the qualifying cumulative amount', async () => {
      const { referrer, participant } = await invited();
      await purchase(participant.refereeUserId, '1');

      // A one-dram purchase is as cheap to fabricate as no purchase at all,
      // and it is nowhere near the cumulative threshold on its own.
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: referrer.wallet.id } });
      expect(wallet.lifetimeEarned.toFixed(4)).toBe('0.0000');
      expect((await participantOf(participant.id)).status).toBe(
        ReferralChallengeParticipantStatus.IN_PROGRESS,
      );
    });

    it('rewards both sides once cumulative purchases cross the threshold', async () => {
      const { referrer, referee, participant } = await invited();

      // Split across two purchases — spec §14/§18: no requirement that
      // qualification happen in a single purchase, cumulative is enough.
      await purchase(participant.refereeUserId, '4000');
      await purchase(participant.refereeUserId, '6000');

      const referrerWallet = await prisma.wallet.findUniqueOrThrow({
        where: { id: referrer.wallet.id },
      });
      const refereeWallet = await prisma.wallet.findUniqueOrThrow({
        where: { id: referee.wallet.id },
      });
      expect(referrerWallet.lifetimeEarned.toFixed(4)).toBe(`${rewardAmount}.0000`);
      expect(refereeWallet.lifetimeEarned.toFixed(4)).toBe(`${rewardAmount}.0000`);
      expect((await participantOf(participant.id)).status).toBe(
        ReferralChallengeParticipantStatus.REWARDED,
      );
      await assertWalletIntegrity(prisma, referrer.wallet.id);
      await assertWalletIntegrity(prisma, referee.wallet.id);
    });

    it('refuses a self-referral even if a participant row is forged', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const participant = await prisma.referralChallengeParticipant.create({
        data: { referrerUserId: user.id, refereeUserId: user.id, requiredAmount: qualificationAmount },
      });

      await purchase(user.id, qualificationAmount);

      // Paying yourself for introducing yourself is the whole farm in one
      // row. `createAttribution` already refuses to create this row in the
      // first place (proven separately below) — this proves the same floor
      // holds in `advanceChallengeProgress` itself, in case that first line
      // of defence is ever bypassed.
      expect((await participantOf(participant.id)).status).toBe(
        ReferralChallengeParticipantStatus.IN_PROGRESS,
      );
      const referralCredits = await prisma.bonusLedgerEntry.count({
        where: { walletId: wallet.id, type: 'ACCRUAL_PROMOTION' },
      });
      expect(referralCredits).toBe(0);
    });

    it('never creates an attribution or a challenge participant for a self-referral', async () => {
      const { user } = await createCustomer(prisma);
      // createCustomer is a raw fixture, not registration — a real signup
      // gets its code from AuthService.register, so this test makes one
      // directly rather than depending on that flow.
      const code = await prisma.referralCode.create({
        data: { userId: user.id, code: `TT-${user.id.slice(0, 8).toUpperCase()}` },
      });

      await prisma.$transaction((tx) =>
        referral.createAttribution({ refereeUserId: user.id, referrerCode: code.code }, tx),
      );

      expect(await prisma.referralInvite.count({ where: { refereeUserId: user.id } })).toBe(0);
      expect(
        await prisma.referralChallengeParticipant.count({ where: { refereeUserId: user.id } }),
      ).toBe(0);
    });
  });

  // ── §C5 the reward race ────────────────────────────────────────────────

  describe('the §C5 double-reward race', () => {
    it('pays exactly once when two completions land together', async () => {
      const { referrer, participant } = await invited();
      const partner = await createPartner(prisma);

      const first = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: qualificationAmount,
      });
      const second = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: qualificationAmount,
      });
      const [a, b] = await Promise.all([
        transactions.create({
          userId: participant.refereeUserId,
          partnerId: partner.id,
          type: TransactionType.QR_PAYMENT,
          amount: qualificationAmount,
        }),
        transactions.create({
          userId: participant.refereeUserId,
          partnerId: partner.id,
          type: TransactionType.QR_PAYMENT,
          amount: qualificationAmount,
        }),
      ]);
      await Promise.all([transactions.markCompleted(a.id), transactions.markCompleted(b.id)]);
      void first;
      void second;

      // Both observed IN_PROGRESS and both crossed the threshold at once —
      // the same shape that used to double-pay a plain read-then-write
      // claim, now guarded by a Serializable transaction instead.
      await Promise.all([
        referral.advanceChallengeProgress(participant.refereeUserId, a.id),
        referral.advanceChallengeProgress(participant.refereeUserId, b.id),
      ]);

      const credits = await prisma.bonusLedgerEntry.findMany({
        where: { walletId: referrer.wallet.id, type: 'ACCRUAL_PROMOTION' },
      });
      expect(credits).toHaveLength(1);
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { id: referrer.wallet.id } })).lifetimeEarned
          .toFixed(4),
      ).toBe(`${rewardAmount}.0000`);
      await assertWalletIntegrity(prisma, referrer.wallet.id);
    });

    it('does not pay again once already rewarded', async () => {
      const { referrer, participant } = await invited();

      await purchase(participant.refereeUserId, qualificationAmount);
      await purchase(participant.refereeUserId, '9000');

      const credits = await prisma.bonusLedgerEntry.count({
        where: { walletId: referrer.wallet.id, type: 'ACCRUAL_PROMOTION' },
      });
      expect(credits).toBe(1);
    });

    it('leaves the participant claimable if the reward accrual fails', async () => {
      const { referrer, participant } = await invited();
      const partner = await createPartner(prisma);
      const tx = await transactions.create({
        userId: participant.refereeUserId,
        partnerId: partner.id,
        type: TransactionType.QR_PAYMENT,
        amount: qualificationAmount,
      });
      await transactions.markCompleted(tx.id);

      // Claim and accrual share one transaction: if the money write fails
      // the claim must roll back too, or the challenge is silently lost
      // forever.
      await prisma.wallet.delete({ where: { id: referrer.wallet.id } });
      await expect(
        referral.advanceChallengeProgress(participant.refereeUserId, tx.id),
      ).rejects.toThrow();

      expect((await participantOf(participant.id)).status).toBe(
        ReferralChallengeParticipantStatus.IN_PROGRESS,
      );
    });

    it('caps a referrer at three rewarded slots', async () => {
      const referrer = await createCustomer(prisma);
      const referees = await Promise.all([
        createCustomer(prisma),
        createCustomer(prisma),
        createCustomer(prisma),
        createCustomer(prisma),
      ]);
      const participants = await Promise.all(
        referees.map((referee) =>
          prisma.referralChallengeParticipant.create({
            data: {
              referrerUserId: referrer.user.id,
              refereeUserId: referee.user.id,
              requiredAmount: qualificationAmount,
            },
          }),
        ),
      );

      for (const referee of referees) {
        await purchase(referee.user.id, qualificationAmount);
      }

      const statuses = await Promise.all(participants.map((p) => participantOf(p.id)));
      const rewarded = statuses.filter(
        (s) => s.status === ReferralChallengeParticipantStatus.REWARDED,
      );
      const qualifiedOnly = statuses.filter(
        (s) => s.status === ReferralChallengeParticipantStatus.QUALIFIED,
      );
      expect(rewarded).toHaveLength(3);
      expect(qualifiedOnly).toHaveLength(1);

      const referrerWallet = await prisma.wallet.findUniqueOrThrow({
        where: { id: referrer.wallet.id },
      });
      expect(referrerWallet.lifetimeEarned.toFixed(4)).toBe(
        (Number(rewardAmount) * 3).toFixed(4),
      );
    });
  });
});
