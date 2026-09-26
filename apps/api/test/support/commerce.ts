import { randomUUID } from 'node:crypto';
import {
  BonusEntryType,
  LedgerAccountType,
  PartnerOrderOperationalStatus,
  PaymentLegStatus,
  PrismaClient,
  RoleName,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { TestingModule } from '@nestjs/testing';
import { PartnerIntegrationsService } from '../../src/modules/partners/partner-integrations.service';
import { PartnerApiKeyService } from '../../src/modules/partners/partner-api-key.service';
import { CustomerBalanceService } from '../../src/modules/customer-balance/customer-balance.service';
import { BANK_TOPUP_ADAPTER, BankTopUpAdapter } from '../../src/modules/customer-balance/bank-topup-adapter.interface';
import { BonusEngineService } from '../../src/modules/wallet/bonus-engine.service';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { EmployeeShiftService } from '../../src/modules/employee-shifts/employee-shift.service';
import { createCustomer } from '../setup/fixtures';

/**
 * Shared Partner Commerce test support — real services, real Postgres; the
 * only fake is the bank top-up adapter's network edge.
 */
export function commerceSupport(app: TestingModule, prisma: PrismaClient) {
  const integrations = app.get(PartnerIntegrationsService);
  const apiKeys = app.get(PartnerApiKeyService);
  const customerBalance = app.get(CustomerBalanceService);
  const bankAdapter = app.get<BankTopUpAdapter>(BANK_TOPUP_ADAPTER);
  const bonusEngine = app.get(BonusEngineService);
  const ledger = app.get(LedgerService);
  const shifts = app.get(EmployeeShiftService);

  const support = {
    /** A verified WEBSITE integration + issued API key — the create-order credential (spec §3). */
    async websiteIntegration(partnerId: string, staffUserId: string) {
      const integration = await integrations.create(
        partnerId,
        { type: 'WEBSITE' as const, websiteUrl: 'https://example-partner.test' },
        staffUserId,
      );
      await integrations.markWebsiteVerified(partnerId, integration.id, staffUserId);
      await apiKeys.issue({ partnerId, integrationId: integration.id, label: 'test' });
      return integration.id;
    },

    /** Real money in CUSTOMER_PREPAID_BALANCE, through the real top-up flow. */
    async fundMoney(userId: string, amount: string) {
      const providerReference = `PROVIDER-${randomUUID()}`;
      jest.spyOn(bankAdapter, 'initiateTopUp').mockResolvedValueOnce({ outcome: 'INITIATED', providerReference });
      await customerBalance.initiateTopUp(userId, amount);
      jest.spyOn(bankAdapter, 'verifyTopUpWebhook').mockResolvedValueOnce({ providerReference, outcome: 'COMPLETED' });
      await customerBalance.confirmTopUpWebhook({ reference: providerReference }, {});
    },

    /** Green discount balance (available points). */
    async fundDiscount(walletId: string, amount: string) {
      await bonusEngine.accrue({ walletId, type: BonusEntryType.ACCRUAL_PURCHASE, amount, pendingHours: 0 });
    },

    async customer(money?: string, discount?: string) {
      const c = await createCustomer(prisma);
      if (money) await support.fundMoney(c.user.id, money);
      if (discount) await support.fundDiscount(c.wallet.id, discount);
      return c;
    },

    async staff(partnerId: string, role: RoleName = RoleName.PARTNER_STAFF) {
      const { user } = await createCustomer(prisma);
      const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: r.id, partnerId } });
      return user;
    },

    async branch(partnerId: string, name = 'Main') {
      return prisma.partnerBranch.create({
        data: { partnerId, name, address: 'Yerevan', city: 'Yerevan', latitude: 40.18, longitude: 44.51 },
      });
    },

    async assign(partnerId: string, branchId: string, userId: string, assignedByUserId: string) {
      return prisma.partnerBranchStaffAssignment.create({
        data: {
          partnerId,
          partnerBranchId: branchId,
          userId,
          assignedByUserId,
          employeeDisplayCode: `E-${randomUUID().slice(0, 6)}`,
        },
      });
    },

    startShift(userId: string, branchId: string) {
      return shifts.start(userId, branchId);
    },

    async balance(type: LedgerAccountType, opts: { userId?: string; partnerId?: string } = {}) {
      const account = await prisma.ledgerAccount.findFirst({
        where: { type, userId: opts.userId ?? null, partnerId: opts.partnerId ?? null },
      });
      return (account?.balance ?? new Decimal(0)).toFixed(4);
    },

    /** Every ledger account's materialised balance equals the replay of its own postings. */
    async assertAllAccountsReplay() {
      const accounts = await prisma.ledgerAccount.findMany();
      for (const account of accounts) {
        const replayed = await ledger.replayBalance(account.id);
        expect(`${account.type}:${replayed.toFixed(4)}`).toBe(`${account.type}:${account.balance.toFixed(4)}`);
      }
      // And the whole ledger balances to zero — money never appears from nowhere.
      const total = accounts.reduce((sum, a) => sum.plus(a.balance), new Decimal(0));
      expect(total.toFixed(4)).toBe('0.0000');
    },

    /**
     * Order-level invariants (spec §73-74): the live legs sum to what the
     * customer still owes/paid; a completed or cancelled order leaves nothing
     * in escrow; the distribution snapshot explains 100% of the pool.
     */
    async assertOrderInvariants(orderId: string) {
      const order = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: orderId }, include: { paymentLegs: true } });
      const live = order.paymentLegs.filter(
        (l) => l.status !== PaymentLegStatus.CORRECTED && l.status !== PaymentLegStatus.RETURNED && l.status !== PaymentLegStatus.RETURN_PENDING,
      );
      const liveSum = live.reduce((s, l) => s.plus(l.amount.minus(l.refundedAmount)), new Decimal(0));
      if (order.submittedAt && order.operationalStatus !== PartnerOrderOperationalStatus.CANCELLED) {
        expect(liveSum.toFixed(4)).toBe(order.totalAmount.minus(order.refundedAmount).toFixed(4));
        expect(order.discountAmount.plus(order.tutakMoneyAmount).plus(order.externalAmount).toFixed(4)).toBe(order.totalAmount.toFixed(4));
      }
      const escrowIn = await prisma.ledgerPosting.aggregate({
        where: {
          transaction: { sourceId: orderId },
          account: { type: LedgerAccountType.PARTNER_ORDER_ESCROW },
          direction: 'CREDIT',
        },
        _sum: { amount: true },
      });
      const escrowOut = await prisma.ledgerPosting.aggregate({
        where: {
          transaction: { sourceId: orderId },
          account: { type: LedgerAccountType.PARTNER_ORDER_ESCROW },
          direction: 'DEBIT',
        },
        _sum: { amount: true },
      });
      if (order.operationalStatus === 'COMPLETED' || order.operationalStatus === 'CANCELLED') {
        // Only postings sourced to the order itself; adjustment-sourced legs are checked by the caller.
        const adjustmentIds = (await prisma.partnerOrderAdjustment.findMany({ where: { orderId }, select: { id: true } })).map((a) => a.id);
        const adjIn = await prisma.ledgerPosting.aggregate({
          where: { transaction: { sourceId: { in: adjustmentIds } }, account: { type: LedgerAccountType.PARTNER_ORDER_ESCROW }, direction: 'CREDIT' },
          _sum: { amount: true },
        });
        const adjOut = await prisma.ledgerPosting.aggregate({
          where: { transaction: { sourceId: { in: adjustmentIds } }, account: { type: LedgerAccountType.PARTNER_ORDER_ESCROW }, direction: 'DEBIT' },
          _sum: { amount: true },
        });
        const net = (escrowIn._sum.amount ?? new Decimal(0))
          .plus(adjIn._sum.amount ?? 0)
          .minus(escrowOut._sum.amount ?? 0)
          .minus(adjOut._sum.amount ?? 0);
        expect(net.toFixed(4)).toBe('0.0000');
      }
      if (order.poolAmount) {
        const parts = [order.greenAmount, order.deferredAmount, order.referrer1Amount, order.referrer2Amount, order.referrer3Amount, order.tutakAmount];
        const sum = parts.reduce<Decimal>((s, p) => s.plus(p ?? 0), new Decimal(0));
        expect(sum.toFixed(4)).toBe(order.poolAmount.toFixed(4));
      }
      return order;
    },
  };
  return support;
}

export function orderDto(externalOrderId: string, unitPrice = '30000', extra: Record<string, unknown> = {}) {
  return { externalOrderId, items: [{ name: 'Brake pads', sku: 'BP-1', oemNumber: 'OEM-77', quantity: 1, unitPrice }], ...extra };
}
