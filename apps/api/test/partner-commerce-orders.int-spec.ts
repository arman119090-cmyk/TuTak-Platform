import { LedgerAccountType as A, PrismaClient } from '@prisma/client';
import { PartnerOrdersService } from '../src/modules/partner-orders/partner-orders.service';
import { PartnerOrderAdjustmentService } from '../src/modules/partner-orders/partner-order-adjustment.service';
import { SourcingTaskService } from '../src/modules/partner-orders/sourcing-task.service';
import { CommerceRulesService } from '../src/modules/partner-orders/commerce-rules.service';
import { PartnerOrderCancellationService } from '../src/modules/partner-orders/partner-order-cancellation.service';
import { createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { commerceSupport, orderDto } from './support/commerce';

/**
 * Partner Commerce v2 — online partner orders, end to end against real
 * Postgres (docs/PARTNER_COMMERCE.md). Covers spec §72 scenarios C, D, E, H,
 * I, the cancel/idempotency rules and the order-level races of §61. Every
 * scenario ends by replaying every ledger account and checking the order's
 * own invariants.
 */
describe('Partner Commerce — online orders (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let orders: PartnerOrdersService;
  let adjustments: PartnerOrderAdjustmentService;
  let sourcing: SourcingTaskService;
  let rules: CommerceRulesService;
  let cancellations: PartnerOrderCancellationService;
  let s: ReturnType<typeof commerceSupport>;

  const savedTopUpFlag = process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;

  beforeAll(async () => {
    // Real TuTak money reaches these customers through the real top-up flow,
    // which is off by default since 15.09.2026 (deposit-taking is an open
    // legal question). Set before the harness boots — config reads the env
    // at boot — and restored in afterAll, exactly as customer-balance does.
    process.env.CUSTOMER_PREPAID_TOPUP_ENABLED = 'true';
    harness = await createTestHarness();
    prisma = harness.prisma;
    orders = harness.app.get(PartnerOrdersService);
    adjustments = harness.app.get(PartnerOrderAdjustmentService);
    sourcing = harness.app.get(SourcingTaskService);
    rules = harness.app.get(CommerceRulesService);
    cancellations = harness.app.get(PartnerOrderCancellationService);
    s = commerceSupport(harness.app, prisma);
  });

  afterAll(async () => {
    if (savedTopUpFlag === undefined) delete process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;
    else process.env.CUSTOMER_PREPAID_TOPUP_ENABLED = savedTopUpFlag;
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  async function setup(opts: { rateBps?: number; allowExternalSourcing?: boolean } = {}) {
    const partner = await createPartner(prisma, {
      bonusAccrualRateBps: opts.rateBps ?? 500,
      allowExternalSourcing: opts.allowExternalSourcing,
    });
    const admin = await createStaffUser(prisma);
    const integrationId = await s.websiteIntegration(partner.id, admin.id);
    const staff = await s.staff(partner.id);
    return { partner, admin, integrationId, staff };
  }

  describe('creation', () => {
    it('creates an idempotent DRAFT with the partner base rate, AMD only, no money moved', async () => {
      const { partner, integrationId } = await setup({ rateBps: 1500 });
      const first = await orders.create(partner.id, integrationId, orderDto('EXT-1'));
      const again = await orders.create(partner.id, integrationId, orderDto('EXT-1'));
      expect(again.id).toBe(first.id);
      expect(first.operationalStatus).toBe('DRAFT');
      expect(first.paymentStatus).toBe('UNFUNDED');
      expect(first.commissionRateBps).toBe(1500);
      expect(first.commissionRuleId).toBeNull();
      expect(first.commissionAmount.toFixed(4)).toBe('4500.0000');
      expect(first.submittedAt).toBeNull();
      expect(await prisma.ledgerPosting.count()).toBe(0);
      await expect(
        orders.create(partner.id, integrationId, { ...orderDto('EXT-2'), currency: 'BONUS_POINT' as never }),
      ).rejects.toThrow(/Only AMD/);
    });

    it('uses a serviceType override instead of the base rate — one rate per order (Q5)', async () => {
      const { partner, admin, integrationId } = await setup({ rateBps: 1500 });
      await rules.createCommissionRule({
        partnerId: partner.id,
        serviceType: 'vehicle_import_service',
        name: 'Vehicle import service fee',
        rateBps: 500,
        actorUserId: admin.id,
      });
      // Euro Import: only the $2000-equivalent service fee is sent, never the car price.
      const order = await orders.create(
        partner.id,
        integrationId,
        orderDto('CAR-1', '800000', { serviceType: 'vehicle_import_service' }),
      );
      expect(order.commissionRateBps).toBe(500);
      expect(order.commissionAmount.toFixed(4)).toBe('40000.0000');
      await expect(
        rules.createCommissionRule({ partnerId: partner.id, serviceType: 'vehicle_import_service', name: 'dup', rateBps: 1000, actorUserId: admin.id }),
      ).rejects.toThrow(/already exists/);
      await expect(
        rules.createCommissionRule({ partnerId: partner.id, name: 'no scope', rateBps: 1000, actorUserId: admin.id }),
      ).rejects.toThrow(/serviceType and\/or category/);
      await expect(
        rules.createCommissionRule({ partnerId: partner.id, category: 'x', name: 'off grid', rateBps: 2500, actorUserId: admin.id }),
      ).rejects.toThrow(/0.5%–20%/);
    });
  });

  describe('scenario C — fully electronic', () => {
    it('reserves at confirmation, releases only after "Получил заказ", and distributes 20/30/30/20', async () => {
      const { partner, integrationId, staff } = await setup({ rateBps: 500 });
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('C-1'));

      const submitted = await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'submit-c-1' });
      expect(submitted.operationalStatus).toBe('SUBMITTED');
      expect(submitted.paymentStatus).toBe('FUNDED');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-20000.0000');
      expect(await s.escrow(partner.id)).toBe('-30000.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('0.0000');

      await orders.markSeen(created.id, staff.id);
      await orders.confirmStock(created.id, staff.id);
      // E2 fixed: stock confirmation moves no money.
      expect(await s.escrow(partner.id)).toBe('-30000.0000');
      await orders.markDelivered(created.id, staff.id);

      const done = await orders.confirmReceived(created.id, customer.user.id);
      expect(done.operationalStatus).toBe('COMPLETED');
      expect(done.paymentStatus).toBe('SETTLED');
      expect(await s.escrow(partner.id)).toBe('0.0000');
      // 30000 receivable − 1500 pool (E1 fixed: the pool is distributed, not all platform revenue).
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('-28500.0000');
      expect(done.poolAmount?.toFixed(4)).toBe('1500.0000');
      expect(done.greenAmount?.toFixed(4)).toBe('300.0000');
      expect(done.deferredAmount?.toFixed(4)).toBe('450.0000');
      // No referral chain → L1/L2/L3 fold into TuTak's share.
      expect(done.tutakAmount?.toFixed(4)).toBe('750.0000');
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      expect(wallet.availableBonus.toFixed(4)).toBe('300.0000');
      expect(await prisma.deferredBonusLot.count({ where: { userId: customer.user.id } })).toBe(1);
      const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: done.sourceTransactionId! } });
      expect(tx.status).toBe('COMPLETED');

      // Idempotent: a second "Получил" changes nothing.
      await orders.confirmReceived(created.id, customer.user.id);
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } })).toBe(1);
      await s.assertOrderInvariants(created.id);
      await s.assertAllAccountsReplay();
    });

    it('shows no "Получил" before stock is confirmed', async () => {
      const { partner, integrationId } = await setup();
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('C-2'));
      await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'submit-c-2' });
      await expect(orders.confirmReceived(created.id, customer.user.id)).rejects.toThrow(/cannot be confirmed as received/);
    });
  });

  describe('scenario D — cash on delivery, confirmed by an employee on shift', () => {
    it('keeps the order open after receipt until the external payment is confirmed', async () => {
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500, shiftsRequiredFrom: new Date('2020-01-01') });
      const admin = await createStaffUser(prisma);
      const integrationId = await s.websiteIntegration(partner.id, admin.id);
      const branch = await s.branch(partner.id);
      const cashier = await s.staff(partner.id);
      await s.assign(partner.id, branch.id, cashier.id, admin.id);
      const customer = await s.customer();

      const created = await orders.create(partner.id, integrationId, orderDto('D-1'));
      const submitted = await orders.submit(created.id, customer.user.id, { idempotencyKey: 'submit-d-1' });
      expect(submitted.paymentStatus).toBe('RESERVED');
      expect(submitted.externalAmount.toFixed(4)).toBe('30000.0000');
      await orders.confirmStock(created.id, cashier.id);
      await orders.markDelivered(created.id, cashier.id);
      const received = await orders.confirmReceived(created.id, customer.user.id);
      // Interim rule pending Q10: not completed while external money is unconfirmed.
      expect(received.operationalStatus).toBe('RECEIVED');

      const leg = received.paymentLegs.find((l) => l.type === 'EXTERNAL')!;
      await expect(orders.confirmExternalPayment(leg.id, cashier.id)).rejects.toThrow(/Start your shift first/);

      const shift = await s.startShift(cashier.id, branch.id);
      const done = await orders.confirmExternalPayment(leg.id, cashier.id);
      expect(done.operationalStatus).toBe('COMPLETED');
      const confirmedLeg = await prisma.partnerOrderPaymentLeg.findUniqueOrThrow({ where: { id: leg.id } });
      expect(confirmedLeg.status).toBe('CONFIRMED');
      expect(confirmedLeg.confirmedShiftId).toBe(shift.id);
      expect(confirmedLeg.confirmedBranchId).toBe(branch.id);
      expect(confirmedLeg.confirmedByUserId).toBe(cashier.id);
      // TuTak never received the cash: the partner simply owes the pool.
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('1500.0000');
      expect(await s.escrow(partner.id)).toBe('0.0000');
      await s.assertOrderInvariants(created.id);
      await s.assertAllAccountsReplay();
    });

    it('lets OWNER/MANAGER correct a mistaken confirmation before handover only', async () => {
      const { partner, integrationId, staff } = await setup();
      const customer = await s.customer();
      const created = await orders.create(partner.id, integrationId, orderDto('D-2'));
      const submitted = await orders.submit(created.id, customer.user.id, { idempotencyKey: 'submit-d-2' });
      const leg = submitted.paymentLegs[0]!;
      await orders.confirmExternalPayment(leg.id, staff.id);
      const corrected = await orders.correctExternalPayment(leg.id, staff.id, 'Courier had not paid in yet');
      expect(corrected.paymentLegs.map((l) => l.status).sort()).toEqual(['CORRECTED', 'PENDING']);
      expect(corrected.paymentStatus).toBe('RESERVED');
      const fresh = corrected.paymentLegs.find((l) => l.status === 'PENDING')!;
      await orders.confirmExternalPayment(fresh.id, staff.id);
      await orders.confirmStock(created.id, staff.id);
      await orders.markDelivered(created.id, staff.id);
      await expect(orders.correctExternalPayment(fresh.id, staff.id, 'too late')).rejects.toThrow(/payment dispute/);
      const audit = await prisma.auditLog.findFirst({ where: { action: 'PARTNER_ORDER_EXTERNAL_PAYMENT_CORRECTED' } });
      expect((audit?.metadata as { reason: string }).reason).toBe('Courier had not paid in yet');
    });
  });

  describe('scenario E — mixed discount + TuTak money + external', () => {
    it('tracks three legs separately and never credits the partner twice', async () => {
      const { partner, integrationId, staff } = await setup({ rateBps: 500 });
      const customer = await s.customer('50000', '6000');
      const created = await orders.create(partner.id, integrationId, orderDto('E-1'));
      const submitted = await orders.submit(created.id, customer.user.id, {
        discountAmount: '5000',
        tutakMoneyAmount: '10000',
        idempotencyKey: 'submit-e-1',
      });
      expect(submitted.paymentLegs.map((l) => `${l.type}:${l.status}:${l.amount.toFixed(0)}`).sort()).toEqual([
        'DISCOUNT:CAPTURED:5000',
        'EXTERNAL:PENDING:15000',
        'TUTAK_MONEY:CAPTURED:10000',
      ]);
      expect(await s.escrow(partner.id)).toBe('-15000.0000');
      const walletAfterSubmit = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      expect(walletAfterSubmit.availableBonus.toFixed(4)).toBe('1000.0000');

      await orders.confirmStock(created.id, staff.id);
      await orders.confirmExternalPayment(submitted.paymentLegs.find((l) => l.type === 'EXTERNAL')!.id, staff.id);
      await orders.markDelivered(created.id, staff.id);
      const done = await orders.confirmReceived(created.id, customer.user.id);
      expect(done.operationalStatus).toBe('COMPLETED');
      // 15000 electronic receivable − 1500 pool on the full 30000.
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('-13500.0000');
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner_order.completion' } })).toBe(1);
      await s.assertOrderInvariants(created.id);
      await s.assertAllAccountsReplay();
    });

    it('enforces the discount cap, the prepayment rule and refuses more than the balance', async () => {
      const { partner, admin, integrationId } = await setup();
      await prisma.partner.update({ where: { id: partner.id }, data: { maxBonusPaymentPercent: 10 } });
      await rules.createPrepaymentRule({ partnerId: partner.id, mode: 'PERCENT', percentBps: 2000, actorUserId: admin.id });
      const customer = await s.customer('1000', '10000');
      const created = await orders.create(partner.id, integrationId, orderDto('E-2'));
      expect(created.prepaymentRequiredAmount.toFixed(4)).toBe('6000.0000');
      await expect(
        orders.submit(created.id, customer.user.id, { discountAmount: '4000', idempotencyKey: 'e2-a' }),
      ).rejects.toThrow(/at most 10%/);
      await expect(
        orders.submit(created.id, customer.user.id, { discountAmount: '3000', idempotencyKey: 'e2-b' }),
      ).rejects.toThrow(/in advance/);
      // Q13: discount + money reaching 6000 is not enough — only money counts.
      await expect(
        orders.submit(created.id, customer.user.id, { discountAmount: '3000', tutakMoneyAmount: '3000', idempotencyKey: 'e2-c' }),
      ).rejects.toThrow(/discount balance does not count/);
      await expect(
        orders.submit(created.id, customer.user.id, { discountAmount: '3000', tutakMoneyAmount: '6000', idempotencyKey: 'e2-d' }),
      ).rejects.toThrow(/Not enough money/);
      // Nothing leaked: the discount reservation was released, no transaction completed.
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      expect(wallet.availableBonus.toFixed(4)).toBe('10000.0000');
      expect(wallet.reservedBonus.toFixed(4)).toBe('0.0000');
      const order = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: created.id } });
      expect(order.operationalStatus).toBe('DRAFT');
      await s.assertAllAccountsReplay();
    });
  });

  describe('cancel (spec §43)', () => {
    it('returns every leg to its own source, no penalty; a confirmed cash leg waits for the partner', async () => {
      const { partner, integrationId, staff } = await setup();
      const customer = await s.customer('50000', '6000');
      const created = await orders.create(partner.id, integrationId, orderDto('X-1'));
      const submitted = await orders.submit(created.id, customer.user.id, {
        discountAmount: '5000',
        tutakMoneyAmount: '10000',
        idempotencyKey: 'x-1',
      });
      const external = submitted.paymentLegs.find((l) => l.type === 'EXTERNAL')!;
      await orders.confirmExternalPayment(external.id, staff.id);
      const cancelled = await cancellations.request(created.id, customer.user.id, 'changed my mind');
      expect(cancelled.operationalStatus).toBe('CANCELLED');
      expect(cancelled.paymentStatus).toBe('REFUND_PENDING');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-50000.0000');
      expect(await s.escrow(partner.id)).toBe('0.0000');
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      expect(wallet.availableBonus.toFixed(4)).toBe('6000.0000');
      await orders.confirmExternalReturn(external.id, staff.id);
      const refunded = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: created.id } });
      expect(refunded.paymentStatus).toBe('REFUNDED');
      const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: refunded.sourceTransactionId! } });
      expect(tx.status).toBe('FAILED');
      await s.assertOrderInvariants(created.id);
      await s.assertAllAccountsReplay();
    });

    it('refuses to cancel after receipt — that is a return', async () => {
      const { partner, integrationId, staff } = await setup();
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('X-2'));
      await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'x-2' });
      await orders.confirmStock(created.id, staff.id);
      await orders.markDelivered(created.id, staff.id);
      await orders.confirmReceived(created.id, customer.user.id);
      await expect(cancellations.request(created.id, customer.user.id)).rejects.toThrow(/no longer be cancelled/);
    });

    it('item 8: the customer may still cancel after delivery; with no disclosed cost terms it is a full refund at once', async () => {
      const { partner, integrationId, staff } = await setup();
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('X-2b'));
      await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'x-2b' });
      await orders.confirmStock(created.id, staff.id);
      await orders.markOutForDelivery(created.id, staff.id, 'Courier Aram, +374 99 000000');
      await orders.markDelivered(created.id, staff.id);
      const cancelled = await cancellations.request(created.id, customer.user.id, 'not what I expected');
      expect(cancelled.operationalStatus).toBe('CANCELLED');
      expect(cancelled.paymentStatus).toBe('REFUNDED');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-50000.0000');
      await s.assertOrderInvariants(created.id);
      await s.assertAllAccountsReplay();
      await s.assertEscrowProvenance();
    });

    it('never lets another customer reuse a claimed checkout link', async () => {
      const { partner, integrationId } = await setup();
      const first = await s.customer('50000');
      const second = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('X-3'));
      await orders.submit(created.id, first.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'x-3' });
      await expect(orders.getCheckout(created.id, second.user.id)).rejects.toThrow(/not found/);
      await expect(
        orders.submit(created.id, second.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'x-3b' }),
      ).rejects.toThrow(/not found/);
      await expect(cancellations.request(created.id, second.user.id)).rejects.toThrow(/not found/);
      // Nor can anyone cancel an unclaimed checkout link they merely hold.
      const draft = await orders.create(partner.id, integrationId, orderDto('X-3-draft'));
      await expect(cancellations.request(draft.id, second.user.id)).rejects.toThrow(/not found/);
      expect((await prisma.partnerOrder.findUniqueOrThrow({ where: { id: draft.id } })).operationalStatus).toBe('DRAFT');
    });
  });

  describe('sourcing (scenarios H, I)', () => {
    it('H: out of stock → task → cheaper identical item → customer accepts → difference returned → order continues', async () => {
      const { partner, admin, integrationId, staff } = await setup({ rateBps: 500 });
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('H-1'));
      await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'h-1' });
      const out = await orders.rejectStock(created.id, staff.id, { reason: 'none left' });
      expect(out.operationalStatus).toBe('OUT_OF_STOCK');
      expect(out.sourcingStatus).toBe('REQUIRED');
      const task = await prisma.sourcingTask.findUniqueOrThrow({ where: { orderId: created.id } });
      await sourcing.claim(task.id, admin.id);
      await sourcing.recordResult(task.id, { status: 'FOUND_EXACT', productName: 'Brake pads', price: '25000', sourceType: 'OTHER_TUTAK_PARTNER' }, admin.id);
      const waiting = await orders.findByIdOrThrow(created.id);
      expect(waiting.sourcingStatus).toBe('AWAITING_CUSTOMER');
      const proposal = waiting.adjustments[0]!;
      expect(proposal.type).toBe('PRICE_DECREASE');

      const accepted = await adjustments.accept(proposal.id, customer.user.id, {});
      expect(accepted.operationalStatus).toBe('STOCK_CONFIRMED');
      expect(accepted.totalAmount.toFixed(4)).toBe('25000.0000');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-25000.0000');
      expect(await s.escrow(partner.id)).toBe('-25000.0000');

      await orders.markDelivered(created.id, staff.id);
      const done = await orders.confirmReceived(created.id, customer.user.id);
      expect(done.poolAmount?.toFixed(4)).toBe('1250.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('-23750.0000');
      await s.assertOrderInvariants(created.id);
      await s.assertAllAccountsReplay();
    });

    it('H: an alternative at a higher price is funded by an additional leg the customer chooses', async () => {
      const { partner, admin, integrationId, staff } = await setup({ rateBps: 500 });
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('H-2'));
      await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'h-2' });
      await orders.rejectStock(created.id, staff.id, {});
      const task = await prisma.sourcingTask.findUniqueOrThrow({ where: { orderId: created.id } });
      await sourcing.recordResult(
        task.id,
        { status: 'FOUND_ALTERNATE', productName: 'Other brand pads', price: '33000', differences: 'Other brand', sourceType: 'EXTERNAL' },
        admin.id,
      );
      const proposal = (await orders.findByIdOrThrow(created.id)).adjustments[0]!;
      expect(proposal.type).toBe('ALTERNATE_PRODUCT');
      const accepted = await adjustments.accept(proposal.id, customer.user.id, { tutakMoneyAmount: '3000' });
      expect(accepted.totalAmount.toFixed(4)).toBe('33000.0000');
      expect(accepted.paymentLegs.filter((l) => l.purpose === 'ADDITIONAL')).toHaveLength(1);
      expect(await s.escrow(partner.id)).toBe('-33000.0000');
      await orders.markDelivered(created.id, staff.id);
      const done = await orders.confirmReceived(created.id, customer.user.id);
      expect(done.poolAmount?.toFixed(4)).toBe('1650.0000');
      await s.assertOrderInvariants(created.id);
      await s.assertAllAccountsReplay();
    });

    it('H: accepting the same price-increase proposal twice funds the difference once', async () => {
      const { partner, admin, integrationId, staff } = await setup({ rateBps: 500 });
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('H-2b'));
      await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'h-2b' });
      await orders.rejectStock(created.id, staff.id, {});
      const task = await prisma.sourcingTask.findUniqueOrThrow({ where: { orderId: created.id } });
      await sourcing.recordResult(task.id, { status: 'FOUND_EXACT', productName: 'Same pads', price: '31000' }, admin.id);
      const proposal = (await orders.findByIdOrThrow(created.id)).adjustments[0]!;
      await Promise.allSettled([
        adjustments.accept(proposal.id, customer.user.id, { tutakMoneyAmount: '1000' }),
        adjustments.accept(proposal.id, customer.user.id, { tutakMoneyAmount: '1000' }),
      ]);
      await adjustments.accept(proposal.id, customer.user.id, { tutakMoneyAmount: '1000' });
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-19000.0000');
      expect(await prisma.partnerOrderPaymentLeg.count({ where: { orderId: created.id, purpose: 'ADDITIONAL' } })).toBe(1);
      await s.assertOrderInvariants(created.id);
      await s.assertAllAccountsReplay();
    });

    it('H: declining the proposal cancels with a full refund; not found cancels too', async () => {
      const { partner, admin, integrationId, staff } = await setup();
      const customer = await s.customer('60000');
      const a = await orders.create(partner.id, integrationId, orderDto('H-3'));
      await orders.submit(a.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'h-3' });
      await orders.rejectStock(a.id, staff.id, {});
      const taskA = await prisma.sourcingTask.findUniqueOrThrow({ where: { orderId: a.id } });
      await sourcing.recordResult(taskA.id, { status: 'FOUND_EXACT', productName: 'Same', price: '30000' }, admin.id);
      const proposal = (await orders.findByIdOrThrow(a.id)).adjustments[0]!;
      expect(proposal.type).toBe('SAME_ITEM_OTHER_SOURCE');
      const declined = await adjustments.decline(proposal.id, customer.user.id);
      expect(declined.operationalStatus).toBe('CANCELLED');

      const b = await orders.create(partner.id, integrationId, orderDto('H-4'));
      await orders.submit(b.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'h-4' });
      await orders.rejectStock(b.id, staff.id, {});
      const taskB = await prisma.sourcingTask.findUniqueOrThrow({ where: { orderId: b.id } });
      await sourcing.recordResult(taskB.id, { status: 'NOT_FOUND', notes: 'nowhere' }, admin.id);
      const notFound = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: b.id } });
      expect(notFound.operationalStatus).toBe('CANCELLED');
      expect(notFound.sourcingStatus).toBe('FAILED');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-60000.0000');
      expect(await s.escrow(partner.id)).toBe('0.0000');
      await s.assertAllAccountsReplay();
    });

    it('I: sourcing disabled by policy → out of stock cancels and refunds immediately', async () => {
      const { partner, integrationId, staff } = await setup({ allowExternalSourcing: false });
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('I-1'));
      expect(created.sourcingAllowed).toBe(false);
      await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'i-1' });
      const result = await orders.rejectStock(created.id, staff.id, {});
      expect(result.operationalStatus).toBe('CANCELLED');
      expect(result.paymentStatus).toBe('REFUNDED');
      expect(await prisma.sourcingTask.count()).toBe(0);
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-50000.0000');
      await s.assertOrderInvariants(created.id);
      await s.assertAllAccountsReplay();
    });
  });

  describe('races (spec §61) and idempotency (spec §60)', () => {
    it('duplicate checkout confirmation captures exactly once', async () => {
      const { partner, integrationId } = await setup();
      const customer = await s.customer('100000');
      const created = await orders.create(partner.id, integrationId, orderDto('R-1'));
      const results = await Promise.allSettled([
        orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'r-1' }),
        orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'r-1' }),
        orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'r-1-other' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner_order.money_capture' } })).toBe(1);
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-70000.0000');
      await s.assertAllAccountsReplay();
    });

    it('customer received × customer cancel: exactly one wins, escrow ends at zero either way', async () => {
      const { partner, integrationId, staff } = await setup();
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('R-2'));
      await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'r-2' });
      await orders.confirmStock(created.id, staff.id);
      const results = await Promise.allSettled([
        orders.confirmReceived(created.id, customer.user.id),
        cancellations.request(created.id, customer.user.id),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const final = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: created.id } });
      expect(['COMPLETED', 'CANCELLED']).toContain(final.operationalStatus);
      expect(await s.escrow(partner.id)).toBe('0.0000');
      const released = await prisma.ledgerTransaction.count({ where: { kind: 'partner_order.completion' } });
      const returned = await prisma.ledgerTransaction.count({ where: { kind: 'partner_order.money_return' } });
      expect(released + returned).toBe(1);
      await s.assertAllAccountsReplay();
    });

    it('stock confirmed × out of stock: exactly one decision sticks', async () => {
      const { partner, integrationId, staff } = await setup();
      const other = await s.staff(partner.id);
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('R-3'));
      await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'r-3' });
      const results = await Promise.allSettled([
        orders.confirmStock(created.id, staff.id),
        orders.rejectStock(created.id, other.id, {}),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const final = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: created.id } });
      expect(['STOCK_CONFIRMED', 'OUT_OF_STOCK']).toContain(final.operationalStatus);
      expect(await prisma.sourcingTask.count()).toBe(final.operationalStatus === 'OUT_OF_STOCK' ? 1 : 0);
    });

    it('sourcing claim × partner "в наличии" after all: exactly one wins', async () => {
      const { partner, admin, integrationId, staff } = await setup();
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('R-4'));
      await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'r-4' });
      await orders.rejectStock(created.id, staff.id, {});
      const task = await prisma.sourcingTask.findUniqueOrThrow({ where: { orderId: created.id } });
      const [claim, confirm] = await Promise.allSettled([sourcing.claim(task.id, admin.id), orders.confirmStock(created.id, staff.id)]);
      const final = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: created.id } });
      if (confirm.status === 'fulfilled') {
        expect(final.operationalStatus).toBe('STOCK_CONFIRMED');
        expect(final.sourcingStatus).toBe('RESOLVED');
      } else {
        expect(claim.status).toBe('fulfilled');
        expect(final.sourcingStatus).toBe('SEARCHING');
      }
    });

    it('duplicate external payment confirmation is recorded once', async () => {
      const { partner, integrationId, staff } = await setup();
      const customer = await s.customer();
      const created = await orders.create(partner.id, integrationId, orderDto('R-5'));
      const submitted = await orders.submit(created.id, customer.user.id, { idempotencyKey: 'r-5' });
      const leg = submitted.paymentLegs[0]!;
      await Promise.all([orders.confirmExternalPayment(leg.id, staff.id), orders.confirmExternalPayment(leg.id, staff.id)]);
      expect(await prisma.auditLog.count({ where: { action: 'PARTNER_ORDER_EXTERNAL_PAYMENT_CONFIRMED' } })).toBe(1);
    });
  });
});
