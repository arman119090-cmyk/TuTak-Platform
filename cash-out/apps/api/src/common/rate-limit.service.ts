import { Injectable } from '@nestjs/common';
import { AppError } from './app-error';
import { Clock } from './clock';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * A fixed-window counter, keyed by whatever the caller chooses.
 *
 * Deliberately *not* one global bucket: the key always names the dimension being
 * protected (`otp:phone:+374…`, `otp:ip:1.2.3.4`, `withdraw:driver:<id>`), so
 * one noisy phone cannot lock out every other driver — a mistake that is easy to
 * make and expensive to discover in production.
 *
 * The in-memory implementation is correct for a single instance. `RATE_LIMIT`
 * is an interface so that a Redis-backed implementation can replace it without
 * touching a single call site; running more than one API instance requires that
 * swap, and the deployment notes say so.
 */
export abstract class RateLimiter {
  abstract consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  abstract reset(key: string): Promise<void>;
  /** Drops every bucket. Only tests and an operator-triggered flush use this. */
  abstract resetAll(): Promise<void>;

  async enforce(key: string, limit: number, windowSeconds: number): Promise<void> {
    const result = await this.consume(key, limit, windowSeconds);
    if (!result.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many requests', {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
  }
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

@Injectable()
export class InMemoryRateLimiter extends RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly clock: Clock) {
    super();
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = this.clock.nowMs();
    this.sweep(now);

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.count += 1;
    return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  async resetAll(): Promise<void> {
    this.buckets.clear();
  }

  private sweep(now: number): void {
    if (this.buckets.size < 10_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
