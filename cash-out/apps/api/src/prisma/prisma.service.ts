import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ENV, Env } from '../config/env';

export type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({
      datasources: { db: { url: env.DATABASE_URL } },
      log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `fn` in a serialisable transaction.
   *
   * Everything that touches money runs at SERIALIZABLE. Read-committed would let
   * two concurrent withdrawals each read the same balance and each decide it is
   * sufficient; serialisable makes the database reject one of them, and the
   * caller retries. The cost is a few retries under contention; the alternative
   * is paying the same money twice.
   */
  async inSerializableTransaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15_000,
      maxWait: 5_000,
    });
  }

  async inTransaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(fn, { timeout: 15_000, maxWait: 5_000 });
  }

  /**
   * Takes a Postgres advisory lock for the duration of `tx`.
   *
   * Used to serialise all work for one driver: the withdrawal path reads a
   * balance, checks limits and inserts a row, and those three steps must not
   * interleave with another request for the same driver. The lock is keyed by a
   * hash of the driver id and released when the transaction ends, including on
   * a crash.
   */
  async lockForUpdate(tx: TransactionClient, namespace: string, id: string): Promise<void> {
    const key = advisoryLockKey(namespace, id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key}::bigint)`;
  }

  /** Non-blocking variant, for workers that should move on rather than queue. */
  async tryLock(tx: TransactionClient, namespace: string, id: string): Promise<boolean> {
    const key = advisoryLockKey(namespace, id);
    const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${key}::bigint) AS locked
    `;
    return rows[0]?.locked === true;
  }
}

/**
 * Maps a namespace and id onto the 64-bit integer Postgres advisory locks take.
 * FNV-1a, truncated to a signed 64-bit range. Collisions are possible and
 * harmless: two unrelated ids sharing a lock costs a little contention, never
 * correctness.
 */
export function advisoryLockKey(namespace: string, id: string): bigint {
  const input = `${namespace}:${id}`;
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash ^ BigInt(input.charCodeAt(i))) * prime) & mask;
  }
  // Postgres wants a signed bigint.
  return hash >= 1n << 63n ? hash - (1n << 64n) : hash;
}

export function isSerializationFailure(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // 40001 serialization_failure, 40P01 deadlock_detected
    const code = (error.meta as { code?: string } | undefined)?.code;
    return error.code === 'P2034' || code === '40001' || code === '40P01';
  }
  const message = error instanceof Error ? error.message : '';
  return message.includes('could not serialize') || message.includes('deadlock detected');
}

export function isUniqueViolation(error: unknown, target?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  if (!target) return true;
  const meta = error.meta as { target?: string[] | string } | undefined;
  const targets = Array.isArray(meta?.target) ? meta?.target : [meta?.target];
  return (targets ?? []).some((value) => typeof value === 'string' && value.includes(target));
}
