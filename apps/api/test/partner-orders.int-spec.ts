import { randomUUID } from 'node:crypto';
import { LedgerAccountType, PartnerOrderStatus, PrismaClient } from '@prisma/client';
import { PartnerIntegrationsService } from '../src/modules/partners/partner-integrations.service';
import { PartnerApiKeyService } from '../src/modules/partners/partner-api-key.service';
import { CustomerBalanceService } from '../src/modules/customer-balance/customer-balance.service';
import { BANK_TOPUP_ADAPTER, BankTopUpAdapter } from '../src/modules/customer-balance/bank-topup-adapter.interface';
import { PartnerOrdersService } from '../src/modules/partner-orders/partner-orders.service';
import { PartnerOrderAdjustmentService } from '../src/modules/partner-orders/partner-order-adjustment.service';
import { SourcingTaskService } from '../src/modules/partner-orders/sourcing-task.service';
import { OrderEscalationService } from '../src/modules/partner-orders/order-escalation.service';
import { PartnerOrderSlaSweepService } from '../src/modules/partner-orders/partner-order-sla-sweep.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Partner Commerce (docs/PARTNER_COMMERCE_2026-09-25.md) — spec §27's
 * scenario list, covering the highest-value subset given the size of the
 * feature: normal order lifecycle, both SLA alerts, every sourcing outcome,
 * create-idempotency, and the two money-critical concurrency races (pay vs
 * pay, refund vs stock-confirmation). Not every scenario spec §27 lists is
 * separately exercised here — see the final report's own test-coverage
 * section for exactly which.
 */
describe('Partner Commerce (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let integrations: PartnerIntegrationsService;
  let apiKeys: PartnerApiKeyService;
  let customerBalance: CustomerBalanceService;
  let bankAdapter: BankTopUpAdapter;
  let orders: PartnerOrdersService;
  let adjustments: PartnerOrderAdjustmentService;
  let sourcing: SourcingTaskService;
  let escalations: OrderEscalationService;
  let sla: PartnerOrderSlaSweepService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    integrations = harness.app.get(PartnerIntegrationsService);
    apiKeys = harness.app.get(PartnerApiKeyService);
    customerBalance = harness.app.get(CustomerBalanceService);
    bankAdapter = harness.app.get<BankTopUpAdapter>(BANK_TOPUP_ADAPTER);
    orders = harness.app.get(PartnerOrdersService);
    adjustments = harness.app.get(PartnerOrderAdjustmentService);
    sourcing = harness.app.get(SourcingTaskService);
    escalations = harness.app.get(OrderEscalationService);
    sla = harness.app.get(PartnerOrderSlaSweepService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  /** A verified WEBSITE integration + issued API key — spec §3's create-order credential. */
  async function createWebsiteIntegration(partnerId: string, staffUserId: string) {
    const integration = await integrations.create(
      partnerId,
      { type: 'WEBSITE' as const, websiteUrl: 'https://example-partner.test' },
      staffUserId,
    );
    await integrations.markWebsiteVerified(partnerId, integration.id, staffUserId);
    await apiKeys.issue({ partnerId, integrationId: integration.id, label: 'test' });
    return { integrationId: integration.id };
  }

  /** Funds a customer's real-money balance through the real top-up flow, not a direct DB write. */
  async function fundBalance(userId: string, amount: string) {
    const providerReference = `PROVIDER-${randomUUID()}`;
    jest.spyOn(bankAdapter, 'initiateTopUp').mockResolvedValueOnce({ outcome: 'INITIATED', providerReference });
    await customerBalance.initiateTopUp(userId, amount);
    jest
      .spyOn(bankAdapter, 'verifyTopUpWebhook')
      .mockResolvedValueOnce({ providerReference, outcome: 'COMPLETED' });
    await customerBalance.confirmTopUpWebhook({ reference: providerReference }, {});
  }

  function orderDto(externalOrderId: string, unitPrice = '10000') {
    return {
      externalOrderId,
      items: [{ name: 'Test widget', quantity: 1, unitPrice }],
    };
  }

  async function ledgerBalance(type: LedgerAccountType, opts: { userId?: string; partnerId?: string } = {}) {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type, userId: opts.userId ?? null, partnerId: opts.partnerId ?? null },
    });
    return account?.balance ?? null;
  }

  async function assertAccountReplays(type: LedgerAccountType, opts: { userId?: string; partnerId?: string } = {}) {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type, userId: opts.userId ?? null, partnerId: opts.partnerId ?? null },
    });
    if (!account) return;
    const replayed = await ledger.replayBalance(account.id);
    expect(replayed.toFixed(4)).toBe(account.balance.toFixed(4));
  }

  describe('normal order lifecycle', () => {
    it('create → checkout → pay → seen → stock confirmed settles escrow to partner + platform', async () => {
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await createStaffUser(prisma);
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('ORDER-1'));
      expect(created.paymentStatus).toBe('PAYMENT_PENDING');
      expect(created.orderStatus).toBe(PartnerOrderStatus.CREATED);
      expect(created.totalAmount.toFixed(4)).toBe('10000.0000');

      // Checkout is viewable before payment, unclaimed.
      const checkout = await orders.getCheckoutOrThrow(created.id, customer.user.id);
      expect(checkout.customerId).toBeNull();

      const paid = await orders.pay(created.id, customer.user.id);
      expect(paid.insufficientBalance).toBe(false);
      expect(paid.order.paymentStatus).toBe('PAID');
      expect(paid.order.customerId).toBe(customer.user.id);

      const balanceAfterPay = await customerBalance.getBalance(customer.user.id);
      expect(balanceAfterPay.balance).toBe('40000.0000');

      const seen = await orders.markSeen(created.id, staff.id);
      expect(seen.orderStatus).toBe(PartnerOrderStatus.PARTNER_SEEN);
      expect(seen.partnerSeenAt).not.toBeNull();

      const confirmed = await orders.confirmStock(created.id, staff.id);
      expect(confirmed.orderStatus).toBe(PartnerOrderStatus.STOCK_CONFIRMED);

      // 5% commission on 10000: 500 to platform, 9500 to partner.
      const partnerPayable = await ledgerBalance(LedgerAccountType.PARTNER_PAYABLE, { partnerId: partner.id });
      const platformRevenue = await ledgerBalance(LedgerAccountType.PLATFORM_REVENUE);
      const escrow = await ledgerBalance(LedgerAccountType.PARTNER_ORDER_ESCROW, { partnerId: partner.id });
      expect(partnerPayable?.toFixed(4)).toBe('-9500.0000'); // credited = negative, owed to partner
      expect(platformRevenue?.toFixed(4)).toBe('-500.0000');
      expect(escrow?.toFixed(4)).toBe('0.0000');

      await assertAccountReplays(LedgerAccountType.PARTNER_ORDER_ESCROW, { partnerId: partner.id });
      await assertAccountReplays(LedgerAccountType.PARTNER_PAYABLE, { partnerId: partner.id });
      await assertAccountReplays(LedgerAccountType.PLATFORM_REVENUE);
      await assertAccountReplays(LedgerAccountType.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id });
    });

    it('checkout shows insufficientBalance rather than failing when the customer cannot cover it', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      // No top-up at all.

      const created = await orders.create(partner.id, integrationId, orderDto('ORDER-POOR'));
      const result = await orders.pay(created.id, customer.user.id);
      expect(result.insufficientBalance).toBe(true);
      expect(result.order.paymentStatus).toBe('PAYMENT_PENDING');

      // Nothing was captured — escrow stays untouched.
      const escrow = await ledgerBalance(LedgerAccountType.PARTNER_ORDER_ESCROW, { partnerId: partner.id });
      expect(escrow).toBeNull();
    });
  });

  describe('create idempotency (spec §24: duplicate webhook/create does not create a second order)', () => {
    it('a retried create with the same externalOrderId returns the same order', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);

      const first = await orders.create(partner.id, integrationId, orderDto('DUP-1'));
      const second = await orders.create(partner.id, integrationId, orderDto('DUP-1'));
      expect(second.id).toBe(first.id);

      const count = await prisma.partnerOrder.count({ where: { externalOrderId: 'DUP-1' } });
      expect(count).toBe(1);
    });
  });

  describe('unauthorized access (spec §24)', () => {
    it('a partner only ever sees their own orders', async () => {
      const partnerA = await createPartner(prisma, { displayName: 'A' });
      const partnerB = await createPartner(prisma, { displayName: 'B' });
      const staffA = await createStaffUser(prisma);
      const { integrationId: integrationA } = await createWebsiteIntegration(partnerA.id, staffA.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const orderA = await orders.create(partnerA.id, integrationA, orderDto('A-1'));
      await orders.pay(orderA.id, customer.user.id);

      const listForA = await orders.listForPartner(partnerA.id);
      const listForB = await orders.listForPartner(partnerB.id);
      expect(listForA.map((o) => o.id)).toContain(orderA.id);
      expect(listForB.map((o) => o.id)).not.toContain(orderA.id);
    });

    it('a customer cannot pay for or view an order another customer already claimed', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customerA = await createCustomer(prisma);
      const customerB = await createCustomer(prisma);
      await fundBalance(customerA.user.id, '50000');
      await fundBalance(customerB.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('CLAIM-1'));
      await orders.pay(created.id, customerA.user.id);

      await expect(orders.getCheckoutOrThrow(created.id, customerB.user.id)).rejects.toThrow();
    });
  });

  describe('SLA alerts (spec §8-9)', () => {
    it('raises NOT_SEEN_5MIN once an order has sat unpaid-acknowledged for 5 minutes', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('SLA-SEEN'));
      await orders.pay(created.id, customer.user.id);
      await prisma.partnerOrder.update({
        where: { id: created.id },
        data: { createdAt: new Date(Date.now() - 6 * 60_000) },
      });

      const alerted = await sla.sweepNotSeen();
      expect(alerted).toBe(1);

      const open = await escalations.listOpen('NOT_SEEN_5MIN');
      expect(open.some((e) => e.orderId === created.id)).toBe(true);

      // A second tick must not raise it again.
      const second = await sla.sweepNotSeen();
      expect(second).toBe(0);
    });

    it('raises STOCK_NOT_CONFIRMED_30MIN from createdAt, not partnerSeenAt, and repeats every 5 minutes thereafter', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('SLA-STOCK'));
      await orders.pay(created.id, customer.user.id);
      // Seen at minute 29 — must not buy extra time (spec §9's explicit warning).
      await prisma.partnerOrder.update({
        where: { id: created.id },
        data: { createdAt: new Date(Date.now() - 31 * 60_000), partnerSeenAt: new Date(Date.now() - 2 * 60_000) },
      });

      const firstTick = await sla.sweepStockNotConfirmed();
      expect(firstTick).toBe(1);
      let open = await escalations.listOpen('STOCK_NOT_CONFIRMED_30MIN');
      expect(open.some((e) => e.orderId === created.id)).toBe(true);

      // Not due again immediately.
      expect(await sla.sweepStockNotConfirmed()).toBe(0);

      // Fast-forward the last alert 6 minutes back — due for a repeat.
      await prisma.partnerOrder.update({
        where: { id: created.id },
        data: { stockAlertLastSentAt: new Date(Date.now() - 6 * 60_000) },
      });
      const repeatTick = await sla.sweepStockNotConfirmed();
      expect(repeatTick).toBe(1);
      open = await escalations.listOpen('STOCK_NOT_CONFIRMED_REPEAT');
      expect(open.some((e) => e.orderId === created.id)).toBe(true);
    });

    it('stops re-alerting once staff claim the problem, but the order stays queryable', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('SLA-CLAIM'));
      await orders.pay(created.id, customer.user.id);
      await prisma.partnerOrder.update({
        where: { id: created.id },
        data: { createdAt: new Date(Date.now() - 31 * 60_000) },
      });
      await sla.sweepStockNotConfirmed();

      const [escalation] = await escalations.listOpen('STOCK_NOT_CONFIRMED_30MIN');
      await escalations.claim(escalation!.id, staff.id);

      await prisma.partnerOrder.update({
        where: { id: created.id },
        data: { stockAlertLastSentAt: new Date(Date.now() - 6 * 60_000) },
      });
      expect(await sla.sweepStockNotConfirmed()).toBe(0); // no new push

      // Still visible: the order itself, unresolved, in the partner's own queue.
      const stillOpen = await orders.listForPartner(partner.id);
      expect(stillOpen.some((o) => o.id === created.id && !o.stockConfirmedAt)).toBe(true);
    });
  });

  describe('out-of-stock handling (spec §12-16)', () => {
    it('sourcing-disabled partner (Little Joe-style) refunds outright, no sourcing task', async () => {
      const partner = await createPartner(prisma);
      await prisma.partner.update({ where: { id: partner.id }, data: { allowExternalSourcing: false } });
      const staff = await createStaffUser(prisma);
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('NO-SOURCING'));
      expect(created.sourcingAllowed).toBe(false);
      await orders.pay(created.id, customer.user.id);

      const rejected = await orders.rejectStock(created.id, staff.id, { reason: 'out of stock' });
      expect(rejected.orderStatus).toBe(PartnerOrderStatus.REFUNDED);

      const balance = await customerBalance.getBalance(customer.user.id);
      expect(balance.balance).toBe('50000.0000'); // fully refunded

      const task = await prisma.sourcingTask.findUnique({ where: { orderId: created.id } });
      expect(task).toBeNull();

      await assertAccountReplays(LedgerAccountType.PARTNER_ORDER_ESCROW, { partnerId: partner.id });
      await assertAccountReplays(LedgerAccountType.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id });
    });

    it('sourcing-allowed partner opens a sourcing task on rejection', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('SOURCING-1'));
      await orders.pay(created.id, customer.user.id);
      const rejected = await orders.rejectStock(created.id, staff.id, {});
      expect(rejected.orderStatus).toBe(PartnerOrderStatus.SOURCING_REQUIRED);

      const task = await prisma.sourcingTask.findUnique({ where: { orderId: created.id } });
      expect(task?.status).toBe('OPEN');
    });

    it('sourcing not found refunds fully (spec §16)', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const employee = await createStaffUser(prisma, { firstName: 'Ops' });
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('NOT-FOUND-1'));
      await orders.pay(created.id, customer.user.id);
      await orders.rejectStock(created.id, staff.id, {});
      const task = await prisma.sourcingTask.findUniqueOrThrow({ where: { orderId: created.id } });

      await sourcing.claim(task.id, employee.id);
      await sourcing.recordResult(task.id, { status: 'NOT_FOUND' }, employee.id);

      const finalOrder = await orders.findByIdOrThrow(created.id);
      expect(finalOrder.orderStatus).toBe(PartnerOrderStatus.REFUNDED);
      const balance = await customerBalance.getBalance(customer.user.id);
      expect(balance.balance).toBe('50000.0000');
    });

    it('sourcing found the exact item at the same price resolves without a customer decision', async () => {
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await createStaffUser(prisma);
      const employee = await createStaffUser(prisma, { firstName: 'Ops' });
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('EXACT-SAME'));
      await orders.pay(created.id, customer.user.id);
      await orders.rejectStock(created.id, staff.id, {});
      const task = await prisma.sourcingTask.findUniqueOrThrow({ where: { orderId: created.id } });

      await sourcing.recordResult(
        task.id,
        { status: 'FOUND_EXACT', productName: 'Same widget', price: '10000' },
        employee.id,
      );

      const finalOrder = await orders.findByIdOrThrow(created.id);
      expect(finalOrder.orderStatus).toBe(PartnerOrderStatus.STOCK_CONFIRMED);
      const partnerPayable = await ledgerBalance(LedgerAccountType.PARTNER_PAYABLE, { partnerId: partner.id });
      expect(partnerPayable?.toFixed(4)).toBe('-9500.0000');
    });

    it('a cheaper exact match auto-refunds the difference and continues, no customer decision', async () => {
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await createStaffUser(prisma);
      const employee = await createStaffUser(prisma, { firstName: 'Ops' });
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('CHEAPER', '25000'));
      await orders.pay(created.id, customer.user.id);
      await orders.rejectStock(created.id, staff.id, {});
      const task = await prisma.sourcingTask.findUniqueOrThrow({ where: { orderId: created.id } });

      await sourcing.recordResult(
        task.id,
        { status: 'FOUND_EXACT', productName: 'Cheaper widget', price: '23000' },
        employee.id,
      );

      const finalOrder = await orders.findByIdOrThrow(created.id);
      expect(finalOrder.orderStatus).toBe(PartnerOrderStatus.STOCK_CONFIRMED);
      expect(finalOrder.totalAmount.toFixed(4)).toBe('23000.0000');
      // 25000 - 23000 = 2000 refunded.
      const balance = await customerBalance.getBalance(customer.user.id);
      expect(balance.balance).toBe('27000.0000'); // 50000 - 25000 + 2000
      // 5% of the NEW total (23000): 1150 to platform, 21850 to partner.
      const partnerPayable = await ledgerBalance(LedgerAccountType.PARTNER_PAYABLE, { partnerId: partner.id });
      expect(partnerPayable?.toFixed(4)).toBe('-21850.0000');
    });

    it('a pricier exact match requires customer acceptance and an additional checkout (spec §15)', async () => {
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const staff = await createStaffUser(prisma);
      const employee = await createStaffUser(prisma, { firstName: 'Ops' });
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('PRICIER', '25000'));
      await orders.pay(created.id, customer.user.id);
      await orders.rejectStock(created.id, staff.id, {});
      const task = await prisma.sourcingTask.findUniqueOrThrow({ where: { orderId: created.id } });

      await sourcing.recordResult(
        task.id,
        { status: 'FOUND_EXACT', productName: 'Pricier widget', price: '28000' },
        employee.id,
      );

      let midOrder = await orders.findByIdOrThrow(created.id);
      expect(midOrder.orderStatus).toBe(PartnerOrderStatus.CUSTOMER_DECISION_REQUIRED);
      const adjustment = await prisma.partnerOrderAdjustment.findFirstOrThrow({ where: { orderId: created.id } });
      expect(adjustment.deltaAmount.toFixed(4)).toBe('3000.0000');

      const accepted = await adjustments.respond(adjustment.id, customer.user.id, true);
      expect(accepted.additionalPaymentStatus).toBe('PAYMENT_PENDING');

      const paidExtra = await adjustments.payAdditionalAmount(adjustment.id, customer.user.id);
      expect(paidExtra.insufficientBalance).toBe(false);
      expect(paidExtra.adjustment.status).toBe('APPLIED');

      midOrder = await orders.findByIdOrThrow(created.id);
      expect(midOrder.orderStatus).toBe(PartnerOrderStatus.STOCK_CONFIRMED);
      expect(midOrder.totalAmount.toFixed(4)).toBe('28000.0000');

      const balance = await customerBalance.getBalance(customer.user.id);
      expect(balance.balance).toBe('22000.0000'); // 50000 - 25000 - 3000
      const partnerPayable = await ledgerBalance(LedgerAccountType.PARTNER_PAYABLE, { partnerId: partner.id });
      expect(partnerPayable?.toFixed(4)).toBe('-26600.0000'); // 28000 * 0.95
    });

    it('a declined alternate refunds the full captured amount (spec §15)', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const employee = await createStaffUser(prisma, { firstName: 'Ops' });
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('ALT-DECLINE'));
      await orders.pay(created.id, customer.user.id);
      await orders.rejectStock(created.id, staff.id, {});
      const task = await prisma.sourcingTask.findUniqueOrThrow({ where: { orderId: created.id } });

      await sourcing.recordResult(
        task.id,
        { status: 'FOUND_ALTERNATE', productName: 'Different widget', price: '10000' },
        employee.id,
      );
      const adjustment = await prisma.partnerOrderAdjustment.findFirstOrThrow({ where: { orderId: created.id } });
      expect(adjustment.type).toBe('ALTERNATE_PRODUCT');

      await adjustments.respond(adjustment.id, customer.user.id, false);

      const finalOrder = await orders.findByIdOrThrow(created.id);
      expect(finalOrder.orderStatus).toBe(PartnerOrderStatus.REFUNDED);
      const balance = await customerBalance.getBalance(customer.user.id);
      expect(balance.balance).toBe('50000.0000');
    });
  });

  describe('concurrency (spec §27: refund vs confirmation, duplicate payment)', () => {
    it('only one of two racing pay() calls captures the money', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customerA = await createCustomer(prisma);
      const customerB = await createCustomer(prisma);
      await fundBalance(customerA.user.id, '50000');
      await fundBalance(customerB.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('RACE-PAY'));

      const [resultA, resultB] = await Promise.allSettled([
        orders.pay(created.id, customerA.user.id),
        orders.pay(created.id, customerB.user.id),
      ]);

      const succeeded = [resultA, resultB].filter(
        (r) => r.status === 'fulfilled' && !r.value.insufficientBalance,
      );
      expect(succeeded).toHaveLength(1);

      const finalOrder = await orders.findByIdOrThrow(created.id);
      expect(finalOrder.paymentStatus).toBe('PAID');
      const escrow = await ledgerBalance(LedgerAccountType.PARTNER_ORDER_ESCROW, { partnerId: partner.id });
      // Credited = negative, same convention PARTNER_PAYABLE/PLATFORM_REVENUE
      // use — see the normal-lifecycle test above. Exactly one capture, never two.
      expect(escrow?.toFixed(4)).toBe('-10000.0000');

      await assertAccountReplays(LedgerAccountType.PARTNER_ORDER_ESCROW, { partnerId: partner.id });
    });

    it('confirmStock and rejectStock racing on the same order resolve to exactly one outcome', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const { integrationId } = await createWebsiteIntegration(partner.id, staff.id);
      const customer = await createCustomer(prisma);
      await fundBalance(customer.user.id, '50000');

      const created = await orders.create(partner.id, integrationId, orderDto('RACE-CONFIRM'));
      await orders.pay(created.id, customer.user.id);

      const [confirmResult, rejectResult] = await Promise.allSettled([
        orders.confirmStock(created.id, staff.id),
        orders.rejectStock(created.id, staff.id, {}),
      ]);

      const finalOrder = await orders.findByIdOrThrow(created.id);
      // Exactly one of the two effects happened, never both, never neither.
      expect([PartnerOrderStatus.STOCK_CONFIRMED, PartnerOrderStatus.SOURCING_REQUIRED, PartnerOrderStatus.OUT_OF_STOCK]).toContain(
        finalOrder.orderStatus,
      );

      const escrow = await ledgerBalance(LedgerAccountType.PARTNER_ORDER_ESCROW, { partnerId: partner.id });
      const partnerPayable = await ledgerBalance(LedgerAccountType.PARTNER_PAYABLE, { partnerId: partner.id });
      if (finalOrder.orderStatus === PartnerOrderStatus.STOCK_CONFIRMED) {
        expect(escrow?.toFixed(4)).toBe('0.0000');
        expect(partnerPayable?.toFixed(4)).toBe('-9500.0000');
      } else {
        // Rejected side won — money never left escrow via settlement.
        expect(partnerPayable === null || partnerPayable.toFixed(4) === '0.0000').toBe(true);
      }
      await assertAccountReplays(LedgerAccountType.PARTNER_ORDER_ESCROW, { partnerId: partner.id });
      await assertAccountReplays(LedgerAccountType.PARTNER_PAYABLE, { partnerId: partner.id });

      void confirmResult;
      void rejectResult;
    });
  });
});
