import { PrismaClient, QrCodeType, RoleName, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AdminService } from '../src/modules/admin/admin.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
import { ReferralService } from '../src/modules/referral/referral.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createDynamicInvoiceQr, createEvConnector, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * Adversarial probe suite.
 *
 * Every test here performs an attack against the *current* code rather than
 * asserting that a past fix is still present. The distinction matters: a
 * regression test written alongside a fix tends to encode the shape of that
 * fix, so it keeps passing when a different route to the same outcome opens
 * up. These start from the attacker's goal — mint points, spend twice, act as
 * someone else — and try to reach it by any means the API allows.
 */
describe('Adversarial probe (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let qrPayments: QrPaymentsService;
  let sessions: EvSessionsService;
  let engine: BonusEngineService;
  let referral: ReferralService;
  let transactions: TransactionsService;
  let admin: AdminService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    qrPayments = harness.app.get(QrPaymentsService);
    sessions = harness.app.get(EvSessionsService);
    engine = harness.app.get(BonusEngineService);
    referral = harness.app.get(ReferralService);
    transactions = harness.app.get(TransactionsService);
    admin = harness.app.get(AdminService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const asUser = (id: string, roles: RoleName[] = [RoleName.CUSTOMER]): RequestUser => ({
    id,
    phone: '+37400000000',
    roles,
    permissions: [],
    partnerScopes: {},
    mustChangePassword: false,
  });

  /** Total points in existence across every wallet. */
  const totalIssued = async () => {
    const agg = await prisma.wallet.aggregate({
      _sum: { availableBonus: true, pendingBonus: true, reservedBonus: true },
    });
    return (agg._sum.availableBonus ?? new Decimal(0))
      .plus(agg._sum.pendingBonus ?? new Decimal(0))
      .plus(agg._sum.reservedBonus ?? new Decimal(0));
  };

  // ── Bonus inflation ────────────────────────────────────────────────────

  describe('bonus inflation', () => {
    it('cannot mint through a merchant invoice loop', async () => {
      const { user: staff, wallet: staffWallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 10_000 });
      await prisma.partnerMembership.create({
        data: { partnerId: partner.id, userId: staff.id },
      });

      const before = await totalIssued();
      for (let i = 0; i < 5; i += 1) {
        const code = await qrPayments.issue(
          { type: QrCodeType.DYNAMIC_INVOICE, partnerId: partner.id, amount: '1000000' },
          asUser(staff.id, [RoleName.PARTNER_OWNER]),
        );
        await qrPayments
          .redeem({ token: code.token, idempotencyKey: `loop-${i}` }, staff.id)
          .catch(() => undefined);
      }

      expect((await totalIssued()).toFixed(4)).toBe(before.toFixed(4));
      await assertWalletIntegrity(prisma, staffWallet.id);
    });

    it('cannot mint through repeated EV sessions on one connector', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 10_000 });
      const connector = await createEvConnector(prisma, {
        partnerId: partner.id,
        pricePerKwh: '100.00',
      });

      // Ten sessions, each claiming the maximum the guard permits. The point
      // is the ceiling: whatever an attacker can extract must be bounded by
      // physics, not by how many times they are willing to press the button.
      for (let i = 0; i < 10; i += 1) {
        const session = await sessions
          .start({ connectorId: connector.id }, user.id)
          .catch(() => null);
        if (!session) continue;
        await prisma.evSession.update({
          where: { id: session.id },
          data: { startedAt: new Date(Date.now() - 3_600_000) },
        });
        await sessions.reportMeterValue(session.id, '9999999', user.id).catch(() => undefined);
        await sessions.stop(session.id, user.id, {}).catch(() => undefined);
      }

      // 50 kW for an hour, 100 AMD/kWh, at a 100% rate is ~5,750 a session.
      // Ten of those is the honest ceiling; anything far above means a claim
      // larger than the connector could deliver got through.
      const issued = await totalIssued();
      expect(issued.lessThan(new Decimal('100000'))).toBe(true);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('cannot mint by driving the accrual rate above 100%', async () => {
      const partner = await createPartner(prisma);
      // The CHECK constraint is the last line: even a direct write is refused.
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "partners" SET "bonusAccrualRateBps" = 1000000 WHERE id = '${partner.id}'`,
        ),
      ).rejects.toThrow();
    });
  });

  // ── Double spending and replay ─────────────────────────────────────────

  describe('double spending', () => {
    const funded = async (amount: string) => {
      const { user, wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: 'ACCRUAL_PURCHASE',
        amount,
        pendingHours: 0,
      });
      return { user, wallet };
    };

    it('cannot spend the same points on two concurrent payments', async () => {
      const { user, wallet } = await funded('1000');
      const partner = await createPartner(prisma);
      const a = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });
      const b = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });

      const results = await Promise.allSettled([
        qrPayments.redeem(
          { token: a.token, bonusAmountToApply: '1000', idempotencyKey: 'ds-a' },
          user.id,
        ),
        qrPayments.redeem(
          { token: b.token, bonusAmountToApply: '1000', idempotencyKey: 'ds-b' },
          user.id,
        ),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.lifetimeSpent.toFixed(4)).toBe('1000.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('cannot replay a payment with the same key to spend twice', async () => {
      const { user, wallet } = await funded('1000');
      const partner = await createPartner(prisma);
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });

      await qrPayments.redeem(
        { token: qr.token, bonusAmountToApply: '500', idempotencyKey: 'replay-1' },
        user.id,
      );
      await qrPayments.redeem(
        { token: qr.token, bonusAmountToApply: '500', idempotencyKey: 'replay-1' },
        user.id,
      );

      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).lifetimeSpent.toFixed(4),
      ).toBe('500.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('cannot settle one reservation twice', async () => {
      const { wallet } = await funded('1000');
      const reservation = await engine.reserve(wallet.id, '400', 'tx-double');
      await engine.settleReservation(reservation.reservationId);

      await expect(engine.settleReservation(reservation.reservationId)).rejects.toThrow();
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).lifetimeSpent.toFixed(4),
      ).toBe('400.0000');
    });

    it('cannot claim a reversal twice for one settled spend', async () => {
      const { wallet } = await funded('1000');
      const reservation = await engine.reserve(wallet.id, '400', 'tx-rev');
      await engine.settleReservation(reservation.reservationId);

      await Promise.allSettled([
        engine.reverseSettlement(reservation.reservationId, 'a'),
        engine.reverseSettlement(reservation.reservationId, 'b'),
        engine.reverseSettlement(reservation.reservationId, 'c'),
      ]);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toFixed(4)).toBe('1000.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  // ── Wallet manipulation ────────────────────────────────────────────────

  describe('wallet manipulation', () => {
    it('cannot be driven negative by any sequence the API allows', async () => {
      const { user, wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: 'ACCRUAL_PURCHASE',
        amount: '100',
        pendingHours: 0,
      });
      const partner = await createPartner(prisma);

      for (const bonus of ['100', '100', '100']) {
        const qr = await createDynamicInvoiceQr(prisma, {
          partnerId: partner.id,
          amount: '10000',
        });
        await qrPayments
          .redeem(
            { token: qr.token, bonusAmountToApply: bonus, idempotencyKey: `neg-${bonus}-${Math.random()}` },
            user.id,
          )
          .catch(() => undefined);
      }

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.isNegative()).toBe(false);
      expect(after.reservedBonus.isNegative()).toBe(false);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('cannot write a negative balance directly', async () => {
      const { wallet } = await createCustomer(prisma);
      for (const column of ['availableBonus', 'pendingBonus', 'reservedBonus', 'lifetimeSpent']) {
        await expect(
          prisma.$executeRawUnsafe(
            `UPDATE "wallets" SET "${column}" = -1 WHERE id = '${wallet.id}'`,
          ),
        ).rejects.toThrow();
      }
    });
  });

  // ── Ledger corruption ──────────────────────────────────────────────────

  describe('ledger corruption', () => {
    it('cannot record an entry whose deltas contradict its direction', async () => {
      const { wallet } = await createCustomer(prisma);
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "bonus_ledger_entries"
             (id, "walletId", type, direction, amount, "availableDelta", "pendingDelta",
              "reservedDelta", "balanceAfter")
           VALUES (gen_random_uuid(), '${wallet.id}', 'ACCRUAL_PURCHASE', 'CREDIT', 500,
                   5000, 0, 0, 0)`,
        ),
      ).rejects.toThrow();
    });

    it('keeps the ledger reconstructing the wallet across a mixed workload', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: 'ACCRUAL_PURCHASE',
        amount: '5000',
        pendingHours: 0,
      });

      // Accrue, hold, settle, release, reverse, expire, promote, adjust — the
      // whole vocabulary in one sequence, then check the ledger still replays.
      const held = await engine.reserve(wallet.id, '500', 'mix-1');
      await engine.settleReservation(held.reservationId);
      await engine.reverseSettlement(held.reservationId, 'mixed');
      const released = await engine.reserve(wallet.id, '300', 'mix-2');
      await engine.releaseReservation(released.reservationId, 'mixed');
      await engine.manualAdjustment(wallet.id, '250', 'CREDIT', 'mixed');
      await engine.manualAdjustment(wallet.id, '100', 'DEBIT', 'mixed');
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '2000' });
      await qrPayments.redeem(
        { token: qr.token, bonusAmountToApply: '1000', idempotencyKey: 'mix-qr' },
        user.id,
      );
      await engine.promotePendingLots();
      await engine.expireLots();
      await engine.releaseExpiredReservations();

      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  // ── Privilege escalation and ownership ─────────────────────────────────

  describe('privilege escalation', () => {
    it('cannot climb from PARTNER_OWNER to ADMIN', async () => {
      const { user: owner } = await createCustomer(prisma);
      const { user: target } = await createCustomer(prisma);
      const partner = await createPartner(prisma);

      await expect(
        admin.assignRole(
          { userId: target.id, role: RoleName.ADMIN },
          asUser(owner.id, [RoleName.PARTNER_OWNER]),
        ),
      ).rejects.toThrow();
      void partner;
    });

    it('cannot grant itself anything, at any rank', async () => {
      const { user } = await createCustomer(prisma);
      for (const role of [RoleName.ADMIN, RoleName.SUPER_ADMIN, RoleName.CUSTOMER]) {
        await expect(
          admin.assignRole({ userId: user.id, role }, asUser(user.id, [RoleName.SUPER_ADMIN])),
        ).rejects.toThrow();
      }
    });
  });

  describe('session ownership', () => {
    it('cannot meter, stop or bill another customer’s session', async () => {
      const { user: victim } = await createCustomer(prisma);
      const { user: attacker } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const connector = await createEvConnector(prisma, { partnerId: partner.id });

      const session = await sessions.start({ connectorId: connector.id }, victim.id);
      await prisma.evSession.update({
        where: { id: session.id },
        data: { startedAt: new Date(Date.now() - 3_600_000) },
      });

      await expect(sessions.reportMeterValue(session.id, '40', attacker.id)).rejects.toThrow();
      await expect(sessions.stop(session.id, attacker.id, {})).rejects.toThrow();

      const untouched = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(untouched.status).toBe('CHARGING');
      expect(untouched.energyKwh?.toFixed(3)).toBe('0.000');
    });
  });

  // ── Referral farming ───────────────────────────────────────────────────

  describe('referral farming', () => {
    it('cannot farm rewards with fabricated accounts', async () => {
      const { user: farmer, wallet: farmerWallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma);

      // Twenty throwaway signups, each pointed at the farmer's code, each
      // making the cheapest single transaction that could possibly reach the
      // Referral Challenge's cumulative threshold on its own (default
      // 10 000 AMD — see purchasePolicy.challengeQualificationAmount).
      for (let i = 0; i < 20; i += 1) {
        const { user: mule } = await createCustomer(prisma, { isPhoneVerified: false });
        await prisma.referralInvite.create({
          data: { referrerUserId: farmer.id, refereeUserId: mule.id },
        });
        await prisma.referralChallengeParticipant.create({
          data: { referrerUserId: farmer.id, refereeUserId: mule.id, requiredAmount: '10000' },
        });
        const tx = await transactions.create({
          userId: mule.id,
          partnerId: partner.id,
          type: TransactionType.QR_PAYMENT,
          amount: '10000',
        });
        await transactions.markCompleted(tx.id);
        await referral.advanceChallengeProgress(mule.id, tx.id).catch(() => undefined);
      }

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: farmerWallet.id } });
      expect(after.lifetimeEarned.toFixed(4)).toBe('0.0000');
    });
  });

  // ── Accounting correctness ─────────────────────────────────────────────

  describe('accounting', () => {
    it('never issues points that no ledger entry accounts for', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });

      for (let i = 0; i < 5; i += 1) {
        const qr = await createDynamicInvoiceQr(prisma, {
          partnerId: partner.id,
          amount: '10000',
        });
        await qrPayments.redeem({ token: qr.token, idempotencyKey: `acct-${i}` }, user.id);
      }

      // Points in wallets must equal the signed sum of the ledger, platform
      // wide — not merely per wallet.
      const entries = await prisma.bonusLedgerEntry.aggregate({
        _sum: { availableDelta: true, pendingDelta: true, reservedDelta: true },
      });
      const replayed = (entries._sum.availableDelta ?? new Decimal(0))
        .plus(entries._sum.pendingDelta ?? new Decimal(0))
        .plus(entries._sum.reservedDelta ?? new Decimal(0));

      expect(replayed.toFixed(4)).toBe((await totalIssued()).toFixed(4));
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('writes an audit row for every redemption', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });
      await qrPayments.redeem({ token: qr.token, idempotencyKey: 'audit-1' }, user.id);

      expect(await prisma.auditLog.count({ where: { action: 'QR_REDEEMED' } })).toBe(1);
    });
  });
});
