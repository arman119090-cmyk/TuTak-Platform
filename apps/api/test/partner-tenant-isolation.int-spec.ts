import { ForbiddenException } from '@nestjs/common';
import { PermissionName, PrismaClient, RoleName } from '@prisma/client';
import { AnalyticsController } from '../src/modules/analytics/analytics.controller';
import { EvChargingController } from '../src/modules/ev-charging/ev-charging.controller';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { ROLE_PERMISSIONS } from '../src/scripts/role-permissions';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Tenant isolation on partner administration.
 *
 * The flaw these cover, in one sentence: `PARTNER_MANAGE` reads like
 * "platform administrator" and is not — PARTNER_OWNER holds it, because
 * owners administer their *own* partner — so every route gated on the
 * permission alone was open to every tenant on the network.
 *
 * Two of those routes mutate. A partner owner could bring a new partner into
 * existence at an accrual rate of their choosing, owned by themselves; and
 * could switch a competitor off, which stops that competitor's QR codes
 * redeeming because `findActiveOrThrow` gates redemption on the flag.
 *
 * Both were demonstrated over HTTP against a running API before the fix.
 *
 * The attacker in every test below carries the **real** PARTNER_OWNER
 * permission list, read from `ROLE_PERMISSIONS` rather than hand-written, so
 * these tests keep testing the actual condition if that list ever changes.
 */
describe('Partner tenant isolation (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let partners: PartnersController;
  let analytics: AnalyticsController;
  let ev: EvChargingController;

  const user = (over: Partial<RequestUser>): RequestUser => ({
    id: 'actor-1',
    phone: '+37400000000',
    roles: [RoleName.CUSTOMER],
    permissions: [],
    partnerScopes: {},
    mustChangePassword: false,
    ...over,
  });

  /** A partner owner scoped to `partnerId`, holding what the role really grants. */
  const ownerOf = (partnerId: string, id = 'owner-a') =>
    user({
      id,
      roles: [RoleName.PARTNER_OWNER],
      permissions: ROLE_PERMISSIONS[RoleName.PARTNER_OWNER],
      partnerScopes: { PARTNER_OWNER: [partnerId] },
    });

  /**
   * A real admin row, not an invented id.
   *
   * The mutating routes write an audit entry, and `audit_logs.actorUserId`
   * is a foreign key — which is itself worth knowing: an action that cannot
   * be attributed to an existing user cannot be performed.
   */
  const platformAdmin = async () => {
    const admin = await createCustomer(prisma, { phone: `+3740000${counter++}` });
    return user({
      id: admin.user.id,
      roles: [RoleName.ADMIN],
      permissions: ROLE_PERMISSIONS[RoleName.ADMIN],
    });
  };

  let counter = 1000;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    partners = harness.app.get(PartnersController);
    analytics = harness.app.get(AnalyticsController);
    ev = harness.app.get(EvChargingController);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  // Guards the premise of every test below. If PARTNER_OWNER ever stops
  // holding PARTNER_MANAGE these tests would still pass while proving
  // nothing, so the premise is asserted rather than assumed.
  it('PARTNER_OWNER really does hold PARTNER_MANAGE', () => {
    expect(ROLE_PERMISSIONS[RoleName.PARTNER_OWNER]).toContain(PermissionName.PARTNER_MANAGE);
  });

  describe('creating partners', () => {
    it('refuses a partner owner, who would otherwise own what they created', async () => {
      const mine = await createPartner(prisma);
      const owner = await createCustomer(prisma, { phone: '+37477000001' });

      await expect(
        partners.create(ownerOf(mine.id), {
          legalName: 'Fabricated By A Tenant LLC',
          displayName: 'Exploit Partner',
          taxId: 'EXPLOIT-0001',
          category: 'retail',
          // The reason this matters: the attacker sets the accrual rate on
          // the partner they are about to own.
          bonusAccrualRateBps: 9000,
          ownerUserId: owner.user.id,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(await prisma.partner.count({ where: { displayName: 'Exploit Partner' } })).toBe(0);
    });

    it('still lets a platform admin create one', async () => {
      const owner = await createCustomer(prisma, { phone: '+37477000002' });

      const created = await partners.create(await platformAdmin(), {
        legalName: 'Legitimate LLC',
        displayName: 'Legitimate Partner',
        taxId: 'LEGIT-0001',
        category: 'retail',
        bonusAccrualRateBps: 500,
        ownerUserId: owner.user.id,
      });

      expect(created.displayName).toBe('Legitimate Partner');
    });
  });

  describe('enabling and disabling partners', () => {
    it('refuses a partner owner switching a competitor off', async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });
      const rival = await createPartner(prisma, { displayName: 'Rival' });

      await expect(
        partners.setActive(ownerOf(mine.id), rival.id, { isActive: false }),
      ).rejects.toThrow(ForbiddenException);

      // The flag is what gates redemption, so the assertion that matters is
      // the stored value, not the thrown error.
      const after = await prisma.partner.findUniqueOrThrow({ where: { id: rival.id } });
      expect(after.isActive).toBe(true);
    });

    it('refuses a partner owner switching off their own partner too', async () => {
      // Not an oversight: this endpoint is the platform's termination
      // control, and a control its subject can also operate is not a
      // control.
      const mine = await createPartner(prisma, { displayName: 'Mine' });

      await expect(
        partners.setActive(ownerOf(mine.id), mine.id, { isActive: false }),
      ).rejects.toThrow(ForbiddenException);

      const after = await prisma.partner.findUniqueOrThrow({ where: { id: mine.id } });
      expect(after.isActive).toBe(true);
    });

    it('still lets a platform admin disable a partner', async () => {
      const partner = await createPartner(prisma);

      const updated = await partners.setActive(await platformAdmin(), partner.id, {
        isActive: false,
      });

      expect(updated.isActive).toBe(false);
    });
  });

  describe('reading across the fence', () => {
    it("gives a partner owner only the public projection of a competitor", async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });
      const rival = await createPartner(prisma, { displayName: 'Rival' });

      const row = await partners.get(ownerOf(mine.id), rival.id);

      for (const field of ['taxId', 'paymentCommissionRateBps', 'payoutsBlockedReason']) {
        expect(row).not.toHaveProperty(field);
      }
    });

    it('gives a partner owner their own record in full', async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });

      const row = await partners.get(ownerOf(mine.id), mine.id);

      expect(row).toHaveProperty('taxId');
      expect(row).toHaveProperty('paymentCommissionRateBps');
    });

    it("refuses a partner owner reading a competitor's transactions", async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });
      const rival = await createPartner(prisma, { displayName: 'Rival' });

      await expect(
        partners.transactions(ownerOf(mine.id), rival.id, { limit: 20 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("refuses a partner owner reading a competitor's analytics", async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });
      const rival = await createPartner(prisma, { displayName: 'Rival' });

      await expect(analytics.partner(ownerOf(mine.id), rival.id, {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses a partner owner reading platform-wide analytics', async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });

      // Synchronous — it throws on call rather than rejecting a promise.
      expect(() => analytics.platform(ownerOf(mine.id))).toThrow(ForbiddenException);
    });
  });

  describe('the other permissions PARTNER_OWNER holds', () => {
    it("refuses a partner owner creating an EV station under a competitor", async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });
      const rival = await createPartner(prisma, { displayName: 'Rival' });

      // EV_STATION_MANAGE is also held by PARTNER_OWNER. The station's price
      // per kWh drives accrual, so this is a funding channel as much as an
      // authorization boundary.
      expect(() =>
        ev.createStation(ownerOf(mine.id), {
          partnerId: rival.id,
          name: 'Planted',
          address: 'Somewhere',
          city: 'Yerevan',
          latitude: 40.18,
          longitude: 44.51,
        }),
      ).toThrow(ForbiddenException);

      expect(await prisma.evStation.count({ where: { partnerId: rival.id } })).toBe(0);
    });

    it('still lets a partner owner create a station under their own partner', async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });

      const station = await ev.createStation(ownerOf(mine.id), {
        partnerId: mine.id,
        name: 'Ours',
        address: 'Home',
        city: 'Yerevan',
        latitude: 40.18,
        longitude: 44.51,
      });

      expect(station.partnerId).toBe(mine.id);
    });
  });
});
