import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { hashIdempotencyRequest, IdempotencyService } from '../src/modules/ledger/idempotency.service';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { TEST_DATABASE_URL } from './setup/test-database';

/**
 * Financial core, phase 2: the IN_FLIGHT claim/complete protocol behind
 * `IdempotencyRecord`. Every scenario here is a concrete way a client retry
 * could otherwise double-charge, double-refund or double-payout — the
 * engines built on top of this (phases 3-5) rely on `run()` being the only
 * way in.
 */
describe('IdempotencyService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let idempotency: IdempotencyService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    idempotency = harness.app.get(IdempotencyService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('executes the work once and returns its result', async () => {
    const result = await idempotency.run(
      { scope: 'payment:user-1', key: 'req-1', request: { amount: '100' } },
      () => Promise.resolve({ chargeId: 'ch_1' }),
    );

    expect(result).toEqual({ chargeId: 'ch_1' });
    const row = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: { scope_key: { scope: 'payment:user-1', key: 'req-1' } },
    });
    expect(row.status).toBe('COMPLETED');
    expect(row.responseBody).toEqual({ chargeId: 'ch_1' });
  });

  it('replays the stored result instead of re-running the work', async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      return Promise.resolve({ chargeId: `ch_${calls}` });
    };

    const first = await idempotency.run(
      { scope: 'payment:user-1', key: 'req-1', request: { amount: '100' } },
      fn,
    );
    const second = await idempotency.run(
      { scope: 'payment:user-1', key: 'req-1', request: { amount: '100' } },
      fn,
    );

    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it('scopes keys per actor, so two scopes with the same key do not collide', async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      return Promise.resolve({ n: calls });
    };

    const a = await idempotency.run({ scope: 'payment:user-1', key: 'req-1', request: {} }, fn);
    const b = await idempotency.run({ scope: 'payment:user-2', key: 'req-1', request: {} }, fn);

    expect(calls).toBe(2);
    expect(a).not.toEqual(b);
  });

  it('rejects the same key reused with a different request body', async () => {
    await idempotency.run(
      { scope: 'payment:user-1', key: 'req-1', request: { amount: '100' } },
      () => Promise.resolve({ chargeId: 'ch_1' }),
    );

    await expect(
      idempotency.run(
        { scope: 'payment:user-1', key: 'req-1', request: { amount: '999' } },
        () => Promise.resolve({ chargeId: 'ch_2' }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('runs the work exactly once when two callers race the same key', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { chargeId: 'ch_1' };
    };

    const results = await Promise.allSettled([
      idempotency.run({ scope: 'payment:user-1', key: 'req-1', request: {} }, fn),
      idempotency.run({ scope: 'payment:user-1', key: 'req-1', request: {} }, fn),
    ]);

    expect(calls).toBe(1);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    // Whichever caller lost the claim gets a 409, not a silent second execution.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
  });

  it('replays a completed key without provoking a database error', async () => {
    // Losing the claim race is the ordinary outcome of a phone retrying on a
    // bad connection, not a fault. Claiming used to be an INSERT with the
    // unique violation caught — correct, but PrismaService logs every query
    // error event at ERROR level, so a load test of this exact path produced
    // 12,836 ERROR lines and would have paged an on-call engineer through
    // every patchy evening on the Armenian mobile network. The claim is now
    // `INSERT … ON CONFLICT DO NOTHING`, which returns a count instead of
    // raising.
    //
    // The listener has to be attached to a client of our own: the harness
    // overrides PrismaService with a plain PrismaClient carrying no log
    // events, so a spy on the logger here would pass either way — which is
    // worse than having no test, because it would look like a guard.
    const client = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
      log: [{ emit: 'event', level: 'error' }],
    });
    const errors: unknown[] = [];
    client.$on('error', (event) => errors.push(event));

    try {
      const scoped = new IdempotencyService(client as never);
      const stored = { chargeId: 'ch_1' };
      await idempotency.run({ scope: 'payment:user-1', key: 'req-1', request: {} }, () =>
        Promise.resolve(stored),
      );

      const replays = await Promise.all(
        Array.from({ length: 20 }, () =>
          scoped.run({ scope: 'payment:user-1', key: 'req-1', request: {} }, () =>
            Promise.reject(new Error('the work must not run again')),
          ),
        ),
      );

      expect(replays).toEqual(Array.from({ length: 20 }, () => stored));
      expect(errors).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });

  it('deletes the record on failure so an immediate retry can claim cleanly', async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('downstream unavailable'));
      return Promise.resolve({ chargeId: 'ch_1' });
    };

    await expect(
      idempotency.run({ scope: 'payment:user-1', key: 'req-1', request: {} }, fn),
    ).rejects.toThrow('downstream unavailable');

    expect(await prisma.idempotencyRecord.count()).toBe(0);

    const result = await idempotency.run(
      { scope: 'payment:user-1', key: 'req-1', request: {} },
      fn,
    );
    expect(calls).toBe(2);
    expect(result).toEqual({ chargeId: 'ch_1' });
  });

  it('reclaims a key stuck IN_FLIGHT past its lease, as if the original caller crashed', async () => {
    await prisma.idempotencyRecord.create({
      data: {
        scope: 'payment:user-1',
        key: 'req-1',
        requestHash: hashIdempotencyRequest(null),
        status: 'IN_FLIGHT',
        createdAt: new Date(Date.now() - 60_000),
      },
    });

    // A tiny lease makes the fixture's one-minute-old row already stale.
    const result = await idempotency.run(
      { scope: 'payment:user-1', key: 'req-1', request: null, leaseMs: 1_000 },
      () => Promise.resolve({ chargeId: 'ch_reclaimed' }),
    );

    expect(result).toEqual({ chargeId: 'ch_reclaimed' });
  });

  it('refuses to reclaim a key still inside its lease', async () => {
    await prisma.idempotencyRecord.create({
      data: {
        scope: 'payment:user-1',
        key: 'req-1',
        requestHash: hashIdempotencyRequest(null),
        status: 'IN_FLIGHT',
      },
    });

    await expect(
      idempotency.run(
        { scope: 'payment:user-1', key: 'req-1', request: null, leaseMs: 30_000 },
        () => Promise.resolve({ chargeId: 'should-not-run' }),
      ),
    ).rejects.toThrow(ConflictException);
  });
});
