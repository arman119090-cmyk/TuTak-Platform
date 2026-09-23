import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  LedgerAccountType,
  PermissionName,
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
 * The partner's own account, line by line.
 *
 * Two things are being pinned here and they pull in opposite directions.
 * The list has to be complete and stable enough that a partner can page
 * through six months and reconcile it against their till — which is what
 * the keyset cases are about. And it must never let a filtered subtotal
 * pass for what the organisation is owed, which is what the `selection`
 * cases are about.
 */
describe('Partner account activity (integration)', () => {
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

  const aBranch = async (partnerId: string, name: string) =>
    prisma.partnerBranch.create({
      data: {
        partnerId,
        name,
        address: `${name} 1`,
        city: 'Yerevan',
        latitude: 40.18,
        longitude: 44.51,
      },
    });

  /** A business with a cashier at each of two branches. */
  const aBusiness = async () => {
    const partner = await createPartner(prisma);
    const ownerUser = await hire(partner.id, RoleName.PARTNER_OWNER);
    const cashier = await hire(partner.id);
    const north = await aBranch(partner.id, 'North');
    const south = await aBranch(partner.id, 'South');
    for (const branch of [north, south]) {
      await branchStaff.assign(partner.id, branch.id, {
        userId: cashier.id,
        assignedByUserId: ownerUser.id,
      });
    }
    return { partner, ownerUser, cashier, north, south };
  };

  const sell = async (
    partnerId: string,
    branchId: string,
    cashierId: string,
    grossAmount = '10000',
  ) => {
    const customer = await createCustomer(prisma);
    const intent = await intents.create(
      { partnerId, partnerBranchId: branchId, grossAmount },
      customer.user.id,
    );
    await intents.confirm(intent.id, cashierId);
    return intent;
  };

  /**
   * Enough compensation on the payable that a settlement may be drafted.
   *
   * A plain sale under the default terms leaves the payable *negative* —
   * the partner's contribution exceeds what TuTak compensates — and
   * `createDraft` refuses a non-positive balance, by design. This is the
   * same shape as a customer spending bonus at the till.
   */
  const compensate = async (partnerId: string, amount: string) => {
    const [payable, bonus] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
      ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }),
    ]);
    await ledger.post({
      kind: 'partner.bonus_redemption_compensation',
      sourceType: 'PurchaseIntent',
      sourceId: `purchase-${Math.random().toString(36).slice(2)}`,
      postings: [
        { accountId: bonus.id, direction: PostingDirection.DEBIT, amount: new Decimal(amount) },
        { accountId: payable.id, direction: PostingDirection.CREDIT, amount: new Decimal(amount) },
      ],
    });
  };

  it('is gated on the same permission as the position it itemises', () => {
    const permissions = Reflect.getMetadata(
      'permissions',
      (controller as unknown as Record<string, unknown>).activity as object,
    ) as PermissionName[];
    expect(permissions).toContain(PermissionName.SETTLEMENT_READ);
  });

  it('refuses another business the same way every other money read does', async () => {
    const { partner, ownerUser } = await aBusiness();
    const stranger = await createPartner(prisma);

    await expect(
      controller.activity(owner(ownerUser.id, partner.id), stranger.id, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gives a row the date, a quotable number, the debt change and who confirmed it', async () => {
    const { partner, ownerUser, cashier, north } = await aBusiness();
    const intent = await sell(partner.id, north.id, cashier.id);

    const page = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {});

    expect(page.rows.length).toBeGreaterThan(0);
    const sale = page.rows.find((row) => row.sourceId === intent.id);
    expect(sale).toBeDefined();
    expect(sale!.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Quotable, and derived from the id that will still name this purchase
    // next year — not from the four digits that go back in the pool.
    expect(sale!.reference).toBe(intent.id.replace(/-/g, '').slice(-8).toUpperCase());
    expect(sale!.employeeCode).toMatch(/^EMP-\d{3}$/);
    expect(sale!.confirmationSource).toBe('STAFF');
    expect(sale!.branch).toBe('North');
    expect(sale!.state).toBe('UNSETTLED');
    expect(sale!.itemisable).toBe(true);
  });

  it('names the branch and nothing above it — no organisation chain on the row', async () => {
    const { partner, ownerUser, cashier, north } = await aBusiness();
    await sell(partner.id, north.id, cashier.id);

    const page = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {});

    for (const row of page.rows) {
      expect(typeof row.branch === 'string' || row.branch === null).toBe(true);
      const serialised = JSON.stringify(row);
      expect(serialised).not.toContain(partner.legalName);
      expect(serialised).not.toContain(partner.id);
    }
  });

  it('signs the debt change the way the payable does: a credit raises the debt', async () => {
    const { partner, ownerUser, cashier, north } = await aBusiness();
    await sell(partner.id, north.id, cashier.id);

    const page = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {});
    const credits = page.rows.filter((row) => Number(row.debtChange) > 0);
    const debits = page.rows.filter((row) => Number(row.debtChange) < 0);

    // A contribution is a debit on the payable and a compensation a credit;
    // whichever this partner's terms produce, the signs must not both be
    // positive, or the column means nothing.
    expect(credits.length + debits.length).toBe(page.rows.length);
    const net = page.rows.reduce((sum, row) => sum + Number(row.debtChange), 0);
    expect(Number(page.selection.net)).toBeCloseTo(net, 4);
  });

  it('pages with a cursor, returning every line exactly once', async () => {
    const { partner, ownerUser, cashier, north } = await aBusiness();
    for (let i = 0; i < 5; i += 1) await sell(partner.id, north.id, cashier.id);

    const all = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {});
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let guard = 0;
    do {
      const page = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {
        limit: 2,
        cursor: cursor ?? undefined,
      });
      seen.push(...page.rows.map((row) => row.postingId));
      cursor = page.nextCursor;
      guard += 1;
    } while (cursor && guard < 50);

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(all.rows.map((row) => row.postingId).sort());
  });

  it('does not shift the window when a newer line arrives mid-paging', async () => {
    const { partner, ownerUser, cashier, north } = await aBusiness();
    for (let i = 0; i < 4; i += 1) await sell(partner.id, north.id, cashier.id);

    const first = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {
      limit: 2,
    });
    // A sale lands while the partner is reading page one. With OFFSET this
    // pushes an unread row off the end of page two for ever; with a keyset
    // it simply sorts above the cursor and is not in the rest of the walk.
    await sell(partner.id, north.id, cashier.id);

    const oldest = first.rows[first.rows.length - 1];
    expect(oldest).toBeDefined();
    const seen = [...first.rows.map((row) => row.postingId)];
    let cursor = first.nextCursor;
    let guard = 0;
    while (cursor && guard < 50) {
      const page = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {
        limit: 2,
        cursor,
      });
      seen.push(...page.rows.map((row) => row.postingId));
      cursor = page.nextCursor;
      guard += 1;
    }

    expect(new Set(seen).size).toBe(seen.length);
    const before = await prisma.ledgerPosting.findMany({
      where: {
        account: { partnerId: partner.id, type: 'PARTNER_PAYABLE' },
        transaction: { postedAt: { lte: new Date(oldest!.occurredAt) } },
      },
      select: { id: true },
    });
    // Everything at or below the first page's last row is still reachable.
    for (const posting of before) expect(seen).toContain(posting.id);
  });

  it('refuses a cursor it did not issue instead of silently restarting', async () => {
    const { partner, ownerUser, cashier, north } = await aBusiness();
    await sell(partner.id, north.id, cashier.id);

    await expect(
      controller.activity(owner(ownerUser.id, partner.id), partner.id, { cursor: 'not-a-cursor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a bad cursor even on an account with nothing in it', async () => {
    const partner = await createPartner(prisma);
    const ownerUser = await hire(partner.id, RoleName.PARTNER_OWNER);

    // The early "no account yet" return must not answer a malformed cursor
    // with an empty page: that reads as "you have no activity".
    await expect(
      controller.activity(owner(ownerUser.id, partner.id), partner.id, { cursor: 'not-a-cursor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters to one branch and totals that branch, not the business', async () => {
    const { partner, ownerUser, cashier, north, south } = await aBusiness();
    await sell(partner.id, north.id, cashier.id, '10000');
    await sell(partner.id, south.id, cashier.id, '30000');

    const whole = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {});
    const onlyNorth = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {
      branchId: north.id,
    });

    expect(onlyNorth.rows.every((row) => row.branch === 'North')).toBe(true);
    expect(onlyNorth.rows.length).toBeLessThan(whole.rows.length);
    expect(onlyNorth.filtered).toBe(true);
    expect(whole.filtered).toBe(false);
    // The selection sums the selection. The point of the flag is that a
    // screen can say so rather than printing it next to the balance.
    expect(onlyNorth.selection.rowCount).toBe(onlyNorth.rows.length);
    expect(Number(onlyNorth.selection.net)).not.toBeCloseTo(Number(whole.selection.net), 4);
  });

  it('never presents itself as the organisation position', async () => {
    const { partner, ownerUser, cashier, north } = await aBusiness();
    await sell(partner.id, north.id, cashier.id);

    const page = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {});

    // The position's own field names must not appear here: a client that can
    // read `ledgerBalance` off a filtered page will eventually print it.
    const keys = Object.keys(page).concat(Object.keys(page.selection));
    for (const forbidden of ['ledgerBalance', 'inOpenSettlements', 'paidTotal', 'underReview']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('moves a line from UNSETTLED to IN_SETTLEMENT when a draft claims it', async () => {
    const { partner, ownerUser, cashier, north } = await aBusiness();
    await sell(partner.id, north.id, cashier.id);
    await compensate(partner.id, '50000');
    await prisma.partnerBankAccount.create({
      data: {
        partnerId: partner.id,
        beneficiaryName: 'ООО Тест',
        accountNumber: 'AM00 0000 0000 0000',
        bankName: 'Тестбанк',
        createdByUserId: ownerUser.id,
      },
    });
    const before = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {
      state: 'UNSETTLED',
    });
    expect(before.rows.length).toBeGreaterThan(0);

    await settlements.createDraft({
      partnerId: partner.id,
      actorId: ownerUser.id,
      periodStart: new Date(Date.now() - 86_400_000),
      periodEnd: new Date(Date.now() + 86_400_000),
    });

    const stillUnsettled = await controller.activity(
      owner(ownerUser.id, partner.id),
      partner.id,
      { state: 'UNSETTLED' },
    );
    const claimed = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {
      state: 'IN_SETTLEMENT',
    });

    expect(stillUnsettled.rows).toHaveLength(0);
    expect(claimed.rows.length).toBe(before.rows.length);
    expect(claimed.rows.every((row) => row.settlementId !== null)).toBe(true);
    // A draft is not a transfer. Nothing may read PAID here.
    expect(claimed.rows.every((row) => row.state === 'IN_SETTLEMENT')).toBe(true);
  });

  it('bounds the window by date without dropping the rows outside it from the account', async () => {
    const { partner, ownerUser, cashier, north } = await aBusiness();
    await sell(partner.id, north.id, cashier.id);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const empty = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {
      from: future,
    });
    const whole = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {});

    expect(empty.rows).toHaveLength(0);
    expect(empty.selection.rowCount).toBe(0);
    expect(empty.selection.net).toBe('0.0000');
    expect(whole.rows.length).toBeGreaterThan(0);
  });

  it('answers an account nobody has posted to with an empty page, not an error', async () => {
    const partner = await createPartner(prisma);
    const ownerUser = await hire(partner.id, RoleName.PARTNER_OWNER);

    const page = await controller.activity(owner(ownerUser.id, partner.id), partner.id, {});

    expect(page.rows).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
    expect(page.selection).toEqual({
      credits: '0.0000',
      debits: '0.0000',
      net: '0.0000',
      rowCount: 0,
    });
  });
});
