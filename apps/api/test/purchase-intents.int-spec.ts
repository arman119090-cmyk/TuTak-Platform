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
import { Decimal } from '@prisma/client/runtime/library';
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

    it('stamps the reservation and the intent with the exact same expiry timestamp — no independent clocks', async () => {
      // Independent audit, GitHub issue #28: `create()` used to compute the
      // reservation's `expiresAt` (inside `bonusEngine.reserve`) and the
      // intent's own `expiresAt` from two separate `Date.now()` reads,
      // straddling the reservation's own DB writes. The reservation was
      // always stamped strictly earlier, leaving a real window where
      // `releaseExpiredReservations` could sweep the reservation while the
      // intent still looked unexpired — a confirm in that window failed with
      // no reservation left to settle. One canonical timestamp closes it.
      const { user } = await fundedCustomer('2000');
      const partner = await createPartner(prisma);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000', bonusAmountRequested: '1000' },
        user.id,
      );

      const reservation = await prisma.bonusReservation.findUniqueOrThrow({
        where: { id: intent.bonusReservationId! },
      });
      expect(reservation.expiresAt.getTime()).toBe(intent.expiresAt.getTime());
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

    /**
     * Independent audit, GitHub issue #28, HEAD `0a9c7d5`: the status claim
     * used to be its own statement, committed before the reservation
     * release and transaction-failure calls ran as later, separate
     * statements. A failure in either of those left the intent permanently
     * `REJECTED` with the customer's bonus still `ACTIVE`ly reserved — and
     * a retry found the intent already terminal and did nothing to repair
     * it. `reject()` now wraps all of it in one transaction.
     */
    it('rolls back the status claim if the reservation release fails mid-transaction', async () => {
      const { user, wallet } = await fundedCustomer('1000');
      const partner = await createPartner(prisma);
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '5000', bonusAmountRequested: '500' },
        user.id,
      );

      const spy = jest
        .spyOn(engine, 'releaseReservation')
        .mockImplementationOnce(() => Promise.reject(new Error('injected failure')));

      await expect(
        purchaseIntents.reject(intent.id, staff.id, { reasonCode: 'CUSTOMER_CANCELLED' }),
      ).rejects.toThrow('injected failure');
      spy.mockRestore();

      // The status claim rolled back together with the failed reservation
      // release — an intent left REJECTED here with its reservation still
      // ACTIVE is exactly the inconsistency this atomicity fix closes.
      const afterFailure = await purchaseIntents.findByIdOrThrow(intent.id);
      expect(afterFailure.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);

      const reservation = await prisma.bonusReservation.findUniqueOrThrow({
        where: { id: intent.bonusReservationId! },
      });
      expect(reservation.status).toBe(BonusReservationStatus.ACTIVE);

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.reservedBonus.toFixed(4)).toBe('500.0000'); // still held, not silently dropped

      // A retry, now that the injected failure is gone, must still succeed
      // cleanly — proving the intent was left genuinely retryable, not
      // merely rolled back into a stuck state.
      const retried = await purchaseIntents.reject(intent.id, staff.id, {
        reasonCode: 'CUSTOMER_CANCELLED',
      });
      expect(retried.status).toBe(PurchaseIntentStatus.REJECTED);
      const walletAfterRetry = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfterRetry.availableBonus.toFixed(4)).toBe('1000.0000');
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

    /**
     * NEXT_CLAUDE_TASK.md requirement 11 / GitHub issue #28: `confirm()`
     * has always self-checked `expiresAt` before settling; `reject()` did
     * not, so a cashier's decline arriving after the 3-minute window but
     * before the sweep had processed the row flipped it straight to
     * REJECTED instead of EXPIRED — the wrong terminal state for a window
     * that had already closed.
     */
    it('reject() past the 3-minute window expires the intent instead of rejecting it', async () => {
      const { user, wallet } = await fundedCustomer('1000');
      const partner = await createPartner(prisma);
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '5000', bonusAmountRequested: '500' },
        user.id,
      );
      // Past its window, but not yet touched by the sweep — the exact race
      // a cashier's late tap actually hits in production.
      await prisma.purchaseIntent.update({
        where: { id: intent.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(
        purchaseIntents.reject(intent.id, staff.id, { reasonCode: 'CUSTOMER_CANCELLED' }),
      ).rejects.toThrow('This purchase intent has expired');

      const final = await purchaseIntents.findByIdOrThrow(intent.id);
      expect(final.status).toBe(PurchaseIntentStatus.EXPIRED);
      expect(final.rejectionReason).toBeNull();

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.toFixed(4)).toBe('1000.0000'); // fully released either way
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

    /** Same atomicity fix as reject()'s — see that test's docblock. */
    it('rolls back the expiry status claim if the reservation release fails mid-transaction', async () => {
      const { user, wallet } = await fundedCustomer('1000');
      const partner = await createPartner(prisma);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '5000', bonusAmountRequested: '500' },
        user.id,
      );
      await prisma.purchaseIntent.update({
        where: { id: intent.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const spy = jest
        .spyOn(engine, 'releaseReservation')
        .mockImplementationOnce(() => Promise.reject(new Error('injected failure')));

      // expireStale's loop does not catch — a thrown error from expireOne
      // propagates straight out, which is itself part of what this test
      // proves: nothing here silently swallows the failure and reports a
      // false success.
      await expect(purchaseIntents.expireStale()).rejects.toThrow('injected failure');
      spy.mockRestore();

      const afterFailure = await purchaseIntents.findByIdOrThrow(intent.id);
      expect(afterFailure.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);

      const reservation = await prisma.bonusReservation.findUniqueOrThrow({
        where: { id: intent.bonusReservationId! },
      });
      expect(reservation.status).toBe(BonusReservationStatus.ACTIVE);

      const walletAfterFailure = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfterFailure.reservedBonus.toFixed(4)).toBe('500.0000');

      // A retry, with the injected failure gone, sweeps it cleanly.
      const count = await purchaseIntents.expireStale();
      expect(count).toBe(1);
      const retried = await purchaseIntents.findByIdOrThrow(intent.id);
      expect(retried.status).toBe(PurchaseIntentStatus.EXPIRED);
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

    /**
     * Builds an N-level upward chain (0-3) ending in `referee` — L1 refers
     * `referee`, L2 refers L1, L3 refers L2 — exactly the shape
     * `ReferralService.resolveReferralChain` walks. Each level gets its own
     * `ReferralCode`/`ReferralInvite` row, same as a real registration would
     * produce. Returns the levels in order (`[0]` is L1, `[2]` is L3) so a
     * test can assert against whichever levels it created.
     */
    const buildChain = async (refereeId: string, levels: number) => {
      const users: { id: string }[] = [];
      let childId = refereeId;
      for (let i = 0; i < levels; i += 1) {
        const { user } = await createCustomer(prisma);
        await prisma.referralCode.create({ data: { userId: user.id, code: `TT-CHAIN-${childId}-${i}` } });
        await prisma.referralInvite.create({
          data: { referrerType: 'USER', referrerUserId: user.id, refereeUserId: childId },
        });
        users.push(user);
        childId = user.id;
      }
      return users;
    };

    it('splits the pool 20% green / 30% deferred / 10%/5%/5% L1/L2/L3 / 30% TuTak with a full 3-level chain', async () => {
      const { user: referee } = await createCustomer(prisma);
      const [l1, l2, l3] = await buildChain(referee.id, 3);

      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 }); // pool = 500
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        referee.id,
      );
      const confirmed = await purchaseIntents.confirm(intent.id, staff.id);

      expect(confirmed.programVersion).toBe('THREE_LEVEL_V2');

      const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referee.id } });
      expect(refereeWallet.availableBonus.toFixed(4)).toBe('100.0000'); // green, 20% of 500

      const lot = await prisma.deferredBonusLot.findFirstOrThrow({ where: { userId: referee.id } });
      expect(lot.amount.toFixed(4)).toBe('150.0000'); // deferred, 30% of 500
      expect(lot.requiredTurnover.toFixed(4)).toBe('54000.0000');

      const l1Wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: l1!.id } });
      expect(l1Wallet.availableBonus.toFixed(4)).toBe('50.0000'); // L1, 10% of 500
      const l2Wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: l2!.id } });
      expect(l2Wallet.availableBonus.toFixed(4)).toBe('25.0000'); // L2, 5% of 500
      const l3Wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: l3!.id } });
      expect(l3Wallet.availableBonus.toFixed(4)).toBe('25.0000'); // L3, 5% of 500

      const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
      });
      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
      // TuTak's 30% (150) — every level had a recipient, so nothing extra
      // folds into it.
      expect(revenueAccount.balance.negated().toFixed(4)).toBe('150.0000');
      expect(partnerAccount.balance.toFixed(4)).toBe('500.0000');

      // Sum invariant: all six legs reconstruct the pool exactly.
      expect(
        refereeWallet.availableBonus
          .plus(lot.amount)
          .plus(l1Wallet.availableBonus)
          .plus(l2Wallet.availableBonus)
          .plus(l3Wallet.availableBonus)
          .plus(revenueAccount.balance.negated())
          .toFixed(4),
      ).toBe('500.0000');
    });

    it.each([0, 1, 2] as const)(
      'chain length %i: the missing levels fold into TuTak, never left unpaid or redistributed',
      async (chainLength) => {
        const { user: referee } = await createCustomer(prisma);
        const chain = await buildChain(referee.id, chainLength);

        const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 }); // pool = 500
        const staff = await staffMember(partner.id);

        const intent = await purchaseIntents.create(
          { partnerId: partner.id, grossAmount: '10000' },
          referee.id,
        );
        await purchaseIntents.confirm(intent.id, staff.id);

        // Every level that exists gets exactly its own bps share.
        const expectedByLevel = [50, 25, 25]; // L1/L2/L3, AMD
        for (let i = 0; i < chainLength; i += 1) {
          const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: chain[i]!.id } });
          expect(wallet.availableBonus.toFixed(4)).toBe(`${expectedByLevel[i]}.0000`);
        }

        const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
        // TuTak's base 30% (150) plus whatever the missing levels would have
        // paid — never left unallocated, never redistributed to the levels
        // that do exist.
        const missingLevelsTotal = expectedByLevel.slice(chainLength).reduce((a, b) => a + b, 0);
        expect(revenueAccount.balance.negated().toFixed(4)).toBe(`${150 + missingLevelsTotal}.0000`);
      },
    );

    it('direct partner-referrer: only L1 is paid (via the partner-payable ledger), L2/L3 go to TuTak', async () => {
      const referrerPartner = await createPartner(prisma, { displayName: 'Referrer Co' });
      await prisma.referralCode.create({ data: { partnerId: referrerPartner.id, code: 'TP-CHAIN1' } });
      const { user: referee } = await createCustomer(prisma);
      await prisma.referralInvite.create({
        data: { referrerType: 'PARTNER', referrerPartnerId: referrerPartner.id, refereeUserId: referee.id },
      });

      const sellingPartner = await createPartner(prisma, { bonusAccrualRateBps: 500 }); // pool = 500
      const staff = await staffMember(sellingPartner.id);

      const intent = await purchaseIntents.create(
        { partnerId: sellingPartner.id, grossAmount: '10000' },
        referee.id,
      );
      await purchaseIntents.confirm(intent.id, staff.id);

      // A partner referrer is not a continuation of the chain — its own L1
      // share lands in its PARTNER_PAYABLE, never a wallet, and L2/L3 simply
      // don't exist (no user chain to walk further).
      const referrerAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PARTNER_PAYABLE', partnerId: referrerPartner.id },
      });
      expect(referrerAccount.balance.negated().toFixed(4)).toBe('50.0000'); // L1, 10% of 500

      const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referee.id } });
      expect(refereeWallet.availableBonus.toFixed(4)).toBe('100.0000'); // only the green share

      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
      // TuTak base 30% (150) + L2/L3's missing shares (25 + 25) = 200.
      expect(revenueAccount.balance.negated().toFixed(4)).toBe('200.0000');
    });

    /**
     * P1 finding, 2026-08-19 hardening brief ("consistent financial
     * economics"): a reconciliation test asserting green + deferred +
     * referrer share + TuTak's own leg sum exactly to the pool, deliberately
     * chosen so no individual leg divides evenly — the exact condition that
     * used to leave a residue `LedgerService.post()` rejected as an
     * unbalanced transaction (see `settlePurchase`'s own docblock). Proves
     * the residual construction (`tutakBase = pool - green - deferred -
     * referrerShare`) by testing the boundary it exists for, not just the
     * happy-path round numbers every other test in this file uses.
     */
    it('reconciles green + deferred + L1 + L2 + L3 + TuTak to the pool exactly, even when no leg divides evenly', async () => {
      const { user: referee } = await createCustomer(prisma);
      const [l1, l2, l3] = await buildChain(referee.id, 3);

      // 350 bps (3.5%, a valid on-grid rate — partners_commission_rate_on_grid
      // requires a multiple of 50 bps) of 9999.9999 is 349.999965, which
      // roundIssued truncates to 349.9999 — a pool that does not divide
      // evenly by 20%/30%/10%/5%/5%/30% at 4 decimal places under any
      // rounding rule, without needing an off-grid commission rate to get
      // there.
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 350 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '9999.9999' },
        referee.id,
      );
      const confirmed = await purchaseIntents.confirm(intent.id, staff.id);

      const pool = new Decimal('349.9999');
      expect(confirmed.poolAmount!.toFixed(4)).toBe(pool.toFixed(4));

      const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referee.id } });
      const green = refereeWallet.availableBonus;
      expect(green.toFixed(4)).toBe('69.9999'); // truncated down from 69.99998, never up

      const lot = await prisma.deferredBonusLot.findFirstOrThrow({ where: { userId: referee.id } });
      const deferred = lot.amount;
      expect(deferred.toFixed(4)).toBe('104.9999'); // truncated down from 104.99997

      const l1Wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: l1!.id } });
      expect(l1Wallet.availableBonus.toFixed(4)).toBe('34.9999'); // truncated down from 34.99999
      const l2Wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: l2!.id } });
      expect(l2Wallet.availableBonus.toFixed(4)).toBe('17.4999'); // truncated down from 17.499995
      const l3Wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: l3!.id } });
      expect(l3Wallet.availableBonus.toFixed(4)).toBe('17.4999');

      const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
      });
      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
      const tutakRevenue = revenueAccount.balance.negated();
      // Not 104.9999 (what independently rounding 30% would give) —
      // 105.0004, the residual that absorbs the other five legs' cumulative
      // truncation loss. This is the number this test exists to pin: an
      // independently-rounded sixth leg is exactly the bug this
      // construction prevents.
      expect(tutakRevenue.toFixed(4)).toBe('105.0004');

      // The reconciliation invariant itself: every leg the pool was split
      // into sums back to the pool, to the last ten-thousandth, with no
      // leg left over and none invented. LedgerService.post() would have
      // thrown rather than let this settle if it did not.
      expect(
        green
          .plus(deferred)
          .plus(l1Wallet.availableBonus)
          .plus(l2Wallet.availableBonus)
          .plus(l3Wallet.availableBonus)
          .plus(tutakRevenue)
          .toFixed(4),
      ).toBe(pool.toFixed(4));
      expect(partnerAccount.balance.toFixed(4)).toBe(pool.toFixed(4));

      for (const account of await prisma.ledgerAccount.findMany()) {
        const replayed = await ledger.replayBalance(account.id);
        expect(account.balance.toFixed(4)).toBe(replayed.toFixed(4));
      }
    });

    it('credits the L1 referrer recurring green bonus on every subsequent purchase, no cap', async () => {
      const { user: referee } = await createCustomer(prisma);
      const [l1] = await buildChain(referee.id, 1);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      for (let i = 0; i < 3; i += 1) {
        const intent = await purchaseIntents.create(
          { partnerId: partner.id, grossAmount: '10000' },
          referee.id,
        );
        await purchaseIntents.confirm(intent.id, staff.id);
      }

      const l1Wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: l1!.id } });
      // 50 AMD L1 share (10% of 500) on each of three purchases — recurring, not one-time.
      expect(l1Wallet.availableBonus.toFixed(4)).toBe('150.0000');
    });

    it('routes every referrer level share to TuTak revenue when the customer has no referrer at all', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );
      await purchaseIntents.confirm(intent.id, staff.id);

      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
      // TuTak base (150) + L1/L2/L3 shares that have nowhere else to go
      // (50 + 25 + 25) = 250.
      expect(revenueAccount.balance.negated().toFixed(4)).toBe('250.0000');
    });

    it('self-referral creates no chain and no extra payout', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.referralCode.create({ data: { userId: user.id, code: 'TT-SELF1' } });
      // createAttribution already refuses to create a self-referral row —
      // this simulates a forged/legacy row bypassing that guard, so
      // resolveReferralChain's own defence in depth is what is under test.
      await prisma.referralInvite.create({
        data: { referrerType: 'USER', referrerUserId: user.id, refereeUserId: user.id },
      });

      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);
      const intent = await purchaseIntents.create({ partnerId: partner.id, grossAmount: '10000' }, user.id);
      await purchaseIntents.confirm(intent.id, staff.id);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      // Only the green share — no self-paid referral leg. 100 (green) + 0
      // referral, never 150 (green + a self-referral share).
      expect(wallet.availableBonus.toFixed(4)).toBe('100.0000');

      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
      // The whole 500 pool that isn't green/deferred (150 + 50 + 25 + 25 = 250) goes to TuTak.
      expect(revenueAccount.balance.negated().toFixed(4)).toBe('250.0000');
    });

    it('a cycle in the referral chain stops the walk safely with no payout around the cycle', async () => {
      // Forge a 2-cycle (A refers B, B refers A) directly — unreachable via
      // createAttribution's normal immutable-attribution flow, but
      // resolveReferralChain must still never credit money around it.
      const { user: userA } = await createCustomer(prisma);
      const { user: userB } = await createCustomer(prisma);
      await prisma.referralInvite.create({
        data: { referrerType: 'USER', referrerUserId: userB.id, refereeUserId: userA.id },
      });
      await prisma.referralInvite.create({
        data: { referrerType: 'USER', referrerUserId: userA.id, refereeUserId: userB.id },
      });

      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await staffMember(partner.id);
      const intent = await purchaseIntents.create({ partnerId: partner.id, grossAmount: '10000' }, userA.id);
      await purchaseIntents.confirm(intent.id, staff.id);

      // L1 (userB) is legitimately paid — that part of the chain is real.
      const l1Wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: userB.id } });
      expect(l1Wallet.availableBonus.toFixed(4)).toBe('50.0000');
      // L2 would be userA again (the cycle) — refused, no payout to self.
      const userAWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA.id } });
      expect(userAWallet.availableBonus.toFixed(4)).toBe('100.0000'); // green only

      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
      // TuTak gets base (150) + the refused L2/L3 shares (25 + 25) = 200.
      expect(revenueAccount.balance.negated().toFixed(4)).toBe('200.0000');
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

    it('sums both contributions when two purchases advance the same open lot concurrently, never losing one', async () => {
      // GitHub issue #28: `advanceExistingLots` used to read
      // `progressTurnover`, compute `old + grossAmount` in application
      // code, and write that absolute value back. The enclosing
      // `settlePurchase` transaction runs at Postgres's default READ
      // COMMITTED, not Serializable, so two purchases confirmed at the
      // same instant — both progressing this same lot — could each read
      // the same starting value and the second commit would silently
      // overwrite the first's contribution instead of stacking on it.
      //
      // Driven directly against `DeferredBonusLotService`, with each
      // transaction's timing explicitly controlled, rather than through
      // two full `purchaseIntents.confirm()` calls: the race window this
      // bug depends on — T2 reading before T1 commits, then T2's write
      // blocking on T1's row lock and finally landing *after* T1 — is real
      // but narrow relative to everything else `settlePurchase` does
      // first (reservation settle, transaction completion, green accrual),
      // so relying on `Promise.all` incidental scheduling to hit it would
      // make this test flaky rather than a reliable proof either way.
      const { user } = await createCustomer(prisma);
      const lot = await prisma.deferredBonusLot.create({
        data: {
          userId: user.id,
          sourceTransactionId: 'seed-tx',
          amount: '150',
          requiredTurnover: '54000',
          progressTurnover: '0',
          deadline: new Date(Date.now() + 90 * 24 * 60 * 60_000),
        },
      });

      let releaseFirst: () => void = () => undefined;
      const heldOpen = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      // T1: advances the lot by 10000, then stays open — holding its row
      // lock on the lot — until explicitly released below.
      const first = prisma.$transaction(async (tx) => {
        await deferredLots.advanceExistingLots(user.id, new Decimal('10000'), 'concurrent-tx-1', tx);
        await heldOpen;
      });

      // Give T1 time to complete its read-and-write and reach `heldOpen`
      // before T2 starts. T2 now reads the lot with T1's write uncommitted
      // and therefore invisible under READ COMMITTED — the exact stale
      // read the bug depends on.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const second = prisma.$transaction(async (tx) => {
        await deferredLots.advanceExistingLots(user.id, new Decimal('15000'), 'concurrent-tx-2', tx);
      });

      // T2's own write now blocks on T1's row lock. Give it time to reach
      // and block there before releasing T1.
      await new Promise((resolve) => setTimeout(resolve, 100));
      releaseFirst();
      await Promise.all([first, second]);

      const lotAfter = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      // Well under the 54000 threshold, so this stays a clean addition
      // check — no unlock-race complexity mixed in. The old buggy code
      // reliably produces 15000 here (T2's write, computed from its stale
      // pre-T1 read, overwrites T1's committed 10000); the fix produces
      // the true sum regardless of which side's write lands last.
      expect(lotAfter.progressTurnover.toFixed(4)).toBe('25000.0000');
      expect(lotAfter.status).toBe(DeferredBonusLotStatus.DEFERRED);
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

    it('recognizes an expired lot\'s value as TuTak revenue, releasing the liability booked for it at purchase time', async () => {
      // Business decision (GitHub Issue #28 audit follow-up, 2026-08-16,
      // hardening-audit §N item 1): an expired lot's value becomes TuTak
      // revenue, not a silent write-off.
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 }); // pool = 500
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );
      await purchaseIntents.confirm(intent.id, staff.id);
      const lot = await prisma.deferredBonusLot.findFirstOrThrow({ where: { userId: user.id } });
      expect(lot.amount.toFixed(4)).toBe('150.0000'); // deferred, 30% of the 500 pool

      await prisma.deferredBonusLot.update({
        where: { id: lot.id },
        data: { deadline: new Date(Date.now() - 1000) },
      });
      await deferredLots.expireOverdueLots();

      // postContributionLedger already credited BONUS_LIABILITY 250 (green
      // 100 + deferred 150, no referrer) and PLATFORM_REVENUE 250 (tutak
      // base 150 + the referrerless share 100) at confirmation. Expiry
      // debits BONUS_LIABILITY 150 (releasing the deferred share, never to
      // be paid out) and credits PLATFORM_REVENUE the same 150.
      const bonusLiabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'BONUS_LIABILITY' },
      });
      expect(bonusLiabilityAccount.balance.toFixed(4)).toBe('-100.0000'); // -250 + 150
      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PLATFORM_REVENUE' },
      });
      expect(revenueAccount.balance.toFixed(4)).toBe('-400.0000'); // -250 + -150

      const ledgerTx = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'deferred_bonus.expired', sourceId: lot.id },
        include: { postings: true },
      });
      expect(ledgerTx.postings).toHaveLength(2);
      const net = ledgerTx.postings.reduce(
        (acc, p) => acc + (p.direction === 'DEBIT' ? 1 : -1) * Number(p.amount),
        0,
      );
      expect(net).toBe(0);
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
