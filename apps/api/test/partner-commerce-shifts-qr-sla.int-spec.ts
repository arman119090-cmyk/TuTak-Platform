import { LedgerAccountType as A, PrismaClient, ShiftEndReason } from '@prisma/client';
import { PartnerOrdersService } from '../src/modules/partner-orders/partner-orders.service';
import { PartnerOrderSlaSweepService } from '../src/modules/partner-orders/partner-order-sla-sweep.service';
import { OrderEscalationService } from '../src/modules/partner-orders/order-escalation.service';
import { EmployeeShiftService } from '../src/modules/employee-shifts/employee-shift.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { PurchaseIntentRefundService } from '../src/modules/purchase-intents/purchase-intent-refund.service';
import { PartnerBranchStaffService } from '../src/modules/partners/partner-branch-staff.service';
import { businessDateFor, toDbDate } from '../src/modules/employee-shifts/business-day';
import { createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { commerceSupport, orderDto } from './support/commerce';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('Partner Commerce — shifts, offline QR split, SLA (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let orders: PartnerOrdersService;
  let sla: PartnerOrderSlaSweepService;
  let escalations: OrderEscalationService;
  let shifts: EmployeeShiftService;
  let intents: PurchaseIntentsService;
  let refunds: PurchaseIntentRefundService;
  let branchStaff: PartnerBranchStaffService;
  let s: ReturnType<typeof commerceSupport>;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    orders = harness.app.get(PartnerOrdersService);
    sla = harness.app.get(PartnerOrderSlaSweepService);
    escalations = harness.app.get(OrderEscalationService);
    shifts = harness.app.get(EmployeeShiftService);
    intents = harness.app.get(PurchaseIntentsService);
    refunds = harness.app.get(PurchaseIntentRefundService);
    branchStaff = harness.app.get(PartnerBranchStaffService);
    s = commerceSupport(harness.app, prisma);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await harness.resetAlerts();
    jest.restoreAllMocks();
  });

  // ── Scenario N — employee shifts (spec §6, Q4) ──────────────────────────

  describe('scenario N — shifts', () => {
    async function branchWithStaff(count: number) {
      const partner = await createPartner(prisma, { shiftsRequiredFrom: new Date('2020-01-01') });
      const admin = await createStaffUser(prisma);
      const branch = await s.branch(partner.id);
      const people = [];
      for (let i = 0; i < count; i += 1) {
        const person = await s.staff(partner.id);
        await s.assign(partner.id, branch.id, person.id, admin.id);
        people.push(person);
      }
      return { partner, admin, branch, people };
    }

    it("closes yesterday's forgotten shifts when today's first employee starts, and keeps today's colleagues open", async () => {
      const { partner, branch, people } = await branchWithStaff(5);
      const [a, b, c, d, e] = people;
      const today = businessDateFor(new Date(), branch.timezone, branch.businessDayStartMinute);
      const yesterday = new Date(`${today}T00:00:00Z`);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      for (const person of [a!, b!, c!]) {
        await prisma.employeeShift.create({
          data: {
            partnerId: partner.id,
            branchId: branch.id,
            userId: person.id,
            businessDate: yesterday,
            startedAt: new Date(Date.now() - 20 * HOUR),
          },
        });
      }

      const dShift = await shifts.start(d!.id, branch.id);
      const old = await prisma.employeeShift.findMany({ where: { userId: { in: [a!.id, b!.id, c!.id] } } });
      expect(old.every((sh) => sh.endedAt !== null && sh.endReason === ShiftEndReason.NEW_BUSINESS_DAY)).toBe(true);

      const eShift = await shifts.start(e!.id, branch.id);
      // A second employee today does not close the first one.
      const dAfter = await prisma.employeeShift.findUniqueOrThrow({ where: { id: dShift.id } });
      expect(dAfter.endedAt).toBeNull();
      expect(eShift.endedAt).toBeNull();
      expect(await shifts.listOpenAtBranch(branch.id)).toHaveLength(2);
      expect(eShift.businessDate).toEqual(toDbDate(today));
    });

    it('is idempotent per employee and allows only one open shift per person', async () => {
      const { branch, people } = await branchWithStaff(1);
      const [first, second] = await Promise.all([shifts.start(people[0]!.id, branch.id), shifts.start(people[0]!.id, branch.id)]);
      expect(first.id).toBe(second.id);
      expect(await prisma.employeeShift.count({ where: { userId: people[0]!.id, endedAt: null } })).toBe(1);
      await shifts.end(people[0]!.id);
      await shifts.end(people[0]!.id);
      expect(await prisma.employeeShift.count({ where: { userId: people[0]!.id, endedAt: null } })).toBe(0);
    });

    it('the hourly sweep closes shifts whose business day has ended', async () => {
      const { partner, branch, people } = await branchWithStaff(1);
      await prisma.employeeShift.create({
        data: { partnerId: partner.id, branchId: branch.id, userId: people[0]!.id, businessDate: new Date('2026-01-01T00:00:00Z') },
      });
      expect(await shifts.closeStaleShifts()).toBe(1);
      expect(await shifts.current(people[0]!.id)).toBeNull();
    });

    it('refuses a cash action without a shift once shifts are mandatory, and records the shift when on one', async () => {
      const { partner, branch, people } = await branchWithStaff(1);
      const customer = await s.customer('20000');
      const intent = await intents.create({ partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '10000' }, customer.user.id);
      await expect(intents.confirm(intent.id, people[0]!.id)).rejects.toThrow(/Start your shift first/);
      const shift = await shifts.start(people[0]!.id, branch.id);
      const confirmed = await intents.confirm(intent.id, people[0]!.id);
      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.confirmedShiftId).toBe(shift.id);
      expect(confirmed.confirmedWithoutShift).toBe(false);
    });

    it('inside the rollout window a shiftless confirmation still works and is recorded as such', async () => {
      const partner = await createPartner(prisma); // fixture: window open until 2100
      const staff = await s.staff(partner.id);
      const customer = await s.customer();
      const intent = await intents.create({ partnerId: partner.id, grossAmount: '10000' }, customer.user.id);
      const confirmed = await intents.confirm(intent.id, staff.id);
      expect(confirmed.confirmedWithoutShift).toBe(true);
      const audit = await prisma.auditLog.findFirst({ where: { action: 'PURCHASE_INTENT_CONFIRMED', entityId: intent.id } });
      expect((audit?.metadata as { withoutShift: boolean }).withoutShift).toBe(true);
    });

    it('the mandatory-shift date can only move earlier', async () => {
      const { partner, admin } = await branchWithStaff(0);
      await expect(shifts.requireShiftsFrom(partner.id, new Date('2099-01-01'), admin.id)).rejects.toThrow(/only be moved earlier/);
      await shifts.requireShiftsFrom(partner.id, new Date('2019-01-01'), admin.id);
    });

    it('employee deactivation × confirmation: after deactivation the shift is closed and the action refused', async () => {
      const { partner, admin, branch, people } = await branchWithStaff(1);
      const cashier = people[0]!;
      const assignment = await prisma.partnerBranchStaffAssignment.findFirstOrThrow({ where: { userId: cashier.id } });
      await shifts.start(cashier.id, branch.id);
      const customer = await s.customer();
      const intents2 = await Promise.all([
        intents.create({ partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '1000' }, customer.user.id),
        intents.create({ partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '2000' }, customer.user.id),
      ]);
      const [confirmation] = await Promise.allSettled([
        intents.confirm(intents2[0].id, cashier.id),
        branchStaff.deactivate(partner.id, assignment.id, admin.id),
      ]);
      const closed = await prisma.employeeShift.findFirstOrThrow({ where: { userId: cashier.id } });
      expect(closed.endReason).toBe(ShiftEndReason.DEACTIVATED);
      if (confirmation.status === 'fulfilled') {
        // It committed before the deactivation — against a then-open shift.
        expect(confirmation.value.confirmedShiftId).toBe(closed.id);
      }
      await expect(intents.confirm(intents2[1].id, cashier.id)).rejects.toThrow(/Start your shift first/);
    });

    it('shift close × confirmation: a confirmation never commits against a closed shift', async () => {
      const { partner, branch, people } = await branchWithStaff(1);
      const cashier = people[0]!;
      await shifts.start(cashier.id, branch.id);
      const customer = await s.customer();
      const intent = await intents.create({ partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '1000' }, customer.user.id);
      const [confirmation] = await Promise.allSettled([intents.confirm(intent.id, cashier.id), shifts.end(cashier.id)]);
      const shift = await prisma.employeeShift.findFirstOrThrow({ where: { userId: cashier.id } });
      if (confirmation.status === 'fulfilled') {
        expect(confirmation.value.confirmedShiftId).toBe(shift.id);
        expect(confirmation.value.confirmedAt!.getTime()).toBeLessThanOrEqual(shift.endedAt!.getTime());
      } else {
        expect(String(confirmation.reason)).toMatch(/Start your shift first/);
      }
    });
  });

  // ── Scenarios A/B — offline QR split (Q1) ──────────────────────────────

  describe('scenarios A, B — offline QR purchase with a TuTak-money part', () => {
    it('A: external only — commission on the full confirmed amount, partner owes the pool', async () => {
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await s.staff(partner.id);
      const customer = await s.customer();
      const intent = await intents.create({ partnerId: partner.id, grossAmount: '20000' }, customer.user.id);
      expect(intent.ordinaryPaymentRemainder.toFixed(4)).toBe('20000.0000');
      const confirmed = await intents.confirm(intent.id, staff.id);
      expect(confirmed.poolAmount?.toFixed(4)).toBe('1000.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('1000.0000');
      await s.assertAllAccountsReplay();
    });

    it('B: 30000 = 5000 TuTak money + 25000 external — money held until confirmation, then netted', async () => {
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await s.staff(partner.id);
      const customer = await s.customer('50000');
      const intent = await intents.create({ partnerId: partner.id, grossAmount: '30000', tutakMoneyAmount: '5000' }, customer.user.id);
      expect(intent.ordinaryPaymentRemainder.toFixed(4)).toBe('25000.0000');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-45000.0000');
      expect(await s.balance(A.PARTNER_ORDER_ESCROW, { partnerId: partner.id })).toBe('-5000.0000');
      await intents.confirm(intent.id, staff.id);
      expect(await s.balance(A.PARTNER_ORDER_ESCROW, { partnerId: partner.id })).toBe('0.0000');
      // TuTak owes 5000, the partner owes the 1500 pool on the full 30000 → net 3500 owed to the partner.
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('-3500.0000');

      const refund = await refunds.refund({ purchaseIntentId: intent.id, amount: '12000', reason: 'partial', actorId: staff.id, idempotencyKey: 'qr-b-1' });
      expect(refund.amount).toBe('12000.0000');
      const refundRow = await prisma.purchaseIntentRefund.findFirstOrThrow({ where: { purchaseIntentId: intent.id } });
      expect(refundRow.tutakMoneyRefunded.toFixed(4)).toBe('2000.0000');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-47000.0000');
      await s.assertAllAccountsReplay();
    });

    it('rejection and expiry return the TuTak-money part; not enough money refuses creation', async () => {
      const partner = await createPartner(prisma);
      const staff = await s.staff(partner.id);
      const customer = await s.customer('8000');
      const rejected = await intents.create({ partnerId: partner.id, grossAmount: '10000', tutakMoneyAmount: '5000' }, customer.user.id);
      await intents.reject(rejected.id, staff.id, { reasonCode: 'OTHER' } as never);
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-8000.0000');
      const expiring = await intents.create({ partnerId: partner.id, grossAmount: '10000', tutakMoneyAmount: '8000' }, customer.user.id);
      await prisma.purchaseIntent.update({ where: { id: expiring.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await intents.expireStale();
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-8000.0000');
      await expect(
        intents.create({ partnerId: partner.id, grossAmount: '10000', tutakMoneyAmount: '9000' }, customer.user.id),
      ).rejects.toThrow(/Not enough money/);
      expect(await s.balance(A.PARTNER_ORDER_ESCROW, { partnerId: partner.id })).toBe('0.0000');
      await s.assertAllAccountsReplay();
    });
  });

  // ── Scenarios F/G — SLA from submittedAt; 24h / 48h ─────────────────────

  describe('scenarios F, G — SLA alerts', () => {
    async function submittedOrder(minutesAgo: number) {
      const partner = await createPartner(prisma);
      const admin = await createStaffUser(prisma);
      const integrationId = await s.websiteIntegration(partner.id, admin.id);
      const customer = await s.customer();
      const created = await orders.create(partner.id, integrationId, orderDto(`SLA-${Math.random()}`));
      await orders.submit(created.id, customer.user.id, { idempotencyKey: `sla-${created.id}` });
      await prisma.partnerOrder.update({ where: { id: created.id }, data: { submittedAt: new Date(Date.now() - minutesAgo * MINUTE) } });
      return { partner, admin, order: created, customer };
    }

    it('F: an abandoned DRAFT never alerts; 5 minutes after submit without "Увидел" alerts once', async () => {
      const partner = await createPartner(prisma);
      const admin = await createStaffUser(prisma);
      const integrationId = await s.websiteIntegration(partner.id, admin.id);
      const draft = await orders.create(partner.id, integrationId, orderDto('DRAFT-OLD'));
      await prisma.partnerOrder.update({ where: { id: draft.id }, data: { createdAt: new Date(Date.now() - 3 * HOUR) } });
      const { order } = await submittedOrder(6);
      expect(await sla.sweepNotSeen()).toBe(1);
      expect(await sla.sweepNotSeen()).toBe(0);
      const rows = await prisma.orderEscalation.findMany();
      expect(rows.map((r) => `${r.orderId}:${r.type}`)).toEqual([`${order.id}:NOT_SEEN_5MIN`]);
      expect(harness.alerts.matching(`partner-order.not-seen:${order.id}`)).toHaveLength(1);
    });

    it('G: 30 minutes → critical, repeats every 5 minutes, "Взял в работу" stops the repeats but keeps the order queued', async () => {
      const { admin, order } = await submittedOrder(31);
      expect(await sla.sweepStockNotConfirmed()).toBe(1);
      const first = await prisma.orderEscalation.findFirstOrThrow({ where: { type: 'STOCK_NOT_CONFIRMED_30MIN' } });
      expect(harness.alerts.sent.filter((a) => a.severity === 'critical')).toHaveLength(1);
      // Not yet 5 minutes since the first alert.
      expect(await sla.sweepStockNotConfirmed()).toBe(0);
      await prisma.partnerOrder.update({ where: { id: order.id }, data: { stockAlertLastSentAt: new Date(Date.now() - 6 * MINUTE) } });
      expect(await sla.sweepStockNotConfirmed()).toBe(1);
      expect(await prisma.orderEscalation.count({ where: { type: 'STOCK_NOT_CONFIRMED_REPEAT' } })).toBe(1);

      await escalations.claim(first.id, admin.id);
      await prisma.partnerOrder.update({ where: { id: order.id }, data: { stockAlertLastSentAt: new Date(Date.now() - 6 * MINUTE) } });
      expect(await sla.sweepStockNotConfirmed()).toBe(0);
      const queue = await orders.listAdminQueue('critical');
      expect(queue.map((o) => o.id)).toEqual([order.id]);
      // Seeing the order at minute 29 would not have bought time: the clock is submittedAt.
      expect((await orders.listAdminQueue('stock_not_confirmed')).map((o) => o.id)).toEqual([order.id]);
    });

    it('24h after handover reminds the customer, 48h sends the order to manual review — escrow untouched', async () => {
      const partner = await createPartner(prisma);
      const admin = await createStaffUser(prisma);
      const integrationId = await s.websiteIntegration(partner.id, admin.id);
      const staff = await s.staff(partner.id);
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('RCPT-1'));
      await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'rcpt-1' });
      await orders.confirmStock(created.id, staff.id);
      await orders.markHandedOver(created.id, staff.id);

      await prisma.partnerOrder.update({ where: { id: created.id }, data: { handedOverAt: new Date(Date.now() - 25 * HOUR) } });
      expect(await sla.sweepReceipt()).toEqual({ reminded: 1, manualReview: 0 });
      const notification = await prisma.notification.findFirst({ where: { userId: customer.user.id, titleKey: 'notifications.partnerOrder.receiptReminderTitle' } });
      expect(notification).not.toBeNull();

      await prisma.partnerOrder.update({ where: { id: created.id }, data: { handedOverAt: new Date(Date.now() - 49 * HOUR) } });
      expect(await sla.sweepReceipt()).toEqual({ reminded: 0, manualReview: 1 });
      const order = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: created.id } });
      expect(order.operationalStatus).toBe('HANDED_OVER');
      expect(order.manualReviewAt).not.toBeNull();
      expect(await s.balance(A.PARTNER_ORDER_ESCROW, { partnerId: partner.id })).toBe('-30000.0000');
      expect((await orders.listAdminQueue('manual_review')).map((o) => o.id)).toEqual([created.id]);

      // A human decision — never the timer — completes it.
      const done = await orders.confirmReceivedByAdmin(created.id, admin.id, 'Customer confirmed by phone');
      expect(done.operationalStatus).toBe('COMPLETED');
      await s.assertAllAccountsReplay();
    });

    it('drafts expire after their window and can no longer be confirmed', async () => {
      const partner = await createPartner(prisma);
      const admin = await createStaffUser(prisma);
      const integrationId = await s.websiteIntegration(partner.id, admin.id);
      const customer = await s.customer();
      const created = await orders.create(partner.id, integrationId, orderDto('EXP-1'));
      await prisma.partnerOrder.update({ where: { id: created.id }, data: { draftExpiresAt: new Date(Date.now() - 1000) } });
      expect(await sla.expireDrafts()).toBe(1);
      await expect(orders.submit(created.id, customer.user.id, { idempotencyKey: 'exp-1' })).rejects.toThrow(/no longer be confirmed/);
    });

    it('received with an unconfirmed external leg past the grace window → Payment issue queue', async () => {
      const partner = await createPartner(prisma);
      const admin = await createStaffUser(prisma);
      const integrationId = await s.websiteIntegration(partner.id, admin.id);
      const staff = await s.staff(partner.id);
      const customer = await s.customer();
      const created = await orders.create(partner.id, integrationId, orderDto('PI-1'));
      await orders.submit(created.id, customer.user.id, { idempotencyKey: 'pi-1' });
      await orders.confirmStock(created.id, staff.id);
      await orders.confirmReceived(created.id, customer.user.id);
      await prisma.partnerOrder.update({ where: { id: created.id }, data: { customerReceivedAt: new Date(Date.now() - 25 * HOUR) } });
      expect(await sla.sweepPaymentIssues()).toBe(1);
      expect((await orders.listAdminQueue('payment_issue')).map((o) => o.id)).toEqual([created.id]);
    });
  });
});
