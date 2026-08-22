import type { AccountDeletionService } from '../users/account-deletion.service';
import type { BonusEngineService } from '../wallet/bonus-engine.service';
import type { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';
import type { EvReservationsService } from '../ev-charging/ev-reservations.service';
import type { EvCdrReconciliationService } from '../ev-charging/ev-cdr-reconciliation.service';
import type { EvSessionsService } from '../ev-charging/ev-sessions.service';
import type { OutboxService } from '../ledger/outbox.service';
import type { RefundEngineService } from '../payments/refund-engine.service';
import type { PurchaseIntentsService } from '../purchase-intents/purchase-intents.service';
import type { ReconciliationService } from '../reconciliation/reconciliation.service';
import type { RetentionService } from '../retention/retention.service';

export const SWEEPS_QUEUE = 'sweeps';

/**
 * Same gate, same reasoning, as `app.module.ts`'s own `cardPaymentsEnabled`
 * constant: the canonical TuTak model never takes customer money, so
 * `PaymentsModule` (and everything that only exists because of it, like the
 * PSP-refund reconciliation sweep below) is off by default and only ever
 * loaded when a deployment explicitly turns the legacy card-payment
 * subsystem on. A sweep that unconditionally depended on
 * `RefundEngineService` would force `PaymentsModule` — and its production
 * boot guard requiring a real PSP or `DEMO_MODE=true` — into every
 * deployment regardless of this flag, which is exactly the regression
 * `production-boot.int-spec.ts` exists to catch (caught here: adding the
 * reconciliation sweep first broke that test by doing exactly this).
 */
const cardPaymentsEnabled = process.env.CARD_PAYMENTS_ENABLED === 'true';

/**
 * Injection token for the bundle below.
 *
 * The processor takes the whole bundle rather than one constructor parameter
 * per service. That started as tidiness and became necessary: with a
 * parameter each, adding a sweep changed the processor's arity, which broke
 * every place that constructs it directly — including tests that have nothing
 * to do with the new sweep. Now a new sweep adds a field to one object.
 */
export const SWEEP_DEPENDENCIES = Symbol('SWEEP_DEPENDENCIES');

/** Everything a sweep is allowed to reach. Nothing here touches HTTP. */
export interface SweepDependencies {
  bonus: BonusEngineService;
  reservations: EvReservationsService;
  sessions: EvSessionsService;
  outbox: OutboxService;
  reconciliation: ReconciliationService;
  cdrs: EvCdrReconciliationService;
  accountDeletion: AccountDeletionService;
  retention: RetentionService;
  deferredBonusLots: DeferredBonusLotService;
  purchaseIntents: PurchaseIntentsService;
  /** Only present when `CARD_PAYMENTS_ENABLED=true` — see `cardPaymentsEnabled` above. */
  refunds?: RefundEngineService;
}

export interface SweepDefinition {
  /** Job name and scheduler id. Changing it orphans the old schedule — see the reaper in `SweepsScheduler`. */
  name: string;
  /** Why this job exists, in terms of what breaks without it. */
  why: string;
  /** BullMQ repeat options: `every` in milliseconds, or a cron `pattern`. */
  repeat: { every: number } | { pattern: string; tz?: string };
  /**
   * How long this sweep may go without completing before something is wrong.
   *
   * Not derived from `repeat` automatically: a job that runs every ten
   * seconds and one that runs nightly want very different tolerances, and
   * the nightly one has to survive a slow night without crying wolf. Stated
   * per job so the number is a decision rather than a formula.
   */
  maxSilenceMs: number;
  /**
   * How long the advisory lock is held, or `null` when overlapping runs are
   * not merely safe but wanted.
   *
   * Where a lock is used the TTL is generous relative to how long the sweep
   * actually takes, so a slow run is not mistaken for a dead one and
   * double-claimed — but short enough that a worker killed mid-sweep does not
   * lock everyone else out for long.
   */
  lockTtlMs: number | null;
  run(deps: SweepDependencies): Promise<unknown>;
}

/**
 * Every recurring job in the platform, in one list.
 *
 * These used to be `@Cron` decorators spread across four modules, which meant
 * the only way to answer "what runs unattended, and how often" was to grep for
 * a decorator. They are now rows in a table that the scheduler registers with
 * BullMQ and the processor dispatches on, so adding a job is adding a row and
 * the answer to that question is this file.
 *
 * Two things changed materially in the move, beyond tidiness:
 *
 *  - **One schedule, not one per instance.** In-process cron fires on every
 *    replica; each one then raced for a Redis lock and all but one threw its
 *    tick away. A BullMQ job scheduler is a single row in Redis, upserted by
 *    whichever instance starts, and produces exactly one delayed job per tick
 *    no matter how many instances are running.
 *  - **Failures are visible and retried.** A `@Cron` that threw logged a line
 *    and the tick was gone. A failed job stays in Redis with its stack trace
 *    and its attempt count.
 *
 * The advisory lock is still here for most jobs, and still earns its place:
 * BullMQ gives one job per tick, but nothing stops tick N+1 being delivered
 * while tick N is still running on another worker. The lock is what keeps two
 * sweeps of the same table from overlapping. It is now per-job rather than
 * unconditional, which is what lets the outbox drain scale — see its row.
 */
export const SWEEPS: readonly SweepDefinition[] = [
  {
    name: 'outbox.drain',
    why: 'Settlement only happens because something drains the outbox. Nothing else in the running process calls drain(), so without this the durable-outbox rows are written and never read.',
    repeat: { every: 10_000 },
    // Five minutes against a ten-second cadence: long enough to ride out a
    // deploy or a brief Redis blip, short enough that settlement stalling is
    // noticed while it is still this hour's problem.
    maxSilenceMs: 5 * 60_000,
    // The one sweep with no lock, and the only one where that is an
    // improvement rather than a risk. `drain` claims its batch with
    // `FOR UPDATE SKIP LOCKED` under a lease, so a second drainer picks up
    // different events rather than fighting for the same ones — which is
    // exactly what a backlog needs. Under a lock, settlement was capped at
    // one drainer platform-wide, and the load test measured it falling behind
    // capture roughly 3:1 (docs/LOAD_TEST.md). Overlap here is bounded by the
    // worker's concurrency.
    lockTtlMs: null,
    run: ({ outbox }) => outbox.drain(),
  },
  {
    name: 'bonus.promote-pending',
    why: 'Points accrue as PENDING and become spendable only when promoted. Without this a customer never gets the points they earned.',
    repeat: { every: 5 * 60_000 },
    maxSilenceMs: 30 * 60_000,
    lockTtlMs: 4 * 60_000,
    run: ({ bonus }) => bonus.promotePendingLots(),
  },
  {
    name: 'bonus.expire-lots',
    why: 'Expiry is a liability the platform has promised to retire. Unswept, BONUS_LIABILITY grows forever and the balance a customer sees is wrong.',
    repeat: { every: 60 * 60_000 },
    maxSilenceMs: 4 * 60 * 60_000,
    lockTtlMs: 4 * 60_000,
    run: ({ bonus }) => bonus.expireLots(),
  },
  {
    name: 'bonus.release-expired-reservations',
    why: 'A hold is taken before a payment completes. If the process dies in between, the points sit in `reserved` indefinitely — invisible to the customer and unrecoverable without a manual database edit. This is what makes reserve/settle crash-safe.',
    repeat: { every: 5 * 60_000 },
    maxSilenceMs: 30 * 60_000,
    lockTtlMs: 4 * 60_000,
    run: ({ bonus }) => bonus.releaseExpiredReservations(),
  },
  {
    name: 'ev.expire-stale-reservations',
    why: 'A reservation holds a connector nobody can use. Unswept, the bay is lost to the network until someone notices.',
    repeat: { every: 60_000 },
    maxSilenceMs: 15 * 60_000,
    lockTtlMs: 4 * 60_000,
    run: ({ reservations }) => reservations.expireStaleReservations(),
  },
  {
    name: 'ev.expire-stale-sessions',
    why: 'Frees bays held by sessions nobody ever stopped. Without it a connector stays CHARGING indefinitely.',
    repeat: { every: 60 * 60_000 },
    maxSilenceMs: 4 * 60 * 60_000,
    lockTtlMs: 4 * 60_000,
    run: ({ sessions }) => sessions.expireStaleSessions(),
  },
  {
    name: 'ev.reconcile-roaming-cdrs',
    why: "Settles a roaming session against the charge-point operator who actually delivered it. Without this the platform bills a partner network's energy on a client-reported reading that nothing external corroborates, and an overcharge is never returned.",
    // Every five minutes. A CPO settles a CDR minutes to hours after the plug
    // comes out, so this is a poll rather than a deadline — frequent enough
    // that a customer owed money gets it back the same day.
    repeat: { every: 5 * 60_000 },
    maxSilenceMs: 30 * 60_000,
    lockTtlMs: 4 * 60_000,
    run: ({ cdrs }) => cdrs.reconcilePending(),
  },
  {
    name: 'account.anonymize-deleted',
    why: "Scrubs the personal data of customers who deleted their account once the grace window has passed. Without it the platform keeps every phone number and name it promised to erase, and the deletion the app store required is a promise the backend never keeps.",
    // Hourly. The window is measured in days, so the schedule only has to be
    // fine enough that "we delete after thirty days" is true to the hour.
    repeat: { every: 60 * 60_000 },
    maxSilenceMs: 4 * 60 * 60_000,
    lockTtlMs: 10 * 60_000,
    run: ({ accountDeletion }) => accountDeletion.anonymizeDue(),
  },
  {
    name: 'retention.prune',
    why: 'Deletes non-financial records past their retention period — read notifications, spent verification codes, consumed idempotency keys. Nothing breaks without it; the platform simply keeps personal data forever, which is a growing disk and a shrinking legal position.',
    // Daily at 04:00 Yerevan, an hour after reconciliation so the two heavy
    // table scans do not overlap.
    repeat: { pattern: '0 4 * * *', tz: 'Asia/Yerevan' },
    maxSilenceMs: 26 * 60 * 60_000,
    lockTtlMs: 15 * 60_000,
    run: ({ retention }) => retention.prune(),
  },
  {
    name: 'deferred-bonus.expire-lots',
    why: "Spec §16: a deferred lot whose deadline passes before it reaches its turnover threshold releases the customer's entitlement to it. Unswept, an overdue lot just sits DEFERRED forever and the product state never catches up with the deadline that already passed.",
    repeat: { every: 60 * 60_000 },
    maxSilenceMs: 4 * 60 * 60_000,
    lockTtlMs: 4 * 60_000,
    run: ({ deferredBonusLots }) => deferredBonusLots.expireOverdueLots(),
  },
  {
    name: 'purchase-intent.expire',
    why: 'Spec §7: a PurchaseIntent awaiting staff confirmation holds a bonus reservation. If nobody confirms or rejects it within the timeout, the hold must release back to AVAILABLE on its own — otherwise a customer who walked away from the till keeps their points stuck for good.',
    repeat: { every: 30_000 },
    // Short tolerance: the whole point of the 3-minute timeout is that a
    // customer at a till is not left waiting past it, so this sweep falling
    // silent for more than a few minutes is worth paging on.
    maxSilenceMs: 5 * 60_000,
    lockTtlMs: 60_000,
    run: ({ purchaseIntents }) => purchaseIntents.expireStale(),
  },
  // Only registered when the legacy card-payment subsystem is actually on —
  // see `cardPaymentsEnabled` above. `refunds` in `SweepDependencies` is
  // `undefined` whenever this branch is not taken, and nothing else in the
  // array ever reads it, so that stays sound.
  ...(cardPaymentsEnabled
    ? [
        {
          name: 'payments.reconcile-pending-refunds',
          why: "P0 finding, 2026-08-19 hardening pass: a refund the PSP never confirmed synchronously (a timeout, a crash, an acquirer that answers 'processing') stays PENDING — no ledger posting, no bonus clawback, nothing that implies money moved — until something asks the acquirer again. Without this sweep a genuinely-confirmed refund could sit unreconciled indefinitely, and the customer's clawback and the ledger's reversal would never happen even though the money already moved.",
          // Every two minutes: a refund is a customer-facing action an
          // operator is often watching, so ambiguity should clear in
          // minutes, not hours.
          repeat: { every: 2 * 60_000 },
          maxSilenceMs: 30 * 60_000,
          lockTtlMs: 4 * 60_000,
          run: ({ refunds }: SweepDependencies) => refunds!.reconcilePendingRefunds(),
        } satisfies SweepDefinition,
      ]
    : []),
  {
    name: 'reconciliation.nightly',
    why: 'Replays every account against its own postings. Catches the ledger disagreeing with itself, which is a bug in this codebase rather than a dispute with a third party — and the only unattended check that can find it.',
    // 03:00 Yerevan rather than UTC: the quiet hour that matters is the local
    // one, and Armenia does not observe daylight saving, so this does not
    // drift twice a year.
    repeat: { pattern: '0 3 * * *', tz: 'Asia/Yerevan' },
    // 26 hours: one missed night is a problem, but the tolerance has to clear
    // a full day plus a slow run without alerting on a healthy platform.
    maxSilenceMs: 26 * 60 * 60_000,
    lockTtlMs: 15 * 60_000,
    run: ({ reconciliation }) => {
      // Yesterday, in the same timezone the schedule is expressed in, so the
      // period covers a whole local day rather than a 3am-to-3am slice.
      const now = new Date();
      const yerevan = new Date(now.getTime() + 4 * 60 * 60_000);
      yerevan.setUTCDate(yerevan.getUTCDate() - 1);
      const periodStart = new Date(
        Date.UTC(yerevan.getUTCFullYear(), yerevan.getUTCMonth(), yerevan.getUTCDate()) -
          4 * 60 * 60_000,
      );
      return reconciliation.reconcile({ periodStart });
    },
  },
];

export function findSweep(name: string): SweepDefinition | undefined {
  return SWEEPS.find((sweep) => sweep.name === name);
}
