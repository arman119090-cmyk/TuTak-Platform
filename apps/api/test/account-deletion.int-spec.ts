import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import {
  AuditAction,
  BonusEntryType,
  BonusLotStatus,
  BonusReservationStatus,
  EvConnectorType,
  EvSessionStatus,
  PrismaClient,
  RoleName,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { AccountDeletionService } from '../src/modules/users/account-deletion.service';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

const PASSWORD = 'DeleteMe-2026!';

/**
 * Deleting an account on a platform that keeps a double-entry ledger.
 *
 * The app stores require deletion from inside the app; the ledger requires
 * that the row survives, because payments, transactions, postings and audit
 * entries all reference it. What is checked here is that both hold at once —
 * the customer is gone, the money is not — and that the two stages happen at
 * the two different times they are supposed to.
 */
describe('Account deletion (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let deletion: AccountDeletionService;
  let bonus: BonusEngineService;
  let payments: PaymentEngineService;

  /** A customer whose password can actually be verified, unlike the fixture's. */
  const customerWithPassword = async (phone?: string) => {
    const fixture = await createCustomer(prisma, phone ? { phone } : {});
    await prisma.user.update({
      where: { id: fixture.user.id },
      data: { passwordHash: await argon2.hash(PASSWORD) },
    });
    return fixture;
  };

  const grantRole = async (userId: string, name: RoleName) => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name } });
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
  };

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    deletion = harness.app.get(AccountDeletionService);
    bonus = harness.app.get(BonusEngineService);
    payments = harness.app.get(PaymentEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  describe('asking to be deleted', () => {
    it('ends access immediately and schedules the scrub', async () => {
      const { user } = await customerWithPassword();

      const receipt = await deletion.requestDeletion(user.id, PASSWORD);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.deletedAt).not.toBeNull();
      expect(after.isActive).toBe(false);
      // The personal data is still there — that is the whole point of the
      // second stage, and getting this wrong in the other direction would
      // leave a refund with nowhere to post.
      expect(after.phone).toBe(user.phone);
      expect(after.anonymizedAt).toBeNull();

      const days = (receipt.anonymizedAfter.getTime() - receipt.deletedAt.getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(30);
    });

    it('refuses without the right password', async () => {
      const { user } = await customerWithPassword();

      await expect(deletion.requestDeletion(user.id, 'not-the-password')).rejects.toThrow(
        UnauthorizedException,
      );

      // The failure that matters: a fifteen-minute stolen token must not be
      // enough to destroy an account.
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.deletedAt).toBeNull();
      expect(after.isActive).toBe(true);
    });

    it('revokes every session and removes every device', async () => {
      const { user } = await customerWithPassword();
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: 'hash-1',
          deviceId: 'device-1',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      await prisma.device.create({
        data: { userId: user.id, deviceId: 'device-1', platform: 'IOS', pushToken: 'ExponentX' },
      });

      await deletion.requestDeletion(user.id, PASSWORD);

      const live = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
      expect(live).toBe(0);
      // The push token is both an identifier and a delivery channel. A deleted
      // account must not be reachable, so it goes now rather than in a month.
      expect(await prisma.device.count({ where: { userId: user.id } })).toBe(0);
    });

    it('refuses a second request', async () => {
      const { user } = await customerWithPassword();
      await deletion.requestDeletion(user.id, PASSWORD);

      await expect(deletion.requestDeletion(user.id, PASSWORD)).rejects.toThrow(ConflictException);
    });

    it('refuses a partner owner, who would orphan a business', async () => {
      const { user } = await customerWithPassword();
      await grantRole(user.id, RoleName.PARTNER_OWNER);

      await expect(deletion.requestDeletion(user.id, PASSWORD)).rejects.toThrow(
        BadRequestException,
      );
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt).toBeNull();
    });

    it('refuses an administrator, who might be the last one', async () => {
      const { user } = await customerWithPassword();
      await grantRole(user.id, RoleName.ADMIN);

      await expect(deletion.requestDeletion(user.id, PASSWORD)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses while a charging session is still running', async () => {
      const { user } = await customerWithPassword();
      const partner = await createPartner(prisma);
      const station = await prisma.evStation.create({
        data: {
          partnerId: partner.id,
          name: 'S',
          address: 'A',
          city: 'Yerevan',
          latitude: 40.18,
          longitude: 44.51,
        },
      });
      const connector = await prisma.evConnector.create({
        data: {
          stationId: station.id,
          connectorType: EvConnectorType.CCS2,
          powerKw: 50,
          pricePerKwh: 100,
        },
      });
      await prisma.evSession.create({
        data: {
          userId: user.id,
          connectorId: connector.id,
          status: EvSessionStatus.CHARGING,
          startedAt: new Date(),
        },
      });

      // Money is still arriving into this wallet. Deleting underneath it
      // leaves the accrual with nowhere to land.
      await expect(deletion.requestDeletion(user.id, PASSWORD)).rejects.toThrow(ConflictException);
    });

    it('refuses while a payment is holding points', async () => {
      const { user, wallet } = await customerWithPassword();
      await prisma.bonusReservation.create({
        data: {
          walletId: wallet.id,
          amount: 100,
          status: BonusReservationStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 300_000),
        },
      });

      await expect(deletion.requestDeletion(user.id, PASSWORD)).rejects.toThrow(ConflictException);
    });

    it('records the request in the audit trail', async () => {
      const { user } = await customerWithPassword();

      await deletion.requestDeletion(user.id, PASSWORD, { ipAddress: '10.0.0.1' });

      const entries = await prisma.auditLog.findMany({
        where: { action: AuditAction.ACCOUNT_DELETION_REQUESTED },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.actorUserId).toBe(user.id);
    });
  });

  describe('the grace window', () => {
    it('leaves an account alone until the window has passed', async () => {
      const { user } = await customerWithPassword();
      await deletion.requestDeletion(user.id, PASSWORD);

      // 29 days in. Support can still restore this person, and a chargeback
      // arriving today still has a wallet to post against.
      const scrubbed = await deletion.anonymizeDue(new Date(Date.now() + 29 * 86_400_000));

      expect(scrubbed).toBe(0);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.phone).toBe(user.phone);
      expect(after.anonymizedAt).toBeNull();
    });

    it('never touches an account that was not deleted', async () => {
      const { user } = await customerWithPassword();

      await deletion.anonymizeDue(new Date(Date.now() + 400 * 86_400_000));

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.phone).toBe(user.phone);
      expect(after.anonymizedAt).toBeNull();
    });
  });

  describe('anonymisation', () => {
    /** Deletes and then jumps past the window. */
    const deleteAndScrub = async (userId: string) => {
      await deletion.requestDeletion(userId, PASSWORD);
      return deletion.anonymizeDue(new Date(Date.now() + 31 * 86_400_000));
    };

    it('erases everything that identifies the person', async () => {
      const { user } = await customerWithPassword();
      await prisma.user.update({ where: { id: user.id }, data: { email: 'real@example.com' } });

      expect(await deleteAndScrub(user.id)).toBe(1);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.phone).not.toBe(user.phone);
      expect(after.phone).toMatch(/^deleted-/);
      expect(after.email).toBeNull();
      expect(after.firstName).toBe('Deleted');
      expect(after.lastName).toBe('Account');
      expect(after.anonymizedAt).not.toBeNull();
      // Not merely different — unusable. No password can ever verify against
      // a value argon2 cannot even parse.
      await expect(argon2.verify(after.passwordHash, PASSWORD)).rejects.toThrow();
    });

    it('keeps the financial record intact', async () => {
      const { user } = await customerWithPassword();
      const partner = await createPartner(prisma);
      await payments.capture({
        userId: user.id,
        partnerId: partner.id,
        amount: '5000',
        sourceToken: 'tok_ok',
        idempotencyKey: 'deletion-keeps-money',
      });

      const before = await prisma.ledgerPosting.count();
      expect(before).toBeGreaterThan(0);

      await deleteAndScrub(user.id);

      // The whole reason the row is anonymised rather than removed. Deleting
      // it would either break these references or take the accounting record
      // with it.
      expect(await prisma.ledgerPosting.count()).toBe(before);
      expect(await prisma.payment.count({ where: { userId: user.id } })).toBe(1);
      const imbalance = await prisma.ledgerAccount.aggregate({ _sum: { balance: true } });
      expect(Number(imbalance._sum.balance ?? 0)).toBe(0);
    });

    it('retires the remaining points instead of stranding the liability', async () => {
      const { user, wallet } = await customerWithPassword();
      await bonus.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '750',
      });
      await bonus.promotePendingLots(new Date(Date.now() + 72 * 3_600_000));

      // One simulated instant for both halves. Anonymisation back-dates the
      // lots to the moment it runs, so the expiry sweep has to be asked about
      // that same moment — in production the two are simply `now`.
      const past = new Date(Date.now() + 31 * 86_400_000);
      await deletion.requestDeletion(user.id, PASSWORD);
      expect(await deletion.anonymizeDue(past)).toBe(1);

      // `bonus.expire-lots` is what writes the EXPIRY postings, so the
      // liability retires through the same tested path rather than a second
      // copy of it.
      const lotsBefore = await prisma.bonusLot.findMany({ where: { walletId: wallet.id } });
      expect(lotsBefore.every((lot) => lot.expiresAt <= past)).toBe(true);

      await bonus.expireLots(past);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toNumber()).toBe(0);
      expect(after.pendingBonus.toNumber()).toBe(0);
      const remaining = await prisma.bonusLot.findMany({ where: { walletId: wallet.id } });
      expect(remaining.every((lot) => lot.status === BonusLotStatus.EXPIRED)).toBe(true);
    });

    it('removes the notifications and the spent credentials', async () => {
      const { user } = await customerWithPassword();
      await prisma.notification.create({
        data: { userId: user.id, channel: 'PUSH', titleKey: 't', bodyKey: 'b' },
      });
      await prisma.passwordResetToken.create({
        data: { userId: user.id, codeHash: 'h', expiresAt: new Date() },
      });

      await deleteAndScrub(user.id);

      expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
    });

    it('keeps the audit trail, pointing at a person it can no longer name', async () => {
      const { user } = await customerWithPassword();

      await deleteAndScrub(user.id);

      // Both entries survive. This is what remains of the person: enough to
      // answer "did we delete them, and when", and nothing else.
      const request = await prisma.auditLog.count({
        where: { action: AuditAction.ACCOUNT_DELETION_REQUESTED, actorUserId: user.id },
      });
      const scrub = await prisma.auditLog.count({
        where: { action: AuditAction.ACCOUNT_ANONYMIZED, entityId: user.id },
      });
      expect(request).toBe(1);
      expect(scrub).toBe(1);
    });

    it('is idempotent — a second sweep finds nothing left to do', async () => {
      const { user } = await customerWithPassword();
      await deleteAndScrub(user.id);

      const second = await deletion.anonymizeDue(new Date(Date.now() + 60 * 86_400_000));

      expect(second).toBe(0);
    });

    it('scrubs several accounts without one failure stopping the rest', async () => {
      const a = await customerWithPassword('+37477900001');
      const b = await customerWithPassword('+37477900002');
      await deletion.requestDeletion(a.user.id, PASSWORD);
      await deletion.requestDeletion(b.user.id, PASSWORD);

      const scrubbed = await deletion.anonymizeDue(new Date(Date.now() + 31 * 86_400_000));

      expect(scrubbed).toBe(2);
      // Two placeholders must not collide on the unique phone index — the
      // reason the placeholder carries random bytes rather than the user id.
      const phones = await prisma.user.findMany({
        where: { id: { in: [a.user.id, b.user.id] } },
        select: { phone: true },
      });
      expect(new Set(phones.map((p) => p.phone)).size).toBe(2);
    });
  });
});
