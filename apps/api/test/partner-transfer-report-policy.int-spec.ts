import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  PartnerSettlementStatus,
  PermissionName,
  PostingDirection,
  PrismaClient,
  ReconciliationOutcome,
  ReconciliationSource,
  RoleName,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerAccountType } from '@prisma/client';
import { PartnerSettlementPartnerController } from '../src/modules/partner-settlements/partner-settlement.controller';
import { PartnerSettlementService } from '../src/modules/partner-settlements/partner-settlement.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The one write a partner has on their own money, and what it may not do.
 *
 * The owner's brief of 22.09.2026 asked for three things to be proved about
 * this exception rather than assumed, and noted that a test showing the
 * access is allowed proves nothing about whether the policy is right. So
 * what is pinned here is the policy:
 *
 *  1. the scope is no wider than it has to be;
 *  2. nothing closed leaks back through the response;
 *  3. the report changes neither the ledger nor the payout status.
 *
 * Two of the three failed before 22.09.2026. The route carried no
 * permission at all, and filing a report moved the settlement to
 * `REQUIRES_RECONCILIATION` — a payout-status change made on the payee's
 * own unverified word, by anybody on their payroll.
 */
describe('Partner transfer-problem report: the policy (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnerSettlementPartnerController;
  let settlements: PartnerSettlementService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    controller = harness.app.get(PartnerSettlementPartnerController);
    settlements = harness.app.get(PartnerSettlementService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const actor = (
    id: string,
    partnerId: string,
    role: RoleName,
    permissions: PermissionName[],
  ): RequestUser => ({
    id,
    phone: '+37400000000',
    roles: [role],
    permissions,
    partnerScopes: { [role]: [partnerId] } as RequestUser['partnerScopes'],
    branchIds: [],
    allBranchPartnerIds: [partnerId],
    mustChangePassword: false,
  });

  /** A settlement whose transfer TuTak says it has sent. */
  async function sentTransfer() {
    const partner = await createPartner(prisma);
    const owner = await createStaffUser(prisma);
    const maker = await createStaffUser(prisma);
    const checker = await createStaffUser(prisma);
    await prisma.partnerBankAccount.create({
      data: {
        partnerId: partner.id,
        beneficiaryName: 'ООО Тест',
        accountNumber: 'AM00 0000 0000 0000',
        bankName: 'Тестбанк',
        createdByUserId: maker.id,
      },
    });
    const [payable, bonus] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: partner.id }),
      ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }),
    ]);
    await ledger.post({
      kind: 'partner.bonus_redemption_compensation',
      sourceType: 'PurchaseIntent',
      sourceId: `purchase-${Math.random().toString(36).slice(2)}`,
      postings: [
        { accountId: bonus.id, direction: PostingDirection.DEBIT, amount: new Decimal('9000') },
        { accountId: payable.id, direction: PostingDirection.CREDIT, amount: new Decimal('9000') },
      ],
    });
    const draft = await settlements.createDraft({
      partnerId: partner.id,
      actorId: maker.id,
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-10-01T00:00:00Z'),
    });
    await settlements.markReady(draft.id, { actorId: maker.id, documentNumber: 'ФАКТУРА-1' });
    await settlements.approve(draft.id, checker.id);
    await settlements.markPaymentPending(draft.id, checker.id);
    return { partner, owner, maker, checker, settlement: draft };
  }

  /** Everything on this partner's payable, as a single signed figure. */
  async function payable(partnerId: string): Promise<string> {
    const postings = await prisma.ledgerPosting.findMany({
      where: { account: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId } },
      select: { amount: true, direction: true },
    });
    return postings
      .reduce(
        (sum, row) =>
          row.direction === PostingDirection.CREDIT
            ? sum.plus(new Decimal(row.amount))
            : sum.minus(new Decimal(row.amount)),
        new Decimal(0),
      )
      .toFixed(4);
  }

  describe('1. the scope is no wider than it has to be', () => {
    it('demands the same permission as the reads it is about', () => {
      const permissions = Reflect.getMetadata(
        'permissions',
        (controller as unknown as Record<string, unknown>).reportProblem as object,
      ) as PermissionName[];
      expect(permissions).toContain(PermissionName.SETTLEMENT_READ);
    });

    it('refuses a manager, whose financial access this must not widen', async () => {
      const { partner, settlement } = await sentTransfer();
      const manager = await createStaffUser(prisma);

      // The guard that enforces this in the running application is
      // `PermissionsGuard`, which reads the same metadata asserted above;
      // here the point is that a manager does not hold the permission in
      // the first place, which is what makes the gate a narrowing.
      const { ROLE_PERMISSIONS } = await import('../src/scripts/role-permissions');
      expect(ROLE_PERMISSIONS[RoleName.PARTNER_MANAGER]).not.toContain(
        PermissionName.SETTLEMENT_READ,
      );
      expect(ROLE_PERMISSIONS[RoleName.PARTNER_STAFF]).not.toContain(
        PermissionName.SETTLEMENT_READ,
      );
      expect(manager.id).toBeTruthy();
      expect(settlement.partnerId).toBe(partner.id);
    });

    it('refuses another business the way every other money route does', async () => {
      const { settlement, owner } = await sentTransfer();
      const stranger = await createPartner(prisma, { displayName: 'Somebody Else' });

      await expect(
        controller.reportProblem(
          actor(owner.id, stranger.id, RoleName.PARTNER_OWNER, [PermissionName.SETTLEMENT_READ]),
          stranger.id,
          settlement.id,
          { reason: 'Nothing arrived' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a settlement of another business even inside a valid scope', async () => {
      const mine = await sentTransfer();
      const theirs = await sentTransfer();

      await expect(
        controller.reportProblem(
          actor(mine.owner.id, mine.partner.id, RoleName.PARTNER_OWNER, [
            PermissionName.SETTLEMENT_READ,
          ]),
          mine.partner.id,
          theirs.settlement.id,
          { reason: 'Nothing arrived' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses an owner reporting about another business', async () => {
      const { owner, partner, settlement } = await sentTransfer();
      const other = await createPartner(prisma, { displayName: 'Other' });

      await expect(
        controller.reportProblem(
          actor(owner.id, partner.id, RoleName.PARTNER_OWNER, [PermissionName.SETTLEMENT_READ]),
          other.id,
          settlement.id,
          { reason: 'Nothing arrived' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('2. nothing closed comes back through it', () => {
    it('answers with an acknowledgement, not a financial record', async () => {
      const { owner, partner, settlement } = await sentTransfer();

      const answer = await controller.reportProblem(
        actor(owner.id, partner.id, RoleName.PARTNER_OWNER, [PermissionName.SETTLEMENT_READ]),
        partner.id,
        settlement.id,
        { reason: 'Nothing arrived on our account' },
      );

      expect(Object.keys(answer).sort()).toEqual(['id', 'reportedAt', 'status']);
      const serialised = JSON.stringify(answer);
      // None of the figures a settlement carries, and nothing about
      // anybody else: a write that answers with a financial record is how a
      // route quietly becomes a second way to read one.
      for (const leak of [
        'netPayableAmount',
        'accruedAmount',
        'deductionAmount',
        'bankAccountId',
        'beneficiarySnapshot',
        'createdByUserId',
        'approvedByUserId',
        'paidByUserId',
      ]) {
        expect(serialised).not.toContain(leak);
      }
    });
  });

  describe('3. it changes neither the ledger nor the payout status', () => {
    it('leaves the settlement exactly where it was', async () => {
      const { owner, partner, settlement } = await sentTransfer();

      await controller.reportProblem(
        actor(owner.id, partner.id, RoleName.PARTNER_OWNER, [PermissionName.SETTLEMENT_READ]),
        partner.id,
        settlement.id,
        { reason: 'Nothing arrived on our account' },
      );

      const after = await prisma.partnerSettlement.findUniqueOrThrow({
        where: { id: settlement.id },
      });
      expect(after.status).toBe(PartnerSettlementStatus.PAYMENT_PENDING);
      expect(after.paidAt).toBeNull();
      expect(after.bankTransferReference).toBeNull();
      // The report is recorded, though: who said it, when, and that it was
      // the partner rather than finance.
      expect(after.reconciliationSource).toBe(ReconciliationSource.PARTNER_REPORT);
      expect(after.reconciliationReportedByUserId).toBe(owner.id);
      expect(after.reconciliationReportedAt).not.toBeNull();
      // And nothing is proposed: a report is not a finding.
      expect(after.reconciliationOutcome).toBeNull();
      expect(after.reconciliationProposedByUserId).toBeNull();
    });

    it('writes no ledger posting of any kind', async () => {
      const { owner, partner, settlement } = await sentTransfer();
      const before = await payable(partner.id);
      const postingsBefore = await prisma.ledgerPosting.count();

      await controller.reportProblem(
        actor(owner.id, partner.id, RoleName.PARTNER_OWNER, [PermissionName.SETTLEMENT_READ]),
        partner.id,
        settlement.id,
        { reason: 'Nothing arrived' },
      );

      expect(await payable(partner.id)).toBe(before);
      expect(await prisma.ledgerPosting.count()).toBe(postingsBefore);
    });

    it('does not move a single figure of the position', async () => {
      const { owner, partner, settlement } = await sentTransfer();
      const before = await settlements.position(partner.id);

      await controller.reportProblem(
        actor(owner.id, partner.id, RoleName.PARTNER_OWNER, [PermissionName.SETTLEMENT_READ]),
        partner.id,
        settlement.id,
        { reason: 'Nothing arrived' },
      );
      const after = await settlements.position(partner.id);

      // This is the assertion the old behaviour failed: reporting used to
      // move the amount out of "in settlements not yet paid" and into
      // "under review", which is a payout-status change by the payee.
      expect(after.ledgerBalance.toFixed(4)).toBe(before.ledgerBalance.toFixed(4));
      expect(after.inOpenSettlements.toFixed(4)).toBe(before.inOpenSettlements.toFixed(4));
      expect(after.underReview.toFixed(4)).toBe('0.0000');
      expect(after.paidTotal.toFixed(4)).toBe(before.paidTotal.toFixed(4));
    });

    it('writes no transfer attempt: a complaint is not a try at moving money', async () => {
      const { owner, partner, settlement } = await sentTransfer();
      const before = await prisma.partnerSettlementTransferAttempt.count({
        where: { settlementId: settlement.id },
      });

      await controller.reportProblem(
        actor(owner.id, partner.id, RoleName.PARTNER_OWNER, [PermissionName.SETTLEMENT_READ]),
        partner.id,
        settlement.id,
        { reason: 'Nothing arrived' },
      );

      expect(
        await prisma.partnerSettlementTransferAttempt.count({
          where: { settlementId: settlement.id },
        }),
      ).toBe(before);
    });

    it('refuses a report about a transfer nobody has claimed to have sent', async () => {
      const partner = await createPartner(prisma);
      const owner = await createStaffUser(prisma);
      const maker = await createStaffUser(prisma);
      await prisma.partnerBankAccount.create({
        data: {
          partnerId: partner.id,
          beneficiaryName: 'ООО Тест',
          accountNumber: 'AM00 0000 0000 0000',
          bankName: 'Тестбанк',
          createdByUserId: maker.id,
        },
      });
      const [payableAccount, bonus] = await Promise.all([
        ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: partner.id }),
        ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }),
      ]);
      await ledger.post({
        kind: 'partner.bonus_redemption_compensation',
        sourceType: 'PurchaseIntent',
        sourceId: `purchase-${Math.random().toString(36).slice(2)}`,
        postings: [
          { accountId: bonus.id, direction: PostingDirection.DEBIT, amount: new Decimal('4000') },
          {
            accountId: payableAccount.id,
            direction: PostingDirection.CREDIT,
            amount: new Decimal('4000'),
          },
        ],
      });
      const draft = await settlements.createDraft({
        partnerId: partner.id,
        actorId: maker.id,
        periodStart: new Date('2026-09-01T00:00:00Z'),
        periodEnd: new Date('2026-10-01T00:00:00Z'),
      });

      // A draft is being assembled. There is nothing to dispute.
      await expect(
        controller.reportProblem(
          actor(owner.id, partner.id, RoleName.PARTNER_OWNER, [PermissionName.SETTLEMENT_READ]),
          partner.id,
          draft.id,
          { reason: 'Nothing arrived' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('what the report still protects', () => {
    it('keeps the reporter out of judging their own report after finance opens a review', async () => {
      const { owner, partner, settlement, maker, checker } = await sentTransfer();
      await controller.reportProblem(
        actor(owner.id, partner.id, RoleName.PARTNER_OWNER, [PermissionName.SETTLEMENT_READ]),
        partner.id,
        settlement.id,
        { reason: 'Nothing arrived' },
      );

      // Finance decides the transfer really is ambiguous. Their step must
      // not overwrite who reported it — the lock-out below reads that
      // column, and a service that stamped the finance actor over it would
      // erase the protection at the exact moment it starts to matter.
      await settlements.markRequiresReconciliation(settlement.id, {
        actorId: maker.id,
        reason: 'Partner says nothing arrived; statement unclear',
      });
      const inReview = await prisma.partnerSettlement.findUniqueOrThrow({
        where: { id: settlement.id },
      });
      expect(inReview.reconciliationSource).toBe(ReconciliationSource.PARTNER_REPORT);
      expect(inReview.reconciliationReportedByUserId).toBe(owner.id);

      await expect(
        settlements.proposeReconciliationOutcome(settlement.id, {
          actorId: owner.id,
          outcome: ReconciliationOutcome.MONEY_DID_NOT_MOVE,
          evidence: 'We never got it',
        }),
      ).rejects.toThrow(/for finance to establish/i);

      await settlements.proposeReconciliationOutcome(settlement.id, {
        actorId: maker.id,
        outcome: ReconciliationOutcome.MONEY_DID_NOT_MOVE,
        evidence: 'No debit on the account',
      });
      await expect(
        settlements.confirmReconciliationOutcome(settlement.id, { actorId: owner.id }),
      ).rejects.toThrow(/for finance to establish/i);
      expect(checker.id).toBeTruthy();
    });

    it('records a second report during a review rather than refusing it', async () => {
      const { owner, partner, settlement, maker } = await sentTransfer();
      const reporter = actor(owner.id, partner.id, RoleName.PARTNER_OWNER, [
        PermissionName.SETTLEMENT_READ,
      ]);
      await controller.reportProblem(reporter, partner.id, settlement.id, {
        reason: 'Nothing arrived',
      });
      await settlements.markRequiresReconciliation(settlement.id, {
        actorId: maker.id,
        reason: 'Looking into it',
      });

      // A partner chasing an answer should not be told they are wrong.
      const second = await controller.reportProblem(reporter, partner.id, settlement.id, {
        reason: 'Still nothing, two weeks on',
      });
      expect(second.status).toBe(PartnerSettlementStatus.REQUIRES_RECONCILIATION);
    });
  });
});
