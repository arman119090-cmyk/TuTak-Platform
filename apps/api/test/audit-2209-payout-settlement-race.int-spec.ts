import { ConflictException } from '@nestjs/common';
import {
  LedgerAccountType,
  PartnerSettlementStatus,
  PayoutStatus,
  PostingDirection,
  PrismaClient,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'node:crypto';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PartnerSettlementService } from '../src/modules/partner-settlements/partner-settlement.service';
import { PayoutEngineService } from '../src/modules/payouts/payout-engine.service';
import { createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Audit of 22.09.2026, D02 re-opened: *simultaneous* payout and settlement.
 *
 * The 21.09 tests (`audit-2109-allocation.int-spec.ts`, D02a–D02c) run the two
 * writers one after the other. Sequentially they agree: a payout that already
 * happened is an allocation the next draft nets out, and a draft that claimed
 * the entitlement makes `availableBalance` zero. Neither says anything about
 * the two running at once, which is the case the money is lost in.
 *
 * These tests drive the interleaving instead of hoping for it. Each one opens
 * both transactions on real connections and pauses one of them at the exact
 * statement where the decision is made — after it has read how much is free,
 * before it has written its claim — then lets the other run. No `sleep`, no
 * `Promise.all` and a wish: the barrier is released only once the other
 * transaction has reached the state the test is about.
 *
 * The invariant every case asserts is the one the owner cares about:
 *
 *     open settlements + payouts in flight ≤ what the partner is actually owed
 *
 * Two allocations of one entitlement break it. The ledger identity
 * (`ledgerBalance = net + inOpenSettlements + underReview`) does *not* catch
 * this case — the payout's own debit posting lands in `net` as −50 000 and the
 * identity still balances — which is why it is asserted separately here.
 */
describe('Audit 22.09 — payout and settlement at the same time (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let settlements: PartnerSettlementService;
  let payouts: PayoutEngineService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    settlements = harness.app.get(PartnerSettlementService);
    payouts = harness.app.get(PayoutEngineService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  let partnerId = '';
  let maker = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    partnerId = (await createPartner(prisma)).id;
    maker = (await createStaffUser(prisma)).id;
    await prisma.partnerBankAccount.create({
      data: {
        partnerId,
        beneficiaryName: 'ООО Тест',
        accountNumber: 'AM00 0000 0000 0000',
        bankName: 'Тестбанк',
        createdByUserId: maker,
      },
    });
  });

  afterEach(() => {
    restore();
  });

  // ── barrier plumbing ──────────────────────────────────────────────────────

  type Gate = {
    /** Resolves once the guarded statement has run and the caller is paused. */
    reached: Promise<void>;
    /** Lets the paused transaction continue. */
    release: () => void;
  };

  const restores: Array<() => void> = [];
  function restore() {
    while (restores.length) restores.pop()!();
  }

  function gate(): { gate: Gate; arrive: () => Promise<void> } {
    let signalReached!: () => void;
    let signalRelease!: () => void;
    const reached = new Promise<void>((resolve) => {
      signalReached = resolve;
    });
    const released = new Promise<void>((resolve) => {
      signalRelease = resolve;
    });
    return {
      gate: { reached, release: () => signalRelease() },
      arrive: async () => {
        signalReached();
        await released;
      },
    };
  }

  /**
   * Pauses `createDraft` after it has read what is unsettled — inside its
   * transaction, holding whatever locks it took, before it writes the
   * settlement row.
   */
  function pauseDraftAfterReading(): Gate {
    const { gate: g, arrive } = gate();
    const original = settlements.unsettled.bind(settlements);
    let armed = true;
    (settlements as unknown as { unsettled: typeof settlements.unsettled }).unsettled = async (
      ...args: Parameters<typeof settlements.unsettled>
    ) => {
      const result = await original(...args);
      // Only the call made inside createDraft's transaction, and only once.
      if (armed && args[1]?.tx) {
        armed = false;
        await arrive();
      }
      return result;
    };
    restores.push(() => {
      delete (settlements as unknown as Record<string, unknown>).unsettled;
    });
    return g;
  }

  /**
   * Pauses `requestPayout` after it has taken `FOR UPDATE` on the payable
   * account and read how much open settlements have claimed, before it writes
   * the payout row.
   */
  function pausePayoutAfterReading(): Gate {
    const { gate: g, arrive } = gate();
    const key = 'reservedBySettlements';
    const holder = payouts as unknown as Record<string, (...a: unknown[]) => Promise<Decimal>>;
    const original = (holder[key] as (...a: unknown[]) => Promise<Decimal>).bind(payouts);
    let armed = true;
    holder[key] = async (...args: unknown[]) => {
      const result = await original(...args);
      // The first call is the one inside the transaction, under the row lock.
      if (armed && args[0] !== prisma) {
        armed = false;
        await arrive();
      }
      return result;
    };
    restores.push(() => {
      delete (payouts as unknown as Record<string, unknown>)[key];
    });
    return g;
  }

  // ── fixtures ──────────────────────────────────────────────────────────────

  /** Credits the partner's payable: money TuTak owes and has not settled. */
  async function accrue(amount: string) {
    const [account, counter] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
      ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }),
    ]);
    return ledger.post({
      kind: 'partner.bonus_redemption_compensation',
      sourceType: 'Fixture',
      sourceId: randomUUID(),
      postings: [
        { accountId: account.id, direction: PostingDirection.CREDIT, amount: new Decimal(amount) },
        { accountId: counter.id, direction: PostingDirection.DEBIT, amount: new Decimal(amount) },
      ],
    });
  }

  const period = () => ({
    periodStart: new Date('2026-09-01T00:00:00Z'),
    periodEnd: new Date('2026-10-01T00:00:00Z'),
  });

  const draft = () => settlements.createDraft({ ...period(), partnerId, actorId: maker });
  const payout = (amount: string, key: string = randomUUID()) =>
    payouts.requestPayout({ partnerId, amount, actorId: maker, idempotencyKey: key });

  /**
   * Everything currently promised to this partner from one entitlement:
   * settlements that have claimed postings and not been cancelled, plus
   * payouts that have not failed.
   */
  async function committed(): Promise<{ total: Decimal; settlements: Decimal; payouts: Decimal }> {
    const open = await prisma.partnerSettlement.findMany({
      where: { partnerId, status: { not: PartnerSettlementStatus.CANCELLED } },
      select: { netPayableAmount: true },
    });
    const inFlight = await prisma.payout.findMany({
      where: { partnerId, status: { not: PayoutStatus.FAILED } },
      select: { amount: true },
    });
    const settled = open.reduce((s, r) => s.plus(r.netPayableAmount), new Decimal(0));
    const paid = inFlight.reduce((s, r) => s.plus(r.amount), new Decimal(0));
    return { total: settled.plus(paid), settlements: settled, payouts: paid };
  }

  /**
   * The line that must never be crossed. Expressed as a string so a
   * failure prints both sides of it rather than `expected true, got false`.
   */
  async function expectNoDoubleAllocation(entitlement: string) {
    const c = await committed();
    const detail =
      `settlements ${c.settlements.toFixed(4)} + payouts ${c.payouts.toFixed(4)} ` +
      `= ${c.total.toFixed(4)} committed against an entitlement of ${new Decimal(entitlement).toFixed(4)}`;
    expect(c.total.lessThanOrEqualTo(new Decimal(entitlement)) ? 'within entitlement' : detail).toBe(
      'within entitlement',
    );
  }

  const reason = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected' ? (r.reason as Error) : undefined;

  // ── D02d: draft reads first, payout slips through ─────────────────────────

  it('D02d: a payout cannot take the entitlement a draft is in the middle of claiming', async () => {
    await accrue('50000');

    const g = pauseDraftAfterReading();
    const draftRun = draft();
    await g.reached; // the draft has read 50 000 as unsettled and is holding

    const payoutRun = payout('50000');
    // Give the payout a real chance to finish while the draft is paused: on
    // the unfixed code it does, which is the defect. Under the fix it blocks
    // on the payable row and only proceeds once the draft commits.
    const early = await Promise.race([
      payoutRun.then(
        () => 'settled' as const,
        () => 'settled' as const,
      ),
      new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 750)),
    ]);
    g.release();

    const [draftResult, payoutResult] = await Promise.allSettled([draftRun, payoutRun]);

    await expectNoDoubleAllocation('50000');
    expect(draftResult.status).toBe('fulfilled');
    expect(payoutResult.status).toBe('rejected');
    expect(reason(payoutResult)).toBeInstanceOf(ConflictException);
    expect(reason(payoutResult)?.message).toMatch(/already claimed by an open settlement|exceeds the/);
    // Under the fix the payout waits for the draft rather than racing it.
    expect(early).toBe('blocked');
    expect(await prisma.payout.count()).toBe(0);
  });

  // ── D02e: payout locks first, draft slips through ─────────────────────────

  it('D02e: a draft cannot claim the entitlement a payout is in the middle of taking', async () => {
    await accrue('50000');

    const g = pausePayoutAfterReading();
    const payoutRun = payout('50000');
    await g.reached; // the payout holds FOR UPDATE and has read reserved = 0

    const draftRun = draft();
    const early = await Promise.race([
      draftRun.then(
        () => 'settled' as const,
        () => 'settled' as const,
      ),
      new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 750)),
    ]);
    g.release();

    const [payoutResult, draftResult] = await Promise.allSettled([payoutRun, draftRun]);

    await expectNoDoubleAllocation('50000');
    expect(payoutResult.status).toBe('fulfilled');
    expect(draftResult.status).toBe('rejected');
    expect(reason(draftResult)).toBeInstanceOf(ConflictException);
    expect(reason(draftResult)?.message).toMatch(/Nothing to pay/);
    expect(early).toBe('blocked');
    expect(await prisma.partnerSettlement.count()).toBe(0);
  });

  // ── D02f: the same entitlement, two drafts ────────────────────────────────

  it('D02f: two simultaneous drafts claim the entitlement once', async () => {
    await accrue('50000');

    const g = pauseDraftAfterReading();
    const first = draft();
    await g.reached;
    const second = draft();
    await new Promise((r) => setTimeout(r, 400));
    g.release();

    const results = await Promise.allSettled([first, second]);
    await expectNoDoubleAllocation('50000');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.partnerSettlement.count({ where: { status: PartnerSettlementStatus.DRAFT } }),
    ).toBe(1);
  });

  // ── D02g: two payouts of the whole entitlement ────────────────────────────

  it('D02g: two simultaneous payouts pay the entitlement once', async () => {
    await accrue('50000');

    const g = pausePayoutAfterReading();
    const first = payout('50000');
    await g.reached;
    const second = payout('50000');
    await new Promise((r) => setTimeout(r, 400));
    g.release();

    const results = await Promise.allSettled([first, second]);
    await expectNoDoubleAllocation('50000');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.payout.count()).toBe(1);
  });

  // ── D02h: cancelling a settlement while a payout is deciding ──────────────

  it('D02h: a cancelled settlement releases its claim without paying twice', async () => {
    await accrue('50000');
    const created = await draft();

    const g = pausePayoutAfterReading();
    const payoutRun = payout('50000');
    await g.reached; // reserved was read as 50 000 — this payout must fail

    const cancelRun = settlements.cancel(created.id, { actorId: maker, reason: 'switch to payout' });
    await new Promise((r) => setTimeout(r, 400));
    g.release();

    const [payoutResult] = await Promise.allSettled([payoutRun, cancelRun]);
    expect(payoutResult.status).toBe('rejected');
    expect(reason(payoutResult)).toBeInstanceOf(ConflictException);
    await expectNoDoubleAllocation('50000');

    // Once the cancel has landed the money is free again, and exactly once.
    const after = await payout('50000');
    expect(after.remainingBalance).toBe('0.0000');
    await expectNoDoubleAllocation('50000');
  });

  // ── D02i: paying a settlement while a payout is deciding ──────────────────

  it('D02i: a settlement being marked paid does not free the money for a payout', async () => {
    await accrue('50000');
    const created = await draft();
    await settlements.markReady(created.id, { actorId: maker, documentNumber: 'DOC-1' });
    const approved = await settlements.approve(created.id, (await createStaffUser(prisma)).id);
    expect(approved.status).toBe(PartnerSettlementStatus.APPROVED);

    const g = pausePayoutAfterReading();
    const payoutRun = payout('50000');
    await g.reached;

    const payRun = settlements.markPaid(created.id, {
      actorId: maker,
      bankTransferReference: 'BANK-1',
    });
    await new Promise((r) => setTimeout(r, 400));
    g.release();

    const [payoutResult, payResult] = await Promise.allSettled([payoutRun, payRun]);
    expect(payResult.status).toBe('fulfilled');
    expect(payoutResult.status).toBe('rejected');
    await expectNoDoubleAllocation('50000');
    expect(await prisma.payout.count()).toBe(0);
  });

  // ── D02j: partial allocation ──────────────────────────────────────────────

  it('D02j: a partial payout and a draft cannot together exceed the entitlement', async () => {
    await accrue('50000');

    const g = pauseDraftAfterReading();
    const draftRun = draft();
    await g.reached;
    const payoutRun = payout('20000');
    await new Promise((r) => setTimeout(r, 400));
    g.release();

    const [draftResult, payoutResult] = await Promise.allSettled([draftRun, payoutRun]);
    await expectNoDoubleAllocation('50000');
    expect(draftResult.status).toBe('fulfilled');
    expect(payoutResult.status).toBe('rejected');
  });

  // ── D04c: the partner's page during a draft ───────────────────────────────

  /**
   * D04 was closed on 21.09 by construction — `position()` moved into one
   * `RepeatableRead` transaction — and the report says plainly that the race
   * itself was never reproduced. This reproduces it: the read is paused after
   * its first query and a draft is created underneath it. The identity the
   * partner's page rests on has to survive that.
   */
  it('D04c: a draft created mid-read never shows the same money twice', async () => {
    await accrue('50000');

    const { gate: g, arrive } = gate();
    const original = settlements.unsettled.bind(settlements);
    let armed = true;
    (settlements as unknown as { unsettled: typeof settlements.unsettled }).unsettled = async (
      ...args: Parameters<typeof settlements.unsettled>
    ) => {
      const result = await original(...args);
      if (armed && args[1]?.tx) {
        armed = false;
        await arrive();
      }
      return result;
    };
    restores.push(() => {
      delete (settlements as unknown as Record<string, unknown>).unsettled;
    });

    const reading = settlements.position(partnerId);
    await g.reached; // position has read `unsettled`; the draft does not exist

    const drafting = draft();
    await new Promise((r) => setTimeout(r, 400));
    g.release();

    const [position] = await Promise.all([reading, drafting]);

    // Whatever the snapshot caught, it is *one* snapshot: the money is either
    // still unsettled or already in the settlement, never both.
    expect(position.ledgerBalance.toFixed(4)).toBe(
      position.net.plus(position.inOpenSettlements).plus(position.underReview).toFixed(4),
    );
    expect(position.net.plus(position.inOpenSettlements).toFixed(4)).toBe('50000.0000');
    await expectNoDoubleAllocation('50000');
  });

  // ── D02k: a retry after a lost answer is not a second allocation ──────────

  it('D02k: repeating a payout request after a lost answer pays once', async () => {
    await accrue('50000');
    const key = 'lost-answer-1';
    const first = await payout('50000', key);
    const again = await payout('50000', key);
    expect(again.payoutId).toBe(first.payoutId);
    await expectNoDoubleAllocation('50000');
    expect(await prisma.payout.count()).toBe(1);
  });
});
