import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import {
  AuditAction,
  DeferredBonusLotStatus,
  PartnerStatus,
  PermissionName,
  PostingDirection,
  PrismaClient,
  PurchaseIntentStatus,
  ReferralChallengeParticipantStatus,
  RoleName,
  TransactionStatus,
} from '@prisma/client';
import type { AppConfig } from '../src/config/configuration';
import { AnalyticsController } from '../src/modules/analytics/analytics.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { OutboxService } from '../src/modules/ledger/outbox.service';
import {
  PartnerBranchQrController,
  PartnerBranchQrResolveController,
} from '../src/modules/partners/partner-branch-qr.controller';
import { PartnerBranchStaffController } from '../src/modules/partners/partner-branch-staff.controller';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { PurchaseIntentsController } from '../src/modules/purchase-intents/purchase-intents.controller';
import { ReferralService } from '../src/modules/referral/referral.service';
import { TransactionsController } from '../src/modules/transactions/transactions.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { SMS_PROVIDER, SmsProvider } from '../src/infrastructure/sms/sms-provider.interface';
import { ROLE_PERMISSIONS } from '../src/scripts/role-permissions';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * One restaurant, from an application nobody has looked at to a refunded
 * purchase that four separate places agree about.
 *
 * Every other suite in this directory proves one property in isolation. This
 * one exists because the thing being shipped is not a property, it is a
 * sequence: a real business is connected, a real customer walks in, money
 * moves, some of it moves back, and the customer's app, the restaurant's
 * panel, the administrator's console and the ledger must all be describing
 * the same event afterwards. Each link is tested elsewhere; that the links
 * join up is tested here and nowhere else.
 *
 * Deliberately through controllers rather than services. A controller is
 * where the authorization decision lives — `assertPartnerApprover`,
 * `assertResourceBranchScope`, `assertPlatformAdmin` — and a journey that
 * called services directly would prove the arithmetic while skipping every
 * check a real request passes through. The registrations are real OTP
 * registrations for the same reason: the referral chain this journey pays
 * out to is built by the registration flow, not by writing invite rows.
 *
 * `outbox.drain()` stands in for the sweep the harness does not run — see
 * `harness.ts`.
 */
describe('A restaurant, end to end (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let auth: AuthService;
  let referral: ReferralService;
  let partners: PartnersController;
  let branchQr: PartnerBranchQrController;
  let branchQrResolve: PartnerBranchQrResolveController;
  let branchStaff: PartnerBranchStaffController;
  let intents: PurchaseIntentsController;
  let transactions: TransactionsController;
  let analytics: AnalyticsController;
  let outbox: OutboxService;
  let sms: SmsProvider;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    auth = harness.app.get(AuthService);
    referral = harness.app.get(ReferralService);
    partners = harness.app.get(PartnersController);
    branchQr = harness.app.get(PartnerBranchQrController);
    branchQrResolve = harness.app.get(PartnerBranchQrResolveController);
    branchStaff = harness.app.get(PartnerBranchStaffController);
    intents = harness.app.get(PurchaseIntentsController);
    transactions = harness.app.get(TransactionsController);
    analytics = harness.app.get(AnalyticsController);
    outbox = harness.app.get(OutboxService);
    sms = harness.app.get<SmsProvider>(SMS_PROVIDER);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  // ── People, the way the app makes them ───────────────────────────────

  const randomPhone = () => `+3746${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;

  /** The code as the handset receives it — only its hash is ever stored. */
  const captureCode = (): (() => string) => {
    const spy = jest.spyOn(sms, 'send');
    return () => {
      const body = spy.mock.calls.at(-1)?.[0]?.body ?? '';
      const match = body.match(/(\d{6})/);
      if (!match?.[1]) throw new Error('no code found in SMS body');
      return match[1];
    };
  };

  const asCustomer = (id: string, phone: string): RequestUser =>
    ({
      id,
      phone,
      roles: [RoleName.CUSTOMER],
      permissions: [],
      partnerScopes: {},
      mustChangePassword: false,
    }) as RequestUser;

  /** Registration exactly as the app performs it, carrying an inviter's code. */
  const register = async (referralCode?: string) => {
    const phone = randomPhone();
    const lastCode = captureCode();
    await auth.requestRegistrationOtp({ phone });
    const { user } = await auth.verifyRegistrationOtp(
      {
        phone,
        code: lastCode(),
        password: 'chosen-by-the-customer-1',
        deviceId: `device-${phone}`,
        ...(referralCode ? { referralCode } : {}),
      },
      {},
    );
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    return { id: user.id, phone, wallet, request: asCustomer(user.id, phone) };
  };

  const platformAdmin = async (): Promise<RequestUser> => {
    const person = await register();
    return {
      id: person.id,
      phone: person.phone,
      roles: [RoleName.ADMIN],
      permissions: ROLE_PERMISSIONS[RoleName.ADMIN],
      partnerScopes: {},
      mustChangePassword: false,
    } as RequestUser;
  };

  const asOwner = (userId: string, phone: string, partnerId: string): RequestUser =>
    ({
      id: userId,
      phone,
      roles: [RoleName.PARTNER_OWNER],
      permissions: ROLE_PERMISSIONS[RoleName.PARTNER_OWNER],
      partnerScopes: { [RoleName.PARTNER_OWNER]: [partnerId] },
      mustChangePassword: false,
    }) as RequestUser;

  const asCashier = (
    userId: string,
    phone: string,
    partnerId: string,
    branchIds: string[],
  ): RequestUser =>
    ({
      id: userId,
      phone,
      roles: [RoleName.PARTNER_STAFF],
      permissions: ROLE_PERMISSIONS[RoleName.PARTNER_STAFF],
      partnerScopes: { [RoleName.PARTNER_STAFF]: [partnerId] },
      branchIds,
      mustChangePassword: false,
    }) as RequestUser;

  // ── The money, read back from where it landed ────────────────────────

  const available = async (walletId: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).availableBonus;

  const pending = async (walletId: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).pendingBonus;

  /**
   * Double entry, asserted over every ledger transaction this journey wrote.
   * `LedgerService.post` refuses an unbalanced transaction, so this is not
   * testing that method — it is testing that nothing in the sequence found a
   * way around it.
   */
  const assertEveryLedgerTransactionBalances = async () => {
    const ledgerTransactions = await prisma.ledgerTransaction.findMany({
      include: { postings: true },
    });
    expect(ledgerTransactions.length).toBeGreaterThan(0);
    for (const t of ledgerTransactions) {
      const sum = (direction: PostingDirection) =>
        t.postings
          .filter((p) => p.direction === direction)
          .reduce((acc, p) => acc.plus(p.amount), new Decimal(0));
      expect(sum(PostingDirection.DEBIT).toString()).toBe(sum(PostingDirection.CREDIT).toString());
    }
  };

  // ── The journey ──────────────────────────────────────────────────────

  it('carries one purchase and its refund through all four places consistently', async () => {
    // 1-5. Four customers in a chain: A invited B, B invited C, C invited D.
    const a = await register();
    const b = await register((await referral.getMyCode(a.id)).code);
    const c = await register((await referral.getMyCode(b.id)).code);
    const d = await register((await referral.getMyCode(c.id)).code);

    // 6-7. The restaurateur is an ordinary customer until they apply.
    const restaurateur = await register();
    const application = await partners.apply(restaurateur.request, {
      legalName: 'Dolmama LLC',
      displayName: 'Dolmama',
      category: 'restaurant',
      bonusAccrualRateBps: 1000, // 10%
    });
    expect(application.status).toBe(PartnerStatus.PENDING_APPROVAL);

    // A pending restaurant is not open for business, and the customer app is
    // told so rather than left to infer it.
    expect(await partners.get(d.request, application.id)).toMatchObject({
      status: PartnerStatus.PENDING_APPROVAL,
      isActive: false,
    });
    await expect(
      intents.create(d.request, { partnerId: application.id, grossAmount: '10000' }),
    ).rejects.toThrow(/not currently active/i);

    // 8. The administrator approves it.
    const admin = await platformAdmin();
    const approved = await partners.approvePartner(admin, application.id);
    expect(approved.status).toBe(PartnerStatus.ACTIVE);

    const owner = asOwner(restaurateur.id, restaurateur.phone, approved.id);

    // 9. The owner adds the location customers can walk into.
    const branch = await partners.createBranch(owner, approved.id, {
      name: 'Northern Avenue',
      address: 'Northern Avenue 5',
      city: 'Yerevan',
      latitude: 40.181,
      longitude: 44.514,
    });

    // 10. And puts a cashier on it.
    const cashierPerson = await register();
    const staffRole = await prisma.role.findUniqueOrThrow({
      where: { name: RoleName.PARTNER_STAFF },
    });
    await prisma.userRole.create({
      data: { userId: cashierPerson.id, roleId: staffRole.id, partnerId: approved.id },
    });
    const assignment = await branchStaff.assign(owner, approved.id, branch.id, {
      userId: cashierPerson.id,
      role: 'STAFF' as never,
      employeeDisplayCode: 'B-001',
    });
    expect(assignment.isActive).toBe(true);
    const cashier = asCashier(cashierPerson.id, cashierPerson.phone, approved.id, [branch.id]);

    // 11. The branch gets its own scan-to-pay code.
    const qr = await branchQr.issue(owner, approved.id, branch.id);
    expect(typeof qr.token).toBe('string');

    // 12. D scans it. The token is opaque; the server says what it is.
    const resolved = await branchQrResolve.resolve(qr.token);
    expect(resolved).toMatchObject({ partnerId: approved.id, partnerBranchId: branch.id });

    // 13. The purchase the scan opens — 20,000 AMD of dinner.
    const intent = await intents.create(d.request, {
      partnerId: resolved.partnerId,
      partnerBranchId: resolved.partnerBranchId,
      grossAmount: '20000',
    });
    expect(intent.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
    expect(intent.partnerBranchId).toBe(branch.id);

    // The customer cannot wave their own purchase through.
    await expect(intents.confirm(d.request, intent.id)).rejects.toMatchObject({ status: 403 });

    // 14. The cashier confirms it.
    const confirmed = await intents.confirm(cashier, intent.id);
    expect(confirmed.status).toBe(PurchaseIntentStatus.CONFIRMED);
    await outbox.drain();

    // The pool is 10% of 20,000 = 2,000, split by the referral engine. The
    // split itself belongs to `computePoolSplit` and is tested there; what
    // this journey asserts is that the six legs were actually written and
    // that they add up to the pool, on the row the confirm produced.
    const settled = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(settled.poolAmount!.toString()).toBe('2000');
    const legs = [
      settled.greenAmount!,
      settled.deferredAmount!,
      settled.referrer1Amount!,
      settled.referrer2Amount!,
      settled.referrer3Amount!,
      settled.tutakAmount!,
    ];
    expect(legs.reduce((acc, x) => acc.plus(x), new Decimal(0)).toString()).toBe(
      settled.poolAmount!.toString(),
    );

    // 15. D earned cashback in two parts: the green share is spendable now,
    //     the deferred share is a `DeferredBonusLot` that only vests once D
    //     has spent enough to unlock it. It is deliberately *not* in the
    //     wallet's pending balance — until it vests, D has an entitlement,
    //     not points — so the lot is where it has to be read from.
    const deferredLot = await prisma.deferredBonusLot.findFirstOrThrow({
      where: { userId: d.id, sourceTransactionId: settled.sourceTransactionId! },
    });
    expect(deferredLot.amount.toString()).toBe(settled.deferredAmount!.toString());
    expect(deferredLot.status).toBe(DeferredBonusLotStatus.DEFERRED);

    // 16-18. And each inviter was paid at their own level: C is D's L1, B is
    // L2, A is L3. Asserted against the snapshot the confirm wrote, so this
    // keeps testing the wiring rather than a number that was true in 2026.
    expect(settled.referrer1UserId).toBe(c.id);
    expect(settled.referrer2UserId).toBe(b.id);
    expect(settled.referrer3UserId).toBe(a.id);
    expect((await available(b.wallet.id)).toString()).toBe(settled.referrer2Amount!.toString());
    expect((await available(a.wallet.id)).toString()).toBe(settled.referrer3Amount!.toString());

    // 18b. A 20,000 AMD dinner also carries D past the Referral Challenge
    //      threshold, which pays both sides of that one invite. Stated
    //      rather than absorbed into a total: it is the difference between
    //      D's and C's balances and everybody else's, and a journey that
    //      quietly summed it would not notice if it stopped being paid, or
    //      started being paid twice.
    const challengeReward = new Decimal(
      harness.app
        .get<ConfigService<AppConfig, true>>(ConfigService)
        .get('purchasePolicy.challengeRewardAmount', { infer: true }),
    );
    const participant = await prisma.referralChallengeParticipant.findFirstOrThrow({
      where: { refereeUserId: d.id },
    });
    expect(participant.status).toBe(ReferralChallengeParticipantStatus.REWARDED);
    expect(participant.referrerUserId).toBe(c.id);

    expect((await available(d.wallet.id)).toString()).toBe(
      settled.greenAmount!.plus(challengeReward).toString(),
    );
    expect((await available(c.wallet.id)).toString()).toBe(
      settled.referrer1Amount!.plus(challengeReward).toString(),
    );

    // ── The same event, in four places ─────────────────────────────────

    // (1) The customer's own history.
    const dHistory = await transactions.myHistory(d.request, {} as never);
    expect(dHistory.items.map((t: { id: string }) => t.id)).toContain(settled.sourceTransactionId);

    // (2) The restaurant's panel — the branch cashier's queue, and the
    //     owner's revenue figure for the same day.
    const queue = await intents.list(cashier, approved.id, PurchaseIntentStatus.CONFIRMED);
    expect(queue.map((i) => i.id)).toEqual([intent.id]);
    const panel = await analytics.partner(owner, approved.id, {} as never);
    expect(new Decimal(panel.totalRevenue).toString()).toBe('20000');
    expect(new Decimal(panel.netRevenue).toString()).toBe('20000');
    expect(new Decimal(panel.totalRefunded).toString()).toBe('0');

    // (3) The administrator's console sees it as the same transaction.
    const adminView = await prisma.transaction.findUniqueOrThrow({
      where: { id: settled.sourceTransactionId! },
    });
    expect(adminView).toMatchObject({
      partnerId: approved.id,
      partnerBranchId: branch.id,
      status: TransactionStatus.COMPLETED,
    });
    expect(adminView.amount.toString()).toBe('20000');

    // (4) The ledger. Every transaction it wrote balances, and each of the
    //     four wallets is still reconstructible from its own entries.
    await assertEveryLedgerTransactionBalances();
    for (const w of [a.wallet, b.wallet, c.wallet, d.wallet]) {
      await assertWalletIntegrity(prisma, w.id);
    }

    // ── The refund ─────────────────────────────────────────────────────

    // 21. Half the dinner comes back. Only an owner or manager may do this
    //     directly — the cashier who took the money may not undo it.
    await expect(
      intents.refund(cashier, intent.id, {
        amount: '10000',
        reason: 'One course was sent back',
        idempotencyKey: 'refund-attempt-by-cashier',
      }),
    ).rejects.toMatchObject({ status: 403 });

    await intents.refund(owner, intent.id, {
      amount: '10000',
      reason: 'One course was sent back',
      idempotencyKey: 'restaurant-partial-refund-1',
    });
    await outbox.drain();

    // 22. Half the loyalty went back with it — the customer's cashback and
    //     all three referral shares, in proportion.
    const afterPartial = await prisma.purchaseIntent.findUniqueOrThrow({
      where: { id: intent.id },
    });
    expect(afterPartial.refundedAmount.toString()).toBe('10000');
    expect((await available(b.wallet.id)).toString()).toBe(
      settled.referrer2Amount!.dividedBy(2).toString(),
    );
    expect((await available(a.wallet.id)).toString()).toBe(
      settled.referrer3Amount!.dividedBy(2).toString(),
    );

    // The Challenge reward is not proportional and must not be treated as
    // if it were: 20,000 less 10,000 is still exactly the 10,000 threshold,
    // so the qualification stands and both sides keep the whole 1,000. Half
    // a reward for a friend who did, in fact, spend enough would be a
    // clawback of something that was correctly earned.
    expect(
      (
        await prisma.referralChallengeParticipant.findFirstOrThrow({
          where: { refereeUserId: d.id },
        })
      ).status,
    ).toBe(ReferralChallengeParticipantStatus.REWARDED);
    expect((await available(d.wallet.id)).toString()).toBe(
      settled.greenAmount!.dividedBy(2).plus(challengeReward).toString(),
    );
    expect((await available(c.wallet.id)).toString()).toBe(
      settled.referrer1Amount!.dividedBy(2).plus(challengeReward).toString(),
    );

    // Replaying the same request moves nothing a second time.
    await intents.refund(owner, intent.id, {
      amount: '10000',
      reason: 'One course was sent back',
      idempotencyKey: 'restaurant-partial-refund-1',
    });
    expect(
      (
        await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })
      ).refundedAmount.toString(),
    ).toBe('10000');

    // 23. The rest of the dinner comes back too.
    await intents.refund(owner, intent.id, {
      reason: 'The whole table was comped',
      idempotencyKey: 'restaurant-final-refund-1',
    });
    await outbox.drain();

    // 24. Nobody is left holding anything from a meal that was fully undone —
    //     the Challenge reward included, because the turnover that qualified
    //     it is gone and a reward that survived its own cause is money paid
    //     out of a purchase that did not happen.
    const afterFull = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(afterFull.refundedAmount.toString()).toBe('20000');
    expect(
      (
        await prisma.referralChallengeParticipant.findFirstOrThrow({
          where: { refereeUserId: d.id },
        })
      ).status,
    ).not.toBe(ReferralChallengeParticipantStatus.REWARDED);
    for (const w of [a.wallet, b.wallet, c.wallet, d.wallet]) {
      expect((await available(w.id)).toString()).toBe('0');
      expect((await pending(w.id)).toString()).toBe('0');
    }

    // A refund beyond what was bought is refused rather than netted off.
    await expect(
      intents.refund(owner, intent.id, {
        amount: '1000',
        reason: 'A third helping of refund',
        idempotencyKey: 'restaurant-over-refund-1',
      }),
    ).rejects.toThrow();

    // 25. The ledger still balances, and still explains every wallet.
    await assertEveryLedgerTransactionBalances();
    for (const w of [a.wallet, b.wallet, c.wallet, d.wallet]) {
      await assertWalletIntegrity(prisma, w.id);
    }

    // 26. The restaurant's own dashboard followed the money back.
    //
    //     `totalRevenue` deliberately does not move: it is gross, and the
    //     dinner really was rung up. What used to be missing is everything
    //     beside it — the panel reported 20,000 for a meal that had been
    //     entirely refunded and said nothing about refunds at all, so there
    //     was no figure a reader could subtract and no sign one was absent.
    const panelAfter = await analytics.partner(owner, approved.id, {} as never);
    expect(new Decimal(panelAfter.totalRevenue).toString()).toBe('20000');
    expect(new Decimal(panelAfter.totalRefunded).toString()).toBe('20000');
    expect(new Decimal(panelAfter.netRevenue).toString()).toBe('0');

    // 27. And every decision in the sequence left a record naming who made
    //     it — the thing that makes an argument about this dinner settleable.
    const audit = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    const actions = audit.map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.PARTNER_CREATED,
        AuditAction.PARTNER_UPDATED,
        AuditAction.PURCHASE_INTENT_CREATED,
        AuditAction.PURCHASE_INTENT_CONFIRMED,
      ]),
    );
    expect(
      audit.find((row) => row.action === AuditAction.PURCHASE_INTENT_CONFIRMED)?.actorUserId,
    ).toBe(cashierPerson.id);
    // Every entry is either attributable to a person, or is a system-driven
    // financial mutation that names the transaction it followed from. The
    // Challenge reward is the second kind on purpose — nobody clicked it —
    // and the check is written this way rather than as "every row has an
    // actor" so that a future row with neither an actor nor a cause fails.
    for (const row of audit) {
      const cause = (row.metadata ?? {}) as { sourceTransactionId?: string };
      expect(row.actorUserId ?? cause.sourceTransactionId).toBeTruthy();
    }
  }, 120_000);

  // ── The fences, on the same restaurant ───────────────────────────────

  it('keeps one restaurant out of another restaurant’s purchase', async () => {
    const mine = await register();
    const theirs = await register();
    const admin = await platformAdmin();

    const setUp = async (owner: typeof mine, displayName: string) => {
      const applied = await partners.apply(owner.request, {
        legalName: `${displayName} LLC`,
        displayName,
        category: 'restaurant',
        bonusAccrualRateBps: 500,
      });
      const live = await partners.approvePartner(admin, applied.id);
      const request = asOwner(owner.id, owner.phone, live.id);
      const branch = await partners.createBranch(request, live.id, {
        name: 'Main',
        address: 'Somewhere 1',
        city: 'Yerevan',
        latitude: 40.18,
        longitude: 44.51,
      });
      return { partner: live, owner: request, branch };
    };

    const dolmama = await setUp(mine, 'Dolmama');
    const lavash = await setUp(theirs, 'Lavash');

    const diner = await register();
    const intent = await intents.create(diner.request, {
      partnerId: dolmama.partner.id,
      partnerBranchId: dolmama.branch.id,
      grossAmount: '5000',
    });

    // The other restaurant's owner cannot confirm it, cannot read it, and
    // cannot refund it — with a real id in hand, which is the only version
    // of this that is worth asserting.
    await expect(intents.confirm(lavash.owner, intent.id)).rejects.toMatchObject({ status: 403 });
    await expect(intents.get(lavash.owner, intent.id)).rejects.toMatchObject({ status: 403 });
    await expect(
      intents.refund(lavash.owner, intent.id, {
        reason: 'Refunding a competitor’s dinner',
        idempotencyKey: 'cross-tenant-refund-1',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      analytics.partner(lavash.owner, dolmama.partner.id, {} as never),
    ).rejects.toMatchObject({ status: 403 });

    expect(
      (await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).status,
    ).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
  }, 120_000);

  it('stops a restaurant owner approving their own application', async () => {
    // The trap this flow walks straight into if `PARTNER_MANAGE` is read as
    // "platform administrator": PARTNER_OWNER holds that permission, because
    // owners administer their own business.
    const restaurateur = await register();
    const applied = await partners.apply(restaurateur.request, {
      legalName: 'Self Serve LLC',
      displayName: 'Self Serve',
      category: 'restaurant',
      bonusAccrualRateBps: 2000,
    });
    const owner = asOwner(restaurateur.id, restaurateur.phone, applied.id);

    expect(owner.permissions).toContain(PermissionName.PARTNER_MANAGE);
    await expect(partners.approvePartner(owner, applied.id)).rejects.toMatchObject({ status: 403 });

    expect((await prisma.partner.findUniqueOrThrow({ where: { id: applied.id } })).status).toBe(
      PartnerStatus.PENDING_APPROVAL,
    );
  }, 120_000);
});
