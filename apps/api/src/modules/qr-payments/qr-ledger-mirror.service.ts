import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Currency, LedgerAccountType, PostingDirection } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { LedgerService } from '../ledger/ledger.service';

export interface MirrorParams {
  transactionId: string;
  partnerId: string;
  /** Total charged, before any bonus was applied. */
  amount: Decimal;
  /** The portion paid with points rather than money. */
  bonusApplied: Decimal;
  currency?: Currency;
}

/**
 * Phase 4 of docs/FINANCIAL_CORE_DESIGN.md, in its safe half.
 *
 * The QR path predates the double-entry ledger and still settles bonus on
 * its own. §9 marks routing it through the payment engine as the high-risk
 * step and calls for a dual-write period, reconciled over at least one full
 * settlement cycle, before the old path is removed. This is that dual write:
 * the QR flow stays authoritative for everything the customer is told, and
 * this mirrors the same money into the ledger so the two can be compared.
 *
 * Three properties keep it safe to switch on in production:
 *
 *  1. **Off by default.** `FEATURE_QR_LEDGER_MIRROR` must be set explicitly.
 *  2. **Additive.** It only writes ledger postings. Nothing reads them yet,
 *     and no existing behaviour changes.
 *  3. **Never fatal.** A failure here is logged and swallowed. A mirror that
 *     could fail a customer's payment would be strictly worse than no
 *     mirror — the whole point is that the old path is still the one that
 *     matters.
 *
 * When reconciliation has run clean across a settlement cycle, the mirror
 * becomes the source and the old path goes. Until then it is evidence.
 */
@Injectable()
export class QrLedgerMirrorService {
  private readonly logger = new Logger(QrLedgerMirrorService.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly ledger: LedgerService,
  ) {}

  get enabled(): boolean {
    return this.config.get('features.qrLedgerMirror', { infer: true });
  }

  /**
   * Mirrors one redeemed QR payment.
   *
   * Deliberately returns void and never throws: callers are on the customer's
   * critical path and must not learn that this exists.
   */
  async mirror(params: MirrorParams): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.post(params);
    } catch (err) {
      // Swallowed on purpose. The ledger falling behind is a reconciliation
      // finding, which is exactly what the dual-write period is for; a
      // customer's payment failing because a shadow write failed is not.
      this.logger.error(
        `QR ledger mirror failed for transaction ${params.transactionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async post(params: MirrorParams): Promise<void> {
    const currency = params.currency ?? Currency.AMD;
    const cash = params.amount.minus(params.bonusApplied);

    // A redemption paid entirely in points moves no money between the
    // customer, the acquirer and the partner — only the bonus liability
    // changes, and the bonus ledger already records that.
    if (cash.lessThanOrEqualTo(0)) return;

    const [pspAccount, partnerAccount, liabilityAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PSP_RECEIVABLE, currency }),
      this.ledger.accountFor({
        type: LedgerAccountType.PARTNER_PAYABLE,
        partnerId: params.partnerId,
        currency,
      }),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY, currency }),
    ]);

    // Cash in from the acquirer plus liability released by points spent,
    // against what the partner is now owed — the shape §3 of the design doc
    // specifies for a QR payment with bonus applied.
    const postings = [
      { accountId: pspAccount.id, direction: PostingDirection.DEBIT, amount: cash },
      ...(params.bonusApplied.greaterThan(0)
        ? [
            {
              accountId: liabilityAccount.id,
              direction: PostingDirection.DEBIT,
              amount: params.bonusApplied,
            },
          ]
        : []),
      {
        accountId: partnerAccount.id,
        direction: PostingDirection.CREDIT,
        amount: params.amount,
      },
    ];

    await this.ledger.post({
      kind: 'qr.redeemed.mirror',
      sourceType: 'Transaction',
      sourceId: params.transactionId,
      currency,
      postings,
    });
  }
}
