import { PrismaClient, RoleName } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What a partner record discloses, and to whom.
 *
 * The directory has to be readable by every signed-in user — a customer needs
 * to find where their points are worth something. What it hands over is the
 * question, and the answer was "the whole row": tax IDs, the commission rate
 * negotiated with that partner individually, and `payoutsBlockedReason`,
 * which announces that a business is in a financial dispute and why.
 *
 * Both holes here were found by making the requests, not by reading the code,
 * and the second survived the first fix: `PARTNER_OWNER` also holds
 * `PARTNER_MANAGE` — owners manage their *own* partner — so a check written
 * against the permission name handed every partner owner the commercial terms
 * of every competitor on the platform. A permission name is not an
 * authorization decision; the scope is.
 */
describe('Partner disclosure (integration)', () => {
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

  const COMMERCIAL = ['taxId', 'paymentCommissionRateBps', 'payoutsBlockedReason', 'legalName'];

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

  it('gives a customer the directory without any commercial terms', async () => {
    await createPartner(prisma);

    const rows = await controller.list(asUser({}));
    expect(rows).toHaveLength(1);
    for (const field of COMMERCIAL) {
      expect(rows[0]).not.toHaveProperty(field);
    }
    // What a customer is entitled to: where to go, and what they earn there.
    expect(rows[0]).toHaveProperty('displayName');
    expect(rows[0]).toHaveProperty('bonusAccrualRateBps');
  });

  it('gives a platform admin the full record', async () => {
    await createPartner(prisma);

    const rows = await controller.list(asUser({ roles: [RoleName.ADMIN] }));
    for (const field of COMMERCIAL) {
      expect(rows[0]).toHaveProperty(field);
    }
  });

  it("lets a partner's own owner read their own record in full", async () => {
    const partner = await createPartner(prisma);

    const row = await controller.get(
      asUser({
        roles: [RoleName.PARTNER_OWNER],
        partnerScopes: { PARTNER_OWNER: [partner.id] },
      }),
      partner.id,
    );
    expect(row).toHaveProperty('taxId');
  });

  it("does not let a partner owner read a competitor's terms", async () => {
    const mine = await createPartner(prisma);
    const theirs = await createPartner(prisma, { displayName: 'Rival' });

    const owner = asUser({
      roles: [RoleName.PARTNER_OWNER],
      // The scope that matters. The permission list is deliberately the real
      // one — PARTNER_OWNER does hold PARTNER_MANAGE — because that is the
      // exact condition the first fix got wrong.
      permissions: ['PARTNER_MANAGE'] as RequestUser['permissions'],
      partnerScopes: { PARTNER_OWNER: [mine.id] },
    });

    const row = await controller.get(owner, theirs.id);
    for (const field of COMMERCIAL) {
      expect(row).not.toHaveProperty(field);
    }

    const rows = await controller.list(owner);
    for (const row of rows) {
      for (const field of COMMERCIAL) {
        expect(row).not.toHaveProperty(field);
      }
    }
  });
});
