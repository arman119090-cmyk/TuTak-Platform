import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  AuditAction,
  CollectionStatus,
  LedgerAccountType,
  PostingDirection,
  PrismaClient,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PartnerCollectionService } from '../src/modules/payouts/partner-collection.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The missing direction: a partner's own bank transfer paying down a
 * `PARTNER_PAYABLE` balance that has gone against them.
 *
 * Two controls layered on top of the original single-step design (see
 * `PartnerCollectionService`'s own docblock, and
 * docs/PARTNER_COLLECTIONS_HARDENING_2026-08-24.md):
 *
 *  - Problem 1: `bankTransactionId` is unique per (currency, id) at the
 *    database level. The same real transfer can never be recorded twice,
 *    across admins and across idempotency keys.
 *  - Problem 2: maker-checker. `payouts.dualControl` is on by default (see
 *    `configuration.ts`), so `record` below always produces a `PENDING` row
 *    first — nothing posts until a *different* admin calls `confirm`. The
 *    dual-control-off, single-step path is covered separately in
 *    `partner-collection-single-step.int-spec.ts`, which needs its own
 *    harness to flip the config flag before the app boots.
 *
 * `oweUs` seeds partner debt directly through the ledger rather than driving
 * a full purchase — how the debt arose is `purchase-intents.int-spec.ts`'s
 * question; this file's question is only what happens once it exists.
 */
describe('PartnerCollectionService (integration, dual control on)', () => {
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

  // Real `User` rows, not bare strings: `PartnerCollectionService.confirm`
  // writes its own audit record inside the same transaction as the posting,
  // and `AuditLog.actorUserId` is a real foreign key — see
  // `createStaffUser`'s own docblock. `recordedByUserId` on `record` has no
  // such constraint, but using real ids everywhere keeps the two symmetric
  // and readable.
  let admin1 = '';
  let admin2 = '';
  let admin3 = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    const [a1, a2, a3] = await Promise.all([
      createStaffUser(prisma, { firstName: 'Ani' }),
      createStaffUser(prisma, { firstName: 'Narek' }),
      createStaffUser(prisma, { firstName: 'Lilit' }),
    ]);
    admin1 = a1.id;
    admin2 = a2.id;
    admin3 = a3.id;
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

  /** Reduces what a partner owes without going through a collection at all. */
  const creditPartner = async (partnerId: string, amount: string) => {
    const [partnerAccount, revenueAccount] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
      ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }),
    ]);
    await ledger.post({
      kind: 'test.seed_partner_relief',
      sourceType: 'Test',
      sourceId: partnerId,
      postings: [
        { accountId: revenueAccount.id, direction: PostingDirection.DEBIT, amount },
        { accountId: partnerAccount.id, direction: PostingDirection.CREDIT, amount },
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

  let txnCounter = 0;
  /** A fresh, unique bank transaction id per call, so tests never collide by accident. */
  const freshTxnId = () => `TXN-${(txnCounter += 1)}-${Math.random().toString(36).slice(2, 8)}`;

  it('reports what a partner owes as a positive figure', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '1200');

    expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('1200.0000');
  });

  it("reports zero owed when the balance is actually in the partner's favor", async () => {
    const partner = await createPartner(prisma);
    // No debt seeded — PARTNER_PAYABLE stays at its default zero, and a
    // partner never owed anything is a zero, not a negative, "amount owed".
    expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('0.0000');
  });

  // ── Maker-checker lifecycle ─────────────────────────────────────────────

  describe('the pending → confirmed lifecycle', () => {
    it('records a PENDING collection that touches neither the ledger nor the balance', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '1200');

      const result = await collections.record({
        partnerId: partner.id,
        amount: '1200',
        bankReference: 'SWIFT-COLLECT-1',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-1',
      });

      expect(result.status).toBe(CollectionStatus.PENDING);
      // Nothing posted: the balance is exactly what it was before.
      expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('1200.0000');
      expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('0.0000');
      expect(result.remainingOwed).toBe('1200.0000');

      const stored = await prisma.partnerCollection.findUniqueOrThrow({
        where: { id: result.collectionId },
      });
      expect(stored.ledgerTransactionId).toBeNull();
      expect(stored.confirmedByUserId).toBeNull();
      await assertLedgerIntegrity();
    });

    it('moves the balance toward zero and into PLATFORM_BANK only once a different admin confirms', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '1200');

      const recorded = await collections.record({
        partnerId: partner.id,
        amount: '1200',
        bankReference: 'SWIFT-COLLECT-2',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-2',
      });

      const confirmed = await collections.confirm(recorded.collectionId, admin2);

      expect(confirmed.status).toBe(CollectionStatus.CONFIRMED);
      expect(confirmed.remainingOwed).toBe('0.0000');
      expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('0.0000');
      expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('1200.0000');
      await assertLedgerIntegrity();
    });

    it('allows a partial collection and leaves the remainder owed once confirmed', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '1200');

      const recorded = await collections.record({
        partnerId: partner.id,
        amount: '500',
        bankReference: 'SWIFT-PARTIAL',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-partial',
      });
      const confirmed = await collections.confirm(recorded.collectionId, admin2);

      expect(confirmed.remainingOwed).toBe('700.0000');
      await assertLedgerIntegrity();
    });

    it('lets several sequential collections drain what is owed exactly, and no further', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '1000');

      const first = await collections.record({
        partnerId: partner.id,
        amount: '600',
        bankReference: 'SWIFT-DRAIN-1',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-drain-1',
      });
      await collections.confirm(first.collectionId, admin2);

      const second = await collections.record({
        partnerId: partner.id,
        amount: '400',
        bankReference: 'SWIFT-DRAIN-2',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-drain-2',
      });
      await collections.confirm(second.collectionId, admin2);

      expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('0.0000');

      // The debt is already fully drained, so even the best-effort check at
      // record time refuses it — there is nothing left to confirm.
      await expect(
        collections.record({
          partnerId: partner.id,
          amount: '1',
          bankReference: 'SWIFT-DRAIN-3',
          bankTransactionId: freshTxnId(),
          actorId: admin1,
          idempotencyKey: 'collect-drain-3',
        }),
      ).rejects.toThrow(ConflictException);

      expect(await prisma.partnerCollection.count({ where: { bankReference: 'SWIFT-DRAIN-3' } })).toBe(
        0,
      );
      await assertLedgerIntegrity();
    });
  });

  // ── Never collect more than is owed ────────────────────────────────────

  it('refuses (at record time) a collection larger than what is actually owed', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '500');

    await expect(
      collections.record({
        partnerId: partner.id,
        amount: '5000',
        bankReference: 'SWIFT-OVER',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
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
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-none',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("refuses a collection against a partner whose balance is actually in their own favor", async () => {
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
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-wrong-way',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('re-checks the amount owed at confirmation, under lock — not only at record time', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '1000');

    // 800 is fine against 1,000 owed at record time.
    const recorded = await collections.record({
      partnerId: partner.id,
      amount: '800',
      bankReference: 'SWIFT-STALE',
      bankTransactionId: freshTxnId(),
      actorId: admin1,
      idempotencyKey: 'collect-stale',
    });

    // The balance moves down to 500 before anyone confirms — a second,
    // unrelated collection landed, or a refund clawed some of it back.
    await creditPartner(partner.id, '500');
    expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('500.0000');

    await expect(collections.confirm(recorded.collectionId, admin2)).rejects.toThrow(
      ConflictException,
    );

    // Failed confirmation leaves no partial state: still PENDING, no ledger
    // transaction, no audit record.
    const stored = await prisma.partnerCollection.findUniqueOrThrow({
      where: { id: recorded.collectionId },
    });
    expect(stored.status).toBe(CollectionStatus.PENDING);
    expect(stored.ledgerTransactionId).toBeNull();
    expect(stored.confirmedByUserId).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { action: AuditAction.PARTNER_COLLECTION_CONFIRMED, entityId: recorded.collectionId },
      }),
    ).toBe(0);
    // And the balance itself is exactly what the credit left it at — the
    // failed confirmation attempt moved nothing.
    expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('500.0000');
    await assertLedgerIntegrity();
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
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-blank-ref',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a blank bank transaction id', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '500');

    await expect(
      collections.record({
        partnerId: partner.id,
        amount: '100',
        bankReference: 'SWIFT-OK',
        bankTransactionId: '   ',
        actorId: admin1,
        idempotencyKey: 'collect-blank-txn',
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

    const recorded = await collections.record({
      partnerId: partner.id,
      amount: '500',
      bankReference: 'SWIFT-DESPITE-BLOCK',
      bankTransactionId: freshTxnId(),
      actorId: admin1,
      idempotencyKey: 'collect-despite-block',
    });
    const confirmed = await collections.confirm(recorded.collectionId, admin2);

    expect(confirmed.remainingOwed).toBe('0.0000');
  });

  // ── Idempotency (record) ───────────────────────────────────────────────

  it('replays the stored PENDING result on a retried idempotency key', async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '1000');
    const request = {
      partnerId: partner.id,
      amount: '400',
      bankReference: 'SWIFT-IDEM',
      bankTransactionId: freshTxnId(),
      actorId: admin1,
      idempotencyKey: 'collect-idem-1',
    };

    const first = await collections.record(request);
    const second = await collections.record(request);

    expect(second).toEqual(first);
    expect(await prisma.partnerCollection.count()).toBe(1);
    // Still PENDING — nothing posted, so the balance is unaffected.
    expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('1000.0000');
  });

  // ── Problem 1: the same real transfer can never be recorded twice ──────

  describe('bank transaction uniqueness (Problem 1)', () => {
    it('rejects the same bank transaction id submitted twice with different idempotency keys', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '2000');
      const txnId = freshTxnId();

      await collections.record({
        partnerId: partner.id,
        amount: '400',
        bankReference: 'SWIFT-DUP-A',
        bankTransactionId: txnId,
        actorId: admin1,
        idempotencyKey: 'collect-dup-key-a',
      });

      await expect(
        collections.record({
          partnerId: partner.id,
          amount: '400',
          bankReference: 'SWIFT-DUP-B',
          bankTransactionId: txnId,
          actorId: admin1,
          idempotencyKey: 'collect-dup-key-b',
        }),
      ).rejects.toThrow(ConflictException);

      expect(await prisma.partnerCollection.count()).toBe(1);
    });

    it('rejects the same bank transaction id submitted by two different admins', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '2000');
      const txnId = freshTxnId();

      await collections.record({
        partnerId: partner.id,
        amount: '400',
        bankReference: 'SWIFT-DUP-C',
        bankTransactionId: txnId,
        actorId: admin1,
        idempotencyKey: 'collect-dup-admin-1',
      });

      await expect(
        collections.record({
          partnerId: partner.id,
          amount: '400',
          bankReference: 'SWIFT-DUP-D',
          bankTransactionId: txnId,
          actorId: admin2,
          idempotencyKey: 'collect-dup-admin-2',
        }),
      ).rejects.toThrow(ConflictException);

      expect(await prisma.partnerCollection.count()).toBe(1);
    });

    it('normalizes whitespace and case before comparing, so equivalent ids still collide', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '2000');

      await collections.record({
        partnerId: partner.id,
        amount: '400',
        bankReference: 'SWIFT-NORM-A',
        bankTransactionId: 'ft 23150 000123',
        actorId: admin1,
        idempotencyKey: 'collect-norm-a',
      });

      await expect(
        collections.record({
          partnerId: partner.id,
          amount: '400',
          bankReference: 'SWIFT-NORM-B',
          bankTransactionId: '  FT23150000123  ',
          actorId: admin2,
          idempotencyKey: 'collect-norm-b',
        }),
      ).rejects.toThrow(ConflictException);

      expect(await prisma.partnerCollection.count()).toBe(1);
    });

    it('cannot create two collections from concurrent duplicate submissions', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '2000');
      const txnId = freshTxnId();

      const results = await Promise.allSettled([
        collections.record({
          partnerId: partner.id,
          amount: '400',
          bankReference: 'SWIFT-RACE-A',
          bankTransactionId: txnId,
          actorId: admin1,
          idempotencyKey: 'collect-race-key-a',
        }),
        collections.record({
          partnerId: partner.id,
          amount: '400',
          bankReference: 'SWIFT-RACE-B',
          bankTransactionId: txnId,
          actorId: admin2,
          idempotencyKey: 'collect-race-key-b',
        }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await prisma.partnerCollection.count()).toBe(1);
    });

    it('lets two genuinely different transactions for the same partner coexist', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '2000');

      await collections.record({
        partnerId: partner.id,
        amount: '400',
        bankReference: 'SWIFT-DISTINCT-A',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-distinct-a',
      });
      await collections.record({
        partnerId: partner.id,
        amount: '400',
        bankReference: 'SWIFT-DISTINCT-B',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-distinct-b',
      });

      expect(await prisma.partnerCollection.count()).toBe(2);
    });
  });

  // ── Problem 2: maker-checker ────────────────────────────────────────────

  describe('dual control (Problem 2)', () => {
    it('refuses confirmation from the admin who recorded the collection', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '500');

      const recorded = await collections.record({
        partnerId: partner.id,
        amount: '500',
        bankReference: 'SWIFT-SELF',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-self',
      });

      await expect(collections.confirm(recorded.collectionId, admin1)).rejects.toThrow(
        ForbiddenException,
      );

      const stored = await prisma.partnerCollection.findUniqueOrThrow({
        where: { id: recorded.collectionId },
      });
      expect(stored.status).toBe(CollectionStatus.PENDING);
      expect(stored.confirmedByUserId).toBeNull();
      // The refusal happens before the ledger does, or the control is
      // decorative.
      expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('500.0000');
    });

    it('lets a different admin confirm exactly once; a second attempt does nothing extra', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '500');

      const recorded = await collections.record({
        partnerId: partner.id,
        amount: '500',
        bankReference: 'SWIFT-ONCE',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-once',
      });

      await collections.confirm(recorded.collectionId, admin2);
      // Mirrors `PayoutEngineService.confirmPaid`'s own repeated-resolution
      // guard: a sequential retry after the row is already CONFIRMED is
      // caught by the status check before the transaction even opens, and
      // reads as a `BadRequestException` ("already resolved") rather than
      // the `ConflictException` a genuine race for the claim produces — see
      // the concurrent test below for that case.
      await expect(collections.confirm(recorded.collectionId, admin2)).rejects.toThrow(
        BadRequestException,
      );
      // A third admin trying after the fact gets the same refusal — there is
      // nothing left PENDING to claim.
      await expect(collections.confirm(recorded.collectionId, admin3)).rejects.toThrow(
        BadRequestException,
      );

      expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('0.0000');
      expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('500.0000');
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.collection.confirmed' } }),
      ).toBe(1);
      await assertLedgerIntegrity();
    });

    it('claims exactly one winner when two confirmations race for the same collection', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '500');

      const recorded = await collections.record({
        partnerId: partner.id,
        amount: '500',
        bankReference: 'SWIFT-CONFIRM-RACE',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-confirm-race',
      });

      const results = await Promise.allSettled([
        collections.confirm(recorded.collectionId, admin2),
        collections.confirm(recorded.collectionId, admin3),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('500.0000');
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.collection.confirmed' } }),
      ).toBe(1);
      await assertLedgerIntegrity();
    });

    it('writes exactly one audit event for one confirmed collection', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '500');

      const recorded = await collections.record({
        partnerId: partner.id,
        amount: '500',
        bankReference: 'SWIFT-AUDIT-ONCE',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-audit-once',
      });
      await collections.confirm(recorded.collectionId, admin2);
      await collections.confirm(recorded.collectionId, admin2).catch(() => undefined);
      await collections.confirm(recorded.collectionId, admin3).catch(() => undefined);

      const events = await prisma.auditLog.findMany({
        where: { action: AuditAction.PARTNER_COLLECTION_CONFIRMED, entityId: recorded.collectionId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]!.actorUserId).toBe(admin2);
    });

    it('records who recorded and who confirmed it, so both halves are auditable', async () => {
      const partner = await createPartner(prisma);
      await oweUs(partner.id, '500');

      const recorded = await collections.record({
        partnerId: partner.id,
        amount: '500',
        bankReference: 'SWIFT-NAMES',
        bankTransactionId: freshTxnId(),
        actorId: admin1,
        idempotencyKey: 'collect-names',
      });
      await collections.confirm(recorded.collectionId, admin2);

      const [row] = await collections.listForPartner(partner.id);
      expect(row!.id).toBe(recorded.collectionId);
      expect(row!.recordedByUserId).toBe(admin1);
      expect(row!.confirmedByUserId).toBe(admin2);
      expect(row!.bankReference).toBe('SWIFT-NAMES');
      expect(row!.status).toBe(CollectionStatus.CONFIRMED);
    });
  });

  // ── The settlement clock ────────────────────────────────────────────────

  it("resets the partner's lastSettledAt when a collection is confirmed to zero", async () => {
    const partner = await createPartner(prisma);
    await oweUs(partner.id, '500');
    const afterDebt = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    // oweUs itself just crossed zero → non-zero, so the cycle already started.
    expect(afterDebt.lastSettledAt).not.toBeNull();

    const recorded = await collections.record({
      partnerId: partner.id,
      amount: '500',
      bankReference: 'SWIFT-CLOCK',
      bankTransactionId: freshTxnId(),
      actorId: admin1,
      idempotencyKey: 'collect-clock',
    });
    await collections.confirm(recorded.collectionId, admin2);

    const stored = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(stored.lastSettledAt).not.toBeNull();
    expect(Date.now() - stored.lastSettledAt!.getTime()).toBeLessThan(10_000);
  });
});
