import { PrismaClient, RoleName } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { PartnersService } from '../src/modules/partners/partners.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Partner self-service branches (spec: Arman, 2026-08-26 — partners add
 * their own physical locations, not the platform on their behalf). Same
 * auth shape as `partner-profile.int-spec.ts`'s `offerings` suite, but
 * individual CRUD rather than bulk-replace: a branch is referenced by
 * `PurchaseIntent`/`PartnerIntegration` history, so it is deactivated, never
 * deleted-and-recreated.
 */
describe('Partner branches (integration)', () => {
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

  const branchInput = {
    name: 'Downtown',
    address: '1 Republic Square',
    city: 'Yerevan',
    latitude: 40.177,
    longitude: 44.5126,
  };

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

  it('is an empty list until the owner adds one', async () => {
    const partner = await createPartner(prisma);
    expect(await controller.listBranches(await owner(partner.id), partner.id)).toEqual([]);
  });

  it('lets the owner add a branch, active by default', async () => {
    const partner = await createPartner(prisma);
    const branch = await controller.createBranch(await owner(partner.id), partner.id, branchInput);
    expect(branch).toMatchObject({ ...branchInput, partnerId: partner.id, isActive: true });

    const listed = await controller.listBranches(await owner(partner.id), partner.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(branch.id);
  });

  it('lets the owner edit one field without resending the rest', async () => {
    const partner = await createPartner(prisma);
    const asOwner = await owner(partner.id);
    const branch = await controller.createBranch(asOwner, partner.id, branchInput);

    const updated = await controller.updateBranch(asOwner, partner.id, branch.id, {
      name: 'Downtown (renamed)',
    });
    expect(updated).toMatchObject({ ...branchInput, name: 'Downtown (renamed)' });
  });

  it('deactivates and reactivates a branch rather than deleting it', async () => {
    const partner = await createPartner(prisma);
    const asOwner = await owner(partner.id);
    const branch = await controller.createBranch(asOwner, partner.id, branchInput);

    const deactivated = await controller.setBranchActive(asOwner, partner.id, branch.id, {
      isActive: false,
    });
    expect(deactivated.isActive).toBe(false);
    expect(await prisma.partnerBranch.count({ where: { id: branch.id } })).toBe(1);

    // Still visible on the owner's own list — they need to see it to reopen it.
    const listed = await controller.listBranches(asOwner, partner.id);
    expect(listed.map((b) => b.id)).toContain(branch.id);

    const reactivated = await controller.setBranchActive(asOwner, partner.id, branch.id, {
      isActive: true,
    });
    expect(reactivated.isActive).toBe(true);
  });

  it('excludes a deactivated branch from the customer-facing nearby search', async () => {
    const service = harness.app.get(PartnersService);
    const partner = await createPartner(prisma);
    const asOwner = await owner(partner.id);
    const branch = await controller.createBranch(asOwner, partner.id, branchInput);

    const before = await service.listNearbyBranches({
      lat: branchInput.latitude,
      lng: branchInput.longitude,
      radiusKm: 1,
    });
    expect(before.map((b) => b.id)).toContain(branch.id);

    await controller.setBranchActive(asOwner, partner.id, branch.id, { isActive: false });

    const after = await service.listNearbyBranches({
      lat: branchInput.latitude,
      lng: branchInput.longitude,
      radiusKm: 1,
    });
    expect(after.map((b) => b.id)).not.toContain(branch.id);
  });

  it('refuses a caller with no relationship to the partner', async () => {
    const partner = await createPartner(prisma);
    await expect(
      controller.createBranch(asUser({}), partner.id, branchInput),
    ).rejects.toThrow('You are not authorized to act for this partner');
  });

  it('refuses a MANAGER of the same partner — only the OWNER may write this', async () => {
    const partner = await createPartner(prisma);
    const manager = asUser({
      id: 'manager-1',
      roles: [RoleName.PARTNER_MANAGER],
      partnerScopes: { PARTNER_MANAGER: [partner.id] },
    });
    await expect(controller.createBranch(manager, partner.id, branchInput)).rejects.toThrow(
      'Only the partner owner may',
    );
  });

  it('lets a MANAGER read the list, even though only the OWNER may write it', async () => {
    const partner = await createPartner(prisma);
    await controller.createBranch(await owner(partner.id), partner.id, branchInput);
    const manager = asUser({
      id: 'manager-1',
      roles: [RoleName.PARTNER_MANAGER],
      partnerScopes: { PARTNER_MANAGER: [partner.id] },
    });
    expect(await controller.listBranches(manager, partner.id)).toHaveLength(1);
  });

  it("refuses a competitor's owner", async () => {
    const mine = await createPartner(prisma);
    const theirs = await createPartner(prisma, { displayName: 'Rival' });
    await expect(
      controller.createBranch(await owner(mine.id), theirs.id, branchInput),
    ).rejects.toThrow('You are not authorized to act for this partner');
  });

  it("cannot edit or deactivate another partner's branch by guessing its id, even as a real owner", async () => {
    const mine = await createPartner(prisma);
    const theirs = await createPartner(prisma, { displayName: 'Rival' });
    const theirBranch = await controller.createBranch(await owner(theirs.id), theirs.id, branchInput);

    // Scoped correctly to `mine` (passes assertPartnerScope/assertPartnerOwner)
    // but the branch id belongs to `theirs` — the service's own partnerId
    // filter must still refuse it.
    await expect(
      controller.updateBranch(await owner(mine.id), mine.id, theirBranch.id, { name: 'Hijacked' }),
    ).rejects.toThrow('Branch not found');
    await expect(
      controller.setBranchActive(await owner(mine.id), mine.id, theirBranch.id, { isActive: false }),
    ).rejects.toThrow('Branch not found');
  });

  it('lets a platform admin manage branches too', async () => {
    const partner = await createPartner(prisma);
    const admin = await realUser({ roles: [RoleName.ADMIN] });
    const branch = await controller.createBranch(admin, partner.id, branchInput);
    expect(branch.partnerId).toBe(partner.id);
  });
});
