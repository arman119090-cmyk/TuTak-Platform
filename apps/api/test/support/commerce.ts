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

    /** Both escrows of a partner together (money + discount), as one figure. */
    async escrow(partnerId: string) {
      const accounts = await prisma.ledgerAccount.findMany({
        where: { partnerId, type: { in: [LedgerAccountType.PARTNER_ORDER_MONEY_ESCROW, LedgerAccountType.PARTNER_ORDER_DISCOUNT_ESCROW] } },
      });
      return accounts.reduce((sum, a) => sum.plus(a.balance), new Decimal(0)).toFixed(4);
    },

    /**
     * Item 9 — provenance proven from the ledger alone: every posting on a
     * money escrow is matched only by CUSTOMER_PREPAID_BALANCE or
     * PARTNER_PAYABLE, every posting on a discount escrow only by
     * BONUS_LIABILITY or PARTNER_PAYABLE; no transaction ever moves value
     * between BONUS_LIABILITY/discount escrow and CUSTOMER_PREPAID_BALANCE/
     * money escrow; and the Q9 shortfall clearing always nets to zero once
     * nothing is awaiting a desk settlement.
     */
    async assertEscrowProvenance() {
      const MONEY_SIDE: LedgerAccountType[] = [LedgerAccountType.CUSTOMER_PREPAID_BALANCE, LedgerAccountType.PARTNER_ORDER_MONEY_ESCROW];
      const BONUS_SIDE: LedgerAccountType[] = [LedgerAccountType.BONUS_LIABILITY, LedgerAccountType.PARTNER_ORDER_DISCOUNT_ESCROW];
      const escrowTx = await prisma.ledgerTransaction.findMany({
        where: {
          postings: {
            some: { account: { type: { in: [LedgerAccountType.PARTNER_ORDER_MONEY_ESCROW, LedgerAccountType.PARTNER_ORDER_DISCOUNT_ESCROW] } } },
          },
        },
        include: { postings: { include: { account: true } } },
      });
      for (const t of escrowTx) {
        const types = new Set(t.postings.map((p) => p.account.type));
        if (types.has(LedgerAccountType.PARTNER_ORDER_MONEY_ESCROW)) {
          for (const type of types) {
            expect([`${t.kind}:${type}`]).toEqual([
              expect.stringMatching(/:(CUSTOMER_PREPAID_BALANCE|PARTNER_ORDER_MONEY_ESCROW|PARTNER_ORDER_DISCOUNT_ESCROW|PARTNER_PAYABLE)$/),
            ]);
          }
        }
        if (types.has(LedgerAccountType.PARTNER_ORDER_DISCOUNT_ESCROW)) {
          for (const type of types) {
            expect([`${t.kind}:${type}`]).toEqual([
              expect.stringMatching(/:(BONUS_LIABILITY|PARTNER_ORDER_DISCOUNT_ESCROW|PARTNER_ORDER_MONEY_ESCROW|PARTNER_PAYABLE)$/),
            ]);
          }
        }
        // Both escrows in one transaction only ever at completion, and then
        // both only flow out to PARTNER_PAYABLE — never into each other.
        if (types.has(LedgerAccountType.PARTNER_ORDER_MONEY_ESCROW) && types.has(LedgerAccountType.PARTNER_ORDER_DISCOUNT_ESCROW)) {
          expect(t.kind).toBe('partner_order.completion');
          for (const p of t.postings) {
            if (p.account.type !== LedgerAccountType.PARTNER_PAYABLE) expect(p.direction).toBe('DEBIT');
          }
        }
      }
      // Nowhere in the ledger does discount value land on the money side, or money on the bonus side.
      const all = await prisma.ledgerTransaction.findMany({ include: { postings: { include: { account: true } } } });
      for (const t of all) {
        const credits = t.postings.filter((p) => p.direction === 'CREDIT').map((p) => p.account.type);
        const debits = t.postings.filter((p) => p.direction === 'DEBIT').map((p) => p.account.type);
        const bonusToMoney = debits.some((d) => BONUS_SIDE.includes(d)) && credits.some((c) => MONEY_SIDE.includes(c));
        const moneyToBonus = debits.some((d) => MONEY_SIDE.includes(d)) && credits.some((c) => BONUS_SIDE.includes(c));
        expect(`${t.kind}:${bonusToMoney ? 'bonus→money' : moneyToBonus ? 'money→bonus' : 'ok'}`).toBe(`${t.kind}:ok`);
      }
      const awaiting =
        (await prisma.partnerOrderReturn.count({ where: { status: { in: ['AWAITING_SHORTFALL_SETTLEMENT', 'MANUAL_REVIEW'] } } })) +
        (await prisma.purchaseIntentRefund.count({ where: { status: { in: ['AWAITING_SHORTFALL_SETTLEMENT', 'MANUAL_REVIEW'] } } }));
      if (awaiting === 0) {
        const clearing = await prisma.ledgerAccount.findMany({ where: { type: LedgerAccountType.CUSTOMER_SHORTFALL_CLEARING } });
        for (const c of clearing) expect(`${c.userId}:${c.balance.toFixed(4)}`).toBe(`${c.userId}:0.0000`);
      }
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
      if (order.operationalStatus === 'COMPLETED' || order.operationalStatus === 'CANCELLED') {
        // Every posting caused by this order (itself, its adjustments, its
        // cancellation request) — each escrow must net to zero on its own.
        const adjustmentIds = (await prisma.partnerOrderAdjustment.findMany({ where: { orderId }, select: { id: true } })).map((a) => a.id);
        const cancellationIds = (await prisma.partnerOrderCancellation.findMany({ where: { orderId }, select: { id: true } })).map((c) => c.id);
        const sources = [orderId, ...adjustmentIds, ...cancellationIds];
        for (const type of [LedgerAccountType.PARTNER_ORDER_MONEY_ESCROW, LedgerAccountType.PARTNER_ORDER_DISCOUNT_ESCROW]) {
          const [inflow, outflow] = await Promise.all(
            (['CREDIT', 'DEBIT'] as const).map((direction) =>
              prisma.ledgerPosting.aggregate({
                where: { transaction: { sourceId: { in: sources } }, account: { type }, direction },
                _sum: { amount: true },
              }),
            ),
          );
          const net = (inflow!._sum.amount ?? new Decimal(0)).minus(outflow!._sum.amount ?? 0);
          expect(`${type}:${net.toFixed(4)}`).toBe(`${type}:0.0000`);
        }
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
