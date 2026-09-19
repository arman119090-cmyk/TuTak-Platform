import { Injectable } from '@nestjs/common';

/**
 * Time as a dependency.
 *
 * Expiry, SLA deadlines, rolling limit windows and lease timeouts are all
 * time-dependent, and a test that has to sleep for a real minute is a test
 * nobody runs. Everything that asks "what time is it" asks this.
 */
export abstract class Clock {
  abstract now(): Date;

  nowMs(): number {
    return this.now().getTime();
  }

  plusSeconds(seconds: number): Date {
    return new Date(this.nowMs() + seconds * 1000);
  }
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

/** Used by tests to move time deliberately. */
export class FixedClock extends Clock {
  constructor(private current: Date = new Date('2026-01-01T00:00:00.000Z')) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }
}
