import { PrismaClient, RoleName, TransactionStatus, TransactionType } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { NearbyPartnersQueryDto } from '../src/modules/partners/dto/nearby-partners.query.dto';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * "Recommended for you" on the nearby-partners list (2026-08-26) — ranked by
 * the customer's own purchase history, gated on an explicit, off-by-default
 * consent flag (`personalization-consent.int-spec.ts` covers that flag on
 * its own). What matters here: it never hides anything, it only reorders;
 * it needs real, repeated history, not one purchase; and it needs consent,
 * not just history.
 */
describe('Nearby partners — personalization (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnersController;

  // Republic Square, Yerevan — same reference point as the base nearby suite.
  const CENTRE = { lat: 40.1776, lng: 44.5126 };
  const kmNorth = (km: number) => ({ lat: CENTRE.lat + km / 111, lng: CENTRE.lng });

  const query = (over: Partial<NearbyPartnersQueryDto> = {}): NearbyPartnersQueryDto =>
    Object.assign(new NearbyPartnersQueryDto(), { ...CENTRE, radiusKm: 10 }, over);

  const asUser = (id: string): RequestUser => ({
    id,
    phone: '+37400000000',
    roles: [RoleName.CUSTOMER],
    permissions: [],
    partnerScopes: {},
    mustChangePassword: false,
  });

  async function createBranch(params: {
    displayName: string;
    lat: number;
    lng: number;
    category: string;
  }) {
    const partner = await prisma.partner.create({
      data: {
        legalName: `${params.displayName} LLC`,
        displayName: params.displayName,
        taxId: `tax-${params.displayName}`,
        category: params.category,
        isActive: true,
        bonusAccrualRateBps: 500,
      },
    });
    const branch = await prisma.partnerBranch.create({
      data: {
        partnerId: partner.id,
        name: 'Main',
        address: 'Northern Avenue 1',
        city: 'Yerevan',
        latitude: params.lat,
        longitude: params.lng,
      },
    });
    return { partner, branch };
  }

  /** A completed real purchase — the only kind that counts toward a category. */
  async function completedPurchase(userId: string, partnerId: string) {
    await prisma.transaction.create({
      data: {
        userId,
        partnerId,
        type: TransactionType.PARTNER_PURCHASE,
        status: TransactionStatus.COMPLETED,
        amount: '2000',
      },
    });
  }

  const consentOn = (userId: string) =>
    prisma.user.update({ where: { id: userId }, data: { personalizedRecommendationsConsent: true } });

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

  it('marks nothing recommended, and does not reorder, without consent — even with matching history', async () => {
    const { user } = await createCustomer(prisma);
    const cafe = await createBranch({ displayName: 'Coffee', ...kmNorth(5), category: 'cafe' });
    await createBranch({ displayName: 'Corner shop', ...kmNorth(1), category: 'grocery' });
    await completedPurchase(user.id, cafe.partner.id);
    await completedPurchase(user.id, cafe.partner.id);
    // No consentOn() call — the customer never opted in.

    const rows = await controller.nearby(asUser(user.id), query());

    expect(rows.every((r) => r.recommended === false)).toBe(true);
    expect(rows.map((r) => r.name)).toEqual(['Corner shop', 'Coffee']); // distance order, unchanged
  });

  it('needs more than one purchase in a category before treating it as a preference', async () => {
    const { user } = await createCustomer(prisma);
    const cafe = await createBranch({ displayName: 'Coffee', ...kmNorth(5), category: 'cafe' });
    await createBranch({ displayName: 'Corner shop', ...kmNorth(1), category: 'grocery' });
    await consentOn(user.id);
    await completedPurchase(user.id, cafe.partner.id); // exactly one — not enough

    const rows = await controller.nearby(asUser(user.id), query());

    expect(rows.every((r) => r.recommended === false)).toBe(true);
    expect(rows.map((r) => r.name)).toEqual(['Corner shop', 'Coffee']);
  });

  it('floats a matching category to the top once there is real, repeated history and consent', async () => {
    const { user } = await createCustomer(prisma);
    const cafe = await createBranch({ displayName: 'Coffee', ...kmNorth(5), category: 'cafe' });
    await createBranch({ displayName: 'Corner shop', ...kmNorth(1), category: 'grocery' });
    await consentOn(user.id);
    await completedPurchase(user.id, cafe.partner.id);
    await completedPurchase(user.id, cafe.partner.id);

    const rows = await controller.nearby(asUser(user.id), query());

    // Farther away, but it's what this customer actually buys — recommended first.
    expect(rows.map((r) => r.name)).toEqual(['Coffee', 'Corner shop']);
    expect(rows.find((r) => r.name === 'Coffee')!.recommended).toBe(true);
    expect(rows.find((r) => r.name === 'Corner shop')!.recommended).toBe(false);
  });

  it('never hides a shop it does not recommend — same set, only reordered', async () => {
    const { user } = await createCustomer(prisma);
    const cafe = await createBranch({ displayName: 'Coffee', ...kmNorth(5), category: 'cafe' });
    await createBranch({ displayName: 'Corner shop', ...kmNorth(1), category: 'grocery' });
    await createBranch({ displayName: 'Pharmacy', ...kmNorth(3), category: 'pharmacy' });
    await consentOn(user.id);
    await completedPurchase(user.id, cafe.partner.id);
    await completedPurchase(user.id, cafe.partner.id);

    const rows = await controller.nearby(asUser(user.id), query());

    expect(rows.map((r) => r.name).sort()).toEqual(['Coffee', 'Corner shop', 'Pharmacy'].sort());
  });

  it('ignores an INITIATED purchase — nothing happened yet', async () => {
    const { user } = await createCustomer(prisma);
    const cafe = await createBranch({ displayName: 'Coffee', ...kmNorth(5), category: 'cafe' });
    await createBranch({ displayName: 'Corner shop', ...kmNorth(1), category: 'grocery' });
    await consentOn(user.id);
    await prisma.transaction.create({
      data: {
        userId: user.id,
        partnerId: cafe.partner.id,
        type: TransactionType.PARTNER_PURCHASE,
        status: TransactionStatus.INITIATED,
        amount: '2000',
      },
    });
    await prisma.transaction.create({
      data: {
        userId: user.id,
        partnerId: cafe.partner.id,
        type: TransactionType.PARTNER_PURCHASE,
        status: TransactionStatus.INITIATED,
        amount: '2000',
      },
    });

    const rows = await controller.nearby(asUser(user.id), query());

    expect(rows.every((r) => r.recommended === false)).toBe(true);
  });
});
