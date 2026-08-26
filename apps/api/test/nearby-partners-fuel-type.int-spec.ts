import { PrismaClient, RoleName } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { NearbyPartnersQueryDto } from '../src/modules/partners/dto/nearby-partners.query.dto';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The "fuel" chip's own sub-filter — "Газ" (propane and methane, one bucket)
 * vs "Бензин" (Arman, 2026-08-26: "чтобы было видно... газ вот эти бензин
 * вот эти"). What matters here: `fuelType` narrows within `fuel`, it forces
 * `category` to `fuel` even if something else was sent, and a plain
 * `category=fuel` query (no sub-filter) still returns every fuel partner
 * regardless of what it sells.
 */
describe('Nearby partners — fuel sub-filter (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnersController;

  const CENTRE = { lat: 40.1776, lng: 44.5126 };

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

  async function createFuelBranch(params: {
    displayName: string;
    sellsGas: boolean;
    sellsPetrol: boolean;
  }) {
    const partner = await prisma.partner.create({
      data: {
        legalName: `${params.displayName} LLC`,
        displayName: params.displayName,
        taxId: `tax-${params.displayName}`,
        category: 'fuel',
        sellsGas: params.sellsGas,
        sellsPetrol: params.sellsPetrol,
        isActive: true,
        bonusAccrualRateBps: 200,
      },
    });
    await prisma.partnerBranch.create({
      data: {
        partnerId: partner.id,
        name: 'Main',
        address: 'Northern Avenue 1',
        city: 'Yerevan',
        latitude: CENTRE.lat,
        longitude: CENTRE.lng,
      },
    });
    return partner;
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

  it('returns only gas stations for fuelType=gas', async () => {
    const { user } = await createCustomer(prisma);
    await createFuelBranch({ displayName: 'Flash', sellsGas: true, sellsPetrol: true });
    await createFuelBranch({ displayName: 'Petrol Only', sellsGas: false, sellsPetrol: true });
    await createFuelBranch({ displayName: 'Bakery', sellsGas: false, sellsPetrol: false });

    const rows = await controller.nearby(asUser(user.id), query({ fuelType: 'gas' }));

    expect(rows.map((r) => r.name)).toEqual(['Flash']);
  });

  it('returns only petrol stations for fuelType=petrol', async () => {
    const { user } = await createCustomer(prisma);
    await createFuelBranch({ displayName: 'Flash', sellsGas: true, sellsPetrol: true });
    await createFuelBranch({ displayName: 'Gas Only', sellsGas: true, sellsPetrol: false });

    const rows = await controller.nearby(asUser(user.id), query({ fuelType: 'petrol' }));

    expect(rows.map((r) => r.name)).toEqual(['Flash']);
  });

  it('carries sellsGas/sellsPetrol through on every row, not just the filtered ones', async () => {
    const { user } = await createCustomer(prisma);
    await createFuelBranch({ displayName: 'Flash', sellsGas: true, sellsPetrol: false });

    const rows = await controller.nearby(asUser(user.id), query({ category: 'fuel' }));

    expect(rows[0]!.sellsGas).toBe(true);
    expect(rows[0]!.sellsPetrol).toBe(false);
  });

  it('a plain category=fuel query, without a sub-filter, still returns every fuel partner', async () => {
    const { user } = await createCustomer(prisma);
    await createFuelBranch({ displayName: 'Flash', sellsGas: true, sellsPetrol: true });
    await createFuelBranch({ displayName: 'Petrol Only', sellsGas: false, sellsPetrol: true });
    await createFuelBranch({ displayName: 'Neither Yet', sellsGas: false, sellsPetrol: false });

    const rows = await controller.nearby(asUser(user.id), query({ category: 'fuel' }));

    expect(rows.map((r) => r.name).sort()).toEqual(['Flash', 'Neither Yet', 'Petrol Only']);
  });

  it('fuelType overrides a mismatched category param', async () => {
    const { user } = await createCustomer(prisma);
    await createFuelBranch({ displayName: 'Flash', sellsGas: true, sellsPetrol: true });

    // A client should never send both, but the server does not trust that —
    // fuelType wins, exactly as `listNearbyBranches`'s doc comment says.
    const rows = await controller.nearby(
      asUser(user.id),
      query({ category: 'cafe', fuelType: 'gas' }),
    );

    expect(rows.map((r) => r.name)).toEqual(['Flash']);
  });
});
