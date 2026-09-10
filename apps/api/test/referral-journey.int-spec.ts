import { PrismaClient, ReferralChallengeParticipantStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../src/config/configuration';
import { AuthService } from '../src/modules/auth/auth.service';
import { OutboxService } from '../src/modules/ledger/outbox.service';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
import { ReferralService } from '../src/modules/referral/referral.service';
import { SMS_PROVIDER, SmsProvider } from '../src/infrastructure/sms/sms-provider.interface';
import { createDynamicInvoiceQr, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * The invite journey exactly as a customer performs it, end to end.
 *
 * `referral-abuse.int-spec.ts` proves the *rules* — self-referral, the
 * double-reward race, the slot cap — but it reaches the referral service by
 * calling `advanceChallengeProgress` itself. That leaves the one link a
 * customer actually depends on untested: nothing in the request path calls
 * that method. `TransactionsService.markCompleted` writes an outbox row,
 * `ReferralListener` registers a handler for it, and a sweep drains the
 * outbox — three components whose wiring is exercised nowhere. Wired wrongly
 * (a typo'd event name, a listener never registered, a module not imported)
 * every unit test still passes and no referral is ever rewarded in
 * production, silently.
 *
 * So this suite starts from a real OTP registration carrying a referral code
 * and ends at both wallets, touching nothing but what a phone would touch —
 * plus `outbox.drain()`, which stands in for the sweep the harness
 * deliberately does not run (see `harness.ts` on why `SweepsModule` is
 * excluded).
 */
describe('Referral journey, invite to reward (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let auth: AuthService;
  let referral: ReferralService;
  let qrPayments: QrPaymentsService;
  let outbox: OutboxService;
  let sms: SmsProvider;
  let qualificationAmount: string;
  let rewardAmount: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    auth = harness.app.get(AuthService);
    referral = harness.app.get(ReferralService);
    qrPayments = harness.app.get(QrPaymentsService);
    outbox = harness.app.get(OutboxService);
    sms = harness.app.get<SmsProvider>(SMS_PROVIDER);
    const config = harness.app.get<ConfigService<AppConfig, true>>(ConfigService);
    qualificationAmount = config.get('purchasePolicy.challengeQualificationAmount', { infer: true });
    rewardAmount = config.get('purchasePolicy.challengeRewardAmount', { infer: true });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  const randomPhone = () => `+3746${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;

  /** The code as the handset receives it — the database stores only its hash. */
  const captureCode = (): (() => string) => {
    const spy = jest.spyOn(sms, 'send');
    return () => {
      const body = spy.mock.calls.at(-1)?.[0]?.body ?? '';
      const match = body.match(/(\d{6})/);
      if (!match?.[1]) throw new Error('no code found in SMS body');
      return match[1];
    };
  };

  /** Registration precisely as the app performs it: request a code, then send it back. */
  const registerByOtp = async (referralCode?: string) => {
    const phone = randomPhone();
    const lastCode = captureCode();
    await auth.requestRegistrationOtp({ phone });
    const { user } = await auth.verifyRegistrationOtp(
      {
        phone,
        code: lastCode(),
        deviceId: `device-${phone}`,
        ...(referralCode ? { referralCode } : {}),
      },
      {},
    );
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    return { userId: user.id, phone, wallet };
  };

  /**
   * A purchase with nothing simulated: the partner issues an invoice QR, the
   * customer redeems it, and the outbox is drained the way the sweep drains
   * it. No referral method is called by name anywhere in here.
   */
  const payAtPartner = async (userId: string, amount: string, bonusAccrualRateBps = 500) => {
    const partner = await createPartner(prisma, { bonusAccrualRateBps });
    const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount });
    const result = await qrPayments.redeem(
      { token: qr.token, idempotencyKey: `pay-${qr.token}` },
      userId,
    );
    await outbox.drain();
    return result;
  };

  it('binds a friend to the inviter at registration and shows them on the inviter list', async () => {
    const alice = await registerByOtp();
    const aliceCode = await referral.getMyCode(alice.userId);

    const bob = await registerByOtp(aliceCode.code);

    const invites = await referral.listMyInvites(alice.userId);
    expect(invites).toHaveLength(1);
    expect(invites[0]?.refereeUserId).toBe(bob.userId);

    // The Challenge slot opens at registration, not at the first purchase —
    // otherwise a friend who never buys would leave no trace to reward.
    const participant = await prisma.referralChallengeParticipant.findUniqueOrThrow({
      where: { refereeUserId: bob.userId },
    });
    expect(participant.referrerUserId).toBe(alice.userId);
    expect(participant.status).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);
    expect(participant.requiredAmount.toFixed(4)).toBe(`${Number(qualificationAmount).toFixed(4)}`);
  });

  it('pays the buyer their own bonus on a QR payment at the partner rate', async () => {
    const buyer = await registerByOtp();

    // 5% of 4000 = 200, and the buyer paid no bonus, so the whole amount earns.
    const result = await payAtPartner(buyer.userId, '4000', 500);
    expect(result.bonusEarned).toBe('200');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: buyer.wallet.id } });
    expect(wallet.lifetimeEarned.toFixed(4)).toBe('200.0000');
    await assertWalletIntegrity(prisma, wallet.id);
  });

  it('carries a completed purchase to the referral challenge through the outbox alone', async () => {
    const alice = await registerByOtp();
    const aliceCode = await referral.getMyCode(alice.userId);
    const bob = await registerByOtp(aliceCode.code);

    await payAtPartner(bob.userId, '4000');

    const participant = await prisma.referralChallengeParticipant.findUniqueOrThrow({
      where: { refereeUserId: bob.userId },
    });
    // Below the threshold: progress moved, nobody was paid.
    expect(participant.progressAmount.toFixed(4)).toBe('4000.0000');
    expect(participant.status).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);

    const aliceWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: alice.wallet.id } });
    expect(aliceWallet.lifetimeEarned.toFixed(4)).toBe('0.0000');
  });

  it('rewards inviter and friend once the friend crosses the threshold', async () => {
    const alice = await registerByOtp();
    const aliceCode = await referral.getMyCode(alice.userId);
    const bob = await registerByOtp(aliceCode.code);

    // Cumulative across two visits, which is what the rules allow.
    await payAtPartner(bob.userId, '4000');
    await payAtPartner(bob.userId, '6000');

    const participant = await prisma.referralChallengeParticipant.findUniqueOrThrow({
      where: { refereeUserId: bob.userId },
    });
    expect(participant.status).toBe(ReferralChallengeParticipantStatus.REWARDED);

    const reward = Number(rewardAmount);
    const aliceWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: alice.wallet.id } });
    const bobWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: bob.wallet.id } });

    // Alice bought nothing, so her whole balance is the referral reward.
    expect(aliceWallet.lifetimeEarned.toFixed(4)).toBe(reward.toFixed(4));
    // Bob earned 5% of 4000 and of 6000 on top of the same reward.
    expect(bobWallet.lifetimeEarned.toFixed(4)).toBe((reward + 200 + 300).toFixed(4));

    await assertWalletIntegrity(prisma, alice.wallet.id);
    await assertWalletIntegrity(prisma, bob.wallet.id);
  });

  it('does not reward an inviter whose friend registered without the code', async () => {
    const alice = await registerByOtp();
    await referral.getMyCode(alice.userId);
    const stranger = await registerByOtp();

    await payAtPartner(stranger.userId, '20000');

    expect(await prisma.referralChallengeParticipant.count()).toBe(0);
    const aliceWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: alice.wallet.id } });
    expect(aliceWallet.lifetimeEarned.toFixed(4)).toBe('0.0000');
  });
});
