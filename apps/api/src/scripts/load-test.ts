/**
 * What this platform does under concurrency.
 *
 * Driven through the engines rather than over HTTP, on purpose. The API is
 * rate limited per address — ten payment captures a minute — so a load test
 * from one machine over HTTP measures the throttler and nothing else. What
 * is worth measuring is underneath it: the double-entry ledger under
 * concurrent writes, the `FOR UPDATE` lock on a partner's balance, the
 * idempotency protocol, and the serialization-failure retry loop. Those are
 * the parts that can be correct at one request per second and wrong at two
 * hundred.
 *
 *   CARD_PAYMENTS_ENABLED=true node dist/scripts/load-test.ts   # defaults below
 *   LOAD_CONCURRENCY=64 LOAD_SECONDS=20 node dist/scripts/load-test.js
 *
 * Exercises PaymentEngineService, so it needs the legacy card-payment
 * subsystem loaded — see CARD_PAYMENTS_ENABLED in app.module.ts.
 *
 * Every run ends by asserting the same invariant the test suite does: all
 * accounts sum to zero, and each account's stored balance equals a replay of
 * its own postings. A throughput number from a run that corrupted the ledger
 * is worse than no number at all.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ReferrerType, RoleName } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as argon2 from 'argon2';
import * as os from 'os';
import { AppModule } from '../app.module';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { PaymentEngineService } from '../modules/payments/payment-engine.service';
import { PayoutEngineService } from '../modules/payouts/payout-engine.service';
import { OutboxService } from '../modules/ledger/outbox.service';
import { PurchaseIntentsService } from '../modules/purchase-intents/purchase-intents.service';
import { ReferralService } from '../modules/referral/referral.service';
import { LedgerService } from '../modules/ledger/ledger.service';

/**
 * The report goes to stdout directly rather than through Nest's Logger.
 *
 * The application context below is created with `logger: ['error', 'warn']`,
 * because a run that prints every module Nest instantiates buries the
 * numbers. But that filter applies to `Logger.log` too — so a report written
 * through the Logger is discarded by the very setting that makes the run
 * readable. Writing to stdout keeps both.
 */
function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 32);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 15);
const CUSTOMERS = Number(process.env.LOAD_CUSTOMERS ?? 50);
/**
 * How many merchants the purchase-intent phase spreads its load across.
 *
 * One by default, and that is the interesting number: every confirmation
 * against a merchant moves that merchant's ledger account, so a single
 * partner is one busy fuel station on a Friday evening — the case that
 * decides whether a queue forms. Raising it separates "this merchant is
 * saturated" from "the platform is saturated", which are different
 * problems with different answers.
 */
const PARTNERS = Number(process.env.LOAD_PARTNERS ?? 1);

/**
 * The money-path phases (6-8) get their own customers, separate from the
 * ones phases 1-5 hammer, because they need a state those phases would
 * disturb: a bonus balance to spend, and a referral chain above them.
 */
const MONEY_CUSTOMERS = Number(process.env.LOAD_MONEY_CUSTOMERS ?? 20);
/**
 * Independent referral trees. Each is three referrers deep, and the tree's
 * customers all hang off the same level-1 referrer — so the run covers both
 * "several customers share one referrer" and "several unrelated trees settle
 * at once", which are the two ways a chain can be contaminated by another.
 */
const TREES = Number(process.env.LOAD_REFERRAL_TREES ?? 4);
/**
 * One warm-up purchase this size gives a customer bonus to spend for the
 * rest of the run: green is a fifth of a pool that is itself the partner's
 * negotiated rate on the gross, so 200,000 at the default 300 bps leaves
 * 1,200 available — hundreds of the 5-unit redemptions below.
 *
 * Earned, not injected. `BonusEngineService.accrue` could hand a wallet a
 * balance in one call, but then the lots being reserved would not be the
 * lots a purchase actually produces, and the reservation path is exactly
 * what these phases exist to exercise.
 */
const WARMUP_GROSS = process.env.LOAD_WARMUP_GROSS ?? '200000';
const BONUS_SPEND = process.env.LOAD_BONUS_SPEND ?? '5';

interface Sample {
  ms: number;
  ok: boolean;
  error?: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
}

function report(title: string, samples: Sample[], elapsedMs: number): void {
  const ok = samples.filter((s) => s.ok);
  const failed = samples.filter((s) => !s.ok);
  const durations = ok.map((s) => s.ms).sort((a, b) => a - b);

  const errors = new Map<string, number>();
  for (const sample of failed) {
    const key = (sample.error ?? 'unknown').slice(0, 70);
    errors.set(key, (errors.get(key) ?? 0) + 1);
  }

  say(`── ${title} ─────────────────────────────────`);
  say(`  requests      ${samples.length} in ${(elapsedMs / 1000).toFixed(1)}s`);
  say(`  throughput    ${(ok.length / (elapsedMs / 1000)).toFixed(1)} ok/s`);
  say(`  succeeded     ${ok.length}`);
  say(`  failed        ${failed.length}`);
  say(`  p50 / p95 / p99   ${percentile(durations, 50)} / ${percentile(durations, 95)} / ${percentile(durations, 99)} ms`);
  say(`  slowest       ${durations.at(-1) ?? 0} ms`);
  for (const [message, count] of errors) {
    say(`  ✗ ${count}×  ${message}`);
  }
}

/** Runs `task` on `concurrency` workers until the clock runs out. */
async function saturate(
  concurrency: number,
  seconds: number,
  task: (n: number) => Promise<void>,
): Promise<{ samples: Sample[]; elapsedMs: number }> {
  const samples: Sample[] = [];
  const deadline = Date.now() + seconds * 1000;
  const started = Date.now();
  let sequence = 0;

  const worker = async () => {
    while (Date.now() < deadline) {
      const n = sequence++;
      const began = Date.now();
      try {
        await task(n);
        samples.push({ ms: Date.now() - began, ok: true });
      } catch (err) {
        samples.push({
          ms: Date.now() - began,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { samples, elapsedMs: Date.now() - started };
}

async function main() {
  // No background sweeps in a measurement run. The outbox drainer is on a
  // ten-second schedule, so with it running the "outbox drain" phase below
  // shares its work with a drainer this script cannot see — the rate it
  // reports would be a fraction of the platform's, and the fraction would
  // vary with how long the run took.
  process.env.SWEEPS_ENABLED = 'false';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const payments = app.get(PaymentEngineService);
  const payouts = app.get(PayoutEngineService);
  const outbox = app.get(OutboxService);
  const intents = app.get(PurchaseIntentsService);
  const referrals = app.get(ReferralService);
  const ledger = app.get(LedgerService);

  // Numbers without the machine they were measured on are not a result, they
  // are a rumour. Anyone comparing a later run against a recorded one needs
  // to know whether they are looking at a regression or a smaller box.
  const pgRows = await prisma.$queryRaw<{ version: string }[]>`
    SELECT current_setting('server_version') AS version`;
  const pgVersion = pgRows[0]?.version ?? 'unknown';
  say('── Environment ──────────────────────────────────');
  say(`  node          ${process.version}`);
  say(`  postgres      ${pgVersion}`);
  say(`  cpus          ${os.cpus().length} × ${os.cpus()[0]?.model ?? 'unknown'}`);
  say(`  memory        ${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`);
  say(
    `  settings      concurrency=${CONCURRENCY} duration=${SECONDS}s customers=${CUSTOMERS} partners=${PARTNERS}`,
  );
  say();

  // ── Fixtures ───────────────────────────────────────────────────────────
  const run = Date.now().toString(36);
  // Fixture phones have to be unique per run, not merely per index. They were
  // `+37490<index>`, which is stable across runs — so a second run against a
  // database that still held the first one's fixtures died on the phone
  // unique constraint before measuring anything. Re-running against a warm
  // database is exactly what investigating a result requires, so the run's
  // own clock goes into the number: `+374<run><index>`, twelve characters,
  // which is what the column expects.
  const runDigits = String(Date.now() % 10_000).padStart(4, '0');
  const phoneFor = (index: number) => `+374${runDigits}${String(index).padStart(4, '0')}`;
  const passwordHash = await argon2.hash('LoadTestOnly-2026!');
  const customerRole = await prisma.role.findUniqueOrThrow({
    where: { name: RoleName.CUSTOMER },
  });

  const partner = await prisma.partner.create({
    data: {
      legalName: `Load Test ${run}`,
      displayName: `Load Test ${run}`,
      taxId: `LOAD-${run}`,
      category: 'load-test',
    },
  });

  // Several customers, not one. Concurrent writes to a single wallet would
  // measure row contention on that wallet rather than the platform's
  // throughput, which is not the question.
  const customers: string[] = [];
  for (let i = 0; i < CUSTOMERS; i += 1) {
    const user = await prisma.user.create({
      data: {
        phone: phoneFor(i),
        firstName: 'Load',
        lastName: `Test${i}`,
        passwordHash,
        isPhoneVerified: true,
        wallet: { create: {} },
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: customerRole.id } });
    customers.push(user.id);
  }
  say(`created ${customers.length} customers and 1 partner`);

  // One capture first, alone, so the ledger accounts exist before the
  // measured phase. `accountFor` is find-then-create and recovers from
  // losing the race, but thirty-two workers arriving at a virgin ledger all
  // try to create the same account at once — which measures cold start and
  // fills the log with handled unique-constraint violations. Production
  // does not start from a virgin ledger every morning.
  await payments.capture({
    userId: customers[0]!,
    partnerId: partner.id,
    amount: '1000',
    sourceToken: 'tok_load_test',
    idempotencyKey: `load-${run}-warmup`,
  });

  // ── 1. Payment capture ─────────────────────────────────────────────────
  //
  // The hot path. Every capture writes a Payment row, three ledger postings
  // and an outbox event inside one transaction, and moves three account
  // balances — two of which every other concurrent capture also moves.

  const capture = await saturate(CONCURRENCY, SECONDS, async (n) => {
    await payments.capture({
      userId: customers[n % customers.length]!,
      partnerId: partner.id,
      amount: '1000',
      sourceToken: 'tok_load_test',
      idempotencyKey: `load-${run}-${n}`,
    });
  });
  report('Payment capture', capture.samples, capture.elapsedMs);

  // ── 2. Idempotent replay ───────────────────────────────────────────────
  //
  // What a flaky mobile network actually produces: the same key again. This
  // path must be cheap, because it is the one that gets hammered.

  const replayKey = `load-${run}-replay`;
  await payments.capture({
    userId: customers[0]!,
    partnerId: partner.id,
    amount: '1000',
    sourceToken: 'tok_load_test',
    idempotencyKey: replayKey,
  });
  const replay = await saturate(CONCURRENCY, Math.min(SECONDS, 10), async () => {
    await payments.capture({
      userId: customers[0]!,
      partnerId: partner.id,
      amount: '1000',
      sourceToken: 'tok_load_test',
      idempotencyKey: replayKey,
    });
  });
  report('Idempotent replay', replay.samples, replay.elapsedMs);

  // ── 3. Outbox drain ────────────────────────────────────────────────────

  const drainStart = Date.now();
  let drained = 0;
  for (;;) {
    const count = await outbox.drain();
    drained += count;
    if (count === 0) break;
  }
  const drainMs = Date.now() - drainStart;
  say('── Outbox drain ─────────────────────────────────');
  say(`  settled       ${drained} event(s) in ${(drainMs / 1000).toFixed(1)}s`);
  if (drained > 0) {
    say(`  rate          ${(drained / (drainMs / 1000)).toFixed(1)} events/s`);
  }

  // ── 4. Contended payouts ───────────────────────────────────────────────
  //
  // Every one of these takes `FOR UPDATE` on the same partner's payable
  // balance, so they serialize by design. The number to watch is not
  // throughput but whether the total paid out ever exceeds what was owed —
  // reported below by the ledger check.

  const owedBefore = await payouts.availableBalance(partner.id);
  const payoutRuns = await saturate(Math.min(CONCURRENCY, 16), Math.min(SECONDS, 10), async (n) => {
    await payouts.requestPayout({
      partnerId: partner.id,
      amount: '10',
      actorId: 'load-test',
      idempotencyKey: `load-payout-${run}-${n}`,
    });
  });
  report('Contended payouts (same partner)', payoutRuns.samples, payoutRuns.elapsedMs);
  const owedAfter = await payouts.availableBalance(partner.id);
  const paid = owedBefore.minus(owedAfter);
  say(`  owed before   ${owedBefore.toFixed(4)}`);
  say(`  owed after    ${owedAfter.toFixed(4)}`);
  say(`  paid out      ${paid.toFixed(4)}`);
  if (owedAfter.lessThan(0)) {
    throw new Error(`Partner was overpaid: balance is ${owedAfter.toFixed(4)}`);
  }

  // ── 5. Purchase intent settlement ──────────────────────────────────────
  //
  // The path a till actually runs, and the one phases 1-4 do not touch.
  // Those exercise `PaymentEngineService`, which sits behind
  // `CARD_PAYMENTS_ENABLED` and is off in production — so a run that
  // reported only them described a subsystem nobody's money goes through.
  // Confirming an intent is the heaviest transaction this platform has:
  // it claims the intent, settles the reservation, computes the pool
  // against the rate snapshotted at creation, splits it six ways across
  // the referral chain, writes the bonus lots and the deferred lots, and
  // posts the partner's contribution to the ledger — all inside one
  // transaction, all against the same partner's accounts.
  //
  // The contention is deliberate: one partner, many customers, which is a
  // busy fuel station on a Friday evening rather than an even spread.

  // Each merchant needs its own confirming staff member: affiliation is what
  // `create` refuses, so a staff member not attached to the partner would
  // measure a path production rejects rather than the settlement.
  const tills: Array<{ partnerId: string; staffUserId: string }> = [];
  for (let i = 0; i < PARTNERS; i += 1) {
    const merchant =
      i === 0
        ? partner
        : await prisma.partner.create({
            data: {
              legalName: `Load Test ${run}-${i}`,
              displayName: `Load Test ${run}-${i}`,
              taxId: `LOAD-${run}-${i}`,
              category: 'load-test',
            },
          });
    const staff = await prisma.user.create({
      data: {
        phone: phoneFor(CUSTOMERS + i),
        firstName: 'Load',
        lastName: `Staff${i}`,
        passwordHash,
        isPhoneVerified: true,
      },
    });
    await prisma.partnerMembership.create({
      data: { partnerId: merchant.id, userId: staff.id },
    });
    tills.push({ partnerId: merchant.id, staffUserId: staff.id });
  }

  const purchases = await saturate(CONCURRENCY, SECONDS, async (n) => {
    const till = tills[n % tills.length]!;
    const intent = await intents.create(
      { partnerId: till.partnerId, grossAmount: '1000' },
      customers[n % customers.length]!,
    );
    await intents.confirm(intent.id, till.staffUserId);
  });
  report(
    `Purchase intent (create + confirm, ${PARTNERS} merchant${PARTNERS === 1 ? '' : 's'})`,
    purchases.samples,
    purchases.elapsedMs,
  );

  // ── Money-path fixtures ────────────────────────────────────────────────
  //
  // Phases 1-5 measure throughput. Phases 6-8 measure whether the parts of
  // a purchase that move a customer's own money stay correct while they do
  // — the bonus a customer spends, and the chain of referrers a purchase
  // pays. Both were invisible to every phase above: nothing there requests
  // bonus, so no reservation was ever taken, and nobody there has a
  // referrer, so the whole pool collapsed onto TuTak's residual leg.

  let phoneCursor = CUSTOMERS + PARTNERS;
  const newUser = async (label: string) => {
    const user = await prisma.user.create({
      data: {
        phone: phoneFor(phoneCursor++),
        firstName: 'Load',
        lastName: label,
        passwordHash,
        isPhoneVerified: true,
        wallet: { create: {} },
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: customerRole.id } });
    return user.id;
  };

  // Three referrers per tree, chained upward: the customer's invite names
  // level 1, level 1's own invite names level 2, and level 2's names level
  // 3. That is the shape `ReferralService.resolveReferralChain` walks, so
  // building it with invite rows is building the real thing rather than a
  // stand-in — attribution is immutable once written, and these are written
  // once, before any purchase runs.
  const trees: Array<{ l1: string; l2: string; l3: string }> = [];
  for (let t = 0; t < TREES; t += 1) {
    const l3 = await newUser(`L3T${t}`);
    const l2 = await newUser(`L2T${t}`);
    const l1 = await newUser(`L1T${t}`);
    await prisma.referralInvite.create({
      data: { referrerType: ReferrerType.USER, referrerUserId: l3, refereeUserId: l2 },
    });
    await prisma.referralInvite.create({
      data: { referrerType: ReferrerType.USER, referrerUserId: l2, refereeUserId: l1 },
    });
    trees.push({ l1, l2, l3 });
  }

  // Two populations, so phase 6 can isolate the reservation path from the
  // referral one: `bonusOnly` customers have no referrer at all, `chained`
  // customers hang off a tree's level-1 referrer.
  const bonusOnly: string[] = [];
  const chained: string[] = [];
  for (let i = 0; i < MONEY_CUSTOMERS; i += 1) {
    bonusOnly.push(await newUser(`Bonus${i}`));
    const customerId = await newUser(`Chain${i}`);
    await prisma.referralInvite.create({
      data: {
        referrerType: ReferrerType.USER,
        referrerUserId: trees[i % trees.length]!.l1,
        refereeUserId: customerId,
      },
    });
    chained.push(customerId);
  }
  say(`created ${trees.length} referral trees and ${bonusOnly.length + chained.length} money-path customers`);

  // Earn the balance the next phases spend. Sequential on purpose: this is
  // setup, not a measurement, and running it flat out would only add noise
  // to the phase that follows it.
  const till = tills[0]!;
  for (const customerId of [...bonusOnly, ...chained]) {
    const warmup = await intents.create(
      { partnerId: till.partnerId, grossAmount: WARMUP_GROSS },
      customerId,
    );
    await intents.confirm(warmup.id, till.staffUserId);
  }
  const warmed = await prisma.wallet.findFirstOrThrow({ where: { userId: bonusOnly[0] } });
  say(`warm-up left ${warmed.availableBonus.toFixed(4)} available bonus per customer`);

  // ── 6. Purchase with bonus (reservation path) ──────────────────────────
  //
  // The half of `settlePurchase` phase 5 never reached. Creating the intent
  // holds the bonus against the customer's oldest lots; confirming settles
  // that hold and consumes them. Under concurrency the hazards are a hold
  // that outlives its intent, a lot consumed twice, and a wallet whose
  // cached balances stop matching its own lots — all three are asserted at
  // the end of the run.

  const withBonus = await saturate(CONCURRENCY, SECONDS, async (n) => {
    const intent = await intents.create(
      {
        partnerId: till.partnerId,
        grossAmount: '1000',
        bonusAmountRequested: BONUS_SPEND,
      },
      bonusOnly[n % bonusOnly.length]!,
    );
    await intents.confirm(intent.id, till.staffUserId);
  });
  report('Purchase with bonus (reservation path)', withBonus.samples, withBonus.elapsedMs);

  // ── 7. Purchase through a three-level referral chain ───────────────────
  //
  // Now the pool actually splits. Every confirmation here pays three
  // referrers as well as the customer, and the customers deliberately share
  // referrers, so the same referrer wallet is credited by many concurrent
  // settlements at once — which is where a lost update would show.

  const throughChain = await saturate(CONCURRENCY, SECONDS, async (n) => {
    const intent = await intents.create(
      { partnerId: till.partnerId, grossAmount: '1000' },
      chained[n % chained.length]!,
    );
    await intents.confirm(intent.id, till.staffUserId);
  });
  report('Purchase through a 3-level chain', throughChain.samples, throughChain.elapsedMs);

  // ── 8. Bonus and referral together ─────────────────────────────────────
  //
  // The real shape of a purchase, and the one worth trusting: the customer
  // spends bonus, earns new green and deferred bonus on the gross, and pays
  // three referrers, all inside the one transaction.

  const combined = await saturate(CONCURRENCY, SECONDS, async (n) => {
    const intent = await intents.create(
      {
        partnerId: till.partnerId,
        grossAmount: '1000',
        bonusAmountRequested: BONUS_SPEND,
      },
      chained[n % chained.length]!,
    );
    await intents.confirm(intent.id, till.staffUserId);
  });
  report('Bonus + referral combined', combined.samples, combined.elapsedMs);

  // ── The number that decides whether the rest means anything ────────────

  say('── Ledger integrity ─────────────────────────────');
  let total = new Decimal(0);
  let drift = 0;
  for (const account of await prisma.ledgerAccount.findMany()) {
    total = total.plus(account.balance);
    const replayed = await ledger.replayBalance(account.id);
    if (!replayed.equals(account.balance)) {
      drift += 1;
      say(
        `  DRIFT ${account.type}: stored ${account.balance.toFixed(4)} vs replayed ${replayed.toFixed(4)}`,
      );
    }
  }
  say(`  accounts      ${await prisma.ledgerAccount.count()}`);
  say(`  postings      ${await prisma.ledgerPosting.count()}`);
  say(`  sum           ${total.toFixed(4)}`);

  // Same definition the service uses: unprocessed and out of attempts.
  const dead = (await outbox.deadLettered()).length;
  say(`  dead-lettered ${dead}`);

  // ── Money-path integrity ───────────────────────────────────────────────
  //
  // The ledger check above proves the double-entry side balanced. It says
  // nothing about the customer-facing side: a bonus lot consumed twice, a
  // hold left behind by a settlement that rolled back, or a referrer paid
  // for somebody else's purchase all leave the ledger summing to zero.
  // These are the invariants that would catch them, and every one of them
  // is checked over the whole database, not a sample.

  say();
  say('── Money-path integrity ─────────────────────────');
  let broken = 0;
  const check = async (label: string, sql: Promise<Array<{ n: bigint | number }>>) => {
    const offenders = Number((await sql)[0]?.n ?? 0);
    if (offenders > 0) broken += 1;
    say(`  ${offenders === 0 ? '✓' : '✗'} ${label}${offenders === 0 ? '' : ` — ${offenders} row(s)`}`);
  };

  // A wallet's cached balances are a denormalisation of its lots and holds.
  // Concurrency is exactly what pulls them apart.
  await check(
    'wallet available balance equals the sum of its available lots',
    prisma.$queryRaw`
      SELECT count(*) AS n FROM wallets w
      LEFT JOIN (
        SELECT "walletId", SUM("remainingAmount") AS s FROM bonus_lots
        WHERE status = 'AVAILABLE' GROUP BY "walletId"
      ) l ON l."walletId" = w.id
      WHERE w."availableBonus" <> COALESCE(l.s, 0)`,
  );
  await check(
    'wallet reserved balance equals the sum of its active holds',
    prisma.$queryRaw`
      SELECT count(*) AS n FROM wallets w
      LEFT JOIN (
        SELECT "walletId", SUM(amount) AS s FROM bonus_reservations
        WHERE status = 'ACTIVE' GROUP BY "walletId"
      ) r ON r."walletId" = w.id
      WHERE w."reservedBonus" <> COALESCE(r.s, 0)`,
  );

  // Every unit taken out of a lot must be accounted for by an allocation
  // naming that lot. Consume a lot twice and this is what disagrees.
  await check(
    'every lot consumed exactly as much as its allocations claim',
    prisma.$queryRaw`
      SELECT count(*) AS n FROM bonus_lots bl
      LEFT JOIN (
        SELECT "lotId", SUM(amount) AS s FROM bonus_reservation_allocations GROUP BY "lotId"
      ) a ON a."lotId" = bl.id
      WHERE bl."originalAmount" - bl."remainingAmount" <> COALESCE(a.s, 0)`,
  );
  await check(
    'no lot is over-consumed or negative',
    prisma.$queryRaw`
      SELECT count(*) AS n FROM bonus_lots
      WHERE "remainingAmount" < 0 OR "remainingAmount" > "originalAmount"`,
  );

  // A hold and the intent that owns it are written in one transaction and
  // must move together. Either mismatch is a stuck customer: a settled
  // hold under an unconfirmed intent has taken money for nothing, and an
  // active hold under a confirmed one never released it.
  await check(
    'reservation status agrees with the intent that owns it',
    prisma.$queryRaw`
      SELECT count(*) AS n FROM purchase_intents pi
      JOIN bonus_reservations br ON br.id = pi."bonusReservationId"
      WHERE (pi.status = 'CONFIRMED' AND br.status <> 'SETTLED')
         OR (pi.status = 'AWAITING_CONFIRMATION' AND br.status <> 'ACTIVE')`,
  );
  await check(
    'no active hold is left without an intent still waiting on it',
    prisma.$queryRaw`
      SELECT count(*) AS n FROM bonus_reservations br
      WHERE br.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM purchase_intents pi
          WHERE pi."bonusReservationId" = br.id AND pi.status = 'AWAITING_CONFIRMATION')`,
  );

  // One settlement, one credit. A retried or double-run settlement would
  // put a second lot on the same wallet for the same transaction.
  await check(
    'no wallet was credited twice for one transaction',
    prisma.$queryRaw`
      SELECT count(*) AS n FROM (
        SELECT "sourceTransactionId", "walletId" FROM bonus_lots
        WHERE "sourceTransactionId" IS NOT NULL
        GROUP BY "sourceTransactionId", "walletId" HAVING count(*) > 1
      ) dupes`,
  );
  await check(
    'no deferred lot was written twice for one transaction',
    prisma.$queryRaw`
      SELECT count(*) AS n FROM (
        SELECT "sourceTransactionId", "userId" FROM deferred_bonus_lots
        GROUP BY "sourceTransactionId", "userId" HAVING count(*) > 1
      ) dupes`,
  );

  // A settlement that failed must leave nothing behind — no green lot, no
  // deferred lot, no referrer credit — or the customer was charged for a
  // purchase the till never completed.
  await check(
    'no unconfirmed intent left financial effects behind',
    prisma.$queryRaw`
      SELECT count(*) AS n FROM purchase_intents pi
      WHERE pi.status = 'AWAITING_CONFIRMATION'
        AND pi."sourceTransactionId" IS NOT NULL
        AND (EXISTS (SELECT 1 FROM bonus_lots bl WHERE bl."sourceTransactionId" = pi."sourceTransactionId")
          OR EXISTS (SELECT 1 FROM deferred_bonus_lots dl WHERE dl."sourceTransactionId" = pi."sourceTransactionId"))`,
  );

  // Every confirmed purchase must have priced itself the way the program
  // says. `computePoolSplit` is the program — the same function the
  // settlement used — so re-running it against what was actually stored
  // asks whether concurrency changed the answer, not whether the formula
  // is right. That is what the unit tests are for.
  const confirmed = await prisma.purchaseIntent.findMany({
    where: { status: 'CONFIRMED', poolAmount: { not: null } },
    select: {
      id: true,
      customerId: true,
      poolAmount: true,
      greenAmount: true,
      deferredAmount: true,
      referrer1Type: true,
      referrer1UserId: true,
      referrer1Amount: true,
      referrer2Type: true,
      referrer2UserId: true,
      referrer2Amount: true,
      referrer3Type: true,
      referrer3UserId: true,
      referrer3Amount: true,
      tutakAmount: true,
    },
  });
  let mispriced = 0;
  let contaminated = 0;
  const chainCache = new Map<string, string[]>();
  for (const intent of confirmed) {
    const stored: Array<{ level: 1 | 2 | 3; type: 'USER'; userId: string }> = [];
    if (intent.referrer1Type === ReferrerType.USER && intent.referrer1UserId)
      stored.push({ level: 1, type: 'USER', userId: intent.referrer1UserId });
    if (intent.referrer2Type === ReferrerType.USER && intent.referrer2UserId)
      stored.push({ level: 2, type: 'USER', userId: intent.referrer2UserId });
    if (intent.referrer3Type === ReferrerType.USER && intent.referrer3UserId)
      stored.push({ level: 3, type: 'USER', userId: intent.referrer3UserId });

    const split = referrals.computePoolSplit(intent.poolAmount!, stored);
    const legs: Array<[Decimal, Decimal | null]> = [
      [split.green, intent.greenAmount],
      [split.deferred, intent.deferredAmount],
      [split.l1, intent.referrer1Amount ?? new Decimal(0)],
      [split.l2, intent.referrer2Amount ?? new Decimal(0)],
      [split.l3, intent.referrer3Amount ?? new Decimal(0)],
      [split.tutak, intent.tutakAmount],
    ];
    if (legs.some(([expected, actual]) => actual === null || !expected.equals(actual))) mispriced += 1;

    // The chain stored on the purchase must be the chain the customer
    // actually has. A referrer from another tree here would be one
    // customer's purchase paying another customer's upline.
    let live = chainCache.get(intent.customerId);
    if (!live) {
      const resolved = await referrals.resolveReferralChain(intent.customerId);
      live = resolved.map((entry) => (entry.type === 'USER' ? entry.userId! : `partner:${entry.partnerId!}`));
      chainCache.set(intent.customerId, live);
    }
    const storedIds = stored.map((entry) => entry.userId);
    if (storedIds.length !== live.length || storedIds.some((id, i) => id !== live![i])) contaminated += 1;
  }
  say(
    `  ${mispriced === 0 ? '✓' : '✗'} all six legs match the program's own split on ${confirmed.length} confirmed purchase(s)${mispriced === 0 ? '' : ` — ${mispriced} mispriced`}`,
  );
  say(
    `  ${contaminated === 0 ? '✓' : '✗'} every purchase paid its own customer's chain${contaminated === 0 ? '' : ` — ${contaminated} contaminated`}`,
  );
  if (mispriced > 0) broken += 1;
  if (contaminated > 0) broken += 1;

  const held = await prisma.bonusReservation.groupBy({ by: ['status'], _count: { _all: true } });
  say(`  holds         ${held.map((h) => `${h.status}=${h._count._all}`).join(' ') || 'none'}`);
  const intentStates = await prisma.purchaseIntent.groupBy({ by: ['status'], _count: { _all: true } });
  say(`  intents       ${intentStates.map((i) => `${i.status}=${i._count._all}`).join(' ')}`);

  await app.close();

  if (!total.isZero() || drift > 0) {
    throw new Error(
      `Ledger broke under load: sum ${total.toFixed(4)}, ${drift} account(s) disagreeing with their postings.`,
    );
  }
  if (broken > 0) {
    throw new Error(`Money-path integrity broke under load: ${broken} invariant(s) violated.`);
  }
  say('  ✓ balanced, and every account agrees with a replay of its postings');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  });