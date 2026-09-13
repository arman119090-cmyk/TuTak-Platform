import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaClient, RoleName } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { UsersService } from '../src/modules/users/users.service';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Account state must take effect immediately, not whenever the access token
 * happens to expire.
 *
 * `buildRequestUserClaims` runs on every authenticated request, so it is the
 * enforcement point. Before the hardening pass it only checked that the user
 * row existed: an administrator responding to live fraud pressed "Deactivate"
 * and the attacker kept transacting for the rest of the token's lifetime, and
 * could mint a fresh one from an un-revoked refresh token indefinitely
 * (docs/AUDIT_2026-08.md §B4).
 */
describe('Account state enforcement (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let users: UsersService;
  let admin: AdminService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    users = harness.app.get(UsersService);
    admin = harness.app.get(AdminService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** The caller `setActive` now rank-checks against. */
  const actingAs = (id: string, ...roles: RoleName[]) =>
    ({
      id,
      phone: '+37400000000',
      roles,
      permissions: [],
      partnerScopes: {},
      mustChangePassword: false,
    }) as unknown as Parameters<AdminService['setActive']>[2];

  const platformAdmin = async (role: RoleName) => {
    const { user } = await createCustomer(prisma);
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
    return user;
  };

  it('builds claims for an active account', async () => {
    const { user } = await createCustomer(prisma);
    const claims = await users.buildRequestUserClaims(user.id);
    expect(claims.id).toBe(user.id);
  });

  it('rejects a deactivated account on its very next request', async () => {
    const { user } = await createCustomer(prisma);
    await admin.setActive(user.id, false, actingAs('an-admin', RoleName.SUPER_ADMIN));

    await expect(users.buildRequestUserClaims(user.id)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a soft-deleted account', async () => {
    const { user } = await createCustomer(prisma);
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

    await expect(users.buildRequestUserClaims(user.id)).rejects.toThrow(/no longer active/);
  });

  it('rejects a locked account until the lock elapses', async () => {
    const { user } = await createCustomer(prisma);
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() + 60_000) },
    });
    await expect(users.buildRequestUserClaims(user.id)).rejects.toThrow(/temporarily locked/);

    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    await expect(users.buildRequestUserClaims(user.id)).resolves.toBeDefined();
  });

  it('revokes every refresh token when an account is deactivated', async () => {
    const { user } = await createCustomer(prisma);
    for (const suffix of ['a', 'b', 'c']) {
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: `hash-${suffix}`,
          deviceId: `device-${suffix}`,
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
      });
    }

    await admin.setActive(user.id, false, actingAs('an-admin', RoleName.SUPER_ADMIN));

    // Flagging the row alone was not enough: an un-revoked refresh token let
    // the attacker mint new access tokens after being locked out.
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      0,
    );
  });

  it('does not revoke tokens when reactivating', async () => {
    const { user } = await createCustomer(prisma);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'hash-live',
        deviceId: 'device-live',
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    await admin.setActive(user.id, true, actingAs('an-admin', RoleName.SUPER_ADMIN));
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      1,
    );
  });

  /**
   * Disabling an account is not a smaller act than removing one role from
   * it: it ends every session and locks the person out of the platform
   * entirely. `revokeRole` has been rank-checked, self-protected and
   * last-SUPER_ADMIN-protected since it was written; this door had none of
   * the three.
   */
  describe('who may disable whom', () => {
    it('refuses an ADMIN disabling a SUPER_ADMIN', async () => {
      const target = await platformAdmin(RoleName.SUPER_ADMIN);
      const other = await platformAdmin(RoleName.SUPER_ADMIN);
      expect(other.id).not.toBe(target.id); // not the last one — rank is the point here

      await expect(
        admin.setActive(target.id, false, actingAs('a-mere-admin', RoleName.ADMIN)),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(after.isActive).toBe(true);
    });

    it('refuses disabling the last active SUPER_ADMIN', async () => {
      const onlyOne = await platformAdmin(RoleName.SUPER_ADMIN);

      await expect(
        admin.setActive(onlyOne.id, false, actingAs('another-super', RoleName.SUPER_ADMIN)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an administrator disabling themselves', async () => {
      const self = await platformAdmin(RoleName.SUPER_ADMIN);
      await expect(
        admin.setActive(self.id, false, actingAs(self.id, RoleName.SUPER_ADMIN)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('never hands back the password hash', async () => {
      // An administrator is not an attacker. A hash that travels is one a
      // proxy logs, a browser caches and a ticket quotes — and offline
      // cracking does not care which of those it came from.
      const { user } = await createCustomer(prisma);
      const result = await admin.setActive(
        user.id,
        false,
        actingAs('an-admin', RoleName.SUPER_ADMIN),
      );
      expect(JSON.stringify(result)).not.toContain('passwordHash');
      expect(Object.keys(result)).not.toContain('passwordHash');
    });
  });

  it('grants a role idempotently', async () => {
    const { user } = await createCustomer(prisma);
    const { user: granter } = await createCustomer(prisma);
    const actor = {
      id: granter.id,
      phone: granter.phone,
      roles: [RoleName.SUPER_ADMIN],
      permissions: [],
      partnerScopes: {},
      mustChangePassword: false,
    };

    const first = await admin.assignRole({ userId: user.id, role: RoleName.ADMIN }, actor);
    const second = await admin.assignRole({ userId: user.id, role: RoleName.ADMIN }, actor);

    expect(second.id).toBe(first.id);
    expect(await prisma.userRole.count({ where: { userId: user.id } })).toBe(1);
  });

  it('never returns a password hash from the admin user listing', async () => {
    await createCustomer(prisma);
    const { items } = await admin.listUsers({ limit: 10 } as never);

    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('passwordHash');
  });
});
