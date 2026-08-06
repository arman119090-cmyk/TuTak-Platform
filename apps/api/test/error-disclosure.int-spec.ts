import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient, TransactionStatus, TransactionType } from '@prisma/client';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Regression suite for docs/AUDIT_2026-08-B.md §H4 and §H9.
 *
 * §H4 — any error the application did not deliberately raise had its own
 * message returned to the client with a 500. Prisma's messages embed the
 * failing query and its arguments, the database host, and the table and
 * constraint names behind a CHECK violation.
 *
 * §H9 — partner analytics loaded every matching transaction into memory and
 * summed money with `Number()`.
 */
describe('Error disclosure and analytics (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let analytics: AnalyticsService;
  let transactions: TransactionsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    analytics = harness.app.get(AnalyticsService);
    transactions = harness.app.get(TransactionsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  // ── §H4 ────────────────────────────────────────────────────────────────

  describe('the exception filter', () => {
    const filter = new AllExceptionsFilter();

    /** Captures what the filter would actually put on the wire. */
    const render = (exception: unknown) => {
      const payload: { status?: number; body?: Record<string, unknown> } = {};
      const host = {
        switchToHttp: () => ({
          getResponse: () => ({
            status(code: number) {
              payload.status = code;
              return {
                json(body: Record<string, unknown>) {
                  payload.body = body;
                },
              };
            },
          }),
          getRequest: () => ({ method: 'POST', url: '/v1/test' }),
        }),
      } as unknown as ArgumentsHost;

      filter.catch(exception, host);
      return payload;
    };

    it('never returns the message of an error the application did not raise', () => {
      // Standing in for a PrismaClientValidationError, whose real message
      // contains the full query text and its arguments.
      const leaky = new Error(
        'Invalid `prisma.user.findUnique()` invocation: connection to db.internal:5432 failed',
      );

      const { status, body } = render(leaky);

      expect(status).toBe(500);
      expect(body!.message).toBe('Internal server error');
      expect(JSON.stringify(body)).not.toContain('db.internal');
      expect(JSON.stringify(body)).not.toContain('prisma.user.findUnique');
    });

    it('attaches a correlation id so a redacted 500 is still traceable', () => {
      const { body } = render(new Error('something internal'));
      expect(typeof body!.incidentId).toBe('string');
    });

    it('does not leak a CHECK constraint name', async () => {
      const { wallet } = await createCustomer(prisma);

      // Real violation: the migration's wallets_balances_non_negative.
      const raw = await prisma
        .$executeRawUnsafe(`UPDATE "wallets" SET "availableBonus" = -1 WHERE id = '${wallet.id}'`)
        .catch((e: unknown) => e);

      // Raw-query violations surface as a known Prisma error, so this is a
      // 400 rather than a 500; what matters is that neither the constraint
      // nor the table it guards reaches the client.
      const { status, body } = render(raw);
      expect(status).toBe(400);
      expect(body!.message).toBe('Database request error');
      expect(JSON.stringify(body)).not.toContain('wallets_balances_non_negative');
      expect(JSON.stringify(body)).not.toContain('availableBonus');
    });

    it('still returns messages the application wrote for the caller', () => {
      expect(render(new BadRequestException('Bonus applied cannot exceed the payment amount')))
        .toMatchObject({
          status: 400,
          body: { message: 'Bonus applied cannot exceed the payment amount' },
        });
      expect(render(new NotFoundException('QR code not found'))).toMatchObject({
        status: 404,
        body: { message: 'QR code not found' },
      });
    });

    it('reports a duplicate without naming the constrained columns', () => {
      const duplicate = Object.assign(
        new Error('Unique constraint failed on the fields: (`taxId`)'),
        { code: 'P2002', clientVersion: '6.19.3' },
      );
      Object.setPrototypeOf(
        duplicate,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@prisma/client').Prisma.PrismaClientKnownRequestError.prototype,
      );

      const { status, body } = render(duplicate);
      expect(status).toBe(409);
      expect(JSON.stringify(body)).not.toContain('taxId');
    });
  });

  // ── §H9 ────────────────────────────────────────────────────────────────

  describe('partner analytics', () => {
    const purchase = async (userId: string, partnerId: string, amount: string) => {
      const tx = await transactions.create({
        userId,
        partnerId,
        type: TransactionType.QR_PAYMENT,
        amount,
        bonusAppliedAmount: '0.0001',
      });
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { status: TransactionStatus.COMPLETED, bonusEarnedAmount: '0.1' },
      });
      return tx;
    };

    it('sums money exactly, without a float round trip', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);

      // 0.1 + 0.2 is 0.30000000000000004 in IEEE 754; three of them summed as
      // floats drift from the figure the partner is owed.
      await purchase(user.id, partner.id, '0.1');
      await purchase(user.id, partner.id, '0.2');
      await purchase(user.id, partner.id, '0.3');

      const report = await analytics.partnerAnalytics(partner.id);
      expect(report.totalRevenue).toBe('0.6000');
      expect(report.totalBonusIssued).toBe('0.3000');
      expect(report.totalBonusRedeemed).toBe('0.0003');
    });

    it('counts distinct customers, not transactions', async () => {
      const partner = await createPartner(prisma);
      const a = await createCustomer(prisma);
      const b = await createCustomer(prisma);
      await purchase(a.user.id, partner.id, '100');
      await purchase(a.user.id, partner.id, '200');
      await purchase(b.user.id, partner.id, '300');

      const report = await analytics.partnerAnalytics(partner.id);
      expect(report.totalTransactions).toBe(3);
      expect(report.uniqueCustomers).toBe(2);
    });

    it('excludes transactions that never completed', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      await purchase(user.id, partner.id, '500');
      await transactions.create({
        userId: user.id,
        partnerId: partner.id,
        type: TransactionType.QR_PAYMENT,
        amount: '9999',
      });

      const report = await analytics.partnerAnalytics(partner.id);
      expect(report.totalRevenue).toBe('500.0000');
    });

    it('honours the date window', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const old = await purchase(user.id, partner.id, '100');
      await prisma.transaction.update({
        where: { id: old.id },
        data: { createdAt: new Date('2020-01-01') },
      });
      await purchase(user.id, partner.id, '200');

      const report = await analytics.partnerAnalytics(partner.id, new Date('2024-01-01'));
      expect(report.totalRevenue).toBe('200.0000');
    });

    it('returns zeroes rather than null for a partner with no history', async () => {
      const partner = await createPartner(prisma);
      const report = await analytics.partnerAnalytics(partner.id);

      expect(report).toMatchObject({
        totalTransactions: 0,
        totalRevenue: '0.0000',
        totalBonusIssued: '0.0000',
        uniqueCustomers: 0,
      });
    });
  });
});
