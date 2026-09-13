import { ArgumentsHost } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What an account with no wallet row gets back, and why it matters.
 *
 * Every user the application itself creates has a wallet: `createCustomer`
 * makes the two in one statement, so the pair is inseparable for anyone who
 * registers. `seed-baseline` deliberately does not — the bootstrap
 * administrator is not a customer, and `seed-baseline.spec.ts` holds that
 * decision in place on purpose.
 *
 * The consequence surfaced on a handset: signed in as that administrator,
 * the customer app's home screen and wallet screen both showed "Something
 * went wrong". Not a crash, not a network fault — three 404s for a state
 * that is not an error at all, presented to the person as if the app had
 * broken.
 *
 * This suite pins what the server actually answers, so the client can be
 * written against a known contract rather than a guess: all three wallet
 * reads refuse, and every one of them refuses as 404 — including the two
 * that reach `findUniqueOrThrow` and would otherwise surface as a Prisma
 * fault. That last part is the bit worth a regression test: it holds only
 * because `AllExceptionsFilter` maps P2025, and nothing else in these
 * suites covers that path for this route.
 */
describe('Wallet reads for an account with no wallet (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let wallet: WalletService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    wallet = harness.app.get(WalletService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /**
   * What the filter would actually put on the wire, so these assertions are
   * about the status the app receives rather than the class of the exception
   * that happened to be thrown.
   */
  const statusOnTheWire = async (work: Promise<unknown>) => {
    let thrown: unknown;
    try {
      await work;
      return 200;
    } catch (error) {
      thrown = error;
    }
    let status: number | undefined;
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status(code: number) {
            status = code;
            return { json() {} };
          },
        }),
        getRequest: () => ({ method: 'GET', url: '/v1/wallet/me' }),
      }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(thrown, host);
    return status;
  };

  it('answers the balance with 404, not an invented zero', async () => {
    const staff = await createStaffUser(prisma);

    await expect(statusOnTheWire(wallet.getBalanceForUser(staff.id))).resolves.toBe(404);
  });

  it('answers the ledger with 404 rather than a database fault', async () => {
    const staff = await createStaffUser(prisma);

    // `getLedger` reaches `findUniqueOrThrow`, so this is 404 only because
    // the filter maps Prisma's P2025. Without that it would be a 500, and
    // the app would report a server fault for an account that is merely
    // not a customer.
    await expect(statusOnTheWire(wallet.getLedger(staff.id, { limit: 20 }))).resolves.toBe(404);
  });

  it('answers the lots with 404 rather than a database fault', async () => {
    const staff = await createStaffUser(prisma);

    await expect(statusOnTheWire(wallet.getLots(staff.id))).resolves.toBe(404);
  });

  it('serves all three once the account has a wallet', async () => {
    const staff = await createStaffUser(prisma);
    await prisma.wallet.create({ data: { userId: staff.id } });

    await expect(wallet.getBalanceForUser(staff.id)).resolves.toMatchObject({
      userId: staff.id,
    });
    await expect(wallet.getLedger(staff.id, { limit: 20 })).resolves.toMatchObject({
      items: [],
    });
    await expect(wallet.getLots(staff.id)).resolves.toEqual([]);
  });
});
