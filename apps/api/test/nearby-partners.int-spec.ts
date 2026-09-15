import { PrismaClient, RoleName } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { NearbyPartnersQueryDto } from '../src/modules/partners/dto/nearby-partners.query.dto';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createTestHarness, TestHarness, truncateAll } from './setup/harness';

/**
 * A generic signed-in customer. No personalization consent is granted here
 * — this suite is about distance/radius/filter arithmetic, not
 * recommendation ranking, which has its own suite
 * (`nearby-partners-personalization.int-spec.ts`). The id need not name a
 * real row: `recommendedCategoriesFor` treats a lookup miss the same as no
 * consent, exactly as it would for a real customer who never opted in.
 */
const asCustomer = (): RequestUser => ({
  id: 'customer-1',
  phone: '+37400000001',
  roles: [RoleName.CUSTOMER],
  permissions: [],
  partnerScopes: {},
  mustChangePassword: false,
});

/**
 * Where a customer can spend, near where they are standing.
 *
 * The endpoint behind the map screen. Everything it does that can be wrong is
 * arithmetic or a filter, and both fail quietly: a wrong radius shows a shop
 * an hour's drive away as "nearby", a wrong `isActive` filter sends somebody
 * to a shop that left the programme to earn points they will not get. Neither
 * throws, so neither is visible without a test that walks the distance.
 *
 * The coordinates below are real ones in Yerevan, because the bounding box
 * divides by `cos(latitude)` and a suite written around (0, 0) would pass with
 * that term missing entirely.
 */

// Republic Square, Yerevan. Every distance in this suite is from here.
const CENTRE = { lat: 40.1776, lng: 44.5126 };

/**
 * Moves a point north by a known number of kilometres.
 *
 * North only, deliberately: a degree of latitude is ~111km at every latitude,
 * so this offset is honest without repeating the longitude correction the code
 * under test applies. A helper that shared that arithmetic would agree with a
 * bug in it.
 */
const kmNorth = (km: number) => ({ lat: CENTRE.lat + km / 111, lng: CENTRE.lng });

describe('Nearby partners (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnersController;

  const query = (over: Partial<NearbyPartnersQueryDto> = {}): NearbyPartnersQueryDto =>
    Object.assign(new NearbyPartnersQueryDto(), { ...CENTRE, radiusKm: 10 }, over);

  async function createBranch(params: {
    displayName: string;
    branchName: string;
    lat: number;
    lng: number;
    category?: string;
    isActive?: boolean;
    bonusAccrualRateBps?: number;
    address?: string;
  }) {
    const partner = await prisma.partner.create({
      data: {
        legalName: `${params.displayName} LLC`,
        displayName: params.displayName,
        taxId: `tax-${params.displayName}-${params.branchName}`,
        category: params.category ?? 'grocery',
        isActive: params.isActive ?? true,
        bonusAccrualRateBps: params.bonusAccrualRateBps ?? 500,
      },
    });

    return prisma.partnerBranch.create({
      data: {
        partnerId: partner.id,
        name: params.branchName,
        address: params.address ?? 'Northern Avenue 1',
        city: 'Yerevan',
        latitude: params.lat,
        longitude: params.lng,
      },
    });
  }

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

  it('returns the closest branch first', async () => {
    await createBranch({ displayName: 'Far', branchName: 'Far branch', ...kmNorth(8) });
    await createBranch({ displayName: 'Near', branchName: 'Near branch', ...kmNorth(1) });
    await createBranch({ displayName: 'Middle', branchName: 'Middle branch', ...kmNorth(4) });

    const rows = await controller.nearby(asCustomer(), query());

    expect(rows.map((r) => r.name)).toEqual(['Near', 'Middle', 'Far']);
    // One decimal, and actually measured — not the number the fixture used to
    // place the pin, which would pass against a `distanceKm: 0` stub.
    expect(rows[0]!.distanceKm).toBeCloseTo(1, 1);
    expect(rows[2]!.distanceKm).toBeCloseTo(8, 1);
  });

  it('drops the corners of the bounding box', async () => {
    // The database query selects a rectangle; the radius is a circle. A branch
    // 9km north is inside both. One 9km north *and* 9km east is inside the
    // rectangle and ~12.7km away, so it must not come back from a 10km ask.
    // Without the haversine filter this test is the one that fails.
    await createBranch({ displayName: 'Inside', branchName: 'B', ...kmNorth(9) });
    await createBranch({
      displayName: 'Corner',
      branchName: 'B',
      lat: CENTRE.lat + 9 / 111,
      lng: CENTRE.lng + 9 / (111 * Math.cos((CENTRE.lat * Math.PI) / 180)),
    });

    const rows = await controller.nearby(asCustomer(), query({ radiusKm: 10 }));

    expect(rows.map((r) => r.name)).toEqual(['Inside']);
  });

  it('excludes a partner that has left the programme', async () => {
    await createBranch({ displayName: 'Trading', branchName: 'B', ...kmNorth(1) });
    await createBranch({
      displayName: 'Gone',
      branchName: 'B',
      ...kmNorth(2),
      isActive: false,
    });

    const rows = await controller.nearby(asCustomer(), query());

    expect(rows.map((r) => r.name)).toEqual(['Trading']);
  });

  it('filters by category', async () => {
    await createBranch({
      displayName: 'Corner shop',
      branchName: 'B',
      ...kmNorth(1),
      category: 'grocery',
    });
    await createBranch({
      displayName: 'Coffee',
      branchName: 'B',
      ...kmNorth(2),
      category: 'cafe',
    });

    const rows = await controller.nearby(asCustomer(), query({ category: 'cafe' }));

    expect(rows.map((r) => r.name)).toEqual(['Coffee']);
  });

  it('searches the partner name, the branch and the address, case-insensitively', async () => {
    await createBranch({
      displayName: 'SAS Supermarket',
      branchName: 'Komitas',
      ...kmNorth(1),
    });
    await createBranch({
      displayName: 'Yerevan City',
      branchName: 'Mashtots',
      ...kmNorth(2),
      address: 'Sayat-Nova 5',
    });

    // The partner's own name…
    expect((await controller.nearby(asCustomer(), query({ q: 'sas' }))).map((r) => r.name)).toEqual([
      'SAS Supermarket',
    ]);
    // …the branch…
    expect((await controller.nearby(asCustomer(), query({ q: 'MASHTOTS' }))).map((r) => r.name)).toEqual([
      'Yerevan City',
    ]);
    // …and the street, which is how somebody looks for the one near work.
    expect((await controller.nearby(asCustomer(), query({ q: 'sayat' }))).map((r) => r.name)).toEqual([
      'Yerevan City',
    ]);
  });

  it('gives the customer what is on the sign and nothing behind the counter', async () => {
    await createBranch({
      displayName: 'Corner shop',
      branchName: 'Komitas',
      ...kmNorth(1),
      bonusAccrualRateBps: 750,
    });

    const [row] = await controller.nearby(asCustomer(), query());
    if (!row) throw new Error('expected one branch back');

    // Basis points converted here, once. A client that had to divide would
    // eventually advertise 750% cashback.
    expect(row.cashbackPercent).toBe(7.5);
    expect(row.name).toBe('Corner shop');
    expect(row.branchName).toBe('Komitas');

    for (const field of [
      'legalName',
      'taxId',
      'paymentCommissionRateBps',
      'payoutsBlockedReason',
      'bonusAccrualRateBps',
      'isActive',
    ]) {
      expect(row).not.toHaveProperty(field);
    }
  });

  it('labels a category it has never heard of rather than passing it through', async () => {
    // `Partner.category` is free text — the existing fixtures use 'retail',
    // which is not one of the chips. The client draws an icon per category, so
    // an unrecognised string renders as a blank pin. It has to arrive as
    // something the client can draw.
    await createBranch({
      displayName: 'Old record',
      branchName: 'B',
      ...kmNorth(1),
      category: 'retail',
    });

    const [row] = await controller.nearby(asCustomer(), query());
    if (!row) throw new Error('expected one branch back');

    expect(row.category).toBe('other');
  });

  it('honours a smaller radius than the default', async () => {
    await createBranch({ displayName: 'Walkable', branchName: 'B', ...kmNorth(0.4) });
    await createBranch({ displayName: 'A drive', branchName: 'B', ...kmNorth(6) });

    const rows = await controller.nearby(asCustomer(), query({ radiusKm: 1 }));

    expect(rows.map((r) => r.name)).toEqual(['Walkable']);
  });
});
