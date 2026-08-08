import { Alert, AlertChannel } from '../../src/infrastructure/alerts/alert-channel.interface';

/**
 * Captures alerts instead of delivering them.
 *
 * Tests assert on what an operator would actually receive, not on whether a
 * service called a method — the difference matters, because suppression sits
 * between the two and a suppressed alert wakes nobody.
 */
export class RecordingAlertChannel implements AlertChannel {
  readonly name = 'recording';
  readonly sent: Alert[] = [];

  send(alert: Alert): Promise<void> {
    this.sent.push(alert);
    return Promise.resolve();
  }

  clear(): void {
    this.sent.length = 0;
  }

  /** The alerts whose key starts with `prefix`, e.g. `outbox.dead-letter`. */
  matching(prefix: string): Alert[] {
    return this.sent.filter((a) => a.key.startsWith(prefix));
  }
}
