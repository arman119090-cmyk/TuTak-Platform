import { BonusEntryType, EvSessionStatus, PrismaClient, QrCodeType, RoleName } from '@prisma/client';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { EvReservationsService } from '../src/modules/ev-charging/ev-reservations.service';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createEvConnector, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * Two minting paths that survived the previous round of fixes.
 *
 * The first is self-dealing through a merchant code. Blocking self-redemption
 * only stopped `USER_PAY_TOKEN`, because that is the only type whose issuer is
 * recorded — a partner member could still raise an invoice against their own
 * partner and pay it themselves, collecting the accrual on an amount they
 * chose. Verified at 50,000 points per call before this suite existed.
 *
 * The second is time. Bounding a meter reading by the connector's rating fixed
 * the magnitude but not the window: nothing ever closed an abandoned session,
 * so the ceiling grew for as long as the session stayed open. A session left
 * running for 30 days billed 36,000 kWh and paid 180,000 points, and the bay
 * stayed CHARGING forever.
 */
describe('Self-dealing and unbounded sessions (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let qrPayments: QrPaymentsService;
  let sessions: EvSessionsService;
  let reservations: EvReservationsService;
  let bonusEngine: BonusEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    qrPayments = harness.app.get(QrPaymentsService);
    sessions = harness.app.get(EvSessionsService);
    reservations = harness.app.get(EvReservationsService);
    bonusEngine = harness.app.get(BonusEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const asUser = (id: string, roles: RoleName[] = [RoleName.CUSTOMER]): RequestUser => ({
    id,
    phone: '+37400000000',
    roles,
    permissions: [],
    partnerScopes: {},
    mustChangePassword: false,
  });

  /** A customer who is also a member of the partner. */
  const insider = async (bonusAccrualRateBps = 500) => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps });
    await prisma.partnerMembership.create({ data: { partnerId: partner.id, userId: user.id } });
    return { user, wallet, partner };
  };

  // ── Self-dealing through a merchant code ───────────────────────────────

  describe('merchant codes', () => {
    it('refuses a partner member paying an invoice raised against their own partner', async () => {
      const { user, wallet, partner } = await insider();

      const code = await qrPayments.issue(
        { type: QrCodeType.DYNAMIC_INVOICE, partnerId: partner.id, amount: '1000000' },
        asUser(user.id, [RoleName.PARTNER_OWNER]),
      );

      // 1,000,000 at 5% was 50,000 points a call, repeatable without limit.
      await expect(
        qrPayments.redeem({ token: code.token, idempotencyKey: 'insider-1' }, user.id),
      ).rejects.toThrow(/cannot redeem a code you issued yourself/);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('refuses a second member of the same partner, so two staff cannot collude', async () => {
      const { user: issuerStaff, partner } = await insider();
      const { user: accomplice, wallet } = await createCustomer(prisma);
      await prisma.partnerMembership.create({
        data: { partnerId: partner.id, userId: accomplice.id },
      });

      // One member raises the invoice, a different member pays it — the
      // identity check cannot see this, only membership can.
      const code = await qrPayments.issue(
        { type: QrCodeType.DYNAMIC_INVOICE, partnerId: partner.id, amount: '1000000' },
        asUser(issuerStaff.id, [RoleName.PARTNER_OWNER]),
      );

      await expect(
        qrPayments.redeem({ token: code.token, idempotencyKey: 'insider-2' }, accomplice.id),
      ).rejects.toThrow(/cannot redeem a code issued by the partner you belong to/);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('lets staff added via a partner-scoped role, not only via PartnerMembership, issue an invoice', async () => {
      // AdminService.assignRole — the real staff-onboarding path — creates
      // only a UserRole, never a PartnerMembership. Before this fix,
      // assertCanIssueForPartner's isMember() check would have refused this
      // legitimate cashier entirely — a functional bug, not just a
      // self-dealing gap.
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PARTNER_STAFF } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, partnerId: partner.id } });

      await expect(
        qrPayments.issue(
          { type: QrCodeType.DYNAMIC_INVOICE, partnerId: partner.id, amount: '5000' },
          asUser(user.id, [RoleName.PARTNER_STAFF]),
        ),
      ).resolves.toBeDefined();
    });

    it('refuses staff added via a partner-scoped role from redeeming a colleague\'s invoice', async () => {
      const { user: issuerStaff, partner } = await insider();
      const { user: roleStaff, wallet } = await createCustomer(prisma);
      const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PARTNER_STAFF } });
      await prisma.userRole.create({ data: { userId: roleStaff.id, roleId: role.id, partnerId: partner.id } });

      const code = await qrPayments.issue(
        { type: QrCodeType.DYNAMIC_INVOICE, partnerId: partner.id, amount: '1000000' },
        asUser(issuerStaff.id, [RoleName.PARTNER_OWNER]),
      );

      await expect(
        qrPayments.redeem({ token: code.token, idempotencyKey: 'insider-3' }, roleStaff.id),
      ).rejects.toThrow(/cannot redeem a code issued by the partner you belong to/);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('records the issuer on every code, not only on user pay tokens', async () => {
      const { user, partner } = await insider();

      const invoice = await qrPayments.issue(
        { type: QrCodeType.DYNAMIC_INVOICE, partnerId: partner.id, amount: '5000' },
        asUser(user.id, [RoleName.PARTNER_OWNER]),
      );

      // issuedByUserId was null for merchant codes, which is both the hole
      // above and a gap in the audit trail.
      expect(invoice.issuedByUserId).toBe(user.id);
    });

    it('still lets an ordinary customer pay a merchant invoice', async () => {
      const { user: staff, partner } = await insider();
      const { user: customer, wallet } = await createCustomer(prisma);

      const code = await qrPayments.issue(
        { type: QrCodeType.DYNAMIC_INVOICE, partnerId: partner.id, amount: '10000' },
        asUser(staff.id, [RoleName.PARTNER_OWNER]),
      );

      await expect(
        qrPayments.redeem({ token: code.token, idempotencyKey: 'genuine-1' }, customer.id),
      ).resolves.toMatchObject({ amountCharged: '10000', bonusEarned: '500' });
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  // ── Self-dealing through a charging session ────────────────────────────

  describe('EV charging', () => {
    // Business decision (2026-08-16, M7 revision): affiliated partner
    // owners/staff MAY charge at their own station — the session itself is
    // never blocked — but must receive no TuTak bonus benefit from it.

    // 1 kWh: within METER_FLOOR_KWH, so it's accepted regardless of how
    // little time has elapsed since the session started an instant ago.
    const chargeToCompletion = async (userId: string, connectorId: string, energyKwh = '1') => {
      const session = await sessions.start({ connectorId }, userId);
      await sessions.reportMeterValue(session.id, energyKwh, userId);
      return sessions.stop(session.id, userId, {});
    };

    it('lets a partner member start and complete a session at their own connector', async () => {
      const { user, partner } = await insider();
      const connector = await createEvConnector(prisma, { partnerId: partner.id });

      await expect(chargeToCompletion(user.id, connector.id)).resolves.toBeDefined();
    });

    it('earns no bonus for a partner member charging at their own connector', async () => {
      const { user, wallet, partner } = await insider(500); // 5% would normally accrue
      const connector = await createEvConnector(prisma, { partnerId: partner.id, pricePerKwh: '100.00' });

      const result = await chargeToCompletion(user.id, connector.id); // cost 100, 5% would be 5

      expect(result.bonusEarned).toBe('0');
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.lifetimeEarned.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('earns no bonus for staff added via a partner-scoped role, not only via PartnerMembership', async () => {
      // AdminService.assignRole — the real staff-onboarding path — creates
      // only a UserRole, never a PartnerMembership (that row is only ever
      // created for a partner's founding owner via PartnersService.create/
      // apply). isMember() alone would miss this staff member entirely, the
      // same gap PurchaseIntentsService.create and PaymentEngineService
      // .capture were fixed for — see PartnersService.isAffiliated.
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PARTNER_STAFF } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, partnerId: partner.id } });
      const connector = await createEvConnector(prisma, { partnerId: partner.id, pricePerKwh: '100.00' });

      const result = await chargeToCompletion(user.id, connector.id);

      expect(result.bonusEarned).toBe('0');
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.lifetimeEarned.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('still lets an ordinary customer earn bonus charging at a partner they have no affiliation with', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const connector = await createEvConnector(prisma, { partnerId: partner.id, pricePerKwh: '100.00' });

      const result = await chargeToCompletion(user.id, connector.id); // cost 100, 5% = 5 pool

      // FastCharge settles like every other purchase (2026-08-22 3-level
      // referral rework): the whole pool splits directly by the six-leg
      // rule, no upfront TuTak cut — the customer's immediate green share
      // is 20% of 5 = 1.
      expect(result.bonusEarned).toBe('1');
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.lifetimeEarned.toFixed(4)).toBe('1.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('still lets an affiliated staff member spend bonus they already earned elsewhere', async () => {
      // The instruction was explicitly not to block the session — only to
      // deny new earning from it. Spending previously-earned bonus is not a
      // benefit this session grants, so it is untouched.
      const { user, wallet, partner } = await insider(500);
      // Grant pre-existing bonus from an unrelated source, bypassing the
      // whole earn path — this test is only about spending, not earning.
      await bonusEngine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '50',
        pendingHours: 0,
      });
      const connector = await createEvConnector(prisma, { partnerId: partner.id, pricePerKwh: '100.00' });

      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await sessions.reportMeterValue(session.id, '1', user.id); // cost 100
      const result = await sessions.stop(session.id, user.id, { bonusAmountToApply: '50' });

      expect(result.bonusApplied).toBe('50');
      expect(result.bonusEarned).toBe('0'); // still no earning, even while spending
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  // ── Unbounded sessions ─────────────────────────────────────────────────

  describe('session duration', () => {
    const openSession = async (ageHours: number) => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const connector = await createEvConnector(prisma, {
        partnerId: partner.id,
        pricePerKwh: '100.00',
      });
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await prisma.evSession.update({
        where: { id: session.id },
        data: { startedAt: new Date(Date.now() - ageHours * 3_600_000) },
      });
      return { user, wallet, connector, session };
    };

    it('caps the billable window, so an old session cannot bill a month of energy', async () => {
      const { user, session } = await openSession(24 * 30);

      // 50 kW x 720 h was 36,000 kWh and 180,000 points. The cap holds the
      // ceiling to a day's worth however long the session has been open.
      await expect(sessions.reportMeterValue(session.id, '36000', user.id)).rejects.toThrow(
        /exceeds what the connector could have delivered/,
      );

      // A day at 50 kW, plus tolerance, is still accepted.
      await expect(sessions.reportMeterValue(session.id, '1200', user.id)).resolves.toBeDefined();
    });

    it('bounds what a stale session can ever be worth', async () => {
      const { user, wallet, session } = await openSession(24 * 365);
      await sessions.reportMeterValue(session.id, '1200', user.id);
      const result = await sessions.stop(session.id, user.id, {});

      // 1200 kWh x 100 AMD x 5% = 6000 pool, whatever the session's age.
      // Green is 20% of the whole pool, directly (no upfront TuTak cut) = 1200.
      expect(result.bonusEarned).toBe('1200');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('sweeps an abandoned session and frees the bay', async () => {
      const { connector, session } = await openSession(48);

      // Nothing closed these, so the connector was occupied forever and the
      // partner silently lost every subsequent customer.
      expect(await sessions.expireStaleSessions()).toBe(1);

      expect(
        (await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } })).status,
      ).toBe(EvSessionStatus.INVALID);
      expect(
        (await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } })).status,
      ).toBe('AVAILABLE');
    });

    it('leaves a session that is still within the window', async () => {
      const { session } = await openSession(1);
      expect(await sessions.expireStaleSessions()).toBe(0);
      expect(
        (await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } })).status,
      ).toBe(EvSessionStatus.CHARGING);
    });

    it('lets the freed connector be used again', async () => {
      const { connector } = await openSession(48);
      await sessions.expireStaleSessions();

      const { user: next } = await createCustomer(prisma);
      await expect(sessions.start({ connectorId: connector.id }, next.id)).resolves.toBeDefined();
      void reservations;
    });
  });
});
