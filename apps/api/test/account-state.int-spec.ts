import { UnauthorizedException } from '@nestjs/common';
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

  it('builds claims for an active account', async () => {
    const { user } = await createCustomer(prisma);
    const claims = await users.buildRequestUserClaims(user.id);
    expect(claims.id).toBe(user.id);
  });

  it('rejects a deactivated account on its very next request', async () => {
    const { user } = await createCustomer(prisma);
    await admin.setActive(user.id, false);

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

    await admin.setActive(user.id, false);

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

    await admin.setActive(user.id, true);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      1,
    );
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
