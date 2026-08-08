import { ConsoleLogger, LoggerService, LogLevel } from '@nestjs/common';
import { requestContext } from './request-context';
import { activeTraceId } from './tracing';

/**
 * Fields every line carries, whatever produced it. A log aggregator can
 * filter on these without knowing anything about the message text.
 */
interface LogRecord {
  timestamp: string;
  level: string;
  context?: string;
  message: string;
  requestId?: string;
  userId?: string;
  method?: string;
  path?: string;
  /**
   * Present only when tracing is switched on. It is what lets an operator
   * jump from a log line to the trace it came from, and back — without it,
   * logs and traces are two views of the same incident that cannot be
   * joined.
   */
  traceId?: string;
  stack?: string;
}

/**
 * JSON logs in production, the familiar Nest format everywhere else.
 *
 * The reason for the split: a human reading `pnpm dev` wants colour and
 * alignment, and a log aggregator wants one JSON object per line and nothing
 * else. Producing the human format in production is what turns "find every
 * error for this user in the last hour" from a query into a grep, and
 * producing JSON in development makes the terminal unreadable. Neither
 * format is right for both.
 *
 * Every line is stamped with the active request's id from
 * `AsyncLocalStorage`, so a stack trace and the lines around it can be pulled
 * back together even though production interleaves requests.
 */
export class StructuredLogger extends ConsoleLogger implements LoggerService {
  constructor(private readonly asJson: boolean) {
    super();
  }

  override log(message: unknown, context?: string) {
    this.emit('info', message, context);
  }

  /**
   * Nest overloads the second argument: it is a stack trace when a stack was
   * available and the logging context otherwise, with no marker to tell them
   * apart. Multi-line is the only signal there is — a context is a class
   * name, a stack never fits on one line. Resolving the ambiguity here keeps
   * it out of `emit`.
   */
  override error(message: unknown, stackOrContext?: string, context?: string) {
    const isStack = !!stackOrContext && stackOrContext.includes('\n');
    if (!this.asJson) {
      super.error(message, stackOrContext, context);
      return;
    }
    this.emit(
      'error',
      message,
      isStack ? context : (context ?? stackOrContext),
      isStack ? stackOrContext : undefined,
    );
  }

  override warn(message: unknown, context?: string) {
    this.emit('warn', message, context);
  }

  override debug(message: unknown, context?: string) {
    this.emit('debug', message, context);
  }

  override verbose(message: unknown, context?: string) {
    this.emit('verbose', message, context);
  }

  private emit(level: LogLevel | 'info', message: unknown, context?: string, stack?: string) {
    if (!this.asJson) {
      // Delegate to Nest's own formatting so local output looks exactly as it
      // always has — colour, padding, timing deltas and all.
      const nestLevel = level === 'info' ? 'log' : level;
      (super[nestLevel as 'log'] as (m: unknown, c?: string) => void).call(this, message, context);
      return;
    }

    const ctx = requestContext.get();
    const traceId = activeTraceId();
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
      ...(ctx?.userId ? { userId: ctx.userId } : {}),
      ...(ctx?.method ? { method: ctx.method } : {}),
      ...(ctx?.path ? { path: ctx.path } : {}),
      ...(traceId ? { traceId } : {}),
      ...(stack ? { stack } : {}),
    };

    const line = JSON.stringify(record);
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }
}
