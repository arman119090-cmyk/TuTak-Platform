import { PartnerStatus, PermissionName, PrismaClient, RoleName } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { ROLE_PERMISSIONS } from '../src/scripts/role-permissions';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Can a customer actually find the restaurant, and is what they find true?
 *
 * `Partner.category` is a free-text column, and the two sides of it disagree.
 * Reads normalise through `toPartnerCategory` — trim, lowercase, anything
 * unrecognised becomes `other` — but the map's filter is an exact SQL match
 * on the raw column. So a restaurant stored as `"Restaurant"`, with the
 * capital letter its owner typed, draws a restaurant pin and is invisible to
 * the restaurant chip; and one stored as `"retail"` (the value this repo's
 * own fixtures use) draws an `other` pin that the `other` chip does not
 * return either. Neither is fixable from any panel — it needs someone with a
 * SQL prompt, which is exactly the manual workaround this work exists to
 * remove.
 *
 * The second half is about honesty rather than reach: `listPublic()` selects
 * every partner row with no status filter at all, so an application still
 * awaiting a decision — or one that was rejected — is served to any
 * authenticated customer through `GET /partners`, and `GET /partners/:id`
 * describes it without ever saying which it is. `nearby` does filter
 * (`partner.isActive`), which is why this never reached the map; the
 * directory and the detail route are the ones that never got the check.
 */
describe('Finding a restaurant, and being told the truth about it (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let partners: PartnersController;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    partners = harness.app.get(PartnersController);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** Republic Square, Yerevan — every branch below sits on top of it. */
  const HERE = { lat: 40.1776, lng: 44.5126 };

  const customer = async (): Promise<RequestUser> => {
    const { user } = await createCustomer(prisma);
    return {
      id: user.id,
      phone: user.phone,
      roles: [RoleName.CUSTOMER],
      permissions: [],
      partnerScopes: {},
      mustChangePassword: false,
    } as RequestUser;
  };

  const admin = async (): Promise<RequestUser> => {
    const { user } = await createCustomer(prisma);
    return {
      id: user.id,
      phone: user.phone,
      roles: [RoleName.ADMIN],
      permissions: ROLE_PERMISSIONS[RoleName.ADMIN],
      partnerScopes: {},
      mustChangePassword: false,
    } as RequestUser;
  };

  const branchAt = (partnerId: string, name = 'Main') =>
    prisma.partnerBranch.create({
      data: {
        partnerId,
        name,
        address: 'Republic Square 1',
        city: 'Yerevan',
        latitude: HERE.lat,
        longitude: HERE.lng,
      },
    });

  const nearby = (user: RequestUser, category?: string) =>
    partners.nearby(user, {
      lat: HERE.lat,
      lng: HERE.lng,
      radiusKm: 5,
      ...(category ? { category: category as never } : {}),
    } as never);

  // ── Reach ────────────────────────────────────────────────────────────

  it.each([
    ['a capital letter', ' Restaurant', 'restaurant'],
    ['stray whitespace', '  restaurant ', 'restaurant'],
    ['shouting', 'CAFE', 'cafe'],
  ])('normalises a category typed with %s', async (_case, typed, stored) => {
    // Typed by the applicant, into the one field of the form that has no
    // picker behind it.
    const applicant = await customer();

    const partner = await partners.apply(applicant, {
      legalName: 'Typed By Hand LLC',
      displayName: 'Typed By Hand',
      category: typed,
      bonusAccrualRateBps: 500,
    });

    const row = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(row.category).toBe(stored);
  });

  it('refuses to store a category that is not canonical, whatever writes it', async () => {
    // The guarantee the filter rests on, held by PostgreSQL rather than by
    // every writer remembering. Without it the column drifts back the first
    // time a row is written by a seed, a support script, or an endpoint
    // somebody adds later — and the symptom is a restaurant that is drawn
    // under one chip and returned by another, which no panel can fix.
    await expect(createPartner(prisma, { category: 'Restaurant' })).rejects.toThrow(
      /partners_category_canonical/,
    );
  });

  it('draws the same category it filters by', async () => {
    // The property the two above exist to produce: whatever category a card
    // shows is the chip that returns it. Asserted as a pair, not one side.
    const partner = await createPartner(prisma, { category: 'cafe', displayName: 'Coffeeshop' });
    await branchAt(partner.id);
    const me = await customer();

    const cards = await nearby(me);
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.category).toBe('cafe');
    expect((await nearby(me, card.category)).map((p) => p.name)).toContain('Coffeeshop');
  });

  it('returns partners with an unrecognised category under the chip they are drawn as', async () => {
    // A partner whose category nothing recognises is drawn as `other`. The
    // `other` chip has to mean the same thing, or it is a filter that
    // matches a card nobody can see by any other route.
    const partner = await createPartner(prisma, { category: 'retail', displayName: 'Corner Shop' });
    await branchAt(partner.id);
    const me = await customer();

    const cards = await nearby(me);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.category).toBe('other');
    expect((await nearby(me, 'other')).map((p) => p.name)).toContain('Corner Shop');
  });

  it('does not sweep known categories into the other chip', async () => {
    const known = await createPartner(prisma, { category: 'restaurant', displayName: 'Dolmama' });
    await branchAt(known.id);
    const me = await customer();

    expect(await nearby(me, 'other')).toEqual([]);
  });

  // ── Honesty ──────────────────────────────────────────────────────────

  it('keeps an application still awaiting a decision out of the customer directory', async () => {
    const applicant = await customer();
    await partners.apply(applicant, {
      legalName: 'Not Yet LLC',
      displayName: 'Not Yet Open',
      category: 'restaurant',
      bonusAccrualRateBps: 2000,
    });
    const me = await customer();

    const directory = await partners.list(me);

    expect(directory.map((p) => p.displayName)).not.toContain('Not Yet Open');
  });

  it('keeps a rejected restaurant out of it too', async () => {
    const applicant = await customer();
    const pending = await partners.apply(applicant, {
      legalName: 'Turned Down LLC',
      displayName: 'Turned Down',
      category: 'restaurant',
      bonusAccrualRateBps: 500,
    });
    await partners.rejectPartner(await admin(), pending.id, { reason: 'Not a real business' });
    const me = await customer();

    expect((await partners.list(me)).map((p) => p.displayName)).not.toContain('Turned Down');
  });

  it('keeps a switched-off restaurant out of it', async () => {
    const partner = await createPartner(prisma, {
      category: 'restaurant',
      displayName: 'Closed Down',
    });
    await partners.setActive(await admin(), partner.id, { isActive: false });
    const me = await customer();

    expect((await partners.list(me)).map((p) => p.displayName)).not.toContain('Closed Down');
  });

  it('still lists an approved restaurant', async () => {
    const applicant = await customer();
    const pending = await partners.apply(applicant, {
      legalName: 'Dolmama LLC',
      displayName: 'Dolmama',
      category: 'restaurant',
      bonusAccrualRateBps: 500,
    });
    await partners.approvePartner(await admin(), pending.id);
    const me = await customer();

    expect((await partners.list(me)).map((p) => p.displayName)).toContain('Dolmama');
  });

  it('still shows an administrator every partner, whatever its status', async () => {
    // The directory narrows for customers, not for the people whose job is
    // to look at applications. `list()` and `listPublic()` are different
    // methods and only one of them is being filtered.
    const applicant = await customer();
    await partners.apply(applicant, {
      legalName: 'Not Yet LLC',
      displayName: 'Not Yet Open',
      category: 'restaurant',
      bonusAccrualRateBps: 500,
    });

    expect((await partners.list(await admin())).map((p) => p.displayName)).toContain('Not Yet Open');
  });

  it('says on the record itself whether a restaurant is open for business', async () => {
    // A customer holding a deep link to a partner page gets the row
    // straight from `GET /partners/:id`, which never filtered by status and
    // never reported one either — so a pending or rejected business read
    // exactly like a trading one.
    const applicant = await customer();
    const pending = await partners.apply(applicant, {
      legalName: 'Not Yet LLC',
      displayName: 'Not Yet Open',
      category: 'restaurant',
      bonusAccrualRateBps: 500,
    });
    const me = await customer();

    const row = await partners.get(me, pending.id);

    expect(row).toMatchObject({ status: PartnerStatus.PENDING_APPROVAL, isActive: false });
  });

  it('tells the customer how much of a bill this restaurant lets bonus cover', async () => {
    // `maxBonusPaymentPercent` is the partner's own published term and the
    // one number that decides whether the amount a customer types will be
    // accepted. It was on the private projection only, so the first time
    // anyone learned it was a refusal at the till.
    const partner = await createPartner(prisma, {
      category: 'restaurant',
      displayName: 'Dolmama',
      maxBonusPaymentPercent: 30,
    });
    const me = await customer();

    expect(await partners.get(me, partner.id)).toMatchObject({ maxBonusPaymentPercent: 30 });
  });

  it('still keeps the commercial terms behind the counter', async () => {
    // Widening the public projection is exactly how `taxId` and the
    // commission rate leak. Asserted here, next to the widening.
    const partner = await createPartner(prisma, { category: 'restaurant' });
    const me = await customer();

    const row = await partners.get(me, partner.id);

    for (const field of ['taxId', 'paymentCommissionRateBps', 'payoutsBlockedReason']) {
      expect(row).not.toHaveProperty(field);
    }
  });

  it('gives the restaurant its own people the full record, as before', async () => {
    const partner = await createPartner(prisma, { category: 'restaurant' });
    const { user } = await createCustomer(prisma);
    const owner = {
      id: user.id,
      phone: user.phone,
      roles: [RoleName.PARTNER_OWNER],
      permissions: ROLE_PERMISSIONS[RoleName.PARTNER_OWNER] as PermissionName[],
      partnerScopes: { [RoleName.PARTNER_OWNER]: [partner.id] },
      mustChangePassword: false,
    } as RequestUser;

    expect(await partners.get(owner, partner.id)).toHaveProperty('taxId');
  });
});
