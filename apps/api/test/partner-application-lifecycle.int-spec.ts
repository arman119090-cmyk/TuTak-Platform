import { PartnerStatus, PrismaClient, RoleName } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { PartnersService } from '../src/modules/partners/partners.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { ROLE_PERMISSIONS } from '../src/scripts/role-permissions';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * A business asking to join, and what it can do at each step.
 *
 * The pieces of this were built separately — a form in the app, a queue in
 * the admin panel, three endpoints that predate both — and each was tested
 * where it lives. This walks the chain instead: apply, appear in the queue,
 * be decided on, and only then trade. The step that matters is the one
 * between: an applicant is the owner of their partner from the moment they
 * apply, so "not approved yet" has to be enforced by the platform rather
 * than by the absence of a button.
 *
 * The authorisation shape here is a trap worth testing directly. `approve`
 * and `reject` are annotated `@RequirePermissions(PARTNER_MANAGE)`, and
 * PARTNER_OWNER *holds* PARTNER_MANAGE — owners manage their own partner. So
 * the annotation alone would let an applicant approve their own application.
 * `assertPlatformAdmin` is what actually stops it, and nothing about reading
 * the decorator says so.
 */
describe('The partner application, end to end (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnersController;
  let service: PartnersService;
  let counter = 2000;

  const user = (over: Partial<RequestUser>): RequestUser => ({
    id: 'actor',
    phone: '+37400000000',
    roles: [RoleName.CUSTOMER],
    permissions: [],
    partnerScopes: {},
    mustChangePassword: false,
    ...over,
  });

  /** A real row: the audit entry these routes write has a foreign key to it. */
  const personWhoCanApply = async () => {
    const { user: row } = await createCustomer(prisma, { phone: `+3749100${counter++}` });
    return { id: row.id, as: user({ id: row.id }) };
  };

  const platformAdmin = async () => {
    const { user: row } = await createCustomer(prisma, { phone: `+3749200${counter++}` });
    return user({
      id: row.id,
      roles: [RoleName.ADMIN],
      permissions: ROLE_PERMISSIONS[RoleName.ADMIN],
    });
  };

  /** The applicant once their partner exists: owner-scoped, as the API sees them. */
  const ownerOf = (partnerId: string, id: string) =>
    user({
      id,
      roles: [RoleName.PARTNER_OWNER],
      permissions: ROLE_PERMISSIONS[RoleName.PARTNER_OWNER],
      partnerScopes: { PARTNER_OWNER: [partnerId] },
    });

  const application = (over: Partial<{ displayName: string; taxId: string }> = {}) => ({
    legalName: 'Nairi Foods LLC',
    displayName: 'Nairi',
    category: 'grocery',
    bonusAccrualRateBps: 1000,
    ...over,
  });

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    controller = harness.app.get(PartnersController);
    service = harness.app.get(PartnersService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  describe('while the application is waiting', () => {
    it('creates a partner the applicant owns but cannot trade with', async () => {
      const applicant = await personWhoCanApply();

      const partner = await controller.apply(applicant.as, application());

      expect(partner).toMatchObject({
        status: PartnerStatus.PENDING_APPROVAL,
        isActive: false,
      });
      // Membership is immediate; trading is not. Everything that moves money
      // goes through `findActiveOrThrow` — QR redemption, an EV session, a
      // purchase confirmation — and it refuses.
      await expect(service.findActiveOrThrow(partner.id)).rejects.toMatchObject({ status: 400 });
    });

    it('shows the application to an administrator, marked as waiting', async () => {
      const applicant = await personWhoCanApply();
      await controller.apply(applicant.as, application());

      const listed = await controller.list(await platformAdmin());

      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        status: PartnerStatus.PENDING_APPROVAL,
        legalName: 'Nairi Foods LLC',
      });
    });

    it('hides the waiting business from customers looking for somewhere to spend', async () => {
      const applicant = await personWhoCanApply();
      const partner = await controller.apply(applicant.as, application());
      await prisma.partnerBranch.create({
        data: {
          partnerId: partner.id,
          name: 'Cascade',
          address: 'Northern Avenue 1',
          city: 'Yerevan',
          latitude: 40.1776,
          longitude: 44.5126,
        },
      });

      const nearby = await controller.nearby(
        user({ id: 'some-customer' }),
        Object.assign(Object.create(null), { lat: 40.1776, lng: 44.5126, radiusKm: 10 }),
      );

      // A shop nobody has approved must not be advertised as one that pays
      // cashback — a customer who walked there would earn nothing.
      expect(nearby).toEqual([]);
    });

    it('refuses to let the applicant approve their own application', async () => {
      /*
       * The whole reason `assertPlatformAdmin` exists on this route.
       *
       * The applicant is PARTNER_OWNER of the partner they just created, and
       * PARTNER_OWNER holds PARTNER_MANAGE. So `@RequirePermissions` passes
       * and the decorator, read on its own, says this call is allowed.
       */
      const applicant = await personWhoCanApply();
      const partner = await controller.apply(applicant.as, application());
      const asOwner = ownerOf(partner.id, applicant.id);

      expect(asOwner.permissions).toContain('PARTNER_MANAGE');
      await expect(controller.approvePartner(asOwner, partner.id)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        controller.rejectPartner(asOwner, partner.id, { reason: 'I approve of myself' }),
      ).rejects.toMatchObject({ status: 403 });

      expect((await service.findByIdOrThrow(partner.id)).status).toBe(
        PartnerStatus.PENDING_APPROVAL,
      );
    });
  });

  describe('once an administrator decides', () => {
    it('approving lets the business trade on the rate it proposed', async () => {
      const applicant = await personWhoCanApply();
      const partner = await controller.apply(applicant.as, application());

      const approved = await controller.approvePartner(await platformAdmin(), partner.id);

      expect(approved).toMatchObject({
        status: PartnerStatus.ACTIVE,
        isActive: true,
        bonusAccrualRateBps: 1000,
      });
      await expect(service.findActiveOrThrow(partner.id)).resolves.toMatchObject({
        id: partner.id,
      });
    });

    it('gives an approved owner their own partner, in full', async () => {
      const applicant = await personWhoCanApply();
      const partner = await controller.apply(applicant.as, application({ taxId: '12345678' }));
      await controller.approvePartner(await platformAdmin(), partner.id);

      const own = await controller.listBranches(ownerOf(partner.id, applicant.id), partner.id);

      // Reaching a partner-scoped route at all is the access being tested;
      // a fresh partner has no branches yet.
      expect(own).toEqual([]);
    });

    it('rejecting leaves the business unable to trade, with the reason recorded', async () => {
      const applicant = await personWhoCanApply();
      const partner = await controller.apply(applicant.as, application());

      const rejected = await controller.rejectPartner(await platformAdmin(), partner.id, {
        reason: 'Duplicate of an existing partner',
      });

      expect(rejected).toMatchObject({ status: PartnerStatus.REJECTED, isActive: false });
      await expect(service.findActiveOrThrow(partner.id)).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('the rate an applicant proposed is the rate they trade on', () => {
    /*
     * The assumption the whole "propose a generous rate" arrangement rests
     * on, and it is currently held up by a field being absent from a DTO.
     *
     * A higher rate ranks a partner ahead of nearer-equal neighbours and
     * earns a marker customers can see. If an owner could lower their own
     * rate afterwards, that would be a bait-and-switch they could perform
     * alone: apply at 10%, be approved and ranked on it, then drop to 0.5%
     * while keeping the position. `UpdateCommercialSettingsDto` deliberately
     * omits `bonusAccrualRateBps` — spec §10 — and nothing else a partner can
     * reach writes it.
     */
    it('does not let an owner lower their own cashback while changing what they can', async () => {
      const applicant = await personWhoCanApply();
      const partner = await controller.apply(applicant.as, application());
      await controller.approvePartner(await platformAdmin(), partner.id);
      const asOwner = ownerOf(partner.id, applicant.id);

      const updated = await controller.updateCommercialSettings(asOwner, partner.id, {
        maxBonusPaymentPercent: 40,
      });

      // The cap they may set moved; the rate customers were promised did not.
      expect(updated).toMatchObject({
        maxBonusPaymentPercent: 40,
        bonusAccrualRateBps: 1000,
      });
    });
  });

  describe('one partner never reaches another', () => {
    it('refuses an owner asking about somebody else’s business', async () => {
      const mine = await personWhoCanApply();
      const theirs = await personWhoCanApply();
      const minePartner = await controller.apply(mine.as, application({ displayName: 'Nairi' }));
      const theirsPartner = await controller.apply(
        theirs.as,
        application({ displayName: 'Ararat' }),
      );
      const admin = await platformAdmin();
      await controller.approvePartner(admin, minePartner.id);
      await controller.approvePartner(admin, theirsPartner.id);

      const asMine = ownerOf(minePartner.id, mine.id);

      // Wrapped in an async thunk on purpose. `listBranches` is not an
      // `async` method: the scope check throws before any promise exists, so
      // `expect(controller.listBranches(...)).rejects` never sees a rejection
      // — the throw escapes the assertion entirely.
      await expect(async () =>
        controller.listBranches(asMine, theirsPartner.id),
      ).rejects.toMatchObject({
        status: 403,
      });
    });

    it('withholds the commercial terms from a customer reading a partner', async () => {
      const applicant = await personWhoCanApply();
      const partner = await controller.apply(applicant.as, application({ taxId: '87654321' }));
      await controller.approvePartner(await platformAdmin(), partner.id);

      const asCustomer = await controller.get(user({ id: 'some-customer' }), partner.id);

      // The cashback rate is advertised; what the platform negotiated is not.
      expect(asCustomer).toMatchObject({ bonusAccrualRateBps: 1000 });
      expect(asCustomer).not.toHaveProperty('taxId');
      expect(asCustomer).not.toHaveProperty('paymentCommissionRateBps');
      expect(asCustomer).not.toHaveProperty('legalName');
    });
  });
});
