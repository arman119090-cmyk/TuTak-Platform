import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../src/config/configuration';
import { LedgerAccountType, PrismaClient } from '@prisma/client';
import { MetricsController } from '../src/modules/metrics/metrics.controller';
import { MetricsService } from '../src/modules/metrics/metrics.service';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Business metrics.
 *
 * Two things are being checked, and the second is the one that would have
 * shipped broken: that the numbers are true, and that what comes out of the
 * endpoint is something a scraper can actually read. The first version
 * returned correct figures wrapped in this API's `{ data, timestamp }`
 * envelope — a valid HTTP 200 that Prometheus cannot parse, which fails as
 * empty dashboards rather than as an error anyone would notice.
 */
describe('Metrics (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let metrics: MetricsService;

  const controllerWithToken = (token: string) =>
    new MetricsController(metrics, {
      get: () => token,
    } as unknown as ConfigService<AppConfig, true>);

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    metrics = new MetricsService(harness.app.get(PrismaService));
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  describe('access', () => {
    it('refuses when no token is configured', async () => {
      // Not "falls back to open". An accidentally public metrics endpoint
      // hands over revenue, liability and traffic patterns, and it does so
      // silently.
      await expect(controllerWithToken('').scrape('Bearer anything')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses a wrong or missing token', async () => {
      const controller = controllerWithToken('right-token');
      await expect(controller.scrape('Bearer wrong-token')).rejects.toThrow(ForbiddenException);
      await expect(controller.scrape(undefined)).rejects.toThrow(ForbiddenException);
      await expect(controller.scrape('right-token')).rejects.toThrow(ForbiddenException);
    });

    it('serves the exposition format, unwrapped, to a correct token', async () => {
      const body = await controllerWithToken('right-token').scrape('Bearer right-token');

      // The shape a scraper requires: comment lines and bare samples, with
      // no JSON envelope anywhere.
      expect(body.startsWith('# HELP')).toBe(true);
      expect(body).toContain('# TYPE tutak_ledger_imbalance_amd gauge');
      expect(body).not.toContain('"data"');
      expect(body).not.toContain('"timestamp"');
    });
  });

  describe('the numbers', () => {
    const valueOf = (body: string, metric: string): number => {
      const line = body
        .split('\n')
        .find((l) => l.startsWith(metric) && !l.startsWith('#'));
      if (!line) throw new Error(`${metric} is not being reported`);
      return Number(line.slice(line.lastIndexOf(' ') + 1));
    };

    it('reports a balanced ledger as exactly zero', async () => {
      const customer = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      await payments.capture({
        userId: customer.user.id,
        partnerId: partner.id,
        amount: '5000',
        sourceToken: 'tok_ok',
        idempotencyKey: 'metrics-1',
      });

      const body = await metrics.scrape();
      expect(valueOf(body, 'tutak_ledger_imbalance_amd')).toBe(0);
      // And the individual accounts are real, not a hardcoded zero: the
      // acquirer owes us the captured amount.
      expect(
        valueOf(body, 'tutak_ledger_account_balance_amd{account="PSP_RECEIVABLE"'),
      ).toBe(5000);
    });

    it('reports a broken ledger as non-zero', async () => {
      const customer = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      await payments.capture({
        userId: customer.user.id,
        partnerId: partner.id,
        amount: '5000',
        sourceToken: 'tok_ok',
        idempotencyKey: 'metrics-2',
      });

      const account = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: LedgerAccountType.PSP_RECEIVABLE },
      });
      await prisma.ledgerAccount.update({
        where: { id: account.id },
        data: { balance: account.balance.plus(250) },
      });

      // The check that makes the gauge worth having. A metric that reads
      // zero whatever happens is decoration.
      const body = await metrics.scrape();
      expect(valueOf(body, 'tutak_ledger_imbalance_amd')).toBe(250);
    });

    it('counts what is waiting: outbox events and pending payouts', async () => {
      const customer = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      await payments.capture({
        userId: customer.user.id,
        partnerId: partner.id,
        amount: '3000',
        sourceToken: 'tok_ok',
        idempotencyKey: 'metrics-3',
      });

      const body = await metrics.scrape();
      expect(valueOf(body, 'tutak_outbox_pending')).toBeGreaterThan(0);
      expect(valueOf(body, 'tutak_outbox_dead_lettered')).toBe(0);
      expect(valueOf(body, 'tutak_wallets_total')).toBe(1);
    });

    it('says a reconciliation has never run rather than implying it just did', async () => {
      const body = await metrics.scrape();
      // Zero would read as "reconciled a moment ago" on a dashboard, which
      // is the opposite of the truth on a fresh deployment.
      expect(valueOf(body, 'tutak_reconciliation_age_seconds')).toBe(-1);
    });
  });
});
