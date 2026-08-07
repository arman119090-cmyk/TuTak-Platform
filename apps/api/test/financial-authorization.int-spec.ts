import { ForbiddenException } from '@nestjs/common';
import { PermissionName, PrismaClient, RoleName } from '@prisma/client';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { PaymentsController } from '../src/modules/payments/payments.controller';
import { PayoutsController } from '../src/modules/payouts/payouts.controller';
import { ReconciliationController } from '../src/modules/reconciliation/reconciliation.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Who may move money.
 *
 * The financial engines were built before they had any HTTP surface, so
 * every authorization decision on them is new code and none of it has the
 * benefit of having been attacked before. Two classes of mistake are worth
 * testing for specifically:
 *
 *  1. **Reading across a scope boundary.** One partner seeing another's
 *     balance, settlements or payouts. `assertPartnerScope` exists for
 *     exactly this and the audit history (§H5) records that having the
 *     helper is not the same as calling it.
 *  2. **Trusting the body over the token.** A payment that takes `userId`
 *     from the request is one account charging another's card.
 *
 * Permission enforcement itself (`@RequirePermissions`) is a global guard
 * and is covered by its own suite; what is asserted here is that the right
 * permission is demanded on the right route, read off the metadata, plus the
 * scope checks the guards cannot express.
 */
describe('Financial endpoint authorization (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let paymentsController: PaymentsController;
  let payoutsController: PayoutsController;
  let payments: PaymentEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    paymentsController = harness.app.get(PaymentsController);
    payoutsController = harness.app.get(PayoutsController);
    payments = harness.app.get(PaymentEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const actor = (
    id: string,
    roles: RoleName[] = [RoleName.CUSTOMER],
    partnerScopes: Record<string, string[]> = {},
  ): RequestUser => ({
    id,
    phone: '+37400000000',
    roles,
    permissions: [],
    partnerScopes,
    mustChangePassword: false,
  });

  /** The permission a route demands, read off the decorator's metadata. */
  const permissionsOn = (controller: object, method: string): PermissionName[] =>
    (Reflect.getMetadata(
      'permissions',
      (controller as Record<string, unknown>)[method] as object,
    ) as PermissionName[]) ?? [];

  // ── Partner scope ─────────────────────────────────────────────────────

  describe('partner-scoped reads', () => {
    it('lets a partner owner read their own balance', async () => {
      const partner = await createPartner(prisma);
      const { user } = await createCustomer(prisma);

      const result = await payoutsController.balance(
        actor(user.id, [RoleName.PARTNER_OWNER], { PARTNER_OWNER: [partner.id] }),
        partner.id,
      );

      expect(result.partnerId).toBe(partner.id);
      expect(result.availableBalance).toBe('0.0000');
    });

    it('refuses a partner owner reading another partner’s balance', async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });
      const theirs = await createPartner(prisma, { displayName: 'Theirs' });
      const { user } = await createCustomer(prisma);

      await expect(
        payoutsController.balance(
          actor(user.id, [RoleName.PARTNER_OWNER], { PARTNER_OWNER: [mine.id] }),
          theirs.id,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a partner owner reading another partner’s settlements and payouts', async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });
      const theirs = await createPartner(prisma, { displayName: 'Theirs' });
      const { user } = await createCustomer(prisma);
      const scoped = actor(user.id, [RoleName.PARTNER_OWNER], { PARTNER_OWNER: [mine.id] });

      await expect(payoutsController.settlements(scoped, theirs.id)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(payoutsController.list(scoped, theirs.id)).rejects.toThrow(ForbiddenException);
    });

    it('refuses an ordinary customer reading any partner’s balance', async () => {
      const partner = await createPartner(prisma);
      const { user } = await createCustomer(prisma);

      await expect(
        payoutsController.balance(actor(user.id), partner.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a platform admin read any partner’s balance', async () => {
      const partner = await createPartner(prisma);
      const { user } = await createCustomer(prisma);

      const result = await payoutsController.balance(
        actor(user.id, [RoleName.SUPER_ADMIN]),
        partner.id,
      );
      expect(result.partnerId).toBe(partner.id);
    });
  });

  // ── Payment ownership ─────────────────────────────────────────────────

  describe('payment ownership', () => {
    it('charges the authenticated user, never a user named in the body', async () => {
      const victim = await createCustomer(prisma);
      const attacker = await createCustomer(prisma);
      const partner = await createPartner(prisma);

      // The DTO has no userId field at all; the controller reads it off the
      // token. This asserts the resulting payment belongs to the caller.
      const result = await paymentsController.capture(actor(attacker.user.id), {
        partnerId: partner.id,
        amount: '1000',
        sourceToken: 'tok_visa_test',
        idempotencyKey: 'auth-charge-1',
      });

      const stored = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
      expect(stored.userId).toBe(attacker.user.id);
      expect(stored.userId).not.toBe(victim.user.id);
    });

    it('refuses to show a customer someone else’s payment', async () => {
      const owner = await createCustomer(prisma);
      const stranger = await createCustomer(prisma);
      const partner = await createPartner(prisma);

      const payment = await payments.capture({
        userId: owner.user.id,
        partnerId: partner.id,
        amount: '1000',
        sourceToken: 'tok_visa_test',
        idempotencyKey: 'auth-read-1',
      });

      await expect(
        paymentsController.get(actor(stranger.user.id), payment.paymentId),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        paymentsController.refundsFor(actor(stranger.user.id), payment.paymentId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets the owner and a platform admin read a payment', async () => {
      const owner = await createCustomer(prisma);
      const { user: adminUser } = await createCustomer(prisma);
      const partner = await createPartner(prisma);

      const payment = await payments.capture({
        userId: owner.user.id,
        partnerId: partner.id,
        amount: '1000',
        sourceToken: 'tok_visa_test',
        idempotencyKey: 'auth-read-2',
      });

      await expect(
        paymentsController.get(actor(owner.user.id), payment.paymentId),
      ).resolves.toMatchObject({ id: payment.paymentId });
      await expect(
        paymentsController.get(actor(adminUser.id, [RoleName.ADMIN]), payment.paymentId),
      ).resolves.toMatchObject({ id: payment.paymentId });
    });
  });

  // ── The right permission on the right route ───────────────────────────

  describe('permission requirements', () => {
    it('demands PAYOUT_MANAGE to move money to a bank', () => {
      for (const method of ['request', 'confirm', 'fail']) {
        expect(permissionsOn(payoutsController, method)).toContain(PermissionName.PAYOUT_MANAGE);
      }
    });

    it('demands LEDGER_READ to read the ledger', () => {
      const controller = harness.app.get(ReconciliationController);
      for (const method of ['accounts', 'postings', 'runs', 'run']) {
        expect(permissionsOn(controller, method)).toContain(PermissionName.LEDGER_READ);
      }
    });

    it('demands PAYOUT_MANAGE, not merely LEDGER_READ, to clear a payout block', () => {
      // Clearing a block re-opens the money tap on a partner whose balance
      // was found to be wrong. Read access to the ledger must not be enough.
      const controller = harness.app.get(ReconciliationController);
      expect(permissionsOn(controller, 'clearBlock')).toContain(PermissionName.PAYOUT_MANAGE);
      expect(permissionsOn(controller, 'clearBlock')).not.toContain(PermissionName.LEDGER_READ);
    });

    it('leaves capturing a payment open to any authenticated customer', () => {
      // Paying is not a privileged action; the guard that matters there is
      // that the payer is the caller, asserted above.
      expect(permissionsOn(paymentsController, 'capture')).toHaveLength(0);
    });
  });

  // ── Who holds what, by seeded role ────────────────────────────────────

  describe('seeded role grants', () => {
    it('does not give ADMIN the ability to wire money out', async () => {
      // Deliberate: a payout is the least reversible action on the platform
      // and there is no maker-checker flow yet, so it stays with SUPER_ADMIN.
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { name: RoleName.ADMIN },
        include: { permissions: { include: { permission: true } } },
      });
      const held = adminRole.permissions.map((p) => p.permission.name);

      // The test harness seeds every permission onto every role, so this
      // asserts the *seed script's* intent rather than the harness fixture.
      const seedIntent = await import('../prisma/seed-permissions');
      expect(seedIntent.ROLE_PERMISSIONS.ADMIN).not.toContain(PermissionName.PAYOUT_MANAGE);
      expect(seedIntent.ROLE_PERMISSIONS.ADMIN).toContain(PermissionName.PAYMENT_REFUND);
      expect(seedIntent.ROLE_PERMISSIONS.SUPER_ADMIN).toContain(PermissionName.PAYOUT_MANAGE);
      expect(held.length).toBeGreaterThan(0);
    });
  });
});
