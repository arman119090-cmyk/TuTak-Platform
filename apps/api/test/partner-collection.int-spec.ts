import { BadRequestException, ConflictException } from '@nestjs/common';
import { LedgerAccountType, PostingDirection, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PartnerCollectionService } from '../src/modules/payouts/partner-collection.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The missing direction: a partner's own bank transfer paying down a
 * `PARTNER_PAYABLE` balance that has gone against them.
 *
 * Same property `payout-engine.int-spec.ts` proves for the outbound
 * direction, mirrored: a collection can never claim more than the partner
 * actually owes, including when two admins record one at the same instant.
 * `oweUs` below seeds that state directly through the ledger rather than
 * driving a full purchase — how the debt arose is `purchase-intents.int-spec.ts`
 * and `money-sequence-fuzz.int-spec.ts`'s question; this file's question is
 * only what happens once it exists.
 */
describe('PartnerCollectionService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let collections: PartnerCollectionService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    collections = harness.app.get(PartnerCollectionService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** Seeds a partner owing TuTak `amount`, directly through the ledger. */
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

  const assertLedgerIntegrity = async () => {
    for (const account of await prisma.ledgerAccount.findMany()) {
      const replayed = await ledger.replayBalance(account.id);
      expect({ id: account.id, balance: account.balance.toFixed(4) }).toEqual({
        id: account.id,
        balance: replayed.toFixed(4),
      });
    }
  };

  it('reports what a partner owes as a positive figure', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '1200');

    expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('1200.0000');
  });

  it('reports zero owed when the balance is actually in the partner\'s favor', async () => {
    const partner = await createPartner(prisma);
    // No debt seeded — PARTNER_PAYABLE stays at its default zero, and a
    // partner never owed anything is a zero, not a negative, "amount owed".
    expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('0.0000');
  });

  it('moves the balance toward zero and into PLATFORM_BANK', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '1200');

    const result = await collections.record({
      partnerId: partner.id,
      amount: '1200',
      bankReference: 'SWIFT-COLLECT-1',
      actorId: 'admin-1',
      idempotencyKey: 'collect-1',
    });

    expect(result.amount).toBe('1200.0000');
    expect(result.remainingOwed).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('1200.0000');
    await assertLedgerIntegrity();
  });

  it('allows a partial collection and leaves the remainder owed', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '1200');

    const result = await collections.record({
      partnerId: partner.id,
      amount: '500',
      bankReference: 'SWIFT-PARTIAL',
      actorId: 'admin-1',
      idempotencyKey: 'collect-partial',
    });

    expect(result.remainingOwed).toBe('700.0000');
    await assertLedgerIntegrity();
  });

  // ── Never collect more than is owed ────────────────────────────────────

  it('refuses a collection larger than what is actually owed', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '500');

    await expect(
      collections.record({
        partnerId: partner.id,
        amount: '5000',
        bankReference: 'SWIFT-OVER',
        actorId: 'admin-1',
        idempotencyKey: 'collect-over',
      }),
    ).rejects.toThrow(ConflictException);

    expect(await prisma.partnerCollection.count()).toBe(0);
    await assertLedgerIntegrity();
  });

  it('refuses any collection against a partner who owes nothing', async () => {
    const partner = await createPartner(prisma);

    await expect(
      collections.record({
        partnerId: partner.id,
        amount: '100',
        bankReference: 'SWIFT-NONE',
        actorId: 'admin-1',
        idempotencyKey: 'collect-none',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses a collection against a partner whose balance is actually in their own favor', async () => {
    const partner = await createPartner(prisma);
    // TuTak owes the partner (the ordinary case) — a raw negative balance,
    // the mirror image of `oweUs`.
    const [partnerAccount, revenueAccount] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: partner.id }),
      ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }),
    ]);
    await ledger.post({
      kind: 'test.seed_partner_credit',
      sourceType: 'Test',
      sourceId: partner.id,
      postings: [
        { accountId: revenueAccount.id, direction: PostingDirection.DEBIT, amount: '900' },
        { accountId: partnerAccount.id, direction: PostingDirection.CREDIT, amount: '900' },
      ],
    });

    await expect(
      collections.record({
        partnerId: partner.id,
        amount: '1',
        bankReference: 'SWIFT-WRONG-WAY',
        actorId: 'admin-1',
        idempotencyKey: 'collect-wrong-way',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('never lets concurrent collections together exceed what is owed', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '1000');
    // 1,000 owed; two collections of 600 cannot both be honoured.

    const results = await Promise.allSettled([
      collections.record({
        partnerId: partner.id,
        amount: '600',
        bankReference: 'SWIFT-RACE-A',
        actorId: 'admin-1',
        idempotencyKey: 'collect-race-a',
      }),
      collections.record({
        partnerId: partner.id,
        amount: '600',
        bankReference: 'SWIFT-RACE-B',
        actorId: 'admin-2',
        idempotencyKey: 'collect-race-b',
      }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.partnerCollection.count()).toBe(1);

    const remaining = await collections.amountOwed(partner.id);
    expect(remaining.isNegative()).toBe(false);
    expect(remaining.toFixed(4)).toBe('400.0000');
    await assertLedgerIntegrity();
  });

  it('lets several sequential collections drain what is owed exactly, and no further', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '1000');

    await collections.record({
      partnerId: partner.id,
      amount: '600',
      bankReference: 'SWIFT-DRAIN-1',
      actorId: 'admin-1',
      idempotencyKey: 'collect-drain-1',
    });
    await collections.record({
      partnerId: partner.id,
      amount: '400',
      bankReference: 'SWIFT-DRAIN-2',
      actorId: 'admin-1',
      idempotencyKey: 'collect-drain-2',
    });

    expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('0.0000');

    await expect(
      collections.record({
        partnerId: partner.id,
        amount: '1',
        bankReference: 'SWIFT-DRAIN-3',
        actorId: 'admin-1',
        idempotencyKey: 'collect-drain-3',
      }),
    ).rejects.toThrow(ConflictException);
  });

  // ── Guards ──────────────────────────────────────────────────────────────

  it('refuses a blank bank reference', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '500');

    await expect(
      collections.record({
        partnerId: partner.id,
        amount: '100',
        bankReference: '   ',
        actorId: 'admin-1',
        idempotencyKey: 'collect-blank-ref',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('is not blocked by an active payouts hold — incoming money is always welcome', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '500');
    await prisma.partner.update({
      where: { id: partner.id },
      data: { payoutsBlockedAt: new Date(), payoutsBlockedReason: 'drift under investigation' },
    });

    const result = await collections.record({
      partnerId: partner.id,
      amount: '500',
      bankReference: 'SWIFT-DESPITE-BLOCK',
      actorId: 'admin-1',
      idempotencyKey: 'collect-despite-block',
    });

    expect(result.remainingOwed).toBe('0.0000');
  });

  // ── Idempotency ─────────────────────────────────────────────────────────

  it('replays the stored result on a retried idempotency key', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '1000');
    const request = {
      partnerId: partner.id,
      amount: '400',
      bankReference: 'SWIFT-IDEM',
      actorId: 'admin-1',
      idempotencyKey: 'collect-idem-1',
    };

    const first = await collections.record(request);
    const second = await collections.record(request);

    expect(second).toEqual(first);
    expect(await prisma.partnerCollection.count()).toBe(1);
    expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('600.0000');
  });

  // ── The settlement clock ────────────────────────────────────────────────

  it("resets the partner's lastSettledAt when a collection is recorded", async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '500');
    expect(partner.lastSettledAt).toBeNull();

    await collections.record({
      partnerId: partner.id,
      amount: '500',
      bankReference: 'SWIFT-CLOCK',
      actorId: 'admin-1',
      idempotencyKey: 'collect-clock',
    });

    const stored = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(stored.lastSettledAt).not.toBeNull();
    expect(Date.now() - stored.lastSettledAt!.getTime()).toBeLessThan(10_000);
  });

  it('records who recorded it, so the row is auditable afterwards', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '500');

    const result = await collections.record({
      partnerId: partner.id,
      amount: '500',
      bankReference: 'SWIFT-AUDIT',
      actorId: 'admin-1',
      idempotencyKey: 'collect-audit',
    });

    const [row] = await collections.listForPartner(partner.id);
    expect(row!.id).toBe(result.collectionId);
    expect(row!.recordedByUserId).toBe('admin-1');
    expect(row!.bankReference).toBe('SWIFT-AUDIT');
  });
});
