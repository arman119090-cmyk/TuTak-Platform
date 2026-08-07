import { requestContext } from './request-context';
import { StructuredLogger } from './structured-logger';

/**
 * The property that makes correlation worth having: two requests in flight at
 * once must not see each other's context. If they can, every log line is
 * suspect and the ids are worse than useless — they actively mislead.
 */
describe('requestContext', () => {
  it('keeps concurrent scopes apart across await points', async () => {
    const seen: Array<string | undefined> = [];

    const request = (id: string, delay: number) =>
      requestContext.run({ requestId: id }, async () => {
        await new Promise((r) => setTimeout(r, delay));
        // Deliberately resumed after another request has started and, for the
        // slower one, after the faster has already finished.
        seen.push(requestContext.get()?.requestId);
      });

    await Promise.all([request('a', 30), request('b', 10), request('c', 20)]);

    expect(seen.sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing outside a request', () => {
    expect(requestContext.get()).toBeUndefined();
  });

  it('attaches the user to the scope already in progress', () => {
    requestContext.run({ requestId: 'r1' }, () => {
      expect(requestContext.get()?.userId).toBeUndefined();
      requestContext.setUser('user-1');
      // Same scope, not a new one: anything logged before this point still
      // belongs to the same request id.
      expect(requestContext.get()).toEqual({ requestId: 'r1', userId: 'user-1' });
    });
  });

  it('ignores a user set outside any request rather than throwing', () => {
    expect(() => requestContext.setUser('nobody')).not.toThrow();
  });
});

describe('StructuredLogger', () => {
  const captureStdout = (fn: () => void): string[] => {
    const lines: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      lines.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      fn();
    } finally {
      process.stdout.write = original;
    }
    return lines;
  };

  it('emits one JSON object per line, stamped with the active request', () => {
    const logger = new StructuredLogger(true);

    const lines = captureStdout(() => {
      requestContext.run({ requestId: 'req-1', method: 'POST', path: '/v1/payments' }, () => {
        requestContext.setUser('user-9');
        logger.log('payment captured', 'PaymentEngine');
      });
    });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'info',
      context: 'PaymentEngine',
      message: 'payment captured',
      requestId: 'req-1',
      userId: 'user-9',
      method: 'POST',
      path: '/v1/payments',
    });
    expect(lines[0]!.endsWith('\n')).toBe(true);
  });

  it('omits correlation fields entirely outside a request', () => {
    const logger = new StructuredLogger(true);
    const lines = captureStdout(() => logger.log('booting'));

    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record.message).toBe('booting');
    // Absent rather than null: a log aggregator filtering on `requestId`
    // should not match startup lines that never had one.
    expect('requestId' in record).toBe(false);
    expect('userId' in record).toBe(false);
  });

  it('sends errors to stderr, not stdout', () => {
    const logger = new StructuredLogger(true);
    const errors: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      errors.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    const stdout = captureStdout(() => logger.error('it broke', 'Error: it broke\n  at x'));
    process.stderr.write = original;

    expect(stdout).toHaveLength(0);
    expect(errors).toHaveLength(1);
    const record = JSON.parse(errors[0]!) as Record<string, unknown>;
    expect(record.level).toBe('error');
    expect(record.stack).toContain('at x');
  });

  it('does not mistake a context string for a stack trace', () => {
    // Nest passes the context in the stack position for some call shapes. A
    // one-line "stack" that is really a class name is worse than none.
    const logger = new StructuredLogger(true);
    const errors: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      errors.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    logger.error('failed', 'WalletService');
    process.stderr.write = original;

    const record = JSON.parse(errors[0]!) as Record<string, unknown>;
    expect('stack' in record).toBe(false);
  });

  it('leaves development output to Nest rather than emitting JSON', () => {
    const logger = new StructuredLogger(false);
    const lines = captureStdout(() => logger.log('hello', 'Dev'));

    // Whatever Nest printed, it is not a bare JSON object — the local
    // terminal keeps the format a human can read.
    const combined = lines.join('');
    expect(() => JSON.parse(combined.trim())).toThrow();
    expect(combined).toContain('hello');
  });
});
