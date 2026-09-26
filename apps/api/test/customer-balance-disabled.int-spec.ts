import { Currency, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CustomerBalanceService } from '../src/modules/customer-balance/customer-balance.service';
import {
  BANK_TOPUP_ADAPTER,
  BankTopUpAdapter,
} from '../src/modules/customer-balance/bank-topup-adapter.interface';
import { NoopBankTopUpAdapter } from '../src/modules/customer-balance/noop-bank-topup.adapter';
import { createCustomer } from './setup/fixtures';
import { HttpTestHarness, createHttpTestHarness, truncateAll } from './setup/harness';

/**
 * What a production deployment looks like: customer top-ups off.
 *
 * TuTak is not an issuer of electronic money. A stored balance a customer
 * pays into in advance is a deposit, and who may legally hold one — a
 * licensed provider, or TuTak on its own merchant account — is unresolved
 * (15.09.2026). The code that funds such a balance exists because the EV
 * roaming design needed the *spending* half of it; that is not a reason to
 * leave the paying-in half reachable.
 *
 * So this suite asserts the default, which is the state production runs in.
 * The sibling `customer-balance.int-spec.ts` turns the flag on and tests the
 * mechanism; neither file is meaningful without the other.
 *
 * The distinction being drawn, and it is the point of the whole design: what
 * is closed is **crediting** the balance. Reading one and spending one stay
 * open, because a customer who already holds a balance must not have it
 * stranded by a feature being switched off around them.
 */
describe('Customer prepaid balance, disabled (integration)', () => {
  let harness: HttpTestHarness;
  let prisma: PrismaClient;
  let balance: CustomerBalanceService;

  const savedFlag = process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;

  beforeAll(async () => {
    // Explicitly cleared rather than merely left alone: the assertion is
    // about the default, and a test that passes only because the runner
    // happened not to set a variable proves nothing about production.
    delete process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;
    harness = await createHttpTestHarness();
    prisma = harness.prisma;
    balance = harness.app.get(CustomerBalanceService);
  });

  afterAll(async () => {
    if (savedFlag === undefined) delete process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;
    else process.env.CUSTOMER_PREPAID_TOPUP_ENABLED = savedFlag;
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const url = (path: string) => `${harness.baseUrl}/v1${path}`;

  describe('the public surface', () => {
    /**
     * 404 rather than 403, and that is deliberate. The controller is not
     * registered at all, so there is no route to refuse — an unauthenticated
     * caller cannot even learn that this deployment has a balance feature
     * switched off.
     */
    it('has no top-up route to call', async () => {
      const response = await fetch(url('/balance/topup'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: '5000' }),
      });
      expect(response.status).toBe(404);
    });

    it('has no provider webhook to call either', async () => {
      // The one route on this controller that is `@Public()`, and therefore
      // the one that would be reachable from the internet if it existed.
      const response = await fetch(url('/balance/topup/webhook'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerReference: 'anything', outcome: 'COMPLETED' }),
      });
      expect(response.status).toBe(404);
    });

    it('has no balance route to read', async () => {
      const response = await fetch(url('/balance/me'));
      expect(response.status).toBe(404);
    });
  });

  describe('the service behind it', () => {
    it('refuses to credit a balance even when called directly', async () => {
      const { user } = await createCustomer(prisma);
      await expect(balance.initiateTopUp(user.id, '5000')).rejects.toThrow(/not enabled/i);
      expect(await prisma.balanceTopUp.count()).toBe(0);
    });

    it('refuses a provider webhook before the adapter is even consulted', async () => {
      await expect(balance.confirmTopUpWebhook({ providerReference: 'x' }, {})).rejects.toThrow(
        /not enabled/i,
      );
    });

    /**
     * The half that stays open. A customer whose balance was funded before
     * the feature was closed — or through the EV roaming path — must still
     * be able to see it and spend it.
     */
    it('still reads a balance', async () => {
      const { user } = await createCustomer(prisma);
      expect(await balance.getBalance(user.id)).toEqual({ balance: '0.0000', currency: 'AMD' });
    });

    it('still lets the roaming path spend one', async () => {
      const { user } = await createCustomer(prisma);
      // Nothing funded, so there is nothing to collect — the point is that
      // this returns an answer rather than throwing the way crediting does.
      await expect(
        balance.collectFromBalance(user.id, new Decimal('100'), Currency.AMD, 'no-such-transaction'),
      ).resolves.toBe(false);
    });
  });

  /**
   * Idram collects a purchase the customer is making now. Wiring it here
   * would turn a payment rail into a deposit-taking one, which is the exact
   * thing the flag above exists to prevent — so the adapter is asserted, not
   * assumed.
   */
  it('has no real bank wired to it', () => {
    const adapter = harness.app.get<BankTopUpAdapter>(BANK_TOPUP_ADAPTER);
    expect(adapter).toBeInstanceOf(NoopBankTopUpAdapter);
  });
});
