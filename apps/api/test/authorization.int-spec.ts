import { ForbiddenException } from '@nestjs/common';
import { PermissionName, PrismaClient, RoleName } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import {
  assertPartnerScope,
  hasPartnerScope,
  isPlatformAdmin,
  resolveOperatorPartner,
} from '../src/common/auth/partner-scope';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Regression suite for the authorization findings in docs/AUDIT_2026-08-B.md:
 * §C6 (an ADMIN could promote itself to SUPER_ADMIN) and §H5 (partner-scoped
 * roles were never actually scoped).
 */
describe('Authorization (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let admin: AdminService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    admin = harness.app.get(AdminService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const actor = (
    id: string,
    roles: RoleName[],
    partnerScopes: Record<string, string[]> = {},
  ): RequestUser => ({
    id,
    phone: '+37400000000',
    roles,
    permissions: [PermissionName.USER_MANAGE, PermissionName.EV_STATION_MANAGE],
    partnerScopes,
  });

  // ── §C6 role escalation ────────────────────────────────────────────────

  describe('role granting', () => {
    it('refuses to let an ADMIN promote anyone to SUPER_ADMIN', async () => {
      const { user: adminUser } = await createCustomer(prisma);
      const { user: target } = await createCustomer(prisma);

      // SUPER_ADMIN holds every permission, so this was a one-call takeover.
      await expect(
        admin.assignRole({ userId: target.id, role: RoleName.SUPER_ADMIN }, actor(adminUser.id, [RoleName.ADMIN])),
      ).rejects.toThrow(ForbiddenException);

      expect(await prisma.userRole.count({ where: { userId: target.id } })).toBe(0);
    });

    it('refuses to let an ADMIN promote itself', async () => {
      const { user: adminUser } = await createCustomer(prisma);

      await expect(
        admin.assignRole(
          { userId: adminUser.id, role: RoleName.SUPER_ADMIN },
          actor(adminUser.id, [RoleName.ADMIN]),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses any self-grant, even one the actor could grant to others', async () => {
      const { user: adminUser } = await createCustomer(prisma);

      // Self-granting is never legitimate: it defeats the point of an audit
      // trail that records who granted what to whom.
      await expect(
        admin.assignRole(
          { userId: adminUser.id, role: RoleName.ADMIN },
          actor(adminUser.id, [RoleName.SUPER_ADMIN]),
        ),
      ).rejects.toThrow(/cannot change your own roles/);
    });

    it('allows a SUPER_ADMIN to grant SUPER_ADMIN to someone else', async () => {
      const { user: root } = await createCustomer(prisma);
      const { user: target } = await createCustomer(prisma);

      const granted = await admin.assignRole(
        { userId: target.id, role: RoleName.SUPER_ADMIN },
        actor(root.id, [RoleName.SUPER_ADMIN]),
      );
      expect(granted.userId).toBe(target.id);
    });

    it('allows an ADMIN to grant roles at or below its own level', async () => {
      const { user: adminUser } = await createCustomer(prisma);
      const { user: target } = await createCustomer(prisma);
      const partner = await createPartner(prisma);

      await expect(
        admin.assignRole(
          { userId: target.id, role: RoleName.PARTNER_OWNER, partnerId: partner.id },
          actor(adminUser.id, [RoleName.ADMIN]),
        ),
      ).resolves.toBeDefined();
    });

    it('refuses a partner-scoped role with no partner, and a global role with one', async () => {
      const { user: adminUser } = await createCustomer(prisma);
      const { user: target } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const granter = actor(adminUser.id, [RoleName.SUPER_ADMIN]);

      // A PARTNER_OWNER of nothing, or a CUSTOMER of one partner, are both
      // nonsense states that the scope checks would then have to interpret.
      await expect(
        admin.assignRole({ userId: target.id, role: RoleName.PARTNER_OWNER }, granter),
      ).rejects.toThrow(/requires a partnerId/);
      await expect(
        admin.assignRole(
          { userId: target.id, role: RoleName.CUSTOMER, partnerId: partner.id },
          granter,
        ),
      ).rejects.toThrow(/cannot be scoped to a partner/);
    });

    it('still grants idempotently', async () => {
      const { user: adminUser } = await createCustomer(prisma);
      const { user: target } = await createCustomer(prisma);
      const granter = actor(adminUser.id, [RoleName.ADMIN]);

      const first = await admin.assignRole({ userId: target.id, role: RoleName.CUSTOMER }, granter);
      const second = await admin.assignRole({ userId: target.id, role: RoleName.CUSTOMER }, granter);
      expect(second.id).toBe(first.id);
      expect(await prisma.userRole.count({ where: { userId: target.id } })).toBe(1);
    });

    it('refuses to revoke the last SUPER_ADMIN', async () => {
      const { user: root } = await createCustomer(prisma);
      const { user: other } = await createCustomer(prisma);
      const granter = actor(other.id, [RoleName.SUPER_ADMIN]);
      await admin.assignRole({ userId: root.id, role: RoleName.SUPER_ADMIN }, granter);

      // Locking every operator out of the platform is not a recoverable state.
      await expect(
        admin.revokeRole(root.id, RoleName.SUPER_ADMIN, undefined, granter),
      ).rejects.toThrow(/last SUPER_ADMIN/);
    });
  });

  // ── §H5 partner scope ──────────────────────────────────────────────────

  describe('partner scope helpers', () => {
    const owner = actor('u1', [RoleName.PARTNER_OWNER], { PARTNER_OWNER: ['partner-a'] });

    it('permits a partner to act on itself', () => {
      expect(hasPartnerScope(owner, 'partner-a')).toBe(true);
      expect(() => assertPartnerScope(owner, 'partner-a')).not.toThrow();
    });

    it('refuses a partner acting on another partner', () => {
      expect(hasPartnerScope(owner, 'partner-b')).toBe(false);
      expect(() => assertPartnerScope(owner, 'partner-b')).toThrow(ForbiddenException);
    });

    it('lets a platform admin act on any partner', () => {
      const root = actor('u2', [RoleName.ADMIN]);
      expect(isPlatformAdmin(root)).toBe(true);
      expect(() => assertPartnerScope(root, 'partner-z')).not.toThrow();
    });

    it('treats a plain customer as neither operator nor admin', () => {
      const customer: RequestUser = {
        id: 'u3',
        phone: '+37400000000',
        roles: [RoleName.CUSTOMER],
        permissions: [],
        partnerScopes: {},
      };
      expect(resolveOperatorPartner(customer)).toBeNull();
      expect(hasPartnerScope(customer, 'partner-a')).toBe(false);
    });

    it('does not treat a platform admin as a charge-point operator', () => {
      // Admins hold EV_STATION_MANAGE but are not a charge point; letting them
      // write meter values against arbitrary sessions would reopen §C1.
      expect(resolveOperatorPartner(actor('u4', [RoleName.ADMIN]))).toBeNull();
    });

    it('resolves the operator partner for a scoped station manager', () => {
      expect(resolveOperatorPartner(owner)).toBe('partner-a');
    });
  });
});
