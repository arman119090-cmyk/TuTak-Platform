import { BadRequestException } from '@nestjs/common';
import { LedgerAccountType, PostingDirection, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The double-entry ledger, phase 1 of docs/FINANCIAL_CORE_DESIGN.md.
 *
 * These tests are the point of the phase. The engines that will use this
 * ledger do not exist yet; what has to be true before they are written is
 * that a posting cannot fail to balance, cannot be edited afterwards, and
 * cannot leave a materialized balance disagreeing with the postings behind
 * it. Every one of those is asserted against the database, not against the
 * service — a guard in application code protects only the callers that go
 * through it.
 */
describe('Double-entry ledger (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** A partner payable account and the platform revenue account. */
  const twoAccounts = async () => {
    const partner = await createPartner(prisma);
    const payable = await ledger.accountFor({
      type: LedgerAccountType.PARTNER_PAYABLE,
      partnerId: partner.id,
    });
    const revenue = await ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE });
    return { partner, payable, revenue };
  };

  const balanceOf = async (accountId: string) =>
    (await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: accountId } })).balance;

  /** The invariant that matters: materialized balance equals replayed postings. */
  const assertLedgerIntegrity = async () => {
    const accounts = await prisma.ledgerAccount.findMany();
    for (const account of accounts) {
      const replayed = await ledger.replayBalance(account.id);
      expect({ id: account.id, balance: account.balance.toFixed(4) }).toEqual({
        id: account.id,
        balance: replayed.toFixed(4),
      });
    }
  };

  // ── The balance rule ───────────────────────────────────────────────────

  describe('balancing', () => {
    it('posts a balanced transaction and moves both accounts', async () => {
      const { payable, revenue } = await twoAccounts();

      await ledger.post({
        kind: 'PAYMENT_CAPTURE',
        sourceType: 'Payment',
        sourceId: 'pay-1',
        postings: [
          { accountId: revenue.id, direction: PostingDirection.DEBIT, amount: '9700' },
          { accountId: payable.id, direction: PostingDirection.CREDIT, amount: '9700' },
        ],
      });

      expect((await balanceOf(revenue.id)).toFixed(4)).toBe('9700.0000');
      expect((await balanceOf(payable.id)).toFixed(4)).toBe('-9700.0000');
      await assertLedgerIntegrity();
    });

    it('refuses an unbalanced transaction', async () => {
      const { payable, revenue } = await twoAccounts();

      // The error double-entry exists to catch: a credit with no matching
      // debit. Single entry cannot see this — every row is well-formed.
      await expect(
        ledger.post({
          kind: 'BROKEN',
          sourceType: 'Test',
          sourceId: 't-1',
          postings: [
            { accountId: revenue.id, direction: PostingDirection.DEBIT, amount: '9700' },
            { accountId: payable.id, direction: PostingDirection.CREDIT, amount: '9000' },
          ],
        }),
      ).rejects.toThrow(/does not balance/);

      expect(await prisma.ledgerPosting.count()).toBe(0);
      await assertLedgerIntegrity();
    });

    it('refuses a single-sided posting', async () => {
      const { revenue } = await twoAccounts();
      await expect(
        ledger.post({
          kind: 'BROKEN',
          sourceType: 'Test',
          sourceId: 't-2',
          postings: [{ accountId: revenue.id, direction: PostingDirection.DEBIT, amount: '100' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('is enforced by the database, not only by the service', async () => {
      const { payable, revenue } = await twoAccounts();
      const tx = await prisma.ledgerTransaction.create({
        data: { kind: 'RAW', sourceType: 'Test', sourceId: 't-3' },
      });

      // Bypassing the service entirely. The deferred trigger fires at COMMIT,
      // which is the only moment the rule genuinely applies.
      await expect(
        prisma.$transaction(async (client) => {
          await client.ledgerPosting.create({
            data: {
              transactionId: tx.id,
              accountId: revenue.id,
              direction: PostingDirection.DEBIT,
              amount: '500',
            },
          });
          await client.ledgerPosting.create({
            data: {
              transactionId: tx.id,
              accountId: payable.id,
              direction: PostingDirection.CREDIT,
              amount: '400',
            },
          });
        }),
      ).rejects.toThrow(/does not balance/);

      expect(await prisma.ledgerPosting.count()).toBe(0);
    });

    it('allows a multi-leg transaction that balances overall', async () => {
      const { payable, revenue } = await twoAccounts();
      const { user } = await createCustomer(prisma);
      const bonus = await ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY });
      const psp = await ledger.accountFor({ type: LedgerAccountType.PSP_RECEIVABLE });
      void user;

      // The worked example from the design: 10,000 paid, 500 in points, 3%
      // commission.
      await ledger.post({
        kind: 'PAYMENT_CAPTURE',
        sourceType: 'Payment',
        sourceId: 'pay-2',
        postings: [
          { accountId: psp.id, direction: PostingDirection.DEBIT, amount: '9500' },
          { accountId: bonus.id, direction: PostingDirection.DEBIT, amount: '500' },
          { accountId: payable.id, direction: PostingDirection.CREDIT, amount: '9700' },
          { accountId: revenue.id, direction: PostingDirection.CREDIT, amount: '300' },
        ],
      });

      expect((await balanceOf(psp.id)).toFixed(4)).toBe('9500.0000');
      expect((await balanceOf(payable.id)).toFixed(4)).toBe('-9700.0000');
      await assertLedgerIntegrity();
    });

    it('refuses a mixed-currency transaction', async () => {
      const { payable } = await twoAccounts();
      const points = await ledger.accountFor({
        type: LedgerAccountType.BONUS_LIABILITY,
        currency: 'BONUS_POINT',
      });
      const tx = await prisma.ledgerTransaction.create({
        data: { kind: 'RAW', sourceType: 'Test', sourceId: 't-fx' },
      });

      // Balanced in magnitude, meaningless in fact. Until an explicit FX
      // posting type exists this is a bug, not a conversion.
      await expect(
        prisma.$transaction(async (client) => {
          await client.ledgerPosting.create({
            data: {
              transactionId: tx.id,
              accountId: payable.id,
              direction: PostingDirection.DEBIT,
              amount: '100',
              currency: 'AMD',
            },
          });
          await client.ledgerPosting.create({
            data: {
              transactionId: tx.id,
              accountId: points.id,
              direction: PostingDirection.CREDIT,
              amount: '100',
              currency: 'BONUS_POINT',
            },
          });
        }),
      ).rejects.toThrow(/mixes currencies/);
    });

    it.each(['0', '-100', 'NaN', 'Infinity'])('refuses the amount %p', async (amount) => {
      const { payable, revenue } = await twoAccounts();
      await expect(
        ledger.post({
          kind: 'BROKEN',
          sourceType: 'Test',
          sourceId: 't-amt',
          postings: [
            { accountId: revenue.id, direction: PostingDirection.DEBIT, amount },
            { accountId: payable.id, direction: PostingDirection.CREDIT, amount },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Immutability ───────────────────────────────────────────────────────

  describe('immutability', () => {
    const posted = async () => {
      const { payable, revenue } = await twoAccounts();
      const tx = await ledger.post({
        kind: 'PAYMENT_CAPTURE',
        sourceType: 'Payment',
        sourceId: 'pay-3',
        postings: [
          { accountId: revenue.id, direction: PostingDirection.DEBIT, amount: '1000' },
          { accountId: payable.id, direction: PostingDirection.CREDIT, amount: '1000' },
        ],
      });
      return { tx, payable, revenue };
    };

    it('refuses to update a posting', async () => {
      const { tx } = await posted();
      const posting = await prisma.ledgerPosting.findFirstOrThrow({
        where: { transactionId: tx.id },
      });

      // An accounting record that can be rewritten is not a record.
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "ledger_postings" SET amount = 999999 WHERE id = '${posting.id}'`,
        ),
      ).rejects.toThrow(/append-only/);
    });

    it('refuses to delete a posting', async () => {
      const { tx } = await posted();
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM "ledger_postings" WHERE "transactionId" = '${tx.id}'`,
        ),
      ).rejects.toThrow(/append-only/);
    });

    it('corrects by reversal, leaving both transactions on record', async () => {
      const { tx, payable, revenue } = await posted();

      await ledger.reverse(tx.id, 'REFUND');

      expect((await balanceOf(revenue.id)).toFixed(4)).toBe('0.0000');
      expect((await balanceOf(payable.id)).toFixed(4)).toBe('0.0000');
      // Four postings, not zero: the history of what happened survives.
      expect(await prisma.ledgerPosting.count()).toBe(4);
      await assertLedgerIntegrity();
    });

    it('refuses to reverse the same transaction twice', async () => {
      const { tx } = await posted();
      await ledger.reverse(tx.id, 'REFUND');

      // The unique index on reversesId is what stops a double credit.
      await expect(ledger.reverse(tx.id, 'REFUND')).rejects.toThrow();
      expect(await prisma.ledgerTransaction.count()).toBe(2);
    });

    it('refuses a concurrent double reversal', async () => {
      const { tx, payable } = await posted();

      const results = await Promise.allSettled([
        ledger.reverse(tx.id, 'REFUND'),
        ledger.reverse(tx.id, 'REFUND'),
        ledger.reverse(tx.id, 'REFUND'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await balanceOf(payable.id)).toFixed(4)).toBe('0.0000');
      await assertLedgerIntegrity();
    });
  });

  // ── Concurrency and atomicity ──────────────────────────────────────────

  describe('concurrency', () => {
    it('keeps the balance exact under concurrent postings', async () => {
      const { payable, revenue } = await twoAccounts();

      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          ledger.post({
            kind: 'PAYMENT_CAPTURE',
            sourceType: 'Payment',
            sourceId: `concurrent-${i}`,
            postings: [
              { accountId: revenue.id, direction: PostingDirection.DEBIT, amount: '100' },
              { accountId: payable.id, direction: PostingDirection.CREDIT, amount: '100' },
            ],
          }),
        ),
      );

      // A lost update would show as a balance below 2,000 while 20 sets of
      // postings sit in the table.
      expect((await balanceOf(revenue.id)).toFixed(4)).toBe('2000.0000');
      expect(await prisma.ledgerPosting.count()).toBe(40);
      await assertLedgerIntegrity();
    });

    it('nets an account touched twice in one transaction', async () => {
      const { payable, revenue } = await twoAccounts();

      await ledger.post({
        kind: 'ADJUSTMENT',
        sourceType: 'Test',
        sourceId: 'net-1',
        postings: [
          { accountId: revenue.id, direction: PostingDirection.DEBIT, amount: '500' },
          { accountId: revenue.id, direction: PostingDirection.DEBIT, amount: '300' },
          { accountId: payable.id, direction: PostingDirection.CREDIT, amount: '800' },
        ],
      });

      expect((await balanceOf(revenue.id)).toFixed(4)).toBe('800.0000');
      await assertLedgerIntegrity();
    });

    it('creates one account when two callers race for it', async () => {
      const partner = await createPartner(prisma);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          ledger.accountFor({
            type: LedgerAccountType.PARTNER_PAYABLE,
            partnerId: partner.id,
          }),
        ),
      );

      expect(new Set(results.map((a) => a.id)).size).toBe(1);
    });
  });

  // ── Outbox ─────────────────────────────────────────────────────────────

  describe('outbox', () => {
    it('writes the event in the same transaction as the postings', async () => {
      const { payable, revenue } = await twoAccounts();

      await ledger.post({
        kind: 'PAYMENT_CAPTURE',
        sourceType: 'Payment',
        sourceId: 'pay-outbox',
        postings: [
          { accountId: revenue.id, direction: PostingDirection.DEBIT, amount: '1000' },
          { accountId: payable.id, direction: PostingDirection.CREDIT, amount: '1000' },
        ],
        events: [
          {
            aggregateType: 'Payment',
            aggregateId: 'pay-outbox',
            eventType: 'payment.captured',
            payload: { amount: '1000' },
          },
        ],
      });

      const events = await prisma.outboxEvent.findMany();
      expect(events).toHaveLength(1);
      expect(events[0]!.processedAt).toBeNull();
    });

    it('emits no event when the posting is refused', async () => {
      const { payable, revenue } = await twoAccounts();

      await ledger
        .post({
          kind: 'BROKEN',
          sourceType: 'Payment',
          sourceId: 'pay-none',
          postings: [
            { accountId: revenue.id, direction: PostingDirection.DEBIT, amount: '1000' },
            { accountId: payable.id, direction: PostingDirection.CREDIT, amount: '900' },
          ],
          events: [
            {
              aggregateType: 'Payment',
              aggregateId: 'pay-none',
              eventType: 'payment.captured',
              payload: {},
            },
          ],
        })
        .catch(() => undefined);

      // The whole point of an outbox: an event exists if and only if the
      // money moved. A consumer that saw this one would settle a payment
      // that was never posted.
      expect(await prisma.outboxEvent.count()).toBe(0);
    });
  });

  // ── Account shape ──────────────────────────────────────────────────────

  describe('accounts', () => {
    it('refuses an account owned by both a customer and a partner', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);

      // A posting router given an ambiguous account has no correct behaviour.
      await expect(
        prisma.ledgerAccount.create({
          data: {
            type: LedgerAccountType.PARTNER_PAYABLE,
            userId: user.id,
            partnerId: partner.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('keeps one platform account per type and currency', async () => {
      await ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE });
      await expect(
        prisma.ledgerAccount.create({ data: { type: LedgerAccountType.PLATFORM_REVENUE } }),
      ).rejects.toThrow();
    });

    it('replays a balance from postings alone', async () => {
      const { payable, revenue } = await twoAccounts();
      for (const amount of ['100', '250.5', '3000']) {
        await ledger.post({
          kind: 'PAYMENT_CAPTURE',
          sourceType: 'Payment',
          sourceId: `replay-${amount}`,
          postings: [
            { accountId: revenue.id, direction: PostingDirection.DEBIT, amount },
            { accountId: payable.id, direction: PostingDirection.CREDIT, amount },
          ],
        });
      }

      // This is the reconciliation primitive: the stored balance is a cache,
      // and the postings are the truth.
      expect((await ledger.replayBalance(revenue.id)).toFixed(4)).toBe('3350.5000');
      expect((await balanceOf(revenue.id)).toFixed(4)).toBe('3350.5000');
    });

    it('sums to zero across every account, always', async () => {
      const { payable, revenue } = await twoAccounts();
      const psp = await ledger.accountFor({ type: LedgerAccountType.PSP_RECEIVABLE });

      await ledger.post({
        kind: 'PAYMENT_CAPTURE',
        sourceType: 'Payment',
        sourceId: 'zero-1',
        postings: [
          { accountId: psp.id, direction: PostingDirection.DEBIT, amount: '9700' },
          { accountId: payable.id, direction: PostingDirection.CREDIT, amount: '9400' },
          { accountId: revenue.id, direction: PostingDirection.CREDIT, amount: '300' },
        ],
      });

      // The system-wide statement of double entry: value is never created or
      // destroyed inside the ledger, only moved.
      const all = await prisma.ledgerAccount.aggregate({ _sum: { balance: true } });
      expect((all._sum.balance ?? new Decimal(0)).toFixed(4)).toBe('0.0000');
    });
  });
});
