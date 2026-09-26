import { SmsMessage, SmsProvider } from '../../src/infrastructure/sms/sms-provider.interface';

/**
 * Captures messages instead of sending them, and lets a test read the code
 * out of the one place a code is allowed to exist.
 *
 * The suites that needed a verification code used to take it from the
 * notification row the service also wrote — which is exactly the leak the
 * code no longer has. A test that reaches for a secret through the same
 * route an attacker would is a test that keeps that route open: the day the
 * leak is closed, the test fails, and the cheapest way to make it pass again
 * is to reopen it.
 *
 * So the code comes from the carrier hand-off, where it always belonged.
 */
export class RecordingSmsProvider implements SmsProvider {
  readonly name = 'recording';
  readonly sent: SmsMessage[] = [];

  send(message: SmsMessage): Promise<{ providerMessageId: string | null }> {
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `recorded-${this.sent.length}` });
  }

  clear(): void {
    this.sent.length = 0;
  }

  /** Everything sent to one number, oldest first. */
  to(phone: string): SmsMessage[] {
    return this.sent.filter((message) => message.to === phone);
  }

  /**
   * The code in the most recent message to a number.
   *
   * Read from `templateParams`, which is the carrier-facing field and the
   * one Viva actually receives — the rendered `body` is a convenience for
   * carriers that take free text and is not what reaches the handset here.
   */
  lastCodeTo(phone: string): string {
    const messages = this.to(phone);
    const last = messages.at(-1);
    if (!last) throw new Error(`No SMS was sent to ${phone}`);
    const code = last.templateParams?.[0];
    if (!code) throw new Error(`The last SMS to ${phone} carried no code`);
    return code;
  }
}
