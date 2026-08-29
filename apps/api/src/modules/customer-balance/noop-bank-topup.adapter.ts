import { Injectable, Logger } from '@nestjs/common';
import { BankTopUpAdapter, TopUpInitiateResult, TopUpWebhookResult } from './bank-topup-adapter.interface';

/**
 * No-op bank top-up adapter — active until a real bank/PSP (Idram or
 * otherwise) is configured. Same reasoning as `NoopOcpiAdapter`: this is not
 * a stub standing in for missing work, it is the correct behaviour for "no
 * provider is configured" — honestly refuse, never fabricate a successful
 * top-up nobody actually paid for.
 */
@Injectable()
export class NoopBankTopUpAdapter implements BankTopUpAdapter {
  private readonly logger = new Logger(NoopBankTopUpAdapter.name);

  initiateTopUp(): Promise<TopUpInitiateResult> {
    this.logger.warn('No bank top-up provider is configured — refusing to initiate a top-up');
    return Promise.resolve({ outcome: 'DECLINED', declineReason: 'top_up_not_configured' });
  }

  verifyTopUpWebhook(): Promise<TopUpWebhookResult | null> {
    return Promise.resolve(null);
  }
}
