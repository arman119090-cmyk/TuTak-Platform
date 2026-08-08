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
 *   node dist/scripts/load-test.ts             # defaults below
 *   LOAD_CONCURRENCY=64 LOAD_SECONDS=20 node dist/scripts/load-test.js
 *
 * Every run ends by asserting the same invariant the test suite does: all
 * accounts sum to zero, and each account's stored balance equals a replay of
 * its own postings. A throughput number from a run that corrupted the ledger
 * is worse than no number at all.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RoleName } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as argon2 from 'argon2';
import * as os from 'os';
import { AppModule } from '../app.module';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { PaymentEngineService } from '../modules/payments/payment-engine.service';
import { PayoutEngineService } from '../modules/payouts/payout-engine.service';
import { OutboxService } from '../modules/ledger/outbox.service';
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
  say(`  settings      concurrency=${CONCURRENCY} duration=${SECONDS}s customers=${CUSTOMERS}`);
  say();

  // ── Fixtures ───────────────────────────────────────────────────────────
  const run = Date.now().toString(36);
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
        phone: `+37490${String(i).padStart(6, '0')}`.slice(0, 12),
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

  await app.close();

  if (!total.isZero() || drift > 0) {
    throw new Error(
      `Ledger broke under load: sum ${total.toFixed(4)}, ${drift} account(s) disagreeing with their postings.`,
    );
  }
  say('  ✓ balanced, and every account agrees with a replay of its postings');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  });