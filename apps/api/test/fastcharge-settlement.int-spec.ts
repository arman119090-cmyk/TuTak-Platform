import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { FastChargeSettlementService } from '../src/modules/fastcharge/fastcharge-settlement.service';
import { FastChargeStationsService } from '../src/modules/fastcharge/fastcharge-stations.service';
import { FastChargeCustomersService } from '../src/modules/fastcharge/fastcharge-customers.service';
import { PartnerApiKeyService } from '../src/modules/fastcharge/partner-api-key.service';
import { FastChargeApiKeyGuard } from '../src/modules/fastcharge/fastcharge-api-key.guard';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { OutboxService } from '../src/modules/ledger/outbox.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import {
  createCustomer,
  createFastChargeStation,
  createPartner,
  linkFastChargeCustomer,
} from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

describe('FastCharge wholesale-resale integration (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let settlement: FastChargeSettlementService;
  let stationsService: FastChargeStationsService;
  let customersService: FastChargeCustomersService;
  let apiKeys: PartnerApiKeyService;
  let ledger: LedgerService;
  let outbox: OutboxService;
  let bonusEngine: BonusEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    settlement = harness.app.get(FastChargeSettlementService);
    stationsService = harness.app.get(FastChargeStationsService);
    customersService = harness.app.get(FastChargeCustomersService);
    apiKeys = harness.app.get(PartnerApiKeyService);
    ledger = harness.app.get(LedgerService);
    outbox = harness.app.get(OutboxService);
    bonusEngine = harness.app.get(BonusEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /**
   * A FastCharge partner (75 wholesale / 20 cap unless overridden), one
   * station, one linked customer — the ground every test in this file
   * stands on.
   */
  const scenario = async (
    options: {
      wholesale?: string;
      cap?: string;
      maxBonusPaymentPercent?: number;
      standardRetailRatePerKwh?: string;
    } = {},
  ) => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, {
      evWholesaleRatePerKwh: options.wholesale ?? '75.00',
      evMarginReferralCapPerKwh: options.cap ?? '20.00',
      ...(options.maxBonusPaymentPercent !== undefined
        ? { maxBonusPaymentPercent: options.maxBonusPaymentPercent }
        : {}),
    });
    const { station, connector } = await createFastChargeStation(prisma, {
      partnerId: partner.id,
      standardRetailRatePerKwh: options.standardRetailRatePerKwh ?? '115.00',
    });
    const link = await linkFastChargeCustomer(prisma, { partnerId: partner.id, userId: user.id });
    return { user, wallet, partner, station, connector, link };
  };

  // ── Worked examples (margin/split) ─────────────────────────────────────

  describe('worked examples', () => {
    it('80 AMD/kWh applied (5 margin): all of it goes through the standard 20/30/30/10/5/5 split', async () => {
      const { wallet, station, connector, link } = await scenario();

      const result = await settlement.settle(station.partnerId, {
        fastChargeSessionId: 'sess-80',
        fastChargeCustomerId: link.fastChargeCustomerId,
        fastChargeStationId: station.externalStationId!,
        fastChargeConnectorId: connector.externalConnectorId!,
        energyKwh: '1',
        appliedCustomerRatePerKwh: '80',
        finalAmount: '80',
      });

      expect(result.marginPerKwh).toBe('5');
      expect(result.marginPoolAmount).toBe('5');
      expect(result.uncappedMarginRevenueAmount).toBe('0');
      // Green = 20% of 5 = 1.
      expect(result.bonusEarned).toBe('1');

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.toFixed(4)).toBe('1.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('105 AMD/kWh applied (30 margin): 20 through the split, 10 straight TuTak revenue', async () => {
      const { station, connector, link } = await scenario();

      const result = await settlement.settle(station.partnerId, {
        fastChargeSessionId: 'sess-105',
        fastChargeCustomerId: link.fastChargeCustomerId,
        fastChargeStationId: station.externalStationId!,
        fastChargeConnectorId: connector.externalConnectorId!,
        energyKwh: '1',
        appliedCustomerRatePerKwh: '105',
        finalAmount: '105',
      });

      expect(result.marginPerKwh).toBe('30');
      expect(result.marginPoolAmount).toBe('20');
      expect(result.uncappedMarginRevenueAmount).toBe('10');
      // Green = 20% of the capped pool (20) = 4.
      expect(result.bonusEarned).toBe('4');
    });

    it('120 AMD/kWh applied (45 margin): 20 through the split, 25 straight TuTak revenue', async () => {
      const { station, connector, link } = await scenario();

      const result = await settlement.settle(station.partnerId, {
        fastChargeSessionId: 'sess-120',
        fastChargeCustomerId: link.fastChargeCustomerId,
        fastChargeStationId: station.externalStationId!,
        fastChargeConnectorId: connector.externalConnectorId!,
        energyKwh: '1',
        appliedCustomerRatePerKwh: '120',
        finalAmount: '120',
      });

      expect(result.marginPerKwh).toBe('45');
      expect(result.marginPoolAmount).toBe('20');
      expect(result.uncappedMarginRevenueAmount).toBe('25');
    });

    it('posts the margin to the double-entry ledger: capped pool + uncapped revenue debited from the FastCharge partner, split across bonus liability and platform revenue', async () => {
      const { station, connector, link } = await scenario();

      await settlement.settle(station.partnerId, {
        fastChargeSessionId: 'sess-ledger',
        fastChargeCustomerId: link.fastChargeCustomerId,
        fastChargeStationId: station.externalStationId!,
        fastChargeConnectorId: connector.externalConnectorId!,
        energyKwh: '10',
        appliedCustomerRatePerKwh: '105', // margin 30/kWh × 10 kWh = 300 total; 200 capped pool, 100 uncapped.
        finalAmount: '1050',
      });

      const ledgerTx = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'fastcharge.margin.settlement', sourceType: 'Transaction' },
        include: { postings: true },
      });

      const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PARTNER_PAYABLE', partnerId: station.partnerId },
      });
      const liabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'BONUS_LIABILITY' },
      });
      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PLATFORM_REVENUE' },
      });

      const partnerLeg = ledgerTx.postings.find((p) => p.accountId === partnerAccount.id);
      const liabilityLeg = ledgerTx.postings.find((p) => p.accountId === liabilityAccount.id);
      const revenueLeg = ledgerTx.postings.find((p) => p.accountId === revenueAccount.id);

      // Debit = pool (200) + uncapped revenue (100) = 300.
      expect(partnerLeg?.direction).toBe('DEBIT');
      expect(partnerLeg?.amount.toFixed(4)).toBe('300.0000');

      // Pool 200 → green 20% = 40, deferred 30% = 60 → liability = 100.
      expect(liabilityLeg?.direction).toBe('CREDIT');
      expect(liabilityLeg?.amount.toFixed(4)).toBe('100.0000');

      // TuTak's residual on the pool (200 − 100 = 100, no referrer) + the
      // whole uncapped revenue (100) = 200 credited straight to platform revenue.
      expect(revenueLeg?.direction).toBe('CREDIT');
      expect(revenueLeg?.amount.toFixed(4)).toBe('200.0000');

      // 300 debit == 100 + 200 credit — balanced.
    });
  });

  // ── Idempotency ─────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('never double-posts a duplicate webhook delivery for the same FastCharge session id', async () => {
      const { station, connector, link, wallet } = await scenario();
      const dto = {
        fastChargeSessionId: 'sess-dup',
        fastChargeCustomerId: link.fastChargeCustomerId,
        fastChargeStationId: station.externalStationId!,
        fastChargeConnectorId: connector.externalConnectorId!,
        energyKwh: '5',
        appliedCustomerRatePerKwh: '105',
        finalAmount: '525',
      };

      const first = await settlement.settle(station.partnerId, dto);
      const second = await settlement.settle(station.partnerId, dto);
      const third = await settlement.settle(station.partnerId, dto);

      expect(second.sessionId).toBe(first.sessionId);
      expect(third.sessionId).toBe(first.sessionId);

      expect(await prisma.evSession.count({ where: { fastChargeExternalSessionId: 'sess-dup' } })).toBe(1);
      expect(
        await prisma.ledgerTransaction.count({
          where: { kind: 'fastcharge.margin.settlement', sourceType: 'Transaction' },
        }),
      ).toBe(1);

      // The wallet only ever saw the green accrual once, not three times.
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      // Margin 30/kWh × 5 kWh = 150 → 100 capped pool → green 20% = 20.
      expect(after.pendingBonus.toFixed(4)).toBe('20.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('the unique-index backstop also prevents a double post when the two deliveries carry different idempotency framing', async () => {
      // Simulates a lost/expired IdempotencyRecord lease (the record layer's
      // own reclaim window): calling the private "no idempotency wrapper"
      // path twice directly for the same fastChargeSessionId, bypassing
      // `IdempotencyService` entirely, still must not double-post — the
      // `EvSession.fastChargeExternalSessionId` unique index is the backstop
      // for exactly this.
      const { station, connector, link } = await scenario();
      const dto = {
        fastChargeSessionId: 'sess-race',
        fastChargeCustomerId: link.fastChargeCustomerId,
        fastChargeStationId: station.externalStationId!,
        fastChargeConnectorId: connector.externalConnectorId!,
        energyKwh: '1',
        appliedCustomerRatePerKwh: '80',
        finalAmount: '80',
      };

      const settleOnce = (settlement as unknown as { settleOnce: (p: string, d: typeof dto) => Promise<unknown> })
        .settleOnce.bind(settlement);

      const [a, b] = await Promise.all([settleOnce(station.partnerId, dto), settleOnce(station.partnerId, dto)]);
      expect((a as { sessionId: string }).sessionId).toBe((b as { sessionId: string }).sessionId);
      expect(await prisma.evSession.count({ where: { fastChargeExternalSessionId: 'sess-race' } })).toBe(1);
      expect(
        await prisma.ledgerTransaction.count({
          where: { kind: 'fastcharge.margin.settlement', sourceType: 'Transaction' },
        }),
      ).toBe(1);
    });

    it('recovers a failed fast-path ledger post via the outbox, without double-posting on drain', async () => {
      const { station, connector, link } = await scenario();

      const postSpy = jest
        .spyOn(ledger, 'post')
        .mockImplementationOnce(() => Promise.reject(new Error('transient')));

      const result = await settlement.settle(station.partnerId, {
        fastChargeSessionId: 'sess-outbox',
        fastChargeCustomerId: link.fastChargeCustomerId,
        fastChargeStationId: station.externalStationId!,
        fastChargeConnectorId: connector.externalConnectorId!,
        energyKwh: '1',
        appliedCustomerRatePerKwh: '80',
        finalAmount: '80',
      });
      postSpy.mockRestore();
      expect(result.bonusEarned).toBe('1');

      expect(
        await prisma.ledgerTransaction.count({
          where: { kind: 'fastcharge.margin.settlement', sourceType: 'Transaction' },
        }),
      ).toBe(0);

      await outbox.drain();
      expect(
        await prisma.ledgerTransaction.count({
          where: { kind: 'fastcharge.margin.settlement', sourceType: 'Transaction' },
        }),
      ).toBe(1);

      expect(await outbox.drain()).toBe(0);
      expect(
        await prisma.ledgerTransaction.count({
          where: { kind: 'fastcharge.margin.settlement', sourceType: 'Transaction' },
        }),
      ).toBe(1);
    });
  });

  // ── Immutable snapshots ─────────────────────────────────────────────────

  describe('immutable snapshots', () => {
    it('a later change to the wholesale rate, the cap, or the station retail rate never alters an already-settled session', async () => {
      const { station, connector, link } = await scenario({ wholesale: '75.00', cap: '20.00' });

      const result = await settlement.settle(station.partnerId, {
        fastChargeSessionId: 'sess-snapshot',
        fastChargeCustomerId: link.fastChargeCustomerId,
        fastChargeStationId: station.externalStationId!,
        fastChargeConnectorId: connector.externalConnectorId!,
        energyKwh: '1',
        appliedCustomerRatePerKwh: '105',
        finalAmount: '105',
      });
      expect(result.marginPoolAmount).toBe('20');
      expect(result.uncappedMarginRevenueAmount).toBe('10');

      // The partner's commercial terms change after the fact.
      await prisma.partner.update({
        where: { id: station.partnerId },
        data: { evWholesaleRatePerKwh: '90.00', evMarginReferralCapPerKwh: '5.00' },
      });
      await stationsService.updateTariff(station.id, '200.00');

      const stored = await prisma.evSession.findUniqueOrThrow({
        where: { fastChargeExternalSessionId: 'sess-snapshot' },
      });
      expect(stored.wholesaleRatePerKwh?.toFixed(2)).toBe('75.00');
      expect(stored.marginReferralCapPerKwh?.toFixed(2)).toBe('20.00');
      expect(stored.stationRetailRatePerKwh?.toFixed(2)).toBe('115.00');
      expect(stored.marginPerKwh?.toFixed(2)).toBe('30.00');
      expect(stored.poolAmount?.toFixed(4)).toBe('20.0000');
      expect(stored.uncappedMarginRevenueAmount?.toFixed(4)).toBe('10.0000');

      // A brand-new session on the same station now settles under the new terms.
      const after = await settlement.settle(station.partnerId, {
        fastChargeSessionId: 'sess-after-change',
        fastChargeCustomerId: link.fastChargeCustomerId,
        fastChargeStationId: station.externalStationId!,
        fastChargeConnectorId: connector.externalConnectorId!,
        energyKwh: '1',
        appliedCustomerRatePerKwh: '105',
        finalAmount: '105',
      });
      // 105 - 90 = 15 margin, all under the new 5 AMD/kWh cap → 5 pool, 10 uncapped.
      expect(after.marginPerKwh).toBe('15');
      expect(after.marginPoolAmount).toBe('5');
      expect(after.uncappedMarginRevenueAmount).toBe('10');
    });
  });

  // ── Customer-ID linking ─────────────────────────────────────────────────

  describe('customer linking', () => {
    it('never guesses a customer mapping — an unlinked FastCharge customer id is refused', async () => {
      const { station, connector } = await scenario();

      await expect(
        settlement.settle(station.partnerId, {
          fastChargeSessionId: 'sess-unlinked',
          fastChargeCustomerId: 'fc-cust-never-linked',
          fastChargeStationId: station.externalStationId!,
          fastChargeConnectorId: connector.externalConnectorId!,
          energyKwh: '1',
          appliedCustomerRatePerKwh: '80',
          finalAmount: '80',
        }),
      ).rejects.toThrow(/not linked/);

      expect(await prisma.evSession.count()).toBe(0);
    });

    it('links a TuTak user to a FastCharge customer id, then settles against that mapping', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, {});
      const { station, connector } = await createFastChargeStation(prisma, { partnerId: partner.id });

      const link = await customersService.link(user.id, partner.id, 'fc-cust-explicit');
      expect(link.userId).toBe(user.id);

      const result = await settlement.settle(partner.id, {
        fastChargeSessionId: 'sess-linked',
        fastChargeCustomerId: 'fc-cust-explicit',
        fastChargeStationId: station.externalStationId!,
        fastChargeConnectorId: connector.externalConnectorId!,
        energyKwh: '1',
        appliedCustomerRatePerKwh: '80',
        finalAmount: '80',
      });

      const session = await prisma.evSession.findUniqueOrThrow({ where: { id: result.sessionId } });
      expect(session.userId).toBe(user.id);
    });

    it('refuses to relink a FastCharge customer id already linked to a different TuTak user', async () => {
      const { user: userA } = await createCustomer(prisma);
      const { user: userB } = await createCustomer(prisma);
      const partner = await createPartner(prisma, {});

      await customersService.link(userA.id, partner.id, 'fc-cust-taken');
      await expect(customersService.link(userB.id, partner.id, 'fc-cust-taken')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── Bonus-partial-payment ────────────────────────────────────────────────

  describe('bonus-partial-payment', () => {
    it('settles part of the final amount from the bonus wallet and leaves the rest as FastCharge collects it', async () => {
      const { station, connector, link, wallet } = await scenario();
      await bonusEngine.accrue({
        walletId: wallet.id,
        type: 'ACCRUAL_PURCHASE',
        amount: '5000',
        pendingHours: 0,
      });

      const result = await settlement.settle(station.partnerId, {
        fastChargeSessionId: 'sess-bonus',
        fastChargeCustomerId: link.fastChargeCustomerId,
        fastChargeStationId: station.externalStationId!,
        fastChargeConnectorId: connector.externalConnectorId!,
        energyKwh: '100',
        appliedCustomerRatePerKwh: '100', // 10,000 AMD total.
        finalAmount: '10000',
        bonusAmountToApply: '5000',
      });

      expect(result.cost).toBe('10000');
      const transaction = await prisma.transaction.findUniqueOrThrow({
        where: { id: result.transactionId! },
      });
      expect(transaction.bonusAppliedAmount.toFixed(4)).toBe('5000.0000');

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.lifetimeSpent.toFixed(4)).toBe('5000.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('rejects a bonus amount larger than the session cost', async () => {
      const { station, connector, link } = await scenario();

      await expect(
        settlement.settle(station.partnerId, {
          fastChargeSessionId: 'sess-bonus-too-big',
          fastChargeCustomerId: link.fastChargeCustomerId,
          fastChargeStationId: station.externalStationId!,
          fastChargeConnectorId: connector.externalConnectorId!,
          energyKwh: '1',
          appliedCustomerRatePerKwh: '80',
          finalAmount: '80',
          bonusAmountToApply: '5000',
        }),
      ).rejects.toThrow(/cannot exceed the session cost/);
    });

    it("enforces the partner's own maxBonusPaymentPercent ceiling, reused unchanged from PurchaseIntent", async () => {
      const { station, connector, link, wallet } = await scenario({ maxBonusPaymentPercent: 50 });
      await bonusEngine.accrue({
        walletId: wallet.id,
        type: 'ACCRUAL_PURCHASE',
        amount: '10000',
        pendingHours: 0,
      });

      await expect(
        settlement.settle(station.partnerId, {
          fastChargeSessionId: 'sess-bonus-cap',
          fastChargeCustomerId: link.fastChargeCustomerId,
          fastChargeStationId: station.externalStationId!,
          fastChargeConnectorId: connector.externalConnectorId!,
          energyKwh: '100',
          appliedCustomerRatePerKwh: '100', // 10,000 total; 50% cap = 5,000 usable.
          finalAmount: '10000',
          bonusAmountToApply: '6000',
        }),
      ).rejects.toThrow(/allows at most 50%/);
    });
  });

  // ── Multi-station tariff independence ────────────────────────────────────

  describe('multi-station tariff independence', () => {
    it('two stations under one FastCharge partner keep independent retail tariffs and independent session snapshots', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { evWholesaleRatePerKwh: '75.00', evMarginReferralCapPerKwh: '20.00' });
      const stationA = await createFastChargeStation(prisma, {
        partnerId: partner.id,
        standardRetailRatePerKwh: '115.00',
      });
      const stationB = await createFastChargeStation(prisma, {
        partnerId: partner.id,
        standardRetailRatePerKwh: '110.00',
      });
      const link = await linkFastChargeCustomer(prisma, { partnerId: partner.id, userId: user.id });

      // Station A raises its posted price; station B must not move.
      await stationsService.updateTariff(stationA.station.id, '130.00');
      const refreshedA = await prisma.evStation.findUniqueOrThrow({ where: { id: stationA.station.id } });
      const refreshedB = await prisma.evStation.findUniqueOrThrow({ where: { id: stationB.station.id } });
      expect(refreshedA.standardRetailRatePerKwh?.toFixed(2)).toBe('130.00');
      expect(refreshedB.standardRetailRatePerKwh?.toFixed(2)).toBe('110.00');

      // A taxi driver's own negotiated 80 AMD/kWh tariff applies at BOTH
      // stations regardless of each station's own walk-in price — requirement:
      // "a customer's own negotiated tariff overrides the station's standard
      // rate at any station".
      const atA = await settlement.settle(partner.id, {
        fastChargeSessionId: 'sess-multi-a',
        fastChargeCustomerId: link.fastChargeCustomerId,
        fastChargeStationId: stationA.station.externalStationId!,
        fastChargeConnectorId: stationA.connector.externalConnectorId!,
        energyKwh: '1',
        appliedCustomerRatePerKwh: '80',
        finalAmount: '80',
      });
      const atB = await settlement.settle(partner.id, {
        fastChargeSessionId: 'sess-multi-b',
        fastChargeCustomerId: link.fastChargeCustomerId,
        fastChargeStationId: stationB.station.externalStationId!,
        fastChargeConnectorId: stationB.connector.externalConnectorId!,
        energyKwh: '1',
        appliedCustomerRatePerKwh: '80',
        finalAmount: '80',
      });
      expect(atA.marginPerKwh).toBe('5');
      expect(atB.marginPerKwh).toBe('5');

      const sessionA = await prisma.evSession.findUniqueOrThrow({ where: { id: atA.sessionId } });
      const sessionB = await prisma.evSession.findUniqueOrThrow({ where: { id: atB.sessionId } });
      // Each session's own frozen station-retail snapshot reflects the
      // station it actually happened at, independent of the other one: A's
      // snapshot carries A's own (just-updated) 130, B's carries its own
      // untouched 110 — B's price never moved just because A's did.
      expect(sessionA.stationRetailRatePerKwh?.toFixed(2)).toBe('130.00');
      expect(sessionB.stationRetailRatePerKwh?.toFixed(2)).toBe('110.00');
    });

    it('a station belonging to another partner cannot be settled against by this partner', async () => {
      const partnerX = await createPartner(prisma, {});
      const partnerY = await createPartner(prisma, {});
      const { station, connector } = await createFastChargeStation(prisma, { partnerId: partnerX.id });
      const { user } = await createCustomer(prisma);
      const link = await linkFastChargeCustomer(prisma, { partnerId: partnerY.id, userId: user.id });

      await expect(
        settlement.settle(partnerY.id, {
          fastChargeSessionId: 'sess-cross-partner',
          fastChargeCustomerId: link.fastChargeCustomerId,
          fastChargeStationId: station.externalStationId!,
          fastChargeConnectorId: connector.externalConnectorId!,
          energyKwh: '1',
          appliedCustomerRatePerKwh: '80',
          finalAmount: '80',
        }),
      ).rejects.toThrow(/Unknown FastCharge station/);
    });
  });

  // ── Station sync ─────────────────────────────────────────────────────────

  describe('station tariff authorization', () => {
    it("findStationOrThrow reports the station's real owning partner, so a scope check against it runs before any write", async () => {
      // Regression: the controller originally called updateTariff() first
      // and checked assertPartnerScope() only against its result — an
      // unauthorized write would already have happened by the time the
      // scope check threw. The fix reads the station (read-only) first,
      // scopes against *that*, and only then writes. This proves the piece
      // the controller depends on: the read-only lookup names the correct
      // owning partner before any write is attempted.
      const partnerX = await createPartner(prisma, {});
      const partnerY = await createPartner(prisma, {});
      const { station } = await createFastChargeStation(prisma, {
        partnerId: partnerX.id,
        standardRetailRatePerKwh: '115.00',
      });

      const looked = await stationsService.findStationOrThrow(station.id);
      expect(looked.partnerId).toBe(partnerX.id);
      expect(looked.partnerId).not.toBe(partnerY.id);

      // The station's rate is unchanged — nothing wrote to it via the lookup.
      const unchanged = await prisma.evStation.findUniqueOrThrow({ where: { id: station.id } });
      expect(unchanged.standardRetailRatePerKwh?.toFixed(2)).toBe('115.00');
    });
  });

  describe('station sync', () => {
    it('upserts a station and its connectors idempotently, keyed by FastCharge external ids', async () => {
      const partner = await createPartner(prisma, {});
      const dto = {
        fastChargeStationId: 'ext-station-1',
        name: 'FastCharge Kentron',
        address: '10 Mashtots Ave',
        city: 'Yerevan',
        latitude: 40.18,
        longitude: 44.51,
        standardRetailRatePerKwh: '115.00',
        connectors: [{ fastChargeConnectorId: 'ext-connector-1', connectorType: 'CCS2' as const, powerKw: 60 }],
      };

      const first = await stationsService.sync(partner.id, dto);
      const second = await stationsService.sync(partner.id, { ...dto, standardRetailRatePerKwh: '118.00' });

      expect(second.id).toBe(first.id);
      expect(await prisma.evStation.count({ where: { externalStationId: 'ext-station-1' } })).toBe(1);
      expect(await prisma.evConnector.count({ where: { externalConnectorId: 'ext-connector-1' } })).toBe(1);
      expect(second.standardRetailRatePerKwh?.toFixed(2)).toBe('118.00');
    });
  });

  // ── M2M credentials ───────────────────────────────────────────────────────

  describe('M2M API key auth', () => {
    it('issues a credential, verifies it, and rejects it once revoked', async () => {
      const partner = await createPartner(prisma, {});
      const issued = await apiKeys.issue({ partnerId: partner.id, label: 'FastCharge prod' });

      const verified = await apiKeys.verify(issued.apiKey);
      expect(verified?.partnerId).toBe(partner.id);

      await apiKeys.revoke(issued.id, partner.id);
      expect(await apiKeys.verify(issued.apiKey)).toBeNull();
    });

    it('the guard rejects a missing, malformed, or revoked x-api-key header', async () => {
      const guard = harness.app.get(FastChargeApiKeyGuard);
      const ctx = (headers: Record<string, string>) =>
        ({
          switchToHttp: () => ({ getRequest: () => ({ headers }) }),
        }) as never;

      await expect(guard.canActivate(ctx({}))).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(ctx({ 'x-api-key': 'not-a-real-key' }))).rejects.toThrow(
        UnauthorizedException,
      );

      const partner = await createPartner(prisma, {});
      const issued = await apiKeys.issue({ partnerId: partner.id });
      await apiKeys.revoke(issued.id, partner.id);
      await expect(
        guard.canActivate(ctx({ 'x-api-key': issued.apiKey })),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
