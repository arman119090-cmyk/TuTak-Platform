import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  PartnerIntegrationStatus,
  PartnerIntegrationType,
  PrismaClient,
  RoleName,
} from '@prisma/client';
import { PartnerIntegrationsController } from '../src/modules/partners/partner-integrations.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { ROLE_PERMISSIONS } from '../src/scripts/role-permissions';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Spec §3's extension point, now surfaced through the partner dashboard's
 * "Integrations" section. Nothing here invents a new activation path — the
 * only questions worth covering are the ones the dashboard actually
 * depends on: tenant isolation (the same class of gap
 * `partner-tenant-isolation.int-spec.ts` covers for the rest of the partner
 * surface), and that `create()`'s per-type branching does what the
 * dashboard's copy promises (WEBSITE goes to PENDING_VERIFICATION with its
 * URL recorded, everything else records intent only).
 */
describe('Partner integrations (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnerIntegrationsController;
  let counter = 2000;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    controller = harness.app.get(PartnerIntegrationsController);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const user = (over: Partial<RequestUser>): RequestUser => ({
    id: 'actor-1',
    phone: '+37400000000',
    roles: [RoleName.CUSTOMER],
    permissions: [],
    partnerScopes: {},
    mustChangePassword: false,
    ...over,
  });

  /**
   * A partner owner scoped to `partnerId`, holding what the role really
   * grants, backed by a real user row — `create()` writes an audit entry
   * whose `actorUserId` is a foreign key, so an invented id would fail for
   * a reason that has nothing to do with what these tests are checking.
   */
  const ownerOf = async (partnerId: string): Promise<RequestUser> => {
    const owner = await createCustomer(prisma, { phone: `+3740001${counter++}` });
    return user({
      id: owner.user.id,
      roles: [RoleName.PARTNER_OWNER],
      permissions: ROLE_PERMISSIONS[RoleName.PARTNER_OWNER],
      partnerScopes: { PARTNER_OWNER: [partnerId] },
    });
  };

  const admin = async (): Promise<RequestUser> => {
    const platformAdmin = await createCustomer(prisma, { phone: `+3740002${counter++}` });
    return user({
      id: platformAdmin.user.id,
      roles: [RoleName.ADMIN],
      permissions: ROLE_PERMISSIONS[RoleName.ADMIN],
    });
  };

  describe('tenant isolation', () => {
    it('refuses to list another partner’s integrations', async () => {
      const partnerA = await createPartner(prisma);
      const partnerB = await createPartner(prisma);
      const outsider = await ownerOf(partnerB.id);

      expect(() => controller.list(outsider, partnerA.id)).toThrow(ForbiddenException);
    });

    it('refuses to create an integration for another partner', async () => {
      const partnerA = await createPartner(prisma);
      const partnerB = await createPartner(prisma);
      const outsider = await ownerOf(partnerB.id);

      // `create()` isn't declared `async` — `assertPartnerScope` throws
      // synchronously before any promise is returned, so this rejects the
      // call itself rather than a promise it would have returned.
      expect(() =>
        controller.create(outsider, partnerA.id, { type: PartnerIntegrationType.API }),
      ).toThrow(ForbiddenException);

      expect(await prisma.partnerIntegration.count({ where: { partnerId: partnerA.id } })).toBe(0);
    });

    it('lets an owner manage their own partner’s integrations', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);

      await expect(
        controller.create(owner, partner.id, { type: PartnerIntegrationType.API }),
      ).resolves.toMatchObject({ type: PartnerIntegrationType.API });
    });

    it('restricts website verification to platform admins, even for the owning partner', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      const integration = await controller.create(owner, partner.id, {
        type: PartnerIntegrationType.WEBSITE,
        websiteUrl: 'https://example.am',
      });

      expect(() => controller.verifyWebsite(owner, integration.id)).toThrow(ForbiddenException);
    });
  });

  describe('per-type creation behaviour', () => {
    it('starts a WEBSITE integration at PENDING_VERIFICATION with the URL recorded', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      const integration = await controller.create(owner, partner.id, {
        type: PartnerIntegrationType.WEBSITE,
        websiteUrl: 'https://example.am',
      });

      expect(integration.status).toBe(PartnerIntegrationStatus.PENDING_VERIFICATION);
      expect(integration.websiteUrl).toBe('https://example.am');
      expect(integration.websiteVerifiedAt).toBeNull();
    });

    it('refuses a WEBSITE integration with no URL', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);

      await expect(
        controller.create(owner, partner.id, { type: PartnerIntegrationType.WEBSITE }),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      PartnerIntegrationType.API,
      PartnerIntegrationType.POS,
      PartnerIntegrationType.EV_CHARGING,
      PartnerIntegrationType.OCPI,
    ])('starts a %s integration at NOT_CONNECTED — no activation path exists yet', async (type) => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      const integration = await controller.create(owner, partner.id, { type });

      expect(integration.status).toBe(PartnerIntegrationStatus.NOT_CONNECTED);
      expect(integration.websiteUrl).toBeNull();
    });

    it('records an optional note in configuration without inventing a protocol around it', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      const integration = await controller.create(owner, partner.id, {
        type: PartnerIntegrationType.POS,
        configuration: { note: 'Uses Poster POS, ask for Anahit' },
      });

      expect(integration.configuration).toEqual({ note: 'Uses Poster POS, ask for Anahit' });
    });

    it('rejects a branch that belongs to a different partner', async () => {
      const partner = await createPartner(prisma);
      const otherPartner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      const foreignBranch = await prisma.partnerBranch.create({
        data: {
          partnerId: otherPartner.id,
          name: 'Branch',
          address: 'Somewhere',
          city: 'Yerevan',
          latitude: 40.18,
          longitude: 44.51,
        },
      });

      await expect(
        controller.create(owner, partner.id, {
          type: PartnerIntegrationType.API,
          partnerBranchId: foreignBranch.id,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('the website verification path', () => {
    it('lets a platform admin verify a website, moving it to ACTIVE', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      const integration = await controller.create(owner, partner.id, {
        type: PartnerIntegrationType.WEBSITE,
        websiteUrl: 'https://example.am',
      });

      const verified = await controller.verifyWebsite(await admin(), integration.id);
      expect(verified.status).toBe(PartnerIntegrationStatus.ACTIVE);
      expect(verified.websiteVerifiedAt).not.toBeNull();
    });
  });

  it('lists newest first, matching what the dashboard renders as "current" per type', async () => {
    const partner = await createPartner(prisma);
    const owner = await ownerOf(partner.id);
    const first = await controller.create(owner, partner.id, { type: PartnerIntegrationType.API });
    await new Promise((r) => setTimeout(r, 5));
    const second = await controller.create(owner, partner.id, { type: PartnerIntegrationType.API });

    const list = await controller.list(owner, partner.id);
    expect(list.map((i) => i.id)).toEqual([second.id, first.id]);
  });
});
