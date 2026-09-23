import {
  LedgerAccountType,
  PostingDirection,
  PrismaClient,
  RoleName,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PartnerSettlementPartnerController } from '../src/modules/partner-settlements/partner-settlement.controller';
import { PartnerSettlementService } from '../src/modules/partner-settlements/partner-settlement.service';
import { PartnerBranchStaffService } from '../src/modules/partners/partner-branch-staff.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What TuTak keeps to itself, across every money surface at once.
 *
 * The breakdown endpoint has its own disclosure test, because it is the one
 * that itemises a single sale and is therefore the likeliest place to leak.
 * This is the question that test cannot answer: whether the *other* three
 * reads a partner has — the position, the statement and the activity feed —
 * ever carry TuTak's own economics.
 *
 * It is deliberately one sweep rather than three near-identical tests. The
 * sale is built so that every forbidden number is non-zero and distinct, so
 * a leak shows up as a value even if somebody renames the field.
 */
describe('Partner money reads keep TuTak’s own economics out (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnerSettlementPartnerController;
  let settlements: PartnerSettlementService;
  let intents: PurchaseIntentsService;
  let branchStaff: PartnerBranchStaffService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    controller = harness.app.get(PartnerSettlementPartnerController);
    settlements = harness.app.get(PartnerSettlementService);
    intents = harness.app.get(PurchaseIntentsService);
    branchStaff = harness.app.get(PartnerBranchStaffService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const owner = (id: string, partnerId: string): RequestUser => ({
    id,
    phone: '+37400000000',
    roles: [RoleName.PARTNER_OWNER],
    permissions: [],
    partnerScopes: { PARTNER_OWNER: [partnerId] },
    branchIds: [],
    allBranchPartnerIds: [partnerId],
    mustChangePassword: false,
  });

  const hire = async (partnerId: string, role: RoleName = RoleName.PARTNER_STAFF) => {
    const user = await createStaffUser(prisma);
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: (await prisma.role.findFirstOrThrow({ where: { name: role } })).id,
        partnerId,
      },
    });
    return user;
  };

  /** The field names that describe TuTak's side of a sale, never a partner's. */
  const SECRET_FIELDS = [
    'poolAmount',
    'greenAmount',
    'deferredAmount',
    'tutakAmount',
    'referrerAmount',
    'referrer1Amount',
    'referrer2Amount',
    'referrer3Amount',
    'paymentCommissionRateBps',
  ];

  /**
   * One confirmed sale, one drafted settlement, and the stored snapshot of
   * what TuTak kept from it.
   */
  const aSaleAndASettlement = async () => {
    const partner = await createPartner(prisma);
    const ownerUser = await hire(partner.id, RoleName.PARTNER_OWNER);
    const cashier = await hire(partner.id);
    const customer = await createCustomer(prisma);
    const branch = await prisma.partnerBranch.create({
      data: {
        partnerId: partner.id,
        name: 'North',
        address: 'North 1',
        city: 'Yerevan',
        latitude: 40.18,
        longitude: 44.51,
      },
    });
    await branchStaff.assign(partner.id, branch.id, {
      userId: cashier.id,
      assignedByUserId: ownerUser.id,
    });
    const intent = await intents.create(
      { partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '10000' },
      customer.user.id,
    );
    await intents.confirm(intent.id, cashier.id);

    // A plain sale leaves the payable negative — the partner's contribution
    // exceeds what TuTak compensates — and a draft needs a positive balance.
    // This is the same shape as a customer spending bonus at the till.
    const [payable, bonus] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: partner.id }),
      ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }),
    ]);
    await ledger.post({
      kind: 'partner.bonus_redemption_compensation',
      sourceType: 'PurchaseIntent',
      sourceId: `compensation-${intent.id}`,
      postings: [
        { accountId: bonus.id, direction: PostingDirection.DEBIT, amount: new Decimal('4000') },
        { accountId: payable.id, direction: PostingDirection.CREDIT, amount: new Decimal('4000') },
      ],
    });
    const draft = await settlements.createDraft({
      partnerId: partner.id,
      actorId: ownerUser.id,
      periodStart: new Date(Date.now() - 86_400_000),
      periodEnd: new Date(Date.now() + 60_000),
    });
    const stored = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    return { partner, ownerUser, draft, stored };
  };

  it('keeps TuTak’s side out of the position, the statement and the activity feed', async () => {
    const { partner, ownerUser, draft, stored } = await aSaleAndASettlement();
    const actor = owner(ownerUser.id, partner.id);

    const answers = {
      position: await controller.position(actor, partner.id),
      statements: await controller.statements(actor, partner.id),
      statement: await controller.statement(actor, partner.id, draft.id),
      activity: await controller.activity(actor, partner.id, {}),
    };

    for (const [surface, answer] of Object.entries(answers)) {
      const serialised = JSON.stringify(answer);
      for (const field of SECRET_FIELDS) {
        expect({ surface, field, leaked: serialised.includes(`"${field}"`) }).toEqual({
          surface,
          field,
          leaked: false,
        });
      }
      /*
       * And not as a bare number either: a reader who knows the gross could
       * match TuTak's share against it even with the field name stripped off.
       *
       * `poolAmount` is deliberately not in this list. The pool *is* the
       * partner's own contribution — the money they put in, which TuTak then
       * divides — so it appears in the statement as `partner.contribution`
       * and is exactly what the partner is entitled to see. What must not
       * appear is the division: TuTak's residual and the green and deferred
       * slices. A first version of this test asserted on the pool too and
       * failed against the partner's own contribution, which would have been
       * the wrong thing to "fix" in the code.
       */
      for (const secret of [stored.tutakAmount, stored.greenAmount, stored.deferredAmount]) {
        if (secret && !secret.isZero()) {
          expect({ surface, value: serialised.includes(secret.toFixed(4)) }).toEqual({
            surface,
            value: false,
          });
        }
      }
    }
  });

  it('gives the partner their own contribution, which is the thing they are owed against', async () => {
    const { partner, ownerUser } = await aSaleAndASettlement();

    const position = await controller.position(owner(ownerUser.id, partner.id), partner.id);

    // The point of the confidentiality rule is not that the partner is told
    // nothing: it is that they are told their own half in full. If this ever
    // fails, the screen has stopped being able to answer "why do I owe this".
    expect(position.funding).toHaveProperty('contribution');
    expect(Number(position.funding.salesGross)).toBeGreaterThan(0);
  });

  it('does not let one partner see another’s rate through their own reads', async () => {
    const { partner, ownerUser } = await aSaleAndASettlement();
    const rival = await createPartner(prisma, { displayName: 'Rival' });
    await prisma.partner.update({
      where: { id: rival.id },
      data: { paymentCommissionRateBps: 777 },
    });

    const serialised = JSON.stringify({
      position: await controller.position(owner(ownerUser.id, partner.id), partner.id),
      activity: await controller.activity(owner(ownerUser.id, partner.id), partner.id, {}),
    });

    expect(serialised).not.toContain(rival.id);
    expect(serialised).not.toContain('777');
  });
});
