import { PrismaClient, RoleName } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Partner self-service: what a `fuel`-category station sells (Arman,
 * 2026-08-26) — see `Partner.sellsGas`/`sellsPetrol` and the "Газ"/"Бензин"
 * customer filter that reads them. Same OWNER-only scoping as
 * `partner-branches.int-spec.ts`.
 */
describe('Partner fuel types (integration)', () => {
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

  it('defaults to selling neither', async () => {
    const partner = await createPartner(prisma);
    expect(partner.sellsGas).toBe(false);
    expect(partner.sellsPetrol).toBe(false);
  });

  it('lets the owner set one flag without resending the other', async () => {
    const partner = await createPartner(prisma);
    const asOwner = await owner(partner.id);

    const gasOn = await controller.updateFuelTypes(asOwner, partner.id, { sellsGas: true });
    expect(gasOn).toMatchObject({ sellsGas: true, sellsPetrol: false });

    const petrolOn = await controller.updateFuelTypes(asOwner, partner.id, { sellsPetrol: true });
    expect(petrolOn).toMatchObject({ sellsGas: true, sellsPetrol: true });
  });

  it('refuses a MANAGER of the same partner — only the OWNER may write this', async () => {
    const partner = await createPartner(prisma);
    const manager = asUser({
      id: 'manager-1',
      roles: [RoleName.PARTNER_MANAGER],
      partnerScopes: { PARTNER_MANAGER: [partner.id] },
    });
    await expect(
      controller.updateFuelTypes(manager, partner.id, { sellsGas: true }),
    ).rejects.toThrow();
  });

  it('audits the change', async () => {
    const partner = await createPartner(prisma);
    const asOwner = await owner(partner.id);
    await controller.updateFuelTypes(asOwner, partner.id, { sellsGas: true });

    const logs = await prisma.auditLog.findMany({
      where: { entityId: partner.id, entityType: 'Partner' },
    });
    const entry = logs.find((l) => (l.metadata as Record<string, unknown>)?.field === 'fuelTypes');
    expect(entry).toBeDefined();
    expect(entry!.metadata).toMatchObject({ sellsGas: true, sellsPetrol: false });
  });
});
