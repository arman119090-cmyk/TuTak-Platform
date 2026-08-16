import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PartnersService } from '../src/modules/partners/partners.service';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Product decision: `bonusAccrualRateBps` is restricted to a fixed rate
 * card — 0.5% steps from 0.5% to 20% (50..2000 bps) — not any basis-point
 * value up to 100%. This proves the restriction holds at every layer that
 * can create a partner (`PartnersController.create`/`.apply`, both of which
 * go through `PartnersService`) and at the database itself, so a caller that
 * somehow bypasses both the DTO and the service still can't write an
 * off-grid rate.
 */
describe('Partner commission rate grid (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let partners: PartnersService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    partners = harness.app.get(PartnersService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const basePartner = (bonusAccrualRateBps: number) => ({
    legalName: 'Rate Grid LLC',
    displayName: 'Rate Grid Test Partner',
    taxId: randomUUID(),
    category: 'retail',
    bonusAccrualRateBps,
  });

  describe('PartnersService.create (admin path)', () => {
    it.each([0, 25, 175, 333, 2050, 10_000])(
      'rejects %p bps even though the DTO layer would already have caught it',
      async (bps) => {
        const { user } = await createCustomer(prisma);
        await expect(
          partners.create({ ...basePartner(bps), ownerUserId: user.id }),
        ).rejects.toThrow(/commission grid/);
        expect(await prisma.partner.count()).toBe(0);
      },
    );

    it.each([50, 300, 1000, 2000])('accepts the grid boundary/typical value %p bps', async (bps) => {
      const { user } = await createCustomer(prisma);
      const partner = await partners.create({ ...basePartner(bps), ownerUserId: user.id });
      expect(partner.bonusAccrualRateBps).toBe(bps);
    });
  });

  describe('PartnersService.apply (self-service path)', () => {
    it('rejects an off-grid proposed rate', async () => {
      const { user } = await createCustomer(prisma);
      await expect(partners.apply(basePartner(275), user.id)).rejects.toThrow(/commission grid/);
      expect(await prisma.partner.count()).toBe(0);
    });

    it('accepts a proposed rate on the grid', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await partners.apply(basePartner(1500), user.id);
      expect(partner.bonusAccrualRateBps).toBe(1500);
    });
  });

  describe('database CHECK constraint (third layer, bypassing the app entirely)', () => {
    it('refuses an off-grid rate written by raw SQL', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "partners" (id, "legalName", "displayName", "taxId", category, "bonusAccrualRateBps", "updatedAt")
           VALUES ('${randomUUID()}', 'Raw SQL LLC', 'Raw SQL Partner', '${randomUUID()}', 'retail', 333, NOW())`,
        ),
      ).rejects.toThrow(/partners_commission_rate_on_grid/);
    });

    it('refuses a rate above the 20% ceiling written by raw SQL', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "partners" (id, "legalName", "displayName", "taxId", category, "bonusAccrualRateBps", "updatedAt")
           VALUES ('${randomUUID()}', 'Raw SQL LLC', 'Raw SQL Partner', '${randomUUID()}', 'retail', 5000, NOW())`,
        ),
      ).rejects.toThrow(/partners_commission_rate_on_grid/);
    });

    it('accepts a grid-boundary rate written by raw SQL', async () => {
      const id = randomUUID();
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "partners" (id, "legalName", "displayName", "taxId", category, "bonusAccrualRateBps", "updatedAt")
           VALUES ('${id}', 'Raw SQL LLC', 'Raw SQL Partner', '${randomUUID()}', 'retail', 2000, NOW())`,
        ),
      ).resolves.not.toThrow();
      expect((await prisma.partner.findUniqueOrThrow({ where: { id } })).bonusAccrualRateBps).toBe(
        2000,
      );
    });
  });
});
