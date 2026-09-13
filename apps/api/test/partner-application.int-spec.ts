import { PrismaClient, PartnerStatus } from '@prisma/client';
import { PartnersService } from '../src/modules/partners/partners.service';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Self-service partner applications, and the one column that had to move for
 * them: `taxId`.
 *
 * A business owner meets this form before there is any relationship in which
 * to chase paperwork. The Armenian ՀՎՀՀ was required, and a required number
 * at first contact does not produce the number — it loses the applicant. So
 * it is optional now, and can be supplied later from the partner's own panel.
 *
 * What must not move with it is the guarantee underneath: two businesses may
 * never claim the same tax number. That still holds, because PostgreSQL does
 * not consider one NULL equal to another, so a unique index admits any number
 * of rows without a value while still rejecting a duplicate one. This suite
 * exists to hold both halves of that at once — the permission and the
 * restriction — because relaxing a NOT NULL on a unique column is exactly
 * where a duplicate would slip in unnoticed.
 */
describe('Partner applications (integration)', () => {
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

  const application = (overrides: Partial<{ taxId: string; displayName: string }> = {}) => ({
    legalName: 'Nairi Foods LLC',
    displayName: 'Nairi',
    category: 'grocery',
    bonusAccrualRateBps: 1000,
    ...overrides,
  });

  it('accepts an application with no tax number at all', async () => {
    const { user } = await createCustomer(prisma);

    const partner = await partners.apply(application(), user.id);

    expect(partner.taxId).toBeNull();
    expect(partner.status).toBe(PartnerStatus.PENDING_APPROVAL);
  });

  it('lets two applicants both leave the tax number out', async () => {
    // The half a unique index would break if NULLs were compared to each
    // other: the second application would collide with the first over a
    // number neither of them gave.
    const first = await createCustomer(prisma);
    const second = await createCustomer(prisma);

    await partners.apply(application({ displayName: 'Nairi' }), first.user.id);

    await expect(
      partners.apply(application({ displayName: 'Ararat' }), second.user.id),
    ).resolves.toMatchObject({ taxId: null });
  });

  it('still refuses two partners claiming the same tax number', async () => {
    const first = await createCustomer(prisma);
    const second = await createCustomer(prisma);

    await partners.apply(application({ taxId: '01234567' }), first.user.id);

    await expect(
      partners.apply(application({ displayName: 'Ararat', taxId: '01234567' }), second.user.id),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('keeps the number when one is given', async () => {
    const { user } = await createCustomer(prisma);

    const partner = await partners.apply(application({ taxId: '76543210' }), user.id);

    expect(partner.taxId).toBe('76543210');
  });

  it('makes the applicant the owner of the partner they applied for', async () => {
    const { user } = await createCustomer(prisma);

    const partner = await partners.apply(application(), user.id);

    const membership = await prisma.partnerMembership.findFirst({
      where: { partnerId: partner.id, userId: user.id },
    });
    expect(membership).not.toBeNull();
  });

  describe('what the admin panel is given to work with', () => {
    /**
     * The applications page is a filter over this one list — there is no
     * separate "pending applications" endpoint. So the page can only exist
     * if `status` actually survives the projection, and `list()` builds its
     * rows through `toPublicDto`, whose name says the opposite. It does
     * survive, because that helper only strips the asset rows and spreads
     * the rest, but that is an implementation detail one refactor away from
     * quietly emptying the queue.
     */
    it('includes the status, so an application can be told from a partner', async () => {
      const { user } = await createCustomer(prisma);
      await partners.apply(application(), user.id);

      const listed = await partners.list();

      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ status: PartnerStatus.PENDING_APPROVAL });
    });

    it('includes the tax number, so you can see who still owes you one', async () => {
      const { user } = await createCustomer(prisma);
      await partners.apply(application({ taxId: '11223344' }), user.id);

      const listed = await partners.list();

      expect(listed[0]).toMatchObject({ taxId: '11223344', legalName: 'Nairi Foods LLC' });
    });
  });

  describe('deciding on an application', () => {
    it('approving lets the partner trade on the rate they proposed', async () => {
      const { user } = await createCustomer(prisma);
      const applied = await partners.apply(application({ taxId: '55667788' }), user.id);

      const approved = await partners.approve(applied.id);

      expect(approved).toMatchObject({
        status: PartnerStatus.ACTIVE,
        isActive: true,
        // Untouched by approval: approving is a yes to the applicant's offer.
        bonusAccrualRateBps: 1000,
      });
    });

    it('rejecting records the reason and leaves the business unable to trade', async () => {
      const { user } = await createCustomer(prisma);
      const applied = await partners.apply(application(), user.id);

      const rejected = await partners.reject(applied.id, 'Duplicate of an existing partner');

      expect(rejected).toMatchObject({ status: PartnerStatus.REJECTED, isActive: false });
    });

    it('refuses to approve the same application twice', async () => {
      const { user } = await createCustomer(prisma);
      const applied = await partners.apply(application(), user.id);
      await partners.approve(applied.id);

      await expect(partners.approve(applied.id)).rejects.toMatchObject({ status: 409 });
    });
  });

  it('refuses a rate that is not on the 0.5% grid', async () => {
    const { user } = await createCustomer(prisma);

    await expect(
      partners.apply({ ...application(), bonusAccrualRateBps: 1020 }, user.id),
    ).rejects.toMatchObject({ status: 400 });
  });
});
