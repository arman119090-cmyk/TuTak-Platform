import { SmsBudgetService } from './sms-budget.service';
import { SmsProvider } from './sms-provider.interface';

/**
 * Wraps whichever transport is configured so that the global budget is
 * charged before a message can leave.
 *
 * Placed here rather than in each flow on purpose: `AuthOtpService`,
 * `PhoneVerificationService` and `PasswordService` all resolve
 * `SMS_PROVIDER`, so decorating that one token covers every SMS this
 * platform sends — including any added later, which is the case a
 * per-flow check would miss.
 */
export class BudgetedSmsProvider implements SmsProvider {
  readonly name: string;

  constructor(
    private readonly inner: SmsProvider,
    private readonly budget: SmsBudgetService,
  ) {
    this.name = `budgeted:${inner.name}`;
  }

  /**
   * Claims budget first, and only then sends. A claim that throws stops the
   * message; a send that throws has still spent its unit, which is the
   * conservative direction — a carrier that accepted the request and then
   * failed may well have delivered it, and may well bill for it.
   */
  async send(params: { to: string; body: string }): Promise<{ providerMessageId: string | null }> {
    await this.budget.claim();
    return this.inner.send(params);
  }
}
