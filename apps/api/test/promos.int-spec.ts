import { PartnerStatus, PrismaClient } from '@prisma/client';
import { PromosService } from '../src/modules/promos/promos.service';
import { createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Home "Partner Spotlight" against a real database.
 *
 * The unit spec pins the window rule as a function; this pins the same rule
 * as a query, plus the two things only the database can prove: that the
 * migration's constraints hold (`partner_promos_window_is_ordered`) and that
 * the counters are atomic increments rather than read-modify-write.
 */
describe('Partner promos (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let promos: PromosService;

  const actor = { userId: 'admin-1', ipAddress: null, userAgent: null };

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    promos = harness.app.get(PromosService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('serves only live placements, highest priority first, and never an expired or inactive one', async () => {
    const trading = await createPartner(prisma, { displayName: 'Coffee House' });
    const suspended = await createPartner(prisma, { displayName: 'Closed Shop' });
    await prisma.partner.update({ where: { id: suspended.id }, data: { status: PartnerStatus.SUSPENDED } });

    const now = new Date();
    const hour = 3_600_000;

    const live = await promos.create(
      { partnerId: trading.id, title: 'Coffee to go', benefitLabel: '10%', active: true, priority: 1 },
      actor,
    );
    const priority = await promos.create(
      { partnerId: trading.id, title: 'Lunch', benefitLabel: '5%', active: true, priority: 9 },
      actor,
    );
    await promos.create(
      { partnerId: trading.id, title: 'Switched off', benefitLabel: '1%', active: false, priority: 99 },
      actor,
    );
    await promos.create(
      {
        partnerId: trading.id,
        title: 'Expired',
        benefitLabel: '1%',
        active: true,
        priority: 99,
        startAt: new Date(now.getTime() - 2 * hour).toISOString(),
        endAt: new Date(now.getTime() - hour).toISOString(),
      },
      actor,
    );
    await promos.create(
      {
        partnerId: trading.id,
        title: 'Not yet',
        benefitLabel: '1%',
        active: true,
        priority: 99,
        startAt: new Date(now.getTime() + hour).toISOString(),
      },
      actor,
    );
    await promos.create(
      { partnerId: suspended.id, title: 'Suspended partner', benefitLabel: '1%', active: true, priority: 99 },
      actor,
    );

    const featured = await promos.featured();
    expect(featured.map((p) => p.title)).toEqual(['Lunch', 'Coffee to go']);
    expect(featured[0]).toMatchObject({
      id: priority.id,
      partnerName: 'Coffee House',
      benefitLabel: '5%',
      artwork: null,
      sponsored: false,
    });

    // The admin view carries every row and says which are live — by the
    // same rule the featured query used.
    const all = await promos.list();
    expect(all).toHaveLength(6);
    expect(all.filter((p) => p.live).map((p) => p.id).sort()).toEqual([live.id, priority.id].sort());
  });

  it('counts impressions and opens as increments and says nothing about who', async () => {
    const partner = await createPartner(prisma);
    const promo = await promos.create(
      { partnerId: partner.id, title: 'Counted', benefitLabel: '10%', active: true },
      actor,
    );

    await Promise.all([
      promos.recordEvent(promo.id, 'IMPRESSION'),
      promos.recordEvent(promo.id, 'IMPRESSION'),
      promos.recordEvent(promo.id, 'IMPRESSION'),
      promos.recordEvent(promo.id, 'OPEN'),
    ]);
    // An unknown id is silently ignored, never a 404 for an analytics ping.
    await promos.recordEvent('00000000-0000-0000-0000-000000000000', 'OPEN');

    const row = await prisma.partnerPromo.findUniqueOrThrow({ where: { id: promo.id } });
    expect(row.impressionCount).toBe(3);
    expect(row.openCount).toBe(1);
    expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['userId', 'viewerId']));
  });

  it('refuses a window that ends before it starts, in the service and in the database', async () => {
    const partner = await createPartner(prisma);
    const now = Date.now();

    await expect(
      promos.create(
        {
          partnerId: partner.id,
          title: 'Backwards',
          benefitLabel: '1%',
          startAt: new Date(now + 3_600_000).toISOString(),
          endAt: new Date(now).toISOString(),
        },
        actor,
      ),
    ).rejects.toThrow('endAt must be after startAt');

    await expect(
      prisma.partnerPromo.create({
        data: {
          partnerId: partner.id,
          title: 'Backwards',
          benefitLabel: '1%',
          startAt: new Date(now + 3_600_000),
          endAt: new Date(now),
        },
      }),
    ).rejects.toThrow(/partner_promos_window_is_ordered/);
  });

  it('a partner may carry several ACTIVE promo artworks at once, unlike a logo', async () => {
    const partner = await createPartner(prisma);
    const asset = (n: number) => ({
      kind: 'PROMO_ARTWORK' as const,
      status: 'ACTIVE' as const,
      partnerId: partner.id,
      storageKey: `promo-artwork/aa/${n}/original`,
      displayKey: `promo-artwork/aa/${n}/display`,
      thumbnailKey: `promo-artwork/aa/${n}/thumb`,
      width: 1024,
      height: 640,
      mimeType: 'image/webp',
      byteSize: 1,
      sha256: `sha-${n}`,
      approvedAt: new Date(),
    });
    await prisma.mediaAsset.create({ data: asset(1) });
    await expect(prisma.mediaAsset.create({ data: asset(2) })).resolves.toBeTruthy();
  });
});
