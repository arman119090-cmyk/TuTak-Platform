import { Logger } from '@nestjs/common';
import { Alert, AlertChannel } from './alert-channel.interface';

/**
 * Where alerts go when no webhook is configured — development, and tests.
 *
 * Deliberately logged at `error` even for warnings, so an alert stands out
 * from ordinary log traffic during development. The point of the local
 * channel is that someone building a feature notices they have just tripped
 * a money alert.
 */
export class ConsoleAlertChannel implements AlertChannel {
  readonly name = 'console';
  private readonly logger = new Logger('Alert');

  // Not `async`: there is nothing to await, and the interface's Promise is
  // for the transports that do have I/O.
  send(alert: Alert): Promise<void> {
    const context = Object.entries(alert.context ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    this.logger.error(
      `[${alert.severity}] ${alert.title} — ${alert.body}${context ? ` (${context})` : ''}`,
    );
    return Promise.resolve();
  }
}
