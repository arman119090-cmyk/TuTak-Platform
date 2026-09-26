import { PrismaClient, RoleName } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { NearbyPartnersQueryDto } from '../src/modules/partners/dto/nearby-partners.query.dto';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createTestHarness, TestHarness, truncateAll } from './setup/harness';

/**
 * What a generous cashback rate actually buys a partner.
 *
 * An applicant proposes their own rate, and we ask them for a better one. That
 * ask is only honest if a better rate does something, so a partner offering
 * more is ranked ahead of one offering less and is marked as generous.
 *
 * The danger in that is the reason this suite exists. This endpoint answers
 * "where can I spend near here", and ranking by rate outright would put a shop
 * nine kilometres away above the one across the road — the rate would have
 * quietly bought the partner something the customer pays for in shoe leather.
 * So the comparison happens inside half-kilometre bands: within a band, the
 * better rate wins; across bands, nearer wins however generous the far one is.
 *
 * Every case below is about that boundary holding.
 */

// Republic Square, Yerevan. Every distance here is measured from it, and the
// real latitude matters: the bounding box divides by cos(latitude).
const CENTRE = { lat: 40.1776, lng: 44.5126 };

/** North only — a degree of latitude is ~111km everywhere, so this is honest
 *  without repeating the longitude correction the code under test applies. */
const kmNorth = (km: number) => ({ lat: CENTRE.lat + km / 111, lng: CENTRE.lng });

const asCustomer = (): RequestUser => ({
  id: 'customer-rank',
  phone: '+37400000009',
  roles: [RoleName.CUSTOMER],
  permissions: [],
  partnerScopes: {},
  mustChangePassword: false,
});

describe('Nearby partners ranked by cashback (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnersController;

  const query = (over: Partial<NearbyPartnersQueryDto> = {}): NearbyPartnersQueryDto =>
    Object.assign(new NearbyPartnersQueryDto(), { ...CENTRE, radiusKm: 10 }, over);

  async function createBranch(params: {
    displayName: string;
    km: number;
    bonusAccrualRateBps: number;
  }) {
    const partner = await prisma.partner.create({
      data: {
        legalName: `${params.displayName} LLC`,
        displayName: params.displayName,
        taxId: `tax-${params.displayName}`,
        category: 'grocery',
        isActive: true,
        bonusAccrualRateBps: params.bonusAccrualRateBps,
      },
    });
    const at = kmNorth(params.km);
    return prisma.partnerBranch.create({
      data: {
        partnerId: partner.id,
        name: `${params.displayName} branch`,
        address: 'Northern Avenue 1',
        city: 'Yerevan',
        latitude: at.lat,
        longitude: at.lng,
      },
    });
  }

  const namesFrom = async () =>
    (await controller.nearby(asCustomer(), query())).map((b) => b.name);

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

  it('puts the more generous of two shops on the same street first', async () => {
    // 120m apart: the same half-kilometre band, so the rate decides.
    await createBranch({ displayName: 'Stingy', km: 0.1, bonusAccrualRateBps: 100 });
    await createBranch({ displayName: 'Generous', km: 0.22, bonusAccrualRateBps: 1000 });

    expect(await namesFrom()).toEqual(['Generous', 'Stingy']);
  });

  it('never lets a far generous shop outrank a near mean one', async () => {
    // The case that would make this whole feature a disservice: 10% nine
    // kilometres away against 1% across the road.
    await createBranch({ displayName: 'Across the road', km: 0.1, bonusAccrualRateBps: 100 });
    await createBranch({ displayName: 'Nine km away', km: 9, bonusAccrualRateBps: 2000 });

    expect(await namesFrom()).toEqual(['Across the road', 'Nine km away']);
  });

  it('keeps nearer bands ahead even when every far shop is more generous', async () => {
    await createBranch({ displayName: 'Near and mean', km: 0.2, bonusAccrualRateBps: 50 });
    await createBranch({ displayName: 'Mid and better', km: 2, bonusAccrualRateBps: 1000 });
    await createBranch({ displayName: 'Far and best', km: 6, bonusAccrualRateBps: 2000 });

    expect(await namesFrom()).toEqual(['Near and mean', 'Mid and better', 'Far and best']);
  });

  it('falls back to distance when two shops in a band offer the same rate', async () => {
    // Without this last key the order between equals would depend on the
    // database's row order, and the list would reshuffle between refreshes.
    await createBranch({ displayName: 'Closer', km: 0.1, bonusAccrualRateBps: 300 });
    await createBranch({ displayName: 'Further', km: 0.4, bonusAccrualRateBps: 300 });

    expect(await namesFrom()).toEqual(['Closer', 'Further']);
  });

  describe('the generous marker', () => {
    it('marks a partner at or above the threshold', async () => {
      await createBranch({ displayName: 'Five percent', km: 0.1, bonusAccrualRateBps: 500 });

      const [branch] = await controller.nearby(asCustomer(), query());

      expect(branch).toMatchObject({ cashbackPercent: 5, highCashback: true });
    });

    it('leaves an ordinary rate unmarked', async () => {
      await createBranch({ displayName: 'Three percent', km: 0.1, bonusAccrualRateBps: 300 });

      const [branch] = await controller.nearby(asCustomer(), query());

      expect(branch).toMatchObject({ cashbackPercent: 3, highCashback: false });
    });
  });
});
