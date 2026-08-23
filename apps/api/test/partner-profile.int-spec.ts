import { PrismaClient, RoleName } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The partner public profile — "about" text plus an optional offerings
 * list, confirmed with Arman 2026-08-23. Two things this suite has to prove
 * that `partner-disclosure.int-spec.ts` doesn't already cover:
 *
 * 1. Unlike `logoAssetId`/`coverAssetId`, there is no approval step here —
 *    an owner's write is readable through the *public* projection
 *    immediately, with nothing in between.
 * 2. The write is still owner-scoped and partner-scoped the same way
 *    `commercial-settings` is — a STAFF/MANAGER at the partner, a stranger,
 *    and a competitor's owner must all be refused.
 */
describe('Partner public profile (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnersController;

  const asUser = (over: Partial<RequestUser>): RequestUser => ({
    id: 'user-1',
    phone: '+37400000000',
    roles: [RoleName.CUSTOMER],
    permissions: [],
    partnerScopes: {},
    mustChangePassword: false,
    ...over,
  });

  /**
   * A real `User` row, not just a `RequestUser` shape — `updateAbout` and
   * `replaceOfferings` both write an `AuditLog` row keyed on `actorUserId`,
   * which carries a foreign key to `users`. A caller id that names no real
   * row (fine for the read-only assertions, and for the calls below that are
   * expected to be refused before any write happens) fails that insert with
   * a constraint violation rather than the thing actually under test.
   */
  const realUser = async (over: Partial<RequestUser>): Promise<RequestUser> => {
    const { user } = await createCustomer(prisma);
    return asUser({ id: user.id, ...over });
  };

  const owner = (partnerId: string): Promise<RequestUser> =>
    realUser({ roles: [RoleName.PARTNER_OWNER], partnerScopes: { PARTNER_OWNER: [partnerId] } });

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    controller = harness.app.get(PartnersController);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  describe('about text', () => {
    it('is null until the owner writes one, and is visible on the public read the instant it is saved', async () => {
      const partner = await createPartner(prisma);

      const before = await controller.get(asUser({}), partner.id);
      expect(before).toMatchObject({ about: null, offerings: [] });

      const updated = await controller.updateAbout(await owner(partner.id), partner.id, {
        about: 'We roast our own beans daily.',
      });
      expect(updated.about).toBe('We roast our own beans daily.');

      // No admin approval step — the very next public read already sees it,
      // unlike a submitted logo which stays PENDING_REVIEW until confirmed.
      const after = await controller.get(asUser({}), partner.id);
      expect(after).toMatchObject({ about: 'We roast our own beans daily.' });
    });

    it('trims whitespace-only text down to null rather than storing an empty paragraph', async () => {
      const partner = await createPartner(prisma);

      const updated = await controller.updateAbout(await owner(partner.id), partner.id, {
        about: '   ',
      });
      expect(updated.about).toBeNull();
    });

    it('lets the owner clear a previously written about text', async () => {
      const partner = await createPartner(prisma);
      const asOwner = await owner(partner.id);
      await controller.updateAbout(asOwner, partner.id, { about: 'Hello' });

      const cleared = await controller.updateAbout(asOwner, partner.id, { about: null });
      expect(cleared.about).toBeNull();
    });

    it('refuses a caller with no relationship to the partner', async () => {
      const partner = await createPartner(prisma);
      await expect(
        controller.updateAbout(asUser({}), partner.id, { about: 'Hijacked' }),
      ).rejects.toThrow('You are not authorized to act for this partner');
    });

    it('refuses a MANAGER of the same partner — only the OWNER may write this', async () => {
      const partner = await createPartner(prisma);
      const manager = asUser({
        id: 'manager-1',
        roles: [RoleName.PARTNER_MANAGER],
        partnerScopes: { PARTNER_MANAGER: [partner.id] },
      });
      await expect(
        controller.updateAbout(manager, partner.id, { about: 'Hijacked' }),
      ).rejects.toThrow('Only the partner owner may');
    });

    it("refuses a competitor's owner", async () => {
      const mine = await createPartner(prisma);
      const theirs = await createPartner(prisma, { displayName: 'Rival' });
      await expect(
        controller.updateAbout(await owner(mine.id), theirs.id, { about: 'Hijacked' }),
      ).rejects.toThrow('You are not authorized to act for this partner');
    });

    it('lets a platform admin write it too', async () => {
      const partner = await createPartner(prisma);
      const admin = await realUser({ roles: [RoleName.ADMIN] });
      const updated = await controller.updateAbout(admin, partner.id, { about: 'Set by admin' });
      expect(updated.about).toBe('Set by admin');
    });
  });

  describe('offerings', () => {
    it('is an empty list until the owner submits one', async () => {
      const partner = await createPartner(prisma);
      const row = await controller.get(asUser({}), partner.id);
      expect(row.offerings).toEqual([]);
    });

    it('lets the owner set an offerings list, visible on the public read immediately', async () => {
      const partner = await createPartner(prisma);

      const saved = await controller.replaceOfferings(await owner(partner.id), partner.id, {
        offerings: [
          { name: 'Espresso', description: 'Double shot', price: '1500' },
          { name: 'Latte', price: '2000' },
        ],
      });
      expect(saved).toHaveLength(2);
      expect(saved[0]).toMatchObject({ name: 'Espresso', description: 'Double shot' });
      expect(String(saved[0]?.price)).toBe('1500');
      expect(saved[1]).toMatchObject({ name: 'Latte', description: null });

      const publicView = await controller.get(asUser({}), partner.id);
      expect(publicView.offerings.map((o) => o.name)).toEqual(['Espresso', 'Latte']);
    });

    it('preserves the submitted order across a re-save', async () => {
      const partner = await createPartner(prisma);
      const asOwner = await owner(partner.id);
      await controller.replaceOfferings(asOwner, partner.id, {
        offerings: [
          { name: 'First', price: '100' },
          { name: 'Second', price: '200' },
        ],
      });

      // Reordering is "submit the list again in the order you want it" — see
      // ReplacePartnerOfferingsDto's doc comment.
      const reordered = await controller.replaceOfferings(asOwner, partner.id, {
        offerings: [
          { name: 'Second', price: '200' },
          { name: 'First', price: '100' },
        ],
      });
      expect(reordered.map((o) => o.name)).toEqual(['Second', 'First']);
    });

    it('replaces rather than appends — an empty submission clears every offering', async () => {
      const partner = await createPartner(prisma);
      const asOwner = await owner(partner.id);
      await controller.replaceOfferings(asOwner, partner.id, {
        offerings: [{ name: 'Espresso', price: '1500' }],
      });

      const cleared = await controller.replaceOfferings(asOwner, partner.id, { offerings: [] });
      expect(cleared).toEqual([]);

      const publicView = await controller.get(asUser({}), partner.id);
      expect(publicView.offerings).toEqual([]);
    });

    it('refuses a caller with no relationship to the partner', async () => {
      const partner = await createPartner(prisma);
      await expect(
        controller.replaceOfferings(asUser({}), partner.id, {
          offerings: [{ name: 'Hijacked', price: '1' }],
        }),
      ).rejects.toThrow('You are not authorized to act for this partner');
    });

    it("refuses a competitor's owner", async () => {
      const mine = await createPartner(prisma);
      const theirs = await createPartner(prisma, { displayName: 'Rival' });
      await expect(
        controller.replaceOfferings(await owner(mine.id), theirs.id, {
          offerings: [{ name: 'Hijacked', price: '1' }],
        }),
      ).rejects.toThrow('You are not authorized to act for this partner');
    });

    it("deletes with the partner — offerings do not survive their partner's row", async () => {
      const partner = await createPartner(prisma);
      await controller.replaceOfferings(await owner(partner.id), partner.id, {
        offerings: [{ name: 'Espresso', price: '1500' }],
      });
      expect(await prisma.partnerOfferingItem.count({ where: { partnerId: partner.id } })).toBe(1);

      await prisma.partner.delete({ where: { id: partner.id } });
      expect(await prisma.partnerOfferingItem.count({ where: { partnerId: partner.id } })).toBe(0);
    });
  });
});
