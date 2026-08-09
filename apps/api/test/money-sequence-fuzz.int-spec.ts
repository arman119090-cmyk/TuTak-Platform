import { PayoutStatus, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { RefundEngineService } from '../src/modules/payments/refund-engine.service';
import { PayoutEngineService } from '../src/modules/payouts/payout-engine.service';
import { SettlementService } from '../src/modules/settlement/settlement.service';
import { OutboxService } from '../src/modules/ledger/outbox.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Random sequences of real money operations, with every invariant checked
 * after every step.
 *
 * Every other suite in this directory tests a scenario somebody thought of.
 * That has found a lot — and the two Critical defects in
 * `AUDIT_FINANCIAL_2026-08.md` were both found by attacking in a way no
 * previous round had, rather than by looking harder at what was already
 * covered. This is another way: it does not know what a bug looks like, it
 * only knows what must never stop being true, and it explores orderings
 * nobody would write down.
 *
 * ## Reproducibility
 *
 * The generator is seeded and the seed is printed. A failure names the exact
 * sequence that produced it, so "it failed once in CI" becomes a test case
 * rather than a ghost. Set FUZZ_SEED to replay one.
 *
 * ## Bounded on purpose
 *
 * The default is small enough to belong in the normal suite. FUZZ_STEPS
 * raises it for a deliberate hunt — this file was first run at 400 steps
 * across 20 seeds before being committed at its default.
 *
 * ## Refusals are not failures
 *
 * A payout larger than the partner is owed *should* be refused, and so
 * should a refund past the captured amount. The generator does not avoid
 * proposing them; it counts them. What must never happen is an operation
 * that succeeds and leaves the books wrong.
 */

/** Mulberry32 — small, fast, and identical on every machine, which `Math.random` is not. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEPS = Number(process.env.FUZZ_STEPS ?? 60);
// A comma-separated list, so a hunt across many seeds is one Jest run and
// one harness boot rather than one per seed.
const SEEDS = process.env.FUZZ_SEED
  ? process.env.FUZZ_SEED.split(',').map((s) => Number(s.trim()))
  : [0xc0ffee, 0x5eed, 0x1d0d];

describe('Money operations under random sequences (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let refunds: RefundEngineService;
  let payouts: PayoutEngineService;
  let settlement: SettlementService;
  let outbox: OutboxService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    refunds = harness.app.get(RefundEngineService);
    payouts = harness.app.get(PayoutEngineService);
    settlement = harness.app.get(SettlementService);
    outbox = harness.app.get(OutboxService);
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * Everything that must be true after any operation, whatever it was.
   *
   * Deliberately about *outcomes*, not consistency. A duplicated refund is
   * two complete, correct, balanced transactions — the ledger balances
   * throughout and the customer has still been paid twice. That mistake was
   * made once already, in the first version of
   * `refund-payout-key-durability.int-spec.ts`, so the bounds below matter as
   * much as the balance does.
   */
  const assertInvariants = async (context: string) => {
    const [totals] = await prisma.$queryRaw<{ difference: Decimal }[]>`
      select coalesce(sum(case when direction = 'DEBIT' then amount else -amount end), 0)
        as difference
      from ledger_postings
    `;
    expect(`${context}: ledger difference ${new Decimal(totals?.difference ?? 0).toFixed(4)}`).toBe(
      `${context}: ledger difference 0.0000`,
    );

    // Every account's stored balance must equal a replay of its own postings.
    // A stored number that drifts from its history is the failure mode that
    // makes a balance impossible to argue with a partner about.
    const drift = await prisma.$queryRaw<{ id: string; stored: Decimal; replayed: Decimal }[]>`
      select a.id, a.balance as stored,
             coalesce(sum(case when p.direction = 'DEBIT' then p.amount else -p.amount end), 0)
               as replayed
      from ledger_accounts a
      left join ledger_postings p on p."accountId" = a.id
      group by a.id, a.balance
      having a.balance <> coalesce(
        sum(case when p.direction = 'DEBIT' then p.amount else -p.amount end), 0)
    `;
    expect(`${context}: accounts disagreeing with their postings: ${drift.length}`).toBe(
      `${context}: accounts disagreeing with their postings: 0`,
    );

    // No payment refunded past what was captured.
    const overRefunded = await prisma.$queryRaw<{ count: bigint }[]>`
      select count(*)::bigint as count from payments where "refundedAmount" > amount
    `;
    expect(`${context}: payments refunded past capture: ${Number(overRefunded[0]?.count ?? 0)}`).toBe(
      `${context}: payments refunded past capture: 0`,
    );

    // A partner payable *can* legitimately go positive — the partner owing
    // the platform — when a payout drains the balance and a refund then
    // reverses the payment behind it. This invariant asserted it could not,
    // and the generator disproved that on its third seed.
    //
    // The state is real and the ledger is right; what was missing was anyone
    // being told, because recovering that money is a conversation someone
    // has to know to have. `RefundEngineService.warnIfPartnerNowOwesUs`
    // raises it now, and `refund-partner-debit.int-spec.ts` covers it.
    //
    // What is still asserted is the bound: a partner cannot owe more than
    // the platform ever paid them, which would mean a refund reversed money
    // that was never sent.
    const impossibleDebt = await prisma.$queryRaw<{ count: bigint }[]>`
      select count(*)::bigint as count
      from ledger_accounts a
      where a.type = 'PARTNER_PAYABLE'
        and a.balance > coalesce((
          select sum(p.amount) from payouts p
          where p."partnerId" = a."partnerId"
        ), 0)
    `;
    expect(`${context}: partners owing more than was paid out: ${Number(impossibleDebt[0]?.count ?? 0)}`).toBe(
      `${context}: partners owing more than was paid out: 0`,
    );

    const negativeWallets = await prisma.$queryRaw<{ count: bigint }[]>`
      select count(*)::bigint as count from wallets
      where "availableBonus" < 0 or "pendingBonus" < 0 or "reservedBonus" < 0
    `;
    expect(`${context}: wallets in the negative: ${Number(negativeWallets[0]?.count ?? 0)}`).toBe(
      `${context}: wallets in the negative: 0`,
    );
  };

  describe.each(SEEDS)('seed 0x%s', (seed) => {
    it(`survives ${STEPS} random money operations`, async () => {
      await truncateAll(prisma);
      await harness.resetAlerts();

      const random = rng(seed);
      const pick = <T>(xs: T[]): T | undefined =>
        xs.length ? xs[Math.floor(random() * xs.length)] : undefined;
      // Amounts that do not divide evenly, on purpose: a rate applied to
      // 333.33 is where rounding shows up, and 1,000 is where it hides.
      const money = () => (Math.floor(random() * 90_000) / 100 + 1.11).toFixed(2);

      const partners = [await createPartner(prisma), await createPartner(prisma)];
      const customers = [
        await createCustomer(prisma),
        await createCustomer(prisma),
        await createCustomer(prisma),
      ];
      const operator = await createCustomer(prisma);

      const captured: string[] = [];
      const requestedPayouts: string[] = [];
      const refused: Record<string, number> = {};
      const performed: Record<string, number> = {};
      let step = 0;

      const attempt = async (name: string, run: () => Promise<unknown>) => {
        try {
          await run();
          performed[name] = (performed[name] ?? 0) + 1;
        } catch (err) {
          // A refusal is the system working. What matters is that it left
          // nothing behind, which the invariants below check either way.
          refused[name] = (refused[name] ?? 0) + 1;
          if (err instanceof Error && /Unknown|Cannot read|is not a function/.test(err.message)) {
            throw err; // a programming error, not a business refusal
          }
        }
        await assertInvariants(`seed ${seed} step ${step} after ${name}`);
      };

      for (step = 0; step < STEPS; step++) {
        const roll = random();

        if (roll < 0.34) {
          const customer = pick(customers)!;
          const partner = pick(partners)!;
          await attempt('capture', async () => {
            const result = await payments.capture({
              userId: customer.user.id,
              partnerId: partner.id,
              amount: money(),
              sourceToken: 'tok_ok',
              idempotencyKey: `fuzz-${seed}-${step}`,
            });
            captured.push(result.paymentId);
          });
        } else if (roll < 0.5) {
          const paymentId = pick(captured);
          if (!paymentId) continue;
          const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
          if (!payment) continue;
          // Sometimes a legal partial, sometimes deliberately too much.
          const remaining = payment.amount.minus(payment.refundedAmount);
          const amount = random() < 0.75
            ? remaining.times(random()).toDecimalPlaces(2).toString()
            : remaining.plus(50).toFixed(2);
          if (new Decimal(amount).lessThanOrEqualTo(0)) continue;
          await attempt('refund', () =>
            refunds.refund({
              paymentId,
              amount,
              reason: `fuzz ${step}`,
              actorId: operator.user.id,
              idempotencyKey: `fuzz-refund-${seed}-${step}`,
            }),
          );
        } else if (roll < 0.62) {
          await attempt('drain outbox', () => outbox.drain());
        } else if (roll < 0.74) {
          // Settlement is per payment, driven by the outbox in production.
          // Calling it directly here exercises the same path a drained event
          // would, including on a payment that has already settled.
          const paymentId = pick(captured);
          if (!paymentId) continue;
          await attempt('settle', () => settlement.settlePayment(paymentId));
        } else if (roll < 0.88) {
          const partner = pick(partners)!;
          await attempt('request payout', async () => {
            const result = await payouts.requestPayout({
              partnerId: partner.id,
              amount: money(),
              actorId: operator.user.id,
              idempotencyKey: `fuzz-payout-${seed}-${step}`,
            });
            requestedPayouts.push(result.payoutId);
          });
        } else {
          const payoutId = pick(requestedPayouts);
          if (!payoutId) continue;
          const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
          if (!payout || payout.status !== PayoutStatus.REQUESTED) continue;
          await attempt('confirm payout', () =>
            // A different person from the requester on purpose: the two-person
            // rule is part of what must keep holding.
            payouts.confirmPaid(payoutId, `fuzz-${seed}-${step}`, customers[0]!.user.id),
          );
        }
      }

      // Printed rather than asserted: the shape of a run is worth seeing when
      // one fails, and pinning exact counts would make the test brittle
      // against a generator change without making it stronger.
      // eslint-disable-next-line no-console
      console.log(
        `seed ${seed}: performed ${JSON.stringify(performed)} refused ${JSON.stringify(refused)}`,
      );

      // The run has to have actually done something, or a generator that
      // silently stopped producing work would pass forever.
      expect(Object.values(performed).reduce((a, b) => a + b, 0)).toBeGreaterThan(5);
    }, 300_000);
  });
});
