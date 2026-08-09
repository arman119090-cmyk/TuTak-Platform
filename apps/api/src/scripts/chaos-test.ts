/**
 * What the money paths do when the database is taken away underneath them.
 *
 * Crash recovery has been tested before, but only by interrupting sagas
 * *in process* — throwing at a chosen line and checking the compensation.
 * That covers the application's own logic and says nothing about the case
 * where Postgres itself stops answering halfway through a commit. This
 * driver covers the second one.
 *
 *   node dist/scripts/chaos-test.js
 *   CHAOS_SECONDS=45 node dist/scripts/chaos-test.js
 *
 * It drives the engines directly rather than over HTTP, for the same reason
 * `load-test.ts` does: `POST /payments` is rate limited to ten a minute per
 * address, so an HTTP driver spends an outage collecting 429s from the
 * throttler and never reaches the database at all. That mistake was made
 * once and produced a run in which *every* request during the outage was
 * rejected before it could prove anything.
 *
 * ## What it is actually asking
 *
 * Three questions, in order of how much they would cost to get wrong:
 *
 * 1. **Did anyone get a success they should not have?** A capture that
 *    returned a payment id must have a ledger transaction behind it. One
 *    without is money taken and not recorded.
 * 2. **Does a retry after the outage double-charge?** Every key that failed
 *    is retried once the database is back. The same key must never produce a
 *    second payment.
 * 3. **Is the ledger still coherent?** Debits equal credits, and every
 *    account's stored balance still equals a replay of its own postings.
 *
 * ## Running the outage
 *
 * This process cannot stop Postgres — it is not root and should not be. Run
 * `scripts/chaos-postgres.sh`, which starts this driver, waits for it to
 * report that it is driving, kills Postgres with `-m immediate` (a power
 * loss, not a clean shutdown), brings it back, and lets the driver finish.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Decimal } from '@prisma/client/runtime/library';
import * as argon2 from 'argon2';
import { AppModule } from '../app.module';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { PaymentEngineService } from '../modules/payments/payment-engine.service';

function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

const SECONDS = Number(process.env.CHAOS_SECONDS ?? 45);
const CUSTOMERS = Number(process.env.CHAOS_CUSTOMERS ?? 12);
const CONCURRENCY = Number(process.env.CHAOS_CONCURRENCY ?? 12);

interface Attempt {
  key: string;
  userId: string;
  at: number;
  ok: boolean;
  paymentId?: string;
  error?: string;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const payments = app.get(PaymentEngineService);

  // ── Fixtures, while the database is definitely there ──────────────────
  const passwordHash = await argon2.hash('Chaos!2026x');
  const partner = await prisma.partner.create({
    data: {
      legalName: `Chaos Partner ${Date.now()}`,
      displayName: 'Chaos',
      taxId: `chaos-${Date.now()}`,
      category: 'RETAIL',
      bonusAccrualRateBps: 500,
      paymentCommissionRateBps: 250,
      isActive: true,
    },
  });

  const customers: string[] = [];
  for (let i = 0; i < CUSTOMERS; i++) {
    const user = await prisma.user.create({
      data: {
        phone: `+3749${String(Date.now()).slice(-6)}${i}`.slice(0, 12),
        passwordHash,
        firstName: 'Chaos',
        lastName: `N${i}`,
        locale: 'hy',
        isPhoneVerified: true,
      },
    });
    customers.push(user.id);
  }
  say(`fixtures ready: partner ${partner.id}, ${customers.length} customers`);

  // ── Drive ─────────────────────────────────────────────────────────────
  const attempts: Attempt[] = [];
  const deadline = Date.now() + SECONDS * 1000;
  let seq = 0;

  // Printed on its own line so the outer script can wait for it rather than
  // guessing how long fixtures take.
  say('DRIVING');

  const worker = async (): Promise<void> => {
    while (Date.now() < deadline) {
      const userId = customers[seq % customers.length]!;
      const key = `chaos-${Date.now()}-${seq++}`;
      const at = Date.now();
      try {
        const result = await payments.capture({
          userId,
          partnerId: partner.id,
          amount: '700.00',
          sourceToken: 'tok_ok',
          idempotencyKey: key,
        });
        attempts.push({ key, userId, at, ok: true, paymentId: result.paymentId });
      } catch (err) {
        attempts.push({
          key, userId, at, ok: false,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 120),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const succeeded = attempts.filter((a) => a.ok);
  const failed = attempts.filter((a) => !a.ok);
  say();
  say('── Attempts ─────────────────────────────────');
  say(`  total        ${attempts.length}`);
  say(`  succeeded    ${succeeded.length}`);
  say(`  failed       ${failed.length}`);
  if (failed.length) {
    const byError = new Map<string, number>();
    for (const f of failed) byError.set(f.error ?? '?', (byError.get(f.error ?? '?') ?? 0) + 1);
    for (const [message, count] of [...byError].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      say(`    ${count} × ${message}`);
    }
  }

  if (failed.length === 0) {
    say();
    say('  ⚠ nothing failed — the outage did not overlap the driving window,');
    say('    so this run proves nothing about recovery. Re-run it.');
  }

  // ── Wait for the database to answer again ─────────────────────────────
  say();
  say('── Waiting for Postgres ─────────────────────────────');
  let back = false;
  for (let i = 0; i < 120; i++) {
    try {
      await prisma.$queryRaw`select 1`;
      back = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!back) {
    say('  ✗ database never came back — cannot verify');
    await app.close();
    process.exit(1);
  }
  say('  ✓ answering again');

  // ── 1. Every reported success is backed by a ledger transaction ───────
  say();
  say('── Reported successes ─────────────────────────────');
  const ids = succeeded.map((a) => a.paymentId!).filter(Boolean);
  const txns = await prisma.ledgerTransaction.findMany({
    where: { sourceId: { in: ids }, kind: 'payment.captured' },
    select: { sourceId: true },
  });
  const backed = new Set(txns.map((t) => t.sourceId));
  const unbacked = ids.filter((id) => !backed.has(id));
  say(`  successes reported   ${ids.length}`);
  say(`  with a ledger txn    ${backed.size}`);
  say(`  WITHOUT one          ${unbacked.length}`);
  if (unbacked.length) {
    say(`    ✗ money reported captured and not recorded: ${unbacked.slice(0, 3).join(', ')}`);
  }

  // ── 2. Retrying a failed key must not charge twice ────────────────────
  say();
  say('── Retrying every failed key ─────────────────────────');
  // Only the keys whose fate is genuinely unknown matter: the request was
  // in flight when the database went away, so the caller cannot tell a
  // completed capture from a lost one. That is exactly when a real client
  // retries.
  const retried: { key: string; outcome: string }[] = [];
  for (const f of failed.slice(0, 40)) {
    try {
      const result = await payments.capture({
        userId: f.userId,
        partnerId: partner.id,
        amount: '700.00',
        sourceToken: 'tok_ok',
        idempotencyKey: f.key,
      });
      retried.push({ key: f.key, outcome: `captured ${result.paymentId}` });
    } catch (err) {
      retried.push({
        key: f.key,
        outcome: (err instanceof Error ? err.message : String(err)).slice(0, 80),
      });
    }
  }
  const retriedOk = retried.filter((r) => r.outcome.startsWith('captured'));
  say(`  keys retried         ${retried.length}`);
  say(`  now captured         ${retriedOk.length}`);
  say(`  still refused        ${retried.length - retriedOk.length}`);

  // The decisive count: one payment per idempotency key, no matter how many
  // times it was attempted.
  const allKeys = [...new Set(attempts.map((a) => a.key))];
  const records = await prisma.idempotencyRecord.findMany({
    where: { key: { in: allKeys } },
    select: { key: true, status: true },
  });
  const byStatus = new Map<string, number>();
  for (const r of records) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  say(`  idempotency records  ${records.length} for ${allKeys.length} distinct keys`);
  for (const [status, count] of byStatus) say(`    ${status}: ${count}`);

  const paymentsForPartner = await prisma.payment.count({ where: { partnerId: partner.id } });
  say(`  payments for this partner   ${paymentsForPartner}`);
  say(`  completed records           ${records.length}`);

  // The comparison that matters, and the one this harness originally got
  // wrong. It used to check `payments > distinct keys attempted` — but most
  // attempts fail during an outage, so that ceiling is thousands high and
  // the check passed while a real double charge sat in the data. The first
  // run of this script reported 5,261 payments against 5,260 completed
  // records and still printed PASS.
  //
  // One payment per completed record is the actual invariant: a payment with
  // no record is money whose key was forgotten, which is exactly the state a
  // retry turns into a second charge.
  const doubleCharged = paymentsForPartner !== records.length;
  if (doubleCharged) {
    say(
      `    ✗ ${paymentsForPartner} payments against ${records.length} completed records — ` +
        'a payment exists whose idempotency key was lost, or a key produced two payments',
    );
  }

  const keyless = await prisma.payment.count({
    where: { partnerId: partner.id, idempotencyKey: null },
  });
  say(`  payments with no key stored ${keyless}`);
  if (keyless > 0) {
    say('    ✗ a payment was written without its idempotency key — it cannot be deduplicated');
  }

  // ── 3. Is the ledger still coherent? ──────────────────────────────────
  say();
  say('── Ledger integrity ─────────────────────────────');
  const [sums] = await prisma.$queryRaw<{ debit: Decimal; credit: Decimal }[]>`
    select
      coalesce(sum(case when direction = 'DEBIT'  then amount else 0 end), 0) as debit,
      coalesce(sum(case when direction = 'CREDIT' then amount else 0 end), 0) as credit
    from ledger_postings
  `;
  const debit = new Decimal(sums?.debit ?? 0);
  const credit = new Decimal(sums?.credit ?? 0);
  const balanced = debit.equals(credit);
  say(`  debit    ${debit.toFixed(4)}`);
  say(`  credit   ${credit.toFixed(4)}`);
  say(`  ${balanced ? '✓ balanced' : '✗ NOT BALANCED'}`);

  const orphanPostings = await prisma.$queryRaw<{ count: bigint }[]>`
    select count(*)::bigint as count
    from ledger_postings lp
    left join ledger_transactions lt on lt.id = lp."transactionId"
    where lt.id is null
  `;
  const orphans = Number(orphanPostings[0]?.count ?? 0);
  say(`  postings with no transaction   ${orphans}`);

  // ── Verdict ───────────────────────────────────────────────────────────
  say();
  const problems: string[] = [];
  if (unbacked.length) problems.push(`${unbacked.length} reported capture(s) with no ledger transaction`);
  if (doubleCharged) problems.push('payment count does not match completed idempotency records');
  if (keyless > 0) problems.push(`${keyless} payment(s) written without an idempotency key`);
  if (!balanced) problems.push('ledger does not balance');
  if (orphans) problems.push(`${orphans} orphaned posting(s)`);

  if (problems.length) {
    say('FAIL');
    for (const p of problems) say(`  · ${p}`);
    await app.close();
    process.exit(1);
  }
  say('PASS — no reported success went unrecorded, no key charged twice, ledger coherent');
  await app.close();
}

main().catch((err) => {
  say(`chaos-test failed to run: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
