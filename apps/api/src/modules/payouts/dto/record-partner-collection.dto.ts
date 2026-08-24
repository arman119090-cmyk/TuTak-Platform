import { IsString, IsUUID, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

export class RecordPartnerCollectionDto {
  @IsUUID()
  partnerId: string;

  @IsMoneyString({ allowZero: false })
  amount: string;

  /** The partner's own bank transfer reference, from the statement. */
  @IsString()
  @Length(1, 200)
  bankReference: string;

  /**
   * The bank statement's own external transaction id — the uniqueness key
   * Problem 1 enforces at the database level. Normalized server-side (trim,
   * strip internal whitespace, uppercase) before it is compared or stored —
   * see `normalizeBankTransactionId`. Distinct from `bankReference`, which
   * stays a free-text label.
   */
  @IsString()
  @Length(1, 100)
  bankTransactionId: string;

  @IsString()
  @Length(8, 128)
  idempotencyKey: string;
}
