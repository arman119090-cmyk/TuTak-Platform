import { permissionsFor, roleHasPermission } from '@cashout/contracts';
import { totpCode } from '../../src/modules/admin/totp';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import {
  createHarness,
  Harness,
  requestWithdrawal,
  resetDatabase,
  seedDriver,
  SeededDriver,
  seedPricing,
} from '../harness';

describe('the admin surface and reconciliation', () => {
  let harness: Harness;
  let driver: SeededDriver;
  let crypto: CryptoService;

  beforeAll(async () => {
    harness = await createHarness();
    crypto = harness.app.get(CryptoService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    await harness.rateLimiter.resetAll();
    harness.yandex.reset();
    harness.provider.reset();
    await seedPricing(harness.prisma);
    driver = await seedDriver(harness, { balance: 5_000_000n });
  });

  async function createAdmin(role: 'VIEWER' | 'OPERATOR' | 'FINANCE' | 'ADMIN', withMfa = true) {
    const email = `${role.toLowerCase()}@cashout.test`;
    const password = 'correct-horse-battery-staple';
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    return {
      email,
      password,
      secret,
      row: await harness.prisma.adminUser.create({
        data: {
          email,
          passwordHash: crypto.hashSecret(password),
          role,
          mfaSecretEnc: withMfa ? crypto.encrypt(secret) : null,
          mfaEnabledAt: withMfa ? new Date() : null,
        },
      }),
    };
  }

  describe('admin sign-in', () => {
    it('requires the second factor for any role that can act', async () => {
      const admin = await createAdmin('OPERATOR');
      await expect(
        harness.adminAuth.signIn(admin.email, admin.password),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

      const session = await harness.adminAuth.signIn(
        admin.email,
        admin.password,
        totpCode(admin.secret, harness.clock.nowMs()),
      );
      expect(session.token).toBeTruthy();
      expect(session.admin.role).toBe('OPERATOR');
    });

    it('refuses to let a money role sign in with no second factor configured', async () => {
      const admin = await createAdmin('FINANCE', false);
      await expect(
        harness.adminAuth.signIn(admin.email, admin.password, '000000'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('gives the same answer for a wrong password and an unknown account', async () => {
      const admin = await createAdmin('ADMIN');
      const wrongPassword = harness.adminAuth
        .signIn(admin.email, 'nope', totpCode(admin.secret, harness.clock.nowMs()))
        .catch((error: { code: string; message: string }) => error);
      const unknownAccount = harness.adminAuth
        .signIn('nobody@cashout.test', 'nope', '000000')
        .catch((error: { code: string; message: string }) => error);

      const [a, b] = await Promise.all([wrongPassword, unknownAccount]);
      expect(a.message).toBe(b.message);
      expect(a.code).toBe(b.code);
    });

    it('locks the account after repeated failures', async () => {
      const admin = await createAdmin('ADMIN');
      for (let i = 0; i < 5; i += 1) {
        await expect(harness.adminAuth.signIn(admin.email, 'nope', '000000')).rejects.toBeDefined();
      }
      await expect(
        harness.adminAuth.signIn(
          admin.email,
          admin.password,
          totpCode(admin.secret, harness.clock.nowMs()),
        ),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('rejects a revoked session token immediately', async () => {
      const admin = await createAdmin('ADMIN');
      const session = await harness.adminAuth.signIn(
        admin.email,
        admin.password,
        totpCode(admin.secret, harness.clock.nowMs()),
      );
      await expect(harness.adminAuth.verifySessionToken(session.token)).resolves.toBeDefined();

      await harness.adminAuth.signOut(session.sessionId);
      await expect(harness.adminAuth.verifySessionToken(session.token)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });
  });

  describe('role permissions', () => {
    it('keeps a viewer away from anything that changes state', () => {
      for (const permission of permissionsFor('VIEWER')) {
        expect(permission.endsWith(':read')).toBe(true);
      }
      expect(roleHasPermission('VIEWER', 'withdrawals:resolve')).toBe(false);
      expect(roleHasPermission('VIEWER', 'ledger:adjust')).toBe(false);
    });

    it('keeps pricing away from operators and user administration away from finance', () => {
      expect(roleHasPermission('OPERATOR', 'fees:write')).toBe(false);
      expect(roleHasPermission('FINANCE', 'admins:write')).toBe(false);
    });
  });

  describe('resolving a withdrawal that needs a human', () => {
    async function stuckWithdrawal() {
      harness.yandex.behaviour = { mode: 'timeout' };
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      for (let i = 0; i < 12; i += 1) {
        await harness.prisma.withdrawal.updateMany({
          where: { id: created.id },
          data: { nextAttemptAt: null },
        });
        await harness.orchestrator.advance(created.id, 2);
      }
      const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.state).toBe('MANUAL_REVIEW');
      return row;
    }

    it('refuses to mark a payout complete without evidence', async () => {
      const withdrawal = await stuckWithdrawal();
      await expect(
        harness.admin.resolveManualReview(withdrawal.id, 'admin-1', {
          resolution: 'MARK_COMPLETED',
          reason: 'I checked the bank dashboard and it went through',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('records who decided, why, and on what evidence', async () => {
      const withdrawal = await stuckWithdrawal();
      await harness.admin.resolveManualReview(withdrawal.id, 'admin-1', {
        resolution: 'MARK_FAILED',
        reason: 'Yandex confirmed by email that no transaction exists',
      });

      const after = await harness.prisma.withdrawal.findUniqueOrThrow({
        where: { id: withdrawal.id },
      });
      expect(after.state).toBe('FAILED');

      const audit = await harness.prisma.auditLog.findFirst({
        where: { subjectId: withdrawal.id, action: { contains: 'manual_review' } },
      });
      expect(audit?.actorId).toBe('admin-1');
      expect(audit?.reason).toMatch(/Yandex confirmed/);

      const event = await harness.prisma.withdrawalEvent.findFirst({
        where: { withdrawalId: withdrawal.id, toState: 'FAILED' },
      });
      expect(event?.actorType).toBe('ADMIN');
    });

    it('refuses to resolve a withdrawal that is not under review', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await harness.orchestrator.advance(created.id, 8);

      await expect(
        harness.admin.resolveManualReview(created.id, 'admin-1', {
          resolution: 'MARK_FAILED',
          reason: 'trying to meddle with a finished withdrawal',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('the dashboard', () => {
    it('reports volume, revenue and anything that needs attention', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await harness.orchestrator.advance(created.id, 8);

      const metrics = await harness.admin.dashboard('24h');
      expect(metrics.withdrawalsCount).toBe(1);
      expect(metrics.withdrawalsVolume).toEqual({ minor: '1000000', currency: 'AMD' });
      expect(metrics.platformRevenue).toEqual({ minor: '25000', currency: 'AMD' });
      expect(metrics.successRatePpm).toBe(1_000_000);
      expect(metrics.inFlightCount).toBe(0);
      expect(metrics.suspenseBalance).toEqual({ minor: '0', currency: 'AMD' });
    });
  });

  describe('reconciliation', () => {
    it('is clean after a normal withdrawal', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await harness.orchestrator.advance(created.id, 8);

      expect((await harness.reconciliation.runLedger()).mismatches).toBe(0);
      expect((await harness.reconciliation.runYandex()).mismatches).toBe(0);
      expect((await harness.reconciliation.runProvider()).mismatches).toBe(0);
    });

    it('notices a withdrawal whose Yandex debit does not exist', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await harness.orchestrator.advance(created.id, 8);

      // The park's history loses the transaction — the shape of a Yandex-side
      // rollback, or of a debit we only believed we made.
      harness.yandex.reset();

      const result = await harness.reconciliation.runYandex();
      expect(result.mismatches).toBe(1);

      const open = await harness.reconciliation.openMismatches();
      expect(open[0]?.kind).toBe('yandex_debit_missing');
      expect(open[0]?.withdrawalId).toBe(created.id);
    });

    it('notices a reversed withdrawal that the bank actually settled', async () => {
      harness.provider.behaviour = { mode: 'confirm' };
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await harness.orchestrator.advance(created.id, 8);

      // Somebody marked it reversed although the transfer really went out.
      await harness.prisma.withdrawal.updateMany({
        where: { id: created.id },
        data: { state: 'REVERSED' },
      });

      const result = await harness.reconciliation.runProvider();
      const open = await harness.reconciliation.openMismatches();
      expect(result.mismatches).toBeGreaterThan(0);
      expect(open.some((row) => row.kind === 'reversed_but_provider_settled')).toBe(true);
    });

    it('notices a completed withdrawal with missing journal entries', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await harness.orchestrator.advance(created.id, 8);

      // A crash between the settlement posting and the state change would look
      // exactly like this. The append-only triggers refuse to let even a test
      // produce it, so this one deliberately steps around them — which is
      // itself a demonstration that nothing short of replication-role
      // privileges can rewrite the ledger.
      await harness.prisma.$transaction([
        harness.prisma.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`),
        harness.prisma.$executeRawUnsafe(
          `DELETE FROM ledger_postings WHERE "journalEntryId" IN (
             SELECT id FROM journal_entries WHERE "withdrawalId" = '${created.id}'
               AND type = 'PAYOUT_SETTLEMENT')`,
        ),
        harness.prisma.$executeRawUnsafe(
          `DELETE FROM journal_entries WHERE "withdrawalId" = '${created.id}'
             AND type = 'PAYOUT_SETTLEMENT'`,
        ),
      ]);

      const result = await harness.reconciliation.runLedger();
      expect(result.mismatches).toBeGreaterThan(0);
      const open = await harness.reconciliation.openMismatches();
      expect(open.some((row) => row.kind === 'missing_journal_entries')).toBe(true);
    });

    it('can close a mismatch with a written explanation', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await harness.orchestrator.advance(created.id, 8);
      harness.yandex.reset();
      await harness.reconciliation.runYandex();

      const [mismatch] = await harness.reconciliation.openMismatches();
      await harness.reconciliation.resolveMismatch(mismatch!.id, 'Yandex support confirmed by ticket 1234');

      expect(await harness.reconciliation.openMismatches()).toHaveLength(0);
    });
  });

  describe('the ledger refuses to be rewritten', () => {
    it('rejects an attempt to edit a posting', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await harness.orchestrator.advance(created.id, 8);

      await expect(
        harness.prisma.$executeRawUnsafe(`UPDATE ledger_postings SET "amountMinor" = 1`),
      ).rejects.toThrow(/append-only/);
    });

    it('rejects an attempt to delete a journal entry', async () => {
      const entry = await harness.prisma.journalEntry.create({
        data: {
          type: 'ADJUSTMENT',
          idempotencyKey: 'delete-me-if-you-can',
          description: 'a deliberately empty entry, so the failure is the trigger and not a foreign key',
        },
      });

      await expect(
        harness.prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE id = '${entry.id}'`),
      ).rejects.toThrow(/append-only/);
    });

    it('rejects an attempt to edit the audit log', async () => {
      await expect(
        harness.prisma.$executeRawUnsafe(`UPDATE audit_logs SET reason = 'nothing to see here'`),
      ).rejects.toThrow(/append-only/);
    });
  });
});
