import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * A caller retrying a stuck request must not be blocked forever by the
 * attempt that got stuck. Past this age, an IN_FLIGHT row is treated as
 * abandoned (its process presumably crashed) and is fair game to reclaim.
 */
const DEFAULT_LEASE_MS = 30_000;

export const IDEMPOTENCY_LEASE_MS = DEFAULT_LEASE_MS;

export interface IdempotencyParams {
  /** Actor-scoped namespace — never a bare key, or one account can replay another's. */
  scope: string;
  key: string;
  /** The request body, hashed to detect a key reused with a different payload. */
  request: unknown;
  leaseMs?: number;
}

/** Exported so tests can construct fixtures whose hash actually matches a given request. */
export function hashIdempotencyRequest(request: unknown): string {
  return createHash('sha256').update(JSON.stringify(request ?? null)).digest('hex');
}

/**
 * The IN_FLIGHT protocol for `IdempotencyRecord`.
 *
 * Three things make this correct under concurrency, all resting on the
 * `@@unique([scope, key])` constraint rather than an application-level check:
 *
 *  1. Claiming the key is a single INSERT. Two racing callers both attempt
 *     it; Postgres lets exactly one through and the loser gets a unique
 *     violation, not a read-then-write race.
 *  2. A key already COMPLETED returns the stored result without calling
 *     `fn` again — replaying a mutation is the entire point of idempotency.
 *  3. A key stuck IN_FLIGHT past its lease is reclaimed by a conditional
 *     UPDATE (`status = IN_FLIGHT AND createdAt < staleBefore`), so a
 *     process that crashed mid-request does not wedge the key permanently.
 *     A `fn` failure deletes the row outright instead of waiting out the
 *     lease — there is no reason to make a caller wait to retry a request
 *     that is already known to have failed.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(params: IdempotencyParams, fn: () => Promise<T>): Promise<T> {
    const { scope, key } = params;
    const requestHash = hashIdempotencyRequest(params.request);
    const leaseMs = params.leaseMs ?? DEFAULT_LEASE_MS;

    const claimed = await this.claim(scope, key, requestHash, leaseMs);
    if (claimed === 'own') {
      return this.execute(scope, key, fn);
    }
    return claimed as T;
  }

  /**
   * Returns `'own'` when this call won the right to execute `fn`, or the
   * previously stored result if the key was already completed.
   */
  private async claim(
    scope: string,
    key: string,
    requestHash: string,
    leaseMs: number,
  ): Promise<'own' | unknown> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: { scope, key, requestHash, status: 'IN_FLIGHT' },
      });
      return 'own';
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
        throw err;
      }
    }

    const existing = await this.prisma.idempotencyRecord.findUniqueOrThrow({
      where: { scope_key: { scope, key } },
    });

    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency key was already used with a different request body',
      );
    }

    if (existing.status === 'COMPLETED') {
      return existing.responseBody;
    }

    // Still IN_FLIGHT. Reclaim only if the lease has lapsed; otherwise this
    // really is a concurrent duplicate of a request that is actively running.
    const staleBefore = new Date(Date.now() - leaseMs);
    if (existing.createdAt > staleBefore) {
      throw new ConflictException('An identical request is already in progress');
    }

    const reclaimed = await this.prisma.idempotencyRecord.updateMany({
      where: { scope, key, status: 'IN_FLIGHT', createdAt: { lt: staleBefore } },
      data: { createdAt: new Date() },
    });
    if (reclaimed.count === 0) {
      // Lost the reclaim race to another caller doing the same thing.
      throw new ConflictException('An identical request is already in progress');
    }
    return 'own';
  }

  private async execute<T>(scope: string, key: string, fn: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await fn();
    } catch (err) {
      // Failed work leaves nothing to replay — delete rather than mark
      // FAILED, so the very next attempt with the same key claims cleanly
      // instead of waiting out the lease.
      await this.prisma.idempotencyRecord.deleteMany({ where: { scope, key } });
      throw err;
    }

    await this.prisma.idempotencyRecord.updateMany({
      where: { scope, key },
      data: {
        status: 'COMPLETED',
        responseBody: (result ?? null) as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    return result;
  }
}
