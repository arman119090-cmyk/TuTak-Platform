import {
  BonusEntryType,
  BonusLotStatus,
  BonusReservationStatus,
  DeferredBonusLotStatus,
  PrismaClient,
  PurchaseIntentStatus,
  RoleName,
  TransactionStatus,
} from '@prisma/client';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { PartnersService } from '../src/modules/partners/partners.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../src/modules/wallet/deferred-bonus-lot.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The core-business spec's standard purchase flow — §7-16, §22-24 — end to
 * end against the real database. Everything below exercises
 * `PurchaseIntentsService` and its collaborators exactly as
 * `PurchaseIntentsController` calls them; only the staff-role restriction
 * test goes through the controller layer, because that check lives there.
 *
 * docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md §3 records why this flow is
 * additive alongside `POST /qr/redeem` rather than a replacement — the
 * FastCharge/EV suites are untouched by this file and keep proving the old
 * path still works.
 */
describe('PurchaseIntents (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let purchaseIntents: PurchaseIntentsService;
  let partners: PartnersService;
  let partnersController: PartnersController;
  let engine: BonusEngineService;
  let deferredLots: DeferredBonusLotService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    purchaseIntents = harness.app.get(PurchaseIntentsService);
    partners = harness.app.get(PartnersService);
    partnersController = harness.app.get(PartnersController);
    engine = harness.app.get(BonusEngineService);
    deferredLots = harness.app.get(DeferredBonusLotService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await truncateAll(prisma);
  });

  const fundedCustomer = async (available: string) => {
    const { user, wallet } = await createCustomer(prisma);
    await engine.accrue({
      walletId: wallet.id,
      type: BonusEntryType.ACCRUAL_PURCHASE,
      amount: available,
      pendingHours: 0,
    });
    return { user, wallet };
  };

  const staffMember = async (partnerId: string, roles: RoleName[] = [RoleName.PARTNER_OWNER]) => {
    const { user } = await createCustomer(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roles[0]! } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, partnerId } });
    return user;
  };

  const asRequestUser = (id: string, roles: RoleName[], partnerId: string): RequestUser =>
    ({
      id,
      phone: '+37400000000',
      roles,
      permissions: [],
      partnerScopes: Object.fromEntries(roles.map((r) => [r, [partnerId]])),
      mustChangePassword: false,
    }) as RequestUser;

  // ── Lifecycle — spec §7 ───────────────────────────────────────────────

  describe('lifecycle', () => {
    it('creates an AWAITING_CONFIRMATION intent with no bonus, and posts nothing to the ledger yet', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );

      expect(intent.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
      expect(intent.ordinaryPaymentRemainder.toFixed(4)).toBe('10000.0000');
      expect(intent.negotiatedRateBps).toBe(500);
      expect(await prisma.ledgerTransaction.count()).toBe(0);
    });

    it('rejects a bonus request above the partner max_bonus_payment_percent', async () => {
      const { user } = await fundedCustomer('5000');
      const partner = await createPartner(prisma);
      await partners.updateCommercialSettings(partner.id, { maxBonusPaymentPercent: 30 });

      await expect(
        purchaseIntents.create(
          { partnerId: partner.id, grossAmount: '10000', bonusAmountRequested: '5000' },
          user.id,
        ),
      ).rejects.toThrow(/at most 30%/);
    });

    it('reserves the requested bonus at creation, before confirmation', async () => {
      const { user, wallet } = await fundedCustomer('2000');
      const partner = await createPartner(prisma);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000', bonusAmountRequested: '1000' },
        user.id,
      );

      expect(intent.bonusReservationId).not.toBeNull();
      const reservation = await prisma.bonusReservation.findUniqueOrThrow({
        where: { id: intent.bonusReservationId! },
      });
      expect(reservation.status).toBe(BonusReservationStatus.ACTIVE);
      expect(reservation.amount.toFixed(4)).toBe('1000.0000');
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).availableBonus.toFixed(4),
      ).toBe('1000.0000'); // 2000 - 1000 held
    });

    it('refuses to create a purchase intent for a partner the customer belongs to', async () => {
      const partner = await createPartner(prisma);
      const owner = await staffMember(partner.id, [RoleName.PARTNER_OWNER]);

      // Same reasoning as QrPaymentsService.redeem's self-dealing check:
      // a partner's own staff must not be able to fabricate a purchase
      // against their own partner and pocket the pool's bonus share.
      await expect(
        purchaseIntents.create({ partnerId: partner.id, grossAmount: '10000' }, owner.id),
      ).rejects.toThrow(/partner you belong to/);
    });

    it('refuses to create a purchase intent against a partner still pending approval', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await prisma.partner.create({
        data: {
          legalName: 'Pending LLC',
          displayName: 'Pending',
          taxId: 'pending-tax-id',
          category: 'retail',
          status: 'PENDING_APPROVAL',
          isActive: false,
        },
      });

      await expect(
        purchaseIntents.create({ partnerId: partner.id, grossAmount: '5000' }, user.id),
      ).rejects.toThrow(/not currently active/);
    });

    it('confirm() settles the reservation, completes the transaction, and pays the pool', async () => {
      const { user, wallet } = await fundedCustomer('2000');
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000', bonusAmountRequested: '1000' },
        user.id,
      );
      const confirmed = await purchaseIntents.confirm(intent.id, staff.id);

      expect(confirmed.status).toBe(PurchaseIntentStatus.CONFIRMED);
      expect(confirmed.confirmedByUserId).toBe(staff.id);

      const reservation = await prisma.bonusReservation.findUniqueOrThrow({
        where: { id: intent.bonusReservationId! },
      });
      expect(reservation.status).toBe(BonusReservationStatus.SETTLED);

      const transaction = await prisma.transaction.findUniqueOrThrow({
        where: { id: intent.sourceTransactionId! },
      });
      expect(transaction.status).toBe(TransactionStatus.COMPLETED);

      // Pool = 10000 * 5% = 500; green (20%) = 100, immediately AVAILABLE.
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      // 2000 funded - 1000 reserved-and-spent + 100 green = 1100.
      expect(walletAfter.availableBonus.toFixed(4)).toBe('1100.0000');
    });

    it('confirm() is idempotent — a second call returns the same state without re-crediting', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );
      await purchaseIntents.confirm(intent.id, staff.id);
      await purchaseIntents.confirm(intent.id, staff.id);

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      // Pool = 500, green = 100. Confirmed exactly once, not twice.
      expect(walletAfter.availableBonus.toFixed(4)).toBe('100.0000');
      expect(walletAfter.lifetimeEarned.toFixed(4)).toBe('100.0000');
    });

    it('confirm() under a concurrent double-call pays the pool exactly once', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );

      await Promise.all([
        purchaseIntents.confirm(intent.id, staff.id),
        purchaseIntents.confirm(intent.id, staff.id),
      ]);

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.lifetimeEarned.toFixed(4)).toBe('100.0000');
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } })).toBe(1);
    });

    it('reject() releases the bonus reservation and fails the transaction', async () => {
      const { user, wallet } = await fundedCustomer('1000');
      const partner = await createPartner(prisma);
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '5000', bonusAmountRequested: '500' },
        user.id,
      );
      const rejected = await purchaseIntents.reject(intent.id, staff.id, {
        reasonCode: 'CUSTOMER_CANCELLED',
      });

      expect(rejected.status).toBe(PurchaseIntentStatus.REJECTED);
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.toFixed(4)).toBe('1000.0000'); // fully released
      const transaction = await prisma.transaction.findUniqueOrThrow({
        where: { id: intent.sourceTransactionId! },
      });
      expect(transaction.status).toBe(TransactionStatus.FAILED);
    });

    it('reject() is idempotent, same as confirm()', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '5000' },
        user.id,
      );
      const first = await purchaseIntents.reject(intent.id, staff.id, { reasonCode: 'OTHER' });
      const second = await purchaseIntents.reject(intent.id, staff.id, { reasonCode: 'OTHER' });

      expect(first.status).toBe(PurchaseIntentStatus.REJECTED);
      expect(second.rejectedAt?.getTime()).toBe(first.rejectedAt?.getTime());
    });

    it('expireStale() releases an unconfirmed intent past its 3-minute window', async () => {
      const { user, wallet } = await fundedCustomer('1000');
      const partner = await createPartner(prisma);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '5000', bonusAmountRequested: '500' },
        user.id,
      );
      // Force it past its window rather than waiting three real minutes.
      await prisma.purchaseIntent.update({
        where: { id: intent.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const count = await purchaseIntents.expireStale();

      expect(count).toBe(1);
      const expired = await purchaseIntents.findByIdOrThrow(intent.id);
      expect(expired.status).toBe(PurchaseIntentStatus.EXPIRED);
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.toFixed(4)).toBe('1000.0000');
    });
  });

  // ── Financial transaction boundary ────────────────────────────────────

  describe('financial transaction boundary', () => {
    /**
     * The core invariant a hardening pass exists to catch: a PurchaseIntent
     * must never read as CONFIRMED — "this purchase succeeded" — while any
     * of the financial effects that status implies (reservation settled,
     * bonus accrued, deferred lot advanced, ledger posted) failed to
     * commit. An earlier version flipped the status in its own statement
     * before running settlement in a separate transaction, and separately
     * posted both ledger entries via `LedgerService.post` with no `tx`
     * argument — which opens its *own* independent transaction rather than
     * joining the caller's. A failure late in settlement (here: the ledger
     * write itself) left the intent stuck CONFIRMED with none of its
     * financial effects applied and no way to retry, since `confirm()`
     * treats a non-`AWAITING_CONFIRMATION` intent as already resolved.
     */
    it('rolls back the CONFIRMED status together with every financial effect if settlement fails partway through', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );

      // Fails the ledger write itself — the last thing settlement does, and
      // the exact call that used to run outside the transaction. If it were
      // still outside, this would prove nothing: the reservation-settle,
      // bonus accrual and deferred lot would already have committed by the
      // time this throws. The assertions below are the actual proof.
      jest.spyOn(ledger, 'post').mockRejectedValueOnce(new Error('ledger unavailable'));

      await expect(purchaseIntents.confirm(intent.id, staff.id)).rejects.toThrow(
        'ledger unavailable',
      );

      const afterFailure = await purchaseIntents.findByIdOrThrow(intent.id);
      expect(afterFailure.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
      expect(afterFailure.confirmedByUserId).toBeNull();
      expect(afterFailure.confirmedAt).toBeNull();

      const transaction = await prisma.transaction.findUniqueOrThrow({
        where: { id: intent.sourceTransactionId! },
      });
      expect(transaction.status).toBe(TransactionStatus.INITIATED);

      expect(await prisma.ledgerTransaction.count()).toBe(0);
      expect(await prisma.deferredBonusLot.count()).toBe(0);

      const walletAfterFailure = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfterFailure.availableBonus.toFixed(4)).toBe('0.0000');
      expect(walletAfterFailure.lifetimeEarned.toFixed(4)).toBe('0.0000');

      // And genuinely retryable — same intent, same staff, no manual
      // compensation needed — because nothing partial was left behind.
      const confirmed = await purchaseIntents.confirm(intent.id, staff.id);
      expect(confirmed.status).toBe(PurchaseIntentStatus.CONFIRMED);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } }),
      ).toBe(1);
      const walletAfterRetry = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfterRetry.availableBonus.toFixed(4)).toBe('100.0000'); // 20% of the 500 pool
    });

    it('rolls back the same way when the reservation/wallet-touching work fails, not just the ledger', async () => {
      const { user, wallet } = await fundedCustomer('1000');
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000', bonusAmountRequested: '500' },
        user.id,
      );

      const transactions = harness.app.get(TransactionsService);
      jest.spyOn(transactions, 'markCompleted').mockRejectedValueOnce(new Error('database went away'));

      await expect(purchaseIntents.confirm(intent.id, staff.id)).rejects.toThrow(
        'database went away',
      );

      const afterFailure = await purchaseIntents.findByIdOrThrow(intent.id);
      expect(afterFailure.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);

      // The bonus reservation taken at creation must still be ACTIVE — not
      // settled, not compensated — exactly as it was before this attempt.
      const reservation = await prisma.bonusReservation.findUniqueOrThrow({
        where: { id: intent.bonusReservationId! },
      });
      expect(reservation.status).toBe(BonusReservationStatus.ACTIVE);
      const walletAfterFailure = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfterFailure.availableBonus.toFixed(4)).toBe('500.0000'); // still held, not released or spent
      expect(walletAfterFailure.reservedBonus.toFixed(4)).toBe('500.0000');
    });
  });

  // ── Concurrency and idempotency ────────────────────────────────────────

  describe('concurrency and idempotency', () => {
    it('lets only one of two concurrently-created intents reserve bonus that together would overdraw the wallet', async () => {
      const { user, wallet } = await fundedCustomer('1000');
      const partnerA = await createPartner(prisma);
      const partnerB = await createPartner(prisma);

      // Each alone is affordable; together they are not. `BonusEngineService
      // .reserve` runs Serializable, so one of the two must lose the race
      // rather than both succeeding against a balance read before either
      // committed.
      const results = await Promise.allSettled([
        purchaseIntents.create(
          { partnerId: partnerA.id, grossAmount: '5000', bonusAmountRequested: '700' },
          user.id,
        ),
        purchaseIntents.create(
          { partnerId: partnerB.id, grossAmount: '5000', bonusAmountRequested: '700' },
          user.id,
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      // Exactly one 700 hold — never both, never neither.
      expect(walletAfter.reservedBonus.toFixed(4)).toBe('700.0000');
      expect(walletAfter.availableBonus.toFixed(4)).toBe('300.0000');
    });

    it('lets a confirm and a reject race on the same intent without double-processing', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );

      const [confirmResult, rejectResult] = await Promise.allSettled([
        purchaseIntents.confirm(intent.id, staff.id),
        purchaseIntents.reject(intent.id, staff.id, { reasonCode: 'OTHER' }),
      ]);

      // Both calls resolve (reject/confirm are idempotent no-ops on a
      // resolved intent, not errors) — what matters is they agree on
      // exactly one final, terminal state, not two contradictory ones.
      const final = await purchaseIntents.findByIdOrThrow(intent.id);
      expect([PurchaseIntentStatus.CONFIRMED, PurchaseIntentStatus.REJECTED]).toContain(final.status);

      if (confirmResult.status === 'fulfilled' && confirmResult.value.status === PurchaseIntentStatus.CONFIRMED) {
        expect(final.status).toBe(PurchaseIntentStatus.CONFIRMED);
      }
      if (rejectResult.status === 'fulfilled' && rejectResult.value.status === PurchaseIntentStatus.REJECTED) {
        // Only reachable if confirm lost the race — the two outcomes are
        // mutually exclusive by construction (both branches read the same
        // final `intent`), so this asserts the same thing from the other side.
        expect(final.status).toBe(PurchaseIntentStatus.REJECTED);
      }

      // Whichever won, the pool was applied at most once.
      const ledgerTransactions = await prisma.ledgerTransaction.count({
        where: { kind: 'partner.contribution' },
      });
      expect(ledgerTransactions).toBeLessThanOrEqual(1);
      expect(ledgerTransactions).toBe(final.status === PurchaseIntentStatus.CONFIRMED ? 1 : 0);
    });

    it('lets an expiry sweep and a confirm race on the same intent without double-processing', async () => {
      const { user, wallet } = await fundedCustomer('1000');
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000', bonusAmountRequested: '500' },
        user.id,
      );
      // Past its window — a confirm arriving this late self-detects expiry
      // and calls the same `expireOne` the sweep does (see `confirm()`'s own
      // pre-check), so this is the actual production race: a customer's
      // last-instant confirm and the periodic sweep both discovering the
      // same overdue intent at once. A confirm that arrived *before* the
      // deadline never overlaps with the sweep at all — `expireStale` only
      // ever selects rows already past `expiresAt` — so that path has
      // nothing to race against here.
      await prisma.purchaseIntent.update({
        where: { id: intent.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const [confirmOutcome] = await Promise.allSettled([
        purchaseIntents.confirm(intent.id, staff.id),
        purchaseIntents.expireStale(),
      ]);
      expect(confirmOutcome.status).toBe('rejected'); // both paths agree: expired

      const final = await purchaseIntents.findByIdOrThrow(intent.id);
      expect(final.status).toBe(PurchaseIntentStatus.EXPIRED);

      // The reservation was released exactly once — not left ACTIVE
      // (leaked) and not double-released by both racing callers.
      const reservation = await prisma.bonusReservation.findUniqueOrThrow({
        where: { id: intent.bonusReservationId! },
      });
      expect(reservation.status).toBe(BonusReservationStatus.RELEASED);
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.toFixed(4)).toBe('1000.0000');
      expect(walletAfter.reservedBonus.toFixed(4)).toBe('0.0000');
    });
  });

  // ── Commercial snapshot — spec §8 ─────────────────────────────────────

  describe('commercial snapshot', () => {
    it('confirm() uses the rate frozen at creation, unaffected by a later partner rate change', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );

      // The partner's rate changes after the intent was created but before
      // it is confirmed — the snapshot must win.
      await prisma.partner.update({ where: { id: partner.id }, data: { bonusAccrualRateBps: 1000 } });

      await purchaseIntents.confirm(intent.id, staff.id);

      // Still computed from the 5% snapshot: pool 500, green 100 — not 1000/200.
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.toFixed(4)).toBe('100.0000');
    });
  });

  // ── Pool base and split — spec §9/§12 ─────────────────────────────────

  describe('pool base and split', () => {
    it('computes the pool from the full gross amount, not the post-bonus remainder', async () => {
      const { user, wallet } = await fundedCustomer('4000');
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      // 10000 gross, 4000 paid with bonus — the pool must still be 10000*5%,
      // not 6000*5%.
      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000', bonusAmountRequested: '4000' },
        user.id,
      );
      await purchaseIntents.confirm(intent.id, staff.id);

      // Pool = 500, green (20%) = 100. 4000 spent + 100 earned = 4100 - 4000 = 100.
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.toFixed(4)).toBe('100.0000');
    });

    it('splits the pool 20% green / 30% deferred / 20% referrer / 30% TuTak', async () => {
      const referrer = await createCustomer(prisma);
      await prisma.referralCode.create({ data: { userId: referrer.user.id, code: 'TT-REFER1' } });
      const { user: referee } = await createCustomer(prisma);
      await prisma.referralInvite.create({
        data: { referrerType: 'USER', referrerUserId: referrer.user.id, refereeUserId: referee.id },
      });

      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 }); // pool = 500
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        referee.id,
      );
      await purchaseIntents.confirm(intent.id, staff.id);

      const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referee.id } });
      expect(refereeWallet.availableBonus.toFixed(4)).toBe('100.0000'); // green, 20% of 500

      const lot = await prisma.deferredBonusLot.findFirstOrThrow({ where: { userId: referee.id } });
      expect(lot.amount.toFixed(4)).toBe('150.0000'); // deferred, 30% of 500
      expect(lot.requiredTurnover.toFixed(4)).toBe('54000.0000');

      const referrerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.user.id } });
      expect(referrerWallet.availableBonus.toFixed(4)).toBe('100.0000'); // referrer, 20% of 500

      const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
      });
      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
      // TuTak's 30% base (150) is the only thing left in revenue — the
      // referrer's cut went to the referrer, not to TuTak.
      expect(revenueAccount.balance.negated().toFixed(4)).toBe('150.0000');
      // Partner owed 10000 (gross of the sale itself is out of scope here —
      // this ledger only carries the pool) less by the 500 contribution.
      expect(partnerAccount.balance.toFixed(4)).toBe('500.0000');
    });

    it('credits the user referrer recurring green bonus on every subsequent purchase, no cap', async () => {
      const referrer = await createCustomer(prisma);
      await prisma.referralCode.create({ data: { userId: referrer.user.id, code: 'TT-REFER2' } });
      const { user: referee } = await createCustomer(prisma);
      await prisma.referralInvite.create({
        data: { referrerType: 'USER', referrerUserId: referrer.user.id, refereeUserId: referee.id },
      });
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      for (let i = 0; i < 3; i += 1) {
        const intent = await purchaseIntents.create(
          { partnerId: partner.id, grossAmount: '10000' },
          referee.id,
        );
        await purchaseIntents.confirm(intent.id, staff.id);
      }

      const referrerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.user.id } });
      // 100 AMD referrer share on each of three purchases — recurring, not one-time.
      expect(referrerWallet.availableBonus.toFixed(4)).toBe('300.0000');
    });

    it('credits a partner referrer only via the settlement ledger, never a wallet bonus', async () => {
      const referrerPartner = await createPartner(prisma, { displayName: 'Referrer Co' });
      await prisma.referralCode.create({ data: { partnerId: referrerPartner.id, code: 'TP-REFER1' } });
      const { user: referee } = await createCustomer(prisma);
      await prisma.referralInvite.create({
        data: {
          referrerType: 'PARTNER',
          referrerPartnerId: referrerPartner.id,
          refereeUserId: referee.id,
        },
      });

      const sellingPartner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(sellingPartner.id);

      const intent = await purchaseIntents.create(
        { partnerId: sellingPartner.id, grossAmount: '10000' },
        referee.id,
      );
      await purchaseIntents.confirm(intent.id, staff.id);

      // No wallet exists at all for a partner — the only place a partner
      // referrer's cut can land is its own PARTNER_PAYABLE ledger account.
      const referrerAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PARTNER_PAYABLE', partnerId: referrerPartner.id },
      });
      expect(referrerAccount.balance.negated().toFixed(4)).toBe('100.0000'); // 20% of 500

      const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referee.id } });
      expect(refereeWallet.availableBonus.toFixed(4)).toBe('100.0000'); // only the green share
    });

    it('routes the referrer share to TuTak revenue when the customer has no referrer', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );
      await purchaseIntents.confirm(intent.id, staff.id);

      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
      // TuTak base (150) + referrer share that has nowhere else to go (100) = 250.
      expect(revenueAccount.balance.negated().toFixed(4)).toBe('250.0000');
    });
  });

  // ── Deferred bonus lots — spec §13-16 ─────────────────────────────────

  describe('deferred bonus lots', () => {
    it('creates a new lot from this purchase’s own deferred share, never counting the purchase toward it', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      // Gross 10000, pool 500, deferred share (30%) = 150 — far under the
      // 54000 threshold, so it must stay locked.
      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );
      await purchaseIntents.confirm(intent.id, staff.id);

      const lot = await prisma.deferredBonusLot.findFirstOrThrow({ where: { userId: user.id } });
      expect(lot.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(lot.progressTurnover.toFixed(4)).toBe('0.0000'); // not 10000 — its own purchase never counts
    });

    it('advances every existing open lot before creating the new one, in that order', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      // First purchase opens lot A (150 AMD deferred, progress 0).
      const first = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );
      await purchaseIntents.confirm(first.id, staff.id);
      const lotA = await prisma.deferredBonusLot.findFirstOrThrow({ where: { userId: user.id } });

      // Second purchase of 44000 gross advances lot A by 44000 (still short
      // of 54000) and opens lot B with its own 30% share.
      const second = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '44000' },
        user.id,
      );
      await purchaseIntents.confirm(second.id, staff.id);

      const lotAAfter = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lotA.id } });
      expect(lotAAfter.progressTurnover.toFixed(4)).toBe('44000.0000');
      expect(lotAAfter.status).toBe(DeferredBonusLotStatus.DEFERRED); // not yet unlocked

      const lots = await prisma.deferredBonusLot.findMany({ where: { userId: user.id } });
      expect(lots).toHaveLength(2);

      // A third purchase of 10000 crosses lot A's 54000 threshold (44000 + 10000)
      // and unlocks it into spendable, available points.
      const third = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );
      await purchaseIntents.confirm(third.id, staff.id);

      const lotAUnlocked = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lotA.id } });
      expect(lotAUnlocked.status).toBe(DeferredBonusLotStatus.AVAILABLE);
      expect(lotAUnlocked.grantedBonusLotId).not.toBeNull();

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const deferredGrant = await prisma.bonusLot.findFirstOrThrow({
        where: { id: lotAUnlocked.grantedBonusLotId! },
      });
      expect(deferredGrant.status).toBe(BonusLotStatus.AVAILABLE);
      expect(deferredGrant.originalAmount.toFixed(4)).toBe('150.0000');
      // The wallet actually holds it as spendable green points now.
      expect(walletAfter.availableBonus.greaterThanOrEqualTo(deferredGrant.originalAmount)).toBe(true);
    });

    it('unlocks in a single purchase when gross alone clears the threshold — no monthly minimum', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      // Open a lot first (150 AMD deferred share, progress 0).
      const opener = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '1000' },
        user.id,
      );
      await purchaseIntents.confirm(opener.id, staff.id);
      const lot = await prisma.deferredBonusLot.findFirstOrThrow({ where: { userId: user.id } });

      // One single purchase of 54000 gross — spec §13 requires cumulative
      // turnover, explicitly not a per-period minimum, so one purchase is
      // enough on its own.
      const big = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '54000' },
        user.id,
      );
      await purchaseIntents.confirm(big.id, staff.id);

      const unlocked = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(unlocked.status).toBe(DeferredBonusLotStatus.AVAILABLE);
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.greaterThanOrEqualTo(lot.amount)).toBe(true);
    });

    it('expireOverdueLots releases entitlement past the deadline without granting the bonus', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );
      await purchaseIntents.confirm(intent.id, staff.id);
      const lot = await prisma.deferredBonusLot.findFirstOrThrow({ where: { userId: user.id } });

      await prisma.deferredBonusLot.update({
        where: { id: lot.id },
        data: { deadline: new Date(Date.now() - 1000) },
      });

      const count = await deferredLots.expireOverdueLots();

      expect(count).toBe(1);
      const expired = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(expired.status).toBe(DeferredBonusLotStatus.EXPIRED);
      expect(expired.grantedBonusLotId).toBeNull();
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.toFixed(4)).toBe('100.0000'); // only the green share, never the deferred one
    });
  });

  // ── Settlement ledger — spec §22-24 ───────────────────────────────────

  describe('settlement ledger', () => {
    it('posts the contribution and the bonus-redemption compensation as two separate, unnetted entries', async () => {
      const { user } = await fundedCustomer('1000');
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000', bonusAmountRequested: '1000' },
        user.id,
      );
      await purchaseIntents.confirm(intent.id, staff.id);

      const transactions = await prisma.ledgerTransaction.findMany({
        where: { sourceType: 'PurchaseIntent', sourceId: intent.id },
      });
      const kinds = transactions.map((t) => t.kind).sort();
      expect(kinds).toEqual(['partner.bonus_redemption_compensation', 'partner.contribution']);

      // Sign convention: PARTNER_PAYABLE is credit-normal (balance stored
      // negated). The 500 contribution reduces what is owed by 500; the 1000
      // bonus-redemption compensation increases it by 1000 — net +500 owed.
      const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
      });
      expect(partnerAccount.balance.negated().toFixed(4)).toBe('500.0000');
    });

    it('never posts a redemption-compensation entry when no bonus was spent', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );
      await purchaseIntents.confirm(intent.id, staff.id);

      const transactions = await prisma.ledgerTransaction.findMany({
        where: { sourceType: 'PurchaseIntent', sourceId: intent.id },
      });
      expect(transactions.map((t) => t.kind)).toEqual(['partner.contribution']);
    });
  });

  // ── Staff-role restriction — spec §11/§25/§33 ─────────────────────────

  describe('staff-role restriction', () => {
    it('lets the partner OWNER change the bonus-payment cap', async () => {
      const partner = await createPartner(prisma);
      const owner = await staffMember(partner.id, [RoleName.PARTNER_OWNER]);

      const updated = await partnersController.updateCommercialSettings(
        asRequestUser(owner.id, [RoleName.PARTNER_OWNER], partner.id),
        partner.id,
        { maxBonusPaymentPercent: 40 },
      );

      expect(updated.maxBonusPaymentPercent).toBe(40);
    });

    it('refuses a CASHIER (STAFF) attempting to change the bonus-payment cap', async () => {
      const partner = await createPartner(prisma);
      const cashier = await staffMember(partner.id, [RoleName.PARTNER_STAFF]);

      await expect(
        partnersController.updateCommercialSettings(
          asRequestUser(cashier.id, [RoleName.PARTNER_STAFF], partner.id),
          partner.id,
          { maxBonusPaymentPercent: 40 },
        ),
      ).rejects.toThrow(/Only the partner owner/);

      // Untouched — the default from createPartner's fixture.
      const unchanged = await partners.findByIdOrThrow(partner.id);
      expect(unchanged.maxBonusPaymentPercent).toBe(100);
    });

    it('refuses a MANAGER attempting to change the bonus-payment cap', async () => {
      const partner = await createPartner(prisma);
      const manager = await staffMember(partner.id, [RoleName.PARTNER_MANAGER]);

      await expect(
        partnersController.updateCommercialSettings(
          asRequestUser(manager.id, [RoleName.PARTNER_MANAGER], partner.id),
          partner.id,
          { maxBonusPaymentPercent: 40 },
        ),
      ).rejects.toThrow(/Only the partner owner/);
    });

    it('refuses a user who owns a different partner from changing this partner’s bonus-payment cap', async () => {
      // The escalation this guards against: `user.roles` is a flat set
      // collapsed across every UserRole row the caller holds, any partner.
      // Someone who is genuine STAFF at partner B and *also* OWNER of an
      // unrelated partner A (e.g. via self-service `POST /partners/apply`,
      // which grants OWNER immediately) must not pass a check that only
      // asks "does this user hold PARTNER_OWNER anywhere" — it has to ask
      // "is this user OWNER of partner B specifically."
      const partnerA = await createPartner(prisma, { displayName: 'Partner A (owned)' });
      const partnerB = await createPartner(prisma, { displayName: 'Partner B (target)' });
      const attacker = await staffMember(partnerB.id, [RoleName.PARTNER_STAFF]);
      const ownerRole = await prisma.role.findUniqueOrThrow({
        where: { name: RoleName.PARTNER_OWNER },
      });
      await prisma.userRole.create({
        data: { userId: attacker.id, roleId: ownerRole.id, partnerId: partnerA.id },
      });

      const requestUser: RequestUser = {
        id: attacker.id,
        phone: '+37400000000',
        roles: [RoleName.PARTNER_STAFF, RoleName.PARTNER_OWNER],
        permissions: [],
        partnerScopes: {
          [RoleName.PARTNER_STAFF]: [partnerB.id],
          [RoleName.PARTNER_OWNER]: [partnerA.id],
        },
        mustChangePassword: false,
      };

      await expect(
        partnersController.updateCommercialSettings(requestUser, partnerB.id, {
          maxBonusPaymentPercent: 40,
        }),
      ).rejects.toThrow(/Only the partner owner/);

      const unchanged = await partners.findByIdOrThrow(partnerB.id);
      expect(unchanged.maxBonusPaymentPercent).toBe(100);
    });

    it('records the individual confirming staff member’s identity on the intent', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const staffA = await staffMember(partner.id, [RoleName.PARTNER_STAFF]);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '1000' },
        user.id,
      );
      const confirmed = await purchaseIntents.confirm(intent.id, staffA.id);

      expect(confirmed.confirmedByUserId).toBe(staffA.id);
    });
  });
});
