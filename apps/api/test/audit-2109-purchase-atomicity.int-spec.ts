import { AuditAction, BonusEntryType, PrismaClient, TransactionStatus } from '@prisma/client';
import { AuditService } from '../src/modules/audit/audit.service';
import { CustomerBalanceService } from '../src/modules/customer-balance/customer-balance.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { createCustomer, createPartner, fundPrepaidBalance } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Audit of 21.09.2026, finding D18: the audit row of a purchase creation
 * used to be written *after* the purchase (and its prepaid hold) had
 * committed. An audit INSERT failing at that point fell into the catch that
 * compensates a failed create — releasing the bonus reservation and failing
 * the source transaction of a purchase that was live.
 *
 * Now the audit row commits with the purchase or not at all, and the
 * compensation runs only when nothing was committed. The fault is injected
 * on a real PostgreSQL through the actual `AuditService.record`.
 */
describe('Audit 21.09 — purchase creation is atomic with its audit row (D18)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let purchaseIntents: PurchaseIntentsService;
  let audit: AuditService;
  let engine: BonusEngineService;
  let ledger: LedgerService;
  let balance: CustomerBalanceService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    purchaseIntents = harness.app.get(PurchaseIntentsService);
    audit = harness.app.get(AuditService);
    engine = harness.app.get(BonusEngineService);
    ledger = harness.app.get(LedgerService);
    balance = harness.app.get(CustomerBalanceService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await truncateAll(prisma);
  });

  const funded = async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500, maxBonusPaymentPercent: 50 });
    await engine.accrue({ walletId: wallet.id, type: BonusEntryType.ACCRUAL_PURCHASE, amount: '5000', pendingHours: 0 });
    await fundPrepaidBalance(ledger, user.id, '20000');
    return { user, wallet, partner };
  };

  const open = (partnerId: string, userId: string) =>
    purchaseIntents.create(
      { partnerId, grossAmount: '50000', bonusAmountRequested: '5000', prepaidAmountApplied: '20000' },
      userId,
    );

  it('an audit INSERT that fails after the purchase row is written rolls the purchase, its hold and its reservation back — no false compensation of a live purchase', async () => {
    const { user, wallet, partner } = await funded();

    const realRecord = audit.record.bind(audit);
    jest.spyOn(audit, 'record').mockImplementation(async (params, tx) => {
      if (params.action === AuditAction.PURCHASE_INTENT_CREATED) {
        // The row exists in this transaction at this moment — the auditor's
        // scenario — and the failure must take it down with it.
        const inTx = await tx!.purchaseIntent.count({ where: { id: params.entityId! } });
        expect(inTx).toBe(1);
        throw new Error('injected audit insert failure');
      }
      return realRecord(params, tx);
    });

    await expect(open(partner.id, user.id)).rejects.toThrow(/injected audit insert failure/);

    // Nothing committed, and the compensation was for nothing that existed:
    // the bonus reservation is released, the hold never posted, the source
    // transaction is FAILED — and there is no purchase for any of it to
    // have wrongly touched.
    expect(await prisma.purchaseIntent.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: AuditAction.PURCHASE_INTENT_CREATED } })).toBe(0);
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'customer.prepaid.hold' } })).toBe(0);
    expect((await balance.getBalanceDetail(user.id)).available).toBe('20000.0000');
    const w = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedBonus.toFixed(4)).toBe('0.0000');
    expect(w.availableBonus.toFixed(4)).toBe('5000.0000');
    const source = await prisma.transaction.findFirst({ where: { userId: user.id } });
    expect(source?.status).toBe(TransactionStatus.FAILED);

    // And the retry simply works, with its audit row committed alongside.
    jest.restoreAllMocks();
    const intent = await open(partner.id, user.id);
    expect(await prisma.auditLog.count({ where: { action: AuditAction.PURCHASE_INTENT_CREATED, entityId: intent.id } })).toBe(1);
    expect((await balance.getBalanceDetail(user.id)).reserved).toBe('20000.0000');
  });

  it('a successful create writes the purchase, the hold and the audit row in one transaction', async () => {
    const { user, partner } = await funded();
    const intent = await open(partner.id, user.id);
    const [row, auditRow, hold] = await Promise.all([
      prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } }),
      prisma.auditLog.findFirstOrThrow({ where: { action: AuditAction.PURCHASE_INTENT_CREATED, entityId: intent.id } }),
      prisma.ledgerTransaction.findFirstOrThrow({ where: { kind: 'customer.prepaid.hold' } }),
    ]);
    expect(row.prepaidHoldTransactionId).toBe(hold.id);
    expect(auditRow.actorUserId).toBe(user.id);
  });
});
