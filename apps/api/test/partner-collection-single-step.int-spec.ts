import { ConflictException } from '@nestjs/common';
import { CollectionStatus, LedgerAccountType, PostingDirection, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PartnerCollectionService } from '../src/modules/payouts/partner-collection.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Problem 2, requirement 4: with `payouts.dualControl` off, `record` must
 * still post in one step — the original design, preserved — while Problem
 * 1's database-level uniqueness control and the existing idempotency
 * guarantee stay fully enforced regardless of the flag.
 *
 * This needs its own harness because the config flag is read once when the
 * app boots (`ConfigModule.forRoot`), not per request — see
 * `payout-engine.int-spec.ts` for the equivalent split on the payout side,
 * which does not exist today only because nothing there yet exercises the
 * flag off. `PAYOUT_DUAL_CONTROL` is set before `createTestHarness()` runs
 * and restored afterwards so no other suite in the same test run observes
 * it.
 */
describe('PartnerCollectionService (integration, dual control off)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let collections: PartnerCollectionService;
  let ledger: LedgerService;
  let originalFlag: string | undefined;

  beforeAll(async () => {
    originalFlag = process.env.PAYOUT_DUAL_CONTROL;
    process.env.PAYOUT_DUAL_CONTROL = 'false';
    harness = await createTestHarness();
    prisma = harness.prisma;
    collections = harness.app.get(PartnerCollectionService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
    if (originalFlag === undefined) delete process.env.PAYOUT_DUAL_CONTROL;
    else process.env.PAYOUT_DUAL_CONTROL = originalFlag;
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const oweUs = async (partnerId: string, amount: string) => {
    const [partnerAccount, revenueAccount] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
      ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }),
    ]);
    await ledger.post({
      kind: 'test.seed_partner_debt',
      sourceType: 'Test',
      sourceId: partnerId,
      postings: [
        { accountId: partnerAccount.id, direction: PostingDirection.DEBIT, amount },
        { accountId: revenueAccount.id, direction: PostingDirection.CREDIT, amount },
      ],
    });
  };

  const balanceOf = async (type: LedgerAccountType, partnerId?: string): Promise<string> => {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type, partnerId: partnerId ?? null },
    });
    return (account?.balance ?? new Decimal(0)).toFixed(4);
  };

  let txnCounter = 0;
  const freshTxnId = () => `SINGLE-${(txnCounter += 1)}-${Math.random().toString(36).slice(2, 8)}`;

  it('posts immediately, in one call, with no separate confirmation needed', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '1200');

    const result = await collections.record({
      partnerId: partner.id,
      amount: '1200',
      bankReference: 'SWIFT-SINGLE-1',
      bankTransactionId: freshTxnId(),
      actorId: 'admin-1',
      idempotencyKey: 'single-1',
    });

    expect(result.status).toBe(CollectionStatus.CONFIRMED);
    expect(result.remainingOwed).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('1200.0000');

    const stored = await prisma.partnerCollection.findUniqueOrThrow({ where: { id: result.collectionId } });
    expect(stored.ledgerTransactionId).not.toBeNull();
    // No separate confirming admin exists in the single-step path.
    expect(stored.confirmedByUserId).toBeNull();
  });

  it('still refuses a collection larger than what is actually owed', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '500');

    await expect(
      collections.record({
        partnerId: partner.id,
        amount: '5000',
        bankReference: 'SWIFT-SINGLE-OVER',
        bankTransactionId: freshTxnId(),
        actorId: 'admin-1',
        idempotencyKey: 'single-over',
      }),
    ).rejects.toThrow(ConflictException);

    expect(await prisma.partnerCollection.count()).toBe(0);
  });

  it('still enforces Problem 1: the same bank transaction id cannot be recorded twice', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '2000');
    const txnId = freshTxnId();

    await collections.record({
      partnerId: partner.id,
      amount: '400',
      bankReference: 'SWIFT-SINGLE-DUP-A',
      bankTransactionId: txnId,
      actorId: 'admin-1',
      idempotencyKey: 'single-dup-a',
    });

    await expect(
      collections.record({
        partnerId: partner.id,
        amount: '400',
        bankReference: 'SWIFT-SINGLE-DUP-B',
        bankTransactionId: txnId,
        actorId: 'admin-2',
        idempotencyKey: 'single-dup-b',
      }),
    ).rejects.toThrow(ConflictException);

    expect(await prisma.partnerCollection.count()).toBe(1);
  });

  it('cannot double-post from concurrent duplicate submissions of the same transaction id', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '2000');
    const txnId = freshTxnId();

    const results = await Promise.allSettled([
      collections.record({
        partnerId: partner.id,
        amount: '400',
        bankReference: 'SWIFT-SINGLE-RACE-A',
        bankTransactionId: txnId,
        actorId: 'admin-1',
        idempotencyKey: 'single-race-a',
      }),
      collections.record({
        partnerId: partner.id,
        amount: '400',
        bankReference: 'SWIFT-SINGLE-RACE-B',
        bankTransactionId: txnId,
        actorId: 'admin-2',
        idempotencyKey: 'single-race-b',
      }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.partnerCollection.count()).toBe(1);
    expect(
      await prisma.ledgerTransaction.count({ where: { kind: 'partner.collection.recorded' } }),
    ).toBe(1);
  });

  it('replays the stored result on a retried idempotency key', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '1000');
    const request = {
      partnerId: partner.id,
      amount: '400',
      bankReference: 'SWIFT-SINGLE-IDEM',
      bankTransactionId: freshTxnId(),
      actorId: 'admin-1',
      idempotencyKey: 'single-idem-1',
    };

    const first = await collections.record(request);
    const second = await collections.record(request);

    expect(second).toEqual(first);
    expect(await prisma.partnerCollection.count()).toBe(1);
    expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('600.0000');
  });

  it('resets lastSettledAt on a full settlement, same as the dual-control path', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '500');

    await collections.record({
      partnerId: partner.id,
      amount: '500',
      bankReference: 'SWIFT-SINGLE-CLOCK',
      bankTransactionId: freshTxnId(),
      actorId: 'admin-1',
      idempotencyKey: 'single-clock',
    });

    const stored = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(stored.lastSettledAt).not.toBeNull();
    expect(Date.now() - stored.lastSettledAt!.getTime()).toBeLessThan(10_000);
  });
});
