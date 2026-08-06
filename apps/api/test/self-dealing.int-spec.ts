import { EvSessionStatus, PrismaClient, QrCodeType, RoleName } from '@prisma/client';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { EvReservationsService } from '../src/modules/ev-charging/ev-reservations.service';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
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

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    qrPayments = harness.app.get(QrPaymentsService);
    sessions = harness.app.get(EvSessionsService);
    reservations = harness.app.get(EvReservationsService);
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

      // 1200 kWh x 100 AMD x 5% = 6000, whatever the session's age.
      expect(result.bonusEarned).toBe('6000');
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
