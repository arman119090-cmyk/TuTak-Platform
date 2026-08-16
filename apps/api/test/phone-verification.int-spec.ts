import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaClient, TransactionType } from '@prisma/client';
import { PhoneVerificationService } from '../src/modules/auth/phone-verification.service';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
import { ReferralService } from '../src/modules/referral/referral.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { sha256Hex } from '../src/common/utils/crypto';
import { createCustomer, createDynamicInvoiceQr, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * Phone ownership.
 *
 * `isPhoneVerified` existed from the first schema and was never set and never
 * read, so any well-formed `+374XXXXXXXX` string produced a funded wallet.
 * Individual abuse paths were closed one at a time, but fabricating the
 * accounts to walk through them stayed free — which is what made every one of
 * them repeatable at scale.
 *
 * The gate is on *earning*, not on using the app. Paying and spending cost the
 * customer money and stay open; acquiring points is the only direction a free
 * account is profitable in.
 */
describe('Phone verification (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let verification: PhoneVerificationService;
  let qrPayments: QrPaymentsService;
  let referral: ReferralService;
  let transactions: TransactionsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    verification = harness.app.get(PhoneVerificationService);
    qrPayments = harness.app.get(QrPaymentsService);
    referral = harness.app.get(ReferralService);
    transactions = harness.app.get(TransactionsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** Reads the code out of the notification the request produced. */
  const deliveredCode = async (userId: string) => {
    const note = await prisma.notification.findFirstOrThrow({
      where: { userId, titleKey: 'notifications.phoneVerificationTitle' },
      orderBy: { createdAt: 'desc' },
    });
    return (note.params as { code: string }).code;
  };

  const unverified = () => createCustomer(prisma, { isPhoneVerified: false });

  // ── The challenge ──────────────────────────────────────────────────────

  describe('the code', () => {
    it('verifies a number end to end', async () => {
      const { user } = await unverified();

      await verification.request(user.id);
      await verification.confirm(user.id, await deliveredCode(user.id));

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isPhoneVerified,
      ).toBe(true);
    });

    it('stores only the hash', async () => {
      const { user } = await unverified();
      await verification.request(user.id);
      const code = await deliveredCode(user.id);

      const row = await prisma.phoneVerificationToken.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(row.codeHash).toBe(sha256Hex(code));
      expect(row.codeHash).not.toBe(code);
    });

    it('refuses a wrong code and burns the challenge after five tries', async () => {
      const { user } = await unverified();
      await verification.request(user.id);
      const code = await deliveredCode(user.id);

      for (let i = 0; i < 5; i += 1) {
        await expect(verification.confirm(user.id, '000000')).rejects.toThrow(
          UnauthorizedException,
        );
      }
      await expect(verification.confirm(user.id, code)).rejects.toThrow(UnauthorizedException);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isPhoneVerified,
      ).toBe(false);
    });

    it('bounds guessing across challenges, not just within one', async () => {
      const { user } = await unverified();

      for (let round = 0; round < 3; round += 1) {
        await verification.request(user.id);
        for (let i = 0; i < 5; i += 1) {
          await verification.confirm(user.id, '000000').catch(() => undefined);
        }
      }

      // A fresh challenge must not buy five more guesses indefinitely.
      await verification.request(user.id);
      await expect(
        verification.confirm(user.id, await deliveredCode(user.id)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuses to issue more than five codes an hour', async () => {
      const { user } = await unverified();
      for (let i = 0; i < 5; i += 1) await verification.request(user.id);

      await expect(verification.request(user.id)).rejects.toThrow(/Too many verification codes/);
    });

    it('refuses a code that has expired', async () => {
      const { user } = await unverified();
      await verification.request(user.id);
      const code = await deliveredCode(user.id);
      await prisma.phoneVerificationToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(verification.confirm(user.id, code)).rejects.toThrow(UnauthorizedException);
    });

    it('refuses to re-verify an already verified number', async () => {
      const { user } = await createCustomer(prisma);
      await expect(verification.request(user.id)).rejects.toThrow(/already verified/);
    });

    it('cannot be replayed', async () => {
      const { user } = await unverified();
      await verification.request(user.id);
      const code = await deliveredCode(user.id);
      await verification.confirm(user.id, code);

      await expect(verification.confirm(user.id, code)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── What verification gates ────────────────────────────────────────────

  describe('the earning gate', () => {
    it('lets an unverified customer pay, but not earn', async () => {
      const { user, wallet } = await unverified();
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '10000' });

      // The payment succeeds — refusing it would punish the customer for a
      // step they have not been asked to take yet.
      const result = await qrPayments.redeem(
        { token: qr.token, idempotencyKey: 'unverified-1' },
        user.id,
      );
      expect(result.amountCharged).toBe('10000');
      expect(result.bonusEarned).toBe('0');

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('starts accruing as soon as the number is verified', async () => {
      const { user, wallet } = await unverified();
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });

      await verification.request(user.id);
      await verification.confirm(user.id, await deliveredCode(user.id));

      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '10000' });
      const result = await qrPayments.redeem(
        { token: qr.token, idempotencyKey: 'verified-1' },
        user.id,
      );

      expect(result.bonusEarned).toBe('500');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('refuses a Referral Challenge reward when either side is unverified', async () => {
      const referrer = await unverified();
      const referee = await createCustomer(prisma);
      await prisma.referralInvite.create({
        data: { referrerUserId: referrer.user.id, refereeUserId: referee.user.id },
      });
      const participant = await prisma.referralChallengeParticipant.create({
        data: {
          referrerUserId: referrer.user.id,
          refereeUserId: referee.user.id,
          requiredAmount: '10000',
        },
      });

      const partner = await createPartner(prisma);
      const tx = await transactions.create({
        userId: referee.user.id,
        partnerId: partner.id,
        type: TransactionType.QR_PAYMENT,
        amount: '10000',
      });
      await transactions.markCompleted(tx.id);

      // An unverified referrer is a farm's collection account. Progress
      // still crosses the threshold — the gate is on the reward, not on
      // whether a real purchase happened — but stays IN_PROGRESS rather
      // than being claimed, so a later purchase after verification can still
      // reward it.
      await referral.advanceChallengeProgress(referee.user.id, tx.id);
      expect((await prisma.referralChallengeParticipant.findUniqueOrThrow({ where: { id: participant.id } })).status).toBe(
        'IN_PROGRESS',
      );
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { id: referrer.wallet.id } }))
          .lifetimeEarned.toFixed(4),
      ).toBe('0.0000');
    });

    it('pays the Referral Challenge once both sides are verified', async () => {
      const referrer = await createCustomer(prisma);
      const referee = await createCustomer(prisma);
      await prisma.referralInvite.create({
        data: { referrerUserId: referrer.user.id, refereeUserId: referee.user.id },
      });
      await prisma.referralChallengeParticipant.create({
        data: {
          referrerUserId: referrer.user.id,
          refereeUserId: referee.user.id,
          requiredAmount: '10000',
        },
      });

      const partner = await createPartner(prisma);
      const tx = await transactions.create({
        userId: referee.user.id,
        partnerId: partner.id,
        type: TransactionType.QR_PAYMENT,
        amount: '10000',
      });
      await transactions.markCompleted(tx.id);
      await referral.advanceChallengeProgress(referee.user.id, tx.id);

      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { id: referrer.wallet.id } }))
          .lifetimeEarned.toFixed(4),
      ).toBe('1000.0000');
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { id: referee.wallet.id } }))
          .lifetimeEarned.toFixed(4),
      ).toBe('1000.0000');
    });

    it('reports the gate directly', async () => {
      const { user } = await unverified();
      await expect(verification.assertCanEarn(user.id)).rejects.toThrow(BadRequestException);

      const { user: ok } = await createCustomer(prisma);
      await expect(verification.assertCanEarn(ok.id)).resolves.toBeUndefined();
    });
  });
});
